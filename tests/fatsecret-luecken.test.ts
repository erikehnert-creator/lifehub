/**
 * Zwei Lücken im FatSecret-Abgleich – und warum sie Daten gekostet haben.
 *
 * ---------------------------------------------------------------------------
 * 1. „Kein Eintrag" und „keine Antwort" sahen gleich aus
 *
 * `parseFoodEntries()` liefert für beides eine leere Liste. Für den Abgleich
 * heisst eine leere Liste aber: „in FatSecret wurde alles gelöscht, hier also
 * auch." Kam zu einem Tag keine lesbare Antwort – eine Wartungsseite, ein
 * abgeschnittener Rumpf, ein Netzwackler –, setzte die Edge Function `null`,
 * und LifeHub löschte die Mahlzeiten dieses Tages samt Tageswerten. Gemeldet
 * wurde „1 Tag abgeglichen".
 *
 * 2. Der laufende Abgleich sah immer genau drei Tage zurück
 *
 * Drei Tage decken ab, was in FatSecret nachgetragen wird. Sie decken nicht
 * ab, dass LifeHub eine Woche lang nicht geöffnet wurde: Die vier Tage davor
 * wurden nie geholt und blieben dauerhaft leer. Der Historienlauf half nicht –
 * der galt als „fertig".
 */
import { describe, it, expect } from 'vitest'
import {
  aggregateDay, parseFoodEntries, planNutritionMetrics, pruefeTagesantwort,
  reconcileFoodEntries, nutritionEntryId, foodEntryRowId,
} from '../src/core/fatsecret'
import {
  HOECHSTZAHL_NACHLAUFTAGE, NACHLAUF_TAGE, nachlaufTage, standNachMonaten, LEERER_STAND,
} from '../src/core/fatsecretImport'
import { addDays, diffDays } from '../src/core/dates'

const TAG = '2026-09-29'
const JETZT = '2026-09-29T10:00:00.000Z'

/* ============================================ 1. Antwort oder keine Antwort */

describe('pruefeTagesantwort', () => {
  it('ein Tag ohne Einträge ist eine gültige Antwort', () => {
    expect(pruefeTagesantwort({}).brauchbar).toBe(true)
    expect(pruefeTagesantwort({ food_entries: {} }).brauchbar).toBe(true)
    expect(pruefeTagesantwort({ food_entries: { food_entry: [] } }).brauchbar).toBe(true)
  })

  it('ein Tag mit Einträgen erst recht', () => {
    expect(pruefeTagesantwort({ food_entries: { food_entry: { food_entry_id: '1' } } }).brauchbar).toBe(true)
  })

  it('gar keine Antwort ist keine', () => {
    expect(pruefeTagesantwort(undefined).brauchbar).toBe(false)
    expect(pruefeTagesantwort(null).brauchbar).toBe(false)
  })

  it('eine Wartungsseite oder ein abgeschnittener Rumpf ist keine', () => {
    expect(pruefeTagesantwort('<html>Service unavailable</html>').brauchbar).toBe(false)
    expect(pruefeTagesantwort(42).brauchbar).toBe(false)
    expect(pruefeTagesantwort([]).brauchbar).toBe(false)
  })

  it('ein Fehlerobjekt von FatSecret ist keine', () => {
    expect(pruefeTagesantwort({ error: { code: 21, message: 'Invalid token' } }).brauchbar).toBe(false)
  })

  it('jede Zurückweisung nennt einen Grund', () => {
    for (const roh of [undefined, null, 'html', 7, [], { error: {} }]) {
      const e = pruefeTagesantwort(roh)
      expect(e.brauchbar).toBe(false)
      expect((e as any).grund).toBeTruthy()
    }
  })
})

describe('Was ein leerer Tag auslöst – und warum er nur echt sein darf', () => {
  const lokalesLebensmittel = {
    id: foodEntryRowId('fs-1'), day: TAG, external_id: 'fs-1', source: 'fatsecret',
    deleted_at: null, meal: 'breakfast', name: 'Haferflocken',
    serving_description: '100 g', number_of_units: 1,
    calories: 400, protein: 20, carbohydrate: 50, fat: 10,
  } as any

  const lokalerTageswert = {
    id: nutritionEntryId('calories', TAG), metric_id: 'm-kcal', day: TAG,
    value_num: 400, source: 'fatsecret', deleted_at: null,
  }

  it('ein wirklich leerer Tag räumt auf – das ist gewollt', () => {
    const p = reconcileFoodEntries({ day: TAG, remote: [], lokal: [lokalesLebensmittel], syncedAt: JETZT })
    expect(p.entfernen).toHaveLength(1)

    const mp = planNutritionMetrics({
      day: TAG, werte: aggregateDay([]), metriken: [{ id: 'm-kcal', key: 'calories' }],
      vorhanden: [lokalerTageswert], syncedAt: JETZT,
    })
    expect(mp.entfernen).toHaveLength(1)
  })

  it('genau deshalb darf eine unlesbare Antwort NICHT als leerer Tag durchgehen', () => {
    // Die Kette, die den Schaden anrichtete: null → [] → „alles gelöscht".
    expect(parseFoodEntries(null, TAG)).toEqual([])
    expect(parseFoodEntries('<html>503</html>', TAG)).toEqual([])
    // Der Riegel davor ist pruefeTagesantwort – und der greift vor dem Parsen.
    expect(pruefeTagesantwort(null).brauchbar).toBe(false)
    expect(pruefeTagesantwort('<html>503</html>').brauchbar).toBe(false)
  })
})

/* ======================================================= 2. Die Lücke schliessen */

describe('nachlaufTage', () => {
  const ruf = (zuletzt: string | null, heute = TAG) =>
    nachlaufTage({ heute, zuletzt, addDays, diffDays })

  it('ohne bekannten letzten Abruf: die drei Korrekturtage', () => {
    expect(ruf(null)).toEqual(['2026-09-29', '2026-09-28', '2026-09-27'])
    expect(ruf(null)).toHaveLength(NACHLAUF_TAGE)
  })

  it('heute schon geholt: es bleibt bei dreien', () => {
    expect(ruf('2026-09-29T07:00:00.000Z')).toHaveLength(3)
  })

  it('gestern geholt: immer noch drei – die Lücke ist ja gedeckt', () => {
    expect(ruf('2026-09-28T07:00:00.000Z')).toHaveLength(3)
  })

  it('eine Woche nicht geöffnet: die ganze Woche wird nachgeholt', () => {
    const tage = ruf('2026-09-22T07:00:00.000Z')
    expect(tage).toContain('2026-09-22')
    expect(tage[0]).toBe('2026-09-29')
    // Lückenlos und neueste zuerst.
    for (let i = 1; i < tage.length; i++) expect(tage[i]).toBe(addDays(tage[i - 1], -1))
  })

  it('ein halbes Jahr nicht geöffnet: höchstens ein Monat, den Rest macht die Historie', () => {
    const tage = ruf('2026-03-01T07:00:00.000Z')
    expect(tage).toHaveLength(HOECHSTZAHL_NACHLAUFTAGE)
  })

  it('ein unbrauchbarer Zeitstempel fällt auf die drei Tage zurück', () => {
    expect(ruf('irgendwann')).toHaveLength(3)
    expect(ruf('')).toHaveLength(3)
  })

  it('der Monatswechsel wird richtig überschritten', () => {
    const tage = nachlaufTage({
      heute: '2026-10-02', zuletzt: '2026-09-28T07:00:00.000Z', addDays, diffDays,
    })
    expect(tage).toContain('2026-09-28')
    expect(tage).toContain('2026-10-01')
  })

  it('ein offen gebliebener Tag haelt das Fenster auf, ohne die Haeufigkeit zu aendern', () => {
    // Der Fall: Gestern hat FatSecret zu vorletzter Woche nichts geliefert.
    // Heute wurde gerade abgerufen – „zuletzt" ist also frisch, das Fenster
    // waere drei Tage. Der offene Tag muss trotzdem mitkommen.
    const tage = nachlaufTage({
      heute: TAG, zuletzt: '2026-09-29T07:00:00.000Z', abTag: '2026-09-18',
      addDays, diffDays,
    })
    expect(tage).toContain('2026-09-18')
    expect(tage[0]).toBe(TAG)
  })

  it('ohne offene Luecke bleibt es beim kurzen Fenster', () => {
    const tage = nachlaufTage({
      heute: TAG, zuletzt: '2026-09-29T07:00:00.000Z', abTag: null, addDays, diffDays,
    })
    expect(tage).toHaveLength(3)
  })

  it('auch eine offene Luecke wird bei einem Monat gekappt', () => {
    const tage = nachlaufTage({
      heute: TAG, zuletzt: '2026-09-29T07:00:00.000Z', abTag: '2025-01-01',
      addDays, diffDays,
    })
    expect(tage).toHaveLength(HOECHSTZAHL_NACHLAUFTAGE)
  })

  it('nie eine leere Liste – sonst holte der Abgleich gar nichts', () => {
    for (const z of [null, '2026-09-29T23:59:00.000Z', '2030-01-01T00:00:00.000Z']) {
      expect(ruf(z).length).toBeGreaterThan(0)
    }
  })
})

/* ================================== 3. Der Historienlauf hakt nichts blind ab */

describe('Der Historienlauf und die unvollständige Runde', () => {
  it('nur geprüfte Monate schieben den Fortschritt weiter', () => {
    // standNachMonaten bekommt seit dem 30.09.2026 nur noch die Monate, deren
    // Tage wirklich angekommen sind (siehe state/ernaehrung.ts). Die Funktion
    // selbst bleibt dieselbe – geprüft wird, dass ein ausgelassener Monat den
    // Fortschritt nicht überspringt.
    const stand = standNachMonaten(LEERER_STAND, [
      { monat: '2026-09', tage: ['2026-09-10'] },
    ])
    expect(stand.geprueftBis).toBe('2026-09')

    // Die nächste Runde beginnt damit wieder bei 2026-08 – und nicht bei
    // 2026-07, obwohl der August in derselben Runde schon angefragt war.
    const weiter = standNachMonaten(stand, [{ monat: '2026-08', tage: [] }])
    expect(weiter.geprueftBis).toBe('2026-08')
  })

  it('ein leerer Monat zählt mit, ein übersprungener nicht', () => {
    const leer = standNachMonaten(LEERER_STAND, [{ monat: '2026-09', tage: [] }])
    expect(leer.leereMonate).toBe(1)
    const keiner = standNachMonaten(LEERER_STAND, [])
    expect(keiner.leereMonate).toBe(0)
    expect(keiner.geprueftBis).toBe(null)
  })
})
