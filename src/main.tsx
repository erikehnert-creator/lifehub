import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './ui/theme.css'

createRoot(document.getElementById('root')!).render(<App />)

// Service Worker: macht die App auf dem Smartphone installierbar und offline lauffähig.
//
// Ohne das Update-Handling unten bleibt eine einmal geöffnete Seite – vor
// allem als Homescreen-App auf dem iPhone, die tagelang nicht neu geladen
// wird – auf dem Stand hängen, den sie beim letzten echten Laden hatte, auch
// wenn im Hintergrund längst eine neue Version installiert ist. Neue
// Funktionen, Fehlerkorrekturen und auch Änderungen an der Synchronisation
// kommen dann nie an, ohne dass es auffällt – das sah lange wie "synct nicht"
// aus, war in Wahrheit aber "läuft noch mit altem Code".
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).href
    navigator.serviceWorker.register(swUrl, { scope: './' })
      .then((reg) => {
        const nachNeuemStandSehen = () => { reg.update().catch(() => undefined) }
        document.addEventListener('visibilitychange', () => { if (!document.hidden) nachNeuemStandSehen() })
        window.addEventListener('focus', nachNeuemStandSehen)
      })
      .catch(() => { /* ohne Service Worker funktioniert die App weiterhin */ })

    // Sobald eine neu installierte Version die Kontrolle übernimmt, einmal neu
    // laden – das passiert nur, wenn schon eine ältere Version aktiv war, also
    // nie bei der allerersten Installation.
    let neuGeladen = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (neuGeladen) return
      neuGeladen = true
      location.reload()
    })
  })
}
