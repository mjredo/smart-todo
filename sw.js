/* Smart To Do - service worker (app shell only; never touches auth/Graph) */
const CACHE = "smarttodo-v7";   // bump to force a fresh shell re-cache (show whisper model in Speak dialog)
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./config.js",
  "./msal-browser.min.js",
  "./icon-192.png", "./icon-512.png", "./icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Only handle our own origin's GETs. Microsoft login + Graph go straight to network.
  if (url.origin !== self.location.origin || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match("./index.html")))
  );
});
