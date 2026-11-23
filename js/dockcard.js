// Skybee — "Rubber dock" card: a second tap on the tab you are already on morphs it into a card of quick actions
// (motion study from designbookmark.com): the width lands first (340/21), the height overshoots after (230/21), the rows come in
// one after another (45 ms apart); closing is quicker (420/30). The card grows out of the tab upward.
import { calmMotion } from "./ui.js";
import { spring, step, rest, clamp } from "./spring.js";

const W_OPEN = [340, 21], H_OPEN = [230, 21], CLOSE = [420, 30], STAGGER = .045, RH = 46;
const UP = ["⬆️ Нагору", null];
const ITEMS = {
  "#/": [UP, ["🔲 Колонки", "#/deck"], ["✨ Мої стрічки", "#/myfeeds"], ["🔖 Закладки", "#/bookmarks"]],
  "#/search": [UP, ["#️⃣ Фіди", "#/feeds"], ["📋 Списки", "#/lists"], ["🌱 Для новеньких", "#/newcomers"]],
  "#/notifications": [UP, ["⚙️ Налаштування", "#/settings"]],
  "#/messages": [UP, ["📋 Списки", "#/lists"], ["⚙️ Налаштування", "#/settings"]],
  "#/profile/me": [UP, ["⚙️ Налаштування", "#/settings"], ["🎨 Оформлення", "#/settings/appearance"], ["🔖 Закладки", "#/bookmarks"]],
};
let current = null;

function open(tab) {
  const list = ITEMS[tab.dataset.nav]; if (!list) return;
  const r = tab.getBoundingClientRect(), bar = tab.closest("nav").getBoundingClientRect();
  const fw = Math.min(340, innerWidth - 24), fh = list.length * RH + 16;
  const card = document.createElement("div");
  card.className = "dockcard"; card.setAttribute("role", "menu");
  card.innerHTML = list.map(([l], i) => `<button type="button" role="menuitem" class="dcitem" data-i="${i}">${l}</button>`).join("");
  document.body.appendChild(card);
  const items = [...card.children];
  const cx = clamp(r.left + r.width / 2, fw / 2 + 12, innerWidth - fw / 2 - 12), bottom = innerHeight - bar.top + 8;
  card.style.left = cx + "px"; card.style.bottom = bottom + "px";
  const W = spring(r.width, W_OPEN), H = spring(r.height, H_OPEN), O = spring(0, [420, 32]);
  W.t = fw; H.t = fh; O.t = 1;
  let raf = 0, last = 0, closing = false, t0 = performance.now();
  if (calmMotion()) { W.x = fw; H.x = fh; O.x = 1; }
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { step(W, dt / 4); step(H, dt / 4); step(O, dt / 4); }
    card.style.width = W.x.toFixed(1) + "px"; card.style.height = Math.max(H.x, 8).toFixed(1) + "px";
    card.style.borderRadius = Math.min(Math.max(H.x, 8) / 2, 24) + "px";
    const o = clamp(O.x, 0, 1), age = (now - t0) / 1000;
    card.style.opacity = o.toFixed(3);
    items.forEach((b, i) => { const q = closing ? o : clamp((age - .12 - i * STAGGER) / .25, 0, 1); b.style.opacity = q.toFixed(3); b.style.transform = `translateY(${((1 - q) * 10).toFixed(1)}px)`; });
    if (closing && O.x < .02) { card.remove(); raf = 0; return; }
    raf = !closing && rest(W) && rest(H) && age > .8 ? 0 : requestAnimationFrame(frame);
  };
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  wake();
  const close = () => {
    if (closing) return; closing = true; tab.classList.remove("dc-open");
    document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key, true); removeEventListener("hashchange", close);
    if (current?.card === card) current = null;
    if (calmMotion()) { card.remove(); return; }
    W.k = CLOSE[0]; W.c = CLOSE[1]; H.k = CLOSE[0]; H.c = CLOSE[1]; W.t = r.width; H.t = r.height; O.t = 0; wake();
  };
  const away = (e) => { if (!card.contains(e.target) && !tab.contains(e.target)) close(); }; // a tap on the tab itself toggles (see below)
  const key = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  items.forEach((b, i) => b.addEventListener("click", () => {
    const href = list[i][1]; close();
    if (href) location.hash = href; else scrollTo({ top: 0, behavior: calmMotion() ? "auto" : "smooth" });
  }));
  document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key, true); addEventListener("hashchange", close);
  tab.classList.add("dc-open");
  current = { card, close };
}

// a tap on the tab that is already current (the first tap still switches the tab, as before)
document.addEventListener("click", (e) => {
  const tab = e.target.closest?.("nav.bottom a[data-nav].on");
  if (!tab || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!ITEMS[tab.dataset.nav]) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (current) { current.close(); return; }
  open(tab);
}, true);
