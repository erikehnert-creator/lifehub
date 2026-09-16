/**
 * Achsenbeschriftung ohne Doppel.
 *
 * Anlass: „Erledigte Aufgaben pro Monat" zeigte an einem Diagramm voller
 * Nullen die Achse „1, 1, 0, 0, −1". Zwei Ursachen, beide hier geprüft:
 * Zwischenwerte (0,5) ergaben ganzzahlig formatiert dieselbe Zahl wie ihr
 * Nachbar, und eine Anzahl bekam eine negative Achse.
 */
import { describe, expect, it } from 'vitest'
import { eindeutigeTicks, niceTicks } from '../src/charts'

const ganzzahl = (n: number) => String(Math.round(n))

describe('eindeutigeTicks', () => {
  it('lässt keine Beschriftung zweimal hintereinander stehen', () => {
    const ticks = niceTicks(-1.12, 1.12, 4)
    const texte = eindeutigeTicks(ticks, ganzzahl).map(ganzzahl)
    for (let i = 1; i < texte.length; i++) expect(texte[i]).not.toBe(texte[i - 1])
  })

  it('ändert nichts, wenn die Beschriftungen ohnehin verschieden sind', () => {
    const ticks = niceTicks(0, 1000)
    expect(eindeutigeTicks(ticks, ganzzahl)).toEqual(ticks)
  })

  it('reproduziert den Anlass: ohne Bereinigung stand „1" doppelt da', () => {
    const roh = niceTicks(-1, 1, 4).map(ganzzahl)
    expect(new Set(roh).size).toBeLessThan(roh.length)
    const sauber = eindeutigeTicks(niceTicks(-1, 1, 4), ganzzahl).map(ganzzahl)
    expect(new Set(sauber).size).toBe(sauber.length)
  })
})
