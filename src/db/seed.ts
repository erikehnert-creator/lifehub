/**
 * Startdatensatz. Wird nur einmal angelegt, wenn die Datenbank leer ist.
 * Alle Werte sind Daten, kein Code – jeder Eintrag ist später frei änderbar.
 */
import { all } from './sqlite'
import { insert, update } from './repo'
import { todayString, addDays, holidaysForState } from '../core/dates'

const EXPENSE_CATEGORIES: [string, string, string][] = [
  ['Wohnen', '🏠', 'var(--series-1)'],
  ['Lebensmittel', '🛒', 'var(--series-3)'],
  ['Tanken', '⛽', 'var(--series-2)'],
  ['Auto', '🚗', 'var(--series-4)'],
  ['Verkehr', '🚌', 'var(--series-7)'],
  ['Kleidung', '👕', 'var(--series-5)'],
  ['Freizeit', '🎬', 'var(--series-6)'],
  ['Party', '🎉', 'var(--series-8)'],
  ['Restaurants', '🍽️', 'var(--series-2)'],
  ['Alkohol', '🍺', 'var(--series-4)'],
  ['Urlaub', '✈️', 'var(--series-1)'],
  ['Sport', '🏋️', 'var(--series-3)'],
  ['Technik', '💻', 'var(--series-7)'],
  ['Versicherungen', '🛡️', 'var(--series-5)'],
  ['Abos', '🔁', 'var(--series-6)'],
  ['Geschenke', '🎁', 'var(--series-8)'],
  ['Gesundheit', '💊', 'var(--series-3)'],
  ['Hobby', '🎸', 'var(--series-4)'],
  ['Bildung', '📚', 'var(--series-1)'],
  ['Sonstiges', '📦', 'var(--series-2)'],
]

const INCOME_CATEGORIES: [string, string][] = [
  ['Gehalt', '💼'],
  ['Ausbildungsvergütung', '🎓'],
  ['Nebenjob', '🧰'],
  ['Geschenk', '🎁'],
  ['Rückerstattung', '↩️'],
  ['Verkauf', '🏷️'],
  ['Sonstige Einnahme', '➕'],
]

const METRICS: Array<{
  key: string; name: string; group: string; unit: string; type: string
  decimals: number; agg: string; dir: string; min?: number; max?: number
  labels?: string[]; target?: { value?: number; minus?: number; plus?: number; hardMin?: number; hardMax?: number }
  color?: string; sort: number; inForm?: boolean
}> = [
  { key: 'weight_kg', name: 'Gewicht', group: 'body', unit: 'kg', type: 'number', decimals: 1, agg: 'last', dir: 'range', color: 'var(--series-1)', sort: 10 },
  { key: 'calories', name: 'Kalorien', group: 'nutrition', unit: 'kcal', type: 'integer', decimals: 0, agg: 'sum', dir: 'range', target: { value: 2450, minus: 200, plus: 200, hardMin: 1800, hardMax: 3200 }, color: 'var(--series-2)', sort: 20 },
  { key: 'protein_g', name: 'Protein', group: 'nutrition', unit: 'g', type: 'integer', decimals: 0, agg: 'sum', dir: 'range', target: { value: 130, minus: 10, plus: 15, hardMin: 90, hardMax: 200 }, color: 'var(--series-3)', sort: 21 },
  { key: 'carbs_g', name: 'Kohlenhydrate', group: 'nutrition', unit: 'g', type: 'integer', decimals: 0, agg: 'sum', dir: 'range', target: { value: 300, minus: 25, plus: 25, hardMin: 180, hardMax: 450 }, color: 'var(--series-4)', sort: 22 },
  { key: 'fat_g', name: 'Fett', group: 'nutrition', unit: 'g', type: 'integer', decimals: 0, agg: 'sum', dir: 'range', target: { value: 70, minus: 10, plus: 10, hardMin: 40, hardMax: 120 }, color: 'var(--series-5)', sort: 23 },
  { key: 'water_l', name: 'Wasser', group: 'nutrition', unit: 'l', type: 'number', decimals: 1, agg: 'sum', dir: 'higher_better', target: { value: 3.2, minus: 0.2, plus: 1.5, hardMin: 1.5 }, color: 'var(--series-1)', sort: 24 },
  { key: 'sleep_h', name: 'Schlaf', group: 'sleep', unit: 'h', type: 'number', decimals: 1, agg: 'last', dir: 'range', target: { value: 8, minus: 1, plus: 1, hardMin: 5, hardMax: 11 }, color: 'var(--series-7)', sort: 30 },
  { key: 'sleep_quality', name: 'Schlafqualität', group: 'sleep', unit: '/10', type: 'scale', decimals: 0, agg: 'last', dir: 'higher_better', min: 1, max: 10, target: { value: 8, minus: 2, plus: 2, hardMin: 1, hardMax: 10 }, color: 'var(--series-7)', sort: 31 },
  { key: 'sugar_g', name: 'Zucker', group: 'nutrition', unit: 'g', type: 'integer', decimals: 0, agg: 'sum', dir: 'lower_better', target: { value: 50, minus: 50, plus: 20, hardMin: 0, hardMax: 120 }, color: 'var(--series-8)', sort: 25 },
  { key: 'energy', name: 'Energie', group: 'wellbeing', unit: '/10', type: 'scale', decimals: 0, agg: 'avg', dir: 'higher_better', min: 1, max: 10, target: { value: 8, minus: 2, plus: 2, hardMin: 1, hardMax: 10 }, color: 'var(--series-4)', sort: 50 },
  {
    key: 'skin', name: 'Hautstatus', group: 'wellbeing', unit: '/10', type: 'scale', decimals: 0, agg: 'last',
    dir: 'higher_better', min: 1, max: 10,
    target: { value: 8, minus: 3, plus: 2, hardMin: 1, hardMax: 10 }, color: 'var(--series-5)', sort: 51,
  },
  { key: 'pimples', name: 'Pickel gesamt', group: 'wellbeing', unit: 'Stück', type: 'integer', decimals: 0, agg: 'last', dir: 'lower_better', target: { value: 0, minus: 0, plus: 3, hardMin: 0, hardMax: 40 }, color: 'var(--series-2)', sort: 53 },
  { key: 'mood', name: 'Stimmung', group: 'wellbeing', unit: '/10', type: 'scale', decimals: 0, agg: 'last', dir: 'higher_better', min: 1, max: 10, color: 'var(--series-8)', sort: 52 },
]

const EXERCISES: Array<[string, string, string, boolean]> = [
  ['Weighted Pullups', 'strength', 'Rücken, Bizeps', false],
  ['Pull-ups', 'gymnastics', 'Rücken, Bizeps', true],
  ['Dumbbell Bizeps Curls', 'strength', 'Bizeps', false],
  ['Hammer Curls', 'strength', 'Bizeps, Unterarm', false],
  ['Hanging Leg Raises', 'core', 'Bauch, Hüftbeuger', true],
  ['Dragon Flags', 'core', 'Bauch gesamt', true],
  ['Shoulder Mobility Drills', 'mobility', 'Schulter', true],
  ['Banded Shoulder Stretch', 'mobility', 'Schulter', true],
  ['Wall Slides', 'mobility', 'Schulter, Rücken', true],
  ['Handstand Hold', 'gymnastics', 'Schulter, Core', true],
  ['L-Sit', 'gymnastics', 'Core', true],
  ['Dips', 'gymnastics', 'Brust, Trizeps', true],
  ['Push-ups', 'gymnastics', 'Brust, Trizeps', true],
  ['Plank', 'core', 'Core', true],
  ['Turntraining (frei)', 'gymnastics', 'ganzkörper', true],
]

export function seedIfEmpty(deviceId: string): void {
  const res = all<{ n: number }>('SELECT COUNT(*) AS n FROM categories')
  if (res.length && Number(res[0].n) > 0) return

  const today = todayString()

  // ---- Kategorien
  EXPENSE_CATEGORIES.forEach(([name, icon, color], i) => {
    insert('categories', { name, kind: 'expense', icon, color, sort_order: i, parent_id: null, is_archived: 0, is_system: 0, exclude_from_stats: 0 })
  })
  INCOME_CATEGORIES.forEach(([name, icon], i) => {
    insert('categories', { name, kind: 'income', icon, color: 'var(--series-6)', sort_order: i, parent_id: null, is_archived: 0, is_system: 0, exclude_from_stats: 0 })
  })

  // ---- Konten
  const giro = insert('accounts', {
    name: 'Girokonto', type: 'checking', currency: 'EUR', opening_balance_cents: 0,
    opening_date: today, color: 'var(--series-1)', icon: '🏦', is_active: 1,
    counts_as_savings: 0, counts_as_available: 1, include_in_net_worth: 1, sort_order: 0,
  })
  insert('accounts', {
    name: 'Bargeld', type: 'cash', currency: 'EUR', opening_balance_cents: 0,
    opening_date: today, color: 'var(--series-4)', icon: '💵', is_active: 1,
    counts_as_savings: 0, counts_as_available: 1, include_in_net_worth: 1, sort_order: 1,
  })
  insert('accounts', {
    name: 'Tagesgeld', type: 'savings', currency: 'EUR', opening_balance_cents: 0,
    opening_date: today, color: 'var(--series-3)', icon: '🐖', is_active: 1,
    counts_as_savings: 1, counts_as_available: 0, include_in_net_worth: 1, sort_order: 2,
  })
  insert('accounts', {
    name: 'GIVE-Card', type: 'custom', currency: 'EUR', opening_balance_cents: 0,
    opening_date: today, color: 'var(--series-5)', icon: '🎁', is_active: 1,
    counts_as_savings: 0, counts_as_available: 1, include_in_net_worth: 1, sort_order: 3,
  })
  insert('settings', { key: 'default_account_id', value_json: JSON.stringify(giro) })

  // ---- Tagesarten
  const dayTypes: Array<[string, string, string, string | null, string | null, number, string, number]> = [
    ['Frühschicht', 'F', 'work', '06:00', '14:30', 30, 'var(--series-1)', 1],
    ['Spätschicht', 'S', 'work', '14:00', '22:00', 30, 'var(--series-7)', 1],
    ['Nachtschicht', 'N', 'work', '22:00', '06:00', 30, 'var(--series-8)', 1],
    ['Berufsschule', 'BS', 'school', '07:30', '15:00', 45, 'var(--series-4)', 1],
    ['Urlaub', 'U', 'vacation', null, null, 0, 'var(--series-3)', 0],
    ['Frei', 'FR', 'off', null, null, 0, 'var(--series-6)', 0],
    ['Krank', 'K', 'sick', null, null, 0, 'var(--series-5)', 0],
  ]
  dayTypes.forEach(([name, code, kind, s, e, br, color, work], i) => {
    insert('day_types', {
      name, short_code: code, kind, default_start: s, default_end: e,
      break_minutes: br, color, counts_as_workday: work, sort_order: i,
    })
  })

  // ---- Metriken und Zielbereiche
  for (const m of METRICS) {
    const id = insert('metrics', {
      key: m.key, name: m.name, group_key: m.group, unit: m.unit, value_type: m.type,
      decimals: m.decimals, scale_min: m.min ?? null, scale_max: m.max ?? null,
      scale_labels_json: m.labels ? JSON.stringify(m.labels) : null,
      aggregation: m.agg, direction: m.dir, is_builtin: 1, is_enabled: 1,
      show_in_daily_form: m.inForm === false ? 0 : 1,
      show_zone: m.group === 'nutrition' || m.group === 'body' ? 1 : 0,
      color: m.color ?? null, sort_order: m.sort,
    })
    if (m.target) {
      insert('metric_targets', {
        metric_id: id, target_value: m.target.value ?? null,
        tolerance_minus: m.target.minus ?? null, tolerance_plus: m.target.plus ?? null,
        hard_min: m.target.hardMin ?? null, hard_max: m.target.hardMax ?? null,
        period: 'daily', valid_from: '2020-01-01', valid_to: null,
      })
    }
  }

  // ---- Übungen
  const exIds = new Map<string, string>()
  for (const [name, cat, muscles, bw] of EXERCISES) {
    exIds.set(name, insert('exercises', {
      name, category: cat, muscle_groups: muscles,
      tracks_weight: bw ? 0 : 1, tracks_reps: 1, tracks_time: cat === 'mobility' ? 1 : 0,
      is_bodyweight: bw ? 1 : 0, note: null,
    }))
  }

  // Kein vorgefertigter Trainingsplan: Pläne legst du selbst in der App an
  // (Training → Pläne), mit so vielen Wochen wie du brauchst.

  // ---- Feiertage (aktuelles + nächstes Jahr)
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    // Sachsen, weil Erik in Glashütte wohnt. Änderbar unter Einstellungen.
    for (const h of holidaysForState(y, 'SN')) {
      insert('holidays', { day: h.day, name: h.name, region: 'DE-SN', is_public: 1 })
    }
  }

  // ---- Eine Startaufgabe, damit die Inbox nicht leer wirkt
  insert('tasks', {
    title: 'Konten einrichten und Anfangssalden eintragen',
    description: 'Finanzen → Konten → Anfangssaldo setzen. Danach stimmt das Dashboard.',
    status: 'open', bucket: 'today', scheduled_on: today,
    duration_minutes: 15, priority: 3, sort_order: 0,
  })
  insert('tasks', {
    title: 'Ernährungsziele prüfen',
    description: 'Tracking → Ziele: Kalorien, Protein, Fett, Kohlenhydrate an deine Werte anpassen.',
    status: 'open', bucket: 'inbox', duration_minutes: 10, priority: 2, sort_order: 1,
  })
}

/** Beispieldaten zum Ausprobieren – nur auf ausdrücklichen Wunsch. */
export function seedDemoData(): number {
  const today = todayString()
  const accounts = all<{ id: string; type: string }>('SELECT id, type FROM accounts WHERE deleted_at IS NULL')
  const giro = accounts.find((a) => a.type === 'checking')?.id
  const cash = accounts.find((a) => a.type === 'cash')?.id
  const savings = accounts.find((a) => a.type === 'savings')?.id
  const cats = all<{ id: string; name: string; kind: string }>('SELECT id, name, kind FROM categories WHERE deleted_at IS NULL')
  const cat = (n: string) => cats.find((c) => c.name === n)?.id ?? null
  if (!giro) return 0

  // Startsalden setzen, damit die Auswertungen realistische Zahlen zeigen
  const openingDay = addDays(today, -181)
  if (giro) update('accounts', giro, { opening_balance_cents: 145000, opening_date: openingDay })
  if (cash) update('accounts', cash, { opening_balance_cents: 8000, opening_date: openingDay })
  if (savings) update('accounts', savings, { opening_balance_cents: 210000, opening_date: openingDay })

  let count = 0
  const rnd = mulberry32(20260818)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]

  const patterns: Array<[string, string, number, number, number]> = [
    // Kategorie, Händler, minCent, maxCent, Wahrscheinlichkeit pro Tag
    ['Lebensmittel', 'REWE', 1200, 5200, 0.17],
    ['Lebensmittel', 'Aldi', 900, 4200, 0.09],
    ['Tanken', 'Aral', 4000, 7500, 0.04],
    ['Restaurants', 'Imbiss', 700, 1900, 0.08],
    ['Freizeit', 'Kino', 1100, 2400, 0.02],
    ['Party', 'Bar', 1500, 5000, 0.03],
    ['Technik', 'Amazon', 1500, 9000, 0.025],
    ['Sport', 'Turnverein', 2500, 2500, 0.02],
    ['Kleidung', 'H&M', 2000, 6500, 0.015],
    ['Hobby', 'Musikladen', 1000, 4000, 0.012],
  ]
  for (let d = 180; d >= 0; d--) {
    const day = addDays(today, -d)
    const dom = Number(day.slice(8, 10))

    if (dom === 28) {
      insert('transactions', {
        type: 'income', booked_on: day, amount_cents: 118500, currency: 'EUR',
        account_id: giro, category_id: cat('Ausbildungsvergütung'),
        merchant: 'Arbeitgeber', description: 'Ausbildungsvergütung', status: 'booked',
      })
      count++
      insert('transactions', {
        type: 'transfer', booked_on: day, amount_cents: 25000, currency: 'EUR',
        account_id: giro, to_account_id: savings, category_id: null,
        description: 'Sparen', status: 'booked',
      })
      count++
    }
    if (dom === 1) {
      for (const [name, merchant, amount] of [['Wohnen', 'Miete', 32000], ['Abos', 'Spotify', 1099], ['Versicherungen', 'KFZ-Versicherung', 4200]] as Array<[string, string, number]>) {
        insert('transactions', {
          type: 'expense', booked_on: day, amount_cents: amount, currency: 'EUR',
          account_id: giro, category_id: cat(name), merchant, status: 'booked',
        })
        count++
      }
    }
    if (dom === 5) {
      insert('transactions', {
        type: 'transfer', booked_on: day, amount_cents: 10000, currency: 'EUR',
        account_id: giro, to_account_id: cash, description: 'Bargeld abgehoben', status: 'booked',
      })
      count++
    }

    for (const [catName, merchant, lo, hi, p] of patterns) {
      if (rnd() > p) continue
      const amount = Math.round(lo + rnd() * (hi - lo))
      insert('transactions', {
        type: 'expense', booked_on: day, amount_cents: amount, currency: 'EUR',
        account_id: rnd() < 0.25 && cash ? cash : giro,
        category_id: cat(catName), merchant, status: 'booked',
      })
      count++
    }

    // Tracking
    const metrics = all<{ id: string; key: string }>('SELECT id, key FROM metrics WHERE deleted_at IS NULL')
    const mid = (k: string) => metrics.find((m) => m.key === k)?.id
    const add = (k: string, v: number) => {
      const id = mid(k)
      if (!id) return
      insert('metric_entries', { metric_id: id, day, value_num: Math.round(v * 100) / 100, source: 'manual' })
      count++
    }
    if (d <= 120) {
      add('weight_kg', 52.4 + (120 - d) * 0.013 + (rnd() - 0.5) * 0.6)
      add('calories', 2300 + rnd() * 450)
      add('protein_g', 115 + rnd() * 35)
      add('carbs_g', 270 + rnd() * 80)
      add('fat_g', 60 + rnd() * 28)
      add('water_l', 2.2 + rnd() * 1.6)
      add('sleep_h', 6.2 + rnd() * 2.6)
      add('sleep_quality', 4 + Math.round(rnd() * 6))
      add('steps', 4000 + Math.round(rnd() * 9000))
      add('energy', 4 + Math.round(rnd() * 6))
      add('skin', 1 + Math.round(rnd() * 2.4))
    }

    // Training: Mo/Di/Do
    const wd = ((new Date(day).getDay() + 6) % 7) + 1
    if ([1, 2, 4].includes(wd) && d <= 90 && rnd() > 0.2) {
      insert('workout_sessions', {
        day, title: wd === 1 ? 'Turntraining' : wd === 2 ? 'Hypertrophie + Mobility' : 'Core + Arme',
        type: wd === 1 ? 'gymnastics' : 'strength',
        duration_minutes: 55 + Math.round(rnd() * 40),
        status: 'completed', perceived_effort: 5 + Math.round(rnd() * 4),
      })
      count++
    }

    // Körpermessung monatlich
    if (dom === 15 && d <= 150) {
      insert('body_measurements', {
        day, weight_kg: Math.round((52.6 + (150 - d) * 0.011) * 10) / 10,
        waist_cm: Math.round((75 - (150 - d) * 0.006) * 10) / 10,
        upper_arm_cm: Math.round((31 + (150 - d) * 0.004) * 10) / 10,
        chest_cm: 95, shoulder_cm: 112, body_fat_percent: 12.5, method: 'Caliper',
      })
      count++
    }
  }

  // Arbeitsplan: 2-Wochen-Rhythmus Früh/Spät, Wochenende frei,
  // dazu eine Berufsschulwoche und eine Urlaubswoche
  const dayTypes = all<{ id: string; short_code: string }>('SELECT id, short_code FROM day_types WHERE deleted_at IS NULL')
  const dt = (code: string) => dayTypes.find((x) => x.short_code === code)?.id
  const schoolWeekStart = addDays(today, -47)
  const holidayWeekStart = addDays(today, -96)
  for (let d = 180; d >= -20; d--) {
    const day = addDays(today, -d)
    const weekday = ((new Date(day).getDay() + 6) % 7) + 1
    const weekIndex = Math.floor((180 - d) / 7)
    let code: string | undefined
    if (day >= schoolWeekStart && day < addDays(schoolWeekStart, 5)) code = 'BS'
    else if (day >= holidayWeekStart && day < addDays(holidayWeekStart, 9)) code = 'U'
    else if (weekday >= 6) code = 'FR'
    else code = weekIndex % 2 === 0 ? 'F' : 'S'
    const id = dt(code)
    if (!id) continue
    insert('day_assignments', { day, day_type_id: id })
    count++
  }

  // Budgets
  const budgets: Array<[string, number]> = [
    ['Lebensmittel', 30000], ['Tanken', 20000], ['Party', 15000],
    ['Restaurants', 12000], ['Freizeit', 10000], ['Technik', 8000],
  ]
  for (const [name, amount] of budgets) {
    const id = cat(name)
    if (!id) continue
    insert('budgets', {
      category_id: id, period: 'monthly', amount_cents: amount,
      valid_from: addDays(today, -365), valid_to: null, warn_at_percent: 80, rollover: 0,
    })
    count++
  }

  // Ziele
  if (savings) {
    insert('goals', {
      name: 'Auto', description: 'Erstes eigenes Auto', domain: 'finance', goal_kind: 'amount',
      target_account_id: savings, start_value: 0, target_value: 8000,
      start_on: addDays(today, -200), target_on: '2027-06-01', status: 'active', icon: '🚗',
    })
    count++
  }
  const weightMetric = all<{ id: string }>("SELECT id FROM metrics WHERE key = 'weight_kg'")[0]
  if (weightMetric) {
    insert('goals', {
      name: 'Aufbau auf 58 kg', domain: 'body', goal_kind: 'metric_target',
      metric_id: weightMetric.id, start_value: 52.4, target_value: 58,
      start_on: addDays(today, -120), target_on: addDays(today, 240), status: 'active', icon: '💪',
    })
    count++
  }

  // Wiederkehrende Zahlungen
  insert('recurring_rules', {
    kind: 'transaction', title: 'Ausbildungsvergütung', rrule: 'FREQ=MONTHLY;BYMONTHDAY=28',
    starts_on: addDays(today, -365), template_json: JSON.stringify({ type: 'income', amount_cents: 118500, account_id: giro, category_id: cat('Ausbildungsvergütung') }),
    auto_book: 0, lead_days: 3, is_active: 1,
  })
  insert('recurring_rules', {
    kind: 'transaction', title: 'Miete', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
    starts_on: addDays(today, -365), template_json: JSON.stringify({ type: 'expense', amount_cents: 32000, account_id: giro, category_id: cat('Wohnen') }),
    auto_book: 0, lead_days: 5, is_active: 1,
  })
  insert('recurring_rules', {
    kind: 'transaction', title: 'Spotify', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
    starts_on: addDays(today, -365), template_json: JSON.stringify({ type: 'expense', amount_cents: 1099, account_id: giro, category_id: cat('Abos') }),
    auto_book: 0, lead_days: 3, is_active: 1,
  })
  count += 3

  return count
}

/** Deterministischer Zufall, damit Beispieldaten reproduzierbar sind. */
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fehlende eingebaute Metriken nachrüsten.
 * Läuft bei jedem Start und legt nur an, was noch nicht da ist – dadurch
 * bekommen auch bestehende Datenbestände neue Werte wie „Zucker", ohne dass
 * etwas überschrieben wird.
 */
export function ensureBuiltinMetrics(): number {
  const existing = new Set(
    all<{ key: string }>('SELECT key FROM metrics').map((r) => r.key),
  )
  let added = 0
  for (const m of METRICS) {
    if (existing.has(m.key)) continue
    const id = insert('metrics', {
      key: m.key, name: m.name, group_key: m.group, unit: m.unit, value_type: m.type,
      decimals: m.decimals, scale_min: m.min ?? null, scale_max: m.max ?? null,
      scale_labels_json: m.labels ? JSON.stringify(m.labels) : null,
      aggregation: m.agg, direction: m.dir, is_builtin: 1, is_enabled: 1,
      show_in_daily_form: m.inForm === false ? 0 : 1,
      show_zone: m.group === 'nutrition' || m.group === 'body' ? 1 : 0,
      color: m.color ?? null, sort_order: m.sort,
    })
    if (m.target) {
      insert('metric_targets', {
        metric_id: id, target_value: m.target.value ?? null,
        tolerance_minus: m.target.minus ?? null, tolerance_plus: m.target.plus ?? null,
        hard_min: m.target.hardMin ?? null, hard_max: m.target.hardMax ?? null,
        period: 'daily', valid_from: '2020-01-01', valid_to: null,
      })
    }
    added++
  }
  return added
}

/** Anzahl der Farben in `--cat-1 … --cat-N` (siehe theme.css). */
export const KATEGORIE_FARBEN = 24

/**
 * Jeder Kategorie eine feste, klar unterscheidbare Farbe geben.
 *
 * Ohne feste Farbe würden Diagramme die Farben nach Position vergeben – dann
 * wäre „Lebensmittel" im Januar blau und im Februar grün, und man müsste jedes
 * Mal neu in die Legende schauen. Mit fester Zuordnung erkennt man eine
 * Kategorie an ihrer Farbe wieder.
 *
 * Die Nummern liegen im Goldenen Winkel auseinander (siehe theme.css), deshalb
 * genügt es, in der bestehenden Reihenfolge durchzuzählen: Kategorien, die im
 * Diagramm nebeneinander landen, bekommen weit auseinanderliegende Farben.
 *
 * Läuft bei jedem Start und ändert nur, was noch keine Farbe hat.
 */
export function ensureCategoryColors(): number {
  const rows = all<{ id: string; color: string | null }>(
    `SELECT id, color FROM categories WHERE deleted_at IS NULL
     ORDER BY kind DESC, sort_order, name`,
  )
  // Die alte Palette hatte nur acht Farben und wiederholte sich deshalb im
  // Diagramm. Solche Farben gelten als „nicht bewusst gewählt" und werden
  // ersetzt; eine von Hand vergebene Farbe aus der neuen Palette bleibt.
  const istAltePalette = (c: string | null) => !c || /^var\(--series-\d+\)$/.test(c)
  let index = 0
  let gesetzt = 0
  for (const r of rows) {
    const nummer = (index % KATEGORIE_FARBEN) + 1
    index++
    if (!istAltePalette(r.color)) continue
    update('categories', r.id, { color: `var(--cat-${nummer})` })
    gesetzt++
  }
  return gesetzt
}
