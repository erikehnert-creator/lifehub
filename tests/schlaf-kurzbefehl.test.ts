/**
 * Was ein iOS-Kurzbefehl wirklich abschickt – und was davon angenommen wird.
 *
 * ---------------------------------------------------------------------------
 * Der gemeldete Fehler
 *
 * Der erste Versuch setzte im Anfragetext (JSON) das Feld `proben` auf die
 * Variable `Proben`. Der Endpunkt antwortete:
 *
 *     {"hoechstzahl":2000,"fehler":"Feld „proben" fehlt oder ist keine Liste"}
 *
 * Kurzbefehle macht aus einer Liste je nach Fassung eine Zeichenkette, eine
 * Liste von Zeichenketten oder etwas dazwischen – aber nur selten das Array
 * aus Objekten, das gebraucht wurde. Der Kurzbefehl war nicht falsch bedient;
 * die Schnittstelle verlangte etwas, das dort kaum herzustellen ist.
 *
 * ---------------------------------------------------------------------------
 * Was dieser Test festhält
 *
 * Jede Form, die im Kurzbefehl ohne Klimmzüge entsteht, muss ankommen – und
 * jede davon muss danach dieselbe strenge Prüfung durchlaufen. Die Nachsicht
 * gilt der Verpackung, nicht dem Inhalt.
 */
import { describe, it, expect } from 'vitest'
import {
  pruefeRumpf, probenAusText, baueNaechte, deute, FELDTRENNER, HOECHSTZAHL_PROBEN,
} from '../supabase/functions/schlaf/aggregat'

const A = '2026-09-28T23:00:00+02:00'
const B = '2026-09-29T07:00:00+02:00'

const alsObjekt = { start: A, ende: B, wert: 'AsleepCore', quelle: 'Sleep Cycle' }
const alsZeile = `${A}${FELDTRENNER}${B}${FELDTRENNER}AsleepCore${FELDTRENNER}Sleep Cycle`

/** Jede angenommene Form muss zu genau derselben Probe führen. */
const erwartet = { start: A, ende: B, wert: 'AsleepCore', quelle: 'Sleep Cycle' }

describe('Die Formen, die Kurzbefehle erzeugt', () => {
  it('das saubere Array bleibt gültig', () => {
    const e = pruefeRumpf({ proben: [alsObjekt] })
    expect(e.ok).toBe(true)
    expect(e.proben![0]).toEqual(erwartet)
  })

  it('proben als JSON-TEXT – der gemeldete Fall', () => {
    const e = pruefeRumpf({ proben: JSON.stringify([alsObjekt]) })
    expect(e.ok).toBe(true)
    expect(e.proben![0]).toEqual(erwartet)
  })

  it('proben als aneinandergehängte Objekte mit Komma am Ende', () => {
    // Genau das entsteht, wenn man in einer Schleife Text zusammenhaengt.
    const text = `${JSON.stringify(alsObjekt)},${JSON.stringify(alsObjekt)},`
    const e = pruefeRumpf({ proben: text })
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(2)
  })

  it('proben als Objekte, nur durch Zeilenumbruch getrennt', () => {
    const text = `${JSON.stringify(alsObjekt)}\n${JSON.stringify(alsObjekt)}`
    const e = pruefeRumpf({ proben: text })
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(2)
  })

  it('proben in der Zeilenform – ganz ohne Klammern und Anführungszeichen', () => {
    const e = pruefeRumpf({ proben: `${alsZeile}\n${alsZeile}` })
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(2)
    expect(e.proben![0]).toEqual(erwartet)
  })

  it('proben als LISTE VON TEXTEN in Zeilenform', () => {
    // Kurzbefehle schickt eine Liste mitunter als Liste von Texten.
    const e = pruefeRumpf({ proben: [alsZeile, alsZeile] })
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(2)
    expect(e.proben![1]).toEqual(erwartet)
  })

  it('der ganze Rumpf als Text, ohne Umschlag', () => {
    const e = pruefeRumpf(alsZeile)
    expect(e.ok).toBe(true)
    expect(e.proben![0]).toEqual(erwartet)
  })

  it('das Array ohne Umschlag', () => {
    const e = pruefeRumpf([alsObjekt])
    expect(e.ok).toBe(true)
    expect(e.proben![0]).toEqual(erwartet)
  })

  it('ein einzelnes Objekt ohne Liste', () => {
    const e = pruefeRumpf({ proben: JSON.stringify(alsObjekt) })
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(1)
  })

  it('englische Feldnamen funktionieren weiterhin', () => {
    const e = pruefeRumpf({ samples: [{ startDate: A, endDate: B, value: 'Asleep', source: 'Watch' }] })
    expect(e.ok).toBe(true)
    expect(e.proben![0].quelle).toBe('Watch')
  })

  it('Zeilenform ohne Quelle ist erlaubt', () => {
    const e = pruefeRumpf({ proben: `${A}${FELDTRENNER}${B}${FELDTRENNER}Asleep` })
    expect(e.ok).toBe(true)
    expect(e.proben![0].quelle).toBeUndefined()
  })

  it('Leerzeichen und Windows-Zeilenenden stören nicht', () => {
    const e = pruefeRumpf({ proben: `  ${alsZeile}  \r\n\r\n  ${alsZeile}\r\n` })
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(2)
  })

  it('alle Formen ergeben dieselbe Nacht', () => {
    const formen = [
      { proben: [alsObjekt] },
      { proben: JSON.stringify([alsObjekt]) },
      { proben: alsZeile },
      { proben: [alsZeile] },
      alsZeile,
    ]
    const naechte = formen.map((f) => baueNaechte(pruefeRumpf(f).proben!))
    for (const n of naechte) expect(n).toEqual(naechte[0])
    expect(naechte[0][0].duration_min).toBe(480)
  })
})

/* ------------------------------------------ Die iOS-Anführungszeichenfalle */

describe('Typografische Anführungszeichen', () => {
  const krumm = `{\u201Cstart\u201D:\u201C${A}\u201D,\u201Cende\u201D:\u201C${B}\u201D,\u201Cwert\u201D:\u201CAsleep\u201D}`

  it('werden geradegezogen, statt die Sendung zu verwerfen', () => {
    // iOS ersetzt beim Tippen " durch " und " - auch in Kurzbefehlen.
    const e = pruefeRumpf({ proben: krumm })
    expect(e.ok).toBe(true)
    expect(e.proben![0].start).toBe(A)
  })

  it('ein sauberer Rumpf wird dabei nicht angefasst', () => {
    const e = pruefeRumpf({ proben: JSON.stringify([{ ...alsObjekt, quelle: 'Sleep "Cycle"' }]) })
    expect(e.ok).toBe(true)
    expect(e.proben![0].quelle).toBe('Sleep "Cycle"')
  })

  it('bleibt es kaputt, nennt die Meldung die Ursache', () => {
    const e = pruefeRumpf({ proben: '{\u201Cstart\u201D:\u201Cunfug' })
    expect(e.ok).toBe(false)
    expect(e.fehler).toMatch(/Interpunktion|typografisch/i)
  })
})

/* --------------------------------------------- Streng bleibt streng */

describe('Was weiterhin abgewiesen wird', () => {
  it('ein fehlendes Feld proben', () => {
    const e = pruefeRumpf({})
    expect(e.ok).toBe(false)
    expect(e.fehler).toContain('proben')
  })

  it('eine leere Sendung', () => {
    expect(pruefeRumpf({ proben: [] }).ok).toBe(false)
    expect(pruefeRumpf({ proben: '' }).ok).toBe(false)
    expect(pruefeRumpf({ proben: '   ' }).ok).toBe(false)
  })

  it('eine Zahl statt Proben', () => {
    expect(pruefeRumpf({ proben: 42 }).ok).toBe(false)
  })

  it('ein kaputter Zeitpunkt – egal in welcher Form', () => {
    expect(pruefeRumpf({ proben: [{ ...alsObjekt, start: 'gestern' }] }).ok).toBe(false)
    expect(pruefeRumpf({ proben: `gestern${FELDTRENNER}${B}${FELDTRENNER}Asleep` }).ok).toBe(false)
    expect(pruefeRumpf({ proben: [`gestern${FELDTRENNER}${B}${FELDTRENNER}Asleep`] }).ok).toBe(false)
  })

  it('eine Probe ohne Wert', () => {
    expect(pruefeRumpf({ proben: `${A}${FELDTRENNER}${B}${FELDTRENNER}` }).ok).toBe(false)
  })

  it('eine Zeile mit zu wenigen oder zu vielen Feldern', () => {
    const zuWenig = pruefeRumpf({ proben: `${A}${FELDTRENNER}${B}` })
    expect(zuWenig.ok).toBe(false)
    expect(zuWenig.fehler).toContain('Zeile 1')
    expect(pruefeRumpf({ proben: `${A}|${B}|Asleep|Quelle|zuviel` }).ok).toBe(false)
  })

  it('eine Probe, die vor ihrem Beginn endet', () => {
    expect(pruefeRumpf({ proben: `${B}${FELDTRENNER}${A}${FELDTRENNER}Asleep` }).ok).toBe(false)
  })

  it('die Höchstzahl gilt in JEDER Form', () => {
    const vieleObjekte = Array.from({ length: HOECHSTZAHL_PROBEN + 1 }, () => alsObjekt)
    expect(pruefeRumpf({ proben: vieleObjekte }).ok).toBe(false)

    const vieleZeilen = Array.from({ length: HOECHSTZAHL_PROBEN + 1 }, () => alsZeile).join('\n')
    const e = pruefeRumpf({ proben: vieleZeilen })
    expect(e.ok).toBe(false)
    expect(e.fehler).toContain('Zu viele')
  })

  it('genau die Höchstzahl geht noch durch', () => {
    const grenze = Array.from({ length: HOECHSTZAHL_PROBEN }, () => alsZeile).join('\n')
    expect(pruefeRumpf({ proben: grenze }).ok).toBe(true)
  })

  it('eine Quellenangabe wird weiterhin gekürzt', () => {
    const e = pruefeRumpf({ proben: `${A}${FELDTRENNER}${B}${FELDTRENNER}Asleep${FELDTRENNER}${'x'.repeat(400)}` })
    expect(e.proben![0].quelle!.length).toBe(120)
  })
})

/* ---------------------------------------------------- probenAusText allein */

describe('probenAusText', () => {
  it('meldet einen leeren Text', () => {
    expect(probenAusText('').ok).toBe(false)
    expect(probenAusText('   ').ok).toBe(false)
  })

  it('erkennt JSON am ersten Zeichen', () => {
    expect(probenAusText('[]').roh).toEqual([])
    expect(probenAusText('{"a":1}').roh).toEqual([{ a: 1 }])
  })

  it('nennt die Zeilennummer, wenn eine Zeile nicht passt', () => {
    const e = probenAusText(`${alsZeile}\nunfug`)
    expect(e.ok).toBe(false)
    expect(e.fehler).toContain('Zeile 2')
  })
})

/* ------------------------------------------- Deutsches iPhone */

describe('Werte von einem deutschen iPhone', () => {
  it('erkennt die uebersetzten Namen', () => {
    // Kurzbefehle gibt den Wert in der Sprache des Geraets zurueck. Ohne
    // diese Zeilen faende der Import auf einem deutschen iPhone GAR NICHTS
    // und meldete "keine auswertbaren Schlafproben" - ohne dass etwas
    // kaputt waere.
    expect(deute('Im Bett')!.art).toBe('bett')
    expect(deute('Wach')!.art).toBe('wach')
    expect(deute('Kernschlaf')).toEqual({ art: 'schlaf', phase: 'core' })
    expect(deute('Tiefschlaf')).toEqual({ art: 'schlaf', phase: 'deep' })
    expect(deute('REM-Schlaf')).toEqual({ art: 'schlaf', phase: 'rem' })
    expect(deute('Schlafen')).toEqual({ art: 'schlaf', phase: 'unbekannt' })
  })

  it('haelt die Phasen auseinander, obwohl alle „schlaf" enthalten', () => {
    // Die Reihenfolge der Pruefungen traegt hier die Bedeutung.
    const phasen = ['Kernschlaf', 'Tiefschlaf', 'REM-Schlaf'].map((w) => deute(w)!.phase)
    expect(new Set(phasen).size).toBe(3)
  })

  it('eine ganze deutsche Nacht rechnet richtig', () => {
    const e = pruefeRumpf({
      proben: [
        `2026-09-28T23:00:00+02:00|2026-09-29T01:00:00+02:00|Kernschlaf|Sleep Cycle`,
        `2026-09-29T01:00:00+02:00|2026-09-29T02:30:00+02:00|Tiefschlaf|Sleep Cycle`,
        `2026-09-29T02:30:00+02:00|2026-09-29T07:00:00+02:00|Kernschlaf|Sleep Cycle`,
        `2026-09-28T22:45:00+02:00|2026-09-29T07:05:00+02:00|Im Bett|Sleep Cycle`,
      ].join('\n'),
    })
    expect(e.ok).toBe(true)
    const [nacht] = baueNaechte(e.proben!)
    expect(nacht.day).toBe('2026-09-29')
    expect(nacht.duration_min).toBe(480)        // 8 h, "Im Bett" zaehlt NICHT mit
    expect(nacht.deep_min).toBe(90)
    expect(nacht.core_min).toBe(120 + 270)
  })

  it('englische Werte funktionieren unveraendert weiter', () => {
    expect(deute('AsleepCore')).toEqual({ art: 'schlaf', phase: 'core' })
    expect(deute('HKCategoryValueSleepAnalysisAsleepDeep')!.phase).toBe('deep')
    expect(deute('InBed')!.art).toBe('bett')
  })
})
