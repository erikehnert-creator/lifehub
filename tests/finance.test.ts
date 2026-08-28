import { describe, it, expect } from 'vitest'
import {
  accountBalances, netWorth, availableMoney, periodTotals, monthTotals,
  budgetStatus, budgetProgress, totalsByCategory, forecastMonth, effectOnAccount, formatSavingsRate,
} from '../src/core/finance'
import type { Account, Transaction, Budget, Category } from '../src/core/types'

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
    ...base, id: Math.random().toString(36).slice(2), currency: 'EUR',
    value_on: null, to_account_id: null, category_id: null, merchant: null,
    description: null, note: null, status: 'booked', recurring_id: null,
    import_batch_id: null, external_ref: null, ...over,
  }
}

describe('Kontosalden', () => {
  const giro = account('giro', { opening_balance_cents: 100000 })
  const tagesgeld = account('tg', { type: 'savings', counts_as_savings: 1, counts_as_available: 0 })

  it('berücksichtigt Anfangssaldo und Bewegungen', () => {
    const txs = [
      tx({ type: 'income', amount_cents: 250000, account_id: 'giro', booked_on: '2026-08-01' }),
      tx({ type: 'expense', amount_cents: 4500, account_id: 'giro', booked_on: '2026-08-02' }),
    ]
    const b = accountBalances([giro, tagesgeld], txs)
    expect(b.get('giro')).toBe(100000 + 250000 - 4500)
  })

  it('ignoriert geplante und stornierte Buchungen', () => {
    const txs = [
      tx({ type: 'expense', amount_cents: 5000, account_id: 'giro', booked_on: '2026-08-02', status: 'planned' }),
      tx({ type: 'expense', amount_cents: 7000, account_id: 'giro', booked_on: '2026-08-02', status: 'void' }),
    ]
    expect(accountBalances([giro], txs).get('giro')).toBe(100000)
  })
})

describe('Transfers (Anforderung 11)', () => {
  const giro = account('giro', { opening_balance_cents: 200000 })
  const tagesgeld = account('tg', { type: 'savings', counts_as_savings: 1, counts_as_available: 0 })
  const transfer = tx({ type: 'transfer', amount_cents: 50000, account_id: 'giro', to_account_id: 'tg', booked_on: '2026-08-10' })

  it('verschiebt Geld zwischen Konten', () => {
    const b = accountBalances([giro, tagesgeld], [transfer])
    expect(b.get('giro')).toBe(150000)
    expect(b.get('tg')).toBe(50000)
  })

  it('lässt das Gesamtvermögen unverändert', () => {
    const before = netWorth([giro, tagesgeld], accountBalances([giro, tagesgeld], []))
    const after = netWorth([giro, tagesgeld], accountBalances([giro, tagesgeld], [transfer]))
    expect(after).toBe(before)
  })

  it('verfälscht weder Ausgabenstatistik noch Sparquote', () => {
    const income = tx({ type: 'income', amount_cents: 200000, account_id: 'giro', booked_on: '2026-08-01' })
    const expense = tx({ type: 'expense', amount_cents: 50000, account_id: 'giro', booked_on: '2026-08-05' })
    const withoutTransfer = monthTotals([income, expense], '2026-08')
    const withTransfer = monthTotals([income, expense, transfer], '2026-08')
    expect(withTransfer.expense).toBe(withoutTransfer.expense)
    expect(withTransfer.income).toBe(withoutTransfer.income)
    expect(withTransfer.savingsRatePercent).toBe(withoutTransfer.savingsRatePercent)
    expect(withTransfer.transferVolume).toBe(50000)
  })

  it('Summe aller Kontowirkungen eines Transfers ist null', () => {
    const sum = effectOnAccount(transfer, 'giro') + effectOnAccount(transfer, 'tg')
    expect(sum).toBe(0)
  })
})

describe('Sparquote', () => {
  it('berechnet Sparbetrag und Quote', () => {
    const txs = [
      tx({ type: 'income', amount_cents: 250000, account_id: 'a', booked_on: '2026-08-01' }),
      tx({ type: 'expense', amount_cents: 150000, account_id: 'a', booked_on: '2026-08-15' }),
    ]
    const t = monthTotals(txs, '2026-08')
    expect(t.savings).toBe(100000)
    expect(t.savingsRatePercent).toBe(40)
  })

  it('ist 0 %, wenn kein Einkommen vorhanden ist', () => {
    const t = monthTotals([tx({ type: 'expense', amount_cents: 5000, account_id: 'a', booked_on: '2026-08-01' })], '2026-08')
    expect(t.savingsRatePercent).toBe(0)
    expect(t.savings).toBe(-5000)
  })

  it('respektiert ausgeschlossene Kategorien', () => {
    const txs = [
      tx({ type: 'income', amount_cents: 100000, account_id: 'a', booked_on: '2026-08-01' }),
      tx({ type: 'expense', amount_cents: 20000, account_id: 'a', booked_on: '2026-08-02', category_id: 'invest' }),
    ]
    const withAll = periodTotals(txs, '2026-08-01', '2026-08-31')
    const excluded = periodTotals(txs, '2026-08-01', '2026-08-31', new Set(['invest']))
    expect(withAll.expense).toBe(20000)
    expect(excluded.expense).toBe(0)
    expect(excluded.savingsRatePercent).toBe(100)
  })
})

describe('Budgets', () => {
  it('bestimmt die Ampelfarbe', () => {
    expect(budgetStatus(5000, 20000, 80)).toBe('green')
    expect(budgetStatus(16000, 20000, 80)).toBe('amber')
    expect(budgetStatus(21000, 20000, 80)).toBe('red')
  })

  it('berechnet Fortschritt und Resttage', () => {
    const budget: Budget = {
      ...base, id: 'b1', category_id: 'tanken', period: 'monthly',
      amount_cents: 20000, valid_from: '2026-01-01', valid_to: null,
      warn_at_percent: 80, rollover: 0,
    }
    const cat: Category = {
      ...base, id: 'tanken', name: 'Tanken', parent_id: null, kind: 'expense',
      color: null, icon: null, is_archived: 0, is_system: 0, exclude_from_stats: 0, sort_order: 0,
    }
    const txs = [tx({ type: 'expense', amount_cents: 18000, account_id: 'a', booked_on: '2026-08-10', category_id: 'tanken' })]
    const [p] = budgetProgress([budget], txs, [cat], '2026-08', '2026-08-15')
    expect(p.spent).toBe(18000)
    expect(p.usedPercent).toBe(90)
    expect(p.status).toBe('amber')
    expect(p.remaining).toBe(2000)
    expect(p.daysLeft).toBe(16)
    expect(p.onTrack).toBe(false)
  })
})

describe('Kategorieauswertung', () => {
  it('summiert und berechnet Anteile', () => {
    const cats: Category[] = [
      { ...base, id: 'c1', name: 'Lebensmittel', parent_id: null, kind: 'expense', color: null, icon: null, is_archived: 0, is_system: 0, exclude_from_stats: 0, sort_order: 0 },
    ]
    const txs = [
      tx({ type: 'expense', amount_cents: 6000, account_id: 'a', booked_on: '2026-08-01', category_id: 'c1' }),
      tx({ type: 'expense', amount_cents: 2000, account_id: 'a', booked_on: '2026-08-02', category_id: 'c1' }),
      tx({ type: 'expense', amount_cents: 2000, account_id: 'a', booked_on: '2026-08-03' }),
    ]
    const res = totalsByCategory(txs, cats, '2026-08-01', '2026-08-31')
    expect(res[0].name).toBe('Lebensmittel')
    expect(res[0].amount).toBe(8000)
    expect(res[0].share).toBe(80)
    expect(res[1].name).toBe('Nicht kategorisiert')
  })
})

describe('Monatsprognose', () => {
  it('rechnet den Restmonat hoch und markiert Geplantes', () => {
    const txs = [
      tx({ type: 'income', amount_cents: 200000, account_id: 'a', booked_on: '2026-08-01' }),
      tx({ type: 'expense', amount_cents: 30000, account_id: 'a', booked_on: '2026-08-01' }),
      tx({ type: 'expense', amount_cents: 30000, account_id: 'a', booked_on: '2026-08-10' }),
      tx({ type: 'expense', amount_cents: 12000, account_id: 'a', booked_on: '2026-08-28', status: 'planned' }),
    ]
    const f = forecastMonth(txs, '2026-08', '2026-08-10')
    expect(f.actualExpense).toBe(60000)
    expect(f.plannedExpense).toBe(12000)
    // 60.000 in 10 Tagen = 6.000/Tag, 21 Resttage → 126.000 + 60.000 + 12.000 geplant
    expect(f.projectedExpense).toBe(198000)
    expect(f.projectedIncome).toBe(200000)
  })
})

describe('Budgets auf Oberkategorien', () => {
  const cat = (id: string, name: string, parent: string | null = null): Category => ({
    ...base, id, name, parent_id: parent, kind: 'expense', color: null, icon: null,
    is_archived: 0, is_system: 0, exclude_from_stats: 0, sort_order: 0,
  })
  const categories = [cat('fix', 'Fixkosten'), cat('sprit', 'Sprit', 'fix'), cat('abos', 'Abos', 'fix'), cat('leben', 'Leben')]
  const budget: Budget = {
    ...base, id: 'b', category_id: 'fix', period: 'monthly', amount_cents: 25800,
    valid_from: '2026-01-01', valid_to: null, warn_at_percent: 80, rollover: 0,
  }

  it('zählt die Buchungen der Unterkategorien mit', () => {
    const txs = [
      tx({ type: 'expense', amount_cents: 2217, account_id: 'a', booked_on: '2026-08-05', category_id: 'sprit' }),
      tx({ type: 'expense', amount_cents: 800, account_id: 'a', booked_on: '2026-08-06', category_id: 'abos' }),
      tx({ type: 'expense', amount_cents: 5000, account_id: 'a', booked_on: '2026-08-07', category_id: 'leben' }),
    ]
    const [p] = budgetProgress([budget], txs, categories, '2026-08', '2026-08-19')
    expect(p.spent).toBe(3017)   // nur Sprit + Abos, nicht Leben
  })

  it('zählt Buchungen fremder Kategorien nicht mit', () => {
    const txs = [tx({ type: 'expense', amount_cents: 5000, account_id: 'a', booked_on: '2026-08-07', category_id: 'leben' })]
    const [p] = budgetProgress([budget], txs, categories, '2026-08', '2026-08-19')
    expect(p.spent).toBe(0)
  })
})

describe('Anzeige der Sparquote', () => {
  it('zeigt ohne Einnahmen keinen Prozentwert', () => {
    expect(formatSavingsRate(0, 0)).toBe('–')
  })
  it('zeigt normale Quoten als Zahl – mit deutschem Komma', () => {
    expect(formatSavingsRate(31.5, 100000)).toBe('31,5 %')
    expect(formatSavingsRate(-40, 100000)).toBe('-40 %')
  })
  it('ersetzt unlesbare Extremwerte durch eine Aussage', () => {
    // 2,50 € Einnahmen, 163,50 € Ausgaben ergäben -6440 %
    expect(formatSavingsRate(-6440, 250)).toBe('unter −100 %')
  })
})
