// The tabbed in-game menu (Equipment · Inventory · Options), styled after a weathered wooden board,
// plus persistent settings. Also generates the painted textures the CSS uses (wood, brush strokes).
import { SKILLS, SPECIALS } from "./classes.js";

const $ = (id) => document.getElementById(id);
const KEY = "ashen-oath-settings";

export const DEFAULTS = {
  sens: 1, invertY: false, fov: 60, shake: true, ebars: true,
  master: 6, music: 6, bright: 1, shadows: "High", scale: 100, postfx: true, grass: "High",
};

// [setting, label, kind, ...] — kind: num(min,max,step,fmt) | bool | pick(options)
const PAGES = {
  game: {
    title: "Game Options", desc: "Gameplay feedback and on-screen information.",
    rows: [["shake", "Camera Shake", "bool"], ["ebars", "Enemy Health Bars", "bool"]],
  },
  camera: {
    title: "Camera Options", desc: "Adjust how the camera follows and responds.",
    rows: [["sens", "Camera Speed", "num", 0.3, 3, 0.1, (v) => v.toFixed(1)], ["invertY", "Invert Vertical", "bool"], ["fov", "Field of View", "num", 45, 90, 5, (v) => v + "°"]],
  },
  sound: {
    title: "Sound", desc: "Adjust volume levels.",
    rows: [["master", "Master Volume", "num", 0, 10, 1, (v) => v], ["music", "Music Volume", "num", 0, 10, 1, (v) => v]],
  },
  display: {
    title: "Graphics Options", desc: "Visual quality and brightness. Lower settings run faster.",
    rows: [["bright", "Brightness", "num", 0.6, 1.6, 0.1, (v) => v.toFixed(1)], ["shadows", "Shadow Quality", "pick", ["Off", "Low", "High"]], ["scale", "Render Resolution", "num", 50, 100, 10, (v) => v + "%"], ["postfx", "Bloom & Colour Grade", "bool"], ["grass", "Grass Density", "pick", ["Off", "Low", "High"]]],
  },
  controls: { title: "Key Config", desc: "Keyboard and mouse controls (gamepad in brackets)." },
};
const CONTROLS = [
  ["Move", "W A S D  (L-stick)"], ["Camera", "Mouse  (R-stick)"], ["Attack / Draw bow", "Left mouse  (RB)"],
  ["Heavy / Aim bow", "Right mouse  (RT / LT)"], ["Roll · hold to Sprint", "Space  (B)"], ["Jump", "C  (A)"], ["Grappling hook", "G  (LT)"], ["Block", "Shift  (LB)"],
  ["Skills", "1 · 2 · 3  (D-pad)"], ["Special", "V  (L3)"], ["Swap weapon / bow", "F  (Y)"],
  ["Estus · Mana flask", "R · T  (X · D-pad ↓)"], ["Crimson · Azure vial · Rebirth", "4 · 5 · 6"], ["Lock on", "Tab / Q  (R3)"],
  ["Interact", "E  (A)"], ["Inventory", "I  (Select)"], ["Menu", "Esc  (Start)"],
];
const OPTION_LIST = [["game", "Game Options"], ["camera", "Camera Options"], ["sound", "Sound"], ["display", "Graphics Options"], ["controls", "Key Config"]];

function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#5b554c";
  g.fillRect(0, 0, c.width, c.height);
  let x = 0;
  while (x < c.width) {
    const w = 90 + Math.random() * 70;
    const l = 82 + Math.random() * 18;
    g.fillStyle = `rgb(${l},${l - 4},${l - 12})`;
    g.fillRect(x, 0, w, c.height);
    for (let i = 0; i < 70; i++) {
      // grain
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? "30,26,22" : "140,132,120"},${Math.random() * 0.22})`;
      g.lineWidth = 0.5 + Math.random() * 1.6;
      const gx = x + Math.random() * w;
      g.beginPath();
      g.moveTo(gx, 0);
      for (let y = 0; y <= c.height; y += 32) g.lineTo(gx + Math.sin(y * 0.02 + i) * 2.5, y);
      g.stroke();
    }
    g.fillStyle = "rgba(15,12,10,0.75)"; // seam
    g.fillRect(x + w - 2, 0, 2, c.height);
    x += w;
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  return c.toDataURL("image/jpeg", 0.85);
}

// A dry-brush stroke as an SVG (turbulence-displaced shape), usable as a CSS background.
function brush(color, seed, opacity = 1) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 80' preserveAspectRatio='none'>
    <filter id='r' x='-10%' y='-30%' width='120%' height='160%'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.5' numOctaves='3' seed='${seed}'/><feDisplacementMap in='SourceGraphic' scale='26'/></filter>
    <g filter='url(#r)' fill='${color}' fill-opacity='${opacity}'>
      <path d='M22 20 C120 8 280 6 384 14 L396 34 C300 30 200 34 30 40 Z'/>
      <path d='M14 30 C140 22 300 20 390 26 L382 62 C280 70 140 72 20 64 Z'/>
    </g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Square dry-brush tile frame for HUD slots.
function brushTile(seed) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>
    <filter id='r' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='0.06' numOctaves='3' seed='${seed}'/><feDisplacementMap in='SourceGraphic' scale='9'/></filter>
    <g filter='url(#r)'><rect x='8' y='8' width='84' height='84' fill='#0d0b09' fill-opacity='0.78'/>
    <rect x='8' y='8' width='84' height='84' fill='none' stroke='#d8c6a6' stroke-opacity='0.55' stroke-width='2'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Resurrection-node style orb with a three-comma swirl.
function tomoe(spent) {
  const fill = spent ? "#2a2220" : "url(#g)";
  const ink = spent ? "#6a605a" : "#ffe6ec";
  const heads = [0, 120, 240]
    .map((a) => {
      const r = (a * Math.PI) / 180;
      const hx = 50 + Math.cos(r) * 13, hy = 50 + Math.sin(r) * 13;
      const t = r + 1.5;
      const tx = 50 + Math.cos(t) * 25, ty = 50 + Math.sin(t) * 25;
      return `<circle cx='${hx.toFixed(1)}' cy='${hy.toFixed(1)}' r='8' fill='${ink}'/><path d='M${hx.toFixed(1)} ${hy.toFixed(1)} A20 20 0 0 1 ${tx.toFixed(1)} ${ty.toFixed(1)}' stroke='${ink}' stroke-width='5' fill='none' stroke-linecap='round'/>`;
    })
    .join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
    <defs><radialGradient id='g' cx='45%' cy='40%'><stop offset='0' stop-color='#ff9ab4'/><stop offset='0.6' stop-color='#d63a6a'/><stop offset='1' stop-color='#6a0c26'/></radialGradient></defs>
    <circle cx='50' cy='50' r='46' fill='#0a0606' fill-opacity='0.7'/>
    <circle cx='50' cy='50' r='40' fill='${fill}' stroke='${spent ? "#5a504a" : "#fff0f4"}' stroke-width='3'/>${heads}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function installTheme() {
  const r = document.documentElement.style;
  r.setProperty("--brush-tile", brushTile(5));
  r.setProperty("--tomoe", tomoe(false));
  r.setProperty("--tomoe-spent", tomoe(true));
  r.setProperty("--wood", `url(${woodTexture()})`);
  r.setProperty("--brush-dark", brush("#15120f", 3, 0.88));
  r.setProperty("--brush-orange", brush("#e8711c", 7));
  r.setProperty("--brush-red", brush("#a3141c", 11, 0.9));
  // Ornamental corners on every board-style panel.
  for (const p of document.querySelectorAll(".panel")) for (const k of ["tl", "tr", "bl", "br"]) p.insertAdjacentHTML("beforeend", `<i class="cn ${k}"></i>`);
}

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.tab = "options";
    this.page = "game";
    this.fromTitle = false;
    document.querySelectorAll("#menu-tabs button").forEach((b) => (b.onclick = () => this.show(b.dataset.tab)));
    $("menu-prev").onclick = () => this.cycle(-1);
    $("menu-next").onclick = () => this.cycle(1);
  }

  cycle(d) {
    const tabs = this.fromTitle ? ["options"] : ["equipment", "inventory", "options"];
    const i = tabs.indexOf(this.tab);
    this.show(tabs[(i + d + tabs.length) % tabs.length]);
  }

  show(tab) {
    if (this.fromTitle && tab !== "options") return;
    this.tab = tab;
    document.querySelectorAll("#menu-tabs button").forEach((b) => {
      b.classList.toggle("on", b.dataset.tab === tab);
      b.classList.toggle("off", this.fromTitle && b.dataset.tab !== "options");
    });
    for (const t of ["equipment", "inventory", "options"]) $("tab-" + t).classList.toggle("hidden", t !== tab);
    if (tab === "equipment") this.renderEquipment();
    if (tab === "inventory") this.game.renderInventory();
    if (tab === "options") this.renderOptions();
    $("menu-desc").textContent = { equipment: "Your path, your blade and your strengths.", inventory: "Items carried. Select one to inspect or use it.", options: PAGES[this.page]?.desc || "" }[tab];
  }

  renderEquipment() {
    const p = this.game.player;
    const c = p.cls;
    const st = p.stats;
    const row = (k, v) => `<div class="plank"><span>${k}</span><b>${v}</b></div>`;
    $("tab-equipment").innerHTML = `
      <div class="eq-col">
        <div class="eq-head">${c.name}</div>
        ${row("Level", p.level)}${row("Weapon", p.weaponName)}${row("Bow", `${p.arrows} / ${p.arrowsMax} arrows`)}
        ${row("Vigor", st.vig)}${row("Endurance", st.end)}${row("Strength", st.str)}${row("Arcane", st.arc)}
      </div>
      <div class="eq-col">
        <div class="eq-head">Attributes</div>
        ${row("Vitality", `${Math.ceil(p.hp)} / ${p.maxHp}`)}${row("Stamina", p.maxSta)}${row("Mana", `${Math.round(p.mana)} / ${p.maxMana}`)}
        ${row("Attack Power", Math.round(42 * p.outMul))}${row("Spell Power", Math.round(p.spellMul * 100) + "%")}
        <div class="eq-note"><b>Passive</b> ${c.passive}</div>
        <div class="eq-note"><b>Skills</b> ${c.skills.map((s) => SKILLS[s].name).join(" · ")} &nbsp; <b>Special</b> ${SPECIALS[c.special].name}</div>
      </div>`;
  }

  renderOptions() {
    const s = this.game.settings;
    $("opt-list").innerHTML =
      OPTION_LIST.map(([id, name]) => `<button class="brush ${id === this.page ? "on" : ""}" data-page="${id}">${name}</button>`).join("") +
      `<button class="brush" data-act="resume">${this.fromTitle ? "Back" : "Return to Game"}</button>` +
      (this.fromTitle ? "" : `<button class="brush" data-act="quit">${this.game.mp ? "Leave Match" : "Quit to Title"}</button>`);
    $("opt-list").querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.page) {
            this.page = b.dataset.page;
            this.show("options");
          } else if (b.dataset.act === "resume") this.game.closeMenu();
          else this.game.quitFromMenu();
        }),
    );
    const page = PAGES[this.page];
    if (this.page === "controls") {
      $("opt-body").innerHTML = `<div class="opt-title">${page.title}</div><div class="ctl-grid">${CONTROLS.map(([a, k]) => `<div class="plank"><span>${a}</span><b>${k}</b></div>`).join("")}</div>`;
      return;
    }
    $("opt-body").innerHTML =
      `<div class="opt-title">${page.title}</div>` +
      page.rows
        .map(([key, label, kind, a, b, step, fmt]) => {
          const v = s[key];
          const shown = kind === "bool" ? (v ? "On" : "Off") : kind === "pick" ? v : fmt(v);
          return `<div class="plank opt"><span>${label}</span><div class="val"><button data-k="${key}" data-d="-1">◀</button><b>${shown}</b><button data-k="${key}" data-d="1">▶</button></div></div>`;
        })
        .join("");
    $("opt-body").querySelectorAll("button[data-k]").forEach(
      (btn) =>
        (btn.onclick = () => {
          const [key, , kind, a, b, step] = page.rows.find((r) => r[0] === btn.dataset.k);
          const d = +btn.dataset.d;
          if (kind === "bool") s[key] = !s[key];
          else if (kind === "pick") s[key] = a[(a.indexOf(s[key]) + d + a.length) % a.length];
          else s[key] = Math.round(Math.min(b, Math.max(a, s[key] + d * step)) * 100) / 100;
          this.save();
          this.game.applySettings();
          this.renderOptions();
        }),
    );
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.game.settings));
    } catch {
      /* settings last this session only */
    }
  }
}
