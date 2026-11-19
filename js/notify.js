// Skybee — system notifications while the app is open (a tab, even a background one, or the installed app).
import { t } from "./i18n.js";
// Real push for a closed app needs a server that watches the network; a static site has none.
import * as api from "./api.js";
import { matchMuted } from "./ui.js";

// «<name> <reason>» — shared with the notifications screen
export const NREASON = {
  like: "вподобав(-ла) ваш пост", repost: "поширив(-ла) ваш пост", follow: "стежить за вами",
  reply: "відповів(-ла) вам", mention: "згадав(-ла) вас", quote: "процитував(-ла) ваш пост",
  "like-via-repost": "вподобав(-ла) ваше поширення", "repost-via-repost": "поширив(-ла) ваше поширення",
  "starterpack-joined": "приєднався(-лась) через ваш стартовий набір", verified: "вас верифіковано", unverified: "верифікацію знято",
  "subscribed-post": "опублікував(-ла) новий пост",
};
const WITH_TEXT = ["reply", "mention", "quote", "subscribed-post"];

const KEY = "skybee.notify";
const getItem = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setItem = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
// per account: the newest notification (n) and chat message (c) already handled, as ISO timestamps
const markKey = () => `skybee.notified.${api.session.did}`;

// In the Android/iOS app the system asks through the LocalNotifications plugin (then «Сповіщення» appears in the phone's settings for Skybee)
const LN = () => window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.LocalNotifications : null;
export const supported = () => !!LN() || "Notification" in window;
export const enabled = () => supported() && (LN() || Notification.permission === "granted") && getItem(KEY) === "1";
let lnHooked = false;

export async function enable() {
  if (!supported()) return false;
  const ln = LN();
  if (ln) {
    let p = await ln.checkPermissions().catch(() => null);
    if (p?.display !== "granted") p = await ln.requestPermissions().catch(() => null);
    if (p?.display !== "granted") return false;
  } else if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") return false;
  const now = new Date().toISOString();
  setItem(KEY, "1"); setItem(markKey(), JSON.stringify({ n: now, c: now })); // only what arrives from now on
  show("Skybee", t("Сповіщення увімкнено"), "#/notifications", "skybee-on");
  return true;
}
export const disable = () => setItem(KEY, null);

export async function show(title, body, hash, tag) {
  title = t(title); // the body is someone's post or message: never translated
  const ln = LN();
  if (ln) {
    if (!lnHooked) { lnHooked = true; ln.addListener?.("localNotificationActionPerformed", (e) => { const h = e?.notification?.extra?.hash; if (typeof h === "string" && h.startsWith("#/")) location.hash = h; }); }
    const id = Math.floor(Math.random() * 2e9) + 1;
    try { return await ln.schedule({ notifications: [{ id, title, body: body || "", extra: { hash } }] }); } catch { return; }
  }
  const opts = { body, tag, icon: "icons/icon-192.png", data: { hash } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active) return await reg.showNotification(title, opts); // the only way on Android; clicks are handled in sw.js
  } catch { /* fall back to a page notification */ }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); location.hash = hash; n.close(); };
  } catch { /* not allowed here */ }
}

/* ---------- followed threads: a notice when new replies appear anywhere in the thread (checked every 5 minutes) ---------- */
export const countReplies = (n) => (n?.replies || []).reduce((s, r) => s + (r.$type === "app.bsky.feed.defs#threadViewPost" ? 1 + countReplies(r) : 0), 0);
export const threadSubsKey = () => `skybee.threadSubs.${api.session?.did || "x"}`;
export const threadSubs = () => { try { return JSON.parse(getItem(threadSubsKey())) || {}; } catch { return {}; } };
export const saveThreadSubs = (s) => setItem(threadSubsKey(), Object.keys(s).length ? JSON.stringify(s) : null);
let tsAt = 0;
async function checkThreads() {
  if (Date.now() - tsAt < 5 * 60e3) return; tsAt = Date.now();
  const subs = threadSubs();
  for (const [uri, s] of Object.entries(subs).slice(0, 10)) {
    try {
      const { thread } = await api.get("app.bsky.feed.getPostThread", { uri, depth: 10, parentHeight: 0 });
      const n = countReplies(thread);
      if (n > (s.n || 0)) {
        const [, , did, , rkey] = uri.split("/");
        if (!(document.visibilityState === "visible" && document.hasFocus())) show("Skybee", t("Нових відповідей у гілці, за якою ви стежите: {0}", n - (s.n || 0)), `#/profile/${did}/post/${rkey}`, "thread-" + rkey);
      }
      s.n = n; // also lowers when replies are deleted
    } catch { /* the post is gone or the network is down: try again later */ }
  }
  const now = threadSubs(); // the user may have (un)followed a thread while the requests ran: only the counters are updated
  for (const k of Object.keys(now)) if (subs[k]) now[k].n = subs[k].n;
  saveThreadSubs(now);
}

let lastCount = -1, lastDid = "";
// Called after every badge poll: `count` of unread notifications and the chat list (null when chats are unavailable)
export async function check(count, convos) {
  if (!enabled() || !api.session) return;
  checkThreads().catch(() => {});
  if (api.session.did !== lastDid) { lastDid = api.session.did; lastCount = -1; } // another account: its count starts afresh
  const me = api.session.did, now = new Date().toISOString(), who = (a) => a?.displayName || a?.handle || "Хтось";
  let mark = {};
  try { mark = JSON.parse(getItem(markKey())) || {}; } catch {}
  const since = { n: mark.n || now, c: mark.c || now }, fresh = [];

  if (count && count !== lastCount) {
    const d = await api.get("app.bsky.notification.listNotifications", { limit: 30 });
    for (const n of d.notifications) {
      if (n.isRead || n.indexedAt <= since.n) continue;
      if (n.indexedAt > (mark.n || "")) mark.n = n.indexedAt;
      const rec = n.record || {}, body = WITH_TEXT.includes(n.reason) ? rec.text || "" : "";
      if (body && matchMuted(api.mutedWords, { text: body, facets: rec.facets, tags: rec.tags, langs: rec.langs, actor: n.author })) continue;
      fresh.push({ title: `${who(n.author)} ${NREASON[n.reason] || "— нове сповіщення"}`, body, hash: "#/notifications", tag: n.uri });
    }
  }
  lastCount = count;

  for (const c of convos || []) {
    const m = c.lastMessage;
    if (!c.unreadCount || c.muted || !m?.sentAt || m.sender?.did === me || m.sentAt <= since.c) continue;
    if (m.sentAt > (mark.c || "")) mark.c = m.sentAt;
    fresh.push({ title: `${who(c.members.find(x => x.did === m.sender?.did))}: нове повідомлення`, body: m.text || "", hash: `#/messages/${c.id}`, tag: `chat-${c.id}` });
  }

  setItem(markKey(), JSON.stringify({ n: mark.n || now, c: mark.c || now }));
  // while the user is looking at Skybee, the badges in the menu are enough
  if (!fresh.length || (document.visibilityState === "visible" && document.hasFocus())) return;
  for (const f of fresh.slice(0, 3)) show(f.title, f.body, f.hash, f.tag);
  if (fresh.length > 3) show("Skybee", t("І ще нових сповіщень: {0}", fresh.length - 3), "#/notifications", "skybee-more");
}
