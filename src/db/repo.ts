/**
 * Generische Repository-Schicht.
 * Setzt Basisfelder, führt das Änderungsjournal (Outbox) und erzwingt Soft Delete.
 * Kein Modul der Anwendung schreibt direkt SQL-INSERT/UPDATE.
 */
import { all, one, run, getDb, scheduleSave } from './sqlite'
import { uuidv7 } from '../core/ids'
import { nowIso } from '../core/dates'
import type { SyncedTable } from './schema'

let deviceId = 'local'
export function setDeviceId(id: string) {
  deviceId = id
}
export function getDeviceId() {
  return deviceId
}

function logChange(table: string, rowId: string, op: 'insert' | 'update' | 'delete', fields: Record<string, any>, baseVersion: number) {
  getDb().run(
    `INSERT INTO change_log (table_name, row_id, op, changed_fields, base_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [table, rowId, op, JSON.stringify(fields), baseVersion, nowIso()] as any,
  )
}

export function insert<T extends Record<string, any>>(table: SyncedTable, data: T): string {
  const id = (data.id as string) || uuidv7()
  const ts = nowIso()
  const record: Record<string, any> = {
    ...data,
    id,
    created_at: data.created_at ?? ts,
    updated_at: ts,
    deleted_at: null,
    version: 1,
    last_device_id: deviceId,
    server_rev: null,
    _dirty: 1,
    _conflict: 0,
  }
  const keys = Object.keys(record)
  const placeholders = keys.map(() => '?').join(', ')
  getDb().run(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
    keys.map((k) => normalise(record[k])) as any,
  )
  logChange(table, id, 'insert', record, 0)
  scheduleSave()
  return id
}

export function update(table: SyncedTable, id: string, patch: Record<string, any>): void {
  const current = one<Record<string, any>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  if (!current) throw new Error(`${table}/${id} nicht gefunden`)
  const ts = nowIso()
  const changed: Record<string, any> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k.startsWith('_')) continue
    if (current[k] !== v) changed[k] = v
  }
  if (Object.keys(changed).length === 0) return
  changed.updated_at = ts
  changed.version = Number(current.version || 1) + 1
  changed.last_device_id = deviceId
  const sets = Object.keys(changed).map((k) => `${k} = ?`).join(', ')
  getDb().run(
    `UPDATE ${table} SET ${sets}, _dirty = 1 WHERE id = ?`,
    [...Object.keys(changed).map((k) => normalise(changed[k])), id] as any,
  )
  logChange(table, id, 'update', changed, Number(current.version || 1))
  scheduleSave()
}

/** Soft Delete – der Datensatz bleibt für Papierkorb und Synchronisation erhalten. */
export function softDelete(table: SyncedTable, id: string): void {
  const current = one<Record<string, any>>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  if (!current) return
  const ts = nowIso()
  getDb().run(
    `UPDATE ${table} SET deleted_at = ?, updated_at = ?, version = version + 1,
     last_device_id = ?, _dirty = 1 WHERE id = ?`,
    [ts, ts, deviceId, id] as any,
  )
  logChange(table, id, 'delete', { deleted_at: ts }, Number(current.version || 1))
  scheduleSave()
}

export function restore(table: SyncedTable, id: string): void {
  const ts = nowIso()
  getDb().run(
    `UPDATE ${table} SET deleted_at = NULL, updated_at = ?, version = version + 1,
     last_device_id = ?, _dirty = 1 WHERE id = ?`,
    [ts, deviceId, id] as any,
  )
  logChange(table, id, 'update', { deleted_at: null }, 0)
  scheduleSave()
}

export function hardDelete(table: SyncedTable, id: string): void {
  getDb().run(`DELETE FROM ${table} WHERE id = ?`, [id] as any)
  scheduleSave()
}

export function list<T = Record<string, any>>(
  table: SyncedTable,
  opts: { where?: string; params?: any[]; orderBy?: string; limit?: number; includeDeleted?: boolean } = {},
): T[] {
  const clauses: string[] = []
  if (!opts.includeDeleted) clauses.push('deleted_at IS NULL')
  if (opts.where) clauses.push(`(${opts.where})`)
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const order = opts.orderBy ? `ORDER BY ${opts.orderBy}` : ''
  const limit = opts.limit ? `LIMIT ${opts.limit}` : ''
  return all<T>(`SELECT * FROM ${table} ${where} ${order} ${limit}`, opts.params ?? [])
}

export function byId<T = Record<string, any>>(table: SyncedTable, id: string): T | null {
  return one<T>(`SELECT * FROM ${table} WHERE id = ?`, [id])
}

/** Legt an oder aktualisiert – anhand eines eindeutigen Schlüsselfeldes. */
export function upsertByKey(table: SyncedTable, keyField: string, keyValue: any, data: Record<string, any>): string {
  const existing = one<Record<string, any>>(
    `SELECT * FROM ${table} WHERE ${keyField} = ? AND deleted_at IS NULL`,
    [keyValue],
  )
  if (existing) {
    update(table, existing.id, data)
    return existing.id
  }
  return insert(table, { ...data, [keyField]: keyValue })
}

function normalise(v: any): any {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

export { run, all, one }
