/**
 * Datums- und Zeitlogik.
 * Grundsatz: Kalendertage sind Strings 'YYYY-MM-DD' ohne Zeitzone.
 * Echte Zeitpunkte sind ISO-8601 in UTC.
 */
export type DayString = string // 'YYYY-MM-DD'
export type Instant = string // ISO-8601 UTC

export function nowIso(): Instant {
  return new Date().toISOString()
}

export function todayString(d: Date = new Date()): DayString {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDay(day: DayString): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(day: DayString, n: number): DayString {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return todayString(d)
}

export function addMonths(day: DayString, n: number): DayString {
  const d = parseDay(day)
  const targetMonth = d.getMonth() + n
  const anchor = new Date(d.getFullYear(), targetMonth, 1)
  const daysInTarget = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
  anchor.setDate(Math.min(d.getDate(), daysInTarget))
  return todayString(anchor)
}

export function diffDays(a: DayString, b: DayString): number {
  const ms = parseDay(b).getTime() - parseDay(a).getTime()
  return Math.round(ms / 86400000)
}

export function monthOf(day: DayString): string {
  return day.slice(0, 7)
}

export function monthStart(yearMonth: string): DayString {
  return `${yearMonth}-01`
}

export function monthEnd(yearMonth: string): DayString {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m, 0)
  return todayString(d)
}

export function addMonthsToYearMonth(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Monatsliste rückwärts, ältester zuerst. */
export function lastMonths(anchor: string, count: number): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(addMonthsToYearMonth(anchor, -i))
  return out
}

/** ISO-Woche: Montag = Wochenstart. */
export function startOfWeek(day: DayString): DayString {
  const d = parseDay(day)
  const dow = (d.getDay() + 6) % 7 // Mo=0 … So=6
  d.setDate(d.getDate() - dow)
  return todayString(d)
}

export function endOfWeek(day: DayString): DayString {
  return addDays(startOfWeek(day), 6)
}

export function isoWeekNumber(day: DayString): number {
  const d = parseDay(day)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayNr = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDayNr = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3)
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000))
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Wochentag 1 = Montag … 7 = Sonntag */
export function weekdayIndex(day: DayString): number {
  return ((parseDay(day).getDay() + 6) % 7) + 1
}

export function weekdayShort(day: DayString): string {
  return WEEKDAYS[weekdayIndex(day) - 1]
}

export function weekdayLong(day: DayString): string {
  return WEEKDAYS_LONG[weekdayIndex(day) - 1]
}

export function formatDay(day: DayString, style: 'short' | 'long' | 'medium' = 'medium'): string {
  const d = parseDay(day)
  const dd = String(d.getDate()).padStart(2, '0')
  if (style === 'short') return `${dd}.${String(d.getMonth() + 1).padStart(2, '0')}.`
  if (style === 'long') return `${weekdayLong(day)}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return `${dd}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

export function formatMonth(yearMonth: string, short = false): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `${(short ? MONTHS_SHORT : MONTHS)[m - 1]} ${y}`
}

export function monthLabelShort(yearMonth: string): string {
  const [, m] = yearMonth.split('-').map(Number)
  return MONTHS_SHORT[m - 1]
}

/** 'HH:MM' → Minuten seit Mitternacht */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function minutesToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Dezimalstunden als Std:Min anzeigen, z. B. 7.5 → "7:30". */
export function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/** Relative Angabe für die Oberfläche: "heute", "morgen", "vor 3 Tagen" … */
export function relativeDay(day: DayString, today: DayString = todayString()): string {
  const d = diffDays(today, day)
  if (d === 0) return 'heute'
  if (d === 1) return 'morgen'
  if (d === -1) return 'gestern'
  if (d === 2) return 'übermorgen'
  if (d > 0 && d <= 7) return `in ${d} Tagen`
  if (d < 0 && d >= -7) return `vor ${-d} Tagen`
  return formatDay(day)
}

export function daysInRange(from: DayString, to: DayString): DayString[] {
  const out: DayString[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 4000) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/** Deutsche gesetzliche Feiertage inkl. beweglicher Feste (Gauß'sche Osterformel). */
export function easterSunday(year: number): DayString {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type Holiday = { day: DayString; name: string; nationwide: boolean; states: string[] }

const ALL_STATES = ['BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH']

export function germanHolidays(year: number): Holiday[] {
  const easter = easterSunday(year)
  const rel = (n: number) => addDays(easter, n)
  const list: Holiday[] = [
    { day: `${year}-01-01`, name: 'Neujahr', nationwide: true, states: ALL_STATES },
    { day: `${year}-01-06`, name: 'Heilige Drei Könige', nationwide: false, states: ['BW', 'BY', 'ST'] },
    { day: `${year}-03-08`, name: 'Internationaler Frauentag', nationwide: false, states: ['BE', 'MV'] },
    { day: rel(-2), name: 'Karfreitag', nationwide: true, states: ALL_STATES },
    { day: rel(1), name: 'Ostermontag', nationwide: true, states: ALL_STATES },
    { day: `${year}-05-01`, name: 'Tag der Arbeit', nationwide: true, states: ALL_STATES },
    { day: rel(39), name: 'Christi Himmelfahrt', nationwide: true, states: ALL_STATES },
    { day: rel(50), name: 'Pfingstmontag', nationwide: true, states: ALL_STATES },
    { day: rel(60), name: 'Fronleichnam', nationwide: false, states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'] },
    { day: `${year}-08-15`, name: 'Mariä Himmelfahrt', nationwide: false, states: ['SL'] },
    { day: `${year}-10-03`, name: 'Tag der Deutschen Einheit', nationwide: true, states: ALL_STATES },
    { day: `${year}-10-31`, name: 'Reformationstag', nationwide: false, states: ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'] },
    { day: `${year}-11-01`, name: 'Allerheiligen', nationwide: false, states: ['BW', 'BY', 'NW', 'RP', 'SL'] },
    { day: `${year}-12-25`, name: '1. Weihnachtstag', nationwide: true, states: ALL_STATES },
    { day: `${year}-12-26`, name: '2. Weihnachtstag', nationwide: true, states: ALL_STATES },
  ]
  return list
}

export function holidaysForState(year: number, state: string): Holiday[] {
  return germanHolidays(year).filter((h) => h.nationwide || h.states.includes(state))
}

/**
 * Dauer aus einem einzigen Feld lesen.
 *
 * Getrennte Felder für Stunden und Minuten sind auf dem Handy fummelig.
 * Hier genügt eine Eingabe, und zwar so, wie man sie nebenbei hinschreibt:
 *
 *   `45`     → 45 Minuten      (ein- und zweistellig sind immer Minuten)
 *   `115`    → 1:15            (bei drei und vier Ziffern sind die letzten
 *   `1230`   → 12:30            beiden die Minuten)
 *   `1:15`   → 1:15
 *   `1h30`   → 1:30
 *   `1,5 h`  → 1:30
 *   `90 min` → 1:30
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null

  const clamp = (m: number) => (m <= 0 ? null : Math.min(24 * 60, Math.round(m)))

  // 1:15 oder 1.15h oder 1h30
  const getrennt = s.match(/^(\d{1,2})[:.h](\d{1,2})?(?:min?)?$/)
  if (getrennt) return clamp(Number(getrennt[1]) * 60 + Number(getrennt[2] || 0))

  // ausdrücklich Minuten
  const min = s.match(/^(\d+(?:[.,]\d+)?)(?:min|m)$/)
  if (min) return clamp(Number(min[1].replace(',', '.')))

  // ausdrücklich Stunden, auch mit Komma: 1,5h
  const std = s.match(/^(\d+(?:[.,]\d+)?)(?:std\.?|stunden?|h)$/)
  if (std) return clamp(Number(std[1].replace(',', '.')) * 60)

  // Kommazahl ohne Einheit: 1,5 sind eineinhalb Stunden
  const komma = s.match(/^(\d+)[.,](\d+)$/)
  if (komma) return clamp(Number(`${komma[1]}.${komma[2]}`) * 60)

  // reine Ziffern: bis 99 Minuten, ab 100 als h+mm lesen
  const ziffern = s.match(/^(\d{1,4})$/)
  if (ziffern) {
    const n = Number(ziffern[1])
    if (n < 100) return clamp(n)
    const h = Math.floor(n / 100)
    const m = n % 100
    if (m > 59) return clamp(n)          // 190 ist eher „190 Minuten" als 1:90
    return clamp(h * 60 + m)
  }
  return null
}

/** Dauer so anzeigen, wie sie auch wieder eingegeben werden darf: 1:15 oder 45. */
export function durationToInput(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return ''
  if (minutes < 60) return String(minutes)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
