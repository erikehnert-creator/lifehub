/**
 * Ein Trackingwert zum Eintragen – Zahl, Dauer oder Skala.
 *
 * Steht in einer eigenen Datei, weil ihn inzwischen zwei Seiten brauchen: die
 * Trackingseite für Schlaf, Befinden und Körper, und die Ernährungsseite für
 * „Von Hand eintragen". Ihn von dort aus aus Tracking.tsx zu holen ergäbe
 * einen Ringschluss – Tracking.tsx holt sich seinerseits die Ernährungskarte.
 */
import { useMemo, useState } from 'react'
import { ZonePill, DurationInput } from './components'
import { useData, useMutations } from '../state/store'
import { dayValue, evaluateZone, targetFor, dailySeries } from '../core/metrics'
import { Sparkline, seriesColor } from '../charts'
import { formatNumber } from '../core/money'
import { addDays } from '../core/dates'
import type { Metric } from '../core/types'

/** Zielbereich als Text, z. B. „2.250–2.650 kcal". */
function formatRange(metric: Metric, min: number, max: number): string {
  return `${formatNumber(min, metric.decimals)}–${formatNumber(max, metric.decimals)} ${metric.unit}`
}

export function MetricInput({ metric, day }: { metric: Metric; day: string }) {
  const data = useData()
  const m = useMutations()
  const entry = data.metricEntries.find((e) => !e.deleted_at && e.metric_id === metric.id && e.day === day)
  const value = dayValue(data.metricEntries, metric, day)
  const target = targetFor(data.metricTargets, metric.id, day)
  const zone = evaluateZone(value, target)
  const [draft, setDraft] = useState<string | null>(null)

  const labels: string[] | null = metric.scale_labels_json ? JSON.parse(metric.scale_labels_json) : null

  const commit = (raw: string) => {
    setDraft(null)
    const normalised = raw.replace(',', '.').trim()
    if (!normalised) {
      if (entry) m.remove('metric_entries', entry.id, 'Wert entfernt')
      return
    }
    const num = Number(normalised)
    if (!Number.isFinite(num)) return
    if (entry) m.patch('metric_entries', entry.id, { value_num: num })
    else m.create('metric_entries', { metric_id: metric.id, day, value_num: num, source: 'manual' })
  }

  const series = useMemo(
    () => dailySeries(data.metricEntries, metric, addDays(day, -13), day).map((p) => p.value),
    [data.metricEntries, metric, day],
  )

  return (
    <div className="progress-row">
      <div className="progress-head">
        <span className="dot" style={{ background: metric.color ?? seriesColor(0) }} />
        <span>{metric.name}</span>
        {!!metric.show_zone && zone.status !== 'unknown' && (
          <ZonePill status={zone.status}>{zone.label}</ZonePill>
        )}
        <span className="val" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkline values={series} height={22} color={metric.color ?? seriesColor(0)} />
        </span>
      </div>

      {metric.value_type === 'scale' && labels ? (
        <div className="chips">
          {labels.map((label, i) => (
            <button key={i} className={`chip sm ${value === i + 1 ? 'active' : ''}`}
              onClick={() => commit(String(i + 1))}>{label}</button>
          ))}
        </div>
      ) : metric.value_type === 'scale' ? (
        <div className="chips">
          {Array.from({ length: (metric.scale_max ?? 10) - (metric.scale_min ?? 1) + 1 }, (_, i) => (metric.scale_min ?? 1) + i).map((n) => (
            <button key={n} className={`chip sm ${value === n ? 'active' : ''}`} onClick={() => commit(String(n))}>{n}</button>
          ))}
        </div>
      ) : metric.key === 'sleep_h' ? (
        <div className="row" style={{ gap: 8 }}>
          <DurationInput minutes={value !== null ? Math.round(value * 60) : null}
            onChange={(mins) => commit(mins === null ? '' : String(mins / 60))} />
          {!!metric.show_zone && target && zone.greenMin !== null && zone.greenMax !== null && (
            <span className="small muted">Zielbereich {formatRange(metric, zone.greenMin, zone.greenMax)}</span>
          )}
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ maxWidth: 130 }} inputMode="decimal"
            placeholder={target?.target_value ? `Ziel ${formatNumber(target.target_value, metric.decimals)}` : metric.unit}
            value={draft ?? (value !== null ? formatNumber(value, metric.decimals) : '')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          <span className="small muted">{metric.unit}</span>
          {!!metric.show_zone && target && zone.greenMin !== null && zone.greenMax !== null && (
            <span className="small muted">Zielbereich {formatNumber(zone.greenMin, metric.decimals)}–{formatNumber(zone.greenMax, metric.decimals)} {metric.unit}</span>
          )}
        </div>
      )}
    </div>
  )
}

