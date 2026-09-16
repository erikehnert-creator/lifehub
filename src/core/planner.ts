/**
 * Tagesplanung: Kapazität, Zeitblöcke, Auswahl der heutigen Aufgaben.
 */
import type { Task, TimeBlock, DayType, DayAssignment, CalendarEvent } from './types'
import {
  type DayString, timeToMinutes, minutesToTime, todayString, addDays, startOfWeek,
  diffDays,
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
 * Von mehreren offenen Aufgaben derselben Vorlage bleibt genau eine für heute
 * übrig – die IDs aller anderen liefert diese Funktion zurück.
 *
 * Warum das nötig ist: Eine tägliche Vorlage wie „Dehnung" legt für JEDEN Tag
 * eine Aufgabe an. Wird eine davon nicht abgehakt, schob der Tagesübertrag sie
 * früher auf heute – genau dorthin, wo die Vorlage ohnehin schon eine Aufgabe
 * für heute hingelegt hatte. Aus zwei Zeilen für denselben Vorlagentag machte
 * der Abgleich danach wieder eine, indem er eine davon wegräumte. Traf es die
 * Zeile mit der wiederholbaren ID (und das tat es jeden Tag, siehe
 * core/automation.ts), war dieser Tag anschließend für immer belegt: Die
 * gelöschte Zeile sperrt ihre eigene ID gegen ein Neuanlegen. Verschwand dann
 * die übriggebliebene Kopie, stand für den Tag gar nichts mehr da und die
 * Automatik konnte das nicht mehr heilen. Genau so fiel „Dehnung" aus.
 *
 * Die Regel dagegen ist einfach: Eine Vorlage ist an einem Tag mit EINER
 * Aufgabe vertreten. Liegt die heutige schon da, bleiben ältere offene
 * Aufgaben derselben Vorlage in ihrer Vergangenheit stehen – nicht abgehakt
 * ist nicht abgehakt, das gehört zum jeweiligen Tag. Nur wenn die Vorlage für
 * heute nichts vorsieht (etwa „jeden Dienstag" an einem Mittwoch), wandert die
 * älteste offene Aufgabe wie bisher mit.
 *
 * Es wird dabei nichts gelöscht: Die verdeckten Aufgaben bleiben als Historie
 * an ihrem Tag erhalten, sie drängen sich nur nicht alle in den heutigen Plan.
 */
export function verdeckteVorlagenAufgaben(
  tasks: Task[],
  today: DayString = todayString(),
): Set<string> {
  const proVorlage = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.deleted_at || t.status === 'done' || t.status === 'cancelled') continue
    if (!t.template_id || !t.scheduled_on) continue
    if ((t.scheduled_end_on ?? t.scheduled_on) > today) continue
    const liste = proVorlage.get(t.template_id)
    if (liste) liste.push(t)
    else proVorlage.set(t.template_id, [t])
  }
  const verdeckt = new Set<string>()
  for (const liste of proVorlage.values()) {
    if (liste.length < 2) continue
    // Vorrang hat die Aufgabe, die WIRKLICH für heute angelegt wurde: eine, die
    // heute liegt und noch nie geschoben wurde. Erst danach eine geschobene von
    // heute. Sieht die Vorlage für heute nichts vor, wandert die älteste mit.
    // Die Reihenfolge der Liste darf dabei nichts entscheiden – sie ist bei
    // einem Doppel genau die Zufälligkeit, die den Fehler erzeugt hat.
    const heutigeOriginal = liste.find((t) => t.scheduled_on === today && !(t.carried_count ?? 0))
    const sichtbar = heutigeOriginal
      ?? liste.find((t) => t.scheduled_on === today)
      ?? liste.reduce((a, b) => ((a.scheduled_on ?? '') <= (b.scheduled_on ?? '') ? a : b))
    for (const t of liste) if (t.id !== sichtbar.id) verdeckt.add(t.id)
  }
  return verdeckt
}

/**
 * Offene Aufgaben von gestern auf heute mitnehmen.
 *
 * Was fest an seinem Tag hängt, bleibt liegen – ein Termin von gestern gehört
 * nicht in den heutigen Plan. Alles andere wandert mit und merkt sich, wie oft
 * es schon geschoben wurde; das ist ein ehrliches Signal dafür, dass eine
 * Aufgabe entweder zu groß ist oder gar nicht wirklich ansteht.
 *
 * Aufgaben aus Vorlagen wandern nur, solange die Vorlage für heute nicht schon
 * selbst gesorgt hat – siehe verdeckteVorlagenAufgaben().
 */
export function carryOverPatches(
  tasks: Task[],
  today: DayString = todayString(),
): { id: string; patch: Record<string, any> }[] {
  const out: { id: string; patch: Record<string, any> }[] = []
  const verdeckt = verdeckteVorlagenAufgaben(tasks, today)
  for (const t of tasks) {
    if (t.deleted_at || t.status === 'done' || t.status === 'cancelled') continue
    if (t.pinned_day) continue
    if (!t.scheduled_on || (t.scheduled_end_on ?? t.scheduled_on) >= today) continue
    if (t.bucket === 'someday') continue
    if (verdeckt.has(t.id)) continue
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
  // Nur für den heutigen Tag nötig: Dort sammelt sich sonst alles, was die
  // Vorlage an den Tagen davor angelegt hat (siehe verdeckteVorlagenAufgaben).
  const verdeckt = day === today ? verdeckteVorlagenAufgaben(tasks, today) : null
  return tasks
    .filter((t) => {
      if (t.deleted_at || t.status === 'cancelled') return false
      if (verdeckt?.has(t.id)) return false
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

/* ------------------------------------------------------------- Vorlagen
 *
 * Die Auswertung von Aufgabenvorlagen ist nach core/automation.ts gewandert.
 * Der Grund: Sie beantwortet nicht mehr nur „was fehlt noch?", sondern auch
 * „was muss nachgezogen und was weggeräumt werden?" – und das gehört fachlich
 * zu den wiederkehrenden Zahlungen, die genau dieselbe Frage stellen (mit
 * absichtlich anderer Antwort für die Vergangenheit).
 */
