// Skybee — "Profile card" motion on the profile screen (study from designbookmark.com), the layout stays as it is:
// on a follow the avatar pops, the follower count rolls digit by digit (a carry ripples left), and — when the person
// lets only people they follow write to them — the ✉️ button slides in next to «Ви стежите» as soon as you are
// followed back. Springs: follow 300/22, avatar pop 520/14, digit drum 260/22, 60 ms between digits.
import { calmMotion } from "./ui.js";
import { locale } from "./i18n.js";
import { spring, step, rest, clamp } from "./spring.js";

const FOLLOW = [300, 22], POP = [520, 14], DRUM = [260, 22];
const fmt = (n) => Math.max(0, n).toLocaleString(locale);

/* box: the .phead element; p: the profile (getProfile) it shows */
export function initProfileCard(box, p) {
  const v = p.viewer || {};
  const slot = box.querySelector(".pc-slot"), av = box.querySelector(".bigava"), out = box.querySelector("[data-fc]");
  const S = { f: spring(0, FOLLOW), pop: spring(1, POP) };
  let drums = [], raf = 0, last = 0, W = 0;
  const st = box._pc = { following: !!v.following, followedBy: !!v.followedBy, count: p.followersCount || 0 };

  // the ✉️ slot: closed until the person follows you back (only for «allow messages from people I follow»)
  const open = () => st.following && st.followedBy;
  if (slot) {
    slot.style.width = "auto"; W = slot.offsetWidth; // its natural width, to grow to
    S.f.x = S.f.t = open() ? 1 : 0;
  }

  // follower count as a row of digit drums
  function build() {
    out.textContent = ""; drums = [];
    for (const ch of fmt(st.count)) {
      if (!/\d/.test(ch)) { const s = document.createElement("span"); s.textContent = ch; out.appendChild(s); continue; }
      const dg = document.createElement("span"), col = document.createElement("span"); dg.className = "dg";
      for (let k = 0; k < 11; k++) { const i = document.createElement("i"); i.textContent = k % 10; col.appendChild(i); }
      dg.appendChild(col); out.appendChild(dg);
      drums.push({ col, s: spring(+ch, DRUM) });
    }
    out.setAttribute("aria-label", fmt(st.count));
    drums.forEach(d => { d.col.style.transform = `translateY(${(-(((d.s.x % 10) + 10) % 10) * 100 / 11).toFixed(3)}%)`; }); // show the digits at once
  }
  if (out) build();

  function setCount(n) {
    const ds = [...fmt(n)].filter(c => /\d/.test(c)).map(Number);
    st.count = n;
    if (!out) return;
    if (ds.length !== drums.length || calmMotion()) { build(); return; } // a new digit appears (999 → 1 000): just redraw
    ds.forEach((d, k) => setTimeout(() => {
      const s = drums[k]?.s; if (!s) return;
      const cur = Math.round(s.t); let diff = ((d - cur) % 10 + 10) % 10;
      if (diff > 5) diff -= 10; // the short way round: 9 rolls on to 0 and back
      s.t = cur + diff; wake();
    }, (ds.length - 1 - k) * 60));
    wake();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) { const h = dt / 4; step(S.f, h); step(S.pop, h); drums.forEach(d => step(d.s, h)); }
    const q = clamp(S.f.x, 0, 1);
    if (slot) {
      slot.style.width = (W * S.f.x).toFixed(1) + "px";
      slot.style.opacity = q.toFixed(3);
      slot.firstElementChild.style.transform = `translateX(${((1 - S.f.x) * 24).toFixed(1)}px) scale(${(.9 + .1 * q).toFixed(3)})`;
      slot.style.pointerEvents = open() ? "auto" : "none";
      slot.firstElementChild.tabIndex = open() ? 0 : -1;
    }
    if (av) av.style.transform = S.pop.x === 1 ? "" : `scale(${S.pop.x.toFixed(4)})`;
    drums.forEach(d => { const m = ((d.s.x % 10) + 10) % 10; d.col.style.transform = `translateY(${(-m * 100 / 11).toFixed(3)}%)`; });
    raf = (!rest(S.f) || !rest(S.pop) || drums.some(d => !rest(d.s))) && box.isConnected ? requestAnimationFrame(frame) : 0;
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  if (slot) { frame(performance.now()); }

  // called after a follow / unfollow made from this screen
  st.set = (on) => {
    if (on === st.following) return;
    st.following = on;
    setCount(st.count + (on ? 1 : -1));
    if (on && !calmMotion()) S.pop.v = 4;
    if (slot) {
      if (calmMotion()) { S.f.x = S.f.t = open() ? 1 : 0; S.f.v = 0; } else S.f.t = open() ? 1 : 0;
      slot.firstElementChild.setAttribute("aria-hidden", open() ? "false" : "true");
    }
    wake();
  };
}

/* the global follow / unfollow handler tells the card (if this person's profile is on screen) */
export function followChanged(did, on) {
  document.querySelector(`.phead[data-pc="${CSS.escape(did)}"]`)?._pc?.set(on);
}
