/**
 * Der Konkurrenzvergleich – Plätze, Gleichstände und die Grenzen.
 *
 * ---------------------------------------------------------------------------
 * Die Grundwahrheit
 *
 * Geprüft wird gegen Eriks eigenen Wettkampf: Sächsische Einzelmeisterschaften
 * männlich vom 10.05.2026, Klasse `LK 2 AK 18-29`, sechs Turner. Die erwarteten
 * Plätze stehen unten als Tabelle – sie sind **nicht** in den Code
 * hineingeschrieben, sondern werden aus dem Protokollbestand gerechnet.
 *
 * Der Bestand in `fixtures/protokoll-score-2026.json` trägt ersetzte Namen,
 * Jahrgänge und Vereine (siehe `turnen-protokoll.test.ts`). Sämtliche **Zahlen**
 * und die **Klassen** sind unverändert – und nur die gehen in einen Vergleich
 * ein. Derselbe Lauf gegen das echte PDF steht in
 * `tests/protokoll-integration.mjs`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseProtokoll, type TextStueck, type Teilnehmer,
} from '../supabase/functions/wettkampf-import/protokoll'
import { ausProtokoll, vergleichFuer } from '../src/core/turnen/protokollImport'
import {
  MEHRKAMPF, benchmarkId, benchmarkPlanIstLeer, benchmarkWerte, gruppeVon, milli,
  planeBenchmarks, position, positionAus, rangIn, vergleiche,
  type VergleichsTeilnehmer, type VergleichsZeile,
} from '../src/core/turnen/vergleich'

const seiten: TextStueck[][] = JSON.parse(
  readFileSync(new URL('./fixtures/protokoll-score-2026.json', import.meta.url), 'utf8'))
const protokoll = parseProtokoll(seiten)

const erik: Teilnehmer = (() => {
  const t = protokoll.teilnehmer.filter((x) => (x.name.wert ?? '').startsWith('Ehnert'))
  expect(t, 'genau ein Ehnert im Protokoll').toHaveLength(1)
  return t[0]
})()

const vergleich = vergleichFuer(protokoll, erik)
const zeileVon = (scope: string): VergleichsZeile => {
  const z = vergleich.zeilen.find((x) => x.scope === scope)
  expect(z, `Vergleichszeile für ${scope}`).toBeTruthy()
  return z as VergleichsZeile
}

/* ================================================== Grundrechnung: Rang */

describe('rangIn', () => {
  it('zählt 1 plus die echt besseren Werte', () => {
    const r = rangIn([10, 8, 6], 8)
    expect(r).toMatchObject({ rang: 2, gleich: 1, anzahl: 3 })
  })

  it('gibt bei Gleichstand allen denselben Platz, nicht 2 und 3', () => {
    // Einer darueber, zwei gleich: beide stehen auf 2, nicht auf 2 und 3.
    const r = rangIn([10, 8, 8], 8)
    expect(r?.rang).toBe(2)
    expect(r?.gleich).toBe(2)
  })

  it('vergibt bei drei gleichen Werten dreimal Platz 1', () => {
    const r = rangIn([7, 7, 7], 7)
    expect(r).toMatchObject({ rang: 1, gleich: 3, anzahl: 3 })
  })

  it('erkennt den eindeutigen ersten und den eindeutigen letzten Platz', () => {
    expect(rangIn([9, 8, 7], 9)).toMatchObject({ rang: 1, gleich: 1 })
    expect(rangIn([9, 8, 7], 7)).toMatchObject({ rang: 3, gleich: 1 })
  })

  it('lässt fehlende Werte aus der Reihe, statt sie als 0 zu zählen', () => {
    // Waere null eine 0, stuende sie unter mir und mein Platz bliebe 1 von 3.
    const r = rangIn([10, null, 8], 8)
    expect(r).toMatchObject({ rang: 2, anzahl: 2 })
  })

  it('behandelt eine ausgewiesene 0 als Wert', () => {
    const r = rangIn([10, 0, 8], 0)
    expect(r).toMatchObject({ rang: 3, anzahl: 3 })
  })

  it('gibt null zurück, wenn ich selbst keinen Wert habe', () => {
    expect(rangIn([10, 8], null)).toBeNull()
  })

  it('gibt null zurück, wenn niemand einen Wert hat', () => {
    expect(rangIn([null, null], 8)).toBeNull()
  })

  it('rechnet Median und Bestwert in Tausendsteln', () => {
    const r = rangIn([12000, 10000, 8000], 10000)
    expect(r?.median).toBe(10000)
    expect(r?.best).toBe(12000)
  })

  it('nimmt bei gerader Anzahl das Mittel der beiden mittleren Werte', () => {
    const r = rangIn([12000, 10000, 8000, 6000], 8000)
    expect(r?.median).toBe(9000)
  })

  it('vergleicht auf Tausendsteln und nicht auf Gleitkommazahlen', () => {
    // 0.1 + 0.2 ist als double nicht 0.3 - als Tausendstel schon.
    expect(milli(0.1 + 0.2)).toBe(milli(0.3))
  })
})

/* ================================================= Grundrechnung: Position */

describe('position', () => {
  it('gibt dem Ersten 1 und dem Letzten 0', () => {
    expect(position(rangIn([9, 8, 7, 6, 5, 4], 9))).toBe(1)
    expect(position(rangIn([9, 8, 7, 6, 5, 4], 4))).toBe(0)
  })

  it('macht 1 von 6 und 4 von 6 vergleichbar', () => {
    expect(positionAus(1, 1, 6)).toBe(1)
    expect(positionAus(4, 1, 6)).toBeCloseTo(0.4, 10)
  })

  it('berücksichtigt die Feldgrösse – 2 von 3 ist nicht 2 von 20', () => {
    expect(positionAus(2, 1, 3)).toBeCloseTo(0.5, 10)
    expect(positionAus(2, 1, 20)).toBeCloseTo(18 / 19, 10)
  })

  it('gibt Gleichplatzierten dieselbe Position – die Mitte ihres Rangbereichs', () => {
    // Platz 4 geteilt von 6 belegt die Raenge 4 UND 5, Mittelrang 4,5:
    // (6 − 4,5) / 5 = 0,3. Nur die echt schlechteren zu zaehlen ergaebe 0,2
    // und behandelte den Gleichstand als halbe Niederlage.
    expect(positionAus(4, 2, 6)).toBeCloseTo(0.3, 10)
    expect(positionAus(4, 2, 6)).toBe(positionAus(4, 2, 6))
  })

  it('gibt bei einem Feld von einem null zurück', () => {
    expect(positionAus(1, 1, 1)).toBeNull()
  })
})

/* ============================== Gleichstände in der relativen Position */

/**
 * Gleichstand ist kein Schwächezeichen.
 *
 * Die Position ist der normierte **Mittelrang**: Gleichplatzierte bekommen die
 * Mitte des Rangbereichs, den sie gemeinsam belegen. Ohne das fiele ein
 * vollständig gleiches Feld auf 0 – niemand wäre schlechter als ich – und ein
 * Feld, in dem alle dasselbe geturnt haben, stünde als „ganz unten" da.
 */
describe('position bei Gleichständen', () => {
  it('gibt bei einem vollständig gleichen Feld genau die Mitte', () => {
    const werte = [2900, 2900, 2900, 2900, 2900, 2900]
    const r = rangIn(werte, 2900)
    expect(r).toMatchObject({ rang: 1, gleich: 6, anzahl: 6 })
    // Alle sind Erste - aber niemand steht damit vorn ODER hinten.
    expect(position(r)).toBe(0.5)
  })

  it('gibt bei zwei gleichen Werten in einem Feld von zwei die Mitte', () => {
    expect(position(rangIn([8000, 8000], 8000))).toBe(0.5)
  })

  it('gibt bei drei gleichen Werten in einem Feld von drei die Mitte', () => {
    expect(position(rangIn([7000, 7000, 7000], 7000))).toBe(0.5)
  })

  it('setzt zwei Gleichplatzierte an der Spitze knapp unter den Alleinersten', () => {
    // Vier darunter, einer gleich: (4 + 0,5) / 5 = 0,9.
    const geteilt = position(rangIn([9000, 9000, 8000, 7000, 6000, 5000], 9000))
    const allein = position(rangIn([9000, 8500, 8000, 7000, 6000, 5000], 9000))
    expect(geteilt).toBe(0.9)
    expect(allein).toBe(1)
    expect(geteilt as number).toBeLessThan(allein as number)
  })

  it('setzt zwei Gleichplatzierte am Ende knapp über den Alleinletzten', () => {
    const geteilt = position(rangIn([9000, 8000, 7000, 6000, 5000, 5000], 5000))
    const allein = position(rangIn([9000, 8000, 7000, 6000, 5500, 5000], 5000))
    expect(geteilt).toBe(0.1)
    expect(allein).toBe(0)
    expect(geteilt as number).toBeGreaterThan(allein as number)
  })

  it('setzt zwei Gleichplatzierte in der Mitte genau auf die Mitte', () => {
    // Plaetze 3 und 4 von sechs - der Bereich liegt symmetrisch um die Mitte.
    expect(position(rangIn([9000, 8000, 7000, 7000, 6000, 5000], 7000))).toBe(0.5)
  })

  it('gibt drei gleichen Werten in der Mitte eines Feldes von fünf die Mitte', () => {
    expect(position(rangIn([9000, 7000, 7000, 7000, 5000], 7000))).toBe(0.5)
  })

  it('ist spiegelsymmetrisch – Position und Gegenposition ergeben 1', () => {
    // Fuer jeden Wert gilt: Position(Wert) + Position(Wert im umgekehrten
    // Feld) = 1. Das ist die Probe darauf, dass Gleichstaende weder nach oben
    // noch nach unten bevorzugt werden.
    const felder = [
      [9000, 8000, 7000, 6000, 5000, 4000],
      [9000, 9000, 8000, 7000, 7000, 5000],
      [7000, 7000, 7000, 7000],
      [9000, 8000, 8000],
    ]
    for (const werte of felder) {
      for (const mein of new Set(werte)) {
        const hin = position(rangIn(werte, mein)) as number
        const zurueck = position(rangIn(werte.map((w) => -w), -mein)) as number
        expect(hin + zurueck, `Feld ${werte.join('/')} Wert ${mein}`).toBeCloseTo(1, 12)
      }
    }
  })

  it('behält bei einem Feld von drei die Randwerte', () => {
    expect(position(rangIn([9000, 8000, 7000], 9000))).toBe(1)
    expect(position(rangIn([9000, 8000, 7000], 8000))).toBe(0.5)
    expect(position(rangIn([9000, 8000, 7000], 7000))).toBe(0)
  })

  it('rechnet in einem grossen Feld mit Gleichständen weiter sauber', () => {
    // Zwanzig Turner, die oberen fuenf alle gleich: Sie teilen die Plaetze
    // 1 bis 5, ihre Mitte ist Rang 3 - und damit Position (15 + 2) / 19.
    const werte = [
      ...Array(5).fill(9000),
      ...Array.from({ length: 15 }, (_, i) => 8000 - i * 100),
    ]
    const r = rangIn(werte, 9000)
    expect(r).toMatchObject({ rang: 1, gleich: 5, anzahl: 20 })
    expect(position(r)).toBeCloseTo((15 + 0.5 * 4) / 19, 12)
    expect(position(r) as number).toBeGreaterThan(0.85)
  })

  it('macht aus einem Gleichstand allein keinen schwachen Wert', () => {
    // Die Kernforderung: Wer mit allen anderen gleichauf liegt, liegt nicht
    // unter der Mitte des Feldes.
    for (const n of [2, 3, 4, 5, 6, 7, 12, 20]) {
      const werte = Array(n).fill(5000)
      expect(position(rangIn(werte, 5000)), `Feld von ${n}`).toBe(0.5)
    }
  })
})

/* ====================================================== Gruppe bilden */

describe('gruppeVon', () => {
  const mach = (klasse: string, rang: number | null, gesamt: number | null): VergleichsTeilnehmer =>
    ({ klasse, rang, gesamt, geraete: [] })

  it('nimmt nur die eigene Klasse und nie das ganze Protokoll', () => {
    const ich = ausProtokoll(erik)
    const { gruppe, klasse, grund } = gruppeVon(protokoll.teilnehmer.map(ausProtokoll), ich)
    expect(grund).toBeNull()
    expect(klasse).toBe('LK 2 AK 18-29')
    expect(gruppe).toHaveLength(6)
    expect(protokoll.teilnehmer.length).toBe(95)
  })

  it('gruppiert über den Klassentext und nicht über die Seite', () => {
    // Die Seitenzahl kommt in `VergleichsTeilnehmer` nicht einmal vor -
    // eine Klasse, die sich ueber zwei Seiten zieht, bleibt deshalb EINE
    // Gruppe. In diesem Protokoll steht je Seite genau eine Klasse; ein
    // anderes Protokoll darf es anders halten, ohne dass die Rechnung
    // auseinanderfaellt.
    const ich = mach('LK 2 AK 18-29', 1, 60)
    const gruppe = gruppeVon([
      ich,
      mach('LK 2 AK 18-29', 2, 58),
      mach('LK 2 AK 18-29', 3, 55),
      mach('LK 1 AK 16/17', 1, 61),
    ], ich)
    expect(gruppe.grund).toBeNull()
    expect(gruppe.gruppe).toHaveLength(3)
  })

  it('führt im echten Protokoll je Seite genau eine Klasse', () => {
    // Nicht die Regel, sondern der Befund zu DIESEM Protokoll - damit
    // auffaellt, wenn ein spaeteres Protokoll es anders haelt.
    const klassenJeSeite = new Map<number, Set<string>>()
    for (const t of protokoll.teilnehmer) {
      const da = klassenJeSeite.get(t.seite) ?? new Set<string>()
      da.add(t.klasse)
      klassenJeSeite.set(t.seite, da)
    }
    for (const [seite, klassen] of klassenJeSeite) {
      expect(klassen.size, `Seite ${seite}`).toBe(1)
    }
    expect(new Set(protokoll.teilnehmer.map((t) => t.klasse)).size).toBe(12)
  })

  it('vergleicht nicht ohne Klasse', () => {
    const ich = mach('', 1, 60)
    expect(gruppeVon([ich], ich).grund).toBe('keine_klasse')
  })

  it('vergleicht nicht, wenn nur ein Turner in der Klasse steht', () => {
    const ich = mach('LK 9', 1, 60)
    expect(gruppeVon([ich], ich).grund).toBe('allein')
  })

  it('vergleicht bei zwei Turnern', () => {
    const ich = mach('LK 9', 1, 60)
    expect(gruppeVon([ich, mach('LK 9', 2, 50)], ich).grund).toBeNull()
  })

  it('lehnt ab, wenn zwei Wertungen unter derselben Klasse stehen', () => {
    // Zweimal Platz 1 mit verschiedenen Gesamtwerten: zwei getrennte
    // Wertungen, gleich beschriftet. Die zu vermischen ergaebe erfundene
    // Plaetze.
    const ich = mach('LK 2', 1, 60)
    const fremd = mach('LK 2', 1, 55)
    expect(gruppeVon([ich, fremd], ich).grund).toBe('raenge_widerspruechlich')
  })

  it('lässt echte Gleichplatzierungen zu', () => {
    // Gleicher Platz UND gleicher Gesamtwert ist ein echter Gleichstand.
    const ich = mach('LK 2', 1, 60)
    const gleich = mach('LK 2', 1, 60)
    expect(gruppeVon([ich, gleich], ich).grund).toBeNull()
  })
})

/* ================================================== Die Grundwahrheit */

describe('Eriks Wettkampf – Klasse LK 2 AK 18-29, sechs Turner', () => {
  it('bildet eine Gruppe von sechs', () => {
    expect(vergleich.grund).toBeNull()
    expect(vergleich.klasse).toBe('LK 2 AK 18-29')
    for (const z of vergleich.zeilen) expect(z.feldgroesse).toBe(6)
  })

  /**
   * Die erwarteten Plätze, Gerät für Gerät.
   *
   * `g` heisst geteilt. Diese Tabelle ist die Grundwahrheit aus dem Protokoll –
   * gerechnet wird sie aus den Zahlen, nicht aus ihr.
   */
  const ERWARTET: Record<string, { d: string; e: string; final: string }> = {
    boden: { d: '4g/6', e: '1/6', final: '4/6' },
    pauschenpferd: { d: '2g/6', e: '1/6', final: '1/6' },
    ringe: { d: '3/6', e: '2/6', final: '2/6' },
    sprung: { d: '2g/6', e: '1/6', final: '1/6' },
    barren: { d: '4g/6', e: '1/6', final: '4/6' },
    reck: { d: '4/6', e: '4/6', final: '4/6' },
  }

  const kurz = (r: { rang: number; gleich: number; anzahl: number } | null): string =>
    r ? `${r.rang}${r.gleich > 1 ? 'g' : ''}/${r.anzahl}` : '—'

  for (const [apparatus, soll] of Object.entries(ERWARTET)) {
    it(`${apparatus}: D ${soll.d}, E ${soll.e}, Endnote ${soll.final}`, () => {
      const z = zeileVon(apparatus)
      expect(kurz(z.d)).toBe(soll.d)
      expect(kurz(z.e)).toBe(soll.e)
      expect(kurz(z.final)).toBe(soll.final)
    })
  }

  it('Mehrkampf: 2 von 6', () => {
    const z = zeileVon(MEHRKAMPF)
    expect(kurz(z.final)).toBe('2/6')
    expect(z.d).toBeNull()
    expect(z.e).toBeNull()
  })

  it('liefert sieben Zeilen – sechs Geräte und den Mehrkampf', () => {
    expect(vergleich.zeilen.map((z) => z.scope).sort()).toEqual(
      ['barren', 'boden', 'mehrkampf', 'pauschenpferd', 'reck', 'ringe', 'sprung'])
  })

  it('rechnet Median und Bestwert des Feldes je Gerät', () => {
    const z = zeileVon('reck')
    // Erik stand am Reck auf Platz 4 von 6 - sein Wert liegt also unter dem
    // Besten, und der Median des Feldes ist bestimmbar.
    expect(z.final?.best).toBeGreaterThan(z.final?.median as number)
  })
})

/* ============================ Der entscheidende Fall: rohe Punktzahl täuscht */

describe('Rohe Punktzahlen taugen nicht zum Gerätevergleich', () => {
  it('Sprung hat eine niedrigere Endnote als Boden, Barren und Ringe – und steht besser', () => {
    const sprung = zeileVon('sprung')
    const werte = (scope: string) => zeileVon(scope).final?.best
    expect(werte).toBeTruthy()

    const meinSprung = milli(
      erik.geraete.find((g) => g.apparatus === 'sprung')?.final.wert ?? null) as number
    for (const schwaecher of ['boden', 'barren', 'ringe']) {
      const meins = milli(
        erik.geraete.find((g) => g.apparatus === schwaecher)?.final.wert ?? null) as number
      expect(meinSprung, `Sprung roh niedriger als ${schwaecher}`).toBeLessThan(meins)
    }

    // Trotzdem ist der Sprung erster und Boden und Barren nur vierter.
    expect(sprung.final?.rang).toBe(1)
    expect(zeileVon('boden').final?.rang).toBe(4)
    expect(zeileVon('barren').final?.rang).toBe(4)
  })

  it('gibt dem Sprung eine höhere Position als den roh besseren Geräten', () => {
    const p = (scope: string) => position(zeileVon(scope).final) as number
    expect(p('sprung')).toBeGreaterThan(p('boden'))
    expect(p('sprung')).toBeGreaterThan(p('barren'))
    expect(p('sprung')).toBeGreaterThan(p('ringe'))
  })
})

/* ====================================================== Speicherform */

describe('benchmarkWerte', () => {
  const werte = benchmarkWerte('wk1', vergleich.zeilen, '2026-05-10T12:00:00.000Z')

  it('erzeugt genau eine Zeile je Messgrösse', () => {
    expect(werte).toHaveLength(7)
    expect(new Set(werte.map((w) => w.id)).size).toBe(7)
  })

  it('leitet die ID aus Wettkampf und Messgrösse ab – Reimport trifft dieselbe Zeile', () => {
    const nochmal = benchmarkWerte('wk1', vergleich.zeilen, '2027-01-01T00:00:00.000Z')
    expect(nochmal.map((w) => w.id)).toEqual(werte.map((w) => w.id))
    expect(werte[0].id).toBe(benchmarkId('wk1', werte[0].scope))
  })

  it('hält die Feldgrösse und die Klasse fest', () => {
    const boden = werte.find((w) => w.scope === 'boden')
    expect(boden?.values.cohort_size).toBe(6)
    expect(boden?.values.cohort_label).toBe('LK 2 AK 18-29')
  })

  it('speichert Noten als Noten, nicht als Tausendstel', () => {
    const boden = werte.find((w) => w.scope === 'boden')
    expect(boden?.values.e_best).toBeLessThan(11)
    expect(boden?.values.final_best).toBeGreaterThan(11)
  })

  it('lässt D und E am Mehrkampf leer, statt eine Summe zu erfinden', () => {
    const mk = werte.find((w) => w.scope === MEHRKAMPF)
    expect(mk?.values.d_rank).toBeNull()
    expect(mk?.values.e_median).toBeNull()
    expect(mk?.values.final_rank).toBe(2)
  })
})

/* ============================================================== Plan */

describe('planeBenchmarks', () => {
  const ALLE = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']
  const JETZT = '2026-05-11T08:00:00.000Z'

  /** Die gespeicherten Zeilen, wie sie nach einem ersten Import aussähen. */
  const gespeichert = () => benchmarkWerte('wk1', vergleich.zeilen, JETZT)
    .map((w) => ({ id: w.id, scope: w.scope, ...w.values }))

  it('legt beim ersten Import je Messgrösse eine Zeile an', () => {
    const plan = planeBenchmarks('wk1', vergleich.zeilen, ALLE, [], JETZT)
    expect(plan.anlegen).toHaveLength(7)
    expect(plan.aendern).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
  })

  it('schreibt beim Reimport derselben Datei nichts – und legt keine zweite Zeile an', () => {
    const plan = planeBenchmarks('wk1', vergleich.zeilen, ALLE, gespeichert(), JETZT)
    expect(benchmarkPlanIstLeer(plan)).toBe(true)
  })

  it('rührt den Zeitstempel nicht an, wenn sich keine Zahl geändert hat', () => {
    // Anderes `jetzt`, gleiche Zahlen: kein Schreibvorgang.
    const plan = planeBenchmarks(
      'wk1', vergleich.zeilen, ALLE, gespeichert(), '2027-01-01T00:00:00.000Z')
    expect(plan.aendern).toHaveLength(0)
  })

  it('aktualisiert deterministisch, wenn sich eine Zahl geändert hat', () => {
    const vorhanden = gespeichert().map((b) =>
      (b.scope === 'boden' ? { ...b, final_rank: 99 } : b))
    const plan = planeBenchmarks('wk1', vergleich.zeilen, ALLE, vorhanden, JETZT)
    expect(plan.aendern).toHaveLength(1)
    expect(plan.aendern[0].patch.final_rank).toBe(4)
    expect(plan.aendern[0].patch.computed_at).toBe(JETZT)
    expect(plan.anlegen).toHaveLength(0)
  })

  it('lässt beim gewöhnlichen Speichern die Vergleichswerte stehen', () => {
    // Eine Notiz aendern darf einem importierten Wettkampf nicht seine
    // Plaetze nehmen.
    const plan = planeBenchmarks('wk1', null, ALLE, gespeichert(), JETZT)
    expect(benchmarkPlanIstLeer(plan)).toBe(true)
  })

  it('entfernt den Vergleichswert eines Geräts, das sein Ergebnis verliert', () => {
    const ohneReck = ALLE.filter((a) => a !== 'reck')
    const plan = planeBenchmarks('wk1', null, ohneReck, gespeichert(), JETZT)
    expect(plan.entfernen).toHaveLength(1)
    const reck = gespeichert().find((b) => b.scope === 'reck')
    expect(plan.entfernen[0]).toBe(reck?.id)
  })

  it('lässt den Mehrkampf stehen, auch wenn ein Gerät wegfällt', () => {
    const plan = planeBenchmarks('wk1', null, [], gespeichert(), JETZT)
    expect(plan.entfernen).toHaveLength(6)
    const mk = gespeichert().find((b) => b.scope === MEHRKAMPF)
    expect(plan.entfernen).not.toContain(mk?.id)
  })

  it('legt für ein Gerät ohne Ergebnis keinen Vergleichswert an', () => {
    const plan = planeBenchmarks('wk1', vergleich.zeilen, ['boden'], [], JETZT)
    expect(plan.anlegen.map((a) => a.id).sort()).toEqual(
      [benchmarkId('wk1', 'boden'), benchmarkId('wk1', MEHRKAMPF)].sort())
  })

  it('übergeht gelöschte Zeilen und legt sie neu an', () => {
    const weg = gespeichert().map((b) => ({ ...b, deleted_at: JETZT }))
    const plan = planeBenchmarks('wk1', vergleich.zeilen, ALLE, weg, JETZT)
    expect(plan.anlegen).toHaveLength(7)
    expect(plan.entfernen).toHaveLength(0)
  })

  it('tut ohne Vergleich und ohne Bestand nichts', () => {
    expect(benchmarkPlanIstLeer(planeBenchmarks('wk1', null, ALLE, [], JETZT))).toBe(true)
    expect(benchmarkPlanIstLeer(planeBenchmarks('wk1', [], ALLE, [], JETZT))).toBe(true)
  })
})

/* =================================================== Datenschutz baulich */

describe('Über fremde Teilnehmer bleibt nichts stehen', () => {
  it('überträgt aus dem Protokoll weder Name noch Jahrgang noch Verein', () => {
    const eingekocht = ausProtokoll(erik) as unknown as Record<string, unknown>
    expect(Object.keys(eingekocht).sort()).toEqual(['geraete', 'gesamt', 'klasse', 'rang'])
    for (const feld of ['name', 'verein', 'jahrgang', 'seite']) {
      expect(eingekocht[feld], `kein Feld ${feld}`).toBeUndefined()
    }
  })

  it('trägt in den Gerätewerten nur Zahlen', () => {
    const g = ausProtokoll(erik).geraete[0] as unknown as Record<string, unknown>
    expect(Object.keys(g).sort()).toEqual(['apparatus', 'd', 'e', 'final'])
  })

  it('enthält in den gespeicherten Werten keinen Namen aus dem Protokoll', () => {
    const namen = protokoll.teilnehmer
      .map((t) => t.name.wert)
      .filter((n): n is string => !!n)
    const text = JSON.stringify(benchmarkWerte('wk1', vergleich.zeilen, 'jetzt'))
    for (const name of namen) {
      const nachname = name.split(',')[0].trim()
      expect(text.includes(nachname), `${nachname} steht nicht in den Vergleichswerten`).toBe(false)
    }
  })

  it('enthält in den gespeicherten Werten keinen Verein und keinen Jahrgang', () => {
    const text = JSON.stringify(benchmarkWerte('wk1', vergleich.zeilen, 'jetzt'))
    for (const t of protokoll.teilnehmer) {
      if (t.verein.wert) expect(text.includes(t.verein.wert)).toBe(false)
      if (t.jahrgang.wert) expect(text.includes(String(t.jahrgang.wert))).toBe(false)
    }
  })
})

/* ======================================================= Sonderfälle */

describe('Sonderfälle', () => {
  const feld = (werte: { d?: number | null; e?: number | null; final?: number | null }[]) =>
    werte.map((w, i) => ({
      klasse: 'X',
      rang: i + 1,
      gesamt: 100 - i,
      geraete: [{
        apparatus: 'boden',
        d: w.d ?? null, e: w.e ?? null, final: w.final ?? null,
      }],
    }))

  it('lässt ein Gerät aus, an dem ich nicht gestartet bin', () => {
    const ich: VergleichsTeilnehmer = { klasse: 'X', rang: 1, gesamt: 100, geraete: [] }
    const andere: VergleichsTeilnehmer = {
      klasse: 'X', rang: 2, gesamt: 90,
      geraete: [{ apparatus: 'boden', d: 3, e: 8, final: 11 }],
    }
    const { zeilen } = vergleiche([ich, andere], ich)
    expect(zeilen.find((z) => z.scope === 'boden')).toBeUndefined()
  })

  it('rangt mich auch dann, wenn einem anderen das Gerät fehlt', () => {
    const gruppe = feld([{ d: 3, e: 8, final: 11 }, {}])
    const { zeilen } = vergleiche(gruppe, gruppe[0])
    expect(zeilen[0].final).toMatchObject({ rang: 1, anzahl: 1 })
    // Ein Feld von einem ergibt keine Position.
    expect(position(zeilen[0].final)).toBeNull()
  })

  it('zählt einen fehlenden D-Wert nicht als 0', () => {
    const gruppe = feld([{ d: null, e: 8, final: 11 }, { d: 5, e: 7, final: 12 }])
    const { zeilen } = vergleiche(gruppe, gruppe[0])
    expect(zeilen[0].d).toBeNull()
    expect(zeilen[0].e).toMatchObject({ rang: 1, anzahl: 2 })
  })

  it('behandelt einen echten D-Wert 0 als Wert', () => {
    const gruppe = feld([{ d: 0, e: 8, final: 8 }, { d: 5, e: 7, final: 12 }])
    const { zeilen } = vergleiche(gruppe, gruppe[0])
    expect(zeilen[0].d).toMatchObject({ rang: 2, anzahl: 2 })
  })

  it('rechnet in einem grossen Feld genauso', () => {
    const gross = Array.from({ length: 20 }, (_, i) => ({
      klasse: 'G', rang: i + 1, gesamt: 100 - i,
      geraete: [{ apparatus: 'boden', d: 5 - i * 0.1, e: 9 - i * 0.1, final: 14 - i * 0.2 }],
    }))
    const { zeilen } = vergleiche(gross, gross[4])
    expect(zeilen[0].final).toMatchObject({ rang: 5, anzahl: 20 })
    expect(position(zeilen[0].final)).toBeCloseTo(15 / 19, 10)
  })
})
