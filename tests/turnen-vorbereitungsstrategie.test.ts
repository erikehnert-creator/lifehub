/**
 * Vorbereitungsstrategie (Phase 3D) – der Wettkampfabstand verschiebt die
 * Priorität vorhandener Inhalte.
 *
 * ---------------------------------------------------------------------------
 * Geprüft wird durch die echte Kette
 *
 * Elemente und Versuche → `durchgaengeJeGeraet()` (2E) → `trainingsfokus()`
 * (2D) → `trainingsplanung()` (3A) → `wettkampfvorbereitung()` (3C) →
 * `planMitVorbereitung()` (3D). Ein nachgebautes `PlanungsBild` würde nur die
 * eigene Annahme darüber prüfen, was 3A liefert – und 3D ist nichts anderes
 * als eine Umsortierung genau dieser Liste.
 *
 * ---------------------------------------------------------------------------
 * Der wichtigste Test steht in „Gleicher Datenstand, anderer Abstand"
 *
 * Dort wird **ein** Datenbestand gebaut und ausschliesslich das Wettkampfdatum
 * verschoben. Jeder Unterschied im Vorschlag muss sich auf eine dokumentierte
 * Phase-3D-Regel zurückführen lassen; alles andere wäre ein Nebeneffekt.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { diffDays } from '../src/core/dates'
import { BRAUCHT_ARBEIT } from '../src/core/turnen/status'
import { bloeckeMitTag, geraetBilder } from '../src/core/turnen/elemente'
import { wettkampfAnalyse, type VergleichsWerte } from '../src/core/turnen/analyse'
import { fassungsId, fassungsInhalt } from '../src/core/turnen/fassungen'
import { durchgaengeJeGeraet } from '../src/core/turnen/kuerdurchgaenge'
import { KUER_SCHWELLEN } from '../src/core/turnen/kueren'
import { trainingsfokus } from '../src/core/turnen/trainingsfokus'
import {
  PLAN_SCHWELLEN, planMitAuswahl, trainingsplanung,
  type GeraetPlan, type PlanungsBild,
} from '../src/core/turnen/trainingsplanung'
import { WOCHEN_SCHWELLEN } from '../src/core/turnen/wochenplanung'
import { wettkampfvorbereitung, type WettkampfZiel } from '../src/core/turnen/wettkampfvorbereitung'
import {
  LEITLINIE_LABEL, PHASE_LABEL, PHASE_LEITSATZ, VORBEREITUNG_SCHWELLEN,
  leitlinieAus, phaseAus, phaseGreiftEin, phaseKurztext, planMitVorbereitung,
  vorbereitungsstrategie, zurueckgestelltHinweis,
  type VorbereitungsPhase,
} from '../src/core/turnen/vorbereitungsstrategie'
import type {
  GymAttempt, GymCompetition, GymElement, GymResult, GymRoutine, GymRoutineElement,
  GymRoutineRun, GymRoutineVersion,
} from '../src/core/types'

const HEUTE = '2026-06-01'
const ALT_ID = 'wk-alt'

let lauf = 0
const id = (p: string) => `${p}-${++lauf}`

/* ============================================================ Bausteine */

function wk(o: { id?: string; day: string; name?: string }): GymCompetition {
  return {
    id: o.id ?? id('wk'),
    day: o.day,
    name: o.name ?? `Wettkampf ${o.day}`,
    location: null, class_name: null, rank_allround: null, score_allround: null,
    protocol_url: null, note: null, deleted_at: null,
  } as unknown as GymCompetition
}

function element(o: Partial<GymElement> & { apparatus: string; name: string }): GymElement {
  return {
    id: o.id ?? id('el'),
    apparatus: o.apparatus,
    name: o.name,
    difficulty_letter: o.difficulty_letter ?? null,
    difficulty_value: o.difficulty_value ?? null,
    element_group: null, is_dismount: 0, hold_element: 0,
    status: o.status ?? 'sicher',
    video_url: null, note: null,
    is_active: o.is_active ?? 1,
    sort_order: 0,
    deleted_at: o.deleted_at ?? null,
  } as unknown as GymElement
}

function kuer(o: { apparatus: string; name?: string }): GymRoutine {
  return {
    id: id('k'), apparatus: o.apparatus, name: o.name ?? `Kür ${o.apparatus}`,
    note: null, is_active: 1,
    competition_since: '2026-01-01T10:00:00.000Z',
    deleted_at: null,
  } as unknown as GymRoutine
}

function kuerPlatz(routineId: string, elementId: string, position: number): GymRoutineElement {
  return {
    id: id('re'), routine_id: routineId, element_id: elementId, position, note: null,
    created_at: `2026-01-01T00:00:0${position}.000Z`, deleted_at: null,
  } as unknown as GymRoutineElement
}

function versuche(o: {
  elementId: string; tag: string; clean?: number; shaky?: number; failed?: number
}): { einheit: any; attempts: GymAttempt[] } {
  const sid = id('s')
  return {
    einheit: { id: sid, day: o.tag, deleted_at: null },
    attempts: [{
      id: id('a'), session_id: sid, element_id: o.elementId,
      clean: o.clean ?? 0, shaky: o.shaky ?? 0, failed: o.failed ?? 0,
      with_help: 0, note: null, sort_order: 0, deleted_at: null,
    } as unknown as GymAttempt],
  }
}

function durchgaenge(o: {
  versionId: string; tag: string; anzahl: number; sauber: number
}): { einheit: any; runs: GymRoutineRun[] } {
  const sid = id('s')
  const runs: GymRoutineRun[] = []
  for (let i = 0; i < o.anzahl; i++) {
    const gut = i < o.sauber
    runs.push({
      id: id('run'), session_id: sid, routine_version_id: o.versionId,
      completed: gut ? 1 : 0, falls: gut ? 0 : 1, interruptions: 0, with_help: 0,
      quality: null, note: null, sort_order: i, deleted_at: null,
    } as unknown as GymRoutineRun)
  }
  return { einheit: { id: sid, day: o.tag, deleted_at: null }, runs }
}

function fassung(o: { id: string; routineId: string; apparatus: string }): GymRoutineVersion {
  return {
    id: o.id, routine_id: o.routineId, apparatus: o.apparatus, name: 'Fassung',
    frozen_at: '2026-02-01T00:00:00Z', deleted_at: null,
  } as unknown as GymRoutineVersion
}

/**
 * Der Wettkampfteil: echte 2C-Rechnung.
 *
 * `dRang`/`eRang` sind Plätze in einem Feld von sechs. Aus einem schwachen
 * D-Rang und einem guten E-Rang macht 2C den Fokus `schwierigkeit` – und nur
 * der führt in 3A überhaupt zu einem Entwicklungsinhalt. Ohne diesen Teil
 * hätte Phase 3D nichts zu verschieben.
 */
function wettkampfteil(apparatus: string, o: { dRang: number; eRang: number }) {
  const ergebnis = {
    id: `r-${apparatus}`, competition_id: ALT_ID, apparatus,
    routine_version_id: null,
    d_score: 3, e_score: 8.4, penalty: null, final_score: 11.4,
    rank_apparatus: null, note: null, deleted_at: null,
  } as unknown as GymResult
  const benchmark: VergleichsWerte = {
    competition_id: ALT_ID, scope: apparatus, cohort_label: 'LK 2', cohort_size: 6,
    final_rank: 3, final_tie_count: 1, final_count: 6, final_median: 11.4, final_best: 12.2,
    d_rank: o.dRang, d_tie_count: 1, d_count: 6, d_median: 3.4, d_best: 4,
    e_rank: o.eRang, e_tie_count: 1, e_count: 6, e_median: 8.2, e_best: 8.8,
  }
  return { ergebnis, benchmark }
}

/* ====================================================== Die ganze Kette */

interface Bestand {
  elemente: GymElement[]
  kueren: GymRoutine[]
  verknuepfungen: GymRoutineElement[]
  einheiten: any[]
  attempts: GymAttempt[]
  runs: GymRoutineRun[]
  versionen: GymRoutineVersion[]
  ergebnisse: GymResult[]
  benchmarks: VergleichsWerte[]
}

const leererBestand = (): Bestand => ({
  elemente: [], kueren: [], verknuepfungen: [], einheiten: [], attempts: [],
  runs: [], versionen: [], ergebnisse: [], benchmarks: [],
})

/**
 * Ein Gerät mit stabiler Kür, stabilen Durchgängen und einem stabilen,
 * schwierigeren Kandidaten aussen vor.
 *
 * Genau die Lage, in der Phase 2D `schwierigkeit_pruefen` sagt und Phase 3A
 * daraus Entwicklungsarbeit macht – also der Fall, den Phase 3D verschiebt.
 */
function geraetMitKandidat(b: Bestand, apparatus: string, o: {
  kuerSauber?: number
  kuerDurchgaenge?: number
  elementeStabil?: boolean
} = {}) {
  const e1 = element({ apparatus, name: `${apparatus} Kür A`, difficulty_value: 0.2, difficulty_letter: 'B' })
  const e2 = element({ apparatus, name: `${apparatus} Kür B`, difficulty_value: 0.3, difficulty_letter: 'C' })
  const kandidat = element({
    apparatus, name: `${apparatus} Kandidat`, difficulty_value: 0.5, difficulty_letter: 'E',
  })
  const k = kuer({ apparatus })
  b.elemente.push(e1, e2, kandidat)
  b.kueren.push(k)
  b.verknuepfungen.push(kuerPlatz(k.id, e1.id, 0), kuerPlatz(k.id, e2.id, 1))

  const stabil = o.elementeStabil !== false
  for (const el of [e1, e2]) {
    const v = stabil
      ? versuche({ elementId: el.id, tag: '2026-05-20', clean: 20 })
      : versuche({ elementId: el.id, tag: '2026-05-20', clean: 4, shaky: 4, failed: 4 })
    b.einheiten.push(v.einheit)
    b.attempts.push(...v.attempts)
  }
  // Der Kandidat muss selbst stabil sein, sonst nennt 2D ihn nicht.
  const vk = versuche({ elementId: kandidat.id, tag: '2026-05-21', clean: 20 })
  b.einheiten.push(vk.einheit)
  b.attempts.push(...vk.attempts)

  const fid = fassungsId(fassungsInhalt(k, b.verknuepfungen, b.elemente))
  b.versionen.push(fassung({ id: fid, routineId: k.id, apparatus }))
  const anzahl = o.kuerDurchgaenge ?? 4
  if (anzahl > 0) {
    const d = durchgaenge({
      versionId: fid, tag: '2026-05-27', anzahl, sauber: o.kuerSauber ?? anzahl,
    })
    b.einheiten.push(d.einheit)
    b.runs.push(...d.runs)
  }

  const teil = wettkampfteil(apparatus, { dRang: 6, eRang: 1 })
  b.ergebnisse.push(teil.ergebnis)
  b.benchmarks.push(teil.benchmark)

  return { kuer: k, elemente: [e1, e2], kandidat, fassungId: fid }
}

function baue(b: Bestand, o: {
  wettkaempfe?: GymCompetition[]
  heute?: string
  ohneAnalyse?: boolean
}) {
  const heute = o.heute ?? HEUTE
  const alt = wk({ id: ALT_ID, day: '2026-05-10', name: 'Bezirksmeisterschaft' })
  const wettkaempfe = [alt, ...(o.wettkaempfe ?? [])]

  const dJeGeraet = durchgaengeJeGeraet({
    runs: b.runs, versionen: b.versionen, einheiten: b.einheiten,
    kueren: b.kueren, kuerVerknuepfungen: b.verknuepfungen, elemente: b.elemente,
    heute, tagDifferenz: diffDays,
  })
  const analyse = o.ohneAnalyse || !b.ergebnisse.length
    ? null : wettkampfAnalyse(alt, b.ergebnisse, b.benchmarks)
  const fokus = trainingsfokus({
    analyse, verlauf: new Map(),
    elemente: b.elemente, versuche: b.attempts, einheiten: b.einheiten,
    kueren: b.kueren, kuerVerknuepfungen: b.verknuepfungen,
    durchgaenge: dJeGeraet, heute, tagDifferenz: diffDays,
  })
  const bloecke = bloeckeMitTag(b.attempts, b.einheiten)
  const rohplan = trainingsplanung({
    fokus,
    geraetBilder: geraetBilder(b.elemente, bloecke, heute, diffDays, BRAUCHT_ARBEIT),
  })
  const ziel = wettkampfvorbereitung({
    wettkaempfe, ergebnisse: b.ergebnisse, fokus, analyse, heute, tagDifferenz: diffDays,
  })
  const bild = vorbereitungsstrategie(ziel)
  const { plan, anpassungen } = planMitVorbereitung(rohplan, bild)
  return { rohplan, plan, ziel, bild, anpassungen, fokus }
}

const von = (plan: PlanungsBild, apparatus: string): GeraetPlan => {
  const g = plan.geraete.find((x) => x.apparatus === apparatus)
  expect(g, `Plan für ${apparatus}`).toBeTruthy()
  return g!
}

const arten = (g: GeraetPlan) => g.inhalte.map((i) => i.art)

/* ================================================= 1. Die Zeitphasen */

describe('phaseAus – die Grenzen, Tag für Tag', () => {
  it('kennt ohne Wettkampf keine Phase', () => {
    expect(phaseAus(null)).toBe('keine')
  })

  it('nennt den heutigen Wettkampf Wettkampftag', () => {
    expect(phaseAus(0)).toBe('wettkampftag')
  })

  it('nennt morgen wettkampfnah', () => {
    expect(phaseAus(1)).toBe('wettkampfnah')
  })

  it('zieht die Grenze zwischen wettkampfnah und Stabilisierung sauber', () => {
    const g = VORBEREITUNG_SCHWELLEN.wettkampfnahTage
    expect(phaseAus(g - 1)).toBe('wettkampfnah')
    expect(phaseAus(g)).toBe('wettkampfnah')
    expect(phaseAus(g + 1)).toBe('stabilisierung')
  })

  it('zieht die Grenze zwischen Stabilisierung und Entwicklung sauber', () => {
    const g = VORBEREITUNG_SCHWELLEN.stabilisierungTage
    expect(phaseAus(g - 1)).toBe('stabilisierung')
    expect(phaseAus(g)).toBe('stabilisierung')
    expect(phaseAus(g + 1)).toBe('entwicklung')
  })

  it('bleibt auch weit draussen bei Entwicklung', () => {
    expect(phaseAus(100)).toBe('entwicklung')
    expect(phaseAus(400)).toBe('entwicklung')
  })

  it('lässt einen vergangenen Termin die Strategie nicht bestimmen', () => {
    // Eine negative Tageszahl entsteht nur, wenn jemand sie selbst uebergibt -
    // Phase 3C liefert fuer einen vergangenen Wettkampf gar keinen Termin.
    expect(phaseAus(-1)).toBe('keine')
    expect(phaseAus(-40)).toBe('keine')
  })

  it('greift nur in den drei Phasen ein, in denen sie etwas ändert', () => {
    const ein: VorbereitungsPhase[] = ['stabilisierung', 'wettkampfnah', 'wettkampftag']
    const aus: VorbereitungsPhase[] = ['keine', 'entwicklung']
    for (const p of ein) expect(phaseGreiftEin(p), p).toBe(true)
    for (const p of aus) expect(phaseGreiftEin(p), p).toBe(false)
  })
})

describe('Die Grenzwerte sind keine neuen Zahlen', () => {
  it('nimmt für wettkampfnah den rollenden Planungshorizont aus Phase 3B', () => {
    expect(VORBEREITUNG_SCHWELLEN.wettkampfnahTage).toBe(WOCHEN_SCHWELLEN.horizontTage)
  })

  it('nimmt für die Stabilisierung die vorhandene „lange nicht trainiert"-Spanne', () => {
    expect(VORBEREITUNG_SCHWELLEN.stabilisierungTage).toBe(KUER_SCHWELLEN.langeHerTage)
    expect(VORBEREITUNG_SCHWELLEN.stabilisierungTage).toBe(PLAN_SCHWELLEN.wartungTage)
  })

  it('hält die Phasen in der richtigen Reihenfolge', () => {
    expect(VORBEREITUNG_SCHWELLEN.wettkampfnahTage)
      .toBeLessThan(VORBEREITUNG_SCHWELLEN.stabilisierungTage)
  })
})

describe('Die Phase folgt dem Kalender', () => {
  const mit = (heute: string, tag: string) =>
    baue(leererBestand(), { heute, wettkaempfe: [wk({ day: tag })] }).bild

  it('rechnet über den Monatswechsel', () => {
    const b = mit('2026-05-28', '2026-06-08')
    expect(b.tageHin).toBe(11)
    expect(b.phase).toBe('wettkampfnah')
  })

  it('rechnet über den Jahreswechsel', () => {
    const b = mit('2026-12-20', '2027-01-10')
    expect(b.tageHin).toBe(21)
    expect(b.phase).toBe('stabilisierung')
  })

  it('rechnet über die Umstellung auf Sommerzeit', () => {
    // Der 29.03.2026 hat 23 Stunden. Eine Rechnung ohne Rundung ergaebe 13,96
    // Tage - und damit dieselbe Phase, aber eine falsche Zahl.
    const b = mit('2026-03-25', '2026-04-08')
    expect(b.tageHin).toBe(14)
    expect(b.phase).toBe('wettkampfnah')
  })

  it('rechnet über die Umstellung auf Winterzeit', () => {
    // Der 25.10.2026 hat 25 Stunden - ohne Rundung waeren es 15,04 Tage und
    // damit faelschlich Stabilisierung statt wettkampfnah.
    const b = mit('2026-10-20', '2026-11-03')
    expect(b.tageHin).toBe(14)
    expect(b.phase).toBe('wettkampfnah')
  })

  it('nimmt bei mehreren Wettkämpfen den nächsten – keine Saisonplanung', () => {
    const b = baue(leererBestand(), {
      wettkaempfe: [wk({ day: '2026-06-05', name: 'Nah' }), wk({ day: '2026-09-01', name: 'Fern' })],
    }).bild
    expect(b.wettkampf?.name).toBe('Nah')
    expect(b.tageHin).toBe(4)
    expect(b.phase).toBe('wettkampfnah')
  })

  it('zieht nach einem verschobenen Termin automatisch nach', () => {
    const fern = baue(leererBestand(), { wettkaempfe: [wk({ id: 'w', day: '2026-08-01' })] }).bild
    const nah = baue(leererBestand(), { wettkaempfe: [wk({ id: 'w', day: '2026-06-05' })] }).bild
    expect(fern.phase).toBe('entwicklung')
    expect(nah.phase).toBe('wettkampfnah')
  })

  it('kehrt nach dem Löschen des Termins auf „keine" zurück', () => {
    expect(baue(leererBestand(), { wettkaempfe: [] }).bild.phase).toBe('keine')
  })

  it('lässt einen vergangenen Wettkampf die Strategie nicht beeinflussen', () => {
    const b = baue(leererBestand(), { wettkaempfe: [wk({ day: '2026-05-25' })] }).bild
    expect(b.phase).toBe('keine')
    expect(b.wettkampf).toBeNull()
    expect(b.leitsatz).toBeNull()
    // Und ausdruecklich kein erfundener Erholungsmodus.
    expect(PHASE_LABEL.keine).not.toMatch(/recovery|erholung|regeneration/i)
  })
})

/* ================================ 2. Ohne Wettkampf ändert sich nichts */

describe('Ohne kommenden Wettkampf bleibt Phase 3A genau wie vorher', () => {
  it('gibt dasselbe Planobjekt zurück – nicht eine gleich aussehende Kopie', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    const { rohplan, plan, anpassungen, bild } = baue(b, { wettkaempfe: [] })
    expect(bild.phase).toBe('keine')
    expect(plan).toBe(rohplan)
    expect(anpassungen.size).toBe(0)
  })

  it('nennt dann auch keine Phase in der Oberfläche', () => {
    const { bild } = baue(leererBestand(), { wettkaempfe: [] })
    expect(phaseKurztext(bild)).toBeNull()
    expect(bild.leitsatz).toBeNull()
    expect(bild.geraete).toEqual([])
  })

  /**
   * Die Umkehrung von „zurückgestellt, nicht verworfen".
   *
   * Zurückstellen ist nur dann keine Löschung, wenn der Inhalt auch wirklich
   * von selbst zurückkommt. Geprüft werden beide Wege, auf denen ein Termin
   * aufhört, die Strategie zu bestimmen: Erik löscht ihn, oder der Tag geht
   * vorbei. Verglichen wird gegen denselben Bestand ohne jeden Wettkampf.
   */
  describe('Der zurückgestellte Kandidat kommt von selbst zurück', () => {
    const mitBestand = (wettkaempfe: GymCompetition[], heute?: string) => {
      const b = leererBestand()
      geraetMitKandidat(b, 'reck')
      return baue(b, { wettkaempfe, heute })
    }
    /* Verglichen werden Arten und Texte, nicht die Schluessel: Jeder Bestand
       bekommt eigene Element-IDs, und die stecken im Schluessel. */
    const inhalte = (x: ReturnType<typeof baue>) =>
      von(x.plan, 'reck').inhalte.map((i) => `${i.art}:${i.text}`)

    const ohneWettkampf = mitBestand([])
    const nah = mitBestand([wk({ id: 'w', day: '2026-06-07' })])

    it('ist wettkampfnah wirklich aus dem Vorschlag heraus', () => {
      expect(arten(von(nah.plan, 'reck'))).not.toContain('entwicklung')
      expect(inhalte(nah).length).toBeLessThan(inhalte(ohneWettkampf).length)
    })

    it('steht nach dem Löschen des Termins wieder da', () => {
      const geloescht = mitBestand([])
      expect(arten(von(geloescht.plan, 'reck'))).toContain('entwicklung')
      expect(inhalte(geloescht)).toEqual(inhalte(ohneWettkampf))
      expect(geloescht.anpassungen.size).toBe(0)
    })

    it('steht auch wieder da, sobald der Wettkampftag vorbei ist', () => {
      // Derselbe Wettkampf, nur ist „heute" inzwischen zwei Tage später.
      const vorbei = mitBestand([wk({ id: 'w', day: '2026-06-07' })], '2026-06-09')
      expect(vorbei.bild.phase).toBe('keine')
      expect(vorbei.plan).toBe(vorbei.rohplan)
      expect(arten(von(vorbei.plan, 'reck'))).toContain('entwicklung')
      expect(inhalte(vorbei)).toEqual(inhalte(ohneWettkampf))
    })

    it('erfindet danach keinen Erholungsmodus', () => {
      const vorbei = mitBestand([wk({ id: 'w', day: '2026-06-07' })], '2026-06-09')
      expect(vorbei.bild.leitsatz).toBeNull()
      expect(phaseKurztext(vorbei.bild)).toBeNull()
      expect(vorbei.bild.geraete).toEqual([])
    })
  })

  it('greift auch in der Entwicklungsphase nicht ein', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    const { rohplan, plan, anpassungen, bild } = baue(b, {
      wettkaempfe: [wk({ day: '2026-08-01' })],
    })
    expect(bild.phase).toBe('entwicklung')
    expect(plan).toBe(rohplan)
    expect(anpassungen.size).toBe(0)
    // Die Phase steht trotzdem da - sie ist eine Auskunft, kein Eingriff.
    expect(phaseKurztext(bild)).toMatch(/Entwicklung/)
  })
})

/* ========================== 3. Gleicher Datenstand, anderer Abstand */

/**
 * Der Kerntest aus Abschnitt 22.10.
 *
 * Ein Bestand, drei Abstände. Verändert wird **ausschliesslich** das
 * Wettkampfdatum – nicht ein Versuch, nicht ein Durchgang, nicht eine Kür.
 */
describe('Gleicher Datenstand, anderer Abstand', () => {
  function dreiAbstaende() {
    const bau = () => {
      const b = leererBestand()
      const teile = geraetMitKandidat(b, 'reck')
      return { b, teile }
    }
    const fern = bau()
    const mittel = bau()
    const nah = bau()
    return {
      fern: baue(fern.b, { wettkaempfe: [wk({ day: '2026-07-20' })] }),
      mittel: baue(mittel.b, { wettkaempfe: [wk({ day: '2026-06-21' })] }),
      nah: baue(nah.b, { wettkaempfe: [wk({ day: '2026-06-07' })] }),
      kandidat: nah.teile.kandidat,
    }
  }

  it('liegt in drei verschiedenen Phasen', () => {
    const d = dreiAbstaende()
    expect(d.fern.bild.phase).toBe('entwicklung')
    expect(d.mittel.bild.phase).toBe('stabilisierung')
    expect(d.nah.bild.phase).toBe('wettkampfnah')
  })

  it('baut überhaupt denselben Rohplan – sonst prüfte der Test nichts', () => {
    const d = dreiAbstaende()
    const roh = (x: ReturnType<typeof baue>) =>
      von(x.rohplan, 'reck').inhalte.map((i) => `${i.art}:${i.text}`)
    expect(roh(d.mittel)).toEqual(roh(d.fern))
    expect(roh(d.nah)).toEqual(roh(d.fern))
  })

  it('weit entfernt: Entwicklungsarbeit steht vorn, wie Phase 2D es wollte', () => {
    const d = dreiAbstaende()
    const g = von(d.fern.plan, 'reck')
    expect(arten(g)[0]).toBe('entwicklung')
    expect(g.reihenfolgeArt).toBe('entwicklung_zuerst')
    expect(d.fern.anpassungen.size).toBe(0)
  })

  it('mittlere Phase: der Kandidat bleibt, rutscht aber nach hinten', () => {
    const d = dreiAbstaende()
    const g = von(d.mittel.plan, 'reck')
    expect(arten(g)).toContain('entwicklung')
    expect(arten(g)[arten(g).length - 1]).toBe('entwicklung')
    expect(arten(g)[0]).not.toBe('entwicklung')
    // Die Reihenfolgeangabe darf danach nicht mehr "Schwierigkeit zuerst" sagen.
    expect(g.reihenfolgeArt).toBe('elemente_zuerst')
    const a = d.mittel.anpassungen.get('reck')!
    expect(a.umsortiert).toBe(true)
    expect(a.zurueckgestellt).toEqual([])
  })

  it('wettkampfnah: der Kandidat ist zurückgestellt, nicht verworfen', () => {
    const d = dreiAbstaende()
    const g = von(d.nah.plan, 'reck')
    expect(arten(g)).not.toContain('entwicklung')
    const a = d.nah.anpassungen.get('reck')!
    expect(a.zurueckgestellt.length).toBe(1)
    expect(a.zurueckgestellt[0].art).toBe('entwicklung')
    expect(a.zurueckgestellt[0].elementId).toBe(d.kandidat.id)
    // Verworfen waere er, wenn er nirgends mehr stuende.
    expect(a.zurueckgestellt[0].text).toMatch(/als Kandidaten prüfen/)
    expect(zurueckgestelltHinweis(d.nah.anpassungen, 'reck'))
      .toMatch(/zurückgestellt/)
  })

  it('lässt die Kür am Stück in allen drei Phasen stehen', () => {
    const d = dreiAbstaende()
    for (const x of [d.fern, d.mittel, d.nah]) {
      expect(arten(von(x.plan, 'reck'))).toContain('durchgang')
    }
  })

  it('ändert an Gerätewahl, Rolle und Priorität nichts', () => {
    // Phase 3D verschiebt INHALTE. Welches Gerät mit welcher Rolle im
    // Vorschlag steht, bleibt die Entscheidung von 3A.
    const d = dreiAbstaende()
    const kopf = (x: ReturnType<typeof baue>) => x.plan.geraete.map(
      (g) => `${g.apparatus}/${g.rolle}/${g.prioritaet}/${g.auswahlGrund}`)
    expect(kopf(d.mittel)).toEqual(kopf(d.fern))
    expect(kopf(d.nah)).toEqual(kopf(d.fern))
    expect(d.nah.plan.vorgeschlagen).toEqual(d.fern.plan.vorgeschlagen)
  })

  it('ändert nichts an den Hinweisen und Begründungen von 3A', () => {
    const d = dreiAbstaende()
    const g = (x: ReturnType<typeof baue>) => von(x.plan, 'reck')
    expect(g(d.nah).warum).toEqual(g(d.fern).warum)
    expect(g(d.nah).hinweise).toEqual(g(d.fern).hinweise)
  })

  it('erklärt jeden Eingriff – ohne Wettkampf und durch die Vorbereitung', () => {
    const d = dreiAbstaende()
    for (const x of [d.mittel, d.nah]) {
      const a = x.anpassungen.get('reck')!
      expect(a.ohneWettkampf.length).toBeGreaterThan(0)
      expect(a.ohneWettkampf.join(' ')).toMatch(/Ohne Wettkampfkontext/)
      expect(a.durchVorbereitung.length).toBeGreaterThan(0)
      expect(a.durchVorbereitung.join(' ')).toMatch(/Wettkampf/)
      expect(a.durchVorbereitung.join(' ')).toContain(LEITLINIE_LABEL[a.leitlinie])
    }
  })
})

/* ================================================ 4. Die Strategieregeln */

describe('Strategie je Gerät', () => {
  it('Entwicklung: stabile Kür und stabiler Kandidat – Kandidatenarbeit bleibt möglich', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    const { plan, bild } = baue(b, { wettkaempfe: [wk({ day: '2026-07-20' })] })
    expect(bild.phase).toBe('entwicklung')
    expect(arten(von(plan, 'reck'))).toContain('entwicklung')
    expect(bild.geraete.find((g) => g.apparatus === 'reck')?.leitlinie).toBe('kuer_halten')
  })

  it('Stabilisierung: ein instabiles Kürelement kommt vor der Entwicklung', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck', { elementeStabil: false })
    const { plan, bild } = baue(b, { wettkaempfe: [wk({ day: '2026-06-21' })] })
    expect(bild.phase).toBe('stabilisierung')
    const g = von(plan, 'reck')
    // 2D nennt die Lage instabil und macht daraus "stabilisieren" - dann gibt
    // es gar keinen Entwicklungsinhalt mehr, und 3D muss nichts verschieben.
    expect(arten(g)).not.toContain('entwicklung')
    expect(arten(g)[0]).toBe('element')
    expect(bild.geraete.find((x) => x.apparatus === 'reck')?.leitlinie)
      .toBe('kuerelemente_zuerst')
  })

  it('Stabilisierung: Elemente stabil, Kür instabil – die Durchgänge führen', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck', { kuerDurchgaenge: 5, kuerSauber: 1 })
    const { plan, bild } = baue(b, { wettkaempfe: [wk({ day: '2026-06-21' })] })
    expect(bild.phase).toBe('stabilisierung')
    const g = von(plan, 'reck')
    expect(arten(g)[0]).toBe('durchgang')
    expect(g.reihenfolgeArt).toBe('kuer_zuerst')
    expect(bild.geraete.find((x) => x.apparatus === 'reck')?.leitlinie)
      .toBe('kuer_am_stueck_zuerst')
  })

  it('wettkampfnah: instabile Kür und stabiler Kandidat – der Kandidat führt nicht', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck', { kuerDurchgaenge: 5, kuerSauber: 1 })
    const { plan, bild } = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    expect(bild.phase).toBe('wettkampfnah')
    const g = von(plan, 'reck')
    expect(arten(g)[0]).toBe('durchgang')
    expect(arten(g)).not.toContain('entwicklung')
  })

  it('wettkampfnah: alles stabil – nichts wird künstlich problematisiert', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    const { plan, bild } = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    const g = von(plan, 'reck')
    expect(bild.geraete.find((x) => x.apparatus === 'reck')?.leitlinie).toBe('kuer_halten')
    // Keine neue Elementaufgabe, kein erfundener Problemfokus.
    expect(arten(g)).not.toContain('element')
    expect(arten(g)).toEqual(['durchgang'])
    expect(g.prioritaet).toBe(von(baue(b, { wettkaempfe: [] }).plan, 'reck').prioritaet)
  })

  it('neue Kürfassung: die alten Durchgänge gelten nicht als Stabilität', () => {
    const b = leererBestand()
    const teile = geraetMitKandidat(b, 'reck', { kuerDurchgaenge: 0 })
    // Acht saubere Durchgaenge - aber auf einer ANDEREN Fassung.
    b.versionen.push(fassung({ id: 'alt-fassung', routineId: teile.kuer.id, apparatus: 'reck' }))
    const d = durchgaenge({ versionId: 'alt-fassung', tag: '2026-05-27', anzahl: 8, sauber: 8 })
    b.einheiten.push(d.einheit)
    b.runs.push(...d.runs)

    const { bild } = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    expect(bild.geraete.find((x) => x.apparatus === 'reck')?.leitlinie).toBe('kuer_erfassen')
    expect(LEITLINIE_LABEL.kuer_erfassen).toMatch(/erfassen/)
    // Und ausdruecklich keine Warnung, die dramatisiert.
    expect(LEITLINIE_LABEL.kuer_erfassen).not.toMatch(/gefahr|warnung|kritisch|zu spät/i)
  })

  it('keine Trainingsdaten: keine erfundene Empfehlung', () => {
    const b = leererBestand()
    const k = kuer({ apparatus: 'reck' })
    const e = element({ apparatus: 'reck', name: 'Riesenfelge', difficulty_value: 0.2 })
    b.elemente.push(e)
    b.kueren.push(k)
    b.verknuepfungen.push(kuerPlatz(k.id, e.id, 0))
    const { plan, bild, anpassungen } = baue(b, {
      wettkaempfe: [wk({ day: '2026-06-07' })], ohneAnalyse: true,
    })
    expect(bild.phase).toBe('wettkampfnah')
    const g = von(plan, 'reck')
    expect(arten(g)).not.toContain('entwicklung')
    expect(anpassungen.size).toBe(0)
  })

  it('keine Wettkampfkür: die Leitlinie sagt genau das', () => {
    const b = leererBestand()
    b.elemente.push(element({ apparatus: 'reck', name: 'Riesenfelge' }))
    const { bild } = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    // Ohne Kuer zaehlt Phase 3C das Geraet gar nicht zum Wettkampf (21.6).
    expect(bild.geraete).toEqual([])
  })

  it('lässt ein Gerät unberührt, das Phase 3C nicht zum Wettkampf zählt', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    // Barren hat keine Wettkampfkuer - es gehoert zur normalen Trainingsarbeit.
    const bodenEl = element({ apparatus: 'barren', name: 'Felge', difficulty_value: 0.2 })
    b.elemente.push(bodenEl)
    const v = versuche({ elementId: bodenEl.id, tag: '2026-05-20', clean: 4, shaky: 6 })
    b.einheiten.push(v.einheit)
    b.attempts.push(...v.attempts)

    const nah = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    const ohne = baue(b, { wettkaempfe: [] })
    expect(nah.bild.geraete.map((g) => g.apparatus)).toEqual(['reck'])
    expect(von(nah.plan, 'barren').inhalte.map((i) => i.key))
      .toEqual(von(ohne.plan, 'barren').inhalte.map((i) => i.key))
  })
})

describe('leitlinieAus – eine Umbenennung des 3C-Standes', () => {
  const g = (o: any) => leitlinieAus(o)

  it('bildet jeden Stand auf genau eine Leitlinie ab', () => {
    expect(g({ stand: 'kuer_fehlt', neueFassung: false })).toBe('keine_kuer')
    expect(g({ stand: 'elemente_auffaellig', neueFassung: false })).toBe('kuerelemente_zuerst')
    expect(g({ stand: 'kuer_am_stueck_auffaellig', neueFassung: false }))
      .toBe('kuer_am_stueck_zuerst')
    expect(g({ stand: 'daten_fehlen', neueFassung: false })).toBe('daten_fehlen')
    expect(g({ stand: 'daten_fehlen', neueFassung: true })).toBe('kuer_erfassen')
    expect(g({ stand: 'stabile_basis', neueFassung: false })).toBe('kuer_halten')
  })

  it('macht aus einem stabilen Gerät nie eine Problemaufgabe', () => {
    expect(LEITLINIE_LABEL.kuer_halten).not.toMatch(/problem|kritisch|instabil|fehler/i)
  })
})

/* ================================================== 5. Der Wettkampftag */

describe('Wettkampftag', () => {
  it('ist eine eigene Phase mit einem eigenen Satz', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    const { bild } = baue(b, { wettkaempfe: [wk({ day: HEUTE, name: 'Sachsenmeisterschaft' })] })
    expect(bild.phase).toBe('wettkampftag')
    expect(bild.tageHin).toBe(0)
    expect(bild.leitsatz).toMatch(/Heute ist Wettkampf/)
    expect(phaseKurztext(bild)).toBe(PHASE_LABEL.wettkampftag)
  })

  it('erfindet kein Aufwärmprogramm und keine Mengen', () => {
    const satz = PHASE_LEITSATZ.wettkampftag ?? ''
    expect(satz).not.toMatch(/aufwärm|satz|sätze|wiederholung|minute|ernährung|puls/i)
  })

  it('behandelt den Plan wie wettkampfnah – der Kandidat ist zurückgestellt', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    const { plan, anpassungen } = baue(b, { wettkaempfe: [wk({ day: HEUTE })] })
    expect(arten(von(plan, 'reck'))).not.toContain('entwicklung')
    expect(anpassungen.get('reck')?.zurueckgestellt.length).toBe(1)
  })
})

/* ============================================= 6. Anschluss an 3A und 3B */

describe('Anschluss an Phase 3A und 3B', () => {
  it('lässt die Nutzerwahl weiterhin auf dem angepassten Plan arbeiten', () => {
    const b = leererBestand()
    geraetMitKandidat(b, 'reck')
    geraetMitKandidat(b, 'barren')
    const { plan } = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    const gewaehlt = planMitAuswahl(plan, { ohne: ['reck'] })
    expect(gewaehlt.some((g) => g.apparatus === 'reck')).toBe(false)
    // Und der zurueckgestellte Inhalt ist auch hier nicht wieder da.
    for (const g of gewaehlt) expect(arten(g)).not.toContain('entwicklung')
  })

  it('gibt Phase 3B keine zweite Wettkampflogik, sondern fertige Inhalte', () => {
    const quelle = readFileSync(
      new URL('../src/core/turnen/wochenplanung.ts', import.meta.url), 'utf8')
    const rumpf = quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(rumpf).not.toMatch(/vorbereitungsstrategie|wettkampfvorbereitung/)
    expect(rumpf).not.toMatch(/VorbereitungsPhase|wettkampfnah|VORBEREITUNG_SCHWELLEN/)
  })

  it('kann einen zurückgestellten Inhalt gar nicht als „noch offen" zeigen', () => {
    // Phase 3B fuehrt "Noch offen" je GERAET und nicht je Inhalt - ein
    // zurueckgestellter Kandidat ist dort strukturell nicht darstellbar.
    const quelle = readFileSync(
      new URL('../src/core/turnen/wochenplanung.ts', import.meta.url), 'utf8')
    expect(quelle).toMatch(/offen\.push\(\{[\s\S]{0,120}apparatus/)
  })
})

/* ====================================== 7. Was NICHT entstehen darf */

describe('Grenzen des Moduls – am Quelltext geprüft', () => {
  const quelle = readFileSync(
    new URL('../src/core/turnen/vorbereitungsstrategie.ts', import.meta.url), 'utf8')
  const rumpf = () => quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace('export const KEINE_PERIODISIERUNG = true', '')

  it('baut keine Periodisierung', () => {
    expect(rumpf()).not.toMatch(
      /peaking|taper|deload|superkompensation|belastungskurve|volumen|intensit/i)
  })

  it('erfindet keine Mengen und keine Zeiten', () => {
    expect(rumpf()).not.toMatch(/minute|wiederholung|\bsatz\b|saetze|sätze/i)
  })

  it('baut keinen Score und keine Prozentzahl', () => {
    expect(rumpf()).not.toMatch(/readiness|score|prozent|\*\s*100|\/\s*100\b/i)
  })

  it('liest keine Schlaf-, Puls- oder HRV-Daten', () => {
    expect(rumpf()).not.toMatch(/sleep|schlaf|hrv|puls|herzfrequenz|ernährung|fatsecret/i)
  })

  it('rechnet Stabilität, Fokus und Priorität nicht ein zweites Mal', () => {
    expect(rumpf()).not.toMatch(/statusVorschlag|trefferbild|elementBild|durchgangsBild/)
    expect(rumpf()).not.toMatch(/stabilitaetAus|lageAus|empfehlungAus|prioritaetAus/)
    expect(rumpf()).not.toMatch(/kuerElemente\(|fassungsInhalt\(|rangIn\(/)
  })

  it('rechnet keine eigene Tageslogik', () => {
    expect(rumpf()).not.toMatch(/new Date\(|86400000|toISOString|getTime\(/)
    expect(rumpf()).not.toMatch(/diffDays|tagDifferenz/)
  })

  it('entscheidet nichts über die Kür und sperrt sie nicht', () => {
    expect(rumpf()).not.toMatch(/einbauen|sperr|verbot|darfst nicht/i)
    expect(quelle).not.toMatch(/competition_since|gym_routines|gym_routine_elements/)
  })

  it('legt keine Tabelle und keine Einstellung an', () => {
    // Der Rumpf, nicht die Kommentare: Dort stehen die Namen absichtlich, als
    // Begruendung, warum es die Tabellen nicht gibt.
    expect(rumpf()).not.toMatch(/training_phase|competition_strategy|readiness_/)
    expect(rumpf()).not.toMatch(/insert\(|patch\(|create\(|settings/)
  })

  /**
   * Die Module, aus denen eine Datei WIRKLICH importiert.
   *
   * Nicht der ganze Quelltext: Die Modulkoepfe nennen benachbarte Phasen in
   * Prosa, und eine Erwaehnung ist keine Abhaengigkeit.
   */
  const importe = (datei: string): string[] => {
    const text = readFileSync(new URL(`../src/core/turnen/${datei}`, import.meta.url), 'utf8')
    return [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
  }

  it('hält die Abhängigkeitsrichtung ein – keine Zirkularität', () => {
    // 3D sitzt HINTER 3A und 3C. Importierte eines von beiden dieses Modul,
    // waere der Kreis geschlossen.
    expect(importe('trainingsplanung.ts')).not.toContain('./vorbereitungsstrategie')
    expect(importe('trainingsplanung.ts')).not.toContain('./wettkampfvorbereitung')
    expect(importe('trainingsfokus.ts')).not.toContain('./vorbereitungsstrategie')
    expect(importe('wettkampfvorbereitung.ts')).not.toContain('./vorbereitungsstrategie')
    expect(importe('wettkampfvorbereitung.ts')).not.toContain('./trainingsplanung')
    expect(importe('wochenplanung.ts')).not.toContain('./vorbereitungsstrategie')
    expect(importe('wochenplanung.ts')).not.toContain('./wettkampfvorbereitung')
    // Und umgekehrt: 3D darf nach unten greifen, dort liegen die Fakten.
    expect(importe('vorbereitungsstrategie.ts')).toContain('./trainingsplanung')
    expect(importe('vorbereitungsstrategie.ts')).toContain('./wettkampfvorbereitung')
  })
})

/* ================================================= 8. Aufwand (22.16) */

describe('Aufwand', () => {
  it('ist neben dem vorhandenen Bild nicht messbar', () => {
    const b = leererBestand()
    for (const g of ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']) {
      geraetMitKandidat(b, g)
    }
    const vorbereitet = baue(b, { wettkaempfe: [wk({ day: '2026-06-07' })] })
    expect(vorbereitet.bild.phase).toBe('wettkampfnah')
    expect(vorbereitet.bild.geraete.length).toBe(6)

    const start = performance.now()
    for (let i = 0; i < 200; i++) {
      const bild = vorbereitungsstrategie(vorbereitet.ziel)
      planMitVorbereitung(vorbereitet.rohplan, bild)
    }
    const ms = (performance.now() - start) / 200
    // Grosszuegig bemessen, damit die Pruefung auf einem belegten Rechner
    // nicht grundlos rot wird. Gemessen liegt es weit darunter.
    expect(ms).toBeLessThan(5)
    // eslint-disable-next-line no-console
    console.log(`  Phase 3D über sechs Geräte: ${ms.toFixed(3)} ms je Aufruf`)
  })

  it('liest dabei weder Versuche noch Durchgänge noch Wettkampfhistorie', () => {
    const quelle = readFileSync(
      new URL('../src/core/turnen/vorbereitungsstrategie.ts', import.meta.url), 'utf8')
    expect(quelle).not.toMatch(/GymAttempt|GymRoutineRun|GymResult|GymBenchmark/)
    // Nur der Wettkampf selbst, und der kommt als fertiges Objekt aus 3C.
    expect(quelle).toMatch(/import type \{ GymCompetition \}/)
  })
})

/* ================================ 9. Ziel-Zustand aus dem Ziel-Bild */

describe('vorbereitungsstrategie – aus dem fertigen 3C-Bild', () => {
  it('übernimmt Countdown und Termin unverändert', () => {
    const ziel: WettkampfZiel = {
      naechster: wk({ day: '2026-06-19', name: 'Sachsenmeisterschaft' }),
      tageHin: 18,
      countdown: 'in 18 Tagen',
      weitere: [], ohneErgebnis: [], geraete: [], herkunft: 'keine',
    }
    const bild = vorbereitungsstrategie(ziel)
    expect(bild.phase).toBe('stabilisierung')
    expect(bild.countdown).toBe('in 18 Tagen')
    expect(bild.tageHin).toBe(18)
    expect(bild.wettkampf?.name).toBe('Sachsenmeisterschaft')
    expect(phaseKurztext(bild)).toBe('Stabilisierung · Wettkampf in 18 Tagen')
  })

  it('sagt zu jeder Phase, was LifeHub tut – und nicht, was im Training richtig wäre', () => {
    for (const p of ['entwicklung', 'stabilisierung', 'wettkampfnah'] as VorbereitungsPhase[]) {
      const satz = PHASE_LEITSATZ[p] ?? ''
      expect(satz.length).toBeGreaterThan(0)
      expect(satz).not.toMatch(/du musst|du solltest|gefährlich|riskant|zu spät|reicht nicht/i)
    }
  })
})
