import * as THREE from "three";

const STEP = 1 / 90;
const GRAVITY = new THREE.Vector3(0, -9.8, 0);
const LEG_R = 0.085;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

// Spring-bone skirt: each strand is a verlet chain pinned at the waist. Strands keep their flare via a
// pull toward the rigid rest shape (strong at the waist, loose at the hem), stay together via ring
// links to their neighbours, and are pushed out of the legs and the floor. The resulting points pose
// the skirt bones that the robe is skinned to.
export class SkirtCloth {
  // chains: [[{ bone, rest }]] — bone is a detached Object3D used by the skeleton; rest is in body space.
  constructor(h, chains) {
    this.h = h;
    this.chains = chains.map((nodes) =>
      nodes.map((n, j) => ({
        bone: n.bone,
        rest: n.rest.clone(),
        len: j ? n.rest.distanceTo(nodes[j - 1].rest) : 0,
        // How hard each node is pulled back toward its rest shape (per 1/90 s step).
        stiff: 0.32 * Math.pow(1 - j / nodes.length, 2) + 0.012,
        x: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        target: new THREE.Vector3(),
      })),
    );
    const n = this.chains.length;
    this.ring = this.chains.map((c, i) => c.map((node, j) => node.rest.distanceTo(this.chains[(i + 1) % n][j].rest)));
    this.acc = 0;
    this.needsReset = true;
    this.legs = [];
  }

  reset() {
    this.needsReset = true;
  }

  updateTargets() {
    const mw = this.h.body.matrixWorld;
    for (const c of this.chains) for (const n of c) n.target.copy(n.rest).applyMatrix4(mw);
  }

  // Capsules for the legs that still exist (a severed leg no longer pushes cloth).
  updateLegs() {
    const h = this.h;
    this.legs.length = 0;
    for (const [hip, knee] of [[h.lHip, h.lKnee], [h.rHip, h.rKnee]]) {
      if (hip.userData.cut) continue;
      const a = hip.getWorldPosition(new THREE.Vector3());
      const b = knee.getWorldPosition(new THREE.Vector3());
      this.legs.push([a, b]);
      if (!knee.userData.cut) this.legs.push([b, knee.localToWorld(new THREE.Vector3(0, -h.L2, 0))]);
    }
  }

  step(dt) {
    const h = this.h;
    h.root.updateMatrixWorld(true);
    this.updateTargets();
    if (!this.needsReset) {
      // Teleports (respawn, fog gate) or a blown-up sim: snap back to the rest shape.
      const c0 = this.chains[0];
      if (c0[c0.length - 1].x.distanceTo(c0[c0.length - 1].target) > 2.5) this.needsReset = true;
    }
    if (this.needsReset) {
      this.needsReset = false;
      this.acc = 0;
      for (const c of this.chains) for (const n of c) n.x.copy(n.target), n.prev.copy(n.target);
    }
    this.updateLegs();
    this.acc = Math.min(this.acc + dt, STEP * 6);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.substep();
    }
    this.poseBones();
  }

  substep() {
    const g2 = STEP * STEP;
    const ground = this.h.groundAt;
    for (const c of this.chains) {
      c[0].x.copy(c[0].target);
      c[0].prev.copy(c[0].target);
      for (let j = 1; j < c.length; j++) {
        const n = c[j];
        _a.subVectors(n.x, n.prev).multiplyScalar(0.97);
        n.prev.copy(n.x);
        n.x.add(_a).addScaledVector(GRAVITY, g2);
        n.x.lerp(n.target, n.stiff);
        n.floor = (ground ? ground(n.x.x, n.x.z) : 0) + 0.015;
      }
    }
    const nc = this.chains.length;
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < nc; i++) {
        const c = this.chains[i];
        const o = this.chains[(i + 1) % nc];
        for (let j = 1; j < c.length; j++) {
          const n = c[j];
          // Inextensible strand: keep the link to the parent node at rest length.
          _b.subVectors(n.x, c[j - 1].x);
          const d = _b.length() || 1e-6;
          n.x.addScaledVector(_b, (n.len - d) / d);
          // Ring link to the next strand: only resists stretching, so the hem can still bunch up.
          _c.subVectors(o[j].x, n.x);
          const rd = _c.length() || 1e-6;
          const rl = this.ring[i][j] * 1.15;
          if (rd > rl) {
            _c.multiplyScalar(((rd - rl) / rd) * 0.5);
            n.x.add(_c);
            o[j].x.sub(_c);
          }
          for (const [a, b] of this.legs) pushOutOfCapsule(n.x, a, b, LEG_R);
          if (n.x.y < n.floor) n.x.y = n.floor;
        }
      }
    }
  }

  // Each skirt bone sits on its node and turns its rest direction toward the next node.
  poseBones() {
    const mw = this.h.body.matrixWorld;
    mw.decompose(_a, _q, _s);
    for (const c of this.chains) {
      for (let j = 0; j < c.length; j++) {
        const n = c[j];
        if (j < c.length - 1) {
          _b.subVectors(c[j + 1].rest, n.rest).applyQuaternion(_q).normalize();
          _d.subVectors(c[j + 1].x, n.x).normalize();
          _q2.setFromUnitVectors(_b, _d).multiply(_q);
        } else _q2.copy(_q);
        n.bone.matrixWorld.compose(n.x, _q2, _s);
      }
    }
  }
}

function pushOutOfCapsule(p, a, b, r) {
  _c.subVectors(b, a);
  const t = Math.max(0, Math.min(1, _d.subVectors(p, a).dot(_c) / _c.lengthSq()));
  _d.copy(a).addScaledVector(_c, t);
  _c.subVectors(p, _d);
  const dist = _c.length();
  if (dist < r && dist > 1e-6) p.copy(_d).addScaledVector(_c, r / dist);
}
