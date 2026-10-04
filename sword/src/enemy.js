import * as THREE from "three";
import { Actor } from "./actor.js";
import { Humanoid, P, copyPose, locomotion, sampleKeys } from "./humanoid.js";
import { ATTACKS } from "./attacks.js";
import { angleTo, clamp, damp, distXZ, rand, turnToward, wrapAngle } from "./util.js";

export const TYPES = {
  hollow: {
    name: "Hollow", hp: 150, scale: 1, radius: 0.4, walk: 1.7, run: 4.0, turn: 4.5, souls: 55, poise: 0, aggro: 12, limbHp: 0, bleedMul: 1,
    look: { armor: 0x4d4a44, cloth: 0x4f4234, skin: 0x8c7b68, leather: 0x2e261e, helm: "hollow", weapon: "broken", blade: 0x7a6a58 },
    attacks: [
      { id: "h_slash", min: 0, max: 2.4, w: 3 },
      { id: "h_over", min: 0, max: 2.5, w: 2 },
      { id: "h_lunge", min: 2.0, max: 4.6, w: 2 },
    ],
    cooldown: [1.1, 2.6],
  },
  knight: {
    name: "Fallen Knight", hp: 440, scale: 1.1, radius: 0.45, walk: 1.8, run: 3.7, turn: 3.6, souls: 260, poise: 60, aggro: 14, limbHp: 0, bleedMul: 1,
    look: { armor: 0x5c6068, cloth: 0x1f2a3a, skin: 0x8c7b68, leather: 0x2a2018, helm: "knight", weapon: "sword", shield: true, cape: true },
    attacks: [
      { id: "k_slash", min: 0, max: 2.6, w: 3 },
      { id: "k_combo", min: 0, max: 2.6, w: 2 },
      { id: "k_thrust", min: 2.0, max: 4.6, w: 2 },
    ],
    cooldown: [0.9, 2.0],
    guard: true,
  },
  boss: {
    name: "Ashen Warden", hp: 1750, scale: 2.15, radius: 0.95, walk: 2.3, run: 4.8, turn: 2.4, souls: 6000, poise: 260, aggro: 999, limbHp: 320, bleedMul: 0.35,
    look: { armor: 0x57514b, cloth: 0x5a1a14, skin: 0x6a5a4a, leather: 0x241a14, helm: "boss", weapon: "greatsword", eyes: 0xff5a10, metal: 0x5a4a3a, blade: 0x6a6460, cape: true },
    attacks: [
      { id: "b_sweep", min: 0, max: 5.2, w: 3 },
      { id: "b_over", min: 0, max: 5.4, w: 3 },
      { id: "b_combo", min: 0, max: 5.0, w: 2 },
      { id: "b_thrust", min: 4.5, max: 11, w: 3 },
      { id: "b_leap", min: 8, max: 18, w: 4, phase: 2 },
      { id: "b_nova", min: 0, max: 5, w: 2, phase: 2 },
    ],
    cooldown: [0.7, 1.6],
    boss: true,
  },
};

export class Enemy extends Actor {
  constructor(game, spawn) {
    const T = TYPES[spawn.type];
    super(game, new Humanoid({ ...T.look, scale: T.scale }), T.radius);
    this.T = T;
    this.type = spawn.type;
    this.isBoss = !!T.boss;
    this.spawn = new THREE.Vector3(spawn.x, game.world.heightAt(spawn.x, spawn.z), spawn.z);
    this.wild = !!spawn.wild;
    // Raised by a necromancer: hunts other enemies, follows the player, crumbles after a while.
    this.ally = !!spawn.ally;
    this.life = 30;
    this.outMul = 0.7;
    this.spawnFacing = spawn.f ?? 0;
    this.maxHp = T.hp;
    this.weight = T.scale * T.scale * 1.5;
    this.trail = null;
    this.reset();
  }

  reset() {
    this.pos.copy(this.spawn);
    this.vel.set(0, 0, 0);
    this.facing = this.spawnFacing;
    this.hp = this.maxHp;
    this.alive = true;
    this.active = !this.isBoss;
    this.cooldown = 0.5;
    this.poiseCur = 0;
    this.poiseT = 0;
    this.barT = 0;
    this.dmgAccum = 0;
    this.guardHits = 0;
    this.phase = 1;
    this.speedMul = this.isBoss ? 1 : 1;
    this.strafeDir = 1;
    this.yOff = 0;
    this.walkPhase = Math.random() * 6;
    this.h.root.visible = true;
    this.h.setOpacity(1);
    this.h.setGlow(this.ally ? 0x8a40ff : null);
    if (this.ally) this.h.setTint(0x9a8ab8, 0x1a0630);
    this.clearInjuries();
    for (const m of this.stuck || []) m.removeFromParent();
    this.stuck = [];
    copyPose(this.h.cur, P.NEUTRAL);
    this.setState("idle");
    this.sync();
    this.h.apply();
  }

  get guarding() {
    return this.T.guard && this.state === "strafe" && !this.h.severed.has("lArm");
  }

  pickAttack(dist) {
    const lame = this.h.legsLost > 0;
    const opts = this.T.attacks.filter((a) => dist >= a.min && dist <= a.max && (a.phase ?? 1) <= this.phase && !(lame && (a.id === "b_leap" || a.min > 3)));
    if (!opts.length) return null;
    let r = Math.random() * opts.reduce((s, a) => s + a.w, 0);
    for (const a of opts) if ((r -= a.w) <= 0) return a.id;
    return opts[0].id;
  }

  startAttack(id) {
    this.attack = ATTACKS[id];
    this.attackId = id;
    this.hitSet.clear();
    this.lastTs = 0;
    this.swung = false;
    this.setState("attack");
  }

  update(dt) {
    if (!this.h.root.visible) return;
    const g = this.game;
    // Who this enemy is after: the player, or for allies the nearest hostile.
    const p = this.ally ? this.allyTarget() : g.player;
    if (this.ally && (this.life -= dt) <= 0 && this.alive) {
      this.die();
      return;
    }
    this.t += dt;
    this.cooldown -= dt;
    this.barT -= dt;
    if ((this.poiseT -= dt) <= 0) this.poiseCur = 0;
    const dist = distXZ(this.pos, p.pos);
    const toP = angleTo(this.pos, p.pos);
    const pose = this.pose;
    const T = this.T;
    let rate = 14;
    let snap = null;
    const playerAvailable = p.alive && p.state !== "rest" && !(p.isPlayer && p.veiled) && !(this.ally && p.isPlayer);
    this.bleedUpdate(dt);
    if (!this.alive && this.state !== "dead") return;
    const legMul = [1, 0.3, 0.1][this.h.legsLost];
    const disarmed = this.h.severed.has("rArm");

    switch (this.state) {
      case "idle": {
        this.vel.multiplyScalar(0.8);
        copyPose(pose, this.isBoss ? P.NEUTRAL : P.RELAXED);
        if (this.ally) {
          // Heel: trail the necromancer when there's nothing to kill.
          const pl = g.player;
          const d = distXZ(this.pos, pl.pos);
          if (d > 3.5) {
            this.facing = turnToward(this.facing, angleTo(this.pos, pl.pos), T.turn * dt);
            const f = this.forward();
            const sp = d > 8 ? T.run : T.walk * 1.4;
            this.vel.set(f.x * sp, 0, f.z * sp);
            this.locomote(pose, dt, d > 8);
          }
        }
        if (this.active && playerAvailable && dist < T.aggro) this.setState("chase");
        break;
      }
      case "chase": {
        if (!playerAvailable) {
          this.setState(this.isBoss ? "idle" : "return");
          break;
        }
        if (!this.isBoss && !this.ally && distXZ(this.pos, this.spawn) > 30) {
          this.setState("return");
          break;
        }
        if (this.isBoss && this.phase === 1 && this.hp < this.maxHp * 0.5) {
          this.enterPhase2();
          break;
        }
        if (disarmed) {
          this.facing = turnToward(this.facing, toP + Math.PI, T.turn * dt);
          const f = this.forward();
          const sp = (dist < 12 ? T.run * 0.8 : 0) * legMul;
          this.vel.x = damp(this.vel.x, f.x * sp, 6, dt);
          this.vel.z = damp(this.vel.z, f.z * sp, 6, dt);
          this.locomote(pose, dt, sp > T.walk * 1.5);
          break;
        }
        this.facing = turnToward(this.facing, toP, T.turn * dt);
        if (this.cooldown <= 0) {
          const id = this.pickAttack(dist);
          if (id) {
            this.startAttack(id);
            break;
          }
        }
        let speed;
        if (this.isBoss) speed = dist > 14 ? T.run : dist > 3.8 ? T.walk * (this.phase === 2 ? 1.35 : 1) : 0;
        else if (dist > 5.5) speed = T.run;
        else if (this.cooldown > 0) {
          this.strafeDir = Math.random() < 0.5 ? 1 : -1;
          this.strafeT = rand(1.0, 2.4);
          this.setState("strafe");
          break;
        } else speed = T.walk;
        speed *= legMul;
        const f = this.forward();
        this.vel.x = damp(this.vel.x, f.x * speed, 8, dt);
        this.vel.z = damp(this.vel.z, f.z * speed, 8, dt);
        this.locomote(pose, dt, speed > T.walk * 1.5);
        break;
      }
      case "strafe": {
        if (!playerAvailable) {
          this.setState("return");
          break;
        }
        this.facing = turnToward(this.facing, toP, T.turn * dt);
        const f = this.forward();
        const side = new THREE.Vector3(f.z, 0, -f.x).multiplyScalar(this.strafeDir);
        const keep = clamp((dist - 3) * 0.8, -1, 1);
        const v = side.multiplyScalar(T.walk * 0.75 * legMul).addScaledVector(f, keep * T.walk * 0.6 * legMul);
        this.vel.x = damp(this.vel.x, v.x, 6, dt);
        this.vel.z = damp(this.vel.z, v.z, 6, dt);
        this.locomote(pose, dt, false);
        if (T.guard) for (const k of ["lShX", "lShY", "lShZ", "lEl"]) pose[k] = P.BLOCK[k];
        if (this.t > this.strafeT || this.cooldown <= 0 || dist > 6.5) this.setState("chase");
        break;
      }
      case "attack": {
        const a = this.attack;
        const ts = this.t * this.speedMul;
        if (ts < a.track && playerAvailable) this.facing = turnToward(this.facing, toP, a.trackRate * this.speedMul * dt);
        const v = this.attackMove(a, ts) * this.speedMul * legMul;
        const f = this.forward();
        this.vel.x = damp(this.vel.x, f.x * v, 12, dt);
        this.vel.z = damp(this.vel.z, f.z * v, 12, dt);
        if (a.leap && ts >= a.leap[0] && ts <= a.leap[1] && this.leapFrom) {
          const u = (ts - a.leap[0]) / (a.leap[1] - a.leap[0]);
          this.pos.lerpVectors(this.leapFrom, this.leapTo, u);
          this.vel.set(0, 0, 0);
          this.yOff = Math.sin(u * Math.PI) * 5.5;
        } else this.yOff = 0;
        if (a.hits.length && !this.swung && ts >= a.hits[0][0] - 0.1) {
          this.swung = true;
          g.audio.swing(this.isBoss);
        }
        for (const [et, name] of a.events) if (this.lastTs < et && ts >= et) this.onEvent(name);
        if (a.charge && ts >= a.charge[0] && ts <= a.charge[1]) this.chargeFx(dt, (ts - a.charge[0]) / (a.charge[1] - a.charge[0]));
        this.lastTs = ts;
        sampleKeys(a.keys, ts, pose);
        rate = 24;
        if (ts >= a.dur) {
          this.yOff = 0;
          const [c0, c1] = T.cooldown;
          this.cooldown = rand(c0, c1) * (this.phase === 2 ? 0.6 : 1);
          if (this.isBoss && this.phase === 2 && Math.random() < 0.3) this.cooldown = 0.15;
          this.setState("chase");
        }
        break;
      }
      case "hit": {
        this.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
        copyPose(pose, P.HIT);
        if (this.t >= this.hitDur) {
          this.cooldown = Math.min(this.cooldown, 0.3);
          this.setState("chase");
        }
        break;
      }
      case "roar": {
        this.vel.set(0, 0, 0);
        copyPose(pose, this.t < 0.5 ? P.CROUCH : P.ROAR);
        rate = 8;
        if (this.t > 0.6 && this.t < 2.0) g.shake(0.15);
        for (let i = 0; i < 4; i++) this.flameAlongBlade();
        if (this.t >= 2.4) this.setState("chase");
        break;
      }
      case "return": {
        if (this.ally) {
          this.setState("idle");
          break;
        }
        const d = distXZ(this.pos, this.spawn);
        this.facing = turnToward(this.facing, angleTo(this.pos, this.spawn), T.turn * dt);
        const f = this.forward();
        this.vel.x = damp(this.vel.x, f.x * T.walk * 1.3 * legMul, 6, dt);
        this.vel.z = damp(this.vel.z, f.z * T.walk * 1.3 * legMul, 6, dt);
        this.locomote(pose, dt, false);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3 * dt);
        if (d < 0.8) {
          this.facing = this.spawnFacing;
          this.hp = this.maxHp;
          this.setState("idle");
        } else if (playerAvailable && dist < T.aggro * 0.6 && d < 20) this.setState("chase");
        break;
      }
      case "dead": {
        this.vel.multiplyScalar(Math.max(0, 1 - 5 * dt));
        copyPose(pose, P.DEAD);
        rate = 7;
        this.yOff = Math.max(0, this.yOff - dt * 12);
        if (this.t > 9) {
          const a = Math.max(0, 1 - (this.t - 9) / 1.5);
          this.h.setOpacity(a);
          if (Math.random() < 0.5) g.particles.emit(this.pos.x + rand(-0.5, 0.5), rand(0, 0.5), this.pos.z + rand(-0.5, 0.5), 0, rand(0.5, 1.2), 0, 1.2, 0.08 * this.T.scale, 0.7, 0.75, 0.85, 0.7);
          if (a <= 0) this.h.root.visible = false;
        }
        break;
      }
    }

    if (this.isBoss && this.phase === 2 && this.alive && Math.random() < 0.7) this.flameAlongBlade();

    if (!["dead", "roar"].includes(this.state)) this.injuryPose(pose);
    if (this.state !== "dead") this.physics(dt);
    if (this.isBoss) {
      const A = g.world.arena;
      this.pos.x = clamp(this.pos.x, A.minX, A.maxX);
      this.pos.z = clamp(this.pos.z, A.minZ, A.maxZ);
    }
    this.sync();
    this.h.update(dt, pose, rate, snap);
  }

  locomote(pose, dt, run) {
    const sp = Math.hypot(this.vel.x, this.vel.z) / this.T.scale;
    const f = this.forward();
    const back = this.vel.x * f.x + this.vel.z * f.z < -0.3 ? -1 : 1;
    this.walkPhase += sp * dt * 2.7 * back;
    locomotion(pose, P.NEUTRAL, sp, this.walkPhase, run);
  }

  flameAlongBlade() {
    const b = this.h.baseWorld(new THREE.Vector3());
    const t = this.h.tipWorld(new THREE.Vector3());
    const p = b.lerp(t, Math.random());
    this.game.particles.emit(p.x, p.y, p.z, rand(-0.3, 0.3), rand(0.8, 1.8), rand(-0.3, 0.3), rand(0.25, 0.5), rand(0.15, 0.3), 1, rand(0.3, 0.5), 0.08, 0.7);
  }

  chargeFx(dt, u) {
    const pt = this.game.particles;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 7.5 * (1 - u * 0.3) * Math.random();
      pt.emit(this.pos.x + Math.cos(a) * r, 0.1, this.pos.z + Math.sin(a) * r, 0, rand(0.5, 2) * (0.5 + u), 0, 0.6, rand(0.2, 0.4), 1, 0.35, 0.08, 0.6);
    }
    this.game.shake(0.05 * u);
  }

  onEvent(name) {
    const g = this.game;
    const p = g.player;
    if (name === "slam") {
      const tip = this.h.tipWorld(new THREE.Vector3());
      tip.y = 0.1;
      g.particles.burst(tip, 40, { speed: 6, up: 1.2, life: 0.8, size: 0.25, color: [0.5, 0.45, 0.4], a: 0.5, grav: 4, drag: 2 });
      g.shake(0.6);
      g.audio.boom();
      if (this.phase === 2) g.shockwave(tip, 5.5, 110, this);
    } else if (name === "leapStart") {
      this.leapFrom = this.pos.clone();
      const to = p.pos.clone();
      const d = to.clone().sub(this.pos);
      if (d.length() > 15) d.setLength(15);
      d.setLength(Math.max(0, d.length() - 1.5));
      this.leapTo = this.pos.clone().add(d);
      const A = g.world.arena;
      this.leapTo.x = clamp(this.leapTo.x, A.minX, A.maxX);
      this.leapTo.z = clamp(this.leapTo.z, A.minZ, A.maxZ);
      g.audio.roar();
    } else if (name === "leapLand") {
      this.yOff = 0;
      this.leapFrom = null;
      g.shockwave(this.pos.clone(), 4.8, 150, this);
      g.audio.boom();
      g.shake(1.0);
    } else if (name === "plant") {
      g.audio.boom();
      g.shake(0.4);
    } else if (name === "nova") {
      g.shockwave(this.pos.clone(), 7.5, this.attack.dmg, this, true);
    }
  }

  // Returns true if the hit was guarded.
  receiveHit(dmg, poiseDmg, attacker) {
    const g = this.game;
    const fromAngle = angleTo(this.pos, attacker.pos);
    const frontal = Math.abs(wrapAngle(fromAngle - this.facing)) < 1.4;
    let guarded = false;
    if (this.guarding && frontal) {
      guarded = true;
      dmg *= 0.15;
      poiseDmg = 0;
      if (++this.guardHits >= 3) {
        this.guardHits = 0;
        this.hitDur = 1.3;
        this.setState("hit");
        g.hud.toast("Guard broken!");
      }
    }
    // Hitting a hollow that hasn't noticed you yet always staggers and aggros it.
    if (this.state === "idle") this.setState("chase");
    dmg = Math.round(dmg);
    this.hp -= dmg;
    if (this.barT <= 0) this.dmgAccum = 0;
    this.dmgAccum += dmg;
    this.barT = 3.5;
    this.h.flash();
    if (this.hp <= 0) {
      this.die();
      return guarded;
    }
    this.poiseCur += poiseDmg;
    this.poiseT = 3;
    if (!guarded && this.poiseCur >= this.T.poise && poiseDmg > 0) {
      this.poiseCur = 0;
      this.hitDur = this.isBoss ? 1.4 : 0.6;
      const away = new THREE.Vector3(this.pos.x - attacker.pos.x, 0, this.pos.z - attacker.pos.z).normalize();
      this.vel.copy(away).multiplyScalar(this.isBoss ? 1.5 : 3);
      this.yOff = 0;
      this.setState("hit");
      if (this.isBoss) g.hud.toast("Staggered!");
    }
    if (this.isBoss && this.phase === 1 && this.hp < this.maxHp * 0.5 && this.state !== "attack") this.enterPhase2();
    return guarded;
  }

  bleedOut() {
    this.die();
  }

  allyTarget() {
    const g = this.game;
    let best = null;
    let bd = 18;
    for (const e of g.enemies) {
      if (e.ally || !e.alive || !e.h.root.visible || (e.isBoss && !e.active)) continue;
      const d = distXZ(this.pos, e.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best || g.player;
  }

  dispose() {
    this.clearInjuries();
    for (const m of this.stuck || []) m.removeFromParent();
    this.h.root.removeFromParent();
  }

  onSevered(part) {
    if (part === "head") {
      if (this.alive) this.die();
      return;
    }
    if (!this.alive) return;
    // Losing a limb always staggers, and losing the sword arm ends whatever swing was coming.
    this.yOff = 0;
    this.leapFrom = null;
    this.hitDur = this.isBoss ? 1.2 : 0.8;
    this.setState("hit");
  }

  enterPhase2() {
    this.phase = 2;
    this.speedMul = 1.2;
    this.h.setGlow(0xff5a10);
    this.game.audio.roar();
    this.setState("roar");
  }

  die() {
    const g = this.game;
    this.hp = 0;
    this.alive = false;
    this.yOff = 0;
    this.setState("dead");
    g.onEnemyKilled(this);
  }
}
