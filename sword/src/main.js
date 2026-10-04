import * as THREE from "three";
import { Sfx } from "./audio.js";
import { Input } from "./input.js";
import { Particles, Trail } from "./particles.js";
import { Gore } from "./gore.js";
import { Arrows } from "./archery.js";
import { Multiplayer } from "./mp.js";
import { Spells } from "./spells.js";
import { Loot, ITEMS } from "./loot.js";
import { Menu, installTheme, loadSettings } from "./menu.js";
import { Merchant } from "./merchant.js";
import { CLASSES, CLASS_IDS, SKILLS, SPECIALS } from "./classes.js";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Enemy } from "./enemy.js";
import { CameraRig } from "./camera.js";
import { Hud } from "./hud.js";
import { loadAssets } from "./assets.js";
import { angleTo, distXZ, rand, wrapAngle } from "./util.js";

const SAVE_KEY = "ashen-oath-save";
const $ = (id) => document.getElementById(id);

function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

class Game {
  constructor(assets) {
    this.assets = assets;
    const canvas = $("game");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    // Daytime: the sky dome (world.js) paints the background; haze matches its horizon.
    this.scene.background = new THREE.Color(0xc4d2de);
    this.scene.fog = new THREE.FogExp2(0xc4d2de, 0.0085);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

    this.audio = new Sfx();
    this.input = new Input(canvas);
    this.particles = new Particles(this.scene);
    this.blood = new Particles(this.scene, THREE.NormalBlending);
    this.world = new World(this);
    this.gore = new Gore(this);
    this.spells = new Spells(this);
    this.loot = new Loot(this);
    this.merchant = new Merchant(this, -11.6, -3, Math.PI / 2);
    this.arrows = new Arrows(this, assets?.bow);
    this.player = new Player(this);
    this.enemies = this.world.spawns.map((s) => new Enemy(this, s));
    this.boss = this.enemies.find((e) => e.isBoss);
    this.rig = new CameraRig(this.camera, this.world);
    this.hud = new Hud(this);
    this.playerTrail = new Trail(this.scene, 0xff2a1a);
    this.bossTrail = new Trail(this.scene, 0xff7a30);

    this.state = "title";
    this.time = 0;
    this.hitstop = 0;
    this.fx = [];
    this.lockTarget = null;
    this.lockSwitchAcc = 0;
    this.deathT = -1;
    this.bossFight = false;
    this.bossDefeated = false;
    this.bloodstain = null;
    this.bloodMesh = this.makeBloodstain();
    this.lastBonfire = "b1";
    this.mp = null;
    this.mpMenu = false;

    installTheme();
    this.settings = loadSettings();
    this.menu = new Menu(this);
    this.wireUi();
    this.applySettings();
    addEventListener("resize", () => this.resize());
    this.resize();
    this.applySave(loadSave());
    $("continue-btn").classList.toggle("hidden", !loadSave());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Persistence ─────────────────────────────────────────────────────────
  applySave(s) {
    const p = this.player;
    this.world.bonfires.forEach((b) => b.setLit(b.id === "b1"));
    p.stats = { vig: 10, end: 10, str: 10, arc: 10 };
    p.souls = 0;
    this.bossDefeated = false;
    this.bloodstain = null;
    this.lastBonfire = "b1";
    p.applyClass(s?.cls || this.pendingClass || "warrior", !s);
    p.inv = { hpvial: 0, mpvial: 0, regrow: s ? 0 : 1, ...(s?.inv || {}) };
    p.estusMax = Math.min(8, s?.estusMax ?? 4);
    if (s) {
      Object.assign(p.stats, s.stats);
      p.souls = s.souls ?? 0;
      this.bossDefeated = !!s.bossDefeated;
      this.bloodstain = s.bloodstain ?? null;
      this.lastBonfire = s.bonfire ?? "b1";
      this.world.bonfires.forEach((b) => b.setLit(b.id === "b1" || (s.lit ?? []).includes(b.id)));
    }
    p.recompute();
    this.resetWorld();
    this.respawnPlayer();
    p.arrows = Math.max(30, Math.min(p.arrowsMax, s?.arrows ?? 30));
  }

  save() {
    const p = this.player;
    const data = {
      cls: p.clsId,
      estusMax: p.estusMax,
      inv: p.inv,
      arrows: p.arrows,
      stats: p.stats,
      souls: p.souls,
      bossDefeated: this.bossDefeated,
      bloodstain: this.bloodstain,
      bonfire: this.lastBonfire,
      lit: this.world.bonfires.filter((b) => b.lit).map((b) => b.id),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: progress lasts for this session only */
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  wireUi() {
    const startPlay = () => {
      this.audio.init();
      this.input.requestLock();
      this.showScreen(null);
      this.hud.show(true);
      this.state = "playing";
      this.rig.snapBehind(this.player);
      this.last = performance.now();
    };
    // New Game → pick a class → play.
    const card = (id) => {
      const c = CLASSES[id];
      const st = c.stats;
      return `<button class="class-card" data-class="${id}"><h3>${c.name}</h3><div class="blurb">${c.blurb}</div>
        <div class="meta"><b>Passive</b> ${c.passive}</div>
        <div class="meta"><b>Skills</b> ${c.skills.map((s) => SKILLS[s].name).join(" · ")}</div>
        <div class="meta"><b>Special</b> ${SPECIALS[c.special].name}</div>
        <div class="meta"><b>Stats</b> VIG ${st.vig} · END ${st.end} · STR ${st.str} · ARC ${st.arc}</div></button>`;
    };
    $("class-cards").innerHTML = CLASS_IDS.map(card).join("");
    $("new-btn").onclick = () => this.showScreen("classes");
    $("classes-back").onclick = () => this.showScreen("title");
    document.querySelectorAll(".class-card").forEach(
      (b) =>
        (b.onclick = () => {
          try {
            localStorage.removeItem(SAVE_KEY);
          } catch {
            /* ignore */
          }
          this.pendingClass = b.dataset.class;
          this.applySave(null);
          startPlay();
          setTimeout(() => this.hud.showBanner(CLASSES[b.dataset.class].name.toUpperCase(), "lit", 3200), 300);
        }),
    );
    $("continue-btn").onclick = () => {
      this.applySave(loadSave());
      startPlay();
    };

    // ── Multiplayer lobby ──
    const nameField = $("mp-name");
    try {
      nameField.value = localStorage.getItem("ashen-oath-name") || "";
    } catch {
      /* ignore */
    }
    const playerName = () => {
      const n = nameField.value.trim() || "Ashen";
      try {
        localStorage.setItem("ashen-oath-name", n);
      } catch {
        /* ignore */
      }
      return n;
    };
    const status = (t) => ($("mp-status").textContent = t);
    try {
      this.mpClass = localStorage.getItem("ashen-oath-class") || "warrior";
    } catch {
      this.mpClass = "warrior";
    }
    const drawClassRow = () => {
      $("mp-classes").innerHTML = CLASS_IDS.map((id) => `<button data-c="${id}" class="${id === this.mpClass ? "on" : ""}">${CLASSES[id].name}</button>`).join("");
      $("mp-classes").querySelectorAll("button").forEach(
        (b) =>
          (b.onclick = () => {
            this.mpClass = b.dataset.c;
            try {
              localStorage.setItem("ashen-oath-class", this.mpClass);
            } catch {
              /* ignore */
            }
            drawClassRow();
          }),
      );
    };
    drawClassRow();
    $("mp-btn").onclick = () => {
      this.audio.init();
      status("");
      $("mp-room").classList.add("hidden");
      $("mp-entry").classList.remove("hidden");
      this.showScreen("mp");
    };
    $("mp-back").onclick = () => {
      if (this.mp) this.leaveMp();
      else this.showScreen("title");
    };
    const enter = async (fn) => {
      status("Connecting…");
      this.mp = new Multiplayer(this);
      this.mp.onLobby = () => this.refreshLobby();
      try {
        await fn(this.mp);
        status("");
        $("mp-entry").classList.add("hidden");
        $("mp-room").classList.remove("hidden");
        this.refreshLobby();
        if (!this.mp.isHost) {
          this.enterArena();
          this.showScreen(null);
          this.hud.toast("Waiting for the One to begin the hunt…", 4000);
        }
      } catch (e) {
        this.mp.leave();
        this.mp = null;
        status(e.message);
      }
    };
    $("mp-host").onclick = () => enter((mp) => mp.host(playerName()));
    $("mp-join").onclick = () => {
      const code = $("mp-code").value.trim().toUpperCase();
      if (code.length !== 4) return status("Codes are 4 letters");
      enter((mp) => mp.join(code, playerName()));
    };
    $("mp-code").addEventListener("keydown", (e) => e.key === "Enter" && $("mp-join").click());
    $("mp-start").onclick = () => {
      this.enterArena();
      this.mp.hostStartRound();
    };
    $("controls-btn").onclick = () => this.openMenu("options");
    $("leave-btn").onclick = () => this.leaveBonfire();
    document.querySelectorAll("[data-stat]").forEach((b) => (b.onclick = () => this.levelUp(b.dataset.stat)));

    $("game").addEventListener("click", () => {
      if (this.state === "playing" && !document.pointerLockElement) this.input.requestLock();
    });
    document.addEventListener("pointerlockchange", () => {
      // A lock granted after we already left gameplay (e.g. straight to the title) would trap the mouse.
      if (document.pointerLockElement && (this.state !== "playing" || this.mpMenu)) document.exitPointerLock();
      if (!document.pointerLockElement && this.state === "playing" && this.input.lockWanted !== false) this.pause();
    });
  }

  // The board menu. In single player it pauses; in a match it overlays live play.
  openMenu(tab = "options") {
    this.menu.fromTitle = this.state === "title";
    if (!this.menu.fromTitle) {
      if (this.mp) this.mpMenu = true;
      else if (this.state === "playing") this.state = "paused";
    }
    this.input.lockWanted = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.showScreen("menu");
    this.menu.show(tab);
  }

  closeMenu() {
    if (this.menu.fromTitle) return this.showScreen("title");
    this.showScreen(null);
    if (this.state === "paused") this.state = "playing";
    this.mpMenu = false;
    this.input.lockWanted = true;
    this.input.requestLock();
    this.last = performance.now();
  }

  quitFromMenu() {
    if (this.mp) return this.leaveMp();
    this.save();
    this.audio.stopMusic();
    this.toTitle();
  }

  // Ozrael's shop: pauses like a bonfire.
  openShop() {
    this.state = "shop";
    this.hud.setPrompt(null);
    this.player.vel.set(0, 0, 0);
    this.input.lockWanted = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.showScreen("shop");
    this.merchant.open();
  }

  closeShop() {
    this.showScreen(null);
    this.state = "playing";
    this.input.lockWanted = true;
    this.input.requestLock();
    this.last = performance.now();
  }

  toggleInventory() {
    if (this.screen === "menu" && this.menu.tab === "inventory") this.closeMenu();
    else this.openMenu("inventory");
  }

  applySettings() {
    const s = this.settings;
    this.input.sens = s.sens;
    this.input.invertY = s.invertY;
    this.rig.baseFov = s.fov;
    this.audio.volume = s.master / 10;
    this.audio.musicVolume = s.music / 10;
    this.audio.applyVolume?.();
    this.renderer.toneMappingExposure = s.bright;
    const shadows = s.shadows !== "Off";
    const size = s.shadows === "Low" ? 1024 : 2048;
    const moon = this.world.moon;
    if (this.renderer.shadowMap.enabled !== shadows || moon.shadow.mapSize.x !== size) {
      this.renderer.shadowMap.enabled = shadows;
      moon.castShadow = shadows;
      moon.shadow.mapSize.set(size, size);
      moon.shadow.map?.dispose();
      moon.shadow.map = null;
      this.scene.traverse((o) => o.material && ([].concat(o.material).forEach((m) => (m.needsUpdate = true))));
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * (s.scale / 100));
    this.resize();
  }

  renderInventory(sel = this.invSel || "hpvial") {
    const p = this.player;
    this.invSel = sel;
    const flask = (cls, n) => `<span class="ic ${cls}"></span>${n}`;
    $("inv-equip").innerHTML = `
      <div class="inv-row"><span>Class</span><b>${p.cls.name}</b></div>
      <div class="inv-row"><span>Weapon</span><b>${p.weaponName}</b></div>
      <div class="inv-row"><span>Bow</span><b>${p.arrows} / ${p.arrowsMax} arrows</b></div>
      <div class="inv-row"><span>Estus</span><b>${flask("estus", `${p.estus} / ${p.estusMax}`)}</b></div>
      <div class="inv-row"><span>Mana flasks</span><b>${flask("mana", `${p.manaFlasks} / ${p.manaFlaskMax}`)}</b></div>
      <div class="inv-row"><span>Souls</span><b>${p.souls.toLocaleString()}</b></div>`;
    const cells = [
      ...Object.entries(ITEMS).map(([id, it]) => ({ id, name: it.name, n: p.inv[id] || 0, cls: id })),
      { id: "arrows", name: "Arrows", n: p.arrows, cls: "arrows" },
    ];
    $("inv-grid").innerHTML = cells
      .map((c) => `<button class="inv-cell ${c.id === sel ? "sel" : ""} ${c.n ? "" : "empty"}" data-id="${c.id}"><span class="ic big ${c.cls}"></span><i>${c.n}</i><small>${c.name}</small></button>`)
      .join("");
    $("inv-grid").querySelectorAll(".inv-cell").forEach((b) => (b.onclick = () => this.renderInventory(b.dataset.id)));
    const it = ITEMS[sel];
    $("inv-detail").innerHTML = it
      ? `<h3>${it.name}</h3><p>${it.desc}</p><div class="hint">Quick use in battle: key ${it.key}</div>`
      : `<h3>Arrows</h3><p>Ammunition for your bow. Walk over spent arrows to pull them free; bonfires top the quiver up to 30.</p>`;
    const use = $("inv-use");
    use.classList.toggle("hidden", !it);
    use.disabled = !it || !p.inv[sel];
    use.onclick = () => {
      this.closeMenu();
      p.buffer = { a: "item", i: sel, t: 0.6 };
    };
  }

  refreshLobby() {
    const mp = this.mp;
    if (!mp) return;
    $("mp-code-show").textContent = mp.code;
    const names = [`${mp.name}${mp.isHost ? " (the One)" : ""} — you`, ...[...mp.peers.values()].map((p) => p.name + (p.peerId === mp.hostId ? " (the One)" : ""))];
    $("mp-players").innerHTML = names.map((n) => `<li>${n.replace(/[<>&]/g, "")}</li>`).join("");
    $("mp-start").classList.toggle("hidden", !mp.isHost || mp.round > 0);
    $("mp-wait").classList.toggle("hidden", mp.isHost || mp.round > 0);
    $("mp-wait").textContent = "Waiting for the One to begin the hunt…";
  }

  // Into the Warden's arena: no AI, gate sealed, the match HUD on.
  enterArena() {
    for (const e of this.enemies) {
      e.alive = false;
      e.h.root.visible = false;
    }
    this.bossFight = false;
    this.hud.setBoss(null);
    this.world.setFog(true);
    this.bloodMesh.visible = false;
    this.arrows.clear();
    this.lockTarget = null;
    // Matches use each class's base stats so nobody brings an over-levelled save.
    this.player.applyClass(this.mpClass || "warrior", true);
    this.player.spawnAt(new THREE.Vector3(0, 0, -106), Math.PI);
    this.state = "playing";
    this.hud.show(true);
    this.audio.init();
    this.input.lockWanted = true;
    this.input.requestLock();
    this.last = performance.now();
  }

  // Round start (from mp.js): respawn, team colours, and the One's health scales with the hunt.
  mpSpawn([x, z, f], isOne, hunters) {
    const p = this.player;
    p.hpMul = isOne ? 1 + 0.75 * Math.max(1, hunters) : 1;
    p.recompute();
    this.arrows.clear();
    p.spawnAt(new THREE.Vector3(x, 0, z), f);
    p.refillArrows();
    p.h.setTint(isOne ? 0xff8a8a : 0xffffff, isOne ? 0x2a0000 : 0x000000);
    this.lockTarget = null;
    this.mpMenu = false;
    this.showScreen(null);
    this.hud.setBoss(isOne ? null : this.mp.peers.get(this.mp.oneId) || null);
    this.hud.showBanner(isOne ? "YOU ARE THE ONE" : "HUNT THE ONE", "lit", 2600);
    this.audio.startMusic();
    this.refreshLobby();
  }

  leaveMp() {
    this.mp?.leave();
    this.mp = null;
    this.mpMenu = false;
    this.audio.stopMusic();
    this.player.hpMul = 1;
    this.player.h.setTint(0xffffff);
    this.applySave(loadSave());
    this.toTitle();
  }

  onMpClosed(msg) {
    if (!this.mp) return;
    this.leaveMp();
    this.hud.toast(msg, 4000);
  }

  showScreen(id, prev = null) {
    this.prevScreen = prev;
    this.screen = id;
    for (const s of document.querySelectorAll(".screen")) s.classList.toggle("hidden", s.id !== id);
  }

  toTitle() {
    this.state = "title";
    this.hud.show(false);
    this.lockTarget = null;
    $("continue-btn").classList.toggle("hidden", !loadSave());
    this.showScreen("title");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  pause() {
    if (this.state !== "playing" || this.screen === "menu") return;
    this.openMenu("options");
  }

  // ── World state ─────────────────────────────────────────────────────────
  resetWorld() {
    for (const e of this.enemies.filter((x) => x.ally)) this.removeEnemy(e);
    for (const e of this.enemies) {
      e.reset();
      if (e.isBoss && this.bossDefeated) {
        e.alive = false;
        e.h.root.visible = false;
      }
    }
    this.bossFight = false;
    this.arrows.clear();
    this.loot.clear();
    this.world.setFog(!this.bossDefeated);
    this.hud.setBoss(null);
    this.lockTarget = null;
    this.updateBloodMesh();
  }

  bonfireById(id) {
    return this.world.bonfires.find((b) => b.id === id) || this.world.bonfires[0];
  }

  respawnPlayer() {
    const b = this.bonfireById(this.lastBonfire);
    this.player.spawnAt(b.pos.clone().add(new THREE.Vector3(0, 0, -2.8)), Math.PI);
    this.rig.snapBehind(this.player);
  }

  makeBloodstain() {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x40ff90, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  updateBloodMesh() {
    const b = this.bloodstain;
    this.bloodMesh.visible = !!b;
    if (b) this.bloodMesh.position.set(b.x, this.world.heightAt(b.x, b.z) + 0.35, b.z);
  }

  shake(v) {
    if (this.settings && !this.settings.shake) return;
    this.rig.shake = Math.max(this.rig.shake, v);
  }

  // Expanding fire ring on the ground; damages the player once if they're inside and not rolling.
  // Expanding ground ring (purely visual).
  ring(center, radius, color = 0xff6a20, dur = 0.35) {
    const geo = new THREE.RingGeometry(0.8, 1, 48);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, this.world.heightAt(center.x, center.z) + 0.08, center.z);
    this.scene.add(ring);
    let t = 0;
    this.fx.push((dt) => {
      t += dt;
      const u = Math.min(1, t / dur);
      ring.scale.setScalar(0.5 + u * radius);
      mat.opacity = 0.9 * (1 - u);
      if (u >= 1) {
        this.scene.remove(ring);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
  }

  // Damage from the player's skills to any foe (AI enemy or another player).
  damageFoe(f, dmg, poise, from, kd = false) {
    const p = this.player;
    dmg = Math.round(dmg);
    p.reveal();
    if (f.isRemote) {
      if (f.invuln) return;
      this.mp.send({ t: "hit", to: f.peerId, magic: true, dmg, kd, from: [from.x, from.z] }, f.peerId);
      f.dmgAccum = (f.barT > 0 ? f.dmgAccum : 0) + dmg;
      f.barT = 3.5;
    } else f.receiveHit(dmg, poise, p);
    const at = f.pos.clone().setY(f.pos.y + 1.1 * f.T.scale);
    this.blood.burst(at, 16, { speed: 3.5, life: 0.6, size: 0.08 * f.T.scale, color: [0.4, 0.01, 0.01], grav: 12, drag: 0.5 });
    this.hitstop = Math.max(this.hitstop, 0.04);
  }

  playerBlast(c, r, dmg) {
    for (const f of this.foes()) {
      if (!f.alive || !f.h.root.visible || (f.isBoss && !f.active)) continue;
      if (Math.hypot(f.pos.x - c.x, f.pos.z - c.z) < r + f.radius) this.damageFoe(f, dmg, 70, c, true);
    }
  }

  shockwave(center, radius, dmg, attacker, fiery = false) {
    this.ring(center, radius);
    for (let i = 0; i < (fiery ? 160 : 60); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.particles.emit(center.x + Math.cos(a) * r, 0.1, center.z + Math.sin(a) * r, Math.cos(a) * 2, 1 + Math.random() * (fiery ? 5 : 2), Math.sin(a) * 2, 0.6 + Math.random() * 0.5, 0.25 + Math.random() * 0.35, 1, 0.4 + Math.random() * 0.2, 0.08, 0.8, 1, 1);
    }
    this.audio.boom();
    this.shake(fiery ? 1.2 : 0.7);
    const p = this.player;
    if (p.alive && !p.invulnerable() && distXZ(p.pos, center) < radius + p.radius) this.hitPlayer(attacker, dmg, { knockdown: true, unblockable: fiery });
  }

  // ── Combat ──────────────────────────────────────────────────────────────
  processAttack(att, targets) {
    const def = att.attack;
    const t = att.t * (att.speedMul || 1);
    def.hits.forEach(([t0, t1, mul = 1], i) => {
      if (t < t0 || t > t1) return;
      for (const tg of targets) {
        if (!tg.alive) continue;
        const key = i + ":" + tg.id;
        if (att.hitSet.has(key)) continue;
        const d = distXZ(att.pos, tg.pos);
        if (d > def.range * (att.rangeMul ?? 1) + tg.radius) continue;
        const ang = Math.abs(wrapAngle(angleTo(att.pos, tg.pos) - att.facing));
        if (ang > def.arcRad / 2 && d > att.radius + tg.radius + 0.35) continue;
        if (Math.abs(att.yOff - tg.yOff) > 2.5) continue;
        att.hitSet.add(key);
        if (tg.isRemote) this.hitRemote(att, tg, def, mul);
        else if (tg.isPlayer) {
          if (tg.invulnerable()) continue;
          this.hitPlayer(att, def.dmg * mul, { knockdown: def.knockdown || (att.isBoss && def.dmg >= 150), style: def.style });
        } else this.hitEnemy(att, tg, def, mul);
      }
    });
  }

  foes() {
    return this.mp ? this.mp.foes() : this.enemies.filter((e) => !e.ally);
  }

  // Our blade found another player: show the hit now, let their game decide what it really did.
  hitRemote(p, r, def, mul) {
    if (r.invuln) return;
    const behind = (p.isPlayer && p.forceCrit) || (Math.abs(wrapAngle(angleTo(r.pos, p.pos) - r.facing)) > 2.3 && r.state !== "attack");
    const dmg = Math.round(def.dmg * mul * (p.outMul ?? 1) * (behind ? p.cls?.crit ?? 1.6 : 1));
    const bl = p.isPlayer ? p.onDealtMelee(dmg) : 0;
    this.mp.send({ t: "hit", to: r.peerId, dmg, kd: !!def.knockdown, style: def.style, part: this.pickPart(r, def.style), bl, from: [p.pos.x, p.pos.z] }, r.peerId);
    r.dmgAccum = (r.barT > 0 ? r.dmgAccum : 0) + dmg;
    r.barT = 3.5;
    const at = this.hitPoint(p, r);
    this.blood.burst(at, 30, { speed: 4.5, life: 0.8, size: 0.09, color: [0.4, 0.01, 0.01], a: 1, grav: 12, drag: 0.5 });
    this.audio.flesh();
    this.hitstop = def.heavy ? 0.11 : 0.065;
    this.shake(def.heavy ? 0.35 : 0.18);
    if (behind) this.hud.toast("Critical hit", 900);
  }

  // Another player says they hit us. We honour our own rolls and blocks.
  onNetHit(d, from) {
    const p = this.player;
    if (!p.alive || p.invulnerable()) return;
    const att = { pos: new THREE.Vector3(d.from[0], 0, d.from[1]), isBoss: false };
    if (d.magic) {
      const res = p.receiveHit(Math.round(d.dmg), att, { knockdown: d.kd });
      if (res === "hit" || res === "dead") {
        this.blood.burst(p.pos.clone().setY(p.pos.y + 1.2), 16, { speed: 3, life: 0.6, size: 0.08, color: [0.4, 0.01, 0.01], grav: 12 });
        this.audio.hit(d.dmg > 100);
        this.shake(0.4);
      }
      return;
    }
    if (d.bl) p.bleed += d.bl * p.T.bleedMul;
    if (d.arrow) {
      const dmg = d.part === "head" ? d.dmg * 3 : d.dmg;
      const res = p.receiveHit(Math.round(dmg), att, { unblockable: false });
      if (res === "hit" || res === "dead") {
        p.bleed += d.part === "head" ? 6 : 5;
        p.h.addWound(true);
        this.mp.send({ t: "cut", part: "torso", front: true });
        this.blood.burst(p.pos.clone().setY(1.2), 20, { speed: 3, life: 0.6, size: 0.08, color: [0.4, 0.01, 0.01], grav: 12 });
        this.audio.flesh();
        if (d.part === "head") this.hud.toast("Headshot", 900);
      }
      return;
    }
    this.hitPlayer(att, d.dmg, { knockdown: d.kd, style: d.style, part: d.part });
  }

  // Replay a cut another player suffered so the same limb comes off here.
  onNetCut(r, d) {
    if (d.part === "torso") return void r.h.addWound(d.front);
    if (r.h.severed.has(d.part)) return;
    this.cut(r, { pos: r.pos.clone().add(new THREE.Vector3(Math.sin(r.facing), 0, Math.cos(r.facing))) }, null, 0, d.part, d.j);
  }

  hitPoint(a, b) {
    return new THREE.Vector3((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2 + 1.2 * (b.T ? b.T.scale : 1), (a.pos.z + b.pos.z) / 2);
  }

  // Roaming enemies of the endless wilds come and go with terrain chunks.
  spawnEnemy(spec) {
    const e = new Enemy(this, spec);
    this.enemies.push(e);
    return e;
  }

  removeEnemy(e) {
    if (this.lockTarget === e) this.lockTarget = null;
    e.dispose();
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.hud.bars.get(e)?.remove();
    this.hud.bars.delete(e);
  }

  hitEnemy(p, e, def, mul) {
    const behind = (p.isPlayer && p.forceCrit && !e.isBoss) || (Math.abs(wrapAngle(angleTo(e.pos, p.pos) - e.facing)) > 2.3 && e.state !== "attack" && !e.isBoss);
    const dmg = def.dmg * mul * (p.outMul ?? 1) * (behind ? p.cls?.crit ?? 1.6 : 1);
    const guarded = e.receiveHit(dmg, def.poise, p);
    if (!guarded && p.isPlayer) e.bleed += p.onDealtMelee(dmg) * e.T.bleedMul;
    const at = this.hitPoint(p, e);
    if (guarded) {
      this.particles.burst(at, 24, { speed: 6, life: 0.35, size: 0.06, color: [1, 0.85, 0.5], grav: 12 });
      this.audio.block();
      this.hitstop = 0.05;
      p.vel.addScaledVector(p.forward(), -3);
    } else {
      this.blood.burst(at, 30, { speed: 4.5, life: 0.8, size: 0.09, color: [0.4, 0.01, 0.01], a: 1, grav: 12, drag: 0.5 });
      this.particles.burst(at, 8, { speed: 5, life: 0.25, size: 0.06, color: [1, 0.9, 0.7], grav: 10 });
      this.audio.flesh();
      this.cut(e, p, def.style, dmg);
      this.hitstop = def.heavy ? 0.11 : 0.065;
      this.shake(def.heavy ? 0.35 : 0.18);
      if (behind && p.isPlayer) this.hud.toast("Critical hit", 900);
    }
  }

  hitPlayer(att, dmg, opts = {}) {
    const p = this.player;
    const res = p.receiveHit(Math.round(dmg), att, opts);
    const at = this.hitPoint(att, p);
    if (res === "blocked" || res === "guardbreak") {
      this.particles.burst(at, 30, { speed: 6, life: 0.35, size: 0.07, color: [1, 0.85, 0.5], grav: 12 });
      this.audio.block();
      this.hitstop = 0.06;
      this.shake(0.25);
      if (res === "guardbreak") this.hud.toast("Guard broken", 900);
    } else {
      this.blood.burst(at, 34, { speed: 4.5, life: 0.8, size: 0.1, color: [0.4, 0.01, 0.01], grav: 12, drag: 0.5 });
      this.audio.hit(dmg > 120);
      if (opts.style) this.cut(p, att, opts.style, dmg, opts.part ?? null);
      this.hitstop = 0.09;
      this.shake(dmg > 120 ? 0.75 : 0.4);
    }
  }

  // ── Archery ─────────────────────────────────────────────────────────────
  // Where the archer is aiming: the crosshair while aiming, else the lock-on target, else straight ahead.
  aimPoint() {
    const p = this.player;
    const lt = this.lockTarget;
    if (lt && !p.aiming) return lt.pos.clone().add(new THREE.Vector3(0, 1.25 * lt.T.scale + lt.yOff, 0));
    if (!p.aiming) return p.pos.clone().add(p.forward().multiplyScalar(40)).add(new THREE.Vector3(0, 1.5, 0));
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    let best = 80;
    const ray = new THREE.Ray(origin, dir);
    const hit = new THREE.Vector3();
    for (const e of this.foes()) {
      if (!e.alive || !e.h.root.visible) continue;
      const s = e.T.scale;
      for (const [y, r] of [[1.6, 0.16], [1.2, 0.3], [0.6, 0.25]]) {
        const sphere = new THREE.Sphere(e.pos.clone().add(new THREE.Vector3(0, y * s + e.yOff, 0)), r * s);
        if (ray.intersectSphere(sphere, hit)) best = Math.min(best, hit.distanceTo(origin));
      }
    }
    this.rig.ray.set(origin, dir);
    this.rig.ray.far = best;
    const w = this.rig.ray.intersectObjects(this.world.cameraMeshes, false)[0];
    if (w) best = Math.min(best, w.distance);
    return origin.addScaledVector(dir, Math.max(2.5, best));
  }

  // Arrows pierce rather than cut: they lodge in the body part they hit and bleed it.
  arrowHit(e, point, dir, arrow) {
    const p = this.player;
    const s = e.T.scale;
    const y = (point.y - e.pos.y - e.yOff) / s;
    const right = new THREE.Vector3(-Math.cos(e.facing), 0, Math.sin(e.facing));
    const lat = point.clone().sub(e.pos).dot(right) / s;
    const part = y > 1.45 ? "head" : y < 0.9 ? "leg" : Math.abs(lat) > 0.21 ? "arm" : "torso";
    if (e.isRemote) {
      arrow.dead = true;
      arrow.m.removeFromParent();
      if (e.invuln) return;
      const dmg = Math.round(40 * (0.4 + 0.6 * arrow.power) * p.dmgMul * (part === "torso" ? 1 : part === "head" ? 1 : 0.7));
      this.mp.send({ t: "hit", to: e.peerId, arrow: true, dmg, part, from: [p.pos.x, p.pos.z] }, e.peerId);
      e.barT = 3.5;
      e.dmgAccum = (e.dmgAccum || 0) + dmg;
      this.blood.burst(point, 18, { speed: 3, life: 0.6, size: 0.07, color: [0.4, 0.01, 0.01], grav: 12, drag: 0.5 });
      this.audio.flesh();
      if (part === "head") this.hud.toast("Headshot", 900);
      return;
    }
    const frontal = Math.abs(wrapAngle(Math.atan2(-dir.x, -dir.z) - e.facing)) < 1.2;
    if (e.guarding && frontal) {
      this.particles.burst(point, 16, { speed: 5, life: 0.3, size: 0.05, color: [1, 0.85, 0.5], grav: 12 });
      this.audio.block();
      arrow.m.removeFromParent();
      arrow.dead = true;
      return;
    }
    let dmg = 40 * (0.4 + 0.6 * arrow.power) * p.dmgMul * { head: 2.5, torso: 1, arm: 0.7, leg: 0.7 }[part];
    if (part === "head" && !e.isBoss && arrow.power > 0.5) {
      dmg = e.hp + 1;
      this.hud.toast("Headshot", 900);
    }
    const guarded = e.receiveHit(dmg, 25 * arrow.power, p);
    if (!guarded && part !== "head") {
      e.bleed += (part === "torso" ? 5 : 4) * e.T.bleedMul;
      e.limbDmg[part] = (e.limbDmg[part] || 0) + dmg;
    }
    this.blood.burst(point, 18, { speed: 3, life: 0.6, size: 0.07 * s, color: [0.4, 0.01, 0.01], grav: 12, drag: 0.5 });
    this.audio.flesh();
    this.hitstop = Math.max(this.hitstop, 0.03);
    // Lodge the arrow in the part it struck so it moves (and falls off) with that part.
    const h = e.h;
    const side = lat > 0 ? "l" : "r";
    const joint = { head: h.neck, torso: h.torso, arm: h[side + "El"], leg: h[side + "Hip"] }[part];
    if (joint && !joint.userData.cut) {
      joint.attach(arrow.m);
      arrow.m.userData.inBody = true;
      (e.stuck ||= []).push(arrow.m);
    } else arrow.dead = true;
  }

  // ── Dismemberment ───────────────────────────────────────────────────────
  // Where a swing lands depends on its arc: slashes find arms and necks, overheads find heads, thrusts find guts.
  static CUT_WEIGHTS = {
    h: { head: 0.6, torso: 3, lArm: 2, rArm: 2, lLeg: 0.4, rLeg: 0.4 },
    v: { head: 1.0, torso: 2.5, lArm: 1.5, rArm: 1.5, lLeg: 0.2, rLeg: 0.2 },
    t: { head: 0.3, torso: 5, lArm: 0.5, rArm: 0.5, lLeg: 0.3, rLeg: 0.3 },
  };

  pickPart(victim, style) {
    const w = Game.CUT_WEIGHTS[style] || Game.CUT_WEIGHTS.h;
    const parts = Object.keys(w).filter((k) => k === "torso" || !victim.h.severed.has(k));
    let r = Math.random() * parts.reduce((s, k) => s + w[k], 0);
    for (const k of parts) if ((r -= w[k]) <= 0) return k;
    return "torso";
  }

  cut(victim, attacker, style, dmg, forcedPart = null, forcedIdx = null) {
    const h = victim.h;
    const s = h.root.scale.x;
    const bleedMul = victim.T ? victim.T.bleedMul : 1;
    const limbHp = victim.T ? victim.T.limbHp : 0;
    let part = forcedPart && (forcedPart === "torso" || !h.severed.has(forcedPart)) ? forcedPart : this.pickPart(victim, style);
    const tell = this.mp && victim.isPlayer;
    if (part !== "torso" && limbHp > 0) {
      victim.limbDmg[part] = (victim.limbDmg[part] || 0) + dmg;
      if (victim.limbDmg[part] < limbHp) part = "torso";
    }
    if (part === "torso") {
      const front = Math.abs(wrapAngle(angleTo(victim.pos, attacker.pos) - victim.facing)) < Math.PI / 2;
      h.addWound(front);
      victim.bleed += 6 * bleedMul;
      if (tell) this.mp.send({ t: "cut", part: "torso", front });
      return;
    }
    const c = h.sever(part, forcedIdx);
    if (tell) this.mp.send({ t: "cut", part, j: c.idx });
    const away = new THREE.Vector3(victim.pos.x - attacker.pos.x, 0, victim.pos.z - attacker.pos.z).normalize();
    const vel = away.multiplyScalar(rand(1.5, 3.5) * s).add(new THREE.Vector3(rand(-1, 1), rand(2.5, 4.5) * Math.sqrt(s), rand(-1, 1)));
    this.gore.addDebris(c.obj, vel, h);
    const at = c.stump.getWorldPosition(new THREE.Vector3());
    this.blood.burst(at, 70, { speed: 5 * Math.sqrt(s), up: 1.4, life: 1.1, size: 0.1 * s, color: [0.42, 0.01, 0.01], grav: 9.8, drag: 0.3 });
    this.gore.pool(victim.pos.x, victim.pos.z, rand(0.5, 0.9) * s, true);
    this.hitstop = Math.max(this.hitstop, 0.13);
    this.shake(0.45);
    this.audio.sever();
    victim.bleed += (part.endsWith("Leg") ? 24 : 18) * bleedMul;
    victim.onSevered(part);
  }

  // ── Events ──────────────────────────────────────────────────────────────
  onEnemyKilled(e) {
    const p = this.player;
    if (e.ally) return;
    this.loot.dropFor(e);
    if (p.cls.manaOnKill) p.mana = Math.min(p.maxMana, p.mana + p.cls.manaOnKill);
    p.souls += e.T.souls;
    if (this.lockTarget === e) this.lockTarget = this.findLockTarget(e);
    const from = e.pos.clone();
    const n = e.isBoss ? 220 : 40;
    for (let i = 0; i < n; i++)
      this.particles.emit(from.x + (Math.random() - 0.5), 0.5 + Math.random() * 1.5 * e.T.scale, from.z + (Math.random() - 0.5), (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 3, 0.09, 0.75, 0.85, 1, 1, 0, 0, p.pos);
    setTimeout(() => this.audio.souls(), 400);
    if (e.isBoss) this.onBossDefeated();
  }

  onBossDefeated() {
    this.bossDefeated = true;
    this.bossFight = false;
    this.audio.stopMusic();
    setTimeout(() => {
      this.hud.setBoss(null);
      this.audio.felled();
      this.hud.showBanner("ENEMY FELLED", "felled", 5000);
    }, 1200);
    setTimeout(() => this.world.setFog(false), 3000);
    setTimeout(() => this.hud.toast("The Warden is ash. Thanks for playing — the hollows still stir if you wish to keep fighting.", 6000), 6500);
    this.save();
  }

  onPlayerDeath() {
    this.lockTarget = null;
    if (this.mp) {
      // In a match you stay down until the next round.
      this.audio.died();
      this.mp.onLocalDeath();
      setTimeout(() => this.hud.showBanner("YOU DIED", "died", 3500), 700);
      return;
    }
    this.deathT = 0;
    this.audio.died();
    this.audio.stopMusic();
    setTimeout(() => this.hud.showBanner("YOU DIED", "died", 4200), 900);
  }

  finishDeath() {
    const p = this.player;
    p.refillArrows();
    this.bloodstain = p.souls > 0 ? { x: p.pos.x, z: p.pos.z, souls: p.souls } : null;
    p.souls = 0;
    this.resetWorld();
    this.respawnPlayer();
    this.save();
  }

  onFogTraversed() {
    this.bossFight = true;
    this.world.setFog(true);
    this.boss.active = true;
    this.boss.setState("chase");
    this.hud.setBoss(this.boss);
    this.audio.startMusic();
  }

  // ── Bonfire / level up ──────────────────────────────────────────────────
  restAt(b) {
    const p = this.player;
    if (!b.lit) {
      b.setLit(true);
      this.audio.bonfire();
      this.hud.showBanner("BONFIRE LIT", "lit", 2800);
    }
    this.lastBonfire = b.id;
    p.facing = angleTo(p.pos, b.pos);
    p.setState("rest");
    this.lockTarget = null;
    p.hp = p.maxHp;
    p.estus = p.estusMax;
    p.mana = p.maxMana;
    p.manaFlasks = p.manaFlaskMax;
    p.refillArrows();
    this.resetWorld();
    this.save();
    this.state = "menu";
    this.hud.setPrompt(null);
    this.input.lockWanted = false;
    if (document.pointerLockElement) document.exitPointerLock();
    $("bonfire-name").textContent = b.name;
    this.refreshLevelMenu();
    this.showScreen("levelup");
  }

  levelCost() {
    const L = this.player.level;
    return Math.round(120 + L * 60 + 6 * L * L);
  }

  refreshLevelMenu() {
    const p = this.player;
    const cost = this.levelCost();
    $("lv-level").textContent = p.level;
    $("lv-souls").textContent = p.souls.toLocaleString();
    $("lv-cost").textContent = cost.toLocaleString();
    $("lv-vig").textContent = p.stats.vig;
    $("lv-end").textContent = p.stats.end;
    $("lv-str").textContent = p.stats.str;
    $("lv-arc").textContent = p.stats.arc;
    $("lv-mana").textContent = p.maxMana;
    $("lv-spell").textContent = Math.round(p.spellMul * 100) + "%";
    $("lv-class").textContent = p.cls.name;
    $("lv-hp").textContent = p.maxHp;
    $("lv-sta").textContent = p.maxSta;
    $("lv-dmg").textContent = Math.round(42 * p.outMul);
    document.querySelectorAll("[data-stat]").forEach((b) => (b.disabled = p.souls < cost || p.stats[b.dataset.stat] >= 99));
  }

  levelUp(stat) {
    const p = this.player;
    const cost = this.levelCost();
    if (p.souls < cost) return;
    p.souls -= cost;
    p.stats[stat]++;
    p.recompute();
    p.hp = p.maxHp;
    p.sta = p.maxSta;
    this.audio.souls();
    this.refreshLevelMenu();
    this.save();
  }

  leaveBonfire() {
    this.showScreen(null);
    this.player.setState("idle");
    this.state = "playing";
    this.input.lockWanted = true;
    this.input.requestLock();
    this.last = performance.now();
  }

  // ── Lock-on ─────────────────────────────────────────────────────────────
  findLockTarget(exclude = null, side = 0) {
    const p = this.player;
    const camFwd = this.rig.moveVector(0, 1);
    const camRight = this.rig.moveVector(1, 0);
    let best = null;
    let bestScore = Infinity;
    for (const e of this.foes()) {
      if (!e.alive || !e.h.root.visible || e === exclude || (e.isBoss && !e.active)) continue;
      const d = distXZ(p.pos, e.pos);
      if (d > 20) continue;
      const dir = new THREE.Vector3(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z).normalize();
      const dot = dir.dot(camFwd);
      if (side === 0 && dot < 0.2) continue;
      if (side !== 0) {
        const cur = this.lockTarget;
        const cx = cur ? new THREE.Vector3(cur.pos.x - p.pos.x, 0, cur.pos.z - p.pos.z).normalize().dot(camRight) : 0;
        if ((dir.dot(camRight) - cx) * side <= 0.02) continue;
      }
      const score = d * (1.6 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  updateLock(inp, dt) {
    const p = this.player;
    if (inp.lock) {
      if (this.lockTarget) this.lockTarget = null;
      else {
        this.lockTarget = this.findLockTarget();
        if (!this.lockTarget) this.rig.yaw = p.facing; // no target: recentre camera like the originals
      }
    }
    const lt = this.lockTarget;
    if (!lt) return;
    if (!lt.alive || distXZ(p.pos, lt.pos) > 24) {
      this.lockTarget = null;
      return;
    }
    // Flick the mouse/stick to switch targets.
    this.lockSwitchAcc = this.lockSwitchAcc * Math.exp(-6 * dt) + inp.lookX;
    if (Math.abs(this.lockSwitchAcc) > 0.18) {
      const n = this.findLockTarget(lt, Math.sign(this.lockSwitchAcc));
      if (n) this.lockTarget = n;
      this.lockSwitchAcc = 0;
    }
  }

  // ── Interaction ─────────────────────────────────────────────────────────
  nearestInteraction() {
    const p = this.player;
    if (p.state !== "idle" || this.mp) return null;
    if (distXZ(p.pos, this.merchant.pos) < 3.2) return { text: "Talk to Ozrael", act: () => this.openShop() };
    for (const b of this.world.bonfires) if (distXZ(p.pos, b.pos) < 2.4) return { text: b.lit ? "Rest at bonfire" : "Light bonfire", act: () => this.restAt(b) };
    const bs = this.bloodstain;
    if (bs && Math.hypot(p.pos.x - bs.x, p.pos.z - bs.z) < 1.6)
      return {
        text: "Retrieve souls",
        act: () => {
          p.souls += bs.souls;
          this.hud.toast(`Retrieved ${bs.souls.toLocaleString()} souls`);
          this.audio.souls();
          this.bloodstain = null;
          this.updateBloodMesh();
          this.save();
        },
      };
    const fp = this.world.fogPos;
    if (this.world.fogMesh.visible && !this.bossFight && p.pos.z > fp.z && Math.abs(p.pos.x) < 4 && p.pos.z - fp.z < 2.6)
      return {
        text: "Traverse the white fog",
        act: () => {
          this.lockTarget = null;
          this.world.setFog(false, true);
          p.pos.x = Math.max(-3, Math.min(3, p.pos.x));
          p.facing = Math.PI;
          p.setState("fog");
        },
      };
    for (const m of this.world.messages) if (distXZ(p.pos, m.pos) < 1.3) return { text: "Read message", act: () => this.hud.showMessage(m.text) };
    return null;
  }

  // ── Loop ────────────────────────────────────────────────────────────────
  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.mat.uniforms.scale.value = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    const p = this.player;
    if (this.state === "title") {
      const a = this.time * 0.08;
      this.camera.position.set(Math.sin(a) * 7, 2.6, 4 + Math.cos(a) * 7);
      this.camera.lookAt(0, 1.2, 4);
      if (this.input.poll(dt).pause && this.screen === "menu") this.closeMenu();
      this.world.update(dt, p.pos);
      this.particles.update(dt);
      return;
    }

    let inp = this.input.poll(dt);
    const menuOpen = this.screen === "menu";
    if (inp.inventory && (this.state === "playing" || this.state === "paused")) {
      this.toggleInventory();
      return;
    }
    if (menuOpen) {
      if (inp.pause) this.closeMenu();
      else if (inp.lock) this.menu.cycle(-1);
      else if (inp.interact) this.menu.cycle(1);
      inp = this.input.blank();
    } else if (inp.pause && this.state === "playing") {
      this.openMenu("options");
      return;
    }
    if (this.state === "paused") return;
    if (this.state === "shop") {
      if (inp.pause || inp.interact) this.closeShop();
      this.world.update(dt, p.pos);
      this.merchant.update(dt);
      this.particles.update(dt);
      return;
    }
    if (this.state === "menu") {
      if (inp.stat) this.levelUp(["vig", "end", "str", "arc"][inp.stat - 1]);
      if (inp.interact || inp.pause) this.leaveBonfire();
      p.update(dt, this.input.blank());
      this.world.update(dt, p.pos);
      this.particles.update(dt);
      this.blood.update(dt);
      this.gore.update(dt);
      this.rig.update(dt, p, null, null);
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      p.captureBuffer(inp);
      this.rig.update(dt, p, inp, this.lockTarget);
      return;
    }

    this.updateLock(inp, dt);
    const it = this.nearestInteraction();
    this.hud.setPrompt(it ? it.text : null);
    if (it && inp.interact) it.act();
    if (this.state !== "playing") return;

    p.update(dt, inp);
    for (const e of this.enemies) e.update(dt);

    if (p.state === "attack") this.processAttack(p, this.foes().filter((e) => e.alive && e.h.root.visible && (e.active || !e.isBoss)));
    if (this.mp) this.mp.tick(dt);
    // Hostiles swing at the player (and catch raised allies in the arc); allies swing at hostiles.
    const allies = this.enemies.filter((e) => e.ally && e.alive);
    const hostiles = this.enemies.filter((e) => !e.ally && e.alive && e.h.root.visible && (e.active || !e.isBoss));
    for (const e of this.enemies) if (e.alive && e.state === "attack" && e.attack.hits.length) this.processAttack(e, e.ally ? hostiles : [p, ...allies]);
    for (const e of [...this.enemies]) if (e.ally && !e.alive && !e.h.root.visible) this.removeEnemy(e);
    this.spells.update(dt);
    this.separate();

    if (this.deathT >= 0) {
      this.deathT += dt;
      if (this.deathT > 5.2 && !this.fading) {
        this.fading = true;
        $("fade").classList.add("on");
        setTimeout(() => {
          this.finishDeath();
          this.deathT = -1;
          $("fade").classList.remove("on");
          this.fading = false;
        }, 900);
      }
    }

    // Weapon trails
    const pts = p.t * p.speedMul;
    const pa = p.state === "attack" && pts > p.attack.hits[0][0] - 0.08 && pts < p.attack.hits[0][1] + 0.05;
    this.playerTrail.update(dt, pa, p.h.baseWorld(new THREE.Vector3()), p.h.tipWorld(new THREE.Vector3()));
    const b = this.boss;
    const ba = b.alive && b.state === "attack" && b.attack.hits.some(([t0, t1]) => b.t * b.speedMul > t0 - 0.15 && b.t * b.speedMul < t1 + 0.05);
    this.bossTrail.update(dt, ba, b.h.baseWorld(new THREE.Vector3()), b.h.tipWorld(new THREE.Vector3()));

    if (this.bloodMesh.visible) {
      this.bloodMesh.scale.setScalar(1 + Math.sin(this.time * 4) * 0.2);
      if (Math.random() < 0.3) this.particles.emit(this.bloodMesh.position.x, 0.2, this.bloodMesh.position.z, (Math.random() - 0.5) * 0.3, 0.8, (Math.random() - 0.5) * 0.3, 1, 0.08, 0.3, 1, 0.55, 0.8);
    }

    this.fx = this.fx.filter((f) => f(dt));
    this.merchant.update(dt);
    this.arrows.update(dt);
    this.loot.update(dt);
    this.world.update(dt, p.pos);
    this.particles.update(dt);
    this.blood.update(dt);
    this.gore.update(dt);
    this.rig.update(dt, p, inp, this.lockTarget);
    this.hud.update(dt);
  }

  // Characters push each other apart (heavier ones move less).
  separate() {
    const all = [this.player, ...this.enemies.filter((e) => e.alive && e.h.root.visible), ...(this.mp ? this.mp.peers.values() : [])];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.state === "dead" || b.state === "dead") continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-5) continue;
        if (Math.abs(a.yOff - b.yOff) > 1.5) continue;
        if ((a.isPlayer && a.invulnerable() && a.state !== "fog") || (b.isPlayer && b.invulnerable() && b.state !== "fog")) continue; // roll through enemies
        if (b.isRemote) {
          // Other players are authoritative over their own position: only we move.
          if (!a.isPlayer || !b.alive) continue;
          a.pos.x -= (dx / d) * (min - d);
          a.pos.z -= (dz / d) * (min - d);
          continue;
        }
        const push = min - d;
        const wa = b.weight / (a.weight + b.weight);
        a.pos.x -= (dx / d) * push * wa;
        a.pos.z -= (dz / d) * push * wa;
        b.pos.x += (dx / d) * push * (1 - wa);
        b.pos.z += (dz / d) * push * (1 - wa);
      }
  }
}

window.game = new Game(await loadAssets());
