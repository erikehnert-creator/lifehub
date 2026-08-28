/**
 * Metrik- und Zielbereichssystem.
 * Ein einziges System für Ernährung, Schlaf, Gewicht, Energie, Haut …
 * Damit gilt die Toleranzlogik (grün/gelb/rot) überall gleich.
 */
import type { Metric, MetricEntry, MetricTarget, Aggregation } from './types'
import { type DayString, daysInRange, monthOf, formatHoursMinutes } from './dates'
import { formatNumber } from './money'

export type ZoneStatus = 'optimal' | 'tolerated' | 'outside' | 'unknown'

export interface Zone {
  status: ZoneStatus
  target: number | null
  greenMin: number | null
  greenMax: number | null
  deviation: number | null
  label: string
}

/** Gültiges Ziel zu einem Stichtag ermitteln (Ziele sind historisiert). */
export function targetFor(
  targets: MetricTarget[],
  metricId: string,
  day: DayString,
  period: 'daily' | 'weekly' | 'monthly' = 'daily',
): MetricTarget | null {
  const candidates = targets.filter(
    (t) =>
      !t.deleted_at &&
      t.metric_id === metricId &&
      t.period === period &&
      t.valid_from <= day &&
      (!t.valid_to || t.valid_to >= day),
  )
  if (!candidates.length) return null
  return candidates.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0]
}

/**
 * Bewertet einen Wert gegen seinen Zielbereich.
 *   🟢 optimal    – innerhalb Ziel ± Toleranz
 *   🟡 toleriert  – außerhalb der Toleranz, aber innerhalb der harten Grenzen
 *   🔴 außerhalb  – jenseits der harten Grenzen
 */
export function evaluateZone(value: number | null, target: MetricTarget | null): Zone {
  if (value === null || value === undefined || !target) {
    return { status: 'unknown', target: target?.target_value ?? null, greenMin: null, greenMax: null, deviation: null, label: '–' }
  }
  const t = target.target_value
  const minus = target.tolerance_minus ?? 0
  const plus = target.tolerance_plus ?? 0
  const greenMin = t !== null ? t - minus : target.hard_min
  const greenMax = t !== null ? t + plus : target.hard_max

  const withinGreen =
    (greenMin === null || value >= greenMin) && (greenMax === null || value <= greenMax)
  if (withinGreen) {
    return {
      status: 'optimal', target: t, greenMin, greenMax,
      deviation: t !== null ? Math.round((value - t) * 100) / 100 : null,
      label: 'im Zielbereich',
    }
  }
  const withinHard =
    (target.hard_min === null || target.hard_min === undefined || value >= target.hard_min) &&
    (target.hard_max === null || target.hard_max === undefined || value <= target.hard_max)

  // Ohne harte Grenzen gilt: doppelte Toleranz = gelb, darüber = rot
  const amberMin = greenMin !== null ? greenMin - Math.max(minus, 1) : null
  const amberMax = greenMax !== null ? greenMax + Math.max(plus, 1) : null
  const inAmber =
    target.hard_min === null && target.hard_max === null
      ? (amberMin === null || value >= amberMin) && (amberMax === null || value <= amberMax)
      : withinHard

  return {
    status: inAmber ? 'tolerated' : 'outside',
    target: t, greenMin, greenMax,
    deviation: t !== null ? Math.round((value - t) * 100) / 100 : null,
    label: inAmber ? 'im Toleranzbereich' : 'außerhalb',
  }
}

/** Metrikwert formatiert mit Einheit – Schlaf (sleep_h) als Std:Min, alles andere wie bisher. */
export function formatMetricValue(metric: Metric, value: number): string {
  if (metric.key === 'sleep_h') return formatHoursMinutes(value)
  return `${formatNumber(value, metric.decimals)} ${metric.unit}`
}

export function aggregate(values: number[], how: Aggregation): number | null {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x))
  if (!v.length) return null
  switch (how) {
    case 'sum': return round2(v.reduce((a, b) => a + b, 0))
    case 'avg': return round2(v.reduce((a, b) => a + b, 0) / v.length)
    case 'min': return Math.min(...v)
    case 'max': return Math.max(...v)
    case 'last': return v[v.length - 1]
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Tageswert einer Metrik (mehrere Einträge pro Tag werden aggregiert). */
export function dayValue(entries: MetricEntry[], metric: Metric, day: DayString): number | null {
  const values = entries
    .filter((e) => !e.deleted_at && e.metric_id === metric.id && e.day === day)
    .sort((a, b) => (a.at_time ?? '') < (b.at_time ?? '') ? -1 : 1)
    .map((e) => e.value_num)
    .filter((v): v is number => v !== null)
  return aggregate(values, metric.aggregation === 'last' ? 'last' : metric.aggregation)
}

export interface SeriesPoint { day: DayString; value: number | null }

export function dailySeries(
  entries: MetricEntry[],
  metric: Metric,
  from: DayString,
  to: DayString,
): SeriesPoint[] {
  const byDay = new Map<string, number[]>()
  for (const e of entries) {
    if (e.deleted_at || e.metric_id !== metric.id || e.day < from || e.day > to) continue
    if (e.value_num === null) continue
    const arr = byDay.get(e.day) ?? []
    arr.push(e.value_num)
    byDay.set(e.day, arr)
  }
  return daysInRange(from, to).map((day) => ({
    day,
    value: byDay.has(day) ? aggregate(byDay.get(day)!, metric.aggregation) : null,
  }))
}

/** Wochen-/Monatsaggregation über die Tageswerte. */
export function groupSeries(
  points: SeriesPoint[],
  by: 'month' | 'week',
  how: Aggregation,
): { label: string; value: number | null }[] {
  const groups = new Map<string, number[]>()
  for (const p of points) {
    if (p.value === null) continue
    const key = by === 'month' ? monthOf(p.day) : isoWeekKey(p.day)
    const arr = groups.get(key) ?? []
    arr.push(p.value)
    groups.set(key, arr)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, values]) => ({ label, value: aggregate(values, how) }))
}

function isoWeekKey(day: DayString): string {
  const d = new Date(day)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayNr = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDayNr = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3)
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${target.getFullYear()}-KW${String(week).padStart(2, '0')}`
}

/** Gleitender Mittelwert – glättet z. B. tägliche Gewichtsschwankungen. */
export function movingAverage(points: SeriesPoint[], window: number): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1)
      .map((p) => p.value)
      .filter((v): v is number => v !== null)
    out.push({ day: points[i].day, value: slice.length ? round2(slice.reduce((a, b) => a + b, 0) / slice.length) : null })
  }
  return out
}

/**
 * Pearson-Korrelation zweier Tagesreihen (nur Tage, an denen beide Werte vorliegen).
 * WICHTIG: Ein Zusammenhang ist keine Ursache. Die Oberfläche muss das kenntlich machen.
 */
export function correlation(a: SeriesPoint[], b: SeriesPoint[]): { r: number | null; n: number } {
  const mapB = new Map(b.map((p) => [p.day, p.value]))
  const xs: number[] = []
  const ys: number[] = []
  for (const p of a) {
    const other = mapB.get(p.day)
    if (p.value === null || other === null || other === undefined) continue
    xs.push(p.value)
    ys.push(other)
  }
  const n = xs.length
  if (n < 5) return { r: null, n }
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a1 = xs[i] - mx
    const b1 = ys[i] - my
    num += a1 * b1
    dx += a1 * a1
    dy += b1 * b1
  }
  if (dx === 0 || dy === 0) return { r: null, n }
  return { r: Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000, n }
}

export function correlationLabel(r: number): string {
  const a = Math.abs(r)
  const dir = r >= 0 ? 'gleichläufig' : 'gegenläufig'
  if (a < 0.2) return 'kein erkennbarer Zusammenhang'
  if (a < 0.4) return `schwach ${dir}`
  if (a < 0.6) return `mittel ${dir}`
  if (a < 0.8) return `deutlich ${dir}`
  return `stark ${dir}`
}
