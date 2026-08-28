/**
 * Synchronisation gegen ein Postgres-Backend (Supabase-kompatibel).
 *
 * Ablauf:
 *   PULL  – alles holen, dessen server_rev größer ist als der lokale Cursor
 *   MERGE – bei gleichzeitigen Änderungen feldweise zusammenführen
 *   PUSH  – alle lokal geänderten Zeilen (_dirty = 1) an den Server senden
 *
 * Erst holen, dann senden – niemals umgekehrt. Wer zuerst sendet, überschreibt
 * den Serverstand, bevor er ihn gesehen hat; die Zusammenführung liefe leer und
 * die Änderung des anderen Geräts wäre still verloren.
 *
 * Der Cursor ist bewusst eine serverseitig vergebene, monoton wachsende Zahl
 * und kein Zeitstempel: Geräteuhren gehen falsch, eine Sequenz nie. Damit kann
 * strukturell keine Änderung übersprungen werden.
 *
 * Ohne konfigurierten Server passiert nichts – die App bleibt vollständig
 * nutzbar, das Änderungsjournal wächst einfach weiter.
 */
import { all, run, getDb, saveNow } from '../db/sqlite'
import { SYNCED_TABLES, type SyncedTable } from '../db/schema'
import { nowIso } from '../core/dates'
import { uuidv7 } from '../core/ids'
import { getDeviceId } from '../db/repo'
import { accessToken, isSignedIn, setSyncRolle } from './auth'

export interface SyncResult {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  message: string
}

/** Felder, die bei einem Konflikt niemals automatisch zusammengeführt werden. */
const CRITICAL_FIELDS: Record<string, string[]> = {
  transactions: ['amount_cents', 'account_id', 'to_account_id', 'booked_on', 'type'],
  accounts: ['opening_balance_cents'],
}

/** Markierung für „Konflikt zugunsten dieses Geräts entschieden". */
export const KONFLIKT_ENTSCHIEDEN = 2

export function pendingChangeCount(): number {
  const r = all<{ n: number }>('SELECT COUNT(*) AS n FROM change_log')
  return Number(r[0]?.n ?? 0)
}

export function unresolvedConflictCount(): number {
  const r = all<{ n: number }>('SELECT COUNT(*) AS n FROM conflicts WHERE resolved_at IS NULL')
  return Number(r[0]?.n ?? 0)
}

export function syncStatusText(): string {
  const pending = pendingChangeCount()
  const conflicts = unresolvedConflictCount()
  if (conflicts > 0) return `${conflicts} Konflikte warten auf deine Entscheidung`
  if (pending > 0) return `${pending} Änderungen warten auf Übertragung`
  return 'Alles übertragen'
}

function cursorFor(table: string): number {
  const r = all<{ last_server_rev: number }>('SELECT last_server_rev FROM sync_state WHERE table_name = ?', [table])
  return Number(r[0]?.last_server_rev ?? 0)
}

function setCursor(table: string, rev: number, kind: 'pull' | 'push'): void {
  const existing = all('SELECT table_name FROM sync_state WHERE table_name = ?', [table])
  const col = kind === 'pull' ? 'last_pull_at' : 'last_push_at'
  if (existing.length) {
    getDb().run(`UPDATE sync_state SET last_server_rev = ?, ${col} = ? WHERE table_name = ?`, [rev, nowIso(), table] as any)
  } else {
    getDb().run(`INSERT INTO sync_state (table_name, last_server_rev, ${col}) VALUES (?, ?, ?)`, [table, rev, nowIso()] as any)
  }
}

function localRow(table: string, id: string): Record<string, any> | null {
  const rows = all<Record<string, any>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  return rows.length ? rows[0] : null
}

function stripLocal(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) out[k] = v
  return out
}

/**
 * Feldweises Zusammenführen.
 * Disjunkte Änderungen werden beide übernommen. Beim selben Feld gewinnt die
 * jüngere Änderung – außer bei kritischen Feldern, dort wird ein Konflikt
 * protokolliert und der Servertand vorläufig übernommen.
 */
export function mergeRows(
  table: string,
  local: Record<string, any>,
  remote: Record<string, any>,
): { merged: Record<string, any>; conflicted: string[] } {
  const merged: Record<string, any> = { ...remote }
  const conflicted: string[] = []
  const localNewer = String(local.updated_at ?? '') > String(remote.updated_at ?? '')
  const critical = CRITICAL_FIELDS[table] ?? []
  // _conflict = 2 heißt: Diesen Konflikt hat die Person bereits bewusst zu
  // Gunsten dieses Geräts entschieden. Ohne diese Ausnahme würde der nächste
  // Abgleich die Entscheidung sofort wieder umdrehen – der Serverstand gewinnt
  // bei kritischen Feldern ja grundsätzlich.
  const entschieden = Number(local._conflict) === 2

  for (const [key, localValue] of Object.entries(local)) {
    if (key.startsWith('_') || key === 'id' || key === 'server_rev') continue
    const remoteValue = remote[key]
    if (localValue === remoteValue) continue

    if (critical.includes(key)) {
      if (entschieden) { merged[key] = localValue; continue }
      conflicted.push(key)
      continue // Serverstand behalten, Konflikt sichtbar machen
    }

    // Erledigt schlägt offen – eine abgehakte Aufgabe soll nicht zurückspringen
    if (table === 'tasks' && key === 'status') {
      merged[key] = localValue === 'done' || remoteValue === 'done' ? 'done' : (localNewer ? localValue : remoteValue)
      continue
    }

    // Längere Texte nicht stillschweigend verwerfen
    if (typeof localValue === 'string' && typeof remoteValue === 'string' &&
        localValue.length > 40 && remoteValue.length > 40 && localValue !== remoteValue) {
      merged[key] = `${localValue}\n⟨⟨⟨ getrennt bearbeitet ⟩⟩⟩\n${remoteValue}`
      conflicted.push(key)
      continue
    }

    merged[key] = localNewer ? localValue : remoteValue
  }

  merged.version = Math.max(Number(local.version ?? 1), Number(remote.version ?? 1)) + 1
  merged.updated_at = nowIso()
  return { merged, conflicted }
}

function recordConflict(table: string, id: string, local: any, remote: any, fields: string[]) {
  getDb().run(
    `INSERT INTO conflicts (id, table_name, row_id, local_json, remote_json, merged_json, strategy, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv7(), table, id, JSON.stringify(local), JSON.stringify(remote), null,
     `Felder: ${fields.join(', ')}`, nowIso()] as any,
  )
}

/**
 * Ein Aufruf gegen die Datenschnittstelle.
 *
 * `apikey` ist der öffentliche Projektschlüssel – er sagt dem Server nur,
 * um welches Projekt es geht. Die eigentliche Berechtigung steckt im
 * `Authorization`-Token der angemeldeten Person. Nur damit gibt die
 * Zeilensicherheit die eigenen Zeilen frei.
 */
async function request(
  url: string, anonKey: string, token: string, path: string, init: RequestInit = {},
): Promise<any> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 404) {
      throw new Error(`Die Tabelle „${path.split('?')[0]}" gibt es auf dem Server nicht. `
        + 'Wurde das Server-Schema (0001_init.sql) vollständig ausgeführt?')
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Der Server hat die Anmeldung abgelehnt. Melde dich in den Einstellungen neu an.')
    }
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/**
 * Wie viele Zeilen auf einmal gesendet werden.
 * Belege tragen das Bild als Data-URL mit sich; davon passen nur wenige in
 * eine Anfrage, ohne dass sie unhandlich groß wird.
 */
function pushBatchSize(table: string): number {
  return table === 'attachments' ? 4 : 200
}

export async function runSync(url: string, anonKey: string): Promise<SyncResult> {
  if (!url || !anonKey) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: 'Kein Server hinterlegt – die App arbeitet rein lokal.' }
  }
  if (!isSignedIn()) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: 'Nicht angemeldet – melde dich unter Einstellungen → Synchronisation an.' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: 'Offline – die Änderungen bleiben gespeichert und werden später übertragen.' }
  }

  const token = await accessToken(url, anonKey)
  if (!token) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: 'Die Anmeldung ist abgelaufen. Bitte einmal neu anmelden.' }
  }

  let pushed = 0, pulled = 0, conflicts = 0
  // Jede Tabelle bekommt ihren EIGENEN Versuch. Früher lag das Ganze in einem
  // einzigen try/catch um die komplette Schleife: Scheiterte eine Tabelle
  // (z. B. weil dem Server eine Spalte fehlte, die die App schon kennt), brach
  // die Übertragung dort sofort ab – und jede Tabelle, die in SYNCED_TABLES
  // danach kommt, wurde in diesem Lauf gar nicht erst angefasst, weder geholt
  // noch gesendet. Genau das sah aus wie "nichts synct mehr", obwohl nur eine
  // einzelne Tabelle betroffen war. Jetzt läuft der Rest ganz normal weiter,
  // und die betroffene Tabelle steht namentlich in der Fehlermeldung.
  const fehlgeschlagen: string[] = []

  try {
    for (const table of SYNCED_TABLES) {
      try {
      // Reihenfolge ist entscheidend: erst holen, dann senden.
      // Andersherum würde das zweite Gerät den Serverstand einfach
      // überschreiben – die Zusammenführung käme nie zum Zug und eine
      // geänderte Buchungssumme wäre stillschweigend verloren.
      // ---------------------------------------------------------------- PULL
      // Ebenfalls seitenweise: Der Cursor wandert mit, deshalb liefert jede
      // Runde die jeweils nächsten Zeilen.
      for (;;) {
        const cursor = cursorFor(table)
        const remote: any[] = (await request(
          url, anonKey, token,
          `${table}?server_rev=gt.${cursor}&order=server_rev.asc&limit=500`,
        )) ?? []
        if (!remote.length) break

        let maxRev = cursor
        for (const row of remote) {
          maxRev = Math.max(maxRev, Number(row.server_rev ?? 0))
          delete row.user_id                     // gehört nur dem Server
          const local = localRow(table, row.id)
          if (!local) {
            const cols = Object.keys(row)
            getDb().run(
              `INSERT OR REPLACE INTO ${table} (${cols.join(',')}, _dirty, _conflict) VALUES (${cols.map(() => '?').join(',')}, 0, 0)`,
              cols.map((c) => row[c]) as any,
            )
            pulled++
            continue
          }
          if (Number(local._dirty) === 0) {
            const cols = Object.keys(row)
            getDb().run(
              `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, _dirty = 0 WHERE id = ?`,
              [...cols.map((c) => row[c]), row.id] as any,
            )
            pulled++
            continue
          }
          // Beide Seiten geändert → zusammenführen
          const { merged, conflicted } = mergeRows(table, local, row)
          const cols = Object.keys(merged).filter((c) => !c.startsWith('_') && c !== 'user_id')
          getDb().run(
            `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, _dirty = 1, _conflict = ? WHERE id = ?`,
            [...cols.map((c) => merged[c]), conflicted.length ? 1 : 0, row.id] as any,
          )
          if (conflicted.length) { recordConflict(table, row.id, local, row, conflicted); conflicts++ }
          pulled++
        }
        if (maxRev > cursor) setCursor(table, maxRev, 'pull')
        else break
        if (remote.length < 500) break
      }
      // ---------------------------------------------------------------- PUSH
      // In Schüben, bis nichts Geändertes mehr übrig ist. Ein einzelner Schub
      // mit fester Obergrenze würde bei der ersten Übertragung stillschweigend
      // Zeilen liegen lassen.
      const size = pushBatchSize(table)
      for (;;) {
        const dirty = all<Record<string, any>>(`SELECT * FROM ${table} WHERE _dirty = 1 LIMIT ${size}`)
        if (!dirty.length) break
        const payload = dirty.map(stripLocal)
        const saved = await request(url, anonKey, token, table, { method: 'POST', body: JSON.stringify(payload) })
        const byId = new Map<string, any>((saved ?? []).map((r: any) => [r.id, r]))
        for (const row of dirty) {
          const server = byId.get(row.id)
          getDb().run(
            `UPDATE ${table} SET _dirty = 0, server_rev = ? WHERE id = ?`,
            [server?.server_rev ?? row.server_rev ?? null, row.id] as any,
          )
        }
        pushed += dirty.length
        if (dirty.length < size) break
      }
      getDb().run(`DELETE FROM change_log WHERE table_name = ?`, [table] as any)
      } catch (tabErr: any) {
        // Diese eine Tabelle scheitert – z. B. weil dem Server eine Spalte
        // fehlt, die diese Version der App schon schreibt. Die Zeilen bleiben
        // als "noch zu senden" markiert (change_log wurde für sie ja nicht
        // geleert) und werden beim nächsten Abgleich erneut versucht. Alle
        // anderen Tabellen laufen in DIESEM Lauf trotzdem normal weiter.
        fehlgeschlagen.push(`${table}: ${tabErr?.message ?? String(tabErr)}`)
      }
    }

    await saveNow()
    const parts = [`${pushed} gesendet`, `${pulled} empfangen`]
    if (conflicts) parts.push(`${conflicts} Konflikte`)
    if (fehlgeschlagen.length) {
      return {
        ok: false, pushed, pulled, conflicts,
        message: `Teilweise synchronisiert (${parts.join(' · ')}). Fehlgeschlagen: ${fehlgeschlagen.join(' / ')}`,
      }
    }
    return { ok: true, pushed, pulled, conflicts, message: `Synchronisiert: ${parts.join(' · ')}` }
  } catch (err: any) {
    return {
      ok: false, pushed, pulled, conflicts,
      message: `Synchronisation fehlgeschlagen: ${err?.message ?? String(err)} Deine Daten sind lokal vollständig gespeichert.`,
    }
  }
}

/**
 * Erstverbindung eines weiteren Geräts.
 *
 * Ein frisch gestartetes LifeHub legt Beispielkonten und Standardkategorien an.
 * Würde man darauf einfach den Serverbestand ziehen, stünde alles doppelt da.
 * Deshalb: lokalen Bestand der synchronisierten Tabellen leeren, Cursor auf
 * null setzen und den Server als Wahrheit übernehmen. Die Zugangsdaten und die
 * PIN dieses Geräts bleiben erhalten.
 */
export async function pullFresh(url: string, anonKey: string): Promise<SyncResult> {
  if (!isSignedIn()) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: 'Bitte zuerst anmelden.' }
  }
  const KEEP = ['sync_url', 'sync_key', 'pin_hash', 'pin_salt', 'lock_after_minutes']
  try {
    for (const table of SYNCED_TABLES) {
      if (table === 'settings') {
        getDb().run(`DELETE FROM settings WHERE key NOT IN (${KEEP.map(() => '?').join(',')})`, KEEP as any)
      } else {
        getDb().run(`DELETE FROM ${table}`)
      }
    }
    getDb().run('DELETE FROM sync_state')
    getDb().run('DELETE FROM change_log')
    await saveNow()
  } catch (err: any) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: `Konnte den lokalen Bestand nicht leeren: ${err?.message ?? err}` }
  }
  const res = await runSync(url, anonKey)
  if (res.ok) setSyncRolle('kopie')
  return res.ok
    ? { ...res, message: `Vom Server übernommen: ${res.pulled} Datensätze.` }
    : res
}

/**
 * Gegenstück zu pullFresh: Dieses Gerät hat die richtigen Daten und füllt den
 * Server neu.
 *
 * Nötig, wenn der Server leer ist oder aufgeräumt wurde. Ein gewöhnlicher
 * Abgleich würde nichts senden – die Zeilen gelten ja als längst übertragen.
 * Deshalb werden hier alle Zeilen wieder als "noch zu senden" markiert und die
 * Lesemarken zurückgesetzt.
 */
/**
 * Billige Nachfrage: Liegt auf dem Server etwas, das dieses Gerät noch nicht hat?
 *
 * Eine einzige Anfrage statt einer je Tabelle. Damit kann häufig nachgesehen
 * werden, ohne Datenvolumen und Akku zu verbrauchen – der vollständige Abgleich
 * läuft erst, wenn es wirklich etwas zu holen gibt.
 *
 * Kennt der Server die Ansicht noch nicht (älteres Schema), wird `true`
 * geliefert: dann lieber einmal zu viel abgleichen als eine Änderung verpassen.
 */
export async function hasRemoteChanges(url: string, anonKey: string): Promise<boolean> {
  if (!url || !anonKey || !isSignedIn()) return false
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const token = await accessToken(url, anonKey)
  if (!token) return false
  try {
    const rows = await request(url, anonKey, token, 'sync_head?select=server_rev&limit=1')
    const head = Number(rows?.[0]?.server_rev ?? 0)
    if (!Number.isFinite(head) || head === 0) return false
    const lokal = all<{ m: number }>('SELECT COALESCE(MAX(last_server_rev), 0) AS m FROM sync_state')
    return head > Number(lokal[0]?.m ?? 0)
  } catch {
    return true
  }
}

export async function pushAll(url: string, anonKey: string): Promise<SyncResult> {
  if (!isSignedIn()) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: 'Bitte zuerst anmelden.' }
  }
  try {
    for (const table of SYNCED_TABLES) {
      getDb().run(`UPDATE ${table} SET _dirty = 1`)
    }
    getDb().run('DELETE FROM sync_state')
    await saveNow()
  } catch (err: any) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, message: `Vorbereitung fehlgeschlagen: ${err?.message ?? err}` }
  }
  const res = await runSync(url, anonKey)
  if (res.ok) setSyncRolle('quelle')
  return res.ok
    ? { ...res, message: `Auf den Server geladen: ${res.pushed} Datensätze.` }
    : res
}
