// Skybee — "Glass lens" for the photo viewer (motion study from designbookmark.com): a round glass magnifier chases the pointer a little
// lazily (180/17, like a drop of water), magnifies 1.7× at rest and 2.4× while pressed. A button of the viewer turns it on and off.
import { spring, tune, step, rest, clamp } from "./spring.js";

const FOLLOW = [180, 17], ZOOM = [300, 20], SIZE = 150, Z = 1.7, ZP = 2.4;

/* root: the viewer window; img: the photo element; returns { toggle(), isOn(), destroy() } */
export function glassLens(root, img) {
  const lens = document.createElement("div"); lens.className = "glens"; lens.setAttribute("aria-hidden", "true"); lens.hidden = true; root.appendChild(lens);
  const X = spring(0, FOLLOW), Y = spring(0, FOLLOW), Zs = spring(Z, ZOOM), A = spring(0, [420, 32]);
  let on = false, raf = 0, last = 0, pressed = false, px = 0, py = 0, seen = false;
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { step(X, dt / 4); step(Y, dt / 4); step(Zs, dt / 4); step(A, dt / 4); }
    if (!lens.isConnected) { raf = 0; return; } // the viewer was closed
    const r = img.getBoundingClientRect(), z = Zs.x;
    lens.style.transform = `translate(${(X.x - SIZE / 2).toFixed(1)}px, ${(Y.x - SIZE / 2).toFixed(1)}px) scale(${(.7 + .3 * clamp(A.x, 0, 1)).toFixed(3)})`;
    lens.style.opacity = clamp(A.x, 0, 1).toFixed(3);
    const src = img.currentSrc || img.src; if (/^(https?:|blob:|data:image\/)/i.test(src)) lens.style.backgroundImage = `url("${src.replace(/["\\\n]/g, encodeURIComponent)}")`;
    lens.style.backgroundSize = `${(r.width * z).toFixed(1)}px ${(r.height * z).toFixed(1)}px`;
    lens.style.backgroundPosition = `${(SIZE / 2 - (X.x - r.left) * z).toFixed(1)}px ${(SIZE / 2 - (Y.x - r.top) * z).toFixed(1)}px`;
    raf = on && (seen || !rest(A)) || !rest(X) || !rest(Y) || !rest(Zs) || !rest(A) ? requestAnimationFrame(frame) : 0;
    if (!on && A.x < .02) lens.hidden = true;
  };
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const inside = (x, y) => { const r = img.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const move = (e) => {
    if (!on) return;
    px = e.clientX; py = e.clientY;
    if (inside(px, py)) { if (!seen) { X.x = X.t = px; Y.x = Y.t = py; seen = true; } X.t = px; Y.t = py; A.t = 1; } else { A.t = 0; seen = false; }
    wake();
  };
  const down = (e) => { if (!on) return; pressed = true; Zs.t = ZP; move(e); };
  const up = () => { pressed = false; Zs.t = Z; wake(); };
  root.addEventListener("pointermove", move); root.addEventListener("pointerdown", down); root.addEventListener("pointerup", up); root.addEventListener("pointercancel", up);
  root.addEventListener("pointerleave", () => { A.t = 0; seen = false; wake(); });
  return {
    toggle() { on = !on; lens.hidden = false; tune(X, FOLLOW); A.t = on && seen ? 1 : 0; root.classList.toggle("lens-on", on); wake(); return on; },
    isOn: () => on,
    destroy() { cancelAnimationFrame(raf); lens.remove(); },
  };
}
