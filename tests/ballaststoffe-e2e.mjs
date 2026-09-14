/**
 * Der Ballaststoff-Fehler – nachgestellt, wie er wirklich entstanden ist.
 *
 * Erik meldete: „Ballaststoffe werden unter Ernährung nicht automatisch
 * eingetragen. Andere Werte funktionieren." Die Unit-Tests konnten das nicht
 * zeigen, weil auf einer frischen Datenbank alles stimmt. Der Schaden steckt
 * im ZUSTAND, den zwei Geräte über Tage erzeugt haben:
 *
 *   1. `fiber_g` kam am 13.09.2026 dazu – in derselben Fassung, in der ein
 *      Sortierwert von 23.5 den Abgleich der Tabelle `metrics` zum Stehen
 *      brachte (Migration 9).
 *   2. Bis das behoben war, legten PC und Handy jeweils ihre EIGENE
 *      Ballaststoff-Metrik an und schrieben ihre Tageswerte darauf.
 *   3. Danach lief der Abgleich wieder. Beide Metriken erreichten den Server –
 *      der kennt kein UNIQUE auf `key` und nahm beide an.
 *   4. Beim Holen löste SQLite den UNIQUE-Konflikt auf seine Weise:
 *      `INSERT OR REPLACE` LÖSCHT die vorhandene Zeile. Die Tageswerte zeigten
 *      danach auf eine Metrik, die es nicht mehr gab – und waren damit
 *      unsichtbar, obwohl sie vollständig gespeichert waren.
 *
 * Genau das wird hier nachgestellt: Der Server bekommt eine zweite
 * `fiber_g`-Metrik untergeschoben, während die Tageswerte auf die erste
 * zeigen. Danach muss der Wert trotzdem dastehen, wo Erik hinsieht.
 *
 * Geprüft werden BEIDE Richtungen – die zweite Metrik einmal mit kleinerer,
 * einmal mit größerer Kennung. Nur so ist sicher, dass die Auflösung nicht
 * zufällig in einem der beiden Fälle klappt.
 *
 * Aufruf:  node tests/ballaststoffe-e2e.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, process.env.LIFEHUB_HTML ?? 'LifeHub.html').split(path.sep).join('/')
const PORT = 54407
const SUPA = `http://127.0.0.1:${PORT}`
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
  else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehler++ }
}

const heute = new Date().toISOString().slice(0, 10)
const epoch = (tag) => Math.floor(Date.parse(tag + 'T00:00:00Z') / 86400000)
const ausEpoch = (n) => new Date(n * 86400000).toISOString().slice(0, 10)

/** Ein Tag mit Ballaststoffen – der Wert, den Erik in FatSecret sieht. */
const BALLAST = '27.4'
const tagebuch = new Map([[heute, [{
  food_entry_id: 'e-1', food_id: '900', food_entry_name: 'Vollkornbrot',
  food_entry_description: '100 g', number_of_units: '1', meal: 'breakfast',
  calories: '400', carbohydrate: '50', protein: '20', fat: '10',
  fiber: BALLAST, sugar: '5', saturated_fat: '2',
}]]])

/* ------------------------------------------------------- Der Server-Nachbau */

const tabellen = new Map()
let rev = 0
const tabelle = (name) => tabellen.get(name) ?? tabellen.set(name, new Map()).get(name)

function antwort(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  })
  res.end(body === null ? '' : JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return antwort(res, 204, null)
  const [pfad, query] = req.url.split('?')

  if (pfad.startsWith('/auth/v1/token')) {
    return antwort(res, 200, {
      access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600,
      token_type: 'bearer', user: { id: '11111111-1111-1111-1111-111111111111', email: MAIL },
    })
  }

  const fsRoute = pfad.match(/^\/functions\/v1\/fatsecret\/?(\w*)$/)
  if (fsRoute) {
    let body = ''
    req.on('data', (c) => { body += c })
    return req.on('end', () => {
      const route = fsRoute[1] || 'status'
      if (route === 'status') return antwort(res, 200, { connected: true, connected_at: '2026-01-01T00:00:00Z' })
      let daten = {}
      try { daten = JSON.parse(body || '{}') } catch { /* egal */ }
      if (route === 'months') {
        const out = {}
        for (const m of daten.months ?? []) {
          const monat = ausEpoch(m).slice(0, 7)
          const tage = [...tagebuch.keys()].filter((t) => t.slice(0, 7) === monat)
          out[String(m)] = tage.length
            ? { month: { day: tage.map((t) => ({ date_int: String(epoch(t)) })) } }
            : { month: {} }
        }
        return antwort(res, 200, { months: out })
      }
      if (route === 'diary') {
        const out = {}
        for (const d of daten.dates ?? []) {
          const e = tagebuch.get(ausEpoch(d))
          out[String(d)] = e && e.length ? { food_entries: { food_entry: e } } : { food_entries: {} }
        }
        return antwort(res, 200, { days: out })
      }
      return antwort(res, 200, {})
    })
  }

  const m = pfad.match(/^\/rest\/v1\/(\w+)$/)
  if (!m) return antwort(res, 404, {})
  const store = tabelle(m[1])
  if (req.method === 'GET') {
    const ab = Number((query ?? '').match(/server_rev=gt\.(\d+)/)?.[1] ?? 0)
    return antwort(res, 200, [...store.values()].filter((z) => Number(z.server_rev) > ab))
  }
  let body = ''
  req.on('data', (c) => { body += c })
  return req.on('end', () => {
    let zeilen = []
    try { zeilen = JSON.parse(body) } catch { /* egal */ }
    return antwort(res, 200, zeilen.map((z) => {
      const g = { ...z, server_rev: ++rev }; store.set(z.id, g); return g
    }))
  })
})

/* ------------------------------------------------------------ Browserablauf */

const geh = async (p, hash) => { await p.goto(DATEI + '#' + hash); await p.waitForTimeout(900) }

async function warteAufApp(p, ms = 90000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(60)
  }
  return false
}

async function anmelden(p) {
  await geh(p, '/einstellungen/sync')
  await p.waitForTimeout(700)
  const auf = p.locator('text=Andere Server-Verbindung nutzen')
  if (await auf.count()) { await auf.first().click(); await p.waitForTimeout(400) }
  const feld = p.locator('input[placeholder*="supabase.co"]')
  await feld.fill(SUPA); await feld.blur(); await p.waitForTimeout(300)
  const felder = p.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(ANON); await felder.nth(1).blur(); await p.waitForTimeout(500)
  await p.locator('input[type=email]').fill(MAIL)
  await p.locator('input[type=password]').fill(PASS)
  await p.locator('button', { hasText: 'Anmelden' }).click()
  await p.waitForTimeout(3000)
}

/**
 * Die Rolle dieses Geräts festlegen – ohne das überträgt LifeHub von sich aus
 * nichts, und der Abgleichknopf erscheint gar nicht erst.
 */
async function rolleWaehlen(p) {
  await geh(p, '/einstellungen/sync')
  const knopf = p.locator('button', { hasText: 'Diesen Bestand auf den Server laden' })
  if (!(await knopf.count())) return false
  await knopf.first().click()
  await p.waitForTimeout(500)
  await p.locator('button', { hasText: 'Auf den Server laden' }).last().click()
  await p.waitForTimeout(5000)
  return true
}

async function abgleichen(p) {
  await geh(p, '/einstellungen/sync')
  const knopf = p.locator('button', { hasText: 'Jetzt synchronisieren' })
  if (await knopf.count()) { await knopf.first().click(); await p.waitForTimeout(3500) }
  else { fehler++; console.log('  FEHL Knopf „Jetzt synchronisieren" nicht gefunden') }
}

/** Den Wert einer Metrik auf der Ernährungsseite ablesen – dort, wo Erik schaut. */
async function wertAufErnaehrungsseite(p, beschriftung) {
  await geh(p, '/tracking')
  await p.waitForTimeout(1200)
  return await p.evaluate((label) => {
    const zeilen = [...document.querySelectorAll('.progress-row')]
    const treffer = zeilen.find((z) => z.innerText.trim().startsWith(label))
    const input = treffer?.querySelector('input')
    return input ? input.value : null
  }, beschriftung)
}

/**
 * Einen Durchgang: Die zweite Ballaststoff-Metrik bekommt eine Kennung, die
 * entweder vor oder hinter der vorhandenen einsortiert.
 */
async function durchgang(kleiner) {
  const bezeichnung = kleiner ? 'zweite Metrik mit KLEINERER Kennung' : 'zweite Metrik mit GRÖSSERER Kennung'
  console.log(`\n--- ${bezeichnung} ---`)
  tabellen.clear()
  rev = 0

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-ballast-'))
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profil'), {
    viewport: { width: 1400, height: 1000 },
  })
  const p = ctx.pages()[0] ?? await ctx.newPage()
  const konsole = []
  p.on('pageerror', (e) => konsole.push(String(e)))

  await p.goto(DATEI)
  pruefe('App startet', await warteAufApp(p))
  await p.waitForTimeout(2500)
  await anmelden(p)
  pruefe('Rolle „hier liegen meine Daten" lässt sich wählen', await rolleWaehlen(p))
  await p.waitForTimeout(4000)   // FatSecret läuft von selbst an
  await abgleichen(p)

  // Ausgangslage: Der Wert steht da, alles ist in Ordnung.
  const vorher = await wertAufErnaehrungsseite(p, 'Ballaststoffe')
  // Genau 27,4 – nicht 27. FatSecret nennt eine Nachkommastelle, und wer die
  // Zahlen nebeneinanderlegt, soll nicht nach einem Fehler suchen, wo keiner ist.
  pruefe('Ausgangslage: Ballaststoffe stehen mit Nachkommastelle da', vorher === '27,4',
    `abgelesen: "${vorher}"`)

  // Jetzt der Schaden: eine ZWEITE Metrik mit demselben Schlüssel, so wie sie
  // das andere Gerät angelegt hätte.
  const metriken = tabelle('metrics')
  const eigene = [...metriken.values()].find((m) => m.key === 'fiber_g')
  if (!eigene) { pruefe('Die Ballaststoff-Metrik liegt auf dem Server', false); await ctx.close(); return }

  const fremdeId = kleiner
    ? '00000000-0000-8000-8000-000000000001'
    : 'ffffffff-ffff-8fff-bfff-ffffffffffff'
  metriken.set(fremdeId, {
    ...eigene, id: fremdeId, server_rev: ++rev,
    updated_at: new Date().toISOString(), version: 1,
  })
  pruefe('Zweite Ballaststoff-Metrik liegt auf dem Server',
    [...metriken.values()].filter((m) => m.key === 'fiber_g' && !m.deleted_at).length === 2)

  // Der Abgleich holt sie – hier zerlegte es sich früher.
  await abgleichen(p)
  await p.waitForTimeout(1500)

  const nachher = await wertAufErnaehrungsseite(p, 'Ballaststoffe')
  pruefe('Ballaststoffe stehen nach dem Abgleich immer noch da',
    nachher === '27,4', `abgelesen: "${nachher}"`)

  // Die Kalorien daneben dürfen dabei nicht gelitten haben.
  const kcal = await wertAufErnaehrungsseite(p, 'Kalorien')
  pruefe('Kalorien sind unberührt geblieben', kcal === '400', `abgelesen: "${kcal}"`)

  // Und ein Neustart darf den Wert nicht wieder verlieren.
  await p.goto(DATEI)
  await warteAufApp(p)
  await p.waitForTimeout(3000)
  const nachNeustart = await wertAufErnaehrungsseite(p, 'Ballaststoffe')
  pruefe('Auch nach einem Neustart', nachNeustart === '27,4',
    `abgelesen: "${nachNeustart}"`)

  // Und die Dublette ist aufgelöst, statt bei jedem Abgleich neu zuzuschlagen.
  await abgleichen(p)
  const offen = [...tabelle('metrics').values()].filter((m) => m.key === 'fiber_g' && !m.deleted_at)
  pruefe('Auf dem Server bleibt genau eine Ballaststoff-Metrik übrig',
    offen.length === 1, `${offen.length} gefunden`)

  pruefe('Keine Fehler in der Konsole', konsole.length === 0, konsole.slice(0, 2).join(' | '))
  await ctx.close()
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  console.log('\n=== Ballaststoffe: doppelte Metrik aus zwei Geräten ===')
  await durchgang(true)
  await durchgang(false)
  server.close()
  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); server.close(); process.exit(1) })
