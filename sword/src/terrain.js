import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WATER_LEVEL } from "./nature.js";
import { torii, lantern, pagoda, shrine } from "./japan.js";

// Endless wilderness around the castle: deterministic heightfield + scatter, streamed in chunks.

const SEED = 1337;
const CHUNK = 64;
const RES = 40; // quads per chunk side
const RADIUS = 2; // chunks kept around the player (5×5)
const ENEMY_RADIUS = 1; // chunks that get roaming hollows (3×3)
// The castle footprint stays flat and clear so the terrain meets the walls cleanly.
const LEVEL = { minX: -26, maxX: 26, minZ: -148, maxZ: 18 };

function hash(ix, iz, s = SEED) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, s), b = hash(ix + 1, iz, s), c = hash(ix, iz + 1, s), d = hash(ix + 1, iz + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function fbm(x, z, oct, s) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += noise(x * f, z * f, s + i * 17) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function levelDist(x, z) {
  const dx = Math.max(LEVEL.minX - x, 0, x - LEVEL.maxX);
  const dz = Math.max(LEVEL.minZ - z, 0, z - LEVEL.maxZ);
  return Math.hypot(dx, dz);
}

export function heightAt(x, z) {
  const d = levelDist(x, z);
  if (d <= 0) return 0;
  const k = smoothstep(4, 34, d);
  const hills = fbm(x * 0.011, z * 0.011, 4, 1) * 16;
  const ridges = (1 - Math.abs(fbm(x * 0.004, z * 0.004, 3, 9))) * 10 - 5;
  const bumps = fbm(x * 0.06, z * 0.06, 2, 5) * 1.4;
  return k * Math.max(-3.5, hills + ridges + bumps);
}

function wildTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#b4ae9e";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const v = 70 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v * 0.97},${v * 0.9},${0.15 + Math.random() * 0.25})`;
    const s = 1 + Math.random() * 4;
    g.fillRect(Math.random() * 512, Math.random() * 512, s, s);
  }
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `rgba(40,45,25,${Math.random() * 0.4})`;
    g.beginPath();
    const x = Math.random() * 512, y = Math.random() * 512;
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 8, y - 4 - Math.random() * 8);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function treeGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.3, 5, 7);
  trunk.translate(0, 2.5, 0);
  parts.push(trunk);
  const r = rng(7);
  for (let i = 0; i < 6; i++) {
    const l = 1 + r() * 1.4;
    const b = new THREE.CylinderGeometry(0.03, 0.08, l, 5);
    const a = r() * Math.PI * 2;
    b.translate(0, l / 2, 0);
    b.rotateZ(0.9);
    b.rotateY(a);
    b.translate(0, 2.2 + r() * 2.4, 0);
    parts.push(b);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

export class Terrain {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.chunks = new Map();
    this.mat = new THREE.MeshStandardMaterial({ map: wildTexture(), vertexColors: true, roughness: 1 });
    this.mat.map.repeat.set(10, 10);
    this.treeGeo = treeGeometry();
    this.rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.graveGeo = new THREE.BoxGeometry(0.55, 0.9, 0.15);
    this.woodMat = world.mats.wood;
    this.stoneMat = world.mats.stone;
    this.queue = [];
    this.center = null;
  }

  key(cx, cz) {
    return cx + "," + cz;
  }

  // Load what's near `focus`, drop what's far; a couple of chunks per frame to avoid hitches.
  update(focus, budget = 2) {
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    const c = this.key(cx, cz);
    if (c !== this.center) {
      this.center = c;
      this.queue = [];
      for (let dz = -RADIUS; dz <= RADIUS; dz++)
        for (let dx = -RADIUS; dx <= RADIUS; dx++) if (!this.chunks.has(this.key(cx + dx, cz + dz))) this.queue.push([cx + dx, cz + dz]);
      this.queue.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
      for (const [k, ch] of this.chunks) if (Math.abs(ch.cx - cx) > RADIUS + 1 || Math.abs(ch.cz - cz) > RADIUS + 1) this.unload(k);
    }
    while (budget-- > 0 && this.queue.length) {
      const [x, z] = this.queue.shift();
      if (!this.chunks.has(this.key(x, z))) this.load(x, z);
    }
    // Roaming enemies only in the 3×3 around the player.
    for (const ch of this.chunks.values()) {
      const near = Math.abs(ch.cx - cx) <= ENEMY_RADIUS && Math.abs(ch.cz - cz) <= ENEMY_RADIUS;
      if (near && !ch.enemies) this.spawnEnemies(ch);
      else if (!near && ch.enemies) this.despawnEnemies(ch);

    }
  }

  // Load everything around a point immediately (spawning, teleports).
  prime(focus) {
    this.center = null;
    this.update(focus, 99);
  }

  load(cx, cz) {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, RES, RES);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i) + ox + CHUNK / 2, pos.getZ(i) + oz + CHUNK / 2));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + ox + CHUNK / 2, wz = pos.getZ(i) + oz + CHUNK / 2;
      const rock = smoothstep(0.9, 0.72, nrm.getY(i));
      const grass = smoothstep(-0.35, 0.25, fbm(wx * 0.04, wz * 0.04, 3, 3)) * (1 - rock);
      const dry = smoothstep(0, 0.6, fbm(wx * 0.013, wz * 0.013, 2, 31)); // patches of dead, yellowed grass
      const ash = smoothstep(4, 0, levelDist(wx, wz)) * 0.6;
      let r = 0.46, g = 0.39, b = 0.3; // dirt
      const gr = 0.24 + 0.22 * dry, gg = 0.4 + 0.04 * dry, gb = 0.14 + 0.04 * dry;
      r += (gr - r) * grass; g += (gg - g) * grass; b += (gb - b) * grass;
      r += (0.46 - r) * rock; g += (0.45 - g) * rock; b += (0.44 - b) * rock;
      r += (0.3 - r) * ash; g += (0.29 - g) * ash; b += (0.28 - b) * ash;
      const wet = smoothstep(WATER_LEVEL + 0.6, WATER_LEVEL - 0.2, pos.getY(i)); // dark wet shore / lakebed
      r += (0.2 - r) * wet; g += (0.21 - g) * wet; b += (0.17 - b) * wet;
      col.set([r, g, b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const ground = new THREE.Mesh(geo, this.mat);
    ground.userData.own = true;
    ground.position.set(ox + CHUNK / 2, 0, oz + CHUNK / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const ch = { cx, cz, ground, objects: [ground], boxes: [], circles: [], cameraMeshes: [], enemies: null };
    this.scatter(ch, ox, oz);
    this.chunks.set(this.key(cx, cz), ch);
  }

  unload(k) {
    const ch = this.chunks.get(k);
    this.despawnEnemies(ch);
    for (const o of ch.objects) {
      o.removeFromParent();
      if (o.isInstancedMesh) o.dispose();
      if (o.userData.own) o.geometry.dispose();
    }
    this.dropGrass(ch);
    const nat = this.world.nature;
    nat.sakura = nat.sakura.filter((t) => t.ch !== ch);
    const cm = this.world.cameraMeshes;
    for (const m of ch.cameraMeshes) cm.splice(cm.indexOf(m), 1);
    this.chunks.delete(k);
  }

  scatter(ch, ox, oz) {
    const r = rng(Math.floor(hash(ch.cx, ch.cz, SEED + 5) * 4294967296));
    const free = (x, z, pad = 4) => levelDist(x, z) > pad;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const inst = (geo, mat, list) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = im.receiveShadow = true;
      this.scene.add(im);
      ch.objects.push(im);
    };

    // Forests: sakura groves, black pines on high ground, maple stands, green woods.
    const nat = this.world.nature;
    const forest = fbm((ox + 32) * 0.01, (oz + 32) * 0.01, 2, 21);
    const trees = [];
    const nt = Math.round(5 + Math.max(0, forest) * 34);
    for (let i = 0; i < nt; i++) {
      const x = ox + r() * CHUNK, z = oz + r() * CHUNK;
      if (!free(x, z, 6)) continue;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 0.3) continue;
      const biome = fbm(x * 0.006, z * 0.006, 2, 41);
      const kind = h > 7 ? "pine" : biome > 0.18 ? "sakura" : biome < -0.22 ? "maple" : r() < 0.35 ? "pine" : "green";
      const sc = 0.8 + r() * 0.5;
      p.set(x, h - 0.1, z);
      q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0));
      trees.push({ kind, variant: r() < 0.5 ? 0 : 1, matrix: m4.compose(p, q, s.set(sc, sc * (0.9 + r() * 0.25), sc)).clone() });
      ch.circles.push({ x, z, r: 0.4 * sc, top: h + 5.2 * sc }); // perch on the canopy
      if (kind === "sakura" || kind === "maple") nat.sakura.push({ x, y: h + 5 * sc, z, ch, color: kind === "sakura" ? [0.98, 0.76, 0.84] : [0.85, 0.25, 0.08] });
    }
    ch.grapple = [];
    for (const im of nat.instanceTrees(trees)) {
      this.scene.add(im);
      ch.objects.push(im);
      ch.grapple.push(im);
    }

    // Boulders and scree.
    const rocks = [];
    const nr = 6 + Math.floor(r() * 8);
    for (let i = 0; i < nr; i++) {
      const x = ox + r() * CHUNK, z = oz + r() * CHUNK;
      if (!free(x, z)) continue;
      const sc = r() < 0.2 ? 1.2 + r() * 1.6 : 0.25 + r() * 0.6;
      p.set(x, heightAt(x, z) + sc * 0.25, z);
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      rocks.push(m4.compose(p, q, s.set(sc * (0.8 + r() * 0.5), sc * 0.7, sc * (0.8 + r() * 0.5))).clone());
      if (sc > 0.6) ch.circles.push({ x, z, r: sc * 0.85, top: heightAt(x, z) + sc * 0.6 });
    }
    inst(this.rockGeo, this.stoneMat, rocks);

    // Graveyards.
    if (r() < 0.3) {
      const graves = [];
      const gx = ox + 10 + r() * 44, gz = oz + 10 + r() * 44;
      for (let i = 0; i < 10 + r() * 14; i++) {
        const x = gx + (r() - 0.5) * 14, z = gz + (r() - 0.5) * 14;
        if (!free(x, z)) continue;
        p.set(x, heightAt(x, z) + 0.35, z);
        q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, r() * 0.6 - 0.3, (r() - 0.5) * 0.3));
        graves.push(m4.compose(p, q, s.set(1, 0.8 + r() * 0.5, 1)).clone());
      }
      inst(this.graveGeo, this.stoneMat, graves);
    }

    // Sacred places: a shrine behind a torii and lanterns, or (rarely) a five-storey pagoda.
    const J = this.world.J;
    const add = (b) => {
      this.scene.add(b.group);
      ch.objects.push(b.group);
      ch.grapple.push(b.group);
      if (b.boxes) ch.boxes.push(...b.boxes);
      if (b.circles) ch.circles.push(...b.circles);
    };
    const roll = r();
    if (roll < 0.22) {
      const cx = ox + 16 + r() * 32, cz = oz + 16 + r() * 32;
      const rot = Math.floor(r() * 4) * (Math.PI / 2);
      const base = Math.min(heightAt(cx - 3, cz - 3), heightAt(cx + 3, cz + 3), heightAt(cx, cz));
      if (free(cx, cz, 16) && base > WATER_LEVEL + 0.3) {
        add(shrine(J, cx, base, cz, rot));
        const fx = Math.sin(rot), fz = Math.cos(rot);
        const tx = cx + fx * 9, tz = cz + fz * 9;
        add(torii(J, tx, heightAt(tx, tz) - 0.1, tz, rot));
        for (const sd of [-1, 1]) {
          const lx = cx + fx * 5 + fz * sd * 2.6, lz = cz + fz * 5 - fx * sd * 2.6;
          add(lantern(J, lx, heightAt(lx, lz), lz, rot));
        }
      }
    } else if (roll < 0.28) {
      const cx = ox + 20 + r() * 24, cz = oz + 20 + r() * 24;
      const base = Math.min(heightAt(cx - 4.5, cz - 4.5), heightAt(cx + 4.5, cz + 4.5), heightAt(cx - 4.5, cz + 4.5), heightAt(cx + 4.5, cz - 4.5));
      if (free(cx, cz, 18) && base > WATER_LEVEL + 0.3) add(pagoda(J, cx, base - 0.4, cz));
    }
    // A ruined shrine: broken walls on a square footprint, sometimes a standing arch.
    if (roll > 0.92) {
      const cx = ox + 14 + r() * 36, cz = oz + 14 + r() * 36;
      if (free(cx, cz, 14)) {
        const half = 4 + r() * 4;
        const base = heightAt(cx, cz);
        const wallBox = (x, z, w, d, h) => {
          const y0 = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), base) - 0.5;
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.5, d), this.stoneMat);
          m.position.set(x, y0 + (h + 0.5) / 2, z);
          m.castShadow = m.receiveShadow = true;
          this.scene.add(m);
          ch.objects.push(m);
          ch.cameraMeshes.push(m);
          this.world.cameraMeshes.push(m);
          ch.boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y0 + h + 0.5 });
        };
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let t = -half; t < half; t += 2.2) {
            if (r() < 0.35) continue; // gaps / collapsed sections
            const h = 1 + r() * 4;
            if (sx) wallBox(cx + sx * half, cz + t + 1.1, 0.9, 2.2, h);
            else wallBox(cx + t + 1.1, cz + sz * half, 2.2, 0.9, h);
          }
        }
        if (r() < 0.6) {
          wallBox(cx - 1.6, cz, 0.8, 0.8, 4.5);
          wallBox(cx + 1.6, cz, 0.8, 0.8, 4.5);
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.7, 0.9), this.stoneMat);
          lintel.position.set(cx, base + 4.6, cz);
          lintel.castShadow = true;
          this.scene.add(lintel);
          ch.objects.push(lintel);
        }
      }
    }
    ch.rngState = r;
  }

  // Wind-blown grass on grassy, gentle, dry ground — only in the chunks around the player.
  makeGrass(ch) {
    const g = this.world.game;
    const n = { Off: 0, Low: 2500, High: 6000 }[g.settings?.grass ?? "High"] ?? 6000;
    ch.grass = null;
    if (!n) return;
    const r = rng(Math.floor(hash(ch.cx, ch.cz, SEED + 23) * 4294967296));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const list = [];
    for (let i = 0; i < n; i++) {
      const x = ch.cx * CHUNK + r() * CHUNK, z = ch.cz * CHUNK + r() * CHUNK;
      if (levelDist(x, z) < 3) continue;
      const grass = smoothstep(-0.35, 0.25, fbm(x * 0.04, z * 0.04, 3, 3));
      if (r() > grass * 1.15) continue;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 0.15) continue;
      const slope = Math.abs(heightAt(x + 1, z) - h) + Math.abs(heightAt(x, z + 1) - h);
      if (slope > 0.75) continue;
      q.setFromAxisAngle(up, r() * 6.28);
      const sc = 0.7 + r() * 0.7;
      list.push(m4.compose(p.set(x, h - 0.03, z), q, s.set(sc, sc * (0.8 + r() * 0.6), sc)).clone());
    }
    if (!list.length) return;
    ch.grass = this.world.nature.grassMesh(list);
    this.scene.add(ch.grass);
  }

  dropGrass(ch) {
    if (ch.grass) {
      ch.grass.removeFromParent();
      ch.grass.dispose();
    }
    ch.grass = undefined;
  }

  refreshGrass() {
    const d = { Off: 0, Low: 2, High: 4 }[this.world.game.settings?.grass ?? "High"] ?? 4;
    this.world.nature.setupField(d);
  }

  // Where grass grows (for the grass field): gentle, grassy, dry ground outside the castle.
  grassAt(x, z) {
    if (levelDist(x, z) < 2) return null;
    const h = heightAt(x, z);
    if (h < WATER_LEVEL + 0.15) return null;
    const slope = Math.abs(heightAt(x + 1, z) - h) + Math.abs(heightAt(x, z + 1) - h);
    if (slope > 0.8) return null;
    return { h, grass: smoothstep(-0.35, 0.25, fbm(x * 0.04, z * 0.04, 3, 3)) };
  }

  spawnEnemies(ch) {
    ch.enemies = [];
    const g = this.world.game;
    if (g.mp) return; // matches stay in the arena
    const r = rng(Math.floor(hash(ch.cx, ch.cz, SEED + 11) * 4294967296));
    const n = r() < 0.55 ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < n; i++) {
      const x = ch.cx * CHUNK + 8 + r() * 48, z = ch.cz * CHUNK + 8 + r() * 48;
      if (levelDist(x, z) < 12) continue;
      ch.enemies.push(g.spawnEnemy({ type: r() < 0.12 ? "knight" : "hollow", x, z, f: r() * 6.28, wild: true }));
    }
  }

  despawnEnemies(ch) {
    if (!ch.enemies) return;
    for (const e of ch.enemies) this.world.game.removeEnemy(e);
    ch.enemies = null;
  }

  // Colliders of the chunks around a point.
  near(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const out = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.key(cx + dx, cz + dz));
        if (ch) out.push(ch);
      }
    return out;
  }
}
