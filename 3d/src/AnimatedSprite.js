import * as THREE from "three";

export const ACTIONS = [
  "idle",
  "running",
  "jump",
  "attack_1",
  "attack_2",
  "attack_special",
  "hit",
  "dead",
];
export const NO_LOOP = new Set([
  "attack_1",
  "attack_2",
  "attack_special",
  "hit",
  "dead",
  "jump",
]);
const ANIM_FPS = {
  idle: 8,
  running: 16,
  jump: 14,
  attack_1: 18,
  attack_2: 18,
  attack_special: 16,
  hit: 14,
  dead: 10,
};

const loader = new THREE.TextureLoader();

function loadTexture(path) {
  const tex = loader.load(path);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // needed so repeat.x = -1 mirrors correctly
  return tex;
}

/** A billboard sprite that plays frame-sequence animations, mirroring Character.gd. */
export class AnimatedSprite {
  constructor(characterName, manifest, height = 2.2) {
    this.height = height;
    this.frames = {};
    for (const action of ACTIONS) {
      const count = manifest.characters[characterName]?.[action] || 0;
      const arr = [];
      for (let i = 1; i <= count; i++) {
        arr.push(
          loadTexture(`assets/characters/${characterName}/${action}/${i}.png`),
        );
      }
      this.frames[action] = arr;
    }

    this.material = new THREE.SpriteMaterial({
      map: this.frames.idle[0] || null,
      transparent: true,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.center.set(0.5, 0.0); // anchor at feet, not center

    this.action = "idle";
    this.frameIndex = 0;
    this.frameTime = 0;
    this.flipped = false;
    this._updateScale();
  }

  play(action) {
    if (this.action === action) return;
    this.action = action;
    this.frameIndex = 0;
    this.frameTime = 0;
    this._applyFrame();
  }

  get finished() {
    const arr = this.frames[this.action];
    return NO_LOOP.has(this.action) && arr && this.frameIndex >= arr.length - 1;
  }

  setFlip(flip) {
    if (this.flipped === flip) return;
    this.flipped = flip;
    this._applyFlipToTexture(this.material.map);
  }

  _applyFlipToTexture(tex) {
    if (!tex) return;
    tex.repeat.x = this.flipped ? -1 : 1;
    tex.offset.x = this.flipped ? 1 : 0;
    tex.needsUpdate = true;
  }

  update(dt) {
    const arr = this.frames[this.action];
    if (!arr || arr.length === 0) return;
    const fps = ANIM_FPS[this.action] || 12;
    const frameDur = 1 / fps;
    this.frameTime += dt;
    while (this.frameTime >= frameDur) {
      this.frameTime -= frameDur;
      if (this.frameIndex < arr.length - 1) {
        this.frameIndex++;
        this._applyFrame();
      } else if (!NO_LOOP.has(this.action)) {
        this.frameIndex = 0;
        this._applyFrame();
      }
      // else: hold on final frame
    }
  }

  _applyFrame() {
    const tex = this.frames[this.action][this.frameIndex];
    if (!tex) return;
    this.material.map = tex;
    this._applyFlipToTexture(tex);
    this.material.needsUpdate = true;
    this._updateScale();
  }

  _updateScale() {
    const img = this.material.map?.image;
    const aspect = img && img.width ? img.width / img.height : 0.7;
    const h = this.height;
    const w = h * aspect;
    this.sprite.scale.set(w, h, 1);
  }
}

/** Preloads every frame of every character in the manifest before the game starts. */
export function preloadAll(manifest, onDone) {
  const manager = new THREE.LoadingManager();
  manager.onLoad = onDone;
  const preloader = new THREE.TextureLoader(manager);
  for (const charName of Object.keys(manifest.characters)) {
    for (const action of ACTIONS) {
      const count = manifest.characters[charName][action] || 0;
      for (let i = 1; i <= count; i++) {
        preloader.load(`assets/characters/${charName}/${action}/${i}.png`);
      }
    }
  }
  if (Object.keys(manifest.characters).length === 0) onDone();
}
