import * as THREE from "three";
import { Humanoid, P, copyPose } from "./humanoid.js";
import { angleTo, dampAngle, distXZ, rand } from "./util.js";

const $ = (id) => document.getElementById(id);

// What Ozrael sells. buy() returns false when the purchase can't be made (e.g. quiver full).
const STOCK = [
  { id: "arrows", name: "Bundle of Arrows", desc: "Ten fletched shafts, still warm from some poor soul's quiver.", price: 120, ic: "arrows",
    have: (p) => `${p.arrows} / ${p.arrowsMax}`, can: (p) => p.arrows < p.arrowsMax, buy: (p) => (p.arrows = Math.min(p.arrowsMax, p.arrows + 10)) },
  { id: "hpvial", name: "Crimson Vial", desc: "Restores 35% of your health. Tastes of iron and regret.", price: 260, ic: "hpvial",
    have: (p) => p.inv.hpvial || 0, can: () => true, buy: (p) => (p.inv.hpvial = (p.inv.hpvial || 0) + 1) },
  { id: "mpvial", name: "Azure Vial", desc: "Restores 50% of your mana. Bottled from a drowned star.", price: 240, ic: "mpvial",
    have: (p) => p.inv.mpvial || 0, can: () => true, buy: (p) => (p.inv.mpvial = (p.inv.mpvial || 0) + 1) },
  { id: "regrow", name: "Rebirth Draught", desc: "Regrows severed limbs, closes wounds, stops the bleeding.", price: 1400, ic: "regrow",
    have: (p) => p.inv.regrow || 0, can: () => true, buy: (p) => (p.inv.regrow = (p.inv.regrow || 0) + 1) },
  { id: "shard", name: "Estus Shard", desc: "A sliver of the First Flame. Permanently adds one estus flask.", price: 2600, ic: "estus",
    have: (p) => `${p.estusMax} / 8`, can: (p) => p.estusMax < 8, buy: (p) => (p.estusMax++, p.estus++) },
];

const GREET = [
  "Ahh… fresh souls, walking on two legs. Come, come. Ozrael trades fairly. Mostly.",
  "These chains were forged by a god. My prices were forged by me. Choose.",
  "You reek of the Warden's ash. Buy something before it finishes you.",
  "Another oath-breaker. Your kind always comes back. Usually in fewer pieces.",
];
const THANKS = ["A fine bargain. For me.", "Hehehe… spend it well, little flame.", "Yes. Yesss. More.", "Do try not to die before you use it."];
const POOR = ["Your soul-purse is thin as a hollow's skin. Come back richer.", "I do not do credit, mortal."];
const FULL = ["You can carry no more. Even greed has limits. Yours, not mine."];

// Ozrael, the Chained: a kneeling horned demon who sells wares for souls.
export class Merchant {
  constructor(game, x, z, facing) {
    this.game = game;
    this.pos = new THREE.Vector3(x, 0, z);
    this.facing = facing;
    this.baseFacing = facing;
    this.t = 0;
    const h = (this.h = new Humanoid({
      scale: 1.75, armor: 0x2a1414, cloth: 0x220808, skin: 0x5a1818, leather: 0x160806, helm: "boss",
      weapon: "broken", eyes: 0xff3a10, metal: 0x3a2a20, cape: true,
    }));
    h.weapon.visible = false;
    // Faint ember glow seeping through the armour plates.
    h.matsByName.armor.emissive.set(0x3a0802);
    h.matsByName.armor.emissiveIntensity = 0.6;
    h.baseEmissive[h.mats.indexOf(h.matsByName.armor)].copy(h.matsByName.armor.emissive);
    this.pose = { ...P.SIT };
    copyPose(h.cur, this.pose);
    h.root.position.copy(this.pos);
    h.root.rotation.y = facing;
    game.scene.add(h.root);
    game.world.circles.push({ x, z, r: 1.3 });

    // Chains to two iron stakes, and a ring of candles.
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2626, metalness: 0.85, roughness: 0.45 });
    const link = new THREE.TorusGeometry(0.07, 0.022, 6, 10);
    const side = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    for (const s of [-1, 1]) {
      const stake = this.pos.clone().addScaledVector(side, s * 1.7).addScaledVector(fwd, -0.4);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6), iron);
      post.position.copy(stake).setY(0.3);
      post.castShadow = true;
      game.scene.add(post);
      const wrist = this.pos.clone().addScaledVector(side, s * 0.75).addScaledVector(fwd, 0.35).setY(1.05);
      const top = stake.clone().setY(0.55);
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const p = top.clone().lerp(wrist, u);
        p.y -= Math.sin(u * Math.PI) * 0.35; // sag
        const m = new THREE.Mesh(link, iron);
        m.position.copy(p);
        m.lookAt(wrist);
        m.rotateZ(i % 2 ? Math.PI / 2 : 0);
        m.castShadow = true;
        game.scene.add(m);
      }
    }
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.8 });
    this.flames = [];
    for (let i = 0; i < 7; i++) {
      const a = facing - 1.3 + (i / 6) * 2.6;
      const r = 1.9 + rand(-0.15, 0.15);
      const cx = x + Math.sin(a) * r, cz = z + Math.cos(a) * r;
      const hgt = rand(0.12, 0.3);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, hgt, 8), wax);
      c.position.set(cx, hgt / 2, cz);
      game.scene.add(c);
      this.flames.push(new THREE.Vector3(cx, hgt + 0.04, cz));
    }
    this.light = new THREE.PointLight(0xff4a20, 5, 8, 1.8);
    this.light.position.set(x, 1.4, z).addScaledVector(fwd, 1);
    game.scene.add(this.light);
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    const p = g.player;
    const near = distXZ(p.pos, this.pos) < 7;
    // Turn his head (and a little of his body) to watch whoever comes close.
    const want = near ? angleTo(this.pos, p.pos) : this.baseFacing;
    this.facing = dampAngle(this.facing, this.baseFacing + Math.max(-0.5, Math.min(0.5, ((want - this.baseFacing + Math.PI * 3) % (Math.PI * 2)) - Math.PI)), 2, dt);
    this.h.root.rotation.y = this.facing;
    const breathe = Math.sin(this.t * 1.3);
    this.pose.torsoX = 0.35 + breathe * 0.04;
    this.pose.headX = near ? -0.15 : 0.3 + breathe * 0.03;
    this.pose.lShX = -0.7 + breathe * 0.03;
    this.pose.rShX = -0.7 - breathe * 0.03;
    this.h.update(dt, this.pose, 4);
    this.light.intensity = 5 + Math.sin(this.t * 9) * 0.8 + Math.sin(this.t * 5.3) * 0.6;
    for (const f of this.flames) if (Math.random() < 0.35) g.particles.emit(f.x, f.y, f.z, 0, rand(0.2, 0.5), 0, rand(0.2, 0.4), rand(0.05, 0.09), 1, 0.55, 0.2, 0.9);
    if (Math.random() < 0.2) {
      const e = this.h.neck.getWorldPosition(new THREE.Vector3());
      g.particles.emit(e.x + rand(-0.3, 0.3), e.y + rand(0, 0.4), e.z + rand(-0.3, 0.3), rand(-0.1, 0.1), rand(0.3, 0.8), rand(-0.1, 0.1), rand(1, 2), 0.05, 1, 0.3, 0.1, 0.8);
    }
  }

  // ── Shop screen ─────────────────────────────────────────────────────────
  open() {
    this.say(GREET[Math.floor(Math.random() * GREET.length)]);
    this.render();
    this.game.audio.roar();
  }

  say(line) {
    const el = $("shop-line");
    clearInterval(this.typer);
    let i = 0;
    el.textContent = "";
    this.typer = setInterval(() => {
      el.textContent = line.slice(0, ++i);
      if (i >= line.length) clearInterval(this.typer);
    }, 22);
  }

  render() {
    const p = this.game.player;
    $("shop-souls").innerHTML = `<span class="icon"></span>${p.souls.toLocaleString()} <small>souls</small>`;
    $("shop-stock").innerHTML = STOCK.map((it) => {
      const afford = p.souls >= it.price;
      const ok = it.can(p);
      return `<div class="plank ware ${afford && ok ? "" : "dim"}">
        <span class="ic big ${it.ic}"></span>
        <div class="ware-text"><b>${it.name}</b><small>${it.desc}</small></div>
        <div class="ware-have">Held<br/><b>${it.have(p)}</b></div>
        <button class="brush ${afford && ok ? "on" : ""}" data-id="${it.id}">${it.price.toLocaleString()}</button>
      </div>`;
    }).join("");
    $("shop-stock").querySelectorAll("button[data-id]").forEach((b) => (b.onclick = () => this.buy(b.dataset.id)));
  }

  buy(id) {
    const g = this.game;
    const p = g.player;
    const it = STOCK.find((s) => s.id === id);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (!it.can(p)) return this.say(pick(FULL));
    if (p.souls < it.price) return this.say(pick(POOR));
    p.souls -= it.price;
    it.buy(p);
    g.audio.souls();
    this.say(pick(THANKS));
    g.save();
    this.render();
  }
}
