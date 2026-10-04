import * as THREE from "three";
import { JOINTS } from "./humanoid.js";
import { RemotePlayer } from "./remote.js";
import { CLASS_IDS } from "./classes.js";

const SEND_HZ = 20;
const ARENA_ONE = [0, -136, 0];
const ROUND_DELAY = 6;

const r3 = (v) => Math.round(v * 1000) / 1000;

// One match: the host is "the One", everyone who joins with the code is a Hunter.
// Each client simulates itself and streams its pose; the host runs the rounds.
export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.id = 0;
    this.hostId = 0;
    this.code = "";
    this.name = "";
    this.peers = new Map(); // peerId -> RemotePlayer
    this.sendT = 0;
    this.round = 0;
    this.oneId = 0;
    this.inRound = false;
    this.dead = new Set();
    this.nextRoundT = -1;
    this.onLobby = null; // UI callback(status)
  }

  get isHost() {
    return this.id === this.hostId;
  }
  get isOne() {
    return this.id === this.oneId;
  }

  connect(first) {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        return reject(new Error("Can't reach the multiplayer server"));
      }
      this.ws = ws;
      ws.onopen = () => this.raw(first);
      ws.onerror = () => reject(new Error("Multiplayer server not running — start the game with `npm start`"));
      ws.onclose = () => this.game.onMpClosed("Disconnected from the server");
      ws.onmessage = (ev) => {
        let d;
        try {
          d = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (d.cmd === "error") reject(new Error(d.message));
        if (d.cmd === "hosted" || d.cmd === "joined") resolve(d);
        this.onServer(d);
      };
    });
  }

  host(name) {
    this.name = name;
    return this.connect({ cmd: "host", name });
  }

  join(code, name) {
    this.name = name;
    return this.connect({ cmd: "join", code, name });
  }

  leave() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    for (const p of this.peers.values()) p.dispose();
    this.peers.clear();
  }

  raw(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  send(obj, to) {
    this.raw({ cmd: "msg", ...obj, ...(to ? { to } : {}) });
  }

  addPeer(id, name) {
    if (this.peers.has(id)) return this.peers.get(id);
    const p = new RemotePlayer(this.game, id, name);
    this.peers.set(id, p);
    return p;
  }

  lobbyChanged() {
    this.onLobby?.();
  }

  onServer(d) {
    const g = this.game;
    switch (d.cmd) {
      case "hosted":
        this.id = this.hostId = this.oneId = d.id;
        this.code = d.code;
        this.lobbyChanged();
        break;
      case "joined":
        this.id = d.id;
        this.hostId = this.oneId = d.hostId;
        this.code = d.code;
        for (const p of d.peers) this.addPeer(p.id, p.name);
        this.lobbyChanged();
        break;
      case "peer_joined": {
        this.addPeer(d.id, d.name);
        g.hud.toast(`${d.name} joined the hunt`);
        // Late joiners: tell them the current round so they can drop straight in as a Hunter.
        if (this.isHost && this.inRound) this.send(this.roundMsg(true), d.id);
        this.lobbyChanged();
        break;
      }
      case "peer_left": {
        const p = this.peers.get(d.id);
        if (p) {
          g.hud.toast(`${p.name} left`);
          if (g.lockTarget === p) g.lockTarget = null;
          p.dispose();
          this.peers.delete(d.id);
        }
        this.dead.delete(d.id);
        if (this.isHost) this.checkRound();
        this.lobbyChanged();
        break;
      }
      case "room_closed":
        g.onMpClosed("The host ended the match");
        break;
      case "msg":
        this.onMsg(d);
        break;
    }
  }

  onMsg(d) {
    const g = this.game;
    const p = this.peers.get(d.from);
    switch (d.t) {
      case "s":
        if (p) p.applyState(d);
        break;
      case "hit":
        g.onNetHit(d, p);
        break;
      case "cut":
        if (p) g.onNetCut(p, d);
        break;
      case "regrow":
        if (p) p.reset();
        break;
      case "fx":
        g.spells.remote(d);
        break;
      case "arrow":
        if (p) g.arrows.fire(new THREE.Vector3().fromArray(d.from), new THREE.Vector3().fromArray(d.dir), d.pw, p, true);
        if (p) g.audio.twang(d.pw);
        break;
      case "died":
        this.dead.add(d.from);
        if (p) g.hud.toast(`${p.name} has fallen`);
        if (this.isHost) this.checkRound();
        break;
      case "round":
        this.startRound(d);
        break;
      case "end":
        this.endRound(d.winner);
        break;
    }
  }

  // ── Rounds (host) ───────────────────────────────────────────────────────
  roundMsg(late = false) {
    const ids = [this.id, ...this.peers.keys()];
    const hunters = ids.filter((i) => i !== this.oneId);
    const spawns = { [this.oneId]: ARENA_ONE };
    hunters.forEach((id, i) => {
      const x = (i - (hunters.length - 1) / 2) * 2.2;
      spawns[id] = [Math.max(-18, Math.min(18, x)), -106, Math.PI];
    });
    return { t: "round", n: this.round, one: this.oneId, hunters: hunters.length, spawns, late };
  }

  hostStartRound() {
    if (!this.isHost) return;
    this.round++;
    const msg = this.roundMsg();
    this.send(msg);
    this.startRound(msg);
  }

  checkRound() {
    if (!this.inRound) return;
    const ids = [this.id, ...this.peers.keys()];
    const oneDead = this.dead.has(this.oneId);
    const huntersAlive = ids.filter((i) => i !== this.oneId && !this.dead.has(i)).length;
    if (oneDead || huntersAlive === 0) {
      const winner = oneDead ? "hunters" : "one";
      this.send({ t: "end", winner });
      this.endRound(winner);
    }
  }

  startRound(d) {
    const g = this.game;
    this.round = d.n;
    this.oneId = d.one;
    this.inRound = true;
    this.nextRoundT = -1;
    if (!d.late) this.dead.clear();
    const spawn = d.spawns[this.id] || [0, -106, Math.PI];
    for (const p of this.peers.values()) {
      p.reset();
      p.team = p.peerId === this.oneId ? "one" : "hunter";
      p.tint = p.team === "one" ? [0xff8a8a, 0x2a0000] : [0xffffff, 0x000000];
      p.h.setTint(...p.tint);
    }
    g.mpSpawn(spawn, this.isOne, d.hunters);
  }

  endRound(winner) {
    const g = this.game;
    this.inRound = false;
    const won = (winner === "one") === this.isOne;
    g.hud.showBanner(won ? "VICTORY" : "DEFEAT", won ? "felled" : "died", 4500);
    const one = this.isOne ? "You" : this.peers.get(this.oneId)?.name || "The One";
    setTimeout(() => g.hud.toast(winner === "one" ? `${one} prevailed against the hunt` : `${one} has been slain`, 3000), 1500);
    if (this.isHost) this.nextRoundT = ROUND_DELAY;
  }

  onLocalDeath() {
    this.dead.add(this.id);
    this.send({ t: "died" });
    if (this.isHost) this.checkRound();
  }

  // ── Per frame ───────────────────────────────────────────────────────────
  tick(dt) {
    for (const p of this.peers.values()) p.update(dt);
    if (this.isHost && this.nextRoundT >= 0 && (this.nextRoundT -= dt) <= 0) this.hostStartRound();
    if ((this.sendT -= dt) > 0) return;
    this.sendT = 1 / SEND_HZ;
    const pl = this.game.player;
    const h = pl.h;
    const flags =
      (pl.state === "draw" ? 1 : 0) |
      (pl.state === "attack" && pl.t * pl.speedMul > pl.attack.hits[0][0] - 0.1 && pl.t * pl.speedMul < pl.attack.hits[0][1] ? 2 : 0) |
      (pl.invulnerable() ? 4 : 0) |
      (pl.blocking ? 8 : 0) |
      (pl.alive ? 16 : 0) |
      (pl.state === "attack" ? 32 : 0) |
      (pl.veiled ? 64 : 0);
    this.send({
      t: "s",
      p: [r3(pl.pos.x), r3(pl.pos.y), r3(pl.pos.z)],
      f: r3(pl.facing),
      y: r3(pl.yOff),
      q: JOINTS.map((k) => r3(h.cur[k])),
      m: pl.mode === "bow" ? 1 : 0,
      c: CLASS_IDS.indexOf(pl.clsId),
      fl: flags,
      hp: Math.round(pl.hp),
      mhp: pl.maxHp,
      bl: Math.round(pl.bleed),
      a: flags & 1 ? pl.aimDir.toArray().map(r3) : undefined,
    });
  }

  // The other team, as seen from here.
  foes() {
    const out = [];
    for (const p of this.peers.values()) if (this.isOne ? p.team !== "one" : p.team === "one") out.push(p);
    return out;
  }
}
