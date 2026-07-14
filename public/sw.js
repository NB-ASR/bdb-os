const CACHE_NAME = "bdb-os-v3";
const APP_SHELL = ["/", "/workspace", "/accounts", "/customers", "/calendar", "/communications", "/documents", "/banking", "/reports", "/automation-hub", "/activity", "/settings", "/login", "/bdb-mark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? "BDB OS", { body: data.body ?? "You have a new update.", icon: "/bdb-mark.svg", badge: "/bdb-mark.svg", tag: data.tag, data: { url: data.url ?? "/workspace" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => { const url = event.notification.data?.url ?? "/workspace"; const existing = clients.find((client) => "focus" in client); if (existing) { existing.navigate(url); return existing.focus(); } return self.clients.openWindow(url); }));
});
