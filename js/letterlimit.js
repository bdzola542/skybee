// Skybee — "Letter limit": a hard limit you can see (motion study from designbookmark.com).
// Whatever would go past the limit is cut off the end and thrown out as letters: they hop, fall with weight and spin,
// bounce once and pile up under the window. The ring fills as you type, turns gold near the limit and red at it, and
// every refused letter shakes it. Delete text and the pile shrinks, one letter per freed place.
import { calmMotion } from "./ui.js";
import { spring, step, rest, clamp, SPRING } from "./spring.js";

const NEAR = 20, BIN = 10, MAXP = 46;
const segs = (s) => { try { return [...new Intl.Segmenter().segment(s)].map(x => x.segment); } catch { return [...s]; } };

/* counter: the .counter element (becomes ring + number); ta: the textarea; floorOf(): element whose bottom the pile lies under */
export function letterLimit(counter, ta, { limit = 300, floorOf = () => ta } = {}) {
  counter.classList.add("llcount");
  counter.innerHTML = `<svg class="llmeter" viewBox="0 0 24 24" aria-hidden="true"><circle class="lltrack" cx="12" cy="12" r="9"/><circle class="llfill" cx="12" cy="12" r="9" pathLength="1"/></svg><span class="cnum"></span>`;
  const meter = counter.firstChild, fill = meter.querySelector(".llfill"), num = counter.querySelector(".cnum");
  const layer = document.createElement("div"); layer.className = "llpile"; layer.setAttribute("aria-hidden", "true"); document.body.appendChild(layer);
  const probe = document.createElement("div"); probe.setAttribute("aria-hidden", "true"); ta.parentNode.appendChild(probe);

  const F = spring(0, SPRING.settle), CP = spring(1, SPRING.pop), SH = spring(0, [700, 12]);
  let letters = [], bins = {}, len = 0, raf = 0, last = 0, floorY = 0, W = innerWidth;

  const measure = () => {
    W = innerWidth;
    const r = floorOf().getBoundingClientRect();
    floorY = Math.min(r.bottom + 40, innerHeight - 14);
  };
  addEventListener("resize", measure);

  // where the next letter would have gone: a hidden copy of the text with a marker at its end
  function endOfText() {
    const cs = getComputedStyle(ta);
    probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;width:${ta.clientWidth}px;font:${cs.font};letter-spacing:${cs.letterSpacing};line-height:${cs.lineHeight};padding:${cs.padding}`;
    probe.textContent = ta.value;
    const m = document.createElement("span"); m.textContent = "​"; probe.appendChild(m);
    const p = ta.getBoundingClientRect(), r = m.getBoundingClientRect(), o = probe.getBoundingClientRect();
    return [clamp(p.left + r.left - o.left, p.left, p.right), clamp(p.top + r.top - o.top - ta.scrollTop + 10, p.top, p.bottom)];
  }

  function drop(chars) {
    if (calmMotion()) return; // with "reduce animation" the text is just cut
    measure();
    const [x, y] = endOfText();
    [...chars].forEach((ch, i) => {
      if (!ch.trim()) return;
      const el = document.createElement("span"); el.textContent = ch; layer.appendChild(el);
      letters.push({ el, x: x + 4 + i * 9, y, vx: -40 + Math.random() * 150, vy: -150 - Math.random() * 110, r: 0, vr: (Math.random() - .5) * 720, rest: false, out: 0, s: 1, bin: null, hits: 0 });
    });
    while (letters.filter(l => !l.out).length > MAXP) leave(letters.find(l => !l.out));
    SH.v += 34; CP.x = 1.25; wake();
  }
  // a letter is cleared from the pile
  function leave(l) {
    if (!l || l.out) return;
    l.out = .001; l.vy = -230; l.rest = false;
    if (l.bin != null) bins[l.bin] = Math.max(0, (bins[l.bin] || 0) - 1);
  }

  // call on every input, before the counter is updated: cuts what does not fit and throws it out
  function cut() {
    const a = segs(ta.value);
    if (a.length <= limit) return;
    const caret = ta.selectionStart, keep = a.slice(0, limit).join(""), extra = a.slice(limit).join("");
    ta.value = keep;
    if (document.activeElement === ta) { const c = Math.min(caret, keep.length); ta.setSelectionRange(c, c); }
    drop(extra);
  }
  // n: how many characters there are now
  function set(n) {
    const was = len; len = n;
    if (n < was) { const live = letters.filter(l => !l.out); for (let i = 0; i < Math.min(was - n, live.length); i++) leave(live[live.length - 1 - i]); }
    if (n !== was) CP.x = Math.max(CP.x, 1.12);
    const left = limit - n;
    num.textContent = left;
    counter.classList.toggle("is-near", left <= NEAR && left > 0);
    counter.classList.toggle("is-full", left <= 0);
    F.t = clamp(n / limit, 0, 1);
    wake();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { const h = dt / 4; step(F, h); step(CP, h); step(SH, h); }
    let busy = !rest(F) || !rest(CP) || !rest(SH);
    letters.forEach(l => {
      if (l.out) { l.out += dt; l.vy += 900 * dt; l.y += l.vy * dt; l.s = Math.max(0, 1 - l.out / .32); busy = true; return; }
      if (l.rest) return;
      busy = true;
      l.vy += 1900 * dt; l.x += l.vx * dt; l.y += l.vy * dt; l.r += l.vr * dt;
      if (l.x < 14) { l.x = 14; l.vx = Math.abs(l.vx) * .5; } else if (l.x > W - 14) { l.x = W - 14; l.vx = -Math.abs(l.vx) * .5; }
      const b = Math.round(l.x / BIN), ground = floorY - (bins[b] || 0) * 9;
      if (l.y >= ground && l.vy > 0) {
        l.y = ground;
        if (l.hits++ < 1 && l.vy > 260) { l.vy *= -.3; l.vx *= .6; l.vr *= .5; }
        else { l.rest = true; l.bin = b; bins[b] = Math.min(3, (bins[b] || 0) + 1); l.r = Math.round(l.r / 90) * 90 + (Math.random() - .5) * 34; l.el.classList.add("is-down"); }
      }
    });
    letters = letters.filter(l => { if (l.out > .34) { l.el.remove(); return false; } return true; });
    fill.style.strokeDashoffset = (1 - clamp(F.x, 0, 1)).toFixed(4);
    const sh = SH.x * .5;
    num.style.transform = `translateX(${sh.toFixed(2)}px) scale(${CP.x.toFixed(4)})`;
    meter.style.transform = `translateX(${sh.toFixed(2)}px) rotate(-90deg)`;
    letters.forEach(l => { l.el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px) rotate(${l.r.toFixed(1)}deg) scale(${l.s.toFixed(3)})`; });
    raf = busy ? requestAnimationFrame(frame) : 0;
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function destroy() { cancelAnimationFrame(raf); raf = 0; removeEventListener("resize", measure); layer.remove(); probe.remove(); }

  return { cut, set, destroy };
}
