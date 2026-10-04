// Keyboard + mouse (pointer lock) + standard-mapping gamepad, folded into one action frame.
const DEAD = 0.18;
const SPRINT_HOLD = 0.28;

export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDown = new Set();
    this.mousePressed = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.locked = false;
    this.gpPrev = [];
    this.dodgeT = 0;
    this.dodgeWas = false;
    this.a = this.blank();

    addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing a name / match code
      if (["Tab", "Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener("keyup", (e) => this.down.delete(e.code));
    addEventListener("blur", () => {
      this.down.clear();
      this.mouseDown.clear();
    });
    el.addEventListener("mousedown", (e) => {
      this.mouseDown.add(e.button);
      this.mousePressed.add(e.button);
    });
    addEventListener("mouseup", (e) => this.mouseDown.delete(e.button));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mdx += e.movementX;
      this.mdy += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
    });
  }

  requestLock() {
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* pointer lock unavailable: arrow keys still steer the camera */
    }
  }

  blank() {
    return { moveX: 0, moveY: 0, lookX: 0, lookY: 0, light: false, heavy: false, fireHeld: false, aim: false, swap: false, spell: 0, special: false, manaPot: false, item: 0, inventory: false, roll: false, sprint: false, block: false, estus: false, interact: false, lock: false, pause: false, any: false, stat: 0 };
  }

  poll(dt) {
    const k = this.down;
    const kp = this.pressed;
    const mp = this.mousePressed;
    const a = this.blank();

    a.moveX = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    a.moveY = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const sens = this.sens ?? 1;
    const inv = this.invertY ? -1 : 1;
    a.lookX = (this.mdx * 0.0024 + ((k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0)) * 2.4 * dt) * sens;
    a.lookY = (this.mdy * 0.0024 + ((k.has("ArrowDown") ? 1 : 0) - (k.has("ArrowUp") ? 1 : 0)) * 1.5 * dt) * sens * inv;
    a.light = mp.has(0) || kp.has("KeyJ");
    a.heavy = mp.has(2) || kp.has("KeyK");
    a.block = k.has("ShiftLeft") || k.has("ShiftRight");
    a.fireHeld = this.mouseDown.has(0) || k.has("KeyJ");
    a.aim = this.mouseDown.has(2) || k.has("KeyK");
    a.swap = kp.has("KeyF");
    a.spell = kp.has("Digit1") ? 1 : kp.has("Digit2") ? 2 : kp.has("Digit3") ? 3 : 0;
    a.special = kp.has("KeyV");
    a.manaPot = kp.has("KeyT");
    a.item = kp.has("Digit4") ? 1 : kp.has("Digit5") ? 2 : kp.has("Digit6") ? 3 : 0;
    a.inventory = kp.has("KeyI");
    a.estus = kp.has("KeyR");
    a.interact = kp.has("KeyE");
    a.lock = kp.has("Tab") || kp.has("KeyQ") || mp.has(1);
    a.pause = kp.has("Escape") || kp.has("KeyP");
    a.stat = kp.has("Digit1") ? 1 : kp.has("Digit2") ? 2 : kp.has("Digit3") ? 3 : kp.has("Digit4") ? 4 : 0;
    a.any = kp.size > 0 || mp.size > 0;
    let dodge = k.has("Space");

    const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((g) => g && g.connected);
    if (gp) {
      const ax = (i) => (Math.abs(gp.axes[i] || 0) > DEAD ? gp.axes[i] : 0);
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const bp = (i) => b(i) && !this.gpPrev[i];
      a.moveX += ax(0);
      a.moveY -= ax(1);
      a.lookX += ax(2) * 3.0 * dt * sens;
      a.lookY += ax(3) * 2.0 * dt * sens * inv;
      a.interact ||= bp(0);
      dodge ||= b(1);
      a.estus ||= bp(2);
      a.block ||= b(4);
      a.light ||= bp(5);
      a.heavy ||= bp(7);
      a.fireHeld ||= b(5);
      a.aim ||= b(6);
      a.swap ||= bp(3);
      a.spell ||= bp(14) ? 1 : bp(12) ? 2 : bp(15) ? 3 : 0;
      a.special ||= bp(10);
      a.manaPot ||= bp(13);
      a.inventory ||= bp(8);
      a.lock ||= bp(11);
      a.pause ||= bp(9);
      a.any ||= gp.buttons.some((x, i) => x.pressed && !this.gpPrev[i]);
      this.gpPrev = gp.buttons.map((x) => x.pressed);
    }

    const len = Math.hypot(a.moveX, a.moveY);
    if (len > 1) {
      a.moveX /= len;
      a.moveY /= len;
    }

    // Tap = roll (on release), hold = sprint, like the souls games.
    if (dodge) {
      this.dodgeT += dt;
      a.sprint = this.dodgeT >= SPRINT_HOLD;
    } else if (this.dodgeWas) {
      if (this.dodgeT < SPRINT_HOLD) a.roll = true;
      this.dodgeT = 0;
    }
    this.dodgeWas = dodge;

    this.mdx = this.mdy = 0;
    kp.clear();
    mp.clear();
    this.a = a;
    return a;
  }
}
