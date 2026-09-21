/**
 * Was der Abgleich meldet, wenn dem Server Tabellen fehlen.
 *
 * ---------------------------------------------------------------------------
 * Der Anlass
 *
 * Nach den Turnen-Phasen kannte Eriks Server acht Tabellen noch nicht – die
 * Migration war eingecheckt, aber nicht eingespielt. Die App meldete daraufhin
 * bei jedem Abgleich eine Wand aus Text: achtmal derselbe Erklärungssatz,
 * einmal je Tabelle, aneinandergehängt. Der Hinweis verdeckte den halben
 * Bildschirm und verbarg dabei genau die eine Auskunft, auf die es ankam.
 *
 * Acht fehlende Tabellen sind EIN Problem mit EINER Ursache und einem
 * einzigen Handgriff. Genau so soll es dastehen.
 */
import { describe, expect, it } from 'vitest'
import { schemaMeldung, TabelleFehltFehler } from '../src/sync/engine'

describe('Meldung bei unvollständigem Server-Schema', () => {
  it('fasst mehrere Tabellen zu einem Satz zusammen', () => {
    const text = schemaMeldung(8)
    expect(text).toContain('8 Tabellen fehlen')
    expect(text).toContain('Migration')
  })

  it('bleibt bei einer Tabelle im Singular', () => {
    expect(schemaMeldung(1)).toContain('1 Tabelle fehlt')
    expect(schemaMeldung(1)).not.toContain('Tabellen fehlen')
  })

  it('wiederholt den Erklärungstext nicht je Tabelle', () => {
    // Der alte Fehler: acht Tabellen, acht gleichlautende Saetze. Ein Satz
    // ist lang genug fuer eine Wand, wenn man ihn achtmal schreibt.
    const text = schemaMeldung(8)
    const treffer = text.match(/Migration/g) ?? []
    expect(treffer).toHaveLength(1)
  })

  it('bleibt kurz genug für einen Hinweis am Handy', () => {
    // Die alte Meldung war ueber 600 Zeichen lang und verdeckte den halben
    // Bildschirm. Zwei Zeilen sind das Mass.
    expect(schemaMeldung(8).length).toBeLessThan(140)
    expect(schemaMeldung(55).length).toBeLessThan(140)
  })

  it('nennt keine einzelne Tabelle – die stehen in der Diagnose', () => {
    expect(schemaMeldung(8)).not.toMatch(/gym_|_elements|_results/)
  })
})

describe('TabelleFehltFehler', () => {
  it('merkt sich, welche Tabelle gemeint war', () => {
    const f = new TabelleFehltFehler('gym_results')
    expect(f.tabelle).toBe('gym_results')
    expect(f.name).toBe('TabelleFehltFehler')
    expect(f).toBeInstanceOf(Error)
  })

  it('ist von einem gewöhnlichen Fehler unterscheidbar', () => {
    // Genau darauf beruht die Zusammenfassung: Eine fehlende Tabelle ist
    // etwas anderes als eine zickige Spalte und wird anders gemeldet.
    expect(new TabelleFehltFehler('x') instanceof TabelleFehltFehler).toBe(true)
    expect(new Error('x') instanceof TabelleFehltFehler).toBe(false)
  })
})
