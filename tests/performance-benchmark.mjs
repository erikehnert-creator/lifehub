/**
 * Wie schnell ist LifeHub mit mehreren Jahren Daten – gemessen, nicht geschätzt.
 *
 * Der Anlass: `loadAll()` liest bei JEDER Änderung alle ~40 Tabellen neu ein.
 * Solange die Datenbank klein war, fiel das nicht auf. Mit drei Jahren
 * Ernährungshistorie sind es rund 23.000 Zeilen – und der historische
 * FatSecret-Import schreibt sie einzeln.
 *
 * Gemessen wird deshalb nicht an einer künstlichen Schleife, sondern an dem,
 * was Erik tatsächlich tut: App öffnen, blättern, einen Wert eintragen, Werte
 * von gestern übernehmen, Historie importieren.
 *
 * Der Server ist ein Nachbau – EIN Server für beides, weil LifeHub die
 * FatSecret-Funktion unter derselben Adresse sucht wie die Synchronisation
 * (`resolvedSyncUrl` + `/functions/v1/fatsecret`). Dadurch läuft der Import
 * durch den echten Code, ohne dass ein FatSecret-Konto nötig wäre.
 *
 * Aufruf:  node tests/performance-benchmark.mjs [monate]
 *          node tests/performance-benchmark.mjs 36      (Vorgabe: 36)
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// Für den Vorher/Nachher-Vergleich: LIFEHUB_HTML zeigt auf eine andere Fassung,
// etwa eine aus der Versionsgeschichte herausgeholte.
const HTML = process.env.LIFEHUB_HTML || path.join(WURZEL, 'LifeHub.html')
const DATEI = 'file:///' + path.resolve(HTML).split(path.sep).join('/')
const PORT = 54401
const SUPA = `http://127.0.0.1:${PORT}`
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

const MONATE = Number(process.argv[2] || 36)
/** Tage je Monat mit Einträgen – so sieht ein durchgehend gefuehrtes Tagebuch aus. */
const TAGE_JE_MONAT = 28
/** Lebensmittel je Tag. */
const ESSEN_JE_TAG = 5

/* ------------------------------------------------------------- Messwerkzeug */

const messungen = []
async function miss(name, fn) {
  const t0 = Date.now()
  const zusatz = await fn()
  const ms = Date.now() - t0
  messungen.push({ name, ms, zusatz: zusatz ?? '' })
  console.log(`  ${String(ms).padStart(7)} ms  ${name}${zusatz ? '  (' + zusatz + ')' : ''}`)
  return ms
}

/* ---------------------------------------------------- Erfundene Tagebücher */

const epoch = (tag) => {
  const [j, m, t] = tag.split('-').map(Number)
  return Math.floor(Date.UTC(j, m - 1, t) / 86400000)
}
const ausEpoch = (n) => new Date(n * 86400000).toISOString().slice(0, 10)

/** Ein Lebensmittel mit allen 16 Nährwerten, damit der Import echte Arbeit hat. */
function essen(tag, i) {
  const id = `${epoch(tag)}-${i}`
  return {
    food_entry_id: id,
    food_id: String(1000 + i),
    date_int: String(epoch(tag)),
    meal: ['breakfast', 'lunch', 'dinner', 'other'][i % 4],
    food_entry_name: ['Haferflocken', 'Banane', 'Reis', 'Hähnchen', 'Proteinpulver'][i % 5],
    food_entry_description: '100 g',
    number_of_units: '1',
    calories: String(300 + i * 37), carbohydrate: String(40 + i), protein: String(20 + i),
    fat: String(8 + i), fiber: String(3 + i), sugar: String(2 + i),
    saturated_fat: String(1 + i), polyunsaturated_fat: '2', monounsaturated_fat: '3',
    cholesterol: String(10 + i), sodium: String(80 + i), potassium: String(200 + i),
    calcium: String(50 + i), iron: String(2 + i), vitamin_a: String(40 + i), vitamin_c: String(5 + i),
  }
}

/** Die Monate, die der Nachbau kennt – rückwärts ab dem laufenden. */
function monatsTage(monatEpoch) {
  const basis = ausEpoch(monatEpoch).slice(0, 7)
  const tage = []
  for (let d = 1; d <= TAGE_JE_MONAT; d++) tage.push(`${basis}-${String(d).padStart(2, '0')}`)
  return tage
}

const heute = new Date().toISOString().slice(0, 10)
const aeltesterMonat = (() => {
  const [j, m] = heute.split('-').map(Number)
  const gesamt = j * 12 + (m - 1) - MONATE
  return `${Math.floor(gesamt / 12)}-${String((gesamt % 12) + 1).padStart(2, '0')}`
})()

/* ------------------------------------------------------- Der Server-Nachbau */

const tabellen = new Map()
let rev = 0
let aufrufe = { months: 0, diary: 0, tage: 0 }

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

  /* ------------------------------------------------ FatSecret-Edge-Function */
  const fs2 = pfad.match(/^\/functions\/v1\/fatsecret\/?(\w*)$/)
  if (fs2) {
    let body = ''
    req.on('data', (c) => { body += c })
    return req.on('end', () => {
      const route = fs2[1] || 'status'
      if (route === 'status') return antwort(res, 200, { connected: true, connected_at: '2026-01-01T00:00:00Z' })
      let daten = {}
      try { daten = JSON.parse(body || '{}') } catch { /* egal */ }

      if (route === 'months') {
        aufrufe.months++
        const out = {}
        for (const m of daten.months ?? []) {
          const monat = ausEpoch(m).slice(0, 7)
          out[String(m)] = monat >= aeltesterMonat
            ? { month: { day: monatsTage(m).map((t) => ({ date_int: String(epoch(t)), calories: '2200' })) } }
            : { month: {} }
        }
        return antwort(res, 200, { months: out })
      }
      if (route === 'diary') {
        aufrufe.diary++
        const out = {}
        for (const d of daten.dates ?? []) {
          aufrufe.tage++
          const tag = ausEpoch(d)
          out[String(d)] = tag.slice(0, 7) >= aeltesterMonat
            ? { food_entries: { food_entry: Array.from({ length: ESSEN_JE_TAG }, (_, i) => essen(tag, i)) } }
            : { food_entries: {} }
        }
        return antwort(res, 200, { days: out })
      }
      return antwort(res, 200, {})
    })
  }

  /* --------------------------------------------------------------- PostgREST */
  const m = pfad.match(/^\/rest\/v1\/(\w+)$/)
  if (!m) return antwort(res, 404, { message: 'nicht gefunden' })
  const tabelle = m[1]
  if (!tabellen.has(tabelle)) tabellen.set(tabelle, new Map())
  const store = tabellen.get(tabelle)

  if (req.method === 'GET') {
    const ab = Number((query ?? '').match(/server_rev=gt\.(\d+)/)?.[1] ?? 0)
    return antwort(res, 200, [...store.values()].filter((z) => Number(z.server_rev) > ab))
  }
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    return req.on('end', () => {
      let zeilen = []
      try { zeilen = JSON.parse(body) } catch { /* egal */ }
      const raus = zeilen.map((z) => { const g = { ...z, server_rev: ++rev }; store.set(z.id, g); return g })
      return antwort(res, 200, raus)
    })
  }
  return antwort(res, 405, {})
})

/* ------------------------------------------------------------ Browserablauf */

const geh = async (p, hash) => { await p.goto(DATEI + '#' + hash); await p.waitForTimeout(400) }

async function warteAufApp(p, ms = 90000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(50)
  }
  return false
}

async function anmelden(p) {
  await geh(p, '/einstellungen/sync')
  await p.waitForTimeout(800)
  const aufklapper = p.locator('text=Andere Server-Verbindung nutzen')
  if (await aufklapper.count()) { await aufklapper.first().click(); await p.waitForTimeout(400) }
  const feld = p.locator('input[placeholder*="supabase.co"]')
  await feld.fill(SUPA); await feld.blur(); await p.waitForTimeout(300)
  const felder = p.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(ANON); await felder.nth(1).blur(); await p.waitForTimeout(500)
  await p.locator('input[type=email]').fill(MAIL)
  await p.locator('input[type=password]').fill(PASS)
  await p.locator('button', { hasText: 'Anmelden' }).click()
  await p.waitForTimeout(2500)
}

/** Wie viele Zeilen liegen in der Datenbank? Über die Oberfläche gezählt. */
async function bestand(p) {
  await geh(p, '/einstellungen/daten')
  await p.waitForTimeout(1200)
  const t = await p.evaluate(() => document.body.innerText)
  const m = t.match(/([\d.]+)\s*Datensätze/)
  return m ? m[1] : '?'
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-perf-'))
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profil'), {
    viewport: { width: 1400, height: 1000 },
  })
  const p = ctx.pages()[0] ?? await ctx.newPage()

  console.log(`\n=== LifeHub-Leistungsmessung ===`)
  console.log(`  ${MONATE} Monate à ${TAGE_JE_MONAT} Tage à ${ESSEN_JE_TAG} Lebensmittel`)
  console.log(`  erwartet: ~${MONATE * TAGE_JE_MONAT} Tage, `
    + `~${MONATE * TAGE_JE_MONAT * ESSEN_JE_TAG} Lebensmittel, `
    + `~${MONATE * TAGE_JE_MONAT * 16} Tageswerte\n`)

  /* ------------------------------------------------------- leere Datenbank */
  await miss('Kaltstart, leere Datenbank', async () => {
    await p.goto(DATEI)
    if (!await warteAufApp(p)) throw new Error('App startet nicht')
  })
  await p.waitForTimeout(2000)
  await anmelden(p)

  /* --------------------------------------------------- Historienimport */
  // Der Import läuft von selbst los, sobald FatSecret verbunden ist. Gewartet
  // wird darauf, dass der Stand "fertig" meldet – das ist derselbe Weg, den
  // Erik erlebt, nur ohne Zutun.
  let abgestuerzt = false
  p.on('crash', () => { abgestuerzt = true })
  await miss(`Historienimport (${MONATE} Monate)`, async () => {
    await geh(p, '/einstellungen/ernaehrung')
    const bis = Date.now() + 20 * 60 * 1000
    while (Date.now() < bis) {
      // Der Absturz der Seite ist selbst ein Messergebnis: Die alte Fassung
      // hielt den Import schlicht nicht durch. Er darf den Lauf deshalb nicht
      // mit einer Ausnahme beenden, sondern muss im Bericht stehen.
      try {
        const t = await p.evaluate(() => document.body.innerText)
        if (/Historie vollständig/.test(t)) break
      } catch {
        abgestuerzt = true
        break
      }
      await p.waitForTimeout(1000).catch(() => { abgestuerzt = true })
      if (abgestuerzt) break
    }
    return abgestuerzt
      ? `ABGESTÜRZT nach ${aufrufe.tage} Tagen`
      : `${aufrufe.tage} Tage geholt, ${aufrufe.months} Monatsabfragen`
  })

  if (abgestuerzt) {
    console.log('\n  Die Seite hat den Import nicht überstanden – alles Weitere entfällt.\n')
    fs.writeFileSync(
      path.join(WURZEL, 'tests', `benchmark-${process.env.LIFEHUB_BENCH_TAG || 'lauf'}.json`),
      JSON.stringify({ monate: MONATE, abgestuerzt: true, messungen }, null, 2),
    )
    await ctx.close(); server.close()
    return
  }

  const zeilen = await bestand(p)

  /* ------------------------------------------------------ volle Datenbank */
  await miss('Kaltstart, volle Datenbank', async () => {
    await p.goto(DATEI)
    if (!await warteAufApp(p)) throw new Error('App startet nicht')
    await p.waitForTimeout(1500)
    return `${zeilen} Datensätze`
  })

  for (const [name, hash] of [
    ['Navigation → Tracking', '/tracking'],
    ['Navigation → Verlauf', '/tracking/verlauf'],
    ['Navigation → Analysen', '/analysen'],
    ['Navigation → Finanzen', '/finanzen'],
  ]) {
    await miss(name, async () => {
      await p.goto(DATEI + '#' + hash)
      await p.waitForFunction(() => !!document.querySelector('.page'), null, { timeout: 60000 })
      await p.waitForTimeout(250)
    })
  }

  /* ------------------------------------------- ein einzelner Wert (1x loadAll) */
  await geh(p, '/tracking')
  await p.waitForTimeout(1200)
  await miss('Einzelnen Wert eintragen', async () => {
    // Ein Trackingwert – genau EIN Schreibvorgang, und damit die reine
    // Messung dessen, was ein Nachladen kostet.
    const zeile = p.locator('.progress-row').first()
    if (!await zeile.count()) return 'keine Eingabe gefunden'
    const eingabe = zeile.locator('input').first()
    await eingabe.fill('7', { timeout: 120000 })
    await eingabe.blur().catch(() => {})
    await p.waitForTimeout(300).catch(() => {})
    return ''
  })

  /* --------------------------------- viele Werte auf einmal (N x loadAll) */
  await miss('„Von gestern übernehmen" (viele Werte)', async () => {
    const knopf = p.locator('button', { hasText: 'Von gestern übernehmen' })
    if (!await knopf.count()) return 'Knopf nicht gefunden'
    // `noWaitAfter`, weil der Klick in der alten Fassung den Hauptfaden für
    // zig Sekunden blockiert – Playwright würde sonst beim Warten auf
    // „Navigation abgeschlossen" in eine Zeitüberschreitung laufen und die
    // Messung mit einer Ausnahme beenden, statt sie zu liefern.
    await knopf.first().click({ noWaitAfter: true, timeout: 120000 })
    const bis = Date.now() + 180000
    while (Date.now() < bis) {
      const fertig = await p.evaluate(
        () => /übernommen|Nichts zu übernehmen/.test(document.body.innerText),
      ).catch(() => null)
      if (fertig === null) return 'Seite abgestürzt'
      if (fertig) return ''
      await p.waitForTimeout(200).catch(() => {})
    }
    return 'über 180 s – abgebrochen'
  })

  /* ---------------------------------------------------------- Abgleich */
  await miss('Supabase-Abgleich (voller Bestand)', async () => {
    await geh(p, '/einstellungen/sync')
    await p.waitForTimeout(800)
    const erst = p.locator('button', { hasText: 'Diesen Bestand auf den Server laden' })
    if (await erst.count()) {
      await erst.click(); await p.waitForTimeout(600)
      await p.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
    } else {
      await p.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
    }
    for (let i = 0; i < 600; i++) {
      await p.waitForTimeout(500)
      const t = await p.innerText('#root')
      if (/Synchronisiert:|Auf den Server geladen:|Teilweise|fehlgeschlagen/.test(t)) break
    }
  })

  console.log(`\n  Datenbestand am Ende: ${zeilen} Datensätze`)
  console.log(`\n=== Zusammenfassung ===`)
  for (const m of messungen) {
    console.log(`  ${String(m.ms).padStart(7)} ms  ${m.name}`)
  }

  // Maschinenlesbar, damit sich Vorher/Nachher vergleichen lässt.
  const ziel = path.join(WURZEL, 'tests', `benchmark-${process.env.LIFEHUB_BENCH_TAG || 'lauf'}.json`)
  fs.writeFileSync(ziel, JSON.stringify({ monate: MONATE, zeilen, messungen }, null, 2))
  console.log(`\n  geschrieben: ${path.relative(WURZEL, ziel)}\n`)

  await ctx.close()
  server.close()
}

main().catch((e) => { console.error(e); server.close(); process.exit(1) })
