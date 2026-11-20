/**
 * Termine auf Tage auflösen – die eine Rechnung, auf die Kalender, Heute,
 * Planer und Kapazität sich verlassen.
 *
 * Vorher prüften Heute und der Planer nur `e.day === tag`. Damit fehlten dort
 * wöchentliche Wiederholungen und mehrtägige Termine, die der Kalender sehr
 * wohl zeigte: Der Termin stand im Kalender, aber nicht auf „Heute", und die
 * freie Zeit des Tages war zu großzügig gerechnet.
 */
import type { CalendarEvent } from './types'
import type { DayString } from './dates'
import { addDays, diffDays, formatDay, todayString } from './dates'
import { occurrences, nextOccurrence, describeRRule } from './recurrence'

export interface Vorkommen {
  event: CalendarEvent
  day: DayString
  /** Bei mehrtägigen Terminen: der wievielte Tag und wie viele insgesamt. */
  teil: { nr: number; von: number } | null
}

/**
 * Alle Termine eines Zeitraums – Wiederholungen und mehrtägige Termine
 * bereits auf einzelne Tage aufgelöst. Alles andere in dieser Datei rechnet
 * mit dem Ergebnis und muss sich um Wiederholungsregeln nicht kümmern.
 */
export function vorkommenIn(events: CalendarEvent[], von: DayString, bis: DayString): Vorkommen[] {
  const out: Vorkommen[] = []
  for (const e of events) {
    if (e.deleted_at) continue
    const laenge = e.end_day && e.end_day > e.day ? diffDays(e.day, e.end_day) + 1 : 1
    // Ein mehrtägiger Termin kann schon vor `von` begonnen haben.
    const suchVon = addDays(von, -(laenge - 1))
    const ausnahmen = (e.exdates ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    const starts = e.rrule
      ? occurrences(e.rrule, e.day, suchVon, bis, ausnahmen)
      : (e.day >= suchVon && e.day <= bis ? [e.day] : [])
    for (const start of starts) {
      for (let i = 0; i < laenge; i++) {
        const tag = addDays(start, i)
        if (tag < von || tag > bis) continue
        out.push({ event: e, day: tag, teil: laenge > 1 ? { nr: i + 1, von: laenge } : null })
      }
    }
  }
  return out.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    const ag = a.event.all_day ? 0 : 1
    const bg = b.event.all_day ? 0 : 1
    if (ag !== bg) return ag - bg
    return (a.event.start_time ?? '') < (b.event.start_time ?? '') ? -1 : 1
  })
}

/**
 * Die Termine eines einzelnen Tages, Wiederholungen und mehrtägige Termine
 * eingerechnet. Ganztägige zuerst, dann nach Uhrzeit.
 */
export function termineAmTag(events: CalendarEvent[], tag: DayString): Vorkommen[] {
  return vorkommenIn(events, tag, tag)
}

/**
 * Wie ein Termin in der Suche erscheint. Bei einer Wiederholung zählt der
 * nächste Termin ab heute, nicht der Tag, an dem die Serie einmal begann –
 * sonst stünde „jeden Montag" mit einem Datum von vor einem Jahr da.
 */
export function terminSuchtreffer(
  e: Pick<CalendarEvent, 'day' | 'rrule' | 'exdates' | 'start_time' | 'location'>,
  heute: DayString = todayString(),
): { day: DayString; sub: string } {
  let tag = e.day
  let serie = ''
  if (e.rrule) {
    const naechster = e.day >= heute ? e.day : nextOccurrence(e.rrule, e.day, heute)
    if (naechster) tag = naechster
    serie = describeRRule(e.rrule)
  }
  const teile = [
    e.rrule ? `${tag >= heute ? 'nächster: ' : 'zuletzt: '}${formatDay(tag)}` : formatDay(tag),
    serie || null,
    e.start_time || null,
    e.location || null,
  ].filter(Boolean)
  return { day: tag, sub: teile.join(' · ') }
}
