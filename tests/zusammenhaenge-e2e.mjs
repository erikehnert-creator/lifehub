/**
 * Zeitversetzte Zusammenhänge – im Browser, mit einem eingebauten Muster.
 *
 * Die Unit-Tests prüfen das Rechnen. Was sie nicht können: ob LifeHub den
 * Zusammenhang auch findet, wenn die Daten auf dem üblichen Weg hereinkommen –
 * über den Abgleich, verteilt auf zwei Metriken, mit Lücken.
 *
 * Eingebaut wird ein Muster, das es in Wirklichkeit so eindeutig nie gibt:
 * Zucker steuert den Hautwert mit ZWEI Tagen Versatz. Wenn die Auswertung
 * taugt, muss sie
 *
 *   - den Zusammenhang überhaupt finden,
 *   - ihn bei 2 Tagen Versatz am stärksten sehen (nicht bei 0),
 *   - ihn als „schlechter" beschreiben (mehr Zucker, niedrigerer Hautwert),
 *   - und die Datenbasis nennen.
 *
 * Und der Gegentest, der wichtiger ist: Dieselbe Seite darf bei reinem
 * Rauschen NICHTS behaupten.
 *
 * Aufruf:  node tests/zusammenhaenge-e2e.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, process.env.LIFEHUB_HTML ?? 'LifeHub.html').split(path.sep).join('/')
const PORT = 54409
const SUPA = `http://127.0.0.1:${PORT}`
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'
const TAGE = 120

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
  else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehler++ }
}

/**
 * Der heutige Tag in ORTSZEIT – so, wie die App ihn sieht.
 *
 * `new Date().toISOString()` liefert das Datum in UTC. Östlich von Greenwich
 * ist das zwischen 22 Uhr und Mitternacht noch der Vortag: Der Test legte sein
 * Tagebuch dann auf den 14., während LifeHub den 15. anzeigte – und der Test
 * meldete, es käme nichts an. Ein Fehler, der nur abends auftritt und tagsüber
 * nicht nachzustellen ist.
 */
const ortsdatum = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const heute = ortsdatum()
const tagVor = (n) => new Date(Date.parse(heute + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10)

/** Deterministischer Zufall – ein Test, der mal durchläuft und mal nicht, taugt nichts. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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
  // FatSecret ist hier nicht verbunden – die Werte kommen von Hand.
  if (/^\/functions\/v1\/fatsecret/.test(pfad)) {
    let body = ''
    req.on('data', (c) => { body += c })
    return req.on('end', () => antwort(res, 200, { connected: false }))
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

/**
 * Zu einer Seite gehen – und warten, bis sie WIRKLICH da ist.
 *
 * `goto` auf eine Datei-Adresse lädt die ganze App neu; sie ist danach nicht
 * sofort fertig, sondern erst, wenn Datenbank, Migrationen und Seed durch
 * sind. Eine feste Wartezeit ist dafür der falsche Maßstab: Sie ist auf einer
 * leeren Datenbank zu lang und auf einer vollen zu kurz – und dann liest der
 * Test leere Felder ab und meldet einen Fehler, den es nicht gibt. Genau das
 * ist hier passiert, als die Seite um ein paar Elemente wuchs.
 */
const geh = async (p, hash) => {
  await p.goto(DATEI + '#' + hash)
  const bis = Date.now() + 60000
  while (Date.now() < bis) {
    if (await p.$('.page')) break
    await p.waitForTimeout(60)
  }
  await p.waitForTimeout(700)
}

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

  const knopf = p.locator('button', { hasText: 'Diesen Bestand auf den Server laden' })
  if (await knopf.count()) {
    await knopf.first().click()
    await p.waitForTimeout(500)
    await p.locator('button', { hasText: 'Auf den Server laden' }).last().click()
    await p.waitForTimeout(5000)
  }
}

async function abgleichen(p) {
  await geh(p, '/einstellungen/sync')
  const knopf = p.locator('button', { hasText: 'Jetzt synchronisieren' })
  if (await knopf.count()) { await knopf.first().click(); await p.waitForTimeout(6000) }
}

/**
 * Tageswerte auf den Server legen – so, wie sie von einem anderen Gerät kämen.
 * `werte` ist eine Funktion (tagIndex) → Zahl oder null.
 */
function werteEinspielen(metrikKey, werte) {
  const metriken = tabelle('metrics')
  const metrik = [...metriken.values()].find((x) => x.key === metrikKey)
  if (!metrik) return 0
  const eintraege = tabelle('metric_entries')
  let n = 0
  for (let i = 0; i < TAGE; i++) {
    const wert = werte(i)
    if (wert === null) continue
    const tag = tagVor(TAGE - 1 - i)
    const id = `pruef-${metrikKey}-${tag}`
    eintraege.set(id, {
      id, metric_id: metrik.id, day: tag, at_time: null, value_num: wert,
      value_text: null, note: null, source: 'manual', import_batch_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      deleted_at: null, version: 1, last_device_id: 'pruef', server_rev: ++rev,
    })
    n++
  }
  return n
}

async function seitenText(p) {
  await geh(p, '/analysen/zusammenhaenge')
  await p.waitForTimeout(1600)
  return await p.evaluate(() => document.body.innerText)
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-zushang-'))
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profil'), {
    viewport: { width: 1400, height: 1000 },
  })
  const p = ctx.pages()[0] ?? await ctx.newPage()
  const konsole = []
  p.on('pageerror', (e) => konsole.push(String(e)))

  console.log('\n=== Zeitversetzte Zusammenhänge ===\n')
  await p.goto(DATEI)
  pruefe('App startet', await warteAufApp(p))
  await p.waitForTimeout(2000)
  await anmelden(p)

  /* ----------------------------------------------- 1. Reines Rauschen */
  // Zuerst der Gegentest. Wenn die Seite HIER schon etwas behauptet, ist alles
  // Weitere wertlos.
  const rauschen = mulberry32(4711)
  werteEinspielen('sugar_g', () => Math.round(rauschen() * 120))
  werteEinspielen('skin', () => 1 + Math.round(rauschen() * 9))
  await abgleichen(p)
  const beiRauschen = await seitenText(p)
  pruefe('Bei reinem Rauschen wird nichts behauptet',
    /Nichts, was sich belastbar nennen ließe/.test(beiRauschen))
  pruefe('und es steht dabei, dass geprüft wurde',
    /geprüft/i.test(beiRauschen))

  /* ------------------------------------- 2. Ein eingebautes Muster, Versatz 2 */
  const zufall = mulberry32(99)
  const zucker = []
  for (let i = 0; i < TAGE; i++) zucker.push(20 + Math.round(zufall() * 90))
  // Der Hautwert folgt dem Zucker von vorgestern – plus ordentlich Rauschen,
  // damit es kein Laborfall wird.
  werteEinspielen('sugar_g', (i) => zucker[i])
  const geschrieben = werteEinspielen('skin', (i) => {
    if (i < 2) return null
    const roh = 10 - zucker[i - 2] / 14 + (zufall() - 0.5) * 2.5
    return Math.max(1, Math.min(10, Math.round(roh)))
  })
  pruefe('Hautwerte eingespielt', geschrieben > 100, `${geschrieben} Tage`)

  await abgleichen(p)
  const text = await seitenText(p)

  pruefe('Der Zusammenhang wird gefunden',
    /Zucker/.test(text) && /Hautstatus/.test(text))
  pruefe('und zwar mit zwei Tagen Versatz', /2 Tage später/.test(text),
    (text.match(/(am selben Tag|am Tag darauf|\d+ Tage später)/g) || []).join(' | '))
  pruefe('Die Richtung stimmt: mehr Zucker, schlechterer Hautwert',
    /durchschnittlich schlechter/.test(text))
  pruefe('Die Datenbasis steht dabei', /Datenbasis: \d+ Tage/.test(text),
    (text.match(/Datenbasis: \d+ Tage/) || [''])[0])
  pruefe('Die Irrtumswahrscheinlichkeit steht dabei',
    /Irrtumswahrscheinlichkeit/.test(text))
  // Gezielt die ERZEUGTEN Saetze, nicht die ganze Seite: Im Warnhinweis
  // darueber steht „ob einer den anderen verursacht" - das Wort gehoert dort
  // hin, es verneint ja gerade. Eine Suche ueber die ganze Seite wuerde das
  // als Verstoss melden und waere damit nutzlos.
  const saetze = await p.evaluate(() =>
    [...document.querySelectorAll('.befund-satz')].map((e) => e.textContent ?? ''))
  pruefe('Es wird keine Ursache behauptet',
    saetze.length > 0 && !saetze.some((s) => /verursacht|führt zu|bewirkt|wegen/i.test(s)),
    saetze[0] ?? '(kein Befund)')

  await p.screenshot({ path: path.join(WURZEL, 'tests', 'zusammenhaenge.png'), fullPage: false })
  pruefe('Keine Fehler in der Konsole', konsole.length === 0, konsole.slice(0, 2).join(' | '))

  await ctx.close()
  server.close()
  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); server.close(); process.exit(1) })
