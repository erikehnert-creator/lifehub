/**
 * Wettkampfvorbereitung (Phase 3C) – der Termin und der Stand je Gerät.
 *
 * ---------------------------------------------------------------------------
 * Geprüft wird durch die echte Kette
 *
 * Der Gerätestand entsteht nicht aus einem nachgebauten `TrainingsfokusBild`,
 * sondern aus der wirklichen Reihe: Elemente und Versuche →
 * `durchgaengeJeGeraet()` (2E) → `trainingsfokus()` (2D) →
 * `wettkampfvorbereitung()` (3C). Sonst prüfte diese Datei ihre eigene Annahme
 * darüber, was 2D und 2E liefern – und genau dort liegt der Wert von 3C: dass
 * es die vorhandenen Ergebnisse zusammenführt und nichts zweites rechnet.
 *
 * Zugesichert werden **Kategorien und Zahlen**, nie deutsche Sätze. Eine
 * bessere Formulierung soll keine Prüfung rot machen. Die zwei Ausnahmen sind
 * ausdrücklich benannt und prüfen das Gegenteil: dass bestimmte Worte NICHT
 * dastehen (kein Score, keine Trainingswissenschaft).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { diffDays } from '../src/core/dates'
import { wettkampfAnalyse, type VergleichsWerte } from '../src/core/turnen/analyse'
import { fassungsId, fassungsInhalt } from '../src/core/turnen/fassungen'
import { durchgaengeJeGeraet } from '../src/core/turnen/kuerdurchgaenge'
import { trainingsfokus, type TrainingsfokusBild } from '../src/core/turnen/trainingsfokus'
import {
  kuenftigeWettkaempfe, naechsterUndLetzter, vergangeneWettkaempfe,
} from '../src/core/turnen/wettkampf'
import {
  HERKUNFT_TEXT, STAND_ERKLAERUNG, STAND_LABEL,
  countdownText, geraeteUmfang, standAus, vorTagen, wettkaempfeOhneErgebnis,
  wettkampfHinweis, wettkampfvorbereitung, zielKurztext,
  type GeraetVorbereitung, type WettkampfZiel,
} from '../src/core/turnen/wettkampfvorbereitung'
import type {
  GymAttempt, GymCompetition, GymElement, GymResult, GymRoutine, GymRoutineElement,
  GymRoutineRun, GymRoutineVersion,
} from '../src/core/types'

const HEUTE = '2026-06-01'

let lauf = 0
const id = (p: string) => `${p}-${++lauf}`

/* ============================================================ Bausteine */

function wk(o: {
  id?: string
  day: string
  name?: string
  ort?: string | null
  geloescht?: boolean
}): GymCompetition {
  return {
    id: o.id ?? id('wk'),
    day: o.day,
    name: o.name ?? `Wettkampf ${o.day}`,
    location: o.ort ?? null,
    class_name: null,
    rank_allround: null,
    score_allround: null,
    protocol_url: null,
    note: null,
    deleted_at: o.geloescht ? '2026-01-01T00:00:00Z' : null,
  } as unknown as GymCompetition
}

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
    sort_order: 0,
    deleted_at: o.deleted_at ?? null,
  } as unknown as GymElement
}

function kuer(o: { apparatus: string; name?: string; seit?: string | null }): GymRoutine {
  return {
    id: id('k'),
    apparatus: o.apparatus,
    name: o.name ?? `Kür ${o.apparatus}`,
    note: null,
    is_active: 1,
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
    note: null,
    created_at: `2026-01-01T00:00:0${position}.000Z`,
    deleted_at: null,
  } as unknown as GymRoutineElement
}

/** Eine Einheit mit Versuchen an einem Element. */
function versuche(o: {
  elementId: string
  tag: string
  clean?: number
  shaky?: number
  failed?: number
}): { einheit: any; attempts: GymAttempt[] } {
  const sid = id('s')
  return {
    einheit: { id: sid, day: o.tag, deleted_at: null },
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

/** Kürdurchgänge einer bestimmten Fassung, alle an einem Tag. */
function durchgaenge(o: {
  versionId: string
  tag: string
  anzahl: number
  sauber: number
}): { einheit: any; runs: GymRoutineRun[] } {
  const sid = id('s')
  const runs: GymRoutineRun[] = []
  for (let i = 0; i < o.anzahl; i++) {
    const gut = i < o.sauber
    runs.push({
      id: id('run'),
      session_id: sid,
      routine_version_id: o.versionId,
      completed: gut ? 1 : 0,
      falls: gut ? 0 : 1,
      interruptions: 0,
      with_help: 0,
      quality: null,
      note: null,
      sort_order: i,
      deleted_at: null,
    } as unknown as GymRoutineRun)
  }
  return { einheit: { id: sid, day: o.tag, deleted_at: null }, runs }
}

function fassung(o: { id: string; routineId: string; apparatus: string }): GymRoutineVersion {
  return {
    id: o.id,
    routine_id: o.routineId,
    apparatus: o.apparatus,
    name: 'Fassung',
    frozen_at: '2026-02-01T00:00:00Z',
    deleted_at: null,
  } as unknown as GymRoutineVersion
}

/* ====================================================== Die ganze Kette */

interface Bau {
  wettkaempfe?: GymCompetition[]
  /** Ergebniszeilen – auch zu einem künftigen Wettkampf erlaubt. */
  ergebnisse?: GymResult[]
  benchmarks?: VergleichsWerte[]
  /** Der ausgewertete Wettkampf für Phase 2C, oder `null`. */
  analyseWk?: GymCompetition | null
  elemente?: GymElement[]
  kueren?: GymRoutine[]
  verknuepfungen?: GymRoutineElement[]
  einheiten?: any[]
  attempts?: GymAttempt[]
  runs?: GymRoutineRun[]
  versionen?: GymRoutineVersion[]
  heute?: string
}

function baue(b: Bau): { ziel: WettkampfZiel; fokus: TrainingsfokusBild } {
  const heute = b.heute ?? HEUTE
  const elemente = b.elemente ?? []
  const kueren = b.kueren ?? []
  const verknuepfungen = b.verknuepfungen ?? []
  const einheiten = b.einheiten ?? []
  const ergebnisse = b.ergebnisse ?? []

  const dJeGeraet = durchgaengeJeGeraet({
    runs: b.runs ?? [],
    versionen: b.versionen ?? [],
    einheiten,
    kueren,
    kuerVerknuepfungen: verknuepfungen,
    elemente,
    heute,
    tagDifferenz: diffDays,
  })

  const analyse = b.analyseWk
    ? wettkampfAnalyse(b.analyseWk, ergebnisse, b.benchmarks ?? [])
    : null

  const fokus = trainingsfokus({
    analyse,
    verlauf: new Map(),
    elemente,
    versuche: b.attempts ?? [],
    einheiten,
    kueren,
    kuerVerknuepfungen: verknuepfungen,
    durchgaenge: dJeGeraet,
    heute,
    tagDifferenz: diffDays,
  })

  return {
    fokus,
    ziel: wettkampfvorbereitung({
      wettkaempfe: b.wettkaempfe ?? [],
      ergebnisse,
      fokus,
      analyse,
      heute,
      tagDifferenz: diffDays,
    }),
  }
}

/** Ein Gerät mit aktiver Wettkampfkür aus zwei Elementen. */
function geraetMitKuer(apparatus: string) {
  const e1 = element({ apparatus, name: `${apparatus} A`, difficulty_value: 0.3, difficulty_letter: 'C' })
  const e2 = element({ apparatus, name: `${apparatus} B`, difficulty_value: 0.2, difficulty_letter: 'B' })
  const k = kuer({ apparatus })
  return {
    elemente: [e1, e2],
    kuer: k,
    verknuepfungen: [kuerPlatz(k.id, e1.id, 0), kuerPlatz(k.id, e2.id, 1)],
    aktuelleFassung: (elemente: GymElement[], verkn: GymRoutineElement[]) =>
      fassungsId(fassungsInhalt(k, verkn, elemente)),
  }
}

const von = (ziel: WettkampfZiel, apparatus: string): GeraetVorbereitung => {
  const g = ziel.geraete.find((x) => x.apparatus === apparatus)
  expect(g, `Gerätestand für ${apparatus}`).toBeTruthy()
  return g!
}

/* ================================================= 1. Der Wettkampftermin */

describe('Nächster Wettkampf – die Auswahl', () => {
  it('sagt ohne künftigen Wettkampf klar, dass keiner eingetragen ist', () => {
    const { ziel } = baue({ wettkaempfe: [wk({ day: '2026-03-01' })] })
    expect(ziel.naechster).toBeNull()
    expect(ziel.tageHin).toBeNull()
    expect(ziel.countdown).toBeNull()
    expect(ziel.weitere).toEqual([])
    expect(zielKurztext(ziel)).toBeNull()
  })

  it('kommt auch ohne jeden Wettkampf aus', () => {
    const { ziel } = baue({})
    expect(ziel.naechster).toBeNull()
    expect(ziel.geraete).toEqual([])
    expect(ziel.herkunft).toBe('keine')
  })

  it('nimmt den einen künftigen Wettkampf', () => {
    const w = wk({ day: '2026-06-25', name: 'Sachsenmeisterschaft' })
    const { ziel } = baue({ wettkaempfe: [w] })
    expect(ziel.naechster?.id).toBe(w.id)
    expect(ziel.tageHin).toBe(24)
    expect(ziel.countdown).toBe('in 24 Tagen')
    expect(ziel.weitere).toEqual([])
  })

  it('wählt bei mehreren künftigen den nächsten und listet die übrigen chronologisch', () => {
    const a = wk({ day: '2026-10-24', name: 'Sachsenmeisterschaft' })
    const b = wk({ day: '2026-06-25', name: 'Nahes' })
    const c = wk({ day: '2026-11-14', name: 'Pokalturnen' })
    const { ziel } = baue({ wettkaempfe: [a, b, c] })
    expect(ziel.naechster?.id).toBe(b.id)
    expect(ziel.weitere.map((x) => x.day)).toEqual(['2026-10-24', '2026-11-14'])
  })

  it('bringt zwei Wettkämpfe am selben Tag in eine feste Reihenfolge', () => {
    // Ohne festen zweiten Schluessel entschiede die Ladereihenfolge - und der
    // "naechste Wettkampf" wechselte nach einem Abgleich.
    const a = wk({ day: '2026-06-20', name: 'Zweiter' })
    const b = wk({ day: '2026-06-20', name: 'Erster' })
    expect(baue({ wettkaempfe: [a, b] }).ziel.naechster?.name).toBe('Erster')
    expect(baue({ wettkaempfe: [b, a] }).ziel.naechster?.name).toBe('Erster')
  })

  it('zählt den heutigen Wettkampf als den nächsten, nicht als vergangen', () => {
    const w = wk({ day: HEUTE })
    const { ziel } = baue({ wettkaempfe: [w] })
    expect(ziel.naechster?.id).toBe(w.id)
    expect(ziel.tageHin).toBe(0)
    expect(ziel.countdown).toBe('heute')
  })

  it('nennt morgen morgen und übermorgen übermorgen', () => {
    expect(baue({ wettkaempfe: [wk({ day: '2026-06-02' })] }).ziel.countdown).toBe('morgen')
    expect(baue({ wettkaempfe: [wk({ day: '2026-06-03' })] }).ziel.countdown).toBe('übermorgen')
  })

  it('zeigt einen vergangenen Wettkampf nicht mehr als kommenden', () => {
    const { ziel } = baue({ wettkaempfe: [wk({ day: '2026-05-31' })] })
    expect(ziel.naechster).toBeNull()
  })

  it('übergeht gelöschte Wettkämpfe', () => {
    const weg = wk({ day: '2026-06-10', geloescht: true })
    const echt = wk({ day: '2026-06-20' })
    const { ziel } = baue({ wettkaempfe: [weg, echt] })
    expect(ziel.naechster?.id).toBe(echt.id)
  })

  it('rechnet über den Monatswechsel', () => {
    const { ziel } = baue({ heute: '2026-05-28', wettkaempfe: [wk({ day: '2026-06-02' })] })
    expect(ziel.tageHin).toBe(5)
  })

  it('rechnet über den Jahreswechsel', () => {
    const { ziel } = baue({ heute: '2026-12-28', wettkaempfe: [wk({ day: '2027-01-03' })] })
    expect(ziel.tageHin).toBe(6)
  })

  it('rechnet über die Umstellung auf Sommerzeit', () => {
    // 29.03.2026 ist in Deutschland der Tag mit 23 Stunden. Eine Rechnung in
    // Millisekunden ohne Rundung ergaebe hier 6,96 Tage - also 6.
    const { ziel } = baue({ heute: '2026-03-25', wettkaempfe: [wk({ day: '2026-04-01' })] })
    expect(ziel.tageHin).toBe(7)
    expect(ziel.countdown).toBe('in 7 Tagen')
  })

  it('rechnet über die Umstellung auf Winterzeit', () => {
    // 25.10.2026 hat 25 Stunden.
    const { ziel } = baue({ heute: '2026-10-22', wettkaempfe: [wk({ day: '2026-10-29' })] })
    expect(ziel.tageHin).toBe(7)
  })

  it('bleibt mit `naechsterUndLetzter` einig – eine Regel, nicht zwei', () => {
    const liste = [
      wk({ day: '2026-03-01' }), wk({ day: '2026-06-25' }), wk({ day: '2026-12-12' }),
    ]
    const { ziel } = baue({ wettkaempfe: liste })
    expect(ziel.naechster?.id).toBe(naechsterUndLetzter(liste, HEUTE).naechster?.id)
    expect(kuenftigeWettkaempfe(liste, HEUTE)[0].id).toBe(ziel.naechster?.id)
    expect(vergangeneWettkaempfe(liste, HEUTE).map((x) => x.day)).toEqual(['2026-03-01'])
  })
})

describe('countdownText – nur Kalender, keine Wertung', () => {
  it('übernimmt bis zu einer Woche die vorhandene Formulierung', () => {
    expect(countdownText('2026-06-01', HEUTE, 0)).toBe('heute')
    expect(countdownText('2026-06-02', HEUTE, 1)).toBe('morgen')
    expect(countdownText('2026-06-03', HEUTE, 2)).toBe('übermorgen')
    expect(countdownText('2026-06-06', HEUTE, 5)).toBe('in 5 Tagen')
    expect(countdownText('2026-06-08', HEUTE, 7)).toBe('in 7 Tagen')
  })

  it('zeigt darüber hinaus die Tage statt des Datums', () => {
    expect(countdownText('2026-06-09', HEUTE, 8)).toBe('in 8 Tagen')
    expect(countdownText('2026-06-25', HEUTE, 24)).toBe('in 24 Tagen')
  })

  it('kann auch zurückschauen', () => {
    expect(countdownText('2026-05-31', HEUTE, -1)).toBe('gestern')
    expect(countdownText('2026-05-01', HEUTE, -31)).toBe('vor 31 Tagen')
  })

  it('sagt nichts darüber, ob die Zeit reicht', () => {
    for (const n of [0, 1, 3, 7, 13, 14, 24, 90]) {
      const text = countdownText('2026-06-25', HEUTE, n)
      expect(text).not.toMatch(/reich|spät|knapp|genug|rechtzeitig|noch Zeit/i)
    }
  })

  it('formuliert vergangene Tage einheitlich', () => {
    expect(vorTagen(0)).toBe('heute')
    expect(vorTagen(1)).toBe('gestern')
    expect(vorTagen(5)).toBe('vor 5 Tagen')
  })
})

describe('Vergangener Termin ohne Ergebnis', () => {
  it('wird benannt, ohne eine Teilnahme anzunehmen', () => {
    const vorbei = wk({ day: '2026-05-20', name: 'Ohne Protokoll' })
    const { ziel } = baue({ wettkaempfe: [vorbei] })
    expect(ziel.ohneErgebnis.map((x) => x.id)).toEqual([vorbei.id])
    // Nichts wird erzeugt: Es gibt keine Ergebniszeile und keinen Status.
    expect(ziel.naechster).toBeNull()
  })

  it('verschwindet, sobald eine Ergebniszeile dasteht', () => {
    const vorbei = wk({ id: 'alt', day: '2026-05-20' })
    const r = {
      id: 'r1', competition_id: 'alt', apparatus: 'reck', routine_version_id: null,
      d_score: null, e_score: null, penalty: null, final_score: 11,
      rank_apparatus: null, note: null, deleted_at: null,
    } as unknown as GymResult
    const { ziel } = baue({ wettkaempfe: [vorbei], ergebnisse: [r] })
    expect(ziel.ohneErgebnis).toEqual([])
  })

  it('führt einen künftigen Wettkampf ohne Ergebnis NICHT als offen', () => {
    const { ziel } = baue({ wettkaempfe: [wk({ day: '2026-06-25' })] })
    expect(ziel.ohneErgebnis).toEqual([])
  })

  it('zählt eine gelöschte Ergebniszeile nicht als Ergebnis', () => {
    const vorbei = wk({ id: 'alt', day: '2026-05-20' })
    const r = {
      id: 'r1', competition_id: 'alt', apparatus: 'reck', routine_version_id: null,
      d_score: 3, e_score: 8, penalty: null, final_score: 11,
      rank_apparatus: null, note: null, deleted_at: '2026-05-21T00:00:00Z',
    } as unknown as GymResult
    expect(wettkaempfeOhneErgebnis([vorbei], [r], HEUTE).map((x) => x.id)).toEqual(['alt'])
  })

  it('reiht mehrere offene Termine mit dem jüngsten zuerst', () => {
    const liste = [wk({ day: '2026-01-10' }), wk({ day: '2026-05-20' }), wk({ day: '2026-03-15' })]
    expect(wettkaempfeOhneErgebnis(liste, [], HEUTE).map((x) => x.day))
      .toEqual(['2026-05-20', '2026-03-15', '2026-01-10'])
  })
})

/* ===================== 1b. Der Termin hängt nicht am Elementkatalog ===== */

/**
 * Die vier Zustände eines leeren Turnbestands.
 *
 * Ein kommender Wettkampf ist eine eigenständige Auskunft. Er muss auch dann
 * dastehen, wenn noch kein Element, keine Kür, kein Versuch und kein Durchgang
 * erfasst ist – und darf dabei **nichts** erfinden: keine Gerätekarten, keine
 * Kür, keine sechs Geräte.
 */
describe('Leerer Turnbestand', () => {
  it('ohne Elemente und ohne Wettkampf gibt es nichts zu zeigen', () => {
    const { ziel, fokus } = baue({})
    expect(ziel.naechster).toBeNull()
    expect(ziel.countdown).toBeNull()
    expect(ziel.geraete).toEqual([])
    expect(ziel.herkunft).toBe('keine')
    // Der Fokus kennt alle sechs Geraete, aber keines davon hat eine Kuer -
    // daraus darf kein Geraeteumfang entstehen.
    expect(fokus.geraete.length).toBe(6)
    expect(fokus.geraete.every((g) => g.kuer === null)).toBe(true)
  })

  it('ohne Elemente, aber mit kommendem Wettkampf steht der Termin vollständig da', () => {
    const w = wk({ day: '2026-06-20', name: 'Sachsenmeisterschaft', ort: 'Chemnitz' })
    const { ziel } = baue({ wettkaempfe: [w] })
    expect(ziel.naechster?.name).toBe('Sachsenmeisterschaft')
    expect(ziel.naechster?.day).toBe('2026-06-20')
    expect(ziel.naechster?.location).toBe('Chemnitz')
    expect(ziel.tageHin).toBe(19)
    expect(ziel.countdown).toBe('in 19 Tagen')
    // Und nichts dazu erfunden.
    expect(ziel.geraete).toEqual([])
    expect(ziel.herkunft).toBe('keine')
  })

  it('erfindet ohne Daten keine sechs Geräte', () => {
    const { ziel } = baue({ wettkaempfe: [wk({ day: '2026-06-20' })] })
    expect(ziel.geraete.length).not.toBe(6)
    expect(ziel.geraete.length).toBe(0)
    // Auch kein Platzhalter mit leeren Werten.
    expect(ziel.geraete.some((g) => g.kuerName === null)).toBe(false)
  })

  it('zeigt denselben Wettkampf weiter, sobald Elemente und Kür dazukommen', () => {
    const w = wk({ id: 'kommt', day: '2026-06-20', name: 'Sachsenmeisterschaft' })
    const ohne = baue({ wettkaempfe: [w] }).ziel
    const r = geraetMitKuer('reck')
    const mit = baue({
      wettkaempfe: [w],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
    }).ziel

    // Der Termin bleibt Zeichen fuer Zeichen derselbe.
    expect(mit.naechster?.id).toBe(ohne.naechster?.id)
    expect(mit.countdown).toBe(ohne.countdown)
    expect(mit.tageHin).toBe(ohne.tageHin)
    // Der Geraetestand entsteht jetzt aus den echten Daten.
    expect(mit.geraete.map((g) => g.apparatus)).toEqual(['reck'])
    expect(mit.herkunft).toBe('wettkampfkueren')
    expect(mit.geraete[0].kuerName).toBe(r.kuer.name)
  })

  it('verliert den Termin, sobald der Wettkampf gelöscht ist', () => {
    const w = wk({ id: 'kommt', day: '2026-06-20', name: 'Sachsenmeisterschaft' })
    const weg = { ...w, deleted_at: '2026-06-02T00:00:00Z' } as GymCompetition
    const { ziel } = baue({ wettkaempfe: [weg] })
    expect(ziel.naechster).toBeNull()
    expect(ziel.countdown).toBeNull()
    expect(ziel.ohneErgebnis).toEqual([])
  })
})

/* ============================================ 2. Der Geräteumfang (21.6) */

describe('Geräteumfang – abgeleitet, nicht behauptet', () => {
  it('behauptet ohne Kür und ohne Ergebnis keine sechs Geräte', () => {
    const { ziel } = baue({ wettkaempfe: [wk({ day: '2026-06-25' })] })
    expect(ziel.geraete).toEqual([])
    expect(ziel.herkunft).toBe('keine')
  })

  it('nimmt die Geräte mit aktiver Wettkampfkür', () => {
    const reck = geraetMitKuer('reck')
    const boden = geraetMitKuer('boden')
    const { ziel } = baue({
      wettkaempfe: [wk({ day: '2026-06-25' })],
      elemente: [...reck.elemente, ...boden.elemente],
      kueren: [reck.kuer, boden.kuer],
      verknuepfungen: [...reck.verknuepfungen, ...boden.verknuepfungen],
    })
    // Wettkampfreihenfolge: Boden vor Reck, nicht die Reihenfolge der Zeilen.
    expect(ziel.geraete.map((g) => g.apparatus)).toEqual(['boden', 'reck'])
    expect(ziel.herkunft).toBe('wettkampfkueren')
    expect(HERKUNFT_TEXT.wettkampfkueren).toMatch(/erfasst LifeHub nicht/)
  })

  it('nimmt stattdessen die Ergebniszeilen, wenn es welche gibt', () => {
    const reck = geraetMitKuer('reck')
    const boden = geraetMitKuer('boden')
    const w = wk({ id: 'kommt', day: '2026-06-25' })
    const r = {
      id: 'r1', competition_id: 'kommt', apparatus: 'reck', routine_version_id: null,
      d_score: null, e_score: null, penalty: null, final_score: null,
      rank_apparatus: null, note: 'Startzeit 10:30', deleted_at: null,
    } as unknown as GymResult
    const { ziel } = baue({
      wettkaempfe: [w],
      ergebnisse: [r],
      elemente: [...reck.elemente, ...boden.elemente],
      kueren: [reck.kuer, boden.kuer],
      verknuepfungen: [...reck.verknuepfungen, ...boden.verknuepfungen],
    })
    expect(ziel.geraete.map((g) => g.apparatus)).toEqual(['reck'])
    expect(ziel.herkunft).toBe('ergebniszeilen')
  })

  it('wertet nur die Ergebniszeilen DIESES Wettkampfs', () => {
    const reck = geraetMitKuer('reck')
    const fokus = baue({
      elemente: reck.elemente, kueren: [reck.kuer], verknuepfungen: reck.verknuepfungen,
    }).fokus
    const fremd = {
      id: 'r1', competition_id: 'anderer', apparatus: 'sprung', routine_version_id: null,
      d_score: 3, e_score: 8, penalty: null, final_score: 11,
      rank_apparatus: null, note: null, deleted_at: null,
    } as unknown as GymResult
    const umfang = geraeteUmfang(wk({ id: 'kommt', day: '2026-06-25' }), [fremd], fokus)
    expect(umfang.keys).toEqual(['reck'])
    expect(umfang.herkunft).toBe('wettkampfkueren')
  })
})

/* ============================================= 3. Der Stand je Gerät */

describe('standAus – nur aus den vorhandenen Kategorien', () => {
  it('nennt ein Gerät ohne Wettkampfkür genau so', () => {
    expect(standAus('keine_kuer', 'zu_wenig_daten')).toBe('kuer_fehlt')
    expect(standAus('keine_kuer', 'stabil')).toBe('kuer_fehlt')
  })

  it('stellt auffällige Elemente voran', () => {
    expect(standAus('instabil', 'stabil')).toBe('elemente_auffaellig')
    expect(standAus('gemischt', 'stabil')).toBe('elemente_auffaellig')
    expect(standAus('instabil', 'instabil')).toBe('elemente_auffaellig')
  })

  it('nennt die Kür am Stück, wenn nur sie auffällt', () => {
    expect(standAus('stabil', 'instabil')).toBe('kuer_am_stueck_auffaellig')
    expect(standAus('stabil', 'gemischt')).toBe('kuer_am_stueck_auffaellig')
  })

  it('nennt fehlende Daten fehlende Daten – auf beiden Seiten', () => {
    expect(standAus('zu_wenig_daten', 'zu_wenig_daten')).toBe('daten_fehlen')
    expect(standAus('zu_wenig_daten', 'stabil')).toBe('daten_fehlen')
    // Elemente stehen, aber kein einziger Durchgang: auch das ist eine Luecke
    // in den Daten und nicht "in Ordnung".
    expect(standAus('stabil', 'zu_wenig_daten')).toBe('daten_fehlen')
  })

  it('sagt nur bei beidseitig stabil, dass nichts offen ist', () => {
    expect(standAus('stabil', 'stabil')).toBe('stabile_basis')
  })

  it('verspricht mit `stabile_basis` keine Wettkampfbereitschaft', () => {
    expect(STAND_LABEL.stabile_basis).not.toMatch(/bereit|fit|sicher|gut/i)
    expect(STAND_ERKLAERUNG.stabile_basis).toMatch(/keine Zusage/i)
  })
})

describe('Gerätestand durch die echte Kette', () => {
  const kommend = () => wk({ day: '2026-06-25', name: 'Sachsenmeisterschaft' })

  it('ohne aktive Kür: das Gerät erscheint gar nicht, weil es keinen Umfang hergibt', () => {
    const e = element({ apparatus: 'reck', name: 'Riesenfelge' })
    const { ziel } = baue({ wettkaempfe: [kommend()], elemente: [e] })
    expect(ziel.geraete).toEqual([])
  })

  it('aktive Kür ohne Trainingsdaten: Kür da, aber keine Aussage über sie', () => {
    const r = geraetMitKuer('reck')
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
    })
    const g = von(ziel, 'reck')
    expect(g.kuerName).toBe(r.kuer.name)
    expect(g.elemente).toBe(2)
    expect(g.durchgaenge?.durchgaenge).toBe(0)
    expect(g.durchgangsLage).toBe('zu_wenig_daten')
    // Ohne einen einzigen Versuch fallen beide Elemente als "nie trainiert"
    // auf - 2D nennt die Kuer deshalb instabil, und 3C uebernimmt das.
    expect(g.elementLage).toBe('instabil')
    expect(g.stand).toBe('elemente_auffaellig')
    expect(g.letzterStart).toBeNull()
    expect(g.kuerGeaendert).toBeNull()
  })

  it('stabile Elemente, keine Kürdurchgänge: die Lücke wird benannt', () => {
    const r = geraetMitKuer('reck')
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 20 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 20 })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
    })
    const g = von(ziel, 'reck')
    expect(g.elementLage).toBe('stabil')
    expect(g.durchgangsLage).toBe('zu_wenig_daten')
    expect(g.stand).toBe('daten_fehlen')
    expect(g.hinweise.some((h) => /kein Kürdurchgang/i.test(h))).toBe(true)
  })

  it('stabile Elemente und stabile Kür: keine offenen Punkte', () => {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 20 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 20 })
    const d = durchgaenge({ versionId: fid, tag: '2026-05-27', anzahl: 4, sauber: 4 })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit, d.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
      runs: d.runs,
      versionen: [fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' })],
    })
    const g = von(ziel, 'reck')
    expect(g.elementLage).toBe('stabil')
    expect(g.durchgangsLage).toBe('stabil')
    expect(g.stand).toBe('stabile_basis')
    expect(g.durchgaenge?.durchgaenge).toBe(4)
    expect(g.durchgaenge?.sauber).toBe(4)
    expect(g.durchgaenge?.tageHerKomplett).toBe(5)
  })

  it('stabile Elemente, instabile Kür: die Kür am Stück fällt auf', () => {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 20 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 20 })
    const d = durchgaenge({ versionId: fid, tag: '2026-05-27', anzahl: 5, sauber: 1 })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit, d.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
      runs: d.runs,
      versionen: [fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' })],
    })
    const g = von(ziel, 'reck')
    expect(g.elementLage).toBe('stabil')
    expect(g.durchgangsLage).toBe('instabil')
    expect(g.stand).toBe('kuer_am_stueck_auffaellig')
  })

  it('instabile Elemente bei stabilen Durchgängen: beides steht da, Elemente zuerst', () => {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 4, shaky: 4, failed: 4 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 4, shaky: 4, failed: 4 })
    const d = durchgaenge({ versionId: fid, tag: '2026-05-27', anzahl: 4, sauber: 4 })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit, d.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
      runs: d.runs,
      versionen: [fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' })],
    })
    const g = von(ziel, 'reck')
    expect(g.elementLage).toBe('instabil')
    expect(g.stand).toBe('elemente_auffaellig')
    // Die Kuerstabilitaet wird NICHT verdeckt - sie steht daneben.
    expect(g.durchgangsLage).toBe('stabil')
    expect(g.auffaellige.length).toBeGreaterThanOrEqual(2)
  })

  it('beides auffällig: Elemente führen, die Kür bleibt sichtbar', () => {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 4, shaky: 4, failed: 4 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 4, shaky: 4, failed: 4 })
    const d = durchgaenge({ versionId: fid, tag: '2026-05-27', anzahl: 5, sauber: 1 })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit, d.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
      runs: d.runs,
      versionen: [fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' })],
    })
    const g = von(ziel, 'reck')
    expect(g.stand).toBe('elemente_auffaellig')
    expect(g.durchgangsLage).toBe('instabil')
  })

  it('zählt die Durchgänge einer alten Fassung NICHT zur aktuellen Kür', () => {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const alt = 'fassung-alt'
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 20 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 20 })
    const d = durchgaenge({ versionId: alt, tag: '2026-05-27', anzahl: 8, sauber: 8 })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit, d.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
      runs: d.runs,
      versionen: [
        fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' }),
        fassung({ id: alt, routineId: r.kuer.id, apparatus: 'reck' }),
      ],
    })
    const g = von(ziel, 'reck')
    expect(g.durchgaenge?.durchgaenge).toBe(0)
    expect(g.durchgaenge?.sauber).toBe(0)
    expect(g.fruehere).toEqual({ durchgaenge: 8, fassungen: 1 })
    expect(g.neueFassung).toBe(true)
    expect(g.durchgangsLage).toBe('zu_wenig_daten')
    expect(g.stand).toBe('daten_fehlen')
    // Die Anzeige muss sagen, dass die AKTUELLE Fassung nicht erfasst ist -
    // und nicht "8 stabile Durchgaenge" (21.13).
    const text = g.hinweise.join(' ')
    expect(text).toMatch(/aktuelle Kürfassung ist noch nicht erfasst/i)
    expect(text).toMatch(/zählen dafür nicht/i)
    expect(text).not.toMatch(/8 von 8 sauber/)
  })

  it('verträgt ein gelöschtes Kürelement, ohne die Kür zu kürzen', () => {
    const e1 = element({ apparatus: 'reck', name: 'Bleibt', difficulty_value: 0.3 })
    const e2 = element({
      apparatus: 'reck', name: 'Weg', difficulty_value: 0.4,
      deleted_at: '2026-04-01T00:00:00Z',
    })
    const k = kuer({ apparatus: 'reck' })
    const verkn = [kuerPlatz(k.id, e1.id, 0), kuerPlatz(k.id, e2.id, 1)]
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: [e1, e2], kueren: [k], verknuepfungen: verkn,
    })
    const g = von(ziel, 'reck')
    // `kuerElemente()` zaehlt die Plaetze fuer die Anzeige ab 1.
    expect(g.geloeschtePlaetze).toEqual([2])
    // Zwei Plaetze, einer ohne Wert: die Summe ist nicht vollstaendig.
    expect(g.schwierigkeit?.elemente).toBe(2)
    expect(g.schwierigkeit?.mitWert).toBe(1)
    expect(g.schwierigkeit?.summe).toBe(0.3)
    expect(g.schwierigkeit?.vollstaendig).toBe(false)
    expect(g.hinweise.some((h) => /gelöschte|gelöschtes/i.test(h))).toBe(true)
  })

  it('übergeht ein archiviertes Kürelement nicht still', () => {
    const e1 = element({ apparatus: 'reck', name: 'Aktiv', difficulty_value: 0.3 })
    const e2 = element({ apparatus: 'reck', name: 'Archiv', difficulty_value: 0.2, is_active: 0 })
    const k = kuer({ apparatus: 'reck' })
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: [e1, e2], kueren: [k],
      verknuepfungen: [kuerPlatz(k.id, e1.id, 0), kuerPlatz(k.id, e2.id, 1)],
    })
    const g = von(ziel, 'reck')
    expect(g.elemente).toBe(2)
    expect(g.auffaellige.some((a) => a.element.id === e2.id)).toBe(true)
  })

  it('summiert die Schwierigkeit mit derselben Funktion wie die Kürliste', () => {
    const r = geraetMitKuer('reck')
    const { ziel } = baue({
      wettkaempfe: [kommend()],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
    })
    const g = von(ziel, 'reck')
    expect(g.schwierigkeit?.summe).toBe(0.5)
    expect(g.schwierigkeit?.vollstaendig).toBe(true)
    expect(g.schwierigkeit?.buchstaben).toEqual([
      { buchstabe: 'B', anzahl: 1 }, { buchstabe: 'C', anzahl: 1 },
    ])
  })
})

/* ====================================== 4. Letzter Wettkampf und Fassung */

describe('Letzter Wettkampf – beschreibend und ohne Kausalität', () => {
  const vergangen = wk({ id: 'alt', day: '2026-05-10', name: 'Bezirksmeisterschaft' })

  function mitLetztemWettkampf(o: { versionId: string | null; eRang: number }) {
    const r = geraetMitKuer('reck')
    const ergebnis = {
      id: 'r1', competition_id: 'alt', apparatus: 'reck',
      routine_version_id: o.versionId,
      d_score: 3.2, e_score: 7.8, penalty: null, final_score: 11,
      rank_apparatus: 4, note: null, deleted_at: null,
    } as unknown as GymResult
    const benchmark: VergleichsWerte = {
      competition_id: 'alt', scope: 'reck', cohort_label: 'LK 2', cohort_size: 6,
      final_rank: 4, final_tie_count: 1, final_count: 6, final_median: 11.4, final_best: 12.2,
      d_rank: 2, d_tie_count: 1, d_count: 6, d_median: 3, d_best: 3.6,
      e_rank: o.eRang, e_tie_count: 1, e_count: 6, e_median: 8.1, e_best: 8.8,
    }
    const { ziel } = baue({
      wettkaempfe: [vergangen, wk({ day: '2026-06-25' })],
      ergebnisse: [ergebnis],
      benchmarks: [benchmark],
      analyseWk: vergangen,
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
    })
    return { ziel, r, aktuelleFassung: r.aktuelleFassung(r.elemente, r.verknuepfungen) }
  }

  it('übernimmt D, E, Endnote und den Platz im Feld unverändert aus 2C', () => {
    const { ziel } = mitLetztemWettkampf({ versionId: null, eRang: 5 })
    const l = von(ziel, 'reck').letzterStart!
    expect(l.name).toBe('Bezirksmeisterschaft')
    expect(l.day).toBe('2026-05-10')
    expect(l.d.wert).toBe(3.2)
    expect(l.e.wert).toBe(7.8)
    expect(l.final.wert).toBe(11)
    expect(l.final.rang).toBe(4)
    expect(l.final.anzahl).toBe(6)
    expect(l.feldgroesse).toBe(6)
  })

  it('nennt eine Lage unter der Feldmitte, ohne sie einem Element zuzuschreiben', () => {
    const { ziel } = mitLetztemWettkampf({ versionId: null, eRang: 6 })
    const g = von(ziel, 'reck')
    expect(g.letzterStart?.ausfuehrungUnten).toBe(true)
    // Keine Zeile verbindet das mit einem Element.
    for (const h of g.hinweise) {
      expect(h).not.toMatch(/weil|wegen|verursacht|dadurch|deshalb schlecht/i)
    }
  })

  it('erkennt, dass die Kür seit dem letzten Wettkampf geändert wurde', () => {
    const { ziel } = mitLetztemWettkampf({ versionId: 'fassung-von-damals', eRang: 3 })
    const g = von(ziel, 'reck')
    expect(g.kuerGeaendert).toBe(true)
    expect(g.hinweise.some((h) => /seit dem letzten Wettkampf geändert/i.test(h))).toBe(true)
  })

  it('sagt NICHT, dass die neue Kür besser wäre', () => {
    const { ziel } = mitLetztemWettkampf({ versionId: 'fassung-von-damals', eRang: 3 })
    for (const h of von(ziel, 'reck').hinweise) {
      expect(h).not.toMatch(/besser|schlechter|stärker|schwächer/i)
    }
  })

  it('erkennt eine unveränderte Kür als unverändert', () => {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const ergebnis = {
      id: 'r1', competition_id: 'alt', apparatus: 'reck', routine_version_id: fid,
      d_score: 3.2, e_score: 7.8, penalty: null, final_score: 11,
      rank_apparatus: null, note: null, deleted_at: null,
    } as unknown as GymResult
    const { ziel } = baue({
      wettkaempfe: [vergangen, wk({ day: '2026-06-25' })],
      ergebnisse: [ergebnis], analyseWk: vergangen,
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      versionen: [fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' })],
    })
    expect(von(ziel, 'reck').kuerGeaendert).toBe(false)
  })

  it('lässt die Frage offen, wenn am Start keine Fassung hinterlegt war', () => {
    const { ziel } = mitLetztemWettkampf({ versionId: null, eRang: 3 })
    expect(von(ziel, 'reck').kuerGeaendert).toBeNull()
  })

  it('hält sich bei kleinem Feld mit oben und unten zurück', () => {
    const r = geraetMitKuer('reck')
    const ergebnis = {
      id: 'r1', competition_id: 'alt', apparatus: 'reck', routine_version_id: null,
      d_score: 3, e_score: 8, penalty: null, final_score: 11,
      rank_apparatus: null, note: null, deleted_at: null,
    } as unknown as GymResult
    const benchmark: VergleichsWerte = {
      competition_id: 'alt', scope: 'reck', cohort_label: 'LK 2', cohort_size: 2,
      final_rank: 2, final_tie_count: 1, final_count: 2, final_median: 11.5, final_best: 12,
      d_rank: 2, d_tie_count: 1, d_count: 2, d_median: 3.2, d_best: 3.4,
      e_rank: 2, e_tie_count: 1, e_count: 2, e_median: 8.2, e_best: 8.4,
    }
    const { ziel } = baue({
      wettkaempfe: [vergangen, wk({ day: '2026-06-25' })],
      ergebnisse: [ergebnis], benchmarks: [benchmark], analyseWk: vergangen,
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
    })
    const l = von(ziel, 'reck').letzterStart!
    expect(l.final.rang).toBe(2)
    expect(l.endnoteUnten).toBeNull()
    expect(l.ausfuehrungUnten).toBeNull()
  })

  it('zeigt ohne Vergleichsfeld die Noten und keinen Platz', () => {
    const { ziel } = baue({
      wettkaempfe: [vergangen, wk({ day: '2026-06-25' })],
      ergebnisse: [{
        id: 'r1', competition_id: 'alt', apparatus: 'reck', routine_version_id: null,
        d_score: 3, e_score: null, penalty: null, final_score: 11,
        rank_apparatus: null, note: null, deleted_at: null,
      } as unknown as GymResult],
      analyseWk: vergangen,
      elemente: geraetMitKuer('reck').elemente,
      kueren: [], verknuepfungen: [],
    })
    // Ohne Kuer gibt es keinen Geraeteumfang - und damit keine Zeile.
    expect(ziel.geraete).toEqual([])
  })

  it('zählt einen Wettkampf von heute nicht als „letzten Wettkampf"', () => {
    // Wer am Wettkampftag schon Noten eintraegt, soll nicht lesen, die Kuer
    // habe sich "seit dem letzten Wettkampf" geaendert - es ist derselbe, der
    // oben als der naechste steht.
    const heuteWk = wk({ id: 'heute', day: HEUTE, name: 'Heute' })
    const r = geraetMitKuer('reck')
    const { ziel } = baue({
      wettkaempfe: [heuteWk],
      ergebnisse: [{
        id: 'r1', competition_id: 'heute', apparatus: 'reck',
        routine_version_id: 'irgendeine', d_score: 3, e_score: 8, penalty: null,
        final_score: 11, rank_apparatus: null, note: null, deleted_at: null,
      } as unknown as GymResult],
      analyseWk: heuteWk,
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
    })
    expect(ziel.naechster?.id).toBe('heute')
    // Der Umfang kommt jetzt aus den Ergebniszeilen - die gibt es ja.
    expect(ziel.herkunft).toBe('ergebniszeilen')
    expect(von(ziel, 'reck').letzterStart).toBeNull()
    expect(von(ziel, 'reck').kuerGeaendert).toBeNull()
  })
})

/* ====================================== 5. Anschluss an Phase 3A und 3B */

describe('Anschluss an 3A und 3B – Kontext, keine Steuerung', () => {
  function mitWettkampf(tage: number) {
    const r = geraetMitKuer('reck')
    const fid = r.aktuelleFassung(r.elemente, r.verknuepfungen)
    const v1 = versuche({ elementId: r.elemente[0].id, tag: '2026-05-20', clean: 20 })
    const v2 = versuche({ elementId: r.elemente[1].id, tag: '2026-05-20', clean: 20 })
    const d = durchgaenge({ versionId: fid, tag: '2026-05-27', anzahl: 5, sauber: 1 })
    const tag = `2026-06-${String(1 + tage).padStart(2, '0')}`
    return baue({
      wettkaempfe: [wk({ day: tag, name: 'Sachsenmeisterschaft' })],
      elemente: r.elemente, kueren: [r.kuer], verknuepfungen: r.verknuepfungen,
      einheiten: [v1.einheit, v2.einheit, d.einheit],
      attempts: [...v1.attempts, ...v2.attempts],
      runs: d.runs,
      versionen: [fassung({ id: fid, routineId: r.kuer.id, apparatus: 'reck' })],
    }).ziel
  }

  it('gibt zum Gerät den Abstand und die Lage der Kür', () => {
    const zeilen = wettkampfHinweis(mitWettkampf(24), 'reck')
    expect(zeilen[0]).toBe('Wettkampf in 24 Tagen')
    expect(zeilen[1]).toBe('Kür am Stück instabil')
  })

  it('schweigt ohne kommenden Wettkampf', () => {
    const { ziel } = baue({ wettkaempfe: [] })
    expect(wettkampfHinweis(ziel, 'reck')).toEqual([])
  })

  it('schweigt zu einem Gerät, das nicht zum Wettkampfumfang gehört', () => {
    expect(wettkampfHinweis(mitWettkampf(24), 'sprung')).toEqual([])
  })

  it('sagt bei 5 Tagen dasselbe wie bei 25 – keine Periodisierung', () => {
    // Derselbe Datenstand, nur ein anderer Abstand: Es darf sich NUR der
    // Countdown aendern. Alles andere waere eine erfundene Periodisierung.
    const nah = wettkampfHinweis(mitWettkampf(5), 'reck')
    const fern = wettkampfHinweis(mitWettkampf(25), 'reck')
    expect(nah.slice(1)).toEqual(fern.slice(1))
    expect(nah[0]).not.toBe(fern[0])
  })

  it('liefert für die Wochenansicht nur Name und Abstand', () => {
    expect(zielKurztext(mitWettkampf(24))).toBe('Sachsenmeisterschaft · in 24 Tagen')
  })
})

/* ============================================= 6. Was NICHT entstehen darf */

describe('Grenzen des Moduls – am Quelltext geprüft', () => {
  const quelle = readFileSync(
    new URL('../src/core/turnen/wettkampfvorbereitung.ts', import.meta.url), 'utf8')

  /**
   * Der Rumpf ohne Kommentare und ohne den Merkposten.
   *
   * In den Kommentaren stehen die verbotenen Worte absichtlich – als
   * Begründung, warum es die Sache nicht gibt. `KEIN_READINESS_SCORE` ist
   * derselbe Merkposten in Codeform und zählt deshalb auch nicht mit.
   */
  const rumpfOhne = () => quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace('export const KEIN_READINESS_SCORE = true', '')

  it('baut keinen Readiness Score', () => {
    const rumpf = rumpfOhne()
    expect(rumpf).not.toMatch(/readiness|bereitschaftsScore|score\s*=|prozent/i)
    expect(rumpf).not.toMatch(/\*\s*100|\/\s*100\b/)
  })

  it('rechnet keine eigene Tageslogik', () => {
    const rumpf = rumpfOhne()
    expect(rumpf).not.toMatch(/new Date\(/)
    expect(rumpf).not.toMatch(/86400000/)
    expect(rumpf).not.toMatch(/toISOString/)
    expect(rumpf).not.toMatch(/getTime\(/)
  })

  it('rechnet Elemente, Küren und Durchgänge nicht ein zweites Mal', () => {
    // Es darf weder `sicherheit.statusVorschlag` noch `durchgangsBild` noch
    // `kuerElemente` aufrufen - all das kommt fertig aus 2D/2E herein.
    const rumpf = rumpfOhne()
    expect(rumpf).not.toMatch(/statusVorschlag|trefferbild|elementBild/)
    expect(rumpf).not.toMatch(/durchgangsBild|durchgaengeJeGeraet/)
    expect(rumpf).not.toMatch(/kuerElemente\(|fassungsInhalt\(/)
  })

  it('erfindet keine Trainingswissenschaft', () => {
    const rumpf = rumpfOhne()
    expect(rumpf).not.toMatch(/peaking|taper|deload|periodisier|belastungsspitze/i)
  })

  it('legt keine Tabelle und keinen Wettkampfstatus an', () => {
    expect(quelle).not.toMatch(/competition_goals|upcoming_competitions|readiness_/)
    // Kein `status`-Feld am Wettkampf, kein automatisches "completed".
    expect(rumpfOhne()).not.toMatch(/completed/)
  })
})

/* ================================================= 7. Aufwand (21.15) */

describe('Aufwand bei einem grossen Bestand', () => {
  it('rechnet die Wettkampfzielansicht in Bruchteilen einer Sekunde', () => {
    const GERAETE_KEYS = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']

    /* 100 Wettkaempfe, 600 Ergebnisse, 700 Benchmarks, 100 Elemente,
       4.000 Versuche, 1.000 Kuerdurchgaenge - die Zahlen aus 21.15. */
    const wettkaempfe: GymCompetition[] = []
    const ergebnisse: GymResult[] = []
    const benchmarks: VergleichsWerte[] = []
    for (let i = 0; i < 100; i++) {
      const tag = `20${20 + Math.floor(i / 20)}-${String(1 + (i % 12)).padStart(2, '0')}-1${i % 9}`
      const w = wk({ id: `wk-${i}`, day: tag, name: `Wettkampf ${i}` })
      wettkaempfe.push(w)
      for (const g of GERAETE_KEYS) {
        ergebnisse.push({
          id: `r-${i}-${g}`, competition_id: w.id, apparatus: g,
          routine_version_id: `v-${i}-${g}`,
          d_score: 3, e_score: 8, penalty: null, final_score: 11,
          rank_apparatus: 3, note: null, deleted_at: null,
        } as unknown as GymResult)
        benchmarks.push({
          competition_id: w.id, scope: g, cohort_label: 'LK 2', cohort_size: 8,
          final_rank: 3, final_tie_count: 1, final_count: 8, final_median: 11, final_best: 12,
          d_rank: 3, d_tie_count: 1, d_count: 8, d_median: 3, d_best: 4,
          e_rank: 4, e_tie_count: 1, e_count: 8, e_median: 8, e_best: 9,
        })
      }
    }
    // Ein kommender Termin.
    const kommend = wk({ id: 'kommt', day: '2026-06-25', name: 'Sachsenmeisterschaft' })
    wettkaempfe.push(kommend)

    const elemente: GymElement[] = []
    const kueren: GymRoutine[] = []
    const verknuepfungen: GymRoutineElement[] = []
    for (const g of GERAETE_KEYS) {
      const k = kuer({ apparatus: g })
      kueren.push(k)
      for (let i = 0; i < 16; i++) {
        const el = element({
          apparatus: g, name: `${g} ${i}`,
          difficulty_value: 0.1 * (1 + (i % 5)), difficulty_letter: 'C',
        })
        elemente.push(el)
        if (i < 8) verknuepfungen.push(kuerPlatz(k.id, el.id, i))
      }
    }

    const einheiten: any[] = []
    const attempts: GymAttempt[] = []
    const runs: GymRoutineRun[] = []
    const versionen: GymRoutineVersion[] = []
    for (const k of kueren) {
      versionen.push(fassung({
        id: fassungsId(fassungsInhalt(k, verknuepfungen, elemente)),
        routineId: k.id, apparatus: k.apparatus,
      }))
    }
    const fassungsIdVon = new Map(
      kueren.map((k) => [k.apparatus, fassungsId(fassungsInhalt(k, verknuepfungen, elemente))]))

    for (let tag = 0; tag < 200; tag++) {
      const sid = `s-${tag}`
      const tagText = `2026-0${1 + (tag % 5)}-${String(1 + (tag % 28)).padStart(2, '0')}`
      einheiten.push({ id: sid, day: tagText, deleted_at: null })
      for (let j = 0; j < 20; j++) {
        const el = elemente[(tag * 20 + j) % elemente.length]
        attempts.push({
          id: `a-${tag}-${j}`, session_id: sid, element_id: el.id,
          clean: 8, shaky: 1, failed: 1, with_help: 0, note: null, sort_order: j,
          deleted_at: null,
        } as unknown as GymAttempt)
      }
      for (let j = 0; j < 5; j++) {
        const g = GERAETE_KEYS[(tag + j) % GERAETE_KEYS.length]
        runs.push({
          id: `run-${tag}-${j}`, session_id: sid,
          routine_version_id: fassungsIdVon.get(g)!,
          completed: 1, falls: 0, interruptions: 0, with_help: 0,
          quality: null, note: null, sort_order: j, deleted_at: null,
        } as unknown as GymRoutineRun)
      }
    }

    expect(attempts.length).toBe(4000)
    expect(runs.length).toBe(1000)
    expect(ergebnisse.length).toBe(600)
    expect(benchmarks.length).toBe(600)
    expect(elemente.length).toBe(96)

    // 2C/2D/2E einmal - genau so wie `bild.ts` es tut.
    const dJeGeraet = durchgaengeJeGeraet({
      runs, versionen, einheiten, kueren,
      kuerVerknuepfungen: verknuepfungen, elemente,
      heute: HEUTE, tagDifferenz: diffDays,
    })
    const analyse = wettkampfAnalyse(wettkaempfe[99], ergebnisse, benchmarks)
    const fokus = trainingsfokus({
      analyse, verlauf: new Map(), elemente, versuche: attempts, einheiten,
      kueren, kuerVerknuepfungen: verknuepfungen, durchgaenge: dJeGeraet,
      heute: HEUTE, tagDifferenz: diffDays,
    })

    // Nur Phase 3C messen: Sie laeuft auf fertigen Bildern und darf den
    // Bestand nicht erneut durcharbeiten.
    const start = performance.now()
    let letztes: WettkampfZiel | null = null
    for (let i = 0; i < 20; i++) {
      letztes = wettkampfvorbereitung({
        wettkaempfe, ergebnisse, fokus, analyse, heute: HEUTE, tagDifferenz: diffDays,
      })
    }
    const ms = (performance.now() - start) / 20

    expect(letztes!.naechster?.id).toBe('kommt')
    expect(letztes!.geraete.length).toBe(6)
    // Grosszuegig bemessen, damit die Pruefung auf einem belegten Rechner
    // nicht grundlos rot wird. Gemessen liegt es weit darunter.
    expect(ms).toBeLessThan(25)
    // eslint-disable-next-line no-console
    console.log(`  Phase 3C bei vollem Bestand: ${ms.toFixed(2)} ms je Aufruf`)
  })
})
