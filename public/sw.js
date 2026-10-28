/*
 * Minimal offline shell for the strength app.
 *
 * Data lives in localStorage, so the only job here is to keep the built app
 * shell and previously loaded media available when the network disappears.
 * Uncached images still fall back to the text placeholder in ExerciseMedia.
 */
const CACHE = 'fitbod-clone-shell-v4';
const SHELL = ['/', '/index.html', '/favicon.svg'];
const NETWORK_TIMEOUT_MS = 4000;

function offlineResponse() {
  return new Response('', { status: 504, statusText: 'Offline' });
}

/**
 * A dead origin does not always reject promptly: proxies and mobile networks
 * can leave a request hanging. Bound the wait so uncached media reaches the
 * component's error handler instead of spinning forever.
 */
function fetchWithTimeout(request) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(offlineResponse()), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      () => {
        clearTimeout(timer);
        resolve(offlineResponse());
      },
    );
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('fitbod-clone-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const response = await fetchWithTimeout(request);
        // A non-OK response can come from an intermediary when the origin is
        // down; that is still effectively offline, so prefer the cached shell.
        if (response.ok) {
          const copy = response.clone();
          await cache.put('/index.html', copy);
          return response;
        }
        return (
          (await cache.match('/index.html')) ||
          (await cache.match('/')) ||
          new Response('Offline and no cached app shell is available.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      })(),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetchWithTimeout(request).then((response) => {
        if (
          response.ok &&
          ['image', 'script', 'style', 'font'].includes(request.destination)
        ) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
