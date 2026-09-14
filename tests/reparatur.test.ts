/**
 * Die Reparatur verwaister Tageswerte.
 *
 * Der Schaden, um den es geht: Ein Tageswert zeigt über `metric_id` auf eine
 * Metrik, die es nicht mehr gibt (wie es dazu kam, steht in
 * core/natuerlicheSchluessel.ts). Die Zeile ist vollständig da – Wert, Tag,
 * Quelle –, aber `dayValue()` sucht über die Metrik-ID und findet sie nicht.
 * Für Erik sah das aus, als würde FatSecret die Ballaststoffe nicht liefern.
 *
 * Zuordnen lässt sich das, weil die Zeilen-ID aus Metrik-SCHLÜSSEL und Tag
 * abgeleitet ist. Geprüft wird hier vor allem, dass dabei NICHT geraten wird:
 * Was sich nicht eindeutig zurückrechnen lässt, bleibt liegen.
 */
import { describe, expect, it } from 'vitest'
import { planeReparatur, planIstLeer, LEERER_PLAN } from '../src/core/reparatur'
import { nutritionEntryId } from '../src/core/fatsecret'

const TAG = '2026-09-14'
const GESTERN = '2026-09-13'

const METRIKEN = [
  { id: 'm-kcal', key: 'calories', name: 'Kalorien' },
  { id: 'm-fiber', key: 'fiber_g', name: 'Ballaststoffe' },
  { id: 'm-gewicht', key: 'weight_kg', name: 'Gewicht' },
]

const verwaist = (key: string, day: string, alteId = 'verschwunden') => ({
  id: nutritionEntryId(key, day), day, metric_id: alteId,
})

describe('Verwaiste Tageswerte zuordnen', () => {
  it('tut nichts, wenn nichts verwaist ist', () => {
    const p = planeReparatur([], METRIKEN, [])
    expect(p).toBe(LEERER_PLAN)
    expect(planIstLeer(p)).toBe(true)
  })

  it('findet die Metrik über die abgeleitete Zeilen-ID', () => {
    const p = planeReparatur([verwaist('fiber_g', TAG)], METRIKEN, [])
    expect(p.tageswerte).toEqual([{ id: nutritionEntryId('fiber_g', TAG), metric_id: 'm-fiber' }])
    expect(p.metriken).toEqual(['Ballaststoffe'])
    expect(p.ungeklaert).toBe(0)
  })

  it('ordnet mehrere Tage derselben Metrik zu', () => {
    // Der eigentliche Fall: Eriks Historie, nicht ein einzelner Tag.
    const p = planeReparatur(
      [verwaist('fiber_g', TAG), verwaist('fiber_g', GESTERN)], METRIKEN, [],
    )
    expect(p.tageswerte).toHaveLength(2)
    expect(p.tageswerte.every((t) => t.metric_id === 'm-fiber')).toBe(true)
    expect(p.metriken).toEqual(['Ballaststoffe'])
  })

  it('rät nicht: eine Zeile mit fremder ID bleibt liegen', () => {
    // Ein von Hand erfasster Wert hat eine Zufalls-ID. Die lässt sich nicht
    // zurückrechnen – und irgendeiner Metrik zuzuschlagen wäre schlimmer als
    // sie liegen zu lassen.
    const p = planeReparatur(
      [{ id: 'von-hand-irgendwas', day: TAG, metric_id: 'weg' }], METRIKEN, [],
    )
    expect(p.tageswerte).toEqual([])
    expect(p.ungeklaert).toBe(1)
  })

  it('ordnet nicht dem falschen Tag zu', () => {
    // Die ID enthält den Tag. Eine Zeile, die als Tag etwas anderes führt als
    // ihre ID hergibt, ist nicht eindeutig zuzuordnen.
    const p = planeReparatur(
      [{ id: nutritionEntryId('fiber_g', GESTERN), day: TAG, metric_id: 'weg' }], METRIKEN, [],
    )
    expect(p.tageswerte).toEqual([])
    expect(p.ungeklaert).toBe(1)
  })

  it('nimmt den Zielbereich der verschwundenen Metrik mit', () => {
    // Sonst stünden die Werte zwar wieder da, aber ohne grün/gelb/rot.
    const p = planeReparatur(
      [verwaist('fiber_g', TAG, 'weg')], METRIKEN,
      [{ id: 'z-alt', metric_id: 'weg', period: 'daily' }],
    )
    expect(p.zielbereiche).toEqual([{ id: 'z-alt', metric_id: 'm-fiber' }])
  })

  it('legt keinen zweiten Zielbereich neben einen vorhandenen', () => {
    const p = planeReparatur(
      [verwaist('fiber_g', TAG, 'weg')], METRIKEN,
      [
        { id: 'z-alt', metric_id: 'weg', period: 'daily' },
        { id: 'z-gut', metric_id: 'm-fiber', period: 'daily' },
      ],
    )
    expect(p.zielbereiche).toEqual([])
  })

  it('zieht bei zwei verwaisten Zielbereichen nur einen um', () => {
    const p = planeReparatur(
      [verwaist('fiber_g', TAG, 'weg')], METRIKEN,
      [
        { id: 'z-a', metric_id: 'weg', period: 'daily' },
        { id: 'z-b', metric_id: 'weg', period: 'daily' },
      ],
    )
    expect(p.zielbereiche).toHaveLength(1)
  })

  it('rechnet auch bei vielen Zeilen in vertretbarer Zeit', () => {
    // Drei Jahre Historie, alle sechzehn Nährwerte: rund 17.500 Zeilen. Wer
    // hier je Zeile alle Schlüssel neu hasht, hält den Start der App auf.
    const viele = []
    for (let i = 0; i < 1100; i++) {
      const tag = `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`
      viele.push(verwaist('fiber_g', tag, 'weg'))
    }
    const start = Date.now()
    const p = planeReparatur(viele, METRIKEN, [])
    expect(p.tageswerte.length).toBe(viele.length)
    expect(Date.now() - start).toBeLessThan(500)
  })
})
