/**
 * PLAN – der Rahmen: fünf Reiter und die Adressen dahinter.
 *
 * Aufgaben und Termine sind fachlich dasselbe Problem („was passiert wann")
 * und leben deshalb im selben Bereich. Die Ansichten liegen je in einer
 * eigenen Datei unter `planner/`.
 *
 * Zwei Reiter fassen je zwei frühere zusammen: „Aufgaben" ist Inbox und Alle
 * mit einem Filter davor, „Einrichten" sind Vorlagen und Arbeitsplan. Die
 * alten Adressen bleiben gültig – automatik-e2e öffnet /plan/vorlagen.
 */
import React, { useState } from 'react'
import { Tabs, Segment } from '../ui/components'
import { useData } from '../state/store'
import { CalendarView } from './Calendar'
import { DayView } from './planner/DayView'
import { WeekView } from './planner/WeekView'
import { InboxView, AllTasksView } from './planner/TaskLists'
import { TemplatesView } from './planner/TemplatesView'
import { WorkView } from './planner/WorkView'

export { TaskRow } from './planner/TaskRow'
export { TaskEditor, EventEditor } from './planner/TaskEditor'

export function PlannerScreen({ sub, navigate, openQuickAdd }: {
  sub: string; navigate: (r: string) => void; openQuickAdd: (kind?: any) => void
}) {
  const data = useData()
  const inboxCount = data.tasks.filter((t) => !t.deleted_at && t.bucket === 'inbox' && t.status === 'open').length
  const reiter = sub === 'inbox' || sub === 'alle' ? 'aufgaben'
    : sub === 'vorlagen' || sub === 'arbeit' ? 'einrichten'
    : sub === 'monat' ? 'kalender' : sub
  const tabs = [
    { key: '', label: 'Heute' },
    { key: 'kalender', label: 'Kalender' },
    { key: 'woche', label: 'Woche' },
    { key: 'aufgaben', label: `Aufgaben${inboxCount ? ` (${inboxCount})` : ''}` },
    { key: 'einrichten', label: 'Einrichten' },
  ]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Plan</div>
        </div>
        <div className="page-actions nur-schreibtisch">
          <button className="btn" onClick={() => openQuickAdd('event')}>+ Termin</button>
          <button className="btn btn-primary" onClick={() => openQuickAdd('task')}>+ Aufgabe</button>
        </div>
      </div>
      <Tabs tabs={tabs} active={reiter} onChange={(k) => navigate(`#/plan${k ? '/' + k : ''}`)} />
      {reiter === '' && <DayView openQuickAdd={openQuickAdd} />}
      {reiter === 'kalender' && <CalendarView openQuickAdd={openQuickAdd} />}
      {reiter === 'woche' && <WeekView />}
      {reiter === 'aufgaben' && <AufgabenSeite openQuickAdd={openQuickAdd} startFilter={sub === 'inbox' ? 'inbox' : 'offen'} />}
      {reiter === 'einrichten' && <EinrichtenSeite start={sub === 'arbeit' ? 'arbeit' : 'vorlagen'} />}
    </div>
  )
}

/**
 * Aufgaben – eine Liste mit Filter statt zweier Reiter.
 *
 * "Inbox" (noch nicht eingeplant) und "Alle Aufgaben" waren zwei Ansichten
 * derselben Sache. Der Filter steht jetzt als Segmentschalter darüber.
 */
function AufgabenSeite({ openQuickAdd, startFilter }: {
  openQuickAdd: (kind?: any) => void
  startFilter: 'inbox' | 'offen'
}) {
  const [filter, setFilter] = useState<'inbox' | 'offen' | 'alle'>(startFilter)
  const data = useData()
  const inboxCount = data.tasks.filter((x) => !x.deleted_at && x.bucket === 'inbox' && x.status === 'open').length
  return (
    <div className="stapel">
      <div className="row">
        <Segment label="Aufgaben filtern" value={filter} onChange={setFilter} options={[
          { value: 'inbox', label: `Inbox${inboxCount ? ` (${inboxCount})` : ''}` },
          { value: 'offen', label: 'Offen' },
          { value: 'alle', label: 'Alle' },
        ]} />
      </div>
      {filter === 'inbox'
        ? <InboxView openQuickAdd={openQuickAdd} />
        : <AllTasksView key={filter} openQuickAdd={openQuickAdd} nurOffen={filter === 'offen'} />}
    </div>
  )
}

/** Vorlagen und Arbeitsplan richten beide den Plan ein – eine Seite, zwei Teile. */
function EinrichtenSeite({ start }: { start: 'vorlagen' | 'arbeit' }) {
  const [teil, setTeil] = useState<'vorlagen' | 'arbeit'>(start)
  return (
    <div className="stapel">
      <div className="row">
        <Segment label="Einrichten" value={teil} onChange={setTeil} options={[
          { value: 'vorlagen', label: 'Vorlagen' },
          { value: 'arbeit', label: 'Arbeitsplan' },
        ]} />
      </div>
      {teil === 'vorlagen' ? <TemplatesView /> : <WorkView />}
    </div>
  )
}
