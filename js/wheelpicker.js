// Skybee — "Wheel picker": an iOS-style drum picker, rebuilt in plain JS from Kokonut UI's wheel-picker (MIT).
// Each column is a real 3D cylinder: rows sit round it with rotateX() translateZ() and the whole drum turns with one
// transform. The drum is drawn twice — muted, and in full colour clipped to the selection band — so the text lights
// up exactly where it crosses the band. Same movement as the original: a settle spring of 0.4 s / bounce .15
// (≈ stiffness 247, damping 26.7), a flick that coasts COAST 0.32 s of release speed to a whole row on a 140/24 spring,
// rubber overscroll (1.2 rows) past the ends of a non-looping wheel, tap on a row to turn to it, keyboard, mouse wheel,
// and a 1 ms haptic tick per row on touch.
import { calmMotion } from "./ui.js";

const ITEM_HEIGHT = 36, ITEM_ANGLE = 20;
const RADIUS = Math.round((ITEM_HEIGHT / 2 / Math.tan((ITEM_ANGLE / 2) * Math.PI / 180)) * 100) / 100;
const WINDOW = Math.ceil(90 / ITEM_ANGLE);
const VIEW_HEIGHT = Math.round(RADIUS * 2) + ITEM_HEIGHT / 2;
const MAX_OVERSCROLL = 1.2, VELOCITY_WINDOW_MS = 80, TAP_SLOP = 4, COAST = 0.32;
const SETTLE = { k: 247, c: 26.7, rest: .001 }, FLICK = { k: 140, c: 24, rest: .005 };
const mod = (n, m) => ((n % m) + m) % m;
const damp = (d, max) => max * (1 - Math.exp(-d / max));
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* host: element to fill; columns: [{ id, label, options: [{ value, label }], loop, width }]; value: { [id]: optionValue };
   onChange(value): once a wheel comes to rest on a new option */
export function wheelPicker(host, { columns, value = {}, onChange, label = "" }) {
  const vals = { ...value };
  host.classList.add("wp"); host.setAttribute("role", "group"); if (label) host.setAttribute("aria-label", label);
  host.innerHTML = `<div class="wp-band" aria-hidden="true"></div><span class="wp-tick l" aria-hidden="true"></span><span class="wp-tick r" aria-hidden="true"></span>`;
  const select = (id, v) => { if (vals[id] === v) return; vals[id] = v; onChange?.({ ...vals }); };
  const cols = columns.map((col) => column(col, vals[col.id], (v) => select(col.id, v)));
  cols.forEach(c => host.appendChild(c.el));
  return { get: () => ({ ...vals }), destroy: () => cols.forEach(c => c.destroy()) };
}

function column(def, selected, onSelect) {
  const { options, loop = false } = def, count = options.length;
  const el = document.createElement("div");
  el.className = "wp-col"; el.tabIndex = 0; el.setAttribute("role", "spinbutton"); el.setAttribute("aria-label", def.label);
  el.style.height = VIEW_HEIGHT + "px"; if (def.width) el.style.width = def.width;
  el.innerHTML = `<div class="wp-mask"><div class="wp-drum" aria-hidden="true"><div class="wp-turn"></div></div><div class="wp-drum clip" aria-hidden="true"><div class="wp-turn"></div></div></div>`;
  const turns = [...el.querySelectorAll(".wp-turn")];
  const idx0 = Math.max(options.findIndex(o => o.value === selected), 0);
  let p = idx0, v = 0, anim = null, raf = 0, last = 0, center = null, pointer = "mouse", drag = null, timer = 0;

  const optionAt = (i) => options[mod(i, count)];
  const clampIndex = (i) => loop ? i : Math.min(Math.max(i, 0), count - 1);
  const sync = () => {
    const sel = mod(Math.round(p), count);
    el.setAttribute("aria-valuemin", 0); el.setAttribute("aria-valuemax", count - 1); el.setAttribute("aria-valuenow", sel); el.setAttribute("aria-valuetext", options[sel].label);
  };
  function rowsFor(c) {
    let html = "";
    for (let i = c - WINDOW; i <= c + WINDOW; i++) {
      if (!loop && (i < 0 || i >= count)) continue;
      html += `<div class="wp-row" style="transform:rotateX(${-i * ITEM_ANGLE}deg) translateZ(${RADIUS}px)">${esc(optionAt(i).label)}</div>`;
    }
    return html;
  }
  function draw() {
    const r = Math.round(p);
    if (r !== center) { center = r; turns.forEach(t => { t.innerHTML = rowsFor(r); }); sync(); if (pointer === "touch") navigator.vibrate?.(1); }
    const tr = `translateZ(${-RADIUS}px) rotateX(${(p * ITEM_ANGLE).toFixed(3)}deg)`;
    turns.forEach(t => { t.style.transform = tr; });
  }
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    if (anim) {
      for (let k = 0; k < 4; k++) { const h = dt / 4; v += (-anim.k * (p - anim.target) - anim.c * v) * h; p += v * h; }
      if (Math.abs(p - anim.target) < anim.rest && Math.abs(v) < .05) { const a = anim; p = a.target; v = 0; anim = null; draw(); onSelect(optionAt(Math.round(p)).value); }
    }
    draw();
    raf = anim ? requestAnimationFrame(frame) : 0;
  }
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { anim = null; };
  const settleNow = () => { onSelect(optionAt(Math.round(p)).value); };
  const goTo = (target) => {
    stop();
    if (calmMotion()) { p = target; v = 0; draw(); settleNow(); return; }
    anim = { target, ...SETTLE }; wake();
  };
  const overscroll = (raw) => loop ? raw : raw < 0 ? -damp(-raw, MAX_OVERSCROLL) : raw > count - 1 ? count - 1 + damp(raw - (count - 1), MAX_OVERSCROLL) : raw;

  el.addEventListener("pointerdown", (e) => {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    stop(); pointer = e.pointerType;
    try { el.setPointerCapture(e.pointerId); } catch {}
    drag = { id: e.pointerId, startY: e.clientY, startP: p, moved: false, samples: [{ t: e.timeStamp, v: p }] };
  });
  el.addEventListener("pointermove", (e) => {
    const d = drag; if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < TAP_SLOP) return;
    d.moved = true;
    const raw = d.startP - dy / ITEM_HEIGHT;
    p = overscroll(raw); draw();
    d.samples.push({ t: e.timeStamp, v: raw });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > VELOCITY_WINDOW_MS) d.samples.shift();
  });
  const up = (e) => {
    const d = drag; if (!d || d.id !== e.pointerId) return;
    drag = null;
    if (!d.moved && e.type !== "pointerup") { goTo(clampIndex(Math.round(p))); return; }
    if (!d.moved) { // a tap: turn to the row under the finger (asin undoes the drum's foreshortening)
      const r = el.getBoundingClientRect(), ratio = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / RADIUS));
      goTo(clampIndex(Math.round(p) + Math.round(Math.asin(ratio) * 180 / Math.PI / ITEM_ANGLE)));
      return;
    }
    const first = d.samples[0], lastS = d.samples[d.samples.length - 1] || first, elapsed = (lastS.t - first.t) / 1000;
    const paused = e.timeStamp - lastS.t > VELOCITY_WINDOW_MS; // holding still before letting go is a placement, not a flick
    const vel = elapsed > 0 && !paused ? (lastS.v - first.v) / elapsed : 0;
    const out = !loop && (p < 0 || p > count - 1);
    if (calmMotion() || out || Math.abs(vel) < 2) { goTo(clampIndex(Math.round(p))); return; }
    stop(); v = vel; // a flick: project where it coasts to, land on a whole row, spring there carrying the release speed
    anim = { target: clampIndex(Math.round(p + vel * COAST)), ...FLICK }; wake();
  };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);

  el.addEventListener("keydown", (e) => { // keyboard steps are instant: they repeat quickly
    const i = Math.round(p), moves = { ArrowUp: 1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
    let t;
    if (e.key === "Home") t = i - mod(i, count);
    else if (e.key === "End") t = i - mod(i, count) + count - 1;
    else if (e.key in moves) t = clampIndex(i + moves[e.key]);
    else return;
    e.preventDefault(); stop(); pointer = "keyboard"; p = t; v = 0; draw(); settleNow();
  });
  el.addEventListener("wheel", (e) => { // mouse wheel / trackpad turns the drum, then it settles on the nearest row
    e.preventDefault(); stop(); pointer = "mouse";
    const raw = p + (e.deltaY / ITEM_HEIGHT) * .4;
    p = loop ? raw : Math.min(Math.max(raw, -.4), count - 1 + .4); draw();
    clearTimeout(timer); timer = setTimeout(() => goTo(clampIndex(Math.round(p))), 120);
  }, { passive: false });

  draw();
  return { el, destroy: () => { cancelAnimationFrame(raf); clearTimeout(timer); } };
}
