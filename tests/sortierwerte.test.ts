/**
 * Der Fall „Ballaststoffe 23.5" – und dass er nicht wiederkommt.
 *
 * Beim Nachtragen von Ballaststoffen war der freie Platz zwischen Fett (23)
 * und Wasser (24) verlockend, also bekam der Wert `sort: 23.5`. SQLite nahm
 * das an – eine INTEGER-Spalte ist dort eine Neigung, kein Versprechen.
 * PostgreSQL nahm es nicht an, und weil der Abgleich eine Tabelle immer als
 * Ganzes sendet, scheiterte damit nicht diese eine Zeile, sondern `metrics`
 * vollständig:
 *
 *   Teilweise synchronisiert. Fehlgeschlagen: metrics: 400
 *   22P02  invalid input syntax for type integer: "23.5"
 *
 * Bei jedem Versuch aufs Neue, während alle anderen Tabellen unauffällig
 * weiterliefen. Geprüft wird deshalb auf drei Ebenen:
 *
 *   1. Die Seed-Liste selbst – dort ist der Wert entstanden.
 *   2. Migration 9 auf einer echten Datenbank mit dem alten 23.5.
 *   3. Das Erkennen und Berichtigen beim Senden, für jeden Fall, den heute
 *      noch niemand kennt.
 */
import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { MIGRATIONS } from '../src/db/schema'
import { METRICS } from '../src/db/seed'
import {
  berichtigungsText, ganzzahlSpalten, gebrocheneWerte,
} from '../src/core/ganzzahlen'

/* ------------------------------------------------------- 1. Die Seed-Liste */

describe('Eingebaute Trackingwerte', () => {
  it('haben durchweg ganzzahlige Sortierwerte', () => {
    const krumm = METRICS
      .filter((m) => !Number.isInteger(m.sort))
      .map((m) => `${m.key} = ${m.sort}`)
    expect(
      krumm,
      'metrics.sort_order ist auf dem Server integer – diese Werte blockieren '
      + 'den Abgleich der ganzen Tabelle:\n  ' + krumm.join('\n  '),
    ).toEqual([])
  })

  it('sind eindeutig, damit die Reihenfolge nicht vom Zufall abhängt', () => {
    // store.tsx liest `ORDER BY sort_order` ohne zweites Kriterium. Bei
    // gleichen Werten entscheidet die Einfügereihenfolge – auf zwei Geräten
    // möglicherweise verschieden.
    const gesehen = new Map<number, string>()
    const doppelt: string[] = []
    for (const m of METRICS) {
      const vorher = gesehen.get(m.sort)
      if (vorher) doppelt.push(`${vorher} und ${m.key} teilen sich ${m.sort}`)
      else gesehen.set(m.sort, m.key)
    }
    expect(doppelt).toEqual([])
  })

  it('stellen Ballaststoffe weiterhin zwischen Fett und Wasser', () => {
    // Die Zahl darf sich ändern, die Reihenfolge nicht – sonst wäre der Fehler
    // zwar behoben, aber die Ernährungsseite sortierte plötzlich anders.
    const s = (key: string) => METRICS.find((m) => m.key === key)!.sort
    expect(s('fat_g')).toBeLessThan(s('fiber_g'))
    expect(s('fiber_g')).toBeLessThan(s('water_l'))
  })
})

/* ------------------------------------ 2. Migration 9 auf echten Altdaten */

/** Eine Datenbank im Zustand vor Migration 9, mit dem krummen Wert darin. */
async function altbestand() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  for (const m of MIGRATIONS) {
    if (m.id >= 9) break
    db.run(m.sql)
  }
  // So, wie Migration 8 die Werte hinterlassen hat.
  const werte: [string, string, number][] = [
    ['m1', 'weight_kg', 10], ['m2', 'calories', 20], ['m3', 'protein_g', 21],
    ['m4', 'carbs_g', 22], ['m5', 'fat_g', 23], ['m6', 'fiber_g', 23.5],
    ['m7', 'water_l', 24], ['m8', 'sugar_g', 25], ['m9', 'sleep_h', 30],
  ]
  for (const [id, key, sort] of werte) {
    db.run(
      `INSERT INTO metrics (id, key, name, group_key, unit, value_type, decimals,
         aggregation, direction, is_builtin, is_enabled, show_in_daily_form,
         sort_order, created_at, updated_at, version, last_device_id, _dirty)
       VALUES (?, ?, ?, 'nutrition', 'g', 'integer', 0, 'sum', 'range', 1, 1, 1, ?,
               '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 1, 'pc', 0)`,
      [id, key, key, sort] as any,
    )
  }
  return db
}

const reihenfolge = (db: any): string[] =>
  (db.exec('SELECT key FROM metrics ORDER BY sort_order')[0]?.values ?? [])
    .map((r: any[]) => String(r[0]))

const krummeWerte = (db: any): number =>
  Number(db.exec(
    'SELECT COUNT(*) FROM metrics WHERE sort_order <> CAST(sort_order AS INTEGER)',
  )[0].values[0][0])

const migration9 = MIGRATIONS.find((m) => m.id === 9)!

describe('Migration 9 auf einer bestehenden Datenbank', () => {
  it('findet den alten 23.5 wirklich vor', async () => {
    // Absicherung gegen einen Test, der nur deshalb grün ist, weil der
    // Ausgangszustand gar nicht der beschriebene war.
    const db = await altbestand()
    expect(krummeWerte(db)).toBe(1)
    expect(
      db.exec("SELECT typeof(sort_order) FROM metrics WHERE key = 'fiber_g'")[0].values[0][0],
    ).toBe('real')
    db.close()
  })

  it('macht daraus ganze Zahlen', async () => {
    const db = await altbestand()
    db.run(migration9.sql)
    expect(krummeWerte(db)).toBe(0)
    const typen = db.exec('SELECT DISTINCT typeof(sort_order) FROM metrics')[0].values
    expect(typen).toEqual([['integer']])
    db.close()
  })

  it('lässt die sichtbare Reihenfolge unverändert', async () => {
    const db = await altbestand()
    const vorher = reihenfolge(db)
    db.run(migration9.sql)
    expect(reihenfolge(db)).toEqual(vorher)
    db.close()
  })

  it('markiert die berichtigten Zeilen zum erneuten Senden', async () => {
    // Ohne das liefe der Abgleich zwar durch, der Server behielte aber den
    // alten Stand – der Fehler wäre weg, die Ursache noch da.
    const db = await altbestand()
    db.run(migration9.sql)
    const offen = Number(db.exec('SELECT COUNT(*) FROM metrics WHERE _dirty = 1')[0].values[0][0])
    expect(offen).toBe(9)
    db.close()
  })

  it('lässt eine bereits saubere Datenbank vollständig in Ruhe', async () => {
    const db = await altbestand()
    db.run(migration9.sql)
    db.run('UPDATE metrics SET _dirty = 0')
    const vorher = db.exec('SELECT key, sort_order FROM metrics ORDER BY key')[0].values

    db.run(migration9.sql)                       // zweiter Lauf
    expect(db.exec('SELECT key, sort_order FROM metrics ORDER BY key')[0].values).toEqual(vorher)
    const angefasst = Number(db.exec('SELECT COUNT(*) FROM metrics WHERE _dirty = 1')[0].values[0][0])
    expect(angefasst).toBe(0)
    db.close()
  })

  it('verliert keine Zeile und keinen anderen Wert', async () => {
    const db = await altbestand()
    const vorher = db.exec('SELECT id, key, name, unit, is_builtin FROM metrics ORDER BY id')[0].values
    db.run(migration9.sql)
    expect(db.exec('SELECT id, key, name, unit, is_builtin FROM metrics ORDER BY id')[0].values)
      .toEqual(vorher)
    db.close()
  })

  it('lässt Platz für den nächsten Wert zwischen zweien', async () => {
    // Der eigentliche Grund für 23.5 war, dass zwischen 23 und 24 nichts
    // mehr passte. Mit Schrittweite 10 passt wieder etwas.
    const db = await altbestand()
    db.run(migration9.sql)
    const werte = (db.exec('SELECT sort_order FROM metrics ORDER BY sort_order')[0].values as any[])
      .map((r) => Number(r[0]))
    for (let i = 1; i < werte.length; i++) expect(werte[i] - werte[i - 1]).toBeGreaterThan(1)
    db.close()
  })
})

/* --------------------------------- 3. Erkennen und Berichtigen beim Senden */

describe('Gebrochene Werte vor dem Senden', () => {
  const spalten = ['sort_order', 'version', 'decimals']

  it('erkennt genau den Fall, der den Abgleich blockiert hat', () => {
    const befund = gebrocheneWerte({ id: 'm6', sort_order: 23.5, version: 1 }, spalten)
    expect(befund).toEqual([{ spalte: 'sort_order', wert: 23.5, ganz: 24 }])
  })

  it('beanstandet nichts an einer sauberen Zeile', () => {
    expect(gebrocheneWerte({ id: 'm5', sort_order: 23, version: 1, decimals: 0 }, spalten)).toEqual([])
  })

  it('hält leere Spalten für zulässig', () => {
    // Eine leere Spalte ist kein Typfehler – PostgreSQL nimmt NULL an.
    expect(gebrocheneWerte({ sort_order: null, version: undefined, decimals: '' }, spalten)).toEqual([])
  })

  it('nimmt Zahlen, die als Text zurückkommen', () => {
    // SQLite gibt je nach Weg mal eine Zahl, mal eine Zeichenkette zurück.
    // '23' ist für PostgreSQL gültig, '23.5' nicht.
    expect(gebrocheneWerte({ sort_order: '23' }, spalten)).toEqual([])
    expect(gebrocheneWerte({ sort_order: '23.5' }, spalten)).toEqual([
      { spalte: 'sort_order', wert: 23.5, ganz: 24 },
    ])
  })

  it('lässt Spalten in Ruhe, die gar nicht ganzzahlig sind', () => {
    // value_num ist REAL – 71.4 kg sind dort richtig und kein Fehler.
    expect(gebrocheneWerte({ value_num: 71.4 }, spalten)).toEqual([])
  })

  it('liest die ganzzahligen Spalten aus SQLite selbst', () => {
    const info = [
      { name: 'id', type: 'TEXT' },
      { name: 'sort_order', type: 'INTEGER' },
      { name: 'value_num', type: 'REAL' },
      { name: '_dirty', type: 'INTEGER' },      // bleibt auf dem Gerät
    ]
    expect(ganzzahlSpalten(info)).toEqual(['sort_order'])
  })

  it('erklärt die Berichtigung in einem Satz statt mit 22P02', () => {
    const text = berichtigungsText([
      { tabelle: 'metrics', spalte: 'sort_order', wert: 23.5, ganz: 24 },
    ])
    expect(text).toContain('metrics.sort_order 23.5 → 24')
    expect(text).not.toContain('22P02')
  })

  it('sagt nichts, wenn nichts zu berichtigen war', () => {
    expect(berichtigungsText([])).toBe('')
  })
})

/* ------------------------------ 4. Das ganze Schema gegen denselben Fehler */

describe('Ganzzahlige Spalten im gesamten lokalen Schema', () => {
  it('bekommen aus dem Seed keine Nachkommastellen', async () => {
    // Breiter als der Einzelfall: Jede Spalte, die SQLite als INTEGER führt,
    // wird mit dem Seed-Wert belegt, der dort landen würde.
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    for (const m of MIGRATIONS) db.run(m.sql)
    const info = db.exec("SELECT name, type FROM pragma_table_info('metrics')")[0].values
    const intSpalten = ganzzahlSpalten(
      (info as any[]).map((r) => ({ name: String(r[0]), type: String(r[1]) })),
    )
    db.close()

    expect(intSpalten).toContain('sort_order')
    for (const m of METRICS) {
      expect(gebrocheneWerte({ sort_order: m.sort, decimals: m.decimals }, intSpalten), m.key)
        .toEqual([])
    }
  })
})
