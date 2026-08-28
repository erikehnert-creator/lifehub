/**
 * Automatische Ablage in einen echten Ordner.
 *
 * Der Browser speichert die Datenbank normalerweise in seinem eigenen,
 * unsichtbaren Speicher. Mit der File System Access API darf die App
 * zusätzlich in einen Ordner schreiben, den du einmalig auswählst.
 *
 * Wählst du dafür deinen OneDrive-Ordner, liegen deine Daten damit als
 * echte Dateien in OneDrive – und werden von OneDrive selbst weitergesichert.
 *
 * Unterstützt von Chrome und Edge. Firefox und Safari können das nicht;
 * dort bleibt der manuelle Export.
 */
import { exportDatabaseFile } from '../db/sqlite'
import { exportFullJson } from './exporters'

const IDB_NAME = 'lifehub-handles'
const STORE = 'handles'
const KEY = 'backupDir'

export function folderBackupSupported(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function'
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGetHandle(): Promise<any | null> {
  try {
    const db = await openHandleDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

async function idbPutHandle(handle: any | null): Promise<void> {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    if (handle === null) tx.objectStore(STORE).delete(KEY)
    else tx.objectStore(STORE).put(handle, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export type FolderState = 'unsupported' | 'none' | 'granted' | 'needs_permission'

export async function folderState(): Promise<{ state: FolderState; name: string | null }> {
  if (!folderBackupSupported()) return { state: 'unsupported', name: null }
  const handle = await idbGetHandle()
  if (!handle) return { state: 'none', name: null }
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    return { state: perm === 'granted' ? 'granted' : 'needs_permission', name: handle.name ?? null }
  } catch {
    return { state: 'needs_permission', name: handle.name ?? null }
  }
}

/** Ordner auswählen. Muss aus einer Nutzeraktion heraus aufgerufen werden. */
export async function chooseFolder(): Promise<string | null> {
  if (!folderBackupSupported()) return null
  const handle = await (globalThis as any).showDirectoryPicker({ mode: 'readwrite', id: 'lifehub-backup' })
  const perm = await handle.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') return null
  await idbPutHandle(handle)
  return handle.name ?? null
}

export async function forgetFolder(): Promise<void> {
  await idbPutHandle(null)
}

/** Berechtigung erneut anfordern – nach einem Browser-Neustart nötig. */
export async function reconfirmPermission(): Promise<boolean> {
  const handle = await idbGetHandle()
  if (!handle) return false
  const perm = await handle.requestPermission({ mode: 'readwrite' })
  return perm === 'granted'
}

async function writeFile(dir: any, name: string, data: Uint8Array | string): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(data instanceof Uint8Array ? (data.slice().buffer as ArrayBuffer) : data)
  await writable.close()
}

export interface BackupResult { ok: boolean; message: string; at?: string }

/**
 * Schreibt zwei Dateien in den Ordner:
 *   lifehub.db    – die Datenbank selbst, mit jedem SQLite-Werkzeug lesbar
 *   lifehub.json  – der Vollexport, aus dem sich alles wiederherstellen lässt
 * Zusätzlich eine Tageskopie, damit ein Fehler von gestern nicht die einzige
 * Sicherung überschreibt.
 */
export async function writeBackup(withDailyCopy = true): Promise<BackupResult> {
  if (!folderBackupSupported()) return { ok: false, message: 'Dieser Browser unterstützt das nicht.' }
  const handle = await idbGetHandle()
  if (!handle) return { ok: false, message: 'Kein Ordner ausgewählt.' }
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return { ok: false, message: 'Der Ordner braucht deine Bestätigung.' }

    const db = exportDatabaseFile()
    const json = exportFullJson()
    await writeFile(handle, 'lifehub.db', db)
    await writeFile(handle, 'lifehub.json', json)

    if (withDailyCopy) {
      const day = new Date().toISOString().slice(0, 10)
      const sub = await handle.getDirectoryHandle('Sicherungen', { create: true })
      await writeFile(sub, `lifehub-${day}.json`, json)
      await pruneOldCopies(sub, 30)
    }

    const at = new Date().toISOString()
    localStorage.setItem('lifehub.lastFolderBackup', at)
    return { ok: true, message: 'Gesichert', at }
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) }
  }
}

/** Alte Tageskopien aufräumen, damit der Ordner nicht endlos wächst. */
async function pruneOldCopies(dir: any, keep: number): Promise<void> {
  try {
    const names: string[] = []
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === 'file' && /^lifehub-\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name)
    }
    names.sort()
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      await dir.removeEntry(name).catch(() => undefined)
    }
  } catch {
    /* Aufräumen ist Kür, kein Muss */
  }
}

export function lastBackupAt(): string | null {
  try { return localStorage.getItem('lifehub.lastFolderBackup') } catch { return null }
}
