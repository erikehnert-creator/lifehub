/**
 * Ein LifeHub-„Gerät" für die Sync-Prüfungen: starten, anmelden, abgleichen.
 *
 * Diese Handgriffe standen wörtlich in vier Prüfskripten – vier Fassungen von
 * „Server eintragen, anmelden, auf den Knopf drücken, auf die Meldung warten".
 * Änderte sich etwas an der Einstellungsseite, liefen drei davon still ins
 * Leere. Deshalb steht es jetzt an einer Stelle.
 *
 * Ein Gerät ist entweder die PC-Einzeldatei (`LifeHub.html` über file://) oder
 * die Handy-Fassung aus `dist/` über http. Beide sprechen dieselbe App an;
 * dass es zwei Wege gibt, ist genau der Punkt – so prüft der Abgleich zwei
 * wirklich getrennte Speicher.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { startOptionen, EINZELDATEI, DIST, profilOrdner } from './_browser.mjs'

const TYPEN = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
}

/** `dist/` über http anbieten – die Handy-Fassung braucht einen echten Ursprung. */
export async function starteWebserver(port = 8080) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0])
    const datei = path.join(DIST, rel === '/' ? 'index.html' : rel)
    if (!datei.startsWith(DIST) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) {
      res.writeHead(404); res.end('nicht gefunden'); return
    }
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
    res.end(fs.readFileSync(datei))
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${port}/`, stop: () => new Promise((r) => server.close(r)) }
}

/**
 * Ein Gerät starten.
 *
 * Jedes bekommt ein eigenes, frisches Browserprofil – sonst teilten sich „PC"
 * und „Handy" eine IndexedDB und der Abgleich hätte nichts zu tun.
 */
export async function starteGeraet({ name, url = EINZELDATEI, viewport = { width: 1280, height: 900 } }) {
  const ctx = await chromium.launchPersistentContext(profilOrdner(name), startOptionen({ viewport }))
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const fehler = []
  page.on('pageerror', (e) => fehler.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()) })
  await page.goto(url)
  await warteAufApp(page)
  await page.waitForTimeout(1500)
  return { name, ctx, page, url, fehler, stop: () => ctx.close() }
}

export async function warteAufApp(p, ms = 60000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(300)
  }
  throw new Error('Die App ist nicht hochgekommen')
}

/** Auf eine Seite wechseln. Das Warten danach ist Absicht: Die App lädt nach. */
export async function geh(g, hash, ms = 1300) {
  await g.page.goto(g.url.split('#')[0] + '#' + hash)
  await g.page.waitForTimeout(ms)
}

/**
 * Server eintragen und anmelden.
 *
 * Ist ein Server fest eingebaut (src/sync/config.ts), liegen die Felder für
 * eine andere Verbindung hinter einem Aufklapper. Ohne diesen Klick findet
 * der Test das Eingabefeld nicht und liefe in eine Zeitüberschreitung.
 */
export async function anmelden(g, { url, anon, mail, pass }) {
  const p = g.page
  await geh(g, '/einstellungen/sync')

  const aufklapper = p.locator('text=Andere Server-Verbindung nutzen')
  if (await aufklapper.count()) { await aufklapper.first().click(); await p.waitForTimeout(500) }

  const feld = p.locator('input[placeholder*="supabase.co"]')
  await feld.fill(url); await feld.blur(); await p.waitForTimeout(400)
  const felder = p.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(anon); await felder.nth(1).blur(); await p.waitForTimeout(600)
  await p.locator('input[type=email]').fill(mail)
  await p.locator('input[type=password]').fill(pass)
  await p.locator('button', { hasText: 'Anmelden' }).click()
  await p.waitForTimeout(3000)
  return (await p.innerText('#root')).includes('angemeldet als')
}

/**
 * Einmal abgleichen und die Rückmeldung der App zurückgeben.
 *
 * Beim allerersten Mal steht dort „Diesen Bestand auf den Server laden"
 * statt „Jetzt synchronisieren" – das ist kein Sonderfall des Tests, sondern
 * der erste Schritt, den auch Erik sieht.
 */
export async function abgleich(g, sekunden = 90) {
  const p = g.page
  await geh(g, '/einstellungen/sync')
  const erst = p.locator('button', { hasText: 'Diesen Bestand auf den Server laden' })
  if (await erst.count()) {
    await erst.click(); await p.waitForTimeout(800)
    await p.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
  } else {
    await p.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
  }
  for (let i = 0; i < sekunden; i++) {
    await p.waitForTimeout(1000)
    const t = await p.innerText('#root')
    // Der Zweig für das unvollständige Server-Schema gehört dazu, seit
    // fehlende Tabellen zu EINEM Satz zusammengefasst werden. Ohne ihn meldete
    // der Helfer dort „(keine Rückmeldung)" – und jede Prüfung darauf wäre
    // blind, obwohl die App das Richtige anzeigt.
    const m = t.match(/(Synchronisiert:[^\n]*|Teilweise synchronisiert[^\n]*|Server-Schema unvollständig[^\n]*|Auf den Server geladen:[^\n]*|Synchronisation fehlgeschlagen:[^\n]*)/)
    if (m) return m[1]
  }
  return '(keine Rückmeldung)'
}

/* ----------------------------------------------------------- Kleinkram */

export function pruefer() {
  const fehlend = []
  const pruefe = (name, ok, zusatz = '') => {
    if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
    else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehlend.push(name) }
  }
  return { pruefe, fehlend }
}

export { EINZELDATEI, DIST }
