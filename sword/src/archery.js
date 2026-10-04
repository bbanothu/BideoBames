import * as THREE from "three";
const Z = new THREE.Vector3(0, 0, 1);
const ARROW_GRAVITY = 5;
const STICK_TIME = 25;

function fallbackBow() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x3a1216, roughness: 0.5 });
  for (const s of [1, -1]) {
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.62, 6), m);
    limb.position.set(0, s * 0.31, -0.04);
    limb.rotation.x = s * 0.25;
    g.add(limb);
  }
  for (const [n, y] of [["bow_tip_top", 0.6], ["bow_tip_bottom", -0.6]]) {
    const e = new THREE.Object3D();
    e.name = n;
    e.position.set(0, y, -0.1);
    g.add(e);
  }
  return g;
}

function fallbackArrow() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.75, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a10 }));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.375;
  g.add(shaft);
  return g;
}

// The bow, its live string (drawn to the archer's hand) and the nocked arrow.
export class BowRig {
  constructor(game, model) {
    this.game = game;
    this.group = model ? model.getObjectByName("Bow").clone(true) : fallbackBow();
    this.group.position.set(0, 0, 0);
    this.group.traverse((m) => m.isMesh && (m.castShadow = true));
    this.top = this.group.getObjectByName("bow_tip_top");
    this.bottom = this.group.getObjectByName("bow_tip_bottom");
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    this.string = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd8c8b0 }));
    this.string.frustumCulled = false;
    game.scene.add(this.string);
    this.nocked = game.arrows.makeMesh();
    this.nocked.visible = false;
    game.scene.add(this.nocked);
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.n = new THREE.Vector3();
  }

  // nock: world position of the drawing hand, or null for a resting string.
  update(nock, aimDir) {
    this.group.updateWorldMatrix(true, true);
    this.top.getWorldPosition(this.a);
    this.bottom.getWorldPosition(this.b);
    this.n.copy(nock || this.n.copy(this.a).add(this.b).multiplyScalar(0.5));
    const p = this.string.geometry.attributes.position;
    p.setXYZ(0, this.a.x, this.a.y, this.a.z);
    p.setXYZ(1, this.n.x, this.n.y, this.n.z);
    p.setXYZ(2, this.b.x, this.b.y, this.b.z);
    p.needsUpdate = true;
    this.string.visible = this.group.visible && !!this.group.parent;
    this.nocked.visible = !!nock;
    if (nock) {
      this.nocked.position.copy(nock);
      this.nocked.quaternion.setFromUnitVectors(Z, aimDir);
    }
  }

  gripWorld(out) {
    return this.group.getWorldPosition(out);
  }

  dispose() {
    this.string.removeFromParent();
    this.nocked.removeFromParent();
  }
}

// Arrows in flight and stuck in the world.
export class Arrows {
  constructor(game, model) {
    this.game = game;
    this.model = model ? model.getObjectByName("Arrow") : null;
    this.list = [];
    this.ray = new THREE.Raycaster();
    this.tmp = new THREE.Vector3();
  }

  makeMesh() {
    const m = this.model ? this.model.clone(true) : fallbackArrow();
    m.position.set(0, 0, 0);
    m.traverse((o) => o.isMesh && (o.castShadow = true));
    return m;
  }

  // visual: an arrow another player shot — it only sticks in walls; their game reports any hit.
  fire(from, dir, power, owner, visual = false) {
    const m = this.makeMesh();
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(Z, dir);
    this.game.scene.add(m);
    this.list.push({ m, pos: from.clone(), vel: dir.clone().multiplyScalar(26 + 34 * power), power, owner, visual, t: 0, stuck: false });
  }

  clear() {
    for (const a of this.list) a.m.removeFromParent();
    this.list = [];
  }

  // First enemy whose body (a vertical capsule) the segment passes through, sampled every ~8 cm.
  enemyOnSegment(a, b) {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(len / 0.08));
    for (let i = 1; i <= n; i++) {
      const p = this.tmp.lerpVectors(a, b, i / n);
      for (const e of this.game.foes()) {
        if (!e.alive || !e.h.root.visible || (e.isBoss && !e.active)) continue;
        const s = e.T.scale;
        const y = p.y - e.pos.y - e.yOff;
        if (y < 0.05 || y > 1.85 * s) continue;
        if (Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < e.radius * (y > 1.45 * s ? 0.6 : 1.05)) return { e, point: p.clone(), d: (len * i) / n };
      }
    }
    return null;
  }

  update(dt) {
    const g = this.game;
    for (const a of this.list) {
      a.t += dt;
      if (a.stuck) continue;
      const prev = a.pos.clone();
      a.vel.y -= ARROW_GRAVITY * dt;
      a.pos.addScaledVector(a.vel, dt);
      const seg = a.pos.clone().sub(prev);
      const len = seg.length();
      const dir = seg.clone().divideScalar(len || 1);
      let best = null;
      const eh = a.visual ? null : this.enemyOnSegment(prev, a.pos);
      // Someone else's arrow reaching us: vanish into the body (their game decides the damage).
      if (a.visual && g.player.alive && Math.hypot(a.pos.x - g.player.pos.x, a.pos.z - g.player.pos.z) < 0.4 && a.pos.y > 0.1 && a.pos.y < 1.9) {
        a.dead = true;
        continue;
      }
      if (eh) best = { kind: "enemy", ...eh };
      this.ray.set(prev, dir);
      this.ray.far = len;
      const wh = this.ray.intersectObjects(g.world.cameraMeshes, false)[0];
      if (wh && (!best || wh.distance < best.d)) best = { kind: "world", point: wh.point, d: wh.distance };
      const gNow = g.world.heightAt(a.pos.x, a.pos.z) + 0.02;
      const gPrev = g.world.heightAt(prev.x, prev.z) + 0.02;
      if (a.pos.y <= gNow) {
        const u = Math.max(0, Math.min(1, (prev.y - gPrev) / Math.max(1e-4, prev.y - gPrev - (a.pos.y - gNow))));
        const d = len * u;
        if (!best || d < best.d) best = { kind: "world", point: prev.clone().addScaledVector(dir, d), d };
      }
      a.m.quaternion.setFromUnitVectors(Z, dir);
      if (best) {
        a.stuck = true;
        a.t = 0;
        // Bury the head a little so it reads as stuck in.
        a.m.position.copy(best.point).addScaledVector(dir, -0.62);
        if (best.kind === "enemy") g.arrowHit(best.e, best.point, dir, a);
        else {
          g.audio.thunk();
          g.particles.burst(best.point, 6, { speed: 2, life: 0.4, size: 0.04, color: [0.6, 0.55, 0.45], a: 0.6, grav: 9 });
        }
      } else a.m.position.copy(a.pos);
      if (a.t > 6 && !a.stuck) a.dead = true;
    }
    for (const a of this.list) if ((a.stuck && a.t > STICK_TIME && !a.m.userData.inBody) || a.dead) a.m.removeFromParent();
    this.list = this.list.filter((a) => !(a.dead || (a.stuck && a.t > STICK_TIME && !a.m.userData.inBody)));
    // Arrows lodged in bodies are owned by the body from now on.
    this.list = this.list.filter((a) => !a.m.userData.inBody);
  }
}

