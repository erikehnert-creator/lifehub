/**
 * Zeitversetzte Zusammenhänge – und die Ehrlichkeit der Statistik.
 *
 * Der gefährliche Teil dieser Auswertung ist nicht das Rechnen, sondern das
 * Behaupten. Wer sechs Verzögerungen ausprobiert und danach die stärkste
 * zeigt, findet fast immer „etwas" – und aus einem Zufall wird eine
 * Ernährungsregel, nach der jemand sein Essen umstellt.
 *
 * Geprüft wird deshalb zweierlei:
 *
 *   1. Findet es einen eingebauten Zusammenhang bei der richtigen Verzögerung?
 *   2. Und, wichtiger: Schweigt es bei reinem Rauschen und bei zu wenig Daten?
 *
 * Die Irrtumswahrscheinlichkeit wird gegen Werte geprüft, die in jeder
 * Statistiktabelle stehen – nicht gegen das, was die eigene Funktion gerade
 * ausrechnet.
 */
import { describe, expect, it } from 'vitest'
import {
  MINDESTTAGE, VERZOEGERUNGEN, bewertung, formuliere, pWert, staerke,
  untersuche, verzoegerteKorrelation,
} from '../src/core/zusammenhaenge'
import { addDays } from '../src/core/dates'
import type { SeriesPoint } from '../src/core/metrics'

/** Eine Reihe ab dem 1. Januar, ein Wert je Tag. */
function reihe(werte: (number | null)[], start = '2026-01-01'): SeriesPoint[] {
  return werte.map((value, i) => ({ day: addDays(start, i), value }))
}

/** Deterministischer Zufall – sonst wäre der Rauschtest mal grün, mal rot. */
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* --------------------------------------------------- Die Korrelation selbst */

describe('Zeitversetzte Korrelation', () => {
  it('findet einen um zwei Tage versetzten Zusammenhang genau dort', () => {
    // Die Wirkung ist die um zwei Tage verschobene Ursache. Bei Versatz 2 muss
    // das perfekt passen, bei Versatz 0 nicht.
    const ursache = [3, 9, 1, 7, 2, 8, 4, 6, 5, 10, 3, 9]
    const frueher = reihe(ursache)
    const spaeter = reihe([0, 0, ...ursache])

    expect(verzoegerteKorrelation(frueher, spaeter, 2, addDays).r).toBe(1)
    expect(Math.abs(verzoegerteKorrelation(frueher, spaeter, 0, addDays).r!)).toBeLessThan(0.9)
  })

  it('erkennt einen gegenläufigen Zusammenhang', () => {
    const frueher = reihe([1, 2, 3, 4, 5, 6, 7, 8])
    const spaeter = reihe([0, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(verzoegerteKorrelation(frueher, spaeter, 1, addDays).r).toBe(-1)
  })

  it('rechnet über das Datum und nicht über die Position in der Liste', () => {
    // Der Fall, an dem eine Umsetzung über Listenpositionen still falsch wird:
    // In der späteren Reihe fehlt ein Tag. Über Positionen gerechnet
    // verschöbe sich alles Nachfolgende um einen Tag.
    const frueher = reihe([1, 2, 3, 4, 5, 6])
    const spaeter: SeriesPoint[] = [
      { day: '2026-01-02', value: 1 },
      // 2026-01-03 fehlt
      { day: '2026-01-04', value: 3 },
      { day: '2026-01-05', value: 4 },
      { day: '2026-01-06', value: 5 },
    ]
    const res = verzoegerteKorrelation(frueher, spaeter, 1, addDays)
    expect(res.n).toBe(4)
    expect(res.r).toBe(1)
  })

  it('schweigt, wenn ein Wert sich gar nicht verändert', () => {
    // Ohne Streuung gibt es nichts zu korrelieren – und die Formel teilte
    // durch null.
    const frueher = reihe([1, 2, 3, 4, 5, 6])
    const spaeter = reihe([7, 7, 7, 7, 7, 7])
    expect(verzoegerteKorrelation(frueher, spaeter, 0, addDays).r).toBeNull()
  })

  it('zählt nur Tage, an denen beide Werte vorliegen', () => {
    const frueher = reihe([1, null, 3, null, 5, 6])
    const spaeter = reihe([1, 2, null, 4, 5, 6])
    expect(verzoegerteKorrelation(frueher, spaeter, 0, addDays).n).toBe(3)
  })
})

/* ---------------------------------------------- Irrtumswahrscheinlichkeit */

describe('Irrtumswahrscheinlichkeit', () => {
  it('trifft die Werte aus der Tabelle', () => {
    // r = 0,444 bei n = 20 ist der klassische Grenzwert für 5 % (zweiseitig).
    expect(pWert(0.444, 20)).toBeCloseTo(0.05, 2)
    // r = 0,632 bei n = 10 ebenso.
    expect(pWert(0.632, 10)).toBeCloseTo(0.05, 2)
    // r = 0,254 bei n = 60 ebenso.
    expect(pWert(0.254, 60)).toBeCloseTo(0.05, 2)
  })

  it('ist vom Vorzeichen unabhängig', () => {
    expect(pWert(-0.444, 20)).toBeCloseTo(pWert(0.444, 20), 10)
  })

  it('wird mit mehr Tagen strenger beurteilt', () => {
    // Derselbe Zusammenhang ist über 100 Tage aussagekräftiger als über 10.
    expect(pWert(0.4, 100)).toBeLessThan(pWert(0.4, 10))
  })

  it('hält einen schwachen Zusammenhang über wenige Tage für belanglos', () => {
    expect(pWert(0.3, 8)).toBeGreaterThan(0.4)
  })
})

/* ------------------------------------------------------ Die Zurückhaltung */

describe('Wann etwas als belastbar gilt', () => {
  const tage = 120

  it('erkennt einen echten Zusammenhang bei der richtigen Verzögerung', () => {
    const zufall = mulberry32(7)
    const zucker: number[] = []
    for (let i = 0; i < tage; i++) zucker.push(20 + zufall() * 80)
    // Die Haut folgt dem Zucker mit zwei Tagen Versatz, plus ordentlich Rauschen.
    const haut = zucker.map((z) => 10 - z / 12 + (zufall() - 0.5) * 2)

    const befunde = untersuche(
      'sugar_g', 'skin', reihe(zucker), reihe([0, 0, ...haut]), addDays,
    )
    const belastbar = befunde.filter((b) => b.belastbar)
    expect(belastbar.length).toBeGreaterThan(0)
    const staerkster = [...befunde].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0]
    expect(staerkster.verzoegerung).toBe(2)
    expect(staerkster.r).toBeLessThan(0)          // mehr Zucker, schlechtere Haut
  })

  it('schweigt bei reinem Rauschen', () => {
    // Der wichtigste Test des ganzen Moduls. Zwei unabhängige Zufallsreihen,
    // sechs Verzögerungen – ohne Korrektur fände man hier regelmäßig etwas.
    let gefunden = 0
    for (let lauf = 0; lauf < 40; lauf++) {
      const zufall = mulberry32(lauf * 977 + 13)
      const a: number[] = []
      const b: number[] = []
      for (let i = 0; i < tage; i++) { a.push(zufall() * 100); b.push(zufall() * 10) }
      gefunden += untersuche('a', 'b', reihe(a), reihe(b), addDays)
        .filter((x) => x.belastbar).length
    }
    // Bei 40 Läufen à 6 Verzögerungen wären ohne Korrektur um die 12 Treffer
    // zu erwarten. Mit Korrektur dürfen es nur ganz vereinzelte sein.
    expect(gefunden).toBeLessThanOrEqual(2)
  })

  it('erklärt nichts für belastbar, wenn zu wenige Tage vorliegen', () => {
    // Ein perfekter Zusammenhang über zwölf Tage ist trotzdem keine Aussage.
    const werte = [1, 5, 2, 8, 3, 9, 4, 7, 6, 10, 2, 8]
    const befunde = untersuche('a', 'b', reihe(werte), reihe(werte), addDays)
    const amSelbenTag = befunde.find((b) => b.verzoegerung === 0)!
    expect(amSelbenTag.r).toBe(1)
    expect(amSelbenTag.n).toBeLessThan(MINDESTTAGE)
    expect(amSelbenTag.belastbar).toBe(false)
  })

  it('gibt alle geprüften Verzögerungen zurück, nicht nur die beste', () => {
    // Erst im Nebeneinander sieht man, ob ein Ausschlag allein dasteht.
    const werte = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 10 + 20)
    const befunde = untersuche('a', 'b', reihe(werte), reihe(werte), addDays)
    expect(befunde.map((b) => b.verzoegerung)).toEqual([...VERZOEGERUNGEN])
  })

  it('rechnet die Irrtumswahrscheinlichkeit für die Zahl der Versuche hoch', () => {
    const werte = Array.from({ length: 40 }, (_, i) => (i * 7919) % 100)
    const einer = untersuche('a', 'b', reihe(werte), reihe(werte), addDays, { versuche: 1 })
    const sechs = untersuche('a', 'b', reihe(werte), reihe(werte), addDays, { versuche: 6 })
    const v3 = (liste: typeof einer) => liste.find((b) => b.verzoegerung === 3)!
    expect(v3(sechs).p).toBeCloseTo(Math.min(1, v3(einer).p * 6), 10)
  })
})

/* ------------------------------------------------------------- Die Worte */

describe('Wie ein Befund formuliert wird', () => {
  const befund = {
    ursache: 'sugar_g', wirkung: 'skin', verzoegerung: 2,
    r: -0.42, n: 31, p: 0.03, belastbar: true,
  }

  it('sagt, was beobachtet wurde – und nennt die Datenbasis', () => {
    const satz = formuliere(befund, 'Zucker', 'dein Hautwert', 'higher_better')
    expect(satz).toContain('2 Tage später')
    expect(satz).toContain('schlechter')
    expect(satz).toContain('31 Tage')
  })

  it('behauptet keine Ursache', () => {
    const satz = formuliere(befund, 'Zucker', 'dein Hautwert', 'higher_better')
    for (const wort of ['verursacht', 'führt zu', 'wegen', 'weil', 'bewirkt']) {
      expect(satz.toLowerCase(), `„${wort}" wäre eine Behauptung, keine Beobachtung`)
        .not.toContain(wort)
    }
  })

  it('dreht die Bewertung bei einem Wert, bei dem weniger besser ist', () => {
    // Hautwert: höher ist besser. Pickel: niedriger ist besser. Derselbe
    // Koeffizient bedeutet dort das Gegenteil.
    expect(bewertung(-0.4, 'higher_better')).toBe('schlechter')
    expect(bewertung(-0.4, 'lower_better')).toBe('besser')
    expect(bewertung(0.4, 'higher_better')).toBe('besser')
    expect(bewertung(0.4, 'lower_better')).toBe('schlechter')
  })

  it('urteilt bei einem Zielbereich nicht über besser oder schlechter', () => {
    // Mehr Kalorien sind weder gut noch schlecht – es kommt auf das Ziel an.
    expect(bewertung(0.4, 'range')).toBe('anders')
    const satz = formuliere({ ...befund, r: 0.4 }, 'Zucker', 'dein Gewicht', 'range')
    expect(satz).toContain('höher')
    expect(satz).not.toContain('besser')
  })

  it('benennt die Stärke in Worten', () => {
    expect(staerke(0.1)).toBe('kaum')
    expect(staerke(0.3)).toBe('leicht')
    expect(staerke(0.5)).toBe('deutlich')
    expect(staerke(-0.8)).toBe('stark')
  })
})
