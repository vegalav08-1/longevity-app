// Service worker: offline app shell, network first. No dependencies.
const VERSION = "v4";
const CACHE_NAME = `longevity-shell-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/main.js",
  "src/engine.js",
  "src/data.js",
  "src/views.js",
  "src/day.js",
  "src/dayview.js",
  "src/charts.js",
  "src/dom.js",
  "src/route.js",
  "src/markdown.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch(() => {
            // a missing file must not fail the install
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Only the app's own files. In local mode the page also reads the data
  // repository from the same origin; that must never land in the shell cache.
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
