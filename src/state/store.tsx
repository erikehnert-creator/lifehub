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
import { list, setDeviceId, insert, update, softDelete, restore, upsertByKey, byId, hardDelete } from '../db/repo'
import { seedIfEmpty, ensureBuiltinMetrics, ensureCategoryColors } from '../db/seed'
import type { SyncedTable } from '../db/schema'
import type {
  Account, Category, Transaction, Budget, Task, CalendarEvent, DayType, DayAssignment,
  TimeBlock, Metric, MetricEntry, MetricTarget, Goal, RecurringRule, Exercise,
  WorkoutPlan, WorkoutPlanDay, WorkoutSession, WorkoutSet, BodyMeasurement, Insight,
  ShoppingItem, DayNote, Investment, InvestmentMove,
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
  monthlyClosings: [], attachments: [], importBatches: [], shopping: [],
}

function loadAll(): AppData {
  const settingRows = list<{ key: string; value_json: string }>('settings')
  const settings: any = { ...DEFAULT_SETTINGS }
  for (const r of settingRows) {
    try { settings[r.key] = JSON.parse(r.value_json) } catch { /* defekter Eintrag wird ignoriert */ }
  }
  return {
    settings: settings as AppSettings,
    accounts: list<Account>('accounts', { orderBy: 'sort_order, name' }),
    categories: list<Category>('categories', { orderBy: 'sort_order, name' }),
    transactions: list<Transaction>('transactions', { orderBy: 'booked_on DESC, created_at DESC' }),
    budgets: list<Budget>('budgets'),
    recurring: list<RecurringRule>('recurring_rules', { orderBy: 'title' }),
    tasks: list<Task>('tasks', { orderBy: 'sort_order, created_at DESC' }),
    projects: list('projects', { orderBy: 'name' }),
    events: list<CalendarEvent>('calendar_events', { orderBy: 'day, start_time' }),
    dayTypes: list<DayType>('day_types', { orderBy: 'sort_order' }),
    dayAssignments: list<DayAssignment>('day_assignments', { orderBy: 'day' }),
    shiftPatterns: list('shift_patterns'),
    holidays: list('holidays', { orderBy: 'day' }),
    timeBlocks: list<TimeBlock>('time_blocks', { orderBy: 'day, start_time' }),
    metrics: list<Metric>('metrics', { orderBy: 'sort_order' }),
    metricEntries: list<MetricEntry>('metric_entries', { orderBy: 'day' }),
    metricTargets: list<MetricTarget>('metric_targets'),
    exercises: list<Exercise>('exercises', { orderBy: 'name' }),
    workoutPlans: list<WorkoutPlan>('workout_plans'),
    workoutPlanDays: list<WorkoutPlanDay>('workout_plan_days', { orderBy: 'week_index, weekday' }),
    workoutPlanExercises: list('workout_plan_exercises', { orderBy: 'sort_order' }),
    workoutSessions: list<WorkoutSession>('workout_sessions', { orderBy: 'day DESC' }),
    workoutSets: list<WorkoutSet>('workout_sets', { orderBy: 'set_index' }),
    bodyMeasurements: list<BodyMeasurement>('body_measurements', { orderBy: 'day DESC' }),
    dayNotes: list<DayNote>('day_notes', { orderBy: 'day DESC' }),
    investments: list<Investment>('investments', { orderBy: 'name' }),
    investmentMoves: list<InvestmentMove>('investment_moves', { orderBy: 'day DESC' }),
    goals: list<Goal>('goals'),
    goalContributions: list('goal_contributions', { orderBy: 'day DESC' }),
    taskTemplates: list('task_templates', { orderBy: 'weekday, title' }),
    accountChecks: list('account_checks', { orderBy: 'day DESC' }),
    notes: list('notes', { orderBy: 'created_at DESC' }),
    insights: list<Insight>('insights', { orderBy: 'created_at DESC' }),
    financeDayRuns: list('finance_day_runs', { orderBy: 'ran_on DESC' }),
    monthlyClosings: list('monthly_closings', { orderBy: 'year_month DESC' }),
    attachments: list('attachments'),
    importBatches: list('import_batches', { orderBy: 'imported_at DESC' }),
    shopping: list<ShoppingItem>('shopping_items', { orderBy: 'is_checked, sort_order, name' }),
  }
}

/* ------------------------------------------------------------------ Kontext */

export interface Toast { id: string; text: string; undo?: () => void }

export interface Mutations {
  create: (table: SyncedTable, data: Record<string, any>, toastText?: string) => string
  patch: (table: SyncedTable, id: string, patch: Record<string, any>, toastText?: string) => void
  remove: (table: SyncedTable, id: string, toastText?: string) => void
  restoreRow: (table: SyncedTable, id: string, toastText?: string) => void
  purge: (table: SyncedTable, id: string) => void
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  reload: () => void
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

  const mutations = useMemo<Mutations>(() => ({
    create(table, values, toastText) {
      const id = insert(table, values)
      setData(loadAll())
      if (toastText) toast(toastText, () => { softDelete(table, id); setData(loadAll()) })
      return id
    },
    patch(table, id, values, toastText) {
      const before = byId<Record<string, any>>(table, id)
      update(table, id, values)
      setData(loadAll())
      if (toastText) {
        toast(toastText, before ? () => {
          const revert: Record<string, any> = {}
          for (const k of Object.keys(values)) revert[k] = before[k]
          update(table, id, revert)
          setData(loadAll())
        } : undefined)
      }
    },
    remove(table, id, toastText) {
      softDelete(table, id)
      setData(loadAll())
      toast(toastText ?? 'Gelöscht', () => { restore(table, id); setData(loadAll()) })
    },
    restoreRow(table, id, toastText) {
      restore(table, id)
      setData(loadAll())
      if (toastText) toast(toastText)
    },
    purge(table, id) {
      hardDelete(table, id)
      setData(loadAll())
    },
    setSetting(key, value) {
      upsertByKey('settings', 'key', key as string, { value_json: JSON.stringify(value) })
      setData(loadAll())
    },
    reload() { setData(loadAll()) },
    toast,
  }), [toast])

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
