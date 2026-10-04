import * as THREE from "three";
import { rand } from "./util.js";

// Consumables kept in the inventory. Arrows live on the player's quiver, not here.
export const ITEMS = {
  hpvial: { name: "Crimson Vial", desc: "A draught of warm blood-wine. Restores 35% of your health.", key: "4", color: 0xff4040, glow: 0xff2010 },
  mpvial: { name: "Azure Vial", desc: "Condensed starlight. Restores 50% of your mana.", key: "5", color: 0x4a8aff, glow: 0x2a5aff },
  regrow: { name: "Rebirth Draught", desc: "Bitter golden ichor. Severed limbs grow back, wounds close and the bleeding stops.", key: "6", color: 0xffd060, glow: 0xffa020 },
};

// What each enemy type can leave behind: [item, chance, min, max].
const TABLES = {
  hollow: [["hpvial", 0.3, 1, 1], ["mpvial", 0.25, 1, 1], ["arrows", 0.45, 2, 5], ["regrow", 0.04, 1, 1]],
  knight: [["hpvial", 0.75, 1, 2], ["mpvial", 0.55, 1, 2], ["arrows", 0.65, 4, 8], ["regrow", 0.3, 1, 1]],
  boss: [["hpvial", 1, 3, 3], ["mpvial", 1, 3, 3], ["arrows", 1, 12, 12], ["regrow", 1, 2, 2]],
};

const PICK_R = 1.2;

// Glowing pickups on the ground, and recovery of spent arrows.
export class Loot {
  constructor(game) {
    this.game = game;
    this.drops = [];
    this.vialGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.2, 10);
    this.neckGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8);
    this.mats = Object.fromEntries(
      Object.entries(ITEMS).map(([k, it]) => [k, new THREE.MeshStandardMaterial({ color: it.color, emissive: it.glow, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.1 })]),
    );
    this.corkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9 });
  }

  makeMesh(id, count) {
    const g = new THREE.Group();
    if (id === "arrows") {
      // A small bundle of real arrows.
      for (let i = 0; i < Math.min(4, count); i++) {
        const a = this.game.arrows.makeMesh();
        a.rotation.set(-Math.PI / 2 + rand(-0.15, 0.15), 0, rand(-0.25, 0.25));
        a.position.set(rand(-0.05, 0.05), -0.32, rand(-0.05, 0.05));
        a.scale.setScalar(0.85);
        g.add(a);
      }
    } else {
      const v = new THREE.Mesh(this.vialGeo, this.mats[id]);
      const n = new THREE.Mesh(this.neckGeo, this.mats[id]);
      n.position.y = 0.14;
      const c = new THREE.Mesh(this.neckGeo, this.corkMat);
      c.scale.set(1.2, 0.5, 1.2);
      c.position.y = 0.2;
      g.add(v, n, c);
    }
    g.traverse((m) => m.isMesh && (m.castShadow = true));
    return g;
  }

  drop(pos, id, count) {
    const g = this.game;
    const p = pos.clone().add(new THREE.Vector3(rand(-0.9, 0.9), 0, rand(-0.9, 0.9)));
    p.y = g.world.heightAt(p.x, p.z);
    const mesh = this.makeMesh(id, count);
    g.scene.add(mesh);
    this.drops.push({ id, count, pos: p, mesh, t: 0, seed: Math.random() * 6 });
  }

  // Roll an enemy's loot table; arrows lodged in the body come back too.
  dropFor(e) {
    const table = TABLES[e.type];
    if (!table || e.ally) return;
    let arrows = (e.stuck || []).length;
    for (const [id, chance, min, max] of table) {
      if (Math.random() > chance) continue;
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (id === "arrows") arrows += n;
      else for (let i = 0; i < n; i++) this.drop(e.pos, id, 1);
    }
    if (arrows) this.drop(e.pos, "arrows", arrows);
  }

  clear() {
    for (const d of this.drops) d.mesh.removeFromParent();
    this.drops = [];
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const pt = g.particles;
    for (const d of this.drops) {
      d.t += dt;
      d.mesh.position.set(d.pos.x, d.pos.y + 0.35 + Math.sin(d.t * 2.5 + d.seed) * 0.06, d.pos.z);
      d.mesh.rotation.y += dt * 1.5;
      if (Math.random() < 0.25) {
        const c = d.id === "hpvial" ? [1, 0.3, 0.25] : d.id === "mpvial" ? [0.35, 0.55, 1] : d.id === "regrow" ? [1, 0.8, 0.3] : [1, 0.9, 0.6];
        pt.emit(d.pos.x + rand(-0.15, 0.15), d.pos.y + 0.1, d.pos.z + rand(-0.15, 0.15), 0, rand(0.6, 1.2), 0, 1, 0.07, c[0], c[1], c[2], 0.8);
      }
      if (p.alive && d.t > 0.4 && Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z) < PICK_R && Math.abs(d.pos.y - p.pos.y) < 2) {
        if (this.collect(d.id, d.count)) d.taken = true;
      }
    }
    for (const d of this.drops) if (d.taken) d.mesh.removeFromParent();
    this.drops = this.drops.filter((d) => !d.taken);

    // Spent arrows stuck in the ground or low on walls can be pulled back out.
    if (!p.alive) return;
    const list = g.arrows.list;
    let got = 0;
    for (const a of list) {
      if (!a.stuck || a.t < 0.3 || a.m.userData.inBody || p.arrows >= p.arrowsMax) continue;
      const tip = a.m.position;
      if (Math.hypot(tip.x - p.pos.x, tip.z - p.pos.z) < PICK_R && tip.y - p.pos.y < 2.2 && tip.y - p.pos.y > -0.8) {
        a.m.removeFromParent();
        a.dead = true;
        p.arrows++;
        got++;
      }
    }
    if (got) {
      g.arrows.list = list.filter((a) => !a.dead);
      g.hud.toast(`Recovered ${got} arrow${got > 1 ? "s" : ""}`, 900);
      g.audio.pickup();
    }
  }

  collect(id, count) {
    const g = this.game;
    const p = g.player;
    if (id === "arrows") {
      if (p.arrows >= p.arrowsMax) return false;
      const take = Math.min(count, p.arrowsMax - p.arrows);
      p.arrows += take;
      g.hud.toast(`+${take} arrows`, 1000);
    } else {
      p.inv[id] = (p.inv[id] || 0) + count;
      g.hud.toast(`+${count} ${ITEMS[id].name}`, 1000);
    }
    g.audio.pickup();
    return true;
  }
}
