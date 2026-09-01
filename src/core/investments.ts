/**
 * Investment-Tracking (z. B. Trading212) – rein manuell, ohne Kursdaten.
 *
 * Erfasst wird nur, wie viel Geld in eine Position eingesetzt wurde (Kauf)
 * und wie viel beim Verkauf zurückkam – zusammen mit dem Anteil des
 * eingesetzten Kapitals, der damit verkauft wurde (cost_basis_cents). Aus
 * diesen beiden Zahlen ergibt sich Gewinn/Verlust je Verkauf, ganz ohne
 * Stückzahlen oder Kurshistorie. Alles hier ist reine Rechnerei ohne
 * Datenbank- oder Netzzugriff – siehe core/finance.ts für dasselbe Prinzip.
 */
import type { DayString } from './dates'
import type { Cents } from './money'

export interface InvestmentMove {
  id: string
  investment_id: string
  day: DayString
  kind: 'buy' | 'sell'
  amount_cents: Cents      // Kauf: eingesetztes Kapital · Verkauf: Erlös
  cost_basis_cents: Cents | null   // nur bei Verkauf gesetzt
  note: string | null
  deleted_at: string | null
}

export interface InvestmentSummary {
  /** Summe aller Käufe (all-time, unabhängig von Verkäufen). */
  totalInvested: Cents
  /** Noch „im Markt" eingesetztes Kapital (totalInvested minus verkaufte cost_basis). */
  remainingBasis: Cents
  /** Summe aller Verkaufserlöse. */
  totalProceeds: Cents
  /** Summe (amount_cents - cost_basis_cents) über alle Verkäufe. */
  realizedProfitLoss: Cents
  /** remainingBasis <= 0 und es gab mindestens einen Kauf. */
  isClosed: boolean
}

/**
 * Faltet Käufe und Verkäufe einer Position zu einer Zusammenfassung.
 * Gelöschte Bewegungen werden ignoriert, die übrigen nach Tag aufsteigend
 * verarbeitet (stabile Reihenfolge bei Gleichstand – Array.sort ist stabil).
 */
export function summarizeInvestment(moves: InvestmentMove[]): InvestmentSummary {
  const active = moves.filter((m) => m.deleted_at == null).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))

  let totalInvested = 0
  let remainingBasis = 0
  let totalProceeds = 0
  let realizedProfitLoss = 0
  let hadBuy = false

  for (const m of active) {
    if (m.kind === 'buy') {
      hadBuy = true
      totalInvested += m.amount_cents
      remainingBasis += m.amount_cents
    } else {
      const costBasis = m.cost_basis_cents ?? 0
      totalProceeds += m.amount_cents
      realizedProfitLoss += m.amount_cents - costBasis
      // Defensive Klemme: eine fehlerhaft erfasste Bewegung (mehr Cost Basis
      // verkauft, als noch eingesetzt war) darf den Rest nicht negativ machen.
      // validateSellCostBasis soll das eigentlich schon beim Erfassen verhindern.
      remainingBasis = Math.max(0, remainingBasis - costBasis)
    }
  }

  return {
    totalInvested,
    remainingBasis,
    totalProceeds,
    realizedProfitLoss,
    isClosed: hadBuy && remainingBasis <= 0,
  }
}

/** Wie viel eingesetztes Kapital für einen Verkauf noch zur Verfügung steht. */
export function maxSellCostBasis(moves: InvestmentMove[]): Cents {
  return summarizeInvestment(moves).remainingBasis
}

export function validateSellCostBasis(remainingBasis: Cents, requestedCents: Cents): { ok: boolean; message?: string } {
  if (requestedCents <= 0) return { ok: false, message: 'Betrag muss größer als 0 sein.' }
  if (requestedCents > remainingBasis) return { ok: false, message: 'Mehr als das noch eingesetzte Kapital kann nicht verkauft werden.' }
  return { ok: true }
}

export interface PortfolioSummary {
  totalInvested: Cents
  totalRemaining: Cents
  totalRealizedProfitLoss: Cents
  openCount: number
  closedCount: number
}

/** Aggregiert summarizeInvestment über alle nicht gelöschten Investments. */
export function summarizePortfolio(
  investments: { id: string; deleted_at: string | null }[],
  movesByInvestment: Map<string, InvestmentMove[]>,
): PortfolioSummary {
  let totalInvested = 0
  let totalRemaining = 0
  let totalRealizedProfitLoss = 0
  let openCount = 0
  let closedCount = 0

  for (const inv of investments) {
    if (inv.deleted_at != null) continue
    const summary = summarizeInvestment(movesByInvestment.get(inv.id) ?? [])
    totalInvested += summary.totalInvested
    totalRemaining += summary.remainingBasis
    totalRealizedProfitLoss += summary.realizedProfitLoss
    if (summary.isClosed) closedCount++
    else openCount++
  }

  return { totalInvested, totalRemaining, totalRealizedProfitLoss, openCount, closedCount }
}
