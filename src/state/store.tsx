/**
 * Anwendungszustand.
 *
 * Der vollständige Datenbestand einer Person passt bequem in den Speicher.
 * Deshalb: beim Start alles laden, bei jeder Änderung in SQLite schreiben und
 * neu laden. Ein Datenpfad, keine Cache-Invalidierung, keine Zustände, die
 * auseinanderlaufen können.
 *
 * Mit einer Einschränkung, die am 13.09.2026 dazukam: Nachgeladen wird nur noch
 * die Tabelle, die sich tatsächlich geändert hat (siehe `LADER` und `ladeNur`).
 * Vorher wurden bei jeder einzelnen Änderung alle rund vierzig Tabellen neu
 * eingelesen. Das war jahrelang unauffällig und wurde es in dem Moment nicht
 * mehr, als der historische FatSecret-Import anfing, zehntausende Zeilen zu
 * schreiben – jede einzelne hätte ein vollständiges Neuladen ausgelöst.
 *
 * Am Denkmodell ändert das nichts: Es gibt weiterhin genau eine Wahrheit, die
 * Datenbank, und das Datenbild ist ihr Abbild. Nur wird nicht mehr alles
 * abgeschrieben, wenn sich eine Zeile ändert.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { initDatabase, onSaveStateChange, saveNow, transaction } from '../db/sqlite'
import { list, setDeviceId, insert, update, softDelete, restore, upsertByKey, byId, hardDelete, existsById } from '../db/repo'
import { seedIfEmpty, ensureBuiltinMetrics, ensureCategoryColors } from '../db/seed'
import { repariereVerwaisteTageswerte } from '../db/reparatur'
import { LEERER_STAND, type ImportStand } from '../core/fatsecretImport'
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
  /**
   * Wie weit der FatSecret-Import zurueck schon durch ist.
   *
   * Steht bewusst in den Einstellungen und nicht in einer eigenen Tabelle:
   * Einstellungen werden mitsynchronisiert, also macht das Handy dort weiter,
   * wo der PC aufgehoert hat - statt die halbe Historie ein zweites Mal zu
   * holen. Aufbau siehe core/fatsecretImport.ts.
   */
  fatsecret_import: ImportStand
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
  fatsecret_import: LEERER_STAND,
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
 * Welche Tabelle welchen Teil des Datenbildes speist - und wie er gelesen wird.
 *
 * Diese Zuordnung ist der Kern der Leistungsverbesserung vom 13.09.2026. Vorher
 * las `loadAll()` bei JEDER Aenderung alle rund vierzig Tabellen neu ein. Bei
 * einer kleinen Datenbank fiel das nicht auf; mit drei Jahren Ernaehrung sind es
 * rund 23.000 Zeilen, und der historische FatSecret-Import schreibt sie
 * einzeln - das ergaebe 23.000 vollstaendige Neuladungen.
 *
 * Jetzt wird nur nachgelesen, was sich geaendert hat. Alles andere behaelt seine
 * bisherige Liste, und zwar dieselbe Referenz: React erkennt daran, dass sich
 * nichts geaendert hat, und spart sich das Neuzeichnen gleich mit.
 *
 * Die Zuordnung steht bewusst an EINER Stelle. `loadAll()` baut sich daraus
 * zusammen, statt die Abfragen ein zweites Mal aufzuzaehlen - sonst laufen die
 * beiden Wege irgendwann auseinander, und der gezielte Weg liest etwas anderes
 * als der vollstaendige.
 */
interface Lader { schluessel: keyof AppData; laden: () => any }

const LADER: Record<string, Lader> = {
  accounts: { schluessel: 'accounts', laden: () => list<Account>('accounts', { orderBy: 'sort_order, name' }) },
  categories: { schluessel: 'categories', laden: () => list<Category>('categories', { orderBy: 'sort_order, name' }) },
  transactions: { schluessel: 'transactions', laden: () => list<Transaction>('transactions', { orderBy: 'booked_on DESC, created_at DESC' }) },
  budgets: { schluessel: 'budgets', laden: () => list<Budget>('budgets') },
  recurring_rules: { schluessel: 'recurring', laden: () => list<RecurringRule>('recurring_rules', { orderBy: 'title' }) },
  tasks: { schluessel: 'tasks', laden: () => list<Task>('tasks', { orderBy: 'sort_order, created_at DESC' }) },
  projects: { schluessel: 'projects', laden: () => list('projects', { orderBy: 'name' }) },
  calendar_events: { schluessel: 'events', laden: () => list<CalendarEvent>('calendar_events', { orderBy: 'day, start_time' }) },
  day_types: { schluessel: 'dayTypes', laden: () => list<DayType>('day_types', { orderBy: 'sort_order' }) },
  day_assignments: { schluessel: 'dayAssignments', laden: () => list<DayAssignment>('day_assignments', { orderBy: 'day' }) },
  shift_patterns: { schluessel: 'shiftPatterns', laden: () => list('shift_patterns') },
  holidays: { schluessel: 'holidays', laden: () => list('holidays', { orderBy: 'day' }) },
  time_blocks: { schluessel: 'timeBlocks', laden: () => list<TimeBlock>('time_blocks', { orderBy: 'day, start_time' }) },
  metrics: { schluessel: 'metrics', laden: () => list<Metric>('metrics', { orderBy: 'sort_order' }) },
  metric_entries: { schluessel: 'metricEntries', laden: () => list<MetricEntry>('metric_entries', { orderBy: 'day' }) },
  metric_targets: { schluessel: 'metricTargets', laden: () => list<MetricTarget>('metric_targets') },
  exercises: { schluessel: 'exercises', laden: () => list<Exercise>('exercises', { orderBy: 'name' }) },
  workout_plans: { schluessel: 'workoutPlans', laden: () => list<WorkoutPlan>('workout_plans') },
  workout_plan_days: { schluessel: 'workoutPlanDays', laden: () => list<WorkoutPlanDay>('workout_plan_days', { orderBy: 'week_index, weekday' }) },
  workout_plan_exercises: { schluessel: 'workoutPlanExercises', laden: () => list('workout_plan_exercises', { orderBy: 'sort_order' }) },
  workout_sessions: { schluessel: 'workoutSessions', laden: () => list<WorkoutSession>('workout_sessions', { orderBy: 'day DESC' }) },
  workout_sets: { schluessel: 'workoutSets', laden: () => list<WorkoutSet>('workout_sets', { orderBy: 'set_index' }) },
  body_measurements: { schluessel: 'bodyMeasurements', laden: () => list<BodyMeasurement>('body_measurements', { orderBy: 'day DESC' }) },
  day_notes: { schluessel: 'dayNotes', laden: () => list<DayNote>('day_notes', { orderBy: 'day DESC' }) },
  investments: { schluessel: 'investments', laden: () => list<Investment>('investments', { orderBy: 'name' }) },
  investment_moves: { schluessel: 'investmentMoves', laden: () => list<InvestmentMove>('investment_moves', { orderBy: 'day DESC' }) },
  goals: { schluessel: 'goals', laden: () => list<Goal>('goals') },
  goal_contributions: { schluessel: 'goalContributions', laden: () => list('goal_contributions', { orderBy: 'day DESC' }) },
  task_templates: { schluessel: 'taskTemplates', laden: () => list('task_templates', { orderBy: 'weekday, title' }) },
  account_checks: { schluessel: 'accountChecks', laden: () => list('account_checks', { orderBy: 'day DESC' }) },
  notes: { schluessel: 'notes', laden: () => list('notes', { orderBy: 'created_at DESC' }) },
  insights: { schluessel: 'insights', laden: () => list<Insight>('insights', { orderBy: 'created_at DESC' }) },
  finance_day_runs: { schluessel: 'financeDayRuns', laden: () => list('finance_day_runs', { orderBy: 'ran_on DESC' }) },
  monthly_closings: { schluessel: 'monthlyClosings', laden: () => list('monthly_closings', { orderBy: 'year_month DESC' }) },
  attachments: { schluessel: 'attachments', laden: () => list('attachments') },
  import_batches: { schluessel: 'importBatches', laden: () => list('import_batches', { orderBy: 'imported_at DESC' }) },
  shopping_items: { schluessel: 'shopping', laden: () => list<ShoppingItem>('shopping_items', { orderBy: 'is_checked, sort_order, name' }) },
  food_entries: { schluessel: 'foodEntries', laden: () => list<FoodEntry>('food_entries', { orderBy: 'day DESC, meal, sort_order' }) },
}

/** Die Einstellungen liegen als Schluessel/Wert-Zeilen und brauchen eigenes Auslesen. */
function ladeEinstellungen(): AppSettings {
  const rows = list<{ key: string; value_json: string }>('settings')
  const settings: any = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    try { settings[r.key] = JSON.parse(r.value_json) } catch { /* defekter Eintrag wird ignoriert */ }
  }
  return settings as AppSettings
}

/**
 * Nur die genannten Tabellen neu einlesen, der Rest bleibt, wie er ist.
 *
 * Unbekannte Tabellennamen werden stillschweigend uebergangen: Es gibt
 * synchronisierte Tabellen ohne eigenen Platz im Datenbild (etwa `devices`),
 * und eine Aenderung daran soll nicht in einen Fehler laufen.
 */
function ladeNur(vorher: AppData, tabellen: Iterable<string>): AppData {
  const neu: any = { ...vorher }
  let etwas = false
  for (const t of new Set(tabellen)) {
    if (t === 'settings') { neu.settings = ladeEinstellungen(); etwas = true; continue }
    const l = LADER[t]
    if (!l) continue
    neu[l.schluessel] = l.laden()
    etwas = true
  }
  return etwas ? (neu as AppData) : vorher
}

/** Alles einlesen - beim Start und nach einem Import, der alles anfasst. */
function loadAll(): AppData {
  return ladeNur(EMPTY, ['settings', ...Object.keys(LADER)])
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
  /**
   * Viele Aenderungen als eine behandeln: eine Datenbanktransaktion, ein
   * Nachladen am Ende, und nur fuer die betroffenen Tabellen. Fuer Importe
   * und alles, was in einer Schleife schreibt.
   */
  batch: <T>(fn: () => T) => T
  /** Gibt es diese Zeile schon – auch als gelöschte? Siehe db/repo.ts. */
  exists: (table: SyncedTable, id: string) => boolean
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

  /**
   * Sammelstelle, solange ein Stapel offen ist – sonst `null`.
   *
   * Während eines Stapels wird nicht nachgeladen, sondern nur vermerkt, welche
   * Tabellen betroffen waren. Am Ende gibt es EIN Nachladen für alle. Das ist
   * der Unterschied zwischen „Import schreibt 23.000 Zeilen" und „Import legt
   * die App für Minuten lahm".
   */
  const stapel = useRef<Set<string> | null>(null)

  /** Eine Tabelle hat sich geändert: entweder gleich nachlesen oder vormerken. */
  const beruehrt = useCallback((table: string) => {
    if (stapel.current) { stapel.current.add(table); return }
    setData((vorher) => ladeNur(vorher, [table]))
  }, [])

  const mutations = useMemo<Mutations>(() => ({
    create(table, values, toastText) {
      const id = insert(table, values)
      beruehrt(table)
      if (toastText) toast(toastText, () => { softDelete(table, id); beruehrt(table) })
      return id
    },
    patch(table, id, values, toastText) {
      const before = byId<Record<string, any>>(table, id)
      update(table, id, values)
      beruehrt(table)
      if (toastText) {
        toast(toastText, before ? () => {
          const revert: Record<string, any> = {}
          for (const k of Object.keys(values)) revert[k] = before[k]
          update(table, id, revert)
          beruehrt(table)
        } : undefined)
      }
    },
    remove(table, id, toastText) {
      softDelete(table, id)
      beruehrt(table)
      toast(toastText ?? 'Gelöscht', () => { restore(table, id); beruehrt(table) })
    },
    removeQuiet(table, id) {
      softDelete(table, id)
      beruehrt(table)
    },
    restoreRow(table, id, toastText) {
      restore(table, id)
      beruehrt(table)
      if (toastText) toast(toastText)
    },
    purge(table, id) {
      hardDelete(table, id)
      beruehrt(table)
    },
    exists: existsById,
    setSetting(key, value) {
      upsertByKey('settings', 'key', key as string, { value_json: JSON.stringify(value) })
      beruehrt('settings')
    },
    /**
     * Viele Änderungen als eine behandeln.
     *
     * Zwei Dinge auf einmal: Die Schreibvorgänge laufen in EINER
     * Datenbanktransaktion (SQLite schreibt sonst je Zeile ein Journal), und
     * nachgeladen wird erst danach, einmal, und nur für die betroffenen
     * Tabellen.
     *
     * Verschachtelte Aufrufe geben die Arbeit an den äußeren Stapel weiter –
     * SQLite kennt kein verschachteltes BEGIN, und zwei Transaktionen
     * übereinander würden beim ersten COMMIT die äußere mitbeenden.
     */
    batch<T>(fn: () => T): T {
      if (stapel.current) return fn()
      const gesammelt = new Set<string>()
      stapel.current = gesammelt
      let ergebnis!: T
      try {
        transaction(() => { ergebnis = fn() })
      } finally {
        stapel.current = null
        if (gesammelt.size) setData((vorher) => ladeNur(vorher, gesammelt))
      }
      return ergebnis
    },
    reload() { setData(loadAll()) },
    toast,
  }), [toast, beruehrt])

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
      // Tageswerte, die auf eine verschwundene Metrik zeigen, wieder
      // einhängen. Im Normalfall eine Abfrage ohne Treffer; siehe
      // db/reparatur.ts, warum es das überhaupt gibt.
      const repariert = repariereVerwaisteTageswerte()
      if (cancelled) return
      setData(loadAll())
      setReady(true)
      if (repariert.tageswerte.length > 0) {
        // Eine Zahl, die sich von selbst ändert, soll man nachlesen können.
        toast(`${repariert.tageswerte.length} Tageswerte wieder zugeordnet`
          + (repariert.metriken.length ? ` (${repariert.metriken.join(', ')})` : '') + '.')
      }
    })().catch((err) => {
      console.error(err)
      setError(String(err?.message ?? err))
      setReady(true)
    })
    return () => { cancelled = true }
    // Bewusst nur beim ersten Lauf. `toast` ist über useCallback stabil, steht
    // aber nicht in der Liste: Der Start soll sich nicht wiederholen lassen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => onSaveStateChange(setSaveState), [])

  // Vor dem Schließen sicher speichern – ungesendete Änderungen dürfen nicht verloren gehen
  useEffect(() => {
    const handler = () => { void saveNow() }
    // Der zweite Zuhörer braucht einen eigenen Namen. Vorher stand dort eine
    // anonyme Funktion, die `removeEventListener` gar nicht treffen konnte:
    // Der Zuhörer blieb hängen, und jedes weitere Einhängen legte einen
    // weiteren obendrauf.
    const beiWechsel = () => { if (document.hidden) handler() }
    window.addEventListener('pagehide', handler)
    document.addEventListener('visibilitychange', beiWechsel)
    return () => {
      window.removeEventListener('pagehide', handler)
      document.removeEventListener('visibilitychange', beiWechsel)
    }
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
