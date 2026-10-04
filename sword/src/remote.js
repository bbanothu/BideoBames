import * as THREE from "three";
import { Humanoid, JOINTS, NEUTRAL } from "./humanoid.js";
import { BowRig } from "./archery.js";
import { CLASSES, CLASS_IDS } from "./classes.js";
import { damp, dampAngle, rand } from "./util.js";

const tmp = new THREE.Vector3();

// Another player in the match, rendered from the pose/position they stream to us.
// It quacks enough like an enemy (pos, radius, facing, h, T, alive…) for lock-on, hit tests and the HUD.
export class RemotePlayer {
  constructor(game, id, name) {
    this.game = game;
    this.id = "r" + id;
    this.peerId = id;
    this.name = name;
    this.isRemote = true;
    this.h = new Humanoid({
      build: "sinew", armor: 0x2c2648, cloth: 0x2c2648, skin: 0x2c2648, leather: 0x1a1428, weapon: "demon",
      skinModel: game.assets?.ritual, model: game.assets?.hero, weaponModel: game.assets?.sword,
    });
    this.bowRig = new BowRig(game, game.assets?.bow);
    this.h.bow = this.bowRig.group;
    this.mode = "sword";
    this.h.equip("sword");
    this.h.groundAt = (x, z) => game.world.heightAt(x, z);
    game.scene.add(this.h.root);
    this.T = { scale: 1, name, bleedMul: 1, limbHp: 0 };
    this.radius = 0.4;
    this.pos = new THREE.Vector3(0, 0, -200);
    this.target = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.targetFacing = 0;
    this.yOff = 0;
    this.pose = { ...NEUTRAL };
    this.alive = true;
    this.hp = this.maxHp = 1;
    this.bleed = 0;
    this.limbDmg = {};
    this.flags = 0;
    this.state = "idle";
    this.barT = 0;
    this.dmgAccum = 0;
    this.aim = new THREE.Vector3(0, 0, 1);
    this.dripT = 0;
    this.team = "hunter";
    this.seen = false;
  }

  get invuln() {
    return !!(this.flags & 4);
  }

  // Compact state from mp.js: p position, f facing, y lift, q joints, m mode, fl flags, hp/mhp, bl bleed, a aim.
  applyState(s) {
    this.target.fromArray(s.p);
    if (!this.seen) {
      this.seen = true;
      this.pos.copy(this.target);
      this.facing = s.f;
    }
    this.targetFacing = s.f;
    this.yOff = s.y || 0;
    JOINTS.forEach((k, i) => (this.pose[k] = s.q[i] ?? this.pose[k]));
    const cls = CLASS_IDS[s.c] || "warrior";
    if (cls !== this.cls) {
      this.cls = cls;
      this.h.setWeaponModel(this.game.assets?.classWeapons?.[CLASSES[cls].weapon]);
      this.h.equip(this.mode);
      this.T.name = `${this.name} · ${CLASSES[cls].name}`;
    }
    this.h.setOpacity(s.fl & 64 ? 0.18 : 1); // a veiled rogue is barely visible
    const mode = s.m ? "bow" : "sword";
    if (mode !== this.mode) {
      this.mode = mode;
      this.h.equip(mode);
    }
    const wasSwing = this.flags & 2;
    this.flags = s.fl;
    if (this.flags & 2 && !wasSwing) this.game.audio.swing(false);
    this.alive = !!(this.flags & 16);
    this.state = this.flags & 32 ? "attack" : this.alive ? "idle" : "dead";
    this.hp = s.hp;
    this.maxHp = s.mhp;
    this.bleed = s.bl || 0;
    if (s.a) this.aim.fromArray(s.a);
  }

  update(dt) {
    this.barT -= dt;
    this.pos.x = damp(this.pos.x, this.target.x, 14, dt);
    this.pos.y = damp(this.pos.y, this.target.y, 14, dt);
    this.pos.z = damp(this.pos.z, this.target.z, 14, dt);
    if (this.pos.distanceTo(this.target) > 4) this.pos.copy(this.target); // respawn / teleport
    this.facing = dampAngle(this.facing, this.targetFacing, 16, dt);
    this.h.root.position.set(this.pos.x, this.pos.y + this.yOff, this.pos.z);
    this.h.root.rotation.y = this.facing;
    this.h.update(dt, this.pose, 18, Math.abs(this.pose.bodyX) > 0.5 ? ["bodyX"] : null);
    const nock = this.flags & 1 ? this.h.rHand.getWorldPosition(new THREE.Vector3()) : null;
    this.bowRig.update(nock, this.aim);
    // Purely cosmetic bleeding — their own game owns their health.
    if (this.alive && this.bleed > 0) {
      for (const c of this.h.cuts) {
        if (Math.random() < 0.5) continue;
        c.stump.getWorldPosition(tmp);
        this.game.blood.emit(tmp.x, tmp.y, tmp.z, rand(-1, 1), rand(0.5, 2.5), rand(-1, 1), 0.9, rand(0.04, 0.08), 0.35, 0.01, 0.01, 1, 9.8, 0.4);
      }
      if ((this.dripT -= dt) <= 0) {
        this.dripT = Math.max(0.15, 1.2 - this.bleed * 0.04);
        this.game.gore.pool(this.pos.x + rand(-0.4, 0.4), this.pos.z + rand(-0.4, 0.4), rand(0.08, 0.2));
      }
    }
  }

  onSevered() {}

  // Start of a round: whole again.
  reset() {
    this.h.restore();
    this.game.gore.clearOwner(this.h);
    this.bleed = 0;
    this.barT = 0;
    this.dmgAccum = 0;
  }

  dispose() {
    this.reset();
    this.game.hud.bars.get(this)?.remove();
    this.game.hud.bars.delete(this);
    this.h.root.removeFromParent();
    this.bowRig.dispose();
  }
}
