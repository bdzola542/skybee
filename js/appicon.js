// Skybee — app icon colour (Settings → Оформлення → Іконка). The same colours as the app colour; the picker shows the icon itself.
// Site: the favicon is just the bee without a background. Desktop: window and tray icon (white tile). Phones: see native.js.
const KEY = "skybee.icon";
const store = {
  get: () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
};
// the ready-made set for phones (same colours as APP_COLORS in settings.js; CI builds one launcher icon for each — scripts/app-icons.mjs)
export const ICON_COLORS = ["#ff4d4d","#ff7a2e","#ffa500","#ffee3a","#4cf04c","#36b86a","#4ff0f0","#4a8cff","#7a8cff","#a06bff","#ff3df5","#ff8aa0","#d2b48c","#ffffff","#a8a8a8","#6e6e6e"];
// the tile behind the bee: light (as before), «Сутінки» and dark — the same as the app themes
export const ICON_BGS = ["", "dim", "dark"];
const TILE = { "": "#ffffff", dim: "#161e27", dark: "#0f1218" };
const bgStore = {
  get: () => { try { const v = localStorage.getItem("skybee.iconBg"); return ICON_BGS.includes(v) ? v : ""; } catch { return ""; } },
  set: (v) => { try { v ? localStorage.setItem("skybee.iconBg", v) : localStorage.removeItem("skybee.iconBg"); } catch {} },
};
export const iconBg = () => bgStore.get();
export const setIconBg = (v) => { bgStore.set(ICON_BGS.includes(v) ? v : ""); applyIcon(); };
// the name of a ready-made phone icon: «gold» or hex without #, plus «-dim» / «-dark» on a dark tile
export const iconName = (color = "", bg = "") => (color ? color.slice(1) : "gold") + (bg ? "-" + bg : "");
export const ICON_NAMES = () => ICON_BGS.flatMap(bg => ["", ...ICON_COLORS].map(c => iconName(c, bg)));
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
export const iconColor = () => (isHex(store.get()) ? store.get().toLowerCase() : "");
export const setIconColor = (c) => { store.set(isHex(c) ? c.toLowerCase() : ""); applyIcon(); };

const mix = (hex, to, k) => {
  const n = parseInt(hex.slice(1), 16), t = to === "w" ? 255 : 0;
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (t - v) * k));
  return "#" + ch.map(v => v.toString(16).padStart(2, "0")).join("");
};
const BEE = `<path d="M56 50C43 39 30 22 32 4C47 12 59 30 56 50Z"/><path d="M56 50C44 35 23 19 5 15C17 33 39 45 56 50Z"/><path d="M56 50C42 41 22 39 10 47C24 55 42 55 56 50Z"/><path d="M44 57C51 53 59 58 58 67C57 79 43 92 28 99C23 91 22 82 26 74C30 65 37 59 44 57Z"/><path d="M32 64C39 64 46 67 51 72"/><path d="M28 73C35 73 41 76 46 81"/><path d="M60 66C66 62 68 57 64 52C61 48 63 45 67 45"/><ellipse cx="72" cy="43" rx="6.5" ry="9" transform="rotate(-30 72 43)"/><path d="M69 34C70 28 73 25 77 23"/><path d="M73 36C76 31 80 29 85 29"/>`;
// the bee in a colour ("" = gold); tile: white square behind it (app icon), otherwise transparent (favicon)
export function beeSvg(color = "", tile = false, rx = 112, bg = "") {
  let hi = color || "#dcae4a", lo = color ? mix(color, "k", .3) : "#9b6d22";
  // on a dark tile a dark line (grey, deep green) would vanish: lighten it
  if (tile && bg && color && (parseInt(color.slice(1, 3), 16) * 299 + parseInt(color.slice(3, 5), 16) * 587 + parseInt(color.slice(5, 7), 16) * 114) / 1000 < 120) { hi = mix(color, "w", .45); lo = mix(color, "w", .15); }
  // a very light colour (white, lemon) needs a darker line on a white tile
  const light = !bg && color && (parseInt(color.slice(1, 3), 16) * 299 + parseInt(color.slice(3, 5), 16) * 587 + parseInt(color.slice(5, 7), 16) * 114) / 1000 > 215;
  const a = light && tile ? mix(color, "k", .35) : hi, b = light && tile ? mix(color, "k", .6) : lo;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>${tile ? `<rect width="512" height="512" rx="${rx}" fill="${TILE[bg] || "#ffffff"}"/>` : ""}<g transform="translate(15.4 15.4) scale(4.813) translate(5.5 0.5)" fill="none" stroke="url(#g)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">${BEE}</g></svg>`;
}
export const svgUrl = (svg) => "data:image/svg+xml," + encodeURIComponent(svg);

function png(svg, size) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = size; c.getContext("2d").drawImage(img, 0, 0, size, size); res(c.toDataURL("image/png")); } catch { res(null); } };
    img.onerror = () => res(null);
    img.src = svgUrl(svg);
  });
}

export async function applyIcon() {
  const color = iconColor();
  try {
    // site: replace the favicon with the bee without a background (the browser tab / installed PWA keep the file icon)
    document.querySelectorAll('link[rel="icon"]').forEach(l => l.remove());
    const l = document.createElement("link");
    l.rel = "icon"; l.type = "image/svg+xml"; l.href = svgUrl(beeSvg(color, false));
    document.head.appendChild(l);
  } catch {}
  // desktop: window + tray icon
  try { if (window.skybeeDesktop?.icon) { const p = await png(beeSvg(color, true, 112, iconBg()), 256); if (p) window.skybeeDesktop.icon(p); } } catch {}
  // phones: a ready-made launcher icon (Android activity-alias / iOS alternate icon) — only the preset colours exist
  try {
    const C = window.Capacitor;
    if (C?.isNativePlatform?.() && C.nativePromise && (!color || ICON_COLORS.includes(color)))
      C.nativePromise("AppIcon", "change", { name: iconName(color, iconBg()), all: ICON_NAMES() }).catch(() => {});
  } catch {}
}
