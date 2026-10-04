import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Sekiro-flavoured nature: procedural sakura / black pine / maple / green trees, wind-blown grass,
// layered misty mountains on the horizon, a water plane for the valleys, and drifting petals.

export const wind = { value: 0 };
const grassCenter = { value: new THREE.Vector3() };
export const WATER_LEVEL = -0.8;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Paint a geometry with a base colour, per-face jitter and darker undersides (cheap ambient occlusion).
function paint(geo, [r, g, b], jitter, r01, aoAxis = true) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    ymin = Math.min(ymin, pos.getY(i));
    ymax = Math.max(ymax, pos.getY(i));
  }
  for (let f = 0; f < pos.count; f += 3) {
    const j = 1 + (r01() - 0.5) * 2 * jitter;
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      const ao = aoAxis ? 0.62 + 0.38 * ((pos.getY(i) - ymin) / Math.max(1e-3, ymax - ymin)) : 1;
      col.set([r * j * ao, g * j * ao, b * j * ao], i * 3);
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

function limb(start, dir, len, r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate(start.x, start.y, start.z);
  return g;
}

// A lumpy foliage blob with soft (sphere) normals.
function blob(c, sx, sy, sz, r01, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const seed = r01() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + 0.44 * hash3(Math.round(x * 3) + seed, Math.round(y * 3), Math.round(z * 3));
    nrm.setXYZ(i, x, y, z);
    pos.setXYZ(i, c.x + x * sx * k, c.y + y * sy * k, c.z + z * sz * k);
  }
  return g;
}

// Alpha-cut clusters of small leaves, tinted per species via vertex colours.
let leafTex = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  for (let i = 0; i < 220; i++) {
    const r = Math.sqrt(Math.random()) * 118;
    const a = Math.random() * Math.PI * 2;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const l = 170 + Math.random() * 85;
    g.fillStyle = `rgb(${l},${l},${l})`;
    g.save();
    g.translate(x, y);
    g.rotate(Math.random() * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, 4 + Math.random() * 5, 2.5 + Math.random() * 3, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  return leafTex;
}

const SPECIES = {
  sakura: { bark: [0.16, 0.11, 0.09], leaves: [[0.97, 0.74, 0.82], [0.94, 0.64, 0.75], [1, 0.84, 0.89]], petals: [0.98, 0.76, 0.84] },
  pine: { bark: [0.2, 0.14, 0.1], leaves: [[0.16, 0.27, 0.15], [0.2, 0.32, 0.17], [0.13, 0.22, 0.12]] },
  maple: { bark: [0.2, 0.13, 0.09], leaves: [[0.78, 0.2, 0.08], [0.88, 0.36, 0.1], [0.7, 0.14, 0.07]], petals: [0.85, 0.25, 0.08] },
  green: { bark: [0.22, 0.16, 0.11], leaves: [[0.26, 0.42, 0.17], [0.32, 0.48, 0.2], [0.22, 0.36, 0.15]] },
};

function buildTree(kind, seed) {
  const r = rng(seed);
  const S = SPECIES[kind];
  const bark = [];
  const leaves = [];
  const cards = [];
  const leaf = (c, sx, sy, sz) => {
    const col = S.leaves[Math.floor(r() * S.leaves.length)];
    leaves.push(paint(blob(c, sx * 0.82, sy * 0.82, sz * 0.82, r), col, 0.12, r));
    // Leaf cards on the blob's surface break up the silhouette.
    const n = Math.round(6 + (sx + sz) * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * Math.PI * 2, v = Math.acos(r() * 2 - 1);
      const dir = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
      const q = new THREE.PlaneGeometry(1.1 + r() * 0.6, 1.1 + r() * 0.6);
      q.rotateZ(r() * Math.PI);
      q.lookAt(dir);
      q.translate(c.x + dir.x * sx * 0.9, c.y + dir.y * sy * 0.9, c.z + dir.z * sz * 0.9);
      const nrm = q.attributes.normal;
      for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, dir.x, dir.y, dir.z);
      cards.push(paint(q, col, 0.15, r, false));
    }
  };
  const up = new THREE.Vector3(0, 1, 0);
  // Gnarled trunk: a chain of leaning segments.
  const segs = kind === "pine" ? 4 : 3;
  const H = kind === "pine" ? 8 : kind === "sakura" ? 4.2 : 4.8;
  let p = new THREE.Vector3(0, -0.4, 0);
  let d = up.clone();
  const lean = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize().multiplyScalar(kind === "pine" ? 0.55 : 0.25);
  let rad = kind === "pine" ? 0.38 : 0.42;
  const trunkPts = [];
  for (let i = 0; i < segs; i++) {
    d = d.clone().add(lean.clone().multiplyScalar(0.6 + r())).add(new THREE.Vector3((r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35)).normalize();
    const len = (H / segs) * (0.85 + r() * 0.3);
    bark.push(limb(p, d, len, rad, rad * 0.78));
    p = p.clone().addScaledVector(d, len);
    rad *= 0.78;
    trunkPts.push(p.clone());
  }
  const top = p;
  if (kind === "pine") {
    // Japanese black pine: horizontal limbs ending in flat cloud-pads.
    for (let i = 0; i < 6; i++) {
      const base = trunkPts[Math.min(segs - 1, 1 + Math.floor(r() * (segs - 1)))].clone();
      const a = r() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0.15 + r() * 0.25, Math.sin(a));
      const len = 1.6 + r() * 2.2;
      bark.push(limb(base, dir, len, 0.14, 0.06));
      const end = base.clone().addScaledVector(dir.normalize(), len);
      leaf(end, 1.5 + r() * 0.9, 0.42 + r() * 0.15, 1.4 + r() * 0.8);
      leaf(end.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, 0.25, (r() - 0.5) * 1.2)), 1.0, 0.35, 1.0);
    }
    leaf(top.clone().add(new THREE.Vector3(0, 0.3, 0)), 1.7, 0.55, 1.7);
  } else {
    // Spreading crown: limbs up and out, foliage clustered at their ends.
    const n = kind === "sakura" ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.8;
      const spread = kind === "sakura" ? 0.95 : 0.6;
      const dir = new THREE.Vector3(Math.cos(a) * spread, 0.7 + r() * 0.4, Math.sin(a) * spread).normalize();
      const len = 1.8 + r() * 1.6;
      bark.push(limb(top, dir, len, 0.17, 0.07));
      const end = top.clone().addScaledVector(dir, len);
      const big = kind === "sakura" ? 1.7 : 1.5;
      leaf(end, big * (0.8 + r() * 0.4), big * 0.7, big * (0.8 + r() * 0.4));
      for (let k = 0; k < 2; k++) leaf(end.clone().add(new THREE.Vector3((r() - 0.5) * 2, (r() - 0.6) * 1.2, (r() - 0.5) * 2)), 1 + r() * 0.5, 0.8 + r() * 0.3, 1 + r() * 0.5);
      if (kind === "sakura") leaf(end.clone().add(new THREE.Vector3(dir.x * 0.8, -1.1, dir.z * 0.8)), 0.8, 0.9, 0.8); // drooping
    }
    leaf(top.clone().add(new THREE.Vector3(0, 1.4, 0)), 1.9, 1.3, 1.9);
  }
  return {
    bark: mergeGeometries(bark.map((g) => paint(g, S.bark, 0.18, r, false))),
    leaves: mergeGeometries(leaves),
    cards: mergeGeometries(cards),
    height: top.y + 2,
  };
}

// Shader tweaks: foliage sways in the wind and gets a leafy breakup pattern.
function windify(mat, { sway = 0.06, leafy = false, grass = false, twoSided = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.uniforms.uGrassCenter = grassCenter;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;\nuniform vec3 uGrassCenter;\nvarying vec3 vLeafPos;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float hgt = max(position.y, 0.0);
        ${grass ? "float k = hgt * hgt * 1.6;" : "float k = hgt * 0.08;"}
        transformed.x += sin(uWind * 1.7 + ip.x * 0.31 + ip.z * 0.17 + position.z) * ${sway.toFixed(3)} * k;
        transformed.z += cos(uWind * 1.3 + ip.z * 0.27 + position.x) * ${(sway * 0.6).toFixed(3)} * k;
        vLeafPos = position + ip;
        ${grass ? "transformed *= smoothstep(36.0, 27.0, distance(ip.xz, uGrassCenter.xz)); // fade at the field's edge" : ""}`,
      );
    if (twoSided) {
      // Thin blades and leaf cards: light both faces like the front, instead of flipping to a dark back.
      sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n normal = normalize(vNormal);");
    }
    if (leafy) {
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vLeafPos;\nfloat lh(vec3 p){ return fract(sin(dot(floor(p), vec3(12.9898,78.233,37.719))) * 43758.5453); }")
        .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb *= 0.78 + 0.36 * lh(vLeafPos * 5.0);");
    }
  };
  return mat;
}

function mountainRing(radius, height, color, seed, segs = 160) {
  const r = rng(seed);
  const phase = [r() * 10, r() * 10, r() * 10];
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const h = height * (0.35 + 0.35 * Math.sin(a * 3 + phase[0]) ** 2 + 0.25 * Math.abs(Math.sin(a * 7 + phase[1])) + 0.15 * Math.sin(a * 17 + phase[2]));
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -40, z, x, h, z);
    if (i < segs) {
      const b = i * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -0.5;
  return m;
}

const WATER_FRAG = `
uniform float uTime; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogDensity;
varying vec3 vW;
float wave(vec2 p){ return sin(p.x*0.9+uTime*1.2)*0.5 + sin(p.y*1.3-uTime*0.9)*0.4 + sin((p.x+p.y)*2.7+uTime*2.1)*0.15 + sin((p.x-p.y)*4.1-uTime*2.6)*0.08; }
void main(){
  vec2 p = vW.xz;
  float e = 0.15;
  vec3 n = normalize(vec3(-(wave(p+vec2(e,0.))-wave(p-vec2(e,0.)))*0.35, 1.0, -(wave(p+vec2(0.,e))-wave(p-vec2(0.,e)))*0.35));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.08 + 0.85 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 col = mix(uDeep, uSky, fres);
  vec3 R = reflect(-V, n);
  col += vec3(1.0, 0.93, 0.78) * pow(max(dot(R, uSun), 0.0), 180.0) * 2.2;
  float d = length(cameraPosition - vW);
  col = mix(col, uFog, 1.0 - exp(-uFogDensity * uFogDensity * d * d));
  gl_FragColor = vec4(col, 0.86);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Nature {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.barkMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { sway: 0.01 });
    this.leafMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { sway: 0.05, leafy: true });
    this.cardMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide }), { sway: 0.07, twoSided: true });
    // Two variants of each species, shared by every instance.
    this.trees = {};
    for (const kind of Object.keys(SPECIES)) this.trees[kind] = [buildTree(kind, 11 + kind.length * 7), buildTree(kind, 97 + kind.length * 13)];
    // Grass clump: seven fine blades with a dark-root-to-sunlit-tip gradient.
    const blades = [];
    const r = rng(5);
    for (let i = 0; i < 7; i++) {
      const h = 0.22 + r() * 0.36;
      const g = new THREE.PlaneGeometry(0.05, h, 1, 3);
      g.translate(0, h / 2, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setX(k, p.getX(k) * (1 - p.getY(k) / h)); // taper to a point
      g.rotateY(r() * Math.PI);
      g.rotateX((r() - 0.5) * 0.4);
      g.translate((r() - 0.5) * 0.45, 0, (r() - 0.5) * 0.45);
      blades.push(g);
    }
    const clump = mergeGeometries(blades);
    const cp = clump.attributes.position;
    const col = new Float32Array(cp.count * 3);
    for (let k = 0; k < cp.count; k++) {
      const t = Math.min(1, cp.getY(k) / 0.7);
      col.set([0.16 + 0.3 * t, 0.27 + 0.33 * t, 0.09 + 0.12 * t], k * 3);
    }
    clump.setAttribute("color", new THREE.BufferAttribute(col, 3));
    clump.computeVertexNormals();
    for (let k = 0; k < clump.attributes.normal.count; k++) clump.attributes.normal.setXYZ(k, 0, 1, 0); // lit like the ground
    this.grassGeo = clump;
    this.grassMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), { sway: 0.16, grass: true, twoSided: true });
    this.field = null;

    // Horizon: three ranges of mountains, each paler with distance (aerial perspective).
    this.horizon = new THREE.Group();
    this.horizon.add(mountainRing(330, 70, 0x5c7480, 3), mountainRing(390, 110, 0x7f95a2, 7), mountainRing(460, 160, 0xa3b3bd, 13));
    this.scene.add(this.horizon);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 700, 1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uDeep: { value: new THREE.Color(0x1d3c42) },
          uSky: { value: new THREE.Color(0xb9cad6) },
          uSun: { value: new THREE.Vector3(-0.42, 0.72, 0.55).normalize() },
          uFog: { value: new THREE.Color(0xc9d2d8) },
          uFogDensity: { value: 0.0085 },
        },
        vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: WATER_FRAG,
        transparent: true,
      }),
    );
    this.water.position.y = WATER_LEVEL;
    this.scene.add(this.water);
    this.sakura = []; // world positions of blossom trees, for petals
  }

  // Single tree for hand placement (castle courtyard).
  makeTree(kind, variant = 0) {
    const t = this.trees[kind][variant % 2];
    const g = new THREE.Group();
    const b = new THREE.Mesh(t.bark, this.barkMat);
    const l = new THREE.Mesh(t.leaves, this.leafMat);
    const c = new THREE.Mesh(t.cards, this.cardMat);
    for (const m of [b, l, c]) {
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  // Instanced trees for a terrain chunk: list of {kind, variant, matrix}.
  instanceTrees(list) {
    const out = [];
    const groups = {};
    for (const t of list) (groups[t.kind + t.variant] ||= { t, items: [] }).items.push(t.matrix);
    for (const { t, items } of Object.values(groups)) {
      const geo = this.trees[t.kind][t.variant];
      for (const [g, mat] of [[geo.bark, this.barkMat], [geo.leaves, this.leafMat], [geo.cards, this.cardMat]]) {
        const im = new THREE.InstancedMesh(g, mat, items.length);
        items.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = im.receiveShadow = true;
        im.computeBoundingSphere();
        out.push(im);
      }
    }
    return out;
  }

  grassMesh(matrices) {
    const im = new THREE.InstancedMesh(this.grassGeo, this.grassMat, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }

  // A dense grass field around the player: a toroidal grid of cells, each re-seeded from its world
  // coordinates when it scrolls into the window, so the field is stable and costs one draw call.
  setupField(density) {
    if (this.field) {
      this.field.mesh.removeFromParent();
      this.field.mesh.dispose();
      this.field = null;
    }
    if (!density) return;
    const W = 64, cell = 1.15;
    const mesh = new THREE.InstancedMesh(this.grassGeo, this.grassMat, W * W * density);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.field = { mesh, W, cell, density, slots: new Array(W * W).fill(null) };
  }

  updateField(focus) {
    const f = this.field;
    if (!f) return;
    const { W, cell, density, mesh } = f;
    const terrain = this.world.terrainApi;
    const cx = Math.floor(focus.x / cell), cz = Math.floor(focus.z / cell);
    grassCenter.value.set(focus.x, 0, focus.z);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let changed = 0;
    for (let dz = -W / 2; dz < W / 2; dz++)
      for (let dx = -W / 2; dx < W / 2; dx++) {
        const ix = cx + dx, iz = cz + dz;
        const slot = (((ix % W) + W) % W) + (((iz % W) + W) % W) * W;
        const key = ix * 100003 + iz;
        if (f.slots[slot] === key) continue;
        f.slots[slot] = key;
        changed++;
        for (let k = 0; k < density; k++) {
          const hx = hash3(ix, iz, k), hz = hash3(iz, k + 7, ix);
          const x = (ix + hx) * cell, z = (iz + hz) * cell;
          const info = terrain.grassAt(x, z);
          const keep = info && hash3(ix + 3, iz, k + 11) < info.grass * 1.1;
          q.setFromAxisAngle(up, hash3(k, ix, iz) * 6.28);
          const s = keep ? 0.75 + hash3(iz, ix, k + 3) * 0.6 : 0;
          m4.compose(p.set(x, info ? info.h - 0.03 : 0, z), q, sc.set(s, s * (0.8 + hash3(ix, k, iz) * 0.6), s));
          mesh.setMatrixAt(slot * density + k, m4);
        }
        if (changed > 260) break; // spread big refills over a few frames
      }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, focus, camera) {
    wind.value += dt;
    this.updateField(focus);
    this.horizon.position.set(camera.position.x, 0, camera.position.z);
    this.water.position.x = Math.round(focus.x / 50) * 50;
    this.water.position.z = Math.round(focus.z / 50) * 50;
    this.water.material.uniforms.uTime.value = wind.value;
    // Petals and leaves drift from blossom trees near the player.
    const pt = this.world.game.blood;
    for (const s of this.sakura) {
      if (Math.abs(s.x - focus.x) > 40 || Math.abs(s.z - focus.z) > 40 || Math.random() > 0.35) continue;
      const c = s.color;
      pt.emit(s.x + (Math.random() - 0.5) * 5, s.y + Math.random() * 2, s.z + (Math.random() - 0.5) * 5, 0.5 + Math.random() * 0.4, -0.25, 0.25 + (Math.random() - 0.5) * 0.4, 7, 0.055, c[0], c[1], c[2], 0.95, 0.12, 0.4);
    }
  }
}

export { SPECIES };
