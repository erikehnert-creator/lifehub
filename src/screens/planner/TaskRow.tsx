/**
 * Eine Aufgabenzeile – an mehreren Stellen dieselbe, deshalb hier allein.
 */
import React from 'react'
import { Icon } from '../../ui/icons'
import { formatDay, formatDuration, relativeDay } from '../../core/dates'
import { taskArt, dringlichkeit } from '../../core/planner'
import type { Task } from '../../core/types'

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
          {art === 'fest' && <span className="fest-marke" title="Fester Termin"><Icon name="kalender" size={13} /></span>}
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
