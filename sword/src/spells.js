import * as THREE from "three";
import { rand } from "./util.js";

const BOLT_SPEED = 24;

// Visual + damage flavours. dmg is before the caster's multiplier; `heal` returns that share as HP.
const BOLTS = {
  ember: { color: 0xffb060, fx: [1, 0.5, 0.15], dmg: 70 },
  holy: { color: 0xfff0a8, fx: [1, 0.88, 0.45], dmg: 72 },
  drain: { color: 0xb070ff, fx: [0.55, 0.2, 1], dmg: 60, heal: 0.5 },
};
const NOVAS = {
  ash: { ring: 0xffb080, fx: [1, 0.6, 0.45], dmg: 85, r: 4.8, magic: true },
  holy: { ring: 0xfff0b0, fx: [1, 0.92, 0.55], dmg: 75, r: 4.8, magic: true, healSelf: 0.15 },
  corpse: { ring: 0x9a50ff, fx: [0.5, 0.15, 0.9], dmg: 95, r: 5, magic: true },
  slam: { ring: 0xc8b090, fx: [0.55, 0.48, 0.4], dmg: 80, r: 4.4, magic: false },
  smite: { ring: 0xfff0b0, fx: [1, 0.92, 0.55], dmg: 70, r: 3.5, magic: true, healSelf: 0.1 },
};
const WAVES = {
  cleave: { fx: [1, 0.12, 0.05] },
  soul: { fx: [0.5, 0.15, 1] },
};

// Mana-skill and special-move effects. `visual` effects come from other players: they look the same
// but never deal damage (the caster's own game reports hits).
export class Spells {
  constructor(game) {
    this.game = game;
    this.bolts = [];
    this.ray = new THREE.Raycaster();
    this.boltGeo = new THREE.SphereGeometry(0.13, 12, 10);
    this.boltMats = Object.fromEntries(Object.entries(BOLTS).map(([k, b]) => [k, new THREE.MeshBasicMaterial({ color: b.color })]));
  }

  foeList() {
    return this.game.foes().filter((f) => f.alive && f.h.root.visible && !(f.isBoss && !f.active));
  }

  bolt(from, dir, visual = false, kind = "ember") {
    const B = BOLTS[kind] || BOLTS.ember;
    const m = new THREE.Mesh(this.boltGeo, this.boltMats[kind] || this.boltMats.ember);
    m.position.copy(from);
    this.game.scene.add(m);
    const target = visual ? null : this.game.lockTarget;
    this.bolts.push({ m, B, pos: from.clone(), vel: dir.clone().multiplyScalar(BOLT_SPEED), t: 0, visual, target });
  }

  update(dt) {
    const g = this.game;
    const pt = g.particles;
    for (const b of this.bolts) {
      b.t += dt;
      if (b.target && b.target.alive) {
        const want = b.target.pos.clone().add(new THREE.Vector3(0, 1.2 * b.target.T.scale + (b.target.yOff || 0), 0)).sub(b.pos).normalize().multiplyScalar(BOLT_SPEED);
        b.vel.lerp(want, Math.min(1, 3.2 * dt));
      }
      const prev = b.pos.clone();
      b.pos.addScaledVector(b.vel, dt);
      b.m.position.copy(b.pos);
      const [cr, cg, cb] = b.B.fx;
      for (let i = 0; i < 4; i++) pt.emit(b.pos.x + rand(-0.06, 0.06), b.pos.y + rand(-0.06, 0.06), b.pos.z + rand(-0.06, 0.06), rand(-0.4, 0.4), rand(0, 0.8), rand(-0.4, 0.4), rand(0.25, 0.45), rand(0.14, 0.26), cr, cg, cb, 0.9);
      let hit = null;
      if (!b.visual) {
        for (const f of this.foeList()) {
          const y = b.pos.y - f.pos.y - (f.yOff || 0);
          if (y > 0 && y < 1.9 * f.T.scale && Math.hypot(b.pos.x - f.pos.x, b.pos.z - f.pos.z) < f.radius + 0.25) {
            hit = f;
            break;
          }
        }
      } else if (g.player.alive && b.pos.distanceTo(g.player.pos.clone().setY(g.player.pos.y + 1.1)) < 0.6) b.done = true;
      const seg = b.pos.clone().sub(prev);
      this.ray.set(prev, seg.clone().normalize());
      this.ray.far = seg.length();
      const wall = this.ray.intersectObjects(g.world.cameraMeshes, false).length > 0;
      const ground = b.pos.y < g.world.heightAt(b.pos.x, b.pos.z) + 0.05;
      if (hit || wall || ground || b.t > 3 || b.done) {
        this.burst(b.pos, b.B.fx);
        if (hit) {
          const dmg = b.B.dmg * g.player.spellMul;
          g.damageFoe(hit, dmg, 40, b.pos);
          if (b.B.heal) g.player.healBy(dmg * b.B.heal);
        }
        b.done = true;
      }
    }
    for (const b of this.bolts) if (b.done) b.m.removeFromParent();
    this.bolts = this.bolts.filter((b) => !b.done);
  }

  burst(p, [r, gr, b]) {
    const g = this.game;
    g.particles.burst(p, 40, { speed: 4, up: 0.8, life: 0.5, size: 0.22, color: [r, gr, b], a: 0.9, grav: 1, drag: 3 });
    g.particles.burst(p, 14, { speed: 6, life: 0.35, size: 0.06, color: [1, 0.85, 0.5], grav: 8 });

  }

  // Bursts around a point: Ashen Nova, Sanctuary, Corpse Burst, Ground Slam, Divine Smite.
  nova(center, visual = false, kind = "ash") {
    const g = this.game;
    const N = NOVAS[kind] || NOVAS.ash;
    g.ring(center, N.r, N.ring, 0.4);
    const [r, gr, b] = N.fx;
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(3, 9);
      g.particles.emit(center.x, center.y + rand(0.3, 1.6), center.z, Math.cos(a) * s, rand(0.5, 3), Math.sin(a) * s, rand(0.4, 0.8), rand(0.15, 0.35), r, gr, b, 0.85, 2, 2.5);
    }
    g.audio.boom();
    g.shake(0.6);
    if (visual) return;
    const p = g.player;
    const mul = N.magic ? p.spellMul : p.outMul;
    for (const f of this.foeList()) {
      const d = Math.hypot(f.pos.x - center.x, f.pos.z - center.z);
      if (d > N.r + f.radius) continue;
      g.damageFoe(f, N.dmg * mul * (1 - 0.4 * (d / N.r)), 90, center, true);
      if (!f.isRemote && !f.isBoss) f.vel.addScaledVector(new THREE.Vector3(f.pos.x - center.x, 0, f.pos.z - center.z).normalize(), 9);
    }
    if (N.healSelf) p.healBy(p.maxHp * N.healSelf);
  }

  // A line of fire rolling forward (Crimson Cleave / Soul Rend).
  wave(start, dir, visual = false, kind = "cleave") {
    const g = this.game;
    const [r, gr, b] = (WAVES[kind] || WAVES.cleave).fx;
    const hitSet = new Set();
    let t = 0;
    let next = 0;
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    g.fx.push((dt) => {
      t += dt;
      while (next <= t && next < 0.6) {
        const at = start.clone().addScaledVector(flat, (next / 0.6) * 10);
        at.y = g.world.heightAt(at.x, at.z);
        for (let i = 0; i < 18; i++)
          g.particles.emit(at.x + rand(-0.6, 0.6), at.y + 0.1, at.z + rand(-0.6, 0.6), rand(-0.5, 0.5), rand(2, 5), rand(-0.5, 0.5), rand(0.35, 0.6), rand(0.2, 0.42), r, gr, b, 0.85, -1, 1);
        if (!visual) {
          for (const f of this.foeList()) {
            if (hitSet.has(f) || Math.hypot(f.pos.x - at.x, f.pos.z - at.z) > 1.4 + f.radius) continue;
            hitSet.add(f);
            g.damageFoe(f, 80 * g.player.outMul, 50, at, true);
          }
        }
        next += 0.06;
      }
      return t < 0.7;
    });
  }

  blinkFx(a, b) {
    const pt = this.game.particles;
    for (const [p, n] of [[a, 50], [b, 70]])
      for (let i = 0; i < n; i++)
        pt.emit(p.x + rand(-0.4, 0.4), p.y + rand(0, 1.8), p.z + rand(-0.4, 0.4), rand(-1, 1), rand(-0.5, 1.5), rand(-1, 1), rand(0.4, 0.8), rand(0.1, 0.25), 0.45, 0.2, 0.9, 0.8, 0, 2);
    this.game.audio.blink();
  }

  // A soft glow around the caster (buffs, heals) — purely visual.
  aura(p, [r, g, b], n = 40) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.game.particles.emit(p.x + Math.cos(a) * 0.6, p.y + rand(0, 0.4), p.z + Math.sin(a) * 0.6, Math.cos(a) * 0.3, rand(1.2, 2.6), Math.sin(a) * 0.3, rand(0.6, 1.1), rand(0.1, 0.2), r, g, b, 0.85);
    }
  }

  // Effects other players triggered.
  remote(d) {
    const v = (a) => new THREE.Vector3().fromArray(a);
    if (d.k === "bolt") this.bolt(v(d.from), v(d.dir), true, d.kind);
    else if (d.k === "nova") this.nova(v(d.p), true, d.kind);
    else if (d.k === "wave") this.wave(v(d.p), v(d.dir), true, d.kind);
    else if (d.k === "blink") this.blinkFx(v(d.a), v(d.b));
    else if (d.k === "aura") this.aura(v(d.p), d.c);
  }
}
