/**
 * Service Worker – macht LifeHub auf dem Smartphone installierbar und
 * vollständig offline lauffähig.
 *
 * Strategie:
 *   - App-Hülle (HTML, JS, CSS, WASM) wird beim ersten Start zwischengespeichert
 *   - danach: erst Cache, dann Netz (schneller Start, funktioniert ohne Verbindung)
 *   - Navigationsanfragen fallen immer auf index.html zurück
 * Die Nutzdaten liegen NICHT hier, sondern in der lokalen SQLite-Datenbank.
 */
const CACHE = 'lifehub-v1'
const CORE = ['./', './index.html', './manifest.webmanifest', './sql-wasm.wasm', './sql-wasm-browser.wasm', './icon-192.png']

/**
 * Beim Installieren wird die App-Hülle vollständig zwischengespeichert.
 * Dazu gehören auch die gebündelten Dateien aus /assets, deren Namen einen
 * Hash enthalten – sie werden deshalb aus der index.html ausgelesen.
 * Ohne diesen Schritt startet die App beim ersten Offline-Aufruf nicht.
 */
async function precache() {
  const cache = await caches.open(CACHE)
  await Promise.all(CORE.map((u) => cache.add(u).catch(() => undefined)))
  try {
    const res = await fetch('./index.html', { cache: 'reload' })
    const html = await res.text()
    await cache.put('./index.html', new Response(html, { headers: { 'Content-Type': 'text/html' } }))
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])
    await Promise.all(assets.map((u) => cache.add(u).catch(() => undefined)))
  } catch {
    /* ohne Netz bleibt der vorhandene Cache bestehen */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
