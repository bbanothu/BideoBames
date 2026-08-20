import * as THREE from "three";
import { preloadAll } from "./AnimatedSprite.js";
import { Fighter } from "./Fighter.js";
import { Arena, WORLD_LEFT, WORLD_RIGHT } from "./Arena.js";
import { Net } from "./Net.js";

const $ = (id) => document.getElementById(id);
const screens = {
  loading: $("loading-screen"),
  start: $("start-screen"),
  lobby: $("lobby-screen"),
  character: $("character-screen"),
  map: $("map-screen"),
  hud: $("hud"),
  pause: $("pause-screen"),
  gameover: $("gameover-screen"),
};
function show(...names) {
  for (const key in screens)
    screens[key].classList.toggle("hidden", !names.includes(key));
  const menuBg =
    names.includes("start") ||
    names.includes("lobby") ||
    names.includes("character");
  $("menu-bg").classList.toggle("visible", menuBg);
  $("menu-scrim").classList.toggle("visible", menuBg);
}

// ---- three.js boilerplate ----
const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 3.4, 13);
camera.lookAt(0, 2, 0);

function resize() {
  // updateStyle=false: let our CSS (position:fixed; inset:0) own the canvas's
  // displayed size, this only sets the internal drawing-buffer resolution.
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---- state ----
let manifest = null;
let selectedCharacter = "Naruto";
let selectedMapIndex = 0;
let arena = null;
let player = null;
let opponent = null;
let running = false;
let paused = false;
let gameOver = false;
let clock = new THREE.Clock();
let isMultiplayer = false;
let isHost = false;
const net = new Net();

fetch("assets/manifest.json")
  .then((r) => r.json())
  .then((m) => {
    manifest = m;
    if (manifest.maps && manifest.maps.length) {
      $("menu-bg").style.backgroundImage =
        `url(assets/maps/${manifest.maps[0]})`;
    }
    preloadAll(manifest, () => {
      show("start");
      $("start-btn").focus();
    });
  });

// ---- Start screen ----
$("start-btn").addEventListener("click", () => {
  buildCharacterGrid();
  show("character");
});
$("mp-btn").addEventListener("click", () => {
  $("lobby-status").textContent = "";
  show("lobby");
});
$("quit-btn").addEventListener("click", () => {
  window.close();
});

// ---- Multiplayer lobby ----
$("host-btn").addEventListener("click", () => {
  const url = $("server-field").value.trim();
  if (!url) return;
  $("lobby-status").textContent = "Connecting...";
  net.hostLobby(url);
});
$("join-btn").addEventListener("click", () => {
  const url = $("server-field").value.trim();
  const code = $("code-field").value.trim().toUpperCase();
  if (!url) return;
  if (!code) {
    $("lobby-status").textContent = "Enter a lobby code";
    return;
  }
  $("lobby-status").textContent = "Connecting...";
  net.joinLobby(url, code);
});
$("lobby-back-btn").addEventListener("click", () => {
  net.close();
  show("start");
});
net.onHosted = (code) => {
  $("lobby-status").textContent = `Your code: ${code}\nWaiting for opponent...`;
};
net.onPaired = (role) => {
  isMultiplayer = true;
  isHost = role === "host";
  buildCharacterGrid();
  show("character");
};
net.onError = (msg) => {
  if (isMultiplayer) quitToMenu();
  else $("lobby-status").textContent = "Error: " + msg;
};
net.onPeerLeft = () => {
  if (isMultiplayer) quitToMenu();
};

// ---- Character select ----
function buildCharacterGrid() {
  const grid = $("character-grid");
  grid.innerHTML = "";
  const names = Object.keys(manifest.characters).sort();
  let chosen = names[0];

  function refresh() {
    $("character-selected").textContent = `Selected: ${chosen}`;
    $("char-next-btn").disabled = false;
    [...grid.children].forEach((c) =>
      c.classList.toggle("selected", c.dataset.name === chosen),
    );
  }

  for (const name of names) {
    const card = document.createElement("div");
    card.className = "char-card";
    card.dataset.name = name;
    const img = document.createElement("img");
    img.src = `assets/characters/${name}/idle/1.png`;
    const label = document.createElement("div");
    label.className = "name";
    label.textContent = name;
    card.append(img, label);
    card.addEventListener("click", () => {
      chosen = name;
      refresh();
    });
    grid.appendChild(card);
  }
  refresh();
  selectedCharacter = chosen;
  $("char-next-btn").onclick = () => {
    selectedCharacter = chosen;
    buildMapScreen();
    show("map");
  };
}
$("char-back-btn").addEventListener("click", () => {
  if (isMultiplayer) {
    net.close();
    isMultiplayer = false;
    isHost = false;
  }
  show("start");
});

// ---- Map select ----
function buildMapScreen() {
  selectedMapIndex = 0;
  showMap();
}
function showMap() {
  const name = manifest.maps[selectedMapIndex];
  $("map-bg").style.backgroundImage = `url(assets/maps/${name})`;
  $("map-name").textContent = name
    .replace(/\.png$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
$("map-prev-btn").addEventListener("click", () => {
  selectedMapIndex =
    (selectedMapIndex - 1 + manifest.maps.length) % manifest.maps.length;
  showMap();
});
$("map-next-btn").addEventListener("click", () => {
  selectedMapIndex = (selectedMapIndex + 1) % manifest.maps.length;
  showMap();
});
$("map-back-btn").addEventListener("click", () => show("character"));
$("map-fight-btn").addEventListener("click", () => startFight());

// ---- Fight setup ----
function startFight() {
  clearArena();
  arena = new Arena(scene, manifest.maps[selectedMapIndex]);

  player = new Fighter(selectedCharacter, manifest, scene, { isLocal: true });
  opponent = new Fighter(
    selectedCharacter,
    manifest,
    scene,
    isMultiplayer ? { isRemote: true } : { isAI: true },
  );
  player.opponent = opponent;
  opponent.opponent = player;

  // host is always shown on the left, joiner always on the right (matches the 2D relay convention)
  const amRight = isMultiplayer && !isHost;
  player.setPosition(amRight ? 3.2 : -3.2, 0);
  opponent.setPosition(amRight ? -3.2 : 3.2, 0);
  opponent.anim.setFlip(!amRight); // face the player until real data arrives

  if (isMultiplayer) {
    player.onSendState = (data) => net.sendState({ kind: "state", ...data });
    player.onHitOpponent = (dmg, dir) =>
      net.sendState({ kind: "hit", dmg, dir });
    net.onMessage = (data) => {
      if (data.kind === "hit") player.takeDamage(data.dmg, data.dir);
      else if (data.kind === "state") opponent.receiveState(data);
    };
  }

  player.onHealthChange = (hp, sp) => {
    $("hp-bar").style.transform = `scaleX(${hp / 100})`;
    $("hp-value").textContent = `${Math.round(hp)} / 100`;
    $("sp-bar").style.transform = `scaleX(${sp / 100})`;
    $("sp-value").textContent = `${Math.round(sp)} / 100`;
  };
  opponent.onHealthChange = (hp) => {
    $("opp-hp-bar").style.transform = `scaleX(${hp / 100})`;
  };
  player.onDeath = () => endGame(false);
  opponent.onDeath = () => endGame(true);

  paused = false;
  gameOver = false;
  running = true;
  clock.getDelta();
  show("hud");
}

function clearArena() {
  if (arena) arena.dispose();
  if (player) scene.remove(player.anim.sprite);
  if (opponent) scene.remove(opponent.anim.sprite);
  arena = null;
  player = null;
  opponent = null;
}

function endGame(won) {
  gameOver = true;
  running = false;
  const title = $("gameover-title");
  title.textContent = won ? "You Win!" : "You Lose";
  title.style.color = won ? "#ffd84d" : "#e64545";
  show("gameover");
}

// ---- Pause ----
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && running && !gameOver) {
    paused = !paused;
    show(paused ? "pause" : "hud");
    if (!paused) clock.getDelta();
  }
});
$("resume-btn").addEventListener("click", () => {
  paused = false;
  show("hud");
  clock.getDelta();
});
$("pause-quit-btn").addEventListener("click", () => quitToMenu());
$("gameover-quit-btn").addEventListener("click", () => quitToMenu());
$("rematch-btn").addEventListener("click", () => startFight());

function quitToMenu() {
  running = false;
  paused = false;
  gameOver = false;
  net.onMessage = null;
  net.close();
  isMultiplayer = false;
  isHost = false;
  clearArena();
  show("start");
}

// ---- game loop ----
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (running && !paused && !gameOver && player && opponent) {
    player.update(dt, WORLD_LEFT, WORLD_RIGHT);
    opponent.update(dt, WORLD_LEFT, WORLD_RIGHT);
    camera.position.x = THREE.MathUtils.lerp(
      camera.position.x,
      (player.position.x + opponent.position.x) / 2,
      0.08,
    );
  }
  renderer.render(scene, camera);
}
tick();
