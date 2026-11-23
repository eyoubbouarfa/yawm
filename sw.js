const CACHE = "au-quotidien-v52";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png", "img/minaret.svg", "fonts/cormorant-italic-600.woff2", "fonts/arefruqaa.woff2",
  "data/journee.json", "data/jeune.json", "data/alimentation.json", "data/nawafil.json", "data/sourates.json", "data/themes.json", "data/versions.json",
  "data/coran_ar.json", "data/coran_hamidullah.json", "data/coran_maash.json", "data/coran_montada.json", "data/hadiths.json", "data/fiqh.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Réseau d'abord pour la page et les données (les mises à jour s'affichent tout de suite), cache en secours hors ligne
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).catch(() => fetch(e.request)).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

// Notifications envoyées par le serveur Yawm
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Yawm", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    vibrate: [200, 100, 200], data: { url: d.url || "./#chemin" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || "./#chemin", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(L => {
    for (const c of L) if (c.url.startsWith(self.registration.scope) && "focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return clients.openWindow(url);
  }));
});
