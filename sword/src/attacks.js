import { P } from "./humanoid.js";

// Times are in seconds. hits: [start, end, dmgMul?]; move: [start, end, forwardSpeed].
// events: [time, name] fired once. track: seconds the attacker keeps turning toward its target.
function atk(o) {
  const d = { track: 0.15, trackRate: 8, move: [], events: [], hits: [], stamina: 0, poise: 20, arc: 120, range: 2.4, cancel: o.dur * 0.75, ...o };
  d.arcRad = (d.arc * Math.PI) / 180;
  if (!d.style) {
    const ks = d.keys.map(([, p]) => p);
    d.style = ks.includes(P.THRUST) ? "t" : ks.includes(P.OVER_DOWN) || ks.includes(P.HEAVY_DOWN) ? "v" : "h";
  }
  return d;
}

// Same attack, different tempo/damage (e.g. knights swing faster than hollows).
function retime(def, k, over = {}) {
  const s = (t) => t * k;
  return atk({
    ...def,
    dur: s(def.dur),
    track: s(def.track),
    cancel: s(def.cancel),
    keys: def.keys.map(([t, p]) => [s(t), p]),
    hits: def.hits.map(([a, b, m]) => [s(a), s(b), m]),
    move: def.move.map(([a, b, v]) => [s(a), s(b), v / k]),
    events: def.events.map(([t, n]) => [s(t), n]),
    leap: def.leap && def.leap.map(s),
    ...over,
  });
}

const N = P.NEUTRAL;

export const ATTACKS = {};

// ── Player ────────────────────────────────────────────────────────────────
ATTACKS.p_l1 = atk({
  dur: 0.72, keys: [[0, N], [0.17, P.WIND_R], [0.27, P.SLASH_MID], [0.37, P.SLASH_L], [0.72, N]],
  hits: [[0.22, 0.35]], move: [[0.08, 0.3, 3.2]], dmg: 42, stamina: 18, poise: 22, range: 2.5, arc: 150, cancel: 0.46,
});
ATTACKS.p_l2 = atk({
  dur: 0.72, keys: [[0, P.SLASH_L], [0.15, P.WIND_L], [0.26, P.SLASH_MID], [0.36, P.SLASH_R], [0.72, N]],
  hits: [[0.21, 0.34]], move: [[0.06, 0.28, 3.2]], dmg: 42, stamina: 18, poise: 22, range: 2.5, arc: 150, cancel: 0.46,
});
ATTACKS.p_l3 = atk({
  dur: 0.9, keys: [[0, N], [0.24, P.OVER_UP], [0.36, P.OVER_DOWN], [0.55, P.OVER_DOWN], [0.9, N]],
  hits: [[0.3, 0.42]], move: [[0.15, 0.36, 3.5]], dmg: 55, stamina: 22, poise: 32, range: 2.7, arc: 70, cancel: 0.6,
});
ATTACKS.p_heavy = atk({
  dur: 1.2, keys: [[0, N], [0.5, P.HEAVY_UP], [0.62, P.HEAVY_DOWN], [0.9, P.HEAVY_DOWN], [1.2, N]],
  hits: [[0.55, 0.68]], move: [[0.42, 0.62, 4.2]], dmg: 90, stamina: 34, poise: 60, range: 2.8, arc: 80, cancel: 0.88, track: 0.45, heavy: true,
});

// Special: Crimson Cleave — leap, overhead slam, blood-fire wave (fired from the "cleave" event).
ATTACKS.p_cleave = atk({
  dur: 1.25, keys: [[0, N], [0.28, P.CROUCH], [0.45, P.HEAVY_UP], [0.72, P.HEAVY_DOWN], [1.0, P.HEAVY_DOWN], [1.25, N]],
  leap: [0.3, 0.72], move: [[0.3, 0.72, 8.5]], hits: [[0.68, 0.8]], events: [[0.72, "cleave"]],
  dmg: 95, stamina: 28, poise: 80, range: 3.0, arc: 120, cancel: 1.05, track: 0.32, heavy: true, knockdown: true,
});

// Divine Smite (cleric) and Soul Rend (necromancer): their effects fire from attack events.
ATTACKS.p_smite = atk({ ...ATTACKS.p_heavy, events: [[0.62, "smite"]], dmg: 80, cancel: 0.95 });
ATTACKS.p_soulrend = atk({ ...ATTACKS.p_l3, events: [[0.38, "soulrend"]], dmg: 60, stamina: 24, cancel: 0.7 });

// ── Hollow ────────────────────────────────────────────────────────────────
ATTACKS.h_slash = atk({
  dur: 1.25, keys: [[0, N], [0.55, P.WIND_R], [0.68, P.SLASH_MID], [0.78, P.SLASH_L], [1.25, N]],
  hits: [[0.62, 0.76]], move: [[0.5, 0.7, 2.8]], dmg: 58, range: 2.3, arc: 130, track: 0.55, trackRate: 3,
});
ATTACKS.h_over = atk({
  dur: 1.4, keys: [[0, N], [0.7, P.OVER_UP], [0.84, P.OVER_DOWN], [1.0, P.OVER_DOWN], [1.4, N]],
  hits: [[0.78, 0.9]], move: [[0.65, 0.85, 2.5]], dmg: 72, range: 2.4, arc: 55, track: 0.65, trackRate: 3,
});
ATTACKS.h_lunge = atk({
  dur: 1.35, keys: [[0, N], [0.6, P.THRUST_BACK], [0.78, P.THRUST], [1.0, P.THRUST], [1.35, N]],
  hits: [[0.7, 0.86]], move: [[0.62, 0.84, 8]], dmg: 62, range: 2.5, arc: 40, track: 0.6, trackRate: 3.5,
});

// ── Knight ────────────────────────────────────────────────────────────────
ATTACKS.k_slash = retime(ATTACKS.h_slash, 0.85, { dmg: 82, range: 2.5 });
ATTACKS.k_thrust = retime(ATTACKS.h_lunge, 0.9, { dmg: 88, range: 2.7 });
ATTACKS.k_combo = atk({
  dur: 1.6,
  keys: [[0, N], [0.45, P.WIND_R], [0.56, P.SLASH_MID], [0.66, P.SLASH_L], [0.95, P.WIND_L], [1.06, P.SLASH_MID], [1.16, P.SLASH_R], [1.6, N]],
  hits: [[0.5, 0.64], [1.0, 1.14]], move: [[0.4, 0.6, 2.5], [0.9, 1.1, 2.5]], dmg: 72, range: 2.5, arc: 140, track: 0.95, trackRate: 3,
});

// ── Ashen Warden (boss) ───────────────────────────────────────────────────
ATTACKS.b_sweep = atk({
  dur: 2.0, keys: [[0, N], [0.8, P.WIND_R], [0.95, P.SLASH_MID], [1.1, P.SLASH_L], [2.0, N]],
  hits: [[0.88, 1.06]], move: [[0.7, 1.0, 3]], dmg: 140, range: 5.6, arc: 210, track: 0.8, trackRate: 2,
});
ATTACKS.b_over = atk({
  dur: 2.2, keys: [[0, N], [0.9, P.OVER_UP], [1.08, P.OVER_DOWN], [1.6, P.OVER_DOWN], [2.2, N]],
  hits: [[1.0, 1.12]], move: [[0.85, 1.05, 4]], dmg: 185, range: 5.8, arc: 50, track: 0.9, trackRate: 2.2,
  events: [[1.08, "slam"]], knockdown: true,
});
ATTACKS.b_thrust = atk({
  dur: 1.9, keys: [[0, N], [0.7, P.THRUST_BACK], [0.88, P.THRUST], [1.3, P.THRUST], [1.9, N]],
  hits: [[0.8, 1.0]], move: [[0.74, 1.0, 15]], dmg: 150, range: 5.3, arc: 35, track: 0.72, trackRate: 2.5,
});
ATTACKS.b_combo = atk({
  dur: 2.6,
  keys: [[0, N], [0.6, P.WIND_R], [0.75, P.SLASH_MID], [0.85, P.SLASH_L], [1.25, P.WIND_L], [1.4, P.SLASH_MID], [1.5, P.SLASH_R], [2.6, N]],
  hits: [[0.68, 0.86], [1.33, 1.52]], move: [[0.6, 0.85, 3], [1.25, 1.5, 3]], dmg: 120, range: 5.4, arc: 190, track: 1.3, trackRate: 2,
});
ATTACKS.b_leap = atk({
  dur: 2.5,
  keys: [[0, N], [0.45, P.CROUCH], [0.6, P.OVER_UP], [1.35, P.OVER_UP], [1.45, P.OVER_DOWN], [1.9, P.OVER_DOWN], [2.5, N]],
  leap: [0.6, 1.42], events: [[0.6, "leapStart"], [1.42, "leapLand"]],
  hits: [[1.38, 1.5]], dmg: 170, range: 5.5, arc: 60, track: 0.55, trackRate: 3, knockdown: true,
});
ATTACKS.b_nova = atk({
  dur: 2.8, keys: [[0, N], [0.5, P.OVER_UP], [0.85, P.PLANT], [2.3, P.PLANT], [2.8, N]],
  events: [[0.85, "plant"], [1.9, "nova"]], charge: [0.85, 1.9], dmg: 160, track: 0.4,
});
