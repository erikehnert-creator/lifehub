/**
 * Import.
 * Grundsatz: nichts wird blind übernommen. Vor dem Schreiben gibt es eine
 * Vorschau mit Anzahl, Warnungen und Fehlern; nach dem Schreiben lässt sich
 * jeder Import über seine Batch-ID vollständig rückgängig machen.
 */
import { all, transaction } from '../db/sqlite'
import { insert, update, list } from '../db/repo'
import type { SyncedTable } from '../db/schema'
import { SYNCED_TABLES } from '../db/schema'
import { parseAmountToCents } from '../core/money'
import { todayString } from '../core/dates'
import { uuidv7 } from '../core/ids'

export interface ImportIssue {
  row: number
  level: 'error' | 'warning'
  message: string
  raw?: string
}

export interface ImportPreview {
  targetLabel: string
  columns: string[]
  mapping: Record<string, string>
  rows: Record<string, any>[]
  willImport: number
  willSkip: number
  issues: ImportIssue[]
}

/* ------------------------------------------------------- Trennzeichen-Datei */

export function parseDelimited(text: string): { columns: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/)[0] ?? ''
  const delim = [';', '\t', ','].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0]

  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delim) { cur.push(field); field = '' }
    else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur) }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const columns = (nonEmpty.shift() ?? []).map((c) => c.trim())
  return { columns, rows: nonEmpty }
}

/* ------------------------------------------------------------ Werteparser */

export function parseDayValue(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  // Excel-Seriennummer
  const n = Number(s)
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    return d.toISOString().slice(0, 10)
  }
  return null
}

/** Zahl robust lesen: "7,5", "7.5", "7:30" (→ 7,5 Stunden), "1.234,5". */
export function parseNumberValue(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const time = s.match(/^(\d{1,2}):(\d{2})$/)
  if (time) return Number(time[1]) + Number(time[2]) / 60
  const cents = parseAmountToCents(s)
  return cents === null ? null : cents / 100
}

/* --------------------------------------------- Zuordnung automatisch raten */

const METRIC_HINTS: Record<string, string[]> = {
  weight_kg: ['gewicht', 'weight', 'kg'],
  calories: ['kalorien', 'kcal', 'calories', 'energie kcal'],
  protein_g: ['protein', 'eiweiß', 'eiweiss'],
  carbs_g: ['kohlenhydrate', 'carbs', 'kh'],
  fat_g: ['fett', 'fat'],
  water_l: ['wasser', 'water', 'trinken'],
  sleep_h: ['schlaf', 'sleep'],
  sleep_quality: ['schlafqualität', 'schlafqualitaet', 'sleep quality'],
  steps: ['schritte', 'steps'],
  energy: ['energie', 'energy'],
  skin: ['haut', 'skin'],
  mood: ['stimmung', 'mood', 'laune'],
}

export function guessMetricMapping(columns: string[], metricKeys: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const col of columns) {
    const low = col.toLowerCase().trim()
    if (/datum|date|tag/.test(low)) { map[col] = '__day'; continue }
    if (/notiz|note|kommentar/.test(low)) { map[col] = '__note'; continue }
    let best: string | null = null
    for (const [key, hints] of Object.entries(METRIC_HINTS)) {
      if (!metricKeys.includes(key)) continue
      if (hints.some((h) => low.includes(h))) { best = key; break }
    }
    map[col] = best ?? '__ignore'
  }
  return map
}

export function guessTransactionMapping(columns: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const col of columns) {
    const low = col.toLowerCase().trim()
    if (/datum|buchungstag|date|valuta/.test(low)) map[col] = 'booked_on'
    else if (/betrag|amount|umsatz/.test(low)) map[col] = 'amount'
    else if (/kategorie|category/.test(low)) map[col] = 'category'
    else if (/empfänger|empfaenger|händler|haendler|merchant|beguenstigter|begünstigter|auftraggeber/.test(low)) map[col] = 'merchant'
    else if (/verwendungszweck|beschreibung|description|text/.test(low)) map[col] = 'description'
    else if (/konto|account|iban/.test(low)) map[col] = 'account'
    else if (/notiz|note/.test(low)) map[col] = 'note'
    else map[col] = '__ignore'
  }
  return map
}

/* --------------------------------------------------------------- Vorschau */

export function previewMetricImport(
  columns: string[], rows: string[][], mapping: Record<string, string>,
  metrics: { id: string; key: string; name: string }[],
  existing: { metric_id: string; day: string }[],
): ImportPreview {
  const issues: ImportIssue[] = []
  const out: Record<string, any>[] = []
  const dayCol = columns.find((c) => mapping[c] === '__day')
  const noteCol = columns.find((c) => mapping[c] === '__note')
  const metricByKey = new Map(metrics.map((m) => [m.key, m]))
  const existingSet = new Set(existing.map((e) => `${e.metric_id}|${e.day}`))
  const seenDays = new Set<string>()

  if (!dayCol) {
    issues.push({ row: 0, level: 'error', message: 'Keine Datumsspalte zugeordnet – ohne Datum ist kein Import möglich.' })
    return { targetLabel: 'Tracking-Werte', columns, mapping, rows: [], willImport: 0, willSkip: rows.length, issues }
  }

  rows.forEach((r, i) => {
    const rowNo = i + 2
    const rawDay = r[columns.indexOf(dayCol)] ?? ''
    const day = parseDayValue(rawDay)
    if (!day) {
      if (rawDay.trim()) issues.push({ row: rowNo, level: 'error', message: 'Datum nicht lesbar', raw: rawDay })
      return
    }
    if (day > todayString()) issues.push({ row: rowNo, level: 'warning', message: 'Datum liegt in der Zukunft', raw: day })
    if (seenDays.has(day)) issues.push({ row: rowNo, level: 'warning', message: 'Datum kommt mehrfach vor', raw: day })
    seenDays.add(day)

    const values: { metricId: string; key: string; value: number }[] = []
    for (const col of columns) {
      const target = mapping[col]
      if (!target || target.startsWith('__')) continue
      const metric = metricByKey.get(target)
      if (!metric) continue
      const raw = r[columns.indexOf(col)] ?? ''
      if (!raw.trim()) continue
      const v = parseNumberValue(raw)
      if (v === null) {
        issues.push({ row: rowNo, level: 'warning', message: `${metric.name}: Wert nicht lesbar`, raw })
        continue
      }
      if (existingSet.has(`${metric.id}|${day}`)) {
        issues.push({ row: rowNo, level: 'warning', message: `${metric.name}: Eintrag für ${day} existiert bereits – wird überschrieben` })
      }
      values.push({ metricId: metric.id, key: metric.key, value: v })
    }
    if (!values.length) return
    out.push({ day, note: noteCol ? r[columns.indexOf(noteCol)] || null : null, values })
  })

  return {
    targetLabel: 'Tracking-Werte',
    columns, mapping, rows: out,
    willImport: out.reduce((s, r) => s + r.values.length, 0),
    willSkip: rows.length - out.length,
    issues,
  }
}

export function previewTransactionImport(
  columns: string[], rows: string[][], mapping: Record<string, string>,
  accounts: { id: string; name: string }[], categories: { id: string; name: string; kind: string }[],
  defaultAccountId: string,
): ImportPreview {
  const issues: ImportIssue[] = []
  const out: Record<string, any>[] = []
  const col = (target: string) => columns.find((c) => mapping[c] === target)
  const dayCol = col('booked_on'), amountCol = col('amount')

  if (!dayCol || !amountCol) {
    issues.push({ row: 0, level: 'error', message: 'Datum und Betrag müssen zugeordnet sein.' })
    return { targetLabel: 'Buchungen', columns, mapping, rows: [], willImport: 0, willSkip: rows.length, issues }
  }
  const idx = (c?: string) => (c ? columns.indexOf(c) : -1)
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
  const accByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]))

  rows.forEach((r, i) => {
    const rowNo = i + 2
    const day = parseDayValue(r[idx(dayCol)] ?? '')
    const centsValue = parseAmountToCents(r[idx(amountCol)] ?? '')
    if (!day) { issues.push({ row: rowNo, level: 'error', message: 'Datum nicht lesbar', raw: r[idx(dayCol)] }); return }
    if (centsValue === null || centsValue === 0) { issues.push({ row: rowNo, level: 'error', message: 'Betrag nicht lesbar', raw: r[idx(amountCol)] }); return }

    const catName = idx(col('category')) >= 0 ? (r[idx(col('category'))] ?? '').trim() : ''
    const cat = catName ? catByName.get(catName.toLowerCase()) : undefined
    if (catName && !cat) issues.push({ row: rowNo, level: 'warning', message: `Kategorie „${catName}" unbekannt – wird angelegt` })

    const accName = idx(col('account')) >= 0 ? (r[idx(col('account'))] ?? '').trim() : ''
    const acc = accName ? accByName.get(accName.toLowerCase()) : undefined

    out.push({
      booked_on: day,
      type: centsValue < 0 ? 'expense' : 'income',
      amount_cents: Math.abs(centsValue),
      account_id: acc?.id ?? defaultAccountId,
      category_id: cat?.id ?? null,
      newCategoryName: cat ? null : catName || null,
      merchant: idx(col('merchant')) >= 0 ? r[idx(col('merchant'))] || null : null,
      description: idx(col('description')) >= 0 ? r[idx(col('description'))] || null : null,
      note: idx(col('note')) >= 0 ? r[idx(col('note'))] || null : null,
    })
  })

  // Dubletten innerhalb der Datei markieren
  const seen = new Set<string>()
  out.forEach((r, i) => {
    const key = `${r.booked_on}|${r.amount_cents}|${r.merchant ?? ''}`
    if (seen.has(key)) issues.push({ row: i + 2, level: 'warning', message: 'Mögliche Dublette (gleiches Datum, Betrag, Händler)' })
    seen.add(key)
  })

  return {
    targetLabel: 'Buchungen', columns, mapping, rows: out,
    willImport: out.length, willSkip: rows.length - out.length, issues,
  }
}

/* --------------------------------------------------------------- Ausführen */

export function runMetricImport(preview: ImportPreview, filename: string): { batchId: string; count: number } {
  const batchId = uuidv7()
  let count = 0
  transaction(() => {
    insert('import_batches', {
      id: batchId, source: 'xlsx', filename,
      mapping_json: JSON.stringify(preview.mapping),
      row_count: preview.willImport, skipped_count: preview.willSkip,
      imported_at: new Date().toISOString(),
    })
    const existing = list<{ id: string; metric_id: string; day: string }>('metric_entries')
    const byKey = new Map(existing.map((e) => [`${e.metric_id}|${e.day}`, e.id]))
    for (const row of preview.rows) {
      for (const v of row.values) {
        const found = byKey.get(`${v.metricId}|${row.day}`)
        if (found) update('metric_entries', found, { value_num: v.value, source: 'import', import_batch_id: batchId })
        else insert('metric_entries', {
          metric_id: v.metricId, day: row.day, value_num: v.value,
          note: row.note, source: 'import', import_batch_id: batchId,
        })
        count++
      }
    }
  })
  return { batchId, count }
}

export function runTransactionImport(preview: ImportPreview, filename: string): { batchId: string; count: number } {
  const batchId = uuidv7()
  let count = 0
  transaction(() => {
    insert('import_batches', {
      id: batchId, source: 'csv', filename,
      mapping_json: JSON.stringify(preview.mapping),
      row_count: preview.willImport, skipped_count: preview.willSkip,
      imported_at: new Date().toISOString(),
    })
    const newCats = new Map<string, string>()
    for (const row of preview.rows) {
      let categoryId = row.category_id
      if (!categoryId && row.newCategoryName) {
        const key = row.newCategoryName.toLowerCase()
        if (!newCats.has(key)) {
          newCats.set(key, insert('categories', {
            name: row.newCategoryName, kind: row.type === 'income' ? 'income' : 'expense',
            parent_id: null, is_archived: 0, is_system: 0, exclude_from_stats: 0, sort_order: 900,
          }))
        }
        categoryId = newCats.get(key)!
      }
      insert('transactions', {
        type: row.type, booked_on: row.booked_on, amount_cents: row.amount_cents,
        currency: 'EUR', account_id: row.account_id, to_account_id: null,
        category_id: categoryId, merchant: row.merchant, description: row.description,
        note: row.note, status: 'booked', import_batch_id: batchId,
      })
      count++
    }
  })
  return { batchId, count }
}

/** Import vollständig zurücknehmen. */
export function undoImport(batchId: string): number {
  let n = 0
  transaction(() => {
    for (const table of ['transactions', 'metric_entries'] as SyncedTable[]) {
      const rows = all<{ id: string }>(`SELECT id FROM ${table} WHERE import_batch_id = ?`, [batchId])
      for (const r of rows) {
        update(table, r.id, { deleted_at: new Date().toISOString() })
        n++
      }
    }
    update('import_batches', batchId, { undone_at: new Date().toISOString() })
  })
  return n
}

/** Vollständige Wiederherstellung aus einem JSON-Export. */
/**
 * Einstellungen, die zum Gerät gehören und nicht zum Datenbestand:
 * Serverzugang und Sperrbildschirm. Beim Ersetzen bleiben sie erhalten, sofern
 * die eingespielte Datei sie nicht selbst mitbringt.
 *
 * Ohne diese Ausnahme trennt eine Wiederherstellung das Gerät stillschweigend
 * vom Server – man spielt seine Daten ein und wundert sich, warum der Abgleich
 * plötzlich nicht mehr geht.
 */
const GERAETE_EINSTELLUNGEN = ['sync_url', 'sync_key', 'pin_hash', 'pin_salt', 'lock_after_minutes']

export function importFullJson(json: string, mode: 'replace' | 'merge'): { tables: number; rows: number } {
  const payload = JSON.parse(json)
  if (!payload?.tables) throw new Error('Die Datei enthält keinen erkennbaren LifeHub-Export.')
  let tables = 0
  let rows = 0

  const bewahrt = mode === 'replace'
    ? all<{ id: string; key: string; value_json: string }>(
        `SELECT id, key, value_json FROM settings WHERE key IN (${GERAETE_EINSTELLUNGEN.map(() => '?').join(',')})`,
        GERAETE_EINSTELLUNGEN,
      )
    : []

  transaction(() => {
    for (const t of SYNCED_TABLES) {
      const list = payload.tables[t]
      if (!Array.isArray(list)) continue
      tables++
      if (mode === 'replace') all(`DELETE FROM ${t}`)
      for (const row of list) {
        const clean: Record<string, any> = {}
        for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) clean[k] = v
        const cols = Object.keys(clean)
        const exists = mode === 'merge'
          ? all(`SELECT id FROM ${t} WHERE id = ?`, [clean.id]).length > 0
          : false
        if (exists) continue
        all(
          `INSERT OR REPLACE INTO ${t} (${cols.join(',')}, _dirty, _conflict) VALUES (${cols.map(() => '?').join(',')}, 1, 0)`,
          cols.map((c) => clean[c]),
        )
        rows++
      }
    }

    // Gerätebezogene Einstellungen zurückschreiben, falls die Datei sie nicht mitbrachte
    for (const alt of bewahrt) {
      const vorhanden = all(`SELECT id FROM settings WHERE key = ?`, [alt.key])
      if (vorhanden.length) continue
      const jetzt = new Date().toISOString()
      all(
        `INSERT OR REPLACE INTO settings
           (id, key, value_json, created_at, updated_at, deleted_at, version, last_device_id, server_rev, _dirty, _conflict)
         VALUES (?, ?, ?, ?, ?, NULL, 1, '', NULL, 1, 0)`,
        [alt.id, alt.key, alt.value_json, jetzt, jetzt],
      )
    }
  })
  return { tables, rows }
}
