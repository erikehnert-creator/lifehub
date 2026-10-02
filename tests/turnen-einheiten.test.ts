/**
 * Was als Turneinheit zählt – und was nur geplant ist.
 *
 * Seit Phase 3B steht in `workout_sessions` beides. Die Kennzahlen auf der
 * Turnen-Übersicht („Letzte Einheit", „Einheiten gesamt") beschreiben aber
 * vergangene Aktivität, und ein Termin von übermorgen ist keine. Genau das
 * ging schief: Der Bildschirm sortierte nach Datum absteigend und nahm den
 * ersten – seit es Termine gibt, stand dort ein Training, das erst noch
 * stattfindet.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DISZIPLINEN, DISZIPLIN_TURNEN, absolvierteTurneinheiten, geplanteTurntermine,
  istAbsolviert, istTurnen, letzteTurneinheit,
} from '../src/core/turnen/einheiten'

const HEUTE = '2026-09-30'

const einheit = (teil: Partial<{
  day: string; status: string; discipline: string | null; deleted_at: string | null; id: string
}>) => ({
  id: teil.id ?? `s-${teil.day}-${teil.status}`,
  day: teil.day ?? HEUTE,
  status: teil.status ?? 'completed',
  discipline: teil.discipline === undefined ? DISZIPLIN_TURNEN : teil.discipline,
  deleted_at: teil.deleted_at ?? null,
})

describe('istTurnen', () => {
  it('erkennt die Disziplin, nicht den Titel', () => {
    expect(istTurnen(einheit({}))).toBe(true)
    expect(istTurnen(einheit({ discipline: null }))).toBe(false)
    expect(istTurnen(einheit({ discipline: 'kraft' }))).toBe(false)
  })

  it('gelöschte Einheiten zählen nirgends', () => {
    expect(istTurnen(einheit({ deleted_at: '2026-09-01T00:00:00Z' }))).toBe(false)
  })
})

describe('istAbsolviert', () => {
  it('eine vergangene, erfasste Einheit: ja', () => {
    expect(istAbsolviert(einheit({ day: '2026-09-25' }), HEUTE)).toBe(true)
  })

  it('eine heutige Einheit: ja – die Tagesgrenze ist einschliesslich', () => {
    expect(istAbsolviert(einheit({ day: HEUTE }), HEUTE)).toBe(true)
  })

  it('eine Einheit von morgen: nein, auch wenn sie „completed" heisst', () => {
    expect(istAbsolviert(einheit({ day: '2026-10-01', status: 'completed' }), HEUTE)).toBe(false)
  })

  it('ein geplanter Termin: nein, auch wenn er in der Vergangenheit liegt', () => {
    expect(istAbsolviert(einheit({ day: '2026-09-20', status: 'planned' }), HEUTE)).toBe(false)
  })

  it('ausgefallen und Ruhetag sind kein absolviertes Training', () => {
    expect(istAbsolviert(einheit({ day: '2026-09-20', status: 'skipped' }), HEUTE)).toBe(false)
    expect(istAbsolviert(einheit({ day: '2026-09-20', status: 'rest' }), HEUTE)).toBe(false)
  })
})

describe('Letzte Einheit', () => {
  it('eine vergangene Einheit', () => {
    const alle = [einheit({ day: '2026-09-20' }), einheit({ day: '2026-09-25' })]
    expect(letzteTurneinheit(alle, HEUTE)!.day).toBe('2026-09-25')
  })

  it('eine heutige Einheit gewinnt gegen eine ältere', () => {
    const alle = [einheit({ day: '2026-09-25' }), einheit({ day: HEUTE })]
    expect(letzteTurneinheit(alle, HEUTE)!.day).toBe(HEUTE)
  })

  it('eine zukünftige Einheit verfälscht die Kennzahl nicht', () => {
    // Der gemeldete Fehler, in einer Zeile.
    const alle = [einheit({ day: '2026-09-25' }), einheit({ day: '2026-10-05', status: 'planned' })]
    expect(letzteTurneinheit(alle, HEUTE)!.day).toBe('2026-09-25')
  })

  it('vergangene und zukünftige Einheit gleichzeitig, beide „completed"', () => {
    const alle = [
      einheit({ day: '2026-09-25', status: 'completed' }),
      einheit({ day: '2026-10-05', status: 'completed' }),
    ]
    expect(letzteTurneinheit(alle, HEUTE)!.day).toBe('2026-09-25')
  })

  it('nur Zukunft: dann gibt es keine letzte Einheit', () => {
    const alle = [einheit({ day: '2026-10-05', status: 'planned' })]
    expect(letzteTurneinheit(alle, HEUTE)).toBe(null)
  })

  it('die lokale Tagesgrenze: gestern zählt, morgen nicht', () => {
    const alle = [
      einheit({ day: '2026-09-29', id: 'gestern' }),
      einheit({ day: '2026-10-01', id: 'morgen' }),
    ]
    expect(letzteTurneinheit(alle, HEUTE)!.id).toBe('gestern')
  })
})

describe('Einheiten gesamt', () => {
  it('zählt nur, was stattgefunden hat', () => {
    const alle = [
      einheit({ day: '2026-09-20' }),
      einheit({ day: '2026-09-25' }),
      einheit({ day: HEUTE }),
      einheit({ day: '2026-10-02', status: 'planned' }),
      einheit({ day: '2026-10-09', status: 'planned' }),
      einheit({ day: '2026-09-22', status: 'skipped' }),
      einheit({ day: '2026-09-23', discipline: 'kraft' }),
      einheit({ day: '2026-09-24', deleted_at: 'x' }),
    ]
    expect(absolvierteTurneinheiten(alle, HEUTE)).toHaveLength(3)
  })

  it('neueste zuerst – „Letzte Einheit" ist dieselbe Rechnung', () => {
    const alle = [einheit({ day: '2026-09-20' }), einheit({ day: '2026-09-28' }), einheit({ day: '2026-09-24' })]
    const liste = absolvierteTurneinheiten(alle, HEUTE)
    expect(liste.map((s) => s.day)).toEqual(['2026-09-28', '2026-09-24', '2026-09-20'])
    expect(letzteTurneinheit(alle, HEUTE)).toBe(liste[0])
  })
})

describe('Geplante Turntermine', () => {
  it('nur geplante, ältester zuerst – auch vergangene (die sind überfällig)', () => {
    const alle = [
      einheit({ day: '2026-10-09', status: 'planned' }),
      einheit({ day: '2026-10-02', status: 'planned' }),
      einheit({ day: '2026-09-20', status: 'planned' }),
      einheit({ day: '2026-09-25', status: 'completed' }),
    ]
    expect(geplanteTurntermine(alle).map((s) => s.day))
      .toEqual(['2026-09-20', '2026-10-02', '2026-10-09'])
  })

  it('andere Disziplinen bleiben draussen', () => {
    const alle = [einheit({ day: '2026-10-02', status: 'planned', discipline: 'kraft' })]
    expect(geplanteTurntermine(alle)).toHaveLength(0)
  })
})

describe('Der allgemeine Trainingseditor', () => {
  const quelle = (datei: string) => readFileSync(new URL(`../${datei}`, import.meta.url), 'utf8')

  it('bietet Turnen als Disziplin an', () => {
    expect(DISZIPLINEN.map((d) => d.wert)).toContain(DISZIPLIN_TURNEN)
    expect(DISZIPLINEN.map((d) => d.wert)).toContain(null)
  })

  it('schreibt die Disziplin mit – sonst kennt Phase 3B die Einheit nicht', () => {
    const text = quelle('src/screens/Tracking.tsx')
    // Der Editor baut EIN payload-Objekt für Anlegen und Ändern; steht
    // `discipline` nicht darin, bleibt es beim Anlegen leer.
    expect(text).toMatch(/const payload = \{[\s\S]{0,400}?discipline,/)
    expect(text).toMatch(/DISZIPLINEN/)
  })

  it('erkennt Turnen nicht am Titel', () => {
    for (const datei of [
      'src/screens/Tracking.tsx',
      'src/screens/turnen/Wochenplan.tsx',
      'src/core/turnen/einheiten.ts',
    ]) {
      expect(quelle(datei), datei).not.toMatch(/title[^\n]*(includes|match|startsWith)\([^)]*[Tt]urn/)
    }
  })

  it('kein Bildschirm entscheidet die Turnen-Kennzahlen mehr selbst', () => {
    for (const datei of [
      'src/screens/turnen/Uebersicht.tsx',
      'src/screens/turnen/Training.tsx',
      'src/screens/turnen/Wochenplan.tsx',
    ]) {
      expect(quelle(datei), datei).not.toMatch(/discipline === 'turnen'/)
    }
  })
})
