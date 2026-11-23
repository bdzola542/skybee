// Skybee — "Rubber dock": the pill under the current tab of the bottom bar stretches like rubber
// (motion study from designbookmark.com). Its two edges are separate springs: the leading edge is stiff, the
// trailing edge lazy, so moving to another tab stretches the pill; its height gives a little (area is kept).
// Dragged past the ends of the bar it is held back by a rubber band and springs home on release.
// Springs (tokens.css): lead 640/38, trail 150/16, drag lead 1100/56, drag trail 320/26, rest 600/44, pop 520/16.
import { calmMotion } from "./ui.js";
import { spring, tune, step, rest, clamp } from "./spring.js";

const LEAD = [640, 38], TRAIL = [150, 16], DLEAD = [1100, 56], DTRAIL = [320, 26], HOLD = [600, 44], POP = [520, 16];

// resistance past the ends: x outside min..max moves less and less
export const rubber = (x, min, max, d = 46) =>
  x < min ? min - (1 - 1 / ((min - x) * .55 / d + 1)) * d :
  x > max ? max + (1 - 1 / ((x - max) * .55 / d + 1)) * d : x;

function draw(lens, s) {
  const l = Math.min(s.L.x, s.R.x), r = Math.max(s.L.x, s.R.x);
  const iw = Math.max(r - l, 24);
  if (s.axis === "y") { lens.style.height = iw.toFixed(1) + "px"; lens.style.transform = `translateY(${l.toFixed(1)}px)`; return; } // the side menu: the pill moves along a column
  const sy = s.squash ? clamp(1 / Math.sqrt(iw / s.w), .66, 1.1) : 1; // area preserving: the longer the pill, the flatter
  lens.style.width = iw.toFixed(1) + "px";
  lens.style.transform = `translateX(${l.toFixed(1)}px) scale(${s.P.x.toFixed(4)}, ${(s.P.x * sy).toFixed(4)})`;
}

function run(lens, s) {
  if (s.raf) return;
  s.last = performance.now();
  const frame = (now) => {
    const dt = Math.min((now - s.last) / 1000, 1 / 30); s.last = now;
    for (let k = 0; k < 4; k++) { const h = dt / 4; step(s.L, h); step(s.R, h); step(s.P, h); }
    draw(lens, s);
    s.raf = (!rest(s.L) || !rest(s.R) || !rest(s.P)) && lens.isConnected ? requestAnimationFrame(frame) : 0;
  };
  s.raf = requestAnimationFrame(frame);
}

/* lens: the bubble (.navlens, .rowlens); x, w: where it must stand (left edge, width); opts.drag: a finger holds it;
   opts.lead / opts.trail: own springs ("Tab pill": 620/40 and 170/19); opts.squash: false keeps the height (a tab pill only stretches); opts.axis: "y" for a column (x, w then mean top, height) */
export function lensTo(lens, x, w, { drag = false, swell = drag, swellTo = 1.12, lead: ld, trail: tr, squash = true, axis = "x" } = {}) {
  let s = lens._rb;
  if (!s) { // the first placement: just stand there
    s = lens._rb = { L: spring(x, HOLD), R: spring(x + w, HOLD), P: spring(1, POP), w, squash, axis, raf: 0, last: 0 };
    lens.classList.add("rb"); draw(lens, s); return;
  }
  s.w = w; s.squash = squash; s.axis = axis;
  if (calmMotion()) { // «Зменшити анімацію»: no stretching, it just moves
    s.L.x = s.L.t = x; s.R.x = s.R.t = x + w; s.L.v = s.R.v = 0; s.P.x = s.P.t = 1; draw(lens, s); return;
  }
  const mid = (s.L.x + s.R.x) / 2, dir = Math.abs(x + w / 2 - mid) < 2 ? 0 : Math.sign(x + w / 2 - mid);
  const lead = ld || (drag ? DLEAD : LEAD), trail = tr || (drag ? DTRAIL : TRAIL);
  if (dir === 0) { tune(s.L, HOLD); tune(s.R, HOLD); }
  else { const [l, r] = dir > 0 ? [trail, lead] : [lead, trail]; tune(s.L, l); tune(s.R, r); }
  s.L.t = x; s.R.t = x + w;
  s.P.t = swell ? swellTo : 1;
  run(lens, s);
}
