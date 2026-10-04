import * as THREE from "three";

const MAX = 4000;

const VERT = `
attribute float size;
attribute vec4 pcolor;
uniform float scale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

export class Particles {
  constructor(scene, blending = THREE.AdditiveBlending) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.baseA = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.target = new Array(MAX).fill(null);
    this.next = 0;

    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("pcolor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, grav = 0, drag = 0, target = null) {
    const i = this.next;
    this.next = (i + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b, a], i * 4);
    this.life[i] = this.maxLife[i] = life;
    this.baseSize[i] = this.size[i] = size;
    this.baseA[i] = a;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.target[i] = target;
  }

  // Spherical burst — sparks, blood, dust.
  burst(p, n, { speed = 4, up = 1, life = 0.5, size = 0.08, color = [1, 0.8, 0.4], a = 1, grav = 9, drag = 1, spread = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(
        p.x, p.y, p.z,
        Math.sin(ph) * Math.cos(th) * s * spread,
        Math.abs(Math.cos(ph)) * s * up + (up > 0 ? 0.5 : 0),
        Math.sin(ph) * Math.sin(th) * s * spread,
        life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8),
        color[0], color[1], color[2], a, grav, drag,
      );
    }
  }

  update(dt) {
    const tmp = new THREE.Vector3();
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      const i3 = i * 3;
      const tg = this.target[i];
      if (tg) {
        tmp.set(tg.x - this.pos[i3], tg.y + 1.1 - this.pos[i3 + 1], tg.z - this.pos[i3 + 2]);
        const d = tmp.length();
        if (d < 0.35) {
          this.life[i] = 0;
          this.size[i] = 0;
          continue;
        }
        tmp.multiplyScalar(40 * dt / d);
        this.vel[i3] = (this.vel[i3] + tmp.x) * (1 - 2.5 * dt);
        this.vel[i3 + 1] = (this.vel[i3 + 1] + tmp.y) * (1 - 2.5 * dt);
        this.vel[i3 + 2] = (this.vel[i3 + 2] + tmp.z) * (1 - 2.5 * dt);
      } else {
        this.vel[i3 + 1] -= this.grav[i] * dt;
        const k = Math.max(0, 1 - this.drag[i] * dt);
        this.vel[i3] *= k;
        this.vel[i3 + 1] *= k;
        this.vel[i3 + 2] *= k;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.3;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
      }
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.baseA[i] * Math.min(1, f * 2.5);
      this.size[i] = this.baseSize[i] * (0.5 + 0.5 * f);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

// Ribbon drawn between a weapon's base and tip positions over the last few frames.
export class Trail {
  constructor(scene, color = 0xffffff, max = 16) {
    this.max = max;
    this.pts = [];
    this.posArr = new Float32Array(max * 2 * 3);
    this.alphaArr = new Float32Array(max * 2);
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.55); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt, active, base, tip) {
    for (const p of this.pts) p.age += dt;
    if (active) {
      this.pts.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
      if (this.pts.length > this.max) this.pts.pop();
    }
    const life = 0.14;
    while (this.pts.length && this.pts[this.pts.length - 1].age > life) this.pts.pop();
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      this.posArr.set([p.b.x, p.b.y, p.b.z, p.t.x, p.t.y, p.t.z], i * 6);
      const a = (1 - i / n) * (1 - p.age / life);
      this.alphaArr[i * 2] = a * 0.2;
      this.alphaArr[i * 2 + 1] = a;
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}
