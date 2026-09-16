/**
 * Was ein vollständiges Nachladen kostet.
 *
 * Der Zustand der App wird nach JEDER Änderung komplett neu aus SQLite
 * gelesen (`loadAll()` in state/store.tsx) – rund vierzig Abfragen, ein Haken
 * an einer Aufgabe genauso wie ein Import mit tausend Zeilen. Das ist bewusst
 * einfach gehalten und war lange richtig. Ob es das bleibt, ist aber keine
 * Geschmacksfrage, sondern eine Messung: Dieser Test baut das echte Schema
 * auf, füllt es mit einer Datenmenge, wie sie nach ein paar Jahren LifeHub
 * zusammenkommt, und misst.
 *
 * Er ist absichtlich großzügig gesetzt. Er soll nicht bei jedem Rauschen
 * ausschlagen, sondern dann, wenn das Nachladen wirklich anfängt zu bremsen –
 * und er hält fest, wie lange es heute dauert, damit ein späterer Umbau eine
 * Vorher-Zahl hat.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs from 'sql.js'
import { MIGRATIONS } from '../src/db/schema'

/** So viel, wie nach einigen Jahren täglicher Nutzung dasteht. */
const BUCHUNGEN = 6000
const AUFGABEN = 4000
const MESSWERTE = 20000
const LEBENSMITTEL = 12000
const TERMINE = 2000

let db: any

/** Dieselben Abfragen, die loadAll() absetzt – ohne React drumherum. */
const TABELLEN_MIT_SORTIERUNG: [string, string | null][] = [
  ['settings', null],
  ['accounts', 'sort_order, name'],
  ['categories', 'sort_order, name'],
  ['transactions', 'booked_on DESC, created_at DESC'],
  ['budgets', null],
  ['recurring_rules', 'title'],
  ['tasks', 'sort_order, created_at DESC'],
  ['projects', 'name'],
  ['calendar_events', 'day, start_time'],
  ['day_types', 'sort_order'],
  ['day_assignments', 'day'],
  ['shift_patterns', null],
  ['holidays', 'day'],
  ['time_blocks', 'day, start_time'],
  ['metrics', 'sort_order'],
  ['metric_entries', 'day'],
  ['metric_targets', null],
  ['exercises', 'name'],
  ['workout_plans', null],
  ['workout_plan_days', 'week_index, weekday'],
  ['workout_plan_exercises', 'sort_order'],
  ['workout_sessions', 'day DESC'],
  ['workout_sets', 'set_index'],
  ['body_measurements', 'day DESC'],
  ['day_notes', 'day DESC'],
  ['investments', 'name'],
  ['investment_moves', 'day DESC'],
  ['goals', null],
  ['goal_contributions', 'day DESC'],
  ['task_templates', 'weekday, title'],
  ['account_checks', 'day DESC'],
  ['notes', 'created_at DESC'],
  ['insights', 'created_at DESC'],
  ['finance_day_runs', 'ran_on DESC'],
  ['monthly_closings', 'year_month DESC'],
  ['attachments', null],
  ['import_batches', 'imported_at DESC'],
  ['shopping_items', 'is_checked, sort_order, name'],
  ['food_entries', 'day DESC, meal, sort_order'],
]

function ladeAlles(): number {
  let zeilen = 0
  for (const [tabelle, sortierung] of TABELLEN_MIT_SORTIERUNG) {
    const sql = `SELECT * FROM ${tabelle} WHERE deleted_at IS NULL`
      + (sortierung ? ` ORDER BY ${sortierung}` : '')
    // Genau wie db/sqlite.ts: Zeilen als Objekte herausreichen, nicht nur zählen.
    const stmt = db.prepare(tabelle === 'settings' ? `SELECT * FROM settings` : sql)
    while (stmt.step()) { stmt.getAsObject(); zeilen++ }
    stmt.free()
  }
  return zeilen
}

function tag(i: number): string {
  const d = new Date(Date.UTC(2020, 0, 1) + (i % 2000) * 86400000)
  return d.toISOString().slice(0, 10)
}

beforeAll(async () => {
  const SQL = await initSqlJs()
  db = new SQL.Database()
  for (const m of MIGRATIONS) db.run(m.sql)

  const basis = (id: string) => [id, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', null, 1, 'bench', null, 0, 0]
  const B = 'created_at, updated_at, deleted_at, version, last_device_id, server_rev, _dirty, _conflict'

  db.run('BEGIN')
  db.run(`INSERT INTO accounts (id, name, type, currency, opening_balance_cents, opening_date, is_active, counts_as_savings, counts_as_available, include_in_net_worth, sort_order, ${B}) VALUES ('a1','Giro','checking','EUR',0,'2020-01-01',1,0,1,1,0,?,?,?,?,?,?,?,?)`,
    basis('a1').slice(1))

  let s = db.prepare(`INSERT INTO transactions (id, type, booked_on, amount_cents, currency, account_id, status, ${B}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < BUCHUNGEN; i++) s.run(['t' + i, 'expense', tag(i), 1000 + i, 'EUR', 'a1', 'booked', ...basis('x').slice(1)])
  s.free()

  s = db.prepare(`INSERT INTO tasks (id, title, status, bucket, priority, sort_order, ${B}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < AUFGABEN; i++) s.run(['k' + i, 'Aufgabe ' + i, 'open', 'inbox', 2, 0, ...basis('x').slice(1)])
  s.free()

  db.run(`INSERT INTO metrics (id, key, name, group_key, unit, value_type, is_enabled, show_in_daily_form, sort_order, ${B}) VALUES ('m1','weight_kg','Gewicht','koerper','kg','number',1,1,0,?,?,?,?,?,?,?,?)`,
    basis('m1').slice(1))
  s = db.prepare(`INSERT INTO metric_entries (id, metric_id, day, value_num, source, ${B}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < MESSWERTE; i++) s.run(['e' + i, 'm1', tag(i), 70 + (i % 10), 'manual', ...basis('x').slice(1)])
  s.free()

  s = db.prepare(`INSERT INTO food_entries (id, day, meal, name, calories, protein_g, source, sort_order, ${B}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < LEBENSMITTEL; i++) s.run(['f' + i, tag(i), 'lunch', 'Essen ' + i, 300, 20, 'fatsecret', 0, ...basis('x').slice(1)])
  s.free()

  s = db.prepare(`INSERT INTO calendar_events (id, title, day, all_day, timezone, source, ${B}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (let i = 0; i < TERMINE; i++) s.run(['c' + i, 'Termin ' + i, tag(i), 0, 'Europe/Berlin', 'local', ...basis('x').slice(1)])
  s.free()
  db.run('COMMIT')
})

describe('Vollständiges Nachladen', () => {
  it('liest den ganzen Bestand in vertretbarer Zeit', () => {
    const zeilen = ladeAlles()               // einmal warmlaufen
    expect(zeilen).toBeGreaterThan(40000)

    const runden = 5
    const t0 = performance.now()
    for (let i = 0; i < runden; i++) ladeAlles()
    const proLauf = (performance.now() - t0) / runden

    console.log(`  loadAll(): ${proLauf.toFixed(1)} ms für ${zeilen} Zeilen aus ${TABELLEN_MIT_SORTIERUNG.length} Tabellen`)

    // Die Schwelle markiert, ab wann ein Tastendruck spürbar hängt. Sie ist
    // bewusst weit gesetzt: Hier soll ein echter Einbruch auffallen, nicht
    // die Tagesform des Rechners.
    expect(proLauf).toBeLessThan(1500)
  })

  it('nur die Buchungen zu lesen ist ein Bruchteil davon', () => {
    // Die Gegenprobe zur Frage „lohnt gezieltes Nachladen?": Wenn ein
    // einzelner Haken an einer Aufgabe alles neu liest, zahlt er auch für
    // 12.000 Lebensmittel und 20.000 Messwerte mit.
    const einzeln = () => {
      const stmt = db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, created_at DESC')
      let n = 0
      while (stmt.step()) { stmt.getAsObject(); n++ }
      stmt.free()
      return n
    }
    einzeln()
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) einzeln()
    const proLauf = (performance.now() - t0) / 5

    const t1 = performance.now()
    for (let i = 0; i < 5; i++) ladeAlles()
    const alles = (performance.now() - t1) / 5

    console.log(`  nur tasks: ${proLauf.toFixed(1)} ms  ·  alles: ${alles.toFixed(1)} ms  ·  Faktor ${(alles / proLauf).toFixed(1)}`)
    expect(proLauf).toBeLessThan(alles)
  })
})
