const CACHE_NAME = "bdb-os-static-v6";
const APP_SHELL_CACHE = "bdb-os-offline-shell-v2";
const PRECACHE_ASSETS = ["/bdb-mark.svg"];

function isCacheableStaticAsset(requestUrl) {
  const url = new URL(requestUrl);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  return /\.(?:css|js|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$/i.test(url.pathname);
}

function isOfflineShellPath(pathname) {
  return pathname === "/accounts"
    || pathname.startsWith("/accounts/")
    || pathname === "/customers"
    || pathname.startsWith("/customers/");
}

function isOfflineShellNavigation(request) {
  if (request.method !== "GET" || request.mode !== "navigate") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return isOfflineShellPath(url.pathname);
}

async function cacheOfflineShell(path) {
  if (typeof path !== "string") return;
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin || !isOfflineShellPath(url.pathname)) return;

  const request = new Request(url.href, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "text/html" },
  });
  const response = await fetch(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || response.redirected || !contentType.includes("text/html")) return;

  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.put(request, response.clone());
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== APP_SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_OFFLINE_SHELL") return;
  event.waitUntil(cacheOfflineShell(event.data.path));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (isOfflineShellNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const contentType = response.headers.get("content-type") ?? "";
          if (response.ok && !response.redirected && contentType.includes("text/html")) {
            const copy = response.clone();
            void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const exact = await caches.match(request);
          if (exact) return exact;
          throw new Error("No cached BDB OS shell is available.");
        }),
    );
    return;
  }

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
