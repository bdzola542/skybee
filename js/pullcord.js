// Skybee — "Pull cord": a bulb on a cord that switches the theme (motion study from designbookmark.com). Pull the cord down past
// 34 px and let go: the light goes on or off (dark ↔ light); the cord is a spring (300/12) and swings back with a wobble.
import { spring, tune, step, rest, clamp } from "./spring.js";
import { calmMotion } from "./ui.js";

const REST = 40, PULL = 34, FOLLOW = [900, 50], BACK = [300, 12];

/* host: where the cord hangs; lit(): is the light on now (the light theme); toggle(): switch it */
export function pullCord(host, { lit, toggle }) {
  host.classList.add("cord");
  host.innerHTML = `<svg viewBox="0 0 60 150" aria-hidden="true"><line class="cord-l" x1="30" y1="0" x2="30" y2="${REST}"/><g class="cord-b"><circle class="cord-halo" cx="30" cy="0" r="26"/><path class="cord-g" d="M22 -2 a8 8 0 1 1 16 0 c0 4 -2 6 -3 9 h-10 c-1 -3 -3 -5 -3 -9z"/><rect class="cord-c" x="26" y="7" width="8" height="6" rx="2"/></g></svg>
    <button type="button" class="cord-btn" aria-label="Увімкнути чи вимкнути світло: тема світла чи темна"></button>`;
  const line = host.querySelector(".cord-l"), bulb = host.querySelector(".cord-b"), btn = host.querySelector(".cord-btn");
  const Y = spring(REST, BACK);
  let drag = null, raf = 0, last = 0, fired = false;
  const draw = () => {
    line.setAttribute("y2", Y.x.toFixed(1)); bulb.setAttribute("transform", `translate(0 ${(Y.x + 8).toFixed(1)})`);
    host.classList.toggle("lit", lit());
  };
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) step(Y, dt / 4);
    draw();
    raf = drag || !rest(Y) ? requestAnimationFrame(frame) : 0;
  };
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const pull = () => { if (fired) return; fired = true; toggle(); draw(); };
  btn.addEventListener("pointerdown", (e) => {
    drag = { id: e.pointerId, y0: e.clientY }; fired = false; try { btn.setPointerCapture(e.pointerId); } catch {}
    tune(Y, FOLLOW); wake();
  });
  btn.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = clamp(e.clientY - drag.y0, 0, 70);
    Y.t = REST + d * .8;
    if (d >= PULL * 1.3) navigator.vibrate?.(8);
  });
  const up = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const pulled = Y.t - REST >= PULL * .8 || Y.x - REST >= PULL * .8; drag = null;
    tune(Y, BACK); Y.t = REST; wake();
    if (pulled) pull(); // the light switches when the cord is let go
  };
  btn.addEventListener("pointerup", up); btn.addEventListener("pointercancel", up);
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); Y.v += calmMotion() ? 0 : 520; Y.t = REST; wake(); pull(); setTimeout(() => { fired = false; }, 300); } });
  draw();
  return { refresh: draw };
}
