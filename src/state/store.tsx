/**
 * Anwendungszustand.
 *
 * Der vollständige Datenbestand einer Person passt bequem in den Speicher.
 * Deshalb: beim Start alles laden, bei jeder Änderung in SQLite schreiben und
 * neu laden. Das ist bewusst einfach – ein Datenpfad, keine Cache-Invalidierung,
 * keine Zustände, die auseinanderlaufen können.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { initDatabase, onSaveStateChange, saveNow } from '../db/sqlite'
import { list, setDeviceId, insert, update, softDelete, restore, upsertByKey, byId, hardDelete, existsById } from '../db/repo'
import { seedIfEmpty, ensureBuiltinMetrics, ensureCategoryColors } from '../db/seed'
import type { SyncedTable } from '../db/schema'
import type {
  Account, Category, Transaction, Budget, Task, CalendarEvent, DayType, DayAssignment,
  TimeBlock, Metric, MetricEntry, MetricTarget, Goal, RecurringRule, Exercise,
  WorkoutPlan, WorkoutPlanDay, WorkoutSession, WorkoutSet, BodyMeasurement, Insight,
  ShoppingItem, DayNote, Investment, InvestmentMove, FoodEntry,
} from '../core/types'
import { uuidv7, shortId } from '../core/ids'
import { todayString } from '../core/dates'
import type { LayoutPref } from '../core/layout'

/* ----------------------------------------------------------- Einstellungen */

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  state: string
  sleep_hours: number
  waking_start: string
  waking_end: string
  default_account_id: string | null
  month_start_day: number
  user_name: string
  /**
   * Frei anpassbare Seiten: je Seiten-ID (z. B. "heute"), welche Karten
   * sichtbar sind und in welcher Reihenfolge. Eine ganz normale Einstellung
   * wie sync_url auch – läuft über denselben Schlüssel/Wert-Speicher und
   * damit ganz von selbst über den normalen Abgleich mit, damit Handy und
   * PC dieselbe Ansicht zeigen. Fehlt ein Eintrag für eine Seite, gilt die
   * Standardanordnung dieser Seite (siehe resolveLayout in core/layout.ts).
   */
  layout_prefs: Record<string, LayoutPref>
  finance_day_interval: 'weekly' | 'monthly'
  sync_url: string
  sync_key: string
  pin_hash: string
  pin_salt: string
  lock_after_minutes: number
  /** Fällige wiederkehrende Zahlungen beim Öffnen von selbst buchen. */
  auto_book_recurring: boolean
  /** Offene Aufgaben von gestern auf heute mitnehmen. */
  carry_over_tasks: boolean
  /** Aufgaben aus Vorlagen von selbst einplanen (vier Wochen im Voraus). */
  auto_plan_templates: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  state: 'SN',
  sleep_hours: 8,
  waking_start: '07:00',
  waking_end: '22:00',
  default_account_id: null,
  month_start_day: 1,
  user_name: '',
  layout_prefs: {},
  finance_day_interval: 'monthly',
  sync_url: '',
  sync_key: '',
  pin_hash: '',
  pin_salt: '',
  lock_after_minutes: 0,
  auto_book_recurring: true,
  carry_over_tasks: true,
  auto_plan_templates: true,
}

/* --------------------------------------------------------------- Datenbild */

export interface AppData {
  settings: AppSettings
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  recurring: RecurringRule[]
  tasks: Task[]
  projects: any[]
  events: CalendarEvent[]
  dayTypes: DayType[]
  dayAssignments: DayAssignment[]
  shiftPatterns: any[]
  holidays: any[]
  timeBlocks: TimeBlock[]
  metrics: Metric[]
  metricEntries: MetricEntry[]
  metricTargets: MetricTarget[]
  exercises: Exercise[]
  workoutPlans: WorkoutPlan[]
  workoutPlanDays: WorkoutPlanDay[]
  workoutPlanExercises: any[]
  workoutSessions: WorkoutSession[]
  workoutSets: WorkoutSet[]
  bodyMeasurements: BodyMeasurement[]
  dayNotes: DayNote[]
  investments: Investment[]
  investmentMoves: InvestmentMove[]
  goals: Goal[]
  goalContributions: any[]
  taskTemplates: any[]
  accountChecks: any[]
  notes: any[]
  insights: Insight[]
  financeDayRuns: any[]
  monthlyClosings: any[]
  attachments: any[]
  importBatches: any[]
  shopping: ShoppingItem[]
  /** Einzelne gegessene Lebensmittel – die Begründung hinter den Tageswerten. */
  foodEntries: FoodEntry[]
}

const EMPTY: AppData = {
  settings: DEFAULT_SETTINGS,
  accounts: [], categories: [], transactions: [], budgets: [], recurring: [],
  tasks: [], projects: [], events: [], dayTypes: [], dayAssignments: [],
  shiftPatterns: [], holidays: [], timeBlocks: [], metrics: [], metricEntries: [],
  metricTargets: [], exercises: [], workoutPlans: [], workoutPlanDays: [],
  workoutPlanExercises: [], workoutSessions: [], workoutSets: [], bodyMeasurements: [],
  dayNotes: [],
  investments: [], investmentMoves: [],
  goals: [], goalContributions: [], taskTemplates: [], accountChecks: [], notes: [], insights: [], financeDayRuns: [],
  monthlyClosings: [], attachments: [], importBatches: [], shopping: [], foodEntries: [],
}

/**
 * Welche Tabelle hinter welchem Feld des Datenbildes steckt – an EINER Stelle.
 *
 * Vorher stand diese Zuordnung nur implizit in einem vierzigzeiligen
 * `loadAll()`. Damit ließ sich nur alles oder nichts nachladen: Ein Haken an
 * einer Aufgabe las auch 12.000 Lebensmittel und 20.000 Messwerte neu. Als
 * Liste ist dieselbe Zuordnung auch rückwärts benutzbar – „lade genau die
 * Tabellen, die sich geändert haben".
 */
interface Lader {
  key: Exclude<keyof AppData, 'settings'>
  table: SyncedTable
  orderBy?: string
}

const LADER: Lader[] = [
  { key: 'accounts', table: 'accounts', orderBy: 'sort_order, name' },
  { key: 'categories', table: 'categories', orderBy: 'sort_order, name' },
  { key: 'transactions', table: 'transactions', orderBy: 'booked_on DESC, created_at DESC' },
  { key: 'budgets', table: 'budgets' },
  { key: 'recurring', table: 'recurring_rules', orderBy: 'title' },
  { key: 'tasks', table: 'tasks', orderBy: 'sort_order, created_at DESC' },
  { key: 'projects', table: 'projects', orderBy: 'name' },
  { key: 'events', table: 'calendar_events', orderBy: 'day, start_time' },
  { key: 'dayTypes', table: 'day_types', orderBy: 'sort_order' },
  { key: 'dayAssignments', table: 'day_assignments', orderBy: 'day' },
  { key: 'shiftPatterns', table: 'shift_patterns' },
  { key: 'holidays', table: 'holidays', orderBy: 'day' },
  { key: 'timeBlocks', table: 'time_blocks', orderBy: 'day, start_time' },
  { key: 'metrics', table: 'metrics', orderBy: 'sort_order' },
  { key: 'metricEntries', table: 'metric_entries', orderBy: 'day' },
  { key: 'metricTargets', table: 'metric_targets' },
  { key: 'exercises', table: 'exercises', orderBy: 'name' },
  { key: 'workoutPlans', table: 'workout_plans' },
  { key: 'workoutPlanDays', table: 'workout_plan_days', orderBy: 'week_index, weekday' },
  { key: 'workoutPlanExercises', table: 'workout_plan_exercises', orderBy: 'sort_order' },
  { key: 'workoutSessions', table: 'workout_sessions', orderBy: 'day DESC' },
  { key: 'workoutSets', table: 'workout_sets', orderBy: 'set_index' },
  { key: 'bodyMeasurements', table: 'body_measurements', orderBy: 'day DESC' },
  { key: 'dayNotes', table: 'day_notes', orderBy: 'day DESC' },
  { key: 'investments', table: 'investments', orderBy: 'name' },
  { key: 'investmentMoves', table: 'investment_moves', orderBy: 'day DESC' },
  { key: 'goals', table: 'goals' },
  { key: 'goalContributions', table: 'goal_contributions', orderBy: 'day DESC' },
  { key: 'taskTemplates', table: 'task_templates', orderBy: 'weekday, title' },
  { key: 'accountChecks', table: 'account_checks', orderBy: 'day DESC' },
  { key: 'notes', table: 'notes', orderBy: 'created_at DESC' },
  { key: 'insights', table: 'insights', orderBy: 'created_at DESC' },
  { key: 'financeDayRuns', table: 'finance_day_runs', orderBy: 'ran_on DESC' },
  { key: 'monthlyClosings', table: 'monthly_closings', orderBy: 'year_month DESC' },
  { key: 'attachments', table: 'attachments' },
  { key: 'importBatches', table: 'import_batches', orderBy: 'imported_at DESC' },
  { key: 'shopping', table: 'shopping_items', orderBy: 'is_checked, sort_order, name' },
  { key: 'foodEntries', table: 'food_entries', orderBy: 'day DESC, meal, sort_order' },
]

function ladeEinstellungen(): AppSettings {
  const settingRows = list<{ key: string; value_json: string }>('settings')
  const settings: any = { ...DEFAULT_SETTINGS }
  for (const r of settingRows) {
    try { settings[r.key] = JSON.parse(r.value_json) } catch { /* defekter Eintrag wird ignoriert */ }
  }
  return settings as AppSettings
}

function loadAll(): AppData {
  const out: any = { settings: ladeEinstellungen() }
  for (const l of LADER) out[l.key] = list(l.table, l.orderBy ? { orderBy: l.orderBy } : {})
  return out as AppData
}

/**
 * Nur die genannten Tabellen neu lesen, alles andere unverändert übernehmen.
 *
 * Das „unverändert" ist der eigentliche Gewinn und nicht nur die gesparte
 * Abfrage: Jedes Feld, das nicht neu gelesen wird, behält seine Referenz.
 * Damit laufen die useMemo-Berechnungen der anderen Seiten nicht neu, und die
 * Automatik (state/automatik.ts) startet ihren Zeitgeber nicht mehr neu, bloß
 * weil auf der Einkaufsliste ein Haken gesetzt wurde.
 *
 * Gemessen an einem Bestand aus mehreren Jahren (tests/ladezeit.test.ts):
 * alles lesen 317 ms, nur die Aufgaben lesen 39 ms.
 */
function loadTables(prev: AppData, tables: readonly SyncedTable[]): AppData {
  const gesucht = new Set<string>(tables)
  const out: any = { ...prev }
  if (gesucht.has('settings')) out.settings = ladeEinstellungen()
  for (const l of LADER) {
    if (!gesucht.has(l.table)) continue
    out[l.key] = list(l.table, l.orderBy ? { orderBy: l.orderBy } : {})
  }
  return out as AppData
}

/* ------------------------------------------------------------------ Kontext */

export interface Toast { id: string; text: string; undo?: () => void }

export interface Mutations {
  create: (table: SyncedTable, data: Record<string, any>, toastText?: string) => string
  patch: (table: SyncedTable, id: string, patch: Record<string, any>, toastText?: string) => void
  remove: (table: SyncedTable, id: string, toastText?: string) => void
  /**
   * Löschen ohne Meldung und ohne Rückgängig-Knopf.
   * Für die Automatik: Räumt sie zwölf Aufgaben einer gelöschten Vorlage ab,
   * will niemand zwölf Hinweise dazu sehen. Die eine zusammenfassende Meldung
   * kommt vom Aufrufer.
   */
  removeQuiet: (table: SyncedTable, id: string) => void
  restoreRow: (table: SyncedTable, id: string, toastText?: string) => void
  purge: (table: SyncedTable, id: string) => void
  /** Gibt es diese Zeile schon – auch als gelöschte? Siehe db/repo.ts. */
  exists: (table: SyncedTable, id: string) => boolean
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  /**
   * Mehrere Schreibvorgänge bündeln und danach EINMAL nachladen.
   * Die Rückgabe nennt die angefassten Tabellen; ohne Angabe wird alles
   * neu gelesen.
   */
  batch: (fn: () => readonly SyncedTable[] | void) => void
  /** Ohne Angabe: alles. Mit Angabe: nur diese Tabellen. */
  reload: (tables?: readonly SyncedTable[]) => void
  toast: (text: string, undo?: () => void) => void
}

interface AppCtx {
  ready: boolean
  error: string | null
  data: AppData
  mutations: Mutations
  saveState: 'saving' | 'saved'
  online: boolean
  today: string
  toasts: Toast[]
  dismissToast: (id: string) => void
}

const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp muss innerhalb des StoreProvider verwendet werden')
  return c
}
export function useData(): AppData { return useApp().data }
export function useMutations(): Mutations { return useApp().mutations }

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AppData>(EMPTY)
  const [saveState, setSaveState] = useState<'saving' | 'saved'>('saved')
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [today, setToday] = useState(todayString())

  const reload = useCallback(() => setData(loadAll()), [])

  const toast = useCallback((text: string, undo?: () => void) => {
    const id = uuidv7()
    setToasts((t) => [...t.slice(-2), { id, text, undo }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), undo ? 7000 : 3000)
  }, [])

  // Nach einer Änderung nur die betroffene Tabelle neu lesen. Alles andere
  // behält seine Referenz – siehe loadTables().
  const frisch = useCallback((table: SyncedTable) => {
    setData((prev) => loadTables(prev, [table]))
  }, [])

  const mutations = useMemo<Mutations>(() => ({
    create(table, values, toastText) {
      const id = insert(table, values)
      frisch(table)
      if (toastText) toast(toastText, () => { softDelete(table, id); frisch(table) })
      return id
    },
    patch(table, id, values, toastText) {
      const before = byId<Record<string, any>>(table, id)
      update(table, id, values)
      frisch(table)
      if (toastText) {
        toast(toastText, before ? () => {
          const revert: Record<string, any> = {}
          for (const k of Object.keys(values)) revert[k] = before[k]
          update(table, id, revert)
          frisch(table)
        } : undefined)
      }
    },
    remove(table, id, toastText) {
      softDelete(table, id)
      frisch(table)
      toast(toastText ?? 'Gelöscht', () => { restore(table, id); frisch(table) })
    },
    removeQuiet(table, id) {
      softDelete(table, id)
      frisch(table)
    },
    restoreRow(table, id, toastText) {
      restore(table, id)
      frisch(table)
      if (toastText) toast(toastText)
    },
    purge(table, id) {
      hardDelete(table, id)
      frisch(table)
    },
    exists: existsById,
    setSetting(key, value) {
      upsertByKey('settings', 'key', key as string, { value_json: JSON.stringify(value) })
      frisch('settings')
    },
    /**
     * Mehrere Schreibvorgänge, EIN Nachladen.
     *
     * Ohne das zahlt eine Schleife ihr Nachladen je Durchgang: Ein Import mit
     * 500 Zeilen las den gesamten Bestand 500-mal neu. Der Rückgabewert der
     * übergebenen Funktion sagt, welche Tabellen angefasst wurden; wird nichts
     * genannt, wird alles neu gelesen (sicher, aber langsam).
     */
    batch(fn) {
      const beruehrt = fn()
      if (beruehrt && beruehrt.length) setData((prev) => loadTables(prev, beruehrt))
      else setData(loadAll())
    },
    reload(tables) {
      if (tables && tables.length) setData((prev) => loadTables(prev, tables))
      else setData(loadAll())
    },
    toast,
  }), [toast, frisch])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await initDatabase()
      // Manche eingeschränkten Browser-Umgebungen werfen schon beim Zugriff
      // auf localStorage. Das darf den Start nicht verhindern.
      let deviceId: string | null = null
      try { deviceId = localStorage.getItem('lifehub.deviceId') } catch { /* nicht verfügbar */ }
      if (!deviceId) {
        deviceId = shortId(10)
        try { localStorage.setItem('lifehub.deviceId', deviceId) } catch { /* nicht verfügbar */ }
      }
      setDeviceId(deviceId)
      seedIfEmpty(deviceId)
      ensureBuiltinMetrics()
      ensureCategoryColors()
      if (cancelled) return
      setData(loadAll())
      setReady(true)
    })().catch((err) => {
      console.error(err)
      setError(String(err?.message ?? err))
      setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => onSaveStateChange(setSaveState), [])

  // Vor dem Schließen sicher speichern – ungesendete Änderungen dürfen nicht verloren gehen
  useEffect(() => {
    const handler = () => { void saveNow() }
    window.addEventListener('pagehide', handler)
    document.addEventListener('visibilitychange', () => { if (document.hidden) handler() })
    return () => window.removeEventListener('pagehide', handler)
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setToday((p) => (p === todayString() ? p : todayString())), 60000)
    return () => clearInterval(t)
  }, [])

  // Theme
  useEffect(() => {
    const apply = () => {
      const dark = data.settings.theme === 'dark' ||
        (data.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0d0d0d' : '#f9f9f7')
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [data.settings.theme])

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const value = useMemo<AppCtx>(
    () => ({ ready, error, data, mutations, saveState, online, today, toasts, dismissToast }),
    [ready, error, data, mutations, saveState, online, today, toasts, dismissToast],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { reloadFromDb }
function reloadFromDb() { return loadAll() }
