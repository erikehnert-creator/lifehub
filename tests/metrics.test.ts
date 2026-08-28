import { describe, it, expect } from 'vitest'
import { evaluateZone, targetFor, aggregate, dailySeries, movingAverage, correlation } from '../src/core/metrics'
import type { Metric, MetricEntry, MetricTarget } from '../src/core/types'

const base = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null, version: 1, last_device_id: 't', server_rev: null,
}

function target(over: Partial<MetricTarget> = {}): MetricTarget {
  return {
    ...base, id: 't1', metric_id: 'm1', target_value: 2400,
    tolerance_minus: 150, tolerance_plus: 150, hard_min: 1800, hard_max: 3200,
    period: 'daily', valid_from: '2020-01-01', valid_to: null, ...over,
  }
}

describe('Zielbereiche mit Toleranz', () => {
  const t = target()

  it('erkennt den grünen Bereich', () => {
    expect(evaluateZone(2400, t).status).toBe('optimal')
    expect(evaluateZone(2250, t).status).toBe('optimal')
    expect(evaluateZone(2550, t).status).toBe('optimal')
  })

  it('erkennt den gelben Toleranzbereich', () => {
    expect(evaluateZone(2100, t).status).toBe('tolerated')
    expect(evaluateZone(3100, t).status).toBe('tolerated')
  })

  it('erkennt den roten Bereich außerhalb der harten Grenzen', () => {
    expect(evaluateZone(1500, t).status).toBe('outside')
    expect(evaluateZone(3500, t).status).toBe('outside')
  })

  it('liefert die Grenzen des grünen Bereichs mit', () => {
    const z = evaluateZone(2400, t)
    expect(z.greenMin).toBe(2250)
    expect(z.greenMax).toBe(2550)
    expect(z.deviation).toBe(0)
  })

  it('geht mit fehlendem Wert oder fehlendem Ziel um', () => {
    expect(evaluateZone(null, t).status).toBe('unknown')
    expect(evaluateZone(2400, null).status).toBe('unknown')
  })

  it('erlaubt unsymmetrische Toleranzen', () => {
    const asym = target({ target_value: 130, tolerance_minus: 10, tolerance_plus: 15, hard_min: 90, hard_max: 200 })
    expect(evaluateZone(121, asym).status).toBe('optimal')
    expect(evaluateZone(145, asym).status).toBe('optimal')
    expect(evaluateZone(119, asym).status).toBe('tolerated')
  })
})

describe('Historisierte Ziele', () => {
  it('nimmt das zum Stichtag gültige Ziel', () => {
    const alt = target({ id: 'alt', target_value: 2000, valid_from: '2026-01-01', valid_to: '2026-05-31' })
    const neu = target({ id: 'neu', target_value: 2400, valid_from: '2026-06-01', valid_to: null })
    expect(targetFor([alt, neu], 'm1', '2026-03-15')?.target_value).toBe(2000)
    expect(targetFor([alt, neu], 'm1', '2026-08-15')?.target_value).toBe(2400)
  })
})

describe('Aggregation', () => {
  it('rechnet je nach Metrikart', () => {
    expect(aggregate([1, 2, 3], 'sum')).toBe(6)
    expect(aggregate([1, 2, 3], 'avg')).toBe(2)
    expect(aggregate([1, 2, 3], 'last')).toBe(3)
    expect(aggregate([], 'sum')).toBeNull()
  })
})

describe('Reihen', () => {
  const metric: Metric = {
    ...base, id: 'm1', key: 'weight_kg', name: 'Gewicht', group_key: 'body',
    unit: 'kg', value_type: 'number', decimals: 1, scale_min: null, scale_max: null,
    scale_labels_json: null, aggregation: 'last', direction: 'range',
    is_builtin: 1, is_enabled: 1, show_in_daily_form: 1, show_zone: 1, color: null, sort_order: 0,
  }
  const entries: MetricEntry[] = ['2026-08-01', '2026-08-03'].map((day, i) => ({
    ...base, id: `e${i}`, metric_id: 'm1', day, at_time: null,
    value_num: 50 + i, value_text: null, note: null, source: 'manual', import_batch_id: null,
  }))

  it('füllt Lücken mit null', () => {
    const s = dailySeries(entries, metric, '2026-08-01', '2026-08-04')
    expect(s.map((p) => p.value)).toEqual([50, null, 51, null])
  })

  it('glättet mit gleitendem Mittel', () => {
    const s = movingAverage([
      { day: 'a', value: 10 }, { day: 'b', value: 20 }, { day: 'c', value: 30 },
    ], 2)
    expect(s.map((p) => p.value)).toEqual([10, 15, 25])
  })

  it('braucht genug gemeinsame Tage für eine Korrelation', () => {
    const a = [1, 2, 3].map((v, i) => ({ day: `2026-08-0${i + 1}`, value: v }))
    expect(correlation(a, a).r).toBeNull()
    const long = Array.from({ length: 10 }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, value: i }))
    expect(correlation(long, long).r).toBe(1)
  })
})
