import { describe, it, expect } from 'vitest'
import {
  parseDelimited, parseDayValue, parseNumberValue,
  guessMetricMapping, guessTransactionMapping,
  previewMetricImport, previewTransactionImport,
} from '../src/io/importer'

describe('Datei einlesen', () => {
  it('erkennt Semikolon als Trennzeichen', () => {
    const { columns, rows } = parseDelimited('Datum;Gewicht;Kalorien\n01.08.2026;52,4;2380')
    expect(columns).toEqual(['Datum', 'Gewicht', 'Kalorien'])
    expect(rows).toEqual([['01.08.2026', '52,4', '2380']])
  })

  it('erkennt Komma und Tabulator', () => {
    expect(parseDelimited('a,b\n1,2').columns).toEqual(['a', 'b'])
    expect(parseDelimited('a\tb\n1\t2').columns).toEqual(['a', 'b'])
  })

  it('kommt mit Anführungszeichen und BOM zurecht', () => {
    const { rows } = parseDelimited('﻿a;b\n"Text; mit Semikolon";2')
    expect(rows[0][0]).toBe('Text; mit Semikolon')
  })
})

describe('Werte lesen', () => {
  it('versteht verschiedene Datumsformate', () => {
    expect(parseDayValue('2026-08-01')).toBe('2026-08-01')
    expect(parseDayValue('01.08.2026')).toBe('2026-08-01')
    expect(parseDayValue('1.8.26')).toBe('2026-08-01')
    expect(parseDayValue('08/01/2026')).toBe('2026-08-01')
    expect(parseDayValue('Unsinn')).toBeNull()
  })

  it('versteht Zahlen und Zeitangaben', () => {
    expect(parseNumberValue('52,4')).toBe(52.4)
    expect(parseNumberValue('52.4')).toBe(52.4)
    expect(parseNumberValue('7:30')).toBeCloseTo(7.5, 5)
    expect(parseNumberValue('1.234,5')).toBe(1234.5)
    expect(parseNumberValue('')).toBeNull()
  })
})

describe('Spalten automatisch zuordnen', () => {
  it('erkennt Trackingspalten', () => {
    const map = guessMetricMapping(
      ['Datum', 'Gewicht', 'Kalorien', 'Protein', 'Schlaf', 'Notizen', 'Blabla'],
      ['weight_kg', 'calories', 'protein_g', 'sleep_h'],
    )
    expect(map.Datum).toBe('__day')
    expect(map.Gewicht).toBe('weight_kg')
    expect(map.Kalorien).toBe('calories')
    expect(map.Protein).toBe('protein_g')
    expect(map.Schlaf).toBe('sleep_h')
    expect(map.Notizen).toBe('__note')
    expect(map.Blabla).toBe('__ignore')
  })

  it('erkennt Kontoauszugsspalten', () => {
    const map = guessTransactionMapping(['Buchungstag', 'Betrag', 'Verwendungszweck', 'Begünstigter'])
    expect(map.Buchungstag).toBe('booked_on')
    expect(map.Betrag).toBe('amount')
    expect(map.Verwendungszweck).toBe('description')
    expect(map['Begünstigter']).toBe('merchant')
  })
})

describe('Vorschau vor dem Import', () => {
  const metrics = [{ id: 'm1', key: 'weight_kg', name: 'Gewicht' }]

  it('zählt Datensätze und meldet unlesbare Zeilen', () => {
    const columns = ['Datum', 'Gewicht']
    const rows = [['01.08.2026', '52,4'], ['kaputt', '53'], ['03.08.2026', 'auch kaputt']]
    const p = previewMetricImport(columns, rows, { Datum: '__day', Gewicht: 'weight_kg' }, metrics, [])
    expect(p.willImport).toBe(1)
    expect(p.issues.some((i) => i.level === 'error')).toBe(true)
    expect(p.issues.some((i) => i.level === 'warning')).toBe(true)
  })

  it('warnt vor vorhandenen Einträgen statt sie stillschweigend zu überschreiben', () => {
    const p = previewMetricImport(['Datum', 'Gewicht'], [['01.08.2026', '52,4']],
      { Datum: '__day', Gewicht: 'weight_kg' }, metrics, [{ metric_id: 'm1', day: '2026-08-01' }])
    expect(p.issues.some((i) => i.message.includes('existiert bereits'))).toBe(true)
  })

  it('bricht ohne Datumsspalte mit einem Fehler ab', () => {
    const p = previewMetricImport(['Gewicht'], [['52,4']], { Gewicht: 'weight_kg' }, metrics, [])
    expect(p.willImport).toBe(0)
    expect(p.issues[0].level).toBe('error')
  })

  it('leitet bei Buchungen den Typ aus dem Vorzeichen ab', () => {
    const p = previewTransactionImport(
      ['Datum', 'Betrag', 'Empfänger'],
      [['01.08.2026', '-45,00', 'Aral'], ['28.08.2026', '1185,00', 'Arbeitgeber']],
      { Datum: 'booked_on', Betrag: 'amount', 'Empfänger': 'merchant' },
      [{ id: 'a1', name: 'Giro' }], [], 'a1',
    )
    expect(p.willImport).toBe(2)
    expect(p.rows[0].type).toBe('expense')
    expect(p.rows[0].amount_cents).toBe(4500)
    expect(p.rows[1].type).toBe('income')
  })

  it('markiert mögliche Dubletten', () => {
    const p = previewTransactionImport(
      ['Datum', 'Betrag', 'Empfänger'],
      [['01.08.2026', '-45,00', 'Aral'], ['01.08.2026', '-45,00', 'Aral']],
      { Datum: 'booked_on', Betrag: 'amount', 'Empfänger': 'merchant' },
      [{ id: 'a1', name: 'Giro' }], [], 'a1',
    )
    expect(p.issues.some((i) => i.message.includes('Dublette'))).toBe(true)
  })
})

describe('Vollwiederherstellung', () => {
  it('nennt die gerätebezogenen Einstellungen vollständig', async () => {
    // Diese Liste ist der Grund, warum ein Ersetzen das Gerät nicht vom Server trennt.
    const quelle = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/io/importer.ts', import.meta.url), 'utf8'))
    const treffer = quelle.match(/const GERAETE_EINSTELLUNGEN = \[([^\]]+)\]/)
    expect(treffer).not.toBeNull()
    const liste = treffer![1]
    for (const key of ['sync_url', 'sync_key', 'pin_hash', 'pin_salt', 'lock_after_minutes']) {
      expect(liste).toContain(key)
    }
  })
})
