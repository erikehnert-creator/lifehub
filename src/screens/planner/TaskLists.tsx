/**
 * PLAN · AUFGABEN – Inbox und die vollständige Liste, nach Lage gruppiert.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { todayString, addDays } from '../../core/dates'
import { isOverdue, effectiveShowFrom, toggleTaskPatch, progressPatch } from '../../core/planner'
import type { Task } from '../../core/types'
import { TaskRow } from './TaskRow'
import { TaskEditor } from './TaskEditor'

/* --------------------------------------------------------------- Inbox */

export function InboxView({ openQuickAdd }: { openQuickAdd: (kind?: any) => void }) {
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

export function AllTasksView({ openQuickAdd, nurOffen }: { openQuickAdd: (kind?: any) => void; nurOffen?: boolean }) {
  const data = useData()
  const m = useMutations()
  // "Offen" ist die Liste ohne Erledigte, "Alle" mit. Beides war vorher ein
  // Häkchen mitten in der Leiste.
  const [showDone, setShowDone] = useState(!nurOffen)
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
        <button className="btn btn-primary nur-schreibtisch" onClick={() => openQuickAdd('task')}>+ Aufgabe</button>
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
