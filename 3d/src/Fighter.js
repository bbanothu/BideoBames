import * as THREE from "three";
import { AnimatedSprite } from "./AnimatedSprite.js";

const SPEED = 7.0;
const ACCEL = 45.0;
const JUMP_VELOCITY = 13.5;
const GRAVITY = 26.0;

const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const STAMINA_REGEN = 25;
const ATTACK_STAMINA_COST = { attack_1: 20, attack_2: 25, attack_special: 35 };
const ATTACK_DAMAGE = { attack_1: 10, attack_2: 14, attack_special: 25 };
const HIT_RANGE = 2.1;
const MIN_SEPARATION = 1.5;
const KNOCKBACK_FORCE = 9.0;
const KNOCKBACK_DECAY = 38.0;
const NET_SEND_EVERY = 3; // frames between state broadcasts, matches the 2D version

const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));
const justPressedQueue = new Set();
window.addEventListener("keydown", (e) => {
  if (!e.repeat) justPressedQueue.add(e.code);
});

function consumeJustPressed(code) {
  if (justPressedQueue.has(code)) {
    justPressedQueue.delete(code);
    return true;
  }
  return false;
}

/** One fighter: a billboard sprite + physics + (for the local player) input + combat. */
export class Fighter {
  constructor(
    characterName,
    manifest,
    scene,
    { isLocal = false, isAI = false, isRemote = false } = {},
  ) {
    this.anim = new AnimatedSprite(characterName, manifest);
    scene.add(this.anim.sprite);

    this.isLocal = isLocal;
    this.isAI = isAI;
    this.isRemote = isRemote;
    this.position = new THREE.Vector3();
    this.velocityX = 0;
    this.velocityY = 0;
    this.knockback = 0;
    this.onGround = true;
    this.facingRight = true;

    this.health = MAX_HEALTH;
    this.stamina = MAX_STAMINA;
    this.attacking = false;
    this._hitThisSwing = false;
    this.dead = false;
    this._netFrame = 0;

    this.opponent = null; // set after both fighters exist
    this.onHealthChange = null;
    this.onDeath = null;
    this.onSendState = null; // set for the local fighter in a multiplayer match
    this.onHitOpponent = null; // set for the local fighter in a multiplayer match
  }

  setPosition(x, y) {
    this.position.set(x, y, 0);
  }

  startAttack(action) {
    const cost = ATTACK_STAMINA_COST[action] || 0;
    if (cost > this.stamina) return;
    this.stamina -= cost;
    this.attacking = true;
    this._hitThisSwing = false;
    this.anim.play(action);
    this._notifyStamina();
  }

  takeDamage(amount, knockbackDir = 1) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.attacking = true;
    this._hitThisSwing = false;
    this.knockback = knockbackDir * KNOCKBACK_FORCE;
    this.anim.play(this.health <= 0 ? "dead" : "hit");
    this._notifyHealth();
    if (this.health <= 0) {
      this.dead = true;
      this.onDeath?.();
    }
  }

  _notifyHealth() {
    this.onHealthChange?.(this.health, this.stamina);
  }
  _notifyStamina() {
    this.onHealthChange?.(this.health, this.stamina);
  }

  _checkHit() {
    if (this._hitThisSwing || !this.opponent) return;
    const dmg = ATTACK_DAMAGE[this.anim.action];
    if (!dmg) return;
    const dx = this.opponent.position.x - this.position.x;
    const facingOpponent = this.facingRight ? dx > 0 : dx < 0;
    if (!facingOpponent || Math.abs(dx) > HIT_RANGE) return;
    this._hitThisSwing = true;
    const dir = Math.sign(dx) || 1;
    if (this.opponent.isRemote) {
      this.onHitOpponent?.(dmg, dir); // remote client applies damage to itself
    } else {
      this.opponent.takeDamage(dmg, dir);
    }
  }

  /** Very small AI: idle. (Matches the Godot "idle_ai" opponent behavior.) */
  updateAI(dt) {
    this.anim.setFlip(true); // faces the local player
    this.anim.update(dt);
    this.anim.sprite.position.copy(this.position);
  }

  /** Applies a state update received from the remote peer over the network. */
  receiveState(data) {
    this.position.x = data.x;
    this.position.y = data.y;
    this.facingRight = !data.flip_h;
    this.anim.setFlip(!!data.flip_h);
    if (data.anim && this.anim.action !== data.anim) this.anim.play(data.anim);
    if (typeof data.health === "number" && data.health !== this.health) {
      this.health = data.health;
      this._notifyHealth();
    }
  }

  update(dt, worldLeft, worldRight) {
    if (this.isRemote) {
      this.anim.update(dt);
      this.anim.sprite.position.copy(this.position);
      return;
    }

    if (this.dead && this.anim.finished) {
      // stay collapsed
      this.anim.update(dt);
      this.anim.sprite.position.copy(this.position);
      return;
    }

    if (this.isAI) {
      this.updateAI(dt);
      return;
    }

    // gravity
    if (!this.onGround) {
      this.velocityY -= GRAVITY * dt;
    }

    const jumpPressed =
      consumeJustPressed("KeyW") ||
      consumeJustPressed("Space") ||
      consumeJustPressed("ArrowUp");
    if (jumpPressed && this.onGround && !this.attacking) {
      this.velocityY = JUMP_VELOCITY;
      this.onGround = false;
    }

    if (!this.attacking && this.onGround) {
      if (consumeJustPressed("KeyJ")) this.startAttack("attack_1");
      else if (consumeJustPressed("KeyK")) this.startAttack("attack_2");
      else if (consumeJustPressed("KeyL")) this.startAttack("attack_special");
    }

    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    const dir = left === right ? 0 : left ? -1 : 1;

    if (!this.attacking) {
      if (dir !== 0) {
        this.facingRight = dir > 0;
        this.anim.setFlip(!this.facingRight);
      }
      const targetVx = dir * SPEED;
      this.velocityX +=
        Math.sign(targetVx - this.velocityX) *
        Math.min(ACCEL * dt, Math.abs(targetVx - this.velocityX));
    } else if (this.anim.action === "hit" || this.anim.action === "dead") {
      this.velocityX = this.knockback;
      const decay =
        Math.sign(-this.knockback) *
        Math.min(KNOCKBACK_DECAY * dt, Math.abs(this.knockback));
      this.knockback += decay;
    } else {
      this.velocityX = 0;
      this._checkHit();
    }

    this.position.x += this.velocityX * dt;
    this.position.x = Math.max(
      worldLeft,
      Math.min(worldRight, this.position.x),
    );

    // unit collision: don't let the two fighters overlap
    if (this.opponent && !this.opponent.dead) {
      const dx = this.position.x - this.opponent.position.x;
      if (Math.abs(dx) < MIN_SEPARATION) {
        this.position.x =
          this.opponent.position.x + Math.sign(dx || 1) * MIN_SEPARATION;
        this.position.x = Math.max(
          worldLeft,
          Math.min(worldRight, this.position.x),
        );
      }
    }

    this.position.y += this.velocityY * dt;
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocityY = 0;
      this.onGround = true;
    }

    // pick animation
    if (this.attacking) {
      // handled by start_attack / finished check below
    } else if (!this.onGround) {
      if (this.anim.action !== "jump") this.anim.play("jump");
    } else if (dir !== 0) {
      if (this.anim.action !== "running") this.anim.play("running");
    } else {
      if (this.anim.action !== "idle") this.anim.play("idle");
    }

    if (this.attacking && this.anim.finished && this.anim.action !== "dead") {
      this.attacking = false;
    }

    this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN * dt);
    this._notifyStamina();

    this.anim.update(dt);
    this.anim.sprite.position.copy(this.position);

    if (this.onSendState) {
      this._netFrame++;
      if (this._netFrame >= NET_SEND_EVERY) {
        this._netFrame = 0;
        this.onSendState({
          x: this.position.x,
          y: this.position.y,
          flip_h: !this.facingRight,
          anim: this.anim.action,
          health: this.health,
        });
      }
    }
  }
}
