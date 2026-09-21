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
  /** Feste Uhrzeit der Aufgabe, z. B. „18:00" beim Training. Leer = ohne Uhrzeit. */
  scheduled_time: string | null
}

/**
 * Ein einzelnes gegessenes Lebensmittel.
 *
 * Die Tageswerte für Kalorien und Makros stehen weiterhin als `MetricEntry`
 * da – nur so greifen Zielbereiche, Verlauf und Auswertungen darauf zu, wie
 * sie es immer getan haben. Diese Zeile ist die Begründung dahinter: woraus
 * die Tageswerte entstanden sind.
 */
export interface FoodEntry extends BaseEntity {
  day: DayString
  meal: 'breakfast' | 'lunch' | 'dinner' | 'other'
  name: string
  serving_description: string | null
  number_of_units: number | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  saturated_fat_g: number | null
  sodium_mg: number | null
  /** 'fatsecret' oder 'manual'. */
  source: string
  /** Die food_entry_id von FatSecret – der Anker gegen Doppelte. */
  external_id: string | null
  external_food_id: string | null
  synced_at: Instant | null
  sort_order: number
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
  /**
   * Welche Art Training. `'turnen'` kennzeichnet eine Geraeteinheit, deren
   * Versuche in `gym_attempts` liegen; `'kraft'` waere eine mit
   * `workout_sets`. `null` ist der Bestand vor Migration 14 und bleibt
   * gueltig - eine Einheit ohne Kennzeichen ist keine Luecke.
   *
   * Bewusst eine eigene Spalte und nicht `type`: Dort steht der Schwerpunkt
   * aus dem Trainingsplan als freier Text.
   */
  discipline: string | null
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

/**
 * Eine Nacht.
 *
 * `day` ist der Morgen des Aufwachens und zugleich eindeutig – genau eine
 * Nacht je Tag. Daraus leitet sich die ID ab (core/natuerlicheSchluessel.ts),
 * weshalb derselbe Morgen zweimal geschickt die Zeile aktualisiert, statt
 * eine zweite anzulegen.
 *
 * Zeiten stehen als ISO 8601 MIT Zeitzonenversatz: Nur so bleibt „23:30"
 * auch nach einer Zeitumstellung 23:30.
 *
 * Die Phasenfelder sind `null`, wenn die Quelle keine Phasen liefert – das
 * ist der Normalfall bei Sleep Cycle und älteren Geräten. `0` würde dort
 * behaupten, es seien null Minuten Tiefschlaf gemessen worden.
 */
export interface SleepSession extends BaseEntity {
  day: DayString
  start_at: string
  end_at: string
  /** Tatsächlich geschlafen, in Minuten. */
  duration_min: number
  awake_min: number | null
  in_bed_min: number | null
  core_min: number | null
  deep_min: number | null
  rem_min: number | null
  /** Woher die Werte stammen, z. B. „Sleep Cycle". */
  source: string | null
  note: string | null
}

/**
 * Ein Turnelement.
 *
 * „Zuletzt trainiert" und „wie oft" stehen hier bewusst NICHT: Beides sind
 * Ableitungen aus `GymAttempt` (core/turnen/elemente.ts). Als Spalten müssten
 * sie bei jedem Training nachgezogen werden, und der erste vergessene Nachzug
 * machte sie still falsch.
 */
export interface GymElement extends BaseEntity {
  /** Schlüssel aus core/turnen/geraete.ts – kein Fremdschlüssel. */
  apparatus: string
  name: string
  /** A…I, je nach Wertungsvorschrift. Frei, weil zyklusabhängig. */
  difficulty_letter: string | null
  /** Zahlenwert der Schwierigkeit, z. B. 0.3 – damit sich summieren lässt. */
  difficulty_value: number | null
  /** Elementgruppe I…V. Relevant für Küren (Phase 3). */
  element_group: number | null
  is_dismount: number
  /** Haltekraftteil – an Ringen ein eigener Trainingsgegenstand. */
  hold_element: number
  /** Siehe core/turnen/status.ts. Wird nur vom Nutzer gesetzt. */
  status: string
  /** Nur ein Verweis. Videodaten werden NICHT synchronisiert (4 MB Grenze). */
  video_url: string | null
  note: string | null
  is_active: number
  sort_order: number
}

/**
 * Was in einer Trainingseinheit an einem Element passiert ist.
 *
 * Eine Zeile je Element UND Einheit, nicht je Versuch. Die Gesamtzahl der
 * Versuche wird nicht gespeichert, sondern gerechnet – zwei Quellen für
 * dieselbe Zahl können auseinanderlaufen, eine kann es nicht.
 *
 * `with_help` ist ein Kennzeichen für den ganzen Block, keine Anzahl.
 */
export interface GymAttempt extends BaseEntity {
  session_id: string
  element_id: string
  clean: number
  shaky: number
  failed: number
  with_help: number
  note: string | null
  sort_order: number
}

/**
 * Eine Kür – eine geordnete Folge vorhandener Elemente an einem Gerät.
 *
 * Mehrere Küren je Gerät sind der Normalfall: eine Wettkampffassung, eine
 * Trainingsvariante, eine sichere Variante für den schlechten Tag.
 *
 * `competition_since` ist bewusst ein Zeitpunkt und kein Kennzeichen. Die
 * aktive Wettkampfkür eines Geräts wird daraus abgeleitet (die jüngste), statt
 * gespeichert zu werden – nur so lässt sich „höchstens eine je Gerät" auch
 * nach einem Abgleich zweier Geräte halten. Siehe Migration 15 und
 * core/turnen/kueren.ts.
 */
export interface GymRoutine extends BaseEntity {
  /** Schlüssel aus core/turnen/geraete.ts – kein Fremdschlüssel. */
  apparatus: string
  name: string
  note: string | null
  /** Wann diese Kür zur Wettkampfkür erklärt wurde. `null` = nie. */
  competition_since: string | null
  /** Archiviert oder nicht – dieselbe Bedeutung wie bei GymElement. */
  is_active: number
}

/**
 * Ein Element an seinem Platz in einer Kür.
 *
 * `position` ist ein Sortierwert, kein Schlüssel: Ein Element darf mehrfach
 * vorkommen, und Gleichstand ist erlaubt. Die feste Reihenfolge stellt
 * `kuerElemente()` her.
 */
export interface GymRoutineElement extends BaseEntity {
  routine_id: string
  element_id: string
  position: number
  /** Notiz zu genau diesem Element in genau dieser Kür. */
  note: string | null
}

/**
 * Eine eingefrorene Fassung einer Kür.
 *
 * Unveränderlich. Sie beschreibt einen anderen Gegenstand als `GymRoutine`:
 * nicht wie die Kür *ist*, sondern wie sie an einem Tag *war*. Deshalb ist
 * das ausdrücklich keine zweite Quelle für den aktuellen Zustand.
 *
 * `routine_id` ist nur eine Herkunftsangabe und wird für die Anzeige nie
 * aufgelöst – die lebende Kür darf gelöscht oder umbenannt werden, ohne dass
 * sich hier etwas ändert. `apparatus` und `name` stehen deshalb eingefroren
 * daneben. Siehe core/turnen/fassungen.ts.
 */
export interface GymRoutineVersion extends BaseEntity {
  routine_id: string
  apparatus: string
  name: string
  /** Wann diese Fassung zum ersten Mal festgehalten wurde. */
  frozen_at: string
}

/**
 * Ein Platz in einer eingefrorenen Fassung – mit kopierten Elementdaten.
 *
 * Bewusst eine Kopie aus `GymElement`, und zwar genau so viel, wie die
 * historische Anzeige braucht. `status`, `video_url` und die Notizen fehlen
 * absichtlich: Sie beschreiben den Turner heute, nicht die Übung von damals.
 */
export interface GymRoutineVersionElement extends BaseEntity {
  version_id: string
  position: number
  /** Herkunftsangabe. Kann auf eine gelöschte Zeile zeigen – nie auflösen. */
  element_id: string | null
  name: string
  difficulty_letter: string | null
  difficulty_value: number | null
  element_group: number | null
  is_dismount: number
}

/**
 * Ein Wettkampf.
 *
 * `rank_allround` und `score_allround` werden abgeschrieben, nicht gerechnet:
 * Die Summe der Gerätenoten ist nicht zwingend die Mehrkampfnote.
 *
 * `protocol_url` ist ein Verweis, keine Datei – Anhänge liegen in LifeHub als
 * Base64 in einer synchronisierten Tabelle und sind für Protokolle ungeeignet.
 */
export interface GymCompetition extends BaseEntity {
  day: DayString
  name: string
  location: string | null
  class_name: string | null
  rank_allround: number | null
  score_allround: number | null
  protocol_url: string | null
  note: string | null
}

/**
 * Das Ergebnis an einem Gerät.
 *
 * Alle Noten sind freiwillig und bleiben `null`, wenn nichts eingetragen ist.
 * Sie werden nirgends als 0 angezeigt und nirgends auseinander gerechnet –
 * LifeHub behauptet nicht, dass D + E − Abzug die Endnote ergibt.
 *
 * `routine_version_id` zeigt auf die eingefrorene Fassung, NICHT auf
 * `gym_routines`. Es darf leer bleiben.
 */
export interface GymResult extends BaseEntity {
  competition_id: string
  apparatus: string
  routine_version_id: string | null
  d_score: number | null
  e_score: number | null
  /** Neutralabzüge (Zeit, Linie). Getrennt, weil Protokolle sie getrennt ausweisen. */
  penalty: number | null
  final_score: number | null
  rank_apparatus: number | null
  note: string | null
}

