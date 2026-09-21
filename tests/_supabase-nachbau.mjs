/**
 * Ein kleiner Nachbau der Supabase-Schnittstellen – für Prüfungen im Browser.
 *
 * ---------------------------------------------------------------------------
 * Warum ein Nachbau und kein echtes Postgres
 *
 * Die älteren Sync-Prüfungen sprachen mit einem echten Postgres auf
 * `127.0.0.1:5432`, Benutzer `postgres`, Passwort `test`. Das lief in der
 * Umgebung, in der sie entstanden sind – und sonst nirgends: nicht auf Eriks
 * Rechner, nicht in GitHub Actions. Sie standen deshalb jahrelang als
 * Altlasten da und prüften nichts.
 *
 * Dieser Nachbau spricht dieselbe Sprache (PostgREST plus GoTrue-Anmeldung),
 * hält die Zeilen im Arbeitsspeicher und braucht keine Installation. Die
 * Spaltentypen liest er aus `supabase/migrations/0001_init.sql` – also aus
 * derselben Datei, die Erik im SQL-Editor ausführt.
 *
 * ---------------------------------------------------------------------------
 * Was er streng nimmt
 *
 * `ganzzahlen: true` weist ab, was PostgreSQL abweist: eine Kommazahl in einer
 * `integer`-Spalte, mit demselben Code 22P02. Genau daran ist der Abgleich der
 * Tabelle `metrics` wochenlang gescheitert (siehe sync-ganzzahlen-e2e).
 *
 * `fehlerTabelle` lässt eine einzelne Tabelle beim Senden scheitern. Damit
 * lässt sich prüfen, dass EINE kaputte Tabelle nicht den ganzen Abgleich
 * mitreisst – der Fehler, an dem früher alles nach `calendar_events`
 * stillschweigend ausfiel.
 *
 * `protokoll` schaltet die Edge Function `wettkampf-import` dazu. Sie nimmt
 * die hochgeladene Datei entgegen, prüft Anmeldung und PDF-Signatur wie die
 * echte – und deutet dann den mitgegebenen Textbestand mit dem **echten**
 * Leser aus `supabase/functions/wettkampf-import/protokoll.ts`. Die
 * PDF-Textextraktion selbst steckt nicht darin; die prüft
 * `tests/protokoll-integration.mjs` örtlich gegen das echte Protokoll.
 *
 * Es ist bewusst kein vollständiger PostgREST: Nur, was die App wirklich
 * aufruft, und nur so streng, wie es einen bekannten Fehler nachstellt.
 */
import fs from 'node:fs'
import http from 'node:http'
import { parseProtokoll, ProtokollFehler } from '../supabase/functions/wettkampf-import/protokoll.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export const ANON = 'anon-test-key'
export const MAIL = 'erik@test.de'
export const PASS = 'geheim123'

/* ------------------------------------------- Spaltentypen aus dem Schema */

/**
 * Die ganzzahligen Spalten je Tabelle, gelesen aus 0001_init.sql.
 * Gleiche Deutung wie in tests/schema-parity.test.ts.
 */
export function ganzzahlSpalten() {
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

/* ------------------------------------------------------------ Der Server */

/**
 * Startet den Nachbau. Liefert Adresse, Ablage und ein `stop()`.
 *
 * @param {object} opts
 * @param {number} [opts.port]           Port (Standard 54399)
 * @param {boolean} [opts.ganzzahlen]    Kommazahlen in INTEGER-Spalten abweisen
 * @param {string|null} [opts.fehlerTabelle] Diese eine Tabelle beim Senden
 *                                       scheitern lassen (503), als stünde
 *                                       dort eine Spalte nicht zur Verfügung.
 */
export async function starteNachbau(opts = {}) {
  const port = opts.port ?? 54399
  const strengeZahlen = opts.ganzzahlen ?? false
  let fehlerTabelle = opts.fehlerTabelle ?? null
  // Textstuecke, die die Importfunktion deuten soll - oder ein Fehlercode,
  // den sie stattdessen zurueckgeben soll.
  const protokollSeiten = opts.protokoll ?? null
  /* Tabellen, die dieser Server NICHT kennt - so, wie ein Supabase-Projekt
     antwortet, auf dem die aktuelle Migration noch nicht gelaufen ist.
     PostgREST meldet das als 404 mit dem Code PGRST205. */
  let fehlendeTabellen = new Set(opts.fehlendeTabellen ?? [])
  let protokollFehler = opts.protokollFehler ?? null
  const hochgeladen = []

  const INT = strengeZahlen ? ganzzahlSpalten() : new Map()
  const tabellen = new Map()      // tabelle -> Map(id -> zeile)
  const abgelehnt = []            // was der Server zurückgewiesen hat
  let rev = 0

  const pruefeGanzzahlen = (tabelle, zeile) => {
    for (const spalte of INT.get(tabelle) ?? []) {
      const v = zeile[spalte]
      if (v === null || v === undefined || v === '') continue
      const n = Number(v)
      if (Number.isFinite(n) && !Number.isInteger(n)) {
        return { code: '22P02', message: `invalid input syntax for type integer: "${v}"`, spalte }
      }
    }
    return null
  }

  const antwort = (res, status, body) => {
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
      let body = ''
      req.on('data', (c) => { body += c })
      return req.on('end', () => antwort(res, 200, {
        access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600,
        token_type: 'bearer', user: { id: '11111111-1111-1111-1111-111111111111', email: MAIL },
      }))
    }

    if (pfad === '/functions/v1/wettkampf-import') {
      // Die echte Funktion laeuft mit JWT-Pruefung: ohne Anmeldetoken kommt
      // die Anfrage dort gar nicht erst an.
      if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) {
        return antwort(res, 401, { ok: false, code: 'nicht_angemeldet', message: 'Kein Anmeldetoken.' })
      }
      const teile = []
      req.on('data', (c) => teile.push(c))
      return req.on('end', () => {
        const roh = Buffer.concat(teile)
        hochgeladen.push(roh.length)
        if (protokollFehler) {
          return antwort(res, 422, { ok: false, ...protokollFehler })
        }
        // Die PDF-Signatur steckt irgendwo im Formularrumpf.
        if (!roh.includes(Buffer.from('%PDF-'))) {
          return antwort(res, 415, { ok: false, code: 'keine_pdf', message: 'Das ist keine PDF-Datei.' })
        }
        if (!protokollSeiten) {
          return antwort(res, 422, {
            ok: false, code: 'keine_textebene',
            message: 'Diese PDF enthält keinen lesbaren Text. Gescannte Protokolle kann LifeHub nicht lesen.',
          })
        }
        try {
          const ergebnis = parseProtokoll(protokollSeiten)
          return antwort(res, 200, { ok: true, ...ergebnis, dauer: { extrahiert: 0, geparst: 0, gesamt: 0 } })
        } catch (e) {
          if (e instanceof ProtokollFehler) {
            return antwort(res, 422, { ok: false, code: e.code, message: e.message })
          }
          return antwort(res, 500, { ok: false, code: 'unerwartet', message: 'Fehler.' })
        }
      })
    }

    const m = pfad.match(/^\/rest\/v1\/(\w+)$/)
    if (!m) return antwort(res, 404, { message: 'nicht gefunden' })
    const tabelle = m[1]
    if (fehlendeTabellen.has(tabelle)) {
      return antwort(res, 404, {
        code: 'PGRST205',
        message: `Could not find the table 'public.${tabelle}' in the schema cache`,
      })
    }
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
        // Eine bewusst kaputte Tabelle – so, wie calendar_events es einmal war.
        if (fehlerTabelle && tabelle === fehlerTabelle) {
          abgelehnt.push(`${tabelle}.(absichtlich)`)
          return antwort(res, 400, {
            code: '42703', message: `column "${tabelle}.absichtlich_kaputt" does not exist`,
          })
        }
        let zeilen
        try { zeilen = JSON.parse(body) } catch { return antwort(res, 400, { message: 'kaputtes JSON' }) }

        // PostgreSQL prüft die ganze Sendung, bevor es irgendetwas schreibt.
        for (const z of zeilen) {
          const schlecht = pruefeGanzzahlen(tabelle, z)
          if (schlecht) {
            abgelehnt.push(`${tabelle}.${schlecht.spalte}`)
            return antwort(res, 400, { code: schlecht.code, message: schlecht.message })
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

  await new Promise((r) => server.listen(port, '127.0.0.1', r))

  return {
    url: `http://127.0.0.1:${port}`,
    tabellen,
    abgelehnt,
    /** Zeilen einer Tabelle, ohne die gelöschten. */
    zeilen: (tabelle) => [...(tabellen.get(tabelle)?.values() ?? [])].filter((z) => !z.deleted_at),
    /** Alle Zeilen einer Tabelle, auch die gelöschten. */
    alleZeilen: (tabelle) => [...(tabellen.get(tabelle)?.values() ?? [])],
    /** Die kaputte Tabelle im laufenden Betrieb setzen oder heilen. */
    setzeFehlerTabelle: (t) => { fehlerTabelle = t },
    /** Wie oft und mit wie vielen Bytes der Import angesprochen wurde. */
    hochgeladen,
    /** Den Importer im laufenden Betrieb scheitern lassen – oder wieder nicht. */
    setzeProtokollFehler: (f) => { protokollFehler = f },
    /** Tabellen im laufenden Betrieb verschwinden lassen – oder zurückholen. */
    setzeFehlendeTabellen: (liste) => { fehlendeTabellen = new Set(liste ?? []) },
    stop: () => new Promise((r) => server.close(r)),
  }
}
