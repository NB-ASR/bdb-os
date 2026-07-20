const CACHE_NAME = "bdb-os-static-v5";
const PRECACHE_ASSETS = ["/bdb-mark.svg"];

function isCacheableStaticAsset(requestUrl) {
  const url = new URL(requestUrl);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  return /\.(?:css|js|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$/i.test(url.pathname);
}

function safeNotificationUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/workspace", self.location.origin);
    if (url.origin !== self.location.origin) return "/workspace";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/workspace";
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !isCacheableStaticAsset(request.url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok || response.type !== "basic") return response;
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() ?? "You have a new update." };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "BDB OS", {
      body: data.body ?? "You have a new update.",
      icon: "/bdb-mark.svg",
      badge: "/bdb-mark.svg",
      tag: data.tag,
      data: { url: safeNotificationUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const url = safeNotificationUrl(event.notification.data?.url);
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(url);
        return existing.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
