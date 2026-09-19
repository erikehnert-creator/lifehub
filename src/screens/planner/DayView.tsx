/**
 * PLAN · TAGESANSICHT – Tagesplan, freie Fenster, Aufgaben des Tages.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty } from '../../ui/components'
import { Icon, BEREICH_FARBE } from '../../ui/icons'
import { useData, useMutations } from '../../state/store'
import { todayString, formatDay, formatDuration, addDays, timeToMinutes, minutesToTime } from '../../core/dates'
import {
  tasksForDay, computeCapacity, freeSlots, suggestTasksForDay, wakingWindow,
  toggleTaskPatch, progressPatch,
} from '../../core/planner'
import type { Task, CalendarEvent, DayType } from '../../core/types'
import { TaskRow } from './TaskRow'
import { TaskEditor, EventEditor } from './TaskEditor'

export function DayView({ openQuickAdd }: { openQuickAdd: (kind?: any) => void }) {
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
      <div className="row mb16 tag-leiste">
        <button className="btn btn-sm" onClick={() => setDay(addDays(day, -1))} aria-label="Vortag">
          <Icon name="zurueck" size={16} />
        </button>
        <strong style={{ minWidth: 170, textAlign: 'center' }}>{formatDay(day, 'long')}</strong>
        <button className="btn btn-sm" onClick={() => setDay(addDays(day, 1))} aria-label="Folgetag">
          <Icon name="pfeil-rechts" size={16} />
        </button>
        {day !== todayString() && <button className="btn btn-sm btn-ghost" onClick={() => setDay(todayString())}>Heute</button>}
        <span style={{ flex: 1 }} />
        <DayTypePicker day={day} />
      </div>

      {/* Tagesplan und freie Fenster in einer Karte: Die freien Fenster sind die
          Kehrseite des Plans und standen vorher als eigene Karte daneben. */}
      <Card className="mb16" title="Tagesplan" icon="kalender" farbe={BEREICH_FARBE.plan}
        sub={`${formatDuration(capacity.plannedMinutes)} verplant · ${formatDuration(capacity.freeMinutes)} frei`}>
        <Timeline day={day} dayType={dayType} assignment={assignment} events={events} blocks={blocks}
          onEditEvent={setEditingEvent} />
        <div className="freie-fenster">
          {slots.length === 0
            ? <span className="small muted">Der Tag ist voll.</span>
            : slots.map((s, i) => (
              <span key={i} className="fenster">
                {s.start}–{s.end} <span className="muted">{formatDuration(s.minutes)}</span>
              </span>
            ))}
        </div>
        {slots.length > 0 && (
          <SuggestionBox tasks={data.tasks} minutes={Math.max(...slots.map((s) => s.minutes))} day={day} />
        )}
      </Card>

      <Card title="Aufgaben" icon="aufgaben" farbe={BEREICH_FARBE.plan}
        sub={tasks.length ? `${open.length} von ${tasks.length} offen` : undefined}
        action={<button className="btn btn-sm btn-ghost" onClick={() => openQuickAdd('task')} aria-label="Aufgabe hinzufügen"><Icon name="plus" size={16} /></button>}
        className="pad0">
        {tasks.length === 0 ? (
          <div style={{ padding: '0 16px 16px' }}><Empty kompakt title="Für diesen Tag ist nichts geplant." /></div>
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

  if (!items.length) {
    return <Empty kompakt title="Keine festen Termine." hint="Der ganze Tag steht dir zur Verfügung." />
  }

  // Gezeigt wird der belegte Zeitraum plus eine Stunde Luft, nicht 08:00–24:00.
  // Für eine einzelne Spätschicht standen vorher 16 leere Stunden auf dem Bild.
  const fensterStart = timeToMinutes(win.start)
  const fensterEnde = win.end === '24:00' ? 1440 : timeToMinutes(win.end)
  const startM = Math.max(fensterStart, Math.floor((Math.min(...items.map((i) => i.start)) - 60) / 60) * 60)
  const endM = Math.min(fensterEnde, Math.ceil((Math.max(...items.map((i) => i.end)) + 60) / 60) * 60)
  const span = Math.max(60, endM - startM)

  const hours: number[] = []
  for (let h = Math.floor(startM / 60); h <= Math.ceil(endM / 60); h++) hours.push(h)

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

export function DayTypePicker({ day }: { day: string }) {
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
