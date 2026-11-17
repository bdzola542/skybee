// Skybee — the Android/iOS app (Capacitor, mobile/): small fixes that only matter inside the native shell.
// In a browser or the desktop app window.Capacitor is absent and this file does nothing — except the swipe back, which the desktop app gets too.
const cap = window.Capacitor;
export const isNative = !!cap?.isNativePlatform?.();

if (isNative) {
  // The Content-Security-Policy of index.html, carried here as meta name="skybee-csp" (scripts/dist.mjs): switched on now,
  // after Capacitor's own inline bridge has run. From here on no inline script or on…= handler can run in the page.
  const csp = document.querySelector('meta[name="skybee-csp"]');
  if (csp) { const m = document.createElement("meta"); m.httpEquiv = "Content-Security-Policy"; m.content = csp.content; document.head.prepend(m); }
  document.documentElement.classList.add("native", "native-" + cap.getPlatform());
  // Android: the page runs edge to edge (behind the status bar and the bottom bar) and the WebView may report no safe area,
  // so the real insets come from the SafeArea plugin into --sat/--sab/--sal/--sar (css). An older Android that still keeps
  // the page between the bars gets nothing: there the page is already as tall as the space between them.
  const SafeArea = cap.Plugins?.SafeArea;
  if (cap.getPlatform() === "android" && SafeArea) {
    let edge = null; // decided once: the keyboard later shrinks the page, which must not switch the insets off
    const put = (r) => {
      const i = r?.insets; if (!i) return;
      if (edge === null) edge = Math.abs(screen.height - innerHeight) < (i.top + i.bottom) / 2 + 1; // page reaches under the bars?
      const st = document.documentElement.style;
      for (const [k, v] of [["--sat", i.top], ["--sab", i.bottom], ["--sal", i.left], ["--sar", i.right]]) st.setProperty(k, (edge ? v : 0) + "px");
    };
    SafeArea.getSafeAreaInsets?.().then(put).catch(() => {});
    SafeArea.addListener?.("safeAreaChanged", put);
    addEventListener("resize", () => SafeArea.getSafeAreaInsets?.().then(put).catch(() => {}));
  }
  // Links to other sites open in the phone's browser: the shell sends any navigation away from the app there,
  // but a WebView ignores target=_blank and window.open — so turn those into a plain navigation.
  // …in the app's own browser window (Safari View Controller / Chrome Custom Tab: it slides over Skybee and «Готово» returns),
  // not out in another app; without the plugin — as before
  const open = (url) => {
    if (!/^https?:/i.test(url)) return;
    const B = cap.Plugins?.Browser;
    if (B?.open) B.open({ url, presentationStyle: "popover" }).catch(() => { location.href = url; }); else location.href = url;
  };
  window.open = (url) => { open(String(url || "")); return null; };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[target="_blank"]');
    if (!a || !a.href) return;
    e.preventDefault();
    open(a.href);
  }, true);
  // Android «Back»: one screen back inside Skybee, out of the app on the first screen
  const App = cap.Plugins?.App;
  App?.addListener?.("backButton", ({ canGoBack }) => { if (!closeTop()) canGoBack ? history.back() : App.exitApp(); });
}

// What «Back» closes before it leaves the screen: an open «⋯» menu, then a window, then the side menu. True if something closed.
function closeTop() {
  const pop = document.querySelector(".popmenu:not(.leaving)");
  if (pop) { document.body.click(); pop.remove(); return true; }
  if (document.querySelector(".modal-bg:not(.leaving), .msheet-bg:not(.leaving)")) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return true; }
  if (document.body.classList.contains("drawer")) { document.body.classList.remove("drawer"); return true; }
  return false;
}

/* ---------- swipe back (the apps: Android, iOS, the desktop app on a touch screen) ---------- */
// A finger from the left edge pulled to the right: one step back, like «Back» on Android and the edge swipe on iPhone.
// The screen (or the open window) follows the finger at once; let go past the threshold and it goes back, else it slides home.
if (isNative || window.skybeeDesktop) {
  const EDGE = 32, GO = 80;
  let x0 = null, y0 = 0, dx = 0, on = false, el = null;
  const layer = () => document.querySelector(".modal-bg:not(.leaving) .modal, .msheet-bg:not(.leaving) .msheet")
    || (document.body.classList.contains("drawer") || history.length <= 1 || /^#?\/?$/.test(location.hash) ? null : document.getElementById("main"));
  const home = (animate) => {
    const t = el; el = null;
    if (!t) return;
    if (!animate) { t.style.transition = t.style.transform = ""; return; }
    t.style.transition = "transform .2s ease-out"; t.style.transform = "translateX(0)";
    setTimeout(() => { if (!el) t.style.transition = t.style.transform = ""; }, 230); // not if a new swipe has already taken it
  };
  const drop = () => { home(on); x0 = null; on = false; };
  addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    drop();
    if (e.touches.length !== 1 || t.clientX > EDGE || document.querySelector(".lb") || e.target.closest?.("nav.bottom")) return; // the photo viewer and the tab bar have their own gestures
    x0 = t.clientX; y0 = t.clientY; dx = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (x0 == null) return;
    const t = e.touches[0];
    dx = t.clientX - x0;
    const dy = Math.abs(t.clientY - y0);
    if (!on) {
      if (dy > 14 && dy > dx) return drop(); // scrolling up or down, not a swipe
      if (dx < 8) return;
      el = layer();
      if (!el) return drop();
      on = true; el.style.transition = "none";
    }
    el.style.transform = `translateX(${Math.max(dx, 0)}px)`; // follows the finger
  }, { passive: true });
  const end = () => {
    const goBack = on && dx >= GO;
    if (goBack) {
      // the screen finishes the way the finger was taking it (slides off to the right), then the previous one is simply there — no second animation on top
      const t = el; el = null; x0 = null; on = false;
      const go = () => {
        const r = document.documentElement; r.dataset.swiped = "1"; clearTimeout(go.t); go.t = setTimeout(() => delete r.dataset.swiped, 700);
        if (!closeTop() && history.length > 1 && !/^#?\/?$/.test(location.hash)) history.back();
        if (t) setTimeout(() => { t.style.transition = t.style.transform = t.style.opacity = ""; }, 160);
      };
      if (t) { t.style.transition = "transform .17s cubic-bezier(.3,0,.8,.6), opacity .17s"; t.style.transform = "translateX(100%)"; t.style.opacity = ".4"; setTimeout(go, 170); } else go();
    }
    else drop();
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", drop, { passive: true });
}

// skybee://… links (the browser hands the user back after sign-up): fn(url) for the link that started the app
// and for every later one. In the desktop app the same comes through skybeeDesktop.onLink.
export function onLink(fn) {
  if (window.skybeeDesktop?.onLink) window.skybeeDesktop.onLink(fn);
  const App = isNative && cap.Plugins?.App;
  if (!App) return;
  App.addListener?.("appUrlOpen", (e) => e?.url && fn(e.url));
  App.getLaunchUrl?.().then((r) => r?.url && fn(r.url)).catch(() => {});
}

// Status bar icons that read on the page: light icons on a dark page, dark on a light one (called by applyLook)
export function statusBarFor(darkPage) {
  const StatusBar = isNative && cap.Plugins?.StatusBar;
  StatusBar?.setStyle?.({ style: darkPage ? "DARK" : "LIGHT" })?.catch?.(() => {});
}
