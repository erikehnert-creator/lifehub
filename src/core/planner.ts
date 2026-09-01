/**
 * Tagesplanung: Kapazität, Zeitblöcke, Auswahl der heutigen Aufgaben.
 */
import type { Task, TimeBlock, DayType, DayAssignment, CalendarEvent, TaskTemplate } from './types'
import {
  type DayString, timeToMinutes, minutesToTime, todayString, addDays, startOfWeek,
  daysInRange, diffDays, weekdayIndex,
} from './dates'

export interface DayCapacity {
  day: DayString
  dayTypeName: string | null
  dayTypeKind: string | null
  workMinutes: number
  plannedMinutes: number
  taskMinutes: number
  freeMinutes: number
  wakingMinutes: number
}

/**
 * Wie viel Zeit ein Tag überhaupt hergibt.
 * Statt "der Tag geht von 7 bis 22 Uhr" wird nur die geplante Schlafdauer
 * angegeben – das ist die Zahl, die man wirklich kennt. Alles andere ergibt
 * sich: 24 Stunden minus Schlaf.
 */
export function wakingMinutesFor(sleepHours: number): number {
  const sleep = Math.min(14, Math.max(0, sleepHours))
  return Math.round((24 - sleep) * 60)
}

export function computeCapacity(
  day: DayString,
  assignment: DayAssignment | null,
  dayType: DayType | null,
  blocks: TimeBlock[],
  tasks: Task[],
  events: CalendarEvent[],
  sleepHours = 8,
): DayCapacity {
  const wakingMinutes = wakingMinutesFor(sleepHours)

  let workMinutes = 0
  if (dayType && (dayType.kind === 'work' || dayType.kind === 'school')) {
    const start = assignment?.start_override ?? dayType.default_start
    const end = assignment?.end_override ?? dayType.default_end
    if (start && end) workMinutes = Math.max(0, timeToMinutes(end) - timeToMinutes(start))
  }

  let blockMinutes = 0
  for (const b of blocks) {
    if (b.deleted_at || b.day !== day) continue
    if (b.kind === 'work' || b.kind === 'school') continue // schon in workMinutes enthalten
    blockMinutes += Math.max(0, timeToMinutes(b.end_time) - timeToMinutes(b.start_time))
  }

  let eventMinutes = 0
  for (const e of events) {
    if (e.deleted_at || e.day !== day || e.all_day) continue
    if (e.start_time && e.end_time) {
      eventMinutes += Math.max(0, timeToMinutes(e.end_time) - timeToMinutes(e.start_time))
    }
  }

  let taskMinutes = 0
  for (const t of tasks) {
    if (t.deleted_at || t.status === 'done' || t.status === 'cancelled') continue
    if (t.scheduled_on !== day) continue
    taskMinutes += t.duration_minutes ?? 0
  }

  const plannedMinutes = workMinutes + blockMinutes + eventMinutes
  return {
    day,
    dayTypeName: dayType?.name ?? null,
    dayTypeKind: dayType?.kind ?? null,
    workMinutes,
    plannedMinutes,
    taskMinutes,
    freeMinutes: Math.max(0, wakingMinutes - plannedMinutes - taskMinutes),
    wakingMinutes,
  }
}

/** Freie Zeitfenster eines Tages – für "was passt heute noch rein?". */
/**
 * Freie Zeitfenster eines Tages. Der wache Zeitraum wird symmetrisch um die
 * Nacht gelegt: bei 8 Stunden Schlaf also 08:00–24:00.
 */
export function wakingWindow(sleepHours: number): { start: string; end: string } {
  const sleep = Math.min(14, Math.max(0, sleepHours))
  const start = Math.round(sleep * 60)           // Aufstehen nach dem Schlaf ab Mitternacht
  return { start: minutesToTime(start), end: '24:00' }
}

export function freeSlots(
  day: DayString,
  busy: { start: string; end: string }[],
  waking: { start: string; end: string } = { start: '08:00', end: '24:00' },
): { start: string; end: string; minutes: number }[] {
  const dayStart = timeToMinutes(waking.start)
  const dayEnd = waking.end === '24:00' ? 1440 : timeToMinutes(waking.end)
  const intervals = busy
    .map((b) => ({ s: timeToMinutes(b.start), e: timeToMinutes(b.end) }))
    .filter((b) => b.e > dayStart && b.s < dayEnd)
    .sort((a, b) => a.s - b.s)

  const merged: { s: number; e: number }[] = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e)
    else merged.push({ ...iv })
  }

  const out: { start: string; end: string; minutes: number }[] = []
  let cursor = dayStart
  for (const m of merged) {
    if (m.s > cursor) out.push({ start: minutesToTime(cursor), end: minutesToTime(m.s), minutes: m.s - cursor })
    cursor = Math.max(cursor, m.e)
  }
  if (cursor < dayEnd) out.push({ start: minutesToTime(cursor), end: minutesToTime(dayEnd), minutes: dayEnd - cursor })
  return out.filter((s) => s.minutes >= 10)
}

/**
 * Wählt aus offenen Aufgaben eine realistische Tagesliste, die in die freie
 * Zeit passt. Priorität zuerst, dann kurze Aufgaben – so bleibt die Liste
 * erfüllbar statt frustrierend.
 */
export function suggestTasksForDay(tasks: Task[], availableMinutes: number): Task[] {
  const candidates = tasks
    .filter((t) => !t.deleted_at && (t.status === 'open' || t.status === 'in_progress'))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return (a.duration_minutes ?? 30) - (b.duration_minutes ?? 30)
    })
  const out: Task[] = []
  let used = 0
  for (const t of candidates) {
    const d = t.duration_minutes ?? 30
    if (used + d > availableMinutes) continue
    out.push(t)
    used += d
  }
  return out
}

/* ------------------------------------------------- Aufgabenarten und Fristen
 *
 * Es gibt drei Arten, wie eine Aufgabe an einem Tag hängt – man muss sie
 * beim Anlegen aber nicht auswählen, sie ergeben sich aus dem, was man
 * ausgefüllt hat:
 *
 *   fest        „Freitag 14 Uhr Zahnarzt"      – bleibt an ihrem Tag stehen
 *   Tagesplan   „heute Zimmer aufräumen"       – wandert mit, bis sie erledigt ist
 *   Frist       „bis 31.12. Steuer abgeben"    – taucht erst auf, wenn es Zeit wird
 *   irgendwann  ohne Tag und ohne Frist        – wartet in der Inbox
 */
export type TaskArt = 'fest' | 'tagesplan' | 'frist' | 'irgendwann'

export function taskArt(t: Pick<Task, 'pinned_day' | 'scheduled_on' | 'due_on'>): TaskArt {
  if (t.scheduled_on && t.pinned_day) return 'fest'
  if (t.scheduled_on) return 'tagesplan'
  if (t.due_on) return 'frist'
  return 'irgendwann'
}

/**
 * Wie lange vor der Frist eine Aufgabe auftauchen soll.
 *
 * Der Kern des Problems: Eine Aufgabe mit halbjähriger Frist darf nicht ein
 * halbes Jahr lang jeden Morgen in der Tagesliste stehen – sonst gewöhnt man
 * sich an, über sie hinwegzulesen, und übersieht sie am Ende genau dann, wenn
 * es darauf ankommt. Deshalb bleibt sie ruhig liegen und meldet sich mit
 * genug Vorlauf, um sie noch in Ruhe zu erledigen.
 */
export function anlaufTage(horizont: number): number {
  if (horizont <= 7) return Math.max(0, horizont)
  if (horizont <= 30) return 7
  if (horizont <= 90) return 14
  return 30
}

/** Vorschlag für den Anlauftag – der Nutzer darf ihn überschreiben. */
export function defaultShowFrom(dueOn: DayString, from: DayString = todayString()): DayString {
  const horizont = diffDays(from, dueOn)
  if (horizont <= 0) return from
  return addDays(dueOn, -anlaufTage(horizont))
}

/** Ab wann eine Aufgabe wirklich auftaucht. `null` heißt: immer. */
export function effectiveShowFrom(
  t: Pick<Task, 'show_from' | 'due_on' | 'scheduled_on' | 'created_at'>,
): DayString | null {
  if (t.show_from) return t.show_from
  if (t.scheduled_on || !t.due_on) return null
  const angelegt = (t.created_at ?? '').slice(0, 10) || todayString()
  return defaultShowFrom(t.due_on, angelegt)
}

export interface Dringlichkeit {
  /** 0 ruhig · 1 im Blick · 2 bald · 3 dringend · 4 überfällig */
  level: 0 | 1 | 2 | 3 | 4
  label: string
  status: 'neutral' | 'green' | 'amber' | 'red'
  daysLeft: number | null
}

/** Wie dringend ist die Aufgabe heute? Wird zur Frist hin von allein größer. */
export function dringlichkeit(
  t: Pick<Task, 'status' | 'due_on' | 'scheduled_on' | 'scheduled_end_on' | 'pinned_day'>,
  today: DayString = todayString(),
): Dringlichkeit {
  if (t.status === 'done' || t.status === 'cancelled') {
    return { level: 0, label: 'erledigt', status: 'neutral', daysLeft: null }
  }
  const frist = t.due_on
  if (!frist) {
    const geplant = t.scheduled_on
    const rangeEnd = geplant ? (t.scheduled_end_on ?? geplant) : null
    if (geplant && rangeEnd && rangeEnd < today) {
      return { level: 2, label: 'liegt seit ' + diffDays(rangeEnd, today) + ' Tagen', status: 'amber', daysLeft: null }
    }
    return { level: 0, label: '', status: 'neutral', daysLeft: null }
  }
  const rest = diffDays(today, frist)
  if (rest < 0) return { level: 4, label: `${-rest} Tage überfällig`, status: 'red', daysLeft: rest }
  if (rest === 0) return { level: 3, label: 'heute fällig', status: 'red', daysLeft: 0 }
  if (rest === 1) return { level: 3, label: 'morgen fällig', status: 'red', daysLeft: 1 }
  if (rest <= 2) return { level: 3, label: `noch ${rest} Tage`, status: 'red', daysLeft: rest }
  if (rest <= 7) return { level: 2, label: `noch ${rest} Tage`, status: 'amber', daysLeft: rest }
  if (rest <= 30) return { level: 1, label: `noch ${rest} Tage`, status: 'green', daysLeft: rest }
  return { level: 1, label: `noch ${rest} Tage`, status: 'neutral', daysLeft: rest }
}

/**
 * Offene Aufgaben von gestern auf heute mitnehmen.
 *
 * Was fest an seinem Tag hängt, bleibt liegen – ein Termin von gestern gehört
 * nicht in den heutigen Plan. Alles andere wandert mit und merkt sich, wie oft
 * es schon geschoben wurde; das ist ein ehrliches Signal dafür, dass eine
 * Aufgabe entweder zu groß ist oder gar nicht wirklich ansteht.
 */
export function carryOverPatches(
  tasks: Task[],
  today: DayString = todayString(),
): { id: string; patch: Record<string, any> }[] {
  const out: { id: string; patch: Record<string, any> }[] = []
  for (const t of tasks) {
    if (t.deleted_at || t.status === 'done' || t.status === 'cancelled') continue
    if (t.pinned_day) continue
    if (!t.scheduled_on || (t.scheduled_end_on ?? t.scheduled_on) >= today) continue
    if (t.bucket === 'someday') continue
    out.push({
      id: t.id,
      patch: {
        scheduled_on: today,
        bucket: 'today',
        carried_count: (t.carried_count ?? 0) + 1,
        carried_from: t.carried_from ?? t.scheduled_on,
      },
    })
  }
  return out
}

export function tasksForDay(tasks: Task[], day: DayString, today: DayString = todayString()): Task[] {
  return tasks
    .filter((t) => {
      if (t.deleted_at || t.status === 'cancelled') return false
      if (t.scheduled_on && day >= t.scheduled_on && day <= (t.scheduled_end_on ?? t.scheduled_on)) return true
      if (day !== today || t.status === 'done') return false
      // Was liegengeblieben ist, bleibt sichtbar – auch wenn der Übertrag
      // (noch) nicht gelaufen ist, etwa weil er abgeschaltet wurde.
      if (t.scheduled_on && t.scheduled_on < today) return true
      // Aufgaben mit Frist melden sich erst, wenn es Zeit wird.
      if (!t.scheduled_on && t.due_on) {
        const ab = effectiveShowFrom(t)
        return ab === null || ab <= today
      }
      return false
    })
    .sort((a, b) => {
      const done = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
      if (done !== 0) return done
      const da = dringlichkeit(a, today).level
      const db = dringlichkeit(b, today).level
      if (da !== db) return db - da
      const at = a.scheduled_time ?? '99:99'
      const bt = b.scheduled_time ?? '99:99'
      if (at !== bt) return at < bt ? -1 : 1
      return b.priority - a.priority
    })
}

/** Aufgabe erledigt/wieder öffnen – die eine Umschalt-Logik für alle Checkboxen. */
export function toggleTaskPatch(task: Pick<Task, 'status'>): Record<string, any> {
  return {
    status: task.status === 'done' ? 'open' : 'done',
    completed_at: task.status === 'done' ? null : new Date().toISOString(),
  }
}

/**
 * Teilfortschritt einer Aufgabe verändern (z. B. "1/4 Teile fertig").
 * Erreicht der Fortschritt das Gesamt, gilt die Aufgabe als erledigt; fällt
 * er darunter, wird eine erledigte Aufgabe automatisch wieder geöffnet.
 */
export function progressPatch(
  task: Pick<Task, 'progress_total' | 'progress_done' | 'status'>,
  delta: 1 | -1,
): Record<string, any> {
  const total = task.progress_total ?? 1
  const done = Math.min(total, Math.max(0, (task.progress_done ?? 0) + delta))
  const complete = done >= total
  return {
    progress_done: done,
    status: complete ? 'done' : (task.status === 'done' ? 'open' : task.status),
    completed_at: complete ? new Date().toISOString() : null,
  }
}

export function bucketForDay(day: DayString, today: DayString = todayString()): Task['bucket'] {
  if (day === today) return 'today'
  const weekEnd = addDays(startOfWeek(today), 6)
  if (day <= weekEnd) return 'week'
  return 'scheduled'
}

export function isOverdue(t: Task, today: DayString = todayString()): boolean {
  if (t.status === 'done' || t.status === 'cancelled') return false
  const ref = t.due_on ?? t.scheduled_on
  return !!ref && ref < today
}

/** Schichtmuster auf einen Tag anwenden: welcher Tagestyp-Kürzel gilt? */
export function shiftCodeForDay(
  day: DayString,
  anchorDate: DayString,
  pattern: string[],
): string | null {
  if (!pattern.length) return null
  const diff = Math.round((new Date(day).getTime() - new Date(anchorDate).getTime()) / 86400000)
  const idx = ((diff % pattern.length) + pattern.length) % pattern.length
  const code = pattern[idx]
  return code && code !== '-' ? code : null
}

/* ------------------------------------------------------------- Vorlagen */

export interface PlannedTask {
  templateId: string
  day: DayString
  title: string
  description: string | null
  duration_minutes: number | null
  priority: number
}

/**
 * Erzeugt aus Aufgabenvorlagen die anstehenden Aufgaben.
 *
 * Eine Vorlage beschreibt eine wiederkehrende Verabredung mit sich selbst,
 * die an Bedingungen hängt: "immer dienstags, wenn Spätschicht ist, Auto putzen".
 * Erzeugt wird nur, was noch nicht existiert – zweimal ausführen ändert nichts.
 */
export function planTasksFromTemplates(
  templates: TaskTemplate[],
  assignments: { day: DayString; day_type_id: string }[],
  existingTasks: { template_id?: string | null; scheduled_on: DayString | null; deleted_at: string | null }[],
  from: DayString,
  to: DayString,
): PlannedTask[] {
  const dayTypeOf = new Map(assignments.map((a) => [a.day, a.day_type_id]))
  const already = new Set(
    existingTasks
      .filter((t) => t.template_id && t.scheduled_on)
      .map((t) => `${t.template_id}|${t.scheduled_on}`),
  )
  const out: PlannedTask[] = []

  for (const tpl of templates) {
    if (tpl.deleted_at || !tpl.is_active) continue
    for (const day of daysInRange(from, to)) {
      if (tpl.weekday && weekdayIndex(day) !== tpl.weekday) continue
      if (tpl.day_type_id && dayTypeOf.get(day) !== tpl.day_type_id) continue
      if (tpl.interval_weeks > 1) {
        const anchor = tpl.anchor_date ?? from
        const weeks = Math.floor(diffDays(anchor, day) / 7)
        if (((weeks % tpl.interval_weeks) + tpl.interval_weeks) % tpl.interval_weeks !== 0) continue
      }
      if (already.has(`${tpl.id}|${day}`)) continue
      out.push({
        templateId: tpl.id,
        day,
        title: tpl.title,
        description: tpl.description,
        duration_minutes: tpl.duration_minutes,
        priority: tpl.priority,
      })
    }
  }
  return out
}
