// Skybee — settings: the main list of sections and every section page. Nothing here sends the user to another site.
import { errText } from "./errors.js";
import * as api from "./api.js";
import { session } from "./api.js";
import { bee, $, esc, name, vname, at, avatar, empty, spinner, toast, modal, confirmBox, pwa, actors, ico } from "./ui.js";
import { header } from "./views.js";
import { getLang } from "./compose.js";
import * as push from "./push.js";
import { UI_LANGS, uiLang, setUiLang, isUk, sortAZ } from "./i18n.js";
import * as notify from "./notify.js";
import * as X from "./extras.js";
import { inkFor, colorsOf } from "./flair.js";

// App colour (Settings → Оформлення → Колір): replaces the gold accent. Any colour works; these are the quick picks
export const APP_COLORS = [["#ff4d4d", "Червоний"], ["#ff7a2e", "Помаранчевий"], ["#ffa500", "Бурштиновий"], ["#ffee3a", "Лимонний"], ["#4cf04c", "Салатовий"],
  ["#36b86a", "Зелений"], ["#4ff0f0", "Бірюзовий"], ["#4a8cff", "Синій"], ["#7a8cff", "Волошковий"], ["#a06bff", "Бузковий"], ["#ff3df5", "Пурпуровий"],
  ["#ff8aa0", "Рожевий"], ["#d2b48c", "Пісочний"], ["#ffffff", "Білий"], ["#a8a8a8", "Сірий"], ["#6e6e6e", "Графітовий"]];
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
// WCAG contrast of two #rrggbb colours
const relLum = (h) => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mixHex = (a, b, t) => "#" + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
// an app colour too close to the page (#111 on the dark theme, pale yellow on the light one) is lightened or darkened
// just enough for buttons, the current tab and the counters to stay visible (3:1, WCAG for interface parts)
function visibleAccent(c, theme) {
  const bg = { light: "#ffffff", dim: "#161e27" }[theme] || "#0f1218", to = theme === "light" ? "#000000" : "#ffffff";
  for (let t = 0; t <= 1; t += 0.05) { const m = mixHex(c, to, t); if (contrast(m, bg) >= 3) return m; }
  return to;
}
import * as flair from "./flair.js";
import { statusBarFor, isNative } from "./native.js";
import * as upd from "./updates.js";
import { iconColor, setIconColor, iconBg, setIconBg, beeSvg, svgUrl, ICON_COLORS } from "./appicon.js";

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

// User-installed typefaces are kept in IndexedDB so larger font files survive restarts.
const FONT_DB = "skybee-font-library", FONT_STORE = "fonts";
let activeUserFont = "";
function openFontDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FONT_STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function withFontStore(mode, action) {
  const db = await openFontDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, mode), req = action(tx.objectStore(FONT_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
const listUserFonts = () => withFontStore("readonly", s => s.getAll());
const saveUserFont = record => withFontStore("readwrite", s => s.put(record));
const getUserFont = id => withFontStore("readonly", s => s.get(id));
const removeUserFont = id => withFontStore("readwrite", s => s.delete(id));
async function activateUserFont(id) {
  if (!id || activeUserFont === id) return;
  const rec = await getUserFont(id);
  if (!rec) return;
  const family = "SkybeeUserFont_" + id.replace(/[^a-z0-9]/gi, "");
  if (!document.fonts.check('16px "' + family + '"')) {
    const url = URL.createObjectURL(rec.blob);
    try { document.fonts.add(await new FontFace(family, 'url("' + url + '")').load()); }
    finally { URL.revokeObjectURL(url); }
  }
  document.documentElement.style.setProperty("--skybee-font-family", '"' + family + '"');
  activeUserFont = id;
}

// The app colour belongs to the account (switching accounts switches the colour). An older device-wide value
// goes to the account that is open the first time this runs.
const ownDid = () => { try { return JSON.parse(localStorage.getItem("skybee.session"))?.did || ""; } catch { return ""; } };
const colorKey = () => "skybee.color@" + ownDid();
export function appColor() {
  const v = store.get(colorKey());
  if (v != null) return v;
  const g = store.get("skybee.color");
  if (g && ownDid()) { store.set(colorKey(), g); store.set("skybee.color", null); }
  return g;
}
const saved = (promise, undo) => promise.then(() => toast("Збережено"), (ex) => { toast(errText(ex), 5000); undo?.(); });
// the server refuses some account actions to an app password: say what to do instead of a bare error
// an app password is refused here: the hint, plus the real cause in brackets (it may also be an expired session or a limit)
const needMain = (ex) => ((ex.status === 401 || ex.status === 403) && !/RateLimit|Expired|Takedown/i.test(ex.code || "")) || /Bad token scope|privileged/i.test(ex.message || "")
  ? `Ця дія потребує входу з основним паролем. Вийди й увійди знову, обравши «Основний пароль». ${errText(ex)}` : errText(ex);

/* ---------- section icons: the same line set as the main menu (ico in ui.js) ---------- */
const IC = new Proxy({ chev: `<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>` }, { get: (o, k) => o[k] ?? ico(k) });
const row = (href, icon, label, extra = "") =>
  `<a class="srow" href="${href}"><span class="sicon">${IC[icon]}</span><span class="grow">${label}</span>${extra}<span class="schev">${IC.chev}</span></a>`;
const toggle = (id, label, on, hint = "", disabled = false) =>
  `<label class="stoggle"><span class="grow">${label}${hint ? `<small class="muted">${hint}</small>` : ""}</span><input type="checkbox" id="${id}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}><i></i></label>`;
const seg = (attr, items, cur) => `<div class="seg">${items.map(([v, l]) => `<button data-${attr}="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;

/* ================= MAIN LIST ================= */
// Like Telegram: my profile on top over my Skybee profile colour (fading softly into the theme), then the accounts on this
// device as a list — each with its unread count, a tap switches to it — and «Додати акаунт»; QR and «Змінити» in the top bar
export async function index(el) {
  const me = actors.get(session.did) || session;
  const others = api.accounts.filter(a => a.did !== session.did);
  const head = (p) => `${avatar(p, 96)}<b>${vname(p)}</b><span class="muted">${at(session.handle)}</span>`;
  const acc = (a) => {
    const p = actors.get(a.did) || a;
    return `<button class="srow acc" data-act="switchAccount" data-did="${esc(a.did)}" title="Перемкнутися на ${esc(at(a.handle))}">${avatar(p, 34)}
      <span class="grow"><b>${name(p)}</b><small class="muted">${at(a.handle)}</small></span><span class="acc-n" data-n="${esc(a.did)}"></span></button>`;
  };
  el.innerHTML = header("Налаштування", false,
    `<button class="ghost icon" data-act="shareMe" title="QR-код і посилання на мій профіль">${ico("qr", 20)}</button><button class="ghost icon" data-act="editProfile" title="Змінити профіль" aria-label="Змінити профіль">${ico("pen", 20)}</button>`) + `
    <a class="shead" href="#/profile/${encodeURIComponent(session.handle)}">${head(me)}</a>
    <div class="sgroup accs">
      ${others.map(acc).join("")}
      <button class="srow" data-act="addAccount"><span class="sicon">${ico("plus")}</span><span class="grow">Додати акаунт</span></button>
      ${others.length ? row("#/settings/accounts", "users", "Керувати акаунтами") : ""}
    </div>
    <div class="sgroup">
      ${row("#/settings/account", "user", "Акаунт")}
      ${row("#/settings/privacy", "lock", "Конфіденційність і безпека")}
      ${row("#/settings/moderation", "shield", "Модерація")}
      ${row("#/settings/notifs", "bell", "Сповіщення")}
      ${row("#/settings/media", "media", "Вміст і медіа")}
      ${row("#/settings/appearance", "brush", "Оформлення")}
      ${row("#/settings/analytics", "chart", "Аналітика та інструменти")}
      ${row("#/settings/a11y", "a11y", "Доступність")}
      ${row("#/settings/langs", "globe", "Мови")}
      ${row("#/settings/help", "help", "Довідка")}
      ${row("#/settings/about", "info", "Про Skybee")}
    </div>
    <div class="sgroup"><button class="srow danger" data-act="logout"><span class="grow">Вийти з ${at(session.handle)}</span></button></div>`;
  // my Skybee profile colour behind the top, melting into the page; without one — a faint glow of the app accent
  flair.load(session.did).then(got => { const h = $(".shead", el), c = colorsOf(got?.rec); if (h && c) { h.style.setProperty("--pc", c[0]); h.style.setProperty("--pc2", c[1]); } }).catch(() => {});
  // my own profile may still be loading on the very first screen
  if (!actors.get(session.did)) api.get("app.bsky.actor.getProfile", { actor: session.did }).then(p => {
    actors.set(p.did, p);
    const h = $(".shead", el); if (h) h.innerHTML = head(p);
  }).catch(() => {});
  if (!others.length) return;
  // fresh names and avatars of the other accounts, and how many unseen notifications each has (asked as that account)
  api.get("app.bsky.actor.getProfiles", { actors: others.map(a => a.did).slice(0, 25) }).then(d => {
    d.profiles.forEach(p => actors.set(p.did, p));
    const box = $(".accs", el); if (!box) return;
    for (const a of others) { const b = box.querySelector(`[data-did="${CSS.escape(a.did)}"]`); if (b) b.outerHTML = acc(a); }
    others.forEach(count);
  }).catch(() => others.forEach(count));
  function count(a) {
    api.get("app.bsky.notification.getUnreadCount", {}, { as: a }).then(r => {
      const n = el.querySelector(`[data-n="${CSS.escape(a.did)}"]`);
      if (n && r?.count) n.textContent = r.count > 99 ? "99+" : r.count;
    }).catch(() => {});
  }
}

/* ================= ACCOUNTS ON THIS DEVICE ================= */
export async function accounts(el) {
  const draw = (profiles = []) => api.accounts.map(a => {
    const p = profiles.find(p => p.did === a.did) || actors.get(a.did) || a, active = a.did === session.did;
    return `<div class="accrow">${avatar(p, 44)}
      <div class="who"><b>${name(p)}</b><span class="muted small">${at(a.handle)}${active ? ` · сервер ${esc((a.pds || "").replace(/^https?:\/\//, ""))}` : ""}</span></div>
      ${active ? `<span class="pill">активний</span>`
        : `<button class="btn sm" data-act="switchAccount" data-did="${esc(a.did)}">Перемкнути</button><button class="ghost sm" data-act="removeAccount" data-did="${esc(a.did)}" title="Вийти з цього акаунта">✕</button>`}
    </div>`;
  }).join("");
  el.innerHTML = header("Акаунти", true) + `<div class="card"><div id="acclist">${draw()}</div>
    <button class="ghost sm" data-act="addAccount">Додати акаунт</button>
    <p class="small muted">Тут усі акаунти, у які ви увійшли на цьому пристрої. Перемикатися можна без повторного входу.</p></div>`;
  api.get("app.bsky.actor.getProfiles", { actors: api.accounts.map(a => a.did).slice(0, 25) })
    .then(d => { const box = $("#acclist", el); if (box) box.innerHTML = draw(d.profiles); }).catch(() => {});
}

/* ================= ACCOUNT ================= */
// Asks for the code sent by e-mail (and more fields when given); resolves with their values or null
function codeDialog(title, text, fields = []) {
  return new Promise(res => {
    let done = false;
    const m = modal(`<h3>${title}</h3><p class="small muted">${text}</p>
      ${fields.map(f => `<label class="field">${f.label}<input data-f="${f.key}" type="${f.type || "text"}" ${f.type === "password" ? 'autocomplete="current-password"' : 'autocomplete="one-time-code" autocapitalize="characters"'} value="${esc(f.value || "")}"></label>`).join("")}
      <p class="err"></p><div class="row end"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Далі</button></div>`,
      { onClose: () => { if (!done) res(null); } });
    $("input", m)?.focus();
    m.addEventListener("click", (e) => {
      const x = e.target.closest("[data-x]"); if (!x) return;
      if (x.dataset.x === "1") {
        const v = Object.fromEntries(fields.map(f => [f.key, $(`[data-f=${f.key}]`, m).value]));
        if (fields.some(f => !v[f.key].trim())) { $(".err", m).textContent = "Заповни всі поля"; return; }
        done = true; res(v);
      }
      m.close();
    });
  });
}

export async function account(el) {
  el.innerHTML = header("Акаунт", true) + spinner();
  const a = await api.getAccount();
  const birth = api.pref("personalDetailsPref").birthDate?.slice(0, 10) || "";
  el.innerHTML = header("Акаунт", true) + `
    <div class="card">
      <h3>Пошта</h3>
      ${a.email ? `<p>${esc(a.email)} ${a.emailConfirmed ? `<span class="pill">підтверджено</span>` : `<span class="pill">не підтверджено</span>`}</p>
        <div class="row wrap">${a.emailConfirmed ? "" : `<button class="btn sm" id="confirmEmail">Підтвердити</button>`}<button class="ghost sm" id="changeEmail">Змінити пошту</button></div>`
      : `<p class="small muted">З паролем застосунку пошту не видно. Щоб змінити пошту, увійди з основним паролем.</p>`}
    </div>
    <div class="card">
      <h3>Нік</h3>
      <p>${at(a.handle)} <span class="muted small">(${esc(a.handle)})</span></p>
      <form class="row" id="handleform"><input name="handle" placeholder="новий-нік або власний домен" autocapitalize="none" spellcheck="false" required><button class="btn sm">Змінити</button></form>
      <p class="small muted">Короткий нік отримає закінчення .bsky.social. Для власного домену спершу додай DNS-запис <code>_atproto</code> зі значенням <code>did=${esc(a.did)}</code>.</p>
    </div>
    <div class="card">
      <h3>Пароль</h3>
      <button class="ghost sm" id="pwreset" ${a.email ? "" : "disabled"}>Змінити основний пароль</button>
      <a class="rowlink" href="#/settings/passwords">Паролі застосунків →</a>
    </div>
    <div class="card">
      <h3>Дата народження</h3>
      <form class="row" id="birthform"><input type="date" name="birth" value="${esc(birth)}" max="${new Date().toISOString().slice(0, 10)}"><button class="btn sm">Зберегти</button></form>
      <p class="small muted">Видно лише вам. Від неї залежить доступ до контенту для дорослих.</p>
    </div>
    <div class="card">
      <h3>Мої дані</h3>
      <button class="ghost sm" id="export">Завантажити архів (CAR)</button>
      <p class="small muted">Усі ваші пости, вподобання й підписки одним файлом. Медіафайли в архів не входять.</p>
      <p class="small muted">DID: <code>${esc(a.did)}</code><br>Сервер: <code>${esc(session.pds)}</code></p>
    </div>
    <div class="card">
      <h3>Деактивація та видалення</h3>
      <button class="ghost sm" id="deactivate">Деактивувати акаунт</button>
      <p class="small muted">Профіль і пости сховаються, доки ви не ввійдете знову.</p>
      <button class="ghost sm danger" id="delete">Видалити акаунт назавжди</button>
      <p class="small muted">Знадобляться основний пароль і код із пошти. Скасувати видалення неможливо.</p>
    </div>`;

  $("#confirmEmail", el)?.addEventListener("click", async (e) => {
    try {
      e.target.disabled = true;
      await api.requestEmailConfirmation();
      const v = await codeDialog("Підтвердження пошти", `Код надіслано на ${esc(a.email)}.`, [{ key: "code", label: "Код із листа" }]);
      if (v) { await api.confirmEmail(a.email, v.code); toast("Пошту підтверджено"); account(el); }
    } catch (ex) { toast(needMain(ex), 5000); }
    e.target.disabled = false;
  });
  $("#changeEmail", el)?.addEventListener("click", async (e) => {
    try {
      e.target.disabled = true;
      const { tokenRequired } = await api.requestEmailUpdate();
      const v = await codeDialog("Нова пошта", tokenRequired ? `Код надіслано на поточну адресу ${esc(a.email)}.` : "Введи нову адресу.",
        [{ key: "email", label: "Нова пошта", type: "email" }, ...(tokenRequired ? [{ key: "code", label: "Код із листа" }] : [])]);
      if (v) { await api.updateEmail(v.email.trim(), v.code); toast("Пошту змінено. Підтверди нову адресу."); account(el); }
    } catch (ex) { toast(needMain(ex), 5000); }
    e.target.disabled = false;
  });
  $("#handleform", el).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $("button", f);
    btn.disabled = true;
    try { await api.changeHandle(f.handle.value); toast("Нік змінено"); location.reload(); }
    catch (ex) { toast(needMain(ex), 5000); btn.disabled = false; }
  };
  $("#pwreset", el).onclick = async (e) => {
    try {
      e.target.disabled = true;
      await api.requestPasswordReset(a.email);
      const v = await codeDialog("Новий пароль", `Код надіслано на ${esc(a.email)}.`,
        [{ key: "code", label: "Код із листа" }, { key: "pass", label: "Новий пароль (щонайменше 8 символів)", type: "password" }]);
      if (v) {
        if (v.pass.length < 8) throw new Error("Пароль має містити щонайменше 8 символів");
        await api.resetPassword(v.code, v.pass); toast("Пароль змінено");
      }
    } catch (ex) { toast(errText(ex), 5000); }
    e.target.disabled = false;
  };
  $("#birthform", el).onsubmit = (e) => {
    e.preventDefault();
    const d = e.target.birth.value; if (!d) return;
    saved(api.updatePref("personalDetailsPref", { birthDate: new Date(d + "T00:00:00Z").toISOString() }));
  };
  $("#export", el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const url = URL.createObjectURL(await api.exportRepo()), link = document.createElement("a");
      link.href = url; link.download = `${a.handle}-${new Date().toISOString().slice(0, 10)}.car`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (ex) { toast(errText(ex)); }
    e.target.disabled = false;
  };
  $("#deactivate", el).onclick = async () => {
    if (!await confirmBox("Деактивувати акаунт? Профіль і пости зникнуть для всіх, доки ви не ввійдете знову.", "Деактивувати", true)) return;
    try { await api.deactivateAccount(); api.logout(); location.hash = "#/"; location.reload(); }
    catch (ex) { toast(needMain(ex), 5000); }
  };
  $("#delete", el).onclick = async () => {
    if (!await confirmBox(`Видалити акаунт @${a.handle} назавжди? Усі пости, підписки й повідомлення буде втрачено.`, "Далі", true)) return;
    try {
      await api.requestAccountDelete();
      const v = await codeDialog("Видалення акаунта", `Код надіслано на ${esc(a.email || "пошту акаунта")}. Це остання можливість передумати.`,
        [{ key: "code", label: "Код із листа" }, { key: "pass", label: "Основний пароль", type: "password" }]);
      if (!v) return;
      await api.deleteAccount(v.pass, v.code);
      api.logout(); location.hash = "#/"; location.reload();
    } catch (ex) { toast(needMain(ex), 5000); }
  };
}

/* ================= PRIVACY & SECURITY ================= */
export async function privacy(el) {
  el.innerHTML = header("Конфіденційність і безпека", true) + `
    <div class="card">
      <h3>Вхід</h3>
      <a class="rowlink" href="#/settings/passwords">Паролі застосунків →</a>
      ${toggle("twofa", "Підтвердження входу кодом із пошти", false, "При вході з основним паролем на пошту приходитиме код", true)}
    </div>
    <div class="card">
      <h3>Хто може</h3>
      <label class="field">Писати мені в чат<select id="chatacc" disabled><option value="all">Усі</option><option value="following">Ті, за ким я стежу</option><option value="none">Ніхто</option></select></label>
      <label class="field">Отримувати сповіщення про мої нові пости<select id="actacc" disabled><option value="followers">Мої читачі</option><option value="mutuals">Лише взаємні підписки</option><option value="none">Ніхто</option></select></label>
      <a class="rowlink" href="#/settings/media">Хто може відповідати на нові пости — у «Вміст і медіа» →</a>
    </div>
    <div class="card">
      ${toggle("noauth", "Просити не показувати мій акаунт без входу", false, "Застосунки й сайти, які це підтримують, не показуватимуть профіль і пости тим, хто не увійшов. Це прохання, а не захист: дані в Bluesky публічні.", true)}
    </div>`;
  api.getChatAccess().then(v => { const s = $("#chatacc", el); if (!s) return; s.value = v; s.disabled = false; s.onchange = () => saved(api.setChatAccess(s.value)); });
  api.getActivityAccess().then(v => { const s = $("#actacc", el); if (!s) return; s.value = v; s.disabled = false; s.onchange = () => saved(api.setActivityAccess(s.value)); });
  api.loggedOutHidden().then(on => {
    const c = $("#noauth", el); if (!c) return; c.checked = on; c.disabled = false;
    c.onchange = () => saved(api.setLoggedOutHidden(c.checked), () => { c.checked = !c.checked; });
  }).catch(() => {});
  // 2FA lives with the e-mail settings: turning it on or off needs a code from the inbox
  api.getAccount().then(a => {
    const c = $("#twofa", el); if (!c || !a.email) return;
    c.checked = !!a.emailAuthFactor; c.disabled = false;
    c.onchange = async () => {
      const want = c.checked;
      try {
        const { tokenRequired } = await api.requestEmailUpdate();
        const v = tokenRequired ? await codeDialog("Підтвердження", `Код надіслано на ${esc(a.email)}.`, [{ key: "code", label: "Код із листа" }]) : {};
        if (!v) { c.checked = !want; return; }
        await api.updateEmail(a.email, v.code, want); toast(want ? "Вхід із кодом увімкнено" : "Вхід із кодом вимкнено");
      } catch (ex) { c.checked = !want; toast(needMain(ex), 5000); }
    };
  }).catch(() => {});
}

/* ================= MODERATION ================= */
export async function moderation(el) {
  el.innerHTML = header("Модерація", true) + `
    <div class="sgroup">
      ${row("#/settings/content", "shield", "Фільтри контенту")}
      ${row("#/settings/words", "media", "Приховані слова й теги")}
      ${row("#/settings/mutes", "user", "Приховані акаунти")}
      ${row("#/settings/blocks", "lock", "Заблоковані акаунти")}
      ${row("#/settings/blocked-by", "lock", "Хто мене заблокував")}
      ${row("#/lists", "users", "Модераційні списки")}
    </div>
    <div class="card"><h3>Сервіси модерації</h3><div data-labelers>${spinner()}</div>
      <p class="hint">Підписатися на інший сервіс можна на його профілі — там же налаштовуються його мітки. Знайти сервіси: пошук «labeler» або списки на кшталт bluesky-labelers.</p></div>
    <p class="pad small muted">Приховані акаунти не бачать, що ви їх приховали. Заблоковані не можуть бачити ваші пости й взаємодіяти з вами.</p>`;
  const box = $("[data-labelers]", el);
  try {
    await api.getPrefs(true); const views = await api.loadLabelers();
    const all = [{ creator: { did: api.BSKY_MOD, handle: "moderation.bsky.app", displayName: "Bluesky Moderation Service" }, always: true }, ...views];
    box.innerHTML = all.map(v => `<a class="actor" href="#/profile/${encodeURIComponent(v.creator.handle || v.creator.did)}">${avatar(v.creator, 36)}
      <div class="who"><b>${esc(v.creator.displayName || v.creator.handle)}</b><span class="muted small">${v.always ? "Увімкнено завжди" : `${(v.policies?.labelValues || []).length} міток`}</span></div></a>`).join("");
  } catch (ex) { box.innerHTML = `<p class="err">${esc(errText(ex))}</p>`; }
}

/* ================= NOTIFICATIONS ================= */
const NTYPES = [
  ["like", "Вподобання", true], ["repost", "Поширення", true], ["follow", "Нові читачі", true], ["reply", "Відповіді", true],
  ["mention", "Згадки", true], ["quote", "Цитати", true], ["likeViaRepost", "Вподобання ваших поширень", true],
  ["repostViaRepost", "Поширення ваших поширень", true], ["subscribedPost", "Нові пости тих, на кого підписані дзвіночком", false],
  ["starterpackJoined", "Приєднання через ваш стартовий набір", false], ["verified", "Верифікація", false],
];
export async function notifications(el) {
  el.innerHTML = header("Сповіщення", true) + `
    <div class="card">
      <h3>На цьому пристрої</h3>
      ${toggle("sysnotify", "Системні сповіщення", notify.enabled(), notify.supported()
        ? "Надходять, поки Skybee відкритий — у вкладці (навіть фоновій) або як встановлений застосунок."
        : "Цей браузер не підтримує системні сповіщення.", !notify.supported())}
    </div>
    ${push.supported() ? `<div class="card" id="pushcard"><h3>Push при закритому застосунку</h3>${spinner()}</div>` : ""}
    <div class="card" id="nprefs"><h3>Що показувати в сповіщеннях</h3>${spinner()}</div>`;
  $("#sysnotify", el).onchange = async (e) => {
    if (!e.target.checked) { notify.disable(); return toast("Сповіщення вимкнено"); }
    if (await notify.enable()) return toast("Сповіщення увімкнено");
    e.target.checked = false;
    toast("Браузер не дозволив сповіщення. Дозволь їх для цього сайту в налаштуваннях браузера.", 5000);
  };
  if (push.supported()) pushCard($("#pushcard", el));
  const box = $("#nprefs", el);
  let prefs;
  try { prefs = await api.getNotifPrefs(); }
  catch (ex) { box.insertAdjacentHTML("beforeend", `<p class="err">${esc(errText(ex))}</p>`); box.querySelector(".sentinel")?.remove(); return; }
  box.innerHTML = `<h3>Що показувати в сповіщеннях</h3>` + NTYPES.map(([k, label, filter]) => {
    const p = prefs[k] || {}, on = p.list !== false;
    return `<div class="nprefrow">${toggle("n-" + k, label, on)}
      ${filter ? `<select data-include="${k}" ${on ? "" : "disabled"}><option value="all">від усіх</option><option value="follows" ${p.include === "follows" ? "selected" : ""}>лише від тих, за ким я стежу</option></select>` : ""}</div>`;
  }).join("") + `<div class="nprefrow"><label class="field">Нові повідомлення в чатах<select data-chat><option value="all">від усіх</option><option value="accepted" ${prefs.chat?.include === "accepted" ? "selected" : ""}>лише з прийнятих чатів</option></select></label></div>
    <p class="small muted">Налаштування зберігаються в акаунті й діють і в інших застосунках.</p>`;
  const put = (k, patch, undo) => saved(api.putNotifPrefs({ [k]: { ...(prefs[k] || {}), ...patch } }).then(() => { prefs[k] = { ...(prefs[k] || {}), ...patch }; }), undo);
  NTYPES.forEach(([k, , filter]) => {
    const c = $("#n-" + k, box);
    c.onchange = () => {
      const sel = $(`[data-include="${k}"]`, box); if (sel) sel.disabled = !c.checked;
      put(k, { list: c.checked, push: prefs[k]?.push ?? c.checked, ...(filter ? { include: prefs[k]?.include || "all" } : {}) }, () => { c.checked = !c.checked; });
    };
  });
  box.querySelectorAll("[data-include]").forEach(s => s.onchange = () => put(s.dataset.include, { include: s.value, list: true, push: prefs[s.dataset.include]?.push ?? true }));
  $("[data-chat]", box).onchange = (e) => put("chat", { include: e.target.value, push: prefs.chat?.push ?? true });
}

// Web Push: the server on skybee.online checks the account once a minute with an app password and pushes news to this device
async function pushCard(card) {
  const draw = async () => {
    const on = await push.active();
    card.innerHTML = `<h3>Push при закритому застосунку</h3>` + (on
      ? `<p class="small">Увімкнено на цьому пристрої: сповіщення й нові повідомлення приходять, навіть коли Skybee закритий.</p><button class="ghost" id="pushoff">Вимкнути й видалити пароль із сервера</button>`
      : `<p class="small muted">Сервер Skybee раз на хвилину питає Bluesky про нове й надсилає push. Для цього потрібен <b>окремий пароль застосунку</b>
          (Bluesky → Налаштування → Паролі застосунків). Щоб приходили й чати — постав галочку <b>«Allow access to your direct messages»</b>.
          Пароль зберігається на сервері зашифрованим, вимкнення його видаляє; у будь-який момент його можна відкликати в Bluesky.</p>
        <label class="field">Пароль застосунку<input id="pushpw" type="password" autocomplete="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx-xxxx"></label>
        <button class="btn" id="pushon">Увімкнути push</button><p class="err small" id="pusherr"></p>`);
    $("#pushoff", card)?.addEventListener("click", async () => { try { await push.disable(); toast("Push вимкнено"); } catch (ex) { toast("Сервер push недоступний — пароль ще на ньому. Спробуй вимкнути пізніше.", 5000); } draw(); });
    $("#pushon", card)?.addEventListener("click", async (e) => {
      const pw = $("#pushpw", card).value.trim(), err = $("#pusherr", card);
      if (!pw) { err.textContent = "Встав пароль застосунку"; return; }
      e.target.disabled = true; err.textContent = "";
      try {
        const { chat } = await push.enable(pw);
        toast(chat ? "Push увімкнено, чати теж" : "Push увімкнено, але без чатів: у цьому паролі немає доступу до повідомлень", 5000);
        draw();
      } catch (ex) {
        e.target.disabled = false;
        err.textContent = ex.code === "mainpw" ? "Це основний пароль. Створи пароль застосунку: Bluesky → Налаштування → Паролі застосунків."
          : ex.code === "login" ? "Bluesky не прийняв цей пароль. Потрібен саме пароль застосунку, не основний."
          : ex.code === "denied" ? "Браузер не дозволив сповіщення. Дозволь їх для цього сайту в налаштуваннях браузера."
          : ex.code === "rate" ? "Забагато спроб. Спробуй за годину."
          : ex.code === "sw" || ex.code === "server" ? "Сервіс push зараз недоступний. Спробуй пізніше." : errText(ex);
      }
    });
  };
  draw();
}

/* ================= CONTENT & MEDIA ================= */
export async function media(el) {
  await api.getPrefs().catch(() => {});
  const home = api.pref("feedViewPref", "home"), th = api.pref("threadViewPref");
  const tsort = ["oldest", "newest"].includes(th.sort) ? th.sort : "most-likes";
  const gate = api.defaultGate(), gateMode = !gate ? "all" : gate.length ? "some" : "none";
  el.innerHTML = header("Вміст і медіа", true) + `
    <div class="sgroup">${row("#/feeds", "media", "Мої фіди та їхній порядок")}</div>
    <div class="card">
      <h3>Стрічка «Підписки»</h3>
      ${[["hideReplies", "Приховувати відповіді"], ["hideReposts", "Приховувати поширення"], ["hideQuotePosts", "Приховувати цитати"]].map(([k, l]) => toggle("h-" + k, l, home[k])).join("")}
    </div>
    <div class="card">
      <h3>Гілки</h3>
      <label class="field">Порядок відповідей<select id="tsort">${[["most-likes", "Спершу популярні"], ["oldest", "Спершу старіші"], ["newest", "Спершу новіші"]].map(([v, l]) =>
        `<option value="${v}" ${v === tsort ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${toggle("tfollow", "Спершу відповіді від тих, за ким я стежу", !!th.prioritizeFollowedUsers)}
    </div>
    <div class="card">
      <h3>Нові пости</h3>
      <label class="field">Хто може відповідати за замовчуванням<select id="defgate">
        <option value="all" ${gateMode === "all" ? "selected" : ""}>Усі</option>
        <option value="follow" ${gateMode === "some" && gate.some(r => r.$type?.endsWith("followingRule")) ? "selected" : ""}>Ті, за ким я стежу</option>
        <option value="mention" ${gateMode === "some" && gate.every(r => r.$type?.endsWith("mentionRule")) ? "selected" : ""}>Лише згадані</option>
        <option value="none" ${gateMode === "none" ? "selected" : ""}>Ніхто</option></select></label>
      <p class="small muted">Для окремого поста це можна змінити в редакторі.</p>
    </div>
    <div class="card">
      <h3>Медіа</h3>
      ${toggle("autogif", "Автоматично відтворювати GIF", store.get("skybee.autogif") === "1")}
      <label class="field">Ключ Tenor API — для пошуку GIF<input id="tenorkey" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(store.get("skybee.tenorKey") || "")}"></label>
      <p class="small muted">Безплатний: Google Cloud Console → новий проєкт → увімкнути «Tenor API» → «Облікові дані» → «Створити ключ API». Зберігається лише на цьому пристрої.</p>
      ${toggle("sbbadge", "Значок Skybee біля мого імені", store.get("skybee.badge") === "1", "Інші користувачі Skybee бачать біля вашого імені нашу бджолу (у вашому репозиторії зберігається позначка). Вимкнете — позначку буде прибрано")}
      ${toggle("postcolors", "Кольори профілів на постах", store.get("skybee.postColors") !== "0", "Пости людей з оформленням Skybee — на м'якому градієнті їхнього профілю")}
      <p class="small muted">Оформлення Skybee безпечне для твоєї IP-адреси: чужі записи читаються через публічний кеш, а іграшка — з CDN, тож сервер власника профілю тебе не бачить.</p>
      ${toggle("bmsync", "Папки закладок в акаунті", store.get("skybee.bmSync") === "1", "Папки зберігаються в записі вашого акаунта й з'являються на інших пристроях. Увага: запис публічний — будь-хто зможе побачити назви папок і які пости в них лежать, хоча самі закладки в Bluesky приватні")}
      ${toggle("botfilter", "Ховати підозрілі відповіді", store.get("skybee.botFilter") === "1", "У гілках: акаунти без аватарки, зовсім нові або з нікнеймом із купою цифр — під згорткою «Підозрілі відповіді». Це припущення, не вирок")}
      ${toggle("players", "Вбудовані плеєри", store.get("skybee.players") !== "0", "YouTube, Spotify, SoundCloud, Vimeo, Twitch, Apple Music грають прямо в пості — після натискання ▶")}
      ${toggle("extmedia", "Показувати картки посилань із зображеннями", store.get("skybee.noLinkThumbs") !== "1")}
    </div>`;
  el.querySelectorAll("[id^=h-]").forEach(c => c.onchange = () => saved(api.updatePref("feedViewPref", { [c.id.slice(2)]: c.checked }, "home"), () => { c.checked = !c.checked; }));
  $("#tsort", el).onchange = (e) => saved(api.updatePref("threadViewPref", { sort: e.target.value }));
  $("#tfollow", el).onchange = (e) => saved(api.updatePref("threadViewPref", { prioritizeFollowedUsers: e.target.checked }), () => { e.target.checked = !e.target.checked; });
  $("#defgate", el).onchange = (e) => {
    const R = "app.bsky.feed.threadgate#";
    const rules = { all: undefined, none: [], follow: [{ $type: R + "followingRule" }, { $type: R + "mentionRule" }], mention: [{ $type: R + "mentionRule" }] }[e.target.value];
    saved(api.updatePref("postInteractionSettingsPref", { threadgateAllowRules: rules }));
  };
  $("#autogif", el).onchange = (e) => { store.set("skybee.autogif", e.target.checked ? "1" : null); toast("Збережено"); };
  $("#tenorkey", el).onchange = (e) => { store.set("skybee.tenorKey", e.target.value.trim() || null); toast(e.target.value.trim() ? "Ключ збережено — шукай GIF кнопкою «GIF» у редакторі" : "Ключ прибрано"); };
  $("#sbbadge", el).onchange = async (e) => { store.set("skybee.badge", e.target.checked ? "1" : "0"); toast("Збережено"); (await import("./flair.js")).syncBadge(); };
  $("#postcolors", el).onchange = (e) => { store.set("skybee.postColors", e.target.checked ? null : "0"); toast("Збережено — діє на нових екранах"); };
  $("#bmsync", el).onchange = (e) => { store.set("skybee.bmSync", e.target.checked ? "1" : null); toast(e.target.checked ? "Папки зберігатимуться в акаунті (публічно)" : "Папки лишилися лише на цьому пристрої"); e.target.checked ? X.pushFolders() : X.dropFolderRecord(); };
  $("#botfilter", el).onchange = (e) => { store.set("skybee.botFilter", e.target.checked ? "1" : null); toast("Збережено — діє на нових екранах"); };
  $("#players", el).onchange = (e) => { store.set("skybee.players", e.target.checked ? null : "0"); toast("Збережено"); };
  $("#extmedia", el).onchange = (e) => { store.set("skybee.noLinkThumbs", e.target.checked ? null : "1"); document.body.classList.toggle("nolinkthumbs", !e.target.checked); toast("Збережено"); };
}

/* ================= APPEARANCE ================= */
// What the phone is: the app knows it from Capacitor, a browser from the user agent (iPad says «Macintosh» but has touch)
export function devicePlatform() {
  const p = window.Capacitor?.getPlatform?.();
  if (p === "ios" || p === "android") return p;
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "other";
}
// skybee.ui: auto | glass | material | skybee; «auto» = Liquid Glass on iPhone/iPad, Material on Android, the Skybee look elsewhere
export function uiStyle() {
  const v = store.get("skybee.ui") || "auto";
  if (v !== "auto") return v;
  return { ios: "glass", android: "material" }[devicePlatform()] || "skybee";
}
export const refractWorks = () => /Chrome\/|Chromium|Electron/.test(navigator.userAgent) && !/iPhone|iPad|iPod/.test(navigator.userAgent);
export function applyLook() {
  const t = store.get("skybee.theme") || "dark";
  const sys = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const root = document.documentElement, c = appColor();
  root.dataset.theme = t === "system" ? sys : t;
  // app colour: the palette of the profile colour (js/flair.js); it replaces the gold accent (buttons, switches, the current tab)
  const ok = isHex(c);
  root.classList.toggle("sb-theme", ok);
  if (ok) { const a = visibleAccent(c, root.dataset.theme); root.style.setProperty("--sb", a); root.style.setProperty("--sb-ink", inkFor(a)); }
  else { root.style.removeProperty("--sb"); root.style.removeProperty("--sb-ink"); }
  root.style.colorScheme = ""; // the colour only changes the accent now, the page keeps its theme
  // interface style: Liquid Glass (iPhone by default) or Material Design (Android by default), each with its own options
  const ui = uiStyle();
  root.dataset.ui = ui;
  const selectedFont = store.get("skybee.fontFamily") || "zakon";
  root.dataset.fontFamily = selectedFont.startsWith("custom:") ? "custom" : "zakon";
  root.dataset.fontStyle = ["regular", "italic", "bold", "bolditalic"].includes(store.get("skybee.fontStyle")) ? store.get("skybee.fontStyle") : "regular";
  if (selectedFont.startsWith("custom:")) activateUserFont(selectedFont.slice(7)).catch(() => toast("Не вдалося завантажити власний шрифт"));
  root.dataset.glass = store.get("skybee.glass") || "normal";
  root.classList.toggle("glass-float", store.get("skybee.glassFloat") !== "0");
  // refraction needs backdrop-filter: url(…), which only Chromium draws (desktop app, Android, Chrome); Safari would drop the blur too
  root.classList.toggle("lg-refract", store.get("skybee.lgRefract") === "1" && refractWorks());
  root.classList.toggle("m-labels", store.get("skybee.mLabels") !== "0");
  root.classList.toggle("m-tonal", store.get("skybee.mTonal") !== "0");
  root.classList.toggle("m-ripple", store.get("skybee.mRipple") !== "0");
  document.body.style.fontSize = (store.get("skybee.font") || "15") + "px";
  document.body.classList.toggle("calm", store.get("skybee.calm") === "1");
  const fl = store.get("skybee.feedLook"); // «Вигляд стрічки»: компактний список / мозаїка медіа (css: fl-compact, fl-mosaic)
  document.body.classList.toggle("fl-compact", fl === "compact");
  document.body.classList.toggle("fl-mosaic", fl === "mosaic");
  document.body.classList.toggle("nolinkthumbs", store.get("skybee.noLinkThumbs") === "1");
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0f1218";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  // phone status bar icons: light on a dark page, dark on a light one
  statusBarFor(root.dataset.theme !== "light");
}
export async function appearance(el) {
  let userFonts = [];
  try { userFonts = await listUserFonts(); } catch {}
  const draw = () => {
    const theme = store.get("skybee.theme") || "dark", font = store.get("skybee.font") || "15", color = isHex(appColor()) ? appColor() : "";
    const icolor = iconColor(), ibg = iconBg(), uiPick = store.get("skybee.ui") || "auto", ui = uiStyle();
    el.innerHTML = header("Оформлення", true) + `
      <div class="card"><h3>Тема</h3>${seg("th", [["system", "Як у системі"], ["dark", "Темна"], ["dim", "Сутінки"], ["light", "Світла"]], theme)}</div>
      <div class="card"><h3>Колір</h3><p class="muted small">Колір кнопок, перемикачів, позначок і активної вкладки — замість золотого.</p><div class="sb-swatches app">${
        [["", "Золотий — як у бджілки"], ...APP_COLORS].map(([c, n]) => `<button type="button" class="sb-sw${c ? "" : " none"}${c === color ? " on" : ""}" data-color="${c}" title="${n}" aria-label="${n}"${c ? ` style="background:${c}"` : ""}>${c ? "" : bee(18)}</button>`).join("")}<label class="sb-sw sb-any${color && !APP_COLORS.some(([c]) => c === color) ? " on" : ""}" title="Свій колір"${color && !APP_COLORS.some(([c]) => c === color) ? ` style="--own:${color}"` : ""}><input type="color" data-anycolor value="${isHex(color) ? color : "#ff4d4d"}"><b>+</b></label></div>
        <p class="muted small">${!color ? "Золотий — як у бджілки" : APP_COLORS.find(([c]) => c === color)?.[1] || `Свій колір ${color}`}</p></div>
      <div class="card"><h3>Іконка застосунку</h3><p class="muted small">Кольори ті самі, що й для кнопок. На сайті — бджола без фону у вкладці; на комп'ютері — значок вікна й трею; на телефоні — значок на екрані з готових кольорів.</p>
        ${seg("ibg", [["", "Світла"], ["dim", "Сутінки"], ["dark", "Темна"]], ibg)}<div class="sb-icons">${[["", "Золота — як є"], ...APP_COLORS.filter(([c]) => !isNative || ICON_COLORS.includes(c))].map(([c, n]) => `<button type="button" class="sb-ic${c === icolor ? " on" : ""}" data-icon="${c}" title="${n}" aria-label="${n}"><img alt="" src="${svgUrl(beeSvg(c, true, 112, ibg))}"></button>`).join("")}${isNative ? "" : `<label class="sb-ic sb-any${icolor && !APP_COLORS.some(([c]) => c === icolor) ? " on" : ""}" title="Свій колір"><input type="color" data-anyicon value="${icolor || "#ff4d4d"}">${icolor && !APP_COLORS.some(([c]) => c === icolor) ? `<img alt="" src="${svgUrl(beeSvg(icolor, true, 112, ibg))}">` : "<b>+</b>"}</label>`}</div></div>
      <div class="card"><h3>Вигляд стрічки</h3><p class="muted small">«Компактний» — багато постів на екрані, дрібні відступи й картинки. «Мозаїка» — режим сітки ▦ показує фото різної висоти, як Pinterest.</p>
        ${seg("fl", [["", "Звичайний"], ["compact", "Компактний"], ["mosaic", "Мозаїка"]], store.get("skybee.feedLook") || "")}</div>
      <div class="card"><h3>Шрифт</h3><p class="muted small">Використовуй національний шрифт Zakon або встанови власний файл. Підтримуються TTF, OTF, WOFF і WOFF2.</p>
        <div class="seg"><button type="button" data-fontfamily="zakon" class="${(store.get("skybee.fontFamily") || "zakon") === "zakon" ? "on" : ""}">Zakon</button><button type="button" data-fontfamily="custom" class="${(store.get("skybee.fontFamily") || "").startsWith("custom:") ? "on" : ""}">Мій шрифт</button></div>
        ${userFonts.length ? `<label class="field">Встановлений шрифт<select id="userFontChoice">${userFonts.map(f => `<option value="${esc(f.id)}" ${store.get("skybee.fontFamily") === "custom:" + f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label><button type="button" class="ghost sm danger" id="removeUserFont">Видалити вибраний шрифт</button>` : ""}
        <label class="field">Завантажити власні шрифти<input id="userFontUpload" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" multiple></label>
        <p class="muted small">Файли зберігаються лише на цьому пристрої. Можна додати кілька шрифтів і перемикатися між ними.</p>
        <p class="muted small">Накреслення:</p>${seg("fontstyle", [["regular", "Regular"], ["italic", "Regular Italic"], ["bold", "Bold"], ["bolditalic", "Bold Italic"]], store.get("skybee.fontStyle") || "regular")}</div>
      <div class="card"><h3>Розмір тексту</h3>${seg("font", [["14", "Менший"], ["15", "Звичайний"], ["17", "Більший"], ["19", "Великий"]], font)}</div>
      ${window.skybeeDesktop || window.Capacitor?.isNativePlatform?.() ? `<div class="card"><h3>Анімація запуску</h3>
        <p class="muted small">Бджола пролітає над лукою й сідає в логотип. Небо — за темою (уночі місяць і зорі) і кольором застосунку.</p>
        ${seg("intro", [["full", "Повна"], ["short", "Коротка"], ["off", "Без неї"]], store.get("skybee.intro") || "full")}</div>` : ""}
      <div class="card"><h3>Стиль інтерфейсу</h3>
        <p class="muted small">«Авто»: на iPhone та iPad — Liquid Glass, на Android — Material Design, на комп'ютері — Skybee. Можна вибрати будь-який на будь-якому пристрої.</p>
        ${seg("ui", [["auto", "Авто"], ["glass", "Liquid Glass"], ["material", "Material"], ["skybee", "Skybee"]], uiPick)}
        <div class="uipreview">${["glass", "material", "skybee"].map(v => `<button type="button" class="uipv uipv-${v}${ui === v ? " on" : ""}" data-ui="${v}" aria-label="${{ glass: "Liquid Glass", material: "Material Design", skybee: "Skybee" }[v]}"><i></i><i></i><i></i><b>${{ glass: "Liquid Glass", material: "Material", skybee: "Skybee" }[v]}</b></button>`).join("")}</div>
      </div>
      ${ui === "glass" ? `<div class="card"><h3>Liquid Glass</h3>
        <div class="field">Скло${seg("glass", [["clear", "Прозоре"], ["normal", "Звичайне"], ["frost", "Матове"]], store.get("skybee.glass") || "normal")}</div>
        ${toggle("glassFloat", "Плаваюча панель вкладок", store.get("skybee.glassFloat") !== "0", "Нижня панель — скляна капсула над стрічкою, як в iOS")}
        ${toggle("lgTilt", "Відблиск від нахилу", store.get("skybee.lgTilt") === "1", "Світлий край скла рухається, коли нахиляєш телефон. На комп'ютері світло й так іде за мишею")}
        ${toggle("lgRefract", "Заломлення", store.get("skybee.lgRefract") === "1", refractWorks() ? "Краї скла викривлюють те, що під ними, як справжня лінза. Більше навантажує відеокарту й батарею" : "Поки не показується на iPhone та iPad — Safari такого не вміє. Працює в застосунку для комп'ютера й на Android", !refractWorks())}
      </div>` : ""}
      ${ui === "material" ? `<div class="card"><h3>Material Design</h3>
        ${toggle("mTonal", "Кольори Material You", store.get("skybee.mTonal") !== "0", "Поверхні й кнопки відтінені кольором застосунку")}
        ${toggle("mLabels", "Підписи в нижній панелі", store.get("skybee.mLabels") !== "0")}
        ${toggle("mRipple", "Хвиля при натисканні", store.get("skybee.mRipple") !== "0", "Кругла «хвиля» від пальця на кнопках і пунктах")}
      </div>` : ""}`;
    el.querySelectorAll("[data-th]").forEach(b => b.onclick = () => { store.set("skybee.theme", b.dataset.th); applyLook(); draw(); });
    el.querySelectorAll("[data-color]").forEach(b => b.onclick = () => { store.set(colorKey(), b.dataset.color || ""); applyLook(); draw(); });
    const any = el.querySelector("[data-anycolor]");
    any.oninput = () => { store.set(colorKey(), any.value.toLowerCase()); applyLook(); }; // live while the picker is open
    any.onchange = () => { store.set(colorKey(), any.value.toLowerCase()); applyLook(); draw(); };
    el.querySelectorAll("[data-ibg]").forEach(b => b.onclick = () => { setIconBg(b.dataset.ibg); draw(); });
    el.querySelectorAll("[data-icon]").forEach(b => b.onclick = () => { setIconColor(b.dataset.icon); draw(); });
    const anyI = el.querySelector("[data-anyicon]");
    if (anyI) anyI.onchange = () => { setIconColor(anyI.value); draw(); };
    el.querySelectorAll("[data-font]").forEach(b => b.onclick = () => { store.set("skybee.font", b.dataset.font); applyLook(); draw(); });
    el.querySelectorAll("[data-fontstyle]").forEach(b => b.onclick = () => { store.set("skybee.fontStyle", b.dataset.fontstyle); applyLook(); draw(); });
    el.querySelectorAll("[data-fontfamily]").forEach(b => b.onclick = () => {
      if (b.dataset.fontfamily === "zakon") {
        store.set("skybee.fontFamily", "zakon");
        activeUserFont = "";
        document.documentElement.style.removeProperty("--skybee-font-family");
      } else if (userFonts.length) {
        store.set("skybee.fontFamily", "custom:" + (el.querySelector("#userFontChoice")?.value || userFonts[0].id));
      }
      applyLook(); draw();
    });
    el.querySelector("#userFontChoice")?.addEventListener("change", e => {
      store.set("skybee.fontFamily", "custom:" + e.target.value); applyLook(); draw();
    });
    el.querySelector("#userFontUpload")?.addEventListener("change", async e => {
      for (const file of [...(e.target.files || [])]) {
        const ext = file.name.split(".").pop().toLowerCase();
        if (!["ttf", "otf", "woff", "woff2"].includes(ext)) { toast("Непідтримуваний формат: " + file.name); continue; }
        if (file.size > 10 * 1024 * 1024) { toast("Файл завеликий (максимум 10 МБ): " + file.name); continue; }
        const id = crypto.randomUUID?.() || (Date.now() + "-" + Math.random().toString(36).slice(2));
        const name = file.name.replace(/\.[^.]+$/, "");
        try { await saveUserFont({ id, name, blob: file, format: ext }); }
        catch { toast("Не вдалося зберегти " + file.name); continue; }
        userFonts.push({ id, name, format: ext });
        store.set("skybee.fontFamily", "custom:" + id);
      }
      applyLook(); await appearance(el);
    });
    el.querySelector("#removeUserFont")?.addEventListener("click", async () => {
      const id = el.querySelector("#userFontChoice")?.value;
      if (!id) return;
      await removeUserFont(id);
      userFonts = userFonts.filter(f => f.id !== id);
      if (store.get("skybee.fontFamily") === "custom:" + id) store.set("skybee.fontFamily", "zakon");
      activeUserFont = "";
      document.documentElement.style.removeProperty("--skybee-font-family");
      applyLook(); await appearance(el);
    });
    el.querySelectorAll("[data-fl]").forEach(b => b.onclick = () => { store.set("skybee.feedLook", b.dataset.fl || null); applyLook(); draw(); });
    el.querySelectorAll("[data-intro]").forEach(b => b.onclick = () => { store.set("skybee.intro", b.dataset.intro === "full" ? null : b.dataset.intro); draw(); });
    el.querySelectorAll("[data-ui]").forEach(b => b.onclick = () => { store.set("skybee.ui", b.dataset.ui === "auto" ? null : b.dataset.ui); applyLook(); draw(); });
    el.querySelectorAll("[data-glass]").forEach(b => b.onclick = () => { store.set("skybee.glass", b.dataset.glass === "normal" ? null : b.dataset.glass); applyLook(); draw(); });
    el.querySelector("#lgTilt")?.addEventListener("change", (e) => {
      store.set("skybee.lgTilt", e.target.checked ? "1" : null);
      // iPhone shows its motion-sensor question only from a tap — this tap
      if (e.target.checked && window.DeviceOrientationEvent?.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => {});
    });
    el.querySelector("#lgRefract")?.addEventListener("change", async (e) => {
      if (e.target.checked && !await confirmBox("Заломлення — найважчий ефект скла: відеокарта перемальовує його щоразу, коли щось рухається під склом. На слабших пристроях прокрутка може стати менш плавною, а батарея — сідати швидше. Увімкнути?", "Увімкнути")) { e.target.checked = false; return; }
      store.set("skybee.lgRefract", e.target.checked ? "1" : null); applyLook();
    });
    for (const k of ["glassFloat", "mTonal", "mLabels", "mRipple"]) {
      const i = el.querySelector("#" + k); if (i) i.onchange = () => { store.set("skybee." + k, i.checked ? null : "0"); applyLook(); };
    }
  };
  draw();
}

/* ================= ACCESSIBILITY ================= */
export async function a11y(el) {
  el.innerHTML = header("Доступність", true) + `
    <div class="card">
      <h3>Опис зображень (ALT)</h3>
      ${toggle("reqalt", "Не публікувати фото й відео без опису", store.get("skybee.requireAlt") === "1", "Редактор нагадає додати опис для незрячих")}
    </div>
    <div class="card">
      <h3>Рух</h3>
      ${toggle("calm", "Зменшити анімацію", store.get("skybee.calm") === "1", "Без плавних переходів і анімацій")}
      ${toggle("noautogif", "Не відтворювати GIF самостійно", store.get("skybee.autogif") !== "1")}
    </div>
    <div class="card">
      <h3>Клавіатура</h3>
      ${toggle("hotkeys", "Гарячі клавіші з однієї літери", store.get("skybee.hotkeys") !== "0", "n — новий пост, j/k — між постами, l — вподобати, 1–5 — розділи. Вимкни, якщо користуєшся голосовим керуванням чи екранною клавіатурою")}
    </div>
    <div class="sgroup">${row("#/settings/appearance", "brush", "Розмір тексту й тема")}</div>`;
  $("#reqalt", el).onchange = (e) => { store.set("skybee.requireAlt", e.target.checked ? "1" : null); toast("Збережено"); };
  $("#calm", el).onchange = (e) => { store.set("skybee.calm", e.target.checked ? "1" : null); applyLook(); toast("Збережено"); };
  $("#noautogif", el).onchange = (e) => { store.set("skybee.autogif", e.target.checked ? null : "1"); toast("Збережено"); };
  $("#hotkeys", el).onchange = (e) => { store.set("skybee.hotkeys", e.target.checked ? null : "0"); toast("Збережено"); };
}

/* ================= LANGUAGES ================= */
export const LANGS = sortAZ([["uk", "Українська"], ["en", "English"], ["pl", "Polski"], ["be", "Беларуская"], ["ru", "Русский"], ["de", "Deutsch"],
  ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"], ["cs", "Čeština"], ["ja", "日本語"]]);
export const translateLang = () => store.get("skybee.tlang") || "uk";
export async function langs(el) {
  const content = api.contentLangs();
  el.innerHTML = header("Мови", true) + `
    <div class="card"><h3>Мова інтерфейсу</h3>
      <select id="uilang" class="noi18n">${UI_LANGS.map(([c, n]) => `<option value="${c}" ${c === uiLang ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <p class="small muted">Після вибору Skybee перезавантажиться. Пости й повідомлення людей не перекладаються — для них є «Перекласти».</p></div>
    <div class="card"><h3>Мова моїх постів за замовчуванням</h3>
      <select id="deflang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === getLang() ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="card"><h3>Перекладати на</h3>
      <select id="tlang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === translateLang() ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="card"><h3>Мови вмісту</h3>
      <p class="small muted">Які мови показувати в тематичних фідах. Нічого не обрано — усі мови. На стрічку «Підписки» це не впливає.</p>
      ${LANGS.map(([c, n]) => `<label class="radio"><input type="checkbox" data-cl="${c}" ${content.includes(c) ? "checked" : ""}> ${n}</label>`).join("")}</div>`;
  $("#uilang", el).onchange = (e) => { setUiLang(e.target.value); location.reload(); };
  $("#deflang", el).onchange = (e) => { store.set("skybee.lang", e.target.value); toast("Збережено"); };
  $("#tlang", el).onchange = (e) => { store.set("skybee.tlang", e.target.value); toast("Збережено"); };
  el.querySelectorAll("[data-cl]").forEach(c => c.onchange = () => {
    store.set("skybee.contentLangs", JSON.stringify([...el.querySelectorAll("[data-cl]:checked")].map(x => x.dataset.cl)));
    toast("Збережено");
  });
}

/* ================= ANALYTICS ================= */
// Own numbers come from Skybee's tools (computed on the device); the network-wide numbers and the bot check are bskycheck.com,
// an independent free service (not Bluesky). Its pages open in the app's own browser window.
const BSC = "https://bskycheck.com/";
export async function analytics(el) {
  el.innerHTML = header("Аналітика та інструменти", true) + `
    <div class="sgroup">
      ${row("#/tools/stats", "media", "Статистика мого профілю: лайки, активність, найкращі пости")}
      ${row("#/tools/follows", "users", "Підписки: хто не підписаний у відповідь, хто відписався")}
      ${row("#/settings/blocked-by", "shield", "Хто мене заблокував")}
      <button class="srow" data-tool="friends"><span class="sicon">${IC.search}</span><span class="grow">Знайти знайомих зі списку (X, Mastodon…)</span></button>
      <button class="srow" data-tool="sync"><span class="sicon">${IC.globe}</span><span class="grow">Налаштування Skybee між пристроями</span></button>
    </div>
    <div class="card"><h3>Bluesky загалом — bskycheck</h3>
      <p class="small muted">Незалежний безкоштовний сервіс (не Bluesky): живі дані з відкритого потоку Bluesky. Сторінки відкриваються у вікні застосунку.</p>
      <div class="col" style="gap:8px">
        <a class="btn ghost" href="${BSC}stats.php" target="_blank" rel="noopener">Кількість користувачів і ріст</a>
        <a class="btn ghost" href="${BSC}jazco.php" target="_blank" rel="noopener">Реєстрації та пости за сьогодні</a>
        <a class="btn ghost" href="${BSC}bots.php" target="_blank" rel="noopener">Ботоактивність у мережі</a>
      </div></div>
    <div class="card"><h3>Перевірка акаунта на бота</h3>
      <p class="small muted">Нік скопіюється, а на сторінці bskycheck його лишається вставити (3 перевірки на день без входу).</p>
      <div class="row" style="gap:8px"><input id="botq" class="grow" placeholder="нік.bsky.social" maxlength="253" autocomplete="off" value="${esc(api.session?.handle || "")}"><button class="btn" id="botgo">Перевірити</button></div></div>`;
  el.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tool]")?.dataset.tool; if (!t) return;
    const m = await import("./tools.js"); if (t === "friends") m.findFriends(); else m.syncDialog();
  });
  $("#botgo", el).onclick = async () => {
    const h = $("#botq", el).value.trim().replace(/^@/, "");
    try { await navigator.clipboard.writeText(h); toast("Нік скопійовано — вставте його на сторінці"); } catch {}
    window.open(BSC + "botcheck.php", "_blank", "noopener,noreferrer");
  };
}

/* ================= HELP ================= */
export async function help(el) {
  el.innerHTML = header("Довідка", true) + `
    ${isUk ? `<div class="sgroup">${row("#/newcomers", "help", "Для новеньких: як усе працює, українські стрічки й списки")}</div>` : ""}
    <div class="card"><h3>Клавіатура</h3>
      <p><kbd>N</kbd> — новий пост<br><kbd>/</kbd> — пошук<br><kbd>Ctrl</kbd> + <kbd>Enter</kbd> — опублікувати з редактора<br><kbd>Esc</kbd> — закрити вікно</p></div>
    <div class="card"><h3>Пароль застосунку чи основний?</h3>
      <p class="small">Пароль застосунку безпечніший: його можна будь-коли відкликати, і він не дає змінити пошту чи видалити акаунт. Створити його можна в <a href="#/settings/passwords">Паролях застосунків</a> (для цього треба один раз увійти з основним паролем). Щоб працювали чати, постав галочку доступу до повідомлень.</p></div>
    <div class="card"><h3>Гілка з кількох постів</h3>
      <p class="small">У редакторі натисни <b>＋</b> поруч із лічильником символів — з'явиться наступний пост гілки. Усі пости публікуються разом.</p></div>
    <div class="card"><h3>Чому немає сповіщень, коли Skybee закрито?</h3>
      <p class="small">Для справжніх push-сповіщень потрібен сервер, який стежить за мережею. Поки що Skybee показує сповіщення лише тоді, коли він відкритий (зокрема у фоновій вкладці або як встановлений застосунок).</p></div>
    <div class="card"><h3>Знайшли помилку?</h3>
      <p class="small">Напишіть про неї на <a href="https://github.com/vysocavnu/skybee/issues" target="_blank" rel="noopener">GitHub</a> — додайте скриншот і опис, що саме сталося.</p></div>`;
}

/* ================= ABOUT ================= */
const cap = () => window.Capacitor;

// «Встановити як застосунок» on the site: pick a device, get the file from the newest GitHub release
const RELEASES = "https://github.com/vysocavnu/skybee/releases/latest";
// platform icons in the same line style as ico() (stroke = currentColor), instead of emoji
const PI = {
  windows: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M3 12h18"/>',
  android: '<path d="M5 17v-5a7 7 0 0 1 14 0v5z"/><path d="M8 5.5L6.5 3.5M16 5.5l1.5-2"/><circle cx="9.5" cy="12" r=".6"/><circle cx="14.5" cy="12" r=".6"/><path d="M5 17h14v1.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z"/>',
  ios: '<path d="M12 7.6C10.4 6.5 7.4 6.3 5.9 8.6c-1.6 2.5-.8 6.7 1.3 9.5 1.1 1.5 2.3 2.4 3.4 1.9.9-.4 1.9-.4 2.8 0 1.1.5 2.3-.4 3.4-1.9.8-1.1 1.4-2.3 1.8-3.5-1.8-.8-2.6-2.4-2.5-4 .1-1.3.8-2.3 1.7-2.9-1.5-1.6-4.2-1.6-5.8-.1z"/><path d="M12 7.4c0-2 1.3-3.6 3-4 0 2-1.3 3.6-3 4z"/>',
  appimage: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 9.5l3 2.5-3 2.5M12 15h5"/>',
  flatpak: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  tar: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v2h-2v2h2v2h-2v2h2v2M10.5 15h3v3h-3z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
};
const pIco = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px">${PI[k] || ""}</svg>`;
const INSTALL = [
  { id: "windows", name: "Windows", note: "Інсталятор .exe — оновлюється сам", re: /setup\.exe$/i },
  { id: "android", name: "Android", note: "Файл APK — дозволь встановлення з браузера", re: /\.apk$/i },
  { id: "ios", name: "iPhone / iPad", note: "IPA без підпису — встанови через Sideloadly чи AltStore", re: /\.ipa$/i },
  { id: "appimage", name: "Linux — AppImage", note: "Один файл, оновлюється сам", re: /\.AppImage$/i },
  { id: "flatpak", name: "Linux — Flatpak", note: "flatpak remote-add --user skybee https://skybee.online/flatpak/skybee.flatpakrepo && flatpak install --user skybee io.github.vysocavnu.skybee", re: /\.flatpak$/i },
  { id: "tar", name: "Linux — tar.gz", note: "Архів, розпакуй і запусти skybee", re: /linux-x64\.tar\.gz$/i },
];
let latestAssets = null; // cached for the session: [{name, browser_download_url}]
function latestRelease() {
  latestAssets ||= fetch("https://api.github.com/repos/vysocavnu/skybee/releases/latest")
    .then((r) => r.ok ? r.json() : Promise.reject(r.status))
    .then((j) => (j.assets || []).filter((a) => /^https:\/\/github\.com\//.test(a.browser_download_url)))
    .catch(() => { latestAssets = null; return []; });
  return latestAssets;
}
export function installDialog() {
  const here = devicePlatform(), ua = navigator.userAgent || "";
  const mine = here === "android" ? "android" : here === "ios" ? "ios" : /windows/i.test(ua) ? "windows" : /linux/i.test(ua) ? "appimage" : "";
  const list = [...INSTALL].sort((a, b) => (b.id === mine) - (a.id === mine));
  const m = modal(`<h3>Встановити Skybee</h3>
    <p class="small muted">Обери пристрій — завантажиться остання версія.</p>
    ${pwa.install ? `<button class="instpick" data-pwa><span class="ii">${pIco("web")}</span><span><b>У цьому браузері</b><small>Окреме вікно без завантаження файлів</small></span></button>` : ""}
    ${list.map((o) => `<a class="instpick${o.id === mine ? " mine" : ""}" data-id="${o.id}" href="${RELEASES}" target="_blank" rel="noopener">
      <span class="ii">${pIco(o.id)}</span><span><b>${esc(o.name)}${o.id === mine ? ' <i class="tag">цей пристрій</i>' : ""}</b><small>${esc(o.note)}</small></span></a>`).join("")}
    ${/macintosh/i.test(ua) && here !== "ios" ? `<p class="small muted">Для Mac окремої версії ще немає — встанови Skybee як застосунок через браузер (Chrome, Edge або Safari: «Додати в Dock»).</p>` : ""}
    ${here === "ios" ? `<p class="small muted">Або без файлів: «Поділитися» → «На початковий екран» у Safari.</p>` : ""}
    <p class="small muted"><a href="${RELEASES}" target="_blank" rel="noopener">Усі файли й версії на GitHub</a></p>
    <div class="row end"><button class="ghost" data-x>Закрити</button></div>`);
  latestRelease().then((assets) => {
    for (const a of m.querySelectorAll(".instpick[data-id]")) {
      const f = assets.find((x) => INSTALL.find((o) => o.id === a.dataset.id).re.test(x.name));
      if (f) a.href = f.browser_download_url; // otherwise the release page stays
    }
  });
  m.addEventListener("click", async (e) => {
    if (e.target.closest("[data-x]")) return m.close();
    if (e.target.closest("[data-pwa]")) {
      const p = pwa.install; pwa.install = null; m.close();
      if (p) { p.prompt(); await p.userChoice.catch(() => {}); }
      return;
    }
    if (e.target.closest(".instpick[data-id]")) setTimeout(() => m.close(), 0);
  });
}
export async function about(el) {
  el.innerHTML = header("Про Skybee", true) + `
    <div class="card center"><div class="aboutbee">${bee(110)}</div><h3>Skybee</h3>
      <p class="small muted">Відкритий клієнт для Bluesky. Без реклами, без трекерів, без збирання даних: усе зберігається у вашому акаунті Bluesky або в цьому браузері.</p>
      <a class="ghost sm" href="https://github.com/vysocavnu/skybee" target="_blank" rel="noopener">Код на GitHub</a>
      ${window.skybeeDesktop || isNative || matchMedia("(display-mode: standalone)").matches ? "" : `<button class="btn sm" data-act="install">Встановити як застосунок</button>`}</div>
    ${window.skybeeDesktop?.update || isNative ? `<div class="card"><h3>Оновлення</h3>
      <p class="small muted" id="appver">Версія застосунку: …</p>
      <div id="betabox" hidden>${toggle("beta", "Бета-тестування", false, "Нові версії Skybee раніше за всіх — з кожною зміною в коді. Можуть траплятися помилки: пиши про них на GitHub. Якщо вимкнеш, залишишся на беті, доки не вийде новіша звичайна версія.")}</div>
      <button class="btn sm" id="checkupd">Перевірити оновлення</button>
      <p class="small" id="updres" hidden></p>
      <button class="btn sm" id="getupd" hidden>Завантажити</button></div>` : ""}
    <div class="card"><h3>Цей пристрій</h3>
      <button class="ghost sm" id="clearcache">Очистити кеш застосунку</button>
      <p class="small muted">Допомагає, якщо після оновлення щось виглядає дивно. Акаунти й налаштування залишаться.</p>
      <button class="ghost sm danger" id="resetlocal">Скинути налаштування цього пристрою</button>
      <p class="small muted">Тема, розмір тексту, мови й чернетка повернуться до початкових. Акаунти й налаштування в акаунті Bluesky не зміняться.</p></div>`;
  if ($("[data-act=install]", el)) latestRelease(); // the file links are ready by the time the dialog opens
  const chk = $("#checkupd", el);
  if (chk) {
    const res = $("#updres", el), get = $("#getupd", el), ver = $("#appver", el);
    if (window.skybeeDesktop) window.skybeeDesktop.version().then((v) => { ver.textContent = `Версія застосунку: ${v}`; }).catch(() => {});
    else upd.checkPhone().then((r) => { if (r.state !== "error" || r.version) ver.textContent = `Версія застосунку: ${r.state === "available" ? r.here : r.version}`; });
    upd.betaState().then((b) => {
      if (!b.available) return;
      const box = $("#betabox", el), sw = $("#beta", el);
      box.hidden = false; sw.checked = b.on;
      sw.onchange = async () => {
        try { await upd.setBeta(sw.checked); } catch { sw.checked = !sw.checked; toast("Не вдалося змінити — спробуй ще раз"); return; }
        toast(sw.checked ? "Бета-тестування увімкнено 🐝" : "Бета-тестування вимкнено");
        chk.click(); // look for the build of the chosen channel at once
      };
    });
    get.onclick = () => get.dataset.url && upd.download(get.dataset.url);
    chk.onclick = async () => {
      chk.disabled = true; chk.textContent = "Перевіряю…"; res.hidden = true; get.hidden = true;
      let r;
      if (window.skybeeDesktop) { try { r = await window.skybeeDesktop.update(); } catch { r = { state: "error", code: "ipc" }; } }
      else r = await upd.checkPhone();
      chk.disabled = false; chk.textContent = "Перевірити оновлення";
      res.textContent = {
        latest: `✓ У тебе найновіша версія (${r.version}).`,
        available: `Вийшла нова ${r.beta ? "бета-версія" : "версія"}: ${r.version}. ${cap()?.getPlatform?.() === "ios" ? "Встанови IPA через Sideloadly чи AltStore." : "Встанови її поверх — акаунти й налаштування залишаться."}`,
        downloading: `Знайдено версію ${r.version}. Вона завантажується у фоні (прогрес — на значку в панелі задач); коли буде готова, Skybee запропонує перезапуститися.`,
        ready: `Версія ${r.version} вже завантажена — перезапусти Skybee, щоб її встановити.`,
        flatpak: "Цю версію оновлює Flatpak (якщо встановлена через репозиторій skybee): відкрий «Програми» (GNOME Software чи Discover) або виконай flatpak update.",
        manual: "Ця збірка не оновлюється сама — завантаж нову версію зі сторінки релізів Skybee на GitHub.",
        dev: "Skybee запущено з вихідного коду — оновлення вимкнені.",
        error: `Не вдалося перевірити оновлення. Перевір підключення до інтернету й спробуй ще раз пізніше. (${r.code || "network"})`,
      }[r.state] || "";
      res.hidden = !res.textContent;
      if (r.state === "available") { get.dataset.url = r.url; get.hidden = false; }
    };
  }
  $("#clearcache", el).onclick = async () => {
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister();
    } catch {}
    location.reload();
  };
  $("#resetlocal", el).onclick = async () => {
    if (!await confirmBox("Скинути налаштування цього пристрою?", "Скинути", true)) return;
    for (const k of ["theme", "color", "ui", "glass", "glassFloat", "lgTilt", "lgRefract", "intro", "mTonal", "mLabels", "mRipple", "font", "lang", "tlang", "contentLangs", "requireAlt", "calm", "autogif", "players", "flairAll", "feedLook", "postColors", "tenorKey", "noLinkThumbs", "draft"]) store.set("skybee." + k, null);
    store.set(colorKey(), null);
    location.reload();
  };
}
