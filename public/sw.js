const CACHE_NAME = "bdb-os-static-v2";
const PUBLIC_FALLBACK = ["/offline", "/bdb-mark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_FALLBACK)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;

  // Tenant pages and APIs always use the network and are never stored in a
  // shared browser cache. Only versioned static assets are cached below.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    return;
  }
  if (new URL(request.url).pathname.startsWith("/api/")) return;

  if (["style", "script", "font", "image"].includes(request.destination)) {
    event.respondWith(caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || fresh;
    }));
  }
});
