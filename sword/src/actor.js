import * as THREE from "three";
import { NEUTRAL } from "./humanoid.js";
import { rand } from "./util.js";

const tmp = new THREE.Vector3();

let nextId = 1;

export class Actor {
  constructor(game, humanoid, radius) {
    this.id = nextId++;
    this.game = game;
    this.h = humanoid;
    this.radius = radius;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.yOff = 0;
    this.state = "idle";
    this.t = 0;
    this.alive = true;
    this.attack = null;
    this.hitSet = new Set();
    this.pose = { ...NEUTRAL };
    this.weight = 1;
    this.bleed = 0; // hp lost per second
    this.dripT = 0;
    this.limbDmg = {};
    humanoid.groundAt = (x, z) => game.world.heightAt(x, z);
    game.scene.add(humanoid.root);
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  // Forward speed scripted by the current attack at time t.
  attackMove(def, t) {
    for (const [a, b, v] of def.move) if (t >= a && t <= b) return v;
    return 0;
  }

  clearInjuries() {
    this.h.restore();
    this.game.gore.clearOwner(this.h);
    this.bleed = 0;
    this.limbDmg = {};
  }

  // Lose blood every frame; stumps spurt in time with the heartbeat and leave pools behind.
  bleedUpdate(dt) {
    if (!this.alive || this.bleed <= 0) return;
    const g = this.game;
    const s = this.h.root.scale.x;
    this.hp -= this.bleed * dt;
    const beat = Math.sin(g.time * 8.5) > 0.3;
    for (const c of this.h.cuts) {
      if (c.cauterized) continue;
      c.stump.getWorldPosition(tmp);
      const n = beat ? 3 : 1;
      for (let i = 0; i < n; i++)
        g.blood.emit(tmp.x, tmp.y, tmp.z, rand(-1, 1) * s, rand(0.5, beat ? 3 : 1) * s, rand(-1, 1) * s, 0.9, rand(0.04, 0.08) * s, 0.35, 0.01, 0.01, 1, 9.8, 0.4);
    }
    if (this.h.wounds.length && Math.random() < 0.3) {
      const w = this.h.wounds[Math.floor(Math.random() * this.h.wounds.length)];
      w.getWorldPosition(tmp);
      g.blood.emit(tmp.x, tmp.y, tmp.z, rand(-0.2, 0.2), 0, rand(-0.2, 0.2), 0.8, 0.04 * s, 0.35, 0.01, 0.01, 1, 9.8, 0.2);
    }
    if ((this.dripT -= dt) <= 0) {
      this.dripT = Math.max(0.12, 1.2 - this.bleed * 0.04);
      g.gore.pool(this.pos.x + rand(-0.4, 0.4) * s, this.pos.z + rand(-0.4, 0.4) * s, rand(0.08, 0.2) * s * Math.min(2, 0.5 + this.bleed / 15));
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.bleedOut();
    }
  }

  // Shared limb-loss posture: limp on one leg, drag yourself on none.
  injuryPose(pose) {
    const l = this.h.legsLost;
    if (l === 1) {
      pose.hipsY -= 0.2;
      pose.torsoZ += this.h.severed.has("lLeg") ? -0.15 : 0.15;
      pose.torsoX += 0.15;
    } else if (l === 2) {
      pose.hipsY = Math.min(pose.hipsY, -0.6);
      pose.torsoX += 0.4;
    }
  }

  physics(dt) {
    this.pos.addScaledVector(this.vel, dt);
    this.game.world.resolve(this.pos, this.radius);
    this.pos.y = this.game.world.heightAt(this.pos.x, this.pos.z);
  }

  sync() {
    this.h.root.position.set(this.pos.x, this.pos.y + this.yOff, this.pos.z);
    this.h.root.rotation.y = this.facing;
  }
}
