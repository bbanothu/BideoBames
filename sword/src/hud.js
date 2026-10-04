import * as THREE from "three";
import { damp } from "./util.js";
import { SKILLS, SPECIALS } from "./classes.js";

// One brush kanji per skill, Sekiro-style.
const KANJI = {
  warcry: "吼", slam: "震", charge: "突", step: "影", veil: "煙", venom: "毒", holybolt: "光", heal: "癒", sanctuary: "聖",
  rage: "怒", whirl: "旋", drain: "吸", raise: "屍", corpse: "爆", cleave: "斬", assassinate: "殺", smite: "罰", soulrend: "魂", barrage: "矢",
};
// Small line icons for status effects.
const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const STATUS = {
  bleed: ic('<path d="M12 3 C8 9 6 12 6 15 a6 6 0 0 0 12 0 c0-3-2-6-6-12 Z"/>'),
  warcry: ic('<path d="M4 15 L4 9 L9 9 L15 4 L15 20 L9 15 Z M18 8 c2 2 2 6 0 8"/>'),
  rage: ic('<path d="M12 21 c-5 0-7-4-6-8 c1 2 3 3 3 3 c-1-5 3-8 3-12 c3 3 7 7 7 12 c0 3-3 5-7 5 Z"/>'),
  veil: ic('<path d="M4 14 c2-3 5-3 7 0 s5 3 7 0 M4 9 c2-3 5-3 7 0 s5 3 7 0"/>'),
  venom: ic('<path d="M6 18 C6 8 14 4 20 4 C20 10 16 18 6 18 Z M6 18 L13 11"/>'),
};

// Line-art weapon glyphs for the big bottom-right tile.
const g = (d) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const GLYPHS = {
  sword: g('<path d="M50 8 L20 38 M46 8 h6 v6 L22 44 l-4-4 Z"/><path d="M14 36 l14 14 M17 47 l-7 7"/>'),
  dagger: g('<path d="M44 14 c4 6 2 10 -2 14 L26 44 l-6-6 L36 22 c4-4 6-8 8-8 Z"/><path d="M16 36 l12 12 M19 45 l-6 6"/>'),
  mace: g('<circle cx="42" cy="22" r="9"/><path d="M42 9 v4 M55 22 h-4 M42 35 v-4 M29 22 h4 M35 29 L12 52"/>'),
  axe: g('<path d="M16 54 L46 16"/><path d="M38 12 c10 0 16 6 16 16 c-6-2-10-2-14 2 c-2-6-2-12-2-18 Z"/>'),
  staff: g('<path d="M18 56 L44 18"/><circle cx="47" cy="13" r="6"/><path d="M40 10 l-4-4 M53 20 l4 4"/>'),
  bow: g('<path d="M18 8 c22 8 22 40 0 48"/><path d="M18 8 L18 56" stroke-width="1.2"/><path d="M18 32 H54 M48 27 l6 5 -6 5"/>'),
};

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = $("hud");
    this.hpBar = $("hp-bar");
    this.hpFill = this.hpBar.querySelector(".fill");
    this.hpTrail = this.hpBar.querySelector(".trail");
    this.stBar = $("st-bar");
    this.stFill = this.stBar.querySelector(".fill");
    this.estus = $("estus-count");
    this.souls = $("souls-val");
    this.boss = $("boss");
    this.bossFill = this.boss.querySelector(".fill");
    this.bossTrail = this.boss.querySelector(".trail");
    this.bossDmg = $("boss-dmg");
    this.prompt = $("prompt");
    this.lock = $("lock");
    this.floaters = $("floaters");
    this.toastEl = $("toast");
    this.msgEl = $("message");
    this.banner = $("banner");
    this.bleedEl = $("bleed");
    this.crosshair = $("crosshair");
    this.orbs = $("orbs");
    this.grappleMark = $("grapple-mark");
    this.bossDots = $("boss-dots");
    this.wglyph = $("wglyph");
    this.fpBar = $("fp-bar");
    this.hpVal = $("hp-val");
    this.whoClass = $("who-class");
    this.whoLvl = $("who-lvl");
    this.fpFill = this.fpBar.querySelector(".fill");
    this.manaCount = $("mana-count");
    this.skillsEl = $("skills");
    this.itemsEl = $("items");
    this.buffsEl = $("buffs");
    this.skillKey = "";
    this.weaponEl = $("weapon");
    this.bleedLabel = $("bleed-label");
    this.hpTrailV = 1;
    this.bossTrailV = 1;
    this.shownSouls = 0;
    this.bars = new Map();
    this.v = new THREE.Vector3();
  }

  show(v) {
    this.el.classList.toggle("hidden", !v);
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  showMessage(text) {
    this.msgEl.querySelector(".body").textContent = text;
    this.msgEl.classList.remove("hidden");
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.msgEl.classList.add("hidden"), 6000);
  }

  showBanner(text, kind, ms = 4000) {
    const b = this.banner;
    b.className = kind;
    // Sekiro-style: a brush kanji over a small spaced word.
    const kanji = { "YOU DIED": "死", DEFEAT: "敗", VICTORY: "勝", "ENEMY FELLED": "勝" }[text] || "";
    b.querySelector(".kanji").textContent = kanji;
    b.querySelector(".txt").textContent = text === "YOU DIED" ? "DEATH" : text;
    b.classList.toggle("has-kanji", !!kanji);
    void b.offsetWidth;
    b.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.remove("show"), ms);
  }

  setPrompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.prompt.classList.toggle("hidden", !text);
    if (text) this.prompt.innerHTML = `<kbd>E</kbd> ${text}`;
  }

  setBoss(enemy) {
    this.bossEnemy = enemy;
    this.boss.classList.toggle("hidden", !enemy);
    if (enemy) {
      this.boss.querySelector(".name").textContent = enemy.T.name;
      this.bossTrailV = enemy.hp / enemy.maxHp;
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.hpBar.style.width = Math.min(640, p.maxHp * 1.1) + "px";
    // Stamina reads like a posture gauge: only shown while it's being spent.
    this.stBar.classList.toggle("rest", p.sta >= p.maxSta - 0.5);
    const hpF = p.hp / p.maxHp;
    this.hpFill.style.width = hpF * 100 + "%";
    this.hpTrailV = hpF > this.hpTrailV ? hpF : damp(this.hpTrailV, hpF, 2.5, dt);
    this.hpTrail.style.width = this.hpTrailV * 100 + "%";
    // Posture: grows outward from the centre mark as stamina is spent; hotter colours near breaking.
    const posture = 1 - Math.max(0, p.sta / p.maxSta);
    this.stFill.style.width = posture * 100 + "%";
    this.stBar.classList.toggle("hot", posture > 0.55);
    this.stBar.classList.toggle("crit", posture > 0.85);
    this.hpBar.classList.toggle("low", hpF < 0.25);
    const bl = p.alive ? p.bleed : 0;
    const pulse = 0.75 + 0.25 * Math.sin(g.time * 8.5);
    this.bleedEl.style.opacity = bl > 0 ? Math.min(0.85, 0.25 + bl / 40) * pulse : 0;
    this.bleedLabel.classList.add("hidden");
    const bow = p.mode === "bow";
    this.weaponEl.textContent = bow ? `${p.arrows}` : "";
    const glyph = bow ? "bow" : p.cls.weapon;
    if (glyph !== this.glyph) {
      this.glyph = glyph;
      this.wglyph.innerHTML = GLYPHS[glyph] || GLYPHS.sword;
    }
    this.fpBar.style.width = Math.min(520, p.maxMana * 2.3) + "px";
    this.fpFill.style.width = Math.max(0, p.mana / p.maxMana) * 100 + "%";
    this.hpVal.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    this.whoClass.textContent = g.mp ? `${p.cls.name} · ${g.mp.isOne ? "The One" : "Hunter"}` : p.cls.name;
    this.whoLvl.textContent = `Lv ${p.level}`;
    this.manaCount.textContent = p.manaFlasks;
    this.itemsEl.innerHTML = `<span><b>4</b><span class="ic hpvial"></span>${p.inv.hpvial || 0}</span><span><b>5</b><span class="ic mpvial"></span>${p.inv.mpvial || 0}</span><span><b>6</b><span class="ic regrow"></span>${p.inv.regrow || 0}</span><span><b>I</b>Inventory</span>`;
    this.manaCount.parentElement.classList.toggle("empty", p.manaFlasks === 0);
    // Skill bar: the class's three skills plus the special for the weapon in hand.
    const sp = bow ? "barrage" : p.cls.special;
    const key = p.clsId + sp;
    if (key !== this.skillKey) {
      this.skillKey = key;
      this.skillsEl.innerHTML =
        p.cls.skills.map((id, i) => `<div class="skill" data-cost="${SKILLS[id].cost}" title="${SKILLS[id].name}"><b>${i + 1}</b><span class="kj">${KANJI[id]}</span><i>${SKILLS[id].cost}</i></div>`).join("") +
        `<div class="skill special" data-cost="${SPECIALS[sp].cost}" title="${SPECIALS[sp].name}"><b>V</b><span class="kj">${KANJI[sp]}</span><i>${SPECIALS[sp].cost}</i></div>`;
    }
    for (const el of this.skillsEl.children) el.classList.toggle("dim", p.mana < +el.dataset.cost);
    const st = Object.entries(p.buffs).filter(([k, t]) => t > 0 && STATUS[k]).map(([k, t]) => `<span class="sic ${k}">${STATUS[k]}<i>${Math.ceil(t)}</i></span>`);
    if (bl > 0) st.unshift(`<span class="sic bleed" title="Bleeding — R to cauterize">${STATUS.bleed}<i>${Math.round(bl)}</i></span>`);
    const sh = st.join("");
    if (sh !== this.buffHtml) this.buffsEl.innerHTML = this.buffHtml = sh;
    const drawing = p.state === "draw";
    this.crosshair.classList.toggle("hidden", !(bow && (p.aiming || (drawing && !g.lockTarget))));
    this.crosshair.style.transform = `translate(-50%, -50%) scale(${drawing ? 1.6 - 0.8 * Math.min(1, p.t / 0.85) : 1.4})`;
    this.estus.textContent = p.estus;
    const ok = `${p.estus}/${p.estusMax}`;
    if (ok !== this.orbKey) {
      this.orbKey = ok;
      this.orbs.innerHTML = Array.from({ length: p.estusMax }, (_, i) => `<span class="orb ${i < p.estus ? "" : "spent"}"></span>`).join("");
    }
    this.estus.parentElement.classList.toggle("empty", p.estus === 0);
    this.shownSouls = Math.abs(this.shownSouls - p.souls) < 1 ? p.souls : damp(this.shownSouls, p.souls, 6, dt);
    this.souls.textContent = Math.round(this.shownSouls).toLocaleString();

    const mpEl = document.getElementById("mp-hud");
    if (g.mp) {
      const mp = g.mp;
      const ids = [mp.id, ...mp.peers.keys()];
      const alive = ids.filter((i) => i !== mp.oneId && !mp.dead.has(i)).length;
      mpEl.textContent = `${mp.isOne ? "THE ONE" : "HUNTER"}  ·  ${alive} hunter${alive === 1 ? "" : "s"} standing  ·  code ${mp.code}`;
    }
    mpEl.classList.toggle("hidden", !g.mp);
    const be = this.bossEnemy;
    if (be) {
      // Vitality nodes: the Warden has two lives (phases); a player-One has one.
      const lives = be.isBoss ? 2 : 1;
      const left = be.isBoss ? (be.phase === 2 ? 1 : 2) : be.alive ? 1 : 0;
      const dk = lives + "/" + left;
      if (dk !== this.dotKey) {
        this.dotKey = dk;
        this.bossDots.innerHTML = Array.from({ length: lives }, (_, i) => `<span class="${i < left ? "" : "spent"}"></span>`).join("");
      }
      const f = Math.max(0, be.hp / be.maxHp);
      this.bossFill.style.width = f * 100 + "%";
      this.bossTrailV = damp(this.bossTrailV, f, 2.5, dt);
      this.bossTrail.style.width = this.bossTrailV * 100 + "%";
      this.bossDmg.textContent = be.barT > 0 && be.dmgAccum > 0 ? be.dmgAccum : "";
    }

    const cam = g.camera;
    const W = innerWidth;
    const H = innerHeight;
    const project = (pos, y) => {
      this.v.set(pos.x, pos.y + y, pos.z).project(cam);
      return this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1 ? [((this.v.x + 1) / 2) * W, ((1 - this.v.y) / 2) * H] : null;
    };

    const lt = g.lockTarget;
    const lp = lt && project(lt.pos, 1.1 * lt.T.scale);
    this.lock.classList.toggle("hidden", !lp);
    const ga = p.grappleAim && p.state !== "grapple" && project(p.grappleAim.point, 0);
    this.grappleMark.classList.toggle("hidden", !ga);
    if (ga) this.grappleMark.style.transform = `translate(${ga[0]}px, ${ga[1]}px)`;
    this.lock.classList.toggle("deathblow", !!lt && lt.state === "hit");
    if (lp) this.lock.style.transform = `translate(${lp[0]}px, ${lp[1]}px)`;

    // Floating enemy health bars with accumulated damage numbers.
    const others = g.mp ? [...g.mp.peers.values()] : [];
    for (const e of [...g.enemies, ...others]) {
      let el = this.bars.get(e);
      if (e.isBoss || (e.isRemote && e === this.bossEnemy)) {
        if (el) el.style.display = "none";
        continue;
      }
      const visible = e.alive && e.h.root.visible && (e.isRemote || (g.settings.ebars && (e.barT > 0 || e === lt) && e.hp < e.maxHp));
      const sp = visible && project(e.pos, 2.15 * e.T.scale);
      if (!sp) {
        if (el) el.style.display = "none";
        continue;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "ebar";
        el.innerHTML = `<div class="fill"></div><span></span>`;
        this.floaters.appendChild(el);
        this.bars.set(e, el);
      }
      el.style.display = "block";
      el.style.transform = `translate(${sp[0] - 40}px, ${sp[1]}px)`;
      el.firstChild.style.width = (Math.max(0, e.hp) / e.maxHp) * 100 + "%";
      el.lastChild.textContent = e.isRemote ? e.name + (e.barT > 0 ? `  ${e.dmgAccum}` : "") : e.barT > 0 ? e.dmgAccum : "";
      el.classList.toggle("one", !!e.isRemote && e.team === "one");
    }
  }
}
