/**
 * Abgleich, Teil 2: Konto, Geraeteeinstellungen, Zusammenfuehrung, Pull-Cursor.
 *
 *  1. Ein Geraet darf nach einem Konto- oder Serverwechsel nichts mehr in das
 *     neue Konto schicken (und nichts vom neuen Konto in den alten Bestand).
 *  2. PIN-Pruefsumme, Salt, Sperrzeit und Serveradresse gehoeren zum Geraet und
 *     laufen weder hin noch her.
 *  3. Aenderungen an VERSCHIEDENEN Feldern derselben Zeile gehen nicht verloren.
 *  4. Eine spaeter festgeschriebene Serverzeile mit kleinerer Nummer, als der
 *     Cursor schon steht, wird trotzdem noch geholt.
 *
 * Gleiche Pruefumgebung wie sync-sicherheit.test.ts: echte lokale Datenbank
 * (sql.js), Server aus dem Arbeitsspeicher.
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

const einstellung = (k: string) =>
  db.all<Record<string, any>>('SELECT * FROM settings WHERE key = ?', [k])[0]

function neueZeile(id: string, name: string, extra: Record<string, any> = {}) {
  return {
    id, name, color: null, scope: null,
    created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z',
    deleted_at: null, version: 1, last_device_id: 'x', ...extra,
  }
}

/* --------------------------------------------------------------- Konto */

describe('Konto- und Serverwechsel', () => {
  it('sendet nach einem Kontowechsel nichts in das neue Konto', async () => {
    const id = repo.insert('tags', { name: 'Gehoert Konto 1', color: null, scope: null })
    const erster = await engine.runSync(URL_, KEY)
    expect(erster.ok).toBe(true)

    // Jemand meldet sich auf diesem Geraet mit einem anderen Konto an.
    speicher.set('lifehub.session', JSON.stringify({
      access_token: 't2', refresh_token: 'r2', email: 'anderer@x.de', user_id: 'u2', url: URL_,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }))
    const neu = repo.insert('tags', { name: 'Noch offen', color: null, scope: null })
    server.posts = []

    const res = await engine.runSync(URL_, KEY)

    expect(res.ok).toBe(false)
    expect(res.message).toContain('anderen Konto')
    expect(server.posts).toHaveLength(0)
    expect(tag(neu)._dirty).toBe(1)             // nichts verworfen
    expect(tag(id)).toBeTruthy()
  })

  it('verweigert auch den Wechsel auf einen anderen Server', async () => {
    repo.insert('tags', { name: 'A', color: null, scope: null })
    await engine.runSync(URL_, KEY)
    repo.insert('tags', { name: 'B', color: null, scope: null })
    server.posts = []

    const res = await engine.runSync('https://anderes.supabase.co', KEY)

    expect(res.ok).toBe(false)
    expect(server.posts).toHaveLength(0)
  })

  it('arbeitet mit dem urspruenglichen Konto normal weiter', async () => {
    repo.insert('tags', { name: 'A', color: null, scope: null })
    await engine.runSync(URL_, KEY)
    const id = repo.insert('tags', { name: 'B', color: null, scope: null })
    const res = await engine.runSync(URL_, KEY)
    expect(res.ok).toBe(true)
    expect(server.zeilen.get('tags')?.get(id)?.name).toBe('B')
  })

  it('uebernimmt mit „Vom Server uebernehmen" das neue Konto als Besitzer', async () => {
    repo.insert('tags', { name: 'Altes Konto', color: null, scope: null })
    await engine.runSync(URL_, KEY)
    speicher.set('lifehub.session', JSON.stringify({
      access_token: 't2', refresh_token: 'r2', email: 'anderer@x.de', user_id: 'u2', url: URL_,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }))
    serverZeile('tags', neueZeile('srv-2', 'Konto 2'))

    const fresh = await engine.pullFresh(URL_, KEY)
    expect(fresh.ok).toBe(true)
    // Ab jetzt gehoert das Geraet zum neuen Konto und gleicht wieder ab.
    const res = await engine.runSync(URL_, KEY)
    expect(res.ok).toBe(true)
  })
})

/* ------------------------------------------------- Geraeteeinstellungen */

describe('Geraetegebundene Einstellungen bleiben auf dem Geraet', () => {
  it('sendet PIN-Pruefsumme, Salt, Sperrzeit und Serveradresse nie', async () => {
    for (const k of ['pin_hash', 'pin_salt', 'lock_after_minutes', 'sync_url', 'sync_key']) {
      repo.upsertByKey('settings', 'key', k, { value_json: JSON.stringify('geheim-' + k) })
    }
    repo.upsertByKey('settings', 'key', 'theme', { value_json: JSON.stringify('dunkel') })

    const res = await engine.runSync(URL_, KEY)
    expect(res.ok).toBe(true)

    const aufServer = [...(server.zeilen.get('settings')?.values() ?? [])].map((r) => r.key)
    expect(aufServer).toEqual(['theme'])
    // Und sie gelten nicht als „wartet noch".
    expect(einstellung('pin_hash')._dirty).toBe(0)
  })

  it('uebernimmt keine PIN-Pruefsumme vom Server (Altbestand)', async () => {
    repo.upsertByKey('settings', 'key', 'pin_hash', { value_json: JSON.stringify('meine-pin') })
    // Aus einer fruehen Fassung liegt noch eine Zeile auf dem Server.
    serverZeile('settings', neueZeile('s-alt', 'x', {
      key: 'pin_hash', value_json: JSON.stringify('fremde-pin'),
    }) as any)
    delete (server.zeilen.get('settings')!.get('s-alt') as any).name
    serverZeile('settings', neueZeile('s-neu', 'x', {
      key: 'theme', value_json: JSON.stringify('hell'),
    }) as any)
    delete (server.zeilen.get('settings')!.get('s-neu') as any).name
    delete (server.zeilen.get('settings')!.get('s-neu') as any).color
    delete (server.zeilen.get('settings')!.get('s-neu') as any).scope
    delete (server.zeilen.get('settings')!.get('s-alt') as any).color
    delete (server.zeilen.get('settings')!.get('s-alt') as any).scope

    const res = await engine.runSync(URL_, KEY)
    expect(res.ok).toBe(true)

    expect(JSON.parse(einstellung('pin_hash').value_json)).toBe('meine-pin')
    expect(JSON.parse(einstellung('theme').value_json)).toBe('hell')   // normale Einstellungen laufen weiter
  })

  it('behaelt beim Uebernehmen vom Server die eigene PIN', async () => {
    repo.upsertByKey('settings', 'key', 'pin_hash', { value_json: JSON.stringify('meine-pin') })
    serverZeile('tags', neueZeile('srv-1', 'Vom Server'))

    const res = await engine.pullFresh(URL_, KEY)

    expect(res.ok).toBe(true)
    expect(JSON.parse(einstellung('pin_hash').value_json)).toBe('meine-pin')
  })
})

/* ------------------------------------------------------ Zusammenfuehrung */

describe('Zusammenfuehrung mit gemeinsamem Ausgangsstand', () => {
  it('behaelt unabhaengige Aenderungen an verschiedenen Feldern beider Seiten', async () => {
    const id = repo.insert('tags', { name: 'Urspruenglich', color: null, scope: null })
    await engine.runSync(URL_, KEY)

    // Dieses Geraet aendert den Namen (noch nicht gesendet) ...
    repo.update('tags', id, { name: 'Lokal umbenannt' })
    // ... ein anderes Geraet hat inzwischen die Farbe gesetzt - und ist dabei NEUER.
    serverZeile('tags', {
      id, color: 'rot', updated_at: '2099-01-01T00:00:00Z', version: 50, last_device_id: 'anderes',
    })

    const res = await engine.runSync(URL_, KEY)
    expect(res.ok).toBe(true)

    const lokal = tag(id)
    expect(lokal.name).toBe('Lokal umbenannt')   // frueher: vom Server ueberschrieben
    expect(lokal.color).toBe('rot')
    const server_ = server.zeilen.get('tags')!.get(id)
    expect(server_.name).toBe('Lokal umbenannt')
    expect(server_.color).toBe('rot')
  })

  it('nimmt bei Aenderung desselben Feldes weiter die neuere Fassung', async () => {
    const id = repo.insert('tags', { name: 'Urspruenglich', color: null, scope: null })
    await engine.runSync(URL_, KEY)
    repo.update('tags', id, { name: 'Lokal' })
    serverZeile('tags', { id, name: 'Server', updated_at: '2099-01-01T00:00:00Z', version: 50 })

    await engine.runSync(URL_, KEY)

    expect(tag(id).name).toBe('Server')
  })

  it('uebernimmt Serveraenderungen an Feldern, die dieses Geraet nicht angefasst hat', async () => {
    const id = repo.insert('tags', { name: 'Lokal', color: null, scope: null })
    await engine.runSync(URL_, KEY)
    repo.update('tags', id, { color: 'blau' })
    serverZeile('tags', { id, name: 'Serverseitig umbenannt', updated_at: '2099-01-01T00:00:00Z', version: 50 })

    await engine.runSync(URL_, KEY)

    expect(tag(id).name).toBe('Serverseitig umbenannt')
    expect(tag(id).color).toBe('blau')
  })
})

/* ------------------------------------------------------------ Pull-Cursor */

describe('Pull-Cursor: spaet festgeschriebene Zeilen gehen nicht verloren', () => {
  it('holt eine Zeile mit kleinerer Nummer nach, die erst nach dem Cursor sichtbar wurde', async () => {
    serverZeile('tags', neueZeile('t1', 'Eins'))
    serverZeile('tags', neueZeile('t2', 'Zwei'))
    serverZeile('tags', neueZeile('t3', 'Drei'))
    await engine.runSync(URL_, KEY)
    expect(alleTags().map((t) => t.name).sort()).toEqual(['Drei', 'Eins', 'Zwei'])

    // Eine laenger laufende Transaktion eines anderen Geraets wird erst jetzt
    // festgeschrieben - ihre Nummer (2) liegt UNTER dem Cursor dieses Geraets (3).
    server.zeilen.get('tags')!.set('spaet', { ...neueZeile('spaet', 'Spaet'), server_rev: 2, user_id: 'u1' })

    await engine.runSync(URL_, KEY)

    expect(tag('spaet')?.name).toBe('Spaet')
  })

  it('wendet bereits bekannte Zeilen bei der Ueberlappung nicht erneut an', async () => {
    serverZeile('tags', neueZeile('t1', 'Eins'))
    await engine.runSync(URL_, KEY)
    const vorher = tag('t1')

    // Zweiter Lauf liest t1 wegen der Ueberlappung noch einmal.
    await engine.runSync(URL_, KEY)

    expect(tag('t1')).toEqual(vorher)
    expect(tag('t1')._dirty).toBe(0)
    expect(journal()).toHaveLength(0)
  })
})
