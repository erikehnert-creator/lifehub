/**
 * FINANZTAG – die Checkliste wird aus dem tatsächlichen Zustand erzeugt,
 * nicht stumpf immer gleich angezeigt.
 * Jeder Punkt kennt seinen Anlass und ist damit begründbar.
 */
import type { Account, Transaction, Budget, Category, Goal, RecurringRule } from './types'
import { accountBalances, budgetProgress, monthTotals, forecastMonth } from './finance'
import { formatMoney } from './money'
import { type DayString, monthOf, todayString, addDays, diffDays, formatDay, addMonthsToYearMonth } from './dates'
import { nextOccurrence } from './recurrence'

export interface ChecklistItem {
  key: string
  title: string
  detail: string
  reason: string
  priority: 1 | 2 | 3
  action?: { kind: string; payload?: any }
  done?: boolean
}

export interface FinanceDayInput {
  accounts: Account[]
  transactions: Transaction[]
  budgets: Budget[]
  categories: Category[]
  goals: Goal[]
  recurring: RecurringRule[]
  today: DayString
  lastRunOn: DayString | null
}

export function generateFinanceDayChecklist(i: FinanceDayInput): ChecklistItem[] {
  const today = i.today || todayString()
  const items: ChecklistItem[] = []
  const month = monthOf(today)
  const balances = accountBalances(i.accounts, i.transactions)

  // 1. Buchungen ohne Kategorie
  const uncategorised = i.transactions.filter(
    (t) => !t.deleted_at && t.type === 'expense' && !t.category_id && t.booked_on >= addDays(today, -60),
  )
  if (uncategorised.length) {
    items.push({
      key: 'uncategorised',
      title: `${uncategorised.length} Buchungen kategorisieren`,
      detail: uncategorised.slice(0, 3).map((t) => `${formatDay(t.booked_on, 'short')} ${formatMoney(t.amount_cents)}`).join(' · '),
      reason: 'Ohne Kategorie fehlen sie in Budget und Auswertung.',
      priority: 1,
      action: { kind: 'open_uncategorised' },
    })
  }

  // 2. Buchungen ohne Beleg über 100 €
  const missingReceipts = i.transactions.filter(
    (t) => !t.deleted_at && t.type === 'expense' && t.amount_cents >= 10000 && t.booked_on >= addDays(today, -30),
  )
  if (missingReceipts.length) {
    items.push({
      key: 'receipts',
      title: `${missingReceipts.length} größere Ausgaben prüfen`,
      detail: 'Ausgaben ab 100 € der letzten 30 Tage – Beleg vorhanden?',
      reason: 'Bei größeren Beträgen ist ein Beleg später oft wichtig.',
      priority: 3,
      action: { kind: 'open_transactions', payload: { minAmount: 10000, since: addDays(today, -30) } },
    })
  }

  // 3. Kontostände prüfen – Konten, die lange keine Buchung hatten
  for (const a of i.accounts) {
    if (!a.is_active) continue
    const last = i.transactions
      .filter((t) => !t.deleted_at && (t.account_id === a.id || t.to_account_id === a.id))
      .sort((x, y) => (x.booked_on < y.booked_on ? 1 : -1))[0]
    const lastDay = last?.booked_on ?? a.opening_date
    if (diffDays(lastDay, today) > 30) {
      items.push({
        key: `stale_${a.id}`,
        title: `Kontostand ${a.name} abgleichen`,
        detail: `Letzte Bewegung ${formatDay(lastDay)} · aktuell ${formatMoney(balances.get(a.id) ?? 0)}`,
        reason: 'Seit über 30 Tagen keine Buchung – vermutlich fehlt etwas.',
        priority: 2,
        action: { kind: 'reconcile_account', payload: { accountId: a.id } },
      })
    }
  }

  // 4. Bargeld gesondert: Kassensturz
  const cash = i.accounts.filter((a) => a.type === 'cash' && a.is_active)
  for (const c of cash) {
    items.push({
      key: `cash_${c.id}`,
      title: `Bargeld zählen (${c.name})`,
      detail: `Rechnerisch ${formatMoney(balances.get(c.id) ?? 0)}`,
      reason: 'Bargeld weicht erfahrungsgemäß am stärksten ab.',
      priority: 2,
      action: { kind: 'reconcile_account', payload: { accountId: c.id } },
    })
  }

  // 5. Budgets, die aus dem Ruder laufen
  const budgets = budgetProgress(i.budgets, i.transactions, i.categories, month, today)
  const critical = budgets.filter((b) => b.status !== 'green')
  if (critical.length) {
    items.push({
      key: 'budgets',
      title: `${critical.length} Budget${critical.length > 1 ? 's' : ''} prüfen`,
      detail: critical.slice(0, 3).map((b) => `${b.categoryName} ${Math.round(b.usedPercent)} %`).join(' · '),
      reason: 'Mindestens ein Budget steht auf Gelb oder Rot.',
      priority: 1,
      action: { kind: 'open_budgets' },
    })
  }

  // 6. Kommende wiederkehrende Zahlungen
  const upcoming: { title: string; day: DayString }[] = []
  for (const r of i.recurring) {
    if (r.deleted_at || !r.is_active || r.kind !== 'transaction') continue
    const next = nextOccurrence(r.rrule, r.starts_on, today)
    if (next && diffDays(today, next) <= 14) upcoming.push({ title: r.title, day: next })
  }
  if (upcoming.length) {
    items.push({
      key: 'upcoming',
      title: `${upcoming.length} Zahlung${upcoming.length > 1 ? 'en' : ''} in den nächsten 14 Tagen`,
      detail: upcoming.sort((a, b) => (a.day < b.day ? -1 : 1)).slice(0, 4).map((u) => `${formatDay(u.day, 'short')} ${u.title}`).join(' · '),
      reason: 'Damit die Liquidität nicht überrascht.',
      priority: 2,
      action: { kind: 'open_recurring' },
    })
  }

  // 7. Sparziele
  for (const g of i.goals) {
    if (g.deleted_at || g.status !== 'active' || g.domain !== 'finance') continue
    if (!g.target_on) continue
    const daysLeft = diffDays(today, g.target_on)
    if (daysLeft > 0 && daysLeft < 400) {
      items.push({
        key: `goal_${g.id}`,
        title: `Sparziel „${g.name}" prüfen`,
        detail: `Zieldatum ${formatDay(g.target_on)} · noch ${daysLeft} Tage`,
        reason: 'Regelmäßiger Blick verhindert das stille Zurückfallen.',
        priority: 3,
        action: { kind: 'open_goal', payload: { goalId: g.id } },
      })
    }
  }

  // 8. Monatsprognose
  const forecast = forecastMonth(i.transactions, month, today)
  if (forecast.elapsedDays >= 10) {
    items.push({
      key: 'forecast',
      title: 'Monatsprognose ansehen',
      detail: `Voraussichtlich ${formatMoney(forecast.projectedSavings)} Sparbetrag (${forecast.projectedSavingsRate} %)`,
      reason: 'Rechtzeitig gegensteuern ist einfacher als nachträglich erklären.',
      priority: 3,
      action: { kind: 'open_forecast' },
    })
  }

  // 9. Monatsabschluss (nur in den ersten Tagen des Folgemonats)
  const dayOfMonth = Number(today.slice(8, 10))
  if (dayOfMonth <= 5) {
    const prev = addMonthsToYearMonth(month, -1)
    const t = monthTotals(i.transactions, prev)
    items.push({
      key: 'closing',
      title: `Monatsabschluss ${prev} durchführen`,
      detail: `Einnahmen ${formatMoney(t.income)} · Ausgaben ${formatMoney(t.expense)} · Sparbetrag ${formatMoney(t.savings)}`,
      reason: 'Anfang des Monats sind die Zahlen des Vormonats vollständig.',
      priority: 1,
      action: { kind: 'close_month', payload: { yearMonth: prev } },
    })
  }

  return items.sort((a, b) => a.priority - b.priority)
}

/**
 * Zu welcher Route führt ein Klick auf einen Finanztag-Punkt?
 *
 * Ein Punkt wie „12 Buchungen kategorisieren" ist nutzlos, wenn er nur auf
 * die allgemeine Buchungsliste zeigt – dann sucht man die gemeinten
 * Buchungen von Hand wieder zusammen. Die Routen hier verlinken deshalb so
 * genau wie möglich auf das, worüber der Punkt tatsächlich spricht (per
 * Query an die Buchungsliste bzw. das betroffene Konto), statt nur auf den
 * Bereich. Eine Stelle für diese Übersetzung, damit Finanztag-Tab und die
 * Kurzfassung auf „Heute" nicht auseinanderlaufen.
 */
export function financeChecklistRoute(action?: ChecklistItem['action']): string | null {
  if (!action) return null
  switch (action.kind) {
    case 'open_uncategorised':
      return '#/finanzen/buchungen?uncategorised=1'
    case 'open_transactions': {
      const p = action.payload ?? {}
      const params: string[] = []
      if (p.minAmount) params.push(`minAmount=${encodeURIComponent(p.minAmount)}`)
      if (p.since) params.push(`since=${encodeURIComponent(p.since)}`)
      return `#/finanzen/buchungen${params.length ? '?' + params.join('&') : ''}`
    }
    case 'reconcile_account': {
      const id = action.payload?.accountId
      return id ? `#/finanzen/finanztag?account=${encodeURIComponent(id)}` : '#/finanzen/finanztag'
    }
    case 'open_budgets':
      return '#/finanzen/budgets'
    case 'open_recurring':
      return '#/finanzen/wiederkehrend'
    case 'open_goal':
      return '#/ziele'
    case 'open_forecast':
      return '#/finanzen'
    case 'close_month': {
      const ym = action.payload?.yearMonth
      return ym ? `#/finanzen?month=${encodeURIComponent(ym)}` : '#/finanzen'
    }
    default:
      return null
  }
}
