const CACHE = "au-quotidien-v10";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png", "img/minaret.svg",
  "data/journee.json", "data/jeune.json", "data/alimentation.json", "data/sourates.json", "data/themes.json", "data/versions.json",
  "data/coran_ar.json", "data/coran_hamidullah.json", "data/coran_maash.json", "data/coran_montada.json", "data/hadiths.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Réseau d'abord pour la page et les données (les mises à jour s'affichent tout de suite), cache en secours hors ligne
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
