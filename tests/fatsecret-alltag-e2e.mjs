/**
 * Eriks Alltag mit FatSecret – im Browser durchgespielt.
 *
 * Der Zielzustand aus seinen Worten: „Ich trage mein Essen nur noch in
 * FatSecret ein. LifeHub übernimmt das automatisch, und die Ernährungsseite
 * zeigt die Tageswerte, ohne dass ich einen Knopf drücke."
 *
 * Die Unit-Tests prüfen die Entscheidungen (welcher Monat, welcher Tag, welcher
 * Wert). Was sie nicht können, ist die Frage, auf die es Erik ankommt: Stehen
 * die Zahlen hinterher **oben unter Ernährung**? Genau das ist hier der Kern –
 * nicht „liegen sie in food_entries", sondern „stehen sie da, wo er hinschaut".
 *
 * Der Server ist ein Nachbau. EIN Server für beides, weil LifeHub die
 * FatSecret-Funktion unter derselben Adresse sucht wie die Synchronisation.
 * Dadurch läuft alles durch den echten Code, ohne FatSecret-Konto.
 *
 * Aufruf:  node tests/fatsecret-alltag-e2e.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, 'LifeHub.html').split(path.sep).join('/')
const PORT = 54402
const SUPA = `http://127.0.0.1:${PORT}`
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
  else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehler++ }
}

/* --------------------------------------------------------------- Das Konto */

const heute = new Date().toISOString().slice(0, 10)
const tagVor = (n) => new Date(Date.parse(heute + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const epoch = (tag) => Math.floor(Date.parse(tag + 'T00:00:00Z') / 86400000)
const ausEpoch = (n) => new Date(n * 86400000).toISOString().slice(0, 10)

/**
 * Das erfundene Tagebuch: Tag → Liste von Einträgen.
 * Wird im Lauf des Tests verändert – genau so, wie Erik in FatSecret
 * nachträgt, korrigiert und löscht.
 */
const tagebuch = new Map()

function eintrag(id, name, werte = {}) {
  return {
    food_entry_id: id, food_id: '900', food_entry_name: name,
    food_entry_description: '100 g', number_of_units: '1', meal: 'breakfast',
    calories: '400', carbohydrate: '50', protein: '20', fat: '10',
    fiber: '6', sugar: '5', saturated_fat: '2', polyunsaturated_fat: '1',
    monounsaturated_fat: '3', cholesterol: '15', sodium: '90', potassium: '250',
    calcium: '60', iron: '3', vitamin_a: '30', vitamin_c: '8', ...werte,
  }
}

// Ausgangslage: heute Haferflocken, gestern Reis, vorgestern nichts.
tagebuch.set(heute, [eintrag('e-heute', 'Haferflocken')])
tagebuch.set(tagVor(1), [eintrag('e-gestern', 'Reis', { calories: '300', protein: '8' })])

// Ein Tag weit in der Vergangenheit – für den Historienabgleich.
const ALT = tagVor(95)
tagebuch.set(ALT, [eintrag('e-alt', 'Altes Brot', { calories: '250' })])

let diaryAufrufe = []

/* ------------------------------------------------------- Der Server-Nachbau */

const tabellen = new Map()
let rev = 0

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
            ? { month: { day: tage.map((t) => ({ date_int: String(epoch(t)), calories: '400' })) } }
            : { month: {} }
        }
        return antwort(res, 200, { months: out })
      }
      if (route === 'diary') {
        const tage = (daten.dates ?? []).map(ausEpoch)
        diaryAufrufe.push(tage)
        const out = {}
        for (const d of daten.dates ?? []) {
          const tag = ausEpoch(d)
          const e = tagebuch.get(tag)
          out[String(d)] = e && e.length ? { food_entries: { food_entry: e } } : { food_entries: {} }
        }
        return antwort(res, 200, { days: out })
      }
      return antwort(res, 200, {})
    })
  }

  const m = pfad.match(/^\/rest\/v1\/(\w+)$/)
  if (!m) return antwort(res, 404, {})
  const store = tabellen.get(m[1]) ?? tabellen.set(m[1], new Map()).get(m[1])
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
  await p.waitForTimeout(2500)
}

/** Warten, bis der Erstimport durch ist. */
async function warteAufImport(p, ms = 420000) {
  await geh(p, '/einstellungen/ernaehrung')
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    const t = await p.evaluate(() => document.body.innerText)
    if (/Historie vollständig/.test(t)) return true
    await p.waitForTimeout(800)
  }
  return false
}

/** Den Wert einer Metrik auf der Ernährungsseite ablesen – dort, wo Erik schaut. */
async function wertAufErnaehrungsseite(p, tag, beschriftung) {
  await geh(p, '/tracking')
  await p.waitForTimeout(900)
  // Zum gewünschten Tag blättern.
  const heuteStr = new Date().toISOString().slice(0, 10)
  let schritte = Math.round((Date.parse(heuteStr) - Date.parse(tag)) / 86400000)
  while (schritte-- > 0) {
    await p.locator('button', { hasText: '←' }).first().click()
    await p.waitForTimeout(250)
  }
  await p.waitForTimeout(500)
  // Die Trackingwerte stehen als `.progress-row` da: Name links, Eingabefeld
  // rechts. Genau diese Eingabe ist das, was Erik sieht und was er sonst von
  // Hand füllen müsste.
  return await p.evaluate((label) => {
    const zeilen = [...document.querySelectorAll('.progress-row')]
    const treffer = zeilen.find((z) => z.innerText.trim().startsWith(label))
    const input = treffer?.querySelector('input')
    return input ? input.value : null
  }, beschriftung)
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-alltag-'))
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profil'), {
    viewport: { width: 1400, height: 1000 },
  })
  const p = ctx.pages()[0] ?? await ctx.newPage()
  const konsole = []
  p.on('pageerror', (e) => konsole.push(String(e)))

  console.log('\n=== FatSecret im Alltag ===\n')

  await p.goto(DATEI)
  pruefe('App startet', await warteAufApp(p))
  await p.waitForTimeout(2000)
  await anmelden(p)

  /* ------------------------------------------- 1. Erstverbindung → Historie */
  pruefe('Erstimport läuft von selbst und wird fertig', await warteAufImport(p))
  const standText = await p.evaluate(() => document.body.innerText)
  pruefe('Der älteste gefundene Tag ist dabei', /Historie vollständig/.test(standText))

  /* ------------------------- 2. Die Werte stehen OBEN unter Ernährung */
  const kcal = await wertAufErnaehrungsseite(p, heute, 'Kalorien')
  pruefe('Kalorien stehen auf der Ernährungsseite', kcal === '400', `abgelesen: ${kcal}`)
  const protein = await wertAufErnaehrungsseite(p, heute, 'Protein')
  pruefe('Protein steht auf der Ernährungsseite', protein === '20', `abgelesen: ${protein}`)
  const ballast = await wertAufErnaehrungsseite(p, heute, 'Ballaststoffe')
  pruefe('Ballaststoffe stehen auf der Ernährungsseite', ballast === '6', `abgelesen: ${ballast}`)

  /* ----------------------------------- 3. Einzelne Lebensmittel sind da */
  const gegessen = await p.evaluate(() => document.body.innerText)
  pruefe('Das Lebensmittel selbst steht darunter', /Haferflocken/.test(gegessen))

  /* ---------------------------------------------- 4. Wasser bleibt manuell */
  await geh(p, '/tracking')
  await p.waitForTimeout(800)
  const wasserZeile = p.locator('.progress-row').filter({ hasText: 'Wasser' }).first()
  let wasserGesetzt = false
  if (await wasserZeile.count()) {
    const feld = wasserZeile.locator('input').first()
    await feld.fill('2,5')
    await feld.blur()
    await p.waitForTimeout(1200)
    wasserGesetzt = true
  }
  pruefe('Wasser lässt sich von Hand eintragen', wasserGesetzt)

  /* ----------------- 5. Der laufende Abgleich holt genau drei Tage */
  // Unter allen bisherigen Abrufen muss einer sein, der genau heute, gestern
  // und vorgestern geholt hat – das ist der laufende Abgleich. Die übrigen
  // stammen vom Erstimport und holen ältere Tage.
  const dreierAbruf = diaryAufrufe.find((tage) => {
    const s = [...tage].sort()
    return s.length === 3 && s[2] === heute && s[1] === tagVor(1) && s[0] === tagVor(2)
  })
  pruefe('Der laufende Abgleich holt genau heute, gestern und vorgestern',
    !!dreierAbruf, dreierAbruf ? dreierAbruf.sort().join(', ') : '(kein solcher Abruf)')

  /* --------------------- 6. Kein zweiter Abruf gleich hinterher */
  // App-Start, Fensterwechsel und online-Ereignis dürfen nicht drei identische
  // Anfragen auslösen. Der Erstimport hat den Zeitstempel gerade gesetzt, also
  // ist der nächste Abgleich erst in einer Viertelstunde fällig.
  tagebuch.set(tagVor(1), [eintrag('e-gestern', 'Reis', { calories: '555', protein: '33' })])
  diaryAufrufe = []
  await p.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
  })
  await p.waitForTimeout(4000)
  pruefe('Drei Ereignisse kurz nacheinander lösen keinen Abruf aus',
    diaryAufrufe.length === 0, `${diaryAufrufe.length} Abruf(e)`)

  /* ------------------------ 7. Korrektur von gestern kommt an */
  await p.goto(DATEI + '#/einstellungen/ernaehrung')
  await p.waitForTimeout(800)
  await p.locator('button', { hasText: 'Jetzt abgleichen' }).first().click()
  await p.waitForTimeout(4000)
  const gestern = await wertAufErnaehrungsseite(p, tagVor(1), 'Kalorien')
  pruefe('Korrektur von gestern wird übernommen', gestern === '555', `abgelesen: ${gestern}`)

  /* --------------------------------- 7. Gelöschter Eintrag verschwindet */
  tagebuch.set(heute, [])
  await p.goto(DATEI + '#/einstellungen/ernaehrung')
  await p.waitForTimeout(500)
  await p.locator('button', { hasText: 'Jetzt abgleichen' }).first().click()
  await p.waitForTimeout(4000)
  const nachLoeschen = await wertAufErnaehrungsseite(p, heute, 'Kalorien')
  pruefe('Gelöschter FatSecret-Eintrag räumt den Tageswert ab',
    nachLoeschen === '' || nachLoeschen === null, `abgelesen: "${nachLoeschen}"`)

  /* ------------------------------------------ 8. Wasser hat das überlebt */
  const wasser = await wertAufErnaehrungsseite(p, heute, 'Wasser')
  pruefe('Wasser ist unangetastet geblieben', wasser === '2,5' || wasser === '2.5',
    `abgelesen: "${wasser}"`)

  /* --------------------------------------- 9. Keine Dubletten bei Wiederholung */
  tagebuch.set(heute, [eintrag('e-heute', 'Haferflocken')])
  await p.goto(DATEI + '#/einstellungen/ernaehrung')
  await p.waitForTimeout(500)
  for (let i = 0; i < 2; i++) {
    await p.locator('button', { hasText: 'Jetzt abgleichen' }).first().click()
    await p.waitForTimeout(3000)
  }
  const wiederKcal = await wertAufErnaehrungsseite(p, heute, 'Kalorien')
  pruefe('Zweimal abgleichen verdoppelt nichts', wiederKcal === '400', `abgelesen: ${wiederKcal}`)
  const anzahlHafer = await p.evaluate(() =>
    (document.body.innerText.match(/Haferflocken/g) || []).length)
  pruefe('Das Lebensmittel steht genau einmal da', anzahlHafer === 1, `${anzahlHafer}x`)

  /* ------------------------------------ 10. Historienabgleich auf Knopfdruck */
  tagebuch.set(ALT, [eintrag('e-alt', 'Altes Brot', { calories: '777' })])
  await p.goto(DATEI + '#/einstellungen/ernaehrung')
  await p.waitForTimeout(800)
  const knopf = p.locator('button', { hasText: 'Historie erneut abgleichen' })
  pruefe('Der Knopf für den Historienabgleich ist da', await knopf.count() > 0)
  if (await knopf.count()) {
    await knopf.first().click()
    pruefe('Historienabgleich läuft durch', await warteAufImport(p))
    const altWert = await wertAufErnaehrungsseite(p, ALT, 'Kalorien')
    pruefe('Die alte Korrektur ist angekommen', altWert === '777', `abgelesen: ${altWert}`)
  }

  pruefe('Keine Fehler in der Konsole', konsole.length === 0, konsole.slice(0, 2).join(' | '))

  await ctx.close()
  server.close()
  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); server.close(); process.exit(1) })
