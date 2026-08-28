import { describe, it, expect } from 'vitest'
import { parseRRule, buildRRule, occurrences, nextOccurrence, describeRRule } from '../src/core/recurrence'

describe('Wiederholungsregeln', () => {
  it('liest und schreibt RRULE-Zeichenketten', () => {
    const r = parseRRule('FREQ=MONTHLY;BYMONTHDAY=1;INTERVAL=2')
    expect(r.freq).toBe('MONTHLY')
    expect(r.byMonthDay).toEqual([1])
    expect(r.interval).toBe(2)
    expect(buildRRule({ freq: 'WEEKLY', byDay: [1, 4] })).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
  })

  it('erzeugt monatliche Termine', () => {
    const list = occurrences('FREQ=MONTHLY;BYMONTHDAY=1', '2026-01-01', '2026-01-01', '2026-04-30')
    expect(list).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
  })

  it('kürzt den 31. in kurzen Monaten auf den Monatsletzten', () => {
    const list = occurrences('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', '2026-01-01', '2026-03-31')
    expect(list).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('versteht den Monatsletzten als -1', () => {
    const list = occurrences('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-01', '2026-01-01', '2026-02-28')
    expect(list).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('erzeugt wöchentliche Termine an mehreren Wochentagen', () => {
    const list = occurrences('FREQ=WEEKLY;BYDAY=MO,TH', '2026-08-03', '2026-08-03', '2026-08-16')
    expect(list).toEqual(['2026-08-03', '2026-08-06', '2026-08-10', '2026-08-13'])
  })

  it('beachtet INTERVAL bei Wochen', () => {
    const list = occurrences('FREQ=WEEKLY;BYDAY=MO;INTERVAL=2', '2026-08-03', '2026-08-03', '2026-09-14')
    expect(list).toEqual(['2026-08-03', '2026-08-17', '2026-08-31', '2026-09-14'])
  })

  it('beachtet COUNT und UNTIL', () => {
    expect(occurrences('FREQ=DAILY;COUNT=3', '2026-08-01', '2026-08-01', '2026-12-31')).toHaveLength(3)
    expect(occurrences('FREQ=DAILY;UNTIL=20260805', '2026-08-01', '2026-08-01', '2026-12-31')).toHaveLength(5)
  })

  it('lässt Ausnahmetage aus', () => {
    const list = occurrences('FREQ=DAILY', '2026-08-01', '2026-08-01', '2026-08-04', ['2026-08-02'])
    expect(list).toEqual(['2026-08-01', '2026-08-03', '2026-08-04'])
  })

  it('findet den nächsten Termin', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=28', '2026-01-28', '2026-08-19')).toBe('2026-08-28')
  })

  it('beschreibt Regeln auf Deutsch', () => {
    expect(describeRRule('FREQ=MONTHLY;BYMONTHDAY=1')).toContain('monatlich')
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO')).toContain('Montag')
  })
})
