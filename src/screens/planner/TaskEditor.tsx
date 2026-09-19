/**
 * PLAN · AUFGABEN-EDITOR – die Art bestimmt, wie sich eine Aufgabe über die
 * Zeit verhält. Der Termin-Editor lebt im Kalender.
 */
import React, { useState } from 'react'
import { Modal, Field, Chips, Confirm, DurationInput } from '../../ui/components'
import { useMutations } from '../../state/store'
import { todayString, formatDay, diffDays } from '../../core/dates'
import { taskArt, defaultShowFrom, type TaskArt } from '../../core/planner'
import type { Task, CalendarEvent } from '../../core/types'
import { TerminEditor } from '../Calendar'

const PRIORITIES = [
  { value: 0, label: 'keine' },
  { value: 1, label: 'niedrig' },
  { value: 2, label: 'normal' },
  { value: 3, label: 'hoch' },
]

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
