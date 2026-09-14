/**
 * Alle sechzehn Nährwerte – jeder einzeln nachgerechnet.
 *
 * Eriks Frage nach dem Ballaststoff-Fehler war die richtige: „Teste, ob die
 * anderen fünfzehn wirklich korrekt gemappt werden und nicht nur zufällig
 * funktionieren." Zufällig funktionieren kann hier viel, denn ein vergessener
 * Nährwert fällt nicht auf – er wird einfach nicht übernommen, ohne Fehler,
 * ohne Meldung.
 *
 * Ein Nährwert muss an fünf Stellen zusammenpassen:
 *
 *   1. Feldname bei FatSecret          core/naehrwerte.ts → Rohantwort
 *   2. Spalte in `food_entries`         src/db/schema.ts
 *   3. Spalte auf dem Server            supabase/migrations/0001_init.sql
 *   4. Metrik im Seed                   src/db/seed.ts
 *   5. Vergleich beim erneuten Abgleich core/fatsecret.ts
 *
 * Stimmt eine nicht, ist der Wert still weg. Deshalb wird hier jede einzeln
 * geprüft – und zwar gegen die Liste, nicht gegen eine zweite Aufzählung,
 * die dieselben Lücken haben könnte.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NAEHRWERTE, NAEHRWERT_KEYS, WICHTIGE_NAEHRWERTE } from '../src/core/naehrwerte'
import {
  ERNAEHRUNGS_METRIKEN, aggregateDay, parseFoodEntries, reconcileFoodEntries,
  type LokalesLebensmittel,
} from '../src/core/fatsecret'
import { MIGRATIONS } from '../src/db/schema'
import { METRICS } from '../src/db/seed'

const TAG = '2026-09-14'
const TAG_INT = Math.floor(Date.UTC(2026, 8, 14) / 86400000)

/**
 * Eine Antwort, wie FatSecret sie schickt – von Hand geschrieben.
 *
 * Absichtlich NICHT aus `NAEHRWERTE` erzeugt. Ein Test, der die Rohantwort aus
 * derselben Liste baut, die er prüfen soll, bestätigt nur sich selbst: Wer
 * `fiber` zu `fibre` verschriebe, änderte damit auch die Testdaten, und der
 * Test bliebe grün, während in LifeHub nichts mehr ankäme.
 *
 * Die Feldnamen hier stehen deshalb ausgeschrieben, so wie sie in der Doku zu
 * `food_entries.get.v2` stehen. Jeder Wert ist unverwechselbar, damit eine
 * Verwechslung zweier Felder auffällt.
 */
const ROHANTWORT = {
  food_entry_id: '1', date_int: String(TAG_INT), meal: 'breakfast',
  food_entry_name: 'Prüfmahlzeit', number_of_units: '1',
  calories: '511',
  protein: '22.5',
  carbohydrate: '33.5',
  fat: '44.5',
  fiber: '55.5',
  sugar: '66.5',
  saturated_fat: '77.5',
  polyunsaturated_fat: '88.5',
  monounsaturated_fat: '99.5',
  cholesterol: '110.5',
  sodium: '121.5',
  potassium: '132.5',
  calcium: '143.5',
  iron: '154.5',
  vitamin_a: '165.5',
  vitamin_c: '176.5',
}

/** Was daraus in LifeHub werden muss – ebenfalls von Hand. */
const ERWARTET: Record<string, number> = {
  calories: 511,
  protein_g: 22.5,
  carbs_g: 33.5,
  fat_g: 44.5,
  fiber_g: 55.5,
  sugar_g: 66.5,
  saturated_fat_g: 77.5,
  poly_fat_g: 88.5,
  mono_fat_g: 99.5,
  cholesterol_mg: 110.5,
  sodium_mg: 121.5,
  potassium_mg: 132.5,
  calcium_mg: 143.5,
  iron_mg: 154.5,
  vitamin_a_ug: 165.5,
  vitamin_c_mg: 176.5,
}

/* ------------------------------------------------------------ Die Liste */

describe('Die Nährwertliste selbst', () => {
  it('umfasst die sechzehn Werte, die FatSecret je Eintrag liefert', () => {
    expect(NAEHRWERTE).toHaveLength(16)
  })

  it('vergibt jeden Schlüssel und jedes FatSecret-Feld nur einmal', () => {
    // Ein doppelter Schlüssel überschriebe still den anderen Wert.
    expect(new Set(NAEHRWERTE.map((n) => n.key)).size).toBe(NAEHRWERTE.length)
    expect(new Set(NAEHRWERTE.map((n) => n.feld)).size).toBe(NAEHRWERTE.length)
  })

  it('führt genau die fünf, nach denen man täglich schaut, als wichtig', () => {
    expect([...WICHTIGE_NAEHRWERTE]).toEqual([
      'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g',
    ])
  })

  it('ist die Quelle für die Tagesmetriken', () => {
    expect([...ERNAEHRUNGS_METRIKEN]).toEqual([...NAEHRWERT_KEYS])
  })
})

/* ------------------------------------------- 1. Vom FatSecret-Feld zum Wert */

describe('Jeder Nährwert kommt aus dem richtigen FatSecret-Feld', () => {
  const [eintrag] = parseFoodEntries({ food_entries: { food_entry: [ROHANTWORT] } })

  it('kennt zu jedem Nährwert eine erwartete Zahl', () => {
    // Sonst liefe die Prüfung unten gegen `undefined` und wäre bedeutungslos.
    for (const n of NAEHRWERTE) expect(ERWARTET[n.key], n.key).toBeTypeOf('number')
    expect(Object.keys(ERWARTET)).toHaveLength(NAEHRWERTE.length)
  })

  for (const n of NAEHRWERTE) {
    it(`${n.name} aus „${n.feld}" (${n.einheit})`, () => {
      expect((eintrag as any)[n.key]).toBe(ERWARTET[n.key])
    })
  }

  it('macht aus einem fehlenden Wert null und nicht 0', () => {
    // „keine Angabe" und „nichts davon gegessen" sind zwei verschiedene
    // Aussagen. Nur die zweite darf in einem Zielbereich landen.
    const [ohne] = parseFoodEntries({
      food_entries: { food_entry: [{ food_entry_id: '2', date_int: String(TAG_INT), calories: '100' }] },
    })
    expect(ohne.calories).toBe(100)
    expect(ohne.fiber_g).toBeNull()
    expect(ohne.vitamin_a_ug).toBeNull()
  })
})

/* --------------------------------------------------- 2. Tagessummen bilden */

describe('Jeder Nährwert wird zur Tagessumme addiert', () => {
  const zweiter = { ...ROHANTWORT, food_entry_id: '2' }
  const werte = aggregateDay(parseFoodEntries({ food_entries: { food_entry: [ROHANTWORT, zweiter] } }))

  for (const n of NAEHRWERTE) {
    it(`${n.name} summiert über beide Mahlzeiten`, () => {
      expect(werte[n.key]).toBe(ERWARTET[n.key] * 2)
    })
  }
})

/* ------------------------------------- 3. Korrekturen werden nachgezogen */

describe('Jeder Nährwert wird bei einer Korrektur nachgezogen', () => {
  // Der Fall, den man beim Nachtragen einer Spalte am leichtesten vergisst:
  // Der Wert wird beim ERSTEN Import geschrieben, danach nie wieder
  // aktualisiert. Korrigiert man die Portion in FatSecret, bliebe der alte
  // Wert stehen – ohne dass irgendwo ein Fehler auftaucht.
  const [original] = parseFoodEntries({ food_entries: { food_entry: [ROHANTWORT] } })

  for (const n of NAEHRWERTE) {
    it(`${n.name} wird aktualisiert`, () => {
      const lokal = {
        id: 'x', day: TAG, external_id: '1', source: 'fatsecret', deleted_at: null,
        meal: 'breakfast', name: 'Prüfmahlzeit', serving_description: null, number_of_units: 1,
        ...Object.fromEntries(NAEHRWERT_KEYS.map((k) => [k, (original as any)[k]])),
      } as LokalesLebensmittel

      const geaendert = { ...original, [n.key]: 999 }
      const plan = reconcileFoodEntries({
        day: TAG, remote: [geaendert], lokal: [lokal], syncedAt: 'jetzt',
      })
      expect(plan.aendern, `${n.key} wird beim erneuten Abgleich nicht verglichen`).toHaveLength(1)
      expect(plan.aendern[0].patch[n.key]).toBe(999)
    })
  }
})

/* ------------------------------------------------- 4. Spalten und Metriken */

describe('Jeder Nährwert hat seinen Platz in der Datenbank', () => {
  const lokalesSchema = MIGRATIONS.map((m) => m.sql).join('\n')
  const serverSchema = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0001_init.sql'), 'utf8',
  )

  for (const n of NAEHRWERTE) {
    it(`${n.name}: Spalte in food_entries (lokal)`, () => {
      const da = new RegExp(`\\b${n.key}\\s+REAL`, 'i').test(lokalesSchema)
      expect(da, `In src/db/schema.ts fehlt:\n  ALTER TABLE food_entries ADD COLUMN ${n.key} REAL;`).toBe(true)
    })

    it(`${n.name}: Spalte in food_entries (Server)`, () => {
      // Fehlt sie dort, scheitert der Abgleich der ganzen Tabelle bei jedem
      // Versuch – und zwar still, weil nur eine von vierzig Tabellen betroffen ist.
      const da = new RegExp(`\\b${n.key}\\b`, 'i').test(serverSchema)
      expect(da, `In supabase/migrations/0001_init.sql fehlt:\n`
        + `  ALTER TABLE food_entries ADD COLUMN IF NOT EXISTS ${n.key} real;`).toBe(true)
    })

    it(`${n.name}: eingebaute Metrik mit passender Einheit`, () => {
      const metrik = METRICS.find((m) => m.key === n.key)
      expect(metrik, `In src/db/seed.ts fehlt die Metrik „${n.name}" (key ${n.key})`).toBeTruthy()
      expect(metrik!.group).toBe('nutrition')
      expect(metrik!.name, 'Anzeigename weicht von core/naehrwerte.ts ab').toBe(n.name)
      expect(metrik!.unit, 'Einheit weicht von der gelieferten ab').toBe(n.einheit)
      expect(metrik!.agg, 'Nährwerte werden über den Tag summiert').toBe('sum')
    })
  }

  it('lässt Wasser aus – das trägt Erik selbst ein', () => {
    // FatSecret liefert keine Trinkmenge. Stünde water_l in der Liste, räumte
    // jeder Abgleich den von Hand eingetragenen Wert ab.
    expect(NAEHRWERT_KEYS).not.toContain('water_l' as any)
    expect(METRICS.some((m) => m.key === 'water_l')).toBe(true)
  })
})
