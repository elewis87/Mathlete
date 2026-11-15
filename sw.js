// Mathlete offline cache. Bump VERSION whenever a file in this folder changes.
const VERSION = "mathlete-v8";
const CORE = ["./", "index.html", "cloud.js", "firebase-config.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
const CACHEABLE = u => u.origin === self.location.origin || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com" ||
  (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/"));
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!CACHEABLE(url)) return;                       // sign-in and database traffic goes straight to the network
  const own = url.origin === self.location.origin;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request, { ignoreSearch: e.request.mode === "navigate" });
    const fresh = fetch(e.request).then(r => { if (r && (r.ok || r.type === "opaque")) cache.put(e.request, r.clone()); return r; });
    if (own) { try { return await fresh; } catch (err) { return hit || cache.match("index.html"); } }   // newest app files when online
    if (hit) { fresh.catch(() => {}); return hit; }                                                     // fonts and libraries from cache
    return fresh;
  })());
});
