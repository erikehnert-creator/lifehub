/**
 * Trainingsplanung – Geräteauswahl, Inhaltstypen, Reihenfolge, Nutzerwahl.
 *
 * ---------------------------------------------------------------------------
 * Der Eingang kommt aus den echten Rechnungen
 *
 * Priorität, Lage und Kandidaten werden **nicht** nachgebaut, sondern von
 * `trainingsfokus()` geliefert, das seinerseits auf `wettkampfAnalyse()` und
 * `durchgaengeJeGeraet()` sitzt. Sonst prüfte diese Datei nur ihre eigene
 * Annahme darüber, was Phase 2D liefert – und ginge weiter durch, nachdem 2D
 * sich geändert hat.
 *
 * Zugesichert werden Kategorien: `rolle`, `art`, `umfang`, Reihenfolge,
 * Auswahlgründe. Nie deutsche Sätze, nie ein erwarteter Elementname.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { diffDays } from '../src/core/dates'
import { BRAUCHT_ARBEIT } from '../src/core/turnen/status'
import { GERAETE } from '../src/core/turnen/geraete'
import { KUER_SCHWELLEN } from '../src/core/turnen/kueren'
import { SCHWELLEN } from '../src/core/turnen/sicherheit'
import { fassungsId, fassungsInhalt } from '../src/core/turnen/fassungen'
import { bloeckeMitTag, geraetBilder } from '../src/core/turnen/elemente'
import { durchgaengeJeGeraet } from '../src/core/turnen/kuerdurchgaenge'
import { wettkampfAnalyse, type VergleichsWerte } from '../src/core/turnen/analyse'
import { trainingsfokus, type TrainingsfokusBild } from '../src/core/turnen/trainingsfokus'
import {
  DURCHGANGS_VORGABE, PLAN_SCHWELLEN,
  geraeteLabel, nachwaehlbar, planMitAuswahl, reihenfolgeArtFuer,
  trainingsplanung,
  type GeraetPlan,
} from '../src/core/turnen/trainingsplanung'
import type {
  GymAttempt, GymCompetition, GymElement, GymResult, GymRoutine,
  GymRoutineElement, GymRoutineRun, GymRoutineVersion,
} from '../src/core/types'

const HEUTE = '2026-06-01'
const WK_ID = 'wk1'

let lauf = 0
const id = (p: string) => `${p}-${++lauf}`

/* ------------------------------------------------------------- Bausteine */

function element(o: {
  name: string
  apparatus?: string
  wert?: number
  status?: string
  aktiv?: boolean
  weg?: boolean
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
    status: o.status ?? 'sicher',
    video_url: null,
    note: null,
    is_active: o.aktiv === false ? 0 : 1,
    deleted_at: o.weg ? '2026-05-01T00:00:00.000Z' : null,
  } as unknown as GymElement
}

function kuer(o: { apparatus?: string; name?: string; seit?: string | null }): GymRoutine {
  return {
    id: id('k'),
    apparatus: o.apparatus ?? 'boden',
    name: o.name ?? `Kür ${o.apparatus ?? 'boden'}`,
    is_active: 1,
    competition_since: o.seit === undefined ? '2026-01-01T10:00:00.000Z' : o.seit,
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

/** Versuche an einem Element, in einer eigenen Einheit. */
function versuche(o: {
  elementId: string
  tag: string
  clean?: number
  shaky?: number
  failed?: number
  hilfe?: boolean
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
      with_help: o.hilfe ? 1 : 0,
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
const mitHilfe = (elementId: string, tag = '2026-05-20') =>
  versuche({ elementId, tag, clean: 20, hilfe: true })

function run(o: {
  sessionId: string
  versionId: string
  completed?: boolean
  falls?: number
  sort?: number
}): GymRoutineRun {
  return {
    id: id('run'),
    session_id: o.sessionId,
    routine_version_id: o.versionId,
    completed: o.completed === false ? 0 : 1,
    falls: o.falls ?? 0,
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

/** Wie in `turnen-trainingsfokus.test.ts`: echte 2C-Rechnung aus Rängen. */
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

/** Die vier Fokuslagen aus Phase 2C, über die Ränge erzeugt. */
const SCHWIERIGKEIT = { dRang: 5, eRang: 1, finalRang: 5 }
const AUSFUEHRUNG = { dRang: 1, eRang: 5, finalRang: 5 }
const BEIDES = { dRang: 5, eRang: 5, finalRang: 5 }
const HALTEN = { dRang: 1, eRang: 1, finalRang: 1 }
/** Schwierigkeit unten, Endnote trägt aber noch – ergibt `mittel`. */
const SCHWIERIGKEIT_MITTEL = { dRang: 5, eRang: 1, finalRang: 1 }

/* --------------------------------------------------------------- Aufbau */

interface Bau {
  geraete?: WkGeraet[]
  elemente?: GymElement[]
  kueren?: GymRoutine[]
  verknuepfungen?: GymRoutineElement[]
  einheiten?: any[]
  attempts?: GymAttempt[]
  runs?: GymRoutineRun[]
  versionen?: GymRoutineVersion[]
  ohneWettkampf?: boolean
}

function baue(b: Bau) {
  const elemente = b.elemente ?? []
  const attempts = b.attempts ?? []
  const einheiten = b.einheiten ?? []
  const kueren = b.kueren ?? []
  const verkn = b.verknuepfungen ?? []

  const bloecke = bloeckeMitTag(attempts, einheiten)
  const bilder = geraetBilder(elemente, bloecke, HEUTE, diffDays, BRAUCHT_ARBEIT)

  const durchgaenge = durchgaengeJeGeraet({
    runs: b.runs ?? [],
    versionen: b.versionen ?? [],
    einheiten,
    kueren,
    kuerVerknuepfungen: verkn,
    elemente,
    heute: HEUTE,
    tagDifferenz: diffDays,
  })

  const teil = wettkampfteil(b.geraete ?? [])
  const fokus: TrainingsfokusBild = trainingsfokus({
    analyse: b.ohneWettkampf
      ? null
      : wettkampfAnalyse(teil.wk, teil.ergebnisse, teil.benchmarks),
    verlauf: new Map(),
    elemente,
    versuche: attempts,
    einheiten,
    kueren,
    kuerVerknuepfungen: verkn,
    durchgaenge,
    heute: HEUTE,
    tagDifferenz: diffDays,
  })

  const bild = trainingsplanung({ fokus, geraetBilder: bilder })
  return {
    bild,
    fokus,
    plan: planMitAuswahl(bild),
    von: (apparatus: string): GeraetPlan => {
      const g = bild.geraete.find((x) => x.apparatus === apparatus)
      expect(g, `Plan für ${apparatus}`).toBeTruthy()
      return g!
    },
  }
}

/** Ein Gerät mit zwei Kürelementen, deren Stabilität sich vorgeben lässt. */
function geraetMitKuer(o: {
  apparatus: string
  elementeStabil: boolean
  /** Ein stabiles, schwierigeres Element ausserhalb der Kür. */
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
    elemente,
    attempts,
    einheiten,
    kueren: [k],
    verknuepfungen: [platz(k.id, a.id, 1), platz(k.id, b.id, 2)],
    kuer: k,
    a,
    b,
  }
}

/** Zusammenbauen mehrerer Geräte zu einem Bau. */
function zusammen(teile: ReturnType<typeof geraetMitKuer>[], geraete: WkGeraet[]): Bau {
  return {
    geraete,
    elemente: teile.flatMap((t) => t.elemente),
    attempts: teile.flatMap((t) => t.attempts),
    einheiten: teile.flatMap((t) => t.einheiten),
    kueren: teile.flatMap((t) => t.kueren),
    verknuepfungen: teile.flatMap((t) => t.verknuepfungen),
  }
}

const arten = (g: GeraetPlan) => g.inhalte.map((i) => i.art)
const hat = (g: GeraetPlan, art: string) => g.inhalte.some((i) => i.art === art)

/* ================================================== Schwellen und Form */

describe('Die Auswahlregeln stehen als Schwellen da', () => {
  it('nennt höchstens drei Geräte und höchstens zwei Schwerpunkte', () => {
    expect(PLAN_SCHWELLEN.maxGeraete).toBe(3)
    expect(PLAN_SCHWELLEN.maxSchwerpunkte).toBe(2)
    expect(PLAN_SCHWELLEN.maxSchwerpunkte).toBeLessThan(PLAN_SCHWELLEN.maxGeraete)
  })

  it('benutzt für Wartung dieselbe Frist wie die Kürelemente – keine zweite Zeitlogik', () => {
    expect(PLAN_SCHWELLEN.wartungTage).toBe(KUER_SCHWELLEN.langeHerTage)
  })

  it('schlägt nie mehr als zwei Kürdurchgänge vor', () => {
    expect(DURCHGANGS_VORGABE.kuerImVordergrund.bis).toBeLessThanOrEqual(2)
    expect(DURCHGANGS_VORGABE.nebenbei.bis).toBe(1)
  })

  it('liefert für jedes Gerät einen Eintrag, auch ohne Daten', () => {
    const { bild } = baue({})
    expect(bild.geraete).toHaveLength(GERAETE.length)
  })
})

/* ====================================================== Geräteauswahl */

describe('Geräteauswahl – hohe Priorität zuerst', () => {
  it('macht ein Gerät mit hoher Priorität zum Schwerpunkt', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { von } = baue(zusammen([t], [{ apparatus: 'barren', ...BEIDES }]))
    expect(von('barren').prioritaet).toBe('hoch')
    expect(von('barren').rolle).toBe('schwerpunkt')
  })

  it('nennt höchstens drei Geräte, obwohl mehr in Frage kämen', () => {
    const teile = GERAETE.map((g) =>
      geraetMitKuer({ apparatus: g.key, elementeStabil: false }))
    const { bild } = baue(zusammen(teile, GERAETE.map((g) => ({ apparatus: g.key, ...BEIDES }))))
    expect(bild.vorgeschlagen).toHaveLength(PLAN_SCHWELLEN.maxGeraete)
  })

  it('macht aus vier hohen Prioritäten nicht vier Schwerpunkte', () => {
    const teile = GERAETE.slice(0, 4).map((g) =>
      geraetMitKuer({ apparatus: g.key, elementeStabil: false }))
    const { bild, von } = baue(zusammen(
      teile, GERAETE.slice(0, 4).map((g) => ({ apparatus: g.key, ...BEIDES }))))
    const schwerpunkte = bild.vorgeschlagen.filter((k) => von(k).rolle === 'schwerpunkt')
    expect(schwerpunkte).toHaveLength(PLAN_SCHWELLEN.maxSchwerpunkte)
  })

  it('setzt hohe Priorität vor mittlere', () => {
    const hoch = geraetMitKuer({ apparatus: 'reck', elementeStabil: false })
    // Stabile Elemente: Bei instabiler Kuer macht `prioritaetAus` aus
    // `schwierigkeit` sonst ebenfalls `hoch`.
    const mittel = geraetMitKuer({ apparatus: 'boden', elementeStabil: true })
    const { bild, von } = baue(zusammen([hoch, mittel], [
      { apparatus: 'reck', ...BEIDES },
      { apparatus: 'boden', ...SCHWIERIGKEIT_MITTEL },
    ]))
    expect(von('reck').prioritaet).toBe('hoch')
    expect(von('boden').prioritaet).toBe('mittel')
    expect(bild.vorgeschlagen.indexOf('reck')).toBeLessThan(bild.vorgeschlagen.indexOf('boden'))
  })

  it('stellt vorgeschlagene Geräte in der Liste nach vorn', () => {
    const t = geraetMitKuer({ apparatus: 'reck', elementeStabil: false })
    const { bild } = baue(zusammen([t], [{ apparatus: 'reck', ...BEIDES }]))
    expect(bild.geraete[0].apparatus).toBe('reck')
    expect(bild.geraete[0].rolle).toBe('schwerpunkt')
    expect(bild.geraete.slice(1).every((g) => g.rolle === null || bild.vorgeschlagen.includes(g.apparatus)))
      .toBe(true)
  })
})

describe('Geräteauswahl – gleiche Priorität', () => {
  it('nimmt bei gleicher Priorität das länger nicht trainierte zuerst', () => {
    // Beide `beides`, also beide `hoch`. Unterschied ist allein der Tag.
    const frisch = geraetMitKuer({ apparatus: 'boden', elementeStabil: false, tag: '2026-05-30' })
    const alt = geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-04-20' })
    const { bild } = baue(zusammen([frisch, alt], [
      { apparatus: 'boden', ...BEIDES },
      { apparatus: 'reck', ...BEIDES },
    ]))
    expect(bild.vorgeschlagen.indexOf('reck')).toBeLessThan(bild.vorgeschlagen.indexOf('boden'))
  })

  it('bricht Gleichstand danach über die Wettkampfreihenfolge', () => {
    // Gleiche Priorität, gleicher Tag: Boden (1.) vor Reck (6.).
    const a = geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-05-20' })
    const b = geraetMitKuer({ apparatus: 'boden', elementeStabil: false, tag: '2026-05-20' })
    const { bild } = baue(zusammen([a, b], [
      { apparatus: 'reck', ...BEIDES },
      { apparatus: 'boden', ...BEIDES },
    ]))
    expect(bild.vorgeschlagen.indexOf('boden')).toBeLessThan(bild.vorgeschlagen.indexOf('reck'))
  })
})

describe('Geräteauswahl – eine Stärke verschwindet nicht wochenlang', () => {
  /**
   * Vier Kandidaten auf drei Plätze – erst dann muss sich etwas verdrängen.
   *
   * Zwei Problemgeräte und ein Nebenfokus, alle frisch trainiert, dazu eine
   * Stärke, deren letztes Training sich einstellen lässt. Ohne den
   * Wartungsplatz stünden immer dieselben drei da.
   */
  const baueWartung = (tagDerStaerke: string) => {
    const p1 = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-30' })
    const p2 = geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-05-30' })
    const neben = geraetMitKuer({ apparatus: 'boden', elementeStabil: true, tag: '2026-05-30' })
    const staerke = geraetMitKuer({
      apparatus: 'ringe', elementeStabil: false, tag: tagDerStaerke,
    })
    return baue(zusammen([p1, p2, neben, staerke], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'reck', ...BEIDES },
      { apparatus: 'boden', ...SCHWIERIGKEIT_MITTEL },
      { apparatus: 'ringe', ...HALTEN },
    ]))
  }

  it('holt eine seit über vier Wochen unangetastete Stärke als Wartung dazu', () => {
    const { bild, von } = baueWartung('2026-04-01') // 61 Tage her
    expect(von('ringe').prioritaet).toBe('halten')
    expect(bild.vorgeschlagen).toContain('ringe')
    expect(von('ringe').rolle).toBe('wartung')
    expect(von('ringe').auswahlGrund).toBe('lange_nicht_trainiert')
  })

  it('verdrängt dafür den Nebenfokus und nicht den Schwerpunkt', () => {
    const { bild, von } = baueWartung('2026-04-01')
    const schwerpunkte = bild.vorgeschlagen.filter((k) => von(k).rolle === 'schwerpunkt')
    expect(schwerpunkte).toHaveLength(PLAN_SCHWELLEN.maxSchwerpunkte)
    expect(bild.vorgeschlagen).toContain('barren')
    expect(bild.vorgeschlagen).toContain('reck')
    expect(bild.vorgeschlagen).not.toContain('boden')
  })

  it('holt eine frisch trainierte Stärke nicht dazu', () => {
    const { bild, von } = baueWartung('2026-05-28') // 4 Tage her
    expect(bild.vorgeschlagen).not.toContain('ringe')
    expect(bild.vorgeschlagen).toContain('boden')
    expect(von('boden').rolle).toBe('nebenfokus')
  })

  it('füllt einen sonst leeren Platz auch mit einer frischen Stärke', () => {
    // Nur drei Kandidaten auf drei Plaetze: Ein leerer Platz waere schlechter
    // als eine kurze Wartung, also steht die Staerke trotzdem da.
    const p1 = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-30' })
    const p2 = geraetMitKuer({ apparatus: 'reck', elementeStabil: false, tag: '2026-05-30' })
    const frisch = geraetMitKuer({ apparatus: 'ringe', elementeStabil: false, tag: '2026-05-28' })
    const { bild, von } = baue(zusammen([p1, p2, frisch], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'reck', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    expect(bild.vorgeschlagen).toContain('ringe')
    expect(von('ringe').rolle).toBe('wartung')
  })

  it('führt eine nie trainierte Stärke als Wartung und nennt das so', () => {
    const p1 = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-30' })
    // Eine Kuer ohne jeden Versuch: nie trainiert.
    const nie = (() => {
      const a = element({ apparatus: 'ringe', name: 'Ringe A' })
      const k = kuer({ apparatus: 'ringe' })
      return {
        elemente: [a], attempts: [], einheiten: [], kueren: [k],
        verknuepfungen: [platz(k.id, a.id, 1)], kuer: k, a, b: a,
      }
    })()
    const { von, bild } = baue(zusammen([p1, nie], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    expect(von('ringe').tageHer).toBeNull()
    expect(bild.vorgeschlagen).toContain('ringe')
    expect(von('ringe').rolle).toBe('wartung')
  })
})

/* ====================================================== Inhaltstypen */

describe('Inhaltstyp A – Elementtraining', () => {
  it('schlägt instabile Kürelemente als Elementarbeit vor', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { von } = baue(zusammen([t], [{ apparatus: 'barren', ...AUSFUEHRUNG }]))
    expect(hat(von('barren'), 'element')).toBe(true)
    const el = von('barren').inhalte.filter((i) => i.art === 'element')
    expect(el.length).toBeGreaterThan(0)
    expect(el.every((i) => i.elementId !== null)).toBe(true)
    expect(el.every((i) => i.warum.length > 0)).toBe(true)
  })

  it('nennt ein Element mit Hilfestellung, aber führt es nicht als Kandidat', () => {
    const a = element({ apparatus: 'barren', name: 'A', wert: 0.2 })
    const b = element({ apparatus: 'barren', name: 'B', wert: 0.3 })
    const k = kuer({ apparatus: 'barren' })
    const va = mitHilfe(a.id)
    const vb = stabil(b.id)
    const { von } = baue({
      geraete: [{ apparatus: 'barren', ...AUSFUEHRUNG }],
      elemente: [a, b],
      attempts: [...va.attempts, ...vb.attempts],
      einheiten: [va.einheit, vb.einheit],
      kueren: [k],
      verknuepfungen: [platz(k.id, a.id, 1), platz(k.id, b.id, 2)],
    })
    const el = von('barren').inhalte.filter((i) => i.art === 'element')
    expect(el.some((i) => i.elementId === a.id)).toBe(true)
    expect(hat(von('barren'), 'entwicklung')).toBe(false)
  })

  it('nennt bei einem Wartungsgerät weniger Elemente als bei einem Schwerpunkt', () => {
    const viele = (apparatus: string, tag: string) => {
      const els = [1, 2, 3, 4].map((n) =>
        element({ apparatus, name: `${apparatus} ${n}`, wert: 0.1 * n }))
      const k = kuer({ apparatus })
      const vs = els.map((e) => instabil(e.id, tag))
      return {
        elemente: els,
        attempts: vs.flatMap((v) => v.attempts),
        einheiten: vs.map((v) => v.einheit),
        kueren: [k],
        verknuepfungen: els.map((e, i) => platz(k.id, e.id, i + 1)),
        kuer: k, a: els[0], b: els[1],
      }
    }
    const schwer = viele('barren', '2026-05-20')
    const wart = viele('ringe', '2026-04-01')
    const { von } = baue(zusammen([schwer, wart], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    const zaehl = (k: string) => von(k).inhalte.filter((i) => i.art === 'element').length
    expect(zaehl('barren')).toBeGreaterThan(zaehl('ringe'))
    expect(von('ringe').inhalte.filter((i) => i.art === 'element')
      .every((i) => i.umfang === 'kurz')).toBe(true)
  })

  it('trägt den Raum über den Umfang und nicht über Minuten', () => {
    const schwer = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-30' })
    const wart = geraetMitKuer({ apparatus: 'ringe', elementeStabil: false, tag: '2026-04-01' })
    const { von, bild } = baue(zusammen([schwer, wart], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    // Jeder Inhalt hat eine der drei Stufen - und kein Feld darueber hinaus.
    for (const key of bild.vorgeschlagen) {
      for (const i of von(key).inhalte) {
        expect(['kurz', 'normal', 'schwerpunkt']).toContain(i.umfang)
        expect(Object.keys(i)).not.toContain('minuten')
        expect(Object.keys(i)).not.toContain('dauer')
      }
    }
    expect(von('ringe').inhalte.every((i) => i.umfang === 'kurz')).toBe(true)
  })

  it('gibt dem ersten Element eines Schwerpunkts den Umfang Schwerpunkt', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { von } = baue(zusammen([t], [{ apparatus: 'barren', ...BEIDES }]))
    const el = von('barren').inhalte.filter((i) => i.art === 'element')
    expect(el[0].umfang).toBe('schwerpunkt')
  })
})

describe('Inhaltstyp B – Entwicklungsarbeit', () => {
  it('schlägt einen stabilen schwierigeren Kandidaten vor, wenn 2D das nahelegt', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: true, kandidat: true })
    const { von, fokus } = baue(zusammen([t], [{ apparatus: 'barren', ...SCHWIERIGKEIT }]))
    const f = fokus.geraete.find((g) => g.apparatus === 'barren')!
    expect(f.empfehlung).toBe('schwierigkeit_pruefen')
    expect(hat(von('barren'), 'entwicklung')).toBe(true)
  })

  it('sagt „prüfen" und nirgends „einbauen"', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: true, kandidat: true })
    const { von } = baue(zusammen([t], [{ apparatus: 'barren', ...SCHWIERIGKEIT }]))
    const e = von('barren').inhalte.find((i) => i.art === 'entwicklung')!
    expect(e.text).toMatch(/prüfen/)
    expect(e.text).not.toMatch(/einbauen|Kür aufnehmen|erhöht/)
  })

  it('nennt genau einen Kandidaten, auch wenn mehrere stabil sind', () => {
    const a = element({ apparatus: 'barren', name: 'A', wert: 0.2 })
    const k = kuer({ apparatus: 'barren' })
    const c1 = element({ apparatus: 'barren', name: 'C1', wert: 0.8 })
    const c2 = element({ apparatus: 'barren', name: 'C2', wert: 0.9 })
    const vs = [a, c1, c2].map((e) => stabil(e.id))
    const { von } = baue({
      geraete: [{ apparatus: 'barren', ...SCHWIERIGKEIT }],
      elemente: [a, c1, c2],
      attempts: vs.flatMap((v) => v.attempts),
      einheiten: vs.map((v) => v.einheit),
      kueren: [k],
      verknuepfungen: [platz(k.id, a.id, 1)],
    })
    expect(von('barren').inhalte.filter((i) => i.art === 'entwicklung')).toHaveLength(1)
  })

  it('schlägt keinen Kandidaten vor, solange die Kür zu stabilisieren ist', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, kandidat: true })
    const { von, fokus } = baue(zusammen([t], [{ apparatus: 'barren', ...SCHWIERIGKEIT }]))
    expect(fokus.geraete.find((g) => g.apparatus === 'barren')!.empfehlung).toBe('stabilisieren')
    expect(hat(von('barren'), 'entwicklung')).toBe(false)
  })

  it('schlägt keinen Kandidaten vor, der Hilfe braucht – er ist keiner', () => {
    const a = element({ apparatus: 'barren', name: 'A', wert: 0.2 })
    const k = kuer({ apparatus: 'barren' })
    const c = element({ apparatus: 'barren', name: 'C', wert: 0.9 })
    const va = stabil(a.id)
    const vc = mitHilfe(c.id)
    const { von, fokus } = baue({
      geraete: [{ apparatus: 'barren', ...SCHWIERIGKEIT }],
      elemente: [a, c],
      attempts: [...va.attempts, ...vc.attempts],
      einheiten: [va.einheit, vc.einheit],
      kueren: [k],
      verknuepfungen: [platz(k.id, a.id, 1)],
    })
    expect(fokus.geraete.find((g) => g.apparatus === 'barren')!.kandidaten).toHaveLength(0)
    expect(hat(von('barren'), 'entwicklung')).toBe(false)
    expect(von('barren').hinweise.join(' ')).toMatch(/nicht stabil/)
  })

  it('schlägt keinen Kandidaten an einem Haltegerät vor', () => {
    const t = geraetMitKuer({ apparatus: 'ringe', elementeStabil: true, kandidat: true })
    const { von } = baue(zusammen([t], [{ apparatus: 'ringe', ...HALTEN }]))
    expect(hat(von('ringe'), 'entwicklung')).toBe(false)
  })
})

describe('Inhaltstyp C – Kürdurchgänge', () => {
  /** Eine Kür mit stabilen Elementen und wählbaren Durchgängen. */
  const baueMitRuns = (o: {
    apparatus?: string
    fokus: WkGeraet
    elementeStabil: boolean
    /** Wie viele Durchgänge, und wie viele davon misslungen. */
    runs?: { anzahl: number; abbrueche: number }
    tag?: string
  }) => {
    const apparatus = o.apparatus ?? 'barren'
    const t = geraetMitKuer({
      apparatus, elementeStabil: o.elementeStabil, tag: o.tag,
    })
    const v = fassung(t.kuer, t.verknuepfungen, t.elemente)
    const sid = id('srun')
    const runs: GymRoutineRun[] = []
    const n = o.runs?.anzahl ?? 0
    for (let i = 0; i < n; i++) {
      runs.push(run({
        sessionId: sid,
        versionId: v.id,
        completed: i >= (o.runs?.abbrueche ?? 0),
        sort: i,
      }))
    }
    const bau = zusammen([t], [o.fokus])
    return baue({
      ...bau,
      einheiten: [...(bau.einheiten ?? []), einheit(sid, o.tag ?? '2026-05-20')],
      runs,
      versionen: n ? [v] : [],
    })
  }

  it('schlägt die ganze Kür zuerst vor, wenn die Elemente stehen und die Kür nicht', () => {
    const { von, fokus } = baueMitRuns({
      fokus: { apparatus: 'barren', ...SCHWIERIGKEIT },
      elementeStabil: true,
      runs: { anzahl: 4, abbrueche: 4 },
    })
    expect(fokus.geraete.find((g) => g.apparatus === 'barren')!.empfehlung)
      .toBe('kuer_unter_belastung')
    expect(von('barren').reihenfolgeArt).toBe('kuer_zuerst')
    expect(arten(von('barren'))[0]).toBe('durchgang')
  })

  it('schlägt dann eine Spanne von bis zu zwei Durchgängen vor', () => {
    const { von } = baueMitRuns({
      fokus: { apparatus: 'barren', ...SCHWIERIGKEIT },
      elementeStabil: true,
      runs: { anzahl: 4, abbrueche: 4 },
    })
    const d = von('barren').inhalte.find((i) => i.art === 'durchgang')!
    expect(d.durchgaenge).toEqual(DURCHGANGS_VORGABE.kuerImVordergrund)
    expect(d.umfang).toBe('schwerpunkt')
  })

  it('nennt bei stabiler Kür nur einen Durchgang, und zwar hinten', () => {
    const { von } = baueMitRuns({
      fokus: { apparatus: 'barren', ...SCHWIERIGKEIT },
      elementeStabil: true,
      runs: { anzahl: 4, abbrueche: 0 },
    })
    const d = von('barren').inhalte.find((i) => i.art === 'durchgang')!
    expect(d.durchgaenge).toEqual(DURCHGANGS_VORGABE.nebenbei)
  })

  it('schlägt auch bei instabilen Elementen einen Durchgang vor – aber nach ihnen', () => {
    const t = geraetMitKuer({ apparatus: 'reck', elementeStabil: false })
    const { von } = baue(zusammen([t], [{ apparatus: 'reck', ...AUSFUEHRUNG }]))
    expect(von('reck').reihenfolgeArt).toBe('elemente_zuerst')
    const a = arten(von('reck'))
    expect(a).toContain('durchgang')
    expect(a.indexOf('element')).toBeLessThan(a.indexOf('durchgang'))
  })

  it('schlägt ohne Wettkampfkür keinen Durchgang vor', () => {
    const a = element({ apparatus: 'boden', name: 'A' })
    const v = instabil(a.id)
    const { von } = baue({
      geraete: [{ apparatus: 'boden', ...AUSFUEHRUNG }],
      elemente: [a],
      attempts: v.attempts,
      einheiten: [v.einheit],
    })
    expect(hat(von('boden'), 'durchgang')).toBe(false)
  })

  it('nennt einen Durchgang an einem Wartungsgerät kurz', () => {
    const p = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-30' })
    const s = geraetMitKuer({ apparatus: 'ringe', elementeStabil: true, tag: '2026-04-01' })
    const { von } = baue(zusammen([p, s], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    expect(von('ringe').rolle).toBe('wartung')
    const d = von('ringe').inhalte.find((i) => i.art === 'durchgang')!
    expect(d.umfang).toBe('kurz')
  })
})

/* ============================================= Kürfassung (Phase 2E) */

describe('Kürfassung – eine geänderte Kür fängt neu an', () => {
  /**
   * Drei gute Durchgänge auf der ALTEN Fassung, dann ein Element ergänzt.
   *
   * Die alte Fassung bleibt in `gym_routine_versions` stehen, die Durchgänge
   * zeigen weiter auf sie – die jetzige Fassung hat damit keinen Durchgang.
   */
  const baueFassungswechsel = (geaendert: boolean) => {
    const a = element({ apparatus: 'barren', name: 'A', wert: 0.2 })
    const b = element({ apparatus: 'barren', name: 'B', wert: 0.3 })
    const c = element({ apparatus: 'barren', name: 'C', wert: 0.4 })
    const k = kuer({ apparatus: 'barren' })

    const alt = [platz(k.id, a.id, 1), platz(k.id, b.id, 2)]
    const altFassung = fassung(k, alt, [a, b, c])
    const jetzt = geaendert ? [...alt, platz(k.id, c.id, 3)] : alt

    const sid = id('srun')
    const runs = [0, 1, 2].map((i) =>
      run({ sessionId: sid, versionId: altFassung.id, sort: i }))

    const vs = [a, b, c].map((e) => stabil(e.id))
    return baue({
      geraete: [{ apparatus: 'barren', ...SCHWIERIGKEIT }],
      elemente: [a, b, c],
      attempts: vs.flatMap((v) => v.attempts),
      einheiten: [...vs.map((v) => v.einheit), einheit(sid, '2026-05-20')],
      kueren: [k],
      verknuepfungen: jetzt,
      runs,
      versionen: [altFassung],
    })
  }

  it('zählt die guten Durchgänge, solange die Kür unverändert ist', () => {
    const { fokus } = baueFassungswechsel(false)
    const f = fokus.geraete.find((g) => g.apparatus === 'barren')!
    expect(f.durchgaenge!.aktuell.durchgaenge).toBe(3)
    expect(f.durchgangsLage).toBe('stabil')
  })

  it('behandelt alte Durchgänge nach einer Küränderung nicht als aktuelle Stabilität', () => {
    const { fokus, von } = baueFassungswechsel(true)
    const f = fokus.geraete.find((g) => g.apparatus === 'barren')!
    expect(f.durchgaenge!.aktuell.durchgaenge).toBe(0)
    expect(f.durchgaenge!.fruehere.durchgaenge).toBe(3)
    expect(von('barren').tageHerKomplett).toBeNull()
  })

  it('sagt beim Fassungswechsel, dass die aktuelle Fassung unerfasst ist', () => {
    const { von } = baueFassungswechsel(true)
    const d = von('barren').inhalte.find((i) => i.art === 'durchgang')!
    expect(d.warum.join(' ')).toMatch(/aktuelle Kürfassung/)
    expect(d.warum.join(' ')).toMatch(/vorherigen Fassung/)
  })

  it('schlägt nach dem Fassungswechsel einen Durchgang vor', () => {
    const { von } = baueFassungswechsel(true)
    expect(hat(von('barren'), 'durchgang')).toBe(true)
  })
})

/* ================================================= Reihenfolge im Gerät */

describe('Reihenfolge innerhalb eines Geräts', () => {
  it('ordnet im Normalfall Elemente, Entwicklung, Kür', () => {
    const t = geraetMitKuer({ apparatus: 'reck', elementeStabil: false })
    const { von } = baue(zusammen([t], [{ apparatus: 'reck', ...AUSFUEHRUNG }]))
    const a = arten(von('reck'))
    expect(a.indexOf('element')).toBeLessThan(a.indexOf('durchgang'))
  })

  it('stellt Entwicklung voran, wenn Kür und Elemente tragen', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: true, kandidat: true })
    const v = fassung(t.kuer, t.verknuepfungen, t.elemente)
    const sid = id('srun')
    const runs = [0, 1, 2, 3].map((i) => run({ sessionId: sid, versionId: v.id, sort: i }))
    const bau = zusammen([t], [{ apparatus: 'barren', ...SCHWIERIGKEIT }])
    const { von } = baue({
      ...bau,
      einheiten: [...(bau.einheiten ?? []), einheit(sid, '2026-05-20')],
      runs,
      versionen: [v],
    })
    expect(von('barren').reihenfolgeArt).toBe('entwicklung_zuerst')
    expect(arten(von('barren'))[0]).toBe('entwicklung')
  })

  it('reiht die Reihenfolgeart nachvollziehbar aus der 2D-Empfehlung ab', () => {
    // Direkt an der reinen Funktion, ohne Aufbau: die Tabelle selbst.
    const g = (empfehlung: string, lage: string, durchgangsLage: string) =>
      reihenfolgeArtFuer({ empfehlung, lage, durchgangsLage } as any)
    expect(g('kuer_unter_belastung', 'stabil', 'instabil')).toBe('kuer_zuerst')
    expect(g('schwierigkeit_pruefen', 'stabil', 'stabil')).toBe('entwicklung_zuerst')
    expect(g('schwierigkeit_pruefen', 'stabil', 'instabil')).toBe('elemente_zuerst')
    expect(g('stabilisieren', 'instabil', 'instabil')).toBe('elemente_zuerst')
    expect(g('technik_stabilitaet', 'gemischt', 'zu_wenig_daten')).toBe('elemente_zuerst')
    expect(g('wartung', 'stabil', 'zu_wenig_daten')).toBe('elemente_zuerst')
  })
})

/* ================================================= Wenig oder keine Daten */

describe('Wenig Daten – keine absurden Empfehlungen', () => {
  it('sagt ohne alles klar, dass es zu wenig Daten sind', () => {
    const { bild } = baue({ ohneWettkampf: true })
    expect(bild.vorgeschlagen).toHaveLength(0)
    expect(bild.grund).toBe('keine_elemente')
  })

  it('arbeitet ohne Wettkampfdaten mit den Trainingsdaten weiter', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { bild, von } = baue({ ...zusammen([t], []), ohneWettkampf: true })
    expect(bild.hatWettkampf).toBe(false)
    expect(von('barren').prioritaet).toBe('zu_wenig_daten')
    expect(bild.vorgeschlagen).toContain('barren')
    expect(von('barren').inhalte.length).toBeGreaterThan(0)
  })

  it('gibt ohne Trainingsdaten keine Elementempfehlung, aber einen Durchgang', () => {
    const a = element({ apparatus: 'barren', name: 'A' })
    const b = element({ apparatus: 'barren', name: 'B' })
    const k = kuer({ apparatus: 'barren' })
    const { von, bild } = baue({
      geraete: [{ apparatus: 'barren', ...BEIDES }],
      elemente: [a, b],
      kueren: [k],
      verknuepfungen: [platz(k.id, a.id, 1), platz(k.id, b.id, 2)],
    })
    expect(bild.hatTraining).toBe(false)
    expect(von('barren').hatTrainingsdaten).toBe(false)
    expect(hat(von('barren'), 'element')).toBe(false)
    expect(hat(von('barren'), 'durchgang')).toBe(true)
    expect(von('barren').hinweise.join(' ')).toMatch(/kein Versuch/)
  })

  it('nennt ein Gerät ohne Kür und ohne auffälliges Element als nichts zu tun', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { von } = baue(zusammen([t], [{ apparatus: 'barren', ...BEIDES }]))
    // Sprung ist gar nicht aufgebaut.
    expect(von('sprung').rolle).toBeNull()
    expect(von('sprung').inhalte).toHaveLength(0)
    expect(von('sprung').nichtsZuTun).not.toBeNull()
  })

  it('plant mit nur einem trainierbaren Gerät genau dieses', () => {
    const t = geraetMitKuer({ apparatus: 'sprung', elementeStabil: false })
    const { bild } = baue(zusammen([t], [{ apparatus: 'sprung', ...BEIDES }]))
    expect(bild.vorgeschlagen).toEqual(['sprung'])
    expect(geraeteLabel(bild.vorgeschlagen.length)).toBe('1 Gerät vorgeschlagen')
  })

  it('schlägt ein Gerät ohne jedes Element nicht vor', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { bild } = baue(zusammen([t], [
      { apparatus: 'barren', ...BEIDES },
      // Reck hat einen Wettkampfbefund, aber kein einziges Element.
      { apparatus: 'reck', ...BEIDES },
    ]))
    expect(bild.vorgeschlagen).not.toContain('reck')
  })
})

/* ====================================================== Datenstandhinweise */

describe('Datenstandhinweise sind keine Übungen', () => {
  it('nennt ein archiviertes Element in der Kür als Hinweis, nicht als Aufgabe', () => {
    const a = element({ apparatus: 'barren', name: 'A', aktiv: false })
    const b = element({ apparatus: 'barren', name: 'B' })
    const k = kuer({ apparatus: 'barren' })
    const va = stabil(a.id)
    const vb = stabil(b.id)
    const { von } = baue({
      geraete: [{ apparatus: 'barren', ...BEIDES }],
      elemente: [a, b],
      attempts: [...va.attempts, ...vb.attempts],
      einheiten: [va.einheit, vb.einheit],
      kueren: [k],
      verknuepfungen: [platz(k.id, a.id, 1), platz(k.id, b.id, 2)],
    })
    expect(von('barren').hinweise.join(' ')).toMatch(/archiviert/)
    // Das archivierte Element steht stabil – es ist keine Trainingsaufgabe.
    const el = von('barren').inhalte.filter((i) => i.art === 'element')
    expect(el.some((i) => i.elementId === a.id)).toBe(false)
  })

  it('nennt einen gelöschten Kürplatz als Hinweis', () => {
    const a = element({ apparatus: 'barren', name: 'A' })
    const weg = element({ apparatus: 'barren', name: 'Weg', weg: true })
    const k = kuer({ apparatus: 'barren' })
    const va = instabil(a.id)
    const { von } = baue({
      geraete: [{ apparatus: 'barren', ...BEIDES }],
      elemente: [a, weg],
      attempts: va.attempts,
      einheiten: [va.einheit],
      kueren: [k],
      verknuepfungen: [platz(k.id, a.id, 1), platz(k.id, weg.id, 2)],
    })
    expect(von('barren').hinweise.join(' ')).toMatch(/gelöschte/)
    expect(von('barren').inhalte.every((i) => i.elementId !== weg.id)).toBe(true)
  })
})

/* ========================================================== Begründung */

describe('Begründung – nur vorhandene Daten', () => {
  it('begründet jedes vorgeschlagene Gerät und jeden Inhalt', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { bild, von } = baue(zusammen([t], [{ apparatus: 'barren', ...BEIDES }]))
    for (const key of bild.vorgeschlagen) {
      const g = von(key)
      expect(g.warum.length).toBeGreaterThan(0)
      expect(g.warum.every((s) => s.trim().length > 0)).toBe(true)
      for (const i of g.inhalte) expect(i.warum.length).toBeGreaterThan(0)
    }
  })

  it('übernimmt die Datenpunkte aus Phase 2D unverändert', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { von, fokus } = baue(zusammen([t], [{ apparatus: 'barren', ...BEIDES }]))
    const f = fokus.geraete.find((g) => g.apparatus === 'barren')!
    // Erster Satz ist die Rolle, danach 2D wörtlich - nichts umformuliert.
    expect(von('barren').warum.slice(1)).toEqual(f.begruendung)
  })

  it('nennt bei Wartung ausdrücklich, dass es kein Wettkampfnachteil ist', () => {
    const p = geraetMitKuer({ apparatus: 'barren', elementeStabil: false, tag: '2026-05-30' })
    const s = geraetMitKuer({ apparatus: 'ringe', elementeStabil: false, tag: '2026-04-01' })
    const { von } = baue(zusammen([p, s], [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    expect(von('ringe').rolle).toBe('wartung')
    expect(von('ringe').warum[0]).toMatch(/kein Wettkampfnachteil/)
  })

  it('erwähnt das Beobachtungsfenster mit derselben Wochenzahl wie der Rest', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: true, kandidat: true })
    const { von } = baue(zusammen([t], [{ apparatus: 'barren', ...SCHWIERIGKEIT }]))
    const e = von('barren').inhalte.find((i) => i.art === 'entwicklung')!
    expect(e.warum.join(' ')).toContain(`${Math.round(SCHWELLEN.fensterTage / 7)} Wochen`)
  })
})

/* ======================================================= Nutzerkontrolle */

describe('Der Plan ist ein Vorschlag – die Wahl liegt beim Nutzer', () => {
  const dreiGeraete = () => {
    const teile = ['barren', 'reck', 'boden'].map((a) =>
      geraetMitKuer({ apparatus: a, elementeStabil: false }))
    return baue(zusammen(teile, [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'reck', ...BEIDES },
      { apparatus: 'boden', ...SCHWIERIGKEIT_MITTEL },
    ]))
  }

  it('lässt ein Gerät abwählen', () => {
    const { bild } = dreiGeraete()
    const weg = bild.vorgeschlagen[0]
    const plan = planMitAuswahl(bild, { ohne: [weg] })
    expect(plan.map((g) => g.apparatus)).not.toContain(weg)
    expect(plan).toHaveLength(bild.vorgeschlagen.length - 1)
  })

  it('lässt ein Gerät hinzuwählen und kennzeichnet es als Nutzerwahl', () => {
    const teile = ['barren', 'ringe'].map((a) =>
      geraetMitKuer({ apparatus: a, elementeStabil: false, tag: '2026-05-28' }))
    const { bild } = baue(zusammen(teile, [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    const plan = planMitAuswahl(bild, { zusatz: ['ringe'] })
    const r = plan.find((g) => g.apparatus === 'ringe')
    expect(r).toBeTruthy()
    expect(r!.inhalte.length).toBeGreaterThan(0)
  })

  it('nimmt ein Gerät ohne Inhalte nicht dazu – es stünde leer da', () => {
    const t = geraetMitKuer({ apparatus: 'barren', elementeStabil: false })
    const { bild } = baue(zusammen([t], [{ apparatus: 'barren', ...BEIDES }]))
    const plan = planMitAuswahl(bild, { zusatz: ['sprung'] })
    expect(plan.map((g) => g.apparatus)).not.toContain('sprung')
  })

  it('lässt die Reihenfolge ändern', () => {
    const { bild } = dreiGeraete()
    const umgekehrt = [...bild.vorgeschlagen].reverse()
    const plan = planMitAuswahl(bild, { reihenfolge: umgekehrt })
    expect(plan.map((g) => g.apparatus)).toEqual(umgekehrt)
  })

  it('übergeht unbekannte Schlüssel in der Wunschreihenfolge', () => {
    const { bild } = dreiGeraete()
    const plan = planMitAuswahl(bild, { reihenfolge: ['gibtsnicht', bild.vorgeschlagen[2]] })
    expect(plan[0].apparatus).toBe(bild.vorgeschlagen[2])
    expect(plan).toHaveLength(bild.vorgeschlagen.length)
  })

  it('lässt einen einzelnen Inhalt entfernen', () => {
    const { bild } = dreiGeraete()
    const erst = bild.geraete.find((g) => g.apparatus === bild.vorgeschlagen[0])!
    const key = erst.inhalte[0].key
    const plan = planMitAuswahl(bild, { ohneInhalte: [key] })
    const g = plan.find((x) => x.apparatus === erst.apparatus)!
    expect(g.inhalte.some((i) => i.key === key)).toBe(false)
    expect(g.inhalte).toHaveLength(erst.inhalte.length - 1)
  })

  it('lässt ein Gerät stehen, auch wenn alle seine Inhalte entfernt wurden', () => {
    const { bild } = dreiGeraete()
    const erst = bild.geraete.find((g) => g.apparatus === bild.vorgeschlagen[0])!
    const plan = planMitAuswahl(bild, { ohneInhalte: erst.inhalte.map((i) => i.key) })
    const g = plan.find((x) => x.apparatus === erst.apparatus)
    expect(g).toBeTruthy()
    expect(g!.inhalte).toHaveLength(0)
  })

  it('ändert das Ausgangsbild nicht – die Wahl ist eine Sicht darauf', () => {
    const { bild } = dreiGeraete()
    const vorher = bild.vorgeschlagen.length
    const inhalteVorher = bild.geraete.map((g) => g.inhalte.length)
    planMitAuswahl(bild, { ohne: [bild.vorgeschlagen[0]], ohneInhalte: ['x'] })
    expect(bild.vorgeschlagen).toHaveLength(vorher)
    expect(bild.geraete.map((g) => g.inhalte.length)).toEqual(inhalteVorher)
  })

  it('bietet als nachwählbar nur Geräte mit Inhalten an, die nicht drin sind', () => {
    const teile = ['barren', 'ringe'].map((a) =>
      geraetMitKuer({ apparatus: a, elementeStabil: false, tag: '2026-05-28' }))
    const { bild } = baue(zusammen(teile, [
      { apparatus: 'barren', ...BEIDES },
      { apparatus: 'ringe', ...HALTEN },
    ]))
    const frei = nachwaehlbar(bild)
    expect(frei.every((g) => g.inhalte.length > 0)).toBe(true)
    expect(frei.every((g) => !bild.vorgeschlagen.includes(g.apparatus))).toBe(true)
    expect(nachwaehlbar(bild, { zusatz: frei.map((g) => g.apparatus) })).toHaveLength(0)
  })

  it('ist ohne Wahl genau der Vorschlag', () => {
    const { bild } = dreiGeraete()
    expect(planMitAuswahl(bild).map((g) => g.apparatus)).toEqual(bild.vorgeschlagen)
  })
})

/* ================================================= Abgrenzung am Quelltext */

describe('Was diese Phase nicht tut', () => {
  const quelle = () => readFileSync(
    new URL('../src/core/turnen/trainingsplanung.ts', import.meta.url), 'utf8')

  const code = () => quelle().split(/\r?\n/)
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')

  it('legt keine Tabelle an und schreibt nichts', () => {
    // Phase 3A rechnet nur - kein Schema, keine Persistenz.
    expect(code()).not.toMatch(/gym_routine_plans|training_plans|CREATE TABLE/)
    expect(code()).not.toMatch(/\bm\.create\b|\bm\.patch\b|\bremoveQuiet\b/)
  })

  it('kennt keinen Kalender, keine Schicht und keine Aufgaben', () => {
    expect(code()).not.toMatch(/calendar_events|shift_patterns|task_templates|notifications/)
  })

  it('erfindet keine Satz- und Wiederholungszahlen', () => {
    // Die einzige Zahl am Inhalt ist die Durchgangsspanne, und die ist <= 2.
    expect(DURCHGANGS_VORGABE.kuerImVordergrund.bis).toBeLessThanOrEqual(2)
    expect(code()).not.toMatch(/wiederholungen|saetze|reps\b/i)
  })

  it('behauptet keine physiologische Gerätereihenfolge', () => {
    const c = code()
    expect(c).not.toMatch(/ermuedung|muedigkeit|regeneration|belastungssteuerung/i)
  })

  it('plant keine Zeit – keine Dauer, keine Minuten, kein Verteilungsschlüssel', () => {
    // Phase 3A beantwortet WAS, nicht wie lange. Eine Minutenverteilung war
    // kurzzeitig da und ist als Scope-Ueberschreitung wieder entfernt worden;
    // diese Zusicherung haelt sie draussen.
    const c = code()
    expect(c).not.toMatch(/dauerMinuten|DAUER_GEWICHT|aufteilung|formatDuration/)
    expect(c).not.toMatch(/minuten/i)
  })

  it('nennt die Auswahlregeln ausdrücklich eine Produktheuristik', () => {
    // Die Zahlen sind eine Verabredung. Sie als optimale Verteilung
    // darzustellen waere die eigentliche Falschaussage dieser Phase.
    const q = quelle()
    const kopf = q.slice(q.indexOf('export const PLAN_SCHWELLEN') - 1600,
      q.indexOf('export const PLAN_SCHWELLEN'))
    expect(kopf).toMatch(/Produktheuristik/)
    expect(kopf).toMatch(/keine Messung/)
    expect(kopf).toMatch(/trainingswissenschaftlich/)
  })

  it('schreibt nirgends, dass ein Element in die Kür kommt', () => {
    // Am Code, nicht am Kommentar: Der Dateikopf sagt ausdruecklich, dass
    // genau dieser Satz NICHT vorkommen darf - er darf ihn dabei nennen.
    expect(code()).not.toMatch(/in die Kür einbauen|erhöht den D-Wert/)
  })
})

/* ============================================================ Performance */

describe('Performance – der Plan ist ein Nachschlagen', () => {
  /** Der grosse Bestand: 100 Elemente, 6 Küren, viele Versuche und Durchgänge. */
  const gross = () => {
    const elemente: GymElement[] = []
    for (const g of GERAETE) {
      for (let i = 0; i < 17; i++) {
        elemente.push(element({
          apparatus: g.key, name: `${g.kurz} ${i}`, wert: 0.1 + i * 0.05,
        }))
      }
    }
    const kueren: GymRoutine[] = []
    const verkn: GymRoutineElement[] = []
    for (const g of GERAETE) {
      const k = kuer({ apparatus: g.key })
      kueren.push(k)
      const eigene = elemente.filter((x) => x.apparatus === g.key).slice(0, 8)
      for (const [pos, el] of eigene.entries()) verkn.push(platz(k.id, el.id, pos + 1))
    }
    const versionen = kueren.map((k) => fassung(k, verkn, elemente))

    const einheiten: any[] = []
    const attempts: GymAttempt[] = []
    for (let i = 0; i < 4000; i++) {
      const sid = `sess-${Math.floor(i / 40)}`
      if (i % 40 === 0) {
        einheiten.push(einheit(sid, `2026-0${(i % 5) + 1}-${String((i % 28) + 1).padStart(2, '0')}`))
      }
      const el = elemente[i % elemente.length]
      attempts.push({
        id: `a-${i}`, session_id: sid, element_id: el.id,
        clean: i % 3 === 0 ? 2 : 1, shaky: i % 5 === 0 ? 1 : 0,
        failed: i % 7 === 0 ? 1 : 0, with_help: 0,
        note: null, sort_order: i % 40, deleted_at: null,
      } as unknown as GymAttempt)
    }
    const runs: GymRoutineRun[] = []
    for (let i = 0; i < 1000; i++) {
      runs.push(run({
        sessionId: `sess-${Math.floor(i / 40) % 100}`,
        versionId: versionen[i % versionen.length].id,
        completed: i % 5 !== 0,
        falls: i % 7 === 0 ? 1 : 0,
        sort: i % 4,
      }))
    }
    return { elemente, kueren, verkn, versionen, einheiten, attempts, runs }
  }

  const bestand = gross()

  it('hat den erwarteten Bestand', () => {
    expect(bestand.elemente).toHaveLength(102)
    expect(bestand.attempts).toHaveLength(4000)
    expect(bestand.runs).toHaveLength(1000)
    expect(bestand.versionen).toHaveLength(6)
  })

  it('rechnet die Planung auf dem grossen Bestand unter 10 ms', () => {
    const bloecke = bloeckeMitTag(bestand.attempts, bestand.einheiten)
    const bilder = geraetBilder(bestand.elemente, bloecke, HEUTE, diffDays, BRAUCHT_ARBEIT)
    const durchgaenge = durchgaengeJeGeraet({
      runs: bestand.runs, versionen: bestand.versionen, einheiten: bestand.einheiten,
      kueren: bestand.kueren, kuerVerknuepfungen: bestand.verkn,
      elemente: bestand.elemente, heute: HEUTE, tagDifferenz: diffDays,
    })
    const teil = wettkampfteil(GERAETE.map((g) => ({ apparatus: g.key, ...BEIDES })))
    const fokus = trainingsfokus({
      analyse: wettkampfAnalyse(teil.wk, teil.ergebnisse, teil.benchmarks),
      verlauf: new Map(),
      elemente: bestand.elemente, versuche: bestand.attempts,
      einheiten: bestand.einheiten, kueren: bestand.kueren,
      kuerVerknuepfungen: bestand.verkn, durchgaenge,
      heute: HEUTE, tagDifferenz: diffDays,
    })

    // Gemessen wird NUR die Planung: Fokus und Durchgaenge rechnet die
    // Oberflaeche ohnehin schon fuer die Analyse.
    const t0 = performance.now()
    const bild = trainingsplanung({ fokus, geraetBilder: bilder })
    const dauer = performance.now() - t0
    // eslint-disable-next-line no-console
    console.log(`  trainingsplanung(): ${dauer.toFixed(2)} ms auf 4.000 Versuchen, `
      + '1.000 Durchgängen, 102 Elementen')
    expect(bild.geraete).toHaveLength(6)
    expect(dauer).toBeLessThan(10)
  })

  it('kostet die Nutzerwahl nichts – sie rechnet nicht neu', () => {
    const bloecke = bloeckeMitTag(bestand.attempts, bestand.einheiten)
    const bilder = geraetBilder(bestand.elemente, bloecke, HEUTE, diffDays, BRAUCHT_ARBEIT)
    const teil = wettkampfteil(GERAETE.map((g) => ({ apparatus: g.key, ...BEIDES })))
    const fokus = trainingsfokus({
      analyse: wettkampfAnalyse(teil.wk, teil.ergebnisse, teil.benchmarks),
      verlauf: new Map(),
      elemente: bestand.elemente, versuche: bestand.attempts,
      einheiten: bestand.einheiten, kueren: bestand.kueren,
      kuerVerknuepfungen: bestand.verkn,
      heute: HEUTE, tagDifferenz: diffDays,
    })
    const bild = trainingsplanung({ fokus, geraetBilder: bilder })

    let beste = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      planMitAuswahl(bild, { ohne: ['boden'], zusatz: ['ringe'], reihenfolge: ['reck'] })
      beste = Math.min(beste, performance.now() - t0)
    }
    expect(beste).toBeLessThan(1)
  })
})
