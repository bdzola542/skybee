// Skybee — tiny spring helpers (numbers are "stiffness damping", taken from designbookmark tokens.css)
import { calmMotion } from "./ui.js";

export const spring = (x, [k, c]) => ({ x, v: 0, t: x, k, c: calmMotion() ? 2 * Math.sqrt(k) : c }); // calm: no overshoot
export const tune = (s, [k, c]) => { s.k = k; s.c = calmMotion() ? 2 * Math.sqrt(k) : c; };
export const step =(s, dt) => { s.v += (-s.k * (s.x - s.t) - s.c * s.v) * dt; s.x += s.v * dt; };
export const rest = (s) => Math.abs(s.x - s.t) < .002 && Math.abs(s.v) < .02;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const SPRING = { pop: [520, 16], settle: [280, 22], soft: [260, 24], fade: [420, 32], lead: [620, 36], trail: [190, 19] };
