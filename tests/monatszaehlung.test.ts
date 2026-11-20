import { describe, it, expect } from 'vitest'
import { erledigteAufgabenJeMonat, trainingseinheitenJeMonat } from '../src/core/monatszaehlung'

const monate = ['2026-09', '2026-10', '2026-11']

describe('erledigteAufgabenJeMonat', () => {
  it('zählt je Monat und gibt jeden gewünschten Monat aus, auch leere', () => {
    const r = erledigteAufgabenJeMonat([
      { deleted_at: null, completed_at: '2026-10-03T08:00:00Z' },
      { deleted_at: null, completed_at: '2026-10-31T22:00:00Z' },
      { deleted_at: null, completed_at: '2026-11-01T00:00:00Z' },
    ] as any, monate)
    expect(r).toEqual([
      { monat: '2026-09', anzahl: 0 },
      { monat: '2026-10', anzahl: 2 },
      { monat: '2026-11', anzahl: 1 },
    ])
  })
  it('ignoriert gelöschte und nicht erledigte Aufgaben sowie Monate außerhalb', () => {
    const r = erledigteAufgabenJeMonat([
      { deleted_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-03T08:00:00Z' },
      { deleted_at: null, completed_at: null },
      { deleted_at: null, completed_at: '2025-01-01T00:00:00Z' },
    ] as any, monate)
    expect(r.every((x) => x.anzahl === 0)).toBe(true)
  })
})

describe('trainingseinheitenJeMonat', () => {
  it('zählt nur absolvierte, nicht gelöschte Einheiten', () => {
    const r = trainingseinheitenJeMonat([
      { deleted_at: null, status: 'completed', day: '2026-11-02' },
      { deleted_at: null, status: 'completed', day: '2026-11-20' },
      { deleted_at: null, status: 'planned', day: '2026-11-21' },
      { deleted_at: '2026-11-22T00:00:00Z', status: 'completed', day: '2026-11-03' },
      { deleted_at: null, status: 'completed', day: '2026-09-30' },
    ] as any, monate)
    expect(r.map((x) => x.anzahl)).toEqual([1, 0, 2])
  })
})
