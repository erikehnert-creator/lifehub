/**
 * Wettkämpfe und eingefrorene Kürfassungen.
 *
 * Vier Dinge stehen hier im Mittelpunkt, weil sie sonst still schiefgehen:
 *
 *   1. Eine historische Fassung darf sich NIE ändern. Wird die Kür bearbeitet,
 *      ein Element umbenannt, archiviert oder gelöscht, muss der alte
 *      Wettkampf Zeichen für Zeichen dasselbe zeigen. Das ist der eigentliche
 *      Prüfgegenstand dieser Datei.
 *   2. Fehlende Noten bleiben `null`. Nirgends eine 0, nirgends eine Lücke,
 *      die als Einbruch aussieht.
 *   3. LifeHub rechnet keine Endnote aus. Die Plausibilitätsangabe ist eine
 *      Gegenüberstellung, kein Urteil, und blockiert nichts.
 *   4. Zweimal dasselbe speichern fasst keine Zeile an.
 */
import { describe, it, expect } from 'vitest'
import {
  leseNote, formatNote, lesePlatz, ergebnisId, leereEingabe, eingabeAus, werteAus,
  eingabeIstLeer, planeErgebnisse, planIstLeer, plausibilitaet,
  wettkampfBild, verlauf, geraetBilanzen, naechsterUndLetzter,
  MINDEST_GERAETE_FUER_MARKE, MINDESTPUNKTE_LINIE,
  type ErgebnisEingabe,
} from '../src/core/turnen/wettkampf'
import {
  fassungsInhalt, fassungsId, fassungsPlatzId, planeFassung,
  fassungsPlaetze, fassungsLabel, fassungIstAktuell,
} from '../src/core/turnen/fassungen'
import { schwierigkeitAus } from '../src/core/turnen/kueren'
import type {
  GymElement, GymRoutine, GymRoutineElement, GymRoutineVersion,
  GymRoutineVersionElement, GymCompetition, GymResult,
} from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 't', server_rev: null,
}

const el = (id: string, name: string, opt: Partial<GymElement> = {}): GymElement => ({
  ...basis, id, apparatus: 'reck', name,
  difficulty_letter: null, difficulty_value: null, element_group: null,
  is_dismount: 0, hold_element: 0, status: 'sicher', video_url: null, note: null,
  is_active: 1, sort_order: 0, ...opt,
} as GymElement)

const verk = (id: string, routine: string, element: string, position: number,
  opt: Partial<GymRoutineElement> = {}): GymRoutineElement => ({
  ...basis, id, routine_id: routine, element_id: element, position, note: null, ...opt,
} as GymRoutineElement)

const kuer = (id: string, name: string, opt: Partial<GymRoutine> = {}): GymRoutine => ({
  ...basis, id, apparatus: 'reck', name, note: null,
  competition_since: null, is_active: 1, ...opt,
} as GymRoutine)

const wk = (id: string, day: string, name: string, opt: Partial<GymCompetition> = {}): GymCompetition => ({
  ...basis, id, day, name, location: null, class_name: null,
  rank_allround: null, score_allround: null, protocol_url: null, note: null, ...opt,
} as GymCompetition)

const erg = (id: string, competition: string, apparatus: string,
  opt: Partial<GymResult> = {}): GymResult => ({
  ...basis, id, competition_id: competition, apparatus, routine_version_id: null,
  d_score: null, e_score: null, penalty: null, final_score: null,
  rank_apparatus: null, note: null, ...opt,
} as GymResult)

const eingabe = (apparatus: string, opt: Partial<ErgebnisEingabe> = {}): ErgebnisEingabe =>
  ({ ...leereEingabe(apparatus), ...opt })

/* ========================================================= Noten lesen */

describe('Noten lesen und schreiben', () => {
  it('nimmt Komma wie Punkt', () => {
    expect(leseNote('13,25')).toBe(13.25)
    expect(leseNote('13.25')).toBe(13.25)
  })

  it('macht aus einem leeren Feld null und nicht 0', () => {
    expect(leseNote('')).toBeNull()
    expect(leseNote('   ')).toBeNull()
    expect(leseNote(null)).toBeNull()
    expect(leseNote(undefined)).toBeNull()
  })

  it('weist Unsinn zurück, statt 0 daraus zu machen', () => {
    expect(leseNote('keine')).toBeNull()
    expect(leseNote('--')).toBeNull()
  })

  it('nimmt eine echte 0 als 0', () => {
    expect(leseNote('0')).toBe(0)
    expect(leseNote('0,0')).toBe(0)
  })

  it('zeigt eine fehlende Note als Strich', () => {
    expect(formatNote(null)).toBe('—')
    expect(formatNote(undefined)).toBe('—')
  })

  it('kürzt Nachkommastellen, behält aber eine', () => {
    expect(formatNote(13.25)).toBe('13,25')
    expect(formatNote(13)).toBe('13,0')
    expect(formatNote(13.256)).toBe('13,256')
    expect(formatNote(13.2)).toBe('13,2')
    expect(formatNote(0)).toBe('0,0')
  })

  it('rundet eine Platzierung auf eine ganze Zahl', () => {
    // PostgreSQL weist eine Kommazahl in einer integer-Spalte ab und damit
    // den Push der ganzen Tabelle.
    expect(lesePlatz('3')).toBe(3)
    expect(lesePlatz('3,4')).toBe(3)
    expect(lesePlatz('')).toBeNull()
    expect(Number.isInteger(lesePlatz('2,7'))).toBe(true)
  })
})

/* ================================================ Eingefrorene Fassung */

describe('Kürfassung einfrieren', () => {
  const kippe = el('e1', 'Kippe', { difficulty_letter: 'A', difficulty_value: 0.1, element_group: 1 })
  const riese = el('e2', 'Riesenfelge', { difficulty_letter: 'B', difficulty_value: 0.2, element_group: 2 })
  const abgang = el('e3', 'Salto rückwärts', { difficulty_letter: 'C', difficulty_value: 0.3, is_dismount: 1 })
  const elemente = [kippe, riese, abgang]
  const k = kuer('k1', 'Reckkür')
  const verkn = [verk('v1', 'k1', 'e1', 0), verk('v2', 'k1', 'e2', 1), verk('v3', 'k1', 'e3', 2)]

  it('hält Name, Schwierigkeit, Gruppe, Abgang und Reihenfolge fest', () => {
    const inhalt = fassungsInhalt(k, verkn, elemente)
    expect(inhalt.apparatus).toBe('reck')
    expect(inhalt.name).toBe('Reckkür')
    expect(inhalt.plaetze).toEqual([
      { position: 0, element_id: 'e1', name: 'Kippe', difficulty_letter: 'A', difficulty_value: 0.1, element_group: 1, is_dismount: 0 },
      { position: 1, element_id: 'e2', name: 'Riesenfelge', difficulty_letter: 'B', difficulty_value: 0.2, element_group: 2, is_dismount: 0 },
      { position: 2, element_id: 'e3', name: 'Salto rückwärts', difficulty_letter: 'C', difficulty_value: 0.3, element_group: null, is_dismount: 1 },
    ])
  })

  it('friert den Status NICHT ein – er beschreibt den Turner, nicht die Übung', () => {
    const inhalt = fassungsInhalt(k, verkn, elemente)
    for (const p of inhalt.plaetze) {
      expect(Object.keys(p)).not.toContain('status')
      expect(Object.keys(p)).not.toContain('video_url')
    }
  })

  it('vergibt die Position lückenlos neu', () => {
    // In der lebenden Kuer darf position Luecken und Dubletten haben.
    const krumm = [verk('v1', 'k1', 'e1', 5), verk('v2', 'k1', 'e2', 5), verk('v3', 'k1', 'e3', 9)]
    const inhalt = fassungsInhalt(k, krumm, elemente)
    expect(inhalt.plaetze.map((p) => p.position)).toEqual([0, 1, 2])
  })

  it('behält den Platz eines gelöschten Elements', () => {
    const inhalt = fassungsInhalt(k, [...verkn, verk('v9', 'k1', 'weg', 3)], elemente)
    expect(inhalt.plaetze).toHaveLength(4)
    expect(inhalt.plaetze[3].name).toBe('Gelöschtes Element')
    expect(inhalt.plaetze[3].difficulty_value).toBeNull()
  })

  it('ergibt für denselben Inhalt dieselbe ID', () => {
    const a = fassungsId(fassungsInhalt(k, verkn, elemente))
    const b = fassungsId(fassungsInhalt(k, [...verkn].reverse(), elemente))
    expect(a).toBe(b)
  })

  it('ergibt für eine andere Reihenfolge eine andere ID', () => {
    const gedreht = [verk('v1', 'k1', 'e1', 2), verk('v2', 'k1', 'e2', 1), verk('v3', 'k1', 'e3', 0)]
    expect(fassungsId(fassungsInhalt(k, verkn, elemente)))
      .not.toBe(fassungsId(fassungsInhalt(k, gedreht, elemente)))
  })

  it('ergibt nach einem Umbenennen eine andere ID', () => {
    const umbenannt = [{ ...kippe, name: 'Kippe aus dem Hang' }, riese, abgang]
    expect(fassungsId(fassungsInhalt(k, verkn, elemente)))
      .not.toBe(fassungsId(fassungsInhalt(k, verkn, umbenannt)))
  })

  it('ergibt nach einer geänderten Schwierigkeit eine andere ID', () => {
    const anders = [{ ...kippe, difficulty_value: 0.2 }, riese, abgang]
    expect(fassungsId(fassungsInhalt(k, verkn, elemente)))
      .not.toBe(fassungsId(fassungsInhalt(k, verkn, anders)))
  })

  it('ändert sich NICHT, wenn nur der Status eines Elements wechselt', () => {
    const unsicher = [{ ...kippe, status: 'unsicher' }, riese, abgang]
    expect(fassungsId(fassungsInhalt(k, verkn, elemente)))
      .toBe(fassungsId(fassungsInhalt(k, verkn, unsicher)))
  })

  it('ändert sich NICHT, wenn nur eine Arbeitsnotiz am Kürplatz wechselt', () => {
    const mitNotiz = [{ ...verkn[0], note: 'Absprung beachten' }, verkn[1], verkn[2]]
    expect(fassungsId(fassungsInhalt(k, verkn, elemente)))
      .toBe(fassungsId(fassungsInhalt(k, mitNotiz, elemente)))
  })
})

describe('planeFassung', () => {
  const e1 = el('e1', 'Kippe', { difficulty_value: 0.1 })
  const k = kuer('k1', 'Reckkür')
  const verkn = [verk('v1', 'k1', 'e1', 0)]
  const inhalt = fassungsInhalt(k, verkn, [e1])

  it('legt eine neue Fassung mit ihren Plätzen an', () => {
    const plan = planeFassung(inhalt, [], '2026-10-04T12:00:00Z')
    expect(plan.version).not.toBeNull()
    expect(plan.version!.id).toBe(plan.id)
    expect(plan.version!.values).toMatchObject({
      routine_id: 'k1', apparatus: 'reck', name: 'Reckkür', frozen_at: '2026-10-04T12:00:00Z',
    })
    expect(plan.plaetze).toHaveLength(1)
    expect(plan.plaetze[0].id).toBe(fassungsPlatzId(plan.id, 0))
  })

  it('schreibt nichts, wenn es die Fassung schon gibt', () => {
    const id = fassungsId(inhalt)
    const da: GymRoutineVersion = {
      ...basis, id, routine_id: 'k1', apparatus: 'reck', name: 'Reckkür',
      frozen_at: '2026-10-04T12:00:00Z',
    } as GymRoutineVersion
    const plan = planeFassung(inhalt, [da], '2026-12-01T12:00:00Z')
    expect(plan.id).toBe(id)
    expect(plan.version).toBeNull()
    expect(plan.plaetze).toHaveLength(0)
  })

  it('erzeugt auf zwei Geräten dieselbe Fassung', () => {
    const pc = planeFassung(inhalt, [], '2026-10-04T12:00:00Z')
    const handy = planeFassung(inhalt, [], '2026-10-04T18:30:00Z')
    expect(pc.id).toBe(handy.id)
    expect(pc.plaetze[0].id).toBe(handy.plaetze[0].id)
  })
})

/* ============================================ Historie bleibt stabil */

describe('Die Historie bleibt unberührt', () => {
  const kippe = el('e1', 'Kippe', { difficulty_letter: 'A', difficulty_value: 0.1 })
  const riese = el('e2', 'Riesenfelge', { difficulty_letter: 'B', difficulty_value: 0.2 })
  const k = kuer('k1', 'Reckkür')
  const verkn = [verk('v1', 'k1', 'e1', 0), verk('v2', 'k1', 'e2', 1)]

  /** Die Oktoberfassung – einmal eingefroren, danach unantastbar. */
  const oktober = planeFassung(fassungsInhalt(k, verkn, [kippe, riese]), [], '2026-10-04T12:00:00Z')
  const versionZeile: GymRoutineVersion = {
    ...basis, id: oktober.id, ...oktober.version!.values,
  } as GymRoutineVersion
  const platzZeilen: GymRoutineVersionElement[] = oktober.plaetze.map((p) => ({
    ...basis, id: p.id, ...p.values,
  })) as GymRoutineVersionElement[]

  it('zeigt die Fassung mit Reihenfolge und Schwierigkeit', () => {
    const plaetze = fassungsPlaetze(oktober.id, platzZeilen)
    expect(plaetze.map((p) => p.name)).toEqual(['Kippe', 'Riesenfelge'])
    expect(plaetze.map((p) => p.position)).toEqual([0, 1])
  })

  it('rechnet dieselbe Schwierigkeitssumme wie die lebende Kür', () => {
    const plaetze = fassungsPlaetze(oktober.id, platzZeilen)
    expect(schwierigkeitAus(plaetze).summe).toBe(0.3)
    expect(schwierigkeitAus(plaetze).vollstaendig).toBe(true)
  })

  it('bleibt unverändert, wenn die Kür im Dezember geändert wird', () => {
    // Die Kuer bekommt ein drittes Element und ein neues erstes.
    const neu = el('e3', 'Tkatchev', { difficulty_letter: 'D', difficulty_value: 0.4 })
    const dezember = [verk('v0', 'k1', 'e3', 0), ...verkn]
    const nachher = planeFassung(
      fassungsInhalt(k, dezember, [kippe, riese, neu]), [versionZeile], '2026-12-20T12:00:00Z')

    // Eine ANDERE Fassung - die Oktoberzeilen sind nicht angefasst worden.
    expect(nachher.id).not.toBe(oktober.id)
    expect(nachher.version).not.toBeNull()

    const alt = fassungsPlaetze(oktober.id, platzZeilen)
    expect(alt.map((p) => p.name)).toEqual(['Kippe', 'Riesenfelge'])
    expect(schwierigkeitAus(alt).summe).toBe(0.3)
  })

  it('bleibt unverändert, wenn ein Element umbenannt wird', () => {
    const umbenannt = [{ ...kippe, name: 'Kippe aus dem Hang' }, riese]
    // Die lebende Kuer zeigt den neuen Namen ...
    expect(fassungsInhalt(k, verkn, umbenannt).plaetze[0].name).toBe('Kippe aus dem Hang')
    // ... die eingefrorene Fassung den alten.
    expect(fassungsPlaetze(oktober.id, platzZeilen)[0].name).toBe('Kippe')
  })

  it('bleibt lesbar, wenn ein Element gelöscht wird', () => {
    // Der Elementkatalog kennt e1 nicht mehr.
    const ohne = [riese]
    expect(fassungsInhalt(k, verkn, ohne).plaetze[0].name).toBe('Gelöschtes Element')
    // Die Fassung traegt ihre eigene Kopie und bleibt vollstaendig.
    const alt = fassungsPlaetze(oktober.id, platzZeilen)
    expect(alt.map((p) => p.name)).toEqual(['Kippe', 'Riesenfelge'])
    expect(alt[0].difficulty_value).toBe(0.1)
  })

  it('bleibt lesbar, wenn die ganze Kür gelöscht wird', () => {
    const geloescht = { ...k, deleted_at: '2027-01-01T00:00:00Z' }
    expect(fassungIstAktuell(versionZeile, geloescht, verkn, [kippe, riese])).toBe(false)
    // Die Fassung selbst haengt nicht an der Kuer.
    expect(fassungsPlaetze(oktober.id, platzZeilen)).toHaveLength(2)
    expect(versionZeile.name).toBe('Reckkür')
  })

  it('erkennt, ob die lebende Kür noch dieser Fassung entspricht', () => {
    expect(fassungIstAktuell(versionZeile, k, verkn, [kippe, riese])).toBe(true)
    // Die Reihenfolge steckt in `position`, nicht in der Reihenfolge des
    // Arrays - eine umgedrehte Liste derselben Zeilen ist KEINE Aenderung.
    expect(fassungIstAktuell(versionZeile, k, [...verkn].reverse(), [kippe, riese])).toBe(true)
    const geaendert = [verk('v1', 'k1', 'e1', 1), verk('v2', 'k1', 'e2', 0)]
    expect(fassungIstAktuell(versionZeile, k, geaendert, [kippe, riese])).toBe(false)
  })

  it('beschriftet eine Fassung mit Namen und Datum', () => {
    expect(fassungsLabel(versionZeile, (t) => t.split('-').reverse().join('.')))
      .toBe('Reckkür · Fassung vom 04.10.2026')
    expect(fassungsLabel(null, (t) => t)).toBe('keine Kür hinterlegt')
  })
})

/* ================================================= Ergebnisse planen */

describe('planeErgebnisse', () => {
  const vorhanden = [
    erg(ergebnisId('w1', 'boden'), 'w1', 'boden', { d_score: 4.2, e_score: 8.1, final_score: 12.3 }),
    erg(ergebnisId('w1', 'reck'), 'w1', 'reck', { d_score: 3.5, e_score: 7.9, final_score: 11.4 }),
  ]
  const wieGehabt = vorhanden.map(eingabeAus)

  it('tut nichts, wenn sich nichts geändert hat', () => {
    expect(planIstLeer(planeErgebnisse('w1', wieGehabt, vorhanden))).toBe(true)
  })

  it('legt ein neues Gerät an, ohne die anderen anzufassen', () => {
    const plan = planeErgebnisse('w1',
      [...wieGehabt, eingabe('barren', { d: '3,0', e: '8,0', final: '11,0' })], vorhanden)
    expect(plan.anlegen).toHaveLength(1)
    expect(plan.anlegen[0].id).toBe(ergebnisId('w1', 'barren'))
    expect(plan.anlegen[0].values).toMatchObject({ d_score: 3, e_score: 8, final_score: 11 })
    expect(plan.aendern).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
  })

  it('legt für ein Gerät ohne jede Angabe KEINE Zeile an', () => {
    const plan = planeErgebnisse('w1', [...wieGehabt, eingabe('ringe')], vorhanden)
    expect(planIstLeer(plan)).toBe(true)
  })

  it('legt eine Zeile an, wenn nur eine Kür hinterlegt ist', () => {
    // "Ich habe die Kuer geturnt, die Noten trage ich nach."
    const plan = planeErgebnisse('w1',
      [...wieGehabt, eingabe('ringe', { versionId: 'f1' })], vorhanden)
    expect(plan.anlegen).toHaveLength(1)
    expect(plan.anlegen[0].values.routine_version_id).toBe('f1')
  })

  it('entfernt ein leergeräumtes Gerät wieder', () => {
    const leer = [{ ...wieGehabt[0], d: '', e: '', final: '', penalty: '', rank: '', note: '' }, wieGehabt[1]]
    const plan = planeErgebnisse('w1', leer, vorhanden)
    expect(plan.entfernen).toEqual([ergebnisId('w1', 'boden')])
  })

  it('entfernt ein Gerät, das aus der Liste genommen wurde', () => {
    const plan = planeErgebnisse('w1', [wieGehabt[0]], vorhanden)
    expect(plan.entfernen).toEqual([ergebnisId('w1', 'reck')])
  })

  it('nimmt eine geänderte Note mit', () => {
    const plan = planeErgebnisse('w1',
      [{ ...wieGehabt[0], e: '8,3', final: '12,5' }, wieGehabt[1]], vorhanden)
    expect(plan.aendern).toEqual([
      { id: ergebnisId('w1', 'boden'), patch: { e_score: 8.3, final_score: 12.5 } },
    ])
  })

  it('erzeugt beim zweiten Speichern keine Dublette', () => {
    const neu = eingabe('barren', { d: '3,0', final: '11,0' })
    const erst = planeErgebnisse('w1', [...wieGehabt, neu], vorhanden)
    expect(erst.anlegen).toHaveLength(1)

    const danach = [...vorhanden,
      erg(erst.anlegen[0].id, 'w1', 'barren', { d_score: 3, final_score: 11 })]
    const nochmal = planeErgebnisse('w1', danach.map(eingabeAus), danach)
    expect(planIstLeer(nochmal)).toBe(true)
  })

  it('verliert beim erneuten Speichern die hinterlegte Fassung nicht', () => {
    const mitFassung = erg(ergebnisId('w2', 'reck'), 'w2', 'reck',
      { routine_version_id: 'f-okt', final_score: 12.1 })
    const zurueck = eingabeAus(mitFassung)
    expect(zurueck.versionId).toBe('f-okt')
    expect(planIstLeer(planeErgebnisse('w2', [zurueck], [mitFassung]))).toBe(true)
  })

  it('lässt die Ergebnisse anderer Wettkämpfe unberührt', () => {
    const fremd = [...vorhanden, erg('x', 'w2', 'boden', { final_score: 9 })]
    expect(planeErgebnisse('w1', wieGehabt, fremd).entfernen).toEqual([])
  })

  it('hält zwei Wettkämpfe am selben Tag auseinander', () => {
    expect(ergebnisId('w1', 'boden')).not.toBe(ergebnisId('w2', 'boden'))
  })

  it('schreibt eine fehlende Note als null und nicht als 0', () => {
    const werte = werteAus('w1', eingabe('boden', { d: '4,2', final: '12,3' }))
    expect(werte.d_score).toBe(4.2)
    expect(werte.e_score).toBeNull()
    expect(werte.penalty).toBeNull()
    expect(werte.rank_apparatus).toBeNull()
  })

  it('erkennt eine leere Eingabe', () => {
    expect(eingabeIstLeer(leereEingabe('boden'))).toBe(true)
    expect(eingabeIstLeer(eingabe('boden', { note: '  ' }))).toBe(true)
    expect(eingabeIstLeer(eingabe('boden', { d: '4,0' }))).toBe(false)
  })
})

/* ==================================================== Plausibilität */

describe('Plausibilität – Gegenüberstellung, kein Urteil', () => {
  it('schweigt, solange nicht alle drei Werte dastehen', () => {
    expect(plausibilitaet(eingabe('boden', { d: '4,2', final: '12,3' }))).toBeNull()
    expect(plausibilitaet(eingabe('boden', { e: '8,1', final: '12,3' }))).toBeNull()
    expect(plausibilitaet(eingabe('boden', { d: '4,2', e: '8,1' }))).toBeNull()
  })

  it('schweigt, wenn die Rechnung aufgeht', () => {
    expect(plausibilitaet(eingabe('boden', { d: '4,2', e: '8,1', final: '12,3' }))).toBeNull()
  })

  it('schweigt auch bei Gleitkomma-Resten', () => {
    expect(plausibilitaet(eingabe('boden', { d: '0,1', e: '0,2', final: '0,3' }))).toBeNull()
  })

  it('rechnet den Abzug mit', () => {
    expect(plausibilitaet(eingabe('boden', { d: '4,2', e: '8,1', penalty: '0,3', final: '12,0' })))
      .toBeNull()
  })

  it('stellt eine Abweichung nebeneinander, ohne ein Urteil zu fällen', () => {
    const text = plausibilitaet(eingabe('boden', { d: '4,2', e: '8,1', final: '12,5' }))
    expect(text).toContain('12,3')
    expect(text).toContain('12,5')
    expect(text).toContain('Beides kann richtig sein')
    // Keine Behauptung, welcher Wert falsch ist.
    expect(text).not.toMatch(/falsch|Fehler|ungültig|korrigiere/i)
  })
})

/* ======================================================= Auswertung */

describe('Wettkampfbild', () => {
  const w = wk('w1', '2026-10-04', 'Bezirksmeisterschaft')

  it('ordnet die Geräte nach Wettkampfreihenfolge', () => {
    const bild = wettkampfBild(w, [
      erg('a', 'w1', 'reck', { final_score: 11.4 }),
      erg('b', 'w1', 'boden', { final_score: 12.3 }),
      erg('c', 'w1', 'barren', { final_score: 11.9 }),
    ])
    expect(bild.ergebnisse.map((r) => r.apparatus)).toEqual(['boden', 'barren', 'reck'])
  })

  it('übergeht gelöschte Ergebnisse und die anderer Wettkämpfe', () => {
    const bild = wettkampfBild(w, [
      erg('a', 'w1', 'boden', { final_score: 12.3 }),
      erg('b', 'w1', 'reck', { final_score: 11.4, deleted_at: '2026-11-01T00:00:00Z' }),
      erg('c', 'w2', 'barren', { final_score: 11.9 }),
    ])
    expect(bild.ergebnisse).toHaveLength(1)
  })

  it('markiert beste und schwächste Note erst ab drei Geräten', () => {
    const zwei = wettkampfBild(w, [
      erg('a', 'w1', 'boden', { final_score: 12.3 }),
      erg('b', 'w1', 'reck', { final_score: 11.4 }),
    ])
    expect(zwei.beste).toBeNull()
    expect(zwei.schwaechste).toBeNull()

    const drei = wettkampfBild(w, [
      erg('a', 'w1', 'boden', { final_score: 12.3 }),
      erg('b', 'w1', 'reck', { final_score: 11.4 }),
      erg('c', 'w1', 'barren', { final_score: 11.9 }),
    ])
    expect(drei.beste).toBe(12.3)
    expect(drei.schwaechste).toBe(11.4)
    expect(drei.mitEndnote).toBe(MINDEST_GERAETE_FUER_MARKE)
  })

  it('zählt ein Gerät ohne Endnote nicht als Note mit', () => {
    const bild = wettkampfBild(w, [
      erg('a', 'w1', 'boden', { final_score: 12.3 }),
      erg('b', 'w1', 'reck', { d_score: 3.5 }),
      erg('c', 'w1', 'barren', { final_score: 11.9 }),
    ])
    expect(bild.ergebnisse).toHaveLength(3)
    expect(bild.mitEndnote).toBe(2)
    expect(bild.beste).toBeNull()
  })
})

describe('Verlauf und Bilanz', () => {
  const wettkaempfe = [
    wk('w1', '2026-03-01', 'Frühjahr'),
    wk('w2', '2026-06-01', 'Sommer'),
    wk('w3', '2026-10-04', 'Herbst'),
  ]
  const ergebnisse = [
    erg('a', 'w3', 'reck', { final_score: 12.5, d_score: 3.8 }),
    erg('b', 'w1', 'reck', { final_score: 11.2, d_score: 3.4 }),
    erg('c', 'w2', 'reck', { d_score: 3.6 }),            // ohne Endnote
    erg('d', 'w1', 'boden', { final_score: 13.0 }),
  ]

  it('ordnet chronologisch', () => {
    expect(verlauf('reck', 'final_score', wettkaempfe, ergebnisse).map((p) => p.day))
      .toEqual(['2026-03-01', '2026-10-04'])
  })

  it('lässt einen fehlenden Wert weg, statt eine 0 zu zeichnen', () => {
    const endnoten = verlauf('reck', 'final_score', wettkaempfe, ergebnisse)
    expect(endnoten).toHaveLength(2)
    expect(endnoten.map((p) => p.wert)).not.toContain(0)
    // Der D-Wert desselben Wettkampfs ist dagegen da.
    expect(verlauf('reck', 'd_score', wettkaempfe, ergebnisse)).toHaveLength(3)
  })

  it('übergeht ein Ergebnis ohne Wettkampf', () => {
    const verwaist = [...ergebnisse, erg('x', 'weg', 'reck', { final_score: 99 })]
    expect(verlauf('reck', 'final_score', wettkaempfe, verwaist)).toHaveLength(2)
  })

  it('nennt Starts, Bestwert und letzten Start je Gerät', () => {
    const b = geraetBilanzen(wettkaempfe, ergebnisse)
    const reck = b.get('reck')!
    expect(reck.starts).toBe(3)
    expect(reck.bestEndnote?.wert).toBe(12.5)
    expect(reck.bestD?.wert).toBe(3.8)
    expect(reck.letzter?.day).toBe('2026-10-04')
    expect(b.get('boden')!.starts).toBe(1)
  })

  it('führt ein Gerät ohne Start gar nicht auf', () => {
    const b = geraetBilanzen(wettkaempfe, ergebnisse)
    expect(b.has('ringe')).toBe(false)
    expect(b.has('pauschenpferd')).toBe(false)
  })

  it('zählt einen Start auch ohne Endnote', () => {
    // Sommer hat am Reck nur einen D-Wert - trotzdem ein Start.
    expect(geraetBilanzen(wettkaempfe, ergebnisse).get('reck')!.starts).toBe(3)
  })

  it('braucht drei Punkte, bevor eine Linie gezeichnet werden darf', () => {
    expect(MINDESTPUNKTE_LINIE).toBe(3)
    expect(verlauf('reck', 'final_score', wettkaempfe, ergebnisse).length)
      .toBeLessThan(MINDESTPUNKTE_LINIE)
  })
})

describe('naechsterUndLetzter', () => {
  const liste = [
    wk('w1', '2026-03-01', 'Frühjahr'),
    wk('w2', '2026-10-04', 'Herbst'),
    wk('w3', '2026-12-12', 'Winter'),
  ]

  it('trennt künftig von vergangen', () => {
    const { naechster, letzter } = naechsterUndLetzter(liste, '2026-06-01')
    expect(naechster?.id).toBe('w2')
    expect(letzter?.id).toBe('w1')
  })

  it('zählt den heutigen Wettkampf als den nächsten', () => {
    const { naechster, letzter } = naechsterUndLetzter(liste, '2026-10-04')
    expect(naechster?.id).toBe('w2')
    expect(letzter?.id).toBe('w1')
  })

  it('kommt ohne künftige Wettkämpfe aus', () => {
    const { naechster, letzter } = naechsterUndLetzter(liste, '2027-01-01')
    expect(naechster).toBeNull()
    expect(letzter?.id).toBe('w3')
  })

  it('übergeht gelöschte Wettkämpfe', () => {
    const mitGeloescht = [...liste, wk('w4', '2026-07-01', 'Weg', { deleted_at: '2026-08-01T00:00:00Z' })]
    expect(naechsterUndLetzter(mitGeloescht, '2026-06-01').naechster?.id).toBe('w2')
  })
})
