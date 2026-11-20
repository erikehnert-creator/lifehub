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
import {
  all, run, getDb, saveNow, momentaufnahme, stelleMomentaufnahmeWiederHer, sperrePersistenz,
} from '../db/sqlite'
import { SYNCED_TABLES } from '../db/schema'
import {
  berichtigungsText, ganzzahlSpalten, gebrocheneWerte, type SpaltenInfo,
} from '../core/ganzzahlen'
import {
  NATUERLICHER_SCHLUESSEL, SCHLUESSEL_UMBENENNBAR, VERWEISE_AUF,
  aufgeloesterSchluessel, entscheideKollision,
} from '../core/natuerlicheSchluessel'
import { nowIso } from '../core/dates'
import { uuidv7 } from '../core/ids'
import { accessToken, currentSession, isSignedIn, setSyncRolle } from './auth'

/**
 * Woran der Abgleich gerade ist.
 *
 * Der Unterschied ist wichtiger, als er aussieht: „teilweise synchronisiert"
 * und „dem Server fehlt das halbe Schema" haben nichts miteinander zu tun.
 * Das eine ist eine einzelne zickige Tabelle, das andere heisst: Erik hat die
 * aktuelle Migration noch nicht eingespielt, und ein Hinweis mit acht
 * gleichlautenden Sätzen hilft ihm dabei nicht.
 */
export type SyncZustand =
  | 'vollstaendig'
  | 'teilweise'
  | 'schema_unvollstaendig'
  | 'offline'
  | 'nicht_angemeldet'
  | 'kein_server'
  | 'fehler'

export interface SyncResult {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  message: string
  zustand: SyncZustand
  /** Tabellen, die der Server gar nicht kennt. */
  fehlendeTabellen: string[]
  /** Je gescheiterter Tabelle ein Grund – für die Diagnose, nicht für den Hinweis. */
  fehler: { tabelle: string; grund: string }[]
}

/**
 * Ein Satz für fehlende Servertabellen – egal wie viele es sind.
 *
 * Vorher stand hier je Tabelle derselbe Erklärungstext, achtmal
 * hintereinander. Das füllte den halben Bildschirm und verdeckte genau die
 * eine Auskunft, auf die es ankommt: Der Server ist älter als die App, und
 * ein einziger Schritt behebt das.
 */
export function schemaMeldung(anzahl: number): string {
  return `Server-Schema unvollständig: ${anzahl} ${anzahl === 1 ? 'Tabelle fehlt' : 'Tabellen fehlen'}. `
    + 'Bitte die aktuelle Supabase-Migration einmal ausführen.'
}

/** Ein Ergebnis mit Vorgaben, damit die Rückgabestellen kurz bleiben. */
function ergebnis(teil: Partial<SyncResult> & { zustand: SyncZustand; message: string }): SyncResult {
  return {
    ok: teil.zustand === 'vollstaendig',
    pushed: 0, pulled: 0, conflicts: 0,
    fehlendeTabellen: [], fehler: [],
    ...teil,
  }
}

/**
 * Der Server kennt diese Tabelle nicht.
 *
 * Eigene Fehlerart, damit der Abgleich sie von einer zickigen Spalte
 * unterscheiden kann. Acht fehlende Tabellen sind EIN Problem mit einer
 * Ursache und gehören zu einem Satz zusammengefasst – nicht zu acht.
 */
export class TabelleFehltFehler extends Error {
  tabelle: string

  constructor(tabelle: string) {
    super(`Die Tabelle „${tabelle}" gibt es auf dem Server nicht.`)
    this.name = 'TabelleFehltFehler'
    this.tabelle = tabelle
  }
}

/**
 * Einstellungen, die zu DIESEM Geraet gehoeren und nie ueber den Server laufen.
 *
 * PIN-Pruefsumme und Salt gehoeren ausdruecklich dazu: Wer sie synchronisiert,
 * legt die Pruefsumme der PIN auf dem Server ab und ueberschreibt auf jedem
 * anderen Geraet dessen eigene PIN. Auch Sperrzeit und Serveradresse sind
 * Eigenheiten des einzelnen Geraets.
 *
 * Bestehende Installationen: Auf dem Server liegen aus frueheren Fassungen
 * womoeglich noch solche Zeilen. Sie werden hier beim Holen schlicht
 * uebergangen und nie angewendet; auf dem Server selbst wird nichts geloescht.
 */
export const GERAETEGEBUNDENE_EINSTELLUNGEN = [
  'sync_url', 'sync_key', 'pin_hash', 'pin_salt', 'lock_after_minutes',
] as const

function istGeraetegebunden(table: string, row: Record<string, any>): boolean {
  return table === 'settings'
    && (GERAETEGEBUNDENE_EINSTELLUNGEN as readonly string[]).includes(String(row.key))
}

/* ------------------------------------------------------------- Besitzer
 *
 * Wem gehoert der lokale Bestand? Gemerkt wird Server + Konto in der Datenbank
 * selbst (eine Zeile in sync_state), damit es mit einer eingespielten
 * Sicherung mitwandert. Ohne diese Pruefung schickt ein Gerät nach einem
 * Kontowechsel die Daten des alten Kontos in das neue - oder umgekehrt.
 */
const BESITZER_ZEILE = '__besitzer__'

function besitzerKennung(url: string): string | null {
  const s = currentSession()
  const wer = s?.user_id || s?.email || ''
  if (!wer) return null
  return `${url.replace(/\/+$/, '')}|${wer}`
}

function lokalerBesitzer(): string | null {
  const r = all<{ last_pull_at: string | null }>(
    'SELECT last_pull_at FROM sync_state WHERE table_name = ?', [BESITZER_ZEILE])
  return r.length ? (r[0].last_pull_at ?? null) : null
}

function stempleBesitzer(kennung: string): void {
  const da = all('SELECT table_name FROM sync_state WHERE table_name = ?', [BESITZER_ZEILE])
  if (da.length) {
    getDb().run('UPDATE sync_state SET last_pull_at = ? WHERE table_name = ?', [kennung, BESITZER_ZEILE] as any)
  } else {
    getDb().run(
      'INSERT INTO sync_state (table_name, last_server_rev, last_pull_at) VALUES (?, 0, ?)',
      [BESITZER_ZEILE, kennung] as any,
    )
  }
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

export interface BerichtigterWert {
  tabelle: string
  spalte: string
  wert: number
  ganz: number
}

/** Welche Spalten einer Tabelle SQLite als ganzzahlig führt – einmal je Lauf. */
const ganzzahlSpaltenCache = new Map<string, string[]>()
function ganzzahlSpaltenVon(table: string): string[] {
  const bekannt = ganzzahlSpaltenCache.get(table)
  if (bekannt) return bekannt
  const info = all<SpaltenInfo>(`SELECT name, type FROM pragma_table_info('${table}')`)
  const spalten = ganzzahlSpalten(info)
  ganzzahlSpaltenCache.set(table, spalten)
  return spalten
}

/**
 * Nachkommastellen aus ganzzahligen Spalten nehmen, bevor sie den Server
 * erreichen – und zwar in der Datenbank, nicht nur in der Sendung.
 *
 * Nur die Sendung zu säubern hieße: Der Abgleich läuft durch, der krumme Wert
 * bleibt aber liegen und weicht von dem ab, was auf dem Server steht. Beim
 * nächsten Pull käme er als Konflikt zurück.
 *
 * Ohne diese Stelle scheitert der Push der ganzen Tabelle an einer einzigen
 * Zeile, mit `22P02` und bei jedem Versuch aufs Neue (siehe core/ganzzahlen.ts).
 * Migration 9 räumt den bekannten Fall – Ballaststoffe mit Sortierwert 23.5 –
 * beim Update ab; das hier fängt jeden weiteren ab, den heute noch niemand
 * kennt. Die Zeile bleibt `_dirty`, sie wird ja gerade gesendet.
 */
function ganzzahlenBerichtigen(
  table: string, zeilen: Record<string, any>[],
): BerichtigterWert[] {
  const spalten = ganzzahlSpaltenVon(table)
  if (!spalten.length) return []

  const out: BerichtigterWert[] = []
  for (const zeile of zeilen) {
    for (const b of gebrocheneWerte(zeile, spalten)) {
      run(`UPDATE ${table} SET ${b.spalte} = ? WHERE id = ?`, [b.ganz, zeile.id] as any)
      zeile[b.spalte] = b.ganz          // auch in der Sendung dieses Laufs
      out.push({ tabelle: table, spalte: b.spalte, wert: b.wert, ganz: b.ganz })
    }
  }
  return out
}

/**
 * Eine hereinkommende Zeile, deren natürlicher Schlüssel hier schon vergeben ist.
 *
 * Ohne diese Stelle erledigt SQLite den Konflikt selbst, und zwar auf die
 * schlechteste denkbare Weise: `INSERT OR REPLACE` LÖSCHT die vorhandene Zeile
 * und setzt die neue an ihren Platz – ohne Fehler, ohne Meldung. Alles, was
 * auf die gelöschte Zeile zeigte, zeigt danach ins Leere. Genau so sind die
 * Ballaststoff-Tageswerte unsichtbar geworden (core/natuerlicheSchluessel.ts).
 *
 * Hier wird stattdessen entschieden, umgehängt und aufgeräumt:
 *
 *   1. Welche der beiden bleibt – nach einer festen, geräteunabhängigen Regel.
 *   2. Was auf die weichende zeigt, wird auf die bleibende umgehängt und als
 *      „noch zu senden" markiert, damit die Berichtigung auch beim anderen
 *      Gerät ankommt.
 *   3. Die weichende Zeile wird aufgelöst: Wo der Schlüssel technisch ist,
 *      bekommt sie einen abgewandelten und gilt als gelöscht – so erfährt auch
 *      der Server davon und die Dublette ist dauerhaft weg. Wo im Schlüssel
 *      echter Inhalt steht (ein Datum), wird sie nur örtlich entfernt.
 *
 * Zurück kommt, ob die hereinkommende Zeile noch eingefügt werden soll.
 */
function loeseSchluesselkollision(
  table: string, row: Record<string, any>,
): { einfuegen: boolean; aufgeloest: string | null } {
  const feld = NATUERLICHER_SCHLUESSEL[table]
  if (!feld) return { einfuegen: true, aufgeloest: null }
  const wert = row[feld]
  if (wert === null || wert === undefined || wert === '') return { einfuegen: true, aufgeloest: null }

  const andere = all<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${feld} = ? AND id <> ?`, [wert, row.id],
  )
  if (!andere.length) return { einfuegen: true, aufgeloest: null }

  const { bleibt, weicht } = entscheideKollision(String(row.id), andere[0].id)
  const ts = nowIso()

  // Erst umhängen, dann auflösen – andersherum gäbe es einen Moment, in dem
  // Tageswerte auf eine Metrik zeigen, die es nicht mehr gibt.
  for (const v of VERWEISE_AUF[table] ?? []) {
    getDb().run(
      `UPDATE ${v.tabelle} SET ${v.feld} = ?, updated_at = ?, version = version + 1, _dirty = 1
        WHERE ${v.feld} = ?`,
      [bleibt, ts, weicht] as any,
    )
  }

  if (weicht === andere[0].id) {
    // Die hiesige Zeile weicht. Die hereinkommende wird gleich eingefügt.
    if (SCHLUESSEL_UMBENENNBAR[table]) {
      getDb().run(
        `UPDATE ${table} SET ${feld} = ?, deleted_at = ?, updated_at = ?, version = version + 1, _dirty = 1
          WHERE id = ?`,
        [aufgeloesterSchluessel(String(wert), weicht), ts, ts, weicht] as any,
      )
    } else {
      getDb().run(`DELETE FROM ${table} WHERE id = ?`, [weicht] as any)
    }
    return { einfuegen: true, aufgeloest: weicht }
  }

  // Die hereinkommende weicht. Wo möglich wird sie als gelöschte Zeile
  // übernommen – nur so erfährt der Server, dass sie weg soll.
  if (SCHLUESSEL_UMBENENNBAR[table]) {
    const zeile = { ...row, [feld]: aufgeloesterSchluessel(String(wert), weicht), deleted_at: ts, updated_at: ts }
    const cols = Object.keys(zeile)
    getDb().run(
      `INSERT OR REPLACE INTO ${table} (${cols.join(',')}, _dirty, _conflict) VALUES (${cols.map(() => '?').join(',')}, 1, 0)`,
      cols.map((c) => zeile[c]) as any,
    )
  }
  return { einfuegen: false, aufgeloest: weicht }
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
  lokalGeaendert?: Map<string, LokaleAenderung>,
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

    // Mit Ausgangswerten (Dreiwege-Zusammenfuehrung):
    //  - Dieses Geraet hat das Feld nicht angefasst  -> Serverstand.
    //  - Nur dieses Geraet hat es geaendert (der Server hat noch den
    //    Ausgangswert)                               -> eigener Wert, auch
    //    bei kritischen Feldern: es gibt ja nichts zu entscheiden.
    //  - Beide haben es geaendert (oder der Ausgangswert ist unbekannt)
    //                                                -> die bisherigen Regeln.
    // Frueher entschied allein die Zeile als Ganzes (jueEngere Aenderung
    // gewinnt) und ueberschrieb dabei unabhaengige Aenderungen an anderen Feldern.
    if (lokalGeaendert) {
      const eigene = lokalGeaendert.get(key)
      if (!eigene) continue                       // merged[key] ist schon der Serverwert
      if (eigene.hatAusgang && (eigene.ausgang ?? null) === (remoteValue ?? null)) {
        merged[key] = localValue
        continue
      }
    }

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

/**
 * Was dieses Geraet an einer Zeile seit dem letzten Abgleich geaendert hat -
 * samt dem Wert, den das Feld vor der ersten dieser Aenderungen hatte.
 */
export interface LokaleAenderung {
  hatAusgang: boolean
  ausgang: any
}

function lokaleAenderungen(table: string, id: string): Map<string, LokaleAenderung> {
  const zeilen = all<{ changed_fields: string; base_json: string | null }>(
    'SELECT changed_fields, base_json FROM change_log WHERE table_name = ? AND row_id = ? ORDER BY seq ASC',
    [table, id],
  )
  const out = new Map<string, LokaleAenderung>()
  for (const z of zeilen) {
    let felder: Record<string, any> = {}
    let basis: Record<string, any> | null = null
    try { felder = JSON.parse(z.changed_fields) ?? {} } catch { /* unlesbarer Eintrag */ }
    try { basis = z.base_json ? JSON.parse(z.base_json) : null } catch { /* unlesbarer Eintrag */ }
    for (const k of Object.keys(felder)) {
      if (out.has(k)) continue        // die ERSTE Aenderung liefert den Ausgangswert
      out.set(k, basis && k in basis
        ? { hatAusgang: true, ausgang: basis[k] }
        : { hatAusgang: false, ausgang: undefined })
    }
  }
  return out
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
    // PostgREST meldet eine unbekannte Tabelle als 404, je nach Fassung auch
    // mit dem Code PGRST205 im Rumpf. Beides heisst dasselbe: Das Schema auf
    // dem Server ist aelter als die App.
    if (res.status === 404 || /PGRST205|Could not find the table/i.test(body)) {
      throw new TabelleFehltFehler(path.split('?')[0])
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
/** Wie weit vor dem Cursor die erste Abfrage je Lauf beginnt (siehe Pull-Schleife). */
const UEBERLAPPUNG = 500

function pushBatchSize(table: string): number {
  return table === 'attachments' ? 4 : 200
}

/* ------------------------------------------------- Letzter Abgleichstand
 *
 * Fuer die Diagnose unter Einstellungen -> Synchronisation. Bewusst im
 * localStorage und NICHT in einer synchronisierten Tabelle: Was diesem Geraet
 * beim letzten Versuch widerfahren ist, geht kein anderes etwas an - und eine
 * Tabelle dafuer kostete drei Abgleichanfragen je Synchronisation.
 */
const STAND_SCHLUESSEL = 'lifehub.sync.stand'

export interface SyncStand {
  zustand: SyncZustand
  message: string
  fehlendeTabellen: string[]
  fehler: { tabelle: string; grund: string }[]
  /** Zeitpunkt in Millisekunden. */
  wann: number
}

export function letzterSyncStand(): SyncStand | null {
  try {
    const roh = localStorage.getItem(STAND_SCHLUESSEL)
    return roh ? JSON.parse(roh) as SyncStand : null
  } catch {
    return null
  }
}

function merkeStand(r: SyncResult): SyncResult {
  try {
    localStorage.setItem(STAND_SCHLUESSEL, JSON.stringify({
      zustand: r.zustand,
      message: r.message,
      fehlendeTabellen: r.fehlendeTabellen,
      fehler: r.fehler,
      wann: Date.now(),
    } satisfies SyncStand))
  } catch { /* privater Modus, voller Speicher - kein Grund, den Abgleich zu stoeren */ }
  return r
}

/**
 * Eine gemeinsame Sperre fuer alles, was die Datenbank mit dem Server abgleicht.
 *
 * Vorher konnten der Knopf „Jetzt synchronisieren" und der automatische Abgleich
 * (Start, Rueckkehr in den Vordergrund, nach jeder Aenderung) gleichzeitig
 * laufen: zwei Durchlaeufe lasen dieselben Zeilen, sendeten sie doppelt und
 * schrieben sich gegenseitig Cursor und Markierungen um. Jetzt laeuft immer nur
 * einer; der naechste wartet, bis er fertig ist, und sieht dann den neuen Stand.
 */
let sperreKette: Promise<unknown> = Promise.resolve()
function mitSperre<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = sperreKette.then(arbeit, arbeit)
  sperreKette = lauf.then(() => undefined, () => undefined)
  return lauf
}

export function runSync(url: string, anonKey: string): Promise<SyncResult> {
  return mitSperre(async () => merkeStand(await runSyncIntern(url, anonKey)))
}

async function runSyncIntern(url: string, anonKey: string): Promise<SyncResult> {
  if (!url || !anonKey) {
    return ergebnis({ zustand: 'kein_server', message: 'Kein Server hinterlegt – die App arbeitet rein lokal.' })
  }
  if (!isSignedIn()) {
    return ergebnis({ zustand: 'nicht_angemeldet', message: 'Nicht angemeldet – melde dich unter Einstellungen → Synchronisation an.' })
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return ergebnis({ zustand: 'offline', message: 'Offline – die Änderungen bleiben gespeichert und werden später übertragen.' })
  }

  const token = await accessToken(url, anonKey)
  if (!token) {
    return ergebnis({ zustand: 'nicht_angemeldet', message: 'Die Anmeldung ist abgelaufen. Bitte einmal neu anmelden.' })
  }

  const kennung = besitzerKennung(url)
  if (kennung) {
    const bisher = lokalerBesitzer()
    if (bisher === null) {
      // Bestehende Installation oder erste Verbindung: der Bestand gehoert ab
      // jetzt zu diesem Konto. (Die erste Verbindung geht ohnehin nur ueber
      // „vom Server uebernehmen" oder „als Quelle".)
      stempleBesitzer(kennung)
    } else if (bisher !== kennung) {
      return ergebnis({
        zustand: 'fehler',
        message: 'Dieses Gerät gehört zu einem anderen Konto oder Server. Es wird nichts übertragen, '
          + 'damit sich die Daten nicht vermischen. Melde dich mit dem ursprünglichen Konto an – oder '
          + 'wähle „Vom Server übernehmen", wenn dieses Gerät künftig zu diesem Konto gehören soll '
          + '(das ersetzt den lokalen Bestand).',
      })
    }
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
  const fehlgeschlagen: { tabelle: string; grund: string }[] = []
  const fehlendeTabellen: string[] = []
  const berichtigt: BerichtigterWert[] = []
  /** Zeilen, die als Dublette eines natürlichen Schlüssels aufgelöst wurden. */
  const aufgeloesteDubletten: string[] = []

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
      //
      // Die erste Anfrage beginnt UEBERLAPPUNG Stellen vor dem Cursor. Die
      // Nummern kommen aus einer Sequenz, die beim Schreiben vergeben wird -
      // nicht beim Festschreiben. Schreibt ein anderes Geraet gerade eine
      // laengere Transaktion und ein drittes eine kurze, kann die kurze mit
      // der hoeheren Nummer zuerst sichtbar werden. Wer dann den Cursor setzt,
      // sieht die spaeter festgeschriebene Zeile mit der kleineren Nummer nie
      // wieder. Die Ueberlappung holt sie beim naechsten Mal nach; bereits
      // bekannte Zeilen werden unten ohne Schreibzugriff uebergangen.
      let von = Math.max(0, cursorFor(table) - UEBERLAPPUNG)
      for (;;) {
        const cursor = cursorFor(table)
        const remote: any[] = (await request(
          url, anonKey, token,
          `${table}?server_rev=gt.${von}&order=server_rev.asc&limit=500`,
        )) ?? []
        if (!remote.length) break

        let hoechste = von
        for (const row of remote) {
          hoechste = Math.max(hoechste, Number(row.server_rev ?? 0))
          delete row.user_id                     // gehört nur dem Server
          if (istGeraetegebunden(table, row)) continue   // gehört nur diesem Gerät
          const local = localRow(table, row.id)
          if (!local) {
            // Vorher prüfen, ob der natürliche Schlüssel hier schon vergeben
            // ist – sonst löscht `INSERT OR REPLACE` die vorhandene Zeile
            // stillschweigend mit.
            const kollision = loeseSchluesselkollision(table, row)
            if (kollision.aufgeloest) aufgeloesteDubletten.push(`${table}/${kollision.aufgeloest}`)
            if (!kollision.einfuegen) { pulled++; continue }
            const cols = Object.keys(row)
            getDb().run(
              `INSERT OR REPLACE INTO ${table} (${cols.join(',')}, _dirty, _conflict) VALUES (${cols.map(() => '?').join(',')}, 0, 0)`,
              cols.map((c) => row[c]) as any,
            )
            pulled++
            continue
          }
          // Schon in genau dieser Fassung vorhanden (Ueberlappung): nichts tun.
          if (Number(local._dirty) === 0 && local.server_rev !== null && local.server_rev !== undefined
              && Number(local.server_rev) === Number(row.server_rev)) continue
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
          const lokalAend = lokaleAenderungen(table, row.id)
          const { merged, conflicted } = mergeRows(table, local, row, lokalAend.size ? lokalAend : undefined)
          const cols = Object.keys(merged).filter((c) => !c.startsWith('_') && c !== 'user_id')
          getDb().run(
            `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, _dirty = 1, _conflict = ? WHERE id = ?`,
            [...cols.map((c) => merged[c]), conflicted.length ? 1 : 0, row.id] as any,
          )
          if (conflicted.length) { recordConflict(table, row.id, local, row, conflicted); conflicts++ }
          pulled++
        }
        if (hoechste > cursor) setCursor(table, hoechste, 'pull')
        if (remote.length < 500 || hoechste <= von) break
        von = hoechste
      }
      // ---------------------------------------------------------------- PUSH
      // In Schüben, bis nichts Geändertes mehr übrig ist. Ein einzelner Schub
      // mit fester Obergrenze würde bei der ersten Übertragung stillschweigend
      // Zeilen liegen lassen.
      if (table === 'settings') {
        // Geraetegebundene Einstellungen gelten als erledigt, ohne gesendet zu
        // werden (siehe GERAETEGEBUNDENE_EINSTELLUNGEN).
        getDb().run(
          `UPDATE settings SET _dirty = 0 WHERE _dirty = 1 AND key IN (${GERAETEGEBUNDENE_EINSTELLUNGEN.map(() => '?').join(',')})`,
          [...GERAETEGEBUNDENE_EINSTELLUNGEN] as any,
        )
      }
      const size = pushBatchSize(table)
      // Obergrenze nur als Notbremse: Aendert sich dieselbe Zeile waehrend jedes
      // Uploads erneut, soll der Lauf irgendwann enden und beim naechsten
      // Abgleich weitermachen.
      for (let runde = 0; runde < 50; runde++) {
        const dirty = all<Record<string, any>>(`SELECT * FROM ${table} WHERE _dirty = 1 LIMIT ${size}`)
        if (!dirty.length) break
        berichtigt.push(...ganzzahlenBerichtigen(table, dirty))
        const payload = dirty.map(stripLocal)
        const saved = await request(url, anonKey, token, table, { method: 'POST', body: JSON.stringify(payload) })
        const byId = new Map<string, any>((saved ?? []).map((r: any) => [r.id, r]))
        for (const row of dirty) {
          const server = byId.get(row.id)
          // Den Serverstand der Zeile merken - das gilt fuer jede gesendete Zeile.
          getDb().run(
            `UPDATE ${table} SET server_rev = ? WHERE id = ?`,
            [server?.server_rev ?? row.server_rev ?? null, row.id] as any,
          )
          // Als „uebertragen" gilt NUR die Fassung, die tatsaechlich gesendet
          // wurde. Hat die Person die Zeile waehrend des Uploads erneut
          // geaendert, steht dort jetzt eine hoehere Version - dann bleibt sie
          // zur Uebertragung vorgemerkt. Vorher wurde jede Zeile des Schubs
          // bedingungslos auf „sauber" gesetzt und die neuere Aenderung ging
          // still verloren.
          getDb().run(
            `UPDATE ${table} SET _dirty = 0 WHERE id = ? AND version IS ?`,
            [row.id, row.version ?? null] as any,
          )
        }
        pushed += dirty.length
        if (dirty.length < size) break
      }
      // Das Aenderungsjournal gehoert zu den Zeilen, die noch zu senden sind -
      // nicht zur ganzen Tabelle. Eintraege zu Zeilen, die waehrend des Uploads
      // erneut geaendert wurden, bleiben deshalb stehen.
      getDb().run(
        `DELETE FROM change_log WHERE table_name = ? AND row_id NOT IN (SELECT id FROM ${table} WHERE _dirty = 1)`,
        [table] as any,
      )
      } catch (tabErr: any) {
        // Diese eine Tabelle scheitert – z. B. weil dem Server eine Spalte
        // fehlt, die diese Version der App schon schreibt. Die Zeilen bleiben
        // als "noch zu senden" markiert (change_log wurde für sie ja nicht
        // geleert) und werden beim nächsten Abgleich erneut versucht. Alle
        // anderen Tabellen laufen in DIESEM Lauf trotzdem normal weiter.
        if (tabErr instanceof TabelleFehltFehler) {
          // Acht fehlende Tabellen sind EIN Problem mit einer Ursache. Sie
          // einzeln aufzuzaehlen macht den Hinweis riesig und die Ursache
          // unkenntlich.
          fehlendeTabellen.push(table)
        } else {
          fehlgeschlagen.push({ tabelle: table, grund: String(tabErr?.message ?? tabErr) })
        }
      }
    }

    await saveNow()
    const parts = [`${pushed} gesendet`, `${pulled} empfangen`]
    if (conflicts) parts.push(`${conflicts} Konflikte`)
    // Berichtigte Werte gehören in die Meldung, auch wenn danach alles glatt
    // lief: Eine Zahl, die sich von selbst ändert, soll man nachlesen können.
    const hinweis = [
      berichtigungsText(berichtigt),
      aufgeloesteDubletten.length
        ? `${aufgeloesteDubletten.length} doppelt angelegte Zeile(n) zusammengeführt.`
        : '',
    ].filter(Boolean).join(' ')
    // Fehlende Tabellen wiegen schwerer als eine zickige: Sie haben eine
    // einzige Ursache, die Erik in einem Schritt beheben kann.
    if (fehlendeTabellen.length) {
      return ergebnis({
        zustand: 'schema_unvollstaendig',
        pushed, pulled, conflicts,
        fehlendeTabellen,
        fehler: fehlgeschlagen,
        message: schemaMeldung(fehlendeTabellen.length),
      })
    }
    if (fehlgeschlagen.length) {
      return ergebnis({
        zustand: 'teilweise',
        pushed, pulled, conflicts,
        fehler: fehlgeschlagen,
        message: `Teilweise synchronisiert (${parts.join(' · ')}). `
          + `${fehlgeschlagen.length === 1 ? 'Eine Tabelle' : `${fehlgeschlagen.length} Tabellen`} kam nicht durch.`
          + (hinweis ? ` ${hinweis}` : ''),
      })
    }
    return ergebnis({
      zustand: 'vollstaendig', pushed, pulled, conflicts,
      message: `Synchronisiert: ${parts.join(' · ')}` + (hinweis ? ` ${hinweis}` : ''),
    })
  } catch (err: any) {
    return ergebnis({
      zustand: 'fehler', pushed, pulled, conflicts,
      message: `Synchronisation fehlgeschlagen: ${err?.message ?? String(err)} Deine Daten sind lokal vollständig gespeichert.`,
    })
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
export function pullFresh(url: string, anonKey: string): Promise<SyncResult> {
  return mitSperre(() => pullFreshIntern(url, anonKey))
}

/**
 * Der lokale Bestand wird erst ersetzt, wenn der Serverstand vollstaendig da ist.
 *
 * Frueher wurde zuerst alles geloescht und gespeichert und DANN heruntergeladen.
 * Brach der Abruf ab (Funkloch, abgelaufene Anmeldung, fehlende Tabelle auf dem
 * Server), blieb ein leeres Geraet zurueck - samt verlorenen, noch nicht
 * gesendeten Aenderungen.
 *
 * Jetzt: Momentaufnahme des alten Bestands, Speichern auf die Platte gesperrt
 * (dort liegt bis zum Schluss der alte, vollstaendige Stand), Bestand im
 * Arbeitsspeicher leeren und neu fuellen. Nur wenn alles durchlief UND der
 * Server auch etwas geliefert hat, wird gespeichert. Sonst wird die
 * Momentaufnahme zurueckgespielt - einschliesslich der offenen Aenderungen.
 */
async function pullFreshIntern(url: string, anonKey: string): Promise<SyncResult> {
  if (!isSignedIn()) {
    return ergebnis({ zustand: 'nicht_angemeldet', message: 'Bitte zuerst anmelden.' })
  }
  const KEEP: string[] = [...GERAETEGEBUNDENE_EINSTELLUNGEN]
  let vorher: Uint8Array
  try {
    vorher = momentaufnahme()
  } catch (err: any) {
    return ergebnis({ zustand: 'fehler', message: `Konnte den lokalen Bestand nicht sichern: ${err?.message ?? err} Es wurde nichts verändert.` })
  }
  const offeneAenderungen = pendingChangeCount()

  let res: SyncResult
  sperrePersistenz(true)
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
    res = merkeStand(await runSyncIntern(url, anonKey))
    // Ein leerer Server ist kein Grund, ein Geraet mit ungesendeten Aenderungen
    // zu leeren - dafuer gibt es „Dieses Geraet als Quelle".
    if (res.ok && res.pulled === 0 && offeneAenderungen > 0) {
      res = ergebnis({
        zustand: 'fehler',
        message: 'Der Server hat nichts geliefert, dieses Gerät hat aber noch ungesendete Änderungen. '
          + 'Abgebrochen – nimm „Dieses Gerät als Quelle", wenn dieses Gerät die richtigen Daten hat.',
      })
    }
  } catch (err: any) {
    res = ergebnis({ zustand: 'fehler', message: `Übernahme fehlgeschlagen: ${err?.message ?? err}` })
  }

  if (!res.ok) {
    try {
      await stelleMomentaufnahmeWiederHer(vorher)
    } finally {
      sperrePersistenz(false)
    }
    await saveNow()
    return { ...res, ok: false, message: `${res.message} Dein bisheriger Bestand auf diesem Gerät ist unverändert (auch die noch nicht gesendeten Änderungen).` }
  }

  sperrePersistenz(false)
  await saveNow()
  setSyncRolle('kopie')
  return { ...res, message: `Vom Server übernommen: ${res.pulled} Datensätze.` }
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

/**
 * Liegt auf dem Server schon ein echter Bestand?
 *
 * Eine Zeile je Tabelle genügt – gefragt wird nicht „wie viel", sondern „über-
 * haupt etwas". Bei einem Fehler wird `null` geliefert: Dann wird nicht geraten,
 * sondern die Entscheidung dem Nutzer gelassen.
 */
async function serverHatBestand(
  url: string, anonKey: string, token: string,
): Promise<{ konten: boolean; buchungen: boolean } | null> {
  try {
    const [k, b] = await Promise.all([
      request(url, anonKey, token, 'accounts?select=id&limit=1'),
      request(url, anonKey, token, 'transactions?select=id&limit=1'),
    ])
    return { konten: Array.isArray(k) && k.length > 0, buchungen: Array.isArray(b) && b.length > 0 }
  } catch {
    return null
  }
}

/**
 * Dieses Gerät füllt den Server.
 *
 * Vorher wird nachgesehen, ob dort schon etwas liegt – und zwar aus einem
 * konkreten Anlass: Am 13.09.2026 wurde die Webfassung geöffnet, um FatSecret
 * zu verbinden. Sie legte beim ersten Start ihren Beispielbestand an, und
 * dieser Knopf schob ihn auf den Server, auf dem Eriks echte Konten lagen.
 * Danach stand jedes Konto doppelt da – einmal echt, einmal als Beispiel.
 *
 * Überschrieben wird dabei nichts (gesendet wird nur, nichts gelöscht), aber
 * verdoppelt: Gleiche Namen, verschiedene Kennungen, und der Abgleich kann sie
 * nicht als dasselbe erkennen.
 *
 * Die Bedingung ist bewusst eng. Abgelehnt wird nur der Fall, der nicht sinnvoll
 * sein KANN: Der Server hat Buchungen, dieses Gerät keine einzige. Wer hier
 * wirklich den Serverstand ersetzen will, hat vorher etwas eingespielt – und
 * dann hat er Buchungen.
 */
export function pushAll(url: string, anonKey: string): Promise<SyncResult> {
  return mitSperre(() => pushAllIntern(url, anonKey))
}

async function pushAllIntern(url: string, anonKey: string): Promise<SyncResult> {
  if (!isSignedIn()) {
    return ergebnis({ zustand: 'nicht_angemeldet', message: 'Bitte zuerst anmelden.' })
  }

  const token = await accessToken(url, anonKey)
  if (token) {
    const dort = await serverHatBestand(url, anonKey, token)
    const hierBuchungen = Number(
      all<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL')[0]?.n ?? 0,
    )
    if (dort?.buchungen && hierBuchungen === 0) {
      return ergebnis({
        zustand: 'fehler',
        message: 'Abgebrochen: Auf dem Server liegen schon Buchungen, auf diesem Gerät keine einzige. '
          + 'Dieses Gerät würde seinen Beispielbestand danebenlegen – danach stünde jedes Konto doppelt da. '
          + 'Nimm stattdessen „Dieses Gerät vom Server befüllen".',
      })
    }
  }

  try {
    for (const table of SYNCED_TABLES) {
      getDb().run(`UPDATE ${table} SET _dirty = 1`)
    }
    getDb().run('DELETE FROM sync_state')
    await saveNow()
  } catch (err: any) {
    return ergebnis({ zustand: 'fehler', message: `Vorbereitung fehlgeschlagen: ${err?.message ?? err}` })
  }
  const res = merkeStand(await runSyncIntern(url, anonKey))
  if (res.ok) setSyncRolle('quelle')
  return res.ok
    ? { ...res, message: `Auf den Server geladen: ${res.pushed} Datensätze.` }
    : res
}
