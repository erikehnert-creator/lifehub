/**
 * Automatische Hinweise.
 * Jeder Hinweis führt seine Zahlen mit (evidence) – die Oberfläche kann
 * jederzeit "Wie kommt das zustande?" beantworten.
 * Statistische Beobachtungen werden NIE als Ursache formuliert.
 */
import type { Transaction, Category, Account, Task, Metric, MetricEntry, MetricTarget, RecurringRule } from './types'
import { monthTotals, monthTotalsErwartet, budgetProgress, totalsByCategory } from './finance'
import type { Budget } from './types'
import { formatMoney, type Cents } from './money'
import { type DayString, addMonthsToYearMonth, monthOf, todayString, formatMonth, monthStart, monthEnd, addDays, lastMonths } from './dates'
import { dailySeries, aggregate, evaluateZone, targetFor } from './metrics'

export interface GeneratedInsight {
  kind: string
  severity: 'info' | 'attention' | 'warning'
  title: string
  body: string
  evidence: Record<string, any>
  isStatistical: boolean
}

export interface InsightInput {
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  budgets: Budget[]
  recurring: RecurringRule[]
  tasks: Task[]
  metrics: Metric[]
  metricEntries: MetricEntry[]
  metricTargets: MetricTarget[]
  today: DayString
}

export function generateInsights(input: InsightInput): GeneratedInsight[] {
  const out: GeneratedInsight[] = []
  const today = input.today || todayString()
  const thisMonth = monthOf(today)
  const prevMonth = addMonthsToYearMonth(thisMonth, -1)

  out.push(...spendingComparison(input, thisMonth, prevMonth))
  out.push(...categorySpikes(input, thisMonth))
  out.push(...budgetWarnings(input, thisMonth, today))
  out.push(...savingsRateNote(input, thisMonth))
  out.push(...taskLoad(input, today))
  out.push(...metricNotes(input, today))

  return out
}

function spendingComparison(i: InsightInput, thisMonth: string, prevMonth: string): GeneratedInsight[] {
  const cur = monthTotals(i.transactions, thisMonth)
  const prev = monthTotals(i.transactions, prevMonth)
  if (prev.expense === 0 || cur.expense === 0) return []
  const change = ((cur.expense - prev.expense) / prev.expense) * 100
  if (Math.abs(change) < 8) return []
  const up = change > 0
  return [{
    kind: 'spending_comparison',
    severity: up && change > 25 ? 'attention' : 'info',
    title: up
      ? `${Math.round(change)} % mehr ausgegeben als im Vormonat`
      : `${Math.round(-change)} % weniger ausgegeben als im Vormonat`,
    body: `${formatMonth(thisMonth)}: ${formatMoney(cur.expense)} · ${formatMonth(prevMonth)}: ${formatMoney(prev.expense)}.`,
    evidence: { thisMonth, prevMonth, currentExpense: cur.expense, previousExpense: prev.expense, changePercent: Math.round(change * 10) / 10 },
    isStatistical: false,
  }]
}

function categorySpikes(i: InsightInput, thisMonth: string): GeneratedInsight[] {
  const months = lastMonths(addMonthsToYearMonth(thisMonth, -1), 6)
  const current = totalsByCategory(i.transactions, i.categories, monthStart(thisMonth), monthEnd(thisMonth))
  const out: GeneratedInsight[] = []
  for (const c of current.slice(0, 8)) {
    if (!c.categoryId || c.amount < 2000) continue
    const history: Cents[] = months.map((m) => {
      const totals = totalsByCategory(i.transactions, i.categories, monthStart(m), monthEnd(m))
      return totals.find((t) => t.categoryId === c.categoryId)?.amount ?? 0
    })
    const nonZero = history.filter((h) => h > 0)
    if (nonZero.length < 3) continue
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length
    if (avg <= 0) continue
    const change = ((c.amount - avg) / avg) * 100
    if (change < 30) continue
    out.push({
      kind: 'category_spike',
      severity: change > 60 ? 'attention' : 'info',
      title: `${Math.round(change)} % mehr für ${c.name} als im Durchschnitt`,
      body: `Diesen Monat ${formatMoney(c.amount)}, im Schnitt der letzten ${nonZero.length} Monate mit Ausgaben ${formatMoney(Math.round(avg))}.`,
      evidence: { category: c.name, current: c.amount, average: Math.round(avg), months, history, changePercent: Math.round(change) },
      isStatistical: false,
    })
  }
  return out.slice(0, 2)
}

function budgetWarnings(i: InsightInput, thisMonth: string, today: DayString): GeneratedInsight[] {
  const progress = budgetProgress(i.budgets, i.transactions, i.categories, thisMonth, today)
  const out: GeneratedInsight[] = []
  for (const p of progress) {
    if (p.status === 'red') {
      out.push({
        kind: 'budget_exceeded',
        severity: 'warning',
        title: `Budget ${p.categoryName} überschritten`,
        body: `${formatMoney(p.spent)} von ${formatMoney(p.limit)} (${p.usedPercent} %). Noch ${p.daysLeft} Tage im Monat.`,
        evidence: { category: p.categoryName, spent: p.spent, limit: p.limit, usedPercent: p.usedPercent, daysLeft: p.daysLeft },
        isStatistical: false,
      })
    } else if (p.status === 'amber' && !p.onTrack) {
      out.push({
        kind: 'budget_pace',
        severity: 'attention',
        title: `Budget ${p.categoryName} zu ${Math.round(p.usedPercent)} % ausgeschöpft`,
        body: `Zeitanteil des Monats: ${Math.round(p.paceExpectedPercent)} %. Es sind noch ${formatMoney(p.remaining)} übrig für ${p.daysLeft} Tage.`,
        evidence: { category: p.categoryName, spent: p.spent, limit: p.limit, usedPercent: p.usedPercent, expectedPercent: p.paceExpectedPercent },
        isStatistical: false,
      })
    }
  }
  return out.slice(0, 3)
}

function savingsRateNote(i: InsightInput, thisMonth: string): GeneratedInsight[] {
  const months = lastMonths(thisMonth, 6)
  // Der laufende Monat rechnet mit erwarteten, noch nicht gebuchten Einnahmen
  // (z. B. Gehalt vor dem Zahltag) – sonst widerspricht dieser Hinweis der
  // Sparquote, die auf Heute/Finanzen bereits damit rechnet.
  const rates = months
    .map((m) => ({
      m,
      t: m === thisMonth ? monthTotalsErwartet(i.transactions, i.recurring, m, i.today) : monthTotals(i.transactions, m),
    }))
    .filter((x) => x.t.income > 0)
  if (rates.length < 3) return []
  const cur = rates[rates.length - 1]
  const past = rates.slice(0, -1)
  if (!past.length) return []
  // Ein angebrochener Monat ganz ohne Einnahmen und ohne erwartete Einnahmen
  // ergibt absurde Quoten (2,50 € Einnahmen gegen 163 € Ausgaben sind
  // -6.440 %). Solche Monate sind noch nicht vergleichbar.
  if (cur.t.income < cur.t.expense * 0.5) return []
  const avg = past.reduce((s, x) => s + x.t.savingsRatePercent, 0) / past.length
  if (Math.abs(cur.t.savingsRatePercent - avg) < 5) return []
  const better = cur.t.savingsRatePercent > avg
  const projected = 'projected' in cur.t && cur.t.projected
  return [{
    kind: 'savings_rate',
    severity: better ? 'info' : 'attention',
    title: `Sparquote ${cur.t.savingsRatePercent} %${projected ? ' erwartet' : ''} – ${better ? 'über' : 'unter'} deinem Schnitt`,
    body: `Durchschnitt der ${past.length} Vormonate: ${Math.round(avg * 10) / 10} %.`
      + (projected ? ' Die Einnahmen, die diesen Monat noch kommen, sind mitgerechnet.' : ''),
    evidence: { current: cur.t.savingsRatePercent, average: Math.round(avg * 10) / 10, projected, months: rates.map((r) => ({ month: r.m, rate: r.t.savingsRatePercent })) },
    isStatistical: false,
  }]
}

function taskLoad(i: InsightInput, today: DayString): GeneratedInsight[] {
  const overdue = i.tasks.filter(
    (t) => !t.deleted_at && t.status !== 'done' && t.status !== 'cancelled' &&
      ((t.due_on && t.due_on < today) || (t.scheduled_on && t.scheduled_on < today)),
  )
  if (overdue.length < 3) return []
  return [{
    kind: 'task_overdue',
    severity: overdue.length > 8 ? 'attention' : 'info',
    title: `${overdue.length} Aufgaben sind überfällig`,
    body: 'Verschieben oder streichen hält die Liste ehrlich – eine Liste, der man nicht mehr glaubt, plant nichts mehr.',
    evidence: { count: overdue.length, titles: overdue.slice(0, 5).map((t) => t.title) },
    isStatistical: false,
  }]
}

function metricNotes(i: InsightInput, today: DayString): GeneratedInsight[] {
  const out: GeneratedInsight[] = []
  const from = addDays(today, -13)
  for (const m of i.metrics) {
    if (!m.is_enabled) continue
    const series = dailySeries(i.metricEntries, m, from, today)
    const values = series.map((s) => s.value).filter((v): v is number => v !== null)
    if (values.length < 5) continue
    const avg = aggregate(values, m.aggregation === 'sum' ? 'avg' : m.aggregation)
    if (avg === null) continue
    const target = targetFor(i.metricTargets, m.id, today)
    if (!target) continue
    const zone = evaluateZone(avg, target)
    if (zone.status === 'optimal' || zone.status === 'unknown') continue
    out.push({
      kind: 'metric_zone',
      severity: zone.status === 'outside' ? 'attention' : 'info',
      title: `${m.name}: Ø ${format(avg, m.decimals)} ${m.unit} in 14 Tagen`,
      body: `Zielbereich ${format(zone.greenMin ?? 0, m.decimals)}–${format(zone.greenMax ?? 0, m.decimals)} ${m.unit}. Beobachtung über ${values.length} Tage mit Eintrag.`,
      evidence: { metric: m.key, average: avg, days: values.length, greenMin: zone.greenMin, greenMax: zone.greenMax },
      isStatistical: true,
    })
  }
  return out.slice(0, 3)
}

function format(n: number, decimals: number): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
}

/** Hinweistext für statistische Aussagen – Zusammenhang ist keine Ursache. */
export const STATISTICAL_DISCLAIMER =
  'Das ist eine statistische Beobachtung in deinen eigenen Daten, keine Ursache und keine medizinische Aussage.'
