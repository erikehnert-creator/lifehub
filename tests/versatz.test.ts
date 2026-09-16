/**
 * Zusammenhänge mit Zeitversatz – „liegt es am Essen?"
 *
 * Der schwierige Teil an dieser Auswertung ist nicht das Rechnen, sondern das
 * Schweigen: Wer sechs Verzögerungen durchprobiert, findet fast immer eine,
 * die gut aussieht. Deshalb prüft dieser Test vor allem, dass die Auswertung
 * bei dünner Datenlage und bei reinem Rauschen NICHTS behauptet.
 */
import { describe, it, expect } from 'vitest'
import {
  versetzteKorrelation, versatzReihe, besterVersatz, sicherheitsText, versatzText,
  VERSATZ_TAGE, MINDESTPAARE, type SeriesPoint,
} from '../src/core/metrics'
import { addDays } from '../src/core/dates'

const START = '2026-01-01'

/** Eine Tagesreihe aus Werten ab dem 01.01.2026. */
function reihe(werte: (number | null)[], ab = START): SeriesPoint[] {
  return werte.map((value, i) => ({ day: addDays(ab, i), value }))
}

/** Gleichmäßiges, aber nicht zufälliges Auf und Ab. */
function welle(tage: number, versatz = 0): (number | null)[] {
  return Array.from({ length: tage }, (_, i) => Math.sin((i + versatz) / 3) * 10 + 50)
}

describe('Versetzte Korrelation', () => {
  it('findet den Zusammenhang am selben Tag', () => {
    const a = reihe(welle(60))
    const b = reihe(welle(60))
    const f = versetzteKorrelation(a, b, 0)
    expect(f.r).toBeGreaterThan(0.95)
    expect(f.belastbar).toBe(true)
    expect(f.n).toBe(60)
  })

  it('findet einen Zusammenhang, der erst drei Tage später auftaucht', () => {
    // b von Tag T entspricht a von Tag T-3: Die Wirkung kommt verzögert.
    const a = reihe(welle(90))
    const b = reihe(welle(90, -3))
    const befunde = versatzReihe(a, b)
    const beste = besterVersatz(befunde)
    expect(beste).not.toBeNull()
    expect(beste!.versatzTage).toBe(3)
    expect(beste!.r).toBeGreaterThan(0.9)
  })

  it('prüft alle geforderten Verzögerungen: 0, 1, 2, 3, 5, 7 Tage', () => {
    expect([...VERSATZ_TAGE]).toEqual([0, 1, 2, 3, 5, 7])
    const befunde = versatzReihe(reihe(welle(60)), reihe(welle(60)))
    expect(befunde.map((f) => f.versatzTage)).toEqual([0, 1, 2, 3, 5, 7])
  })

  it('erkennt einen gegenläufigen Zusammenhang', () => {
    const a = reihe(welle(60))
    const b = reihe(welle(60).map((v) => 100 - (v as number)))
    const f = versetzteKorrelation(a, b, 0)
    expect(f.r).toBeLessThan(-0.95)
    expect(f.belastbar).toBe(true)
  })
})

describe('Was die Auswertung NICHT behaupten darf', () => {
  it('schweigt bei zu wenigen gemeinsamen Tagen', () => {
    const kurz = reihe(welle(MINDESTPAARE - 1))
    const f = versetzteKorrelation(kurz, kurz, 0)
    expect(f.r).toBeNull()
    expect(f.belastbar).toBe(false)
    expect(sicherheitsText(f)).toMatch(/zu wenige/)
  })

  it('schweigt, wenn eine Reihe sich gar nicht bewegt', () => {
    const konstant = reihe(Array(40).fill(70))
    const f = versetzteKorrelation(reihe(welle(40)), konstant, 0)
    expect(f.r).toBeNull()
  })

  it('erklärt reines Rauschen nicht für belastbar', () => {
    // Wiederholbarer Pseudozufall – der Test darf nicht mal so, mal so ausgehen.
    let seed = 12345
    const zufall = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    let behauptungen = 0
    for (let versuch = 0; versuch < 40; versuch++) {
      const a = reihe(Array.from({ length: 30 }, () => zufall() * 100))
      const b = reihe(Array.from({ length: 30 }, () => zufall() * 100))
      if (besterVersatz(versatzReihe(a, b))) behauptungen++
    }
    // Bei 40 Versuchen über je sechs Verzögerungen wäre eine Handvoll
    // Fehlalarme statistisch zu erwarten. Ein Drittel wäre keine Auswertung
    // mehr, sondern eine Maschine für Scheinzusammenhänge.
    console.log(`  Fehlalarme bei reinem Rauschen: ${behauptungen} von 40`)
    expect(behauptungen).toBeLessThan(4)
  })

  it('nennt bei dünner Datenlage einen breiten Unsicherheitsbereich', () => {
    const wenig = 12
    const a = reihe(welle(wenig))
    const b = reihe(welle(wenig).map((v) => (v as number) + (Math.random() > 0.5 ? 8 : -8)))
    const f = versetzteKorrelation(a, b, 0)
    if (f.r !== null) {
      const breite = f.oben! - f.unten!
      const viel = versetzteKorrelation(reihe(welle(300)), reihe(welle(300)), 0)
      expect(breite).toBeGreaterThan(viel.oben! - viel.unten!)
    }
  })

  it('lässt Tage ohne Wert einfach aus, statt sie als 0 zu zählen', () => {
    const mitLuecken = reihe([...welle(20)].map((v, i) => (i % 3 === 0 ? null : v)))
    const voll = reihe(welle(20))
    const f = versetzteKorrelation(mitLuecken, voll, 0)
    expect(f.n).toBeLessThan(20)
    expect(f.n).toBeGreaterThan(10)
  })

  it('zählt beim Versatz nur Paare, die es wirklich gibt', () => {
    const a = reihe(welle(30))
    const b = reihe(welle(30))
    // Sieben Tage Versatz heißt: Die letzten sieben Tage von a haben kein
    // Gegenstück mehr.
    expect(versetzteKorrelation(a, b, 7).n).toBe(23)
  })
})

describe('Sprache der Befunde', () => {
  it('benennt die Verzögerung verständlich', () => {
    expect(versatzText(0)).toBe('am selben Tag')
    expect(versatzText(1)).toBe('einen Tag später')
    expect(versatzText(3)).toBe('3 Tage später')
  })

  it('nennt immer die Datenmenge', () => {
    const f = versetzteKorrelation(reihe(welle(60)), reihe(welle(60)), 0)
    expect(sicherheitsText(f)).toContain('60')
  })
})
