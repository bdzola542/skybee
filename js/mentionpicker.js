// Skybee — animated @mention list for the composer (spring motion from the "Mention picker" study).
// Each row has a y spring (its slot in the filtered list) and an opacity/scale spring: rows that stop matching
// fold away and the rest close up. The highlight has a lead edge and a trail edge, so it stretches when it moves.
// Springs are "stiffness damping" — the same numbers as designbookmark tokens.css.
import { calmMotion } from "./ui.js";

const SPRING = { soft: [260, 24], fade: [420, 32], lead: [620, 36], trail: [190, 19] };
const RH = 44, PAD = 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const spring = (x, [k, c]) => ({ x, v: 0, t: x, k, c });
// with "reduce animation" the spring is critically damped: it arrives without overshoot
const tune = (s) => { if (calmMotion()) s.c = 2 * Math.sqrt(s.k); };
const step = (s, dt) => { s.v += (-s.k * (s.x - s.t) - s.c * s.v) * dt; s.x += s.v * dt; };
const rest = (s) => Math.abs(s.x - s.t) < .02 && Math.abs(s.v) < .02;

/* box: the element the list lives in (.mentions); build(actor) → inner HTML of one row; onPick(actor) */
export function mentionPicker(box, { build, onPick }) {
  box.classList.add("mpick");
  box.setAttribute("role", "listbox");
  box.innerHTML = `<span class="mp-hl" aria-hidden="true"></span>`;
  const hl = box.firstChild;
  const H = spring(0, SPRING.soft), HA = spring(PAD, SPRING.lead), HB = spring(PAD, SPRING.trail);
  const rows = new Map(); // handle → row
  let list = [], act = 0, raf = 0, last = 0, open = false;

  const place = () => {
    const y = PAD + act * RH;
    HA.t = HB.t = y;
    list.forEach((a, i) => rows.get(a.handle)?.b.setAttribute("aria-selected", i === act));
  };

  function show(actors) {
    const prev = list[act]?.handle;
    list = actors.slice(0, 5);
    const keep = new Set(list.map(a => a.handle));
    list.forEach((a, i) => {
      let r = rows.get(a.handle);
      if (!r) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "mp-row"; b.setAttribute("role", "option"); b.tabIndex = -1;
        b.innerHTML = build(a);
        b.addEventListener("pointerdown", e => e.preventDefault()); // the text field keeps its focus
        b.addEventListener("click", () => { act = list.findIndex(x => x.handle === a.handle); if (act > -1) onPick(list[act]); });
        box.appendChild(b);
        r = { b, Y: spring(PAD + i * RH - 8, SPRING.soft), O: spring(0, SPRING.fade) };
        [r.Y, r.O].forEach(tune);
        rows.set(a.handle, r);
        if (!open) r.Y.x = r.Y.t = PAD + i * RH;
      }
      r.Y.t = PAD + i * RH; r.O.t = 1; r.gone = false;
    });
    rows.forEach((r, h) => { if (!keep.has(h)) { r.O.t = 0; r.gone = true; } });
    const same = list.findIndex(a => a.handle === prev);
    act = same > -1 ? same : 0;
    if (!open) { HA.x = HB.x = PAD + act * RH; }
    open = list.length > 0;
    H.t = open ? list.length * RH + PAD * 2 : 0;
    [H, HA, HB].forEach(tune);
    box.classList.toggle("is-open", open);
    place(); wake();
  }

  function hide() { if (!open && !rows.size) return; list = []; open = false; H.t = 0; rows.forEach(r => { r.O.t = 0; r.gone = true; }); box.classList.remove("is-open"); wake(); }
  function move(d) { if (!list.length) return; act = (act + d + list.length) % list.length; place(); wake(); }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) {
      const h = dt / 4;
      step(H, h); step(HA, h); step(HB, h);
      rows.forEach(r => { step(r.Y, h); step(r.O, h); });
    }
    box.style.height = Math.max(0, H.x).toFixed(1) + "px";
    box.style.opacity = clamp(H.x / 24, 0, 1).toFixed(3);
    hl.style.transform = `translateY(${Math.min(HA.x, HB.x).toFixed(1)}px)`;
    hl.style.height = (Math.abs(HA.x - HB.x) + RH).toFixed(1) + "px";
    hl.style.opacity = list.length ? 1 : 0;
    let moving = !rest(H) || !rest(HA) || !rest(HB);
    rows.forEach((r, h) => {
      const v = clamp(r.O.x, 0, 1);
      r.b.style.opacity = v.toFixed(3);
      r.b.style.transform = `translateY(${r.Y.x.toFixed(1)}px) scale(${(.92 + .08 * v).toFixed(3)})`;
      r.b.style.visibility = v < .01 ? "hidden" : "";
      if (r.gone && r.O.x < .01 && rest(r.O)) { r.b.remove(); rows.delete(h); } else if (!rest(r.Y) || !rest(r.O)) moving = true;
    });
    raf = moving ? requestAnimationFrame(frame) : 0;
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  return {
    show, hide, move,
    get isOpen() { return open; },
    pick() { if (list[act]) onPick(list[act]); },
  };
}
