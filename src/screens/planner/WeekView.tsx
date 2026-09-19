/**
 * PLAN · WOCHE – sieben Tage nebeneinander.
 */
import React, { useState } from 'react'
import { Card } from '../../ui/components'
import { Icon } from '../../ui/icons'
import { useData, useMutations } from '../../state/store'
import {
  todayString, formatDay, formatDuration, addDays, startOfWeek, endOfWeek,
  weekdayShort, isoWeekNumber, daysInRange,
} from '../../core/dates'
import { toggleTaskPatch } from '../../core/planner'
import type { Task } from '../../core/types'
import { TaskEditor } from './TaskEditor'

/* -------------------------------------------------------------- Woche */

export function WeekView() {
  const data = useData()
  const m = useMutations()
  const [anchor, setAnchor] = useState(todayString())
  const [editing, setEditing] = useState<Task | null>(null)
  const start = startOfWeek(anchor)
  const days = daysInRange(start, endOfWeek(anchor))

  return (
    <>
      <div className="row mb16">
        <button className="btn btn-sm" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Vorwoche">
          <Icon name="zurueck" size={16} /></button>
        <strong style={{ minWidth: 190, textAlign: 'center' }}>KW {isoWeekNumber(start)} · {formatDay(start, 'short')}–{formatDay(days[6], 'short')}</strong>
        <button className="btn btn-sm" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Folgewoche">
          <Icon name="pfeil-rechts" size={16} /></button>
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
