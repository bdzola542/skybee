// Skybee — "Morph select": a drop-down that grows out of its own button (motion study from designbookmark.com).
// The native <select> stays in the page (hidden) and keeps the value, so every screen's own code keeps working; the button
// shows the choice and opens a menu that morphs from the button's size to its own (open 360/24), with a stretchy highlight that
// follows the arrows and the pointer (620/34 in front, 190/19 behind). Used in the post editor and the settings.
import { calmMotion, esc } from "./ui.js";
import { spring, tune, step, rest, clamp } from "./spring.js";
import { lensTo } from "./rubberdock.js";

const OPEN = [360, 24], RH = 38, PAD = 4;
let current = null; // one menu at a time

function enhance(sel) {
  if (sel._ms || sel.multiple || sel.size > 1 || sel.closest(".chatbar")) return;
  sel._ms = true;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "msel " + (sel.className || ""); btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
  if (sel.title) btn.title = sel.title;
  const lab = sel.getAttribute("aria-label") || sel.title; if (lab) btn.setAttribute("aria-label", lab);
  const sync = () => { btn.disabled = sel.disabled; btn.innerHTML = `<span class="mst">${esc(sel.selectedOptions[0]?.textContent || "")}</span><svg class="msc" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`; };
  sync();
  sel.hidden = true; sel.tabIndex = -1; sel.after(btn);
  sel.addEventListener("change", sync); btn.addEventListener("pointerenter", sync); btn.addEventListener("focus", sync); // a value set from code does not fire an event: look again when the button is reached
  btn.addEventListener("click", (e) => { e.preventDefault(); open(sel, btn, sync); });
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(sel, btn, sync); } });
  // the label follows a value set from code (a restored draft)
  new MutationObserver(sync).observe(sel, { attributes: true, childList: true, subtree: true, attributeFilter: ["selected", "value", "disabled"] });
}

function open(sel, btn, sync) {
  if (current) { const same = current.btn === btn; current.close(); if (same) return; }
  const opts = [...sel.options].filter(o => !o.hidden);
  const r = btn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "mselmenu"; menu.setAttribute("role", "listbox");
  menu.innerHTML = `<span class="msl" aria-hidden="true"></span>` + opts.map((o, i) => `<button type="button" role="option" class="mso" data-i="${i}" ${o.disabled ? "disabled" : ""}>${esc(o.textContent)}</button>`).join("");
  document.body.appendChild(menu);
  const items = [...menu.querySelectorAll(".mso")], hl = menu.querySelector(".msl");
  // the final size: as wide as the widest item (at least the button), as tall as the items
  menu.style.cssText = `left:0;top:0;width:auto;height:auto;visibility:hidden`;
  const fw = Math.max(r.width, menu.offsetWidth + 8, 150), fh = opts.length * RH + PAD * 2;
  const below = r.bottom + 6 + fh <= innerHeight - 8, top = below ? r.top : Math.max(8, r.bottom - fh);
  const left = clamp(r.left, 8, innerWidth - fw - 8);
  menu.style.cssText = `left:${left}px;top:${top}px;`;
  const W = spring(r.width, OPEN), H = spring(r.height, OPEN), O = spring(0, [420, 32]);
  let act = Math.max(opts.findIndex(o => o.value === sel.value), 0), raf = 0, last = 0, closing = false;
  items.forEach((b, i) => { b.style.top = PAD + i * RH + "px"; b.style.height = RH + "px"; });
  const hlTo = (i, first) => { hl.style.left = PAD + "px"; hl.style.right = PAD + "px"; hl.style.top = "0"; lensTo(hl, PAD + i * RH, RH, { axis: "y", lead: [620, 34], trail: [190, 19], squash: false }); items.forEach((b, j) => b.setAttribute("aria-selected", j === i)); };
  if (calmMotion()) { W.x = W.t = fw; H.x = H.t = fh; O.x = O.t = 1; }
  W.t = fw; H.t = fh; O.t = 1;
  hlTo(act); hl.style.transform = `translateY(${PAD + act * RH}px)`;
  btn.setAttribute("aria-expanded", "true"); btn.classList.add("open");
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { step(W, dt / 4); step(H, dt / 4); step(O, dt / 4); }
    menu.style.width = W.x.toFixed(1) + "px"; menu.style.height = Math.max(H.x, 0).toFixed(1) + "px";
    const o = clamp(O.x, 0, 1);
    items.forEach((b, i) => { const q = clamp((H.x - r.height) / Math.max(fh - r.height, 1) * 1.4 - i * .06, 0, 1); b.style.opacity = (q * o).toFixed(3); b.style.transform = `translateY(${((1 - q) * 8).toFixed(1)}px)`; });
    menu.style.opacity = closing ? o.toFixed(3) : "1";
    if (closing && O.x < .02) { menu.remove(); raf = 0; return; }
    raf = requestAnimationFrame(frame);
    if (!closing && rest(W) && rest(H)) { cancelAnimationFrame(raf); raf = 0; } // open and still: nothing to animate
  }
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  wake();
  const close = () => {
    if (closing) return; closing = true;
    document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key, true); removeEventListener("resize", close); removeEventListener("scroll", close, true);
    btn.setAttribute("aria-expanded", "false"); btn.classList.remove("open");
    if (current?.menu === menu) current = null;
    if (calmMotion()) { menu.remove(); return; }
    tune(W, [420, 30]); tune(H, [420, 30]); W.t = r.width; H.t = r.height; O.t = 0; wake();
  };
  const choose = (i) => {
    const o = opts[i]; if (!o || o.disabled) return;
    if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); }
    sync(); close(); btn.focus();
  };
  const away = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); act = (act + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; hlTo(act); wake(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(act); }
    else if (e.key === "Tab") close();
  };
  items.forEach((b, i) => {
    b.addEventListener("pointerenter", () => { act = i; hlTo(i); });
    b.addEventListener("click", () => choose(i));
  });
  document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key, true);
  addEventListener("resize", close); addEventListener("scroll", close, true);
  current = { btn, menu, close };
}

const SEL = "select";
const scan = (root) => {
  if (root.nodeType !== 1) return;
  const list = root.matches?.(SEL) ? [root] : [...root.querySelectorAll?.(SEL) || []];
  // the post editor and the windows/cards of the settings; a bare <select> elsewhere stays native
  list.forEach(s => { if (s.closest(".composer, .modal, .card, .field")) enhance(s); });
};
new MutationObserver((l) => l.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
scan(document.body);
