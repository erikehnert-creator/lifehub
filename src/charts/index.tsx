/**
 * Diagramm-Engine – handgeschriebenes SVG, keine Chart-Bibliothek.
 * Gründe: keine zusätzliche Abhängigkeit, volle Kontrolle über Farben und
 * Barrierefreiheit, und die Diagramme folgen alle demselben Regelwerk.
 *
 * Regeln, die überall gelten:
 *  - dünne Marken, 2px Linien, abgerundete Balkenenden an der Grundlinie
 *  - Gitter und Achsen treten zurück, Text trägt Textfarben statt Serienfarben
 *  - ab zwei Serien immer eine Legende
 *  - Hover-Ebene mit Tooltip als Standard
 */
import React, { useState, useRef, useMemo, useEffect } from 'react'
import { Modal } from '../ui/components'

export const SERIES = ['var(--series-1)','var(--series-2)','var(--series-3)','var(--series-4)',
  'var(--series-5)','var(--series-6)','var(--series-7)','var(--series-8)']

export function seriesColor(i: number): string {
  return SERIES[i % SERIES.length]
}

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const node = tip ? (
    <div className="chart-tooltip" style={{
      left: Math.max(4, Math.min(tip.x, (ref.current?.clientWidth ?? 300) - 130)),
      top: Math.max(0, tip.y - 8),
    }}>{tip.content}</div>
  ) : null
  return { tip, setTip, ref, node }
}

/**
 * Runde Werte für die Y-Achse.
 *
 * Ohne beschriftete Achse ist ein Balkendiagramm nur ein Bild: Man sieht,
 * dass ein Monat höher ist als der andere, aber nicht, um wie viel. Deshalb
 * bekommt jedes Diagramm Zahlen an der Seite – und zwar runde, weil „2.500"
 * lesbar ist und „2.487,33" nicht.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min]
  const roh = (max - min) / Math.max(2, target)
  const mag = Math.pow(10, Math.floor(Math.log10(roh)))
  const norm = roh / mag
  const schritt = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const erste = Math.ceil(min / schritt - 1e-9) * schritt
  const out: number[] = []
  for (let v = erste; v <= max + schritt * 1e-9; v += schritt) {
    out.push(Math.abs(v) < schritt * 1e-9 ? 0 : Number(v.toFixed(10)))
  }
  return out
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return step * mag
}

// ------------------------------------------------------------- Balkendiagramm

export interface BarDatum { label: string; values: number[]; hint?: string }

export function BarChart({
  data, seriesNames, height = 190, formatValue = (n: number) => String(n), stacked = false,
  axisLabel, formatAxis,
}: {
  data: BarDatum[]
  seriesNames: string[]
  height?: number
  formatValue?: (n: number) => string
  stacked?: boolean
  /** Beschriftung der Y-Achse, z. B. „Euro" oder „kcal". */
  axisLabel?: string
  /** Kurzform für die Achsenzahlen; ohne Angabe wird formatValue benutzt. */
  formatAxis?: (n: number) => string
}) {
  const { setTip, ref, node } = useTooltip()
  const padL = 76, padR = 8, padB = 22, padT = 10
  const W = 640
  const H = height
  const innerH = H - padB - padT

  // Negative Werte (z. B. ein Monat mit Minus beim Sparbetrag) müssen sichtbar
  // sein – sonst verschwinden genau die Monate, die man sehen müsste.
  const { max, min } = useMemo(() => {
    const highs = data.map((d) => stacked
      ? d.values.reduce((a, b) => a + Math.max(0, b), 0)
      : Math.max(...d.values.map((v) => Math.max(0, v)), 0))
    const lows = data.map((d) => stacked
      ? d.values.reduce((a, b) => a + Math.min(0, b), 0)
      : Math.min(...d.values.map((v) => Math.min(0, v)), 0))
    return { max: niceMax(Math.max(...highs, 1)), min: -niceMax(Math.max(-Math.min(...lows, 0), 0)) }
  }, [data, stacked])

  const span = max - min || 1
  const y0 = padT + innerH - ((0 - min) / span) * innerH // Nulllinie
  const scale = (v: number) => (Math.abs(v) / span) * innerH

  const groupW = data.length ? (W - padL - padR) / data.length : 0
  const nSeries = seriesNames.length
  const barW = stacked ? Math.min(30, groupW * 0.5) : Math.min(18, (groupW * 0.62) / Math.max(1, nSeries))

  const achse = formatAxis ?? formatValue
  const ticks = niceTicks(min, max, Math.max(3, Math.round(innerH / 44)))
  const yFuer = (v: number) => padT + innerH - ((v - min) / span) * innerH

  return (
    <div className="chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label={`Balkendiagramm: ${seriesNames.join(', ')}`} style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yFuer(t)} y2={yFuer(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 7} y={yFuer(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-muted)">
              {achse(t)}
            </text>
          </g>
        ))}
        {axisLabel && (
          <text x={11} y={padT + innerH / 2} fontSize={10.5} fill="var(--text-muted)"
            textAnchor="middle" transform={`rotate(-90 11 ${padT + innerH / 2})`}>{axisLabel}</text>
        )}
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke="var(--axis)" strokeWidth={min < 0 ? 1.5 : 1} />
        {data.map((d, i) => {
          const gx = padL + i * groupW
          let posAcc = 0
          let negAcc = 0
          return (
            <g key={d.label}>
              {d.values.map((v, s) => {
                const h = scale(v)
                if (h <= 0) return null
                let x: number, y: number
                if (stacked) {
                  x = gx + groupW / 2 - barW / 2
                  if (v >= 0) { y = y0 - h - posAcc; posAcc += h + 2 }
                  else { y = y0 + negAcc; negAcc += h + 2 }
                } else {
                  const totalW = nSeries * barW + (nSeries - 1) * 2
                  x = gx + groupW / 2 - totalW / 2 + s * (barW + 2)
                  y = v >= 0 ? y0 - h : y0
                }
                return (
                  <rect key={s} x={x} y={y} width={barW} height={Math.max(1, h)}
                    rx={Math.min(4, barW / 2)} fill={v < 0 ? 'var(--critical)' : seriesColor(s)}
                    onMouseEnter={() => setTip({
                      x: gx + groupW / 2, y: Math.min(y, y0),
                      content: <><strong>{d.label}</strong><br />{seriesNames[s]}: {formatValue(v)}</>,
                    })}
                    onMouseLeave={() => setTip(null)} />
                )
              })}
              <text x={gx + groupW / 2} y={H - 6} textAnchor="middle"
                fontSize={11} fill="var(--text-muted)">{d.label}</text>
            </g>
          )
        })}
      </svg>
      {node}
      {seriesNames.length > 1 && (
        <div className="legend">
          {seriesNames.map((n, i) => (
            <span className="legend-item" key={n}>
              <span className="legend-swatch" style={{ background: seriesColor(i) }} />{n}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- Liniendiagramm

export interface LinePoint { label: string; value: number | null }

export function LineChart({
  series, height = 190, formatValue = (n: number) => String(n), band, showArea = true, zeroBased = false,
  axisLabel, formatAxis,
}: {
  series: { name: string; points: LinePoint[] }[]
  height?: number
  formatValue?: (n: number) => string
  band?: { min: number; max: number; label?: string }
  showArea?: boolean
  zeroBased?: boolean
  axisLabel?: string
  formatAxis?: (n: number) => string
}) {
  const { setTip, ref, node } = useTooltip()
  const W = 640, H = height, padL = 76, padR = 10, padB = 22, padT = 10
  const innerH = H - padT - padB
  const innerW = W - padL - padR
  const n = series[0]?.points.length ?? 0

  const allValues = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v !== null)
  if (band) { allValues.push(band.min, band.max) }
  let min = allValues.length ? Math.min(...allValues) : 0
  let max = allValues.length ? Math.max(...allValues) : 1
  if (zeroBased) min = Math.min(0, min)
  const pad = (max - min) * 0.12 || 1
  min -= pad; max += pad
  const scaleY = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH
  const scaleX = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)

  const path = (points: LinePoint[]) => {
    let d = ''
    let started = false
    points.forEach((p, i) => {
      if (p.value === null) { started = false; return }
      d += `${started ? 'L' : 'M'}${scaleX(i).toFixed(1)},${scaleY(p.value).toFixed(1)} `
      started = true
    })
    return d.trim()
  }

  const areaPath = (points: LinePoint[]) => {
    const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null)
    if (valid.length < 2) return ''
    const top = valid.map((p, k) => `${k === 0 ? 'M' : 'L'}${scaleX(p.i).toFixed(1)},${scaleY(p.value!).toFixed(1)}`).join(' ')
    const baseY = padT + innerH
    return `${top} L${scaleX(valid[valid.length - 1].i).toFixed(1)},${baseY} L${scaleX(valid[0].i).toFixed(1)},${baseY} Z`
  }

  const labelEvery = Math.max(1, Math.ceil(n / 8))

  return (
    <div className="chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label={`Liniendiagramm: ${series.map((s) => s.name).join(', ')}`} style={{ display: 'block' }}>
        {niceTicks(min, max, Math.max(3, Math.round(innerH / 44))).map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={scaleY(t)} y2={scaleY(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 7} y={scaleY(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-muted)">
              {(formatAxis ?? formatValue)(t)}
            </text>
          </g>
        ))}
        {axisLabel && (
          <text x={11} y={padT + innerH / 2} fontSize={10.5} fill="var(--text-muted)"
            textAnchor="middle" transform={`rotate(-90 11 ${padT + innerH / 2})`}>{axisLabel}</text>
        )}
        {band && (
          <>
            <rect x={padL} y={scaleY(band.max)} width={innerW}
              height={Math.max(1, scaleY(band.min) - scaleY(band.max))}
              fill="var(--good)" opacity={0.11} />
            <line x1={padL} x2={W - padR} y1={scaleY(band.max)} y2={scaleY(band.max)} stroke="var(--good)" strokeWidth={1} strokeDasharray="3 3" opacity={.55} />
            <line x1={padL} x2={W - padR} y1={scaleY(band.min)} y2={scaleY(band.min)} stroke="var(--good)" strokeWidth={1} strokeDasharray="3 3" opacity={.55} />
          </>
        )}
        {series.map((s, si) => (
          <g key={s.name}>
            {showArea && series.length === 1 && (
              <path d={areaPath(s.points)} fill={seriesColor(si)} opacity={0.10} />
            )}
            <path d={path(s.points)} fill="none" stroke={seriesColor(si)} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" />
            {s.points.map((p, i) => p.value === null ? null : (
              <circle key={i} cx={scaleX(i)} cy={scaleY(p.value)} r={n > 40 ? 0 : 3.2}
                fill={seriesColor(si)} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        ))}
        {/* Hover-Ebene */}
        {series[0]?.points.map((p, i) => (
          <rect key={i} x={scaleX(i) - innerW / Math.max(1, n) / 2} y={padT}
            width={innerW / Math.max(1, n)} height={innerH} fill="transparent"
            onMouseEnter={() => setTip({
              x: scaleX(i), y: padT,
              content: <><strong>{p.label}</strong>{series.map((s) => (
                <div key={s.name}>{series.length > 1 ? `${s.name}: ` : ''}
                  {s.points[i]?.value === null || s.points[i]?.value === undefined ? '–' : formatValue(s.points[i]!.value!)}</div>
              ))}</>,
            })}
            onMouseLeave={() => setTip(null)} />
        ))}
        {series[0]?.points.map((p, i) => i % labelEvery === 0 ? (
          <text key={i} x={scaleX(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{p.label}</text>
        ) : null)}
      </svg>
      {node}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s, i) => (
            <span className="legend-item" key={s.name}>
              <span className="legend-swatch" style={{ background: seriesColor(i) }} />{s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ Ringdiagramm

export function DonutChart({
  slices, size = 168, thickness = 22, centerLabel, centerValue, maxLegend = 8, formatValue,
}: {
  slices: { label: string; value: number; color?: string }[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
  maxLegend?: number
  /** Wenn gesetzt, steht in der Legende zusätzlich der Betrag. */
  formatValue?: (n: number) => string
}) {
  const { setTip, ref, node } = useTooltip()
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = size / 2 - thickness / 2
  const c = size / 2
  let angle = -Math.PI / 2
  const gap = total > 0 ? 0.02 : 0

  return (
    <div className="chart-wrap" ref={ref} style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Ringdiagramm" style={{ flex: 'none' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {total > 0 && slices.map((s, i) => {
          const frac = s.value / total
          const sweep = frac * Math.PI * 2 - (slices.length > 1 ? gap : 0)
          if (sweep <= 0) return null
          const start = angle
          const end = angle + sweep
          angle += frac * Math.PI * 2
          const x1 = c + r * Math.cos(start), y1 = c + r * Math.sin(start)
          const x2 = c + r * Math.cos(end), y2 = c + r * Math.sin(end)
          const large = sweep > Math.PI ? 1 : 0
          return (
            <path key={i} d={`M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2}`}
              fill="none" stroke={s.color ?? seriesColor(i)} strokeWidth={thickness} strokeLinecap="butt"
              onMouseEnter={() => setTip({ x: c, y: 0, content: <><strong>{s.label}</strong><br />{Math.round(frac * 1000) / 10} %</> })}
              onMouseLeave={() => setTip(null)} />
          )
        })}
        {centerValue && (
          <>
            <text x={c} y={c - 2} textAnchor="middle" fontSize={19} fontWeight={700} fill="var(--ink)">{centerValue}</text>
            <text x={c} y={c + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{centerLabel}</text>
          </>
        )}
      </svg>
      <div className="legend" style={{ flexDirection: 'column', gap: 6, marginTop: 0, flex: 1, minWidth: 140 }}>
        {slices.slice(0, maxLegend).map((s, i) => (
          <span className="legend-item" key={s.label} style={{ width: '100%' }}>
            <span className="legend-swatch" style={{ background: s.color ?? seriesColor(i) }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            {formatValue && <span className="mono muted">{formatValue(s.value)}</span>}
            <span className="mono muted">{total > 0 ? Math.round((s.value / total) * 100) : 0} %</span>
          </span>
        ))}
      </div>
      {node}
    </div>
  )
}

// ------------------------------------------------------------------ Sparkline

export function Sparkline({ values, height = 34, color = 'var(--series-1)' }: {
  values: (number | null)[]; height?: number; color?: string
}) {
  const W = 120, H = height
  const valid = values.filter((v): v is number => v !== null)
  if (valid.length < 2) return <svg width={W} height={H} />
  const min = Math.min(...valid), max = Math.max(...valid)
  const span = max - min || 1
  const pts = values.map((v, i) => v === null ? null : {
    x: (i / (values.length - 1)) * W,
    y: H - 3 - ((v - min) / span) * (H - 6),
  })
  let d = ''; let started = false
  for (const p of pts) {
    if (!p) { started = false; continue }
    d += `${started ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `
    started = true
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d.trim()} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ----------------------------------------------------------------- Messanzeige

export function Meter({ percent, status = 'good', markerPercent }: {
  percent: number; status?: 'good' | 'warning' | 'critical'; markerPercent?: number
}) {
  const color = status === 'critical' ? 'var(--critical)' : status === 'warning' ? 'var(--warning)' : 'var(--good)'
  return (
    <div className="meter" style={{ position: 'relative' }}>
      <div className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
      {markerPercent !== undefined && markerPercent > 0 && markerPercent < 100 && (
        <div style={{
          position: 'absolute', left: `${markerPercent}%`, top: -2, bottom: -2,
          width: 2, background: 'var(--text-muted)', opacity: .55,
        }} title={`Zeitanteil des Monats: ${Math.round(markerPercent)} %`} />
      )}
    </div>
  )
}

// ------------------------------------------------------------- Jahres-Heatmap

export function YearHeatmap({
  year, values, colorFor, onDayClick, legend,
}: {
  year: number
  values: Map<string, number>
  colorFor: (v: number | undefined) => string
  onDayClick?: (day: string) => void
  legend?: { label: string; color: string }[]
}) {
  const { setTip, ref, node } = useTooltip()
  const cell = 11, gap = 2.5
  const start = new Date(year, 0, 1)
  const startDow = (start.getDay() + 6) % 7
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
  const weeks = Math.ceil((daysInYear + startDow) / 7)
  const W = weeks * (cell + gap) + 24
  const H = 7 * (cell + gap) + 16

  const cells: React.ReactNode[] = []
  for (let i = 0; i < daysInYear; i++) {
    const d = new Date(year, 0, 1 + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const idx = i + startDow
    const wk = Math.floor(idx / 7)
    const dow = idx % 7
    cells.push(
      <rect key={key} x={24 + wk * (cell + gap)} y={dow * (cell + gap)} width={cell} height={cell} rx={2.5}
        fill={colorFor(values.get(key))}
        onMouseEnter={() => setTip({ x: 24 + wk * (cell + gap), y: dow * (cell + gap), content: key })}
        onMouseLeave={() => setTip(null)}
        onClick={() => onDayClick?.(key)}
        style={{ cursor: onDayClick ? 'pointer' : 'default' }} />,
    )
  }
  const monthLabels = Array.from({ length: 12 }, (_, m) => {
    const d = new Date(year, m, 1)
    const dayIdx = Math.floor((d.getTime() - start.getTime()) / 86400000) + startDow
    return { x: 24 + Math.floor(dayIdx / 7) * (cell + gap), label: ['J','F','M','A','M','J','J','A','S','O','N','D'][m] }
  })

  return (
    <div className="chart-wrap scroll-x" ref={ref}>
      <svg width={W} height={H + 14} viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`Jahresübersicht ${year}`}>
        {['Mo','','Mi','','Fr','',''].map((l, i) => l ? (
          <text key={i} x={0} y={i * (cell + gap) + 9} fontSize={9} fill="var(--text-muted)">{l}</text>
        ) : null)}
        {monthLabels.map((m, i) => (
          <text key={i} x={m.x} y={H + 6} fontSize={9.5} fill="var(--text-muted)">{m.label}</text>
        ))}
        {cells}
      </svg>
      {node}
      {legend && (
        <div className="legend">
          {legend.map((l) => (
            <span className="legend-item" key={l.label}>
              <span className="legend-swatch" style={{ background: l.color }} />{l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------- Horizontales Ranking

export function RankBars({ items, formatValue }: {
  items: { label: string; value: number; color?: string }[]
  formatValue: (n: number) => string
}) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div>
      {items.map((it, i) => (
        <div key={it.label} className="progress-row">
          <div className="progress-head">
            <span className="dot" style={{ background: it.color ?? seriesColor(i) }} />
            <span className="name">{it.label}</span>
            <span className="val">{formatValue(it.value)}</span>
          </div>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? seriesColor(i) }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// --------------------------------------------------- Antippen und vergrößern

/**
 * Rahmen um ein Diagramm, das man antippen kann.
 *
 * Auf dem Handy ist ein Diagramm mit zwölf Monaten schlicht zu klein, um etwas
 * abzulesen. Ein Tipp öffnet es deshalb bildschirmfüllend, mit Zoom und
 * Verschieben – gezoomt wird, indem das Diagramm breiter gemacht wird und der
 * Rahmen scrollt. Das ist einfacher als eine Zoom-Matrix und fühlt sich beim
 * Wischen richtig an, weil es echtes Scrollen ist.
 *
 * Zwei Finger zum Auf- und Zuziehen funktionieren zusätzlich.
 */
export function ChartFrame({ title, sub, children }: {
  title: string
  sub?: string
  children: (opts: { height: number; gross: boolean }) => React.ReactNode
}) {
  const [offen, setOffen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  const geste = useRef<{ start: number; zoom: number } | null>(null)

  useEffect(() => { if (offen) setZoom(1) }, [offen])

  const abstand = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  return (
    <>
      <div className="chart-tap" onClick={() => setOffen(true)}
        role="button" tabIndex={0} title="Antippen zum Vergrößern"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOffen(true) } }}>
        {children({ height: 190, gross: false })}
        <span className="chart-lupe" aria-hidden="true">⤢</span>
      </div>

      <Modal open={offen} onClose={() => setOffen(false)} wide title={title}
        footer={<>
          <span className="small muted" style={{ marginRight: 'auto' }}>
            {zoom > 1 ? 'Zum Verschieben wischen' : 'Größer ziehen oder + tippen'}
          </span>
          <button className="btn" onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 2) / 2))}
            disabled={zoom <= 1} aria-label="Kleiner">−</button>
          <span className="mono small" style={{ minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)} %</span>
          <button className="btn" onClick={() => setZoom((z) => Math.min(5, Math.round((z + 0.5) * 2) / 2))}
            disabled={zoom >= 5} aria-label="Größer">+</button>
          <button className="btn btn-primary" onClick={() => setOffen(false)}>Fertig</button>
        </>}>
        {sub && <div className="small muted">{sub}</div>}
        <div className="chart-zoom" ref={box}
          onTouchStart={(e) => {
            if (e.touches.length === 2) geste.current = { start: abstand(e.touches), zoom }
          }}
          onTouchMove={(e) => {
            if (e.touches.length !== 2 || !geste.current) return
            const faktor = abstand(e.touches) / geste.current.start
            setZoom(Math.min(5, Math.max(1, geste.current.zoom * faktor)))
          }}
          onTouchEnd={() => { geste.current = null }}>
          <div style={{ width: `${zoom * 100}%` }}>
            {children({ height: 340, gross: true })}
          </div>
        </div>
      </Modal>
    </>
  )
}
