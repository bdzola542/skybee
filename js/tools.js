// Skybee — «🧰 Інструменти»: things other Bluesky clients have, done in the client without a server:
// follow analytics (who does not follow back, who unfollowed), profile statistics, finding friends from a pasted list,
// list export / import, settings synced through the own account.
import * as api from "./api.js";
import { esc, modal, toast, avatar, name, at, spinner, confirmBox } from "./ui.js";
import { header } from "./views.js";
import { errText } from "./errors.js";
import { locale } from "./i18n.js";

const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

async function allPages(method, params, key, max = 6000) {
  const out = []; let cursor;
  do { const d = await api.get(method, { ...params, limit: 100, cursor }); out.push(...(d[key] || [])); cursor = d.cursor; } while (cursor && out.length < max);
  return out;
}
const row = (a, extra = "") => `<div class="actor" data-href="#/profile/${esc(a.did)}">${avatar(a, 40)}<div class="who"><b>${name(a)}</b><span class="muted small">${at(a.handle)}</span></div>${extra}</div>`;

// profiles by handles / DIDs in batches of 25; a batch the server refuses (one bad name) is retried name by name
async function profilesOf(names) {
  const out = [];
  for (let i = 0; i < names.length; i += 25) {
    const part = names.slice(i, i + 25);
    try { out.push(...(await api.get("app.bsky.actor.getProfiles", { actors: part })).profiles); }
    catch { for (const n of part) { try { out.push(...(await api.get("app.bsky.actor.getProfiles", { actors: [n] })).profiles); } catch { /* not a real account */ } } }
  }
  return out;
}
const validHandle = (h) => h.length <= 253 && /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(h);

/* ---------- the index ---------- */
export async function tools(el) {
  el.innerHTML = header("🧰 Інструменти", true) + `<div class="sgroup">
    <a class="srow" href="#/tools/follows"><span class="grow">👥 Аналітика підписок: хто не підписаний у відповідь, хто відписався</span></a>
    <a class="srow" href="#/tools/stats"><span class="grow">📊 Статистика мого профілю</span></a>
    <button class="srow" data-t="friends"><span class="grow">🔎 Знайти знайомих зі списку (X, Mastodon…)</span></button>
    <button class="srow" data-t="sync"><span class="grow">☁️ Налаштування Skybee між пристроями</span></button></div>
    <p class="muted small pad">Усе рахується на вашому пристрої з даних Bluesky, стороннім серверам нічого не надсилається.</p>`;
  el.onclick = (e) => { const b = e.target.closest("[data-t]"); if (b?.dataset.t === "friends") findFriends(); if (b?.dataset.t === "sync") syncDialog(); };
}

/* ---------- follow analytics ---------- */
export async function followsReport(el) {
  el.innerHTML = header("👥 Підписки", true) + spinner();
  const me = api.session.did;
  const [follows, followers] = await Promise.all([allPages("app.bsky.graph.getFollows", { actor: me }, "follows"), allPages("app.bsky.graph.getFollowers", { actor: me }, "followers")]);
  const fing = new Set(follows.map(a => a.did)), fers = new Set(followers.map(a => a.did));
  const sets = {
    notback: follows.filter(a => !fers.has(a.did)),
    fans: followers.filter(a => !fing.has(a.did)),
    mutual: follows.filter(a => fers.has(a.did)),
  };
  // who unfollowed: the followers seen last time and not now (the first visit only takes the snapshot)
  // (a list cut at the limit would show people as «unfollowed» that are just beyond it: then nothing is compared or saved)
  const key = "skybee.fsnap." + me, gkey = "skybee.fgone." + me, prev = rd(key, null), whole = followers.length < 6000;
  let gone = [];
  if (whole) {
    const goneIds = new Set(rd(gkey, []));
    if (prev) for (const d of prev) if (!fers.has(d)) goneIds.add(d);
    for (const d of fers) goneIds.delete(d); // came back
    const ids = [...goneIds].slice(-300);
    gone = ids.length ? await profilesOf(ids) : [];
    wr(gkey, ids); wr(key, [...fers].slice(0, 20000));
  }
  let tab = "notback";
  const names = { notback: `Не підписані у відповідь (${sets.notback.length})`, fans: `Читачі, яких ви не читаєте (${sets.fans.length})`, mutual: `Взаємні (${sets.mutual.length})`, gone: `Відписалися (${gone.length})` };
  const draw = () => {
    el.querySelector("[data-list]").innerHTML = (tab === "gone" ? gone : sets[tab]).map(a => row(a, tab === "notback" && a.viewer?.following
      ? `<button class="ghost sm" data-unf="${esc(a.viewer.following)}">Відписатися</button>` : tab === "fans" ? `<button class="ghost sm" data-fol="${esc(a.did)}">Стежити</button>` : "")).join("")
      || `<p class="muted pad">Тут нікого${tab === "gone" && !prev ? ". Знімок читачів збережено — наступного разу побачите, хто відписався" : ""}</p>`;
    el.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  };
  el.innerHTML = header("👥 Підписки", true) + `<div class="tabs" style="flex-wrap:wrap">${Object.entries(names).map(([k, v]) => `<button data-tab="${k}">${esc(v)}</button>`).join("")}</div>
    <div data-list></div>`;
  draw();
  el.onclick = async (e) => {
    const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; return draw(); }
    const u = e.target.closest("[data-unf]");
    if (u) { e.stopPropagation(); if (await confirmBox("Відписатися від цього акаунта?", "Відписатися", true)) { try { await api.unfollow(u.dataset.unf); u.closest(".actor").remove(); toast("Відписано"); } catch (ex) { toast(errText(ex)); } } return; }
    const f = e.target.closest("[data-fol]");
    if (f) { e.stopPropagation(); try { await api.follow(f.dataset.fol); f.textContent = "✓"; f.disabled = true; } catch (ex) { toast(errText(ex)); } }
  };
}

/* ---------- profile statistics (from the latest posts) ---------- */
export async function statsReport(el) {
  el.innerHTML = header("📊 Статистика", true) + spinner();
  const me = api.session.did;
  const profile = await api.get("app.bsky.actor.getProfile", { actor: me });
  const posts = [];
  let cursor;
  for (let i = 0; i < 3; i++) {
    const d = await api.get("app.bsky.feed.getAuthorFeed", { actor: me, limit: 100, cursor, filter: "posts_no_replies" });
    posts.push(...d.feed.filter(it => !it.reason && it.post.author.did === me).map(it => it.post));
    cursor = d.cursor; if (!cursor) break;
  }
  const sum = (k) => posts.reduce((n, p) => n + (p[k] || 0), 0), n = posts.length || 1;
  const days = Array(7).fill(0), hours = Array(24).fill(0);
  for (const p of posts) { const d = new Date(p.record?.createdAt || p.indexedAt); days[(d.getDay() + 6) % 7]++; hours[d.getHours()]++; }
  const top = [...posts].sort((a, b) => (b.likeCount + 2 * b.repostCount + b.replyCount) - (a.likeCount + 2 * a.repostCount + a.replyCount)).slice(0, 5);
  const bars = (arr, labels) => { const mx = Math.max(...arr, 1); return arr.map((v, i) => `<div class="row" style="gap:8px;align-items:center"><span class="muted small" style="width:28px">${labels[i]}</span><div style="height:8px;border-radius:4px;background:var(--accent);width:${Math.round(v / mx * 100)}%;min-width:2px"></div><span class="muted small">${v}</span></div>`).join(""); };
  const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  // more than totals: growth of the readers over days (a snapshot each visit, kept on this device), what kind of posts, tags, the best hour
  const hk = "skybee.fhist." + me, hist = rd(hk, {}), day = new Date().toISOString().slice(0, 10);
  hist[day] = profile.followersCount ?? 0;
  for (const k of Object.keys(hist).sort().slice(0, -400)) delete hist[k];
  wr(hk, hist);
  const pts = Object.entries(hist).sort(([a], [b]) => a.localeCompare(b)).slice(-60);
  const spark = pts.length > 1 ? (() => {
    const vs = pts.map(([, v]) => v), mn = Math.min(...vs), mx = Math.max(...vs), W = 300, H = 60;
    const xy = pts.map(([, v], i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(H - 4 - (mx === mn ? .5 : (v - mn) / (mx - mn)) * (H - 8)).toFixed(1)}`).join(" ");
    const d = vs[vs.length - 1] - vs[0];
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:60px"><polyline points="${xy}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/></svg>
      <p class="muted small">Читачі за ${pts.length} дн. (знімок при кожному відкритті): ${d >= 0 ? "+" : ""}${d}</p>`;
  })() : `<p class="muted small">Графік росту читачів з'явиться, коли відкриєте цю сторінку ще раз в інший день.</p>`;
  const kind = { text: 0, image: 0, video: 0, link: 0, quote: 0 }, tags = new Map(), perHour = Array(24).fill(0), cntHour = Array(24).fill(0);
  for (const p of posts) {
    const t = p.embed?.$type || "";
    if (/images/.test(t)) kind.image++; else if (/video/.test(t)) kind.video++; else if (/external/.test(t)) kind.link++; else if (/record/.test(t)) kind.quote++; else kind.text++;
    for (const tag of p.record?.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
    for (const f of p.record?.facets || []) for (const ft of f.features || []) if (ft.$type === "app.bsky.richtext.facet#tag" && ft.tag) tags.set(ft.tag, (tags.get(ft.tag) || 0) + 1);
    const h = new Date(p.record?.createdAt || p.indexedAt).getHours();
    perHour[h] += (p.likeCount || 0) + 2 * (p.repostCount || 0) + (p.replyCount || 0); cntHour[h]++;
  }
  const avgHour = perHour.map((v, i) => cntHour[i] ? v / cntHour[i] : 0), bestH = avgHour.indexOf(Math.max(...avgHour));
  const followers = Math.max(profile.followersCount || 0, 1), eng = sum("likeCount") + sum("repostCount") + sum("replyCount") + sum("quoteCount");
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const extra = `<div class="card pad"><b>Ріст читачів</b>${spark}</div>
    <div class="card pad"><b>Залученість</b><p>На пост у середньому ${(eng / n).toFixed(1)} реакцій, або ${(eng / n / followers * 100).toFixed(2)}% від кількості читачів.</p>
      ${cntHour.some(Boolean) ? `<p class="muted small">Найкраща година для постів: <b>${String(bestH).padStart(2, "0")}:00</b> (за середніми реакціями на пост).</p>` : ""}</div>
    <div class="card pad"><b>Що ви публікуєте</b><p class="small">Текст ${kind.text} · фото ${kind.image} · відео ${kind.video} · посилання ${kind.link} · цитати ${kind.quote}</p>
      ${topTags.length ? `<p class="small">Теги: ${topTags.map(([t, c]) => `<a href="#/tag/${encodeURIComponent(t)}">#${esc(t)}</a> ×${c}`).join(" · ")}</p>` : ""}</div>`;
  el.innerHTML = header("📊 Статистика", true) + `<div class="card pad">
    <p><b>${(profile.followersCount ?? 0).toLocaleString(locale)}</b> читачів · <b>${(profile.followsCount ?? 0).toLocaleString(locale)}</b> підписок · <b>${(profile.postsCount ?? 0).toLocaleString(locale)}</b> постів</p>
    <p class="muted small">За останні ${posts.length} постів (без відповідей і поширень):</p>
    <p>♥ ${sum("likeCount").toLocaleString(locale)} (у середньому ${(sum("likeCount") / n).toFixed(1)}) · 🔁 ${sum("repostCount").toLocaleString(locale)} (${(sum("repostCount") / n).toFixed(1)}) · 💬 ${sum("replyCount").toLocaleString(locale)} (${(sum("replyCount") / n).toFixed(1)}) · цитат ${sum("quoteCount").toLocaleString(locale)}</p></div>
    <div class="card pad"><b>Коли ви пишете</b><p class="muted small">За днями тижня</p>${bars(days, WD)}<p class="muted small">За годинами</p>${bars(hours, hours.map((_, i) => String(i).padStart(2, "0")))}</div>
    <div class="card pad"><b>Найкращі пости</b>${top.map(p => `<p><a href="#/profile/${esc(me)}/post/${esc(p.uri.split("/").pop())}">${esc((p.record?.text || "…").slice(0, 90))}</a><br><span class="muted small">♥ ${p.likeCount} · 🔁 ${p.repostCount} · 💬 ${p.replyCount}</span></p>`).join("") || `<p class="muted">Постів ще нема</p>`}</div>` + extra;
}

/* ---------- find friends: a pasted list of names from another network ---------- */
function candidates(token, guess = true) {
  let t = token.trim().replace(/^@/, "").toLowerCase().replace(/[,;]+$/, "");
  if (!t || t.length > 253) return [];
  if (/^did:plc:[a-z2-7]{24}$/.test(t)) return [t];
  const m = t.match(/^([a-z0-9_.-]+)@([a-z0-9.-]+\.[a-z]{2,})$/); // user@mastodon.social → the bridge address first
  if (m) return [`${m[1]}.${m[2]}.ap.brid.gy`, `${m[1]}.bsky.social`].filter(validHandle);
  if (validHandle(t)) return [t];
  if (guess && /^[a-z0-9_-]{3,}$/.test(t)) return [`${t}.bsky.social`].filter(validHandle);
  return [];
}
export function findFriends() {
  const m = modal(`<h3>🔎 Знайти знайомих</h3><p class="muted small">Вставте імена людей (по одному в рядку чи через кому): нікнейми з X, адреси Mastodon (user@instance), домени Bluesky. Skybee перевірить, хто з них є в Bluesky.</p>
    <textarea data-ta rows="6" maxlength="20000" placeholder="@name&#10;user@mastodon.social&#10;someone.com"></textarea><div data-res></div><p class="err"></p>
    <div class="row between"><button class="ghost" data-x="0">Закрити</button><button class="btn" data-x="1">Знайти</button></div>`);
  const res = m.querySelector("[data-res]"), err = m.querySelector(".err");
  m.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]"); if (!b) return;
    if (b.dataset.x === "0") return m.close();
    if (b.dataset.x === "follow") {
      const dids = [...res.querySelectorAll("input:checked")].map(i => i.value);
      if (!dids.length) return;
      b.disabled = true; try { await api.followAll(dids); toast(`Підписано: ${dids.length}`); m.close(); } catch (ex) { err.textContent = errText(ex); b.disabled = false; }
      return;
    }
    err.textContent = ""; b.disabled = true; res.innerHTML = `<p class="muted small">Шукаю…</p>`;
    try {
      const names = [...new Set(m.querySelector("[data-ta]").value.split(/[\s,;]+/).flatMap(candidates))].slice(0, 300);
      const found = new Map();
      for (const p of await profilesOf(names)) found.set(p.did, p);
      const list = [...found.values()].filter(p => p.did !== api.session.did);
      res.innerHTML = list.length ? list.map(p => `<label class="row" style="gap:8px;align-items:center;margin:6px 0"><input type="checkbox" value="${esc(p.did)}" ${p.viewer?.following ? "disabled" : "checked"}>${avatar(p, 32)}<span><b>${name(p)}</b> <span class="muted small">${at(p.handle)}${p.viewer?.following ? " · уже читаєте" : ""}</span></span></label>`).join("")
        + `<button class="btn" data-x="follow">Підписатися на вибраних</button>` : `<p class="muted">Нікого не знайдено в Bluesky.</p>`;
    } catch (ex) { err.textContent = errText(ex); }
    b.disabled = false;
  });
}

/* ---------- Skybee settings through the own account (another phone or computer takes them from there) ---------- */
const NS = "io.github.vysocavnu.skybee.settings";
const KEYS = ["theme", "color", "ui", "glass", "glassFloat", "lgTilt", "lgRefract", "intro", "mTonal", "mLabels", "mRipple", "font", "lang", "ui.lang", "tlang", "contentLangs", "requireAlt", "calm", "autogif", "players", "postColors", "badge", "hotkeys", "feedLook"];
export function syncDialog() {
  const m = modal(`<h3>☁️ Налаштування між пристроями</h3><p class="muted small">Зберігає вигляд і мови Skybee в одному записі вашого акаунта Bluesky (паролів і токенів там немає, але запис публічний: його може побачити будь-хто). На іншому пристрої натисніть «Завантажити».</p><p class="err"></p>
    <div class="row between"><button class="btn" data-x="up">⬆️ Зберегти в акаунт</button><button class="btn ghost" data-x="down">⬇️ Завантажити з акаунта</button></div>
    <div class="row end"><button class="ghost" data-x="0">Закрити</button></div>`);
  const err = m.querySelector(".err");
  m.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return;
    if (x === "0") return m.close();
    err.textContent = "";
    try {
      if (x === "up") {
        const data = {};
        for (const k of KEYS) { const v = localStorage.getItem("skybee." + k); if (v != null && v.length <= 200) data[k] = v; }
        await api.post("com.atproto.repo.putRecord", { repo: api.session.did, collection: NS, rkey: "self", record: { $type: NS, updatedAt: new Date().toISOString(), data }, validate: false });
        toast("Збережено в акаунті ☁️"); m.close();
      } else {
        const r = await api.get("com.atproto.repo.getRecord", { repo: api.session.did, collection: NS, rkey: "self" }).catch(() => null);
        const data = r?.value?.data;
        if (!data || typeof data !== "object") { err.textContent = "У цьому акаунті ще нема збережених налаштувань"; return; }
        if (!await confirmBox("Замінити налаштування вигляду на цьому пристрої збереженими? Сторінка перезавантажиться.", "Завантажити")) return;
        for (const k of KEYS) if (typeof data[k] === "string" && data[k].length <= 200) localStorage.setItem("skybee." + k, data[k]);
        location.reload();
      }
    } catch (ex) { err.textContent = errText(ex); }
  });
}

/* ---------- lists: export and import of the people ---------- */
export async function exportList(uri) {
  const l = await api.get("app.bsky.graph.getList", { list: uri, limit: 1 });
  const items = await allPages("app.bsky.graph.getList", { list: uri }, "items");
  // a cell that starts with = + - @ would run as a formula in Excel/Sheets: a quote in front makes it plain text
  const cell = (v) => { v = String(v || "").replace(/"/g, '""'); return `"${/^[=+\-@\t\r]/.test(v) ? "'" + v : v}"`; };
  const csv = "handle,did,name\n" + items.map(i => [i.subject.handle, i.subject.did, i.subject.displayName].map(cell).join(",")).join("\n");
  const fname = (l.list.name || "list").replace(/[^\w\u0400-\u04FF-]+/g, "_").slice(0, 50) + ".csv";
  const file = new File([csv], fname, { type: "text/csv" });
  if (window.Capacitor?.isNativePlatform?.() || window.skybeeDesktop) { // a WebView cannot save a download: the system «Share» (or the clipboard)
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: fname }); return; } } catch (e) { if (e?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(csv); return toast(`CSV скопійовано (${items.length})`); } catch { /* the download below */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = (l.list.name || "list").replace(/[^\wЀ-ӿ-]+/g, "_").slice(0, 50) + ".csv";
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Експортовано: ${items.length}`);
}
export function importToList(uri, onDone) {
  const m = modal(`<h3>⬆️ Імпорт у список</h3><p class="muted small">Вставте нікнейми або адреси (по одному в рядку, чи CSV із колонкою handle). До 200 за раз.</p>
    <textarea rows="7" data-ta maxlength="30000" placeholder="name.bsky.social&#10;someone.com"></textarea><p class="err"></p>
    <div class="row between"><button class="ghost" data-x="0">Скасувати</button><button class="btn" data-x="1">Додати</button></div>`);
  m.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-x]"); if (!b) return;
    if (b.dataset.x === "0") return m.close();
    const err = m.querySelector(".err"); err.textContent = ""; b.disabled = true;
    try {
      // only real handles and DIDs (a CSV exported by Skybee has headers and names: those are not guessed into accounts)
      const names = [...new Set(m.querySelector("[data-ta]").value.split(/[\s,;"]+/).flatMap(x => candidates(x, false)))].slice(0, 200);
      const dids = (await profilesOf(names)).map(p => p.did);
      const have = new Set((await allPages("app.bsky.graph.getList", { list: uri }, "items")).map(i => i.subject.did));
      const fresh = [...new Set(dids)].filter(d => !have.has(d));
      const createdAt = new Date().toISOString();
      for (let i = 0; i < fresh.length; i += 100) await api.post("com.atproto.repo.applyWrites", { repo: api.session.did,
        writes: fresh.slice(i, i + 100).map(subject => ({ $type: "com.atproto.repo.applyWrites#create", collection: "app.bsky.graph.listitem", value: { $type: "app.bsky.graph.listitem", subject, list: uri, createdAt } })) });
      toast(`Додано в список: ${fresh.length}`); m.close(); onDone?.();
    } catch (ex) { err.textContent = errText(ex); b.disabled = false; }
  });
}
