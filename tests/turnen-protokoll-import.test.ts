/**
 * Vom gelesenen Protokoll zum Wettkampfentwurf.
 *
 * Der Leser selbst ist in `turnen-protokoll.test.ts` nachgerechnet. Hier geht
 * es um den Schritt danach: dass aus den erkannten Werten **genau dieselben**
 * Objekte werden wie bei der Handeingabe, dass eine 0 eine 0 bleibt und dass
 * nichts die Datenbank erreicht, was niemand bestätigt hat.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseProtokoll, type TextStueck } from '../supabase/functions/wettkampf-import/protokoll'
import {
  vorschlagen, suchen, teilnehmerZeile, wettkampfEntwurf, ergebnisEingaben,
  unsichereFelder, markerListe, schonVorhanden,
} from '../src/core/turnen/protokollImport'
import {
  planeErgebnisse, planIstLeer, eingabeAus, werteAus, plausibilitaet, ergebnisId,
} from '../src/core/turnen/wettkampf'
import { pruefeDatei, HOECHSTGROESSE } from '../src/sync/protokoll'
import type { GymCompetition, GymResult } from '../src/core/types'

const seiten: TextStueck[][] = JSON.parse(
  readFileSync(new URL('./fixtures/protokoll-score-2026.json', import.meta.url), 'utf8'))
const protokoll = parseProtokoll(seiten)
const erik = protokoll.teilnehmer.find((t) => t.name.wert === 'Ehnert, Erik')!

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 't', server_rev: null,
}
const wk = (id: string, day: string, name: string, opt: Partial<GymCompetition> = {}): GymCompetition => ({
  ...basis, id, day, name, location: null, class_name: null,
  rank_allround: null, score_allround: null, protocol_url: null, note: null, ...opt,
} as GymCompetition)

/* ==================================================== Teilnehmer wählen */

describe('Teilnehmer vorschlagen', () => {
  it('schlägt bei genau einem Treffer vor', () => {
    expect(vorschlagen(protokoll.teilnehmer, 'Ehnert')?.name.wert).toBe('Ehnert, Erik')
    expect(vorschlagen(protokoll.teilnehmer, 'Erik Ehnert')?.name.wert).toBe('Ehnert, Erik')
  })

  it('schlägt nichts vor, wenn kein Name hinterlegt ist', () => {
    // Ohne Namen im Profil gibt es keinen Vorschlag - und keine
    // Hartcodierung, die einen erfindet.
    expect(vorschlagen(protokoll.teilnehmer, '')).toBeNull()
    expect(vorschlagen(protokoll.teilnehmer, '   ')).toBeNull()
  })

  it('schlägt nichts vor, wenn niemand passt', () => {
    expect(vorschlagen(protokoll.teilnehmer, 'Mustermann')).toBeNull()
  })

  it('schlägt nichts vor, wenn mehrere passen', () => {
    // Zwei mögliche Treffer: Der Mensch entscheidet, nicht LifeHub.
    const mehrere = vorschlagen(protokoll.teilnehmer, 'Vorname0')
    expect(mehrere).toBeNull()
    expect(suchen(protokoll.teilnehmer, 'Vorname0').length).toBeGreaterThan(1)
  })

  it('sucht auch über Verein, Klasse und Jahrgang', () => {
    expect(suchen(protokoll.teilnehmer, 'SG Empor Possendorf').length).toBeGreaterThan(1)
    expect(suchen(protokoll.teilnehmer, 'Ehnert Possendorf')).toHaveLength(1)
    expect(suchen(protokoll.teilnehmer, '2006 Possendorf')).toHaveLength(1)
  })

  it('gibt ohne Suche alle zurück', () => {
    expect(suchen(protokoll.teilnehmer, '')).toHaveLength(95)
  })

  it('macht aus einem Teilnehmer eine lesbare Zeile', () => {
    expect(teilnehmerZeile(erik)).toBe('2006 · SG Empor Possendorf · LK 2 AK 18-29 · Rang 2')
  })

  it('lässt den Jahrgang weg, wenn keiner dasteht', () => {
    const ohne = protokoll.teilnehmer.find((t) => t.jahrgang.sicherheit === 'missing')!
    expect(teilnehmerZeile(ohne)).not.toMatch(/^\d{4}/)
    expect(teilnehmerZeile(ohne)).toContain('TV zu Beispielheim-Süd')
  })
})

/* ====================================================== Wettkampfentwurf */

describe('Wettkampfentwurf', () => {
  const entwurf = wettkampfEntwurf(protokoll, erik, '2026-09-21')

  it('übernimmt Name, Ort, Datum und Klasse', () => {
    expect(entwurf).toEqual({
      name: 'Sächsische Einzelmeisterschaften männlich',
      tag: '2026-05-10',
      ort: 'Bannewitz',
      klasse: 'LK 2 AK 18-29',
      rang: '2',
      gesamt: '67,181',
    })
  })

  it('nimmt heute, wenn im Protokoll kein Datum stand', () => {
    const ohneDatum = {
      ...protokoll,
      wettkampf: { ...protokoll.wettkampf, tag: { wert: null, sicherheit: 'missing' as const, roh: null } },
    }
    expect(wettkampfEntwurf(ohneDatum, erik, '2026-09-21').tag).toBe('2026-09-21')
  })

  it('reicht class_name für die Leistungs- und Altersklasse', () => {
    // Keine eigene Tabelle fuer Altersklassen - es ist ein Text, den nur
    // Erik liest.
    expect(entwurf.klasse).toBe('LK 2 AK 18-29')
    expect(typeof entwurf.klasse).toBe('string')
  })
})

/* ==================================================== Geräteergebnisse */

describe('Ergebniseingaben', () => {
  const eingaben = ergebnisEingaben(erik)

  it('erzeugt genau die sechs Geräte in Wettkampfreihenfolge', () => {
    expect(eingaben.map((e) => e.apparatus))
      .toEqual(['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck'])
  })

  it('trägt Eriks Werte in derselben Form ein wie die Handeingabe', () => {
    expect(eingaben.map((e) => [e.d, e.e, e.final])).toEqual([
      ['2,9', '8,666', '11,566'],
      ['3,1', '8,266', '11,366'],
      ['3,3', '8,366', '11,666'],
      ['1,9', '9,1', '11,0'],
      ['2,9', '8,733', '11,633'],
      ['2,1', '7,85', '9,95'],
    ])
  })

  it('lässt den Abzug leer, wo keiner stand', () => {
    for (const e of eingaben) expect(e.penalty).toBe('')
  })

  it('lässt die Kür leer – das Protokoll weiss nichts davon', () => {
    for (const e of eingaben) {
      expect(e.routineId).toBeNull()
      expect(e.versionId).toBeNull()
    }
  })

  it('trägt den Abzug als Betrag ein', () => {
    // Seite 6, Rang 6: Ringe mit Abzug 1.0.
    const t = protokoll.teilnehmer.find((x) => x.seite === 6 && x.rang.wert === 6)!
    const ringe = ergebnisEingaben(t).find((e) => e.apparatus === 'ringe')!
    expect([ringe.d, ringe.e, ringe.penalty, ringe.final])
      .toEqual(['2,4', '7,733', '1,0', '9,133'])
  })

  it('behält eine echte 0 als 0 und wirft das Gerät nicht weg', () => {
    // Seite 1, Rang 6: Boden 0.0 / 0.000 / 0.000.
    const t = protokoll.teilnehmer.find((x) => x.seite === 1 && x.rang.wert === 6)!
    const eing = ergebnisEingaben(t)
    expect(eing).toHaveLength(6)
    const boden = eing.find((e) => e.apparatus === 'boden')!
    expect([boden.d, boden.e, boden.final]).toEqual(['0,0', '0,0', '0,0'])
    // Und beim Schreiben wird daraus eine echte 0, kein null.
    const werte = werteAus('w1', boden)
    expect(werte.d_score).toBe(0)
    expect(werte.final_score).toBe(0)
    expect(werte.penalty).toBeNull()
  })

  it('übergeht ein Gerät ohne jede Zahl', () => {
    const leer = {
      ...erik,
      geraete: erik.geraete.map((g, i) => i === 0 ? {
        ...g,
        d: { wert: null, sicherheit: 'missing' as const, roh: null },
        e: { wert: null, sicherheit: 'missing' as const, roh: null },
        final: { wert: null, sicherheit: 'missing' as const, roh: null },
      } : g),
    }
    expect(ergebnisEingaben(leer).map((e) => e.apparatus))
      .toEqual(['pauschenpferd', 'ringe', 'sprung', 'barren', 'reck'])
  })
})

/* ========================================== Der Weg in die Datenbank */

describe('Speichern über denselben Weg wie die Handeingabe', () => {
  it('erzeugt sechs Ergebniszeilen mit den richtigen Werten', () => {
    const plan = planeErgebnisse('w-import', ergebnisEingaben(erik), [])
    expect(plan.anlegen).toHaveLength(6)
    expect(plan.aendern).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
    const boden = plan.anlegen.find((a) => a.values.apparatus === 'boden')!
    expect(boden.values).toMatchObject({
      d_score: 2.9, e_score: 8.666, final_score: 11.566, penalty: null,
      routine_version_id: null,
    })
  })

  it('erzeugt beim zweiten Import desselben Protokolls keine Dubletten', () => {
    const eingaben = ergebnisEingaben(erik)
    const erst = planeErgebnisse('w-import', eingaben, [])
    // So, wie es nach dem ersten Bestaetigen in der Datenbank steht.
    const danach: GymResult[] = erst.anlegen.map((a) => ({
      ...basis, id: a.id, ...a.values,
    })) as GymResult[]
    expect(danach.map((r) => r.id))
      .toEqual(['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']
        .map((g) => ergebnisId('w-import', g)))

    const nochmal = planeErgebnisse('w-import', danach.map(eingabeAus), danach)
    expect(planIstLeer(nochmal)).toBe(true)
  })

  it('geht bei jedem Gerät rechnerisch auf – ohne dass etwas gerechnet würde', () => {
    // plausibilitaet() aus Phase 2B1, unveraendert weiterverwendet.
    for (const e of ergebnisEingaben(erik)) expect(plausibilitaet(e)).toBeNull()
  })

  it('meldet eine Abweichung, ohne den Import zu blockieren', () => {
    const [boden] = ergebnisEingaben(erik)
    const verstellt = { ...boden, final: '12,0' }
    const hinweis = plausibilitaet(verstellt)
    expect(hinweis).toContain('11,566')
    expect(hinweis).toContain('12,0')
    expect(hinweis).toContain('Beides kann richtig sein')
  })
})

/* ====================================================== Unsicherheiten */

describe('Unsicherheit', () => {
  it('meldet bei diesem Protokoll nichts – alles ist eindeutig', () => {
    expect(unsichereFelder(protokoll, erik)).toEqual([])
  })

  it('meldet einen nicht gedeuteten Wert mit dem, was dastand', () => {
    const verstellt = {
      ...erik,
      geraete: erik.geraete.map((g, i) => i === 5 ? {
        ...g, e: { wert: null, sicherheit: 'ambiguous' as const, roh: '8,x66' },
      } : g),
    }
    expect(unsichereFelder(protokoll, verstellt)).toEqual([
      { feld: 'Reck · E-Wert', sicherheit: 'ambiguous', roh: '8,x66' },
    ])
  })

  it('meldet einen fehlenden Abzug NICHT als Unsicherheit', () => {
    // Kein Abzug ist der Normalfall. Ihn zu melden hiesse, bei fast jedem
    // Import sechs bedeutungslose Warnungen zu zeigen.
    const felder = unsichereFelder(protokoll, erik).map((u) => u.feld)
    expect(felder.some((f) => /Abzug/.test(f))).toBe(false)
  })

  it('führt die Kennzeichnung (+) mit, ohne sie zu deuten', () => {
    const mitPlus = protokoll.teilnehmer.find((x) => x.seite === 6 && x.rang.wert === 3)!
    expect(markerListe(mitPlus)).toEqual([
      { geraet: 'Sprung', marker: ['(+)'] },
      { geraet: 'Reck', marker: ['(+)'] },
    ])
    expect(markerListe(erik)).toEqual([])
  })
})

/* ================================================= Doppelter Wettkampf */

describe('schonVorhanden', () => {
  const entwurf = wettkampfEntwurf(protokoll, erik, '2026-09-21')

  it('erkennt denselben Wettkampf an Tag und Namen wieder', () => {
    const da = [wk('w1', '2026-05-10', 'Sächsische Einzelmeisterschaften männlich')]
    expect(schonVorhanden(da, entwurf)?.id).toBe('w1')
  })

  it('unterscheidet Gross- und Kleinschreibung nicht', () => {
    const da = [wk('w1', '2026-05-10', '  sächsische einzelmeisterschaften MÄNNLICH ')]
    expect(schonVorhanden(da, entwurf)?.id).toBe('w1')
  })

  it('meldet einen anderen Wettkampf am selben Tag nicht', () => {
    const da = [wk('w1', '2026-05-10', 'Gerätefinale Reck')]
    expect(schonVorhanden(da, entwurf)).toBeNull()
  })

  it('übergeht gelöschte Wettkämpfe', () => {
    const da = [wk('w1', '2026-05-10', 'Sächsische Einzelmeisterschaften männlich',
      { deleted_at: '2026-06-01T00:00:00Z' })]
    expect(schonVorhanden(da, entwurf)).toBeNull()
  })
})

/* ======================================================== Dateiprüfung */

describe('pruefeDatei', () => {
  const datei = (name: string, groesse: number, typ = 'application/pdf') =>
    ({ name, size: groesse, type: typ } as File)

  it('lässt eine gewöhnliche PDF durch', () => {
    expect(pruefeDatei(datei('protokoll.pdf', 1_250_000))).toBeNull()
  })

  it('weist eine zu grosse Datei ab, bevor sie hochgeladen wird', () => {
    const f = pruefeDatei(datei('film.pdf', HOECHSTGROESSE + 1))
    expect(f?.code).toBe('zu_gross')
    expect(f?.message).toMatch(/8 MB/)
  })

  it('weist eine leere Datei ab', () => {
    expect(pruefeDatei(datei('leer.pdf', 0))?.code).toBe('keine_datei')
  })

  it('weist eine offensichtliche Nicht-PDF ab', () => {
    expect(pruefeDatei(datei('urlaub.jpg', 500_000, 'image/jpeg'))?.code).toBe('keine_pdf')
  })

  it('lässt eine PDF ohne Typangabe des Browsers durch', () => {
    // Manche Browser melden fuer eine PDF gar keinen Typ. Die Signatur prueft
    // die Funktion ohnehin noch einmal.
    expect(pruefeDatei(datei('protokoll.pdf', 100_000, ''))).toBeNull()
  })
})
