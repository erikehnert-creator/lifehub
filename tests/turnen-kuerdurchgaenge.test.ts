/**
 * Kürdurchgänge – Erfassung, Fassungsbezug und Kürstabilität.
 *
 * ---------------------------------------------------------------------------
 * Was hier der Prüfgegenstand ist
 *
 * Nicht die Zählung selbst (die ist trivial), sondern die drei Stellen, an denen
 * es schiefgehen kann:
 *
 *   - Ein Durchgang muss auf die **Fassung** zeigen und nicht auf die lebende
 *     Kür. Ändert Erik die Kür, dürfen die alten Durchgänge unberührt bleiben.
 *   - Die aktuelle Auswertung darf **nur** Durchgänge der aktuellen Fassung
 *     zählen – eine geänderte Kür ist eine andere Übung.
 *   - Die Kürstabilität ist eine **eigene** Messgrösse und nicht die
 *     Elementstabilität mit anderem Namen.
 *
 * Geprüft werden Kategorien und Zahlen, keine deutschen Sätze.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { diffDays } from '../src/core/dates'
import { SCHWELLEN } from '../src/core/turnen/sicherheit'
import { fassungsId, fassungsInhalt } from '../src/core/turnen/fassungen'
import {
  DURCHGANG_SCHWELLEN, FENSTER_WOCHEN, chronologisch, durchgaengeJeGeraet,
  durchgaengeMitTag, durchgangText, durchgangsBild, eingabeAus, imFenster,
  istSauber, lageAus, leereEingabe, planIstLeer, planeDurchgaenge, werteAus,
  type DurchgangMitTag, type DurchgangsStand,
} from '../src/core/turnen/kuerdurchgaenge'
import type {
  GymElement, GymRoutine, GymRoutineElement, GymRoutineRun, GymRoutineVersion,
} from '../src/core/types'

const HEUTE = '2026-06-01'

let lauf = 0
const id = (p: string) => `${p}-${++lauf}`

/* ------------------------------------------------------------- Bausteine */

function element(o: { name: string; apparatus?: string; wert?: number; deleted?: boolean }): GymElement {
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
    deleted_at: o.deleted ? '2026-05-01T00:00:00.000Z' : null,
  } as unknown as GymElement
}

function kuer(o: { apparatus?: string; name?: string; seit?: string | null; weg?: boolean }): GymRoutine {
  return {
    id: id('k'),
    apparatus: o.apparatus ?? 'boden',
    name: o.name ?? 'Kür',
    is_active: 1,
    competition_since: o.seit === undefined ? '2026-01-01T10:00:00.000Z' : o.seit,
    deleted_at: o.weg ? '2026-05-20T00:00:00.000Z' : null,
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

/** Eine Fassungszeile, wie sie beim Einfrieren entstünde. */
function fassung(k: GymRoutine, verkn: GymRoutineElement[], els: GymElement[]): GymRoutineVersion {
  const inhalt = fassungsInhalt(k, verkn, els)
  return {
    id: fassungsId(inhalt),
    routine_id: k.id,
    apparatus: k.apparatus,
    name: k.name,
    frozen_at: '2026-05-01T10:00:00.000Z',
    deleted_at: null,
  } as unknown as GymRoutineVersion
}

function run(o: {
  sessionId: string
  versionId: string
  completed?: boolean
  falls?: number
  interruptions?: number
  hilfe?: boolean
  quality?: GymRoutineRun['quality']
  sort?: number
}): GymRoutineRun {
  return {
    id: id('run'),
    session_id: o.sessionId,
    routine_version_id: o.versionId,
    completed: o.completed === false ? 0 : 1,
    falls: o.falls ?? 0,
    interruptions: o.interruptions ?? 0,
    with_help: o.hilfe ? 1 : 0,
    quality: o.quality ?? null,
    note: null,
    sort_order: o.sort ?? 0,
    created_at: `2026-05-01T1${o.sort ?? 0}:00:00.000Z`,
    deleted_at: null,
  } as unknown as GymRoutineRun
}

const einheit = (idStr: string, day: string) => ({ id: idStr, day, deleted_at: null })

/* ====================================================== Ein Durchgang */

describe('istSauber', () => {
  const kern = (o: Partial<GymRoutineRun>) => ({
    completed: 1, falls: 0, interruptions: 0, with_help: 0, ...o,
  } as GymRoutineRun)

  it('nennt einen kompletten, sturzfreien Durchgang ohne Absetzen und Hilfe sauber', () => {
    expect(istSauber(kern({}))).toBe(true)
  })

  it('nennt einen abgebrochenen Durchgang nicht sauber', () => {
    expect(istSauber(kern({ completed: 0 }))).toBe(false)
  })

  it('nennt einen kompletten Durchgang mit Sturz nicht sauber', () => {
    expect(istSauber(kern({ falls: 1 }))).toBe(false)
  })

  it('nennt einen kompletten Durchgang mit Absetzen nicht sauber', () => {
    expect(istSauber(kern({ interruptions: 1 }))).toBe(false)
  })

  it('nennt einen kompletten Durchgang mit Hilfe nicht sauber', () => {
    expect(istSauber(kern({ with_help: 1 }))).toBe(false)
  })
})

describe('durchgangText', () => {
  it('beschreibt einen sauberen Durchgang', () => {
    expect(durchgangText(run({ sessionId: 's', versionId: 'v' })))
      .toBe('komplett · 0 Stürze')
  })

  it('beschreibt einen Abbruch mit Sturz', () => {
    expect(durchgangText(run({ sessionId: 's', versionId: 'v', completed: false, falls: 1 })))
      .toBe('abgebrochen · 1 Sturz')
  })

  it('nennt Unterbrechungen und Hilfe, wenn es sie gab', () => {
    const t = durchgangText(run({
      sessionId: 's', versionId: 'v', falls: 2, interruptions: 1, hilfe: true,
    }))
    expect(t).toContain('2 Stürze')
    expect(t).toContain('1 Unterbrechung')
    expect(t).toContain('mit Hilfe')
  })
})

/* ==================================================== Kürstabilität */

describe('lageAus – die Kategorie', () => {
  it('gibt unter drei Durchgängen keine Aussage', () => {
    expect(DURCHGANG_SCHWELLEN.mindestDurchgaenge).toBe(3)
    expect(lageAus(1, 1)).toBe('zu_wenig_daten')
    expect(lageAus(2, 2)).toBe('zu_wenig_daten')
  })

  it('nennt überwiegend saubere Durchgänge stabil', () => {
    expect(lageAus(4, 3)).toBe('stabil')
    expect(lageAus(4, 4)).toBe('stabil')
  })

  it('nennt die Hälfte gemischt', () => {
    expect(lageAus(4, 2)).toBe('gemischt')
  })

  it('nennt überwiegend misslungene Durchgänge instabil', () => {
    expect(lageAus(5, 1)).toBe('instabil')
    expect(lageAus(5, 0)).toBe('instabil')
  })

  it('benutzt eigene Schwellen und nicht die der Elemente', () => {
    // Eine ganze Uebung am Stueck ist schwerer als ein einzelnes Element -
    // 90 % zu verlangen hiesse, jeden Turner als instabil zu fuehren.
    expect(DURCHGANG_SCHWELLEN.stabil).toBe(0.75)
    expect(DURCHGANG_SCHWELLEN.gemischt).toBe(0.4)
    expect(SCHWELLEN.sicher).toBe(0.9)
    expect(SCHWELLEN.unsicher).toBe(0.6)
    expect(DURCHGANG_SCHWELLEN.stabil).not.toBe(SCHWELLEN.sicher)
  })

  it('nimmt dasselbe Zeitfenster wie der Rest des Moduls', () => {
    expect(FENSTER_WOCHEN).toBe(8)
    expect(SCHWELLEN.fensterTage).toBe(56)
  })
})

describe('durchgangsBild', () => {
  const liste = (runs: GymRoutineRun[], tag = '2026-05-20'): DurchgangMitTag[] =>
    runs.map((r) => ({ run: r, day: tag }))

  it('zählt ohne Durchgänge nichts und sagt zu wenig Daten', () => {
    const b = durchgangsBild([], HEUTE, diffDays)
    expect(b.durchgaenge).toBe(0)
    expect(b.sauberQuote).toBeNull()
    expect(b.lage).toBe('zu_wenig_daten')
    expect(b.zuletztKomplett).toBeNull()
  })

  it('zählt einen einzigen Durchgang, urteilt aber nicht', () => {
    const b = durchgangsBild(liste([run({ sessionId: 's', versionId: 'v' })]), HEUTE, diffDays)
    expect(b.durchgaenge).toBe(1)
    expect(b.komplett).toBe(1)
    expect(b.sauber).toBe(1)
    expect(b.lage).toBe('zu_wenig_daten')
  })

  it('zählt komplette, sturzfreie, unterbrechungsfreie und hilfefreie getrennt', () => {
    const b = durchgangsBild(liste([
      run({ sessionId: 's', versionId: 'v' }),
      run({ sessionId: 's', versionId: 'v', falls: 1 }),
      run({ sessionId: 's', versionId: 'v', completed: false, interruptions: 2 }),
      run({ sessionId: 's', versionId: 'v', hilfe: true }),
    ]), HEUTE, diffDays)
    expect(b.durchgaenge).toBe(4)
    expect(b.komplett).toBe(3)
    expect(b.sturzfrei).toBe(3)
    expect(b.unterbrechungsfrei).toBe(3)
    expect(b.ohneHilfe).toBe(3)
    expect(b.sauber).toBe(1)
    expect(b.stuerzeGesamt).toBe(1)
    expect(b.lage).toBe('instabil')
  })

  it('merkt sich den letzten Durchgang und den letzten KOMPLETTEN getrennt', () => {
    const b = durchgangsBild([
      { run: run({ sessionId: 's1', versionId: 'v' }), day: '2026-05-10' },
      { run: run({ sessionId: 's2', versionId: 'v', completed: false }), day: '2026-05-26' },
    ], HEUTE, diffDays)
    expect(b.zuletzt).toBe('2026-05-26')
    expect(b.tageHer).toBe(6)
    expect(b.zuletztKomplett).toBe('2026-05-10')
    expect(b.tageHerKomplett).toBe(22)
  })

  it('sagt, wenn in der Reihe nie komplett geturnt wurde', () => {
    const b = durchgangsBild(liste([
      run({ sessionId: 's', versionId: 'v', completed: false }),
      run({ sessionId: 's', versionId: 'v', completed: false }),
      run({ sessionId: 's', versionId: 'v', completed: false }),
    ]), HEUTE, diffDays)
    expect(b.komplett).toBe(0)
    expect(b.zuletztKomplett).toBeNull()
    expect(b.tageHerKomplett).toBeNull()
    expect(b.lage).toBe('instabil')
  })

  it('bildet das Beispiel aus der Anforderung ab – 5 Durchgänge, 4 komplett, 3 sturzfrei', () => {
    const b = durchgangsBild(liste([
      run({ sessionId: 's', versionId: 'v' }),
      run({ sessionId: 's', versionId: 'v' }),
      run({ sessionId: 's', versionId: 'v' }),
      run({ sessionId: 's', versionId: 'v', falls: 1 }),
      run({ sessionId: 's', versionId: 'v', completed: false, falls: 1 }),
    ]), HEUTE, diffDays)
    expect(b.durchgaenge).toBe(5)
    expect(b.komplett).toBe(4)
    expect(b.sturzfrei).toBe(3)
    expect(b.sauber).toBe(3)
    expect(b.lage).toBe('gemischt')
  })
})

/* ============================================= Einheit und Zeitfenster */

describe('durchgaengeMitTag', () => {
  it('verbindet Durchgänge mit dem Tag ihrer Einheit', () => {
    const r = run({ sessionId: 's1', versionId: 'v' })
    expect(durchgaengeMitTag([r], [einheit('s1', '2026-05-20')]))
      .toEqual([{ run: r, day: '2026-05-20' }])
  })

  it('übergeht einen Durchgang ohne Einheit – die Einheit wurde gelöscht', () => {
    const r = run({ sessionId: 'weg', versionId: 'v' })
    expect(durchgaengeMitTag([r], [einheit('s1', '2026-05-20')])).toHaveLength(0)
  })

  it('übergeht eine gelöschte Einheit', () => {
    const r = run({ sessionId: 's1', versionId: 'v' })
    expect(durchgaengeMitTag([r], [{ id: 's1', day: '2026-05-20', deleted_at: 'x' }]))
      .toHaveLength(0)
  })

  it('übergeht einen gelöschten Durchgang', () => {
    const r = { ...run({ sessionId: 's1', versionId: 'v' }), deleted_at: 'x' } as GymRoutineRun
    expect(durchgaengeMitTag([r], [einheit('s1', '2026-05-20')])).toHaveLength(0)
  })
})

describe('imFenster', () => {
  const mach = (tag: string): DurchgangMitTag =>
    ({ run: run({ sessionId: 's', versionId: 'v' }), day: tag })

  it('nimmt, was innerhalb der 56 Tage liegt', () => {
    expect(imFenster([mach('2026-05-20')], HEUTE, diffDays)).toHaveLength(1)
  })

  it('lässt ältere Durchgänge draussen', () => {
    // 2026-01-01 liegt weit vor dem Fenster.
    expect(imFenster([mach('2026-01-01')], HEUTE, diffDays)).toHaveLength(0)
  })

  it('nimmt den Tag genau an der Fenstergrenze mit', () => {
    const grenze = '2026-04-06'   // 56 Tage vor dem 01.06.2026
    expect(diffDays(grenze, HEUTE)).toBe(56)
    expect(imFenster([mach(grenze)], HEUTE, diffDays)).toHaveLength(1)
  })
})

describe('chronologisch', () => {
  it('ordnet nach Tag, dann nach Reihenfolge innerhalb der Einheit', () => {
    const a = run({ sessionId: 's1', versionId: 'v', sort: 1 })
    const b = run({ sessionId: 's1', versionId: 'v', sort: 0 })
    const c = run({ sessionId: 's2', versionId: 'v', sort: 0 })
    const sortiert = chronologisch([
      { run: c, day: '2026-05-26' },
      { run: a, day: '2026-05-20' },
      { run: b, day: '2026-05-20' },
    ])
    expect(sortiert.map((x) => x.run.id)).toEqual([b.id, a.id, c.id])
  })
})

/* ============================================ Fassungen je Gerät */

describe('durchgaengeJeGeraet', () => {
  /** Eine Kür mit zwei Elementen, ihre Fassung und ein Durchgang darauf. */
  const aufbau = () => {
    const e1 = element({ name: 'A' })
    const e2 = element({ name: 'B' })
    const k = kuer({})
    const verkn = [platz(k.id, e1.id, 1), platz(k.id, e2.id, 2)]
    const v = fassung(k, verkn, [e1, e2])
    return { e1, e2, k, verkn, v }
  }

  const rechne = (o: {
    runs: GymRoutineRun[]
    versionen: GymRoutineVersion[]
    kueren: GymRoutine[]
    verkn: GymRoutineElement[]
    elemente: GymElement[]
    einheiten?: any[]
  }) => durchgaengeJeGeraet({
    runs: o.runs,
    versionen: o.versionen,
    einheiten: o.einheiten ?? [einheit('s1', '2026-05-20'), einheit('s2', '2026-05-26')],
    kueren: o.kueren,
    kuerVerknuepfungen: o.verkn,
    elemente: o.elemente,
    heute: HEUTE,
    tagDifferenz: diffDays,
  })

  it('rechnet die Fassungs-ID aus dem jetzigen Inhalt der Kür', () => {
    const { k, verkn, v, e1, e2 } = aufbau()
    const m = rechne({ runs: [], versionen: [v], kueren: [k], verkn, elemente: [e1, e2] })
    expect(m.get('boden')?.fassungId).toBe(v.id)
  })

  it('zählt die Durchgänge der aktuellen Fassung', () => {
    const { k, verkn, v, e1, e2 } = aufbau()
    const runs = [
      run({ sessionId: 's1', versionId: v.id }),
      run({ sessionId: 's1', versionId: v.id, sort: 1 }),
      run({ sessionId: 's2', versionId: v.id, completed: false }),
    ]
    const g = rechne({ runs, versionen: [v], kueren: [k], verkn, elemente: [e1, e2] }).get('boden')!
    expect(g.aktuell.durchgaenge).toBe(3)
    expect(g.aktuell.komplett).toBe(2)
    expect(g.verlauf).toHaveLength(3)
  })

  it('mehrere Durchgänge derselben Kür in derselben Einheit sind der Normalfall', () => {
    const { k, verkn, v, e1, e2 } = aufbau()
    const runs = [
      run({ sessionId: 's1', versionId: v.id, sort: 0 }),
      run({ sessionId: 's1', versionId: v.id, sort: 1 }),
      run({ sessionId: 's1', versionId: v.id, sort: 2 }),
    ]
    const g = rechne({ runs, versionen: [v], kueren: [k], verkn, elemente: [e1, e2] }).get('boden')!
    expect(g.aktuell.durchgaenge).toBe(3)
    expect(new Set(runs.map((r) => r.id)).size).toBe(3)
  })

  it('trennt mehrere Geräte in derselben Einheit', () => {
    const eB = element({ name: 'Boden A', apparatus: 'boden' })
    const eR = element({ name: 'Reck A', apparatus: 'reck' })
    const kB = kuer({ apparatus: 'boden', name: 'Bodenkür' })
    const kR = kuer({ apparatus: 'reck', name: 'Reckkür' })
    const verkn = [platz(kB.id, eB.id, 1), platz(kR.id, eR.id, 1)]
    const vB = fassung(kB, verkn, [eB, eR])
    const vR = fassung(kR, verkn, [eB, eR])
    const runs = [
      run({ sessionId: 's1', versionId: vB.id, sort: 0 }),
      run({ sessionId: 's1', versionId: vB.id, sort: 1 }),
      run({ sessionId: 's1', versionId: vR.id, sort: 2 }),
    ]
    const m = rechne({
      runs, versionen: [vB, vR], kueren: [kB, kR], verkn, elemente: [eB, eR],
    })
    expect(m.get('boden')?.aktuell.durchgaenge).toBe(2)
    expect(m.get('reck')?.aktuell.durchgaenge).toBe(1)
  })

  /* ----------------------------------------- Der eigentliche Prüfgegenstand */

  it('hält Durchgänge einer FRÜHEREN Fassung getrennt, wenn die Kür geändert wird', () => {
    const e1 = element({ name: 'A' })
    const e2 = element({ name: 'B' })
    const e3 = element({ name: 'C – neu dazu' })
    const k = kuer({})

    // Fassung 1: A und B. Darauf drei Durchgaenge.
    const verknAlt = [platz(k.id, e1.id, 1), platz(k.id, e2.id, 2)]
    const vAlt = fassung(k, verknAlt, [e1, e2, e3])
    const alteRuns = [
      run({ sessionId: 's1', versionId: vAlt.id, sort: 0 }),
      run({ sessionId: 's1', versionId: vAlt.id, sort: 1 }),
      run({ sessionId: 's1', versionId: vAlt.id, sort: 2 }),
    ]

    // Jetzt kommt C dazu: die LEBENDE Kuer hat drei Plaetze.
    const verknNeu = [...verknAlt, platz(k.id, e3.id, 3)]
    const vNeu = fassung(k, verknNeu, [e1, e2, e3])
    expect(vNeu.id).not.toBe(vAlt.id)

    const g = rechne({
      runs: alteRuns, versionen: [vAlt, vNeu], kueren: [k],
      verkn: verknNeu, elemente: [e1, e2, e3],
    }).get('boden')!

    // Die aktuelle Fassung hat noch keinen Durchgang - die alten zaehlen NICHT
    // mit, weil die Kuer jetzt eine andere Uebung ist.
    expect(g.fassungId).toBe(vNeu.id)
    expect(g.aktuell.durchgaenge).toBe(0)
    expect(g.aktuell.lage).toBe('zu_wenig_daten')
    expect(g.fruehere).toEqual({ durchgaenge: 3, fassungen: 1 })
  })

  it('lässt die alten Durchgänge unverändert – sie zeigen weiter auf ihre Fassung', () => {
    const e1 = element({ name: 'A' })
    const k = kuer({})
    const verknAlt = [platz(k.id, e1.id, 1)]
    const vAlt = fassung(k, verknAlt, [e1])
    const r = run({ sessionId: 's1', versionId: vAlt.id })

    const e2 = element({ name: 'B' })
    const verknNeu = [...verknAlt, platz(k.id, e2.id, 2)]
    rechne({
      runs: [r], versionen: [vAlt], kueren: [k], verkn: verknNeu, elemente: [e1, e2],
    })
    // Kein Seiteneffekt: Die Zeile selbst ist unberuehrt.
    expect(r.routine_version_id).toBe(vAlt.id)
  })

  it('zählt mehrere frühere Fassungen als solche', () => {
    const e1 = element({ name: 'A' })
    const e2 = element({ name: 'B' })
    const e3 = element({ name: 'C' })
    const k = kuer({})
    const v1 = fassung(k, [platz(k.id, e1.id, 1)], [e1, e2, e3])
    const v2 = fassung(k, [platz(k.id, e1.id, 1), platz(k.id, e2.id, 2)], [e1, e2, e3])
    const verknJetzt = [platz(k.id, e1.id, 1), platz(k.id, e2.id, 2), platz(k.id, e3.id, 3)]
    const v3 = fassung(k, verknJetzt, [e1, e2, e3])

    const g = rechne({
      runs: [
        run({ sessionId: 's1', versionId: v1.id }),
        run({ sessionId: 's1', versionId: v2.id, sort: 1 }),
        run({ sessionId: 's2', versionId: v3.id }),
      ],
      versionen: [v1, v2, v3], kueren: [k], verkn: verknJetzt, elemente: [e1, e2, e3],
    }).get('boden')!
    expect(g.fassungId).toBe(v3.id)
    expect(g.aktuell.durchgaenge).toBe(1)
    expect(g.fruehere).toEqual({ durchgaenge: 2, fassungen: 2 })
  })

  it('zählt Fassungen einer ANDEREN Kür nicht als frühere Fassung', () => {
    const e1 = element({ name: 'A' })
    const kA = kuer({ name: 'Kür A' })
    const kB = kuer({ name: 'Kür B', seit: null })   // keine Wettkampfkür
    const verkn = [platz(kA.id, e1.id, 1), platz(kB.id, e1.id, 1)]
    const vA = fassung(kA, verkn, [e1])
    const vB = fassung(kB, verkn, [e1])
    const g = rechne({
      runs: [run({ sessionId: 's1', versionId: vB.id })],
      versionen: [vA, vB], kueren: [kA, kB], verkn, elemente: [e1],
    }).get('boden')!
    expect(g.kuer?.id).toBe(kA.id)
    expect(g.aktuell.durchgaenge).toBe(0)
    expect(g.fruehere.durchgaenge).toBe(0)
  })

  it('kommt ohne aktive Wettkampfkür ohne Fassung aus', () => {
    const e1 = element({ name: 'A' })
    const k = kuer({ seit: null })
    const verkn = [platz(k.id, e1.id, 1)]
    const g = rechne({ runs: [], versionen: [], kueren: [k], verkn, elemente: [e1] }).get('boden')!
    expect(g.kuer).toBeNull()
    expect(g.fassungId).toBeNull()
    expect(g.aktuell.durchgaenge).toBe(0)
  })

  it('zeigt die Historie auch dann, wenn die lebende Kür gelöscht wurde', () => {
    const e1 = element({ name: 'A' })
    const k = kuer({})
    const verkn = [platz(k.id, e1.id, 1)]
    const v = fassung(k, verkn, [e1])
    const runs = [
      run({ sessionId: 's1', versionId: v.id, sort: 0 }),
      run({ sessionId: 's1', versionId: v.id, sort: 1 }),
      run({ sessionId: 's1', versionId: v.id, sort: 2 }),
    ]
    const weg = { ...k, deleted_at: '2026-05-25T00:00:00.000Z' } as GymRoutine

    // Ohne lebende Kuer gibt es keine "aktuelle Fassung" - die Durchgaenge
    // selbst sind aber nicht verschwunden.
    const g = rechne({ runs, versionen: [v], kueren: [weg], verkn, elemente: [e1] }).get('boden')!
    expect(g.kuer).toBeNull()
    expect(g.fassungId).toBeNull()
    const roh = imFenster(
      durchgaengeMitTag(runs, [einheit('s1', '2026-05-20')]), HEUTE, diffDays)
    expect(roh).toHaveLength(3)
    expect(durchgangsBild(roh, HEUTE, diffDays).lage).toBe('stabil')
  })

  it('funktioniert weiter, wenn ein Element der Kür später gelöscht wird', () => {
    const e1 = element({ name: 'A' })
    const e2 = element({ name: 'B' })
    const k = kuer({})
    const verkn = [platz(k.id, e1.id, 1), platz(k.id, e2.id, 2)]
    const vAlt = fassung(k, verkn, [e1, e2])
    const runs = [
      run({ sessionId: 's1', versionId: vAlt.id, sort: 0 }),
      run({ sessionId: 's1', versionId: vAlt.id, sort: 1 }),
      run({ sessionId: 's1', versionId: vAlt.id, sort: 2 }),
    ]

    // e2 wird geloescht: Der Kuerplatz bleibt und heisst "Geloeschtes Element",
    // die Fassung des JETZIGEN Zustands ist damit eine andere.
    const g = rechne({
      runs, versionen: [vAlt], kueren: [k], verkn, elemente: [e1],
    }).get('boden')!
    expect(g.fassungId).not.toBe(vAlt.id)
    expect(g.aktuell.durchgaenge).toBe(0)
    expect(g.fruehere.durchgaenge).toBe(3)
  })

  it('lässt Durchgänge ausserhalb des Fensters aus der Auswertung', () => {
    const e1 = element({ name: 'A' })
    const k = kuer({})
    const verkn = [platz(k.id, e1.id, 1)]
    const v = fassung(k, verkn, [e1])
    const g = rechne({
      runs: [
        run({ sessionId: 'alt', versionId: v.id }),
        run({ sessionId: 's1', versionId: v.id, sort: 1 }),
      ],
      versionen: [v], kueren: [k], verkn, elemente: [e1],
      einheiten: [einheit('alt', '2026-01-05'), einheit('s1', '2026-05-20')],
    }).get('boden')!
    expect(g.aktuell.durchgaenge).toBe(1)
  })

  it('liefert für jedes Gerät einen Eintrag, auch ohne Kür', () => {
    const m = rechne({ runs: [], versionen: [], kueren: [], verkn: [], elemente: [] })
    expect([...m.keys()].sort()).toEqual(
      ['barren', 'boden', 'pauschenpferd', 'reck', 'ringe', 'sprung'])
  })
})

/* ================================================= Wettkampf bleibt Wettkampf */

describe('Ein Wettkampfergebnis ist kein Trainingsdurchgang', () => {
  it('erzeugt aus einem Wettkampfergebnis keinen Durchgang', () => {
    // Geprueft am Quelltext: Nichts in diesem Modul liest gym_results oder
    // gym_competitions. Waere es anders, entstuende aus einem Wettkampf ein
    // Trainingsdurchgang - und die Kuerstabilitaet waere mit Wettkampfdaten
    // vermischt.
    const quelle = readFileSync(
      new URL('../src/core/turnen/kuerdurchgaenge.ts', import.meta.url), 'utf8')
    const code = quelle.split(/\r?\n/)
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')
    expect(code).not.toMatch(/GymResult|gym_results/)
    expect(code).not.toMatch(/GymCompetition|gym_competitions/)
  })

  it('erzeugt aus einem Durchgang keine Elementversuche', () => {
    const quelle = readFileSync(
      new URL('../src/core/turnen/kuerdurchgaenge.ts', import.meta.url), 'utf8')
    const code = quelle.split(/\r?\n/)
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')
    expect(code).not.toMatch(/GymAttempt|gym_attempts/)
  })
})

/* ====================================================== Speichern planen */

describe('planeDurchgaenge', () => {
  const vorhanden = (n: number, versionId = 'v1') =>
    Array.from({ length: n }, (_, i) =>
      run({ sessionId: 's1', versionId, sort: i }))

  const stand = (r: GymRoutineRun): DurchgangsStand =>
    ({ id: r.id, versionId: r.routine_version_id, eingabe: eingabeAus(r) })

  it('legt einen neuen Durchgang ohne ID an', () => {
    const plan = planeDurchgaenge(
      [{ id: null, versionId: 'v1', eingabe: leereEingabe() }], [])
    expect(plan.anlegen).toHaveLength(1)
    expect(plan.anlegen[0].values.routine_version_id).toBe('v1')
    expect((plan.anlegen[0] as any).id).toBeUndefined()
  })

  it('schreibt beim zweiten Speichern nichts', () => {
    const da = vorhanden(2)
    const plan = planeDurchgaenge(da.map(stand), da)
    expect(planIstLeer(plan)).toBe(true)
  })

  it('erkennt eine Änderung an den Zahlen', () => {
    const da = vorhanden(1)
    const geaendert = [{ ...stand(da[0]), eingabe: { ...eingabeAus(da[0]), falls: 2 } }]
    const plan = planeDurchgaenge(geaendert, da)
    expect(plan.aendern).toHaveLength(1)
    expect(plan.aendern[0].patch.falls).toBe(2)
  })

  it('entfernt einen aus der Liste genommenen Durchgang', () => {
    const da = vorhanden(3)
    const plan = planeDurchgaenge([stand(da[0]), stand(da[2])], da)
    expect(plan.entfernen).toEqual([da[1].id])
  })

  it('vergibt sort_order nach der Reihenfolge in der Liste', () => {
    const plan = planeDurchgaenge([
      { id: null, versionId: 'v1', eingabe: leereEingabe() },
      { id: null, versionId: 'v1', eingabe: leereEingabe() },
    ], [])
    expect(plan.anlegen.map((a) => a.values.sort_order)).toEqual([0, 1])
  })

  it('behält bei einer vorhandenen Zeile deren Fassung', () => {
    const da = vorhanden(1, 'alteFassung')
    const plan = planeDurchgaenge(da.map(stand), da)
    expect(planIstLeer(plan)).toBe(true)
    expect(da[0].routine_version_id).toBe('alteFassung')
  })

  it('übergeht eine gelöschte Zeile und legt sie neu an', () => {
    const da = vorhanden(1).map((r) => ({ ...r, deleted_at: 'x' }) as GymRoutineRun)
    const plan = planeDurchgaenge(da.map(stand), da)
    expect(plan.anlegen).toHaveLength(1)
    expect(plan.entfernen).toHaveLength(0)
  })
})

describe('werteAus', () => {
  it('schreibt Wahrheitswerte als 0 und 1', () => {
    const w = werteAus('s1', 'v1', {
      completed: true, falls: 1, interruptions: 2, withHelp: true,
      quality: 'gut', note: '  Abgang kurz  ',
    }, 3)
    expect(w).toMatchObject({
      session_id: 's1', routine_version_id: 'v1',
      completed: 1, falls: 1, interruptions: 2, with_help: 1,
      quality: 'gut', note: 'Abgang kurz', sort_order: 3,
    })
  })

  it('macht aus einer leeren Notiz null', () => {
    expect(werteAus('s', 'v', { ...leereEingabe(), note: '   ' }, 0).note).toBeNull()
  })

  it('lässt negative Zähler nicht zu', () => {
    const w = werteAus('s', 'v', { ...leereEingabe(), falls: -3, interruptions: -1 }, 0)
    expect(w.falls).toBe(0)
    expect(w.interruptions).toBe(0)
  })

  it('ist mit eingabeAus umkehrbar', () => {
    const r = run({ sessionId: 's', versionId: 'v', falls: 2, interruptions: 1, hilfe: true, quality: 'schlecht' })
    const w = werteAus('s', 'v', eingabeAus(r), 0)
    expect(w).toMatchObject({
      completed: 1, falls: 2, interruptions: 1, with_help: 1, quality: 'schlecht',
    })
  })

  it('legt einen Durchgang als komplett vor – der Normalfall', () => {
    expect(leereEingabe().completed).toBe(true)
  })
})

/* ============================================================ Leistung */

/**
 * Der Durchgangsteil muss einen echten Bestand in einem Durchgang schaffen.
 *
 * Gemessen wird der Aufruf, den die Oberfläche macht. Die Schwelle ist
 * grosszügig: Sie soll eine Regression fangen, die je Gerät erneut über alle
 * Durchgänge läuft.
 */
describe('Leistung', () => {
  const GERAETE_KEYS = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']
  const ELEMENTE = 100
  const DURCHGAENGE = 1000

  const vieleElemente: GymElement[] = []
  for (let i = 0; i < ELEMENTE; i++) {
    vieleElemente.push(element({
      name: `Element ${i}`, apparatus: GERAETE_KEYS[i % 6], wert: 0.1 + (i % 9) * 0.1,
    }))
  }

  const kueren: GymRoutine[] = []
  const verkn: GymRoutineElement[] = []
  for (const apparatus of GERAETE_KEYS) {
    const k = kuer({ apparatus, name: `Kür ${apparatus}` })
    kueren.push(k)
    const eigene = vieleElemente.filter((x) => x.apparatus === apparatus).slice(0, 8)
    for (const [pos, el] of eigene.entries()) verkn.push(platz(k.id, el.id, pos + 1))
  }
  const versionen = kueren.map((k) => fassung(k, verkn, vieleElemente))

  const einheiten: any[] = []
  const runs: GymRoutineRun[] = []
  for (let i = 0; i < DURCHGAENGE; i++) {
    const sid = `sess-${Math.floor(i / 4)}`
    if (i % 4 === 0) {
      einheiten.push(einheit(sid, `2026-0${(i % 5) + 1}-${String((i % 28) + 1).padStart(2, '0')}`))
    }
    runs.push(run({
      sessionId: sid,
      versionId: versionen[i % versionen.length].id,
      completed: i % 5 !== 0,
      falls: i % 7 === 0 ? 1 : 0,
      sort: i % 4,
    }))
  }

  it('hat den erwarteten Bestand', () => {
    expect(vieleElemente).toHaveLength(100)
    expect(runs).toHaveLength(1000)
    expect(versionen).toHaveLength(6)
  })

  it('rechnet 1.000 Durchgänge in einem Durchgang unter 150 ms', () => {
    const t0 = performance.now()
    const m = durchgaengeJeGeraet({
      runs, versionen, einheiten, kueren, kuerVerknuepfungen: verkn,
      elemente: vieleElemente, heute: HEUTE, tagDifferenz: diffDays,
    })
    const dauer = performance.now() - t0
    expect(m.size).toBe(6)
    // eslint-disable-next-line no-console
    console.log(`  durchgaengeJeGeraet(): ${dauer.toFixed(1)} ms für 1.000 Durchgänge, `
      + `100 Elemente, 6 Küren`)
    expect(dauer).toBeLessThan(150)
  })

  it('gruppiert einmal – Kosten wachsen nicht je Gerät', () => {
    const einmal = (n: number) => {
      const teil = runs.slice(0, n)
      const t0 = performance.now()
      durchgaengeJeGeraet({
        runs: teil, versionen, einheiten, kueren, kuerVerknuepfungen: verkn,
        elemente: vieleElemente, heute: HEUTE, tagDifferenz: diffDays,
      })
      return performance.now() - t0
    }
    // Der schnellste von fuenf Laeufen - ein Einzellauf schwankt unter einer
    // Millisekunde um mehr als die Aussage selbst.
    const messe = (n: number) => {
      let beste = Infinity
      for (let i = 0; i < 5; i++) beste = Math.min(beste, einmal(n))
      return beste
    }
    messe(100)
    const klein = Math.max(messe(100), 0.05)
    const gross = messe(1000)
    // Zehnmal so viele Durchgaenge duerfen nicht hundertmal so lange dauern.
    expect(gross / klein).toBeLessThan(40)
  })
})
