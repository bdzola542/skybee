// Skybee — "Swipe deck" for people to follow (motion study from designbookmark.com): a stack of cards, the top one follows the finger
// (900/50) and tilts; thrown past 110 px it flies off — right: follow, left: skip; let go earlier and it springs back (280/16).
// Buttons under the deck do the same for those who do not swipe.
import { esc, avatar, name, at, toast, calmMotion } from "./ui.js";
import * as api from "./api.js";
import { errText } from "./errors.js";
import { spring, tune, step, rest } from "./spring.js";

const DRAG = [900, 50], RETURN = [280, 16], THRESHOLD = 110;

export function swipeDeck(host, actorsList) {
  let list = actorsList.filter(a => !a.viewer?.following && a.did !== api.session?.did);
  if (list.length < 2) { host.remove(); return; }
  host.classList.add("sdeck");
  host.innerHTML = `<h3>Картки: гортайте людей</h3><div class="sd-stage" aria-live="polite"></div><div class="sd-btns"><button type="button" class="ghost sd-no" aria-label="Пропустити">✕ Пропустити</button><button type="button" class="btn sd-yes" aria-label="Стежити">＋ Стежити</button></div><p class="muted small sd-hint">Гортайте вправо, щоб стежити, вліво — щоб пропустити</p>`;
  const stage = host.querySelector(".sd-stage");
  let cards = [], i = 0, busy = false;

  const make = (a) => {
    const el = document.createElement("div"); el.className = "sd-card";
    el.innerHTML = `<div class="sd-stamp yes">СТЕЖУ</div><div class="sd-stamp no">ПРОПУСК</div>${avatar(a, 72)}<b>${name(a)}</b><span class="muted">${at(a.handle)}</span>${a.viewer?.followedBy ? '<span class="pill">Стежить за вами</span>' : ""}<p class="small">${esc((a.description || "").slice(0, 140))}</p>`;
    return { el, a, X: spring(0, DRAG), Y: spring(0, DRAG), R: spring(0, DRAG) };
  };
  const rebuild = () => {
    stage.innerHTML = ""; cards = list.slice(i, i + 3).map(make).reverse(); // the top card is the last in the DOM
    cards.forEach(c => stage.appendChild(c.el));
    if (!cards.length) host.innerHTML = `<p class="muted small" style="text-align:center">Це всі пропозиції на зараз</p>`;
    layout(); wake();
  };
  const top = () => cards[cards.length - 1];
  const layout = () => cards.forEach((c, k) => {
    const depth = cards.length - 1 - k; // 0 = the top card
    c.base = depth;
    c.el.style.zIndex = String(10 - depth);
  });

  let raf = 0, last = 0;
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    let busyNow = false;
    cards.forEach((c, k) => {
      for (let n = 0; n < 4; n++) { step(c.X, dt / 4); step(c.Y, dt / 4); step(c.R, dt / 4); }
      const depth = cards.length - 1 - k, tp = c === top();
      const lift = tp ? 0 : 1 - Math.min(Math.abs(top()?.X.x || 0) / THRESHOLD, 1) * (depth === 1 ? 1 : 0); // the next card rises as the top one leaves
      const sc = tp ? 1 : 1 - depth * .05 + (depth === 1 ? (1 - lift) * .05 : 0), ty = tp ? c.Y.x : depth * 12 - (depth === 1 ? (1 - lift) * 12 : 0);
      c.el.style.transform = `translate(${tp ? c.X.x.toFixed(1) : 0}px, ${ty.toFixed(1)}px) rotate(${tp ? c.R.x.toFixed(2) : 0}deg) scale(${sc.toFixed(3)})`;
      if (tp) { c.el.querySelector(".sd-stamp.yes").style.opacity = Math.max(0, Math.min(c.X.x / THRESHOLD, 1)).toFixed(2); c.el.querySelector(".sd-stamp.no").style.opacity = Math.max(0, Math.min(-c.X.x / THRESHOLD, 1)).toFixed(2); }
      if (!rest(c.X) || !rest(c.Y) || !rest(c.R)) busyNow = true;
    });
    raf = busyNow || drag ? requestAnimationFrame(frame) : 0;
  };
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  const decide = async (yes, fromX = 0) => {
    const c = top(); if (!c || busy) return; busy = true;
    const dir = yes ? 1 : -1;
    tune(c.X, [180, 14]); tune(c.Y, [180, 14]); tune(c.R, [180, 14]);
    c.X.t = dir * (innerWidth + 200); c.Y.t = c.Y.x - 40; c.R.t = dir * 28; wake();
    if (yes) { try { await api.follow(c.a.did); toast(`Ви стежите за ${at(c.a.handle)}`); } catch (e) { toast(errText(e)); } }
    setTimeout(() => { i++; busy = false; rebuild(); }, 320);
  };

  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    const c = top(); if (!c || busy || !c.el.contains(e.target)) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY }; try { stage.setPointerCapture(e.pointerId); } catch {}
    for (const s of [c.X, c.Y, c.R]) tune(s, DRAG);
    wake();
  });
  stage.addEventListener("pointermove", (e) => {
    const c = top(); if (!drag || drag.id !== e.pointerId || !c) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    c.X.t = dx; c.Y.t = dy * .5; c.R.t = dx / 18;
  });
  const up = (e) => {
    const c = top(); if (!drag || drag.id !== e.pointerId || !c) return;
    const dx = c.X.t; drag = null;
    if (Math.abs(dx) > THRESHOLD) decide(dx > 0);
    else { for (const s of [c.X, c.Y, c.R]) tune(s, RETURN); c.X.t = 0; c.Y.t = 0; c.R.t = 0; wake(); } // not far enough: it springs back
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  host.querySelector(".sd-yes").addEventListener("click", () => decide(true));
  host.querySelector(".sd-no").addEventListener("click", () => decide(false));
  rebuild();
}
