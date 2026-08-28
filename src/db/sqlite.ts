/**
 * SQLite im Browser (sql.js / WASM) mit Persistenz in IndexedDB.
 *
 * Der Datenbestand ist eine echte SQLite-Datei. Sie kann jederzeit exportiert
 * und mit jedem SQLite-Werkzeug geöffnet werden – das ist das Kernversprechen
 * "meine Daten gehören mir".
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from './schema'

const IDB_NAME = 'lifehub'
const IDB_STORE = 'files'
const IDB_KEY = 'lifehub.db'
const LS_KEY = 'lifehub.db.b64'

/**
 * Pfad zur WASM-Datei. Muss relativ zum Dokument aufgelöst werden, nicht
 * relativ zum JavaScript-Bündel – sonst sucht der Browser im assets-Ordner.
 */
function wasmUrl(file: string): string {
  if (typeof document !== 'undefined' && document.baseURI) return new URL(file, document.baseURI).href
  return `./${file}`
}

/**
 * In der Einzeldatei-Fassung ist die WASM-Datei als Base64 eingebettet.
 * Das ist der Grund, warum diese Fassung auch per Doppelklick (file://)
 * funktioniert: Der Browser muss dann nichts nachladen.
 */
function embeddedWasm(): Uint8Array | null {
  const raw = (globalThis as any).__LIFEHUB_WASM__
  if (typeof raw !== 'string' || !raw) return null
  const bin = atob(raw)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  const wasmBinary = embeddedWasm()
  return wasmBinary
    ? await initSqlJs({ wasmBinary } as any)
    : await initSqlJs({ locateFile: (file) => wasmUrl(file) })
}

/**
 * Wo die Datenbankdatei liegt.
 *   'idb'    – IndexedDB (Normalfall, unbegrenzt)
 *   'local'  – localStorage (Notlösung, wenn IndexedDB gesperrt ist –
 *              etwa beim Öffnen per Doppelklick in Firefox)
 *   'memory' – nichts davon verfügbar; die Sitzung ist flüchtig
 */
export type StorageMode = 'idb' | 'local' | 'memory'
let storageMode: StorageMode = 'idb'
export function getStorageMode(): StorageMode { return storageMode }

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveListeners: Array<(state: 'saving' | 'saved') => void> = []

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const idb = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const idb = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Speicher ermitteln und lesen – mit Rückfallebenen. */
async function loadFile(): Promise<Uint8Array | null> {
  try {
    const viaIdb = await idbGet(IDB_KEY)
    storageMode = 'idb'
    if (viaIdb) return viaIdb
  } catch {
    storageMode = 'local'
  }
  if (storageMode === 'idb') {
    // IndexedDB ist erreichbar, enthält aber noch nichts
    return null
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    storageMode = 'local'
    if (!raw) return null
    const bin = atob(raw)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    storageMode = 'memory'
    return null
  }
}

async function persistFile(data: Uint8Array): Promise<void> {
  if (storageMode === 'idb') {
    try { await idbPut(IDB_KEY, data); return } catch { storageMode = 'local' }
  }
  if (storageMode === 'local') {
    try {
      let s = ''
      const chunk = 0x8000
      for (let i = 0; i < data.length; i += chunk) {
        s += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + chunk)) as any)
      }
      localStorage.setItem(LS_KEY, btoa(s))
      return
    } catch {
      storageMode = 'memory'
    }
  }
  // 'memory': nichts zu tun – die Oberfläche weist darauf hin
}

export function onSaveStateChange(fn: (state: 'saving' | 'saved') => void): () => void {
  saveListeners.push(fn)
  return () => {
    saveListeners = saveListeners.filter((f) => f !== fn)
  }
}

/** Persistierung gebündelt: nicht bei jedem Tastendruck, sondern gedrosselt. */
/**
 * Änderungen werden gesammelt geschrieben, damit nicht bei jedem Tastendruck
 * die ganze Datenbank ausgelagert wird.
 *
 * Zwei Ausnahmen von der Wartezeit:
 * - Ist die App gerade im Hintergrund (Handy weggewischt), wird sofort
 *   geschrieben – dort kann es sein, dass es kein "gleich" mehr gibt.
 * - Die Wartezeit ist bewusst kurz gehalten. Sie soll Tastendrücke bündeln,
 *   nicht eine fertige Buchung minutenlang in der Luft hängen lassen.
 */
export function scheduleSave(delayMs = 250): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveListeners.forEach((f) => f('saving'))
  if (typeof document !== 'undefined' && document.hidden) {
    void saveNow()
    return
  }
  saveTimer = setTimeout(() => {
    void saveNow()
  }, delayMs)
}

export async function saveNow(): Promise<void> {
  if (!db) return
  const data = db.export()
  await persistFile(data)
  saveListeners.forEach((f) => f('saved'))
}

export async function initDatabase(): Promise<Database> {
  if (db) return db
  SQL = await loadSqlJs()
  const stored = await loadFile().catch(() => null)
  db = stored ? new SQL.Database(stored) : new SQL.Database()
  db.run('PRAGMA foreign_keys = OFF;')
  runMigrations(db)
  await saveNow()
  return db
}

function runMigrations(database: Database): void {
  database.run(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  );`)
  const applied = new Set<number>()
  const res = database.exec('SELECT id FROM _migrations')
  if (res.length) for (const row of res[0].values) applied.add(Number(row[0]))

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    database.run('BEGIN')
    try {
      database.run(m.sql)
      database.run('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)', [
        m.id, m.name, new Date().toISOString(),
      ])
      database.run('COMMIT')
    } catch (err) {
      database.run('ROLLBACK')
      throw new Error(`Migration ${m.id} (${m.name}) fehlgeschlagen: ${String(err)}`)
    }
  }
}

export function getDb(): Database {
  if (!db) throw new Error('Datenbank ist noch nicht initialisiert')
  return db
}

export type Row = Record<string, any>

/** Abfrage mit Ergebniszeilen als Objekte. */
export function all<T = Row>(sql: string, params: any[] = []): T[] {
  const database = getDb()
  const stmt = database.prepare(sql)
  try {
    stmt.bind(params as any)
    const out: T[] = []
    while (stmt.step()) out.push(stmt.getAsObject() as T)
    return out
  } finally {
    stmt.free()
  }
}

export function one<T = Row>(sql: string, params: any[] = []): T | null {
  const rows = all<T>(sql, params)
  return rows.length ? rows[0] : null
}

export function scalar<T = number>(sql: string, params: any[] = []): T | null {
  const row = one<Record<string, any>>(sql, params)
  if (!row) return null
  const keys = Object.keys(row)
  return keys.length ? (row[keys[0]] as T) : null
}

export function run(sql: string, params: any[] = []): void {
  getDb().run(sql, params as any)
  scheduleSave()
}

export function transaction(fn: () => void): void {
  const database = getDb()
  database.run('BEGIN')
  try {
    fn()
    database.run('COMMIT')
  } catch (err) {
    database.run('ROLLBACK')
    throw err
  }
  scheduleSave()
}

/** Rohe SQLite-Datei – für Backup und Export. */
export function exportDatabaseFile(): Uint8Array {
  return getDb().export()
}

/** Datenbank vollständig durch eine hochgeladene Datei ersetzen. */
export async function replaceDatabaseFile(data: Uint8Array): Promise<void> {
  if (!SQL) SQL = await loadSqlJs()
  db?.close()
  db = new SQL.Database(data)
  runMigrations(db)
  await saveNow()
}

export async function wipeDatabase(): Promise<void> {
  if (!SQL) SQL = await loadSqlJs()
  db?.close()
  db = new SQL.Database()
  runMigrations(db)
  await saveNow()
}
