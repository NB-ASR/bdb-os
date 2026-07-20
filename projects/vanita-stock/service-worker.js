const CACHE = "vanita-stock-v19-safe-static";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "cloud.js",
  "discount-reporting.js",
  "icon.svg",
  "manifest.webmanifest"
];
const STATIC_PATHS = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";
  const isKnownStaticAsset = STATIC_PATHS.has(url.pathname);
  if (!isNavigation && !isKnownStaticAsset) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (isNavigation) return caches.match(new URL("./", self.registration.scope).pathname);
        throw new Error("Offline asset unavailable");
      })
  );
});
