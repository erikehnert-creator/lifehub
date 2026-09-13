/**
 * Der Fehler „metrics: 400 / 22P02", einmal vollständig nachgestellt.
 *
 * Die Unit-Tests prüfen die Teile: den Seed-Wert, Migration 9, das Erkennen
 * beim Senden. Was sie NICHT prüfen können, ist der Weg, auf dem Erik den
 * Fehler tatsächlich gesehen hat – eine bestehende Datenbank auf dem Gerät,
 * ein Server, der Ganzzahlen ernst nimmt, und ein Abgleich dazwischen.
 *
 * Ablauf:
 *   1. ALTE Fassung (aus Git) in einem dauerhaften Browserprofil öffnen.
 *      Sie legt Ballaststoffe mit Sortierwert 23.5 an – so, wie es auf Eriks
 *      Geräten steht.
 *   2. Abgleich gegen den strengen Server: metrics MUSS scheitern. Ohne diesen
 *      Schritt wüsste man nicht, ob der Nachbau streng genug ist, und der
 *      Test wäre grün, ohne je etwas bewiesen zu haben.
 *   3. NEUE Fassung auf demselben Profil: Migration 9 läuft.
 *   4. Abgleich erneut: jetzt muss er durchgehen, der Server die Zeile haben,
 *      der Sortierwert ganzzahlig sein, nichts doppelt und nichts verloren.
 *
 * Der Server ist bewusst ein eigener, kleiner Nachbau statt eines echten
 * Postgres: Die Typen liest er aus `supabase/migrations/0001_init.sql` – also
 * aus derselben Datei, die Erik im SQL-Editor ausführt – und weist genau das
 * zurück, was PostgreSQL zurückweist, mit demselben Code 22P02. Damit läuft
 * die Prüfung überall, auch in GitHub Actions, ohne Datenbankinstallation.
 *
 * Aufruf:  node tests/sync-ganzzahlen-e2e.mjs
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const datei = (p) => 'file:///' + p.split(path.sep).join('/')
const PORT = 54399
const SUPA = `http://127.0.0.1:${PORT}`
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
  else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehler++ }
}

/* ------------------------------------------- Spaltentypen aus dem Schema */

/**
 * Die ganzzahligen Spalten je Tabelle, gelesen aus 0001_init.sql.
 * Gleiche Deutung wie in tests/schema-parity.test.ts – hier reicht uns, welche
 * Spalten `integer`/`bigint`/`smallint` sind.
 */
function ganzzahlSpalten() {
  const text = fs.readFileSync(path.join(WURZEL, 'supabase/migrations/0001_init.sql'), 'utf8')
    .split(/\r?\n/).map((z) => z.replace(/--.*$/, '')).join('\n')

  const out = new Map()
  const merke = (tab, sp, typ) => {
    if (!/^(integer|bigint|smallint)$/i.test(typ.trim())) return
    if (!out.has(tab)) out.set(tab, new Set())
    out.get(tab).add(sp)
  }
  const typVon = (rest) => {
    const w = []
    for (const t of rest.trim().split(/\s+/)) {
      if (/^(NOT|NULL|DEFAULT|PRIMARY|REFERENCES|UNIQUE|CHECK|GENERATED|COLLATE|CONSTRAINT)$/i.test(t)) break
      w.push(t)
    }
    return w.join(' ').replace(/\(.*$/, '')
  }

  const kopf = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/gi
  for (let m = kopf.exec(text); m; m = kopf.exec(text)) {
    const von = m.index + m[0].length
    let tiefe = 1, i = von
    for (; i < text.length && tiefe > 0; i++) {
      if (text[i] === '(') tiefe++
      else if (text[i] === ')') tiefe--
    }
    const teile = []
    let stueck = '', t = 0
    for (const c of text.slice(von, i - 1)) {
      if (c === '(') t++
      else if (c === ')') t--
      if (c === ',' && t === 0) { teile.push(stueck); stueck = '' } else stueck += c
    }
    teile.push(stueck)
    for (const teil of teile) {
      const w = teil.trim().match(/^(\w+)\b/)
      if (!w || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)$/i.test(w[1])) continue
      merke(m[1], w[1], typVon(teil.trim().slice(w[1].length)))
    }
  }
  const nach = /ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)([^;]*);/gi
  for (let m = nach.exec(text); m; m = nach.exec(text)) merke(m[1], m[2], typVon(m[3]))
  return out
}

/* --------------------------------------------- Der strenge Server-Nachbau */

const INT = ganzzahlSpalten()
const tabellen = new Map()      // tabelle -> Map(id -> zeile)
let rev = 0
const abgelehnt = []            // was der Server zurückgewiesen hat

function pruefeGanzzahlen(tabelle, zeile) {
  for (const spalte of INT.get(tabelle) ?? []) {
    const v = zeile[spalte]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n) && !Number.isInteger(n)) {
      return { code: '22P02', message: `invalid input syntax for type integer: "${v}"` }
    }
  }
  return null
}

function antwort(res, status, body) {
  const text = body === null ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  })
  res.end(text)
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return antwort(res, 204, null)
  const [pfad, query] = req.url.split('?')

  if (pfad.startsWith('/auth/v1/token')) {
    let body = ''
    req.on('data', (c) => { body += c })
    return req.on('end', () => antwort(res, 200, {
      access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600,
      token_type: 'bearer', user: { id: '11111111-1111-1111-1111-111111111111', email: MAIL },
    }))
  }

  const m = pfad.match(/^\/rest\/v1\/(\w+)$/)
  if (!m) return antwort(res, 404, { message: 'nicht gefunden' })
  const tabelle = m[1]
  if (!tabellen.has(tabelle)) tabellen.set(tabelle, new Map())
  const store = tabellen.get(tabelle)

  if (req.method === 'GET') {
    const ab = Number((query ?? '').match(/server_rev=gt\.(\d+)/)?.[1] ?? 0)
    const zeilen = [...store.values()]
      .filter((z) => Number(z.server_rev) > ab)
      .sort((a, b) => a.server_rev - b.server_rev)
    return antwort(res, 200, zeilen)
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    return req.on('end', () => {
      let zeilen
      try { zeilen = JSON.parse(body) } catch { return antwort(res, 400, { message: 'kaputtes JSON' }) }

      // PostgreSQL prüft die ganze Sendung, bevor es irgendetwas schreibt.
      for (const z of zeilen) {
        const schlecht = pruefeGanzzahlen(tabelle, z)
        if (schlecht) {
          abgelehnt.push(`${tabelle}.${Object.keys(z).find((k) => (INT.get(tabelle) ?? new Set()).has(k)
            && !Number.isInteger(Number(z[k])) && z[k] !== null)}`)
          return antwort(res, 400, schlecht)
        }
      }
      const raus = []
      for (const z of zeilen) {
        const gespeichert = { ...z, server_rev: ++rev }
        store.set(z.id, gespeichert)
        raus.push(gespeichert)
      }
      return antwort(res, 200, raus)
    })
  }
  return antwort(res, 405, { message: 'nicht erlaubt' })
})

/* ---------------------------------------------------- Ablauf im Browser */

async function warteAufApp(p, ms = 60000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(300)
  }
  return false
}

const geh = async (p, url, hash) => { await p.goto(url + '#' + hash); await p.waitForTimeout(1500) }

async function anmelden(p, url) {
  await geh(p, url, '/einstellungen/sync')
  // Ist ein Server fest eingebaut (src/sync/config.ts), liegen die Felder für
  // eine andere Verbindung hinter einem Aufklapper. Ohne diesen Klick findet
  // der Test das Eingabefeld nicht und liefe in eine Zeitüberschreitung.
  const aufklapper = p.locator('text=Andere Server-Verbindung nutzen')
  if (await aufklapper.count()) { await aufklapper.first().click(); await p.waitForTimeout(500) }

  const feld = p.locator('input[placeholder*="supabase.co"]')
  await feld.fill(SUPA); await feld.blur(); await p.waitForTimeout(400)
  const felder = p.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(ANON); await felder.nth(1).blur(); await p.waitForTimeout(600)
  await p.locator('input[type=email]').fill(MAIL)
  await p.locator('input[type=password]').fill(PASS)
  await p.locator('button', { hasText: 'Anmelden' }).click()
  await p.waitForTimeout(3000)
  return (await p.innerText('#root')).includes('angemeldet als')
}

async function abgleich(p, url) {
  await geh(p, url, '/einstellungen/sync')
  const erst = p.locator('button', { hasText: 'Diesen Bestand auf den Server laden' })
  if (await erst.count()) {
    await erst.click(); await p.waitForTimeout(800)
    await p.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
  } else {
    await p.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
  }
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000)
    const t = await p.innerText('#root')
    const m = t.match(/(Synchronisiert:[^\n]*|Teilweise synchronisiert[^\n]*|Auf den Server geladen:[^\n]*|Synchronisation fehlgeschlagen:[^\n]*)/)
    if (m) return m[1]
  }
  return '(keine Rückmeldung)'
}

/** Die Fassung vor Migration 9 – gesucht wie in migration-e2e.mjs. */
function basisFassung() {
  if (process.env.LIFEHUB_MIGRATION_BASIS) return process.env.LIFEHUB_MIGRATION_BASIS.trim()
  const hoechste = (t) => {
    const tr = [...t.matchAll(/^\s*id:\s*(\d+),\s*$/gm)].map((x) => Number(x[1]))
    return tr.length ? Math.max(...tr) : 0
  }
  const jetzt = hoechste(fs.readFileSync(path.join(WURZEL, 'src/db/schema.ts'), 'utf8'))
  const commits = execSync('git log --format=%H -- src/db/schema.ts', { cwd: WURZEL })
    .toString().trim().split(String.fromCharCode(10)).filter(Boolean)
  for (const c of commits) {
    let schema
    try {
      schema = execSync(`git show ${c}:src/db/schema.ts`, { cwd: WURZEL, maxBuffer: 16 * 1024 * 1024 }).toString()
    } catch { continue }
    if (hoechste(schema) >= jetzt) continue
    try { execSync(`git cat-file -e ${c}:LifeHub.html`, { cwd: WURZEL }); return c } catch { /* weiter */ }
  }
  throw new Error('Keine Fassung mit einer niedrigeren Migration gefunden.')
}

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-sync-'))
  const alt = path.join(tmp, 'LifeHub-alt.html')
  const profil = path.join(tmp, 'profil')
  const vorher = basisFassung()
  fs.writeFileSync(alt, execSync(`git show ${vorher}:LifeHub.html`, {
    cwd: WURZEL, maxBuffer: 64 * 1024 * 1024,
  }))
  const neu = path.join(WURZEL, 'LifeHub.html')

  console.log(`\n=== Abgleich über die Migration hinweg (${vorher.slice(0, 7)} → HEAD) ===\n`)
  console.log(`  strenger Server auf ${SUPA}, Typen aus 0001_init.sql`)
  console.log(`  ganzzahlige Spalten in metrics: ${[...(INT.get('metrics') ?? [])].join(', ')}\n`)

  /* ------------------------------------------- 1. Alte Fassung, alter Wert */
  let ctx = await chromium.launchPersistentContext(profil, { viewport: { width: 1280, height: 900 } })
  let p = ctx.pages()[0] ?? await ctx.newPage()
  await p.goto(datei(alt))
  pruefe('Alte Fassung startet', await warteAufApp(p))

  pruefe('Anmeldung am Testserver', await anmelden(p, datei(alt)))
  const meldung1 = await abgleich(p, datei(alt))
  pruefe('Der strenge Server weist metrics zurück',
    /metrics/.test(meldung1) && /400|22P02/.test(meldung1), meldung1.slice(0, 150))
  pruefe('Andere Tabellen kamen trotzdem an', tabellen.size > 3, `${tabellen.size} Tabellen`)
  pruefe('metrics liegt nicht auf dem Server', !(tabellen.get('metrics')?.size))
  await ctx.close()

  /* ----------------------------------------- 2. Neue Fassung, selbe Daten */
  ctx = await chromium.launchPersistentContext(profil, { viewport: { width: 1280, height: 900 } })
  p = ctx.pages()[0] ?? await ctx.newPage()
  const konsole = []
  p.on('pageerror', (e) => konsole.push(String(e)))
  await p.goto(datei(neu))
  pruefe('Neue Fassung startet auf derselben Datenbank', await warteAufApp(p))
  await p.waitForTimeout(2500)

  // Ab hier darf der Server nichts mehr zurückweisen. Der Zählerstand von
  // vorher ist der Vergleichspunkt – ohne ihn wüsste man nur, DASS abgelehnt
  // wurde, nicht ob es vor oder nach der Migration war.
  const ablehnungenVorher = abgelehnt.length

  const meldung2 = await abgleich(p, datei(neu))
  pruefe('Der Abgleich läuft jetzt durch',
    /^Synchronisiert:|^Auf den Server geladen:/.test(meldung2), meldung2.slice(0, 150))
  pruefe('Keine Tabelle mehr als fehlgeschlagen gemeldet', !/Fehlgeschlagen/.test(meldung2))

  const serverMetrics = tabellen.get('metrics')
  pruefe('metrics ist jetzt auf dem Server angekommen', (serverMetrics?.size ?? 0) > 0,
    `${serverMetrics?.size ?? 0} Zeilen`)

  const fiber = [...(serverMetrics?.values() ?? [])].filter((z) => z.key === 'fiber_g')
  pruefe('Ballaststoffe genau einmal auf dem Server – keine Dublette', fiber.length === 1,
    `${fiber.length} Zeile(n)`)
  pruefe('Der Sortierwert auf dem Server ist ganzzahlig',
    fiber.length === 1 && Number.isInteger(Number(fiber[0].sort_order)),
    fiber.length ? String(fiber[0].sort_order) : '—')

  pruefe('Der Server hat vor der Migration überhaupt abgelehnt', ablehnungenVorher > 0,
    `${ablehnungenVorher} Ablehnung(en) in Schritt 1`)
  pruefe('Nach der Migration lehnt der Server nichts mehr ab',
    abgelehnt.length === ablehnungenVorher,
    `${abgelehnt.length - ablehnungenVorher} neue Ablehnung(en)`)

  const wartend = await p.evaluate(() => {
    const t = document.body.innerText
    const m = t.match(/Wartende Änderungen\s*(\d+)/)
    return m ? Number(m[1]) : -1
  })
  pruefe('Kein Eintrag bleibt in der Outbox hängen', wartend === 0, `Wartende Änderungen: ${wartend}`)

  // Zweiter Abgleich direkt hinterher: nichts Neues, nichts doppelt.
  const vorherZahl = serverMetrics?.size ?? 0
  const meldung3 = await abgleich(p, datei(neu))
  pruefe('Ein zweiter Abgleich läuft ebenfalls durch', /^Synchronisiert:/.test(meldung3),
    meldung3.slice(0, 120))
  pruefe('und legt auf dem Server nichts doppelt an',
    (tabellen.get('metrics')?.size ?? 0) === vorherZahl,
    `${tabellen.get('metrics')?.size} statt ${vorherZahl}`)

  pruefe('Keine Fehler in der Konsole', konsole.length === 0, konsole.slice(0, 2).join(' | '))

  await ctx.close()
  server.close()

  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); server.close(); process.exit(1) })
