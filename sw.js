// Skybee service worker: keeps the app shell available offline and shows notification clicks the way.
// Network first — a new deploy is picked up at once; the cache is only a fallback without a connection.
const CACHE = "skybee-shell-v17";
const SHELL = ["./", "css/style.css", "js/app.js", "js/api.js", "js/ui.js", "js/views.js", "js/compose.js", "js/more.js", "js/settings.js", "js/notify.js", "js/flair.js", "js/sources.js", "js/deck.js", "js/splash.js", "js/errors.js", "js/newbie.js", "js/native.js", "js/stars.js", "js/updates.js", "js/i18n.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg", "icons/favicon.svg", "favicon.ico", "offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API, images, video: straight to the network
  // hls.js (540 KB) is not in SHELL: it is cached here the first time a video plays, not downloaded by everyone on each release
  e.respondWith((async () => {
    const net = fetch(e.request).then(res => {
      // only a whole, ordinary answer is kept (a 206 range or an opaque one would break the copy); the worker waits for the write
      if (res.status === 200 && res.type === "basic") {
        const copy = res.clone(), write = caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        try { e.waitUntil(write); } catch { /* the page was already answered from the cache: the write just runs on */ }
      }
      return res;
    });
    const cached = caches.match(e.request, { ignoreSearch: true });
    // a very slow network (the metro, weak 3G) does not keep the screen white: after 4 s the saved page is shown if there is one.
    // Only the page itself: scripts always come together from one place, a mix of old and new modules would not start
    net.catch(() => {}); // a failed network after the cache already answered is not an unhandled error
    const slow = e.request.mode === "navigate" ? new Promise(r => setTimeout(r, 4000)).then(() => cached).then(c => c || net) : net;
    try { return await Promise.race([net, slow]); }
    catch { return (await cached) || (e.request.mode === "navigate" && (await caches.match("./") || await caches.match("offline.html"))) || Response.error(); }
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const hash = e.notification.data?.hash || "#/notifications";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (tabs) => {
    const tab = tabs.find(t => t.url.startsWith(self.registration.scope));
    if (tab) { await tab.focus(); tab.postMessage({ type: "skybee:open", hash }); }
    else await self.clients.openWindow(self.registration.scope + hash);
  }));
});
