/**
 * Die kurze Vorschau hinter einem Antippen.
 *
 * Auf der Heute-Seite steht je Aufgabe und Termin nur eine Zeile. Das ist
 * richtig so – eine Übersicht, die alles zeigt, zeigt nichts. Die Beschreibung,
 * die Frist, der Ort: Das ist genau das, was in dieser Zeile keinen Platz hat
 * und wofür man bisher auf eine andere Seite wechseln musste.
 *
 * Deshalb hier ein Zwischenschritt zwischen Zeile und Editor: antippen, alles
 * Wichtige lesen, schließen. Wer wirklich etwas ändern will, kommt mit einem
 * weiteren Tipp in den vollen Editor – aber niemand muss den Editor öffnen,
 * nur um nachzulesen, was er sich notiert hatte.
 *
 * Aufgabe und Termin verhalten sich bewusst gleich: gleicher Aufbau, gleiche
 * Knöpfe an derselben Stelle. Auf dem Handy ist das der Unterschied zwischen
 * „ich weiß, wo ich hindrücken muss" und „ich probiere es jedes Mal neu".
 */
import React from 'react'
import { Modal, StatusPill } from './components'
import { formatDay, formatDuration, relativeDay, todayString, weekdayLong } from '../core/dates'
import { dringlichkeit, taskArt } from '../core/planner'
import type { CalendarEvent, Task } from '../core/types'

/* -------------------------------------------------------------- Bausteine */

/** Eine Zeile „Bezeichnung – Wert". Ohne Wert erscheint sie gar nicht. */
function Zeile({ label, children }: { label: string; children?: React.ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) return null
  return (
    <div className="detail-zeile">
      <span className="detail-label">{label}</span>
      <span className="detail-wert">{children}</span>
    </div>
  )
}

function Beschreibung({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className="detail-text">{text}</div>
  )
}

const PRIO_TEXT: Record<number, string> = { 0: 'keine', 1: 'niedrig', 2: 'normal', 3: 'hoch' }

const ART_TEXT: Record<string, string> = {
  fest: 'fester Termin am Tag',
  tagesplan: 'Tagesplan – wandert mit, bis sie erledigt ist',
  frist: 'Aufgabe mit Frist',
  irgendwann: 'ohne festen Tag',
}

const STATUS_TEXT: Record<string, string> = {
  open: 'offen',
  in_progress: 'in Arbeit',
  done: 'erledigt',
  cancelled: 'abgebrochen',
}

/* ---------------------------------------------------------------- Aufgabe */

export function TaskDetail({ task, onClose, onEdit, onToggle, today = todayString() }: {
  task: Task
  onClose: () => void
  onEdit: () => void
  onToggle?: () => void
  today?: string
}) {
  const d = dringlichkeit(task, today)
  const art = taskArt(task)
  const erledigt = task.status === 'done'

  return (
    <Modal open title={task.title} onClose={onClose}
      footer={<>
        {onToggle && (
          <button className="btn" onClick={() => { onToggle(); onClose() }}>
            {erledigt ? '↩ Wieder öffnen' : '✓ Erledigt'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Schließen</button>
        <button className="btn btn-primary" onClick={onEdit}>Bearbeiten</button>
      </>}>
      <div className="detail">
        <Beschreibung text={task.description} />
        {task.note && task.note !== task.description && <Beschreibung text={task.note} />}

        <Zeile label="Status">
          {STATUS_TEXT[task.status] ?? task.status}
          {d.label && !erledigt && <> · <StatusPill status={d.status === 'neutral' ? 'green' : d.status}>{d.label}</StatusPill></>}
        </Zeile>
        <Zeile label="Geplant">
          {task.scheduled_on
            ? <>{weekdayLong(task.scheduled_on)}, {formatDay(task.scheduled_on)}
                {task.scheduled_end_on && task.scheduled_end_on !== task.scheduled_on
                  ? ` bis ${formatDay(task.scheduled_end_on)}` : ''}
                {' '}<span className="muted">({relativeDay(task.scheduled_on, today)})</span></>
            : null}
        </Zeile>
        <Zeile label="Uhrzeit">{task.scheduled_time}</Zeile>
        <Zeile label="Frist">
          {task.due_on
            ? <>{formatDay(task.due_on)}{task.due_time ? ` um ${task.due_time}` : ''}</>
            : null}
        </Zeile>
        <Zeile label="Dauer">{task.duration_minutes ? formatDuration(task.duration_minutes) : null}</Zeile>
        <Zeile label="Priorität">{task.priority ? PRIO_TEXT[task.priority] ?? String(task.priority) : null}</Zeile>
        <Zeile label="Kategorie">{task.category}</Zeile>
        <Zeile label="Fortschritt">
          {task.progress_total && task.progress_total > 1
            ? `${task.progress_done ?? 0} von ${task.progress_total} Teilen`
            : null}
        </Zeile>
        <Zeile label="Art">{ART_TEXT[art]}</Zeile>
        <Zeile label="Verschoben">
          {task.carried_count
            ? `${task.carried_count}× · ursprünglich ${task.carried_from ? formatDay(task.carried_from) : 'früher'}`
            : null}
        </Zeile>
        <Zeile label="Herkunft">{task.template_id ? 'automatisch aus einer Aufgabenvorlage' : null}</Zeile>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- Termin */

export function TerminDetail({ event, onClose, onEdit, today = todayString() }: {
  event: CalendarEvent
  onClose: () => void
  onEdit: () => void
  today?: string
}) {
  const zeit = event.all_day
    ? 'ganztägig'
    : event.start_time
      ? `${event.start_time}${event.end_time ? ` – ${event.end_time}` : ''}`
      : null

  return (
    <Modal open title={event.title} onClose={onClose}
      footer={<>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Schließen</button>
        <button className="btn btn-primary" onClick={onEdit}>Bearbeiten</button>
      </>}>
      <div className="detail">
        <Beschreibung text={event.description} />

        <Zeile label="Wann">
          {weekdayLong(event.day)}, {formatDay(event.day)}
          {event.end_day && event.end_day !== event.day ? ` bis ${formatDay(event.end_day)}` : ''}
          {' '}<span className="muted">({relativeDay(event.day, today)})</span>
        </Zeile>
        <Zeile label="Uhrzeit">{zeit}</Zeile>
        <Zeile label="Ort">{event.location}</Zeile>
        <Zeile label="Erinnerung">
          {event.reminder_minutes ? `${event.reminder_minutes} Minuten vorher` : null}
        </Zeile>
        <Zeile label="Wiederholung">{event.rrule ? 'wiederkehrender Termin' : null}</Zeile>
        <Zeile label="Herkunft">{event.source && event.source !== 'local' ? event.source : null}</Zeile>
      </div>
    </Modal>
  )
}
