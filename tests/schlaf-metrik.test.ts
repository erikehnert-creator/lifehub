/**
 * Die Nacht als Tageswert – und warum die Automatik davon nicht durchdreht.
 *
 * Die Automatik läuft nach JEDER Datenänderung erneut und schreibt dabei
 * selbst Daten. Das endet nur, weil der zweite Durchlauf nichts mehr findet
 * (siehe CLAUDE.md). Wer dort ein Feld ergänzt, das sich nie „gleich genug"
 * anfühlt, baut eine Schleife, in der die App im Kreis läuft, ohne dass
 * irgendwo etwas rot wird.
 *
 * Deshalb ist der wichtigste Test hier nicht „der Wert kommt an", sondern
 * „beim zweiten Mal passiert nichts mehr".
 */
import { describe, it, expect } from 'vitest'
import { planeSchlafwerte, stundenAusMinuten, SCHLAF_QUELLE } from '../src/core/schlafMetrik'
import type { Metric, MetricEntry, SleepSession } from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 't', server_rev: null,
}

const SCHLAF_METRIK = { ...basis, id: 'm-sleep', key: 'sleep_h' } as unknown as Metric

const nacht = (day: string, minuten: number, extra: Partial<SleepSession> = {}): SleepSession => ({
  ...basis, id: `s-${day}`, day, start_at: `${day}T00:00:00+02:00`, end_at: `${day}T07:00:00+02:00`,
  duration_min: minuten, awake_min: null, in_bed_min: null,
  core_min: null, deep_min: null, rem_min: null, source: 'Sleep Cycle', note: null,
  ...extra,
} as SleepSession)

const eintrag = (day: string, wert: number, quelle: string): MetricEntry => ({
  ...basis, id: `e-${day}-${quelle}`, metric_id: 'm-sleep', day, at_time: null,
  value_num: wert, value_text: null, note: null, source: quelle, import_batch_id: null,
} as unknown as MetricEntry)

describe('Minuten in Stunden', () => {
  it('rundet auf zwei Nachkommastellen', () => {
    expect(stundenAusMinuten(462)).toBe(7.7)     // 7 h 42 min
    expect(stundenAusMinuten(480)).toBe(8)
    expect(stundenAusMinuten(0)).toBe(0)
    expect(stundenAusMinuten(1)).toBe(0.02)
  })
})

describe('Welche Tageswerte nachzuziehen sind', () => {
  it('trägt eine neue Nacht ein', () => {
    const plan = planeSchlafwerte([nacht('2026-09-29', 462)], SCHLAF_METRIK, [])
    expect(plan).toEqual([{ day: '2026-09-29', stunden: 7.7, entryId: undefined }])
  })

  it('beim zweiten Durchlauf passiert nichts mehr', () => {
    // DAS ist der Test, der eine Endlosschleife verhindert.
    const eintraege = [eintrag('2026-09-29', 7.7, SCHLAF_QUELLE)]
    expect(planeSchlafwerte([nacht('2026-09-29', 462)], SCHLAF_METRIK, eintraege)).toEqual([])
  })

  it('auch bei Fließkommarauschen bleibt es dabei', () => {
    const eintraege = [eintrag('2026-09-29', 7.700000000000001, SCHLAF_QUELLE)]
    expect(planeSchlafwerte([nacht('2026-09-29', 462)], SCHLAF_METRIK, eintraege)).toEqual([])
  })

  it('eine Korrektur der Nacht zieht den Tageswert nach', () => {
    const eintraege = [eintrag('2026-09-29', 7.7, SCHLAF_QUELLE)]
    const plan = planeSchlafwerte([nacht('2026-09-29', 480)], SCHLAF_METRIK, eintraege)
    expect(plan.length).toBe(1)
    expect(plan[0].stunden).toBe(8)
    expect(plan[0].entryId).toBe('e-2026-09-29-sleep_session')
  })

  it('rührt einen von Hand eingetragenen Wert NICHT an', () => {
    // Die Uhr ist nicht mehr wert als das, was Erik selbst notiert hat.
    const eintraege = [eintrag('2026-09-29', 6, 'manual')]
    expect(planeSchlafwerte([nacht('2026-09-29', 462)], SCHLAF_METRIK, eintraege)).toEqual([])
  })

  it('übergeht gelöschte Nächte und gelöschte Einträge', () => {
    const geloescht = nacht('2026-09-29', 462, { deleted_at: '2026-09-29T10:00:00Z' })
    expect(planeSchlafwerte([geloescht], SCHLAF_METRIK, [])).toEqual([])

    const eintraege = [{ ...eintrag('2026-09-29', 7.7, SCHLAF_QUELLE), deleted_at: '2026-09-29T10:00:00Z' }]
    expect(planeSchlafwerte([nacht('2026-09-29', 462)], SCHLAF_METRIK, eintraege).length).toBe(1)
  })

  it('tut nichts, wenn es die Metrik nicht gibt', () => {
    expect(planeSchlafwerte([nacht('2026-09-29', 462)], null, [])).toEqual([])
    expect(planeSchlafwerte([nacht('2026-09-29', 462)], undefined, [])).toEqual([])
  })

  it('übergeht eine Nacht ohne Dauer', () => {
    expect(planeSchlafwerte([nacht('2026-09-29', 0)], SCHLAF_METRIK, [])).toEqual([])
  })

  it('lässt Einträge anderer Metriken in Ruhe', () => {
    const fremd = { ...eintrag('2026-09-29', 99, 'manual'), metric_id: 'm-gewicht' } as MetricEntry
    const plan = planeSchlafwerte([nacht('2026-09-29', 462)], SCHLAF_METRIK, [fremd])
    expect(plan.length).toBe(1)
  })

  it('kommt mit vielen Nächten auf einmal zurecht', () => {
    const naechte = Array.from({ length: 30 }, (_, i) => nacht(`2026-09-${String(i + 1).padStart(2, '0')}`, 420 + i))
    const plan = planeSchlafwerte(naechte, SCHLAF_METRIK, [])
    expect(plan.length).toBe(30)
    // Und nach dem Schreiben ist Ruhe.
    const danach = plan.map((p) => eintrag(p.day, p.stunden, SCHLAF_QUELLE))
    expect(planeSchlafwerte(naechte, SCHLAF_METRIK, danach)).toEqual([])
  })
})
