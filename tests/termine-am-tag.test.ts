import { describe, it, expect } from 'vitest'
import { termineAmTag, vorkommenIn } from '../src/core/termine'
import { computeCapacity } from '../src/core/planner'

const termin = (over: Record<string, any> = {}) => ({
  id: 'e' + Math.random().toString(36).slice(2), title: 'Termin', deleted_at: null,
  description: null, location: null, day: '2026-11-02', start_time: '18:00',
  end_time: '19:30', all_day: 0, timezone: 'Europe/Berlin', rrule: null,
  exdates: null, color: null, source: 'local', external_uid: null,
  end_day: null, reminder_minutes: null,
  ...over,
}) as any

describe('termineAmTag – eine Rechnung für Kalender, Heute und Planer', () => {
  it('findet eine wöchentliche Wiederholung an einem späteren Montag', () => {
    const training = termin({ day: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    expect(termineAmTag([training], '2026-11-23').map((v) => v.event.id)).toEqual([training.id])
    expect(termineAmTag([training], '2026-11-24')).toHaveLength(0)
  })
  it('lässt ausgenommene Wiederholungen weg', () => {
    const training = termin({ day: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: '2026-11-23' })
    expect(termineAmTag([training], '2026-11-23')).toHaveLength(0)
  })
  it('zeigt einen mehrtägigen Termin an jedem seiner Tage', () => {
    const reise = termin({ day: '2026-11-20', end_day: '2026-11-22', all_day: 1, start_time: null, end_time: null })
    expect(termineAmTag([reise], '2026-11-21')).toHaveLength(1)
    expect(termineAmTag([reise], '2026-11-23')).toHaveLength(0)
  })
  it('ignoriert gelöschte Termine', () => {
    expect(termineAmTag([termin({ deleted_at: '2026-11-01T00:00:00Z' })], '2026-11-02')).toHaveLength(0)
  })
  it('gibt für einen Tag dasselbe wie vorkommenIn für diesen einen Tag', () => {
    const liste = [termin({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }), termin({ day: '2026-11-09' })]
    expect(termineAmTag(liste, '2026-11-09')).toEqual(vorkommenIn(liste, '2026-11-09', '2026-11-09'))
  })
})

describe('Tageskapazität rechnet Wiederholungen mit', () => {
  const kap = (events: any[], tag: string) => computeCapacity(tag, null, null, [], [], events, 8)
  it('belegt den späteren Montag mit der Termindauer (90 Minuten)', () => {
    const training = termin({ day: '2026-11-02', rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    expect(kap([training], '2026-11-02').plannedMinutes).toBe(90)
    expect(kap([training], '2026-11-23').plannedMinutes).toBe(90)
    expect(kap([training], '2026-11-24').plannedMinutes).toBe(0)
  })
  it('rechnet einen mehrtägigen Termin mit Uhrzeit nur am ersten Tag', () => {
    const t = termin({ day: '2026-11-20', end_day: '2026-11-22' })
    expect(kap([t], '2026-11-20').plannedMinutes).toBe(90)
    expect(kap([t], '2026-11-21').plannedMinutes).toBe(0)
  })
  it('ganztägige Termine belegen keine Zeit', () => {
    expect(kap([termin({ all_day: 1 })], '2026-11-02').plannedMinutes).toBe(0)
  })
})
