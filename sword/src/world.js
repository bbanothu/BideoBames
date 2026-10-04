import * as THREE from "three";
import { clamp, rand } from "./util.js";
import { Terrain, heightAt } from "./terrain.js";

function canvasTex(draw, size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(g, s, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

const stoneTex = () =>
  canvasTex((g, s) => {
    g.fillStyle = "#2a2722";
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const bw = s / 4;
      const off = (r % 2) * bw * 0.5;
      for (let x = -bw; x < s + bw; x += bw) {
        const l = 70 + Math.random() * 30;
        g.fillStyle = `rgb(${l + 6},${l + 2},${l - 6})`;
        g.fillRect(x + off + 3, r * rh + 3, bw - 6, rh - 6);
      }
    }
    speckle(g, s, 9000, 0.25);
  });

const groundTex = () =>
  canvasTex((g, s) => {
    g.fillStyle = "#1c1a17";
    g.fillRect(0, 0, s, s);
    const n = 6;
    const c = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const l = 52 + Math.random() * 26;
        g.fillStyle = `rgb(${l},${l - 2},${l - 8})`;
        const j = () => rand(2, 9);
        g.beginPath();
        g.moveTo(x * c + j(), y * c + j());
        g.lineTo((x + 1) * c - j(), y * c + j());
        g.lineTo((x + 1) * c - j(), (y + 1) * c - j());
        g.lineTo(x * c + j(), (y + 1) * c - j());
        g.fill();
      }
    for (let i = 0; i < 14; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rand(20, 70));
      gr.addColorStop(0, "rgba(60,80,40,0.35)");
      gr.addColorStop(1, "rgba(60,80,40,0)");
      g.save();
      g.translate(Math.random() * s, Math.random() * s);
      g.fillStyle = gr;
      g.fillRect(-80, -80, 160, 160);
      g.restore();
    }
    speckle(g, s, 12000, 0.2);
  });

// Box whose UVs tile with world size instead of stretching.
function tiledBox(w, h, d, s = 2.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / s, (uv.getY(i) * dims[f][1]) / s);
    }
  return g;
}

// Afternoon sun, from the west-ish and fairly high.
const SUN_DIR = new THREE.Vector3(-0.42, 0.72, 0.55).normalize();

const FOG_FRAG = `
uniform float time;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  float n = fbm(vec2(vUv.x*3.0 + sin(time*0.2), vUv.y*2.5 - time*0.35));
  float m = fbm(vUv*5.0 + vec2(time*0.15, -time*0.1) + n);
  float a = 0.25 + 0.6*n*m*1.6;
  float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x) * smoothstep(1.0, 0.8, vUv.y);
  gl_FragColor = vec4(vec3(0.82, 0.86, 0.95) * (0.7 + 0.7*m), clamp(a, 0.0, 0.9) * edge);
}`;

class Bonfire {
  constructor(world, id, name, x, z) {
    this.id = id;
    this.name = name;
    this.pos = new THREE.Vector3(x, 0, z);
    this.lit = false;
    const g = (this.group = new THREE.Group());
    g.position.copy(this.pos);
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.16, 0.24)), stone);
      r.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
      r.rotation.set(rand(0, 3), rand(0, 3), 0);
      r.castShadow = r.receiveShadow = true;
      g.add(r);
    }
    const ash = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x1e1b19, roughness: 1 }));
    ash.position.y = 0.12;
    g.add(ash);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a2a20, metalness: 0.7, roughness: 0.6 }));
    blade.position.set(0, 0.55, 0);
    blade.rotation.z = 0.12;
    blade.castShadow = true;
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.05), blade.material);
    hilt.position.set(0.06, 1.05, 0);
    hilt.rotation.z = 0.12;
    g.add(blade, hilt);
    this.light = new THREE.PointLight(0xff8a3a, 0, 20, 1.5);
    this.light.position.set(0, 1.0, 0);
    g.add(this.light);
    world.scene.add(g);
    world.circles.push({ x, z, r: 0.6 });
  }

  setLit(v) {
    this.lit = v;
  }

  update(dt, pt, time) {
    if (!this.lit) {
      this.light.intensity = 0;
      if (Math.random() < 0.05) pt.emit(this.pos.x + rand(-0.2, 0.2), 0.3, this.pos.z + rand(-0.2, 0.2), 0, 0.4, 0, 1.2, 0.05, 0.6, 0.25, 0.1, 0.8);
      return;
    }
    this.light.intensity = 28 + Math.sin(time * 13) * 4 + Math.sin(time * 7.3) * 5;
    for (let i = 0; i < 3; i++) {
      pt.emit(this.pos.x + rand(-0.22, 0.22), 0.25, this.pos.z + rand(-0.22, 0.22), rand(-0.15, 0.15), rand(1.3, 2.2), rand(-0.15, 0.15), rand(0.35, 0.7), rand(0.25, 0.42), 1, rand(0.35, 0.55), 0.12, 0.55);
    }
    if (Math.random() < 0.35) pt.emit(this.pos.x, 0.6, this.pos.z, rand(-0.5, 0.5), rand(1.5, 2.8), rand(-0.5, 0.5), rand(1.5, 3), 0.05, 1, 0.6, 0.2, 1, -0.2, 0.3);
  }
}

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.boxes = [];
    this.circles = [];
    this.cameraMeshes = [];
    this.bonfires = [];
    this.braziers = [];
    this.messages = [];
    this.time = 0;
    this.mats = {
      stone: new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.95, color: 0xb0aca4 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x2b2017, roughness: 1 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.5 }),
    };
    this.build();
    this.terrain = new Terrain(this);
  }

  heightAt(x, z) {
    return heightAt(x, z);
  }

  box(cx, cz, w, d, h, mat = this.mats.stone, collide = true, y0 = 0) {
    const m = new THREE.Mesh(tiledBox(w, h, d), mat);
    m.position.set(cx, y0 + h / 2, cz);
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    if (collide) {
      this.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
      this.cameraMeshes.push(m);
    }
    return m;
  }

  // Ruined wall broken into chunks of uneven height. `gaps` are [from, to] openings.
  wall(axis, at, from, to, gaps = [], h = 6, t = 1.2) {
    let ranges = [[from, to]];
    for (const [g0, g1] of gaps)
      ranges = ranges.flatMap(([a, b]) => (g1 <= a || g0 >= b ? [[a, b]] : [[a, g0], [g1, b]].filter(([x, y]) => y - x > 0.05)));
    for (const [a, b] of ranges) {
      let p = a;
      while (p < b - 0.01) {
        const len = Math.min(b - p, rand(2.5, 4.5));
        const hh = h * rand(0.72, 1.1);
        if (axis === "x") this.box(p + len / 2, at, len, t, hh);
        else this.box(at, p + len / 2, t, len, hh);
        p += len;
      }
    }
  }

  pillar(x, z, r, h, broken = false) {
    const mat = this.mats.stone;
    const hh = broken ? h * rand(0.25, 0.55) : h;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, hh, 12), mat);
    m.position.set(x, hh / 2, z);
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    const base = new THREE.Mesh(tiledBox(r * 2.6, 0.4, r * 2.6), mat);
    base.position.set(x, 0.2, z);
    base.castShadow = base.receiveShadow = true;
    this.scene.add(base);
    if (!broken) {
      const cap = new THREE.Mesh(tiledBox(r * 2.6, 0.35, r * 2.6), mat);
      cap.position.set(x, hh + 0.17, z);
      cap.castShadow = true;
      this.scene.add(cap);
    } else {
      for (let i = 0; i < 3; i++) this.rubble(x + rand(-2, 2), z + rand(-2, 2), rand(0.3, 0.7));
    }
    this.circles.push({ x, z, r: r * 1.2 });
    this.cameraMeshes.push(m);
  }

  rubble(x, z, s) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s), this.mats.stone);
    m.position.set(x, s * 0.4, z);
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    m.scale.y = 0.6;
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    if (s > 0.5) this.circles.push({ x, z, r: s * 0.9 });
  }

  brazier(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 1.1, 6), this.mats.iron);
    legs.position.y = 0.55;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.22, 0.3, 10, 1, true), this.mats.iron);
    bowl.position.y = 1.2;
    bowl.material.side = THREE.DoubleSide;
    for (const m of [legs, bowl]) {
      m.castShadow = true;
      g.add(m);
    }
    const light = new THREE.PointLight(0xff7a2a, 14, 14, 1.6);
    light.position.y = 1.7;
    g.add(light);
    this.scene.add(g);
    this.circles.push({ x, z, r: 0.45 });
    this.braziers.push({ x, z, light, seed: Math.random() * 10 });
  }

  tree(x, z) {
    const mat = this.mats.wood;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const h = rand(4, 6);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, h, 7), mat);
    trunk.position.y = h / 2;
    trunk.rotation.z = rand(-0.1, 0.1);
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 6; i++) {
      const l = rand(1, 2.2);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, l, 5), mat);
      const y = rand(h * 0.45, h * 0.95);
      const a = rand(0, Math.PI * 2);
      b.position.set(Math.cos(a) * l * 0.35, y + l * 0.3, Math.sin(a) * l * 0.35);
      b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      b.castShadow = true;
      g.add(b);
    }
    this.scene.add(g);
    this.circles.push({ x, z, r: 0.35 });
  }

  grave(x, z) {
    const m = new THREE.Mesh(tiledBox(0.55, 0.9, 0.15), this.mats.stone);
    m.position.set(x, 0.4, z);
    m.rotation.set(rand(-0.15, 0.15), rand(-0.4, 0.4), rand(-0.15, 0.15));
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    // Swords of the fallen stuck in the earth.
    if (Math.random() < 0.5) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.015), this.mats.iron);
      s.position.set(x + 0.45, 0.4, z + 0.2);
      s.rotation.set(rand(-0.25, 0.25), 0, rand(-0.25, 0.25));
      s.castShadow = true;
      this.scene.add(s);
    }
  }

  message(x, z, text) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    this.scene.add(m);
    this.messages.push({ pos: new THREE.Vector3(x, 0, z), text, mesh: m });
  }

  build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xcfe0ff, 0x7a6650, 1.7));
    // The sun (still called `moon` internally: it's the one shadow-casting key light).
    const moon = (this.moon = new THREE.DirectionalLight(0xfff0d8, 3.2));
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = sc.bottom = -30;
    sc.right = sc.top = 30;
    sc.near = 1;
    sc.far = 200;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    s.add(moon, moon.target);

    // Sky dome + sun disc; both follow the camera so the horizon never ends either.
    this.sky = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 horizon = vec3(0.77, 0.82, 0.87), zenith = vec3(0.30, 0.50, 0.80), below = vec3(0.62, 0.62, 0.58);
            vec3 c = h > 0.0 ? mix(horizon, zenith, smoothstep(0.0, 0.55, h)) : mix(horizon, below, smoothstep(0.0, -0.2, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -1;
    this.sky.add(dome);
    const glow = canvasTex((g, sz) => {
      const gr = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
      gr.addColorStop(0, "rgba(255,252,240,1)");
      gr.addColorStop(0.1, "rgba(255,248,225,1)");
      gr.addColorStop(0.18, "rgba(255,235,190,0.45)");
      gr.addColorStop(1, "rgba(255,220,170,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, sz, sz);
    }, 256);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, fog: false, depthWrite: false, transparent: true }));
    sprite.scale.set(140, 140, 1);
    sprite.position.copy(SUN_DIR).multiplyScalar(380);
    this.sky.add(sprite);
    s.add(this.sky);

    const gt = groundTex();
    gt.repeat.set(52 / 4.5, 166 / 4.5);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(52, 166), new THREE.MeshStandardMaterial({ map: gt, roughness: 1, color: 0x9a968e }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0.006, -65);
    ground.receiveShadow = true;
    s.add(ground);

    // A: Courtyard of Ash
    this.wall("x", 14, -14.6, 14.6, [[-3, 3]], 6);
    this.box(-3.8, 14, 1.6, 1.8, 7.5);
    this.box(3.8, 14, 1.6, 1.8, 7.5);
    this.box(0, 14, 9.2, 1.4, 1.1, this.mats.stone, false, 6.4);
    this.wall("z", -14, -14, 14, [], 6);
    this.wall("z", 14, -14, 14, [], 6);
    this.wall("x", -14, -14.6, 14.6, [[-4, 4]], 6);
    this.box(-4.8, -14, 1.6, 1.8, 8.5);
    this.box(4.8, -14, 1.6, 1.8, 8.5);
    this.box(0, -14, 11.2, 1.4, 1.2, this.mats.stone, false, 7.3);
    this.tree(-9, 8);
    this.tree(10, -7);
    this.tree(9.5, 9);
    for (let i = 0; i < 14; i++) {
      const x = rand(-12, 12);
      const z = rand(-11, 12);
      if (Math.hypot(x, z - 4) > 4 && Math.abs(x) > 2.5) this.grave(x, z);
    }
    this.pillar(-8, -6, 0.55, 6, true);
    this.pillar(7.5, 2, 0.55, 6, true);
    this.brazier(-3, -11.5);
    this.brazier(3, -11.5);

    // B: Hollow Causeway
    this.wall("z", -5, -14, -50, [], 7);
    this.wall("z", 5, -14, -50, [], 7);
    for (const z of [-20, -28, -36, -44]) {
      this.pillar(-3.7, z, 0.45, 6.5, Math.random() < 0.4);
      this.pillar(3.7, z, 0.45, 6.5, Math.random() < 0.4);
    }
    this.brazier(-4, -32);
    this.rubble(1.5, -38, 0.6);

    // C: Sunken Hall
    this.wall("x", -50, -18.6, 18.6, [[-5, 5]], 8);
    this.wall("z", -18, -50, -86, [], 8);
    this.wall("z", 18, -50, -86, [], 8);
    this.wall("x", -86, -18.6, 18.6, [[-4, 4]], 8);
    for (const z of [-58, -68, -78]) {
      this.pillar(-9, z, 0.8, 9, Math.random() < 0.3);
      this.pillar(9, z, 0.8, 9, Math.random() < 0.3);
    }
    this.box(-14, -56, 1.6, 1.2, 1.1, this.mats.wood);
    this.box(13, -81, 1.4, 1.4, 1.0, this.mats.wood);
    this.brazier(-16, -68);
    this.brazier(16, -68);
    for (let i = 0; i < 8; i++) this.rubble(rand(-16, 16), rand(-84, -52), rand(0.2, 0.5));

    // D: Antechamber
    this.wall("z", -6, -86, -100, [], 8);
    this.wall("z", 6, -86, -100, [], 8);

    // E: Arena of the Warden
    this.wall("x", -100, -22.6, 22.6, [[-4, 4]], 10);
    this.box(-4.8, -100, 1.6, 1.8, 11);
    this.box(4.8, -100, 1.6, 1.8, 11);
    this.wall("z", -22, -100, -144, [], 10);
    this.wall("z", 22, -100, -144, [], 10);
    this.wall("x", -144, -22.6, 22.6, [], 10);
    for (const [x, z] of [[-16, -107], [16, -107], [-16, -137], [16, -137]]) this.pillar(x, z, 1.2, 12);
    const dais = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshStandardMaterial({ color: 0x3a3732, roughness: 1 }));
    dais.rotation.x = -Math.PI / 2;
    dais.position.set(0, 0.015, -122);
    dais.receiveShadow = true;
    s.add(dais);
    const ring = new THREE.Mesh(new THREE.RingGeometry(14.6, 15, 64), new THREE.MeshBasicMaterial({ color: 0x5a2010 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, -122);
    s.add(ring);
    // Colossal seated statue looming over the arena.
    this.box(0, -140.5, 8, 4, 3);
    this.box(0, -141.5, 5, 3, 7, this.mats.stone, false, 3);
    this.box(0, -141.5, 2.2, 2.2, 2.4, this.mats.stone, false, 10);
    this.box(-3.2, -139.5, 1.4, 4, 1.2, this.mats.stone, false, 3);
    this.box(3.2, -139.5, 1.4, 4, 1.2, this.mats.stone, false, 3);
    this.brazier(-12, -104);
    this.brazier(12, -104);
    this.brazier(-19, -122);
    this.brazier(19, -122);
    this.brazier(-9, -139);
    this.brazier(9, -139);

    // (Distant towers retired: the endless terrain now fills the horizon.)
    for (let i = 0; i < 0; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(70, 150);
      const x = Math.cos(a) * r;
      const z = -60 + Math.sin(a) * r;
      const w = rand(5, 14);
      const h = rand(15, 60);
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), this.mats.dark);
      t.position.set(x, h / 2, z);
      s.add(t);
      if (Math.random() < 0.5) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(w * 0.7, h * 0.3, 4), this.mats.dark);
        c.position.set(x, h + h * 0.15, z);
        c.rotation.y = Math.PI / 4;
        s.add(c);
      }
    }

    // Fog gate
    this.fogMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: FOG_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fogMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 6.5), this.fogMat);
    this.fogMesh.position.set(0, 3.25, -100);
    s.add(this.fogMesh);
    this.fogBox = { minX: -4, maxX: 4, minZ: -100.5, maxZ: -99.5 };
    this.boxes.push(this.fogBox);
    this.fogPos = new THREE.Vector3(0, 0, -100);

    this.bonfires.push(new Bonfire(this, "b1", "Courtyard of Ash", 0, 4));
    this.bonfires.push(new Bonfire(this, "b2", "Warden's Antechamber", -3.5, -92));

    this.message(1.6, 1.2, "WASD move · Mouse look · LMB attack · RMB heavy · Space roll (hold to sprint) · Shift block · R estus · Tab lock on · E interact");
    this.message(2, -16.5, "Hollows ahead. Try rolling through their swings.");
    this.message(-2.5, -52.5, "A knight guards this hall. Its shield is strong — try attacking from behind.");
    this.message(2.2, -95, "Fog ahead. Rest first, and be wary of its flames.");
    this.message(1.6, 11.5, "Beyond this gate the wilds go on forever. Hollows roam there.");

    this.spawns = [
      { type: "hollow", x: 2, z: -24, f: 0 },
      { type: "hollow", x: -2.5, z: -33, f: 0.3 },
      { type: "hollow", x: 1, z: -44, f: 0 },
      { type: "hollow", x: -11, z: -60, f: Math.PI },
      { type: "hollow", x: 11, z: -63, f: 0 },
      { type: "hollow", x: -7, z: -79, f: 0.5 },
      { type: "hollow", x: 12, z: -77, f: -0.4 },
      { type: "knight", x: 0, z: -71, f: 0 },
      { type: "boss", x: 0, z: -128, f: 0 },
    ];
    this.arena = { minX: -20, maxX: 20, minZ: -142, maxZ: -102 };
  }

  setFog(active, visible = active) {
    this.fogBox.disabled = !active;
    this.fogMesh.visible = visible;
    // A sealed gate also blocks the camera so it can't end up looking through the fog.
    const i = this.cameraMeshes.indexOf(this.fogMesh);
    if (active && i < 0) this.cameraMeshes.push(this.fogMesh);
    if (!active && i >= 0) this.cameraMeshes.splice(i, 1);
  }

  // Push a circle (XZ) out of all static colliders.
  resolve(pos, r) {
    const near = this.terrain ? this.terrain.near(pos.x, pos.z) : [];
    for (const b of near.length ? this.boxes.concat(...near.map((c) => c.boxes)) : this.boxes) {
      if (b.disabled) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      } else {
        const pl = pos.x - b.minX, pr = b.maxX - pos.x, pd = pos.z - b.minZ, pu = b.maxZ - pos.z;
        const m = Math.min(pl, pr, pd, pu);
        if (m === pl) pos.x = b.minX - r;
        else if (m === pr) pos.x = b.maxX + r;
        else if (m === pd) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
      }
    }
    for (const c of near.length ? this.circles.concat(...near.map((ch) => ch.circles)) : this.circles) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = r + c.r;
      if (d < min && d > 1e-6) {
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
  }

  update(dt, focus) {
    this.time += dt;
    this.terrain.update(focus);
    const pt = this.game.particles;
    for (const b of this.bonfires) b.update(dt, pt, this.time);
    for (const b of this.braziers) {
      b.light.intensity = 12 + Math.sin(this.time * 11 + b.seed) * 2.5 + Math.sin(this.time * 5.7 + b.seed) * 2;
      if (Math.hypot(b.x - focus.x, b.z - focus.z) > 45) continue;
      pt.emit(b.x + rand(-0.15, 0.15), 1.35, b.z + rand(-0.15, 0.15), rand(-0.1, 0.1), rand(0.9, 1.6), rand(-0.1, 0.1), rand(0.3, 0.55), rand(0.2, 0.32), 1, rand(0.35, 0.5), 0.1, 0.5);
    }
    this.fogMat.uniforms.time.value = this.time;
    if (this.fogMesh.visible && Math.random() < 0.4)
      pt.emit(rand(-3.8, 3.8), rand(0.2, 6), -100 + rand(-0.3, 0.3), rand(-0.2, 0.2), rand(0.1, 0.4), rand(-0.2, 0.2), rand(1, 2), 0.12, 0.6, 0.65, 0.75, 0.4);
    for (const m of this.messages) m.mesh.material.opacity = 0.4 + Math.sin(this.time * 2 + m.pos.x) * 0.15;
    // Keep the shadow frustum centred on the action.
    this.moon.target.position.set(focus.x, focus.y || 0, focus.z);
    this.moon.position.copy(SUN_DIR).multiplyScalar(80).add(this.moon.target.position);
    this.sky.position.copy(this.game.camera.position);
  }
}
