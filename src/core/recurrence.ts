/**
 * Wiederholungsregeln – Teilmenge von RFC 5545 (RRULE).
 * Unterstützt: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY, BYMONTHDAY,
 * COUNT, UNTIL.
 * Bewusst eine Teilmenge: alles, was diese App braucht, nichts darüber hinaus.
 */
import { type DayString, addDays, addMonths, parseDay, todayString, weekdayIndex } from './dates'

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  byDay: number[] | null // 1 = Montag … 7 = Sonntag
  byMonthDay: number[] | null
  count: number | null
  until: DayString | null
}

const DAY_CODES: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }
const DAY_NAMES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export function parseRRule(rrule: string): ParsedRule {
  const parts = rrule.replace(/^RRULE:/i, '').split(';')
  const map = new Map<string, string>()
  for (const p of parts) {
    const [k, v] = p.split('=')
    if (k && v) map.set(k.toUpperCase(), v.toUpperCase())
  }
  const freq = (map.get('FREQ') ?? 'MONTHLY') as ParsedRule['freq']
  const byDay = map.get('BYDAY')
    ? map.get('BYDAY')!.split(',').map((c) => DAY_CODES[c.slice(-2)]).filter(Boolean)
    : null
  const byMonthDay = map.get('BYMONTHDAY')
    ? map.get('BYMONTHDAY')!.split(',').map(Number).filter((n) => !Number.isNaN(n))
    : null
  const untilRaw = map.get('UNTIL')
  const until = untilRaw
    ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`
    : null
  return {
    freq,
    interval: Number(map.get('INTERVAL') ?? 1) || 1,
    byDay: byDay && byDay.length ? byDay : null,
    byMonthDay: byMonthDay && byMonthDay.length ? byMonthDay : null,
    count: map.get('COUNT') ? Number(map.get('COUNT')) : null,
    until,
  }
}

export function buildRRule(r: Partial<ParsedRule> & { freq: ParsedRule['freq'] }): string {
  const parts = [`FREQ=${r.freq}`]
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  if (r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => DAY_NAMES[d - 1]).join(',')}`)
  if (r.byMonthDay?.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`)
  if (r.count) parts.push(`COUNT=${r.count}`)
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`)
  return parts.join(';')
}

/** Alle Termine einer Regel im Zeitfenster [from, to]. */
export function occurrences(
  rrule: string,
  startsOn: DayString,
  from: DayString,
  to: DayString,
  exdates: DayString[] = [],
): DayString[] {
  const rule = parseRRule(rrule)
  const excluded = new Set(exdates)
  const out: DayString[] = []
  const hardLimit = 2000
  let produced = 0

  const end = rule.until && rule.until < to ? rule.until : to

  if (rule.freq === 'DAILY') {
    let cur = startsOn
    let guard = 0
    while (cur <= end && guard++ < hardLimit) {
      if (cur >= from && !excluded.has(cur)) { out.push(cur); produced++ }
      if (rule.count && produced >= rule.count) break
      cur = addDays(cur, rule.interval)
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay ?? [weekdayIndex(startsOn)]
    // Auf den Wochenanfang der Startwoche gehen
    let weekStart = addDays(startsOn, -((weekdayIndex(startsOn) - 1)))
    let guard = 0
    while (weekStart <= end && guard++ < hardLimit) {
      for (const d of [...days].sort((a, b) => a - b)) {
        const day = addDays(weekStart, d - 1)
        if (day < startsOn || day > end) continue
        if (day >= from && !excluded.has(day)) { out.push(day); produced++ }
        if (rule.count && produced >= rule.count) return out
      }
      weekStart = addDays(weekStart, 7 * rule.interval)
    }
  } else if (rule.freq === 'MONTHLY') {
    const monthDays = rule.byMonthDay ?? [parseDay(startsOn).getDate()]
    let anchor = `${startsOn.slice(0, 7)}-01`
    let guard = 0
    while (anchor <= end && guard++ < hardLimit) {
      const [y, m] = anchor.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      for (const md of [...monthDays].sort((a, b) => a - b)) {
        const dayNum = md > 0 ? Math.min(md, lastDay) : lastDay + md + 1
        const day = `${anchor.slice(0, 7)}-${String(dayNum).padStart(2, '0')}`
        if (day < startsOn || day > end) continue
        if (day >= from && !excluded.has(day)) { out.push(day); produced++ }
        if (rule.count && produced >= rule.count) return out
      }
      anchor = addMonths(anchor, rule.interval)
    }
  } else if (rule.freq === 'YEARLY') {
    const startDate = parseDay(startsOn)
    let year = startDate.getFullYear()
    let guard = 0
    while (guard++ < 200) {
      const day = `${year}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
      if (day > end) break
      if (day >= from && day >= startsOn && !excluded.has(day)) { out.push(day); produced++ }
      if (rule.count && produced >= rule.count) break
      year += rule.interval
    }
  }
  return out.sort()
}

export function nextOccurrence(
  rrule: string,
  startsOn: DayString,
  after: DayString = todayString(),
): DayString | null {
  const horizon = addMonths(after, 24)
  const list = occurrences(rrule, startsOn, after, horizon)
  return list.length ? list[0] : null
}

export function describeRRule(rrule: string): string {
  const r = parseRRule(rrule)
  const every = r.interval > 1 ? `alle ${r.interval} ` : ''
  const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
  switch (r.freq) {
    case 'DAILY':
      return r.interval > 1 ? `alle ${r.interval} Tage` : 'täglich'
    case 'WEEKLY': {
      const days = r.byDay?.map((d) => dayNames[d - 1]).join(', ')
      const base = r.interval > 1 ? `${every}Wochen` : 'wöchentlich'
      return days ? `${base} (${days})` : base
    }
    case 'MONTHLY': {
      const md = r.byMonthDay?.map((d) => (d > 0 ? `${d}.` : 'am Monatsletzten')).join(', ')
      const base = r.interval > 1 ? `${every}Monate` : 'monatlich'
      return md ? `${base}, jeweils ${md}` : base
    }
    case 'YEARLY':
      return r.interval > 1 ? `alle ${r.interval} Jahre` : 'jährlich'
  }
}
