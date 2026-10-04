import * as THREE from "three";

// Sengoku-era architecture: ishigaki stone bases, white plaster walls with tiled caps, vermilion torii,
// stone lanterns, pagodas and small shrines. Builders return meshes plus colliders.

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const noise = (g, w, h, n, a, dark = true) => {
  for (let i = 0; i < n; i++) {
    const v = dark ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
};

export function makeMaterials() {
  const plaster = canvas(512, 512, (g, w, h) => {
    g.fillStyle = "#e8e2d4";
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 14000, 0.05);
    for (let i = 0; i < 40; i++) {
      // rain streaks and grime
      const x = Math.random() * w;
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "rgba(80,70,55,0)");
      gr.addColorStop(1, `rgba(80,70,55,${0.05 + Math.random() * 0.12})`);
      g.fillStyle = gr;
      g.fillRect(x, Math.random() * h * 0.5, 2 + Math.random() * 10, h);
    }
  });
  const stone = canvas(512, 512, (g, w, h) => {
    // ishigaki: big irregular dry-laid stones
    g.fillStyle = "#2a2724";
    g.fillRect(0, 0, w, h);
    let y = 0;
    while (y < h) {
      const rh = 40 + Math.random() * 50;
      let x = -Math.random() * 60;
      while (x < w) {
        const rw = 50 + Math.random() * 90;
        const l = 95 + Math.random() * 45;
        g.fillStyle = `rgb(${l},${l - 4},${l - 12})`;
        g.beginPath();
        const j = () => (Math.random() - 0.5) * 10;
        g.moveTo(x + 4 + j(), y + 4 + j());
        g.lineTo(x + rw - 4 + j(), y + 4 + j());
        g.lineTo(x + rw - 4 + j(), y + rh - 4 + j());
        g.lineTo(x + 4 + j(), y + rh - 4 + j());
        g.fill();
        if (Math.random() < 0.25) {
          g.fillStyle = "rgba(70,95,45,0.35)"; // moss
          g.fillRect(x + 4, y + 4, rw * 0.6, rh * 0.25);
        }
        x += rw;
      }
      y += rh;
    }
    noise(g, w, h, 16000, 0.18);
  });
  const tiles = canvas(256, 256, (g, w, h) => {
    g.fillStyle = "#3a3d43";
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, "#23252a");
      gr.addColorStop(0.5, "#5a5e66");
      gr.addColorStop(1, "#23252a");
      g.fillStyle = gr;
      g.fillRect(x, 0, 16, h);
    }
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(0, y, w, 4);
    }
    noise(g, w, h, 3000, 0.15);
  });
  const wood = canvas(256, 256, (g, w, h) => {
    g.fillStyle = "#2b1d15";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? "10,6,4" : "70,50,36"},${Math.random() * 0.4})`;
      g.beginPath();
      const y = Math.random() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w, y + 2);
      g.stroke();
    }
  });
  return {
    plaster: new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.92 }),
    stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }),
    tiles: new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.6, metalness: 0.15 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.8 }),
    lacquer: new THREE.MeshStandardMaterial({ color: 0xb33a22, roughness: 0.45 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1b1716, roughness: 0.6 }),
    lantern: new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.95, map: stone }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffd090, emissive: 0xffa040, emissiveIntensity: 2.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 0.9, roughness: 0.35 }),
  };
}

// Box whose UVs scale with world size.
export function tiledBox(w, h, d, s = 2.5) {
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

const mesh = (geo, mat, x, y, z, parent) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
};

// A gabled tile roof with overhanging eaves, along local X.
function gableRoof(len, width, rise, mat) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width * 0.08, rise);
  s.lineTo(-width * 0.08, rise);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  return new THREE.Mesh(g, mat);
}

// One section of castle wall: ishigaki base, plaster wall, dark beam, tiled cap.
export function wallSegment(M, cx, cz, len, t, h, alongX) {
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  if (!alongX) g.rotation.y = Math.PI / 2;
  const baseH = h * 0.5;
  const plasterH = h - baseH - 0.5;
  const base = mesh(tiledBox(len, baseH, t + 0.25, 3), M.stone, 0, baseH / 2, 0, g);
  const wall = mesh(tiledBox(len, plasterH, t * 0.82, 3), M.plaster, 0, baseH + plasterH / 2, 0, g);
  mesh(tiledBox(len, 0.22, t * 0.9), M.wood, 0, baseH + plasterH - 0.11, 0, g);
  mesh(tiledBox(len, 0.12, t * 0.86), M.wood, 0, baseH + 0.06, 0, g);
  const roof = gableRoof(len + 0.05, t + 1.0, 0.75, M.tiles);
  roof.position.y = baseH + plasterH;
  roof.castShadow = true;
  g.add(roof);
  return { group: g, cameraMeshes: [base, wall] };
}

export function torii(M, x, y, z, rotY = 0, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);
  const W = 4.6, H = 5.2;
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.2, 0.24, H, 14), M.lacquer, (s * W) / 2, H / 2, 0, g);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 14), M.black, (s * W) / 2, 0.2, 0, g);
  }
  mesh(new THREE.BoxGeometry(W + 1.2, 0.28, 0.24), M.lacquer, 0, H - 1.1, 0, g); // nuki
  mesh(new THREE.BoxGeometry(0.22, 0.9, 0.2), M.lacquer, 0, H - 0.55, 0, g); // gakuzuka
  // Kasagi: the black upswept top beam, built from short boxes along a curve.
  const n = 11, span = W + 2.6;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    const yy = H + 0.15 + u * u * 1.4;
    const slope = Math.atan((2 * u * 1.4) / span);
    const b = mesh(new THREE.BoxGeometry(span / n + 0.1, 0.32, 0.5), M.black, u * span, yy, 0, g);
    b.rotation.z = slope;
    const sh = mesh(new THREE.BoxGeometry(span / n + 0.1, 0.24, 0.36), M.lacquer, u * span * 0.94, yy - 0.28, 0, g);
    sh.rotation.z = slope;
  }
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const circles = [-1, 1].map((k) => ({ x: x + ((k * W) / 2) * c * scale, z: z - ((k * W) / 2) * s * scale, r: 0.3 * scale, top: y + 5.4 * scale }));
  return { group: g, circles };
}

export function lantern(M, x, y, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.18, 6), M.lantern, 0, 0.09, 0, g);
  mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.75, 8), M.lantern, 0, 0.55, 0, g);
  mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.12, 6), M.lantern, 0, 0.98, 0, g);
  mesh(new THREE.BoxGeometry(0.4, 0.36, 0.4), M.lantern, 0, 1.22, 0, g);
  for (const [dx, dz, ry] of [[0, 0.201, 0], [0, -0.201, 0], [0.201, 0, Math.PI / 2], [-0.201, 0, Math.PI / 2]]) {
    const w = mesh(new THREE.PlaneGeometry(0.2, 0.2), M.glow, dx, 1.22, dz, g);
    w.rotation.y = ry;
    w.castShadow = false;
  }
  mesh(new THREE.ConeGeometry(0.5, 0.32, 6), M.lantern, 0, 1.56, 0, g);
  mesh(new THREE.SphereGeometry(0.08, 8, 6), M.lantern, 0, 1.78, 0, g);
  return { group: g, circles: [{ x, z, r: 0.42, top: y + 1.8 }] };
}

export function pagoda(M, x, y, z, tiers = 5) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  mesh(tiledBox(9, 1.2, 9, 3), M.stone, 0, 0.6, 0, g);
  let yy = 1.2;
  for (let i = 0; i < tiers; i++) {
    const w = 5.6 - i * 0.7;
    const bh = i === 0 ? 2.6 : 1.7;
    mesh(tiledBox(w, bh, w, 2), M.plaster, 0, yy + bh / 2, 0, g);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) mesh(new THREE.BoxGeometry(0.28, bh, 0.28), M.lacquer, (dx * w) / 2, yy + bh / 2, (dz * w) / 2, g);
    mesh(tiledBox(w + 0.3, 0.3, w + 0.3), M.wood, 0, yy + bh + 0.15, 0, g);
    // Flared hip roof: a squat four-sided frustum.
    const roof = mesh(new THREE.CylinderGeometry(w * 0.5, w * 1.0, 0.8, 4, 1), M.tiles, 0, yy + bh + 0.7, 0, g);
    roof.rotation.y = Math.PI / 4;
    yy += bh + 1.1;
  }
  mesh(new THREE.CylinderGeometry(0.08, 0.12, 4, 8), M.gold, 0, yy + 2, 0, g);
  for (let i = 0; i < 6; i++) mesh(new THREE.TorusGeometry(0.28 - i * 0.02, 0.05, 6, 16), M.gold, 0, yy + 0.8 + i * 0.45, 0, g).rotation.x = Math.PI / 2;
  return { group: g, boxes: [{ minX: x - 4.5, maxX: x + 4.5, minZ: z - 4.5, maxZ: z + 4.5, top: y + yy }], height: yy + 4 };
}

export function shrine(M, x, y, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  mesh(tiledBox(6.4, 0.9, 4.6, 3), M.stone, 0, 0.45, 0, g);
  mesh(tiledBox(5.8, 0.18, 4.0), M.wood, 0, 0.99, 0, g);
  for (const [dx, dz] of [[-2.6, -1.8], [2.6, -1.8], [-2.6, 1.8], [2.6, 1.8], [0, 1.8], [0, -1.8]]) mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.6, 10), M.lacquer, dx, 2.3, dz, g);
  mesh(tiledBox(5.4, 2.4, 0.2, 2), M.plaster, 0, 2.2, -1.7, g);
  for (const s of [-1, 1]) mesh(tiledBox(0.2, 2.4, 3.4, 2), M.plaster, s * 2.6, 2.2, -0.1, g);
  mesh(tiledBox(6.2, 0.28, 4.4), M.wood, 0, 3.7, 0, g);
  const roof = gableRoof(7.4, 6, 1.9, M.tiles);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = 3.84;
  roof.castShadow = true;
  g.add(roof);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const hw = 3.2, hd = 2.3;
  const ex = Math.abs(hw * c) + Math.abs(hd * s), ez = Math.abs(hw * s) + Math.abs(hd * c);
  return { group: g, boxes: [{ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, top: y + 5.6 }] };
}
