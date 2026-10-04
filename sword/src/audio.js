// All sound is synthesized with WebAudio so the game ships with zero asset files.
// Only the bow (draw, twang, arrow impact), sword swings and the player taking damage make sound.
// Everything else is silenced here; the synth recipes stay below in case they're wanted back.
const MUTED = ["flesh", "sever", "pickup", "cast", "blink", "block", "roll", "heal", "souls", "bonfire", "boom", "roar", "died", "felled"];

export class Sfx {
  constructor() {
    this.ctx = null;
    this.music = null;
    for (const name of MUTED) this[name] = () => {};
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9 * (this.volume ?? 0.6);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  noise(dur, type, f0, f1, peak, { q = 1, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(type, f0, f1, dur, peak, { delay = 0, attack = 0.005, dest = null } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, attack, peak, dur);
    o.connect(g).connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  swing(heavy = false) {
    this.noise(heavy ? 0.32 : 0.2, "bandpass", heavy ? 500 : 900, heavy ? 2200 : 3800, heavy ? 0.5 : 0.35, { q: 1.4, attack: 0.04 });
  }
  hit(big = false) {
    this.noise(0.18, "lowpass", 3000, 300, big ? 0.9 : 0.6);
    this.tone("sine", big ? 110 : 160, 40, big ? 0.35 : 0.2, big ? 0.9 : 0.6);
  }
  flesh() {
    this.noise(0.14, "bandpass", 1400, 500, 0.55, { q: 0.8 });
    this.tone("triangle", 220, 70, 0.15, 0.4);
  }
  sever() {
    this.noise(0.25, "bandpass", 2200, 400, 0.8, { q: 0.7 });
    this.tone("triangle", 140, 45, 0.3, 0.6);
    this.noise(0.6, "lowpass", 900, 200, 0.35, { delay: 0.08, attack: 0.05 });
  }
  pickup() {
    this.tone("triangle", 660, 990, 0.18, 0.12);
    this.tone("sine", 1320, 1320, 0.25, 0.06, { delay: 0.06 });
  }
  cast() {
    this.noise(0.45, "bandpass", 500, 1800, 0.25, { q: 3, attack: 0.15 });
    this.tone("sine", 440, 880, 0.4, 0.08, { attack: 0.1 });
  }
  blink() {
    this.noise(0.3, "highpass", 3000, 800, 0.3, { attack: 0.02 });
    this.tone("sine", 900, 200, 0.3, 0.12);
  }
  draw() {
    this.noise(0.75, "bandpass", 260, 700, 0.22, { q: 6, attack: 0.3 });
  }
  twang(power = 1) {
    this.tone("triangle", 150 + 60 * power, 90, 0.35, 0.45);
    this.noise(0.12, "bandpass", 1800, 600, 0.35 * power, { q: 1.2 });
  }
  thunk() {
    this.noise(0.12, "lowpass", 1400, 200, 0.5);
    this.tone("sine", 140, 60, 0.12, 0.35);
  }
  block() {
    this.tone("square", 520, 480, 0.25, 0.18);
    this.tone("square", 790, 760, 0.3, 0.12);
    this.noise(0.08, "highpass", 3000, 2000, 0.4);
  }
  roll() {
    this.noise(0.3, "lowpass", 600, 150, 0.4, { attack: 0.03 });
  }
  heal() {
    [392, 523, 659, 784].forEach((f, i) => this.tone("sine", f, f, 0.6, 0.15, { delay: i * 0.08, attack: 0.05 }));
  }
  souls() {
    [880, 1175, 1568].forEach((f, i) => this.tone("sine", f, f * 1.01, 0.5, 0.06, { delay: i * 0.05, attack: 0.02 }));
  }
  bonfire() {
    this.noise(1.2, "lowpass", 200, 2400, 0.5, { attack: 0.3 });
    [196, 247, 294, 392].forEach((f) => this.tone("sawtooth", f, f, 2.2, 0.035, { attack: 0.5 }));
  }
  boom() {
    this.tone("sine", 70, 25, 0.9, 1.0);
    this.noise(0.8, "lowpass", 900, 80, 0.8);
  }
  roar() {
    this.tone("sawtooth", 90, 55, 1.6, 0.35, { attack: 0.2 });
    this.tone("sawtooth", 93, 50, 1.6, 0.3, { attack: 0.2 });
    this.noise(1.6, "bandpass", 300, 150, 0.5, { q: 2, attack: 0.2 });
  }
  died() {
    [73.4, 110, 146.8, 174.6].forEach((f) => this.tone("sawtooth", f, f * 0.98, 4.5, 0.08, { attack: 0.6 }));
    this.tone("sine", 55, 40, 4, 0.5, { attack: 0.3 });
  }
  felled() {
    [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone("triangle", f, f, 3.5, 0.08, { delay: i * 0.12, attack: 0.3 }));
  }

  startMusic() {
    const c = this.ctx;
    if (!c || this.music) return;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(0.5 * (this.musicVolume ?? 0.6), c.currentTime + 3);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    out.connect(this.master);
    lp.connect(out);
    const oscs = [];
    const voices = [0, 1, 2, 3].map(() => {
      const a = c.createOscillator();
      const b = c.createOscillator();
      a.type = b.type = "sawtooth";
      b.detune.value = 9;
      const g = c.createGain();
      g.gain.value = 0.12;
      a.connect(g);
      b.connect(g);
      g.connect(lp);
      a.start();
      b.start();
      oscs.push(a, b);
      return [a, b];
    });
    // D minor, Bb, G minor, A — a slow, ominous loop.
    const chords = [
      [36.7, 146.8, 174.6, 220],
      [29.1, 146.8, 174.6, 233.1],
      [24.5, 146.8, 196, 233.1],
      [27.5, 138.6, 164.8, 220],
    ];
    let i = 0;
    const step = () => {
      const ch = chords[i++ % chords.length];
      const t = c.currentTime;
      voices.forEach(([a, b], k) => {
        a.frequency.setTargetAtTime(ch[k], t, 0.4);
        b.frequency.setTargetAtTime(ch[k], t, 0.4);
      });
      [0, 0.8, 1.6, 2.0].forEach((d, k) => this.tone("sine", k === 0 ? 75 : 60, 30, 0.6, k === 0 ? 0.5 : 0.3, { delay: d, dest: out }));
    };
    step();
    const timer = setInterval(step, 3200);
    this.music = { out, oscs, timer };
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0.9 * (this.volume ?? 0.6), this.ctx.currentTime, 0.05);
    if (this.music) this.music.out.gain.setTargetAtTime(0.5 * (this.musicVolume ?? 0.6), this.ctx.currentTime, 0.1);
  }

  stopMusic() {
    const m = this.music;
    if (!m || !this.ctx) return;
    this.music = null;
    clearInterval(m.timer);
    const t = this.ctx.currentTime;
    m.out.gain.cancelScheduledValues(t);
    m.out.gain.setValueAtTime(m.out.gain.value, t);
    m.out.gain.linearRampToValueAtTime(0, t + 2);
    m.oscs.forEach((o) => o.stop(t + 2.1));
  }
}
