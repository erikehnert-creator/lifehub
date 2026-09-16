/**
 * Morgens darf ein niedriger Kalorienwert nicht rot sein.
 */
import { describe, expect, it } from 'vitest'
import { BEWERTUNG_AB_STUNDE, darfBewerten, fortschrittProzent, tagIstAbgeschlossen } from '../src/core/tagesfortschritt'

const HEUTE = '2026-09-17'

describe('Wann eine Tagessumme bewertet wird', () => {
  it('heute morgens nicht', () => {
    expect(darfBewerten('sum', HEUTE, HEUTE, 9)).toBe(false)
  })

  it('heute am späten Abend schon', () => {
    expect(darfBewerten('sum', HEUTE, HEUTE, BEWERTUNG_AB_STUNDE)).toBe(true)
  })

  it('vergangene Tage immer', () => {
    expect(darfBewerten('sum', '2026-09-16', HEUTE, 9)).toBe(true)
  })

  it('künftige Tage nie', () => {
    expect(tagIstAbgeschlossen('2026-09-18', HEUTE, 23)).toBe(false)
  })

  it('Werte ohne Tagessumme (Gewicht, Schlaf) sofort', () => {
    expect(darfBewerten('last', HEUTE, HEUTE, 7)).toBe(true)
    expect(darfBewerten('avg', HEUTE, HEUTE, 7)).toBe(true)
  })
})

describe('Fortschritt zum Tagesziel', () => {
  it('rechnet den Anteil in Prozent', () => {
    expect(fortschrittProzent(400, 2450)).toBe(16)
    expect(fortschrittProzent(2626, 2450)).toBe(107)
  })

  it('ohne Ziel oder Wert gibt es keinen Anteil', () => {
    expect(fortschrittProzent(null, 2450)).toBeNull()
    expect(fortschrittProzent(400, null)).toBeNull()
    expect(fortschrittProzent(400, 0)).toBeNull()
  })
})
