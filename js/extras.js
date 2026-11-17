// Skybee — small things people ask for in Bluesky clients, all done on the device (no server):
// a filter box over a loaded list, bookmark folders, several drafts, remembered ALT texts,
// accounts hidden from «Підписки» without unfollowing, a filter for spam in chat requests.
import { esc } from "./ui.js";
import * as api from "./api.js";

const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const me = () => api.session?.did || "x";

/* ---------- a filter box over the posts already loaded (bookmarks, feeds, lists) ---------- */
// Adds «🔍» under the top bar; posts that do not contain the words are hidden as they load.
export function attachFilter(el, placeholder = "Пошук у цьому списку") {
  const bar = el.querySelector(".topbar"); if (!bar || el.querySelector(".lfilter")) return;
  const wrap = document.createElement("div"); wrap.className = "pad lfilter-wrap";
  wrap.innerHTML = `<input type="search" class="lfilter" placeholder="🔍 ${esc(placeholder)}" aria-label="${esc(placeholder)}" maxlength="100">`;
  bar.after(wrap);
  const input = wrap.firstElementChild;
  const apply = () => {
    const q = input.value.trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
    el.querySelectorAll("article.post[data-uri]").forEach(a => {
      const t = a.textContent.toLowerCase();
      a.hidden = words.length > 0 && !words.every(w => t.includes(w));
    });
  };
  let timer = 0; const soon = () => { clearTimeout(timer); timer = setTimeout(apply, 120); };
  input.addEventListener("input", soon);
  new MutationObserver(() => { if (input.value) soon(); }).observe(el, { childList: true, subtree: true });
}

/* ---------- bookmark folders (kept on this device) ---------- */
const fk = () => "skybee.bmFolders." + me();
export const folders = () => Object.assign(Object.create(null), rd(fk(), {})); // { name: [uri, …] }
export function addToFolder(name, uri) {
  const f = folders(); name = name.trim().slice(0, 40); if (!name || /^(__proto__|constructor|prototype)$/i.test(name)) return;
  const list = (f[name] ||= []); if (!list.includes(uri)) list.push(uri);
  wr(fk(), f);
}
export function removeFromFolders(uri) {
  const f = folders(); for (const k of Object.keys(f)) { f[k] = f[k].filter(u => u !== uri); if (!f[k].length) delete f[k]; }
  wr(fk(), f);
}
export const folderOf = (uri) => Object.entries(folders()).filter(([, l]) => l.includes(uri)).map(([n]) => n);

/* ---------- several drafts ---------- */
const dk = () => "skybee.drafts." + me();
export const drafts = () => rd(dk(), []); // [{ id, text, at }]
export function saveDraft(text) {
  text = text.trim(); if (!text) return false;
  const l = drafts().filter(d => d.text !== text);
  l.unshift({ id: Date.now().toString(36), text: text.slice(0, 3000), at: Date.now() });
  wr(dk(), l.slice(0, 30)); return true;
}
export function dropDraft(id) { wr(dk(), drafts().filter(d => d.id !== id)); }

/* ---------- remembered ALT texts: the same picture (name + size) gets its last description back ---------- */
const sig = (f) => `${f.name || ""}|${f.size || 0}|${f.lastModified || 0}`;
export const altFor = (f) => rd("skybee.alts", {})[sig(f)] || "";
export function rememberAlt(f, alt) {
  alt = (alt || "").trim(); if (!alt || !f) return;
  const m = rd("skybee.alts", {}); delete m[sig(f)]; m[sig(f)] = alt.slice(0, 2000);
  const keys = Object.keys(m); for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete m[k];
  wr("skybee.alts", m);
}
export const recentAlts = () => [...new Set(Object.values(rd("skybee.alts", {})).reverse())].slice(0, 6);

/* ---------- accounts hidden from «Підписки» (still followed) ---------- */
const hk = () => "skybee.hiddenFollow." + me();
export const hiddenFromHome = () => new Set(rd(hk(), []));
export function toggleHiddenFromHome(did) {
  const s = hiddenFromHome(); const on = !s.has(did);
  on ? s.add(did) : s.delete(did); wr(hk(), [...s].slice(0, 500)); return on;
}

/* ---------- spam in chat requests (every «Hi. How are you?» from strangers) ---------- */
const SPAM = [/^\s*(hi|hello|hey|hii+|hola)[\s.,!?]*(how are you|how r u|how's it going)?[\s.,!?]*$/i, /\b(forex|airdrop|sugar (daddy|mommy)|crypto investment|investment opportunit)\w*/i,
  /(?:https?:\/\/)?t\.me\//i];
export const spamOn = () => rd("skybee.dmSpam", true);
export const setSpam = (v) => wr("skybee.dmSpam", !!v);
export const looksSpam = (text) => spamOn() && !!text && SPAM.some(r => r.test(text));

/* ---------- translation inside the browser (Chrome's on-device Translator, no server, no key); null when the browser has none ---------- */
export async function translateText(text, target) {
  try {
    if (!("Translator" in self) || !("LanguageDetector" in self) || !text.trim()) return null;
    const det = await (await self.LanguageDetector.create()).detect(text.slice(0, 500));
    const src = det?.[0]?.detectedLanguage; if (!src || src === "und") return null;
    if (src.split("-")[0] === target.split("-")[0]) return text;
    const tr = await self.Translator.create({ sourceLanguage: src, targetLanguage: target });
    return await tr.translate(text);
  } catch { return null; }
}
