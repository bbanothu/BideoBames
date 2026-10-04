import * as THREE from "three";
import { damp, smooth } from "./util.js";
import { SkirtCloth } from "./cloth.js";

// A procedural knight built from primitives and driven by a flat table of joint angles.
// Model faces +Z. Negative X rotation on a limb swings it forward. Right side is -X.

export const JOINTS = [
  "hipsY", "bodyX", "torsoX", "torsoY", "torsoZ", "headX", "headY",
  "lShX", "lShY", "lShZ", "lEl", "rShX", "rShY", "rShZ", "rEl", "rWrist",
  "lHip", "lKnee", "rHip", "rKnee", "lHipZ", "rHipZ",
];

export const NEUTRAL = {
  hipsY: -0.07, bodyX: 0, torsoX: 0.15, torsoY: -0.1, torsoZ: 0, headX: -0.1, headY: 0,
  lShX: -0.6, lShY: -0.35, lShZ: 0.15, lEl: -1.2,
  rShX: -0.35, rShY: 0.1, rShZ: -0.12, rEl: -1.0, rWrist: -0.55,
  lHip: -0.3, lKnee: 0.35, rHip: 0.15, rKnee: 0.3, lHipZ: 0.06, rHipZ: -0.06,
};

const pose = (o) => ({ ...NEUTRAL, ...o });

export const P = {
  NEUTRAL,
  // One-handed stance: no shield, so the off hand hangs loose instead of guarding the chest.
  NEUTRAL_1H: pose({ lShX: -0.2, lShY: 0.05, lShZ: 0.2, lEl: -0.45 }),
  // Archery. The chest turns side-on (left shoulder to the target) and the head turns back to face it.
  BOW_IDLE: pose({ lShX: -0.45, lShY: 0.1, lShZ: 0.15, lEl: -0.7, rShX: -0.15, rShZ: -0.12, rEl: -0.35, rWrist: 0 }),
  BOW_NOCK: pose({ torsoY: -0.7, headY: 0.65, lShX: -1.5, lShY: 0.75, lShZ: 0, lEl: -0.05, rShX: -1.35, rShY: 0.55, rShZ: 0, rEl: -0.7, rWrist: 0 }),
  BOW_DRAW: pose({ torsoY: -0.75, torsoX: 0.05, headY: 0.7, lShX: -1.55, lShY: 0.78, lShZ: 0, lEl: 0, rShX: 0, rShY: -0.82, rShZ: -1.45, rEl: -2.85, rWrist: 0 }),
  JUMP: pose({ hipsY: -0.08, torsoX: 0.25, lHip: -1.0, lKnee: 1.4, rHip: -0.25, rKnee: 0.9, lShX: -0.7, lShZ: 0.4, rShX: -0.6, rShZ: -0.3, rEl: -0.8 }),
  GRAPPLE: pose({ torsoX: -0.1, torsoY: 0.3, lShX: -2.5, lShY: 0.1, lShZ: 0, lEl: -0.05, rShX: -0.4, rEl: -0.9, lHip: -0.9, lKnee: 1.3, rHip: -0.4, rKnee: 1.0, headX: -0.3 }),
  CAST: pose({ torsoY: 0.4, torsoX: 0.1, headY: -0.25, lShX: -1.55, lShY: 0.3, lShZ: 0, lEl: -0.1, rShX: -0.3, rEl: -0.8 }),
  REACH_BACK: pose({ rShX: -2.7, rShY: 0.3, rShZ: 0, rEl: -1.6, rWrist: 0, headY: -0.3 }),
  RELAXED: pose({ hipsY: -0.02, torsoX: 0.05, torsoY: 0, lShX: -0.1, lShY: 0, lShZ: 0.12, lEl: -0.3, rShX: -0.15, rShZ: -0.12, rEl: -0.5, rWrist: -0.9, lHip: -0.05, rHip: 0.05, lKnee: 0.08, rKnee: 0.08 }),
  WIND_R: pose({ torsoY: -0.9, torsoX: 0.1, rShX: -1.3, rShY: -1.3, rShZ: -0.3, rEl: -0.7, rWrist: -0.6, lShX: -0.8, lShY: 0.2 }),
  SLASH_MID: pose({ torsoY: 0, torsoX: 0.25, rShX: -1.5, rShY: 0, rShZ: 0, rEl: -0.05, rWrist: -0.25, lHip: -0.6, lKnee: 0.6, hipsY: -0.12 }),
  SLASH_L: pose({ torsoY: 0.8, torsoX: 0.25, rShX: -1.35, rShY: 1.25, rShZ: 0, rEl: -0.3, rWrist: -0.5, lHip: -0.6, lKnee: 0.6, hipsY: -0.12 }),
  WIND_L: pose({ torsoY: 0.9, rShX: -1.6, rShY: 1.4, rShZ: 0, rEl: -1.7, rWrist: -0.4, lShX: -0.4 }),
  SLASH_R: pose({ torsoY: -0.75, torsoX: 0.25, rShX: -1.4, rShY: -1.3, rShZ: 0, rEl: -0.1, rWrist: -0.3, rHip: -0.5, rKnee: 0.6, lHip: 0.2, hipsY: -0.12 }),
  OVER_UP: pose({ torsoX: -0.2, torsoY: -0.15, rShX: -2.9, rShY: 0.1, rShZ: 0, rEl: -1.1, rWrist: -0.8, lShX: -0.9, lHip: -0.45, rHip: 0.3 }),
  OVER_DOWN: pose({ torsoX: 0.55, torsoY: 0.05, rShX: -0.9, rShY: 0.05, rShZ: 0, rEl: -0.1, rWrist: -0.9, headX: -0.3, hipsY: -0.2, lHip: -0.8, lKnee: 0.9, rHip: 0.35, rKnee: 0.3, lShX: -0.2 }),
  HEAVY_UP: pose({ torsoX: -0.35, torsoY: -0.35, rShX: -3.0, rShY: 0, rShZ: -0.1, rEl: -1.4, rWrist: -0.9, lShX: -1.2, lHip: -0.5, rHip: 0.45, hipsY: -0.1 }),
  HEAVY_DOWN: pose({ torsoX: 0.75, torsoY: 0.1, rShX: -0.7, rShY: 0, rShZ: 0, rEl: -0.05, rWrist: -1.0, headX: -0.5, hipsY: -0.28, lHip: -1.0, lKnee: 1.1, rHip: 0.5, rKnee: 0.5, lShX: 0.1 }),
  THRUST_BACK: pose({ torsoY: -0.6, rShX: -0.2, rShY: -0.25, rShZ: -0.1, rEl: -1.4, rWrist: 0, lShX: -1.0, rHip: -0.2, hipsY: -0.12 }),
  THRUST: pose({ torsoY: 0.35, torsoX: 0.3, rShX: -1.55, rShY: 0.1, rShZ: 0, rEl: 0, rWrist: -0.05, lShX: 0.2, lHip: -0.9, lKnee: 0.7, rHip: 0.5, rKnee: 0.2, hipsY: -0.2 }),
  CROUCH: pose({ hipsY: -0.38, torsoX: 0.55, rShX: 0.5, rEl: -0.6, lShX: 0.5, lEl: -0.5, lHip: -1.0, lKnee: 1.6, rHip: -0.7, rKnee: 1.4, headX: -0.4 }),
  PLANT: pose({ hipsY: -0.3, torsoX: 0.5, headX: -0.3, rShX: -0.7, rShY: 0.1, rEl: -0.35, rWrist: 0.95, lShX: -0.8, lShY: -0.55, lShZ: 0, lEl: -0.5, lHip: -0.8, lKnee: 1.0, rHip: 0.2, rKnee: 0.6 }),
  ROLL: pose({ hipsY: -0.45, torsoX: 0.9, headX: 0.5, lHip: -1.9, lKnee: 2.3, rHip: -1.9, rKnee: 2.3, lShX: -1.0, lEl: -1.6, rShX: -0.9, rEl: -1.4, rWrist: -1.6 }),
  BACKSTEP: pose({ torsoX: -0.2, hipsY: -0.12, lHip: 0.3, rHip: -0.4, rKnee: 0.6, lKnee: 0.2, lShX: -0.9, rShX: -0.5 }),
  HIT: pose({ torsoX: -0.4, headX: -0.45, lShX: -0.2, lShZ: 0.7, rShZ: -0.7, rShX: -0.2, rEl: -0.6, lEl: -0.6, hipsY: -0.12, lHip: 0.1, rHip: -0.3 }),
  BLOCK: pose({ lShX: -1.35, lShY: -0.95, lShZ: 0, lEl: -0.45, torsoX: 0.25, hipsY: -0.12, rShX: -0.2, rEl: -1.2 }),
  DRINK: pose({ lShX: -2.3, lShY: -0.7, lShZ: 0, lEl: -2.1, headX: -0.55, torsoX: -0.1 }),
  SIT: pose({ hipsY: -0.62, torsoX: 0.35, headX: 0.35, lHip: -1.5, lKnee: 2.5, rHip: -1.5, rKnee: 2.5, lHipZ: 0.3, rHipZ: -0.3, lShX: -0.9, lEl: -0.6, rShX: -0.9, rEl: -0.6, rWrist: -0.9 }),
  DEAD: pose({ bodyX: -1.48, hipsY: -0.78, torsoX: 0, torsoY: 0, headX: 0.2, headY: 0.6, lShX: -0.3, lShZ: 1.1, rShX: -0.3, rShZ: -1.1, lEl: -0.2, rEl: -0.3, lHip: -0.1, lKnee: 0.15, rHip: 0.05, rKnee: 0.1, lHipZ: 0.25, rHipZ: -0.2 }),
  ROAR: pose({ torsoX: -0.45, headX: -0.65, lShX: -0.7, lShZ: 1.2, rShX: -0.7, rShZ: -1.2, lEl: -0.5, rEl: -0.5, hipsY: -0.18, lHip: -0.4, rHip: 0.3 }),
  FOG: pose({ torsoX: 0.3, lShX: -1.6, lShY: -0.2, lEl: -0.4, headX: 0.1 }),
};

export function copyPose(out, src) {
  for (const k of JOINTS) out[k] = src[k];
  return out;
}

export function lerpPose(out, a, b, t) {
  for (const k of JOINTS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function sampleKeys(keys, t, out) {
  if (t <= keys[0][0]) return copyPose(out, keys[0][1]);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, p0] = keys[i];
    const [t1, p1] = keys[i + 1];
    if (t <= t1) {
      const u = smooth((t - t0) / Math.max(1e-4, t1 - t0));
      for (const k of JOINTS) out[k] = p0[k] + (p1[k] - p0[k]) * u;
      return out;
    }
  }
  return copyPose(out, keys[keys.length - 1][1]);
}

// Layer a walk/run cycle on top of a base stance.
export function locomotion(out, base, speed, phase, run = false) {
  copyPose(out, base);
  const a = Math.min(1, speed / 3.5);
  const amp = (run ? 0.85 : 0.55) * a;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  out.lHip += -amp * s;
  out.rHip += amp * s;
  out.lKnee += Math.max(0, amp * 1.4 * c);
  out.rKnee += Math.max(0, -amp * 1.4 * c);
  out.hipsY += -0.035 * a * Math.abs(c) + (run ? -0.04 : 0);
  out.lShX += amp * 0.45 * s;
  out.rShX += -amp * 0.3 * s;
  out.torsoY += amp * 0.12 * s;
  if (run) {
    out.torsoX += 0.3 * a;
    out.rShX += 0.5;
    out.rEl -= 0.3;
  }
  return out;
}

const L1 = 0.44; // hip → knee
const L2 = 0.45; // knee → foot

// Tapered, curved spike (horn / claw / barb) along a list of points.
function hornGeo(points, r0, tip = 0.08) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tub = 14;
  const rad = 6;
  const g = new THREE.TubeGeometry(curve, tub, r0, rad, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = Math.floor(i / (rad + 1)) / tub;
    curve.getPointAt(u, c);
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - u * (1 - tip));
    pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}

function extrude(shape, depth, z = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, z - depth / 2);
  return g;
}

function ellipse(path, cx, cy, rx, ry, rot = 0) {
  path.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, rot);
  return path;
}

// The bone-and-blood greatblade: jagged hooked edges, dark core, glowing vein.
function makeDemonSword(mats) {
  const g = new THREE.Group();
  const L = 1.05; // blade length
  const G = -0.1; // guard line
  const Y = (t) => G - t * L;
  const width = (t) => (t < 0.84 ? 0.07 + 0.055 * Math.sin((t / 0.84) * Math.PI * 0.8) : 0.07 + 0.055 * Math.sin(Math.PI * 0.8)) ;
  const taper = (t) => (t < 0.84 ? 1 : Math.max(0, 1 - (t - 0.84) / 0.16));

  // Outline: each side walks guard→tip, throwing out barbs that hook back toward the hilt.
  const side = (sign, barbs) => {
    const pts = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const w = width(t) * taper(t) * (sign > 0 ? 1 : 0.92);
      pts.push([sign * w, Y(t)]);
      const b = barbs.find((x) => Math.abs(x[0] - t) < 0.01);
      if (b) {
        pts.push([sign * (w + b[1]), Y(t - 0.05)]);
        pts.push([sign * (w * 0.92), Y(t + 0.012)]);
      }
    }
    return pts;
  };
  const right = side(1, [[0.12, 0.05], [0.3, 0.04], [0.46, 0.06], [0.62, 0.045], [0.76, 0.05]]);
  const left = side(-1, [[0.06, 0.07], [0.22, 0.045], [0.4, 0.05], [0.56, 0.06], [0.7, 0.04], [0.84, 0.035]]);
  const tipPt = [-0.015, Y(1.0)];
  const outer = new THREE.Shape();
  outer.moveTo(right[0][0], right[0][1]);
  for (const p of right) outer.lineTo(p[0], p[1]);
  outer.lineTo(tipPt[0], tipPt[1]);
  for (const p of left.slice().reverse()) outer.lineTo(p[0], p[1]);
  outer.closePath();

  // Inner dark core (barbless, inset) with see-through holes.
  const coreOutline = (path) => {
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const t = 0.02 + (i / n) * 0.86;
      const w = width(t) * taper(t) * 0.68;
      i === 0 ? path.moveTo(w, Y(t)) : path.lineTo(w, Y(t));
    }
    path.lineTo(-0.01, Y(0.93));
    for (let i = n; i >= 0; i--) {
      const t = 0.02 + (i / n) * 0.86;
      path.lineTo(-width(t) * taper(t) * 0.62, Y(t));
    }
    path.closePath();
    return path;
  };
  const holes = [
    [-0.035, 0.3, 0.026, 0.07, 0.25],
    [0.04, 0.5, 0.022, 0.06, -0.2],
    [-0.03, 0.68, 0.02, 0.05, 0.2],
  ];
  const core = coreOutline(new THREE.Shape());
  for (const [x, t, rx, ry, r] of holes) core.holes.push(ellipse(new THREE.Path(), x, Y(t), rx, ry, r));
  const rim = outer;
  rim.holes.push(coreOutline(new THREE.Path()));

  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(extrude(rim, 0.014), mats.bone);
  add(extrude(core, 0.026), mats.dread);

  // Glowing vein down the middle, wavering and splitting around the holes.
  const vein = new THREE.Shape();
  const vn = 30;
  const vx = (t) => Math.sin(t * 9) * 0.012 + (t > 0.25 && t < 0.75 ? Math.sin((t - 0.25) * Math.PI * 2) * 0.01 : 0);
  for (let i = 0; i <= vn; i++) {
    const t = 0.03 + (i / vn) * 0.85;
    const w = 0.006 + 0.006 * Math.sin(t * Math.PI);
    i === 0 ? vein.moveTo(vx(t) + w, Y(t)) : vein.lineTo(vx(t) + w, Y(t));
  }
  vein.lineTo(vx(0.92), Y(0.92));
  for (let i = vn; i >= 0; i--) {
    const t = 0.03 + (i / vn) * 0.85;
    const w = 0.006 + 0.006 * Math.sin(t * Math.PI);
    vein.lineTo(vx(t) - w, Y(t));
  }
  add(extrude(vein, 0.032), mats.glow);
  for (const [x, t, rx, ry, r] of holes) {
    const ring = ellipse(new THREE.Shape(), x, Y(t), rx + 0.008, ry + 0.008, r);
    ring.holes.push(ellipse(new THREE.Path(), x, Y(t), rx, ry, r));
    add(extrude(ring, 0.03), mats.glow);
  }

  // Guard: dark skull-like block, glowing eyes, horns sweeping back toward the grip.
  const block = add(new THREE.DodecahedronGeometry(0.075), mats.dread);
  block.position.set(0, G - 0.01, 0);
  block.scale.set(1.5, 0.9, 0.55);
  for (const x of [-0.035, 0.035]) {
    const eye = add(new THREE.SphereGeometry(0.014, 8, 6), mats.glow);
    eye.position.set(x, G, 0.04);
    const eye2 = add(new THREE.SphereGeometry(0.014, 8, 6), mats.glow);
    eye2.position.set(x, G, -0.04);
  }
  const gem = add(new THREE.OctahedronGeometry(0.02), mats.glow);
  gem.position.set(0, G - 0.045, 0);
  const horns = [
    [[0.08, G, 0], [0.17, G + 0.04, 0], [0.2, G + 0.13, 0], [0.16, G + 0.2, 0]],
    [[-0.08, G, 0], [-0.16, G + 0.03, 0], [-0.2, G + 0.11, 0], [-0.18, G + 0.19, 0]],
    [[0.06, G - 0.03, 0], [0.13, G - 0.09, 0], [0.18, G - 0.06, 0]],
    [[-0.06, G - 0.03, 0], [-0.14, G - 0.1, 0], [-0.2, G - 0.08, 0]],
    [[0.03, G + 0.02, 0], [0.07, G + 0.09, 0], [0.11, G + 0.12, 0]],
    [[-0.03, G + 0.02, 0], [-0.07, G + 0.09, 0], [-0.11, G + 0.12, 0]],
  ];
  horns.forEach((pts, i) => add(hornGeo(pts, i < 2 ? 0.022 : 0.016), i < 2 ? mats.bone : mats.dread));

  // Grip: knuckled bone with blood-red wraps.
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const y = G + 0.03 + i * 0.055;
    const bone = add(new THREE.CylinderGeometry(0.017, 0.021, 0.05, 8), mats.bone);
    bone.position.y = y + 0.025;
    const knuckle = add(new THREE.SphereGeometry(0.026, 8, 6), mats.bone);
    knuckle.position.y = y;
    knuckle.scale.y = 0.6;
    if (i % 2 === 1) {
      const wrap = add(new THREE.TorusGeometry(0.022, 0.007, 5, 12), mats.blood);
      wrap.position.y = y + 0.025;
      wrap.rotation.x = Math.PI / 2 + 0.3;
    }
  }
  const top = G + 0.03 + segs * 0.055;
  for (const [x, z, len, rz] of [[0.02, 0.012, 0.16, 0.15], [0.005, -0.012, 0.12, -0.1], [-0.015, 0.01, 0.09, 0.3]]) {
    const strip = add(new THREE.BoxGeometry(0.022, len, 0.004), mats.blood);
    strip.position.set(x, top - 0.06 - len / 2, z);
    strip.rotation.z = rz;
  }
  // Pommel: red orb clutched by bone claws.
  const orb = add(new THREE.SphereGeometry(0.03, 12, 10), mats.glow);
  orb.position.y = top + 0.03;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    add(hornGeo([[0, top, 0], [c * 0.05, top + 0.02, sn * 0.05], [c * 0.055, top + 0.07, sn * 0.055], [c * 0.02, top + 0.085, sn * 0.02]], 0.01), mats.bone);
  }

  const base = new THREE.Object3D();
  base.position.y = G - 0.06;
  const end = new THREE.Object3D();
  end.position.y = Y(1);
  g.add(base, end);
  // Turn the flat of the blade toward the camera; apply() only drives rotation.x (the wrist).
  g.rotation.y = 1.25;
  return { group: g, base, end, len: L };
}

// Dark violet "muscle fibre" armour: sinewy strokes running along each limb.
let sinewTex = null;
function getSinewTex() {
  if (sinewTex) return sinewTex;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#4b4372";
  g.fillRect(0, 0, 512, 512);
  const stroke = (color, w, n) => {
    g.strokeStyle = color;
    for (let i = 0; i < n; i++) {
      g.lineWidth = w * (0.5 + Math.random());
      const x = Math.random() * 512;
      const sway = (Math.random() - 0.5) * 120;
      g.beginPath();
      g.moveTo(x, -20);
      g.bezierCurveTo(x + sway, 170, x - sway, 340, x + sway * 0.5, 532);
      g.stroke();
    }
  };
  stroke("rgba(20,16,40,0.9)", 5, 60);
  stroke("rgba(30,24,56,0.7)", 10, 30);
  stroke("rgba(150,140,200,0.55)", 1.5, 45);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return (sinewTex = t);
}

function makeWeapon(kind, mats) {
  if (kind === "demon") return makeDemonSword(mats);
  const g = new THREE.Group();
  const len = kind === "greatsword" ? 1.5 : kind === "broken" ? 0.62 : 0.95;
  const w = kind === "greatsword" ? 0.13 : 0.065;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, kind === "greatsword" ? 0.32 : 0.18, 6), mats.leather);
  grip.position.y = kind === "greatsword" ? 0.05 : 0;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(w * 3.2, 0.035, 0.045), mats.metal);
  guard.position.y = -0.1;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mats.metal);
  pommel.position.y = kind === "greatsword" ? 0.23 : 0.1;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.018), mats.blade);
  blade.position.y = -0.1 - len / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(w / 1.6, w * 1.6, 4), mats.blade);
  tip.rotation.x = Math.PI;
  tip.scale.z = 0.25;
  tip.position.y = -0.1 - len - w * 0.8;
  if (kind === "broken") tip.visible = false;
  for (const m of [grip, guard, pommel, blade, tip]) {
    m.castShadow = true;
    g.add(m);
  }
  const base = new THREE.Object3D();
  base.position.y = -0.15;
  const end = new THREE.Object3D();
  end.position.y = -0.1 - len - (kind === "broken" ? 0 : w * 1.4);
  g.add(base, end);
  return { group: g, base, end, len };
}

export class Humanoid {
  constructor(o) {
    const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
    const mats = (this.matsByName = {
      armor: std(o.armor, 0.3, 0.5),
      cloth: std(o.cloth, 0, 0.95),
      skin: std(o.skin, 0, 0.8),
      leather: std(o.leather ?? 0x2e2218, 0.1, 0.85),
      dark: std(0x050505, 0, 1, { emissive: o.eyes ?? 0x000000, emissiveIntensity: 2 }),
      metal: std(o.metal ?? 0x8d877a, 0.45, 0.4),
      blade: std(o.blade ?? 0xb8bcc4, 0.55, 0.25),
      gore: std(0x5a0606, 0.1, 0.35, { emissive: 0x200000 }),
      bone: std(0xd8b896, 0.05, 0.6),
      dread: std(0x3a1216, 0.35, 0.45, { emissive: 0x1a0204, emissiveIntensity: 1 }),
      glow: std(0xb00000, 0, 0.4, { emissive: 0xff0000, emissiveIntensity: 1.6 }),
      blood: std(0x7a0a10, 0, 0.8),
    });
    const sinew = o.build === "sinew";
    if (sinew) {
      mats.sinew = new THREE.MeshPhysicalMaterial({ map: getSinewTex(), color: 0x9890c8, metalness: 0.2, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.55 });
      mats.face = std(0x15121f, 0.5, 0.25);
      mats.visor = std(0xffffff, 0, 0.3, { emissive: 0xe6e4ff, emissiveIntensity: 2.2 });
      mats.violet = std(0x6a2aff, 0, 0.3, { emissive: 0x5a1cff, emissiveIntensity: 1.6 });
      mats.sheath = std(0x1a1428, 0.4, 0.35);
      mats.strap = std(0x3a2618, 0.1, 0.7);
    }
    this.mats = Object.values(mats);
    this.baseEmissive = this.mats.map((m) => m.emissive.clone());
    this.baseEmissiveI = this.mats.map((m) => m.emissiveIntensity);

    const add = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const grp = (parent, x = 0, y = 0, z = 0, order = "XYZ") => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.order = order;
      parent.add(g);
      return g;
    };

    // Rig proportions; a skinned model replaces these with its own measurements.
    this.hipHeight = 0.95;
    this.L1 = L1;
    this.L2 = L2;
    this.ankleH = 0.06;

    this.root = new THREE.Group();
    this.root.scale.setScalar(o.scale ?? 1);
    this.body = grp(this.root, 0, 0.95, 0);

    // Scaled sphere — the building block of the muscled build.
    const ball = new THREE.SphereGeometry(1, 16, 12);
    const blob = (parent, x, y, z, sx, sy, sz, mat = mats.sinew, rx = 0, rz = 0) => {
      const m = add(ball, mat, parent, x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.set(rx, 0, rz);
      return m;
    };
    this.torso = grp(this.body, 0, 0.1, 0, "YXZ");

    if (sinew) {
      // Pelvis + glutes
      blob(this.body, 0, 0, 0, 0.16, 0.12, 0.12);
      blob(this.body, 0.07, -0.05, -0.06, 0.08, 0.09, 0.075);
      blob(this.body, -0.07, -0.05, -0.06, 0.08, 0.09, 0.075);
      // V-shaped torso: lats, waist, pecs, abs, traps, back
      blob(this.torso, 0, 0.3, 0, 0.23, 0.22, 0.135);
      blob(this.torso, 0, 0.08, 0, 0.145, 0.13, 0.11);
      for (const sx of [-1, 1]) {
        blob(this.torso, sx * 0.085, 0.36, 0.085, 0.1, 0.075, 0.06, mats.sinew, 0, sx * -0.2);
        blob(this.torso, sx * 0.09, 0.3, -0.085, 0.1, 0.16, 0.06);
        blob(this.torso, sx * 0.15, 0.22, 0.02, 0.06, 0.14, 0.09, mats.sinew, 0, sx * 0.25);
        for (let i = 0; i < 3; i++) blob(this.torso, sx * 0.037, 0.06 + i * 0.058, 0.1, 0.033, 0.026, 0.022);
      }
      blob(this.torso, 0, 0.47, -0.02, 0.13, 0.06, 0.09);
      // Bandolier strap across the chest and back
      for (const z of [0.142, -0.142]) {
        const strap = add(new THREE.BoxGeometry(0.045, 0.72, 0.012), mats.strap, this.torso, 0, 0.27, z);
        strap.rotation.z = z > 0 ? 0.72 : -0.72;
      }
      add(new THREE.BoxGeometry(0.05, 0.04, 0.02), mats.metal, this.torso, -0.07, 0.36, 0.15);
      add(new THREE.BoxGeometry(0.018, 0.26, 0.03), mats.violet, this.torso, 0.205, 0.28, 0.05).rotation.z = 0.2;
      // Katana sheathed across the back, hilt over the right shoulder
      const sh = grp(this.torso, -0.02, 0.28, -0.17);
      sh.rotation.set(0.12, 0, 0.55);
      add(new THREE.CylinderGeometry(0.022, 0.018, 0.78, 8), mats.sheath, sh, 0, -0.05, 0);
      for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.023, 0.005, 4, 10), mats.violet, sh, 0, -0.38 + i * 0.13, 0).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12), mats.metal, sh, 0, 0.345, 0);
      add(new THREE.CylinderGeometry(0.017, 0.017, 0.22, 8), mats.violet, sh, 0, 0.46, 0);
      add(new THREE.SphereGeometry(0.02, 8, 6), mats.metal, sh, 0, 0.575, 0);
    } else {
    // Hips + tabard
    add(new THREE.BoxGeometry(0.34, 0.2, 0.22), mats.cloth, this.body);
    add(new THREE.BoxGeometry(0.37, 0.06, 0.25), mats.leather, this.body, 0, 0.07, 0);
    add(new THREE.BoxGeometry(0.28, 0.44, 0.025), mats.cloth, this.body, 0, -0.24, 0.125);
    add(new THREE.BoxGeometry(0.3, 0.4, 0.025), mats.cloth, this.body, 0, -0.22, -0.125);

    // Torso
    add(new THREE.BoxGeometry(0.42, 0.42, 0.25), mats.armor, this.torso, 0, 0.28, 0);
    add(new THREE.BoxGeometry(0.34, 0.16, 0.21), mats.leather, this.torso, 0, 0.04, 0);
    const pg = new THREE.SphereGeometry(0.12, 10, 8);
    add(pg, mats.armor, this.torso, 0.26, 0.47, 0).scale.set(1.15, 0.8, 1.1);
    add(pg, mats.armor, this.torso, -0.26, 0.47, 0).scale.set(1.15, 0.8, 1.1);
    if (o.cape) {
      const cape = add(new THREE.BoxGeometry(0.44, 0.9, 0.03), mats.cloth, this.torso, 0, 0.05, -0.15);
      cape.rotation.x = 0.12;
    }
    }

    // Head
    this.neck = grp(this.torso, 0, 0.52, 0, "YXZ");
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), mats.leather, this.neck, 0, 0.03, 0);
    if (sinew) {
      add(new THREE.CylinderGeometry(0.068, 0.085, 0.1, 10), mats.sinew, this.neck, 0, 0.03, 0);
      blob(this.neck, 0, 0.16, 0.0, 0.1, 0.13, 0.115);
      blob(this.neck, 0, 0.14, 0.05, 0.085, 0.1, 0.075, mats.face);
      for (const sx of [-1, 1]) {
        const v = add(new THREE.BoxGeometry(0.052, 0.012, 0.01), mats.visor, this.neck, sx * 0.034, 0.165, 0.118);
        v.rotation.set(0, sx * 0.35, sx * -0.38);
        add(hornGeo([[sx * 0.03, 0.25, -0.06], [sx * 0.05, 0.31, -0.1], [sx * 0.085, 0.335, -0.17]], 0.008), mats.sinew, this.neck);
      }
      add(new THREE.BoxGeometry(0.014, 0.05, 0.2), mats.sinew, this.neck, 0, 0.285, -0.01);
    } else if (o.helm === "hollow") {
      add(new THREE.SphereGeometry(0.115, 12, 10), mats.skin, this.neck, 0, 0.15, 0.01);
      add(new THREE.SphereGeometry(0.03, 6, 6), mats.dark, this.neck, 0.045, 0.16, 0.1);
      add(new THREE.SphereGeometry(0.03, 6, 6), mats.dark, this.neck, -0.045, 0.16, 0.1);
      const hood = add(new THREE.SphereGeometry(0.135, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mats.cloth, this.neck, 0, 0.15, -0.015);
      hood.rotation.x = -0.35;
    } else {
      add(new THREE.CylinderGeometry(0.125, 0.135, 0.28, 14), mats.armor, this.neck, 0, 0.15, 0);
      add(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.armor, this.neck, 0, 0.29, 0);
      add(new THREE.BoxGeometry(0.17, 0.022, 0.03), mats.dark, this.neck, 0, 0.17, 0.122);
      add(new THREE.BoxGeometry(0.022, 0.09, 0.03), mats.dark, this.neck, 0, 0.11, 0.124);
      if (o.helm === "boss") {
        const hg = new THREE.ConeGeometry(0.04, 0.32, 8);
        const h1 = add(hg, mats.metal, this.neck, 0.15, 0.32, 0);
        h1.rotation.z = -0.9;
        const h2 = add(hg, mats.metal, this.neck, -0.15, 0.32, 0);
        h2.rotation.z = 0.9;
        add(new THREE.BoxGeometry(0.15, 0.3, 0.02), mats.cloth, this.neck, 0, 0.0, -0.13);
      } else {
        add(new THREE.BoxGeometry(0.025, 0.1, 0.26), mats.cloth, this.neck, 0, 0.42, -0.02);
      }
    }

    // Arms
    const arm = (side) => {
      const sh = grp(this.torso, side * (sinew ? 0.28 : 0.26), 0.44, 0, "YXZ");
      const el = grp(sh, 0, -0.3, 0);
      const hand = grp(el, 0, -0.29, 0);
      if (sinew) {
        blob(sh, 0, -0.02, 0, 0.09, 0.085, 0.095); // deltoid
        add(new THREE.CapsuleGeometry(0.055, 0.2, 4, 10), mats.sinew, sh, 0, -0.15, 0);
        blob(sh, 0, -0.14, 0.03, 0.062, 0.1, 0.06); // biceps
        blob(sh, 0, -0.13, -0.03, 0.058, 0.11, 0.055); // triceps
        blob(el, 0, -0.08, 0.005, 0.06, 0.11, 0.058);
        add(new THREE.CapsuleGeometry(0.043, 0.18, 4, 10), mats.sinew, el, 0, -0.15, 0);
        blob(hand, 0, 0, 0, 0.055, 0.06, 0.05, mats.face);
      } else {
        add(new THREE.CapsuleGeometry(0.062, 0.2, 4, 8), mats.armor, sh, 0, -0.14, 0);
        add(new THREE.CapsuleGeometry(0.052, 0.18, 4, 8), mats.leather, el, 0, -0.13, 0);
        add(new THREE.CylinderGeometry(0.066, 0.058, 0.12, 8), mats.armor, el, 0, -0.18, 0);
        add(new THREE.SphereGeometry(0.05, 8, 6), mats.leather, hand);
      }
      return { sh, el, hand };
    };
    const r = arm(-1);
    const l = arm(1);
    this.rHand = r.hand;
    this.lHand = l.hand;
    this.rSh = r.sh;
    this.rEl = r.el;
    this.lSh = l.sh;
    this.lEl = l.el;

    const wpn = o.weaponModel ? this.useWeaponModel(o.weaponModel) : makeWeapon(o.weapon ?? "sword", mats);
    this.weapon = wpn.group;
    this.weaponBase = wpn.base;
    this.weaponTip = wpn.end;
    this.weaponLen = wpn.len;
    this.swordYaw = wpn.group.rotation.y;
    r.hand.add(this.weapon);

    this.hasShield = !!o.shield;
    if (o.shield) {
      const sg = new THREE.Group();
      sg.position.set(0.075, -0.15, 0);
      const disc = add(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 18), mats.armor, sg);
      disc.rotation.z = Math.PI / 2;
      const boss = add(new THREE.SphereGeometry(0.07, 10, 8), mats.metal, sg, 0.03, 0, 0);
      boss.scale.x = 0.6;
      const rim = add(new THREE.TorusGeometry(0.27, 0.018, 6, 24), mats.metal, sg);
      rim.rotation.y = Math.PI / 2;
      this.lEl.add(sg);
    }

    this.flask = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 2.5 }),
    );
    this.flask.visible = false;
    l.hand.add(this.flask);

    // Legs
    const leg = (side) => {
      const hip = grp(this.body, side * 0.1, -0.06, 0);
      const knee = grp(hip, 0, -L1, 0);
      if (sinew) {
        blob(hip, 0, -0.2, 0.01, 0.1, 0.22, 0.1); // thigh
        blob(hip, side * -0.035, -0.31, 0.04, 0.06, 0.1, 0.06); // inner quad
        blob(knee, 0, 0, 0.04, 0.045, 0.045, 0.035);
        add(new THREE.CapsuleGeometry(0.052, 0.26, 4, 10), mats.sinew, knee, 0, -0.21, 0);
        blob(knee, 0, -0.13, -0.035, 0.065, 0.12, 0.062); // calf
        add(new THREE.BoxGeometry(0.12, 0.08, 0.27), mats.face, knee, 0, -L2, 0.05);
        add(new THREE.BoxGeometry(0.125, 0.02, 0.28), mats.sinew, knee, 0, -L2 - 0.035, 0.05);
      } else {
        add(new THREE.CapsuleGeometry(0.075, 0.28, 4, 8), mats.cloth, hip, 0, -0.22, 0);
        add(new THREE.CapsuleGeometry(0.065, 0.26, 4, 8), mats.armor, knee, 0, -0.2, 0);
        add(new THREE.BoxGeometry(0.11, 0.07, 0.25), mats.leather, knee, 0, -L2, 0.05);
      }
      return { hip, knee };
    };
    const ll = leg(1);
    const rl = leg(-1);
    this.lHip = ll.hip;
    this.lKnee = ll.knee;
    this.rHip = rl.hip;
    this.rKnee = rl.knee;

    if (o.skinModel) this.useSkinnedModel(o.skinModel);
    else if (o.model) this.useBodyModel(o.model);

    this.cuts = [];
    this.wounds = [];
    this.severed = new Set();
    this.cur = { ...NEUTRAL };
    this.flashT = 0;
    this.glow = null;
    this.opacity = 1;
    this.apply(true);
  }

  // Approach the target pose; `snap` keys jump straight there (used for the roll spin).
  update(dt, target, rate = 16, snap = null) {
    for (const k of JOINTS) {
      if ((snap && snap.includes(k)) || Math.abs(target[k] - this.cur[k]) > Math.PI) this.cur[k] = target[k];
      else this.cur[k] = damp(this.cur[k], target[k], rate, dt);
    }
    this.apply(!!(snap && snap.includes("ik-off")));
    if (this.cloth) this.cloth.step(dt);

    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.12);
      this.mats.forEach((m, i) => {
        m.emissive.copy(this.baseEmissive[i]).lerp(new THREE.Color(0xffffff), k * 0.6);
        m.emissiveIntensity = Math.max(this.baseEmissiveI[i], k);
      });
      if (this.flashT <= 0) this.restoreEmissive();
    }
  }

  restoreEmissive() {
    this.mats.forEach((m, i) => {
      m.emissive.copy(this.baseEmissive[i]);
      m.emissiveIntensity = this.baseEmissiveI[i];
    });
    if (this.glow) this.setGlow(this.glow);
  }

  flash() {
    this.flashT = 0.12;
  }

  setGlow(color) {
    this.glow = color;
    const m = this.matsByName.blade;
    m.emissive.set(color ?? 0x000000);
    m.emissiveIntensity = color ? 2.2 : 1;
    const i = this.mats.indexOf(m);
    this.baseEmissive[i].copy(m.emissive);
    this.baseEmissiveI[i] = m.emissiveIntensity;
  }

  setOpacity(a) {
    if (a === this.opacity) return;
    const wasT = this.opacity < 1;
    this.opacity = a;
    for (const m of this.mats) {
      m.transparent = a < 1;
      m.opacity = a;
      if (wasT !== a < 1) m.needsUpdate = true;
    }
  }

  // Give this instance its own copies of a model's materials so hit-flash / fade stay per-character.
  adopt(obj) {
    obj.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.castShadow = m.receiveShadow = true;
      this.mats.push(m.material);
      this.baseEmissive.push(m.material.emissive.clone());
      this.baseEmissiveI.push(m.material.emissiveIntensity);
    });
    return obj;
  }

  useWeaponModel(model) {
    const g = this.adopt(model.clone(true));
    g.position.set(0, 0, 0);
    // Turn the flat of the blade toward the camera; apply() only drives rotation.x (the wrist).
    g.rotation.set(0, (this.swordYaw = 1.25), 0);
    let base = g.getObjectByName("sword_base");
    let end = g.getObjectByName("sword_tip");
    g.traverse((o) => {
      if (!base && o.name.endsWith("_base")) base = o;
      if (!end && o.name.endsWith("_tip")) end = o;
    });
    return { group: g, base, end, len: 1.05 };
  }

  // Swap the weapon model (class change); keeps it wherever the old one was (hand or back).
  setWeaponModel(model) {
    if (!model) return;
    const old = this.weapon;
    const wpn = this.useWeaponModel(model);
    const inHand = old.parent === this.rHand;
    old.removeFromParent();
    this.weapon = wpn.group;
    this.weaponBase = wpn.base;
    this.weaponTip = wpn.end;
    this.swordYaw = wpn.group.rotation.y;
    if (inHand) this.rHand.add(this.weapon);
  }

  // Put the chosen weapon in hand and stow the other across the back.
  equip(mode) {
    const sword = this.weapon;
    const bow = this.bow;
    if (mode === "bow" && bow) {
      this.lHand.add(bow);
      bow.position.set(0, 0, 0);
      bow.rotation.set(Math.PI / 2, 0, 0);
      this.torso.add(sword);
      sword.position.set(-0.1, 0.46, -0.17);
      sword.rotation.set(0, 0, 0.5);
    } else {
      this.rHand.add(sword);
      sword.position.set(0, 0, 0);
      sword.rotation.set(0, this.swordYaw ?? 0, 0);
      if (bow) {
        this.torso.add(bow);
        bow.position.set(0.04, 0.26, -0.19);
        bow.rotation.set(0, Math.PI, -0.45);
      }
    }
  }

  // Team colouring for multiplayer (multiplies the body's texture).
  setTint(color, emissive = 0x000000) {
    const m = this.skin ? this.skin.material : this.matsByName.armor;
    m.color.set(color);
    m.emissive.set(emissive);
    const i = this.mats.indexOf(m);
    if (i >= 0) this.baseEmissive[i].copy(m.emissive);
  }

  // Remove the primitive body meshes (keeping the weapon and flask).
  stripBody() {
    const keep = new Set([this.weapon, this.flask]);
    const strip = [];
    this.body.traverse((m) => {
      if (!m.isMesh) return;
      for (let p = m; p; p = p.parent) if (keep.has(p)) return;
      strip.push(m);
    });
    for (const m of strip) m.parent.remove(m);
  }

  jointMap() {
    return {
      hips: this.body, torso: this.torso, head: this.neck,
      upperarm_L: this.lSh, forearm_L: this.lEl, hand_L: this.lHand, thigh_L: this.lHip, shin_L: this.lKnee, foot_L: this.lKnee,
      upperarm_R: this.rSh, forearm_R: this.rEl, hand_R: this.rHand, thigh_R: this.rHip, shin_R: this.rKnee, foot_R: this.rKnee,
    };
  }

  // A single skinned mesh (Blender armature bones named after our joints). The rig is moved onto the
  // model's own joint positions, posed to match its bind pose, and the skin is rebound to our joint
  // groups, so all existing poses, IK and dismemberment drive it directly.
  useSkinnedModel(scene) {
    this.stripBody();
    let src = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh && !src) src = o;
    });
    if (!src) return;
    scene.updateMatrixWorld(true);
    const B = Object.fromEntries(src.skeleton.bones.map((b) => [b.name, b.getWorldPosition(new THREE.Vector3())]));
    const pel = B.hips;
    const wst = B.torso;
    this.hipHeight = pel.y;
    this.body.position.copy(pel);
    this.torso.position.copy(wst).sub(pel);
    this.neck.position.copy(B.head).sub(wst);
    this.torso.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    const L1s = [];
    const L2s = [];
    // Bind-pose aim of a limb segment, as (X, Z) angles for a rest direction of straight down.
    const aim = (d) => [Math.atan2(-d.z, -d.y), Math.asin(Math.max(-1, Math.min(1, d.x)))];
    for (const sd of ["L", "R"]) {
      const sh = this[sd === "L" ? "lSh" : "rSh"];
      const el = this[sd === "L" ? "lEl" : "rEl"];
      const hand = this[sd === "L" ? "lHand" : "rHand"];
      const hip = this[sd === "L" ? "lHip" : "rHip"];
      const knee = this[sd === "L" ? "lKnee" : "rKnee"];
      const S = B["upperarm_" + sd], E = B["forearm_" + sd], W = B["hand_" + sd];
      const H = B["thigh_" + sd], K = B["shin_" + sd], A = B["foot_" + sd];
      sh.position.copy(S).sub(wst);
      el.position.set(0, -S.distanceTo(E), 0);
      hand.position.set(0, -E.distanceTo(W), 0);
      hip.position.copy(H).sub(pel);
      knee.position.set(0, -H.distanceTo(K), 0);
      L1s.push(H.distanceTo(K));
      L2s.push(K.distanceTo(A));
      this.ankleH = A.y;
      const [ax, az] = aim(E.clone().sub(S).normalize());
      sh.rotation.set(ax, 0, az);
      const fl = W.clone().sub(E).normalize().applyQuaternion(sh.quaternion.clone().invert());
      el.rotation.set(Math.atan2(-fl.z, -fl.y), 0, 0);
      hand.rotation.set(0, 0, 0);
      const [lx, lz] = aim(K.clone().sub(H).normalize());
      hip.rotation.set(lx, 0, lz);
      const sl = A.clone().sub(K).normalize().applyQuaternion(hip.quaternion.clone().invert());
      knee.rotation.set(Math.atan2(-sl.z, -sl.y), 0, 0);
    }
    this.L1 = (L1s[0] + L1s[1]) / 2;
    this.L2 = (L2s[0] + L2s[1]) / 2;

    const mat = src.material.clone();
    // The sculpt ships with a 2x specular boost that turns the robe into wet plastic under torchlight.
    if (mat.specularColor) mat.specularColor.setScalar(0.6);
    this.mats.push(mat);
    this.baseEmissive.push(mat.emissive.clone());
    this.baseEmissiveI.push(mat.emissiveIntensity);
    const mesh = new THREE.SkinnedMesh(src.geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    const map = this.jointMap();
    this.root.updateMatrixWorld(true);
    // Skirt strands (bones "skirt_<strand>_<node>") become free-floating bones posed by the cloth sim.
    const strands = [];
    for (const b of src.skeleton.bones) {
      const m = /^skirt_(\d+)_(\d+)$/.exec(b.name);
      if (!m) continue;
      const bone = new THREE.Object3D();
      bone.matrixAutoUpdate = false;
      const rest = B[b.name].clone().sub(pel); // body space (the body is unrotated at bind)
      bone.matrixWorld.compose(rest.clone().applyMatrix4(this.body.matrixWorld), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      ((strands[+m[1]] ||= [])[+m[2]] = { bone, rest });
      map[b.name] = bone;
    }
    const bones = src.skeleton.bones.map((b) => map[b.name] || this.body);
    mesh.bind(new THREE.Skeleton(bones, bones.map((g) => g.matrixWorld.clone().invert())), mesh.matrixWorld);
    this.skin = mesh;
    if (strands.length) this.cloth = new SkirtCloth(this, strands);
    // Dominant joint per vertex, for carving severed pieces out of the skin.
    const si = src.geometry.attributes.skinIndex;
    const sw = src.geometry.attributes.skinWeight;
    this.domBone = new Uint16Array(si.count);
    for (let i = 0; i < si.count; i++) {
      let best = 0;
      for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, best)) best = j;
      this.domBone[i] = si.getComponent(i, best);
    }
  }

  // Bake the skin triangles owned by `obj`'s subtree, in their current pose, into a loose mesh.
  carveSkin(obj) {
    const mesh = this.skin;
    const geo = mesh.geometry;
    const sub = new Set();
    obj.traverse((o) => sub.add(o));
    const bones = mesh.skeleton.bones;
    const inSub = (i) => sub.has(bones[this.domBone[i]]);
    this.root.updateMatrixWorld(true);
    mesh.skeleton.update();
    const pivot = obj.getWorldPosition(new THREE.Vector3());
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const idx = geo.index;
    const remap = new Map();
    const P = [];
    const U = [];
    const I = [];
    const v = new THREE.Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (!(inSub(a) && inSub(b) && inSub(c))) continue;
      for (const i of [a, b, c]) {
        if (!remap.has(i)) {
          v.fromBufferAttribute(pos, i);
          mesh.applyBoneTransform(i, v);
          v.applyMatrix4(mesh.matrixWorld).sub(pivot);
          remap.set(i, P.length / 3);
          P.push(v.x, v.y, v.z);
          if (uv) U.push(uv.getX(i), uv.getY(i));
        }
        I.push(remap.get(i));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    const piece = new THREE.Mesh(g, mesh.material);
    piece.castShadow = true;
    piece.position.copy(pivot);
    return piece;
  }

  // Swap the primitive body for Blender-built pieces, each hung on the matching rig joint.
  useBodyModel(parts) {
    this.stripBody();
    const joints = {
      hips: this.body, torso: this.torso, head: this.neck,
      upperarm_L: this.lSh, forearm_L: this.lEl, hand_L: this.lHand, thigh_L: this.lHip, shin_L: this.lKnee,
      upperarm_R: this.rSh, forearm_R: this.rEl, hand_R: this.rHand, thigh_R: this.rHip, shin_R: this.rKnee,
    };
    for (const [name, joint] of Object.entries(joints)) {
      const src = parts[name];
      if (!src) continue;
      const piece = this.adopt(src.clone(true));
      piece.position.set(0, 0, 0);
      joint.add(piece);
    }
  }

  // Detach a body part (cut at a random joint along it) and hand it to the world as loose debris.
  sever(part, forcedIdx = null) {
    const opts = {
      head: [this.neck],
      rArm: [this.rSh, this.rEl],
      lArm: [this.lSh, this.lEl],
      lLeg: [this.lHip, this.lKnee],
      rLeg: [this.rHip, this.rKnee],
    }[part];
    const idx = forcedIdx ?? Math.floor(Math.random() * opts.length);
    const obj = opts[Math.min(idx, opts.length - 1)];
    const parent = obj.parent;
    const r = part === "head" ? 0.075 : part.endsWith("Leg") ? 0.075 : 0.06;
    const capGeo = new THREE.SphereGeometry(r, 8, 6);
    const stump = new THREE.Mesh(capGeo, this.matsByName.gore);
    stump.position.copy(obj.position);
    stump.scale.y = 0.45;
    parent.add(stump);
    const cap = new THREE.Mesh(capGeo, this.matsByName.gore);
    cap.scale.y = 0.45;
    obj.add(cap);
    const cut = { part, idx, obj, parent, pos: obj.position.clone(), quat: obj.quaternion.clone(), stump, cap, cauterized: false };
    if (this.skin) {
      // Skinned body: carve the limb out as a loose mesh, then collapse it on the body into a stump.
      const piece = this.carveSkin(obj);
      this.root.parent.add(piece);
      piece.add(cap);
      cut.held = [];
      for (const item of [this.weapon, this.bow]) {
        let p = item;
        while (p && p !== obj) p = p.parent;
        if (!item || !p) continue;
        cut.held.push({ item, parent: item.parent, pos: item.position.clone(), quat: item.quaternion.clone() });
        piece.attach(item);
      }
      obj.scale.setScalar(0.001);
      cut.skinned = true;
      cut.obj = piece;
      cut.joint = obj;
    } else this.root.parent.attach(obj);
    (cut.joint || obj).traverse((o) => (o.userData.cut = true));
    this.cuts.push(cut);
    this.severed.add(part);
    return cut;
  }

  // A gash on the torso, front or back.
  addWound(front = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03 + Math.random() * 0.12, 0.018, 0.012), this.matsByName.gore);
    m.position.set((Math.random() - 0.5) * 0.3, 0.12 + Math.random() * 0.32, front ? 0.127 : -0.127);
    m.rotation.z = (Math.random() - 0.5) * 2;
    this.torso.add(m);
    this.wounds.push(m);
  }

  restore() {
    for (const c of this.cuts.reverse()) {
      if (c.skinned) {
        for (const hld of c.held) {
          hld.parent.add(hld.item);
          hld.item.position.copy(hld.pos);
          hld.item.quaternion.copy(hld.quat);
          hld.item.scale.set(1, 1, 1);
        }
        c.obj.removeFromParent();
        c.obj.geometry.dispose();
        c.joint.scale.set(1, 1, 1);
        c.parent.remove(c.stump);
        c.joint.traverse((o) => (o.userData.cut = false));
        continue;
      }
      c.parent.add(c.obj);
      c.obj.position.copy(c.pos);
      c.obj.quaternion.copy(c.quat);
      c.obj.scale.set(1, 1, 1);
      c.obj.remove(c.cap);
      c.parent.remove(c.stump);
      c.obj.traverse((o) => (o.userData.cut = false));
    }
    for (const w of this.wounds) w.parent.remove(w);
    this.cuts = [];
    this.wounds = [];
    this.severed.clear();
  }

  get legsLost() {
    return (this.severed.has("lLeg") ? 1 : 0) + (this.severed.has("rLeg") ? 1 : 0);
  }

  apply(noIK = false) {
    const p = this.cur;
    const ok = (o) => !o.userData.cut;
    this.body.position.y = this.hipHeight + p.hipsY;
    this.body.rotation.x = p.bodyX;
    this.torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
    if (ok(this.neck)) this.neck.rotation.set(p.headX, p.headY, 0);
    if (ok(this.rSh)) this.rSh.rotation.set(p.rShX, p.rShY, p.rShZ);
    if (ok(this.rEl)) {
      this.rEl.rotation.x = p.rEl;
      if (this.weapon.parent === this.rHand) this.weapon.rotation.x = p.rWrist;
    }
    if (ok(this.lSh)) this.lSh.rotation.set(p.lShX, p.lShY, p.lShZ);
    if (ok(this.lEl)) this.lEl.rotation.x = p.lEl;

    let lh = p.lHip, lk = p.lKnee, rh = p.rHip, rk = p.rKnee;
    // Two-bone IK: keep planted feet on the ground when the hips crouch.
    if (!noIK && Math.abs(p.bodyX) < 0.05) {
      const V = this.body.position.y + this.lHip.position.y - this.ankleH;
      [lh, lk] = this.legIK(lh, lk, V);
      [rh, rk] = this.legIK(rh, rk, V);
    }
    if (ok(this.lHip)) this.lHip.rotation.set(lh, 0, p.lHipZ);
    if (ok(this.lKnee)) this.lKnee.rotation.x = lk;
    if (ok(this.rHip)) this.rHip.rotation.set(rh, 0, p.rHipZ);
    if (ok(this.rKnee)) this.rKnee.rotation.x = rk;
  }

  legIK(hip, knee, V) {
    const t1 = -hip;
    const t2 = t1 - knee;
    const { L1, L2 } = this;
    const f = L1 * Math.sin(t1) + L2 * Math.sin(t2);
    const v = L1 * Math.cos(t1) + L2 * Math.cos(t2);
    if (v <= V) return [hip, knee];
    const d = Math.min(Math.hypot(f, V), L1 + L2 - 1e-4);
    const kneeInner = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
    const beta = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const alpha = Math.atan2(f, V);
    return [-(alpha + beta), Math.PI - kneeInner];
  }

  tipWorld(out) {
    return this.weaponTip.getWorldPosition(out);
  }
  baseWorld(out) {
    return this.weaponBase.getWorldPosition(out);
  }
}
