// Skybee — "Goo menu" on the round ✏️ button (motion study from designbookmark.com).
// A tap pours liquid bubbles out of the button. Bubbles are springs; in the Skybee style an SVG goo filter fuses
// them while they are close, so they peel off like drops; in Liquid Glass they are glass drops. A bubble can be
// dragged on a rubber band, and a tap on it pulls everything back in and runs the action. Material is left alone.
// Springs: out 230/15, in 520/34, release 300/12, stagger 45 ms, radius 112 px, goo blur 10 (designbookmark tokens.css).
import { spring, tune, step, rest, clamp } from "./spring.js";

const OUT = [230, 15], IN = [520, 34], REL = [300, 12], FOLLOW = [900, 50];
const STAGGER = .045, RADIUS = 112, BS = 48, OX = 210, OY = 210, MS = 56;
const ANGLES = [-178, -148, -118, -88]; // the button sits in the bottom-right corner: bubbles go left and up
const svg = (p, sw = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const band = (r, d = 70) => d * (1 - 1 / (r * .55 / d + 1)); // rubber band

export const GOO_ACTIONS = [
  ["post", "Новий пост", '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>'],
  ["photo", "Фото", '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m20 15-4.5-4.5L6 19"/>'],
  ["gif", "GIF", '<rect x="3.5" y="6" width="17" height="12" rx="3"/><path d="M10 10.5H8.2a1.2 1.2 0 0 0-1.2 1.2v.6a1.2 1.2 0 0 0 1.2 1.2H10v-1.2H8.8M12.5 10v4M15 14v-4h2"/>'],
  ["drafts", "Чернетки", '<path d="M6 4h9l3 3v13H6z"/><path d="M9 10h6M9 13.5h6M9 17h3.5"/>'],
];

/* fab: the round button; run(id): does the chosen action; on(): is the menu on in the current look */
export function gooMenu(fab, run, { on = () => true, actions = GOO_ACTIONS, angles = ANGLES, blob = true, cross = true } = {}) {
  if (!document.getElementById("sb-goo-svg")) {
    document.body.insertAdjacentHTML("beforeend", `<svg id="sb-goo-svg" width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="sb-goo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></svg>`);
  }
  const root = document.createElement("div"); root.className = "goo"; root.hidden = true;
  const layer = document.createElement("div"); layer.className = "goo-layer";
  const ui = document.createElement("div"); ui.className = "goo-ui";
  root.append(layer, ui); document.body.appendChild(root);
  if (cross) fab.insertAdjacentHTML("beforeend", `<span class="gx" aria-hidden="true">${svg('<path d="M6 6l12 12M18 6 6 18"/>', 2.2)}</span>`);

  const mainBlob = document.createElement("div"); mainBlob.className = "blob main"; if (blob) layer.appendChild(mainBlob);
  const MB = spring(1, [520, 16]);
  const home = angles.map(d => ({ x: Math.cos(d * Math.PI / 180) * RADIUS, y: Math.sin(d * Math.PI / 180) * RADIUS }));
  const bubs = actions.map(([id, label, path]) => {
    const blob = document.createElement("div"); blob.className = "blob"; layer.appendChild(blob);
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "gbtn"; btn.tabIndex = -1; btn.setAttribute("aria-label", label);
    btn.innerHTML = `${svg(path)}<span class="gtip">${label}</span>`; ui.appendChild(btn);
    return { id, blob, btn, x: spring(0, OUT), y: spring(0, OUT), s: spring(.5, [420, 22]), pending: null, drag: null };
  });

  let open = false, raf = 0, last = 0, cx = 0, cy = 0, closing = 0;
  const sendTo = (b, delay, pos, kc) => { b.pending = { t: delay, pos, kc }; };

  function place() { const r = fab.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; root.style.transform = `translate(${cx}px,${cy}px)`; }

  function setOpen(v) {
    if (v === open) return;
    open = v; fab.classList.toggle("goo-open", v); fab.setAttribute("aria-expanded", v);
    if (v) { place(); root.hidden = false; root.dataset.mode = document.documentElement.dataset.ui || "skybee"; }
    MB.v -= v ? 3 : 1.6;
    bubs.forEach((b, i) => {
      b.btn.tabIndex = v ? 0 : -1;
      if (v) { sendTo(b, i * STAGGER, home[i], OUT); b.s.t = 1; tune(b.s, [300, 14]); }
      else { sendTo(b, (bubs.length - 1 - i) * STAGGER * .66, { x: 0, y: 0 }, IN); b.s.t = .5; tune(b.s, [420, 30]); b.btn.classList.remove("hover"); }
    });
    wake();
  }

  bubs.forEach((b, i) => {
    const btn = b.btn;
    btn.addEventListener("pointerenter", () => { if (!open) return; btn.classList.add("hover"); b.s.t = 1.14; tune(b.s, [500, 18]); wake(); });
    btn.addEventListener("pointerleave", () => { btn.classList.remove("hover"); if (open && !b.drag) { b.s.t = 1; wake(); } });
    btn.addEventListener("pointerdown", e => {
      if (!open) return;
      b.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, live: false };
      try { btn.setPointerCapture(e.pointerId); } catch {}
      btn.classList.add("hover"); b.s.t = .92; wake();
    });
    btn.addEventListener("pointermove", e => {
      const d = b.drag; if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0, r = Math.hypot(dx, dy);
      if (!d.live && r > 4) { d.live = true; b.s.t = 1.08; btn.classList.remove("hover"); }
      if (!d.live) return;
      const k = band(r) / (r || 1);
      b.pending = null; tune(b.x, FOLLOW); tune(b.y, FOLLOW);
      b.x.t = home[i].x + dx * k; b.y.t = home[i].y + dy * k; wake();
    });
    const up = e => {
      const d = b.drag; if (!d || d.id !== e.pointerId) return;
      b.drag = null; btn.classList.remove("hover");
      if (d.live) { tune(b.x, REL); tune(b.y, REL); b.x.t = home[i].x; b.y.t = home[i].y; b.s.t = 1; } // let go: it snaps home with a wobble
      else if (e.type === "pointerup") choose(b);
      wake();
    };
    btn.addEventListener("pointerup", up); btn.addEventListener("pointercancel", up);
    btn.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(b); } });
    btn.addEventListener("click", e => e.stopPropagation());
  });

  function choose(b) { b.s.t = 1; b.s.v += 4; setTimeout(() => setOpen(false), 80); clearTimeout(closing); closing = setTimeout(() => run(b.id), 200); wake(); }

  // the round button: on a tap it opens the menu (in the Material look it stays a plain button)
  fab.addEventListener("click", e => {
    if (!on()) return;
    e.stopImmediatePropagation(); e.preventDefault();
    setOpen(!open);
  }, true);
  const away = e => { if (open && !root.contains(e.target) && !fab.contains(e.target)) setOpen(false); };
  const esc = e => { if (open && e.key === "Escape") setOpen(false); };
  const hash = () => setOpen(false);
  document.addEventListener("pointerdown", away); addEventListener("keydown", esc); addEventListener("hashchange", hash);

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    if (open || !root.hidden) place();
    let busy = open || !rest(MB);
    for (let k = 0; k < 4; k++) {
      const h = dt / 4;
      step(MB, h);
      bubs.forEach(b => {
        if (b.pending && (b.pending.t -= h) <= 0) { const p = b.pending; b.pending = null; tune(b.x, p.kc); tune(b.y, p.kc); b.x.t = p.pos.x; b.y.t = p.pos.y; }
        step(b.x, h); step(b.y, h); step(b.s, h);
      });
    }
    bubs.forEach(b => { if (b.pending || !rest(b.x) || !rest(b.y) || !rest(b.s)) busy = true; });
    mainBlob.style.transform = `translate(${OX - MS / 2}px,${OY - MS / 2}px) scale(${MB.x.toFixed(3)})`;
    bubs.forEach(b => {
      const x = OX + b.x.x - BS / 2, y = OY + b.y.x - BS / 2, sc = b.s.x;
      const sp = Math.hypot(b.x.v, b.y.v), st = 1 + Math.min(sp / 2600, .32), a = Math.atan2(b.y.v, b.x.v); // squash and stretch along the move
      const vis = clamp((Math.hypot(b.x.x, b.y.x) - 18) / 40, 0, 1);
      b.blob.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${a.toFixed(3)}rad) scale(${(sc * st).toFixed(3)},${(sc / st).toFixed(3)})`;
      b.btn.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      b.btn.style.opacity = b.blob.style.opacity = vis.toFixed(3);
      b.btn.style.pointerEvents = open ? "auto" : "none";
    });
    if (!busy) { root.hidden = true; raf = 0; return; }
    raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  return { close: () => setOpen(false), get isOpen() { return open; }, destroy() { document.removeEventListener("pointerdown", away); removeEventListener("keydown", esc); removeEventListener("hashchange", hash); cancelAnimationFrame(raf); root.remove(); } };
}
