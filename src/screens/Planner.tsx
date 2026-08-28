/**
 * PLANER – Heute, Woche, Monat, Inbox, Kalender, Arbeitsplan.
 * Aufgaben und Termine sind fachlich dasselbe Problem („was passiert wann")
 * und leben deshalb im selben Bereich.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Tabs, Empty, Confirm, DurationInput } from '../ui/components'
import { useData, useMutations } from '../state/store'
import { CalendarView, TerminEditor } from './Calendar'
import {
  todayString, formatDay, formatDuration, addDays, startOfWeek, endOfWeek,
  weekdayShort, weekdayLong, isoWeekNumber, daysInRange, monthOf, formatMonth,
  addMonthsToYearMonth, monthStart, monthEnd, relativeDay, weekdayIndex, timeToMinutes, minutesToTime,
  diffDays,
} from '../core/dates'
import {
  tasksForDay, computeCapacity, isOverdue, freeSlots, suggestTasksForDay, wakingWindow,
  planTasksFromTemplates, taskArt, defaultShowFrom, dringlichkeit, effectiveShowFrom,
  toggleTaskPatch, progressPatch,
  type TaskArt,
} from '../core/planner'
import type { Task, CalendarEvent, DayType } from '../core/types'

const PRIORITIES = [
  { value: 0, label: 'keine' },
  { value: 1, label: 'niedrig' },
  { value: 2, label: 'normal' },
  { value: 3, label: 'hoch' },
]

const BUCKETS: { value: Task['bucket']; label: string }[] = [
  { value: 'inbox', label: '📥 Inbox' },
  { value: 'today', label: 'Heute' },
  { value: 'week', label: 'Diese Woche' },
  { value: 'month', label: 'Dieser Monat' },
  { value: 'someday', label: 'Irgendwann' },
]

export function PlannerScreen({ sub, navigate, openQuickAdd }: {
  sub: string; navigate: (r: string) => void; openQuickAdd: (kind?: any) => void
}) {
  const data = useData()
  const inboxCount = data.tasks.filter((t) => !t.deleted_at && t.bucket === 'inbox' && t.status === 'open').length
  const tabs = [
    { key: '', label: 'Heute' },
    { key: 'kalender', label: 'Kalender' },
    { key: 'woche', label: 'Woche' },
    { key: 'inbox', label: `Inbox${inboxCount ? ` (${inboxCount})` : ''}` },
    { key: 'alle', label: 'Alle Aufgaben' },
    { key: 'arbeit', label: 'Arbeitsplan' },
    { key: 'vorlagen', label: 'Vorlagen' },
  ]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Planer</div>
          <div className="page-sub">Aufgaben, Termine und Tagesplanung</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => openQuickAdd('event')}>+ Termin</button>
          <button className="btn btn-primary" onClick={() => openQuickAdd('task')}>+ Aufgabe</button>
        </div>
      </div>
      <Tabs tabs={tabs} active={sub} onChange={(k) => navigate(`#/plan${k ? '/' + k : ''}`)} />
      {sub === '' && <DayView openQuickAdd={openQuickAdd} />}
      {sub === 'kalender' && <CalendarView openQuickAdd={openQuickAdd} />}
      {sub === 'woche' && <WeekView />}
      {/* Alte Adresse: der Monat lebt jetzt im Kalender weiter. */}
      {sub === 'monat' && <CalendarView openQuickAdd={openQuickAdd} />}
      {sub === 'inbox' && <InboxView openQuickAdd={openQuickAdd} />}
      {sub === 'alle' && <AllTasksView openQuickAdd={openQuickAdd} />}
      {sub === 'arbeit' && <WorkView />}
      {sub === 'vorlagen' && <TemplatesView />}
    </div>
  )
}

/* ------------------------------------------------------------ Tagesansicht */

function DayView({ openQuickAdd }: { openQuickAdd: (kind?: any) => void }) {
  const data = useData()
  const m = useMutations()
  const [day, setDay] = useState(todayString())
  const [editing, setEditing] = useState<Task | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)

  const assignment = data.dayAssignments.find((a) => !a.deleted_at && a.day === day) ?? null
  const dayType = assignment ? data.dayTypes.find((t) => t.id === assignment.day_type_id) ?? null : null
  const tasks = useMemo(() => tasksForDay(data.tasks, day), [data.tasks, day])
  const events = data.events.filter((e) => !e.deleted_at && e.day === day)
  const blocks = data.timeBlocks.filter((b) => !b.deleted_at && b.day === day)
  const capacity = useMemo(
    () => computeCapacity(day, assignment, dayType, data.timeBlocks, data.tasks, data.events, data.settings.sleep_hours ?? 8),
    [day, assignment, dayType, data.timeBlocks, data.tasks, data.events, data.settings],
  )

  const busy = [
    ...(dayType?.default_start && dayType?.default_end && (dayType.kind === 'work' || dayType.kind === 'school')
      ? [{ start: assignment?.start_override ?? dayType.default_start, end: assignment?.end_override ?? dayType.default_end }] : []),
    ...events.filter((e) => e.start_time && e.end_time).map((e) => ({ start: e.start_time!, end: e.end_time! })),
    ...blocks.map((b) => ({ start: b.start_time, end: b.end_time })),
  ]
  const slots = freeSlots(day, busy, wakingWindow(data.settings.sleep_hours ?? 8))
  const open = tasks.filter((t) => t.status !== 'done')
  const doneList = tasks.filter((t) => t.status === 'done')

  const toggle = (t: Task) => m.patch('tasks', t.id, toggleTaskPatch(t), t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt')

  return (
    <>
      <div className="row mb16">
        <button className="btn btn-sm" onClick={() => setDay(addDays(day, -1))}>←</button>
        <strong style={{ minWidth: 210, textAlign: 'center' }}>{formatDay(day, 'long')}</strong>
        <button className="btn btn-sm" onClick={() => setDay(addDays(day, 1))}>→</button>
        {day !== todayString() && <button className="btn btn-sm btn-ghost" onClick={() => setDay(todayString())}>Heute</button>}
        <span style={{ flex: 1 }} />
        <DayTypePicker day={day} />
      </div>

      <div className="grid grid-2 mb16">
        <Card title="Tagesplan" sub={`${formatDuration(capacity.plannedMinutes)} verplant · ${formatDuration(capacity.freeMinutes)} frei`}>
          <Timeline day={day} dayType={dayType} assignment={assignment} events={events} blocks={blocks}
            onEditEvent={setEditingEvent} />
        </Card>
        <Card title="Freie Zeitfenster" sub="Was heute realistisch noch hineinpasst">
          {slots.length === 0 ? (
            <Empty icon="⏳" title="Der Tag ist voll" />
          ) : (
            <div className="list">
              {slots.map((s, i) => (
                <div className="list-row" key={i} style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <span className="list-main">
                    <span className="list-title">{s.start} – {s.end}</span>
                    <span className="list-sub">{formatDuration(s.minutes)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {slots.length > 0 && (
            <SuggestionBox tasks={data.tasks} minutes={Math.max(...slots.map((s) => s.minutes))} day={day} />
          )}
        </Card>
      </div>

      <Card title={`Aufgaben (${open.length} offen)`}
        action={<button className="btn btn-sm" onClick={() => openQuickAdd('task')}>+</button>} className="pad0">
        {tasks.length === 0 ? (
          <div style={{ padding: 16 }}><Empty icon="✅" title="Nichts geplant" hint="Ein freier Tag – oder du planst noch etwas ein." /></div>
        ) : (
          <div className="list">
            {[...open, ...doneList].map((t) => (
              <TaskRow key={t.id} task={t} onToggle={() => toggle(t)}
                onProgress={(d) => m.patch('tasks', t.id, progressPatch(t, d))}
                onOpen={() => setEditing(t)} showDate={t.scheduled_on !== day} />
            ))}
          </div>
        )}
      </Card>

      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
      {editingEvent && <EventEditor event={editingEvent} onClose={() => setEditingEvent(null)} />}
    </>
  )
}

function SuggestionBox({ tasks, minutes, day }: { tasks: Task[]; minutes: number; day: string }) {
  const m = useMutations()
  const candidates = useMemo(
    () => suggestTasksForDay(tasks.filter((t) => !t.scheduled_on || t.scheduled_on > day), minutes).slice(0, 4),
    [tasks, minutes, day],
  )
  if (!candidates.length) return null
  return (
    <div className="hint-box mt12">
      <div className="mb8"><strong>Passt in {formatDuration(minutes)}:</strong></div>
      <div className="chips">
        {candidates.map((t) => (
          <button key={t.id} className="chip sm"
            onClick={() => m.patch('tasks', t.id, { scheduled_on: day, bucket: 'scheduled' }, 'Eingeplant')}>
            + {t.title} {t.duration_minutes ? `(${t.duration_minutes} min)` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

function Timeline({ day, dayType, assignment, events, blocks, onEditEvent }: {
  day: string; dayType: DayType | null; assignment: any
  events: CalendarEvent[]; blocks: any[]; onEditEvent: (e: CalendarEvent) => void
}) {
  const data = useData()
  const win = wakingWindow(data.settings.sleep_hours ?? 8)
  const startM = timeToMinutes(win.start)
  const endM = win.end === '24:00' ? 1440 : timeToMinutes(win.end)
  const span = Math.max(1, endM - startM)

  const items: { start: number; end: number; title: string; color: string; onClick?: () => void }[] = []
  if (dayType && (dayType.kind === 'work' || dayType.kind === 'school')) {
    const s = assignment?.start_override ?? dayType.default_start
    const e = assignment?.end_override ?? dayType.default_end
    if (s && e) items.push({ start: timeToMinutes(s), end: timeToMinutes(e), title: dayType.name, color: dayType.color ?? 'var(--series-1)' })
  }
  for (const e of events) {
    if (e.all_day || !e.start_time) continue
    items.push({
      start: timeToMinutes(e.start_time),
      end: timeToMinutes(e.end_time ?? e.start_time) || timeToMinutes(e.start_time) + 60,
      title: e.title, color: e.color ?? 'var(--series-7)', onClick: () => onEditEvent(e),
    })
  }
  for (const b of blocks) {
    items.push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time), title: b.title, color: b.color ?? 'var(--series-3)' })
  }

  const hours: number[] = []
  for (let h = Math.floor(startM / 60); h <= Math.ceil(endM / 60); h++) hours.push(h)

  if (!items.length) {
    return <Empty icon="🗓️" title="Keine festen Termine" hint="Der ganze Tag steht dir zur Verfügung." />
  }

  return (
    <div style={{ position: 'relative', height: 240, borderLeft: '1px solid var(--border)', marginLeft: 42 }}>
      {hours.map((h) => {
        const top = ((h * 60 - startM) / span) * 240
        if (top < 0 || top > 240) return null
        return (
          <div key={h} style={{ position: 'absolute', top, left: -42, right: 0, height: 1, background: 'var(--grid)' }}>
            <span style={{ position: 'absolute', left: 0, top: -7, fontSize: 10.5, color: 'var(--text-muted)' }}>{String(h).padStart(2, '0')}:00</span>
          </div>
        )
      })}
      {items.map((it, i) => {
        const top = Math.max(0, ((it.start - startM) / span) * 240)
        const height = Math.max(15, ((it.end - it.start) / span) * 240 - 2)
        return (
          <div key={i} onClick={it.onClick}
            style={{
              position: 'absolute', top, left: 6, right: 4, height,
              background: it.color, opacity: .92, borderRadius: 7, padding: '3px 8px',
              color: '#fff', fontSize: 12, fontWeight: 600, overflow: 'hidden',
              cursor: it.onClick ? 'pointer' : 'default',
            }}>
            {it.title}
            <span style={{ opacity: .85, fontWeight: 400 }}> · {minutesToTime(it.start)}–{minutesToTime(it.end)}</span>
          </div>
        )
      })}
    </div>
  )
}

function DayTypePicker({ day }: { day: string }) {
  const data = useData()
  const m = useMutations()
  const assignment = data.dayAssignments.find((a) => !a.deleted_at && a.day === day)
  const current = assignment ? data.dayTypes.find((t) => t.id === assignment.day_type_id) : null

  return (
    <select className="select" style={{ width: 'auto' }} value={current?.id ?? ''}
      onChange={(e) => {
        const id = e.target.value
        if (!id) { if (assignment) m.remove('day_assignments', assignment.id, 'Tagesart entfernt'); return }
        if (assignment) m.patch('day_assignments', assignment.id, { day_type_id: id }, 'Tagesart geändert')
        else m.create('day_assignments', { day, day_type_id: id }, 'Tagesart gesetzt')
      }}>
      <option value="">Tagesart wählen…</option>
      {data.dayTypes.filter((t) => !t.deleted_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  )
}

/* ---------------------------------------------------------- Aufgabenzeile */

/**
 * Eine Aufgabenzeile.
 *
 * Die Dringlichkeit steht als farbiger Streifen links und als Fähnchen im
 * Untertitel. Sie wächst von allein, je näher die Frist rückt – man muss also
 * nichts umstellen, damit eine Aufgabe irgendwann laut wird.
 */
export function TaskRow({ task, onToggle, onProgress, onOpen, showDate }: {
  task: Task; onToggle: () => void; onProgress?: (delta: 1 | -1) => void; onOpen: () => void; showDate?: boolean
}) {
  const d = dringlichkeit(task)
  const erledigt = task.status === 'done'
  const art = taskArt(task)
  const hatTeile = !!task.progress_total && task.progress_total > 1
  return (
    <div className={`list-row aufgabe ${erledigt ? 'done' : ''} dringlich-${erledigt ? 'neutral' : d.status}`}>
      {hatTeile && onProgress ? (
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-sm btn-ghost" type="button" disabled={(task.progress_done ?? 0) <= 0}
            onClick={() => onProgress(-1)} aria-label="Ein Teil weniger fertig">−</button>
          <span className="mono small" style={{ minWidth: 34, textAlign: 'center' }}>
            {task.progress_done ?? 0}/{task.progress_total}
          </span>
          <button className="btn btn-sm btn-ghost" type="button" disabled={(task.progress_done ?? 0) >= (task.progress_total ?? 0)}
            onClick={() => onProgress(1)} aria-label="Ein Teil mehr fertig">+</button>
        </div>
      ) : (
        <button className={`checkbox ${erledigt ? 'checked' : ''}`} onClick={onToggle} aria-label="Erledigt">✓</button>
      )}
      <button className="list-main" style={{ textAlign: 'left' }} onClick={onOpen}>
        <span className="list-title">
          {art === 'fest' && <span title="Fester Termin" style={{ marginRight: 5 }}>📌</span>}
          {task.title}
        </span>
        <span className="list-sub">
          {task.priority >= 3 && <span className="pill crit" style={{ marginRight: 6 }}>wichtig</span>}
          {!erledigt && d.level >= 2 && (
            <span className={`pill ${d.status === 'red' ? 'crit' : 'warn'}`} style={{ marginRight: 6 }}>{d.label}</span>
          )}
          {!erledigt && d.level === 1 && task.due_on && (
            <span className="muted" style={{ marginRight: 6 }}>bis {formatDay(task.due_on, 'short')} · {d.label}</span>
          )}
          {task.carried_count > 0 && !erledigt && (
            <span className="pill" style={{ marginRight: 6 }} title="So oft schon verschoben">↻ {task.carried_count}×</span>
          )}
          {task.duration_minutes ? `${formatDuration(task.duration_minutes)} · ` : ''}
          {task.scheduled_time ? `${task.scheduled_time} · ` : ''}
          {showDate && task.scheduled_on ? relativeDay(task.scheduled_on) : ''}
          {task.description ? ` ${task.description.slice(0, 60)}` : ''}
        </span>
      </button>
    </div>
  )
}

/* -------------------------------------------------------------- Woche */

function WeekView() {
  const data = useData()
  const m = useMutations()
  const [anchor, setAnchor] = useState(todayString())
  const [editing, setEditing] = useState<Task | null>(null)
  const start = startOfWeek(anchor)
  const days = daysInRange(start, endOfWeek(anchor))

  return (
    <>
      <div className="row mb16">
        <button className="btn btn-sm" onClick={() => setAnchor(addDays(anchor, -7))}>←</button>
        <strong style={{ minWidth: 190, textAlign: 'center' }}>KW {isoWeekNumber(start)} · {formatDay(start, 'short')}–{formatDay(days[6], 'short')}</strong>
        <button className="btn btn-sm" onClick={() => setAnchor(addDays(anchor, 7))}>→</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setAnchor(todayString())}>Diese Woche</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {days.map((d) => {
          const assignment = data.dayAssignments.find((a) => !a.deleted_at && a.day === d)
          const dt = assignment ? data.dayTypes.find((t) => t.id === assignment.day_type_id) : null
          const tasks = data.tasks.filter((t) => !t.deleted_at && t.scheduled_on === d)
          const events = data.events.filter((e) => !e.deleted_at && e.day === d)
          const isToday = d === todayString()
          const holiday = data.holidays.find((h: any) => !h.deleted_at && h.day === d)
          const load = tasks.filter((t) => t.status !== 'done').reduce((s, t) => s + (t.duration_minutes ?? 0), 0)
          return (
            <Card key={d} className={isToday ? '' : ''}
              title={<span style={{ color: isToday ? 'var(--accent)' : undefined }}>{weekdayShort(d)} {formatDay(d, 'short')}</span>}
              sub={<>{dt && <span className="pill" style={{ background: dt.color ?? undefined, color: '#fff' }}>{dt.short_code}</span>}{holiday && <span className="pill good" style={{ marginLeft: 4 }}>{holiday.name}</span>}{load > 0 && <span className="muted"> · {formatDuration(load)}</span>}</>}>
              {events.map((e) => (
                <div key={e.id} className="small" style={{ marginBottom: 4 }}>
                  <span className="dot" style={{ background: e.color ?? 'var(--series-7)', display: 'inline-block', marginRight: 6 }} />
                  {e.all_day ? '' : `${e.start_time} `}{e.title}
                </div>
              ))}
              {tasks.length === 0 && events.length === 0 && <div className="small muted">frei</div>}
              {tasks.map((t) => (
                <div key={t.id} className="row small" style={{ gap: 6, marginTop: 3 }}>
                  <button className={`checkbox ${t.status === 'done' ? 'checked' : ''}`} style={{ width: 17, height: 17, fontSize: 11 }}
                    onClick={() => m.patch('tasks', t.id, toggleTaskPatch(t))}>✓</button>
                  <button onClick={() => setEditing(t)} style={{ textAlign: 'left', flex: 1, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--text-muted)' : undefined }}>
                    {t.title}
                  </button>
                </div>
              ))}
            </Card>
          )
        })}
      </div>
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/* --------------------------------------------------------------- Monat */

function MonthView() {
  const data = useData()
  const [month, setMonth] = useState(monthOf(todayString()))
  const [selected, setSelected] = useState<string | null>(null)

  const first = monthStart(month)
  const gridStart = startOfWeek(first)
  const gridEnd = endOfWeek(monthEnd(month))
  const days = daysInRange(gridStart, gridEnd)

  return (
    <>
      <div className="row mb16">
        <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, -1))}>←</button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{formatMonth(month)}</strong>
        <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, 1))}>→</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setMonth(monthOf(todayString()))}>Heute</button>
      </div>
      <Card className="pad0">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {['Mo','Di','Mi','Do','Fr','Sa','So'].map((d) => (
            <div key={d} style={{ padding: '9px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>{d}</div>
          ))}
          {days.map((d) => {
            const inMonth = monthOf(d) === month
            const isToday = d === todayString()
            const assignment = data.dayAssignments.find((a) => !a.deleted_at && a.day === d)
            const dt = assignment ? data.dayTypes.find((t) => t.id === assignment.day_type_id) : null
            const tasks = data.tasks.filter((t) => !t.deleted_at && t.scheduled_on === d && t.status !== 'done')
            const events = data.events.filter((e) => !e.deleted_at && e.day === d)
            const holiday = data.holidays.find((h: any) => !h.deleted_at && h.day === d)
            return (
              <button key={d} onClick={() => setSelected(d)}
                style={{
                  minHeight: 88, padding: 6, textAlign: 'left', borderRight: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)', opacity: inMonth ? 1 : .38,
                  background: isToday ? 'var(--accent-soft)' : undefined,
                }}>
                <div className="row" style={{ gap: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: isToday ? 700 : 550, color: isToday ? 'var(--accent)' : undefined }}>{Number(d.slice(8, 10))}</span>
                  {dt && <span className="pill" style={{ background: dt.color ?? undefined, color: '#fff', fontSize: 10 }}>{dt.short_code}</span>}
                </div>
                {holiday && <div className="small" style={{ color: 'var(--good-text)', fontSize: 10.5 }}>{holiday.name}</div>}
                {events.slice(0, 2).map((e) => (
                  <div key={e.id} style={{ fontSize: 10.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {e.title}</div>
                ))}
                {tasks.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{tasks.length} Aufgabe{tasks.length > 1 ? 'n' : ''}</div>}
              </button>
            )
          })}
        </div>
      </Card>
      {selected && <DayDetailModal day={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function DayDetailModal({ day, onClose }: { day: string; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const tasks = data.tasks.filter((t) => !t.deleted_at && t.scheduled_on === day)
  const events = data.events.filter((e) => !e.deleted_at && e.day === day)
  return (
    <Modal open title={formatDay(day, 'long')} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Schließen</button>}>
      <DayTypePicker day={day} />
      {events.length > 0 && (
        <div>
          <div className="field-label mb8">Termine</div>
          {events.map((e) => (
            <div key={e.id} className="list-row" style={{ padding: '6px 0' }}>
              <span className="dot" style={{ background: e.color ?? 'var(--series-7)' }} />
              <span className="list-main"><span className="list-title">{e.title}</span>
                <span className="list-sub">{e.all_day ? 'ganztägig' : `${e.start_time}–${e.end_time ?? ''}`}{e.location ? ` · ${e.location}` : ''}</span></span>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="field-label mb8">Aufgaben</div>
        {tasks.length === 0 ? <div className="small muted">keine</div> : tasks.map((t) => (
          <div key={t.id} className="list-row" style={{ padding: '6px 0' }}>
            <button className={`checkbox ${t.status === 'done' ? 'checked' : ''}`}
              onClick={() => m.patch('tasks', t.id, toggleTaskPatch(t))}>✓</button>
            <span className="list-main"><span className="list-title">{t.title}</span></span>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- Inbox */

function InboxView({ openQuickAdd }: { openQuickAdd: (kind?: any) => void }) {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<Task | null>(null)
  const today = todayString()
  const inbox = data.tasks.filter((t) => !t.deleted_at && t.bucket === 'inbox' && t.status !== 'done')

  const moveTo = (t: Task, bucket: Task['bucket'], day: string | null) =>
    m.patch('tasks', t.id, { bucket, scheduled_on: day }, 'Verschoben')

  return (
    <>
      <Card className="mb16" title="Inbox" sub="Alles, was noch kein Datum hat. Schnell erfassen, später einsortieren.">
        <div className="small muted">{inbox.length} offene Einträge</div>
      </Card>
      {inbox.length === 0 ? (
        <Empty icon="📥" title="Inbox ist leer"
          hint="Wenn dir unterwegs etwas einfällt, erfasse es hier ohne Datum."
          action={<button className="btn btn-primary" onClick={() => openQuickAdd('task')}>+ Aufgabe</button>} />
      ) : (
        <Card className="pad0">
          <div className="list">
            {inbox.map((t) => (
              <div className="list-row" key={t.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <button className="checkbox" onClick={() => m.patch('tasks', t.id, { status: 'done', completed_at: new Date().toISOString() }, 'Erledigt')}>✓</button>
                <button className="list-main" style={{ textAlign: 'left' }} onClick={() => setEditing(t)}>
                  <span className="list-title">{t.title}</span>
                  {t.description && <span className="list-sub">{t.description}</span>}
                </button>
                <div className="chips">
                  <button className="chip sm" onClick={() => moveTo(t, 'today', today)}>Heute</button>
                  <button className="chip sm" onClick={() => moveTo(t, 'today', addDays(today, 1))}>Morgen</button>
                  <button className="chip sm" onClick={() => moveTo(t, 'week', null)}>Diese Woche</button>
                  <button className="chip sm" onClick={() => moveTo(t, 'someday', null)}>Irgendwann</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/* --------------------------------------------------------- Alle Aufgaben */

function AllTasksView({ openQuickAdd }: { openQuickAdd: (kind?: any) => void }) {
  const data = useData()
  const m = useMutations()
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)

  const tasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.tasks.filter((t) => {
      if (t.deleted_at) return false
      if (!showDone && t.status === 'done') return false
      if (q && !`${t.title} ${t.description ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.tasks, showDone, query])

  const heute = todayString()
  // Aufgaben mit weiter Frist tauchen in der Tagesliste bewusst nicht auf.
  // Verschwunden sind sie deshalb nicht – hier stehen sie, mit dem Datum,
  // ab dem sie sich melden.
  const ruht = (t: Task) => {
    if (t.status === 'done' || t.scheduled_on || !t.due_on) return false
    const ab = effectiveShowFrom(t)
    return !!ab && ab > heute
  }
  const offen = tasks.filter((t) => t.status !== 'done')
  const groups: { label: string; sub?: string; items: Task[] }[] = [
    { label: 'Überfällig', items: offen.filter((t) => isOverdue(t)) },
    { label: 'Heute', items: offen.filter((t) => t.scheduled_on === heute && !isOverdue(t)) },
    { label: 'Läuft an', sub: 'Frist rückt näher',
      items: offen.filter((t) => !t.scheduled_on && t.due_on && !isOverdue(t) && !ruht(t)) },
    { label: 'Geplant', items: offen.filter((t) => t.scheduled_on && t.scheduled_on > heute) },
    { label: 'Ruht noch', sub: 'meldet sich rechtzeitig von allein', items: offen.filter(ruht) },
    { label: 'Ohne Datum', items: offen.filter((t) => !t.scheduled_on && !t.due_on) },
    ...(showDone ? [{ label: 'Erledigt', items: tasks.filter((t) => t.status === 'done') }] : []),
  ].filter((g) => g.items.length > 0)

  return (
    <>
      <div className="row mb16">
        <input className="input" style={{ flex: 1 }} placeholder="Aufgaben durchsuchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={`chip ${showDone ? 'active' : ''}`} onClick={() => setShowDone(!showDone)}>Erledigte zeigen</button>
        <button className="btn btn-primary" onClick={() => openQuickAdd('task')}>+ Aufgabe</button>
      </div>
      {groups.length === 0 ? (
        <Empty icon="✅" title="Keine Aufgaben" />
      ) : groups.map((g) => (
        <Card key={g.label} title={`${g.label} (${g.items.length})`} sub={g.sub} className="pad0 mb16">
          <div className="list">
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} showDate
                onToggle={() => m.patch('tasks', t.id, toggleTaskPatch(t), t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt')}
                onProgress={(d) => m.patch('tasks', t.id, progressPatch(t, d))}
                onOpen={() => setEditing(t)} />
            ))}
          </div>
        </Card>
      ))}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/* --------------------------------------------------------- Arbeitsplan */

function WorkView() {
  const data = useData()
  const m = useMutations()
  const [month, setMonth] = useState(monthOf(todayString()))
  const [editMode, setEditMode] = useState(false)
  const [brush, setBrush] = useState<string | null>(null)          // gewählte Tagesart ("Pinsel")
  const [pending, setPending] = useState<Record<string, string | null>>({})
  const [editingType, setEditingType] = useState<DayType | 'new' | null>(null)

  const dayTypes = data.dayTypes.filter((t) => !t.deleted_at)
  const typeById = useMemo(() => new Map(dayTypes.map((t) => [t.id, t])), [dayTypes])

  // Kalendergitter: volle Wochen von Montag bis Sonntag
  const gridStart = startOfWeek(monthStart(month))
  const gridEnd = endOfWeek(monthEnd(month))
  const days = daysInRange(gridStart, gridEnd)

  const assignedId = (day: string): string | null => {
    if (day in pending) return pending[day]
    const a = data.dayAssignments.find((x) => !x.deleted_at && x.day === day)
    return a ? a.day_type_id : null
  }

  const paint = (day: string) => {
    if (!editMode || !brush) return
    setPending((p) => ({ ...p, [day]: brush === '__clear' ? null : brush }))
  }

  const save = () => {
    let n = 0
    for (const [day, typeId] of Object.entries(pending)) {
      const existing = data.dayAssignments.find((x) => !x.deleted_at && x.day === day)
      if (typeId === null) {
        if (existing) { m.remove('day_assignments', existing.id); n++ }
      } else if (existing) {
        if (existing.day_type_id !== typeId) { m.patch('day_assignments', existing.id, { day_type_id: typeId }); n++ }
      } else {
        m.create('day_assignments', { day, day_type_id: typeId }); n++
      }
    }
    setPending({})
    setEditMode(false)
    setBrush(null)
    m.toast(n ? `${n} Tage gespeichert` : 'Nichts geändert')
  }

  const monthDays = days.filter((d) => monthOf(d) === month)
  const stats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of monthDays) {
      const id = assignedId(d)
      const name = id ? typeById.get(id)?.name ?? '?' : 'ohne Angabe'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [monthDays, data.dayAssignments, pending, typeById])

  const pendingCount = Object.keys(pending).length

  return (
    <>
      <Card className="mb16" title={`Arbeitsplan · ${formatMonth(month)}`}
        sub={editMode
          ? 'Tagesart oben wählen, dann die Tage antippen. Zum Schluss speichern.'
          : 'Der Plan ist gegen versehentliches Verstellen geschützt. Zum Ändern auf „Bearbeiten" tippen.'}
        action={
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, -1))}>←</button>
            <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, 1))}>→</button>
            {!editMode
              ? <button className="btn btn-sm btn-primary" onClick={() => setEditMode(true)}>Bearbeiten</button>
              : <>
                  <button className="btn btn-sm" onClick={() => { setPending({}); setEditMode(false); setBrush(null) }}>Abbrechen</button>
                  <button className="btn btn-sm btn-primary" onClick={save}>
                    Speichern{pendingCount ? ` (${pendingCount})` : ''}
                  </button>
                </>}
          </div>
        }>

        {editMode && (
          <div className="chips mb16">
            {dayTypes.map((t) => (
              <button key={t.id} className={`chip ${brush === t.id ? 'active' : ''}`}
                onClick={() => setBrush(brush === t.id ? null : t.id)}>
                <span className="dot" style={{ background: t.color ?? 'var(--surface-3)' }} />
                {t.name}
              </button>
            ))}
            <button className={`chip ${brush === '__clear' ? 'active' : ''}`}
              onClick={() => setBrush(brush === '__clear' ? null : '__clear')}>🧽 Eintrag entfernen</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, maxWidth: 560 }}>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', paddingBottom: 4 }}>{d}</div>
          ))}
          {days.map((d) => {
            const inMonth = monthOf(d) === month
            const isToday = d === todayString()
            const id = assignedId(d)
            const t = id ? typeById.get(id) : null
            const changed = d in pending
            const holiday = data.holidays.find((h: any) => !h.deleted_at && h.day === d)
            return (
              <button key={d} onClick={() => paint(d)}
                disabled={!editMode || !brush}
                title={holiday ? holiday.name : formatDay(d)}
                style={{
                  aspectRatio: '1', borderRadius: 8, padding: 2,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: t?.color ?? 'var(--surface-2)',
                  color: t ? '#fff' : 'var(--text-muted)',
                  opacity: inMonth ? 1 : 0.32,
                  outline: changed ? '2px solid var(--accent)' : isToday ? '2px solid var(--text)' : 'none',
                  outlineOffset: -2,
                  cursor: editMode && brush ? 'pointer' : 'default',
                }}>
                <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 600 }}>{Number(d.slice(8, 10))}</span>
                {t && <span style={{ fontSize: 9, fontWeight: 700 }}>{t.short_code}</span>}
                {!t && holiday && <span style={{ fontSize: 8 }}>F</span>}
              </button>
            )
          })}
        </div>

        <div className="legend">
          {stats.map(([name, n]) => (
            <span className="legend-item" key={name}>
              <span className="legend-swatch" style={{ background: dayTypes.find((t) => t.name === name)?.color ?? 'var(--surface-3)' }} />
              {name}: <strong>{n}</strong>
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Tagesarten" sub="Schichten, Schule, Urlaub – frei anpassbar"
          action={<button className="btn btn-sm" onClick={() => setEditingType('new')}>+ Neu</button>}>
          <div className="list">
            {dayTypes.map((t) => (
              <button className="list-row" key={t.id} onClick={() => setEditingType(t)} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="dot" style={{ background: t.color ?? 'var(--surface-3)' }} />
                <span className="list-main">
                  <span className="list-title">{t.name} <span className="muted">({t.short_code})</span></span>
                  <span className="list-sub">
                    {t.default_start && t.default_end ? `${t.default_start}–${t.default_end}` : 'ohne feste Zeiten'}
                    {t.break_minutes ? ` · ${t.break_minutes} min Pause` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Schnell eintragen" sub="Ganze Zeiträume auf einmal setzen – etwa eine Berufsschulwoche.">
          <BulkAssign />
        </Card>
      </div>

      {editingType && <DayTypeEditor dayType={editingType === 'new' ? null : editingType} onClose={() => setEditingType(null)} />}
    </>
  )
}

function BulkAssign() {
  const data = useData()
  const m = useMutations()
  const [from, setFrom] = useState(monthStart(monthOf(todayString())))
  const [to, setTo] = useState(monthEnd(monthOf(todayString())))
  const [typeId, setTypeId] = useState('')
  const [skipWeekend, setSkipWeekend] = useState(true)

  const apply = () => {
    if (!typeId) return
    let n = 0
    for (const d of daysInRange(from, to)) {
      if (skipWeekend && weekdayIndex(d) >= 6) continue
      const existing = data.dayAssignments.find((a) => !a.deleted_at && a.day === d)
      if (existing) m.patch('day_assignments', existing.id, { day_type_id: typeId })
      else m.create('day_assignments', { day: d, day_type_id: typeId })
      n++
    }
    m.toast(`${n} Tage gesetzt`)
  }

  return (
    <>
      <div className="grid grid-2 keep2">
        <Field label="Von"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Bis"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Tagesart">
        <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">wählen…</option>
          {data.dayTypes.filter((t) => !t.deleted_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <label className="row small mt8">
        <input type="checkbox" checked={skipWeekend} onChange={(e) => setSkipWeekend(e.target.checked)} /> Wochenenden auslassen
      </label>
      <button className="btn btn-primary mt12" onClick={apply} disabled={!typeId}>Eintragen</button>
    </>
  )
}

function DayTypeEditor({ dayType, onClose }: { dayType: DayType | null; onClose: () => void }) {
  const m = useMutations()
  const data = useData()
  const [name, setName] = useState(dayType?.name ?? '')
  const [code, setCode] = useState(dayType?.short_code ?? '')
  const [kind, setKind] = useState(dayType?.kind ?? 'work')
  const [start, setStart] = useState(dayType?.default_start ?? '')
  const [end, setEnd] = useState(dayType?.default_end ?? '')
  const [breakMin, setBreakMin] = useState(dayType?.break_minutes ?? 0)
  const [color, setColor] = useState(dayType?.color ?? 'var(--series-1)')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    if (!name.trim() || !code.trim()) return
    const payload = {
      name: name.trim(), short_code: code.trim(), kind,
      default_start: start || null, default_end: end || null,
      break_minutes: breakMin, color,
      counts_as_workday: kind === 'work' || kind === 'school' ? 1 : 0,
      sort_order: dayType?.sort_order ?? data.dayTypes.length,
    }
    if (dayType) m.patch('day_types', dayType.id, payload, 'Tagesart geändert')
    else m.create('day_types', payload, 'Tagesart angelegt')
    onClose()
  }

  return (
    <Modal open title={dayType ? 'Tagesart bearbeiten' : 'Neue Tagesart'} onClose={onClose}
      footer={<>
        {dayType && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save}>Speichern</button>
      </>}>
      <div className="grid grid-2 keep2">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Kürzel"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} /></Field>
      </div>
      <Field label="Art">
        <Chips options={[
          { value: 'work', label: 'Arbeit' }, { value: 'school', label: 'Schule' },
          { value: 'vacation', label: 'Urlaub' }, { value: 'off', label: 'Frei' },
          { value: 'sick', label: 'Krank' },
        ]} value={kind} onChange={(v) => setKind(v as any)} />
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Beginn"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ende"><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Pause (Minuten)"><input className="input" type="number" value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} /></Field>
      <Field label="Farbe">
        <div className="chips">
          {[1,2,3,4,5,6,7,8].map((i) => (
            <button key={i} type="button" onClick={() => setColor(`var(--series-${i})`)}
              style={{ width: 26, height: 26, borderRadius: 8, background: `var(--series-${i})`,
                outline: color === `var(--series-${i})` ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </Field>
      <Confirm open={confirmDelete} title="Tagesart löschen?" message="Bereits zugeordnete Tage verlieren ihre Zuordnung." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('day_types', dayType!.id, 'Tagesart gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* ------------------------------------------------------------- Vorlagen */

function TemplatesView() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<any | 'new' | null>(null)
  const today = todayString()

  const templates = data.taskTemplates.filter((t: any) => !t.deleted_at)
  const typeById = new Map(data.dayTypes.map((t) => [t.id, t]))
  const WEEK = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

  const preview = useMemo(
    () => planTasksFromTemplates(
      templates as any,
      data.dayAssignments.filter((a) => !a.deleted_at).map((a) => ({ day: a.day, day_type_id: a.day_type_id })),
      data.tasks.filter((t) => !t.deleted_at) as any,
      today, addDays(today, 27),
    ),
    [templates, data.dayAssignments, data.tasks, today],
  )

  const generate = () => {
    let n = 0
    for (const p of preview) {
      m.create('tasks', {
        title: p.title, description: p.description, status: 'open', bucket: 'scheduled',
        scheduled_on: p.day, duration_minutes: p.duration_minutes, priority: p.priority,
        template_id: p.templateId, sort_order: 0,
      })
      n++
    }
    m.toast(n ? `${n} Aufgaben eingeplant` : 'Nichts Neues einzuplanen')
  }

  return (
    <>
      <Card className="mb16" title="Aufgabenvorlagen"
        sub={'Wiederkehrende Aufgaben, die an deinen Plan gekoppelt sind – etwa „immer dienstags, wenn Spätschicht ist: Auto putzen“.'}
        action={<button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>+ Vorlage</button>}>
        <div className="row">
          <Stat small label="Vorlagen" value={String(templates.length)} />
          <Stat small label="Einplanbar (4 Wochen)" value={String(preview.length)} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={!preview.length} onClick={generate}>
            {preview.length ? `${preview.length} Aufgaben einplanen` : 'Alles eingeplant'}
          </button>
        </div>
      </Card>

      {templates.length === 0 ? (
        <Empty icon="🔁" title="Noch keine Vorlagen"
          hint="Eine Vorlage merkt sich, was an bestimmten Tagen ansteht, und plant es für dich vor."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Erste Vorlage</button>} />
      ) : (
        <Card className="pad0 mb16">
          <div className="list">
            {templates.map((t: any) => (
              <button className="list-row" key={t.id} onClick={() => setEditing(t)}>
                <span className="avatar">🔁</span>
                <span className="list-main">
                  <span className="list-title">{t.title}</span>
                  <span className="list-sub">
                    {t.weekday ? `jeden ${WEEK[t.weekday]}` : 'jeden Tag'}
                    {t.interval_weeks > 1 ? ` (alle ${t.interval_weeks} Wochen)` : ''}
                    {t.day_type_id ? ` · nur bei ${typeById.get(t.day_type_id)?.name ?? '?'}` : ''}
                    {t.duration_minutes ? ` · ${formatDuration(t.duration_minutes)}` : ''}
                    {!t.is_active ? ' · pausiert' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {preview.length > 0 && (
        <Card title="Nächste Termine dieser Vorlagen" sub="Vorschau der nächsten vier Wochen">
          <div className="list">
            {preview.slice(0, 20).map((p, i) => (
              <div className="list-row" key={i} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="list-main">
                  <span className="list-title">{p.title}</span>
                  <span className="list-sub">{weekdayShort(p.day)} {formatDay(p.day)}</span>
                </span>
                {p.duration_minutes && <span className="list-amount">{formatDuration(p.duration_minutes)}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function TemplateEditor({ template, onClose }: { template: any | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [title, setTitle] = useState(template?.title ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [duration, setDuration] = useState<number | null>(template?.duration_minutes ?? null)
  const [priority, setPriority] = useState(template?.priority ?? 2)
  const [weekday, setWeekday] = useState<number>(template?.weekday ?? 0)
  const [dayTypeId, setDayTypeId] = useState(template?.day_type_id ?? '')
  const [intervalWeeks, setIntervalWeeks] = useState(template?.interval_weeks ?? 1)
  const [active, setActive] = useState(template ? !!template.is_active : true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    if (!title.trim()) return
    const payload = {
      title: title.trim(), description: description || null,
      duration_minutes: duration, priority,
      weekday: weekday || null, day_type_id: dayTypeId || null,
      interval_weeks: intervalWeeks, anchor_date: template?.anchor_date ?? todayString(),
      is_active: active ? 1 : 0, last_generated_on: null,
    }
    if (template) m.patch('task_templates', template.id, payload, 'Vorlage geändert')
    else m.create('task_templates', payload, 'Vorlage angelegt')
    onClose()
  }

  return (
    <Modal open title={template ? 'Vorlage bearbeiten' : 'Neue Vorlage'} onClose={onClose}
      footer={<>
        {template && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Speichern</button>
      </>}>
      <Field label="Aufgabe"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Auto putzen" autoFocus /></Field>
      <Field label="Wochentag">
        <select className="select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          <option value={0}>jeden Tag</option>
          {['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((d, i) => (
            <option key={d} value={i + 1}>jeden {d}</option>
          ))}
        </select>
      </Field>
      <Field label="Nur an diesen Tagen" hint="So entsteht die Aufgabe nur, wenn der Tag auch wirklich passt.">
        <select className="select" value={dayTypeId} onChange={(e) => setDayTypeId(e.target.value)}>
          <option value="">unabhängig von der Tagesart</option>
          {data.dayTypes.filter((t) => !t.deleted_at).map((t) => <option key={t.id} value={t.id}>nur bei {t.name}</option>)}
        </select>
      </Field>
      <Field label="Rhythmus">
        <Chips options={[
          { value: 1, label: 'jede Woche' }, { value: 2, label: 'alle 2 Wochen' },
          { value: 3, label: 'alle 3 Wochen' }, { value: 4, label: 'alle 4 Wochen' },
        ]} value={intervalWeeks} onChange={setIntervalWeeks} />
      </Field>
      <Field label="Dauer"><DurationInput minutes={duration} onChange={setDuration} /></Field>
      <Field label="Priorität">
        <Chips options={[{ value: 1, label: 'Niedrig' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Hoch' }]}
          value={priority} onChange={setPriority} />
      </Field>
      <Field label="Beschreibung"><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label className="row small"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktiv</label>
      <Confirm open={confirmDelete} title="Vorlage löschen?" message="Bereits eingeplante Aufgaben bleiben bestehen." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('task_templates', template.id, 'Vorlage gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* -------------------------------------------------------- Aufgaben-Editor */

export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const m = useMutations()
  const heute = todayString()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [art, setArt] = useState<TaskArt>(taskArt(task))
  const [scheduledOn, setScheduledOn] = useState(task.scheduled_on ?? heute)
  const [scheduledTime, setScheduledTime] = useState(task.scheduled_time ?? '')
  const [scheduledEndOn, setScheduledEndOn] = useState(task.scheduled_end_on ?? '')
  const [dueOn, setDueOn] = useState(task.due_on ?? '')
  const [showFrom, setShowFrom] = useState(task.show_from ?? '')
  const [eigenerAnlauf, setEigenerAnlauf] = useState(!!task.show_from)
  const [duration, setDuration] = useState(task.duration_minutes ?? 0)
  const [priority, setPriority] = useState(task.priority)
  const [hatTeile, setHatTeile] = useState(!!task.progress_total)
  const [teileGesamt, setTeileGesamt] = useState(task.progress_total ?? 2)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Wann die Aufgabe auftaucht, wenn man nichts eigenes einträgt
  const anlaufVorschlag = dueOn ? defaultShowFrom(dueOn, heute) : ''
  const anlauf = eigenerAnlauf && showFrom ? showFrom : anlaufVorschlag

  const save = () => {
    if (!title.trim()) return
    const gemeinsam = {
      title: title.trim(), description: description || null,
      duration_minutes: duration || null, priority,
      progress_total: hatTeile ? teileGesamt : null,
      progress_done: hatTeile ? Math.min(task.progress_done ?? 0, teileGesamt) : null,
    }
    const endeGuard = (start: string) => scheduledEndOn && scheduledEndOn > start ? scheduledEndOn : null
    let spezifisch: Record<string, any>
    if (art === 'fest') {
      const start = scheduledOn || heute
      spezifisch = {
        scheduled_on: start, scheduled_time: scheduledTime || null, scheduled_end_on: endeGuard(start),
        due_on: null, show_from: null, pinned_day: 1, bucket: 'scheduled',
      }
    } else if (art === 'tagesplan') {
      const start = scheduledOn || heute
      spezifisch = {
        scheduled_on: start, scheduled_time: scheduledTime || null, scheduled_end_on: endeGuard(start),
        due_on: dueOn || null, show_from: null, pinned_day: 0,
        bucket: start === heute ? 'today' : 'scheduled',
      }
    } else if (art === 'frist') {
      spezifisch = {
        scheduled_on: null, scheduled_time: null, scheduled_end_on: null,
        due_on: dueOn || null,
        show_from: eigenerAnlauf ? (showFrom || null) : null,
        pinned_day: 0, bucket: 'scheduled',
      }
    } else {
      spezifisch = {
        scheduled_on: null, scheduled_time: null, scheduled_end_on: null, due_on: null,
        show_from: null, pinned_day: 0, bucket: 'someday',
      }
    }
    m.patch('tasks', task.id, { ...gemeinsam, ...spezifisch }, 'Aufgabe geändert')
    onClose()
  }

  const erklaerung = art === 'fest'
    ? 'Bleibt an ihrem Tag stehen. Wird sie nicht erledigt, wandert sie nicht mit – ein Termin von gestern gehört nicht in den heutigen Plan.'
    : art === 'tagesplan'
      ? 'Steht heute im Plan. Was am Abend offen ist, nimmt die App am nächsten Morgen mit.'
      : art === 'frist'
        ? (dueOn
            ? `Liegt bis dahin ruhig und meldet sich ab ${formatDay(anlauf)} – ${Math.max(0, diffDays(anlauf, dueOn))} Tage vor der Frist. Je näher der Termin, desto deutlicher wird sie angezeigt.`
            : 'Trag eine Frist ein. Die Aufgabe taucht dann nicht täglich auf, sondern erst, wenn es Zeit wird.')
        : 'Wartet ohne Datum, bis du sie einplanst. Sie taucht in keiner Tagesliste auf.'

  return (
    <Modal open title="Aufgabe" onClose={onClose}
      footer={<>
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Speichern</button>
      </>}>
      <Field label="Titel"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>

      {/* Die Art bestimmt, wie sich die Aufgabe über die Zeit verhält. */}
      <Field label="Wie hängt sie am Kalender?">
        <Chips value={art} onChange={(v) => setArt(v as TaskArt)} options={[
          { value: 'tagesplan', label: '📋 Tagesaufgabe' },
          { value: 'fest', label: '📌 Fester Termin' },
          { value: 'frist', label: '⏳ Mit Frist' },
          { value: 'irgendwann', label: '💭 Irgendwann' },
        ]} />
        <div className="hint-box mt8 small">{erklaerung}</div>
      </Field>

      {(art === 'fest' || art === 'tagesplan') && (
        <>
          <div className="grid grid-2 keep2">
            <Field label={art === 'fest' ? 'Am' : 'Geplant für'}>
              <input className="input" type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
            </Field>
            <Field label="Uhrzeit" hint="freiwillig">
              <input className="input" type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Bis" hint="leer lassen für eine eintägige Aufgabe">
            <input className="input" type="date" value={scheduledEndOn} min={scheduledOn}
              onChange={(e) => setScheduledEndOn(e.target.value)} />
          </Field>
        </>
      )}

      {(art === 'frist' || art === 'tagesplan') && (
        <Field label={art === 'frist' ? 'Muss erledigt sein bis' : 'Frist (freiwillig)'}>
          <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </Field>
      )}

      {art === 'frist' && dueOn && (
        <Field label="Wann soll sie sich melden?">
          <Chips size="sm" value={eigenerAnlauf ? 'eigen' : 'auto'}
            onChange={(v) => {
              setEigenerAnlauf(v === 'eigen')
              if (v === 'eigen' && !showFrom) setShowFrom(anlaufVorschlag)
            }}
            options={[
              { value: 'auto', label: `Automatisch (ab ${formatDay(anlaufVorschlag, 'short')})` },
              { value: 'eigen', label: 'Selbst festlegen' },
            ]} />
          {eigenerAnlauf && (
            <input className="input mt8" type="date" value={showFrom} max={dueOn}
              onChange={(e) => setShowFrom(e.target.value)} />
          )}
        </Field>
      )}

      <Field label="Beschreibung"><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Dauer" hint="Frei eintragen – damit die App realistische Tagespläne bauen kann.">
        <DurationInput minutes={duration || null} onChange={(v) => setDuration(v ?? 0)} />
      </Field>
      <Field label="Priorität">
        <Chips options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} value={priority} onChange={setPriority} />
      </Field>
      <label className="row small">
        <input type="checkbox" checked={hatTeile} onChange={(e) => setHatTeile(e.target.checked)} />
        Aufgabe besteht aus mehreren Teilen
      </label>
      {hatTeile && (
        <Field label="Teile insgesamt" hint={`Bisheriger Fortschritt: ${task.progress_done ?? 0}`}>
          <input className="input" type="number" min={2} style={{ maxWidth: 100 }}
            value={teileGesamt} onChange={(e) => setTeileGesamt(Math.max(2, Number(e.target.value) || 2))} />
        </Field>
      )}

      {task.carried_count > 0 && (
        <div className="hint-box warn small">
          Diese Aufgabe wurde schon {task.carried_count}× auf den nächsten Tag geschoben
          {task.carried_from && ` – ursprünglich war sie für den ${formatDay(task.carried_from)} geplant`}.
          Vielleicht ist sie zu groß für einen Rutsch, oder sie steht in Wahrheit gar nicht an.
        </div>
      )}

      <Confirm open={confirmDelete} title="Aufgabe löschen?" message="Sie wandert in den Papierkorb." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('tasks', task.id, 'Aufgabe gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/** Der Termin-Editor lebt jetzt im Kalender – hier bleibt nur der Name. */
export function EventEditor({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  return <TerminEditor event={event} onClose={onClose} />
}
