/* Smart To Do - service worker (app shell only; never touches auth/Graph) */
const CACHE = "smarttodo-v26";   // bump: auto-refresh
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

/* ---------------- reminder notifications ----------------
   The push server (push-worker/) sends one message per due reminder. Done and
   Snooze go straight back to it, so they work without opening the app; tapping
   the notification itself opens the task. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: e.data && e.data.text() }; }
  const actions = d.taskId ? [
    { action: "done", title: "✓ Done" },
    { action: "snooze", title: "Snooze 15 min" },
  ] : [];
  e.waitUntil(self.registration.showNotification(d.title || "Smart To Do", {
    body: d.body || "",
    tag: d.tag || undefined,          // same task twice → replace, never stack
    renotify: !!d.tag,
    requireInteraction: !!d.taskId,   // stays until handled, like To Do's alarm
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: d,
    actions,
  }));
});

self.addEventListener("notificationclick", e => {
  const d = e.notification.data || {};
  e.notification.close();
  if ((e.action === "done" || e.action === "snooze") && d.api) {
    e.waitUntil(
      fetch(d.api + "/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: e.action, user: d.user, listId: d.listId, taskId: d.taskId, tok: d.tok }),
      }).then(r => { if (!r.ok) throw new Error(r.status); })
        .catch(() => self.registration.showNotification("Couldn't update the task", {
          body: (d.title || "") + " — open Smart To Do to finish it.", tag: d.tag, data: { taskId: d.taskId },
        }))
    );
    return;
  }
  const url = new URL("./", self.registration.scope);
  if (d.taskId) url.searchParams.set("task", d.taskId);
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ type: "openTask", taskId: d.taskId }); return w.focus(); }
    return clients.openWindow(url.href);
  }));
});
