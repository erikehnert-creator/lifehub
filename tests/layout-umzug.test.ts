/**
 * Eine neu geschnittene Seite darf die Anpassungen des Nutzers nicht wegwerfen.
 *
 * „Heute" und die Finanzübersicht haben im September 2026 neue Kennungen
 * bekommen (heute2, finanzen_uebersicht2), weil die Karten anders geschnitten
 * wurden. Ohne Umrechnung stünde die Seite wieder in Werkseinstellung da –
 * und das Ausblenden, das Erik vorgenommen hatte, wäre still verschwunden.
 */
import { describe, it, expect } from 'vitest'
import { migriereLayout, resolveLayout, type LayoutPref } from '../src/core/layout'

const HEUTE_UMZUG: Record<string, string> = {
  aufgaben: 'aufgaben',
  dein_tag: 'tag',
  training: 'training',
  ernaehrung: 'gesundheit',
  schlaf_gewicht: 'gesundheit',
  finanzen_kurz: 'geld',
  hinweise: 'hinweise',
  budgets: 'budgets',
  kommende_zahlungen: 'kommende_zahlungen',
  finanzen_konten: 'finanzen_konten',
  finanztag_checkliste: 'finanztag_checkliste',
  ziele: 'ziele',
}

const UEBERSICHT_UMZUG: Record<string, string> = {
  kennzahlen: 'vermoegen',
  prognose: 'monat',
  chart_ein_aus: 'verlauf',
  chart_sparen: 'verlauf',
  chart_vermoegen: 'verlauf',
  chart_kategorie: 'chart_kategorie',
  ausgaben_konto: 'ausgaben_konto',
  budgets: 'budgets',
}

describe('Umzug einer Seitenanpassung', () => {
  it('ohne alte Einstellung bleibt es bei der Werkseinstellung', () => {
    expect(migriereLayout(null, HEUTE_UMZUG)).toBeNull()
    expect(migriereLayout({ order: [], hidden: [] }, HEUTE_UMZUG)).toBeNull()
  })

  it('übersetzt die Reihenfolge und behält sie bei', () => {
    const alt: LayoutPref = { order: ['finanzen_kurz', 'aufgaben', 'training'], hidden: [] }
    expect(migriereLayout(alt, HEUTE_UMZUG)).toEqual({
      order: ['geld', 'aufgaben', 'training'],
      hidden: [],
    })
  })

  it('nimmt eine ausgeblendete Karte als ausgeblendet mit', () => {
    const alt: LayoutPref = { order: ['aufgaben', 'ziele'], hidden: ['ziele'] }
    expect(migriereLayout(alt, HEUTE_UMZUG)).toEqual({ order: ['aufgaben', 'ziele'], hidden: ['ziele'] })
  })

  it('Karten, die es nicht mehr gibt, verfallen ohne Lücke', () => {
    // "termine" ist aus den sortierbaren Karten herausgewandert.
    const alt: LayoutPref = { order: ['termine', 'aufgaben'], hidden: ['termine'] }
    expect(migriereLayout(alt, HEUTE_UMZUG)).toEqual({ order: ['aufgaben'], hidden: [] })
  })

  it('zusammengelegte Karten erscheinen nur einmal, an der ersten Stelle', () => {
    const alt: LayoutPref = { order: ['schlaf_gewicht', 'aufgaben', 'ernaehrung'], hidden: [] }
    const neu = migriereLayout(alt, HEUTE_UMZUG)
    expect(neu!.order).toEqual(['gesundheit', 'aufgaben'])
  })

  it('beim Zusammenlegen genügt EINE sichtbare Quelle – sonst verschwände sie mit', () => {
    // Ernährung war sichtbar, Schlaf & Gewicht ausgeblendet: die gemeinsame
    // Karte muss sichtbar bleiben, sonst verliert Erik die Ernährungswerte.
    const alt: LayoutPref = { order: ['ernaehrung', 'schlaf_gewicht'], hidden: ['schlaf_gewicht'] }
    expect(migriereLayout(alt, HEUTE_UMZUG)).toEqual({ order: ['gesundheit'], hidden: [] })
  })

  it('erst wenn ALLE Quellen ausgeblendet waren, bleibt die neue Karte aus', () => {
    const alt: LayoutPref = { order: ['ernaehrung', 'schlaf_gewicht'], hidden: ['ernaehrung', 'schlaf_gewicht'] }
    expect(migriereLayout(alt, HEUTE_UMZUG)).toEqual({ order: ['gesundheit'], hidden: ['gesundheit'] })
  })

  it('Finanzen: die drei Verlaufsdiagramme werden eine Verlaufskarte', () => {
    const alt: LayoutPref = {
      order: ['prognose', 'chart_ein_aus', 'chart_sparen', 'chart_vermoegen', 'kennzahlen'],
      hidden: ['chart_sparen'],
    }
    const neu = migriereLayout(alt, UEBERSICHT_UMZUG)
    expect(neu!.order).toEqual(['monat', 'verlauf', 'vermoegen'])
    // "Sparen" war ausgeblendet, "Ein/Aus" nicht – der Verlauf bleibt sichtbar.
    expect(neu!.hidden).toEqual([])
  })

  it('wer die Prognose nach oben gezogen hatte, findet sie oben wieder', () => {
    const alt: LayoutPref = { order: ['prognose', 'kennzahlen', 'chart_kategorie'], hidden: [] }
    expect(migriereLayout(alt, UEBERSICHT_UMZUG)!.order[0]).toBe('monat')
  })

  it('greift mit resolveLayout zusammen: neue Karten kommen hinten dazu', () => {
    const alt: LayoutPref = { order: ['prognose', 'kennzahlen'], hidden: ['kennzahlen'] }
    const umgezogen = migriereLayout(alt, UEBERSICHT_UMZUG)
    const defs = [
      { id: 'monat', title: 'Dieser Monat' },
      { id: 'budgets', title: 'Budgets' },
      { id: 'chart_kategorie', title: 'Ausgaben nach Kategorie' },
      { id: 'verlauf', title: 'Verlauf' },
      { id: 'vermoegen', title: 'Vermögen' },
      { id: 'ausgaben_konto', title: 'Ausgaben nach Konto', defaultVisible: false },
    ]
    const karten = resolveLayout(defs, umgezogen)
    expect(karten.map((k) => k.id).slice(0, 2)).toEqual(['monat', 'vermoegen'])
    // Übernommen: Vermögen bleibt ausgeblendet.
    expect(karten.find((k) => k.id === 'vermoegen')!.visible).toBe(false)
    // Karten, die es beim Speichern noch nicht gab, sind da und sichtbar.
    expect(karten.find((k) => k.id === 'verlauf')!.visible).toBe(true)
    // Werkseinstellung einer neuen Karte bleibt erhalten.
    expect(karten.find((k) => k.id === 'ausgaben_konto')!.visible).toBe(false)
  })
})
