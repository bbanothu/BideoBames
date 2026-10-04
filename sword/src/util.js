export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const smooth = (t) => t * t * (3 - 2 * t);
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(a, b, rate, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
}

// Rotate angle a toward b by at most maxStep radians.
export function turnToward(a, b, maxStep) {
  const d = wrapAngle(b - a);
  return a + clamp(d, -maxStep, maxStep);
}

// Facing angle (model faces +Z at 0) from one point toward another on the XZ plane.
export const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

export const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
