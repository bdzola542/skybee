// Skybee — Web Push при закритому застосунку (сайт і PWA). Сервер — hosting/push/ на власному хостингу:
// він раз на хвилину питає Bluesky від імені користувача (за його ПАРОЛЕМ ЗАСТОСУНКУ) і шле push.
// Пароль іде лише на цей сервер (https), там зберігається зашифрованим; відписка його видаляє.
import * as api from "./api.js";
import { uiLang } from "./i18n.js";

const API = "https://skybee.online/push/api.php";
const key = () => "skybee.push." + api.session.did;
const getItem = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setItem = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const native = () => !!(window.skybeeDesktop || window.Capacitor?.isNativePlatform?.());

// Web Push є не скрізь: застосунки (Electron, Capacitor) його не мають — там інші способи (трей, фоновий запуск)
export const supported = () => !native() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// serviceWorker.ready висить вічно, якщо воркер не зареєстровано: чекаємо не довше 6 с
const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("sw"), { code: "sw" })), 6000))]);
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

export async function active() {
  if (!supported() || !api.session || !getItem(key())) return false;
  try { return !!(await (await ready()).pushManager.getSubscription()); } catch { return false; }
}

async function call(action, body) {
  const r = await fetch(`${API}?a=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "http " + r.status), { code: d.error, status: r.status });
  return d;
}

// → { chat }: чи отримує сервер доступ до чатів із цього пароля
export async function enable(password) {
  if (!supported()) throw Object.assign(new Error("unsupported"), { code: "unsupported" });
  if (await Notification.requestPermission() !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
  const reg = await ready();
  const vr = await fetch(`${API}?a=vapid`);
  if (!vr.ok) throw Object.assign(new Error("server"), { code: "server" });
  const { key: vapid } = await vr.json();
  try { await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch {} // стара підписка могла бути з іншим ключем сервера
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapid) });
  const d = await call("subscribe", { handle: api.session.handle, password, subscription: sub.toJSON(), lang: /^(uk|rue)/.test(uiLang) ? "uk" : "en" });
  setItem(key(), d.token);
  return { chat: !!d.chat };
}

export async function disable() {
  const token = getItem(key());
  if (token) await call("unsubscribe", { did: api.session.did, token }); // сервер недоступний → помилка: токен лишається, можна повторити (пароль на сервері не загубиться)
  setItem(key(), null);
  try { await (await (await ready()).pushManager.getSubscription())?.unsubscribe(); } catch {}
}

/* ---------- заплановані пости (той самий сервер: cron раз на хвилину публікує) ---------- */
// лише текст (+ цитата чи відповідь); потрібне ввімкнене сповіщення: сервер тримає пароль застосунку й публікує від імені акаунта
export const canSchedule = () => !!(api.session && getItem(key()));
const auth = () => ({ did: api.session.did, token: getItem(key()) });
export async function schedule({ text, facets, langs, reply, quote, at }) {
  return call("sched_add", { ...auth(), text, facets, langs, reply, quote, at: new Date(at).toISOString() });
}
export async function scheduled() { return (await call("sched_list", auth())).items || []; }
export async function unschedule(id) { return call("sched_del", { ...auth(), id }); }
