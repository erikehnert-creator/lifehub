/**
 * Geldarithmetik. Beträge sind IMMER ganzzahlige Cent.
 * Grund: 0.1 + 0.2 !== 0.3 in Fließkommaarithmetik – bei Finanzdaten inakzeptabel.
 */
export type Cents = number

export const ZERO: Cents = 0

export function cents(value: number): Cents {
  return Math.round(value * 100)
}

export function toEuro(c: Cents): number {
  return c / 100
}

export function addAll(values: Cents[]): Cents {
  let sum = 0
  for (const v of values) sum += v
  return sum
}

/** Prozentanteil in ganzen Zehntelprozent-Schritten, ohne Rundungsdrift. */
export function percentOf(part: Cents, whole: Cents): number {
  if (whole === 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

/**
 * Verteilt einen Betrag auf n Teile ohne Cent-Verlust.
 * Die Restcents werden auf die vorderen Teile verteilt.
 */
export function split(total: Cents, parts: number): Cents[] {
  if (parts <= 0) return []
  const base = Math.trunc(total / parts)
  const rest = total - base * parts
  const out = new Array<number>(parts).fill(base)
  const sign = rest >= 0 ? 1 : -1
  for (let i = 0; i < Math.abs(rest); i++) out[i] += sign
  return out
}

const nf = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})
const nfCompact = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(c: Cents, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const value = toEuro(c)
  const s = opts.compact && Math.abs(c) >= 100000 ? nfCompact.format(value) : nf.format(value)
  if (opts.sign && c > 0) return '+' + s
  return s
}

/** Kurzform für Achsen: „1.200 €" statt „1.200,00 €". */
export function formatMoneyAxis(c: Cents): string {
  return nfCompact.format(toEuro(c))
}

export function formatNumber(n: number, decimals = 1): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

/** Deutsche und englische Zahlenformate robust einlesen: "1.234,56" und "1,234.56". */
export function parseAmountToCents(input: string): Cents | null {
  const raw = input.trim().replace(/[€\s ]/g, '')
  if (!raw) return null
  const hasComma = raw.includes(',')
  const hasDot = raw.includes('.')
  let normalised = raw
  if (hasComma && hasDot) {
    // Das zuletzt auftretende Zeichen ist das Dezimaltrennzeichen
    normalised = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
  } else if (hasComma) {
    const parts = raw.split(',')
    // "1,234" mit exakt 3 Nachkommastellen ist ein Tausendertrenner
    normalised = parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && /^\d+$/.test(parts[0])
      ? raw.replace(/,/g, '')
      : raw.replace(',', '.')
  }
  const n = Number(normalised)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/**
 * Cent-Betrag als Text fürs Eingabefeld: immer mit zwei Nachkommastellen und
 * ohne Tausenderpunkt, damit die Kasseneingabe ihn eindeutig zurücklesen kann.
 */
export function centsToInput(c: Cents | null | undefined): string {
  if (c === null || c === undefined) return ''
  const neg = c < 0
  const abs = Math.abs(Math.round(c))
  return (neg ? '-' : '') + Math.floor(abs / 100) + ',' + String(abs % 100).padStart(2, '0')
}

/**
 * Kasseneingabe: Ziffern wandern von rechts herein.
 * Aus „2000" wird 20,00 €, aus „5" werden 0,05 €.
 * Kommas und Punkte in der Eingabe werden ignoriert – wer „20,00" tippt,
 * bekommt trotzdem 20,00 €.
 */
export function registerInput(raw: string): string {
  const negativ = raw.trimStart().startsWith('-')
  const ziffern = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11)
  if (!ziffern) return negativ ? '-' : ''
  const gefuellt = ziffern.padStart(3, '0')
  return (negativ ? '-' : '') + gefuellt.slice(0, -2) + ',' + gefuellt.slice(-2)
}
