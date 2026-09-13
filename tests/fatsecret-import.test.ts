/**
 * Der Weg rückwärts durch das FatSecret-Tagebuch.
 *
 * FatSecret sagt nirgends, seit wann ein Konto besteht – `profile.get` liefert
 * Größe, Zielgewicht und die letzte Wiegung, kein Anlegedatum. „Hole alles seit
 * Tag 1" gibt es als Abfrage also nicht; das Ende muss erschlossen werden.
 *
 * Grundlage ist `food_entries.get_month.v2`: Die Monatsübersicht enthält laut
 * Doku nur Tage MIT Einträgen. Ein Jahr Historie kostet damit zwölf Aufrufe
 * statt 365, und man weiß hinterher genau, welche Tage sich einzeln zu holen
 * lohnen.
 *
 * Geprüft wird hier vor allem, was schiefgehen könnte:
 *   - zu früh aufhören, weil jemand zwei Wochen Pause gemacht hat
 *   - gar nicht aufhören, weil FatSecret leere Monate statt Fehler liefert
 *   - nach einer Unterbrechung wieder von vorn anfangen
 */
import { describe, expect, it } from 'vitest'
import {
  FRUEHESTER_MONAT, LEERER_STAND, LEERE_MONATE_BIS_ENDE, abgleichFaellig,
  ersterTagDesMonats, monatVon, nachzuholendeTage, naechsteMonate, standNachMonaten,
  standFuerNeuenLauf, vorherigerMonat, type ImportStand, type MonatsBefund,
} from '../src/core/fatsecretImport'
import { parseMonthDays } from '../src/core/fatsecret'
import { addDays } from '../src/core/dates'

const HEUTE = '2026-09-13'

/* ----------------------------------------------------------- Monatsrechnen */

describe('Monate', () => {
  it('liest den Monat aus einem Tag', () => {
    expect(monatVon('2026-09-13')).toBe('2026-09')
  })

  it('geht über den Jahreswechsel zurück', () => {
    expect(vorherigerMonat('2026-01')).toBe('2025-12')
    expect(vorherigerMonat('2026-09')).toBe('2026-08')
  })

  it('hält die Monate zweistellig, damit der Textvergleich stimmt', () => {
    // '2026-9' wäre größer als '2026-10' – die ganze Rückwärtssuche liefe
    // dann in der falschen Reihenfolge.
    expect(vorherigerMonat('2026-11')).toBe('2026-10')
    expect(vorherigerMonat('2026-10')).toBe('2026-09')
    expect(vorherigerMonat('2026-02')).toBe('2026-01')
  })

  it('nennt den ersten Tag eines Monats – das will FatSecret als Datum', () => {
    expect(ersterTagDesMonats('2026-09')).toBe('2026-09-01')
  })
})

/* -------------------------------------------------------------- Fahrplan */

describe('Welche Monate als Nächstes', () => {
  it('beginnt beim laufenden Monat', () => {
    expect(naechsteMonate(LEERER_STAND, 3, HEUTE)).toEqual(['2026-09', '2026-08', '2026-07'])
  })

  it('setzt danach dort an, wo der letzte Lauf aufgehört hat', () => {
    const stand = { ...LEERER_STAND, geprueftBis: '2026-07' }
    expect(naechsteMonate(stand, 2, HEUTE)).toEqual(['2026-06', '2026-05'])
  })

  it('liefert nichts mehr, wenn der Lauf durch ist', () => {
    expect(naechsteMonate({ ...LEERER_STAND, fertig: true }, 5, HEUTE)).toEqual([])
  })

  it('geht nicht hinter den Boden zurück', () => {
    // Die Notbremse: FatSecret gibt es seit 2007, ein Tagebuch davor nicht.
    const stand = { ...LEERER_STAND, geprueftBis: `${FRUEHESTER_MONAT.slice(0, 4)}-02` }
    const monate = naechsteMonate(stand, 12, HEUTE)
    expect(monate).toEqual([FRUEHESTER_MONAT])
  })
})

/* ------------------------------------------------------- Wann ist Schluss */

const befund = (monat: string, tage: string[] = []): MonatsBefund => ({ monat, tage })

describe('Der Stand nach einer Runde', () => {
  it('merkt sich den ältesten gefundenen Tag', () => {
    const neu = standNachMonaten(LEERER_STAND, [
      befund('2026-09', ['2026-09-02', '2026-09-11']),
      befund('2026-08', ['2026-08-20']),
    ])
    expect(neu.aeltesterTag).toBe('2026-08-20')
    expect(neu.gefundeneTage).toBe(3)
    expect(neu.geprueftBis).toBe('2026-08')
  })

  it('kommt auch bei leeren Monaten voran', () => {
    // Sonst liefe der Import nach einer Unterbrechung immer wieder gegen
    // denselben leeren Monat und käme nie beim nächsten an.
    const neu = standNachMonaten(LEERER_STAND, [befund('2026-09'), befund('2026-08')])
    expect(neu.geprueftBis).toBe('2026-08')
    expect(neu.leereMonate).toBe(2)
    expect(neu.fertig).toBe(false)
  })

  it('lässt sich von einer Lücke mitten in der Historie nicht abschrecken', () => {
    // Zwei Monate Pause bedeuten nicht, dass davor nichts war.
    let stand: ImportStand = { ...LEERER_STAND }
    stand = standNachMonaten(stand, [befund('2026-09', ['2026-09-01'])])
    stand = standNachMonaten(stand, [befund('2026-08'), befund('2026-07')])
    expect(stand.leereMonate).toBe(2)
    stand = standNachMonaten(stand, [befund('2026-06', ['2026-06-15'])])
    expect(stand.leereMonate).toBe(0)
    expect(stand.fertig).toBe(false)
    expect(stand.aeltesterTag).toBe('2026-06-15')
  })

  it('hört nach genug leeren Monaten in Folge auf', () => {
    let stand: ImportStand = { ...LEERER_STAND }
    for (let i = 0; i < LEERE_MONATE_BIS_ENDE; i++) {
      expect(stand.fertig, `nach ${i} leeren Monaten`).toBe(false)
      stand = standNachMonaten(stand, [befund(`2026-${String(12 - i).padStart(2, '0')}`)])
    }
    expect(stand.fertig).toBe(true)
  })

  it('hört am Boden auf, auch wenn immer weiter leere Monate kämen', () => {
    // Der Fall, in dem FatSecret nicht mit einem Fehler antwortet, sondern
    // beliebig weit zurück leere Monate liefert.
    const stand = standNachMonaten(
      { ...LEERER_STAND, leereMonate: 0 }, [befund(FRUEHESTER_MONAT, ['2006-01-05'])],
    )
    expect(stand.fertig).toBe(true)
  })

  it('verarbeitet die Befunde von neu nach alt, egal wie sie ankommen', () => {
    const durcheinander = standNachMonaten(LEERER_STAND, [
      befund('2026-07', ['2026-07-01']), befund('2026-09'), befund('2026-08'),
    ])
    // Die beiden leeren Monate liegen NACH dem gefüllten – der Zähler steht
    // danach auf 0, nicht auf 2.
    expect(durcheinander.geprueftBis).toBe('2026-07')
    expect(durcheinander.leereMonate).toBe(0)
  })

  it('ist wiederaufnehmbar: derselbe Stand ergibt denselben nächsten Schritt', () => {
    const stand = standNachMonaten(LEERER_STAND, [befund('2026-09', ['2026-09-02'])])
    const kopie: ImportStand = JSON.parse(JSON.stringify(stand))
    expect(naechsteMonate(kopie, 2, HEUTE)).toEqual(naechsteMonate(stand, 2, HEUTE))
    expect(naechsteMonate(kopie, 1, HEUTE)).toEqual(['2026-08'])
  })
})

/* ------------------------------------------------ Monatsübersicht auslesen */

describe('Antwort von food_entries.get_month.v2', () => {
  it('liest die Tage eines Monats', () => {
    const roh = {
      month: {
        day: [
          { date_int: '20708', calories: '2380' },
          { date_int: '20709', calories: '2100' },
        ],
        from_date_int: '20698', to_date_int: '20727',
      },
    }
    expect(parseMonthDays(roh)).toEqual(['2026-09-12', '2026-09-13'])
  })

  it('kommt mit einem einzigen Tag zurecht', () => {
    // FatSecrets bekannte Falle: bei genau einem Eintrag ein Objekt statt
    // einer Liste. Wer nur .map() aufruft, verliert diesen Monat still.
    expect(parseMonthDays({ month: { day: { date_int: '20708' } } })).toEqual(['2026-09-12'])
  })

  it('hält einen leeren Monat für leer und nicht für kaputt', () => {
    expect(parseMonthDays({ month: {} })).toEqual([])
    expect(parseMonthDays({})).toEqual([])
    expect(parseMonthDays(null)).toEqual([])
  })

  it('wirft doppelte Tage weg und sortiert', () => {
    const roh = { month: { day: [{ date_int: '20709' }, { date_int: '20708' }, { date_int: '20709' }] } }
    expect(parseMonthDays(roh)).toEqual(['2026-09-12', '2026-09-13'])
  })

  it('überspringt Tage ohne Datum, statt aufzugeben', () => {
    const roh = { month: { day: [{ calories: '100' }, { date_int: '20708' }] } }
    expect(parseMonthDays(roh)).toEqual(['2026-09-12'])
  })
})

/* ---------------------------------------------------- Der laufende Abgleich */

describe('Was ein gewöhnlicher Abgleich nachholt', () => {
  it('sieht die letzten Tage erneut an, nicht nur heute', () => {
    const tage = nachzuholendeTage(HEUTE, addDays, 3)
    expect(tage).toEqual(['2026-09-13', '2026-09-12', '2026-09-11'])
  })

  it('deckt heute, gestern und vorgestern ab – genau das und nicht mehr', () => {
    // Drei Tage sind Absicht: In FatSecret wird abends nachgetragen und am
    // nächsten Tag korrigiert, das muss ankommen. Weiter zurück kostet je Tag
    // einen Aufruf und bringt nichts – die Historie wurde einmal vollständig
    // geholt. Wer einen alten Tag ändert, stößt den Historienabgleich an.
    expect(nachzuholendeTage(HEUTE, addDays))
      .toEqual(['2026-09-13', '2026-09-12', '2026-09-11'])
  })
})

describe('Historie erneut abgleichen', () => {
  it('setzt den Suchfortschritt zurück, nicht das Ergebnis', () => {
    // Der Fall: In FatSecret wird ein Tag von vor drei Monaten korrigiert. Der
    // laufende Abgleich sieht nur drei Tage zurück und bekäme davon nichts mit.
    const fertig: ImportStand = {
      geprueftBis: '2023-01', leereMonate: 12, fertig: true,
      aeltesterTag: '2023-05-02', gefundeneTage: 812, zuletzt: '2026-09-13T10:00:00Z',
    }
    const neu = standFuerNeuenLauf(fertig)

    expect(neu.fertig).toBe(false)
    expect(neu.geprueftBis).toBeNull()
    expect(neu.leereMonate).toBe(0)
    // Was gefunden wurde, bleibt bekannt – der Lauf beginnt die SUCHE neu,
    // nicht die Datenhaltung.
    expect(neu.aeltesterTag).toBe('2023-05-02')
    expect(neu.gefundeneTage).toBe(812)
  })

  it('lässt den Lauf wieder beim laufenden Monat beginnen', () => {
    const neu = standFuerNeuenLauf({ ...LEERER_STAND, geprueftBis: '2023-01', fertig: true })
    expect(naechsteMonate(neu, 2, HEUTE)).toEqual(['2026-09', '2026-08'])
  })
})

describe('Wann automatisch abgeglichen wird', () => {
  const jetzt = Date.parse('2026-09-13T12:00:00Z')

  it('beim allerersten Mal sofort', () => {
    expect(abgleichFaellig(null, jetzt)).toBe(true)
  })

  it('nicht gleich noch einmal', () => {
    expect(abgleichFaellig('2026-09-13T11:58:00Z', jetzt)).toBe(false)
  })

  it('nach einer Viertelstunde wieder', () => {
    expect(abgleichFaellig('2026-09-13T11:44:00Z', jetzt)).toBe(true)
  })

  it('auch bei einem unbrauchbaren Zeitstempel', () => {
    // Lieber einmal zu viel abgleichen als wegen eines kaputten Werts nie.
    expect(abgleichFaellig('kein-datum', jetzt)).toBe(true)
  })
})
