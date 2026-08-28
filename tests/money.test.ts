import { describe, it, expect } from 'vitest'
import { cents, toEuro, split, percentOf, parseAmountToCents, formatMoney, addAll } from '../src/core/money'

describe('Geldarithmetik', () => {
  it('rechnet ohne Fließkommafehler', () => {
    // Der klassische Fall: 0.1 + 0.2 !== 0.3
    expect(cents(0.1) + cents(0.2)).toBe(cents(0.3))
    expect(toEuro(cents(0.1) + cents(0.2))).toBe(0.3)
  })

  it('verteilt Beträge ohne Cent-Verlust', () => {
    for (const total of [100, 101, 999, 1, -7, 12345]) {
      for (const parts of [1, 2, 3, 7, 12]) {
        const s = split(total, parts)
        expect(s.length).toBe(parts)
        expect(addAll(s)).toBe(total)
      }
    }
  })

  it('berechnet Prozentanteile', () => {
    expect(percentOf(2500, 10000)).toBe(25)
    expect(percentOf(0, 10000)).toBe(0)
    expect(percentOf(1000, 0)).toBe(0)
  })

  it('liest deutsche und englische Zahlenformate', () => {
    expect(parseAmountToCents('12,50')).toBe(1250)
    expect(parseAmountToCents('12.50')).toBe(1250)
    expect(parseAmountToCents('1.234,56')).toBe(123456)
    expect(parseAmountToCents('1,234.56')).toBe(123456)
    expect(parseAmountToCents('45')).toBe(4500)
    expect(parseAmountToCents('45 €')).toBe(4500)
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
  })

  it('formatiert deutsch', () => {
    expect(formatMoney(123456)).toContain('1.234,56')
    expect(formatMoney(4500, { sign: true }).startsWith('+')).toBe(true)
  })
})
