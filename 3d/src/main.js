import * as THREE from "three";
import { preloadAll } from "./AnimatedSprite.js";
import { Fighter } from "./Fighter.js";
import { Arena, WORLD_LEFT, WORLD_RIGHT } from "./Arena.js";

const $ = (id) => document.getElementById(id);
const screens = {
  loading: $("loading-screen"),
  start: $("start-screen"),
  character: $("character-screen"),
  map: $("map-screen"),
  hud: $("hud"),
  pause: $("pause-screen"),
  gameover: $("gameover-screen"),
};
function show(...names) {
  for (const key in screens) screens[key].classList.toggle("hidden", !names.includes(key));
}

// ---- three.js boilerplate ----
const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
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
let selectedCharacter = "StickFigure";
let selectedMapIndex = 0;
let arena = null;
let player = null;
let opponent = null;
let running = false;
let paused = false;
let gameOver = false;
let clock = new THREE.Clock();

fetch("assets/manifest.json")
  .then((r) => r.json())
  .then((m) => {
    manifest = m;
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
$("quit-btn").addEventListener("click", () => {
  window.close();
});

// ---- Character select ----
function buildCharacterGrid() {
  const grid = $("character-grid");
  grid.innerHTML = "";
  const names = Object.keys(manifest.characters).sort();
  let chosen = names[0];

  function refresh() {
    $("character-selected").textContent = `Selected: ${chosen}`;
    $("char-next-btn").disabled = false;
    [...grid.children].forEach((c) => c.classList.toggle("selected", c.dataset.name === chosen));
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
$("char-back-btn").addEventListener("click", () => show("start"));

// ---- Map select ----
function buildMapScreen() {
  selectedMapIndex = 0;
  showMap();
}
function showMap() {
  const name = manifest.maps[selectedMapIndex];
  $("map-bg").style.backgroundImage = `url(assets/maps/${name})`;
  $("map-name").textContent = name.replace(/\.png$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
$("map-prev-btn").addEventListener("click", () => {
  selectedMapIndex = (selectedMapIndex - 1 + manifest.maps.length) % manifest.maps.length;
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
  opponent = new Fighter(selectedCharacter, manifest, scene, { isAI: true });
  player.opponent = opponent;
  opponent.opponent = player;
  player.setPosition(-3.2, 0);
  opponent.setPosition(3.2, 0);
  opponent.anim.setFlip(true);

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
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, (player.position.x + opponent.position.x) / 2, 0.08);
  }
  renderer.render(scene, camera);
}
tick();
