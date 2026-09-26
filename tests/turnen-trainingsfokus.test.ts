/**
 * Trainingsfokus – Gerätepriorität, Elementpriorität, Kandidaten.
 *
 * ---------------------------------------------------------------------------
 * Geprüft werden Kategorien, nicht Elementnamen
 *
 * Die Zusicherungen halten sich an `prioritaet`, `lage`, `empfehlung`,
 * `stabilitaet` und die Gründe – nie an deutsche Sätze und nie an einen
 * erwarteten Elementnamen. Welche Elemente auftauchen, hängt an Eriks echten
 * Trainingsdaten, und die sollen die Prüfungen nicht vorschreiben.
 *
 * Der Wettkampfteil kommt aus der echten Phase-2C-Rechnung
 * (`wettkampfAnalyse`), nicht aus einem nachgebauten Fokus: Sonst prüfte diese
 * Datei ihre eigene Annahme darüber, was 2C liefert.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseProtokoll } from '../supabase/functions/wettkampf-import/protokoll'
import { vergleichFuer } from '../src/core/turnen/protokollImport'
import { benchmarkWerte } from '../src/core/turnen/vergleich'
import { analyseBild } from '../src/core/turnen/analyse'
import { diffDays } from '../src/core/dates'
import { SCHWELLEN } from '../src/core/turnen/sicherheit'
import { KUER_SCHWELLEN } from '../src/core/turnen/kueren'
import { wettkampfAnalyse, type VergleichsWerte, type VerlaufsPunkt } from '../src/core/turnen/analyse'
import {
  MEHRERE, empfehlungAus, kuerQuoteAus, lageAus, prioritaetAus, stabilitaetAus,
  trainingsfokus, verlaufshinweisFuer,
  type ElementLage, type GeraetFokus, type TrainingsfokusEingang,
} from '../src/core/turnen/trainingsfokus'
import { trefferbild } from '../src/core/turnen/sicherheit'
import type {
  GymAttempt, GymCompetition, GymElement, GymResult, GymRoutine, GymRoutineElement,
} from '../src/core/types'

const HEUTE = '2026-06-01'
const WK_ID = 'wk1'

/* ------------------------------------------------------------- Bausteine */

let lauf = 0
const id = (p: string) => `${p}-${++lauf}`

function element(o: Partial<GymElement> & { apparatus: string; name: string }): GymElement {
  return {
    id: o.id ?? id('el'),
    apparatus: o.apparatus,
    name: o.name,
    difficulty_letter: o.difficulty_letter ?? null,
    difficulty_value: o.difficulty_value ?? null,
    element_group: null,
    is_dismount: 0,
    hold_element: 0,
    status: o.status ?? 'sicher',
    video_url: null,
    note: null,
    is_active: o.is_active ?? 1,
    deleted_at: o.deleted_at ?? null,
  } as unknown as GymElement
}

/** Eine Einheit mit Versuchen an einem Element. */
function versuche(o: {
  elementId: string
  tag: string
  clean?: number
  shaky?: number
  failed?: number
  hilfe?: boolean
  bloecke?: number
}): { einheit: any; attempts: GymAttempt[] } {
  const sid = id('s')
  const n = o.bloecke ?? 1
  const attempts: GymAttempt[] = []
  for (let i = 0; i < n; i++) {
    attempts.push({
      id: id('a'),
      session_id: sid,
      element_id: o.elementId,
      clean: o.clean ?? 0,
      shaky: o.shaky ?? 0,
      failed: o.failed ?? 0,
      with_help: o.hilfe ? 1 : 0,
      note: null,
      sort_order: i,
      deleted_at: null,
    } as unknown as GymAttempt)
  }
  return { einheit: { id: sid, day: o.tag, deleted_at: null }, attempts }
}

function kuer(o: { apparatus: string; seit?: string | null; aktiv?: boolean }): GymRoutine {
  return {
    id: id('k'),
    apparatus: o.apparatus,
    name: `Kür ${o.apparatus}`,
    is_active: o.aktiv === false ? 0 : 1,
    competition_since: o.seit === undefined ? '2026-01-01T10:00:00.000Z' : o.seit,
    deleted_at: null,
  } as unknown as GymRoutine
}

function kuerPlatz(routineId: string, elementId: string, position: number): GymRoutineElement {
  return {
    id: id('re'),
    routine_id: routineId,
    element_id: elementId,
    position,
    created_at: `2026-01-01T00:00:0${position}.000Z`,
    deleted_at: null,
  } as unknown as GymRoutineElement
}

/**
 * Der Wettkampfteil: echte 2C-Rechnung aus Werten und einem Vergleichsfeld.
 *
 * `dRang`/`eRang` sind die Plätze in einem Feld von sechs. Daraus baut die
 * Prüfung eine Benchmarkzeile, und `wettkampfAnalyse` leitet Position und Fokus
 * ab – wie in der App.
 */
function wettkampfteil(geraete: {
  apparatus: string
  dRang: number
  eRang: number
  finalRang: number
  dGleich?: number
}[]): { wk: GymCompetition; ergebnisse: GymResult[]; benchmarks: VergleichsWerte[] } {
  const wk = {
    id: WK_ID, day: '2026-05-10', name: 'Prüfwettkampf', location: null,
    class_name: 'LK 2', rank_allround: 2, score_allround: 60,
    protocol_url: null, note: null, deleted_at: null,
  } as unknown as GymCompetition

  const ergebnisse: GymResult[] = []
  const benchmarks: VergleichsWerte[] = []
  for (const g of geraete) {
    ergebnisse.push({
      id: `r-${g.apparatus}`, competition_id: WK_ID, apparatus: g.apparatus,
      routine_version_id: null, d_score: 3, e_score: 8, penalty: null,
      final_score: 11, rank_apparatus: null, note: null, deleted_at: null,
    } as unknown as GymResult)
    benchmarks.push({
      competition_id: WK_ID, scope: g.apparatus, cohort_label: 'LK 2', cohort_size: 6,
      final_rank: g.finalRang, final_tie_count: 1, final_count: 6,
      final_median: 11, final_best: 12,
      d_rank: g.dRang, d_tie_count: g.dGleich ?? 1, d_count: 6, d_median: 3, d_best: 4,
      e_rank: g.eRang, e_tie_count: 1, e_count: 6, e_median: 8, e_best: 9,
    })
  }
  return { wk, ergebnisse, benchmarks }
}

interface Bau {
  geraete?: { apparatus: string; dRang: number; eRang: number; finalRang: number; dGleich?: number }[]
  elemente?: GymElement[]
  kueren?: GymRoutine[]
  verknuepfungen?: GymRoutineElement[]
  einheiten?: any[]
  attempts?: GymAttempt[]
  verlauf?: Map<string, VerlaufsPunkt[]>
  ohneWettkampf?: boolean
  ohneBenchmarks?: boolean
}

function baue(b: Bau) {
  const teil = wettkampfteil(b.geraete ?? [])
  const eingang: TrainingsfokusEingang = {
    analyse: b.ohneWettkampf ? null : wettkampfAnalyse(
      teil.wk, teil.ergebnisse, b.ohneBenchmarks ? [] : teil.benchmarks),
    verlauf: b.verlauf ?? new Map(),
    elemente: b.elemente ?? [],
    versuche: b.attempts ?? [],
    einheiten: b.einheiten ?? [],
    kueren: b.kueren ?? [],
    kuerVerknuepfungen: b.verknuepfungen ?? [],
    heute: HEUTE,
    tagDifferenz: diffDays,
  }
  const bild = trainingsfokus(eingang)
  return {
    bild,
    von: (apparatus: string): GeraetFokus => {
      const g = bild.geraete.find((x) => x.apparatus === apparatus)
      expect(g, `Fokus für ${apparatus}`).toBeTruthy()
      return g!
    },
  }
}

/** Versuche über mehrere Einheiten, sodass das Fenster genug Daten hat. */
function stabileVersuche(elementId: string, anzahl = 20, tag = '2026-05-20') {
  return versuche({ elementId, tag, clean: anzahl })
}
function instabileVersuche(elementId: string, tag = '2026-05-20') {
  return versuche({ elementId, tag, clean: 4, shaky: 4, failed: 4 })
}

/* ================================================= Stabilität: Abbildung */

describe('stabilitaetAus – bildet die vorhandene Statuslogik ab', () => {
  const bild = (o: { clean?: number; shaky?: number; failed?: number; hilfe?: boolean }) =>
    trefferbild([{
      clean: o.clean ?? 0, shaky: o.shaky ?? 0, failed: o.failed ?? 0,
      with_help: o.hilfe ? 1 : 0, deleted_at: null,
    } as unknown as GymAttempt])

  it('nennt einen einzigen Versuch nicht stabil', () => {
    expect(stabilitaetAus(bild({ clean: 1 }))).toBe('zu_wenig_daten')
  })

  it('nennt 20 von 20 gelungen stabil', () => {
    expect(stabilitaetAus(bild({ clean: 20 }))).toBe('stabil')
  })

  it('nennt 18 von 20 gelungen stabil – genau an der Schwelle', () => {
    expect(stabilitaetAus(bild({ clean: 18, shaky: 2 }))).toBe('stabil')
  })

  it('setzt 1 von 1 nicht über 18 von 20', () => {
    // Die Kernforderung: Die Stichprobengroesse zaehlt.
    expect(stabilitaetAus(bild({ clean: 1 }))).toBe('zu_wenig_daten')
    expect(stabilitaetAus(bild({ clean: 18, shaky: 2 }))).toBe('stabil')
  })

  it('deckelt bei Hilfestellung auf gemischt, auch bei hoher Quote', () => {
    expect(stabilitaetAus(bild({ clean: 20, hilfe: true }))).toBe('gemischt')
  })

  it('nennt eine Quote unter 60 % instabil', () => {
    expect(stabilitaetAus(bild({ clean: 4, shaky: 4, failed: 4 }))).toBe('instabil')
  })

  it('nennt einen Sturz bei hoher Quote gemischt statt stabil', () => {
    expect(stabilitaetAus(bild({ clean: 19, failed: 1 }))).toBe('gemischt')
  })

  it('benutzt genau die Schwellen aus sicherheit.ts', () => {
    expect(SCHWELLEN.mindestVersuche).toBe(10)
    expect(SCHWELLEN.fensterTage).toBe(56)
    expect(SCHWELLEN.sicher).toBe(0.9)
    expect(SCHWELLEN.unsicher).toBe(0.6)
  })
})

/* ================================================== Regeln für sich */

describe('empfehlungAus – die Tabelle', () => {
  it('Schwierigkeit bei instabiler Kür ergibt Stabilisieren', () => {
    expect(empfehlungAus('schwierigkeit', 'instabil', 3)).toBe('stabilisieren')
  })

  it('Schwierigkeit bei stabiler Kür ergibt Schwierigkeit prüfen', () => {
    expect(empfehlungAus('schwierigkeit', 'stabil', 0)).toBe('schwierigkeit_pruefen')
  })

  it('Ausführung ergibt immer Technik und Stabilität', () => {
    for (const lage of ['stabil', 'gemischt', 'instabil', 'zu_wenig_daten', 'keine_kuer'] as const) {
      expect(empfehlungAus('ausfuehrung', lage, 0)).toBe('technik_stabilitaet')
    }
  })

  it('beides sucht bei schon einem auffälligen Element zuerst Stabilität', () => {
    expect(empfehlungAus('beides', 'gemischt', 1)).toBe('stabilisieren')
    expect(empfehlungAus('beides', 'instabil', 2)).toBe('stabilisieren')
  })

  it('beides bei stabiler Kür darf Schwierigkeit prüfen', () => {
    expect(empfehlungAus('beides', 'stabil', 0)).toBe('schwierigkeit_pruefen')
  })

  it('macht aus halten höchstens Wartung, nie ein Problemgerät', () => {
    expect(empfehlungAus('halten', 'stabil', 0)).toBe('halten')
    expect(empfehlungAus('halten', 'instabil', 3)).toBe('wartung')
  })

  it('gibt ohne Wettkampffokus keine Empfehlung', () => {
    expect(empfehlungAus('zu_wenig_daten', 'stabil', 0)).toBe('zu_wenig_daten')
  })
})

describe('prioritaetAus', () => {
  it('gibt beides immer hohe Priorität', () => {
    expect(prioritaetAus('beides', false, 'stabil')).toBe('hoch')
  })

  it('gibt einer schwachen Seite hohe Priorität, wenn die Endnote darunter leidet', () => {
    expect(prioritaetAus('schwierigkeit', true, 'stabil')).toBe('hoch')
  })

  it('gibt einer schwachen Seite mittlere Priorität, wenn die Endnote trägt', () => {
    expect(prioritaetAus('schwierigkeit', false, 'stabil')).toBe('mittel')
  })

  it('hebt auf hoch, wenn zusätzlich die Kür instabil ist', () => {
    expect(prioritaetAus('schwierigkeit', false, 'instabil')).toBe('hoch')
  })

  it('lässt halten auch bei instabiler Kür halten', () => {
    expect(prioritaetAus('halten', false, 'instabil')).toBe('halten')
  })

  it('gibt ohne Vergleichsfeld zu wenig Daten', () => {
    expect(prioritaetAus('zu_wenig_daten', null, 'stabil')).toBe('zu_wenig_daten')
  })
})

describe('lageAus', () => {
  const lage = (auffaellig: number, mitAussage = true): ElementLage[] =>
    Array.from({ length: Math.max(auffaellig, mitAussage ? 1 : 0) }, (_, i) => ({
      element: element({ apparatus: 'boden', name: `E${i}` }),
      platz: i + 1, zuletzt: '2026-05-20', tageHer: 12,
      fenster: trefferbild([{ clean: 20, shaky: 0, failed: 0, with_help: 0, deleted_at: null } as any]),
      stabilitaet: 'stabil',
      auffaellig: i < auffaellig ? [{ art: 'langeHer' as const, text: 'x' }] : [],
      dringlichkeit: i < auffaellig ? 6 : 99,
    }))

  it('nennt ohne Kür keine Lage', () => {
    expect(lageAus(null, [])).toBe('keine_kuer')
  })

  it('nennt eine Kür ohne jede Aussage zu wenig Daten', () => {
    const leer: ElementLage[] = [{
      element: element({ apparatus: 'boden', name: 'E' }),
      platz: 1, zuletzt: null, tageHer: null,
      fenster: trefferbild([]), stabilitaet: 'zu_wenig_daten',
      auffaellig: [], dringlichkeit: 99,
    }]
    expect(lageAus(kuer({ apparatus: 'boden' }), leer)).toBe('zu_wenig_daten')
  })

  it('nennt eine Kür ohne Auffälligkeit stabil', () => {
    expect(lageAus(kuer({ apparatus: 'boden' }), lage(0))).toBe('stabil')
  })

  it('nennt genau eine Auffälligkeit gemischt', () => {
    expect(lageAus(kuer({ apparatus: 'boden' }), lage(1))).toBe('gemischt')
  })

  it('nennt mehrere Auffälligkeiten instabil', () => {
    expect(MEHRERE).toBe(2)
    expect(lageAus(kuer({ apparatus: 'boden' }), lage(MEHRERE))).toBe('instabil')
  })
})

/* =========================================== Die Fälle aus der Anforderung */

describe('Schwierigkeit als Fokus', () => {
  it('stabile Kür plus schwierigeres stabiles Element ergibt einen Kandidaten', () => {
    const inKuer = element({ apparatus: 'boden', name: 'Leicht', difficulty_value: 0.2 })
    const kandidat = element({ apparatus: 'boden', name: 'Schwer', difficulty_value: 0.5 })
    const k = kuer({ apparatus: 'boden' })
    const v1 = stabileVersuche(inKuer.id)
    const v2 = stabileVersuche(kandidat.id)

    const { von } = baue({
      // D schwach (Rang 5), E stark (Rang 1), Endnote unter der Mitte.
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [inKuer, kandidat],
      kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, inKuer.id, 1)],
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })

    const g = von('boden')
    expect(g.wettkampfFokus).toBe('schwierigkeit')
    expect(g.lage).toBe('stabil')
    expect(g.empfehlung).toBe('schwierigkeit_pruefen')
    expect(g.kandidaten).toHaveLength(1)
    expect(g.kandidaten[0].element.id).toBe(kandidat.id)
    expect(g.kandidaten[0].stabilitaet).toBe('stabil')
    expect(g.keineKandidaten).toBeNull()
  })

  it('instabile Kür ergibt Stabilisieren statt mehr Schwierigkeit', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const b = element({ apparatus: 'boden', name: 'B', difficulty_value: 0.3 })
    const kandidat = element({ apparatus: 'boden', name: 'Schwer', difficulty_value: 0.6 })
    const k = kuer({ apparatus: 'boden' })
    const va = instabileVersuche(a.id)
    const vb = instabileVersuche(b.id)
    const vk = stabileVersuche(kandidat.id)

    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a, b, kandidat],
      kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1), kuerPlatz(k.id, b.id, 2)],
      einheiten: [va.einheit, vb.einheit, vk.einheit],
      attempts: [...va.attempts, ...vb.attempts, ...vk.attempts],
    })

    const g = von('boden')
    expect(g.wettkampfFokus).toBe('schwierigkeit')
    expect(g.lage).toBe('instabil')
    expect(g.empfehlung).toBe('stabilisieren')
    expect(g.auffaellige.length).toBeGreaterThanOrEqual(2)
    // Der Kandidat verschwindet nicht - aber die Empfehlung zeigt woanders hin.
    expect(g.kandidaten).toHaveLength(1)
  })

  it('nennt kein Element schwieriger, wenn in der Kür kein Wert steht', () => {
    const ohneWert = element({ apparatus: 'boden', name: 'Ohne Wert' })
    const kandidat = element({ apparatus: 'boden', name: 'Schwer', difficulty_value: 0.6 })
    const k = kuer({ apparatus: 'boden' })
    const v = stabileVersuche(kandidat.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [ohneWert, kandidat], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, ohneWert.id, 1)],
      einheiten: [v.einheit], attempts: v.attempts,
    })
    expect(von('boden').kandidaten).toHaveLength(0)
    expect(von('boden').keineKandidaten).toBe('kein_vergleichswert')
  })
})

describe('Ausführung als Fokus', () => {
  it('ordnet ein auffälliges Kürelement nach vorn', () => {
    const gut = element({ apparatus: 'reck', name: 'Gut', difficulty_value: 0.3 })
    const schlecht = element({ apparatus: 'reck', name: 'Wackelt', difficulty_value: 0.3 })
    const k = kuer({ apparatus: 'reck' })
    const vg = stabileVersuche(gut.id)
    const vs = instabileVersuche(schlecht.id)

    const { von } = baue({
      // D stark (Rang 1), E schwach (Rang 5).
      geraete: [{ apparatus: 'reck', dRang: 1, eRang: 5, finalRang: 3 }],
      elemente: [gut, schlecht], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, gut.id, 1), kuerPlatz(k.id, schlecht.id, 2)],
      einheiten: [vg.einheit, vs.einheit],
      attempts: [...vg.attempts, ...vs.attempts],
    })

    const g = von('reck')
    expect(g.wettkampfFokus).toBe('ausfuehrung')
    expect(g.empfehlung).toBe('technik_stabilitaet')
    expect(g.auffaellige[0].element.id).toBe(schlecht.id)
    expect(g.auffaellige[0].stabilitaet).toBe('instabil')
  })

  it('behauptet nicht, das Element verursache den E-Abzug', () => {
    const schlecht = element({ apparatus: 'reck', name: 'Wackelt', difficulty_value: 0.3 })
    const k = kuer({ apparatus: 'reck' })
    const vs = instabileVersuche(schlecht.id)
    const { von } = baue({
      geraete: [{ apparatus: 'reck', dRang: 1, eRang: 5, finalRang: 3 }],
      elemente: [schlecht], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, schlecht.id, 1)],
      einheiten: [vs.einheit], attempts: vs.attempts,
    })
    const text = von('reck').begruendung.join(' ').toLowerCase()
    for (const wort of ['verursacht', 'kostet', 'wegen', 'schuld', 'abzug von']) {
      expect(text.includes(wort), `„${wort}" steht nicht in der Begründung`).toBe(false)
    }
    expect(text).toContain('beobachtung aus dem training')
  })
})

describe('beides als Fokus', () => {
  const bauen = (instabil: boolean) => {
    const a = element({ apparatus: 'reck', name: 'A', difficulty_value: 0.2 })
    const b = element({ apparatus: 'reck', name: 'B', difficulty_value: 0.3 })
    const k = kuer({ apparatus: 'reck' })
    const va = instabil ? instabileVersuche(a.id) : stabileVersuche(a.id)
    const vb = instabil ? instabileVersuche(b.id) : stabileVersuche(b.id)
    return baue({
      geraete: [{ apparatus: 'reck', dRang: 5, eRang: 5, finalRang: 5 }],
      elemente: [a, b], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1), kuerPlatz(k.id, b.id, 2)],
      einheiten: [va.einheit, vb.einheit],
      attempts: [...va.attempts, ...vb.attempts],
    })
  }

  it('bei instabiler Kür erst stabilisieren', () => {
    const g = bauen(true).von('reck')
    expect(g.wettkampfFokus).toBe('beides')
    expect(g.lage).toBe('instabil')
    expect(g.empfehlung).toBe('stabilisieren')
    expect(g.prioritaet).toBe('hoch')
  })

  it('bei stabiler Kür darf Schwierigkeit geprüft werden', () => {
    const g = bauen(false).von('reck')
    expect(g.wettkampfFokus).toBe('beides')
    expect(g.lage).toBe('stabil')
    expect(g.empfehlung).toBe('schwierigkeit_pruefen')
  })
})

describe('halten als Fokus', () => {
  it('sucht keine Probleme', () => {
    const a = element({ apparatus: 'sprung', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'sprung' })
    const va = stabileVersuche(a.id)
    const { von } = baue({
      geraete: [{ apparatus: 'sprung', dRang: 1, eRang: 1, finalRang: 1 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [va.einheit], attempts: va.attempts,
    })
    const g = von('sprung')
    expect(g.wettkampfFokus).toBe('halten')
    expect(g.prioritaet).toBe('halten')
    expect(g.empfehlung).toBe('halten')
    expect(g.auffaellige).toHaveLength(0)
  })

  it('wird bei einem auffälligen Element zur Wartung, nicht zum Problem', () => {
    const a = element({ apparatus: 'sprung', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'sprung' })
    // Lange nicht trainiert: Versuche liegen weit zurueck.
    const va = versuche({ elementId: a.id, tag: '2026-03-01', clean: 20 })
    const { von } = baue({
      geraete: [{ apparatus: 'sprung', dRang: 1, eRang: 1, finalRang: 1 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [va.einheit], attempts: va.attempts,
    })
    const g = von('sprung')
    expect(g.prioritaet).toBe('halten')
    expect(g.empfehlung).toBe('wartung')
    expect(g.auffaellige).toHaveLength(1)
    expect(g.auffaellige[0].auffaellig.some((x) => x.art === 'langeHer')).toBe(true)
  })
})

/* ================================================== Fehlende Daten */

describe('Fehlende Daten', () => {
  it('ohne Wettkampf gibt es keine Priorität und keine Empfehlung', () => {
    const { bild, von } = baue({ ohneWettkampf: true })
    expect(bild.hatWettkampf).toBe(false)
    for (const g of bild.geraete) {
      expect(g.wettkampfFokus).toBe('zu_wenig_daten')
      expect(g.prioritaet).toBe('zu_wenig_daten')
      expect(g.empfehlung).toBe('zu_wenig_daten')
    }
    expect(von('boden').begruendung[0]).toContain('kein Wettkampfergebnis')
  })

  it('ohne Vergleichswerte gibt es keinen Fokus, aber die Werte bleiben', () => {
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      ohneBenchmarks: true,
    })
    const g = von('boden')
    expect(g.wettkampfFokus).toBe('zu_wenig_daten')
    expect(g.prioritaet).toBe('zu_wenig_daten')
    expect(g.begruendung[0]).toContain('kein Vergleichsfeld')
  })

  it('ohne Trainingsdaten sagt die Begründung genau das', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'boden' })
    const { bild, von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
    })
    expect(bild.hatTraining).toBe(false)
    const g = von('boden')
    expect(g.lage).not.toBe('stabil')
    expect(g.kuerQuote).toBeNull()
    expect(g.begruendung.join(' ')).toContain('fehlt die Trainingsbasis')
    // Der Wettkampfbefund bleibt trotzdem stehen.
    expect(g.wettkampfFokus).toBe('schwierigkeit')
  })

  it('ohne aktive Wettkampfkür gibt es keine Elementebene', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const ohneMarke = kuer({ apparatus: 'boden', seit: null })
    const va = stabileVersuche(a.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [ohneMarke],
      verknuepfungen: [kuerPlatz(ohneMarke.id, a.id, 1)],
      einheiten: [va.einheit], attempts: va.attempts,
    })
    const g = von('boden')
    expect(g.kuer).toBeNull()
    expect(g.lage).toBe('keine_kuer')
    expect(g.kuerElemente).toHaveLength(0)
    expect(g.keineKandidaten).toBe('keine_kuer')
    expect(g.begruendung.join(' ')).toContain('keine Wettkampfkür')
  })
})

/* ================================================== Elementsonderfälle */

describe('Elementsonderfälle', () => {
  it('nimmt ein archiviertes Element nicht als Kandidat', () => {
    const inKuer = element({ apparatus: 'boden', name: 'Leicht', difficulty_value: 0.2 })
    const archiv = element({
      apparatus: 'boden', name: 'Archiviert', difficulty_value: 0.6, is_active: 0,
    })
    const k = kuer({ apparatus: 'boden' })
    const v1 = stabileVersuche(inKuer.id)
    const v2 = stabileVersuche(archiv.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [inKuer, archiv], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, inKuer.id, 1)],
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })
    expect(von('boden').kandidaten).toHaveLength(0)
    expect(von('boden').keineKandidaten).toBe('keine_schwierigeren')
  })

  it('meldet ein archiviertes Element, das in der Kür steht', () => {
    const archiv = element({
      apparatus: 'boden', name: 'Archiviert', difficulty_value: 0.2, is_active: 0,
    })
    const k = kuer({ apparatus: 'boden' })
    const v = stabileVersuche(archiv.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [archiv], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, archiv.id, 1)],
      einheiten: [v.einheit], attempts: v.attempts,
    })
    const g = von('boden')
    expect(g.kuerElemente[0].auffaellig.some((x) => x.art === 'archiviert')).toBe(true)
  })

  it('führt einen Kürplatz mit gelöschtem Element getrennt auf', () => {
    const da = element({ apparatus: 'boden', name: 'Da', difficulty_value: 0.2 })
    const weg = element({ apparatus: 'boden', name: 'Weg', deleted_at: '2026-04-01' })
    const k = kuer({ apparatus: 'boden' })
    const v = stabileVersuche(da.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [da, weg], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, da.id, 1), kuerPlatz(k.id, weg.id, 2)],
      einheiten: [v.einheit], attempts: v.attempts,
    })
    const g = von('boden')
    expect(g.geloeschtePlaetze).toEqual([2])
    expect(g.kuerElemente).toHaveLength(1)
  })

  it('erkennt ein Element, das lange nicht trainiert wurde', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'boden' })
    const v = versuche({ elementId: a.id, tag: '2026-04-01', clean: 20 })
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [v.einheit], attempts: v.attempts,
    })
    const lage = von('boden').kuerElemente[0]
    expect(lage.tageHer).toBe(61)
    expect(lage.auffaellig.some((x) => x.art === 'langeHer')).toBe(true)
    expect(KUER_SCHWELLEN.langeHerTage).toBe(28)
  })

  it('zeigt viele Versuche mit Hilfe als Auffälligkeit', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'boden' })
    const v = versuche({ elementId: a.id, tag: '2026-05-20', clean: 20, hilfe: true })
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [v.einheit], attempts: v.attempts,
    })
    const lage = von('boden').kuerElemente[0]
    expect(lage.stabilitaet).toBe('gemischt')
    expect(lage.auffaellig.some((x) => x.art === 'mitHilfe')).toBe(true)
  })

  it('zählt einen nicht nachgezogenen Status nicht gegen die eigenen Zahlen', () => {
    // Beim Anlegen steht jedes Element auf „neu". Hat es danach 20 von 20
    // Versuchen sauber, ist „neu" ein nicht nachgezogener Eintrag und kein
    // Trainingsproblem - sonst gilt eine Kuer mit lauter gelungenen Versuchen
    // als instabil. Genau das ist im E2E aufgefallen.
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2, status: 'neu' })
    const b = element({ apparatus: 'boden', name: 'B', difficulty_value: 0.3, status: 'neu' })
    const k = kuer({ apparatus: 'boden' })
    const va = stabileVersuche(a.id)
    const vb = stabileVersuche(b.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a, b], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1), kuerPlatz(k.id, b.id, 2)],
      einheiten: [va.einheit, vb.einheit],
      attempts: [...va.attempts, ...vb.attempts],
    })
    const g = von('boden')
    for (const l of g.kuerElemente) {
      expect(l.stabilitaet).toBe('stabil')
      expect(l.auffaellig, `${l.element.name} ohne Auffälligkeit`).toHaveLength(0)
    }
    expect(g.lage).toBe('stabil')
    expect(g.empfehlung).toBe('schwierigkeit_pruefen')
  })

  it('zählt den Status, wo die Datenlage nichts sagt', () => {
    // Ohne genug Versuche ist der gesetzte Status die einzige Auskunft - dann
    // muss er zaehlen.
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2, status: 'aufbau' })
    const k = kuer({ apparatus: 'boden' })
    const va = versuche({ elementId: a.id, tag: '2026-05-20', clean: 2 })
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [va.einheit], attempts: va.attempts,
    })
    const l = von('boden').kuerElemente[0]
    expect(l.stabilitaet).toBe('zu_wenig_daten')
    expect(l.auffaellig.some((x) => x.art === 'statusAufbau')).toBe(true)
  })

  it('zählt den Status auch bei gemischter Datenlage', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2, status: 'unsicher' })
    const k = kuer({ apparatus: 'boden' })
    const va = versuche({ elementId: a.id, tag: '2026-05-20', clean: 14, shaky: 6 })
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [va.einheit], attempts: va.attempts,
    })
    const l = von('boden').kuerElemente[0]
    expect(l.stabilitaet).toBe('gemischt')
    expect(l.auffaellig.some((x) => x.art === 'statusUnsicher')).toBe(true)
  })

  it('nennt ein Element, das nicht in der Kür steht, nicht auffällig', () => {
    const inKuer = element({ apparatus: 'boden', name: 'Drin', difficulty_value: 0.2 })
    const draussen = element({ apparatus: 'boden', name: 'Draussen', difficulty_value: 0.1 })
    const k = kuer({ apparatus: 'boden' })
    const v1 = stabileVersuche(inKuer.id)
    const v2 = instabileVersuche(draussen.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [inKuer, draussen], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, inKuer.id, 1)],
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })
    const g = von('boden')
    expect(g.lage).toBe('stabil')
    expect(g.auffaellige).toHaveLength(0)
    // Und er ist auch kein Kandidat: niedrigerer Wert, dazu instabil.
    expect(g.kandidaten).toHaveLength(0)
  })

  it('nimmt ein schwierigeres, aber instabiles Element nicht als Kandidat', () => {
    const inKuer = element({ apparatus: 'boden', name: 'Leicht', difficulty_value: 0.2 })
    const wackelig = element({ apparatus: 'boden', name: 'Schwer wackelig', difficulty_value: 0.7 })
    const k = kuer({ apparatus: 'boden' })
    const v1 = stabileVersuche(inKuer.id)
    const v2 = instabileVersuche(wackelig.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [inKuer, wackelig], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, inKuer.id, 1)],
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })
    expect(von('boden').kandidaten).toHaveLength(0)
    expect(von('boden').keineKandidaten).toBe('keine_stabilen')
  })

  it('nimmt ein Element eines anderen Geräts nicht als Kandidat', () => {
    const inKuer = element({ apparatus: 'boden', name: 'Leicht', difficulty_value: 0.2 })
    const fremd = element({ apparatus: 'reck', name: 'Reckelement', difficulty_value: 0.9 })
    const k = kuer({ apparatus: 'boden' })
    const v1 = stabileVersuche(inKuer.id)
    const v2 = stabileVersuche(fremd.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [inKuer, fremd], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, inKuer.id, 1)],
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })
    expect(von('boden').kandidaten).toHaveLength(0)
  })
})

/* ================================================== Mehrere Wettkämpfe */

describe('Mehrere Wettkämpfe', () => {
  const punkt = (
    tag: string, position: number | null,
    seiten: { d?: number | null; e?: number | null } = {},
  ): VerlaufsPunkt => ({
    competitionId: `c-${tag}`, day: tag, name: 'W', d: 3, e: 8, final: 11,
    rang: 2, gleich: 1, anzahl: 6, position,
    dPosition: seiten.d ?? null, ePosition: seiten.e ?? null,
    abstandMedian: 0,
  })

  it('nennt bei zwei Wettkämpfen noch keine Richtung', () => {
    const h = verlaufshinweisFuer([punkt('2026-01-01', 0.2), punkt('2026-05-10', 0.8)])
    expect(h).toContain('ohne durchgehende Richtung')
  })

  it('nennt eine durchgehend fallende Reihe beschreibend', () => {
    const h = verlaufshinweisFuer([
      punkt('2026-01-01', 0.8), punkt('2026-03-01', 0.6), punkt('2026-05-10', 0.4)])
    expect(h).toContain('durchgehend niedriger')
    // Keine Ursache.
    expect(h?.toLowerCase()).not.toContain('weil')
    expect(h?.toLowerCase()).not.toContain('training')
  })

  it('nennt eine durchgehend steigende Reihe beschreibend', () => {
    const h = verlaufshinweisFuer([
      punkt('2026-01-01', 0.2), punkt('2026-03-01', 0.5), punkt('2026-05-10', 0.9)])
    expect(h).toContain('durchgehend höher')
  })

  it('nennt die Seite, die sich bewegt hat – nicht nur die Endnote', () => {
    const h = verlaufshinweisFuer([
      punkt('2026-01-01', 0.8, { e: 0.9 }),
      punkt('2026-03-01', 0.6, { e: 0.6 }),
      punkt('2026-05-10', 0.4, { e: 0.3 }),
    ])
    expect(h).toContain('Ausführung')
    expect(h).toContain('durchgehend niedriger')
  })

  it('nennt die Schwierigkeit, wenn sie sich bewegt hat', () => {
    const h = verlaufshinweisFuer([
      punkt('2026-01-01', 0.4, { d: 0.2 }),
      punkt('2026-03-01', 0.6, { d: 0.5 }),
      punkt('2026-05-10', 0.8, { d: 0.9 }),
    ])
    expect(h).toContain('Schwierigkeit')
    expect(h).toContain('durchgehend höher')
  })

  it('sagt bei einem einzigen Wettkampf nichts', () => {
    expect(verlaufshinweisFuer([punkt('2026-05-10', 0.4)])).toBeNull()
  })

  it('übergeht Wettkämpfe ohne Vergleichsfeld', () => {
    expect(verlaufshinweisFuer([punkt('2026-01-01', null), punkt('2026-05-10', 0.4)])).toBeNull()
  })

  it('hängt den Hinweis an das Gerät', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'boden' })
    const v = stabileVersuche(a.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [v.einheit], attempts: v.attempts,
      verlauf: new Map([['boden', [
        punkt('2026-01-01', 0.8), punkt('2026-03-01', 0.6), punkt('2026-05-10', 0.4)]]]),
    })
    expect(von('boden').verlaufshinweis).toContain('durchgehend niedriger')
    expect(von('reck').verlaufshinweis).toBeNull()
  })

  it('nimmt den jüngsten Wettkampf als Momentaufnahme', () => {
    // Die Empfehlung haengt am uebergebenen `analyse`, und das ist in
    // `analyseBild` der juengste Wettkampf mit Ergebnissen (Phase 2C).
    const alt = {
      id: 'alt', day: '2024-01-01', name: 'Alter Wettkampf', class_name: 'LK 2',
      rank_allround: 6, score_allround: 50, deleted_at: null,
    } as unknown as GymCompetition
    const analyse = wettkampfAnalyse(alt, [{
      id: 'r-alt', competition_id: 'alt', apparatus: 'boden',
      d_score: 3, e_score: 8, final_score: 11, deleted_at: null,
    } as unknown as GymResult], [])
    expect(analyse.geraete[0].fokus).toBe('zu_wenig_daten')
  })
})

/* ============================================ Gleichstände aus Phase 2C */

describe('Gleichstände aus Phase 2C', () => {
  it('macht aus einem vollständig gleichen Feld kein Problemgerät', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'boden' })
    const v = stabileVersuche(a.id)
    // Alle sechs geteilt Erste an D, E und Endnote: Position 0,5 -> halten.
    const teil = wettkampfteil([])
    const wk = teil.wk
    const ergebnisse = [{
      id: 'r-boden', competition_id: WK_ID, apparatus: 'boden',
      d_score: 3, e_score: 8, final_score: 11, deleted_at: null,
    } as unknown as GymResult]
    const benchmarks: VergleichsWerte[] = [{
      competition_id: WK_ID, scope: 'boden', cohort_label: 'LK 2', cohort_size: 6,
      final_rank: 1, final_tie_count: 6, final_count: 6, final_median: 11, final_best: 11,
      d_rank: 1, d_tie_count: 6, d_count: 6, d_median: 3, d_best: 3,
      e_rank: 1, e_tie_count: 6, e_count: 6, e_median: 8, e_best: 8,
    }]
    const bild = trainingsfokus({
      analyse: wettkampfAnalyse(wk, ergebnisse, benchmarks),
      verlauf: new Map(),
      elemente: [a], versuche: v.attempts, einheiten: [v.einheit],
      kueren: [k], kuerVerknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      heute: HEUTE, tagDifferenz: diffDays,
    })
    const g = bild.geraete.find((x) => x.apparatus === 'boden')!
    expect(g.wettkampfFokus).toBe('halten')
    expect(g.prioritaet).toBe('halten')
    expect(g.empfehlung).toBe('halten')
  })
})

/* ================================================== Reihenfolge */

describe('Reihenfolge der Geräte', () => {
  it('stellt hohe Priorität vor mittlere vor halten', () => {
    const { bild } = baue({
      geraete: [
        { apparatus: 'sprung', dRang: 1, eRang: 1, finalRang: 1 },   // halten
        { apparatus: 'reck', dRang: 5, eRang: 5, finalRang: 5 },     // beides -> hoch
        { apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 2 },    // Endnote traegt -> mittel
      ],
    })
    const reihe = bild.geraete
      .filter((g) => g.prioritaet !== 'zu_wenig_daten')
      .map((g) => `${g.apparatus}:${g.prioritaet}`)
    expect(reihe).toEqual(['reck:hoch', 'boden:mittel', 'sprung:halten'])
  })

  it('führt Geräte ohne Wettkampfergebnis am Ende', () => {
    const { bild } = baue({
      geraete: [{ apparatus: 'reck', dRang: 5, eRang: 5, finalRang: 5 }],
    })
    expect(bild.geraete[0].apparatus).toBe('reck')
    expect(bild.geraete[bild.geraete.length - 1].prioritaet).toBe('zu_wenig_daten')
  })
})

/* ================================================== Quote und Fenster */

describe('kuerQuoteAus', () => {
  const lage = (clean: number, versucheGesamt: number): ElementLage => ({
    element: element({ apparatus: 'boden', name: 'E' }),
    platz: 1, zuletzt: '2026-05-20', tageHer: 12,
    fenster: {
      versuche: versucheGesamt, clean, shaky: versucheGesamt - clean, failed: 0,
      mitHilfe: 0, quote: versucheGesamt ? clean / versucheGesamt : null,
    },
    stabilitaet: 'stabil', auffaellig: [], dringlichkeit: 99,
  })

  it('nennt unter zehn Versuchen keine Quote', () => {
    expect(kuerQuoteAus([lage(5, 9)])).toBeNull()
  })

  it('rechnet über alle Kürelemente zusammen', () => {
    const q = kuerQuoteAus([lage(9, 10), lage(9, 10)])
    expect(q).toEqual({ quote: 0.9, versuche: 20 })
  })

  it('nennt bei leerer Kür keine Quote', () => {
    expect(kuerQuoteAus([])).toBeNull()
  })
})

/* ======================================== Was ausdrücklich nicht behauptet wird */

describe('Grenzen werden nicht überschritten', () => {
  it('verspricht nirgends einen D-Wert-Gewinn', () => {
    const inKuer = element({ apparatus: 'boden', name: 'Leicht', difficulty_value: 0.2 })
    const kandidat = element({ apparatus: 'boden', name: 'Schwer', difficulty_value: 0.5 })
    const k = kuer({ apparatus: 'boden' })
    const v1 = stabileVersuche(inKuer.id)
    const v2 = stabileVersuche(kandidat.id)
    const { bild } = baue({
      geraete: [{ apparatus: 'boden', dRang: 5, eRang: 1, finalRang: 5 }],
      elemente: [inKuer, kandidat], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, inKuer.id, 1)],
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })
    const text = JSON.stringify(bild).toLowerCase()
    for (const wort of ['erhöht deinen', 'bringt 0,', 'bringt dir', 'd-wert um']) {
      expect(text.includes(wort), `„${wort}" kommt nicht vor`).toBe(false)
    }
  })

  it('behauptet nirgends, eine Kür sei am Stück sicher', () => {
    const a = element({ apparatus: 'boden', name: 'A', difficulty_value: 0.2 })
    const k = kuer({ apparatus: 'boden' })
    const v = stabileVersuche(a.id)
    const { bild } = baue({
      geraete: [{ apparatus: 'boden', dRang: 1, eRang: 1, finalRang: 1 }],
      elemente: [a], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, a.id, 1)],
      einheiten: [v.einheit], attempts: v.attempts,
    })
    const text = JSON.stringify(bild).toLowerCase()
    for (const wort of ['kür sitzt', 'am stück sicher', 'durchturnfähig', 'kür ist sicher']) {
      expect(text.includes(wort), `„${wort}" kommt nicht vor`).toBe(false)
    }
  })
})

/* ============================ Grundwahrheit: Eriks echter Wettkampf */

/**
 * Gegen Eriks Protokoll – aber **ohne** erwartete Elementnamen.
 *
 * Der Bestand enthält seinen Wettkampf, keine Trainingsdaten und keine Küren.
 * Genau das ist der Prüfgegenstand: Die Gerätepriorität muss aus dem Wettkampf
 * entstehen, und auf der Elementebene darf **nichts** erfunden werden.
 */
describe('Eriks echter Wettkampf – Priorität ohne Trainingsdaten', () => {
  const seiten = JSON.parse(
    readFileSync(new URL('./fixtures/protokoll-score-2026.json', import.meta.url), 'utf8'))
  const protokoll = parseProtokoll(seiten)
  const erik = protokoll.teilnehmer.filter((t) => (t.name.wert ?? '').startsWith('Ehnert'))[0]
  const v = vergleichFuer(protokoll, erik)

  const wk = {
    id: 'sachsen', day: '2026-05-10', name: 'Sächsische Einzelmeisterschaften',
    class_name: erik.klasse, rank_allround: erik.rang.wert,
    score_allround: erik.gesamt.wert, deleted_at: null,
  } as unknown as GymCompetition
  const ergebnisse = erik.geraete.map((g) => ({
    id: `r-${g.apparatus}`, competition_id: 'sachsen', apparatus: g.apparatus,
    d_score: g.d.wert, e_score: g.e.wert, penalty: g.penalty.wert,
    final_score: g.final.wert, rank_apparatus: null, deleted_at: null,
  }) as unknown as GymResult)
  const benchmarks = benchmarkWerte('sachsen', v.zeilen, 'jetzt')
    .map((w) => w.values as unknown as VergleichsWerte)

  const bild = trainingsfokus({
    analyse: wettkampfAnalyse(wk, ergebnisse, benchmarks),
    verlauf: new Map(),
    elemente: [], versuche: [], einheiten: [],
    kueren: [], kuerVerknuepfungen: [],
    heute: HEUTE, tagDifferenz: diffDays,
  })
  const von = (apparatus: string) =>
    bild.geraete.find((x) => x.apparatus === apparatus)!

  /** Die Phase-2C-Ergebnisse bleiben, was sie sind. */
  const FOKUS: Record<string, string> = {
    boden: 'schwierigkeit',
    pauschenpferd: 'halten',
    ringe: 'halten',
    sprung: 'halten',
    barren: 'schwierigkeit',
    reck: 'beides',
  }

  for (const [apparatus, fokus] of Object.entries(FOKUS)) {
    it(`${apparatus}: Wettkampffokus bleibt ${fokus}`, () => {
      expect(von(apparatus).wettkampfFokus).toBe(fokus)
    })
  }

  /**
   * Die erwartete Priorität – gerechnet, nicht gesetzt.
   *
   * Boden und Barren: Die Schwierigkeit liegt unter dem Feld UND die Endnote
   * liegt unter der Feldmitte (Platz 4 von 6) – es kostet Plätze, also hoch.
   * Reck: beide Seiten unten, also hoch. Die übrigen drei stehen im Feld vorn.
   */
  const PRIORITAET: Record<string, string> = {
    boden: 'hoch',
    barren: 'hoch',
    reck: 'hoch',
    pauschenpferd: 'halten',
    ringe: 'halten',
    sprung: 'halten',
  }

  for (const [apparatus, p] of Object.entries(PRIORITAET)) {
    it(`${apparatus}: Priorität ${p}`, () => {
      expect(von(apparatus).prioritaet).toBe(p)
    })
  }

  it('führt die drei Geräte mit hoher Priorität vorn', () => {
    expect(bild.geraete.slice(0, 3).map((g) => g.apparatus).sort())
      .toEqual(['barren', 'boden', 'reck'])
  })

  it('leitet ohne Trainingsdaten kein einziges Element ab', () => {
    for (const g of bild.geraete) {
      expect(g.kuerElemente, `${g.apparatus} Kürelemente`).toHaveLength(0)
      expect(g.auffaellige, `${g.apparatus} auffällige`).toHaveLength(0)
      expect(g.kandidaten, `${g.apparatus} Kandidaten`).toHaveLength(0)
      expect(g.lage).toBe('keine_kuer')
      expect(g.kuerQuote).toBeNull()
    }
    expect(bild.hatTraining).toBe(false)
  })

  it('sagt an den Geräten mit Fokus, dass die Trainingsbasis fehlt', () => {
    for (const apparatus of ['boden', 'barren', 'reck']) {
      const text = von(apparatus).begruendung.join(' ')
      expect(text, apparatus).toContain('keine Wettkampfkür')
    }
  })

  it('nennt trotzdem die Wettkampfrichtung – der Befund bleibt', () => {
    expect(von('boden').empfehlung).toBe('schwierigkeit_pruefen')
    expect(von('barren').empfehlung).toBe('schwierigkeit_pruefen')
    expect(von('reck').empfehlung).toBe('schwierigkeit_pruefen')
    expect(von('sprung').empfehlung).toBe('halten')
  })

  it('macht aus dem Sprung kein Problemgerät, obwohl die Rohnote niedrig ist', () => {
    // Derselbe Prüfstein wie in Phase 2C, eine Ebene weiter: 11,000 war die
    // niedrigste seiner vier besten Noten und trotzdem Platz 1.
    expect(von('sprung').prioritaet).toBe('halten')
    expect(von('sprung').empfehlung).toBe('halten')
  })

  it('nennt in den Begründungen die echten Plätze', () => {
    const boden = von('boden').begruendung.join(' ')
    expect(boden).toContain('Platz 1 von 6')
    expect(boden).toContain('Platz 4 geteilt von 6')
  })
})

/* ============================================================ Leistung */

/**
 * Der Trainingsfokus muss einen echten Bestand in einem Durchgang schaffen.
 *
 * Gemessen wird der Aufruf, den die Oberfläche macht – einmal je Datenänderung,
 * nicht je Zeichnen. Die Schwelle ist grosszügig: Sie soll eine Regression
 * fangen, die je Gerät und Element erneut über alle Versuche läuft.
 */
describe('Leistung', () => {
  const WETTKAEMPFE = 100
  const ELEMENTE = 100
  const EINHEITEN = 200

  const alleGeraete = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']

  const wettkaempfe: GymCompetition[] = []
  const ergebnisse: GymResult[] = []
  const benchmarks: VergleichsWerte[] = []
  for (let i = 0; i < WETTKAEMPFE; i++) {
    const wid = `wk-${i}`
    wettkaempfe.push({
      id: wid, day: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      name: `W ${i}`, class_name: 'LK 2', rank_allround: 2, score_allround: 60,
      deleted_at: null,
    } as unknown as GymCompetition)
    for (const [j, apparatus] of alleGeraete.entries()) {
      ergebnisse.push({
        id: `${wid}-${apparatus}`, competition_id: wid, apparatus,
        d_score: 3, e_score: 8, penalty: null, final_score: 11,
        rank_apparatus: null, deleted_at: null,
      } as unknown as GymResult)
      benchmarks.push({
        competition_id: wid, scope: apparatus, cohort_label: 'LK 2', cohort_size: 6,
        final_rank: (j % 6) + 1, final_tie_count: 1, final_count: 6,
        final_median: 11, final_best: 12,
        d_rank: (j % 6) + 1, d_tie_count: 1, d_count: 6, d_median: 3, d_best: 4,
        e_rank: ((j + 2) % 6) + 1, e_tie_count: 1, e_count: 6, e_median: 8, e_best: 9,
      })
    }
    benchmarks.push({
      competition_id: wid, scope: 'mehrkampf', cohort_label: 'LK 2', cohort_size: 6,
      final_rank: 2, final_tie_count: 1, final_count: 6, final_median: 60, final_best: 66,
    })
  }

  const vieleElemente: GymElement[] = []
  for (let i = 0; i < ELEMENTE; i++) {
    vieleElemente.push(element({
      apparatus: alleGeraete[i % 6],
      name: `Element ${i}`,
      difficulty_value: 0.1 + (i % 9) * 0.1,
      status: i % 4 === 0 ? 'unsicher' : 'sicher',
    }))
  }

  const kueren: GymRoutine[] = []
  const verknuepfungen: GymRoutineElement[] = []
  for (const apparatus of alleGeraete) {
    const k = kuer({ apparatus })
    kueren.push(k)
    const eigene = vieleElemente.filter((x) => x.apparatus === apparatus).slice(0, 8)
    for (const [pos, el] of eigene.entries()) {
      verknuepfungen.push(kuerPlatz(k.id, el.id, pos + 1))
    }
  }

  // Mehrere tausend Versuche, verteilt ueber 200 Einheiten.
  const einheiten: any[] = []
  const attempts: GymAttempt[] = []
  for (let i = 0; i < EINHEITEN; i++) {
    const tag = `2026-0${(i % 5) + 1}-${String((i % 28) + 1).padStart(2, '0')}`
    const sid = `sess-${i}`
    einheiten.push({ id: sid, day: tag, deleted_at: null })
    for (let j = 0; j < 20; j++) {
      const el = vieleElemente[(i * 20 + j) % ELEMENTE]
      attempts.push({
        id: `att-${i}-${j}`, session_id: sid, element_id: el.id,
        clean: 3, shaky: 1, failed: 0, with_help: 0, note: null, sort_order: j,
        deleted_at: null,
      } as unknown as GymAttempt)
    }
  }

  it('hat den erwarteten Bestand', () => {
    expect(wettkaempfe).toHaveLength(100)
    expect(ergebnisse).toHaveLength(600)
    expect(benchmarks).toHaveLength(700)
    expect(vieleElemente).toHaveLength(100)
    expect(attempts.length).toBeGreaterThanOrEqual(4000)
  })

  it('rechnet Analyse und Trainingsfokus zusammen unter 250 ms', () => {
    const t0 = performance.now()
    const analyse = analyseBild(wettkaempfe, ergebnisse, benchmarks)
    const bild = trainingsfokus({
      analyse: analyse.aktuell,
      verlauf: analyse.verlauf,
      elemente: vieleElemente,
      versuche: attempts,
      einheiten,
      kueren,
      kuerVerknuepfungen: verknuepfungen,
      heute: HEUTE,
      tagDifferenz: diffDays,
    })
    const dauer = performance.now() - t0
    expect(bild.geraete).toHaveLength(6)
    expect(bild.hatTraining).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`  trainingsfokus(): ${dauer.toFixed(1)} ms für 100 Wettkämpfe, `
      + `${attempts.length} Versuche, 100 Elemente`)
    expect(dauer).toBeLessThan(250)
  })

  it('wertet jedes Element nur einmal aus – Kosten wachsen nicht je Gerät', () => {
    const messe = (n: number) => {
      const els = vieleElemente.slice(0, n)
      const ids = new Set(els.map((x) => x.id))
      const att = attempts.filter((a) => ids.has(a.element_id))
      const t0 = performance.now()
      trainingsfokus({
        analyse: null, verlauf: new Map(), elemente: els, versuche: att,
        einheiten, kueren, kuerVerknuepfungen: verknuepfungen,
        heute: HEUTE, tagDifferenz: diffDays,
      })
      return performance.now() - t0
    }
    messe(10)
    const klein = Math.max(messe(10), 0.05)
    const gross = messe(100)
    // Zehnmal so viele Elemente duerfen nicht hundertmal so lange dauern.
    expect(gross / klein).toBeLessThan(40)
  })
})
