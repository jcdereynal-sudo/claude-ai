// Service worker de Compte-Vis : met l'application en cache pour un fonctionnement hors ligne.
// Ses caches sont préfixés « vis- » : Compte-Tubes (même site) ne les supprime pas, et réciproquement.
const VERSION = "vis-v1";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "screws.js", "worker.js", "ai.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("vis-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Les appels à l'API IA ne passent jamais par le cache.
  if (url.hostname === "api.anthropic.com") return;
  if (url.origin === location.origin) {
    // Réseau d'abord (mises à jour), cache en secours (hors ligne).
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
    );
  } else if (url.hostname === "cdn.jsdelivr.net") {
    // Module IA versionné : cache d'abord.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
