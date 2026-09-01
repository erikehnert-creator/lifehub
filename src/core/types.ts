import type { Cents } from './money'
import type { DayString, Instant } from './dates'
import type { InvestmentMove } from './investments'

export type { InvestmentMove }

export interface BaseEntity {
  id: string
  created_at: Instant
  updated_at: Instant
  deleted_at: Instant | null
  version: number
  last_device_id: string
  server_rev: number | null
}

export type AccountType =
  | 'checking' | 'savings' | 'money_market' | 'credit_card'
  | 'depot' | 'cash' | 'loan' | 'custom'

export interface Account extends BaseEntity {
  name: string
  type: AccountType
  currency: string
  opening_balance_cents: Cents
  opening_date: DayString
  iban: string | null
  institution: string | null
  color: string | null
  icon: string | null
  is_active: number
  counts_as_savings: number
  counts_as_available: number
  include_in_net_worth: number
  sort_order: number
}

export interface Category extends BaseEntity {
  name: string
  parent_id: string | null
  kind: 'income' | 'expense'
  color: string | null
  icon: string | null
  is_archived: number
  is_system: number
  exclude_from_stats: number
  sort_order: number
}

export type TransactionType = 'income' | 'expense' | 'transfer'

export interface Transaction extends BaseEntity {
  type: TransactionType
  booked_on: DayString
  value_on: DayString | null
  amount_cents: Cents
  currency: string
  account_id: string
  to_account_id: string | null
  category_id: string | null
  merchant: string | null
  description: string | null
  note: string | null
  status: 'planned' | 'booked' | 'cleared' | 'void'
  recurring_id: string | null
  import_batch_id: string | null
  external_ref: string | null
}

export interface Budget extends BaseEntity {
  category_id: string | null
  period: 'monthly' | 'weekly' | 'yearly'
  amount_cents: Cents
  valid_from: DayString
  valid_to: DayString | null
  warn_at_percent: number
  rollover: number
}

export interface Task extends BaseEntity {
  title: string
  description: string | null
  note: string | null
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  bucket: 'inbox' | 'today' | 'week' | 'month' | 'someday' | 'scheduled'
  scheduled_on: DayString | null
  scheduled_time: string | null
  due_on: DayString | null
  due_time: string | null
  duration_minutes: number | null
  priority: number
  category: string | null
  project_id: string | null
  parent_task_id: string | null
  recurring_id: string | null
  completed_at: Instant | null
  energy: 'low' | 'medium' | 'high' | null
  sort_order: number
  template_id: string | null
  /** Ab wann die Aufgabe im Tag auftauchen soll (bei Aufgaben mit Frist). */
  show_from: DayString | null
  /** 1 = bleibt an ihrem Tag stehen und wandert nicht mit. */
  pinned_day: number
  /** Wie oft die Aufgabe schon auf den nächsten Tag gerutscht ist. */
  carried_count: number
  /** Der Tag, für den sie ursprünglich geplant war. */
  carried_from: DayString | null
  /** Letzter Tag bei mehrtägigen Aufgaben; leer = eintägig. */
  scheduled_end_on: DayString | null
  /** Anzahl Teile, aus denen die Aufgabe besteht (z. B. 4 Druckteile); leer = keine Teilaufgabe. */
  progress_total: number | null
  /** Wie viele Teile schon fertig sind. */
  progress_done: number | null
}

export interface ShoppingItem extends BaseEntity {
  name: string
  quantity: string | null
  aisle: string | null
  note: string | null
  is_checked: number
  checked_at: Instant | null
  is_template: number
  times_used: number
  estimated_cents: Cents | null
  sort_order: number
}

export interface CalendarEvent extends BaseEntity {
  title: string
  description: string | null
  location: string | null
  day: DayString
  start_time: string | null
  end_time: string | null
  all_day: number
  timezone: string
  rrule: string | null
  exdates: string | null
  color: string | null
  source: string
  external_uid: string | null
  /** Letzter Tag bei mehrtägigen Terminen; leer = eintägig. */
  end_day: DayString | null
  /** Erinnerung: Minuten vor Beginn. */
  reminder_minutes: number | null
}

export interface DayType extends BaseEntity {
  name: string
  short_code: string
  kind: 'work' | 'school' | 'vacation' | 'off' | 'sick' | 'custom'
  default_start: string | null
  default_end: string | null
  break_minutes: number
  color: string | null
  counts_as_workday: number
  sort_order: number
}

export interface DayAssignment extends BaseEntity {
  day: DayString
  day_type_id: string
  start_override: string | null
  end_override: string | null
  note: string | null
}

export interface TimeBlock extends BaseEntity {
  day: DayString
  start_time: string
  end_time: string
  kind: string
  title: string
  color: string | null
  task_id: string | null
  event_id: string | null
  is_locked: number
}

export type Aggregation = 'sum' | 'avg' | 'last' | 'min' | 'max'

export interface Metric extends BaseEntity {
  key: string
  name: string
  group_key: string
  unit: string
  value_type: 'number' | 'integer' | 'scale' | 'duration' | 'text'
  decimals: number
  scale_min: number | null
  scale_max: number | null
  scale_labels_json: string | null
  aggregation: Aggregation
  direction: 'higher_better' | 'lower_better' | 'range' | 'neutral'
  is_builtin: number
  is_enabled: number
  show_in_daily_form: number
  show_zone: number
  color: string | null
  sort_order: number
}

export interface MetricEntry extends BaseEntity {
  metric_id: string
  day: DayString
  at_time: string | null
  value_num: number | null
  value_text: string | null
  note: string | null
  source: string
  import_batch_id: string | null
}

export interface MetricTarget extends BaseEntity {
  metric_id: string
  target_value: number | null
  tolerance_minus: number | null
  tolerance_plus: number | null
  hard_min: number | null
  hard_max: number | null
  period: 'daily' | 'weekly' | 'monthly'
  valid_from: DayString
  valid_to: DayString | null
}

export interface Goal extends BaseEntity {
  name: string
  description: string | null
  domain: 'finance' | 'body' | 'fitness' | 'habit' | 'learning' | 'project'
  goal_kind: 'percent' | 'amount' | 'metric_target' | 'count' | 'streak' | 'milestone'
  target_account_id: string | null
  metric_id: string | null
  manual_current: number | null
  start_value: number | null
  target_value: number | null
  start_on: DayString
  target_on: DayString | null
  status: 'active' | 'paused' | 'reached' | 'abandoned'
  color: string | null
  icon: string | null
  progress_percent: number | null
  completed_on: DayString | null
}

export interface TaskTemplate extends BaseEntity {
  title: string
  description: string | null
  duration_minutes: number | null
  priority: number
  weekday: number | null
  day_type_id: string | null
  interval_weeks: number
  anchor_date: DayString | null
  is_active: number
  last_generated_on: DayString | null
}

export interface RecurringRule extends BaseEntity {
  kind: 'transaction' | 'task'
  title: string
  rrule: string
  starts_on: DayString
  ends_on: DayString | null
  template_json: string
  /** Historisches Feld – jede aktive Regel bucht fällige Zahlungen inzwischen von selbst, ungefragt. */
  auto_book: number
  lead_days: number
  last_generated_on: DayString | null
  is_active: number
}

export interface Exercise extends BaseEntity {
  name: string
  category: string | null
  muscle_groups: string | null
  tracks_weight: number
  tracks_reps: number
  tracks_time: number
  is_bodyweight: number
  note: string | null
}

export interface WorkoutPlan extends BaseEntity {
  name: string
  cycle_weeks: number
  anchor_date: DayString
  is_active: number
}

export interface WorkoutPlanDay extends BaseEntity {
  plan_id: string
  week_index: number
  weekday: number
  frequency: 'every' | 'biweekly'
  title: string
  focus: string | null
}

export interface WorkoutSession extends BaseEntity {
  day: DayString
  plan_day_id: string | null
  title: string
  type: string | null
  started_at: Instant | null
  ended_at: Instant | null
  duration_minutes: number | null
  status: 'planned' | 'completed' | 'skipped' | 'rest'
  perceived_effort: number | null
  note: string | null
}

export interface WorkoutSet extends BaseEntity {
  session_id: string
  exercise_id: string
  set_index: number
  reps: number | null
  weight_kg: number | null
  seconds: number | null
  distance_m: number | null
  is_warmup: number
  note: string | null
}

export interface BodyMeasurement extends BaseEntity {
  day: DayString
  weight_kg: number | null
  waist_cm: number | null
  chest_cm: number | null
  upper_arm_cm: number | null
  shoulder_cm: number | null
  thigh_cm: number | null
  neck_cm: number | null
  body_fat_percent: number | null
  method: string | null
  note: string | null
}

export interface DayNote extends BaseEntity {
  day: DayString
  note: string
}

export interface Investment extends BaseEntity {
  name: string
  note: string | null
}

export interface Insight extends BaseEntity {
  kind: string
  severity: 'info' | 'attention' | 'warning'
  title: string
  body: string
  evidence_json: string
  period_start: DayString | null
  period_end: DayString | null
  is_statistical: number
  dismissed_at: Instant | null
}
