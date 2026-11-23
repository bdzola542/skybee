// Skybee — "Jelly slider" with steps (motion study from designbookmark.com): a thumb that follows the finger on a spring
// (900/50), a value bubble that rises out of it while it is held (420/22), and a wobble when it snaps to a step on release (300/14).
// items: [[value, label], …]; onChange(value) is called once, when the thumb lets go on a step.
import { spring, tune, step, rest, clamp } from "./spring.js";

const FOLLOW = [900, 50], BUBBLE = [420, 22], RELEASE = [300, 14];
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function jellySlider(host, { items, value, onChange, label = "" }) {
  host.classList.add("jsl");
  host.innerHTML = `<div class="jsl-bar"><div class="jsl-track"></div><div class="jsl-fill"></div><div class="jsl-thumb" role="slider" tabindex="0" aria-label="${esc(label)}"><span class="jsl-bub" aria-hidden="true"></span></div></div>
    <div class="jsl-lbls">${items.map(([v, l], i) => `<button type="button" class="jsl-l" data-i="${i}">${esc(l)}</button>`).join("")}</div>`;
  const bar = host.querySelector(".jsl-bar"), fill = host.querySelector(".jsl-fill"), thumb = host.querySelector(".jsl-thumb"), bub = host.querySelector(".jsl-bub");
  const lbls = [...host.querySelectorAll(".jsl-l")];
  const N = items.length;
  let cur = Math.max(items.findIndex(([v]) => String(v) === String(value)), 0), drag = null, raf = 0, last = 0, W = 0;
  const X = spring(0, FOLLOW), B = spring(0, BUBBLE);
  const px = (i) => N > 1 ? (i / (N - 1)) * W : 0;
  const measure = () => { W = bar.clientWidth - 26; X.x = X.t = px(cur); }; // 26 = the thumb
  const text = () => { bub.textContent = items[cur][1]; thumb.setAttribute("aria-valuetext", items[cur][1]); thumb.setAttribute("aria-valuenow", cur); thumb.setAttribute("aria-valuemin", 0); thumb.setAttribute("aria-valuemax", N - 1); lbls.forEach((b, i) => b.classList.toggle("on", i === cur)); };
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { step(X, dt / 4); step(B, dt / 4); }
    thumb.style.transform = `translateX(${X.x.toFixed(2)}px)`;
    fill.style.width = (X.x + 13).toFixed(2) + "px";
    const b = clamp(B.x, 0, 1.25);
    bub.style.opacity = clamp(B.x, 0, 1).toFixed(3); bub.style.transform = `translate(-50%, ${(-6 - 14 * b).toFixed(1)}px) scale(${(.5 + .5 * b).toFixed(3)})`;
    // the thumb squashes along the way it moves (jelly)
    const sp = Math.min(Math.abs(X.v) / 2400, .3); thumb.style.setProperty("--sx", (1 + sp).toFixed(3)); thumb.style.setProperty("--sy", (1 - sp * .6).toFixed(3));
    raf = (!rest(X) || !rest(B) || drag) ? requestAnimationFrame(frame) : 0;
  };
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const choose = (i) => { i = clamp(i, 0, N - 1); const changed = i !== cur; cur = i; text(); tune(X, RELEASE); X.t = px(i); wake(); if (changed) onChange?.(items[i][0]); };
  const nearest = (x) => N > 1 ? clamp(Math.round(x / W * (N - 1)), 0, N - 1) : 0;
  const local = (e) => clamp(e.clientX - bar.getBoundingClientRect().left - 13, 0, W);

  bar.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    drag = { id: e.pointerId, from: cur }; try { bar.setPointerCapture(e.pointerId); } catch {}
    tune(X, FOLLOW); X.t = local(e); B.t = 1;
    const i = nearest(X.t); if (i !== cur) { cur = i; text(); }
    wake();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    X.t = local(e); const i = nearest(X.t); if (i !== cur) { cur = i; text(); navigator.vibrate?.(4); }
  });
  const up = (e) => { if (!drag || drag.id !== e.pointerId) return; const from = drag.from; drag = null; B.t = 0; const i = nearest(X.t); cur = i; text(); tune(X, RELEASE); X.t = px(i); wake(); if (i !== from) onChange?.(items[i][0]); };
  bar.addEventListener("pointerup", up); bar.addEventListener("pointercancel", up);
  thumb.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return;
    e.preventDefault(); B.t = 1; choose(cur + d); setTimeout(() => { B.t = 0; wake(); }, 700);
  });
  lbls.forEach((b) => b.addEventListener("click", () => choose(+b.dataset.i)));
  addEventListener("resize", () => { measure(); wake(); });
  text(); requestAnimationFrame(() => { measure(); wake(); });
}
