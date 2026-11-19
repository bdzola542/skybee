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
    el.querySelectorAll("article.post[data-uri], .actor:not(article .actor)").forEach(a => {
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
  wr(fk(), f); wr(fat(), Date.now());
}
export function removeFromFolders(uri) {
  const f = folders(); for (const k of Object.keys(f)) { f[k] = f[k].filter(u => u !== uri); if (!f[k].length) delete f[k]; }
  wr(fk(), f); wr(fat(), Date.now());
}
// Optional (a switch in the settings): the folders also live in one record of the own account, so another device sees them.
// The record is PUBLIC, while bookmarks in Bluesky are private — that is why it is off until the user turns it on.
const NSB = "io.github.vysocavnu.skybee.bookmarks", fat = () => "skybee.bmFoldersAt." + me();
export const folderSync = () => { try { return localStorage.getItem("skybee.bmSync") === "1"; } catch { return false; } };
export async function pushFolders() {
  if (!folderSync() || !api.session) return;
  wr(fat(), rd(fat(), 0) || Date.now());
  try { await api.post("com.atproto.repo.putRecord", { repo: api.session.did, collection: NSB, rkey: "self", validate: false,
    record: { $type: NSB, folders: { ...folders() }, updatedAt: new Date(rd(fat(), Date.now())).toISOString() } }); } catch (e) { console.warn("Skybee: folders did not sync", e?.code || e); }
}
// switching the sync off removes the public record (the folders stay on this device)
export async function dropFolderRecord() {
  if (!api.session) return;
  try { await api.post("com.atproto.repo.deleteRecord", { repo: api.session.did, collection: NSB, rkey: "self" }); } catch { /* there was none */ }
}
// → true when folders from the account replaced those on this device (the newer side wins)
export async function pullFolders() {
  if (!folderSync() || !api.session) return false;
  try {
    const r = await api.get("com.atproto.repo.getRecord", { repo: api.session.did, collection: NSB, rkey: "self" }).catch(() => null);
    const v = r?.value, local = rd(fat(), 0);
    if (!v || typeof v.folders !== "object" || !v.folders) { if (Object.keys(folders()).length) pushFolders(); return false; }
    const at = Math.min(Date.parse(v.updatedAt) || 0, Date.now() + 5 * 6e4); // a date from the future is not believed
    if (at > local) {
      const clean = Object.create(null);
      for (const [n, l] of Object.entries(v.folders).slice(0, 40)) {
        if (!n || n.length > 40 || /^(__proto__|constructor|prototype)$/i.test(n) || !Array.isArray(l)) continue;
        clean[n] = l.filter(u => typeof u === "string" && u.startsWith("at://") && u.length < 300).slice(0, 2000);
      }
      wr(fk(), { ...clean }); wr(fat(), at); return true;
    }
    if (at < local) pushFolders();
  } catch { /* offline: the folders on this device stay */ }
  return false;
}
export const folderOf = (uri) => Object.entries(folders()).filter(([, l]) => l.includes(uri)).map(([n]) => n);

/* ---------- several drafts ---------- */
const dk = () => "skybee.drafts." + me();
export const drafts = () => rd(dk(), []); // [{ id, text, at }]
// parts: the texts of a whole thread (the media are not kept, only the words)
export function saveDraft(text, parts) {
  text = text.trim(); if (!text && !(parts?.length > 1)) return false;
  parts = parts?.length > 1 ? parts.slice(0, 25).map(s => String(s).slice(0, 3000)) : undefined;
  const l = drafts().filter(d => parts ? JSON.stringify(d.parts) !== JSON.stringify(parts) : d.text !== text || d.parts);
  l.unshift({ id: Date.now().toString(36), text: (text || parts?.[0] || "").slice(0, 3000), ...(parts ? { parts } : {}), at: Date.now() });
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

/* ---------- snooze: an account is hidden from feeds for some days, or only its reposts are (on this device) ---------- */
const zk = () => "skybee.snooze." + me();
const zRead = () => {
  const m = rd(zk(), {}), now = Date.now(); let ch = false;
  for (const [d, v] of Object.entries(m)) if (!v || (v.until && v.until < now && !v.reposts)) { delete m[d]; ch = true; } else if (v.until && v.until < now) { v.until = 0; ch = true; }
  if (ch) wr(zk(), m);
  return m;
};
export const snoozeList = () => Object.entries(zRead()).map(([did, v]) => ({ did, ...v }));
export function snooze(did, handle, days) {
  const m = zRead(), v = m[did] || {};
  v.until = days > 0 ? Date.now() + Math.min(days, 365) * 864e5 : 0;
  v.handle = handle; if (!v.until && !v.reposts) delete m[did]; else m[did] = v;
  wr(zk(), m);
}
export function muteReposts(did, handle, on) {
  const m = zRead(), v = m[did] || { until: 0 };
  v.reposts = !!on; v.handle = handle; if (!v.until && !v.reposts) delete m[did]; else m[did] = v;
  wr(zk(), m);
}
// → a filter for feed items: true = hide (posts and reposts of snoozed accounts, reposts of «no reposts» ones)
export function snoozeFilter() {
  const m = zRead(), now = Date.now();
  if (!Object.keys(m).length) return () => false;
  return (it) => {
    const a = m[it.post?.author?.did], b = it.reason?.$type === "app.bsky.feed.defs#reasonRepost" ? m[it.reason.by?.did] : null;
    return !!((a?.until > now) || (b && (b.until > now || b.reposts)));
  };
}

/* ---------- «suspicious replies»: simple guesses, never a verdict ---------- */
export const botFilterOn = () => { try { return localStorage.getItem("skybee.botFilter") === "1"; } catch { return false; } };
export function looksBot(a, myDid) {
  if (!a || a.did === myDid || a.viewer?.following || a.viewer?.followedBy) return false; // people you know are never doubted
  let s = 0;
  if (!a.avatar) s++;
  if (!(a.displayName || "").trim()) s++;
  if (/\d{5,}/.test(a.handle || "")) s++;
  if (a.createdAt && Date.now() - Date.parse(a.createdAt) < 7 * 864e5) s++;
  return s >= 3;
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
