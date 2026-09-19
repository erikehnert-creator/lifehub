/**
 * Die Tagesarten haben eine eigene Farbfamilie bekommen.
 *
 * Grund: „Urlaub" und „Frei" waren beide grün und kaum zu trennen, und Grün
 * heisst in dieser App schon etwas (erledigt, im Rahmen, Feiertag). Geprüft
 * wird beides, was dabei schiefgehen kann: die Zuordnung nach Art und
 * Anfangszeit, und dass eine selbst gewählte Farbe unangetastet bleibt.
 */
import { describe, it, expect } from 'vitest'
import {
  tagesartFarbe, istStandardTagesartFarbe, TAGESART_FARBE,
} from '../src/core/tagesartFarben'

describe('Farbe einer Tagesart', () => {
  it('ordnet Arbeitstage nach der Anfangszeit zu', () => {
    expect(tagesartFarbe('work', '06:00')).toBe(TAGESART_FARBE.frueh)
    expect(tagesartFarbe('work', '14:00')).toBe(TAGESART_FARBE.spaet)
    expect(tagesartFarbe('work', '22:00')).toBe(TAGESART_FARBE.nacht)
  })

  it('trifft auch selbst angelegte Schichten mit anderen Namen', () => {
    // Die Zuordnung hängt an der Zeit, nicht am Namen.
    expect(tagesartFarbe('work', '10:00')).toBe(TAGESART_FARBE.frueh)
    expect(tagesartFarbe('work', '23:30')).toBe(TAGESART_FARBE.nacht)
    expect(tagesartFarbe('work', '02:00')).toBe(TAGESART_FARBE.nacht)
  })

  it('die Grenzen liegen bei 04, 12 und 20 Uhr', () => {
    expect(tagesartFarbe('work', '04:00')).toBe(TAGESART_FARBE.frueh)
    expect(tagesartFarbe('work', '03:59')).toBe(TAGESART_FARBE.nacht)
    expect(tagesartFarbe('work', '11:59')).toBe(TAGESART_FARBE.frueh)
    expect(tagesartFarbe('work', '12:00')).toBe(TAGESART_FARBE.spaet)
    expect(tagesartFarbe('work', '19:00')).toBe(TAGESART_FARBE.spaet)
    expect(tagesartFarbe('work', '20:00')).toBe(TAGESART_FARBE.nacht)
  })

  it('ein Arbeitstag ohne Anfangszeit bekommt den mittleren Ton', () => {
    expect(tagesartFarbe('work', null)).toBe(TAGESART_FARBE.spaet)
    expect(tagesartFarbe('work', '')).toBe(TAGESART_FARBE.spaet)
    expect(tagesartFarbe('work', 'Unfug')).toBe(TAGESART_FARBE.spaet)
  })

  it('Urlaub und Frei sind nicht mehr beide grün', () => {
    expect(tagesartFarbe('vacation', null)).toBe(TAGESART_FARBE.urlaub)
    expect(tagesartFarbe('off', null)).toBe(TAGESART_FARBE.frei)
    expect(tagesartFarbe('vacation', null)).not.toBe(tagesartFarbe('off', null))
  })

  it('Schule und Krank haben eigene Töne', () => {
    expect(tagesartFarbe('school', '07:30')).toBe(TAGESART_FARBE.schule)
    expect(tagesartFarbe('sick', null)).toBe(TAGESART_FARBE.krank)
  })

  it('keine der sieben Farben doppelt sich', () => {
    const werte = Object.values(TAGESART_FARBE)
    expect(new Set(werte).size).toBe(werte.length)
  })

  it('keine Tagesart benutzt die Statusfarben', () => {
    // Grün, Gelb und Rot gehören dem Status – erledigt, Warnung, kritisch.
    for (const f of Object.values(TAGESART_FARBE)) {
      expect(f).not.toMatch(/--good|--warning|--critical/)
    }
  })
})

describe('Welche Farbe überschrieben werden darf', () => {
  it('die alte Diagrammpalette gilt als nicht bewusst gewählt', () => {
    expect(istStandardTagesartFarbe('var(--series-1)')).toBe(true)
    expect(istStandardTagesartFarbe('var(--series-8)')).toBe(true)
  })

  it('gar keine Farbe ebenso', () => {
    expect(istStandardTagesartFarbe(null)).toBe(true)
    expect(istStandardTagesartFarbe(undefined)).toBe(true)
    expect(istStandardTagesartFarbe('')).toBe(true)
  })

  it('eine selbst eingestellte Farbe bleibt stehen', () => {
    expect(istStandardTagesartFarbe('#ff00aa')).toBe(false)
    expect(istStandardTagesartFarbe('var(--cat-7)')).toBe(false)
  })

  it('eine bereits umgestellte Tagesart wird nicht erneut angefasst', () => {
    // Sonst schriebe jeder Start dieselbe Änderung erneut.
    for (const f of Object.values(TAGESART_FARBE)) {
      expect(istStandardTagesartFarbe(f)).toBe(false)
    }
  })
})
