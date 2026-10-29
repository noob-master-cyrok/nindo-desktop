// Keeps the app's own files so the window opens without internet. The page
// is always fetched fresh first, so a publish shows up on the next open;
// the hashed files in assets/ never change and are served from the cache.
// Supabase requests are not touched: tasks still need the internet to sync.
const cacheName = 'nindo-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== cacheName).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (url.pathname.includes('/assets/')) event.respondWith(asset(request));
  else event.respondWith(fresh(request));
});

async function page(request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put('./', response.clone());
      void prune(cache, await response.clone().text());
    }
    return response;
  } catch {
    return (await cache.match('./')) ?? Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function fresh(request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

// Drops files from older publishes that the current page no longer uses.
async function prune(cache, html) {
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (!path.includes('/assets/')) continue;
    const name = path.slice(path.lastIndexOf('/assets/') + 1);
    if (!html.includes(name)) await cache.delete(request);
  }
}
