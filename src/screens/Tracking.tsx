/**
 * TRACKING – Tageseintrag, Ernährung, Schlaf, Training, Körper, Zielbereiche.
 * Alle Tageswerte laufen über dasselbe Metrik-System, deshalb gilt die
 * Toleranzlogik (grün/gelb/rot) überall gleich.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Tabs, Empty, Confirm, ZonePill, DurationInput, Collapsible } from '../ui/components'
import { LineChart, BarChart, Sparkline, Meter, seriesColor } from '../charts'
import { useData, useMutations } from '../state/store'
import {
  dayValue, dailySeries, targetFor, evaluateZone, movingAverage, aggregate, groupSeries, formatMetricValue,
} from '../core/metrics'
import {
  todayString, formatDay, addDays, daysInRange, formatDuration, weekdayIndex, weekdayShort,
} from '../core/dates'
import { formatNumber } from '../core/money'
import type { Metric, MetricEntry, MetricTarget, WorkoutSession, BodyMeasurement } from '../core/types'

/** Wertebereich mit Einheit einmal am Ende, z. B. "18,0–22,0 kg" bzw. für Schlaf "7:00–8:00". */
function formatRange(metric: Metric, min: number, max: number): string {
  if (metric.key === 'sleep_h') return `${formatMetricValue(metric, min)}–${formatMetricValue(metric, max)}`
  return `${formatNumber(min, metric.decimals)}–${formatNumber(max, metric.decimals)} ${metric.unit}`
}

const GROUP_LABELS: Record<string, string> = {
  nutrition: 'Ernährung',
  body: 'Körper',
  sleep: 'Schlaf',
  activity: 'Aktivität',
  wellbeing: 'Befinden',
}

/** Ruhetage sind bewusst geplant – sie sehen anders aus als ausgefallene Einheiten. */
function sessionIcon(status: string) {
  if (status === 'completed') return '✅'
  if (status === 'skipped') return '⏭️'
  if (status === 'rest') return '😴'
  return '📅'
}
function sessionZusatz(status: string) {
  if (status === 'skipped') return ' · ausgefallen'
  if (status === 'rest') return ' · Ruhetag'
  return ''
}

export function TrackingScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  const tabs = [
    { key: '', label: 'Tag' },
    { key: 'verlauf', label: 'Verlauf' },
    { key: 'training', label: 'Training' },
    { key: 'koerper', label: 'Körper' },
    { key: 'ziele', label: 'Zielbereiche' },
  ]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Tracking</div>
          <div className="page-sub">Ernährung, Schlaf, Befinden, Training und Körperdaten</div>
        </div>
      </div>
      <Tabs tabs={tabs} active={sub} onChange={(k) => navigate(`#/tracking${k ? '/' + k : ''}`)} />
      {sub === '' && <DailyEntry />}
      {sub === 'verlauf' && <TrendView />}
      {sub === 'training' && <TrainingView />}
      {sub === 'koerper' && <BodyView />}
      {sub === 'ziele' && <TargetsView />}
    </div>
  )
}

/* ---------------------------------------------------------- Tageseintrag */

function DailyEntry() {
  const data = useData()
  const m = useMutations()
  const [day, setDay] = useState(todayString())

  const metrics = data.metrics.filter((x) => !x.deleted_at && x.is_enabled && x.show_in_daily_form)
  const groups = useMemo(() => {
    const map = new Map<string, Metric[]>()
    for (const metric of metrics) {
      const arr = map.get(metric.group_key) ?? []
      arr.push(metric)
      map.set(metric.group_key, arr)
    }
    return [...map.entries()]
  }, [metrics])

  const filled = metrics.filter((metric) => dayValue(data.metricEntries, metric, day) !== null).length

  return (
    <>
      <div className="row mb16">
        <button className="btn btn-sm" onClick={() => setDay(addDays(day, -1))}>←</button>
        <strong style={{ minWidth: 200, textAlign: 'center' }}>{formatDay(day, 'long')}</strong>
        <button className="btn btn-sm" disabled={day >= todayString()} onClick={() => setDay(addDays(day, 1))}>→</button>
        {day !== todayString() && <button className="btn btn-sm btn-ghost" onClick={() => setDay(todayString())}>Heute</button>}
        <span style={{ flex: 1 }} />
        <span className="small muted">{filled} von {metrics.length} Werten erfasst</span>
        <button className="btn btn-sm" onClick={() => {
          // Werte von gestern übernehmen – schneller als alles neu tippen
          const yesterday = addDays(day, -1)
          let n = 0
          for (const metric of metrics) {
            if (dayValue(data.metricEntries, metric, day) !== null) continue
            const v = dayValue(data.metricEntries, metric, yesterday)
            if (v === null) continue
            m.create('metric_entries', { metric_id: metric.id, day, value_num: v, source: 'manual' })
            n++
          }
          m.toast(n ? `${n} Werte von gestern übernommen` : 'Nichts zu übernehmen')
        }}>Von gestern übernehmen</button>
      </div>

      <div className="grid grid-2">
        {groups.map(([groupKey, list]) => (
          <Card key={groupKey} title={GROUP_LABELS[groupKey] ?? groupKey}>
            {list.map((metric) => <MetricInput key={metric.id} metric={metric} day={day} />)}
            {groupKey === 'wellbeing' && <SkinNote day={day} />}
          </Card>
        ))}
        <ActivityCard day={day} />
      </div>
    </>
  )
}

function MetricInput({ metric, day }: { metric: Metric; day: string }) {
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

/**
 * Aktivität des Tages: was tatsächlich gemacht wurde.
 * Bewusst kein Schrittzähler – festgehalten wird die Art der Bewegung
 * (Turntraining, Ausdauerlauf, HIIT, Bauchworkout …), nicht eine Zahl,
 * die nichts über die Belastung sagt.
 */
const ACTIVITY_SUGGESTIONS = [
  'Turntraining', 'Ausdauerlauf', 'HIIT', 'Bauchworkout', 'Krafttraining',
  'Mobility', 'Radfahren', 'Schwimmen', 'Spaziergang', 'Fußball',
]

function ActivityCard({ day }: { day: string }) {
  const data = useData()
  const m = useMutations()
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState<number | null>(45)
  const [note, setNote] = useState('')
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const sessions = data.workoutSessions.filter((s) => !s.deleted_at && s.day === day)

  const add = (name: string) => {
    if (!name.trim()) return
    m.create('workout_sessions', {
      day, title: name.trim(), type: null, duration_minutes: minutes,
      status: 'completed', perceived_effort: null, note: note.trim() || null, plan_day_id: null,
      started_at: null, ended_at: null,
    }, `${name.trim()} erfasst`)
    setTitle('')
    setNote('')
  }

  return (
    <Card title="Aktivität" sub="Was hast du heute gemacht?">
      {sessions.length > 0 && (
        <div className="list mb16">
          {sessions.map((s) => (
            <div key={s.id}>
              <div className="list-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="avatar">{sessionIcon(s.status)}</span>
                <span className="list-main">
                  <span className="list-title">{s.title}</span>
                  <span className="list-sub">
                    {s.duration_minutes ? formatDuration(s.duration_minutes) : 'ohne Dauer'}
                    {s.perceived_effort ? ` · Anstrengung ${s.perceived_effort}/10` : ''}
                    {s.note ? ` · ${s.note}` : ''}
                  </span>
                </span>
                <button className="btn btn-sm btn-ghost" title="Notiz"
                  onClick={() => { setEditingNote(editingNote === s.id ? null : s.id); setNoteDraft(s.note ?? '') }}>
                  {s.note ? '📝' : '＋📝'}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => m.remove('workout_sessions', s.id, 'Entfernt')}>✕</button>
              </div>
              {editingNote === s.id && (
                <div style={{ padding: '0 0 12px' }}>
                  <textarea className="textarea" style={{ minHeight: 60 }} autoFocus
                    placeholder="Was genau hast du gemacht? z. B. Handstand-Drills, 3x8 Klimmzüge, 5 km locker"
                    value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
                  <div className="row mt8">
                    <button className="btn btn-sm btn-primary" onClick={() => {
                      m.patch('workout_sessions', s.id, { note: noteDraft.trim() || null }, 'Notiz gespeichert')
                      setEditingNote(null)
                    }}>Notiz speichern</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingNote(null)}>Abbrechen</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Field label="Neue Aktivität">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="z. B. Turntraining"
          onKeyDown={(e) => { if (e.key === 'Enter') add(title) }} />
      </Field>
      <div className="chips mt8">
        {ACTIVITY_SUGGESTIONS.map((a) => (
          <button key={a} className="chip sm" onClick={() => add(a)}>{a}</button>
        ))}
      </div>
      <div className="mt12">
        <Field label="Dauer"><DurationInput minutes={minutes} onChange={setMinutes} /></Field>
      </div>
      <Field label="Notiz" hint="Was genau war es? Übungen, Strecke, Gefühl.">
        <textarea className="textarea" style={{ minHeight: 56 }} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Turnen: Handstand, Ringe, danach Bauch" />
      </Field>
      <button className="btn btn-primary mt12" disabled={!title.trim()} onClick={() => add(title)}>Hinzufügen</button>
    </Card>
  )
}

/** Freitext zur Haut: wo sitzen die Pickel, wie sieht sie aus. */
function SkinNote({ day }: { day: string }) {
  const data = useData()
  const m = useMutations()
  const metric = data.metrics.find((x) => !x.deleted_at && x.key === 'skin')
  const entry = metric ? data.metricEntries.find((e) => !e.deleted_at && e.metric_id === metric.id && e.day === day) : null
  const [draft, setDraft] = useState<string | null>(null)
  if (!metric) return null

  const commit = (text: string) => {
    setDraft(null)
    const value = text.trim() || null
    if (entry) m.patch('metric_entries', entry.id, { note: value })
    else if (value) m.create('metric_entries', { metric_id: metric.id, day, value_num: null, note: value, source: 'manual' })
  }

  return (
    <div className="progress-row">
      <div className="progress-head"><span>Hautbild notieren</span></div>
      <textarea className="textarea" style={{ minHeight: 60 }}
        placeholder="z. B. Stirn ruhig, zwei Pickel am Kinn, Wangen leicht gerötet"
        value={draft ?? entry?.note ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)} />
    </div>
  )
}

/* --------------------------------------------------------------- Verlauf */

function TrendView() {
  const data = useData()
  const [range, setRange] = useState(30)
  const [selected, setSelected] = useState<string[]>([])

  const metrics = data.metrics.filter((m) => !m.deleted_at && m.is_enabled)
  const active = selected.length ? metrics.filter((m) => selected.includes(m.id)) : metrics.slice(0, 4)
  const today = todayString()
  const from = addDays(today, -(range - 1))

  return (
    <>
      <div className="row mb16">
        <Chips options={[{ value: 14, label: '14 Tage' }, { value: 30, label: '30 Tage' }, { value: 90, label: '90 Tage' }, { value: 365, label: '1 Jahr' }]}
          value={range} onChange={setRange} />
        <span style={{ flex: 1 }} />
      </div>
      <Card className="mb16" title="Werte auswählen">
        <div className="chips">
          {metrics.map((m) => (
            <button key={m.id} className={`chip sm ${active.some((a) => a.id === m.id) ? 'active' : ''}`}
              onClick={() => setSelected((s) => s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id])}>
              {m.name}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        {active.map((metric) => {
          const points = dailySeries(data.metricEntries, metric, from, today)
          const avgLine = movingAverage(points, 7)
          const target = targetFor(data.metricTargets, metric.id, today)
          const values = points.map((p) => p.value).filter((v): v is number => v !== null)
          const avg = aggregate(values, metric.aggregation === 'sum' ? 'avg' : metric.aggregation)
          const zone = evaluateZone(avg, target)
          const labelStep = Math.max(1, Math.floor(points.length / 12))
          return (
            <Card key={metric.id} title={metric.name}
              sub={`${values.length} Einträge · Ø ${avg !== null ? formatMetricValue(metric, avg) : '–'}`}
              action={metric.show_zone && zone.status !== 'unknown' ? <ZonePill status={zone.status}>{zone.label}</ZonePill> : undefined}>
              <LineChart
                series={[
                  { name: metric.name, points: points.map((p, i) => ({ label: i % labelStep === 0 ? formatDay(p.day, 'short') : '', value: p.value })) },
                  { name: 'Ø 7 Tage', points: avgLine.map((p, i) => ({ label: i % labelStep === 0 ? formatDay(p.day, 'short') : '', value: p.value })) },
                ]}
                band={target && zone.greenMin !== null && zone.greenMax !== null
                  ? { min: zone.greenMin, max: zone.greenMax, label: 'Zielbereich' } : undefined}
                formatValue={(v) => formatMetricValue(metric, v)}
                showArea={false}
              />
            </Card>
          )
        })}
      </div>
    </>
  )
}

/* -------------------------------------------------------------- Training */

function TrainingView() {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const [editing, setEditing] = useState<WorkoutSession | 'new' | null>(null)
  const [planOpen, setPlanOpen] = useState<any | 'new' | null>(null)

  const sessions = data.workoutSessions.filter((s) => !s.deleted_at)
  const last30 = sessions.filter((s) => s.day >= addDays(today, -29))
  const completed = last30.filter((s) => s.status === 'completed')
  const planned = sessions.filter((s) => s.status === 'planned' && s.day >= today)
  const minutes = completed.reduce((sum, x) => sum + (x.duration_minutes ?? 0), 0)
  const plans = data.workoutPlans.filter((p) => !p.deleted_at)

  const weeks = useMemo(() => {
    const out: { label: string; values: number[] }[] = []
    for (let w = 11; w >= 0; w--) {
      const start = addDays(today, -w * 7 - 6)
      const end = addDays(today, -w * 7)
      out.push({
        label: w === 0 ? 'jetzt' : `-${w}W`,
        values: [sessions.filter((s) => s.status === 'completed' && s.day >= start && s.day <= end).length],
      })
    }
    return out
  }, [sessions, today])

  return (
    <>
      <div className="grid grid-4 keep2 mb16">
        <Card><Stat label="Einheiten (30 Tage)" value={String(completed.length)} /></Card>
        <Card><Stat label="Trainingszeit" value={formatDuration(minutes)} /></Card>
        <Card><Stat label="Ø pro Woche" value={formatNumber(completed.length / 4.3, 1)} /></Card>
        <Card><Stat label="Geplant" value={String(planned.length)} /></Card>
      </div>

      <Card className="mb16" title="Training dokumentieren"
        sub="Datum, Uhrzeit, was du gemacht hast, wie lange und wie anstrengend."
        action={<button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>+ Einheit</button>}>
        <div className="mt8">
          <BarChart data={weeks} seriesNames={['Einheiten pro Woche']} formatValue={(v) => String(Math.round(v))} height={150} />
        </div>
      </Card>

      {planned.length > 0 && (
        <Card className="mb16" title="Geplant" sub="Noch nicht absolviert">
          <div className="list">
            {planned.map((s) => (
              <div className="list-row" key={s.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="avatar">📅</span>
                <span className="list-main">
                  <span className="list-title">{s.title}</span>
                  <span className="list-sub">{formatDay(s.day)}{s.started_at ? ` · ${s.started_at}` : ''}{s.duration_minutes ? ` · ${formatDuration(s.duration_minutes)}` : ''}</span>
                </span>
                <button className="btn btn-sm" onClick={() => m.patch('workout_sessions', s.id, { status: 'completed' }, 'Als absolviert markiert')}>Erledigt</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)}>…</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb16" title="Trainingsverlauf" >
        {sessions.length === 0 ? (
          <Empty icon="🏋️" title="Noch keine Einheit erfasst"
            hint="Trage ein, was du gemacht hast – der Plan ist optional."
            action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Einheit</button>} />
        ) : (
          <div className="list">
            {sessions.slice(0, 40).map((s) => (
              <button className="list-row" key={s.id} onClick={() => setEditing(s)} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="avatar">{sessionIcon(s.status)}</span>
                <span className="list-main">
                  <span className="list-title">{s.title}</span>
                  <span className="list-sub">
                    {formatDay(s.day)}
                    {s.started_at ? ` · ${s.started_at}` : ''}
                    {s.duration_minutes ? ` · ${formatDuration(s.duration_minutes)}` : ''}
                    {s.perceived_effort ? ` · Anstrengung ${s.perceived_effort}/10` : ''}
                    {sessionZusatz(s.status)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="Trainingspläne" sub="Optional. Lege so viele Wochen an, wie dein Rhythmus braucht – A/B, A/B/C oder mehr."
        action={<button className="btn btn-sm" onClick={() => setPlanOpen('new')}>+ Plan</button>}>
        {plans.length === 0 ? (
          <div className="hint-box">Noch kein Plan angelegt. Du kannst Training auch ganz ohne Plan dokumentieren.</div>
        ) : plans.map((plan) => {
          const planDays = data.workoutPlanDays.filter((d) => !d.deleted_at && d.plan_id === plan.id)
          const weekLetter = (i: number) => String.fromCharCode(65 + i)
          return (
            <div key={plan.id} className="mb16">
              <div className="row">
                <strong>{plan.name}</strong>
                <span className="pill">{plan.cycle_weeks} Wochen</span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-sm btn-ghost" onClick={() => setPlanOpen(plan)}>Bearbeiten</button>
              </div>
              {Array.from({ length: plan.cycle_weeks }, (_, w) => (
                <div key={w} className="mt8">
                  <div className="field-label">Woche {weekLetter(w)}</div>
                  {planDays.filter((d) => d.week_index === w).length === 0
                    ? <div className="small muted">keine Einheiten</div>
                    : planDays.filter((d) => d.week_index === w).map((d) => (
                        <div key={d.id} className="row small" style={{ gap: 8 }}>
                          <strong style={{ minWidth: 30 }}>{['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][d.weekday]}</strong>
                          <span>{d.title}</span>
                          {d.frequency === 'biweekly' && <span className="pill">alle 2 Wochen</span>}
                        </div>
                      ))}
                </div>
              ))}
            </div>
          )
        })}
      </Card>

      {editing && <SessionEditor session={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {planOpen && <PlanEditor plan={planOpen === 'new' ? null : planOpen} onClose={() => setPlanOpen(null)} />}
    </>
  )
}

function PlanEditor({ plan, onClose }: { plan: any | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [name, setName] = useState(plan?.name ?? '')
  const [cycleWeeks, setCycleWeeks] = useState(plan?.cycle_weeks ?? 2)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newDay, setNewDay] = useState({ week: 0, weekday: 1, title: '', frequency: 'every' as 'every' | 'biweekly' })

  const planDays = plan ? data.workoutPlanDays.filter((d) => !d.deleted_at && d.plan_id === plan.id) : []
  const weekLetter = (i: number) => String.fromCharCode(65 + i)

  const savePlan = () => {
    if (!name.trim()) return
    const payload = { name: name.trim(), cycle_weeks: cycleWeeks, anchor_date: plan?.anchor_date ?? todayString(), is_active: 1 }
    if (plan) m.patch('workout_plans', plan.id, payload, 'Plan geändert')
    else m.create('workout_plans', payload, 'Plan angelegt')
    if (!plan) onClose()
  }

  return (
    <Modal open title={plan ? 'Trainingsplan' : 'Neuer Trainingsplan'} onClose={onClose}
      footer={<>
        {plan && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Schließen</button>
        <button className="btn btn-primary" onClick={savePlan} disabled={!name.trim()}>Speichern</button>
      </>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Turnfokus" autoFocus /></Field>
      <Field label="Wochen im Rhythmus" hint="2 = A/B, 3 = A/B/C, und so weiter.">
        <Chips options={[1, 2, 3, 4].map((v) => ({ value: v, label: `${v} (${Array.from({ length: v }, (_, i) => weekLetter(i)).join('/')})` }))}
          value={cycleWeeks} onChange={setCycleWeeks} />
      </Field>

      {plan ? (
        <>
          <div className="field-label mt8">Einheiten im Plan</div>
          {planDays.length === 0 && <div className="small muted">Noch keine Einheiten.</div>}
          {planDays.map((d) => (
            <div key={d.id} className="row small" style={{ gap: 8 }}>
              <span className="pill">Woche {weekLetter(d.week_index)}</span>
              <strong>{['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][d.weekday]}</strong>
              <span style={{ flex: 1 }}>{d.title}</span>
              {d.frequency === 'biweekly' && <span className="pill">alle 2 Wochen</span>}
              <button className="btn btn-sm btn-ghost" onClick={() => m.remove('workout_plan_days', d.id, 'Entfernt')}>✕</button>
            </div>
          ))}

          <div className="hint-box mt12">
            <div className="field-label mb8">Einheit hinzufügen</div>
            <div className="row">
              <select className="select" style={{ maxWidth: 110 }} value={newDay.week} onChange={(e) => setNewDay({ ...newDay, week: Number(e.target.value) })}>
                {Array.from({ length: cycleWeeks }, (_, i) => <option key={i} value={i}>Woche {weekLetter(i)}</option>)}
              </select>
              <select className="select" style={{ maxWidth: 130 }} value={newDay.weekday} onChange={(e) => setNewDay({ ...newDay, weekday: Number(e.target.value) })}>
                {['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((d, i) => (
                  <option key={d} value={i + 1}>{d}</option>
                ))}
              </select>
              <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Bezeichnung"
                value={newDay.title} onChange={(e) => setNewDay({ ...newDay, title: e.target.value })} />
            </div>
            <div className="row mt8">
              <Chips options={[{ value: 'every', label: 'jede Woche' }, { value: 'biweekly', label: 'alle 2 Wochen' }]}
                value={newDay.frequency} onChange={(v) => setNewDay({ ...newDay, frequency: v as any })} />
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm btn-primary" disabled={!newDay.title.trim()}
                onClick={() => {
                  m.create('workout_plan_days', {
                    plan_id: plan.id, week_index: newDay.week, weekday: newDay.weekday,
                    frequency: newDay.frequency, title: newDay.title.trim(), focus: null,
                  }, 'Einheit hinzugefügt')
                  setNewDay({ ...newDay, title: '' })
                }}>Hinzufügen</button>
            </div>
          </div>
        </>
      ) : (
        <div className="hint-box">Speichere den Plan zuerst – danach kannst du die einzelnen Einheiten eintragen.</div>
      )}

      <Confirm open={confirmDelete} title="Plan löschen?" message="Erfasste Trainingseinheiten bleiben erhalten." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('workout_plans', plan.id, 'Plan gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

function SessionEditor({ session, onClose }: { session: WorkoutSession | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [day, setDay] = useState(session?.day ?? todayString())
  const [time, setTime] = useState(session?.started_at ?? '')
  const [title, setTitle] = useState(session?.title ?? '')
  const [duration, setDuration] = useState<number | null>(session?.duration_minutes ?? 60)
  const [status, setStatus] = useState(session?.status ?? 'completed')
  const [effort, setEffort] = useState<number | null>(session?.perceived_effort ?? 7)
  const [note, setNote] = useState(session?.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const planTitles = data.workoutPlanDays
    .filter((d) => !d.deleted_at && d.weekday === weekdayIndex(day))
    .map((d) => d.title)
  const suggestions = [...new Set([...planTitles, 'Turntraining', 'Ausdauerlauf', 'HIIT', 'Bauchworkout', 'Krafttraining'])].slice(0, 6)

  const save = () => {
    if (!title.trim()) return
    const payload = {
      day, title: title.trim(), duration_minutes: duration, status,
      perceived_effort: status === 'completed' ? effort : null,
      note: note || null, type: null, plan_day_id: null,
      started_at: time || null, ended_at: null,
    }
    if (session) m.patch('workout_sessions', session.id, payload, 'Einheit geändert')
    else m.create('workout_sessions', payload, 'Einheit erfasst')
    onClose()
  }

  return (
    <Modal open title={session ? 'Trainingseinheit' : 'Neue Trainingseinheit'} onClose={onClose}
      footer={<>
        {session && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Speichern</button>
      </>}>
      <Field label="Status">
        <Chips options={[
          { value: 'completed', label: 'Absolviert' },
          { value: 'planned', label: 'Geplant' },
          { value: 'skipped', label: 'Ausgefallen' },
          { value: 'rest', label: 'Ruhetag' },
        ]} value={status} onChange={(v) => setStatus(v as any)} />
      </Field>

      <div className="grid grid-2 keep2">
        <Field label={status === 'planned' ? 'Geplant für' : 'Datum'}>
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Uhrzeit" hint="grob genügt">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      <Field label="Bezeichnung" hint="Was hast du gemacht?">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="z. B. Turntraining" />
        {suggestions.length > 0 && (
          <div className="chips mt8">
            {suggestions.map((sg) => <button key={sg} className="chip sm" onClick={() => setTitle(sg)}>{sg}</button>)}
          </div>
        )}
      </Field>

      <Field label="Dauer"><DurationInput minutes={duration} onChange={setDuration} /></Field>

      {status === 'completed' && (
        <Field label="Anstrengung (1–10)">
          <Chips options={Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
            value={effort ?? 0} onChange={setEffort} size="sm" />
        </Field>
      )}

      <Field label={status === 'skipped' ? 'Warum ausgefallen?' : 'Notizen'}
        hint={status === 'skipped' ? 'Kurz festhalten, woran es lag.' : 'Grob, was du gemacht hast.'}>
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={status === 'skipped' ? 'z. B. Spätschicht, zu spät nach Hause' : 'z. B. 5×3 Klimmzüge, danach Mobility'} />
      </Field>

      <Confirm open={confirmDelete} title="Einheit löschen?" message="Sie wandert in den Papierkorb." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('workout_sessions', session!.id, 'Einheit gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* ---------------------------------------------------------------- Körper */

const BODY_FIELDS: { key: keyof BodyMeasurement; label: string; unit: string }[] = [
  { key: 'weight_kg', label: 'Gewicht', unit: 'kg' },
  { key: 'waist_cm', label: 'Taille', unit: 'cm' },
  { key: 'chest_cm', label: 'Brust', unit: 'cm' },
  { key: 'upper_arm_cm', label: 'Oberarm', unit: 'cm' },
  { key: 'shoulder_cm', label: 'Schulter', unit: 'cm' },
  { key: 'thigh_cm', label: 'Oberschenkel', unit: 'cm' },
  { key: 'neck_cm', label: 'Nacken', unit: 'cm' },
  { key: 'body_fat_percent', label: 'Körperfett', unit: '%' },
]

function BodyView() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<BodyMeasurement | 'new' | null>(null)

  const list = data.bodyMeasurements.filter((b) => !b.deleted_at)
  const latest = list[0]
  const previous = list[1]

  return (
    <>
      <div className="page-actions mb16">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Messung</button>
      </div>

      {latest && (
        <div className="grid grid-4 keep2 mb16">
          {BODY_FIELDS.filter((f) => latest[f.key] !== null && latest[f.key] !== undefined).slice(0, 4).map((f) => {
            const cur = latest[f.key] as number
            const prev = previous?.[f.key] as number | undefined
            const delta = prev !== undefined && prev !== null ? cur - prev : null
            return (
              <Card key={String(f.key)}>
                <Stat label={f.label} value={`${formatNumber(cur, 1)} ${f.unit}`}
                  delta={delta !== null ? `${delta > 0 ? '+' : ''}${formatNumber(delta, 1)} ${f.unit} seit ${formatDay(previous.day, 'short')}` : undefined}
                  deltaKind={delta === null ? 'neutral' : delta > 0 ? 'up' : 'down'} />
              </Card>
            )
          })}
        </div>
      )}

      <div className="grid grid-2 mb16">
        {BODY_FIELDS.slice(0, 4).map((f) => {
          const points = list.filter((b) => b[f.key] !== null && b[f.key] !== undefined)
            .slice(0, 24).reverse()
            .map((b) => ({ label: formatDay(b.day, 'short'), value: b[f.key] as number }))
          if (points.length < 2) return null
          return (
            <Card key={String(f.key)} title={f.label} sub={`${points.length} Messungen`}>
              <LineChart series={[{ name: f.label, points }]}
                formatValue={(v) => `${formatNumber(v, 1)} ${f.unit}`} showArea={false} />
            </Card>
          )
        })}
      </div>

      <Card title="Alle Messungen" className="pad0">
        {list.length === 0 ? (
          <div style={{ padding: 16 }}><Empty icon="📏" title="Noch keine Messungen" hint="Einmal im Monat reicht – der Verlauf ist wichtiger als der Einzelwert." /></div>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Datum</th>
                  {BODY_FIELDS.map((f) => <th key={String(f.key)} className="num">{f.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} onClick={() => setEditing(b)} style={{ cursor: 'pointer' }}>
                    <td>{formatDay(b.day)}</td>
                    {BODY_FIELDS.map((f) => (
                      <td key={String(f.key)} className="num">
                        {b[f.key] !== null && b[f.key] !== undefined ? formatNumber(b[f.key] as number, 1) : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <BodyEditor measurement={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function BodyEditor({ measurement, onClose }: { measurement: BodyMeasurement | null; onClose: () => void }) {
  const m = useMutations()
  const [day, setDay] = useState(measurement?.day ?? todayString())
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of BODY_FIELDS) {
      const v = measurement?.[f.key]
      out[String(f.key)] = v !== null && v !== undefined ? String(v).replace('.', ',') : ''
    }
    return out
  })
  const [note, setNote] = useState(measurement?.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    const payload: Record<string, any> = { day, note: note || null }
    for (const f of BODY_FIELDS) {
      const raw = values[String(f.key)].replace(',', '.').trim()
      payload[String(f.key)] = raw ? Number(raw) : null
    }
    if (measurement) m.patch('body_measurements', measurement.id, payload, 'Messung geändert')
    else m.create('body_measurements', payload, 'Messung gespeichert')
    onClose()
  }

  return (
    <Modal open title="Körpermessung" onClose={onClose}
      footer={<>
        {measurement && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save}>Speichern</button>
      </>}>
      <Field label="Datum"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      <div className="grid grid-2 keep2">
        {BODY_FIELDS.map((f) => (
          <Field key={String(f.key)} label={`${f.label} (${f.unit})`}>
            <input className="input" inputMode="decimal" value={values[String(f.key)]}
              onChange={(e) => setValues({ ...values, [String(f.key)]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label="Notiz"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Confirm open={confirmDelete} title="Messung löschen?" message="Sie wandert in den Papierkorb." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('body_measurements', measurement!.id, 'Messung gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* ---------------------------------------------------------- Zielbereiche */

function TargetsView() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<Metric | null>(null)
  const today = todayString()

  return (
    <>
      <Card className="mb16" title="Zielbereiche mit Toleranz"
        sub="Ein Zielwert allein ist zu streng. Mit Toleranz gilt: 🟢 im Zielbereich, 🟡 im Toleranzbereich, 🔴 außerhalb.">
        <div className="small muted">Die Werte gelten ab dem Zeitpunkt der Änderung. Frühere Tage bleiben nach den damals gültigen Zielen bewertet.</div>
      </Card>

      <div className="grid grid-2">
        {data.metrics.filter((x) => !x.deleted_at).map((metric) => {
          const target = targetFor(data.metricTargets, metric.id, today)
          const current = dayValue(data.metricEntries, metric, today)
          const zone = evaluateZone(current, target)
          return (
            <Card key={metric.id} title={metric.name}
              sub={GROUP_LABELS[metric.group_key] ?? metric.group_key}
              action={<button className="btn btn-sm" onClick={() => setEditing(metric)}>Bearbeiten</button>}>
              {target ? (
                <>
                  <div className="row">
                    <Stat small label="Ziel" value={target.target_value !== null ? formatMetricValue(metric, target.target_value) : '–'} />
                    <Stat small label="Toleranz" value={`−${formatNumber(target.tolerance_minus ?? 0, metric.decimals)} / +${formatNumber(target.tolerance_plus ?? 0, metric.decimals)}`} />
                  </div>
                  <div className="hint-box mt12">
                    🟢 {formatRange(metric, zone.greenMin ?? 0, zone.greenMax ?? 0)}
                    {(target.hard_min !== null || target.hard_max !== null) && (
                      <> · 🔴 außerhalb {formatRange(metric, target.hard_min ?? 0, target.hard_max ?? 0)}</>
                    )}
                  </div>
                </>
              ) : (
                <div className="small muted">Kein Zielbereich festgelegt.</div>
              )}
            </Card>
          )
        })}
      </div>

      {editing && <TargetEditor metric={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function TargetEditor({ metric, onClose }: { metric: Metric; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const existing = targetFor(data.metricTargets, metric.id, today)
  const [value, setValue] = useState(existing?.target_value !== null && existing?.target_value !== undefined ? String(existing.target_value).replace('.', ',') : '')
  const [minus, setMinus] = useState(existing?.tolerance_minus !== null && existing?.tolerance_minus !== undefined ? String(existing.tolerance_minus).replace('.', ',') : '')
  const [plus, setPlus] = useState(existing?.tolerance_plus !== null && existing?.tolerance_plus !== undefined ? String(existing.tolerance_plus).replace('.', ',') : '')
  const [hardMin, setHardMin] = useState(existing?.hard_min !== null && existing?.hard_min !== undefined ? String(existing.hard_min).replace('.', ',') : '')
  const [hardMax, setHardMax] = useState(existing?.hard_max !== null && existing?.hard_max !== undefined ? String(existing.hard_max).replace('.', ',') : '')

  const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null }

  const save = () => {
    const payload = {
      metric_id: metric.id,
      target_value: num(value), tolerance_minus: num(minus), tolerance_plus: num(plus),
      hard_min: num(hardMin), hard_max: num(hardMax),
      period: 'daily', valid_from: today, valid_to: null,
    }
    if (existing) {
      // Historie bewahren: altes Ziel abschließen, neues ab heute anlegen
      if (existing.valid_from === today) m.patch('metric_targets', existing.id, payload, 'Zielbereich geändert')
      else {
        m.patch('metric_targets', existing.id, { valid_to: addDays(today, -1) })
        m.create('metric_targets', payload, 'Neuer Zielbereich ab heute')
      }
    } else m.create('metric_targets', payload, 'Zielbereich gesetzt')
    onClose()
  }

  const preview = evaluateZone(num(value), {
    ...(existing ?? {} as any),
    target_value: num(value), tolerance_minus: num(minus), tolerance_plus: num(plus),
    hard_min: num(hardMin), hard_max: num(hardMax),
  } as MetricTarget)

  return (
    <Modal open title={`Zielbereich · ${metric.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save}>Speichern</button>
      </>}>
      <Field label={`Zielwert (${metric.unit})`}>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoFocus />
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Toleranz nach unten"><input className="input" value={minus} onChange={(e) => setMinus(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Toleranz nach oben"><input className="input" value={plus} onChange={(e) => setPlus(e.target.value)} inputMode="decimal" /></Field>
      </div>
      <div className="grid grid-2 keep2">
        <Field label="Harte Untergrenze" hint="darunter rot"><input className="input" value={hardMin} onChange={(e) => setHardMin(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Harte Obergrenze" hint="darüber rot"><input className="input" value={hardMax} onChange={(e) => setHardMax(e.target.value)} inputMode="decimal" /></Field>
      </div>
      {preview.greenMin !== null && preview.greenMax !== null && (
        <div className="hint-box">
          🟢 Zielbereich: {formatRange(metric, preview.greenMin, preview.greenMax)}
        </div>
      )}
      {existing && existing.valid_from !== today && (
        <div className="hint-box">
          Der bisherige Zielbereich bleibt für vergangene Tage gültig. Der neue gilt ab heute.
        </div>
      )}
    </Modal>
  )
}
