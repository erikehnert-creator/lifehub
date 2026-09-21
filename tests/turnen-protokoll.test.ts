/**
 * Der Protokollleser – gegen ein echtes Wettkampfprotokoll.
 *
 * Grundlage ist das PDF der Sächsischen Einzelmeisterschaften männlich vom
 * 10.05.2026 (Wettkampfsoftware SCORE), 12 Seiten, 95 Teilnehmer.
 *
 * ---------------------------------------------------------------------------
 * Warum hier ein Textbestand liegt und keine PDF
 *
 * Dieses Repository ist öffentlich, und das Protokoll enthält Namen, Jahrgänge
 * und Vereine von 95 Teilnehmern, überwiegend Minderjährigen. Der Bestand in
 * `fixtures/protokoll-score-2026.json` trägt deshalb **ersetzte Namen** –
 * alles andere ist unverändert: Ränge, Jahrgänge, Vereine, sämtliche Zahlen,
 * Abzüge, Kennzeichnungen, Nullwerte und die drei fehlenden Jahrgänge.
 * Eriks eigene Zeile steht im Klartext, weil es seine eigenen Daten sind.
 *
 * Neu erzeugen (auch aus einem anderen Protokoll):
 *
 *   node scripts/protokoll-fixture.mjs <pdf> tests/fixtures/<name>.json --behalte Ehnert
 *
 * Gegen das echte PDF samt Klarnamen läuft derselbe Test örtlich mit
 * `--klar` in ein Ziel ausserhalb des Repositories.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseProtokoll, ProtokollFehler, stimmtRechnung, findeNamen,
  PROTOKOLL_GERAETE, type TextStueck, type Teilnehmer,
} from '../supabase/functions/wettkampf-import/protokoll'
import { GERAETE } from '../src/core/turnen/geraete'

const seiten: TextStueck[][] = JSON.parse(
  readFileSync(new URL('./fixtures/protokoll-score-2026.json', import.meta.url), 'utf8'))

const ergebnis = parseProtokoll(seiten)

/** Ein Teilnehmer, sicher gefunden. */
const wer = (name: string): Teilnehmer => {
  const t = ergebnis.teilnehmer.filter((x) => x.name.wert === name)
  expect(t, `genau ein Teilnehmer „${name}"`).toHaveLength(1)
  return t[0]
}

/** Die drei Zahlen eines Geräts, kurz. */
const werte = (t: Teilnehmer, apparatus: string) => {
  const g = t.geraete.find((x) => x.apparatus === apparatus)!
  return [g.d.wert, g.e.wert, g.final.wert]
}

/* ==================================================== Wettkampf und Umfang */

describe('Protokollkopf', () => {
  it('liest Name, Ort und Datum getrennt', () => {
    expect(ergebnis.wettkampf.name.wert).toBe('Sächsische Einzelmeisterschaften männlich')
    expect(ergebnis.wettkampf.ort.wert).toBe('Bannewitz')
    expect(ergebnis.wettkampf.tag.wert).toBe('2026-05-10')
    expect(ergebnis.wettkampf.name.sicherheit).toBe('exact')
    expect(ergebnis.wettkampf.ort.sicherheit).toBe('exact')
  })

  it('liest alle zwölf Seiten', () => {
    expect(ergebnis.seiten).toBe(12)
  })

  it('findet alle 95 Teilnehmer', () => {
    expect(ergebnis.teilnehmer).toHaveLength(95)
  })

  it('kommt ohne Warnungen durch', () => {
    expect(ergebnis.warnungen).toEqual([])
  })

  it('kennt die zwölf Klassen', () => {
    const klassen = [...new Set(ergebnis.teilnehmer.map((t) => t.klasse))]
    expect(klassen).toEqual([
      'LK 1 AK 16/17', 'LK 1 AK 18-29', 'LK 2 AK -13', 'LK 2 AK 14/15',
      'LK 2 AK 16/17', 'LK 2 AK 18-29', 'LK 3 AK -13', 'LK 3 AK 14/15',
      'LK 3 AK 16/17', 'LK 3 AK 18-29', 'LK 4 AK -11', 'LK 4 AK 12/13',
    ])
  })

  it('gibt jedem Teilnehmer sechs Geräte in fester Reihenfolge', () => {
    for (const t of ergebnis.teilnehmer) {
      expect(t.geraete.map((g) => g.apparatus)).toEqual(
        ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck'])
    }
  })
})

describe('Gerätenamen', () => {
  it('benutzt dieselben Schlüssel wie core/turnen/geraete.ts', () => {
    // Die Liste steht im Parser ein zweites Mal, weil eine Edge Function nicht
    // in das Buendel der App hineinsehen kann. Laufen die beiden auseinander,
    // landen Noten am falschen Geraet.
    expect(PROTOKOLL_GERAETE.map((g) => g.apparatus)).toEqual(GERAETE.map((g) => g.key))
  })
})

/* ================================================ Der Prüfstein: Erik Ehnert */

describe('Erik Ehnert – die Werte aus dem echten Protokoll', () => {
  const erik = wer('Ehnert, Erik')

  it('steht in der richtigen Klasse auf Rang 2', () => {
    expect(erik.klasse).toBe('LK 2 AK 18-29')
    expect(erik.rang.wert).toBe(2)
    expect(erik.seite).toBe(6)
  })

  it('nennt Jahrgang und Verein', () => {
    expect(erik.jahrgang.wert).toBe(2006)
    expect(erik.verein.wert).toBe('SG Empor Possendorf')
  })

  it('liest die sechs D-Werte', () => {
    expect(erik.geraete.map((g) => g.d.wert)).toEqual([2.9, 3.1, 3.3, 1.9, 2.9, 2.1])
  })

  it('liest die sechs E-Werte', () => {
    expect(erik.geraete.map((g) => g.e.wert)).toEqual([8.666, 8.266, 8.366, 9.1, 8.733, 7.85])
  })

  it('liest die sechs Endnoten', () => {
    expect(erik.geraete.map((g) => g.final.wert))
      .toEqual([11.566, 11.366, 11.666, 11, 11.633, 9.95])
  })

  it('liest die Gesamtpunktzahl', () => {
    expect(erik.gesamt.wert).toBe(67.181)
  })

  it('ordnet jedes Gerät richtig zu', () => {
    expect(werte(erik, 'boden')).toEqual([2.9, 8.666, 11.566])
    expect(werte(erik, 'pauschenpferd')).toEqual([3.1, 8.266, 11.366])
    expect(werte(erik, 'ringe')).toEqual([3.3, 8.366, 11.666])
    expect(werte(erik, 'sprung')).toEqual([1.9, 9.1, 11])
    expect(werte(erik, 'barren')).toEqual([2.9, 8.733, 11.633])
    expect(werte(erik, 'reck')).toEqual([2.1, 7.85, 9.95])
  })

  it('trägt nirgends einen Abzug ein, wo keiner steht', () => {
    for (const g of erik.geraete) {
      expect(g.penalty.wert).toBeNull()
      expect(g.penalty.sicherheit).toBe('missing')
    }
  })

  it('hat alles als sicher erkannt', () => {
    expect(erik.name.sicherheit).toBe('exact')
    expect(erik.rang.sicherheit).toBe('exact')
    for (const g of erik.geraete) {
      expect([g.d.sicherheit, g.e.sicherheit, g.final.sicherheit])
        .toEqual(['exact', 'exact', 'exact'])
    }
  })

  it('geht in jeder Zeile rechnerisch auf', () => {
    // Beschreibend, nicht korrigierend - aber bei diesem Protokoll stimmt es.
    for (const g of erik.geraete) expect(stimmtRechnung(g)).toBe(true)
  })
})

/* ====================================================== Weitere Teilnehmer */

describe('Andere Teilnehmer', () => {
  it('liest einen zweiten Teilnehmer derselben Seite', () => {
    // Rang 1 auf Seite 6, dieselbe Klasse wie Erik.
    const seite6 = ergebnis.teilnehmer.filter((t) => t.seite === 6)
    expect(seite6).toHaveLength(6)
    const erster = seite6.find((t) => t.rang.wert === 1)!
    expect(erster.klasse).toBe('LK 2 AK 18-29')
    expect(erster.verein.wert).toBe('SG Empor Possendorf')
    expect(erster.geraete.map((g) => g.d.wert)).toEqual([4.8, 2.5, 3.4, 2.7, 3.1, 2.7])
    expect(erster.gesamt.wert).toBe(68.299)
  })

  it('liest einen Teilnehmer einer anderen Seite', () => {
    const seite1 = ergebnis.teilnehmer.filter((t) => t.seite === 1)
    const erster = seite1.find((t) => t.rang.wert === 1)!
    expect(erster.klasse).toBe('LK 1 AK 16/17')
    expect(erster.gesamt.wert).toBe(67.498)
    expect(werte(erster, 'boden')).toEqual([3.3, 7.533, 10.833])
    expect(werte(erster, 'reck')).toEqual([3.1, 6.7, 9.8])
  })

  it('verwechselt keine Klassen', () => {
    // Zwei Teilnehmer mit Rang 2 gibt es viele - jeder auf seiner Seite.
    const rang2 = ergebnis.teilnehmer.filter((t) => t.rang.wert === 2)
    expect(rang2.length).toBeGreaterThan(5)
    expect(new Set(rang2.map((t) => t.klasse)).size).toBe(rang2.length)
  })

  it('liest zweistellige Ränge', () => {
    const zweistellig = ergebnis.teilnehmer.filter((t) => (t.rang.wert ?? 0) >= 10)
    expect(zweistellig).toHaveLength(20)
    const hoechster = Math.max(...ergebnis.teilnehmer.map((t) => t.rang.wert ?? 0))
    expect(hoechster).toBe(17)
    const siebzehn = ergebnis.teilnehmer.find((t) => t.rang.wert === 17)!
    expect(siebzehn.klasse).toBe('LK 3 AK 18-29')
    expect(siebzehn.gesamt.wert).toBe(52.249)
  })
})

/* ========================================================== Sonderfälle */

describe('Abzüge', () => {
  const mitAbzug = ergebnis.teilnehmer.filter(
    (t) => t.geraete.some((g) => g.penalty.wert !== null))

  it('findet die zwölf Zeilen mit Abzug', () => {
    expect(mitAbzug).toHaveLength(12)
  })

  it('führt den Abzug als Betrag, nicht mit dem Vorzeichen des Protokolls', () => {
    const alle = ergebnis.teilnehmer.flatMap((t) => t.geraete)
      .filter((g) => g.penalty.wert !== null)
    expect(alle).toHaveLength(13)
    for (const g of alle) expect(g.penalty.wert!).toBeGreaterThan(0)
    expect([...new Set(alle.map((g) => g.penalty.wert))].sort((a, b) => a! - b!))
      .toEqual([0.3, 1, 2, 3, 4])
  })

  it('verschiebt durch den Abzug weder D noch E noch die Endnote', () => {
    // Seite 6, Rang 6: Ringe 2.4 / 7.733 / Abzug 1.0 / Endnote 9.133.
    const t = ergebnis.teilnehmer.find((x) => x.seite === 6 && x.rang.wert === 6)!
    const ringe = t.geraete.find((g) => g.apparatus === 'ringe')!
    expect([ringe.d.wert, ringe.e.wert, ringe.penalty.wert, ringe.final.wert])
      .toEqual([2.4, 7.733, 1, 9.133])
    // Die Nachbargeraete bleiben unberuehrt.
    expect(werte(t, 'pauschenpferd')).toEqual([2.9, 7.266, 10.166])
    expect(werte(t, 'sprung')).toEqual([1.8, 8.45, 10.25])
    expect(t.gesamt.wert).toBe(60.565)
  })

  it('rechnet bei jedem Abzug auf', () => {
    for (const g of ergebnis.teilnehmer.flatMap((t) => t.geraete)) {
      if (g.penalty.wert !== null) expect(stimmtRechnung(g)).toBe(true)
    }
  })
})

describe('Kennzeichnung (+)', () => {
  const mitPlus = ergebnis.teilnehmer.filter((t) => t.geraete.some((g) => g.marker.length))

  it('findet die elf Zeilen mit (+)', () => {
    expect(mitPlus).toHaveLength(11)
  })

  it('führt die Kennzeichnung unverändert mit, ohne sie zu deuten', () => {
    const alle = ergebnis.teilnehmer.flatMap((t) => t.geraete).filter((g) => g.marker.length)
    expect([...new Set(alle.flatMap((g) => g.marker))]).toEqual(['(+)'])
  })

  it('nimmt die Kennzeichnung aus dem D-Wert heraus, ohne ihn zu verfälschen', () => {
    // Seite 6, Rang 3: Sprung „1.9 (+)" / 8.950 / 10.850.
    const t = ergebnis.teilnehmer.find((x) => x.seite === 6 && x.rang.wert === 3)!
    const sprung = t.geraete.find((g) => g.apparatus === 'sprung')!
    expect(sprung.d.wert).toBe(1.9)
    expect(sprung.d.roh).toBe('1.9 (+)')
    expect(sprung.e.wert).toBe(8.95)
    expect(sprung.final.wert).toBe(10.85)
    expect(sprung.marker).toEqual(['(+)'])
    expect(stimmtRechnung(sprung)).toBe(true)
  })
})

describe('Nullwerte', () => {
  it('liest eine echte 0 als 0 und nicht als fehlend', () => {
    // Seite 1, Rang 6: Boden 0.0 / 0.000 / 0.000.
    const t = ergebnis.teilnehmer.find((x) => x.seite === 1 && x.rang.wert === 6)!
    const boden = t.geraete.find((g) => g.apparatus === 'boden')!
    expect(boden.d.wert).toBe(0)
    expect(boden.e.wert).toBe(0)
    expect(boden.final.wert).toBe(0)
    expect(boden.d.sicherheit).toBe('exact')
    expect(boden.final.sicherheit).toBe('exact')
  })

  it('unterscheidet 0 von fehlend', () => {
    const t = ergebnis.teilnehmer.find((x) => x.seite === 1 && x.rang.wert === 6)!
    const boden = t.geraete.find((g) => g.apparatus === 'boden')!
    // Die Note ist 0 und vorhanden, der Abzug fehlt.
    expect(boden.final.wert).toBe(0)
    expect(boden.final.sicherheit).toBe('exact')
    expect(boden.penalty.wert).toBeNull()
    expect(boden.penalty.sicherheit).toBe('missing')
  })

  it('kommt mit 0 plus Abzug zurecht', () => {
    // Dieselbe Zeile, Reck: 0.0 / 6.950 / Abzug 4.0 / Endnote 2.950.
    const t = ergebnis.teilnehmer.find((x) => x.seite === 1 && x.rang.wert === 6)!
    const reck = t.geraete.find((g) => g.apparatus === 'reck')!
    expect([reck.d.wert, reck.e.wert, reck.penalty.wert, reck.final.wert])
      .toEqual([0, 6.95, 4, 2.95])
    expect(stimmtRechnung(reck)).toBe(true)
  })
})

describe('Mehrzeilige und unvollständige Teilnehmerblöcke', () => {
  it('liest Name und Jahrgang aus zwei Zeilen derselben Spalte', () => {
    const erik = wer('Ehnert, Erik')
    expect(erik.name.wert).toBe('Ehnert, Erik')
    expect(erik.jahrgang.wert).toBe(2006)
  })

  it('kommt ohne Jahrgang aus, ohne den Verein in den Namen zu ziehen', () => {
    // Drei Teilnehmer dieses Protokolls haben keinen Jahrgang. Im Fliesstext
    // stuende dort "Nachname, Vorname TV zu Beispielheim-Süd" ohne Trennung - ueber die
    // Spalten sind es zwei Bloecke.
    const ohne = ergebnis.teilnehmer.filter((t) => t.jahrgang.sicherheit === 'missing')
    expect(ohne).toHaveLength(3)
    for (const t of ohne) {
      expect(t.verein.wert).toBe('TV zu Beispielheim-Süd')
      expect(t.name.wert).not.toContain('TV zu')
      expect(t.name.sicherheit).toBe('exact')
    }
  })

  it('liest mehrteilige Vereinsnamen vollständig', () => {
    const vereine = new Set(ergebnis.teilnehmer.map((t) => t.verein.wert))
    expect(vereine.has('ESV Musterstadt')).toBe(true)
    expect(vereine.has('KTV Musterstadt')).toBe(true)
    expect(vereine.has('TSV Musterau')).toBe(true)
  })
})

/* ====================================================== Namenssuche */

describe('findeNamen', () => {
  it('findet Erik unabhängig von der Schreibreihenfolge', () => {
    expect(findeNamen(ergebnis.teilnehmer, 'Erik Ehnert')).toHaveLength(1)
    expect(findeNamen(ergebnis.teilnehmer, 'Ehnert, Erik')).toHaveLength(1)
    expect(findeNamen(ergebnis.teilnehmer, 'ehnert')).toHaveLength(1)
  })

  it('findet niemanden, wenn niemand passt', () => {
    expect(findeNamen(ergebnis.teilnehmer, 'Mustermann')).toEqual([])
    expect(findeNamen(ergebnis.teilnehmer, '')).toEqual([])
  })

  it('gibt bei mehreren Treffern alle zurück', () => {
    // "Vorname0" passt auf alle ersetzten Namen des Bestands.
    const viele = findeNamen(ergebnis.teilnehmer, 'Vorname0')
    expect(viele.length).toBeGreaterThan(1)
    // Und sie bleiben ueber Jahrgang, Verein und Klasse unterscheidbar.
    const kennungen = viele.map((t) => `${t.klasse}|${t.rang.wert}`)
    expect(new Set(kennungen).size).toBe(viele.length)
  })
})

/* ========================================================= Ablehnungen */

describe('PDFs, die LifeHub nicht lesen kann', () => {
  it('lehnt eine PDF ohne Textebene ab', () => {
    expect(() => parseProtokoll([[], [], []]))
      .toThrowError(/keinen lesbaren Text/)
    try { parseProtokoll([[]]) } catch (e) {
      expect((e as ProtokollFehler).code).toBe('keine_textebene')
    }
  })

  it('lehnt ein unbekanntes Tabellenformat ab, statt zu raten', () => {
    const fremd: TextStueck[][] = [[
      { text: 'Irgendein Turnier', x: 300, y: 550 },
      { text: 'Musterstadt, 01.01.2027', x: 700, y: 530 },
      { text: 'Platz', x: 31, y: 509 },
      { text: 'Sportler', x: 103, y: 509 },
      { text: 'Punkte', x: 225, y: 509 },
      { text: '1', x: 40, y: 480 },
      { text: 'Jemand', x: 60, y: 480 },
      { text: '12.345', x: 225, y: 480 },
    ]]
    expect(() => parseProtokoll(fremd)).toThrowError(/nicht bekannt/)
    try { parseProtokoll(fremd) } catch (e) {
      expect((e as ProtokollFehler).code).toBe('format_unbekannt')
    }
  })

  it('lehnt ein richtiges Format ohne Teilnehmer ab', () => {
    const leer: TextStueck[][] = [[
      { text: 'LK 9 AK 99', x: 369, y: 548 },
      { text: 'Testwettkampf', x: 31, y: 532 },
      { text: 'Musterstadt, 01.01.2027', x: 689, y: 532 },
      ...['Rang', 'Name', 'Verein', 'Boden', 'Pferd', 'Ringe', 'Sprung', 'Barren', 'Reck', 'Gesamt']
        .map((t, i) => ({ text: t, x: 31 + i * 70, y: 509 })),
      { text: 'Seite 1/1', x: 769, y: 26 },
    ]]
    try {
      parseProtokoll(leer)
      throw new Error('haette ablehnen muessen')
    } catch (e) {
      expect((e as ProtokollFehler).code).toBe('keine_teilnehmer')
    }
  })

  it('übergeht eine unvollständige Zeile mit Warnung, statt alles abzubrechen', () => {
    const kopf: TextStueck[] = [
      { text: 'LK 9 AK 99', x: 369, y: 548 },
      { text: 'Testwettkampf', x: 31, y: 532 },
      { text: 'Musterstadt, 01.01.2027', x: 689, y: 532 },
      ...['Rang', 'Name', 'Verein', 'Boden', 'Pferd', 'Ringe', 'Sprung', 'Barren', 'Reck', 'Gesamt']
        .map((t, i) => ({ text: t, x: 31 + i * 70, y: 509 })),
    ]
    // Eine echte Zeile aus dem Bestand plus eine abgeschnittene.
    const echteZeile = seiten[5].filter((s) => s.y >= 461 && s.y <= 470)
    const kaputt: TextStueck[] = [
      { text: '9', x: 40, y: 400 },
      { text: 'Halb, Fertig', x: 60, y: 400 },
      { text: 'SV Nirgendwo', x: 179, y: 400 },
    ]
    const r = parseProtokoll([[...kopf, ...echteZeile, ...kaputt]])
    expect(r.teilnehmer).toHaveLength(1)
    expect(r.teilnehmer[0].name.wert).toBe('Ehnert, Erik')
    expect(r.warnungen).toHaveLength(1)
    expect(r.warnungen[0]).toMatch(/3 statt 16 Spalten/)
  })
})

/* =================================================== Nachrechnen im Ganzen */

describe('stimmtRechnung', () => {
  it('geht im ganzen Protokoll auf – 570 Gerätewertungen', () => {
    const alle = ergebnis.teilnehmer.flatMap((t) => t.geraete)
    expect(alle).toHaveLength(95 * 6)
    const abweichend = alle.filter((g) => stimmtRechnung(g) === false)
    expect(abweichend).toEqual([])
  })

  it('schweigt, wenn ein Wert fehlt', () => {
    expect(stimmtRechnung({
      apparatus: 'boden',
      d: { wert: 4, sicherheit: 'exact', roh: '4.0' },
      e: { wert: null, sicherheit: 'missing', roh: null },
      penalty: { wert: null, sicherheit: 'missing', roh: null },
      final: { wert: 12, sicherheit: 'exact', roh: '12.000' },
      marker: [],
    })).toBeNull()
  })
})
