/**
 * Eine Datenbank mit der Migration 10 aus dem aufgegebenen Ordner muss beim
 * Öffnen auf den gültigen Stand kommen – ohne dass Werte mit Gegenstück
 * verlorengehen, und ohne dass eine gesunde Datenbank angefasst wird.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../src/db/schema'
import { fremdeMigration10Angleichen, FREMDE_SPALTEN } from '../src/db/altstand'

/** Wörtlich die Migration 10 aus Commit c7ccd21 (alter Ordner). */
const FREMDE_MIGRATION_10 = `
  ALTER TABLE food_entries ADD COLUMN trans_fat_g REAL;
  ALTER TABLE food_entries ADD COLUMN polyunsaturated_fat_g REAL;
  ALTER TABLE food_entries ADD COLUMN monounsaturated_fat_g REAL;
  ALTER TABLE food_entries ADD COLUMN cholesterol_mg REAL;
  ALTER TABLE food_entries ADD COLUMN potassium_mg REAL;
  ALTER TABLE food_entries ADD COLUMN added_sugars_g REAL;
  ALTER TABLE food_entries ADD COLUMN vitamin_a_mcg REAL;
  ALTER TABLE food_entries ADD COLUMN vitamin_c_mg REAL;
  ALTER TABLE food_entries ADD COLUMN vitamin_d_mcg REAL;
  ALTER TABLE food_entries ADD COLUMN calcium_mg REAL;
  ALTER TABLE food_entries ADD COLUMN iron_mg REAL;
`

let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs() })

function spalten(db: Database): string[] {
  return db.exec('PRAGMA table_info(food_entries)')[0].values.map((r) => String(r[1]))
}

function datenbank(bis: number, fremd: boolean): Database {
  const db = new SQL.Database()
  for (const m of MIGRATIONS) if (m.id < bis) db.run(m.sql)
  if (fremd) db.run(FREMDE_MIGRATION_10)
  else db.run(MIGRATIONS.find((m) => m.id === 10)!.sql)
  return db
}

const JETZT = '2026-09-16T12:00:00.000Z'

describe('fremde Migration 10', () => {
  it('bringt die Spalten auf den gültigen Stand und übernimmt gleichbedeutende Werte', () => {
    const db = datenbank(10, true)
    db.run(
      `INSERT INTO food_entries (id, day, name, created_at, updated_at, _dirty,
         polyunsaturated_fat_g, monounsaturated_fat_g, vitamin_a_mcg, trans_fat_g, cholesterol_mg)
       VALUES ('f1', '2026-09-16', 'Haferflocken', ?, ?, 0, 1.5, 2.5, 30, 0.1, 12)`,
      [JETZT, JETZT],
    )

    expect(fremdeMigration10Angleichen(db)).toBe(true)

    const nachher = spalten(db)
    for (const s of Object.keys(FREMDE_SPALTEN)) expect(nachher).not.toContain(s)
    for (const s of ['poly_fat_g', 'mono_fat_g', 'vitamin_a_ug', 'cholesterol_mg']) expect(nachher).toContain(s)

    const [zeile] = db.exec(
      `SELECT poly_fat_g, mono_fat_g, vitamin_a_ug, cholesterol_mg, _dirty FROM food_entries WHERE id = 'f1'`,
    )[0].values
    expect(zeile).toEqual([1.5, 2.5, 30, 12, 1])

    // Danach laufen die späteren Migrationen normal weiter.
    for (const m of MIGRATIONS) if (m.id > 10) db.run(m.sql)
  })

  it('lässt eine Datenbank mit der gültigen Migration 10 unberührt', () => {
    const db = datenbank(10, false)
    const vorher = spalten(db)
    expect(fremdeMigration10Angleichen(db)).toBe(false)
    expect(spalten(db)).toEqual(vorher)
  })

  it('ergibt am Ende genau die Spalten einer frisch angelegten Datenbank', () => {
    const repariert = datenbank(10, true)
    fremdeMigration10Angleichen(repariert)
    const frisch = datenbank(10, false)
    expect([...spalten(repariert)].sort()).toEqual([...spalten(frisch)].sort())
  })
})
