/**
 * Die Leistungsanalyse – Fokus, Gerätevergleich und Verlauf.
 *
 * ---------------------------------------------------------------------------
 * Geprüft wird die Deutung, nicht der Wortlaut
 *
 * Die Zusicherungen halten sich an `fokus` (`'schwierigkeit'`, `'ausfuehrung'`,
 * `'beides'`, `'halten'`, `'zu_wenig_daten'`) und an Plätze und Positionen – nie
 * an deutsche Sätze. Eine bessere Formulierung soll keine Prüfung rot machen.
 *
 * Grundlage ist wieder Eriks eigener Wettkampf aus dem Protokollbestand; Werte
 * und Benchmarks werden daraus gerechnet, nicht hineingeschrieben.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseProtokoll, type TextStueck, type Teilnehmer,
} from '../supabase/functions/wettkampf-import/protokoll'
import { vergleichFuer } from '../src/core/turnen/protokollImport'
import { MEHRKAMPF, benchmarkWerte, positionAus, vergleiche } from '../src/core/turnen/vergleich'
import {
  FELDMITTE, MINDESTFELD_FUER_FOKUS, analyseBild, begruendung, fokusVon,
  geraetVerlauf, liegtUnten, richtung, wettkampfAnalyse,
  type Messwert, type VergleichsWerte,
} from '../src/core/turnen/analyse'
import type { GymCompetition, GymResult } from '../src/core/types'

const seiten: TextStueck[][] = JSON.parse(
  readFileSync(new URL('./fixtures/protokoll-score-2026.json', import.meta.url), 'utf8'))
const protokoll = parseProtokoll(seiten)

const erik: Teilnehmer = protokoll.teilnehmer.filter(
  (x) => (x.name.wert ?? '').startsWith('Ehnert'))[0]

const vergleich = vergleichFuer(protokoll, erik)

/* --------------------------------------------------- Daten wie in der App */

const WK_ID = 'wk-sachsen-2026'

const wettkampf = {
  id: WK_ID,
  day: '2026-05-10',
  name: 'Sächsische Einzelmeisterschaften männlich',
  location: 'Bannewitz',
  class_name: 'LK 2 AK 18-29',
  rank_allround: erik.rang.wert,
  score_allround: erik.gesamt.wert,
  protocol_url: null,
  note: null,
  deleted_at: null,
} as unknown as GymCompetition

/** Die eigenen Geräteergebnisse, aus dem Protokoll übernommen. */
const ergebnisse: GymResult[] = erik.geraete
  .filter((g) => g.d.wert !== null || g.e.wert !== null || g.final.wert !== null)
  .map((g) => ({
    id: `res-${g.apparatus}`,
    competition_id: WK_ID,
    apparatus: g.apparatus,
    routine_version_id: null,
    d_score: g.d.wert,
    e_score: g.e.wert,
    penalty: g.penalty.wert,
    final_score: g.final.wert,
    rank_apparatus: null,
    note: null,
    deleted_at: null,
  }) as unknown as GymResult)

const benchmarks: VergleichsWerte[] = benchmarkWerte(WK_ID, vergleich.zeilen, 'jetzt')
  .map((w) => w.values as unknown as VergleichsWerte)

const analyse = wettkampfAnalyse(wettkampf, ergebnisse, benchmarks)
const geraetVon = (apparatus: string) => {
  const g = analyse.geraete.find((x) => x.apparatus === apparatus)
  expect(g, `Analyse für ${apparatus}`).toBeTruthy()
  return g!
}

/* ============================================ Die Fokusregel als Regel */

describe('fokusVon – die Regel selbst', () => {
  const mw = (pos: number | null): Messwert => ({
    wert: 1, rang: 1, gleich: 1, anzahl: pos === null ? 1 : 6,
    median: 1, best: 1, position: pos, abstandMedian: 0, abstandBest: 0,
  })

  it('nennt beides, wenn D und E unter der Feldmitte liegen', () => {
    expect(fokusVon(mw(0.2), mw(0.2), 6)).toBe('beides')
  })

  it('nennt Schwierigkeit, wenn nur D unten liegt', () => {
    expect(fokusVon(mw(0.2), mw(1), 6)).toBe('schwierigkeit')
  })

  it('nennt Ausführung, wenn nur E unten liegt', () => {
    expect(fokusVon(mw(1), mw(0.2), 6)).toBe('ausfuehrung')
  })

  it('nennt halten, wenn nichts unten liegt – und erfindet keinen Schwachpunkt', () => {
    expect(fokusVon(mw(0.6), mw(1), 6)).toBe('halten')
    expect(fokusVon(mw(1), mw(1), 6)).toBe('halten')
  })

  it('zählt die Feldmitte selbst nicht als unten', () => {
    expect(liegtUnten(mw(FELDMITTE))).toBe(false)
    expect(fokusVon(mw(FELDMITTE), mw(FELDMITTE), 6)).toBe('halten')
  })

  it('benennt bei einem zu kleinen Feld keinen Fokus', () => {
    expect(fokusVon(mw(0), mw(0), MINDESTFELD_FUER_FOKUS - 1)).toBe('zu_wenig_daten')
    expect(fokusVon(mw(0), mw(0), 1)).toBe('zu_wenig_daten')
  })

  it('benennt ohne Vergleichsfeld keinen Fokus', () => {
    expect(fokusVon(mw(null), mw(null), null)).toBe('zu_wenig_daten')
  })

  it('benennt nichts, wenn nur eine der beiden Seiten bestimmbar ist', () => {
    // Aus einer Seite allein ist nicht zu sagen, welche die begrenzende ist.
    expect(fokusVon(mw(0.2), mw(null), 6)).toBe('zu_wenig_daten')
    expect(fokusVon(mw(null), mw(0.2), 6)).toBe('zu_wenig_daten')
  })

  /* --------------------------------------------- Gleichstände im Feld */

  /**
   * Ein Gleichstand allein macht nichts schwach.
   *
   * Geprüft wird hier durch die ganze Kette – aus Werten wird eine
   * Vergleichszeile, daraus ein Messwert, daraus ein Fokus. Ein Fehler in der
   * Position schlägt damit bis in die Empfehlung durch und fällt auf.
   */
  describe('Gleichstände lösen keinen Fokus aus', () => {
    /** Ein Feld, in dem alle dasselbe geturnt haben. */
    const gleichesFeld = (n: number) => {
      const teilnehmer = Array.from({ length: n }, (_, i) => ({
        klasse: 'G', rang: 1, gesamt: 50,
        geraete: [{ apparatus: 'boden', d: 3, e: 8, final: 11 }],
      }))
      const { zeilen } = vergleiche(teilnehmer, teilnehmer[0])
      const bm = benchmarkWerte('wk', zeilen, 'jetzt')
        .map((w) => w.values as unknown as VergleichsWerte)
      const wk = {
        id: 'wk', day: '2026-01-01', name: 'Gleich', class_name: 'G',
        rank_allround: 1, score_allround: 50, deleted_at: null,
      } as unknown as GymCompetition
      const erg = [{
        id: 'r', competition_id: 'wk', apparatus: 'boden',
        d_score: 3, e_score: 8, penalty: null, final_score: 11,
        rank_apparatus: null, deleted_at: null,
      } as unknown as GymResult]
      return wettkampfAnalyse(wk, erg, bm).geraete[0]
    }

    for (const n of [3, 4, 6, 12]) {
      it(`bei ${n} vollständig gleichen Turnern steht die Position auf 0,5`, () => {
        const g = gleichesFeld(n)
        expect(g.d.position).toBe(0.5)
        expect(g.e.position).toBe(0.5)
        expect(g.final.position).toBe(0.5)
      })

      it(`und der Fokus lautet halten, nicht beides (n = ${n})`, () => {
        const g = gleichesFeld(n)
        expect(liegtUnten(g.d)).toBe(false)
        expect(liegtUnten(g.e)).toBe(false)
        expect(g.fokus).toBe('halten')
      })
    }

    it('zählt genau die Feldmitte nicht als schwach', () => {
      expect(FELDMITTE).toBe(0.5)
      expect(liegtUnten({ ...mw(0.5), position: 0.5 })).toBe(false)
      expect(fokusVon(mw(0.5), mw(0.5), 6)).toBe('halten')
    })

    it('macht aus einem geteilten letzten Platz keinen Alleinletzten', () => {
      // Geteilt Letzter von sechs ergibt 0,1 und nicht 0 - schwach bleibt es,
      // aber nicht so schwach wie allein zuletzt.
      const geteilt = positionAus(5, 2, 6) as number
      const allein = positionAus(6, 1, 6) as number
      expect(geteilt).toBeGreaterThan(allein)
      expect(allein).toBe(0)
    })

    it('macht aus einem geteilten ersten Platz keinen Alleinersten', () => {
      expect(positionAus(1, 2, 6) as number).toBeLessThan(positionAus(1, 1, 6) as number)
      expect(positionAus(1, 1, 6)).toBe(1)
    })
  })

  it('erzeugt eine Begründung, die die Plätze nennt', () => {
    const d = { ...mw(0.2), rang: 4, gleich: 2, anzahl: 6 }
    const e = { ...mw(1), rang: 1, gleich: 1, anzahl: 6 }
    const text = begruendung('schwierigkeit', d, e)
    expect(text).toContain('Platz 4 geteilt von 6')
    expect(text).toContain('Platz 1 von 6')
  })

  it('verspricht in der Begründung keinen Punktgewinn', () => {
    for (const fokus of ['schwierigkeit', 'ausfuehrung', 'beides', 'halten'] as const) {
      const text = begruendung(fokus, mw(0.2), mw(1)).toLowerCase()
      for (const wort of ['punkt', 'mehr note', 'bringt', 'würde', 'wirst']) {
        expect(text.includes(wort), `„${wort}" steht nicht in „${fokus}"`).toBe(false)
      }
    }
  })
})

/* ================================== Eriks Wettkampf – erwartete Deutung */

describe('Eriks Wettkampf – was die Analyse erkennen muss', () => {
  /** Die erwartete Deutung je Gerät. Gerechnet, nicht hinterlegt. */
  const ERWARTET: Record<string, string> = {
    boden: 'schwierigkeit',
    pauschenpferd: 'halten',
    ringe: 'halten',
    sprung: 'halten',
    barren: 'schwierigkeit',
    reck: 'beides',
  }

  for (const [apparatus, fokus] of Object.entries(ERWARTET)) {
    it(`${apparatus} → ${fokus}`, () => {
      expect(geraetVon(apparatus).fokus).toBe(fokus)
    })
  }

  /**
   * Die relativen Positionen, ausgeschrieben.
   *
   * Sie stehen hier, weil die Fokusregel allein an ihnen hängt: Wer die
   * Positionsformel ändert, sieht an dieser Tabelle sofort, was sich verschiebt –
   * und nicht erst an einem umgeschlagenen Fokus. Gerechnet als normierter
   * Mittelrang, `(Anzahl − Mittelrang) / (Anzahl − 1)`, n = 6.
   */
  const POSITIONEN: Record<string, { d: number; e: number; final: number }> = {
    boden: { d: 0.3, e: 1, final: 0.4 },
    pauschenpferd: { d: 0.7, e: 1, final: 1 },
    ringe: { d: 0.6, e: 0.8, final: 0.8 },
    sprung: { d: 0.7, e: 1, final: 1 },
    barren: { d: 0.3, e: 1, final: 0.4 },
    reck: { d: 0.4, e: 0.4, final: 0.4 },
  }

  for (const [apparatus, soll] of Object.entries(POSITIONEN)) {
    it(`${apparatus}: Position D ${soll.d}, E ${soll.e}, Endnote ${soll.final}`, () => {
      const g = geraetVon(apparatus)
      expect(g.d.position).toBeCloseTo(soll.d, 12)
      expect(g.e.position).toBeCloseTo(soll.e, 12)
      expect(g.final.position).toBeCloseTo(soll.final, 12)
    })
  }

  it('hat an zwei Geräten einen geteilten D-Platz – dort wirkt der Mittelrang', () => {
    // Boden und Barren: Platz 4 geteilt von 6 ergibt 0,3 statt 0,2. Der Fokus
    // bleibt derselbe, weil 0,3 weiterhin unter der Feldmitte liegt.
    for (const apparatus of ['boden', 'barren']) {
      const g = geraetVon(apparatus)
      expect(g.d.gleich).toBe(2)
      expect(g.d.position).toBeCloseTo(0.3, 12)
      expect(liegtUnten(g.d)).toBe(true)
    }
    // Pauschenpferd und Sprung: Platz 2 geteilt ergibt 0,7 statt 0,6 - auch
    // dort bleibt es dabei, dass nichts unten liegt.
    for (const apparatus of ['pauschenpferd', 'sprung']) {
      const g = geraetVon(apparatus)
      expect(g.d.gleich).toBe(2)
      expect(g.d.position).toBeCloseTo(0.7, 12)
      expect(liegtUnten(g.d)).toBe(false)
    }
  })

  it('Boden: Ausführung deutlich stärker als Schwierigkeit', () => {
    const g = geraetVon('boden')
    expect(g.e.position as number).toBeGreaterThan(g.d.position as number)
    expect(g.e.rang).toBe(1)
    expect(g.d.rang).toBe(4)
    // Der Endnotenplatz ist deutlich schlechter als der E-Platz - genau das
    // ist der Hinweis darauf, dass die Schwierigkeit begrenzt.
    expect(g.final.rang as number).toBeGreaterThan(g.e.rang as number)
  })

  it('Pauschenpferd: insgesamt starke relative Position', () => {
    const g = geraetVon('pauschenpferd')
    expect(g.final.rang).toBe(1)
    expect(g.e.rang).toBe(1)
    expect(g.final.position).toBe(1)
  })

  it('Ringe: starke, relativ ausgeglichene Position', () => {
    const g = geraetVon('ringe')
    expect(liegtUnten(g.d)).toBe(false)
    expect(liegtUnten(g.e)).toBe(false)
    // Ausgeglichen: D und E liegen dicht beieinander - hoechstens einen
    // Platz auseinander, also ein Fuenftel des Feldes bei sechs Turnern.
    expect(Math.abs((g.d.position as number) - (g.e.position as number)))
      .toBeLessThan(0.2 + 1e-9)
  })

  it('Sprung: trotz geringerer absoluter Punktzahl relativ sehr stark', () => {
    const sprung = geraetVon('sprung')
    for (const anderes of ['boden', 'barren', 'ringe']) {
      const g = geraetVon(anderes)
      expect(sprung.final.wert as number,
        `Sprung roh niedriger als ${anderes}`).toBeLessThan(g.final.wert as number)
      expect(sprung.final.position as number,
        `Sprung relativ besser als ${anderes}`).toBeGreaterThan(g.final.position as number)
    }
    expect(sprung.final.rang).toBe(1)
    expect(sprung.fokus).not.toBe('beides')
    expect(sprung.fokus).not.toBe('ausfuehrung')
  })

  it('Barren: Ausführung stark, Schwierigkeit deutlich schwächer', () => {
    const g = geraetVon('barren')
    expect(g.e.rang).toBe(1)
    expect(liegtUnten(g.d)).toBe(true)
    expect(liegtUnten(g.e)).toBe(false)
  })

  it('Reck: D und E relativ schwächer – nicht künstlich nur eines davon', () => {
    const g = geraetVon('reck')
    expect(liegtUnten(g.d)).toBe(true)
    expect(liegtUnten(g.e)).toBe(true)
    expect(g.fokus).toBe('beides')
  })

  it('Mehrkampf: 2 von 6', () => {
    expect(analyse.mehrkampf?.rang).toBe(2)
    expect(analyse.mehrkampf?.anzahl).toBe(6)
    expect(analyse.mehrkampf?.wert).toBe(erik.gesamt.wert)
  })
})

/* ===================================== Gerätevergleich ohne Rohpunktzahlen */

describe('Geräte werden nicht über rohe Punktzahlen verglichen', () => {
  it('nennt als relativ stärkste Geräte die mit der höchsten Position', () => {
    expect(analyse.staerkste.sort()).toEqual(['pauschenpferd', 'sprung'])
  })

  it('nennt als höchste Rohnote ein anderes Gerät', () => {
    expect(analyse.hoechsteRohnote).toEqual(['ringe'])
  })

  it('merkt, dass die höchste Rohnote in die Irre führt', () => {
    expect(analyse.rohnoteTaeuscht).toBe(true)
  })

  it('führt die Geräte mit Ansatzpunkt, das relativ schwächste zuerst', () => {
    const keys = analyse.hebel.map((h) => h.apparatus)
    expect(keys).toContain('boden')
    expect(keys).toContain('barren')
    expect(keys).toContain('reck')
    expect(keys).not.toContain('sprung')
    expect(keys).not.toContain('pauschenpferd')
    const positionen = analyse.hebel.map((h) => h.final.position as number)
    expect(positionen).toEqual([...positionen].sort((a, b) => a - b))
  })
})

/* ================================================ Ohne Vergleichsfeld */

describe('Wettkampf ohne Vergleichswerte', () => {
  const ohne = wettkampfAnalyse(wettkampf, ergebnisse, [])

  it('zeigt die Rohwerte weiter an', () => {
    expect(ohne.geraete).toHaveLength(6)
    expect(ohne.geraete[0].final.wert).not.toBeNull()
  })

  it('erfindet keinen Geräteplatz und keinen Median', () => {
    for (const g of ohne.geraete) {
      expect(g.final.rang).toBeNull()
      expect(g.final.median).toBeNull()
      expect(g.final.best).toBeNull()
      expect(g.d.rang).toBeNull()
      expect(g.e.rang).toBeNull()
      expect(g.hatVergleich).toBe(false)
    }
  })

  it('benennt keinen Fokus', () => {
    for (const g of ohne.geraete) expect(g.fokus).toBe('zu_wenig_daten')
  })

  it('sagt, dass kein Vergleichsfeld vorhanden ist', () => {
    expect(ohne.hatVergleich).toBe(false)
    expect(ohne.feldgroesse).toBeNull()
    expect(ohne.mehrkampf).toBeNull()
    expect(ohne.staerkste).toEqual([])
    expect(ohne.rohnoteTaeuscht).toBe(false)
  })

  it('übernimmt gelöschte Vergleichswerte nicht', () => {
    const geloescht = benchmarks.map((b) => ({ ...b, deleted_at: '2026-06-01T00:00:00.000Z' }))
    expect(wettkampfAnalyse(wettkampf, ergebnisse, geloescht).hatVergleich).toBe(false)
  })
})

/* ============================================================= Verlauf */

describe('Verlauf über mehrere Wettkämpfe', () => {
  const zweiter = { ...wettkampf, id: 'wk2', day: '2026-06-14', name: 'Bezirksfinale' } as GymCompetition
  const zweiteErgebnisse: GymResult[] = [{
    id: 'res2-boden', competition_id: 'wk2', apparatus: 'boden',
    routine_version_id: null, d_score: 3.2, e_score: 8.5, penalty: null,
    final_score: 11.7, rank_apparatus: null, note: null, deleted_at: null,
  } as unknown as GymResult]
  const zweiteBenchmarks: VergleichsWerte[] = [{
    competition_id: 'wk2', scope: 'boden', cohort_label: 'LK 2 AK 18-29', cohort_size: 20,
    final_rank: 2, final_tie_count: 1, final_count: 20, final_median: 11, final_best: 12,
    d_rank: 2, d_tie_count: 1, d_count: 20, d_median: 3, d_best: 3.5,
    e_rank: 2, e_tie_count: 1, e_count: 20, e_median: 8, e_best: 8.8,
  }]

  const punkte = geraetVerlauf(
    'boden', [wettkampf, zweiter],
    [...ergebnisse, ...zweiteErgebnisse], [...benchmarks, ...zweiteBenchmarks])

  it('ordnet chronologisch', () => {
    expect(punkte.map((p) => p.day)).toEqual(['2026-05-10', '2026-06-14'])
  })

  it('führt Platz und Feldgrösse mit, damit 2/6 und 2/20 unterscheidbar bleiben', () => {
    expect(punkte[0]).toMatchObject({ rang: 4, anzahl: 6 })
    expect(punkte[1]).toMatchObject({ rang: 2, anzahl: 20 })
    // Dieselbe Platznummer in verschiedenen Feldern ist nicht dieselbe
    // Leistung - deshalb die Position und kein Durchschnittsplatz.
    expect(punkte[1].position as number).toBeGreaterThan(punkte[0].position as number)
  })

  it('rechnet den Abstand zum Median des jeweiligen Feldes', () => {
    expect(punkte[1].abstandMedian).toBeCloseTo(0.7, 6)
  })

  it('lässt einen Wettkampf ohne diesen Wert aus, statt eine 0 zu setzen', () => {
    const luecke = geraetVerlauf('pauschenpferd', [wettkampf, zweiter],
      [...ergebnisse, ...zweiteErgebnisse], benchmarks)
    expect(luecke).toHaveLength(1)
    expect(luecke[0].day).toBe('2026-05-10')
  })

  it('lässt Punkte ohne Vergleichswerte ohne Platz stehen', () => {
    const roh = geraetVerlauf('boden', [wettkampf], ergebnisse, [])
    expect(roh[0].final).not.toBeNull()
    expect(roh[0].rang).toBeNull()
    expect(roh[0].position).toBeNull()
    expect(roh[0].abstandMedian).toBeNull()
  })
})

describe('richtung – beschreibend, ohne Ursache', () => {
  it('nennt bei zwei Werten noch keine Richtung', () => {
    expect(richtung([8, 9])).toBe('zu_wenig')
  })

  it('nennt höher nur bei durchgehend steigenden Werten', () => {
    expect(richtung([8, 8.5, 9])).toBe('hoeher')
  })

  it('nennt niedriger nur bei durchgehend fallenden Werten', () => {
    expect(richtung([9, 8.5, 8])).toBe('niedriger')
  })

  it('nennt gemischt, wenn es auf und ab geht', () => {
    expect(richtung([8, 9, 8.5])).toBe('gemischt')
    expect(richtung([8, 8, 8])).toBe('gemischt')
  })

  it('überspringt Lücken, statt die Reihe abzubrechen', () => {
    expect(richtung([8, null, 8.5, 9])).toBe('hoeher')
  })
})

/* ========================================================== Gesamtbild */

describe('analyseBild', () => {
  const zweiter = { ...wettkampf, id: 'wk2', day: '2026-06-14', name: 'Bezirksfinale' } as GymCompetition
  const zweiteErgebnisse: GymResult[] = [{
    id: 'res2-boden', competition_id: 'wk2', apparatus: 'boden',
    routine_version_id: null, d_score: 3.2, e_score: 8.5, penalty: null,
    final_score: 11.7, rank_apparatus: null, note: null, deleted_at: null,
  } as unknown as GymResult]

  it('wertet den jüngsten Wettkampf mit Ergebnissen aus', () => {
    const bild = analyseBild([wettkampf, zweiter],
      [...ergebnisse, ...zweiteErgebnisse], benchmarks)
    expect(bild.aktuell?.wettkampf.id).toBe('wk2')
  })

  it('überspringt Wettkämpfe ohne Ergebnisse', () => {
    const leer = { ...wettkampf, id: 'wk3', day: '2026-12-01', name: 'Geplant' } as GymCompetition
    const bild = analyseBild([wettkampf, leer], ergebnisse, benchmarks)
    expect(bild.aktuell?.wettkampf.id).toBe(WK_ID)
    expect(bild.wettkaempfe.map((w) => w.id)).toEqual([WK_ID])
  })

  it('zählt, wie viele Wettkämpfe ein Vergleichsfeld haben', () => {
    const bild = analyseBild([wettkampf, zweiter],
      [...ergebnisse, ...zweiteErgebnisse], benchmarks)
    expect(bild.wettkaempfe).toHaveLength(2)
    expect(bild.mitVergleich).toBe(1)
  })

  it('führt je Gerät mit Start einen Verlauf', () => {
    const bild = analyseBild([wettkampf], ergebnisse, benchmarks)
    expect([...bild.verlauf.keys()].sort()).toEqual(
      ['barren', 'boden', 'pauschenpferd', 'reck', 'ringe', 'sprung'])
  })

  it('kommt ohne jeden Wettkampf zurecht', () => {
    const bild = analyseBild([], [], [])
    expect(bild.aktuell).toBeNull()
    expect(bild.verlauf.size).toBe(0)
    expect(bild.mitVergleich).toBe(0)
  })

  it('übergeht gelöschte Wettkämpfe und Ergebnisse', () => {
    const weg = { ...wettkampf, deleted_at: '2026-06-01T00:00:00.000Z' } as GymCompetition
    expect(analyseBild([weg], ergebnisse, benchmarks).aktuell).toBeNull()
    const ergWeg = ergebnisse.map((r) => ({ ...r, deleted_at: 'x' }) as GymResult)
    expect(analyseBild([wettkampf], ergWeg, benchmarks).aktuell).toBeNull()
  })
})

/* ================================================= Kein Personenbezug */

describe('In der Analyse steht kein fremder Personenbezug', () => {
  it('enthält das ganze Analysebild keinen Teilnehmernamen', () => {
    const bild = analyseBild([wettkampf], ergebnisse, benchmarks)
    const text = JSON.stringify({
      aktuell: bild.aktuell, verlauf: [...bild.verlauf], wettkaempfe: bild.wettkaempfe,
    })
    for (const t of protokoll.teilnehmer) {
      const name = t.name.wert
      if (!name || name.startsWith('Ehnert')) continue
      expect(text.includes(name.split(',')[0].trim())).toBe(false)
      if (t.verein.wert) expect(text.includes(t.verein.wert)).toBe(false)
    }
  })

  it('nennt als Vergleichsgruppe nur die Klasse', () => {
    expect(analyse.klasse).toBe('LK 2 AK 18-29')
    expect(analyse.feldgroesse).toBe(6)
  })
})

/* ================================================= Mehrkampf-Sonderfall */

describe('Mehrkampf', () => {
  it('erfindet keine D- und E-Summe', () => {
    const mk = benchmarks.find((b) => b.scope === MEHRKAMPF)
    expect(mk?.d_rank ?? null).toBeNull()
    expect(mk?.e_rank ?? null).toBeNull()
  })
})

/* ========================================================== Leistung */

/**
 * Die Analyse muss einen echten Bestand in einem Durchgang schaffen.
 *
 * Gemessen wird der Aufruf, den die Oberfläche macht – einmal je Datenänderung,
 * nicht je Zeichnen (`useMemo` in `screens/turnen/Analyse.tsx`). Die Schwelle
 * ist bewusst grosszügig: Sie soll eine Regression fangen, die aus einem
 * Durchgang ein Durchsuchen je Gerät und Wettkampf macht (das wären 600 × 6
 * Durchläufe), und nicht auf einem langsamen Rechner grundlos rot werden.
 */
describe('Leistung', () => {
  const WETTKAEMPFE = 100
  const JE_WETTKAMPF = 6

  const vieleWettkaempfe: GymCompetition[] = []
  const vieleErgebnisse: GymResult[] = []
  const vieleBenchmarks: VergleichsWerte[] = []

  for (let i = 0; i < WETTKAEMPFE; i++) {
    const id = `wk-${i}`
    const tag = `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`
    vieleWettkaempfe.push({
      id, day: tag, name: `Wettkampf ${i}`, location: null,
      class_name: 'LK 2 AK 18-29', rank_allround: (i % 6) + 1,
      score_allround: 60 + (i % 10), protocol_url: null, note: null, deleted_at: null,
    } as unknown as GymCompetition)

    const geraete = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']
    for (let j = 0; j < JE_WETTKAMPF; j++) {
      const apparatus = geraete[j]
      vieleErgebnisse.push({
        id: `${id}-${apparatus}`, competition_id: id, apparatus,
        routine_version_id: null,
        d_score: 2 + (j % 3) * 0.3, e_score: 8 + (j % 4) * 0.2, penalty: null,
        final_score: 10 + (j % 5) * 0.4, rank_apparatus: null, note: null, deleted_at: null,
      } as unknown as GymResult)
      vieleBenchmarks.push({
        competition_id: id, scope: apparatus,
        cohort_label: 'LK 2 AK 18-29', cohort_size: 6,
        final_rank: (j % 6) + 1, final_tie_count: 1, final_count: 6,
        final_median: 11, final_best: 12.5,
        d_rank: (j % 6) + 1, d_tie_count: 1, d_count: 6, d_median: 2.6, d_best: 3.4,
        e_rank: (j % 6) + 1, e_tie_count: 1, e_count: 6, e_median: 8.3, e_best: 9.1,
      })
    }
    vieleBenchmarks.push({
      competition_id: id, scope: MEHRKAMPF,
      cohort_label: 'LK 2 AK 18-29', cohort_size: 6,
      final_rank: (i % 6) + 1, final_tie_count: 1, final_count: 6,
      final_median: 63, final_best: 70,
    })
  }

  it('hat 100 Wettkämpfe, 600 Ergebnisse und 700 Vergleichswerte im Bestand', () => {
    expect(vieleWettkaempfe).toHaveLength(100)
    expect(vieleErgebnisse).toHaveLength(600)
    expect(vieleBenchmarks).toHaveLength(700)
  })

  it('wertet das alles in einem Durchgang unter 150 ms aus', () => {
    const t0 = performance.now()
    const bild = analyseBild(vieleWettkaempfe, vieleErgebnisse, vieleBenchmarks)
    const dauer = performance.now() - t0
    expect(bild.aktuell).not.toBeNull()
    expect(bild.verlauf.size).toBe(6)
    expect(bild.wettkaempfe).toHaveLength(100)
    expect(bild.mitVergleich).toBe(100)
    // eslint-disable-next-line no-console
    console.log(`  analyseBild(): ${dauer.toFixed(1)} ms für 100 Wettkämpfe, 600 Ergebnisse`)
    expect(dauer).toBeLessThan(150)
  })

  it('kostet ein Gerätewechsel nichts – die Verläufe liegen fertig da', () => {
    const bild = analyseBild(vieleWettkaempfe, vieleErgebnisse, vieleBenchmarks)
    const t0 = performance.now()
    for (let runde = 0; runde < 50; runde++) {
      for (const key of bild.verlauf.keys()) {
        const punkte = bild.verlauf.get(key)
        expect(punkte?.length).toBe(100)
      }
    }
    expect(performance.now() - t0).toBeLessThan(50)
  })

  it('wertet nur den jüngsten Wettkampf vollständig aus, nicht alle hundert', () => {
    // Die Kosten dürfen nicht mit der Zahl der Wettkämpfe MULTIPLIKATIV
    // wachsen. Zehnmal so viele Wettkämpfe dürfen nicht hundertmal so lange
    // dauern.
    const messe = (n: number) => {
      const wk = vieleWettkaempfe.slice(0, n)
      const ids = new Set(wk.map((w) => w.id))
      const erg = vieleErgebnisse.filter((r) => ids.has(r.competition_id))
      const bm = vieleBenchmarks.filter((b) => ids.has(b.competition_id))
      const t0 = performance.now()
      analyseBild(wk, erg, bm)
      return performance.now() - t0
    }
    messe(10)
    const klein = Math.max(messe(10), 0.05)
    const gross = messe(100)
    expect(gross / klein).toBeLessThan(40)
  })
})
