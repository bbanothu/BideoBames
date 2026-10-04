import * as THREE from "three";
import { Actor } from "./actor.js";
import { Humanoid, P, copyPose, lerpPose, locomotion, sampleKeys } from "./humanoid.js";
import { BowRig } from "./archery.js";
import { ITEMS } from "./loot.js";
import { CLASSES, SKILLS, SPECIALS } from "./classes.js";
import { ATTACKS } from "./attacks.js";
import { angleTo, damp, dampAngle, smooth } from "./util.js";

const ROLL_DUR = 0.62;
const BACKSTEP_DUR = 0.42;
const DRINK_DUR = 1.4;

export class Player extends Actor {
  constructor(game) {
    super(
      game,
      new Humanoid({
        build: "sinew", armor: 0x2c2648, cloth: 0x2c2648, skin: 0x2c2648, leather: 0x1a1428, weapon: "demon",
        skinModel: game.assets?.ritual, model: game.assets?.hero, weaponModel: game.assets?.sword,
      }),
      0.4,
    );
    this.isPlayer = true;
    this.stats = { vig: 10, end: 10, str: 10, arc: 10 };
    this.manaFlaskMax = 3;
    this.manaFlasks = this.manaFlaskMax;
    this.souls = 0;
    this.estusMax = 4;
    this.recompute();
    this.hp = this.maxHp;
    this.sta = this.maxSta;
    this.mana = this.maxMana;
    this.estus = this.estusMax;
    this.buffer = null;
    this.combo = 0;
    this.stDelay = 0;
    this.blocking = false;
    this.sprinting = false;
    this.phase = 0;
    this.rollDir = new THREE.Vector3();
    this.hitDur = 0;
    this.healed = false;
    this.swung = false;
    this.weight = 1;
    // Weapons: the demon blade (right hand) and a bow (left hand); the one not in use rides on the back.
    this.mode = "sword";
    // Quiver holds 60; bonfires top it up to at least 30. Spent arrows can be picked back up.
    this.arrowsMax = 60;
    this.arrows = 30;
    this.inv = { hpvial: 0, mpvial: 0, regrow: 1 };
    this.bow = new BowRig(game, game.assets?.bow);
    this.h.bow = this.bow.group;
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.buffs = {};
    this.vy = 0;
    this.airborne = false;
    this.grappleAim = null;
    this.aimTick = 0;
    // Grappling rope + hook.
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.rope = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0x3a2a1c }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.hook = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.4 }));
    this.hook.visible = false;
    game.scene.add(this.rope, this.hook);
    this.T = { scale: 1, bleedMul: 1, limbHp: 0 };
    this.applyClass("warrior");
    this.equip("sword");
  }

  // Class: weapon, tempo, reach, passives. Stats are only reset for a fresh character.
  applyClass(id, resetStats = false) {
    this.clsId = CLASSES[id] ? id : "warrior";
    const c = (this.cls = CLASSES[this.clsId]);
    this.speedMul = c.atkSpeed;
    this.rangeMul = c.range;
    this.T.bleedMul = c.bleedMul ?? 1;
    if (resetStats) this.stats = { ...c.stats };
    this.h.setWeaponModel(this.game.assets?.classWeapons?.[c.weapon]);
    this.h.setSkinnedModel(this.game.assets?.bodies?.[c.model]);
    this.h.cloth?.reset();
    this.h.equip(this.mode || "sword");
    this.recompute();
  }

  get weaponName() {
    return { sword: "Demon Blade", dagger: "Kris Dagger", mace: "Holy Mace", axe: "Great Axe", staff: "Bone Staff" }[this.cls.weapon];
  }

  // Outgoing physical damage: strength × class × buffs × (berserker) missing health.
  get outMul() {
    let m = this.dmgMul * this.cls.atkDmg;
    if (this.buffs.warcry > 0) m *= 1.3;
    if (this.buffs.rage > 0) m *= 1.25;
    if (this.cls.bloodlust) m *= 1 + 0.6 * (1 - this.hp / this.maxHp);
    return m;
  }

  healBy(n) {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  // Called when our melee lands (lifesteal, venom).
  onDealtMelee(dmg) {
    if (this.buffs.rage > 0) this.healBy(dmg * 0.2);
    this.reveal();
    return this.buffs.venom > 0 ? 8 : 0;
  }

  get veiled() {
    return this.buffs.veil > 0;
  }

  reveal() {
    if (this.buffs.veil > 0) {
      this.buffs.veil = 0;
      this.h.setOpacity(1);
    }
  }

  equip(mode) {
    this.mode = mode;
    this.h.equip(mode);
  }

  get level() {
    return this.stats.vig + this.stats.end + this.stats.str + this.stats.arc - 39;
  }

  recompute() {
    const s = this.stats;
    this.maxHp = Math.round((420 + (s.vig - 10) * 38) * (this.hpMul ?? 1));
    this.maxSta = Math.round(95 + (s.end - 10) * 6);
    this.dmgMul = 1 + (s.str - 10) * 0.055;
    this.maxMana = Math.round(80 + ((s.arc ?? 10) - 10) * 7);
    this.spellMul = 1 + ((s.arc ?? 10) - 10) * 0.06;
  }

  invulnerable() {
    const t = this.t;
    if (this.state === "roll") return t > 0.04 && t < 0.42;
    if (this.state === "blink") return true;
    if (this.state === "backstep") return t > 0.03 && t < 0.24;
    return ["dead", "fog", "rest"].includes(this.state);
  }

  refillArrows() {
    this.arrows = Math.max(this.arrows, 30);
  }

  spawnAt(pos, facing) {
    this.pos.copy(pos);
    this.pos.y = this.game.world.heightAt(pos.x, pos.z);
    this.game.world.terrain.prime(this.pos);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.alive = true;
    this.hp = this.maxHp;
    this.sta = this.maxSta;
    this.mana = this.maxMana;
    this.estus = this.estusMax;
    this.manaFlasks = this.manaFlaskMax;
    this.buffs = {};
    this.h.setOpacity(1);
    this.yOff = 0;
    this.vy = 0;
    this.airborne = false;
    this.rope.visible = this.hook.visible = false;
    this.h.root.visible = true;
    this.buffer = null;
    this.clearInjuries();
    this.setState("idle");
    copyPose(this.h.cur, P.NEUTRAL);
    this.h.cloth?.reset();
    this.sync();
  }

  captureBuffer(inp) {
    for (const a of ["light", "heavy", "roll", "estus", "swap", "special", "manaPot", "jump", "grapple"]) if (inp[a]) this.buffer = { a, t: 0.4 };
    if (inp.grapplePad && this.mode !== "bow") this.buffer = { a: "grapple", t: 0.4 };
    if (inp.spell) this.buffer = { a: "spell", i: inp.spell - 1, t: 0.4 };
    if (inp.item) this.buffer = { a: "item", i: ["hpvial", "mpvial", "regrow"][inp.item - 1], t: 0.4 };
  }

  update(dt, inp) {
    const g = this.game;
    this.t += dt;
    this.stDelay -= dt;
    if (this.state !== "dead" && this.state !== "rest") this.captureBuffer(inp);
    if (this.buffer && (this.buffer.t -= dt) <= 0) this.buffer = null;
    this.bleedUpdate(dt);
    const cut = this.h.severed;
    const legMul = [1, 0.35, 0.15][this.h.legsLost];

    const move = g.rig.moveVector(inp.moveX, inp.moveY);
    const mag = Math.min(1, move.length());
    const lock = g.lockTarget;
    const fwd = this.forward();
    let animRate = 15;
    let snap = null;
    const pose = this.pose;
    const bowMode = this.mode === "bow";
    // Aiming (bow only): over-the-shoulder camera, face where the camera looks.
    this.aiming = bowMode && inp.aim && ["idle", "draw", "loose"].includes(this.state);
    g.rig.aiming = this.aiming;
    let nock = null;
    this.h.flask.visible = false;
    if (this.state !== "attack") this.yOff = 0;
    if (!["cast", "blink"].includes(this.state)) this.mana = Math.min(this.maxMana, this.mana + 0.8 * dt);
    for (const k in this.buffs) if (this.buffs[k] > 0 && (this.buffs[k] -= dt) <= 0 && k === "veil") this.h.setOpacity(1);
    if (this.cls.regen && this.alive) this.healBy(this.cls.regen * dt);
    if (this.buffs.rage > 0 && Math.random() < 0.3) g.particles.emit(this.pos.x + (Math.random() - 0.5) * 0.6, this.pos.y + Math.random() * 1.8, this.pos.z + (Math.random() - 0.5) * 0.6, 0, 1, 0, 0.5, 0.1, 1, 0.15, 0.05, 0.8);
    if (this.buffs.warcry > 0 && Math.random() < 0.2) g.particles.emit(this.pos.x + (Math.random() - 0.5) * 0.6, this.pos.y + Math.random() * 1.8, this.pos.z + (Math.random() - 0.5) * 0.6, 0, 1, 0, 0.5, 0.1, 1, 0.7, 0.3, 0.8);
    this.sprinting = false;
    if (this.state !== "idle") this.blocking = false;

    switch (this.state) {
      case "idle": {
        this.sprinting = inp.sprint && mag > 0.3 && this.sta > 0 && legMul === 1;
        this.blocking = inp.block && !this.sprinting && !cut.has("lArm") && !bowMode;
        const speed = mag * legMul * (this.sprinting ? 6.6 : this.blocking ? 2.2 : 4.0) * (this.buffs.rage > 0 ? 1.15 : 1);
        if (this.sprinting) {
          this.sta -= 20 * dt;
          this.stDelay = 0.5;
        }
        const dir = mag > 0.01 ? move.clone().normalize() : move;
        const accel = this.airborne ? 2.5 : 12; // keep momentum in the air
        this.vel.x = damp(this.vel.x, dir.x * speed, accel, dt);
        this.vel.z = damp(this.vel.z, dir.z * speed, accel, dt);
        if (lock && !this.sprinting) this.facing = dampAngle(this.facing, angleTo(this.pos, lock.pos), 12, dt);
        else if (mag > 0.1) this.facing = dampAngle(this.facing, Math.atan2(move.x, move.z), 11, dt);
        const sp = Math.hypot(this.vel.x, this.vel.z);
        // Walking backwards while locked on reverses the stride.
        const back = this.vel.x * fwd.x + this.vel.z * fwd.z < -0.5 ? -1 : 1;
        this.phase += sp * dt * 2.7 * back;
        if (this.aiming) this.facing = dampAngle(this.facing, g.rig.yaw, 16, dt);
        const stance = bowMode ? P.BOW_IDLE : this.blocking ? P.BLOCK : this.h.hasShield ? P.NEUTRAL : P.NEUTRAL_1H;
        locomotion(pose, this.blocking && !bowMode ? P.BLOCK : stance, sp, this.phase, this.sprinting);
        if (this.blocking) {
          for (const k of ["lShX", "lShY", "lShZ", "lEl"]) pose[k] = P.BLOCK[k];
        }
        if (this.airborne) {
          copyPose(pose, P.JUMP);
          if (bowMode) for (const k of ["lShX", "lShY", "lShZ", "lEl"]) pose[k] = P.BOW_IDLE[k];
        }
        this.tryActions(move, mag);
        break;
      }
      case "grapple": {
        // Throw the hook, then reel in hard toward the anchor.
        const gp = this.grappling;
        const hand = this.h.lHand.getWorldPosition(new THREE.Vector3());
        const reach = Math.min(1, this.t / 0.18);
        const end = hand.clone().lerp(gp.hit, reach);
        const ra = this.rope.geometry.attributes.position;
        ra.setXYZ(0, hand.x, hand.y, hand.z);
        ra.setXYZ(1, end.x, end.y, end.z);
        ra.needsUpdate = true;
        this.hook.position.copy(end);
        this.hook.lookAt(gp.hit.clone().add(gp.dir));
        this.hook.rotateX(Math.PI / 2);
        copyPose(pose, P.GRAPPLE);
        animRate = 20;
        this.facing = dampAngle(this.facing, Math.atan2(gp.dir.x, gp.dir.z), 14, dt);
        this.vel.set(0, 0, 0);
        if (this.t >= 0.18) {
          const to = gp.target.clone().sub(this.pos);
          const d = to.length();
          const step = Math.min(d, 26 * dt * Math.min(1, (this.t - 0.18) * 4 + 0.3));
          this.pos.addScaledVector(to.normalize(), step);
          g.world.resolve(this.pos, this.radius, this.pos.y);
          if (d < 0.6 || this.t > 2.4) this.endGrapple();
        }
        break;
      }
      case "attack": {
        const a = this.attack;
        const ts = this.t * this.speedMul; // class attack tempo
        if (ts < a.track) {
          const want = lock ? angleTo(this.pos, lock.pos) : mag > 0.2 ? Math.atan2(move.x, move.z) : this.facing;
          this.facing = dampAngle(this.facing, want, a.trackRate * 1.4, dt);
        }
        const v = this.attackMove(a, ts) * this.speedMul * legMul;
        const f = this.forward();
        this.vel.x = damp(this.vel.x, f.x * v, 14, dt);
        this.vel.z = damp(this.vel.z, f.z * v, 14, dt);
        if (!this.swung && ts >= a.hits[0][0] - 0.06) {
          this.swung = true;
          g.audio.swing(a.heavy);
        }
        sampleKeys(a.keys, ts, pose);
        animRate = 26;
        for (const [et, name] of a.events) if (this.lastAT < et && ts >= et) this.onAttackEvent(name);
        this.lastAT = ts;
        if (a.leap) {
          const u = (ts - a.leap[0]) / (a.leap[1] - a.leap[0]);
          this.yOff = u > 0 && u < 1 ? Math.sin(u * Math.PI) * 1.1 : 0;
        }
        if (ts >= a.cancel) {
          this.forceCrit = false;
          this.tryActions(move, mag);
        }
        if (this.state === "attack" && ts >= a.dur) this.setState("idle");
        break;
      }
      case "roll": {
        const u = this.t / ROLL_DUR;
        const speed = u < 0.6 ? 7.4 : 7.4 * (1 - (u - 0.6) / 0.4);
        this.vel.copy(this.rollDir).multiplyScalar(speed);
        copyPose(pose, P.ROLL);
        pose.bodyX = smooth(Math.min(1, this.t / (ROLL_DUR * 0.8))) * Math.PI * 2;
        if (u > 0.8) copyPose(pose, P.NEUTRAL);
        snap = ["bodyX"];
        animRate = 22;
        if (this.t > ROLL_DUR * 0.8) this.tryActions(move, mag);
        if (this.state === "roll" && this.t >= ROLL_DUR) this.setState("idle");
        break;
      }
      case "backstep": {
        const u = this.t / BACKSTEP_DUR;
        this.vel.copy(this.rollDir).multiplyScalar(u < 0.5 ? 6 : 6 * (1 - (u - 0.5) * 2));
        copyPose(pose, u < 0.7 ? P.BACKSTEP : P.NEUTRAL);
        if (this.t > BACKSTEP_DUR * 0.75) this.tryActions(move, mag);
        if (this.state === "backstep" && this.t >= BACKSTEP_DUR) this.setState("idle");
        break;
      }
      case "hit": {
        this.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
        if (this.knockdown) {
          // Knocked flat, then get up.
          copyPose(pose, this.t < this.hitDur - 0.6 ? P.DEAD : P.SIT);
          if (this.t < this.hitDur - 0.6) pose.bodyX = -1.2;
          animRate = 9;
        } else copyPose(pose, P.HIT);
        if (this.t >= this.hitDur) this.setState("idle");
        break;
      }
      case "drink": {
        const sp = mag * 1.3;
        this.vel.x = damp(this.vel.x, move.x * sp, 10, dt);
        this.vel.z = damp(this.vel.z, move.z * sp, 10, dt);
        this.phase += Math.hypot(this.vel.x, this.vel.z) * dt * 2.7;
        locomotion(pose, P.DRINK, sp, this.phase);
        for (const k of ["lShX", "lShY", "lShZ", "lEl", "headX"]) pose[k] = this.t < 1.05 ? P.DRINK[k] : P.NEUTRAL[k];
        this.h.flask.visible = this.t < 1.15;
        if (!this.healed && this.t >= 0.7 && this.drinkKind === "regrow") {
          // Rebirth Draught: limbs grow back, wounds close, bleeding stops.
          this.healed = true;
          const had = this.h.severed.size;
          this.clearInjuries();
          this.healBy(this.maxHp * 0.2);
          g.audio.heal();
          g.spells.aura(this.pos, [1, 0.8, 0.3], 60);
          g.hud.toast(had ? "Your body is made whole" : "Wounds closed", 1500);
          g.mp?.send({ t: "regrow" });
        }
        if (!this.healed && this.t >= 0.7 && (this.drinkKind === "hpvial" || this.drinkKind === "mpvial")) {
          this.healed = true;
          if (this.drinkKind === "hpvial") this.healBy(this.maxHp * 0.35);
          else this.mana = Math.min(this.maxMana, this.mana + this.maxMana * 0.5);
          g.audio.heal();
          g.spells.aura(this.pos, this.drinkKind === "hpvial" ? [1, 0.3, 0.25] : [0.35, 0.55, 1], 24);
        }
        if (!this.healed && this.t >= 0.7 && this.drinkKind === "mana") {
          this.healed = true;
          this.mana = Math.min(this.maxMana, this.mana + this.maxMana * 0.6);
          g.audio.heal();
          for (let i = 0; i < 30; i++) g.particles.emit(this.pos.x + (Math.random() - 0.5) * 0.8, this.pos.y + Math.random() * 1.8, this.pos.z + (Math.random() - 0.5) * 0.8, 0, 1.2 + Math.random(), 0, 0.8, 0.12, 0.3, 0.5, 1, 0.9);
        }
        if (!this.healed && this.t >= 0.7) {
          this.healed = true;
          this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
          g.audio.heal();
          if (this.bleed > 0) {
            // The flask's fire seals wounds — but lost limbs stay lost until you rest.
            this.bleed = 0;
            for (const c of this.h.cuts) c.cauterized = true;
            g.hud.toast("Wounds cauterized");
          }
          for (let i = 0; i < 30; i++) g.particles.emit(this.pos.x + (Math.random() - 0.5) * 0.8, Math.random() * 1.8, this.pos.z + (Math.random() - 0.5) * 0.8, 0, 1.2 + Math.random(), 0, 0.8, 0.12, 1, 0.6, 0.2, 0.9);
        }
        if (this.t >= DRINK_DUR) this.setState("idle");
        break;
      }
      case "draw": {
        // Hold to draw, release to loose. Short draws are weak; under a quarter second is a cancel.
        const sp = mag * 1.7 * legMul;
        this.vel.x = damp(this.vel.x, move.x * sp, 10, dt);
        this.vel.z = damp(this.vel.z, move.z * sp, 10, dt);
        this.facing = lock && !this.aiming ? dampAngle(this.facing, angleTo(this.pos, lock.pos), 14, dt) : dampAngle(this.facing, g.rig.yaw, 14, dt);
        this.phase += Math.hypot(this.vel.x, this.vel.z) * dt * 2.7;
        const u = smooth(Math.min(1, this.t / 0.6));
        lerpPose(pose, P.BOW_NOCK, P.BOW_DRAW, u);
        locomotion(pose, { ...pose }, Math.hypot(this.vel.x, this.vel.z), this.phase);
        lerpPose(this.armPose ||= { ...P.NEUTRAL }, P.BOW_NOCK, P.BOW_DRAW, u);
        for (const k of ["lShX", "lShY", "lShZ", "lEl", "rShX", "rShY", "rShZ", "rEl", "torsoY", "headY"]) pose[k] = this.armPose[k];
        pose.torsoX -= g.rig.aimPitch() * 0.6;
        animRate = 20;
        nock = true;
        if (!this.creaked && this.t > 0.12) {
          this.creaked = true;
          g.audio.draw();
        }
        if (!inp.fireHeld) {
          if (this.t >= 0.25) this.loose(Math.min(1, Math.max(0.3, this.t / 0.85)));
          this.setState("loose");
        } else if (this.buffer?.a === "roll") this.tryActions(move, mag);
        break;
      }
      case "loose": {
        this.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
        if (this.aiming) this.facing = dampAngle(this.facing, g.rig.yaw, 14, dt);
        lerpPose(pose, P.BOW_DRAW, P.BOW_IDLE, smooth(Math.min(1, this.t / 0.35)));
        if (this.t > 0.2) this.tryActions(move, mag);
        if (this.state === "loose" && this.t >= 0.4) this.setState("idle");
        break;
      }
      case "swap": {
        this.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
        copyPose(pose, this.t < 0.45 ? P.REACH_BACK : bowMode ? P.BOW_IDLE : P.NEUTRAL_1H);
        if (!this.swapped && this.t >= 0.28) {
          this.swapped = true;
          this.equip(bowMode ? "sword" : "bow");
          g.hud.toast(this.mode === "bow" ? `Bow · ${this.arrows} arrows` : this.weaponName, 1000);
        }
        if (this.t >= 0.6) this.setState("idle");
        break;
      }
      case "cast": {
        // Every mana skill shares this: a short gesture, then the effect fires once.
        const sk = this.spell;
        const rooted = ["slam", "sanctuary", "corpse", "warcry", "rage", "raise"].includes(sk);
        const sp = rooted ? 0 : mag * 1.2 * legMul;
        this.vel.x = damp(this.vel.x, move.x * sp, 10, dt);
        this.vel.z = damp(this.vel.z, move.z * sp, 10, dt);
        if (!rooted) this.facing = lock ? dampAngle(this.facing, angleTo(this.pos, lock.pos), 14, dt) : this.aiming ? dampAngle(this.facing, g.rig.yaw, 14, dt) : this.facing;
        if (rooted) copyPose(pose, this.t < 0.4 ? P.CROUCH : P.ROAR);
        else copyPose(pose, this.t < 0.5 ? P.CAST : P.NEUTRAL_1H);
        animRate = 18;
        const fireAt = rooted ? 0.45 : 0.3;
        if (!this.castDone && this.t >= fireAt) {
          this.castDone = true;
          this.releaseSkill(sk);
        }
        if (!rooted && this.t < fireAt) {
          const hand = this.h.lHand.getWorldPosition(new THREE.Vector3());
          const c = sk === "drain" ? [0.55, 0.2, 1] : sk === "holybolt" || sk === "heal" ? [1, 0.9, 0.5] : [0.6, 0.6, 0.7];
          g.particles.emit(hand.x, hand.y, hand.z, 0, 0.5, 0, 0.3, 0.15, c[0], c[1], c[2], 0.9);
        }
        if (this.t >= (rooted ? 0.95 : 0.62)) this.setState("idle");
        break;
      }
      case "charge": {
        // Shoulder-first sprint that bowls through foes.
        this.vel.copy(this.chargeDir).multiplyScalar(this.t < 0.38 ? 13 : 13 * Math.max(0, 1 - (this.t - 0.38) / 0.15));
        lerpPose(pose, P.THRUST_BACK, P.THRUST, Math.min(1, this.t / 0.12));
        for (const f of g.foes()) {
          if (this.chargeHit.has(f) || !f.alive || !f.h.root.visible || (f.isBoss && !f.active)) continue;
          if (Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < 1.3 + f.radius) {
            this.chargeHit.add(f);
            g.damageFoe(f, 60 * this.outMul, 70, this.pos, true);
            if (!f.isRemote && !f.isBoss) f.vel.addScaledVector(this.chargeDir, 8);
          }
        }
        if (this.t >= 0.55) this.setState("idle");
        break;
      }
      case "whirl": {
        // Three spinning sweeps around the berserker.
        this.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
        this.facing += 15 * dt;
        copyPose(pose, P.SLASH_L);
        pose.rShY = 1.4;
        pose.rShX = -1.5;
        pose.rEl = 0;
        animRate = 30;
        for (const [i, at] of [0.22, 0.48, 0.74].entries()) {
          if (this.whirlHits === i && this.t >= at) {
            this.whirlHits++;
            g.audio.swing(true);
            for (const f of g.foes()) {
              if (!f.alive || !f.h.root.visible || (f.isBoss && !f.active)) continue;
              if (Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < 2.7 + f.radius) g.damageFoe(f, 42 * this.outMul, 30, this.pos, true);
            }
          }
        }
        if (this.t >= 0.95) this.setState("idle");
        break;
      }
      case "blink":
        this.vel.set(0, 0, 0);
        this.h.root.visible = this.t > 0.14;
        copyPose(pose, P.NEUTRAL_1H);
        if (this.t >= 0.3) {
          this.h.root.visible = true;
          this.setState("idle");
        }
        break;
      case "barrage": {
        // Bow special: three quick arrows, fanning slightly.
        this.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
        this.facing = lock && !this.aiming ? dampAngle(this.facing, angleTo(this.pos, lock.pos), 14, dt) : dampAngle(this.facing, g.rig.yaw, 14, dt);
        lerpPose(pose, P.BOW_NOCK, P.BOW_DRAW, Math.min(1, this.t / 0.15));
        nock = true;
        for (const [i, at] of [0.18, 0.34, 0.5].entries()) {
          if (this.shots === i && this.t >= at && this.arrows > 0) {
            this.shots++;
            const spread = (i - 1) * 0.045;
            const keep = this.aimDir.clone();
            this.aimDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
            this.loose(0.85, true);
            this.aimDir.copy(keep);
          }
        }
        if (this.t >= 0.75) this.setState("loose");
        break;
      }
      case "rest":
        this.vel.set(0, 0, 0);
        copyPose(pose, P.SIT);
        animRate = 5;
        break;
      case "fog": {
        const f = this.forward();
        this.vel.copy(f).multiplyScalar(2.4);
        this.phase += 2.4 * dt * 2.7;
        locomotion(pose, P.FOG, 1.4, this.phase);
        if (this.t > 1.8) {
          this.setState("idle");
          g.onFogTraversed();
        }
        break;
      }
      case "dead":
        this.vel.multiplyScalar(Math.max(0, 1 - 5 * dt));
        copyPose(pose, P.DEAD);
        animRate = 6;
        break;
    }

    if (!["attack", "roll", "backstep"].includes(this.state) && !this.sprinting && this.stDelay <= 0)
      this.sta = Math.min(this.maxSta, this.sta + (this.blocking ? 16 : 52) * dt);

    if (!["dead", "roll", "rest"].includes(this.state)) this.injuryPose(pose);
    this.physics(dt);
    this.updateGrappleAim();
    this.sync();
    this.h.update(dt, pose, animRate, snap);
    if (nock) {
      this.aimDir.copy(g.aimPoint()).sub(this.bow.gripWorld(new THREE.Vector3())).normalize();
      nock = this.h.rHand.getWorldPosition(new THREE.Vector3());
    }
    this.bow.update(nock, this.aimDir);
  }

  startSwap() {
    this.swapped = false;
    this.setState("swap");
    return true;
  }

  startDraw() {
    const cut = this.h.severed;
    if (cut.has("lArm") || cut.has("rArm")) {
      this.game.hud.toast("You need both arms to draw a bow");
      return true;
    }
    if (this.arrows <= 0) {
      this.game.hud.toast("Out of arrows — rest at a bonfire");
      return true;
    }
    this.creaked = false;
    this.reveal();
    this.setState("draw");
    return true;
  }

  loose(power, free = false) {
    const g = this.game;
    this.arrows--;
    if (!free) this.sta -= 10;
    this.stDelay = 0.6;
    const from = this.bow.gripWorld(new THREE.Vector3()).addScaledVector(this.aimDir, 0.05);
    g.arrows.fire(from, this.aimDir.clone(), power, this);
    g.audio.twang(power);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    g.mp?.send({ t: "arrow", from: from.toArray().map(r3), dir: this.aimDir.toArray().map(r3), pw: r3(power) });
  }

  bleedOut() {
    this.alive = false;
    this.setState("dead");
    this.game.hud.toast("You bled out", 2500);
    this.game.onPlayerDeath();
  }

  onSevered(part) {
    const g = this.game;
    const msg = {
      head: "Beheaded",
      rArm: "Your sword arm has been severed",
      lArm: "Your shield arm has been severed",
      lLeg: "Your leg has been severed",
      rLeg: "Your leg has been severed",
    }[part];
    g.hud.toast(msg, 2500);
    if (part === "head" && this.alive) {
      this.hp = 0;
      this.alive = false;
      this.setState("dead");
      g.onPlayerDeath();
    }
  }

  tryActions(move, mag) {
    const b = this.buffer;
    if (!b || (this.sta <= 0 && !["swap", "spell", "manaPot", "item", "grapple"].includes(b.a))) return;
    let ok = false;
    if (this.mode === "bow" && (b.a === "light" || b.a === "heavy")) ok = b.a === "light" ? this.startDraw() : true;
    else if (b.a === "light" || b.a === "heavy") ok = this.startAttack(b.a, move, mag);
    else if (b.a === "roll") ok = this.startRoll(move, mag);
    else if (b.a === "estus") ok = this.startDrink();
    else if (b.a === "swap") ok = this.startSwap();
    else if (b.a === "spell") ok = this.startSpell(b.i);
    else if (b.a === "special") ok = this.startSpecial(move, mag);
    else if (b.a === "manaPot") ok = this.startDrink("mana");
    else if (b.a === "item") ok = this.useItem(b.i);
    else if (b.a === "jump") ok = this.startJump();
    else if (b.a === "grapple") ok = this.state === "idle" || this.state === "loose" ? this.startGrapple() : false;
    if (ok) this.buffer = null;
  }

  startAttack(kind, move, mag) {
    if (this.h.severed.has("rArm")) {
      this.game.hud.toast("You have no arm to swing with");
      return true;
    }
    let def;
    if (kind === "light") {
      const chain = this.state === "attack" && !this.attack.heavy;
      this.combo = chain ? (this.combo % 3) + 1 : 1;
      def = ATTACKS["p_l" + this.combo];
    } else {
      this.combo = 0;
      def = ATTACKS.p_heavy;
    }
    this.sta -= def.stamina;
    this.stDelay = 0.75;
    this.reveal();
    this.attack = def;
    this.swung = false;
    this.hitSet.clear();
    const lock = this.game.lockTarget;
    if (lock) this.facing = angleTo(this.pos, lock.pos);
    else if (mag > 0.2) this.facing = Math.atan2(move.x, move.z);
    this.setState("attack");
    return true;
  }

  startJump() {
    if (this.airborne || this.state !== "idle" || this.h.legsLost === 2) return true;
    this.vy = this.h.legsLost ? 5 : 8.6;
    this.airborne = true;
    this.sta -= 8;
    this.stDelay = 0.4;
    return true;
  }

  // What the screen centre points at, within hook range (refreshed every few frames).
  updateGrappleAim() {
    const g = this.game;
    if (++this.aimTick % 3) return;
    this.grappleAim = null;
    if (!["idle", "loose"].includes(this.state)) return;
    const cam = g.camera;
    const ray = (this.aimRay ||= new THREE.Raycaster());
    ray.set(cam.getWorldPosition(new THREE.Vector3()), cam.getWorldDirection(new THREE.Vector3()));
    ray.far = 40;
    const hits = ray.intersectObjects(g.world.grappleList(this.pos.x, this.pos.z), true);
    for (const h of hits) {
      const d = h.point.distanceTo(this.pos);
      if (d < 3 || d > 32 || h.object.userData.noGrapple) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      this.grappleAim = { point: h.point.clone(), normal: n };
      break;
    }
  }

  startGrapple() {
    const a = this.grappleAim;
    if (!a) {
      this.game.hud.toast("Nothing to hook onto", 800);
      return true;
    }
    if (this.h.severed.has("lArm")) {
      this.game.hud.toast("You need your left arm to throw the hook");
      return true;
    }
    const dir = a.point.clone().sub(this.pos).normalize();
    // Aim to arrive just off the surface (on top of it if we hit a top face).
    const target = a.point.clone().addScaledVector(a.normal, a.normal.y > 0.6 ? 0.05 : 0.55);
    if (a.normal.y <= 0.6) target.y -= 0.9;
    this.grappling = { hit: a.point.clone(), target, dir };
    this.rope.visible = this.hook.visible = true;
    this.airborne = true;
    this.vy = 0;
    this.reveal?.();
    this.setState("grapple");
    return true;
  }

  endGrapple() {
    const w = this.game.world;
    this.rope.visible = this.hook.visible = false;
    // Pull ourselves up onto a nearby ledge if there is one; otherwise drop with a little hop.
    const ledge = w.ledgeAt(this.pos);
    if (ledge) {
      this.pos.set(ledge.x, ledge.top, ledge.z);
      this.airborne = false;
      this.vy = 0;
    } else {
      this.airborne = true;
      this.vy = 3.5;
    }
    this.setState("idle");
  }

  // Player movement with gravity, jumping and standing on top of things.
  physics(dt) {
    const w = this.game.world;
    if (this.state === "grapple") return;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    w.resolve(this.pos, this.radius, this.pos.y);
    let ground = w.groundAt(this.pos.x, this.pos.z, this.pos.y, this.radius);
    if (ground < -1.9) {
      // Deep water turns you back.
      this.pos.x = px;
      this.pos.z = pz;
      ground = w.groundAt(px, pz, this.pos.y, this.radius);
    }
    if (!this.airborne && this.pos.y - ground > 0.45) {
      this.airborne = true; // walked off an edge
      this.vy = 0;
    }
    if (this.airborne) {
      this.vy -= 24 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        if (this.vy < -13) this.game.particles.burst(this.pos.clone().setY(ground + 0.1), 18, { speed: 2.5, up: 0.4, life: 0.6, size: 0.18, color: [0.55, 0.5, 0.42], a: 0.45, grav: 2, drag: 3 });
        this.pos.y = ground;
        this.vy = 0;
        this.airborne = false;
      }
    } else this.pos.y = ground;
  }

  startRoll(move, mag) {
    if (this.h.legsLost || this.airborne) return true; // can't roll on one leg or in the air
    this.sta -= this.cls.rollCost ?? 22;
    this.stDelay = 0.75;
    this.game.audio.roll();
    if (mag > 0.2) {
      this.rollDir.copy(move).normalize();
      this.facing = Math.atan2(move.x, move.z);
      this.setState("roll");
    } else {
      this.rollDir.copy(this.forward()).negate();
      this.setState("backstep");
    }
    return true;
  }

  // Inventory consumables share the drinking animation.
  useItem(id) {
    if (!this.inv[id]) {
      this.game.hud.toast(`No ${ITEMS[id].name}s left`);
      return true;
    }
    this.inv[id]--;
    this.drinkKind = id;
    const fm = this.h.flask.material;
    fm.color.set(ITEMS[id].color);
    fm.emissive.set(ITEMS[id].glow);
    this.healed = false;
    this.setState("drink");
    return true;
  }

  startDrink(kind = "estus") {
    if (kind === "mana") {
      if (this.manaFlasks <= 0) {
        this.game.hud.toast("No mana flasks left");
        return true;
      }
      this.manaFlasks--;
    } else {
      if (this.estus <= 0) {
        this.game.hud.toast("No estus left");
        return true;
      }
      this.estus--;
    }
    this.drinkKind = kind;
    const fm = this.h.flask.material;
    fm.color.set(kind === "mana" ? 0x60a0ff : 0xffa040);
    fm.emissive.set(kind === "mana" ? 0x2a6aff : 0xff7a1a);
    this.healed = false;
    this.setState("drink");
    return true;
  }

  spendMana(cost) {
    if (this.mana < cost) {
      this.game.hud.toast("Not enough mana");
      return false;
    }
    this.mana -= cost;
    return true;
  }

  // Mana skill slot i (0..2) of the current class.
  startSpell(i) {
    const id = this.cls.skills[i];
    const sk = SKILLS[id];
    if (!sk) return true;
    const g = this.game;
    if (id === "raise" && g.mp) {
      g.hud.toast("The dead do not answer in the Hunt");
      return true;
    }
    if (!this.spendMana(sk.cost)) return true;
    if (!["veil", "step"].includes(id)) this.reveal();
    if (id === "step") return this.blink(7);
    if (id === "charge") {
      const move = g.rig.moveVector(g.input.a.moveX, g.input.a.moveY);
      const lock = g.lockTarget;
      this.chargeDir = lock ? new THREE.Vector3(lock.pos.x - this.pos.x, 0, lock.pos.z - this.pos.z).normalize() : move.lengthSq() > 0.04 ? move.normalize() : this.forward();
      this.facing = Math.atan2(this.chargeDir.x, this.chargeDir.z);
      this.chargeHit = new Set();
      g.audio.roar();
      this.setState("charge");
      return true;
    }
    if (id === "whirl") {
      this.whirlHits = 0;
      this.setState("whirl");
      return true;
    }
    this.spell = id;
    this.castDone = false;
    this.setState("cast");
    g.audio.cast();
    return true;
  }

  // Blink up to `dist` metres toward the stick (or forward), stopping at walls.
  blink(dist, dirOverride = null, to = null) {
    const g = this.game;
    const move = g.rig.moveVector(g.input.a.moveX, g.input.a.moveY);
    const dir = dirOverride || (move.lengthSq() > 0.04 ? move.normalize() : this.forward());
    const from = this.pos.clone();
    const p = this.pos.clone();
    if (to) p.copy(to);
    else
      for (let d = 0; d < dist; d += 0.25) {
        const want = p.clone().addScaledVector(dir, 0.25);
        g.world.resolve(want, this.radius);
        if (want.distanceTo(p) < 0.12) break;
        p.copy(want);
      }
    g.world.resolve(p, this.radius);
    p.y = g.world.heightAt(p.x, p.z);
    this.pos.copy(p);
    if (!to) this.facing = Math.atan2(dir.x, dir.z);
    g.spells.blinkFx(from, p);
    this.sendFx({ k: "blink", a: from.toArray(), b: p.toArray() });
    this.setState("blink");
    return true;
  }

  sendFx(d) {
    const r3 = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
    const out = { t: "fx" };
    for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? v.map(r3) : v;
    this.game.mp?.send(out);
  }

  releaseSkill(id) {
    const g = this.game;
    const here = this.pos.clone();
    switch (id) {
      case "holybolt":
      case "drain": {
        const kind = id === "drain" ? "drain" : "holy";
        const from = this.h.lHand.getWorldPosition(new THREE.Vector3()).addScaledVector(this.forward(), 0.25);
        const dir = g.aimPoint().sub(from).normalize();
        g.spells.bolt(from, dir, false, kind);
        this.sendFx({ k: "bolt", kind, from: from.toArray(), dir: dir.toArray() });
        break;
      }
      case "slam":
      case "sanctuary":
      case "corpse": {
        const kind = { slam: "slam", sanctuary: "holy", corpse: "corpse" }[id];
        g.spells.nova(here, false, kind);
        this.sendFx({ k: "nova", kind, p: here.toArray() });
        break;
      }
      case "heal": {
        this.healBy(this.maxHp * 0.35);
        this.bleed = 0;
        for (const c of this.h.cuts) c.cauterized = true;
        g.audio.heal();
        this.aura(here, [1, 0.88, 0.5]);
        break;
      }
      case "warcry":
        this.buffs.warcry = 12;
        g.audio.roar();
        g.shake(0.3);
        this.aura(here, [1, 0.7, 0.3]);
        break;
      case "rage":
        this.buffs.rage = 12;
        g.audio.roar();
        this.aura(here, [1, 0.12, 0.05]);
        break;
      case "veil":
        this.buffs.veil = 6;
        this.h.setOpacity(0.28);
        for (const e of g.enemies) if (!e.ally && e.state !== "dead" && e.state !== "idle") e.setState("return");
        g.particles.burst(here.clone().setY(here.y + 1), 60, { speed: 2.5, life: 1.4, size: 0.4, color: [0.35, 0.35, 0.4], a: 0.5, grav: -0.3, drag: 1.5 });
        this.sendFx({ k: "aura", p: here.toArray(), c: [0.4, 0.4, 0.45] });
        break;
      case "venom":
        this.buffs.venom = 12;
        this.aura(here, [0.3, 0.9, 0.3]);
        break;
      case "raise": {
        for (const side of [-1, 1]) {
          const f = this.forward();
          const x = this.pos.x + f.x * 1.5 + f.z * side * 1.5, z = this.pos.z + f.z * 1.5 - f.x * side * 1.5;
          g.spawnEnemy({ type: "hollow", x, z, f: this.facing, ally: true });
          g.particles.burst(new THREE.Vector3(x, g.world.heightAt(x, z) + 0.3, z), 40, { speed: 3, up: 1.5, life: 1, size: 0.2, color: [0.5, 0.2, 0.9], a: 0.8, grav: 1, drag: 2 });
        }
        g.audio.roar();
        break;
      }
    }
  }

  aura(p, c) {
    this.game.spells.aura(p, c);
    this.sendFx({ k: "aura", p: p.toArray(), c });
  }

  // V: the class special (sword hand) or Barrage (bow).
  startSpecial(move, mag) {
    const g = this.game;
    const cut = this.h.severed;
    if (this.mode === "bow") {
      if (cut.has("lArm") || cut.has("rArm") || this.arrows <= 0) return this.startDraw();
      if (!this.spendMana(SPECIALS.barrage.cost)) return true;
      this.reveal();
      this.shots = 0;
      this.setState("barrage");
      return true;
    }
    if (cut.has("rArm")) return this.startAttack("light", move, mag);
    const sp = this.cls.special;
    if (!this.spendMana(SPECIALS[sp].cost)) return true;
    this.reveal();
    if (sp === "assassinate") {
      // Blink behind the target and strike a guaranteed critical.
      const lock = g.lockTarget;
      if (lock && lock.alive && this.pos.distanceTo(lock.pos) < 11) {
        const behind = lock.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(lock.facing), 0, Math.cos(lock.facing)), -1.1);
        this.blink(0, null, behind);
        this.facing = angleTo(this.pos, lock.pos);
      } else this.blink(5);
      this.forceCrit = true;
      this.buffer = { a: "light", t: 0.5 };
      return true;
    }
    const def = { cleave: ATTACKS.p_cleave, smite: ATTACKS.p_smite, soulrend: ATTACKS.p_soulrend }[sp];
    this.sta -= def.stamina;
    this.stDelay = 0.9;
    this.attack = def;
    this.combo = 0;
    this.swung = false;
    this.lastAT = 0;
    this.hitSet.clear();
    const lock = g.lockTarget;
    if (lock) this.facing = angleTo(this.pos, lock.pos);
    else if (mag > 0.2) this.facing = Math.atan2(move.x, move.z);
    this.setState("attack");
    g.audio.roar();
    return true;
  }

  onAttackEvent(name) {
    const g = this.game;
    const f = this.forward();
    const c = this.pos.clone().addScaledVector(f, 1.6);
    c.y = g.world.heightAt(c.x, c.z);
    if (name === "cleave" || name === "soulrend") {
      const kind = name === "cleave" ? "cleave" : "soul";
      g.ring(c, 3, kind === "cleave" ? 0xff4020 : 0x9a50ff, 0.3);
      g.playerBlast(c, 3, 70 * this.outMul);
      g.spells.wave(c, f, false, kind);
      g.audio.boom();
      g.shake(0.8);
      this.sendFx({ k: "wave", kind, p: c.toArray(), dir: f.toArray() });
    } else if (name === "smite") {
      g.spells.nova(c, false, "smite");
      this.sendFx({ k: "nova", kind: "smite", p: c.toArray() });
    }
  }

  // Returns "blocked" | "guardbreak" | "hit" | "dead"
  receiveHit(dmg, attacker, { knockdown = false, unblockable = false } = {}) {
    const g = this.game;
    const toAtt = angleTo(this.pos, attacker.pos);
    const frontal = Math.abs(((toAtt - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.6;
    dmg *= this.cls.dmgTaken * (this.buffs.warcry > 0 ? 0.85 : 1);
    if (this.blocking && frontal && !unblockable) {
      this.sta -= dmg * 0.55 * (this.clsId === "warrior" ? 0.6 : 1);
      this.stDelay = 0.8;
      if (this.sta < 0) {
        this.sta = 0;
        this.hitDur = 1.0;
        this.knockdown = false;
        this.setState("hit");
        return "guardbreak";
      }
      const away = new THREE.Vector3(this.pos.x - attacker.pos.x, 0, this.pos.z - attacker.pos.z).normalize();
      this.vel.addScaledVector(away, 2.5);
      return "blocked";
    }
    this.hp -= dmg;
    this.h.flash();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.setState("dead");
      g.onPlayerDeath();
      return "dead";
    }
    this.knockdown = knockdown;
    this.hitDur = knockdown ? 1.6 : 0.42;
    const away = new THREE.Vector3(this.pos.x - attacker.pos.x, 0, this.pos.z - attacker.pos.z).normalize();
    this.vel.copy(away).multiplyScalar(knockdown ? 7 : 3.2);
    this.facing = toAtt;
    this.setState("hit");
    return "hit";
  }
}
