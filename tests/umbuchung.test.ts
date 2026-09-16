/**
 * Umbuchungen zwischen eigenen Konten – der Fall „150 € vom Tagesgeld aufs
 * Girokonto", von der Eingabe bis zum Nettovermögen.
 *
 * Der gemeldete Fehler saß nicht in der Rechnung, sondern davor: Das Zielkonto
 * war im Formular nie gesetzt, während die Auswahlliste trotzdem ein Konto
 * anzeigte. Das Formular sah vollständig aus, die Prüfung sagte zu Recht
 * „kein Zielkonto" – und der Speichern-Knopf blieb ohne sichtbaren Grund blass.
 * Deshalb prüft der erste Block hier die Anzeige, nicht die Arithmetik.
 */
import { describe, it, expect } from 'vitest'
import {
  angezeigtesKonto, buchungProblem, accountBalances, netWorth, periodTotals,
  effectOnAccount, transactionsForAccount,
} from '../src/core/finance'
import { parseAmountToCents } from '../src/core/money'
import type { Account, Transaction } from '../src/core/types'

const base = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null, version: 1, last_device_id: 'test', server_rev: null,
}

function account(id: string, over: Partial<Account> = {}): Account {
  return {
    ...base, id, name: id, type: 'checking', currency: 'EUR',
    opening_balance_cents: 0, opening_date: '2026-01-01',
    iban: null, institution: null, color: null, icon: null,
    is_active: 1, counts_as_savings: 0, counts_as_available: 1,
    include_in_net_worth: 1, sort_order: 0, ...over,
  }
}

function tx(over: Partial<Transaction> & Pick<Transaction, 'type' | 'amount_cents' | 'account_id' | 'booked_on'>): Transaction {
  return {
    ...base, id: 'tx' + Math.random().toString(36).slice(2), currency: 'EUR',
    value_on: null, to_account_id: null, category_id: null, merchant: null,
    description: null, note: null, status: 'booked', recurring_id: null,
    import_batch_id: null, external_ref: null, ...over,
  }
}

const giro = account('giro', { name: 'Girokonto', opening_balance_cents: 50000 })
const tagesgeld = account('tg', {
  name: 'Tagesgeld', type: 'savings', opening_balance_cents: 300000,
  counts_as_savings: 1, counts_as_available: 0,
})
const konten = [giro, tagesgeld]

/** Das Formular, so weit es für die Speicherbarkeit zählt. */
function formular(gewaehltVon: string, gewaehltZiel: string, betrag: string, konto = konten) {
  const von = angezeigtesKonto(konto, gewaehltVon)
  const ziel = angezeigtesKonto(konto, gewaehltZiel, von)
  const problem = buchungProblem({
    type: 'transfer', amountCents: parseAmountToCents(betrag), accountId: von, toAccountId: ziel,
  })
  return { von, ziel, problem, speicherbar: problem === null }
}

describe('Umbuchung – Formular', () => {
  it('1. Tagesgeld → Girokonto, 150 €: Speichern ist aktiv', () => {
    // So kommt das Formular frisch hoch: Zielkonto noch gar nicht angefasst.
    const f = formular('tg', '', '150,00')
    expect(f.von).toBe('tg')
    expect(f.ziel).toBe('giro')
    expect(f.speicherbar).toBe(true)
  })

  it('2. Girokonto → Tagesgeld ist genauso möglich', () => {
    const f = formular('giro', '', '150,00')
    expect(f.ziel).toBe('tg')
    expect(f.speicherbar).toBe(true)
  })

  it('3. Dezimalbeträge kommen centgenau an', () => {
    expect(parseAmountToCents('150,45')).toBe(15045)
    expect(parseAmountToCents('0,01')).toBe(1)
    expect(parseAmountToCents('1.234,56')).toBe(123456)
    expect(formular('tg', 'giro', '150,45').speicherbar).toBe(true)
  })

  it('4. Quellkonto = Zielkonto wird verhindert', () => {
    // Über die Anzeige ist es gar nicht erst erreichbar …
    expect(formular('tg', 'tg', '150,00').ziel).toBe('giro')
    // … und wer es direkt versucht, bekommt eine Begründung.
    expect(buchungProblem({
      type: 'transfer', amountCents: 15000, accountId: 'tg', toAccountId: 'tg',
    })).toMatch(/verschieden/)
  })

  it('5. Betrag leer: Speichern bleibt gesperrt, mit Begründung', () => {
    const f = formular('tg', '', '')
    expect(f.speicherbar).toBe(false)
    expect(f.problem).toMatch(/Betrag/)
  })

  it('6. Betrag 0 wird abgelehnt', () => {
    expect(formular('tg', '', '0,00').problem).toMatch(/0,00/)
  })

  it('6b. NaN und negativer Betrag werden abgelehnt', () => {
    expect(parseAmountToCents('abc')).toBe(null)
    expect(formular('tg', '', 'abc').speicherbar).toBe(false)
    expect(buchungProblem({
      type: 'transfer', amountCents: -15000, accountId: 'tg', toAccountId: 'giro',
    })).toMatch(/positiv/)
  })

  it('7. ein gültiger Transfer meldet kein Problem', () => {
    expect(formular('tg', 'giro', '150,00').problem).toBe(null)
  })

  it('gelöschte Konten fallen aus der Auswahl – und ziehen die Wahl mit', () => {
    const mitLeiche = [account('alt', { deleted_at: 'x' }), giro, tagesgeld]
    // Voreinstellung zeigt auf ein gelöschtes Konto: Die Anzeige nimmt das
    // erste echte – und der Zustand muss dem folgen, sonst blockt die Prüfung.
    expect(angezeigtesKonto(mitLeiche, 'alt')).toBe('giro')
    expect(formular('alt', '', '150,00').speicherbar).toBe(true)
  })

  it('ohne jedes Konto bleibt Speichern gesperrt', () => {
    expect(formular('', '', '150,00', []).problem).toMatch(/Konto/)
  })

  it('Konten gleichen Typs sind als Quelle und Ziel erlaubt', () => {
    const zweiSpar = [
      account('s1', { type: 'savings' }), account('s2', { type: 'savings' }),
    ]
    expect(formular('s1', '', '150,00', zweiSpar).speicherbar).toBe(true)
  })
})

describe('Umbuchung – Wirkung auf die Konten', () => {
  const umbuchung = tx({
    id: 'um1', type: 'transfer', amount_cents: 15000,
    account_id: 'tg', to_account_id: 'giro', booked_on: '2026-09-16',
  })

  it('8. Salden: Tagesgeld −150 €, Girokonto +150 €', () => {
    const vorher = accountBalances(konten, [])
    const nachher = accountBalances(konten, [umbuchung])
    expect(nachher.get('tg')! - vorher.get('tg')!).toBe(-15000)
    expect(nachher.get('giro')! - vorher.get('giro')!).toBe(+15000)
    expect(effectOnAccount(umbuchung, 'tg')).toBe(-15000)
    expect(effectOnAccount(umbuchung, 'giro')).toBe(+15000)
  })

  it('9. das Nettovermögen bleibt unverändert', () => {
    const vorher = netWorth(konten, accountBalances(konten, []))
    const nachher = netWorth(konten, accountBalances(konten, [umbuchung]))
    expect(nachher).toBe(vorher)
  })

  it('keine künstliche Einnahme oder Ausgabe', () => {
    const t = periodTotals([umbuchung], '2026-09-01', '2026-09-30')
    expect(t.income).toBe(0)
    expect(t.expense).toBe(0)
    expect(t.savings).toBe(0)
    expect(t.transferVolume).toBe(15000)
  })

  it('die Umbuchung erscheint bei BEIDEN Konten', () => {
    expect(transactionsForAccount([umbuchung], 'tg')).toHaveLength(1)
    expect(transactionsForAccount([umbuchung], 'giro')).toHaveLength(1)
  })

  it('10. gelöscht: die Salden stehen wieder wie vorher', () => {
    const geloescht = { ...umbuchung, deleted_at: '2026-09-16T10:00:00Z' }
    // accountBalances bekommt nur ungelöschte Zeilen – so lädt die App sie.
    const nachher = accountBalances(konten, [geloescht].filter((t) => !t.deleted_at))
    expect(nachher.get('tg')).toBe(300000)
    expect(nachher.get('giro')).toBe(50000)
  })

  it('11. bearbeitet: 150 € → 200 € und anderes Zielkonto', () => {
    const sparbuch = account('sp', { name: 'Sparbuch', type: 'savings' })
    const geaendert = { ...umbuchung, amount_cents: 20000, to_account_id: 'sp' }
    const b = accountBalances([...konten, sparbuch], [geaendert])
    expect(b.get('tg')).toBe(300000 - 20000)
    expect(b.get('giro')).toBe(50000)
    expect(b.get('sp')).toBe(20000)
    expect(netWorth([...konten, sparbuch], b)).toBe(300000 + 50000)
  })

  it('geplant und storniert zählen nicht in die Salden', () => {
    for (const status of ['planned', 'void'] as const) {
      const b = accountBalances(konten, [{ ...umbuchung, status }])
      expect(b.get('tg')).toBe(300000)
      expect(b.get('giro')).toBe(50000)
    }
  })

  it('ein Zielkonto, das es nicht mehr gibt, verliert kein Geld aus der Quelle', () => {
    const b = accountBalances(konten, [{ ...umbuchung, to_account_id: 'weg' }])
    expect(b.get('tg')).toBe(300000 - 15000)
    expect(b.get('giro')).toBe(50000)
  })
})
