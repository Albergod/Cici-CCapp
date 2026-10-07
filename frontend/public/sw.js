/* Service Worker mínimo de CiCi (PWA instalable).
 * Estrategia segura: solo cachea estáticos mismo-origen por GET (JS/CSS/
 * imágenes); la navegación y /api siempre van a red. Versión bump = limpieza.
 */
const CACHE = "cici-static-v1";
const STATIC_RX = /\.(js|css|png|jpg|jpeg|webp|avif|gif|svg|woff2?)$/;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // analytics, Google, QR: fuera
  if (!STATIC_RX.test(url.pathname)) return; // navegación y /api: a red
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((hit) => {
        const network = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    )
  );
});
