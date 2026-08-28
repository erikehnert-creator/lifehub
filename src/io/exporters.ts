/**
 * Export – deine Daten müssen jederzeit vollständig und lesbar herauskommen.
 * Leitformat ist JSON mit versioniertem Schema; CSV und XLSX-kompatible
 * Tabellen für Tabellenkalkulationen.
 */
import { all, exportDatabaseFile } from '../db/sqlite'
import { SYNCED_TABLES } from '../db/schema'
import type { AppData } from '../state/store'
import { accountBalances, monthTotals, totalsByCategory, budgetProgress } from '../core/finance'
import { toEuro } from '../core/money'
import { monthStart, monthEnd, monthOf, todayString, lastMonths } from '../core/dates'

export const EXPORT_SCHEMA_VERSION = '1.0'

export interface ExportOptions {
  from?: string | null
  to?: string | null
  includeDeleted?: boolean
  tables?: string[]
}

/** Vollexport: alle Tabellen, alle Felder. Import stellt exakt dies wieder her. */
export function exportFullJson(opts: ExportOptions = {}): string {
  const tables = opts.tables ?? [...SYNCED_TABLES]
  const payload: Record<string, any> = {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    app: 'LifeHub',
    amounts_in: 'cents',
    currency: 'EUR',
    tables: {},
  }
  for (const t of tables) {
    const where = opts.includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    payload.tables[t] = all(`SELECT * FROM ${t} ${where}`).map(stripLocal)
  }
  return JSON.stringify(payload, null, 2)
}

function stripLocal(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) out[k] = v
  return out
}

/**
 * Auswertungsexport für KI und Tabellenkalkulation: vorberechnete Kennzahlen
 * statt Rohdaten, damit eine Auswertung nicht die Fachlogik nachbauen muss.
 */
export function exportSummaryJson(data: AppData, months = 12): string {
  const today = todayString()
  const monthList = lastMonths(monthOf(today), months)
  const balances = accountBalances(data.accounts, data.transactions)

  return JSON.stringify({
    schema_version: EXPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    currency: 'EUR',
    amounts_in: 'cents',
    accounts: data.accounts.filter((a) => !a.deleted_at).map((a) => ({
      id: a.id, name: a.name, type: a.type,
      balance_cents: balances.get(a.id) ?? 0,
      counts_as_savings: !!a.counts_as_savings,
      counts_as_available: !!a.counts_as_available,
    })),
    months: monthList.map((m) => {
      const t = monthTotals(data.transactions, m)
      return {
        month: m,
        income_cents: t.income,
        expense_cents: t.expense,
        savings_cents: t.savings,
        savings_rate_percent: t.savingsRatePercent,
        transfer_volume_cents: t.transferVolume,
        transactions: t.transactionCount,
        by_category: totalsByCategory(data.transactions, data.categories, monthStart(m), monthEnd(m))
          .map((c) => ({ category: c.name, expense_cents: c.amount, share_percent: c.share })),
      }
    }),
    budgets: budgetProgress(data.budgets, data.transactions, data.categories, monthOf(today), today)
      .map((b) => ({
        category: b.categoryName, limit_cents: b.limit, spent_cents: b.spent,
        used_percent: b.usedPercent, status: b.status,
      })),
    open_tasks: data.tasks.filter((t) => !t.deleted_at && t.status !== 'done' && t.status !== 'cancelled')
      .map((t) => ({
        id: t.id, title: t.title, due_on: t.due_on, scheduled_on: t.scheduled_on,
        duration_minutes: t.duration_minutes, priority: t.priority, bucket: t.bucket,
      })),
    metrics: data.metrics.filter((m) => !m.deleted_at && m.is_enabled).map((m) => {
      const entries = data.metricEntries.filter((e) => !e.deleted_at && e.metric_id === m.id)
      return {
        key: m.key, name: m.name, unit: m.unit, aggregation: m.aggregation,
        entry_count: entries.length,
        series: entries.slice(-370).map((e) => ({ day: e.day, value: e.value_num })),
      }
    }),
    goals: data.goals.filter((g) => !g.deleted_at).map((g) => ({
      name: g.name, domain: g.domain, kind: g.goal_kind,
      start_value: g.start_value, target_value: g.target_value,
      start_on: g.start_on, target_on: g.target_on, status: g.status,
    })),
  }, null, 2)
}

/** CSV mit Semikolon und BOM – so öffnet Excel die Datei in Deutschland korrekt. */
export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows.length) return '﻿'
  const cols = columns ?? Object.keys(rows[0])
  const esc = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))]
  return '﻿' + lines.join('\r\n')
}

export function exportTransactionsCsv(data: AppData): string {
  const acc = new Map(data.accounts.map((a) => [a.id, a.name]))
  const cat = new Map(data.categories.map((c) => [c.id, c.name]))
  const rows = data.transactions
    .filter((t) => !t.deleted_at)
    .map((t) => ({
      Datum: t.booked_on,
      Typ: t.type === 'income' ? 'Einnahme' : t.type === 'expense' ? 'Ausgabe' : 'Transfer',
      Betrag: toEuro(t.amount_cents).toFixed(2).replace('.', ','),
      Waehrung: t.currency,
      Konto: acc.get(t.account_id) ?? '',
      Zielkonto: t.to_account_id ? acc.get(t.to_account_id) ?? '' : '',
      Kategorie: t.category_id ? cat.get(t.category_id) ?? '' : '',
      Haendler: t.merchant ?? '',
      Beschreibung: t.description ?? '',
      Notiz: t.note ?? '',
      Status: t.status,
    }))
  return toCsv(rows)
}

export function exportMetricsCsv(data: AppData): string {
  const byKey = new Map(data.metrics.map((m) => [m.id, m]))
  const days = new Map<string, Record<string, any>>()
  for (const e of data.metricEntries) {
    if (e.deleted_at || e.value_num === null) continue
    const m = byKey.get(e.metric_id)
    if (!m) continue
    const row = days.get(e.day) ?? { Datum: e.day }
    const prev = row[m.name]
    row[m.name] = m.aggregation === 'sum' && typeof prev === 'number' ? prev + e.value_num : e.value_num
    days.set(e.day, row)
  }
  const cols = ['Datum', ...data.metrics.filter((m) => !m.deleted_at).map((m) => m.name)]
  const rows = [...days.values()].sort((a, b) => (a.Datum < b.Datum ? -1 : 1))
    .map((r) => {
      const out: Record<string, any> = {}
      for (const c of cols) out[c] = r[c] !== undefined ? String(r[c]).replace('.', ',') : ''
      return out
    })
  return toCsv(rows, cols)
}

export function exportTasksCsv(data: AppData): string {
  const rows = data.tasks.filter((t) => !t.deleted_at).map((t) => ({
    Titel: t.title, Status: t.status, Ablage: t.bucket,
    Geplant: t.scheduled_on ?? '', Faellig: t.due_on ?? '',
    Dauer_Minuten: t.duration_minutes ?? '', Prioritaet: t.priority,
    Erledigt_am: t.completed_at ?? '', Beschreibung: t.description ?? '',
  }))
  return toCsv(rows)
}

/** Rohe SQLite-Datei – vollständige technische Kopie. */
export function exportSqlite(): Uint8Array {
  return exportDatabaseFile()
}

export function download(filename: string, content: string | Uint8Array, mime = 'application/octet-stream'): void {
  const blob = content instanceof Uint8Array
    ? new Blob([content.slice().buffer as ArrayBuffer], { type: mime })
    : new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function timestampSuffix(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}
