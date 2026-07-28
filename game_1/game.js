// --- config ---
const SCALE = 2;
const GRAVITY = 0.6;
const MOVE_SPEED = 4;
const JUMP_SPEED = -13;
const GROUND_Y = 400;
const ATTACK_RANGE = 45;
const ATTACK_DAMAGE = 10;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

const bgImage = new Image();
bgImage.src = 'backgrounds/rooftop.jpg';

const platforms = [
  { x: 0, y: GROUND_Y, w: 800, h: 50, draw: false },
  { x: 250, y: 300, w: 200, h: 20, draw: true },
  { x: 520, y: 190, w: 180, h: 20, draw: true },
];

// --- character rosters (frame counts already extracted into sprites/frames/<dir>/<anim>/) ---
const CHARACTERS = {
  ichigo: { name: 'Ichigo', dir: 'ichigo', counts: { idle: 4, walk: 8, jump: 1, attack1: 6, attack2: 7 } },
  vegeta: { name: 'Vegeta', dir: 'vegeta', counts: { idle: 4, walk: 4, jump: 6, attack1: 8, attack2: 12 } },
};
const ANIM_SPEED = { idle: 150, walk: 80, jump: 999, attack1: 60, attack2: 50 };

// --- preload every animation frame for every character up front ---
const imageCache = {}; // imageCache[charDir][animName] = [Image, ...]
for (const key in CHARACTERS) {
  const c = CHARACTERS[key];
  imageCache[c.dir] = {};
  for (const anim in c.counts) {
    const frames = [];
    for (let i = 0; i < c.counts[anim]; i++) {
      const img = new Image();
      img.src = `sprites/frames/${c.dir}/${anim}/${anim}_${i}.png`;
      frames.push(img);
    }
    imageCache[c.dir][anim] = frames;
  }
}

// --- input ---
const keys = new Set();
window.addEventListener('keydown', e => {
  keys.add(e.code);
  for (const f of fighters) {
    if (!f.controls || f.attacking) continue;
    if (e.code === f.controls.attack1) startAttack(f, 'attack1');
    else if (e.code === f.controls.attack2) startAttack(f, 'attack2');
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));

const P1_CONTROLS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', attack1: 'KeyQ', attack2: 'KeyE' };
const P2_CONTROLS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', attack1: 'Comma', attack2: 'Period' };

function rectsOverlapX(ax, aw, b) { return ax + aw > b.x && ax < b.x + b.w; }

function createFighter(charKey, x, facing, controls) {
  return {
    char: CHARACTERS[charKey], x, y: GROUND_Y, vx: 0, vy: 0,
    w: 50, h: 100, facing, grounded: false,
    state: 'idle', frameIndex: 0, frameTimer: 0,
    hp: 100, maxHp: 100,
    attacking: null, hitDone: false,
    controls, isCPU: !controls, cpuCooldown: 500,
  };
}

function startAttack(f, name) {
  f.attacking = name;
  f.state = name;
  f.frameIndex = 0;
  f.frameTimer = 0;
  f.hitDone = false;
}

let fighters = [];
let gameState = 'title'; // title | mode | select | playing | over
let mode = null; // '1v1' | 'cpu'
let winner = null;

function updateFighter(f, dt, opponent) {
  let moving = false;

  if (f.isCPU) {
    const dist = opponent.x - f.x;
    f.cpuCooldown -= dt;
    if (Math.abs(dist) > ATTACK_RANGE) {
      f.vx = Math.sign(dist) * MOVE_SPEED;
      moving = true;
    } else {
      f.vx = 0;
      if (!f.attacking && f.cpuCooldown <= 0) {
        startAttack(f, Math.random() < 0.5 ? 'attack1' : 'attack2');
        f.cpuCooldown = 600 + Math.random() * 700;
      }
    }
  } else {
    if (keys.has(f.controls.left)) { f.vx = -MOVE_SPEED; moving = true; }
    else if (keys.has(f.controls.right)) { f.vx = MOVE_SPEED; moving = true; }
    else { f.vx = 0; }
    if (keys.has(f.controls.up) && f.grounded) { f.vy = JUMP_SPEED; f.grounded = false; }
  }

  // face the opponent, fighting-game style
  f.facing = (opponent.x + opponent.w / 2) < (f.x + f.w / 2) ? -1 : 1;

  f.vy += GRAVITY;
  f.x += f.vx;
  f.x = Math.max(0, Math.min(canvas.width - f.w, f.x));

  const prevFeetY = f.y;
  f.y += f.vy;
  let grounded = false;
  for (const p of platforms) {
    if (rectsOverlapX(f.x, f.w, p)) {
      if (f.vy >= 0 && prevFeetY <= p.y && f.y >= p.y) {
        f.y = p.y;
        f.vy = 0;
        grounded = true;
      }
    }
  }
  f.grounded = grounded;

  // animation state
  if (!f.attacking) {
    const state = !f.grounded ? 'jump' : (moving ? 'walk' : 'idle');
    if (state !== f.state) { f.state = state; f.frameIndex = 0; f.frameTimer = 0; }
  }
  const count = f.char.counts[f.state];
  f.frameTimer += dt;
  if (f.frameTimer > ANIM_SPEED[f.state]) {
    f.frameTimer = 0;
    f.frameIndex++;
    if (f.frameIndex >= count) {
      if (f.attacking) { f.attacking = null; }
      f.frameIndex = 0;
    }
  }

  // hit detection: once per attack, while overlapping the opponent
  if (f.attacking && !f.hitDone) {
    const overlapX = rectsOverlapX(f.x, f.w, { x: opponent.x, w: opponent.w });
    const overlapY = f.y - f.h < opponent.y && f.y > opponent.y - opponent.h;
    if (overlapX && overlapY) {
      opponent.hp = Math.max(0, opponent.hp - ATTACK_DAMAGE);
      f.hitDone = true;
    }
  }
}

function drawFighter(f) {
  const frames = imageCache[f.char.dir][f.state];
  const img = frames[f.frameIndex];
  if (!img || !img.complete || !img.naturalWidth) return;
  const dw = img.naturalWidth * SCALE;
  const dh = img.naturalHeight * SCALE;
  ctx.save();
  ctx.translate(f.x + f.w / 2, f.y);
  ctx.scale(f.facing, 1);
  ctx.drawImage(img, -dw / 2, -dh, dw, dh);
  ctx.restore();
}

function drawHealthBar(f, x, alignRight) {
  const barW = 220, barH = 20, y = 20;
  const bx = alignRight ? canvas.width - x - barW : x;
  ctx.fillStyle = '#333';
  ctx.fillRect(bx - 2, y - 2, barW + 4, barH + 4);
  ctx.fillStyle = '#600';
  ctx.fillRect(bx, y, barW, barH);
  ctx.fillStyle = '#e33';
  const pct = f.hp / f.maxHp;
  ctx.fillRect(alignRight ? bx + barW * (1 - pct) : bx, y, barW * pct, barH);
  ctx.strokeStyle = '#000';
  ctx.strokeRect(bx, y, barW, barH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = alignRight ? 'right' : 'left';
  ctx.fillText(f.char.name, alignRight ? bx + barW : bx, y - 6);
  ctx.textAlign = 'left';
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (gameState !== 'playing' && gameState !== 'over') return;

  if (bgImage.complete && bgImage.naturalWidth) {
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#4a7d3c';
  for (const p of platforms) if (p.draw) ctx.fillRect(p.x, p.y, p.w, p.h);

  for (const f of fighters) drawFighter(f);

  drawHealthBar(fighters[0], 20, false);
  drawHealthBar(fighters[1], 20, true);
}

function endRound() {
  gameState = 'over';
  winner = fighters[0].hp <= 0 ? fighters[1] : fighters[0];
  showOverGameOverlay();
}

let lastT = 0;
function loop(t) {
  const dt = Math.min(t - lastT || 16, 33);
  lastT = t;
  if (gameState === 'playing') {
    updateFighter(fighters[0], dt, fighters[1]);
    updateFighter(fighters[1], dt, fighters[0]);
    if (fighters[0].hp <= 0 || fighters[1].hp <= 0) endRound();
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ==================== menu screens ====================

function clearOverlay() { overlay.innerHTML = ''; overlay.style.display = 'flex'; }

function showTitleScreen() {
  gameState = 'title';
  clearOverlay();
  overlay.innerHTML = `
    <h1>Ichigo vs Vegeta</h1>
    <h2>a very lazy fighting platformer</h2>
    <div class="btn-row"><button class="big" id="playBtn">Play</button></div>
  `;
  document.getElementById('playBtn').onclick = showModeScreen;
}

function showModeScreen() {
  gameState = 'mode';
  clearOverlay();
  overlay.innerHTML = `
    <h1>Choose Mode</h1>
    <div class="btn-row">
      <button class="big" id="btn1v1">1 v 1</button>
      <button class="big" id="btnCpu">1 v CPU</button>
    </div>
  `;
  document.getElementById('btn1v1').onclick = () => showSelectScreen('1v1');
  document.getElementById('btnCpu').onclick = () => showSelectScreen('cpu');
}

function charGridHtml(idPrefix) {
  return Object.keys(CHARACTERS).map(key => {
    const c = CHARACTERS[key];
    return `<div class="char-btn" data-key="${key}" id="${idPrefix}_${key}">
      <img src="sprites/frames/${c.dir}/portrait/portrait_0.png">
      <div>${c.name}</div>
    </div>`;
  }).join('');
}

function showSelectScreen(selectedMode) {
  mode = selectedMode;
  gameState = 'select';
  clearOverlay();

  const secondLabel = mode === '1v1' ? 'Player 2: choose your fighter' : 'Choose the enemy';
  overlay.innerHTML = `
    <h1>Select Fighters</h1>
    <div class="select-columns">
      <div class="select-col">
        <h3>Player 1: choose your fighter</h3>
        <div class="char-grid">${charGridHtml('p1')}</div>
      </div>
      <div class="select-col">
        <h3>${secondLabel}</h3>
        <div class="char-grid">${charGridHtml('p2')}</div>
      </div>
    </div>
    <div class="btn-row"><button class="big" id="fightBtn" disabled>Fight!</button></div>
  `;

  let p1Choice = null, p2Choice = null;
  const fightBtn = document.getElementById('fightBtn');
  function tryEnable() { fightBtn.disabled = !(p1Choice && p2Choice); }

  for (const key of Object.keys(CHARACTERS)) {
    document.getElementById('p1_' + key).onclick = () => {
      p1Choice = key;
      for (const k of Object.keys(CHARACTERS)) document.getElementById('p1_' + k).classList.remove('selected');
      document.getElementById('p1_' + key).classList.add('selected');
      tryEnable();
    };
    document.getElementById('p2_' + key).onclick = () => {
      p2Choice = key;
      for (const k of Object.keys(CHARACTERS)) document.getElementById('p2_' + k).classList.remove('selected');
      document.getElementById('p2_' + key).classList.add('selected');
      tryEnable();
    };
  }

  fightBtn.onclick = () => startGame(p1Choice, p2Choice);
}

function startGame(p1Key, p2Key) {
  keys.clear();
  const p2Controls = mode === '1v1' ? P2_CONTROLS : null;
  fighters = [
    createFighter(p1Key, 120, 1, P1_CONTROLS),
    createFighter(p2Key, 630, -1, p2Controls),
  ];
  overlay.style.display = 'none';
  gameState = 'playing';
}

function showOverGameOverlay() {
  clearOverlay();
  const label = mode === 'cpu'
    ? (winner === fighters[0] ? 'You win!' : 'CPU wins!')
    : `${winner.char.name} wins!`;
  overlay.innerHTML = `
    <h1>${label}</h1>
    <div class="btn-row"><button class="big" id="againBtn">Play Again</button></div>
  `;
  document.getElementById('againBtn').onclick = showTitleScreen;
}

showTitleScreen();
