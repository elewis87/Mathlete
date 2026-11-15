// Mathlete offline cache. Bump VERSION when index.html changes.
const VERSION = "mathlete-v5";
const CORE = ["./", "index.html", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const page = e.request.mode === "navigate";
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request, {ignoreSearch: page});
    const fresh = fetch(e.request).then(r => { if (r && (r.ok || r.type === "opaque")) cache.put(e.request, r.clone()); return r; });
    if (page) { try { return await fresh; } catch (err) { return hit || cache.match("index.html"); } }   // newest page when online
    if (hit) { fresh.catch(() => {}); return hit; }                                                    // fonts and icons from cache
    return fresh;
  })());
});
