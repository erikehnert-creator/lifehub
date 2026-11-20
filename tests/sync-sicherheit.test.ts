/**
 * Der Abgleich darf keine Daten verlieren.
 *
 * ---------------------------------------------------------------------------
 * Die Anlaesse (Codex-Review vom November 2026)
 *
 *  1. pullFresh leerte den lokalen Bestand und SPEICHERTE den leeren Stand,
 *     bevor ein einziges Byte vom Server da war. Brach der Abruf ab (Funkloch,
 *     abgelaufene Anmeldung, fehlende Tabelle), blieb ein leeres Geraet zurueck
 *     - samt allen noch nicht gesendeten Aenderungen.
 *  2. Die Push-Schleife setzte jede gesendete Zeile bedingungslos auf „sauber".
 *     Wurde eine Zeile waehrend des Uploads erneut geaendert, ging die neuere
 *     Fassung still verloren; das Aenderungsjournal wurde gleich mit geleert.
 *  3. Knopf und automatischer Abgleich konnten gleichzeitig laufen.
 *
 * Die Prueffaelle laufen gegen die ECHTE lokale Datenbank (sql.js) und einen
 * kleinen Server aus dem Arbeitsspeicher, der sich auf Wunsch verschluckt.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const URL_ = 'https://test.supabase.co'
const KEY = 'anon-test'

/* ---------------------------------------------------------------- Umgebung */

const speicher = new Map<string, string>()

/** Ein Server, der alle Tabellen kennt und sich merkt, was ihm gesendet wurde. */
const server = {
  zeilen: new Map<string, Map<string, any>>(),
  rev: 0,
  posts: [] as { tabelle: string; ids: string[] }[],
  /** Wird bei jedem Abruf (GET) aufgerufen; wirft der Haken, scheitert der Abruf. */
  beiAbruf: null as null | ((tabelle: string) => void),
  /** Wird bei jedem Senden (POST) VOR der Antwort aufgerufen. */
  beiSenden: null as null | ((tabelle: string, zeilen: any[]) => void | Promise<void>),
}

function serverZuruecksetzen() {
  server.zeilen = new Map()
  server.rev = 0
  server.posts = []
  server.beiAbruf = null
  server.beiSenden = null
}

function serverZeile(tabelle: string, zeile: any) {
  let t = server.zeilen.get(tabelle)
  if (!t) { t = new Map(); server.zeilen.set(tabelle, t) }
  const bestehend = t.get(zeile.id)
  const neu = { ...bestehend, ...zeile, server_rev: ++server.rev, user_id: 'u1' }
  t.set(zeile.id, neu)
  return neu
}

async function falscherServer(input: any, init?: any): Promise<Response> {
  const adresse = String(input)
  const m = adresse.match(/\/rest\/v1\/([a-z_]+)(\?.*)?$/)
  if (!m) return new Response('nicht gefunden', { status: 404 })
  const tabelle = m[1]
  const methode = (init?.method ?? 'GET').toUpperCase()
  if (methode === 'GET') {
    server.beiAbruf?.(tabelle)
    const gt = Number(adresse.match(/server_rev=gt\.(\d+)/)?.[1] ?? 0)
    const rows = [...(server.zeilen.get(tabelle)?.values() ?? [])]
      .filter((r) => r.server_rev > gt)
      .sort((a, b) => a.server_rev - b.server_rev)
      .map((r) => ({ ...r }))
    return new Response(JSON.stringify(rows), { status: 200 })
  }
  const gesendet = JSON.parse(init.body) as any[]
  await server.beiSenden?.(tabelle, gesendet)
  server.posts.push({ tabelle, ids: gesendet.map((r) => r.id) })
  const gespeichert = gesendet.map((r) => serverZeile(tabelle, r))
  return new Response(JSON.stringify(gespeichert), { status: 201 })
}

let db: typeof import('../src/db/sqlite')
let repo: typeof import('../src/db/repo')
let engine: typeof import('../src/sync/engine')

beforeAll(async () => {
  // Die WASM-Datei einbetten, wie es die Einzeldatei-Fassung tut - so findet
  // sql.js sie auch ohne Browser.
  const require_ = createRequire(import.meta.url)
  const wasm = readFileSync(require_.resolve('sql.js/dist/sql-wasm.wasm'))
  ;(globalThis as any).__LIFEHUB_WASM__ = wasm.toString('base64')

  vi.stubGlobal('localStorage', {
    getItem: (k: string) => speicher.get(k) ?? null,
    setItem: (k: string, v: string) => { speicher.set(k, String(v)) },
    removeItem: (k: string) => { speicher.delete(k) },
  })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', falscherServer)

  db = await import('../src/db/sqlite')
  repo = await import('../src/db/repo')
  engine = await import('../src/sync/engine')
})

beforeEach(async () => {
  speicher.clear()
  speicher.set('lifehub.session', JSON.stringify({
    access_token: 't', refresh_token: 'r', email: 'e@x.de', user_id: 'u1', url: URL_,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }))
  serverZuruecksetzen()
  await db.wipeDatabase()
  db.getDb().run('PRAGMA foreign_keys = OFF;')
  db.sperrePersistenz(false)
})

const tag = (id: string) =>
  db.all<Record<string, any>>('SELECT * FROM tags WHERE id = ?', [id])[0]
const alleTags = () => db.all<Record<string, any>>('SELECT * FROM tags ORDER BY name')
const journal = () => db.all<Record<string, any>>('SELECT * FROM change_log')

/* ------------------------------------------------------------ pullFresh */

describe('pullFresh: erst ersetzen, wenn der Serverstand da ist', () => {
  it('behaelt den lokalen Bestand samt offenen Aenderungen, wenn der Abruf scheitert', async () => {
    const id = repo.insert('tags', { name: 'Nur lokal', color: null, scope: null })
    expect(tag(id)._dirty).toBe(1)
    expect(journal().length).toBeGreaterThan(0)

    // Mitten im Abruf bricht die Verbindung ab.
    server.beiAbruf = (tabelle) => { if (tabelle === 'tags') throw new TypeError('Failed to fetch') }

    const res = await engine.pullFresh(URL_, KEY)

    expect(res.ok).toBe(false)
    expect(res.message).toContain('unverändert')
    expect(tag(id)).toBeTruthy()
    expect(tag(id).name).toBe('Nur lokal')
    expect(tag(id)._dirty).toBe(1)               // noch zu senden
    expect(journal().length).toBeGreaterThan(0)  // Journal ebenfalls erhalten
  })

  it('behaelt den Bestand auch, wenn die Anmeldung abgelaufen ist', async () => {
    const id = repo.insert('tags', { name: 'Offen', color: null, scope: null })
    speicher.delete('lifehub.session')

    const res = await engine.pullFresh(URL_, KEY)

    expect(res.ok).toBe(false)
    expect(tag(id)?.name).toBe('Offen')
    expect(tag(id)._dirty).toBe(1)
  })

  it('gibt das Speichern nach einem Abbruch wieder frei', async () => {
    repo.insert('tags', { name: 'X', color: null, scope: null })
    server.beiAbruf = (tabelle) => { if (tabelle === 'tags') throw new TypeError('Failed to fetch') }
    await engine.pullFresh(URL_, KEY)

    // Ein spaeteres Speichern darf nicht mehr stillschweigend uebergangen werden.
    const gespeichert = vi.fn()
    const weg = db.onSaveStateChange((s) => { if (s === 'saved') gespeichert() })
    await db.saveNow()
    weg()
    expect(gespeichert).toHaveBeenCalled()
  })

  it('ersetzt den Bestand, wenn der Server vollstaendig liefert', async () => {
    serverZeile('tags', {
      id: 'srv-1', name: 'Vom Server', color: null, scope: null,
      created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z',
      deleted_at: null, version: 1, last_device_id: 'x',
    })
    // Lokal liegt nur der Beispielbestand eines frisch gestarteten Geraets.
    const lokal = repo.insert('tags', { name: 'Beispiel', color: null, scope: null })
    db.getDb().run('UPDATE tags SET _dirty = 0 WHERE id = ?', [lokal] as any)
    db.getDb().run('DELETE FROM change_log')

    const res = await engine.pullFresh(URL_, KEY)

    expect(res.ok).toBe(true)
    expect(alleTags().map((t) => t.name)).toEqual(['Vom Server'])
  })

  it('bricht ab, wenn der Server leer ist, dieses Geraet aber ungesendete Aenderungen hat', async () => {
    const id = repo.insert('tags', { name: 'Wertvoll', color: null, scope: null })

    const res = await engine.pullFresh(URL_, KEY)

    expect(res.ok).toBe(false)
    expect(res.message).toContain('Quelle')
    expect(tag(id)?.name).toBe('Wertvoll')
    expect(tag(id)._dirty).toBe(1)
  })
})

/* ----------------------------------------------------------------- Push */

describe('Push: nur die tatsaechlich gesendete Fassung gilt als uebertragen', () => {
  it('laesst eine Zeile vorgemerkt, die waehrend des Uploads erneut geaendert wurde', async () => {
    const id = repo.insert('tags', { name: 'Erste Fassung', color: null, scope: null })

    // Waehrend der Upload laeuft, aendert die Person die Zeile noch einmal.
    server.beiSenden = (tabelle) => {
      if (tabelle === 'tags') repo.update('tags', id, { name: 'Zweite Fassung' })
    }

    const res = await engine.runSync(URL_, KEY)
    expect(res.ok).toBe(true)

    // Gesendet wurde die erste Fassung ...
    expect(server.zeilen.get('tags')?.get(id)?.name).toBe('Erste Fassung')
    // ... die zweite wartet noch und ist samt Journal erhalten.
    // (Der Lauf selbst sendet sie in der naechsten Runde nach - siehe unten.)
    expect(tag(id).name).toBe('Zweite Fassung')
  })

  it('sendet die neuere Fassung spaetestens im naechsten Abgleich', async () => {
    const id = repo.insert('tags', { name: 'Erste Fassung', color: null, scope: null })
    let einmal = true
    server.beiSenden = (tabelle) => {
      if (tabelle === 'tags' && einmal) {
        einmal = false
        repo.update('tags', id, { name: 'Zweite Fassung' })
      }
    }

    await engine.runSync(URL_, KEY)
    await engine.runSync(URL_, KEY)

    expect(server.zeilen.get('tags')?.get(id)?.name).toBe('Zweite Fassung')
    expect(tag(id)._dirty).toBe(0)
    expect(journal().filter((j) => j.row_id === id)).toHaveLength(0)
  })

  it('behaelt das Journal einer Zeile, die noch gesendet werden muss', async () => {
    const id = repo.insert('tags', { name: 'A', color: null, scope: null })
    // Waehrend des Uploads kommt eine Aenderung der Person dazu.
    server.beiSenden = (tabelle) => {
      if (tabelle === 'tags') repo.update('tags', id, { name: 'B' })
    }

    await engine.runSync(URL_, KEY)

    // Gesendet wurde 'A'; 'B' wartet - samt Journaleintrag, damit der Hinweis
    // „n Aenderungen warten auf Uebertragung" stimmt und nichts verloren geht.
    expect(server.zeilen.get('tags')?.get(id)?.name).toBe('A')
    expect(tag(id).name).toBe('B')
    expect(tag(id)._dirty).toBe(1)
    expect(journal().filter((j) => j.row_id === id).length).toBeGreaterThan(0)
    expect(engine.pendingChangeCount()).toBeGreaterThan(0)

    // Der naechste Abgleich bringt 'B' hinueber, danach ist alles sauber.
    server.beiSenden = null
    await engine.runSync(URL_, KEY)
    expect(server.zeilen.get('tags')?.get(id)?.name).toBe('B')
    expect(tag(id)._dirty).toBe(0)
    expect(engine.pendingChangeCount()).toBe(0)
  })

  it('raeumt Journaleintraege verworfener Zeilen weiterhin auf', async () => {
    const id = repo.insert('tags', { name: 'Weg', color: null, scope: null })
    repo.hardDelete('tags', id)           // Zeile weg, Journaleintrag bleibt
    expect(journal().some((j) => j.row_id === id)).toBe(true)

    await engine.runSync(URL_, KEY)

    expect(journal().some((j) => j.row_id === id)).toBe(false)
  })
})

/* --------------------------------------------------------------- Sperre */

describe('Gemeinsame Sperre fuer manuellen und automatischen Abgleich', () => {
  it('sendet eine Zeile bei zwei gleichzeitigen Laeufen nur einmal', async () => {
    const id = repo.insert('tags', { name: 'Einmal', color: null, scope: null })

    const [a, b] = await Promise.all([
      engine.runSync(URL_, KEY),
      engine.runSync(URL_, KEY),
    ])

    expect(a.ok && b.ok).toBe(true)
    const gesendet = server.posts.filter((p) => p.tabelle === 'tags' && p.ids.includes(id))
    expect(gesendet).toHaveLength(1)
  })

  it('laesst auch pullFresh nicht mit einem laufenden Abgleich zusammenlaufen', async () => {
    repo.insert('tags', { name: 'Lokal', color: null, scope: null })
    serverZeile('tags', {
      id: 'srv-1', name: 'Vom Server', color: null, scope: null,
      created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z',
      deleted_at: null, version: 1, last_device_id: 'x',
    })

    const reihenfolge: string[] = []
    const a = engine.runSync(URL_, KEY).then(() => reihenfolge.push('abgleich'))
    const b = engine.pullFresh(URL_, KEY).then(() => reihenfolge.push('uebernahme'))
    await Promise.all([a, b])

    expect(reihenfolge).toEqual(['abgleich', 'uebernahme'])
  })
})
