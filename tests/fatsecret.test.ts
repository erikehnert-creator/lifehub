/**
 * Der FatSecret-Import.
 *
 * Geprüft wird vor allem das, was die Schnittstelle einem antut: Zahlen als
 * Text, ein einzelner Eintrag als Objekt statt als Liste, Datumsangaben als
 * Tage seit 1970. Dazu die Eigenschaft, auf die es beim wiederholten Abgleich
 * ankommt – dass er nichts doppelt anlegt und nichts still überschreibt.
 */
import { describe, it, expect } from 'vitest'
import {
  parseFoodEntries, aggregateDay, dayToEpochDay, epochDayToDay,
  reconcileFoodEntries, planNutritionMetrics, foodEntryRowId, nutritionEntryId,
  planIstLeer, type FatSecretEntry, type LokalesLebensmittel,
} from '../src/core/fatsecret'

const TAG = '2026-09-14'
const TAG_INT = dayToEpochDay(TAG)

/** Eine Antwort, wie FatSecret sie tatsächlich schickt: alles als Text. */
function roh(eintraege: Record<string, string>[]) {
  return { food_entries: { food_entry: eintraege } }
}

const HAFERFLOCKEN = {
  food_entry_id: '111', food_id: 'f-hafer', date_int: String(TAG_INT), meal: 'breakfast',
  food_entry_name: 'Haferflocken', food_entry_description: '100 g - Kalorien: 370kcal',
  number_of_units: '1', calories: '370', protein: '13.5', carbohydrate: '58.7',
  fat: '7', fiber: '10', sugar: '1.1', saturated_fat: '1.3', sodium: '8',
}
/** Ein Eintrag, bei dem FatSecret ALLE Naehrwerte mitliefert. */
const VOLLSTAENDIG = {
  food_entry_id: '999', food_id: 'f-voll', date_int: String(TAG_INT), meal: 'lunch',
  food_entry_name: 'Vollstaendig', number_of_units: '1',
  calories: '500', protein: '30', carbohydrate: '40', fat: '20',
  fiber: '6', sugar: '9', saturated_fat: '4', sodium: '600',
  trans_fat: '0.3', polyunsaturated_fat: '2.5', monounsaturated_fat: '8.1',
  cholesterol: '75', potassium: '450', added_sugars: '3',
  vitamin_a: '120', vitamin_c: '15', vitamin_d: '2.5', calcium: '210', iron: '4.2',
}

const HAEHNCHEN = {
  food_entry_id: '222', food_id: 'f-huhn', date_int: String(TAG_INT), meal: 'lunch',
  food_entry_name: 'Hähnchenbrust', food_entry_description: '200 g',
  number_of_units: '2', calories: '330', protein: '62', carbohydrate: '0',
  fat: '7.2', fiber: '0', sugar: '0',
}

/* ------------------------------------------------------------------ Datum */

describe('Datumsumrechnung', () => {
  it('rechnet hin und zurück', () => {
    expect(epochDayToDay(dayToEpochDay('2026-09-14'))).toBe('2026-09-14')
    expect(epochDayToDay(dayToEpochDay('2026-01-01'))).toBe('2026-01-01')
    expect(epochDayToDay(dayToEpochDay('2026-12-31'))).toBe('2026-12-31')
  })

  it('kennt den Nullpunkt von FatSecret', () => {
    expect(dayToEpochDay('1970-01-01')).toBe(0)
    expect(dayToEpochDay('1970-01-02')).toBe(1)
  })

  it('rechnet unabhängig von der Zeitzone des Geräts', () => {
    // Ohne UTC läge das Ergebnis östlich von Greenwich einen Tag daneben und
    // LifeHub fragte still den falschen Tag ab.
    expect(dayToEpochDay('2026-09-14')).toBe(Math.floor(Date.UTC(2026, 8, 14) / 86400000))
  })
})

/* ------------------------------------------------------------- Rohantwort */

describe('Antwort von food_entries.get.v2 auswerten', () => {
  it('liest Zahlen, die als Text kommen', () => {
    const [e] = parseFoodEntries(roh([HAFERFLOCKEN]))
    expect(e.calories).toBe(370)
    expect(e.protein_g).toBe(13.5)
    expect(e.carbs_g).toBe(58.7)
    expect(e.fat_g).toBe(7)
    expect(e.fiber_g).toBe(10)
    expect(e.name).toBe('Haferflocken')
    expect(e.meal).toBe('breakfast')
    expect(e.day).toBe(TAG)
  })

  it('kommt mit einem einzelnen Eintrag als Objekt zurecht', () => {
    // Genau hier verliert man sonst still den Tag, an dem man nur eine
    // Kleinigkeit gegessen hat.
    const out = parseFoodEntries({ food_entries: { food_entry: HAFERFLOCKEN } })
    expect(out).toHaveLength(1)
    expect(out[0].externalId).toBe('111')
  })

  it('liefert für einen leeren Tag eine leere Liste statt eines Fehlers', () => {
    expect(parseFoodEntries({})).toEqual([])
    expect(parseFoodEntries({ food_entries: {} })).toEqual([])
    expect(parseFoodEntries(null)).toEqual([])
  })

  it('überspringt Einträge ohne food_entry_id', () => {
    const out = parseFoodEntries(roh([{ ...HAFERFLOCKEN, food_entry_id: '' }, HAEHNCHEN]))
    expect(out.map((e) => e.externalId)).toEqual(['222'])
  })

  it('stuft eine unbekannte Mahlzeit als „sonstiges" ein', () => {
    const [e] = parseFoodEntries(roh([{ ...HAFERFLOCKEN, meal: 'brunch' }]))
    expect(e.meal).toBe('other')
  })
})

/* ------------------------------------------------------------- Tageswerte */

describe('Tageswerte berechnen', () => {
  const eintraege = parseFoodEntries(roh([HAFERFLOCKEN, HAEHNCHEN]))

  it('summiert Kalorien und alle geforderten Makros', () => {
    const w = aggregateDay(eintraege)
    expect(w.calories).toBe(700)
    expect(w.protein_g).toBe(75.5)
    expect(w.carbs_g).toBe(58.7)
    expect(w.fat_g).toBe(14.2)
    expect(w.fiber_g).toBe(10)
  })

  it('unterscheidet „nichts gegessen" von „keine Angabe vorhanden"', () => {
    // Zu Hähnchen liefert FatSecret hier keine Ballaststoffe – das Feld fehlt
    // ganz. Bei beiden fehlend muss null herauskommen, nicht 0: Sonst stünde
    // im Zielbereich eine Zahl, die niemand gemessen hat.
    const ohneBallast = parseFoodEntries(roh([
      { ...HAFERFLOCKEN, fiber: '' }, { ...HAEHNCHEN, fiber: '' },
    ]))
    expect(aggregateDay(ohneBallast).fiber_g).toBeNull()
    expect(aggregateDay(ohneBallast).calories).toBe(700)
  })

  it('liefert für einen leeren Tag überall null', () => {
    const w = aggregateDay([])
    expect(w.calories).toBeNull()
    expect(w.protein_g).toBeNull()
  })
})

/* ------------------------------------------------------- Abgleich der Tage */

function lokal(over: Partial<LokalesLebensmittel> = {}): LokalesLebensmittel {
  return {
    id: foodEntryRowId('111'), day: TAG, external_id: '111', source: 'fatsecret',
    deleted_at: null, meal: 'breakfast', name: 'Haferflocken',
    serving_description: '100 g - Kalorien: 370kcal', number_of_units: 1,
    calories: 370, protein_g: 13.5, carbs_g: 58.7, fat_g: 7, fiber_g: 10,
    sugar_g: 1.1, saturated_fat_g: 1.3, sodium_mg: 8, ...over,
  }
}

describe('Wiederholter Abgleich', () => {
  const remote = parseFoodEntries(roh([HAFERFLOCKEN, HAEHNCHEN]))
  const jetzt = '2026-09-14T20:00:00Z'

  it('legt beim ersten Mal alles an', () => {
    const p = reconcileFoodEntries({ day: TAG, remote, lokal: [], syncedAt: jetzt })
    expect(p.anlegen).toHaveLength(2)
    expect(p.anlegen[0].id).toBe(foodEntryRowId('111'))
    expect(p.anlegen[0].values.external_id).toBe('111')
  })

  it('legt beim zweiten Mal nichts an – kein Duplikat', () => {
    const bestand = reconcileFoodEntries({ day: TAG, remote, lokal: [], syncedAt: jetzt })
      .anlegen.map((a) => lokal({ ...a.values } as Partial<LokalesLebensmittel>))
    const p = reconcileFoodEntries({ day: TAG, remote, lokal: bestand, syncedAt: jetzt })
    expect(planIstLeer(p)).toBe(true)
  })

  it('vergibt für dieselbe food_entry_id immer dieselbe Zeilen-ID', () => {
    expect(foodEntryRowId('111')).toBe(foodEntryRowId('111'))
    expect(foodEntryRowId('111')).not.toBe(foodEntryRowId('112'))
  })

  it('übernimmt eine Korrektur aus FatSecret', () => {
    const geaendert: FatSecretEntry[] = [{ ...remote[0], calories: 555, numberOfUnits: 1.5 }]
    const p = reconcileFoodEntries({ day: TAG, remote: geaendert, lokal: [lokal()], syncedAt: jetzt })
    expect(p.aendern).toHaveLength(1)
    expect(p.aendern[0].patch.calories).toBe(555)
    expect(p.aendern[0].patch.number_of_units).toBe(1.5)
    expect(p.anlegen).toHaveLength(0)
  })

  it('entfernt, was in FatSecret gelöscht wurde', () => {
    const p = reconcileFoodEntries({ day: TAG, remote: [], lokal: [lokal()], syncedAt: jetzt })
    expect(p.entfernen).toEqual([{ id: foodEntryRowId('111'), name: 'Haferflocken' }])
  })

  it('holt einen in LifeHub gelöschten Eintrag nicht zurück', () => {
    const p = reconcileFoodEntries({
      day: TAG, remote: [remote[0]],
      lokal: [lokal({ deleted_at: '2026-09-14T21:00:00Z' })], syncedAt: jetzt,
    })
    expect(planIstLeer(p)).toBe(true)
  })

  it('fasst von Hand erfasste Lebensmittel nicht an', () => {
    const eigenes = lokal({ id: 'eigen-1', external_id: null, source: 'manual', name: 'Oma-Kuchen' })
    const p = reconcileFoodEntries({ day: TAG, remote: [], lokal: [eigenes], syncedAt: jetzt })
    expect(p.entfernen).toHaveLength(0)
  })

  it('sieht nur den angefragten Tag an', () => {
    const andererTag = lokal({ id: 'x', day: '2026-09-13', external_id: '999' })
    const p = reconcileFoodEntries({ day: TAG, remote: [], lokal: [andererTag], syncedAt: jetzt })
    expect(p.entfernen).toHaveLength(0)
  })
})

/* --------------------------------------------------- Tageswerte als Metrik */

const METRIKEN = [
  { id: 'm-kcal', key: 'calories' },
  { id: 'm-prot', key: 'protein_g' },
  { id: 'm-fiber', key: 'fiber_g' },
  { id: 'm-gewicht', key: 'weight_kg' },   // gehört nicht dazu
]

describe('Tageswerte landen im bestehenden Metriksystem', () => {
  const werte = aggregateDay(parseFoodEntries(roh([HAFERFLOCKEN, HAEHNCHEN])))
  const jetzt = '2026-09-14T20:00:00Z'

  it('legt je Nährwert genau eine Zeile an', () => {
    const p = planNutritionMetrics({ day: TAG, werte, metriken: METRIKEN, vorhanden: [], syncedAt: jetzt })
    expect(p.anlegen.map((a) => a.values.metric_id).sort()).toEqual(['m-fiber', 'm-kcal', 'm-prot'])
    expect(p.anlegen.find((a) => a.values.metric_id === 'm-kcal')!.values.value_num).toBe(700)
    expect(p.anlegen[0].values.source).toBe('fatsecret')
  })

  it('rührt fachfremde Metriken nicht an', () => {
    const p = planNutritionMetrics({ day: TAG, werte, metriken: METRIKEN, vorhanden: [], syncedAt: jetzt })
    expect(p.anlegen.some((a) => a.values.metric_id === 'm-gewicht')).toBe(false)
  })

  it('schreibt beim zweiten Abgleich nichts, wenn sich nichts geändert hat', () => {
    const vorhanden = [{
      id: nutritionEntryId('calories', TAG), metric_id: 'm-kcal', day: TAG,
      value_num: 700, source: 'fatsecret', deleted_at: null,
    }]
    const p = planNutritionMetrics({ day: TAG, werte, metriken: [METRIKEN[0]], vorhanden, syncedAt: jetzt })
    expect(p.anlegen).toHaveLength(0)
    expect(p.aendern).toHaveLength(0)
  })

  it('aktualisiert einen abweichenden Wert', () => {
    const vorhanden = [{
      id: nutritionEntryId('calories', TAG), metric_id: 'm-kcal', day: TAG,
      value_num: 500, source: 'fatsecret', deleted_at: null,
    }]
    const p = planNutritionMetrics({ day: TAG, werte, metriken: [METRIKEN[0]], vorhanden, syncedAt: jetzt })
    expect(p.aendern).toEqual([{
      id: nutritionEntryId('calories', TAG),
      patch: { value_num: 700, source: 'fatsecret' },
    }])
  })

  it('räumt einen konkurrierenden Handeintrag weg, statt ihn dazuzuzählen', () => {
    // dayValue summiert alle Einträge eines Tages. Blieben beide stehen,
    // stünden im Tagesziel 1400 statt 700 kcal – ohne sichtbaren Fehler.
    const vorhanden = [{
      id: 'von-hand', metric_id: 'm-kcal', day: TAG,
      value_num: 700, source: 'manual', deleted_at: null,
    }]
    const p = planNutritionMetrics({ day: TAG, werte, metriken: [METRIKEN[0]], vorhanden, syncedAt: jetzt })
    expect(p.ersetzen).toEqual([{ id: 'von-hand', metrik: 'calories' }])
    expect(p.anlegen).toHaveLength(1)
  })

  it('löscht bei fehlender Angabe keinen Handeintrag mit', () => {
    const leer = aggregateDay([])
    const vorhanden = [{
      id: 'von-hand', metric_id: 'm-kcal', day: TAG,
      value_num: 2000, source: 'manual', deleted_at: null,
    }]
    const p = planNutritionMetrics({ day: TAG, werte: leer, metriken: [METRIKEN[0]], vorhanden, syncedAt: jetzt })
    expect(p.ersetzen).toHaveLength(0)
    expect(p.entfernen).toHaveLength(0)
    expect(p.anlegen).toHaveLength(0)
  })

  it('entfernt den eigenen Wert, wenn FatSecret den Tag geleert hat', () => {
    const leer = aggregateDay([])
    const vorhanden = [{
      id: nutritionEntryId('calories', TAG), metric_id: 'm-kcal', day: TAG,
      value_num: 700, source: 'fatsecret', deleted_at: null,
    }]
    const p = planNutritionMetrics({ day: TAG, werte: leer, metriken: [METRIKEN[0]], vorhanden, syncedAt: jetzt })
    expect(p.entfernen).toEqual([{ id: nutritionEntryId('calories', TAG), metrik: 'calories' }])
  })

  it('stellt eine gelöschte eigene Zeile wieder her, statt eine zweite anzulegen', () => {
    const vorhanden = [{
      id: nutritionEntryId('calories', TAG), metric_id: 'm-kcal', day: TAG,
      value_num: 700, source: 'fatsecret', deleted_at: '2026-09-14T19:00:00Z',
    }]
    const p = planNutritionMetrics({ day: TAG, werte, metriken: [METRIKEN[0]], vorhanden, syncedAt: jetzt })
    expect(p.anlegen).toHaveLength(0)
    expect(p.wiederherstellen).toHaveLength(1)
  })
})

describe('Alle Naehrwerte, nicht nur die acht bekannten', () => {
  it('uebernimmt jeden Wert, den FatSecret mitschickt', () => {
    const [e] = parseFoodEntries(roh([VOLLSTAENDIG]))
    // Die acht von vorher ...
    expect(e.calories).toBe(500)
    expect(e.protein_g).toBe(30)
    expect(e.carbs_g).toBe(40)
    expect(e.fat_g).toBe(20)
    expect(e.fiber_g).toBe(6)
    expect(e.sugar_g).toBe(9)
    expect(e.saturated_fat_g).toBe(4)
    expect(e.sodium_mg).toBe(600)
    // ... und die, die bisher stillschweigend weggeworfen wurden.
    expect(e.trans_fat_g).toBe(0.3)
    expect(e.polyunsaturated_fat_g).toBe(2.5)
    expect(e.monounsaturated_fat_g).toBe(8.1)
    expect(e.cholesterol_mg).toBe(75)
    expect(e.potassium_mg).toBe(450)
    expect(e.added_sugars_g).toBe(3)
    expect(e.vitamin_a_mcg).toBe(120)
    expect(e.vitamin_c_mg).toBe(15)
    expect(e.vitamin_d_mcg).toBe(2.5)
    expect(e.calcium_mg).toBe(210)
    expect(e.iron_mg).toBe(4.2)
  })

  it('laesst fehlende Angaben leer, statt sie als 0 zu erfinden', () => {
    // Haferflocken bringen nur die acht alten Werte mit.
    const [e] = parseFoodEntries(roh([HAFERFLOCKEN]))
    expect(e.calories).toBe(370)
    expect(e.iron_mg).toBeNull()
    expect(e.vitamin_c_mg).toBeNull()
    expect(e.cholesterol_mg).toBeNull()
  })

  it('schreibt die neuen Werte auch wirklich in die Zeile', () => {
    const plan = reconcileFoodEntries({
      day: TAG, remote: parseFoodEntries(roh([VOLLSTAENDIG])), lokal: [], syncedAt: 'jetzt',
    })
    expect(plan.anlegen).toHaveLength(1)
    const werte = plan.anlegen[0].values
    expect(werte.iron_mg).toBe(4.2)
    expect(werte.potassium_mg).toBe(450)
    expect(werte.trans_fat_g).toBe(0.3)
  })

  it('erkennt eine Aenderung an einem der neuen Werte', () => {
    const remote = parseFoodEntries(roh([VOLLSTAENDIG]))
    const vorhanden = reconcileFoodEntries({ day: TAG, remote, lokal: [], syncedAt: 'jetzt' })
      .anlegen[0]
    const lokal = [{
      ...vorhanden.values, id: vorhanden.id, deleted_at: null,
      iron_mg: 1.0,   // in FatSecret nachtraeglich korrigiert
    }] as unknown as LokalesLebensmittel[]
    const plan = reconcileFoodEntries({ day: TAG, remote, lokal, syncedAt: 'jetzt' })
    expect(plan.anlegen).toHaveLength(0)
    expect(plan.aendern).toHaveLength(1)
    expect(plan.aendern[0].patch.iron_mg).toBe(4.2)
  })
})
