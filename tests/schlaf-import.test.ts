/**
 * Der Schlafimport: derselbe Morgen zweimal darf keine zweite Nacht ergeben.
 *
 * Zwei Dinge müssen dafür zusammenpassen, die in verschiedenen Welten laufen:
 * die App (Browser) und die Edge Function (Deno). Rechnen sie die ID einer
 * Nacht verschieden, entsteht je Nacht eine zweite Zeile – und weil `day`
 * lokal UNIQUE ist, löscht `INSERT OR REPLACE` beim Holen still die
 * vorhandene. Genau so sind Eriks Ballaststoffwerte verschwunden.
 *
 * Deshalb prüft dieser Test ausdrücklich, dass beide Seiten dieselbe ID
 * ausrechnen – nicht nur, dass jede für sich funktioniert.
 */
import { describe, it, expect } from 'vitest'
import { entscheideSchreiben, baueNaechte, IMPORT_FELDER, type Nacht } from '../supabase/functions/schlaf/aggregat'
import { idAusSchluessel, stableId } from '../supabase/functions/_shared/stabileId'
import { erzeugeToken, tokenAbdruck, siehtWieTokenAus } from '../supabase/functions/_shared/importToken'
import { natuerlicheId, NATUERLICHER_SCHLUESSEL } from '../src/core/natuerlicheSchluessel'

const nacht = (day: string, felder: Partial<Nacht> = {}): Nacht => ({
  day,
  start_at: `${day}T00:00:00+02:00`,
  end_at: `${day}T07:00:00+02:00`,
  duration_min: 420,
  awake_min: null, in_bed_min: null, core_min: null, deep_min: null, rem_min: null,
  source: 'Sleep Cycle',
  ...felder,
})

/* ------------------------------------------------- App und Server einig */

describe('App und Edge Function rechnen dieselbe ID', () => {
  it('für dieselbe Nacht', () => {
    for (const tag of ['2026-09-29', '2026-01-01', '2026-12-31']) {
      const ausDerFunktion = idAusSchluessel('sleep_sessions', tag)
      const ausDerApp = natuerlicheId('sleep_sessions', { day: tag })
      expect(ausDerFunktion).toBe(ausDerApp)
    }
  })

  it('und für verschiedene Nächte verschiedene', () => {
    const a = idAusSchluessel('sleep_sessions', '2026-09-29')
    const b = idAusSchluessel('sleep_sessions', '2026-09-30')
    expect(a).not.toBe(b)
  })

  it('sleep_sessions ist als natürlicher Schlüssel eingetragen', () => {
    // Ohne diesen Eintrag vergaebe die App Zufalls-IDs und der Import
    // abgeleitete - zwei Zeilen je Nacht.
    expect(NATUERLICHER_SCHLUESSEL.sleep_sessions).toBe('day')
  })

  it('die ID hängt am Tag, nicht an der Uhrzeit', () => {
    expect(idAusSchluessel('sleep_sessions', '2026-09-29'))
      .toBe(stableId('natuerlicher-schluessel', 'sleep_sessions', '2026-09-29'))
  })
})

/* --------------------------------------------------------- Idempotenz */

describe('Derselbe Morgen, zweimal geschickt', () => {
  it('ohne Vorgänger wird angelegt', () => {
    expect(entscheideSchreiben(null, nacht('2026-09-29'))).toBe('neu')
    expect(entscheideSchreiben(undefined, nacht('2026-09-29'))).toBe('neu')
  })

  it('mit demselben Inhalt wird NICHT geschrieben', () => {
    // Der Kurzbefehl laeuft um 07:15 und noch einmal um 08:20.
    const n = nacht('2026-09-29')
    expect(entscheideSchreiben({ ...n }, n)).toBe('gleich')
  })

  it('auch wenn die Datenbank Zahlen als Text zurückgibt', () => {
    const n = nacht('2026-09-29')
    const ausDerDatenbank = { ...n, duration_min: '420' }
    expect(entscheideSchreiben(ausDerDatenbank, n)).toBe('gleich')
  })

  it('null und „nicht gesetzt" gelten als dasselbe', () => {
    const n = nacht('2026-09-29')
    const ausDerDatenbank: Record<string, any> = { ...n }
    delete ausDerDatenbank.core_min
    expect(entscheideSchreiben(ausDerDatenbank, n)).toBe('gleich')
  })

  it('eine nachträgliche Korrektur wird übernommen', () => {
    const alt = nacht('2026-09-29', { duration_min: 400 })
    const neu = nacht('2026-09-29', { duration_min: 431 })
    expect(entscheideSchreiben(alt, neu)).toBe('geaendert')
  })

  it('jedes einzelne Importfeld löst eine Änderung aus', () => {
    const alt = nacht('2026-09-29', {
      awake_min: 10, in_bed_min: 500, core_min: 200, deep_min: 100, rem_min: 120,
    })
    for (const feld of IMPORT_FELDER) {
      const neu = { ...alt, [feld]: feld === 'source' ? 'Apple Watch' : 999 } as Nacht
      expect(entscheideSchreiben(alt, neu), feld).toBe('geaendert')
    }
  })

  it('eine von Hand geschriebene Notiz zählt nicht als Unterschied', () => {
    // Sonst wuerde jeder Import die Nacht "aendern", nur weil eine Notiz
    // daran haengt, die Apple Health gar nicht kennt.
    const n = nacht('2026-09-29')
    expect(entscheideSchreiben({ ...n, note: 'schlecht geschlafen' }, n)).toBe('gleich')
    expect(IMPORT_FELDER).not.toContain('note' as any)
  })

  it('mehrere Nächte auf einmal ergeben je Tag genau eine', () => {
    const proben = [
      { start: '2026-09-27T23:00:00+02:00', ende: '2026-09-28T07:00:00+02:00', wert: 'Asleep' },
      { start: '2026-09-28T23:00:00+02:00', ende: '2026-09-29T07:00:00+02:00', wert: 'Asleep' },
    ]
    const naechte = baueNaechte(proben)
    expect(naechte.map((n) => n.day)).toEqual(['2026-09-28', '2026-09-29'])
    expect(new Set(naechte.map((n) => idAusSchluessel('sleep_sessions', n.day))).size).toBe(2)
  })

  it('dieselbe Ladung zweimal verarbeitet ergibt dieselben Nächte', () => {
    const proben = [{ start: '2026-09-28T23:00:00+02:00', ende: '2026-09-29T07:00:00+02:00', wert: 'Asleep' }]
    expect(baueNaechte(proben)).toEqual(baueNaechte(proben))
  })
})

/* ------------------------------------------------------------- Zugang */

describe('Das Importtoken', () => {
  it('ist lang genug, um nicht erraten zu werden', () => {
    const t = erzeugeToken()
    expect(t.length).toBeGreaterThanOrEqual(42)
    expect(siehtWieTokenAus(t)).toBe(true)
  })

  it('kommt nie zweimal gleich heraus', () => {
    const viele = new Set(Array.from({ length: 200 }, () => erzeugeToken()))
    expect(viele.size).toBe(200)
  })

  it('enthält nichts, was in einer Kopfzeile stört', () => {
    for (let i = 0; i < 50; i++) expect(erzeugeToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('ergibt einen stabilen SHA-256-Abdruck', async () => {
    // Fester Vergleichswert: Weichen App und Funktion hier ab, laesst sich
    // ein Zugang anlegen, aber nie benutzen.
    expect(await tokenAbdruck('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('derselbe Abdruck für dasselbe Token, ein anderer für ein anderes', async () => {
    const a = erzeugeToken()
    const b = erzeugeToken()
    expect(await tokenAbdruck(a)).toBe(await tokenAbdruck(a))
    expect(await tokenAbdruck(a)).not.toBe(await tokenAbdruck(b))
  })

  it('weist zurück, was gar nicht wie ein Token aussieht', () => {
    for (const x of ['', 'kurz', null, undefined, 42, 'hat leerzeichen drin', 'x'.repeat(200)]) {
      expect(siehtWieTokenAus(x as any)).toBe(false)
    }
  })
})
