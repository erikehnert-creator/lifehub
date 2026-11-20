/**
 * Tagestraining (Phase 3E) – der heutige Termin und sein Tageskontext.
 *
 * ---------------------------------------------------------------------------
 * Geprüft wird durch die echte Kette
 *
 * Elemente und Versuche → `durchgaengeJeGeraet()` (2E) → `trainingsfokus()`
 * (2D) → `trainingsplanung()` (3A) → `planMitVorbereitung()` (3D) →
 * `wochenplanung()` (3B) → `tagestraining()` (3E). Ein nachgebautes
 * `WochenBild` würde nur die eigene Annahme darüber prüfen, was 3B liefert –
 * und 3E ist nichts anderes als eine Auswahl daraus.
 *
 * ---------------------------------------------------------------------------
 * Was hier NICHT erwartet wird
 *
 * **Keine medizinische oder trainingswissenschaftliche Bewertung.** Kein Test
 * verlangt, dass aus sechs Stunden Schlaf irgendetwas folgt. Mehrere Tests
 * verlangen das Gegenteil: dass derselbe Plan mit und ohne Schlafdaten
 * identisch bleibt.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { diffDays } from '../src/core/dates'
import { BRAUCHT_ARBEIT } from '../src/core/turnen/status'
import { bloeckeMitTag, geraetBilder } from '../src/core/turnen/elemente'
import { wettkampfAnalyse, type VergleichsWerte } from '../src/core/turnen/analyse'
import { fassungsId, fassungsInhalt } from '../src/core/turnen/fassungen'
import { durchgaengeJeGeraet } from '../src/core/turnen/kuerdurchgaenge'
import { trainingsfokus } from '../src/core/turnen/trainingsfokus'
import { PLAN_SCHWELLEN, trainingsplanung } from '../src/core/turnen/trainingsplanung'
import {
  WOCHEN_SCHWELLEN, kapazitaetAus, plaetzeFuer, wochenplanung,
  type TerminEingang, type WochenBild,
} from '../src/core/turnen/wochenplanung'
import { wettkampfvorbereitung } from '../src/core/turnen/wettkampfvorbereitung'
import {
  planMitVorbereitung, vorbereitungsstrategie,
  type VorbereitungsBild,
} from '../src/core/turnen/vorbereitungsstrategie'
import {
  STATUS_TEXT, ZURUECK_GRUND, erfasstText, kapazitaetText, nachKapazitaet,
  statusAus, tagMitAuswahl, tagesKapazitaet, tagestraining,
  type NachtKontext, type TagesSitzung, type TagesTrainingBild,
} from '../src/core/turnen/tagestraining'
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
    id: o.id ?? id('wk'), day: o.day, name: o.name ?? `Wettkampf ${o.day}`,
    location: null, class_name: null, rank_allround: null, score_allround: null,
    protocol_url: null, note: null, deleted_at: null,
  } as unknown as GymCompetition
}

function element(o: Partial<GymElement> & { apparatus: string; name: string }): GymElement {
  return {
    id: o.id ?? id('el'), apparatus: o.apparatus, name: o.name,
    difficulty_letter: o.difficulty_letter ?? null,
    difficulty_value: o.difficulty_value ?? null,
    element_group: null, is_dismount: 0, hold_element: 0,
    status: o.status ?? 'sicher', video_url: null, note: null,
    is_active: 1, sort_order: 0, deleted_at: null,
  } as unknown as GymElement
}

function kuer(o: { apparatus: string }): GymRoutine {
  return {
    id: id('k'), apparatus: o.apparatus, name: `Kür ${o.apparatus}`, note: null,
    is_active: 1, competition_since: '2026-01-01T10:00:00.000Z', deleted_at: null,
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

function nacht(o: Partial<NachtKontext> & { day: string; dauerMinuten: number }): NachtKontext {
  return {
    day: o.day,
    dauerMinuten: o.dauerMinuten,
    von: o.von ?? '2026-05-31T22:40:00.000Z',
    bis: o.bis ?? '2026-06-01T05:58:00.000Z',
    quelle: o.quelle ?? 'Apple Health',
  }
}

function termin(o: Partial<TerminEingang> & { sessionId: string; day: string }): TerminEingang {
  return {
    sessionId: o.sessionId, day: o.day,
    titel: o.titel ?? null,
    dauerMinuten: o.dauerMinuten ?? null,
    tagesart: o.tagesart ?? null,
    freieMinuten: o.freieMinuten ?? null,
  }
}

function sitzung(o: Partial<TagesSitzung> & { sessionId: string }): TagesSitzung {
  return {
    sessionId: o.sessionId,
    status: o.status ?? 'planned',
    titel: o.titel ?? null,
    dauerMinuten: o.dauerMinuten ?? null,
    versuche: o.versuche ?? 0,
    durchgaenge: o.durchgaenge ?? 0,
    geraete: o.geraete ?? [],
  }
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
 * Ein Gerät mit Kür, stabilen Elementen und einem Wettkampfbefund.
 *
 * `dRang`/`eRang` steuern, welche Priorität Phase 2C/2D dem Gerät gibt – und
 * damit, ob es in Phase 3A als Schwerpunkt, Nebenfokus oder Wartung erscheint.
 * Genau diese Rollen braucht Phase 3E, um das Zurückstellen zu prüfen.
 */
function geraetMitKuer(b: Bestand, apparatus: string, o: {
  dRang?: number
  eRang?: number
  elementeStabil?: boolean
  kuerSauber?: number
  kuerDurchgaenge?: number
} = {}) {
  const e1 = element({ apparatus, name: `${apparatus} A`, difficulty_value: 0.2, difficulty_letter: 'B' })
  const e2 = element({ apparatus, name: `${apparatus} B`, difficulty_value: 0.3, difficulty_letter: 'C' })
  const k = kuer({ apparatus })
  b.elemente.push(e1, e2)
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

  b.ergebnisse.push({
    id: `r-${apparatus}`, competition_id: ALT_ID, apparatus,
    routine_version_id: null,
    d_score: 3, e_score: 8.4, penalty: null, final_score: 11.4,
    rank_apparatus: null, note: null, deleted_at: null,
  } as unknown as GymResult)
  b.benchmarks.push({
    competition_id: ALT_ID, scope: apparatus, cohort_label: 'LK 2', cohort_size: 6,
    final_rank: o.dRang ?? 3, final_tie_count: 1, final_count: 6,
    final_median: 11.4, final_best: 12.2,
    d_rank: o.dRang ?? 3, d_tie_count: 1, d_count: 6, d_median: 3.4, d_best: 4,
    e_rank: o.eRang ?? 3, e_tie_count: 1, e_count: 6, e_median: 8.2, e_best: 8.8,
  })
  return { kuer: k, elemente: [e1, e2], fassungId: fid }
}

interface Bau {
  wettkaempfe?: GymCompetition[]
  termine?: TerminEingang[]
  sitzungenHeute?: TagesSitzung[]
  tagesart?: string | null
  freieMinuten?: number | null
  nacht?: NachtKontext | null
  energie?: number | null
  heute?: string
}

function baue(b: Bestand, o: Bau = {}) {
  const heute = o.heute ?? HEUTE
  const alt = wk({ id: ALT_ID, day: '2026-05-10', name: 'Bezirksmeisterschaft' })
  const wettkaempfe = [alt, ...(o.wettkaempfe ?? [])]

  const dJeGeraet = durchgaengeJeGeraet({
    runs: b.runs, versionen: b.versionen, einheiten: b.einheiten,
    kueren: b.kueren, kuerVerknuepfungen: b.verknuepfungen, elemente: b.elemente,
    heute, tagDifferenz: diffDays,
  })
  const analyse = b.ergebnisse.length
    ? wettkampfAnalyse(alt, b.ergebnisse, b.benchmarks) : null
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
  const vorbereitung = vorbereitungsstrategie(ziel)
  const { plan } = planMitVorbereitung(rohplan, vorbereitung)

  const termine = o.termine ?? []
  const woche = wochenplanung({ plan, termine, heute, tagDifferenz: diffDays })

  const tag = tagestraining({
    heute,
    sitzungenHeute: o.sitzungenHeute ?? [],
    woche,
    vorbereitung,
    tagesart: o.tagesart ?? null,
    freieMinuten: o.freieMinuten ?? null,
    nacht: o.nacht ?? null,
    energie: o.energie ?? null,
  })

  return { tag, woche, plan, vorbereitung, ziel }
}

/** Ein Bestand mit drei Geräten – Schwerpunkt, Nebenfokus, Wartung. */
function dreiGeraete(): Bestand {
  const b = leererBestand()
  // Schwache Schwierigkeit UND schwache Ausfuehrung: Prioritaet hoch.
  geraetMitKuer(b, 'reck', { dRang: 6, eRang: 6, elementeStabil: false })
  // Nur eine Seite schwach, Endnote traegt: Prioritaet mittel.
  geraetMitKuer(b, 'barren', { dRang: 6, eRang: 1 })
  // Nichts unter dem Feld: halten - und damit Wartung.
  geraetMitKuer(b, 'boden', { dRang: 1, eRang: 1 })
  return b
}

const rollen = (t: TagesTrainingBild) =>
  t.einheiten[0].geraete.map((g) => `${g.apparatus}/${g.rolle}`)

/* ================================================= 1. Der heutige Termin */

describe('Welche Einheit heute gilt', () => {
  it('erfindet ohne Turntermin kein heutiges Training', () => {
    const { tag } = baue(dreiGeraete(), {})
    expect(tag.status).toBe('kein_training')
    expect(tag.einheiten).toEqual([])
    expect(tag.erfasst).toEqual([])
    expect(STATUS_TEXT.kein_training).toBe('Heute ist kein Turntraining geplant.')
  })

  it('nimmt den einen geplanten Turntermin von heute', () => {
    const { tag } = baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'a', day: HEUTE, titel: 'Turntraining' })],
      sitzungenHeute: [sitzung({ sessionId: 'a', titel: 'Turntraining' })],
    })
    expect(tag.status).toBe('geplant')
    expect(tag.einheiten.length).toBe(1)
    expect(tag.einheiten[0].sessionId).toBe('a')
    expect(tag.einheiten[0].geraete.length).toBeGreaterThan(0)
  })

  it('zeigt bei zwei Terminen heute BEIDE – keine stille Auswahl', () => {
    const { tag } = baue(dreiGeraete(), {
      termine: [
        termin({ sessionId: 'a', day: HEUTE, titel: 'Vormittag' }),
        termin({ sessionId: 'b', day: HEUTE, titel: 'Abend' }),
      ],
      sitzungenHeute: [
        sitzung({ sessionId: 'a', titel: 'Vormittag' }),
        sitzung({ sessionId: 'b', titel: 'Abend' }),
      ],
    })
    expect(tag.einheiten.map((u) => u.sessionId)).toEqual(['a', 'b'])
    // Und beide bekommen ihre Inhalte aus 3B, nicht eine davon nichts.
    expect(tag.einheiten[0].geraete.length).toBeGreaterThan(0)
    expect(tag.einheiten[1].geraete.length).toBeGreaterThan(0)
  })

  it('führt eine heute schon erfasste Einheit nicht mehr als bevorstehend', () => {
    const { tag } = baue(dreiGeraete(), {
      sitzungenHeute: [sitzung({
        sessionId: 'a', status: 'completed', titel: 'Reck · Barren',
        versuche: 24, durchgaenge: 2, geraete: ['Barren', 'Reck'],
      })],
    })
    expect(tag.status).toBe('erfasst')
    expect(tag.einheiten).toEqual([])
    expect(tag.erfasst.length).toBe(1)
    expect(tag.erfasst[0].versuche).toBe(24)
  })

  it('fasst eine erfasste Einheit beschreibend zusammen – ohne Urteil', () => {
    const text = erfasstText({
      sessionId: 'a', titel: null, dauerMinuten: 90,
      versuche: 24, durchgaenge: 2, geraete: ['Barren', 'Reck'],
    })
    expect(text).toBe('Barren · Reck · 24 Versuche · 2 Kürdurchgänge')
    expect(text).not.toMatch(/gut|stark|schwach|erfolg|ziel|genug/i)
  })

  it('nennt einen ausgefallenen Termin ausgefallen', () => {
    const { tag } = baue(dreiGeraete(), {
      sitzungenHeute: [sitzung({ sessionId: 'a', status: 'skipped' })],
    })
    expect(tag.status).toBe('ausgefallen')
    expect(tag.ausgefallen.length).toBe(1)
    expect(tag.einheiten).toEqual([])
  })

  it('lässt einen offenen Termin den erfassten schlagen – es steht ja noch etwas aus', () => {
    const { tag } = baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'b', day: HEUTE })],
      sitzungenHeute: [
        sitzung({ sessionId: 'a', status: 'completed', versuche: 12 }),
        sitzung({ sessionId: 'b', status: 'planned' }),
      ],
    })
    expect(tag.status).toBe('geplant')
    expect(tag.einheiten.map((u) => u.sessionId)).toEqual(['b'])
    // Die erfasste steht trotzdem da - sie verschwindet nicht.
    expect(tag.erfasst.map((u) => u.sessionId)).toEqual(['a'])
  })

  it('zählt einen Termin von morgen nicht als heute', () => {
    const { tag } = baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'a', day: '2026-06-02' })],
      sitzungenHeute: [],
    })
    expect(tag.status).toBe('kein_training')
    expect(tag.naechsteEinheit?.day).toBe('2026-06-02')
    expect(tag.naechsteEinheit?.label).toBe('morgen')
  })

  it('zählt einen überfälligen Termin von gestern nicht als heute', () => {
    const { tag, woche } = baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'alt', day: '2026-05-31' })],
      sitzungenHeute: [],
    })
    expect(tag.status).toBe('kein_training')
    expect(tag.einheiten).toEqual([])
    // Phase 3B fuehrt ihn als ueberfaellig - 3E erfindet daraus nichts.
    expect(woche.ueberfaellig.map((u) => u.sessionId)).toEqual(['alt'])
  })

  it('nennt den nächsten Termin auch an einem Tag mit Training nicht doppelt', () => {
    const { tag } = baue(dreiGeraete(), {
      termine: [
        termin({ sessionId: 'a', day: HEUTE }),
        termin({ sessionId: 'b', day: '2026-06-04' }),
      ],
      sitzungenHeute: [sitzung({ sessionId: 'a' })],
    })
    expect(tag.status).toBe('geplant')
    // Der naechste ist der NACH heute, nicht der heutige.
    expect(tag.naechsteEinheit?.sessionId).toBe('b')
  })

  it('kommt ohne jeden Termin auch ohne nächste Einheit aus', () => {
    const { tag } = baue(dreiGeraete(), {})
    expect(tag.naechsteEinheit).toBeNull()
  })
})

describe('statusAus – die Reihenfolge der Dringlichkeit', () => {
  const ohneWk = { phase: 'keine' } as unknown as VorbereitungsBild
  const wkTag = { phase: 'wettkampftag' } as unknown as VorbereitungsBild

  it('stellt den Wettkampftag voran', () => {
    expect(statusAus(wkTag, 1, 1, 1)).toBe('wettkampftag')
    expect(statusAus(wkTag, 0, 0, 0)).toBe('wettkampftag')
  })

  it('bildet die übrigen Fälle ab', () => {
    expect(statusAus(ohneWk, 1, 0, 0)).toBe('geplant')
    expect(statusAus(ohneWk, 1, 1, 0)).toBe('geplant')
    expect(statusAus(ohneWk, 0, 1, 0)).toBe('erfasst')
    expect(statusAus(ohneWk, 0, 0, 1)).toBe('ausgefallen')
    expect(statusAus(ohneWk, 0, 0, 0)).toBe('kein_training')
  })
})

/* ================================================= 2. Der Tageskontext */

describe('Schlaf ist Kontext und kein Regler', () => {
  const mit = (n: NachtKontext | null) => baue(dreiGeraete(), {
    termine: [termin({ sessionId: 'a', day: HEUTE })],
    sitzungenHeute: [sitzung({ sessionId: 'a' })],
    nacht: n,
  }).tag

  it('nimmt die Nacht auf heute unverändert entgegen', () => {
    const t = mit(nacht({ day: HEUTE, dauerMinuten: 378 }))
    expect(t.kontext.nacht?.dauerMinuten).toBe(378)
    expect(t.kontext.nacht?.quelle).toBe('Apple Health')
  })

  it('kommt ohne Schlafdaten vollständig aus', () => {
    const t = mit(null)
    expect(t.kontext.nacht).toBeNull()
    // Das Training bleibt nutzbar - Schlaf ist keine Voraussetzung.
    expect(t.status).toBe('geplant')
    expect(t.einheiten[0].geraete.length).toBeGreaterThan(0)
  })

  it('ändert am Plan nichts – mit oder ohne Schlaf dasselbe', () => {
    const kurz = mit(nacht({ day: HEUTE, dauerMinuten: 300 }))
    const lang = mit(nacht({ day: HEUTE, dauerMinuten: 540 }))
    const ohne = mit(null)
    const inhalte = (t: TagesTrainingBild) =>
      t.einheiten[0].geraete.map((g) => `${g.apparatus}:${g.inhalte.map((i) => i.art).join(',')}`)
    expect(inhalte(kurz)).toEqual(inhalte(ohne))
    expect(inhalte(lang)).toEqual(inhalte(ohne))
    expect(kurz.einheiten[0].zurueckgestellt).toEqual([])
    expect(lang.einheiten[0].zurueckgestellt).toEqual([])
  })

  it('kennt keine Schlafkategorie und keine Ampel', () => {
    const t = mit(nacht({ day: HEUTE, dauerMinuten: 300 }))
    // Es gibt im Bild kein Feld, in dem eine Bewertung stehen koennte.
    expect(Object.keys(t.kontext.nacht!).sort())
      .toEqual(['bis', 'dauerMinuten', 'day', 'quelle', 'von'])
  })

  it('übernimmt die Zuordnung über Mitternacht, wie der Import sie setzt', () => {
    // `sleep_sessions.day` IST der Morgen des Aufwachens. Die Nacht beginnt
    // am 31.05. abends und endet am 01.06. frueh - sie traegt den 01.06.
    const n = nacht({
      day: HEUTE, dauerMinuten: 402,
      von: '2026-05-31T21:12:00.000Z', bis: '2026-06-01T04:34:00.000Z',
    })
    const t = mit(n)
    expect(t.kontext.nacht?.day).toBe(HEUTE)
    expect(t.kontext.nacht?.von.slice(0, 10)).toBe('2026-05-31')
    expect(t.kontext.nacht?.bis.slice(0, 10)).toBe('2026-06-01')
  })

  it('nimmt auch eine nach Mitternacht begonnene Nacht', () => {
    const n = nacht({
      day: HEUTE, dauerMinuten: 320,
      von: '2026-06-01T00:48:00.000Z', bis: '2026-06-01T06:20:00.000Z',
    })
    expect(mit(n).kontext.nacht?.dauerMinuten).toBe(320)
  })

  it('nimmt eine Nacht über die Umstellung auf Sommerzeit', () => {
    const t = baue(dreiGeraete(), {
      heute: '2026-03-29',
      nacht: nacht({
        day: '2026-03-29', dauerMinuten: 395,
        von: '2026-03-28T21:30:00.000Z', bis: '2026-03-29T05:05:00.000Z',
      }),
    }).tag
    expect(t.kontext.nacht?.day).toBe('2026-03-29')
    expect(t.kontext.nacht?.dauerMinuten).toBe(395)
  })

  it('nimmt eine Nacht über die Umstellung auf Winterzeit', () => {
    const t = baue(dreiGeraete(), {
      heute: '2026-10-25',
      nacht: nacht({
        day: '2026-10-25', dauerMinuten: 465,
        von: '2026-10-24T21:00:00.000Z', bis: '2026-10-25T05:45:00.000Z',
      }),
    }).tag
    expect(t.kontext.nacht?.day).toBe('2026-10-25')
    expect(t.kontext.nacht?.dauerMinuten).toBe(465)
  })

  it('zieht nach, wenn der Schlafdatensatz sich ändert', () => {
    const vorher = mit(nacht({ day: HEUTE, dauerMinuten: 300 }))
    const nachher = mit(nacht({ day: HEUTE, dauerMinuten: 455 }))
    expect(vorher.kontext.nacht?.dauerMinuten).toBe(300)
    expect(nachher.kontext.nacht?.dauerMinuten).toBe(455)
  })

  it('übergeht eine Nacht, die einem anderen Tag zugerechnet ist', () => {
    // Die Auswahl trifft der Aufrufer ueber `day === heute`; dieses Modul
    // bekommt dann schlicht `null` und erfindet nichts dazu.
    const t = mit(null)
    expect(t.kontext.nacht).toBeNull()
  })
})

describe('Tagesart und Energie sind Kontext', () => {
  it('übernimmt die vorhandene Tagesart unverändert', () => {
    const { tag } = baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'a', day: HEUTE, tagesart: 'Frühschicht' })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })],
      tagesart: 'Frühschicht',
    })
    expect(tag.kontext.tagesart).toBe('Frühschicht')
  })

  it('leitet aus der Tagesart keine Geräteentscheidung ab', () => {
    const basis = dreiGeraete()
    const inhalte = (t: TagesTrainingBild) =>
      t.einheiten[0].geraete.map((g) => g.apparatus)
    const frueh = baue(basis, {
      termine: [termin({ sessionId: 'a', day: HEUTE })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })], tagesart: 'Frühschicht',
    }).tag
    const frei = baue(basis, {
      termine: [termin({ sessionId: 'a', day: HEUTE })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })], tagesart: 'Frei',
    }).tag
    expect(inhalte(frueh)).toEqual(inhalte(frei))
  })

  it('nimmt einen vorhandenen Energiewert mit, ohne etwas daraus zu folgern', () => {
    const basis = dreiGeraete()
    const niedrig = baue(basis, {
      termine: [termin({ sessionId: 'a', day: HEUTE })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })], energie: 3,
    }).tag
    const hoch = baue(basis, {
      termine: [termin({ sessionId: 'a', day: HEUTE })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })], energie: 9,
    }).tag
    expect(niedrig.kontext.energie).toBe(3)
    expect(hoch.kontext.energie).toBe(9)
    expect(niedrig.einheiten[0].geraete.map((g) => g.apparatus))
      .toEqual(hoch.einheiten[0].geraete.map((g) => g.apparatus))
  })
})

/* ==================================================== 3. Die Kapazität */

describe('tagesKapazitaet – nur vorhandene Angaben', () => {
  it('lässt eine Dauer an der Einheit gewinnen', () => {
    const k = tagesKapazitaet(45, 600)
    expect(k.quelle).toBe('dauer')
    expect(k.kapazitaet).toBe('kurz')
    expect(k.plaetze).toBe(WOCHEN_SCHWELLEN.geraeteKurz)
  })

  it('nimmt sonst die freie Zeit des Tages', () => {
    const k = tagesKapazitaet(null, 40)
    expect(k.quelle).toBe('tag')
    expect(k.kapazitaet).toBe('kurz')
  })

  it('behauptet ohne beides nichts', () => {
    const k = tagesKapazitaet(null, null)
    expect(k.quelle).toBe('keine')
    expect(k.kapazitaet).toBe('unbekannt')
    expect(k.plaetze).toBe(PLAN_SCHWELLEN.maxGeraete)
    expect(kapazitaetText(k)).toBe('')
  })

  it('verwendet die vorhandenen Kategorien und erfindet keine neuen', () => {
    for (const minuten of [30, 59, 60, 119, 120, 240]) {
      expect(tagesKapazitaet(minuten, null).kapazitaet).toBe(kapazitaetAus(minuten))
    }
  })

  it('nennt die Kategorie samt Herkunft', () => {
    expect(kapazitaetText(tagesKapazitaet(45, null)))
      .toBe('kurze Einheit · aus der hinterlegten Dauer der Einheit')
    expect(kapazitaetText(tagesKapazitaet(null, 45)))
      .toBe('kurze Einheit · aus der heute noch freien Zeit')
  })

  it('nennt nirgends Minuten je Gerät', () => {
    const quelle = readFileSync(
      new URL('../src/core/turnen/tagestraining.ts', import.meta.url), 'utf8')
    const rumpf = quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(rumpf).not.toMatch(/minutenJe|minPro|verteilMinuten|anteilMinuten/i)
  })
})

describe('Gleicher Plan, andere Tageskapazität', () => {
  const mit = (freieMinuten: number | null, dauerMinuten: number | null = null) =>
    baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'a', day: HEUTE, dauerMinuten, freieMinuten })],
      sitzungenHeute: [sitzung({ sessionId: 'a', dauerMinuten })],
      freieMinuten,
    }).tag

  it('baut überhaupt denselben Plan – sonst prüft der Test nichts', () => {
    expect(rollen(mit(600))).toEqual(rollen(mit(300)))
  })

  it('lange Kapazität: alles bleibt stehen', () => {
    const t = mit(600)
    expect(t.einheiten[0].kapazitaet.kapazitaet).toBe('lang')
    expect(t.einheiten[0].zurueckgestellt).toEqual([])
    expect(t.einheiten[0].geraete.length).toBe(PLAN_SCHWELLEN.maxGeraete)
  })

  it('normale Kapazität: ebenfalls alles', () => {
    const t = mit(90)
    expect(t.einheiten[0].kapazitaet.kapazitaet).toBe('normal')
    expect(t.einheiten[0].zurueckgestellt).toEqual([])
  })

  it('kurze Kapazität: die hintersten Rollen weichen, nicht die Schwerpunkte', () => {
    const lang = mit(600)
    const kurz = mit(40)
    expect(kurz.einheiten[0].kapazitaet.kapazitaet).toBe('kurz')
    expect(kurz.einheiten[0].geraete.length).toBe(WOCHEN_SCHWELLEN.geraeteKurz)
    expect(kurz.einheiten[0].zurueckgestellt.length).toBe(
      lang.einheiten[0].geraete.length - WOCHEN_SCHWELLEN.geraeteKurz)
    // Kein Schwerpunkt faellt heraus.
    expect(kurz.einheiten[0].zurueckgestellt.every((g) => g.rolle !== 'schwerpunkt')).toBe(true)
  })

  it('behält dabei die Reihenfolge und priorisiert nicht neu', () => {
    const lang = rollen(mit(600))
    const kurz = rollen(mit(40))
    // Die verbliebenen stehen in genau derselben Reihe wie vorher.
    expect(kurz).toEqual(lang.slice(0, kurz.length))
  })

  it('stellt nichts zurück, wenn die Dauer an der Einheit steht – 3B hat das schon', () => {
    // Mit einer Dauer von 40 Minuten hat Phase 3B der Einheit nur zwei
    // Plaetze gegeben; dasselbe ein zweites Mal anzuwenden wuerde doppelt
    // kuerzen.
    const t = mit(40, 40)
    expect(t.einheiten[0].kapazitaet.quelle).toBe('dauer')
    expect(t.einheiten[0].zurueckgestellt).toEqual([])
    expect(t.einheiten[0].geraete.length).toBe(WOCHEN_SCHWELLEN.geraeteKurz)
  })

  it('nennt den Grund für das Zurückstellen', () => {
    expect(ZURUECK_GRUND).toBe('kurze verfügbare Einheit')
  })
})

describe('nachKapazitaet – die Regel einzeln', () => {
  const g = (apparatus: string, rolle: string) =>
    ({ apparatus, name: apparatus, rolle, inhalte: [], wiederholung: false, warum: [] }) as any

  it('rührt nichts an, wenn die Dauer die Quelle ist', () => {
    const alle = [g('a', 'schwerpunkt'), g('b', 'nebenfokus'), g('c', 'wartung')]
    const r = nachKapazitaet(alle, tagesKapazitaet(40, null))
    expect(r.geraete).toBe(alle)
    expect(r.zurueckgestellt).toEqual([])
  })

  it('stellt von hinten zurück', () => {
    const alle = [g('a', 'schwerpunkt'), g('b', 'nebenfokus'), g('c', 'wartung')]
    const r = nachKapazitaet(alle, tagesKapazitaet(null, 40))
    expect(r.geraete.map((x: any) => x.apparatus)).toEqual(['a', 'b'])
    expect(r.zurueckgestellt.map((x: any) => x.apparatus)).toEqual(['c'])
  })

  it('verdrängt niemals einen Schwerpunkt', () => {
    const alle = [g('a', 'schwerpunkt'), g('b', 'schwerpunkt'), g('c', 'schwerpunkt')]
    const r = nachKapazitaet(alle, tagesKapazitaet(null, 40))
    expect(r.geraete.length).toBe(3)
    expect(r.zurueckgestellt).toEqual([])
  })

  it('überspringt einen Schwerpunkt in der Mitte', () => {
    const alle = [g('a', 'nebenfokus'), g('b', 'schwerpunkt'), g('c', 'wartung')]
    const r = nachKapazitaet(alle, tagesKapazitaet(null, 40))
    expect(r.geraete.map((x: any) => x.apparatus)).toEqual(['a', 'b'])
    expect(r.zurueckgestellt.map((x: any) => x.apparatus)).toEqual(['c'])
  })
})

/* ============================================ 4. Phase 3D bleibt gültig */

describe('Phase 3E umgeht Phase 3D nicht', () => {
  const mit = (wettkampfTag: string | null) => {
    const b = leererBestand()
    // Ein Geraet mit stabiler Kuer und einem schwierigeren Kandidaten
    // aussen vor - der Fall, den Phase 3D wettkampfnah zuruecklegt.
    const e1 = element({ apparatus: 'reck', name: 'Kür A', difficulty_value: 0.2 })
    const e2 = element({ apparatus: 'reck', name: 'Kür B', difficulty_value: 0.3 })
    const kandidat = element({ apparatus: 'reck', name: 'Kandidat', difficulty_value: 0.5 })
    const k = kuer({ apparatus: 'reck' })
    b.elemente.push(e1, e2, kandidat)
    b.kueren.push(k)
    b.verknuepfungen.push(kuerPlatz(k.id, e1.id, 0), kuerPlatz(k.id, e2.id, 1))
    for (const el of [e1, e2, kandidat]) {
      const v = versuche({ elementId: el.id, tag: '2026-05-20', clean: 20 })
      b.einheiten.push(v.einheit)
      b.attempts.push(...v.attempts)
    }
    const fid = fassungsId(fassungsInhalt(k, b.verknuepfungen, b.elemente))
    b.versionen.push(fassung({ id: fid, routineId: k.id, apparatus: 'reck' }))
    const d = durchgaenge({ versionId: fid, tag: '2026-05-27', anzahl: 4, sauber: 4 })
    b.einheiten.push(d.einheit)
    b.runs.push(...d.runs)
    b.ergebnisse.push({
      id: 'r-reck', competition_id: ALT_ID, apparatus: 'reck', routine_version_id: null,
      d_score: 3, e_score: 8.4, penalty: null, final_score: 11.4,
      rank_apparatus: null, note: null, deleted_at: null,
    } as unknown as GymResult)
    b.benchmarks.push({
      competition_id: ALT_ID, scope: 'reck', cohort_label: 'LK 2', cohort_size: 6,
      final_rank: 3, final_tie_count: 1, final_count: 6, final_median: 11.4, final_best: 12.2,
      d_rank: 6, d_tie_count: 1, d_count: 6, d_median: 3.4, d_best: 4,
      e_rank: 1, e_tie_count: 1, e_count: 6, e_median: 8.2, e_best: 8.8,
    })

    return baue(b, {
      wettkaempfe: wettkampfTag ? [wk({ day: wettkampfTag, name: 'Sachsenmeisterschaft' })] : [],
      termine: [termin({ sessionId: 'a', day: HEUTE })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })],
    })
  }

  const arten = (t: TagesTrainingBild) =>
    t.einheiten[0]?.geraete.flatMap((g) => g.inhalte.map((i) => i.art)) ?? []

  it('zeigt in der Entwicklungsphase die Entwicklungsarbeit', () => {
    const { tag, vorbereitung } = mit('2026-07-20')
    expect(vorbereitung.phase).toBe('entwicklung')
    expect(arten(tag)).toContain('entwicklung')
  })

  it('zeigt sie in der Stabilisierung weiterhin', () => {
    const { tag, vorbereitung } = mit('2026-06-21')
    expect(vorbereitung.phase).toBe('stabilisierung')
    expect(arten(tag)).toContain('entwicklung')
  })

  it('holt eine wettkampfnah zurückgestellte Entwicklungsarbeit NICHT zurück', () => {
    const { tag, vorbereitung } = mit('2026-06-07')
    expect(vorbereitung.phase).toBe('wettkampfnah')
    expect(arten(tag)).not.toContain('entwicklung')
    // Und auch nicht ueber die Hintertuer der zurueckgestellten Geraete.
    const inZurueck = tag.einheiten[0].zurueckgestellt
      .flatMap((g) => g.inhalte.map((i) => i.art))
    expect(inZurueck).not.toContain('entwicklung')
  })

  it('zeigt am Wettkampftag keinen normalen Trainingsplan', () => {
    const { tag, vorbereitung } = mit(HEUTE)
    expect(vorbereitung.phase).toBe('wettkampftag')
    expect(tag.status).toBe('wettkampftag')
    expect(STATUS_TEXT.wettkampftag).toBe('Heute ist Wettkampf.')
  })

  it('löscht am Wettkampftag einen eigenen Turntermin nicht', () => {
    const { tag } = mit(HEUTE)
    // Der Termin bleibt sichtbar - was damit passiert, entscheidet Erik.
    expect(tag.einheiten.length).toBe(1)
    expect(tag.einheiten[0].sessionId).toBe('a')
  })
})

/* ================================================ 5. Die Nutzerwahl */

describe('tagMitAuswahl – nur für heute, nichts gespeichert', () => {
  const basis = () => baue(dreiGeraete(), {
    termine: [termin({ sessionId: 'a', day: HEUTE, freieMinuten: 600 })],
    sitzungenHeute: [sitzung({ sessionId: 'a' })],
    freieMinuten: 600,
  }).tag

  it('gibt ohne Auswahl dasselbe Objekt zurück', () => {
    const t = basis()
    expect(tagMitAuswahl(t, {})).toBe(t)
  })

  it('schiebt ein abgewähltes Gerät in die zurückgestellten – nicht ins Nichts', () => {
    const t = basis()
    const weg = t.einheiten[0].geraete[0].apparatus
    const neu = tagMitAuswahl(t, { ohne: [weg] })
    expect(neu.einheiten[0].geraete.some((g) => g.apparatus === weg)).toBe(false)
    expect(neu.einheiten[0].zurueckgestellt.some((g) => g.apparatus === weg)).toBe(true)
  })

  it('holt ein zurückgestelltes Gerät an seinen Platz zurück', () => {
    const kurz = baue(dreiGeraete(), {
      termine: [termin({ sessionId: 'a', day: HEUTE, freieMinuten: 40 })],
      sitzungenHeute: [sitzung({ sessionId: 'a' })],
      freieMinuten: 40,
    }).tag
    const zurueck = kurz.einheiten[0].zurueckgestellt[0].apparatus
    const neu = tagMitAuswahl(kurz, { zusatz: [zurueck] })
    expect(neu.einheiten[0].geraete.map((g) => g.apparatus))
      .toEqual(basis().einheiten[0].geraete.map((g) => g.apparatus))
    expect(neu.einheiten[0].zurueckgestellt).toEqual([])
  })

  it('entfernt einen Inhalt und lässt das Gerät stehen', () => {
    const t = basis()
    const key = t.einheiten[0].geraete[0].inhalte[0].key
    const neu = tagMitAuswahl(t, { ohneInhalte: [key] })
    expect(neu.einheiten[0].geraete[0].inhalte.some((i) => i.key === key)).toBe(false)
    expect(neu.einheiten[0].geraete.length).toBe(t.einheiten[0].geraete.length)
  })

  it('ändert nichts am ursprünglichen Bild', () => {
    const t = basis()
    const vorher = t.einheiten[0].geraete.length
    tagMitAuswahl(t, { ohne: [t.einheiten[0].geraete[0].apparatus] })
    expect(t.einheiten[0].geraete.length).toBe(vorher)
  })
})

/* ====================================== 6. Was NICHT entstehen darf */

describe('Grenzen des Moduls – am Quelltext geprüft', () => {
  const quelle = readFileSync(
    new URL('../src/core/turnen/tagestraining.ts', import.meta.url), 'utf8')
  const rumpf = () => quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace('export const SCHLAF_IST_KONTEXT = true', '')

  it('baut keinen Score und keine Bewertung', () => {
    expect(rumpf()).not.toMatch(/readiness|recovery|score|ampel|bewert|prozent/i)
  })

  it('leitet aus Schlaf keine Trainingsentscheidung ab', () => {
    const r = rumpf()
    /* Die Nacht wird DURCHGEREICHT und sonst nichts. Geprueft wird das am
       Rumpf: `nacht` darf ausserhalb der Typangaben nur ein einziges Mal
       vorkommen, naemlich in der Zuweisung ins Tagesbild. Jede Bedingung,
       jeder Vergleich und jede Rechnung damit waere eine zweite Stelle. */
    const zeilen = r.split(/\r?\n/)
      .filter((z) => z.includes('nacht'))
      .map((z) => z.trim())
    // Zwei Typangaben und genau eine Durchreichung - sonst nichts.
    expect(zeilen).toEqual([
      'nacht: NachtKontext | null',
      'nacht: NachtKontext | null',
      'nacht: e.nacht,',
    ])
    expect(r).not.toMatch(/hrv|puls|herzfrequenz|regeneration|verletzung/i)
  })

  it('aggregiert keine Schlafepisoden und deutet keine Phasen', () => {
    expect(rumpf()).not.toMatch(/core_min|deep_min|rem_min|in_bed_min|awake_min/)
    expect(rumpf()).not.toMatch(/vereinige|aggregat|sleep_h|planeSchlafwerte/)
  })

  it('verwendet FatSecret nicht', () => {
    expect(quelle).not.toMatch(/fatsecret|kalorien|protein|kohlenhydrat|mahlzeit/i)
  })

  it('rechnet keine eigene Tageslogik und keine zweite Kapazität', () => {
    const r = rumpf()
    expect(r).not.toMatch(/new Date\(|86400000|toISOString|getTime\(/)
    expect(r).not.toMatch(/computeCapacity|wakingMinutes|freeMinutes/)
  })

  it('rechnet Stabilität, Fokus, Priorität und Verteilung nicht neu', () => {
    const r = rumpf()
    expect(r).not.toMatch(/statusVorschlag|trefferbild|elementBild|durchgangsBild/)
    expect(r).not.toMatch(/stabilitaetAus|lageAus|empfehlungAus|prioritaetAus/)
    expect(r).not.toMatch(/trainingsplanung|wochenplanung\(|nachDringlichkeit/)
  })

  it('legt keine Tabelle und keine Einstellung an', () => {
    expect(rumpf()).not.toMatch(/daily_training_plan|daily_adjustment|training_phase/)
    expect(rumpf()).not.toMatch(/insert\(|patch\(|create\(|settings/)
  })

  it('erzeugt keine Session und keinen Status', () => {
    const r = rumpf()
    // Phase 3E liest den Status und schreibt ihn nicht - die Erfassung tut
    // das, und zwar an der vorhandenen Zeile.
    expect(r).not.toMatch(/status:\s*'completed'|workout_sessions/)
  })

  it('hält die Abhängigkeitsrichtung ein – keine Rückkopplung', () => {
    const importe = (datei: string): string[] => {
      const text = readFileSync(new URL(`../src/core/turnen/${datei}`, import.meta.url), 'utf8')
      return [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    }
    // Niemand oberhalb von 3E kennt 3E.
    for (const datei of [
      'trainingsfokus.ts', 'trainingsplanung.ts', 'wettkampfvorbereitung.ts',
      'vorbereitungsstrategie.ts', 'wochenplanung.ts',
    ]) {
      expect(importe(datei), datei).not.toContain('./tagestraining')
    }
    // Und 3E greift nur nach unten.
    expect(importe('tagestraining.ts')).toContain('./wochenplanung')
    expect(importe('tagestraining.ts')).toContain('./vorbereitungsstrategie')
    expect(importe('tagestraining.ts')).not.toContain('./trainingsplanung')
  })
})

/* ================================================= 7. Aufwand (23.11) */

describe('Aufwand', () => {
  it('ist neben dem vorhandenen Bild nicht messbar', () => {
    const b = dreiGeraete()
    geraetMitKuer(b, 'ringe', { dRang: 4, eRang: 4 })
    geraetMitKuer(b, 'sprung', { dRang: 5, eRang: 2 })
    geraetMitKuer(b, 'pauschenpferd', { dRang: 2, eRang: 5 })

    // Vierzehn Tage voller Termine - mehr als der Horizont ueberhaupt zeigt.
    const termine: TerminEingang[] = []
    const sitzungenHeute: TagesSitzung[] = []
    for (let i = 0; i < 14; i++) {
      const tagText = `2026-06-${String(1 + i).padStart(2, '0')}`
      termine.push(termin({ sessionId: `t-${i}`, day: tagText, freieMinuten: 300 }))
      if (i === 0) sitzungenHeute.push(sitzung({ sessionId: 't-0' }))
    }
    const gebaut = baue(b, { termine, sitzungenHeute, freieMinuten: 300 })
    expect(gebaut.tag.status).toBe('geplant')

    const woche: WochenBild = gebaut.woche
    const start = performance.now()
    let letztes: TagesTrainingBild | null = null
    for (let i = 0; i < 200; i++) {
      letztes = tagestraining({
        heute: HEUTE, sitzungenHeute, woche,
        vorbereitung: gebaut.vorbereitung,
        tagesart: 'Frühschicht', freieMinuten: 300,
        nacht: nacht({ day: HEUTE, dauerMinuten: 400 }), energie: 7,
      })
    }
    const ms = (performance.now() - start) / 200
    expect(letztes!.einheiten.length).toBe(1)
    // Grosszuegig bemessen, damit die Pruefung auf einem belegten Rechner
    // nicht grundlos rot wird. Gemessen liegt es weit darunter.
    expect(ms).toBeLessThan(5)
    // eslint-disable-next-line no-console
    console.log(`  Phase 3E bei vollen 14 Tagen: ${ms.toFixed(3)} ms je Aufruf`)
  })

  it('liest dabei weder Versuche noch Durchgänge noch Schlafepisoden', () => {
    const quelle = readFileSync(
      new URL('../src/core/turnen/tagestraining.ts', import.meta.url), 'utf8')
    expect(quelle).not.toMatch(/GymAttempt|GymRoutineRun|GymResult|SleepSession/)
    // Nur die Session selbst, und die kommt als fertiges Objekt herein.
    expect(quelle).toMatch(/import type \{ WorkoutSession \}/)
  })
})
