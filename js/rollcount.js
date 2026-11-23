// Skybee — "Rolling counter": a number that changes rolls digit by digit (motion study from designbookmark.com).
// Each digit is a drum on a spring (260/22); a carry ripples to the left with 60 ms between digits.
// Used for the counters under a post, the badges of the menu, and anywhere a number changes under the finger.
import { calmMotion } from "./ui.js";
import { spring, step, rest } from "./spring.js";

const DRUM = [260, 22];

function drums(el, text, startText) {
  el.textContent = "";
  el.classList.add("rolling");
  const list = [], start = [...startText];
  [...text].forEach((ch, k) => {
    if (!/\d/.test(ch)) { const s = document.createElement("span"); s.textContent = ch; el.appendChild(s); return; }
    const dg = document.createElement("span"), col = document.createElement("span"); dg.className = "dg";
    for (let i = 0; i < 11; i++) { const n = document.createElement("i"); n.textContent = i % 10; col.appendChild(n); }
    dg.appendChild(col); el.appendChild(dg);
    list.push({ col, s: spring(+(start[k] ?? ch), DRUM), to: +ch });
  });
  return list;
}

/* el: the element holding the number; from / to: the old and the new text. Plain digits of the same length roll;
   anything else (1,2К → 1,3К, 99 → 100) pops in. */
export function roll(el, from, to) {
  to = String(to ?? ""); from = String(from ?? ""); el.dataset.v = to;
  if (from === to) { el.textContent = to; return; }
  const plain = /^\d+$/.test(to) && /^\d+$/.test(from) && from.length === to.length;
  if (!plain || calmMotion()) {
    el.textContent = to;
    if (!calmMotion() && el.animate) el.animate([{ transform: "translateY(55%) scale(.8)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" });
    return;
  }
  const list = drums(el, to, from);
  el.setAttribute("aria-label", to);
  const draw = () => list.forEach(d => { const m = ((d.s.x % 10) + 10) % 10; d.col.style.transform = `translateY(${(-m * 100 / 11).toFixed(3)}%)`; });
  draw();
  list.forEach((d, k) => setTimeout(() => {
    const cur = Math.round(d.s.t); let diff = ((d.to - cur) % 10 + 10) % 10;
    if (diff > 5) diff -= 10; // the short way round: 9 rolls on to 0 and back
    d.s.t = cur + diff; wake();
  }, (list.length - 1 - k) * 60));
  let raf = 0, last = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) list.forEach(d => step(d.s, dt / 4));
    draw();
    raf = list.some(d => !rest(d.s)) && el.isConnected ? requestAnimationFrame(frame) : 0;
    if (!raf && el.isConnected && el.dataset.v === to) { el.textContent = to; el.classList.remove("rolling"); } // at rest: plain text again (copyable, readable by screen readers)
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  wake();
}
