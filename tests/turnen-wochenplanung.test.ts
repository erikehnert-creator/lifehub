/**
 * Wochenplanung – Termine, Verteilung, Nutzerwahl, Tagesgrenzen.
 *
 * ---------------------------------------------------------------------------
 * Der Eingang kommt aus der echten Phase-3A-Rechnung
 *
 * `trainingsplanung()` wird nicht nachgebaut, sondern aufgerufen – und die
 * sitzt ihrerseits auf `wettkampfAnalyse()`, `trainingsfokus()` und
 * `durchgaengeJeGeraet()`. Sonst prüfte diese Datei nur ihre eigene Annahme
 * darüber, was 3A liefert, und ginge weiter durch, nachdem 3A sich geändert hat.
 *
 * Zugesichert werden Kategorien und Zuordnungen: welches Gerät an welchem Tag,
 * welche Rolle, was offen bleibt. Nie deutsche Sätze, nie ein Elementname.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { addDays, diffDays } from '../src/core/dates'
import { BRAUCHT_ARBEIT } from '../src/core/turnen/status'
import { GERAETE } from '../src/core/turnen/geraete'
import { fassungsId, fassungsInhalt } from '../src/core/turnen/fassungen'
import { bloeckeMitTag, geraetBilder } from '../src/core/turnen/elemente'
import { durchgaengeJeGeraet } from '../src/core/turnen/kuerdurchgaenge'
import { wettkampfAnalyse, type VergleichsWerte } from '../src/core/turnen/analyse'
import { trainingsfokus } from '../src/core/turnen/trainingsfokus'
import {
  PLAN_SCHWELLEN, planMitAuswahl, trainingsplanung, type PlanungsBild,
} from '../src/core/turnen/trainingsplanung'
import {
  WOCHEN_SCHWELLEN, einheitenLabel, kapazitaetAus, plaetzeFuer, wocheMitAuswahl,
  wochenplanung,
  type GeplanteEinheit, type TerminEingang, type WochenBild,
} from '../src/core/turnen/wochenplanung'
import type {
  GymAttempt, GymCompetition, GymElement, GymResult, GymRoutine,
  GymRoutineElement, GymRoutineRun, GymRoutineVersion,
} from '../src/core/types'

const HEUTE = '2026-06-01' // ein Montag
const WK_ID = 'wk1'

let lauf = 0
const id = (p: string) => `${p}-${++lauf}`

/* ------------------------------------------------------------- Bausteine */

function element(o: {
  name: string
  apparatus?: string
  wert?: number
}): GymElement {
  return {
    id: id('el'),
    apparatus: o.apparatus ?? 'boden',
    name: o.name,
    difficulty_letter: null,
    difficulty_value: o.wert ?? 0.2,
    element_group: null,
    is_dismount: 0,
    hold_element: 0,
    status: 'sicher',
    video_url: null,
    note: null,
    is_active: 1,
    deleted_at: null,
  } as unknown as GymElement
}

function kuer(o: { apparatus?: string }): GymRoutine {
  return {
    id: id('k'),
    apparatus: o.apparatus ?? 'boden',
    name: `Kür ${o.apparatus ?? 'boden'}`,
    is_active: 1,
    competition_since: '2026-01-01T10:00:00.000Z',
    deleted_at: null,
  } as unknown as GymRoutine
}

function platz(routineId: string, elementId: string, position: number): GymRoutineElement {
  return {
    id: id('re'),
    routine_id: routineId,
    element_id: elementId,
    position,
    created_at: `2026-01-01T00:00:0${position}.000Z`,
    deleted_at: null,
  } as unknown as GymRoutineElement
}

function fassung(k: GymRoutine, verkn: GymRoutineElement[], els: GymElement[]): GymRoutineVersion {
  return {
    id: fassungsId(fassungsInhalt(k, verkn, els)),
    routine_id: k.id,
    apparatus: k.apparatus,
    name: k.name,
    frozen_at: '2026-05-01T10:00:00.000Z',
    deleted_at: null,
  } as unknown as GymRoutineVersion
}

const einheit = (idStr: string, day: string) => ({ id: idStr, day, deleted_at: null })

function versuche(o: {
  elementId: string
  tag: string
  clean?: number
  shaky?: number
  failed?: number
}): { einheit: any; attempts: GymAttempt[] } {
  const sid = id('s')
  return {
    einheit: einheit(sid, o.tag),
    attempts: [{
      id: id('a'),
      session_id: sid,
      element_id: o.elementId,
      clean: o.clean ?? 0,
      shaky: o.shaky ?? 0,
      failed: o.failed ?? 0,
      with_help: 0,
      note: null,
      sort_order: 0,
      deleted_at: null,
    } as unknown as GymAttempt],
  }
}

const stabil = (elementId: string, tag = '2026-05-20') =>
  versuche({ elementId, tag, clean: 20 })
const instabil = (elementId: string, tag = '2026-05-20') =>
  versuche({ elementId, tag, clean: 4, shaky: 4, failed: 4 })

function run(o: {
  sessionId: string
  versionId: string
  completed?: boolean
  sort?: number
}): GymRoutineRun {
  return {
    id: id('run'),
    session_id: o.sessionId,
    routine_version_id: o.versionId,
    completed: o.completed === false ? 0 : 1,
    falls: 0,
    interruptions: 0,
    with_help: 0,
    quality: null,
    note: null,
    sort_order: o.sort ?? 0,
    created_at: `2026-05-01T1${o.sort ?? 0}:00:00.000Z`,
    deleted_at: null,
  } as unknown as GymRoutineRun
}

/* -------------------------------------------------------- Wettkampfteil */

interface WkGeraet {
  apparatus: string
  dRang: number
  eRang: number
  finalRang: number
}

function wettkampfteil(geraete: WkGeraet[]) {
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
      d_rank: g.dRang, d_tie_count: 1, d_count: 6, d_median: 3, d_best: 4,
      e_rank: g.eRang, e_tie_count: 1, e_count: 6, e_median: 8, e_best: 9,
    })
  }
  return { wk, ergebnisse, benchmarks }
}

const SCHWIERIGKEIT = { dRang: 5, eRang: 1, finalRang: 5 }
const BEIDES = { dRang: 5, eRang: 5, finalRang: 5 }
const HALTEN = { dRang: 1, eRang: 1, finalRang: 1 }
const SCHWIERIGKEIT_MITTEL = { dRang: 5, eRang: 1, finalRang: 1 }

/* --------------------------------------------------------------- Aufbau */

/** Ein Gerät mit Kür, dessen Elementstabilität sich vorgeben lässt. */
function geraetMitKuer(o: {
  apparatus: string
  elementeStabil: boolean
  kandidat?: boolean
  tag?: string
}) {
  const a = element({ apparatus: o.apparatus, name: `${o.apparatus} A`, wert: 0.2 })
  const b = element({ apparatus: o.apparatus, name: `${o.apparatus} B`, wert: 0.3 })
  const k = kuer({ apparatus: o.apparatus })
  const mach = o.elementeStabil ? stabil : instabil
  const va = mach(a.id, o.tag)
  const vb = mach(b.id, o.tag)

  const elemente = [a, b]
  const attempts = [...va.attempts, ...vb.attempts]
  const einheiten = [va.einheit, vb.einheit]

  if (o.kandidat) {
    const c = element({ apparatus: o.apparatus, name: `${o.apparatus} C`, wert: 0.9 })
    const vc = stabil(c.id, o.tag)
    elemente.push(c)
    attempts.push(...vc.attempts)
    einheiten.push(vc.einheit)
  }

  return {
    elemente, attempts, einheiten, kueren: [k],
    verknuepfungen: [platz(k.id, a.id, 1), platz(k.id, b.id, 2)],
    kuer: k, a, b,
  }
}

interface Bau {
  geraete?: WkGeraet[]
  teile?: ReturnType<typeof geraetMitKuer>[]
  runs?: GymRoutineRun[]
  versionen?: GymRoutineVersion[]
  zusatzEinheiten?: any[]
  heute?: string
}

/** Der Phase-3A-Plan, aus den echten Rechnungen. */
function baue3A(b: Bau): PlanungsBild {
  const teile = b.teile ?? []
  const elemente = teile.flatMap((t) => t.elemente)
  const attempts = teile.flatMap((t) => t.attempts)
  const einheiten = [...teile.flatMap((t) => t.einheiten), ...(b.zusatzEinheiten ?? [])]
  const kueren = teile.flatMap((t) => t.kueren)
  const verkn = teile.flatMap((t) => t.verknuepfungen)
  const heute = b.heute ?? HEUTE

  const bloecke = bloeckeMitTag(attempts, einheiten)
  const bilder = geraetBilder(elemente, bloecke, heute, diffDays, BRAUCHT_ARBEIT)
  const durchgaenge = durchgaengeJeGeraet({
    runs: b.runs ?? [], versionen: b.versionen ?? [], einheiten, kueren,
    kuerVerknuepfungen: verkn, elemente, heute, tagDifferenz: diffDays,
  })
  const teil = wettkampfteil(b.geraete ?? [])
  const fokus = trainingsfokus({
    analyse: wettkampfAnalyse(teil.wk, teil.ergebnisse, teil.benchmarks),
    verlauf: new Map(),
    elemente, versuche: attempts, einheiten, kueren,
    kuerVerknuepfungen: verkn, durchgaenge, heute, tagDifferenz: diffDays,
  })
  return trainingsplanung({ fokus, geraetBilder: bilder })
}

/** Ein Termin: geplante Einheit an Tag `+n`. */
function termin(o: {
  inTagen: number
  dauer?: number | null
  tagesart?: string | null
  freieMinuten?: number | null
  heute?: string
}): TerminEingang {
  const heute = o.heute ?? HEUTE
  return {
    sessionId: id('sess'),
    day: addDays(heute, o.inTagen),
    titel: 'Turnen',
    dauerMinuten: o.dauer ?? null,
    tagesart: o.tagesart ?? null,
    freieMinuten: o.freieMinuten ?? null,
  }
}

function baueWoche(b: Bau, termine: TerminEingang[]): WochenBild {
  return wochenplanung({
    plan: baue3A(b), termine, heute: b.heute ?? HEUTE, tagDifferenz: diffDays,
  })
}

const geraeteVon = (u: GeplanteEinheit) => u.geraete.map((g) => g.apparatus)
const alleZugeordnet = (w: WochenBild) => w.einheiten.flatMap(geraeteVon)

/** Vier Geräte mit Inhalt: zwei hoch, eines mittel, eine Stärke. */
function vierGeraete(heute = HEUTE): Bau {
  return {
    heute,
    teile: [
      geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-20' }),
      geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-05-20' }),
      geraetMitKuer({ apparatus: 'boden', elementeStabil: true, tag: '2026-05-20' }),
      geraetMitKuer({ apparatus: 'ringe', elementeStabil: false, tag: '2026-04-01' }),
    ],
    geraete: [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'reck', ...BEIDES },
      { apparatus: 'boden', ...SCHWIERIGKEIT_MITTEL },
      { apparatus: 'ringe', ...HALTEN },
    ],
  }
}

/* =============================================== Schwellen und Kapazität */

describe('Die Verteilungsregeln stehen als Schwellen da', () => {
  it('schaut vierzehn Tage nach vorn', () => {
    expect(WOCHEN_SCHWELLEN.horizontTage).toBe(14)
  })

  it('hebt die Phase-3A-Grenzen nicht an', () => {
    expect(plaetzeFuer('normal')).toBe(PLAN_SCHWELLEN.maxGeraete)
    expect(plaetzeFuer('lang')).toBe(PLAN_SCHWELLEN.maxGeraete)
    expect(plaetzeFuer('unbekannt')).toBe(PLAN_SCHWELLEN.maxGeraete)
    expect(plaetzeFuer('kurz')).toBeLessThan(PLAN_SCHWELLEN.maxGeraete)
  })

  it('behauptet ohne hinterlegte Dauer keine Kapazität', () => {
    expect(kapazitaetAus(null)).toBe('unbekannt')
    expect(kapazitaetAus(undefined)).toBe('unbekannt')
    expect(kapazitaetAus(0)).toBe('unbekannt')
  })

  it('teilt eine hinterlegte Dauer in drei Stufen', () => {
    expect(kapazitaetAus(45)).toBe('kurz')
    expect(kapazitaetAus(90)).toBe('normal')
    expect(kapazitaetAus(150)).toBe('lang')
  })

  it('nennt die Zahl der Einheiten in Einzahl und Mehrzahl', () => {
    expect(einheitenLabel(1)).toBe('1 Einheit geplant')
    expect(einheitenLabel(3)).toBe('3 Einheiten geplant')
  })
})

/* ======================================================== Keine Termine */

describe('Kein Turntermin', () => {
  it('erfindet keine Trainingstage', () => {
    const w = baueWoche(vierGeraete(), [])
    expect(w.einheiten).toHaveLength(0)
    expect(w.keineTermine).toBe(true)
    expect(w.eineEinheit).toBe(false)
  })

  it('lässt die Inhalte trotzdem sichtbar – als offene Posten', () => {
    const w = baueWoche(vierGeraete(), [])
    expect(w.offen.length).toBeGreaterThan(0)
    expect(w.offen.every((o) => o.grund === 'keine_einheit')).toBe(true)
    expect(w.offen.every((o) => o.inhalte.length > 0)).toBe(true)
  })

  it('übergeht Termine ausserhalb des Zeitraums', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: WOCHEN_SCHWELLEN.horizontTage + 1 })])
    expect(w.einheiten).toHaveLength(0)
    expect(w.keineTermine).toBe(true)
  })

  it('nimmt den Tag genau an der Grenze des Zeitraums mit', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: WOCHEN_SCHWELLEN.horizontTage })])
    expect(w.einheiten).toHaveLength(1)
  })
})

/* ========================================================= Eine Einheit */

describe('Genau ein Turntermin', () => {
  it('übernimmt den Phase-3A-Vorschlag unverändert', () => {
    const bau = vierGeraete()
    const plan = baue3A(bau)
    const w = wochenplanung({
      plan, termine: [termin({ inTagen: 2 })], heute: HEUTE, tagDifferenz: diffDays,
    })
    expect(w.eineEinheit).toBe(true)
    expect(geraeteVon(w.einheiten[0])).toEqual(planMitAuswahl(plan).map((g) => g.apparatus))
  })

  it('verteilt nichts neu, obwohl mehr Geräte Inhalt haben', () => {
    const bau = vierGeraete()
    const plan = baue3A(bau)
    const w = wochenplanung({
      plan, termine: [termin({ inTagen: 1 })], heute: HEUTE, tagDifferenz: diffDays,
    })
    expect(w.einheiten[0].geraete.length).toBeLessThanOrEqual(PLAN_SCHWELLEN.maxGeraete)
    expect(plan.geraete.filter((g) => g.inhalte.length > 0).length)
      .toBeGreaterThan(w.einheiten[0].geraete.length)
  })

  it('zeigt die Geräte ohne Platz als offen – nichts verschwindet', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: 1 })])
    expect(w.offen.length).toBeGreaterThan(0)
    expect(w.offen.every((o) => o.grund === 'keine_plaetze')).toBe(true)
    // Kein Gerät steht gleichzeitig drin und offen.
    const drin = new Set(alleZugeordnet(w))
    expect(w.offen.every((o) => !drin.has(o.apparatus))).toBe(true)
  })

  it('schneidet eine kurze Einheit auf weniger Geräte zu', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: 1, dauer: 45 })])
    expect(w.einheiten[0].kapazitaet).toBe('kurz')
    expect(w.einheiten[0].geraete.length).toBeLessThanOrEqual(WOCHEN_SCHWELLEN.geraeteKurz)
  })
})

/* ====================================================== Mehrere Einheiten */

describe('Zwei Turntermine – es wird verteilt', () => {
  const zwei = () => baueWoche(vierGeraete(), [termin({ inTagen: 1 }), termin({ inTagen: 4 })])

  it('legt nicht alles auf den ersten Tag', () => {
    const w = zwei()
    expect(w.einheiten).toHaveLength(2)
    expect(w.einheiten[0].geraete.length).toBeGreaterThan(0)
    expect(w.einheiten[1].geraete.length).toBeGreaterThan(0)
  })

  it('verteilt die Schwerpunkte auf beide Tage', () => {
    const w = zwei()
    const schwerpunkte = w.einheiten.map(
      (u) => u.geraete.filter((g) => g.rolle === 'schwerpunkt').length)
    // Zwei Schwerpunkte, zwei Einheiten: je einer - nicht beide am ersten Tag.
    expect(schwerpunkte[0]).toBeGreaterThan(0)
    expect(schwerpunkte[1]).toBeGreaterThan(0)
  })

  it('nimmt Geräte mit, für die Phase 3A keinen Platz hatte', () => {
    const bau = vierGeraete()
    const einer = wochenplanung({
      plan: baue3A(bau), termine: [termin({ inTagen: 1 })], heute: HEUTE, tagDifferenz: diffDays,
    })
    const w = zwei()
    expect(alleZugeordnet(w).length).toBeGreaterThan(alleZugeordnet(einer).length)
  })

  it('stellt kein Gerät zweimal in dieselbe Einheit', () => {
    const w = zwei()
    for (const u of w.einheiten) {
      const keys = geraeteVon(u)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('achtet die Schwerpunktgrenze je Einheit', () => {
    const w = zwei()
    for (const u of w.einheiten) {
      expect(u.geraete.filter((g) => g.rolle === 'schwerpunkt').length)
        .toBeLessThanOrEqual(PLAN_SCHWELLEN.maxSchwerpunkte)
    }
  })

  it('achtet die Platzgrenze je Einheit', () => {
    const w = zwei()
    for (const u of w.einheiten) {
      expect(u.geraete.length).toBeLessThanOrEqual(u.plaetze)
      expect(u.plaetze).toBeLessThanOrEqual(PLAN_SCHWELLEN.maxGeraete)
    }
  })

  it('ordnet innerhalb einer Einheit den Schwerpunkt nach vorn', () => {
    const w = zwei()
    for (const u of w.einheiten) {
      const rollen = u.geraete.map((g) => g.rolle)
      const ersterWartung = rollen.indexOf('wartung')
      const letzterSchwer = rollen.lastIndexOf('schwerpunkt')
      if (ersterWartung >= 0 && letzterSchwer >= 0) {
        expect(letzterSchwer).toBeLessThan(ersterWartung)
      }
    }
  })
})

describe('Drei Turntermine', () => {
  it('verteilt auf alle drei Tage, soweit Inhalt da ist', () => {
    const w = baueWoche(vierGeraete(), [
      termin({ inTagen: 1 }), termin({ inTagen: 3 }), termin({ inTagen: 5 }),
    ])
    expect(w.einheiten).toHaveLength(3)
    const belegt = w.einheiten.filter((u) => u.geraete.length > 0)
    expect(belegt.length).toBeGreaterThanOrEqual(2)
  })

  it('bringt bei genügend Plätzen alle Geräte unter', () => {
    const w = baueWoche(vierGeraete(), [
      termin({ inTagen: 1 }), termin({ inTagen: 3 }), termin({ inTagen: 5 }),
    ])
    // Vier Geraete, neun Plaetze: nichts muss offen bleiben.
    expect(w.offen.filter((o) => o.grund === 'keine_plaetze')).toHaveLength(0)
  })

  it('hält die Termine chronologisch', () => {
    const w = baueWoche(vierGeraete(), [
      termin({ inTagen: 5 }), termin({ inTagen: 1 }), termin({ inTagen: 3 }),
    ])
    const tage = w.einheiten.map((u) => u.day)
    expect([...tage].sort()).toEqual(tage)
  })
})

describe('Mehr Prioritäten als Plätze', () => {
  it('lässt nichts verschwinden, sondern nennt es offen', () => {
    const alle = GERAETE.map((g) =>
      geraetMitKuer({ apparatus: g.key, elementeStabil: false, tag: '2026-05-20' }))
    const w = baueWoche({
      teile: alle,
      geraete: GERAETE.map((g) => ({ apparatus: g.key, ...BEIDES })),
    }, [termin({ inTagen: 1 })])

    const drin = alleZugeordnet(w)
    expect(drin.length).toBe(PLAN_SCHWELLEN.maxGeraete)
    expect(drin.length + w.offen.length).toBe(GERAETE.length)
    expect(w.offen.every((o) => o.warum.length > 0)).toBe(true)
  })

  it('begründet jeden offenen Posten weiterhin aus Phase 3A', () => {
    const alle = GERAETE.map((g) =>
      geraetMitKuer({ apparatus: g.key, elementeStabil: false, tag: '2026-05-20' }))
    const bau = {
      teile: alle,
      geraete: GERAETE.map((g) => ({ apparatus: g.key, ...BEIDES })),
    }
    const plan = baue3A(bau)
    const w = wochenplanung({
      plan, termine: [termin({ inTagen: 1 })], heute: HEUTE, tagDifferenz: diffDays,
    })
    for (const o of w.offen) {
      const g = plan.geraete.find((x) => x.apparatus === o.apparatus)!
      expect(o.warum).toEqual(g.warum)
    }
  })
})

describe('Weniger Inhalte als Einheiten', () => {
  it('lässt eine Einheit leer, statt etwas zu erfinden', () => {
    const w = baueWoche({
      teile: [geraetMitKuer({ apparatus: 'barren', elementeStabil: false })],
      geraete: [{ apparatus: 'barren', ...BEIDES }],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 3 }), termin({ inTagen: 5 })])
    expect(w.einheiten).toHaveLength(3)
    expect(alleZugeordnet(w).filter((k) => k === 'barren').length).toBeGreaterThanOrEqual(1)
    const leer = w.einheiten.filter((u) => u.geraete.length === 0)
    expect(leer.length).toBeGreaterThan(0)
  })
})

describe('Nur Wartungsgeräte', () => {
  it('verteilt sie, ohne sie zu Schwerpunkten zu machen', () => {
    const w = baueWoche({
      teile: [
        geraetMitKuer({ apparatus: 'ringe', elementeStabil: true, tag: '2026-04-01' }),
        geraetMitKuer({ apparatus: 'sprung', elementeStabil: true, tag: '2026-04-01' }),
      ],
      geraete: [
        { apparatus: 'ringe', ...HALTEN },
        { apparatus: 'sprung', ...HALTEN },
      ],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    const rollen = w.einheiten.flatMap((u) => u.geraete.map((g) => g.rolle))
    expect(rollen.length).toBeGreaterThan(0)
    expect(rollen.every((r) => r === 'wartung')).toBe(true)
  })
})

describe('Ein Gerät, das lange nicht trainiert wurde', () => {
  it('kommt bei gleicher Priorität zuerst – wie in Phase 3A', () => {
    const w = baueWoche({
      teile: [
        geraetMitKuer({ apparatus: 'boden', elementeStabil: false, tag: '2026-05-30' }),
        geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-04-05' }),
      ],
      geraete: [
        { apparatus: 'boden', ...BEIDES },
        { apparatus: 'reck', ...BEIDES },
      ],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    // Reck liegt laenger: es bekommt den ersten Platz der ersten Einheit.
    expect(geraeteVon(w.einheiten[0])[0]).toBe('reck')
  })
})

/* ============================== Wiederholung nur bei instabiler Kür */

describe('Dieselbe Kür darf mehrfach, wenn sie am Stück nicht durchkommt', () => {
  /** Ein Gerät mit stabilen Elementen und vier abgebrochenen Durchgängen. */
  const baueKuerProblem = (apparatus: string) => {
    const t = geraetMitKuer({ apparatus, elementeStabil: true, tag: '2026-05-20' })
    const v = fassung(t.kuer, t.verknuepfungen, t.elemente)
    const sid = id('srun')
    const runs = [0, 1, 2, 3].map((i) =>
      run({ sessionId: sid, versionId: v.id, completed: false, sort: i }))
    return {
      teil: t, version: v, runs, zusatz: einheit(sid, '2026-05-20'),
    }
  }

  it('wiederholt das Gerät auf einem freien Platz – aber nur die Kür', () => {
    const p = baueKuerProblem('barren')
    const w = baueWoche({
      teile: [p.teil],
      geraete: [{ apparatus: 'barren', ...SCHWIERIGKEIT }],
      runs: p.runs,
      versionen: [p.version],
      zusatzEinheiten: [p.zusatz],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])

    const alle = w.einheiten.flatMap((u) => u.geraete)
    const barren = alle.filter((g) => g.apparatus === 'barren')
    expect(barren.length).toBe(2)
    const wdh = barren.find((g) => g.wiederholung)!
    expect(wdh).toBeTruthy()
    expect(wdh.inhalte.every((i) => i.art === 'durchgang')).toBe(true)
    expect(wdh.rolle).not.toBe('schwerpunkt')
  })

  it('nennt den Grund der Wiederholung', () => {
    const p = baueKuerProblem('barren')
    const w = baueWoche({
      teile: [p.teil],
      geraete: [{ apparatus: 'barren', ...SCHWIERIGKEIT }],
      runs: p.runs, versionen: [p.version], zusatzEinheiten: [p.zusatz],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    const wdh = w.einheiten.flatMap((u) => u.geraete).find((g) => g.wiederholung)!
    expect(wdh.inhalte[0].warum.join(' ')).toMatch(/Zweiter Durchgangstermin/)
  })

  it('wiederholt ein Gerät mit stabiler Kür NICHT', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-20' })
    const w = baueWoche({
      teile: [t], geraete: [{ apparatus: 'barren', ...BEIDES }],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    const barren = w.einheiten.flatMap((u) => u.geraete).filter((g) => g.apparatus === 'barren')
    expect(barren).toHaveLength(1)
    expect(barren[0].wiederholung).toBe(false)
  })

  it('wiederholt nichts, solange ein anderes Gerät noch offen ist', () => {
    const p = baueKuerProblem('barren')
    const andere = GERAETE.filter((g) => g.key !== 'barren').map((g) =>
      geraetMitKuer({ apparatus: g.key, elementeStabil: false, tag: '2026-05-20' }))
    const w = baueWoche({
      teile: [p.teil, ...andere],
      geraete: GERAETE.map((g) => ({
        apparatus: g.key, ...(g.key === 'barren' ? SCHWIERIGKEIT : BEIDES),
      })),
      runs: p.runs, versionen: [p.version], zusatzEinheiten: [p.zusatz],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    const wdh = w.einheiten.flatMap((u) => u.geraete).filter((g) => g.wiederholung)
    expect(wdh).toHaveLength(0)
  })
})

/* ====================================================== Überfällig */

describe('Ein vergangener Termin ist nicht absolviert', () => {
  it('führt ihn als überfällig und verteilt nichts darauf', () => {
    const w = baueWoche(vierGeraete(), [
      termin({ inTagen: -3 }), termin({ inTagen: 2 }), termin({ inTagen: 5 }),
    ])
    expect(w.ueberfaellig).toHaveLength(1)
    expect(w.ueberfaellig[0].day).toBe(addDays(HEUTE, -3))
    expect(w.einheiten).toHaveLength(2)
    expect(w.einheiten.every((u) => u.day >= HEUTE)).toBe(true)
  })

  it('behandelt einen Termin von heute noch als kommend', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: 0 })])
    expect(w.ueberfaellig).toHaveLength(0)
    expect(w.einheiten).toHaveLength(1)
    expect(w.einheiten[0].label).toBe('heute')
  })
})

/* ================================================ Tagesart als Kontext */

describe('Tagesart und freie Zeit sind Kontext, keine Bedingung', () => {
  it('reicht die Tagesart unverändert durch', () => {
    const w = baueWoche(vierGeraete(), [
      termin({ inTagen: 1, tagesart: 'Frühschicht', freieMinuten: 420 }),
    ])
    expect(w.einheiten[0].tagesart).toBe('Frühschicht')
    expect(w.einheiten[0].freieMinuten).toBe(420)
  })

  it('plant ohne Tagesart genauso', () => {
    const ohne = baueWoche(vierGeraete(), [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    const mit = baueWoche(vierGeraete(), [
      termin({ inTagen: 1, tagesart: 'Frühschicht', freieMinuten: 120 }),
      termin({ inTagen: 4, tagesart: 'Frei', freieMinuten: 700 }),
    ])
    // Die Verteilung haengt NICHT an der Tagesart.
    expect(mit.einheiten.map(geraeteVon)).toEqual(ohne.einheiten.map(geraeteVon))
  })

  it('leitet aus der freien Zeit keine Platzzahl ab', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: 1, freieMinuten: 30 })])
    // Nur eine hinterlegte DAUER der Einheit begrenzt die Plaetze, nicht die
    // freie Zeit des Tages - sonst haengte Turnen am gepflegten Arbeitsplan.
    expect(w.einheiten[0].plaetze).toBe(PLAN_SCHWELLEN.maxGeraete)
  })
})

/* ====================================================== Nutzerwahl */

describe('Die Verteilung ist ein Vorschlag', () => {
  const zwei = () => baueWoche(vierGeraete(), [termin({ inTagen: 1 }), termin({ inTagen: 4 })])

  it('verschiebt ein Gerät auf einen anderen Tag', () => {
    const w = zwei()
    const g = w.einheiten[0].geraete[0].apparatus
    const ziel = w.einheiten[1].sessionId
    const n = wocheMitAuswahl(w, { verschoben: { [g]: ziel } })
    expect(geraeteVon(n.einheiten[0])).not.toContain(g)
    expect(geraeteVon(n.einheiten[1])).toContain(g)
  })

  it('tauscht zwei Geräte – ein Tausch sind zwei Verschiebungen', () => {
    const w = zwei()
    const a = w.einheiten[0].geraete[0].apparatus
    const b = w.einheiten[1].geraete[0].apparatus
    const n = wocheMitAuswahl(w, {
      verschoben: { [a]: w.einheiten[1].sessionId, [b]: w.einheiten[0].sessionId },
    })
    expect(geraeteVon(n.einheiten[0])).toContain(b)
    expect(geraeteVon(n.einheiten[1])).toContain(a)
  })

  it('entfernt ein Gerät und führt es als offen', () => {
    const w = zwei()
    const g = w.einheiten[0].geraete[0].apparatus
    const n = wocheMitAuswahl(w, { ohne: [g] })
    expect(alleZugeordnet(n)).not.toContain(g)
    expect(n.offen.some((o) => o.apparatus === g)).toBe(true)
  })

  it('nimmt ein offenes Gerät mit seinen Inhalten in eine Einheit', () => {
    const w = baueWoche(vierGeraete(), [termin({ inTagen: 1 })])
    const offen = w.offen[0]
    expect(offen.inhalte.length).toBeGreaterThan(0)
    const n = wocheMitAuswahl(w, { verschoben: { [offen.apparatus]: w.einheiten[0].sessionId } })
    const drin = n.einheiten[0].geraete.find((g) => g.apparatus === offen.apparatus)!
    expect(drin).toBeTruthy()
    expect(drin.inhalte.length).toBeGreaterThan(0)
    expect(n.offen.some((o) => o.apparatus === offen.apparatus)).toBe(false)
  })

  it('übergeht eine Verschiebung auf eine unbekannte Einheit', () => {
    const w = zwei()
    const g = w.einheiten[0].geraete[0].apparatus
    const n = wocheMitAuswahl(w, { verschoben: { [g]: 'gibtsnicht' } })
    expect(geraeteVon(n.einheiten[0])).toContain(g)
  })

  it('ist ohne Wahl genau die berechnete Verteilung', () => {
    const w = zwei()
    expect(wocheMitAuswahl(w).einheiten.map(geraeteVon)).toEqual(w.einheiten.map(geraeteVon))
  })

  it('ändert das Ausgangsbild nicht – die Wahl ist eine Sicht darauf', () => {
    const w = zwei()
    const vorher = w.einheiten.map(geraeteVon)
    const offenVorher = w.offen.length
    wocheMitAuswahl(w, { ohne: [w.einheiten[0].geraete[0].apparatus] })
    expect(w.einheiten.map(geraeteVon)).toEqual(vorher)
    expect(w.offen).toHaveLength(offenVorher)
  })
})

/* ================================ Reaktion auf absolviertes Training */

describe('Nach einem absolvierten Training entsteht die Woche neu', () => {
  it('ändert den Vorschlag, wenn ein Gerät gut trainiert wurde', () => {
    // Vorher: Barren instabil, also Schwerpunkt.
    const vorher = baueWoche(vierGeraete(), [termin({ inTagen: 1 }), termin({ inTagen: 4 })])
    const barrenVorher = vorher.einheiten
      .flatMap((u) => u.geraete).find((g) => g.apparatus === 'barren')
    expect(barrenVorher?.rolle).toBe('schwerpunkt')

    // Nachher: dieselben Geraete, Barren aber stabil geturnt.
    const nachher = baueWoche({
      teile: [
        geraetMitKuer({ apparatus: 'barren', elementeStabil: true, tag: '2026-05-31' }),
        geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-05-20' }),
        geraetMitKuer({ apparatus: 'boden', elementeStabil: true, tag: '2026-05-20' }),
        geraetMitKuer({ apparatus: 'ringe', elementeStabil: false, tag: '2026-04-01' }),
      ],
      geraete: [
        { apparatus: 'barren', ...BEIDES },
        { apparatus: 'reck', ...BEIDES },
        { apparatus: 'boden', ...SCHWIERIGKEIT_MITTEL },
        { apparatus: 'ringe', ...HALTEN },
      ],
    }, [termin({ inTagen: 1 }), termin({ inTagen: 4 })])

    const barrenNachher = nachher.einheiten
      .flatMap((u) => u.geraete).find((g) => g.apparatus === 'barren')
    // Die Inhalte sind andere - die Woche ist kein eingefrorener Schnappschuss.
    expect(barrenNachher?.inhalte.map((i) => i.art))
      .not.toEqual(barrenVorher?.inhalte.map((i) => i.art))
  })
})

/* ====================================================== Tagesgrenzen */

describe('Tagesgrenzen, Monats-, Jahres- und Zeitwechsel', () => {
  const prueferFuer = (heute: string) => {
    const w = baueWoche({ ...vierGeraete(heute), heute }, [
      { ...termin({ inTagen: 1, heute }), sessionId: 'a' },
      { ...termin({ inTagen: 6, heute }), sessionId: 'b' },
    ])
    return w
  }

  it('trägt über den Sonntag hinaus – der Zeitraum rollt', () => {
    // Sonntag: Eine feste Montagswoche zeigte hier fast nichts mehr.
    const w = prueferFuer('2026-06-07')
    expect(w.einheiten).toHaveLength(2)
    expect(w.einheiten[0].day).toBe('2026-06-08')
    expect(w.einheiten[1].day).toBe('2026-06-13')
  })

  it('trägt über den Monatswechsel', () => {
    const w = prueferFuer('2026-06-28')
    expect(w.einheiten.map((u) => u.day)).toEqual(['2026-06-29', '2026-07-04'])
  })

  it('trägt über den Jahreswechsel', () => {
    const w = prueferFuer('2026-12-29')
    expect(w.einheiten.map((u) => u.day)).toEqual(['2026-12-30', '2027-01-04'])
  })

  it('trägt über den Wechsel auf Sommerzeit', () => {
    // 2027-03-28 ist die Nacht der Umstellung in Deutschland.
    const w = prueferFuer('2027-03-27')
    expect(w.einheiten.map((u) => u.day)).toEqual(['2027-03-28', '2027-04-02'])
  })

  it('trägt über den Wechsel auf Winterzeit', () => {
    // 2026-10-25 ist die Nacht der Umstellung.
    const w = prueferFuer('2026-10-24')
    expect(w.einheiten.map((u) => u.day)).toEqual(['2026-10-25', '2026-10-30'])
  })

  it('zählt den Zeitraum in Tagen und nicht in Stunden', () => {
    // Ueber die Zeitumstellung hinweg muss der 14. Tag noch dazugehoeren.
    const heute = '2026-10-18'
    const w = baueWoche({ ...vierGeraete(heute), heute },
      [termin({ inTagen: 14, heute })])
    expect(w.einheiten).toHaveLength(1)
    expect(w.einheiten[0].day).toBe('2026-11-01')
  })
})

/* ================================================= Abgrenzung am Quelltext */

describe('Was diese Phase nicht tut', () => {
  const quelle = () => readFileSync(
    new URL('../src/core/turnen/wochenplanung.ts', import.meta.url), 'utf8')
  const code = () => quelle().split(/\r?\n/)
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')

  it('legt keine Tabelle an und schreibt nichts', () => {
    // Nicht auf 'wochenplan' pruefen - so heisst die Datei selbst.
    expect(code()).not.toMatch(/CREATE TABLE|ALTER TABLE|gym_training_plans/i)
    expect(code()).not.toMatch(/SYNCED_TABLES|MIGRATIONS/)
    expect(code()).not.toMatch(/\bm\.create\b|\bm\.patch\b|\bremoveQuiet\b/)
  })

  it('rechnet keine Priorität und keine Stabilität neu', () => {
    const c = code()
    // Alles, was bewertet, kommt aus 2C-3A herein.
    expect(c).not.toMatch(/gym_attempts|GymAttempt|trefferbild|statusVorschlag/)
    expect(c).not.toMatch(/SCHWELLEN\.sicher|DURCHGANG_SCHWELLEN|empfehlungAus/)
  })

  it('führt keine eigene Wochentagsliste und keine festen Trainingstage', () => {
    const c = code()
    expect(c).not.toMatch(/Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag/)
    expect(c).not.toMatch(/weekday|wochentag/i)
  })

  it('führt keine eigene Datumsrechnung ein', () => {
    const c = code()
    // Gerechnet wird mit dem uebergebenen `tagDifferenz` und den vorhandenen
    // Helfern - kein new Date(), kein eigenes UTC-Gebastel.
    expect(c).not.toMatch(/new Date\(|getTime\(\)|86400000|toISOString/)
  })

  it('behauptet keine physiologische Wirkung von Schichten', () => {
    const q = quelle()
    expect(q).not.toMatch(/nach Frühschicht ist|ungeeignet weil|Ermüdung durch/i)
    expect(code()).not.toMatch(/fruehschicht|spaetschicht/i)
  })

  it('plant keine Minuten je Gerät', () => {
    const c = code()
    expect(c).not.toMatch(/minutenJeGeraet|verteileMinuten|DAUER_GEWICHT/)
  })

  it('kennt keinen Kalender, keine Aufgaben und keine Erinnerungen', () => {
    const c = code()
    expect(c).not.toMatch(/calendar_events|task_templates|notifications|shift_patterns/)
  })
})

/* ============================================================ Performance */

describe('Performance – die Verteilung ist ein Nachschlagen', () => {
  it('rechnet auf einem grossen Bestand unter 5 ms', () => {
    const alle = GERAETE.map((g) =>
      geraetMitKuer({ apparatus: g.key, elementeStabil: false, tag: '2026-05-20' }))
    const plan = baue3A({
      teile: alle,
      geraete: GERAETE.map((g) => ({ apparatus: g.key, ...BEIDES })),
    })
    // Deutlich mehr Termine, als je im Zeitraum liegen koennen: Auch dann darf
    // die Verteilung nicht teuer werden.
    const termine = Array.from({ length: 200 }, (_, i) => ({
      sessionId: `s-${i}`,
      day: addDays(HEUTE, i - 100),
      titel: 'Turnen',
      dauerMinuten: i % 3 === 0 ? 90 : null,
      tagesart: null,
      freieMinuten: null,
    }))

    let beste = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      wochenplanung({ plan, termine, heute: HEUTE, tagDifferenz: diffDays })
      beste = Math.min(beste, performance.now() - t0)
    }
    // eslint-disable-next-line no-console
    console.log(`  wochenplanung(): ${beste.toFixed(2)} ms bei 200 Terminen, 6 Geräten`)
    expect(beste).toBeLessThan(5)
  })

  it('betrachtet nur Termine im Zeitraum', () => {
    const plan = baue3A(vierGeraete())
    const termine = Array.from({ length: 200 }, (_, i) => ({
      sessionId: `s-${i}`, day: addDays(HEUTE, i + 30), titel: null,
      dauerMinuten: null, tagesart: null, freieMinuten: null,
    }))
    const w = wochenplanung({ plan, termine, heute: HEUTE, tagDifferenz: diffDays })
    expect(w.einheiten).toHaveLength(0)
    expect(w.keineTermine).toBe(true)
  })
})
