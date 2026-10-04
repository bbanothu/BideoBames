import * as THREE from "three";
import { rand } from "./util.js";

const POOLS = 180;

// Severed body parts tumbling under gravity, plus blood pools on the floor.
export class Gore {
  constructor(game) {
    this.game = game;
    this.debris = [];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a0303, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const geo = new THREE.CircleGeometry(1, 18);
    // Squash the circle a little per vertex so pools aren't perfect discs.
    const p = geo.attributes.position;
    for (let i = 1; i < p.count; i++) {
      const k = 0.75 + Math.random() * 0.4;
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
    this.pools = [];
    for (let i = 0; i < POOLS; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.receiveShadow = true;
      game.scene.add(m);
      this.pools.push(m);
    }
    this.next = 0;
    this.growing = [];
    this.box = new THREE.Box3();
    this.tmp = new THREE.Vector3();
  }

  pool(x, z, r, grow = false) {
    const m = this.pools[this.next];
    this.next = (this.next + 1) % POOLS;
    m.position.set(x, this.game.world.heightAt(x, z) + 0.012 + (this.next % 9) * 0.0006, z);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.visible = true;
    this.growing = this.growing.filter((g) => g.m !== m);
    if (grow) {
      m.scale.setScalar(r * 0.15);
      this.growing.push({ m, r, t: 0 });
    } else m.scale.setScalar(r);
  }

  addDebris(obj, vel, h) {
    const s = h.root.scale.x;
    this.debris.push({
      obj, h, vel, t: 0, resting: false, bounced: false, scale: s,
      ang: new THREE.Vector3(rand(-9, 9), rand(-6, 6), rand(-9, 9)),
    });
  }

  clearOwner(h) {
    this.debris = this.debris.filter((d) => d.h !== h);
  }

  update(dt) {
    for (const g of this.growing) {
      g.t += dt;
      g.m.scale.setScalar(g.r * (0.15 + 0.85 * Math.min(1, g.t / 3)));
    }
    this.growing = this.growing.filter((g) => g.t < 3);

    const blood = this.game.blood;
    for (const d of this.debris) {
      if (d.resting) continue;
      d.t += dt;
      const o = d.obj;
      d.vel.y -= 9.8 * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.ang.x * dt;
      o.rotation.y += d.ang.y * dt;
      o.rotation.z += d.ang.z * dt;
      this.game.world.resolve(o.position, 0.1 * d.scale);
      this.box.setFromObject(o);
      const floor = this.game.world.heightAt(o.position.x, o.position.z);
      if (this.box.min.y < floor) {
        o.position.y += floor - this.box.min.y;
        if (!d.bounced) {
          d.bounced = true;
          this.pool(o.position.x, o.position.z, rand(0.25, 0.45) * d.scale, true);
        }
        d.vel.y = Math.abs(d.vel.y) * 0.25;
        d.vel.x *= 0.45;
        d.vel.z *= 0.45;
        d.ang.multiplyScalar(0.45);
        if (d.vel.lengthSq() < 0.05 && d.t > 0.6) d.resting = true;
      }
      if (Math.random() < 0.6) {
        const c = this.box.getCenter(this.tmp);
        blood.emit(c.x, c.y, c.z, rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4), 0.6, 0.05 * d.scale, 0.32, 0.01, 0.01, 1, 9.8, 0.3);
      }
      if (d.t > 8) d.resting = true;
    }
  }
}
