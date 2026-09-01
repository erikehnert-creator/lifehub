/**
 * Finanzberechnungen – reine Funktionen ohne Datenbank- oder Netzzugriff.
 * Alles hier ist deterministisch und vollständig testbar. Das ist Absicht:
 * Finanzberechnungen sind der Teil, der unbedingt stimmen muss.
 */
import type { Account, Budget, Category, Transaction, RecurringRule, TransactionType } from './types'
import { type Cents, percentOf, formatNumber } from './money'
import {
  type DayString, monthOf, monthStart, monthEnd, diffDays, todayString, addDays,
  addMonthsToYearMonth, formatDay,
} from './dates'
import { occurrences } from './recurrence'

/** Wirkung einer Buchung auf ein bestimmtes Konto. */
export function effectOnAccount(tx: Transaction, accountId: string): Cents {
  if (tx.type === 'transfer') {
    if (tx.account_id === accountId) return -tx.amount_cents
    if (tx.to_account_id === accountId) return tx.amount_cents
    return 0
  }
  if (tx.account_id !== accountId) return 0
  return tx.type === 'income' ? tx.amount_cents : -tx.amount_cents
}

export function accountBalance(
  account: Account,
  transactions: Transaction[],
  upTo: DayString | null = null,
): Cents {
  let sum = account.opening_balance_cents
  for (const tx of transactions) {
    if (tx.status === 'void' || tx.status === 'planned') continue
    if (upTo && tx.booked_on > upTo) continue
    sum += effectOnAccount(tx, account.id)
  }
  return sum
}

export function accountBalances(
  accounts: Account[],
  transactions: Transaction[],
  upTo: DayString | null = null,
): Map<string, Cents> {
  const out = new Map<string, Cents>()
  for (const a of accounts) out.set(a.id, a.opening_balance_cents)
  for (const tx of transactions) {
    if (tx.status === 'void' || tx.status === 'planned') continue
    if (upTo && tx.booked_on > upTo) continue
    if (tx.type === 'transfer') {
      if (out.has(tx.account_id)) out.set(tx.account_id, out.get(tx.account_id)! - tx.amount_cents)
      if (tx.to_account_id && out.has(tx.to_account_id))
        out.set(tx.to_account_id, out.get(tx.to_account_id)! + tx.amount_cents)
    } else if (out.has(tx.account_id)) {
      const delta = tx.type === 'income' ? tx.amount_cents : -tx.amount_cents
      out.set(tx.account_id, out.get(tx.account_id)! + delta)
    }
  }
  return out
}

export function netWorth(accounts: Account[], balances: Map<string, Cents>): Cents {
  let sum = 0
  for (const a of accounts) {
    if (!a.include_in_net_worth) continue
    sum += balances.get(a.id) ?? 0
  }
  return sum
}

export function availableMoney(accounts: Account[], balances: Map<string, Cents>): Cents {
  let sum = 0
  for (const a of accounts) {
    if (!a.counts_as_available || !a.is_active) continue
    sum += balances.get(a.id) ?? 0
  }
  return sum
}

export function savingsBalance(accounts: Account[], balances: Map<string, Cents>): Cents {
  let sum = 0
  for (const a of accounts) {
    if (!a.counts_as_savings) continue
    sum += balances.get(a.id) ?? 0
  }
  return sum
}

// ---------------------------------------------------------------- Zeiträume

export function inMonth(tx: Transaction, yearMonth: string): boolean {
  return monthOf(tx.booked_on) === yearMonth
}

export function inRange(tx: Transaction, from: DayString, to: DayString): boolean {
  return tx.booked_on >= from && tx.booked_on <= to
}

export function isCounted(tx: Transaction): boolean {
  return tx.status !== 'void' && tx.status !== 'planned' && !tx.deleted_at
}

export interface PeriodTotals {
  income: Cents
  expense: Cents
  savings: Cents
  savingsRatePercent: number
  transferVolume: Cents
  transactionCount: number
}

/**
 * Kernkennzahlen eines Zeitraums.
 * Transfers zwischen eigenen Konten zählen bewusst NICHT als Einnahme oder Ausgabe.
 */
export function periodTotals(
  transactions: Transaction[],
  from: DayString,
  to: DayString,
  excludedCategoryIds: Set<string> = new Set(),
): PeriodTotals {
  let income = 0
  let expense = 0
  let transferVolume = 0
  let count = 0
  for (const tx of transactions) {
    if (!isCounted(tx) || !inRange(tx, from, to)) continue
    count++
    if (tx.type === 'transfer') {
      transferVolume += tx.amount_cents
      continue
    }
    if (tx.category_id && excludedCategoryIds.has(tx.category_id)) continue
    if (tx.type === 'income') income += tx.amount_cents
    else expense += tx.amount_cents
  }
  const savings = income - expense
  return {
    income,
    expense,
    savings,
    savingsRatePercent: percentOf(savings, income),
    transferVolume,
    transactionCount: count,
  }
}

/**
 * Anzeige der Sparquote.
 * Ohne Einnahmen ist die Quote nicht definiert – dann "–" statt "0 %".
 * Unter −100 % wird der genaue Wert unlesbar (ein Monat mit 2,50 € Einnahmen
 * und 163 € Ausgaben ergäbe −6.440 %); dort zeigen wir die Aussage statt der Zahl.
 */
export function formatSavingsRate(rate: number, income: Cents): string {
  if (income <= 0) return '–'
  if (rate < -100) return 'unter −100 %'
  return `${prozent(rate)} %`
}

/** Prozentzahl deutsch: „83,2" statt „83.2", ganze Zahlen ohne Nachkomma. */
function prozent(n: number): string {
  return formatNumber(n, Number.isInteger(n) ? 0 : 1)
}

// ------------------------------------------------- Wiederkehrende Zahlungen

export interface DueBooking {
  rule: RecurringRule
  day: DayString
  template: Record<string, any>
}

/** Weiter als drei Monate wird nicht nachgebucht. */
export const MAX_NACHHOLEN_TAGE = 92

/**
 * Welche wiederkehrenden Zahlungen sind fällig, aber noch nicht gebucht?
 *
 * Jede erzeugte Buchung ist danach eigenständig. Ändert sich später der Betrag
 * der Regel – etwa weil das Gehalt steigt –, bleiben bereits gebuchte Beträge
 * unverändert. Genau das ist gewollt: Buchhaltung schreibt Vergangenheit nicht um.
 */
export function dueRecurringBookings(
  rules: RecurringRule[],
  transactions: Transaction[],
  today: DayString = todayString(),
  maxLookbackDays: number = MAX_NACHHOLEN_TAGE,
): DueBooking[] {
  // Nicht beliebig weit zurück buchen. Eine frisch angelegte Regel mit einem
  // Startdatum vor zwei Jahren würde sonst zwei Jahre Miete nachbuchen und
  // sämtliche Kontostände verfälschen. Was länger her ist, ist keine offene
  // Zahlung mehr, sondern Vergangenheit.
  const frueheste = addDays(today, -maxLookbackDays)
  const out: DueBooking[] = []
  for (const r of rules) {
    if (r.deleted_at || !r.is_active || r.kind !== 'transaction') continue
    let template: Record<string, any> = {}
    try { template = JSON.parse(r.template_json || '{}') } catch { continue }
    if (!template.account_id) continue
    const roh = r.last_generated_on ? addDays(r.last_generated_on, 1) : r.starts_on
    const from = roh < frueheste ? frueheste : roh
    if (from > today) continue
    const end = r.ends_on && r.ends_on < today ? r.ends_on : today
    for (const day of occurrences(r.rrule, r.starts_on, from, end)) {
      const exists = transactions.some(
        (t) => !t.deleted_at && t.recurring_id === r.id && t.booked_on === day,
      )
      if (!exists) out.push({ rule: r, day, template })
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1))
}

/**
 * Was steht laut den wiederkehrenden Regeln in einem Zeitraum noch an?
 * Gezählt wird unabhängig davon, ob schon gebucht wurde – der Aufrufer gibt
 * deshalb den Zeitraum an, der ihn interessiert (meist: ab morgen).
 */
export function expectedRecurring(
  rules: RecurringRule[],
  from: DayString,
  to: DayString,
): { income: Cents; expense: Cents } {
  let income = 0
  let expense = 0
  if (from > to) return { income, expense }
  for (const r of rules) {
    if (r.deleted_at || !r.is_active || r.kind !== 'transaction') continue
    let tpl: Record<string, any> = {}
    try { tpl = JSON.parse(r.template_json || '{}') } catch { continue }
    const betrag = Number(tpl.amount_cents ?? 0)
    if (!betrag) continue
    const ende = r.ends_on && r.ends_on < to ? r.ends_on : to
    const anzahl = occurrences(r.rrule, r.starts_on, from, ende).length
    if (!anzahl) continue
    if (tpl.type === 'income') income += betrag * anzahl
    else if (tpl.type === 'expense') expense += betrag * anzahl
  }
  return { income, expense }
}

export type EinnahmenQuelle = 'regeln' | 'schnitt' | 'keine'

/** Regel, deren nächste Fälligkeit eine erwartete Einnahme erklärt (für den Hinweistext). */
export interface RegelHerkunft {
  titel: string
  tag: DayString
}

export interface ErwarteteEinnahmen {
  cents: Cents
  quelle: EinnahmenQuelle
  /** Nur gesetzt, wenn `quelle === 'regeln'` – welche Regel liefert die nächste Fälligkeit. */
  regel?: RegelHerkunft | null
}

/**
 * Welche Regel liefert im Zeitraum als Erstes eine noch offene Einnahme?
 * Dient nur der Anzeige – dem Hinweistext, der erklärt, woher die erwartete
 * Einnahme kommt, statt nur "eine Regel" zu sagen.
 */
function naechsteEinnahmeRegel(
  rules: RecurringRule[],
  from: DayString,
  to: DayString,
): RegelHerkunft | null {
  let best: RegelHerkunft | null = null
  for (const r of rules) {
    if (r.deleted_at || !r.is_active || r.kind !== 'transaction') continue
    let tpl: Record<string, any> = {}
    try { tpl = JSON.parse(r.template_json || '{}') } catch { continue }
    if (tpl.type !== 'income' || !tpl.amount_cents) continue
    const ende = r.ends_on && r.ends_on < to ? r.ends_on : to
    const tage = occurrences(r.rrule, r.starts_on, from, ende)
    if (!tage.length) continue
    if (!best || tage[0] < best.tag) best = { titel: r.title, tag: tage[0] }
  }
  return best
}

/**
 * Was im laufenden Monat an Einnahmen noch zu erwarten ist.
 *
 * Zuerst wird gefragt, was fest eingetragen ist – eine wiederkehrende
 * Zahlung „Ausbildungsvergütung am 28." ist die verlässlichste Auskunft.
 * Gibt es keine, hilft der Schnitt der letzten drei Monate weiter. Das ist
 * eine Schätzung und wird auch so benannt, aber es ist allemal näher an der
 * Wahrheit als „diesen Monat gab es bisher 2,50 € Einnahmen".
 */
export function expectedIncomeRest(
  transactions: Transaction[],
  rules: RecurringRule[],
  yearMonth: string,
  today: DayString = todayString(),
): ErwarteteEinnahmen {
  const von = addDays(today, 1)
  const bis = monthEnd(yearMonth)
  const ausRegeln = expectedRecurring(rules, von, bis).income
  if (ausRegeln > 0) return { cents: ausRegeln, quelle: 'regeln', regel: naechsteEinnahmeRegel(rules, von, bis) }

  const vormonate: Cents[] = []
  for (let i = 1; i <= 3; i++) {
    const m = addMonthsToYearMonth(yearMonth, -i)
    const t = periodTotals(transactions, monthStart(m), monthEnd(m))
    if (t.income > 0) vormonate.push(t.income)
  }
  if (!vormonate.length) return { cents: 0, quelle: 'keine' }

  const schnitt = Math.round(vormonate.reduce((a, b) => a + b, 0) / vormonate.length)
  const bisher = periodTotals(transactions, monthStart(yearMonth), monthEnd(yearMonth)).income
  const rest = Math.max(0, schnitt - bisher)
  return rest > 0 ? { cents: rest, quelle: 'schnitt' } : { cents: 0, quelle: 'keine' }
}

export interface MonthTotalsErwartet extends PeriodTotals {
  /** true, wenn in `income` noch nicht gebuchte, aber erwartete Einnahmen stecken. */
  projected: boolean
  /** Einnahmen, die tatsächlich schon gebucht sind – ohne die Erwartung. */
  actualIncome: Cents
  quelle: EinnahmenQuelle
}

/**
 * Monatskennzahlen für die Anzeige – EINE Stelle, die überall dasselbe Bild
 * zeigt. Im laufenden Monat wird die erwartete, aber noch nicht gebuchte
 * Einnahme (z. B. das Gehalt vor dem Zahltag) in `income` eingerechnet, sonst
 * stünden Einnahmen, Sparquote und Hinweise am Monatsanfang im Widerspruch
 * zueinander. Für vergangene (und zukünftige) Monate ist es identisch mit
 * monthTotals() – da ist ohnehin schon alles gebucht.
 *
 * Wichtig: Das betrifft nur die Anzeige von Einnahmen/Sparquote. Kontostände
 * (accountBalance/accountBalances) rechnen davon nichts mit – dort erscheint
 * das Gehalt erst am Tag der tatsächlichen Buchung.
 */
export function monthTotalsErwartet(
  transactions: Transaction[],
  rules: RecurringRule[],
  yearMonth: string,
  today: DayString = todayString(),
): MonthTotalsErwartet {
  const totals = monthTotals(transactions, yearMonth)
  if (yearMonth !== monthOf(today)) {
    return { ...totals, projected: false, actualIncome: totals.income, quelle: 'keine' }
  }
  const offene = expectedIncomeRest(transactions, rules, yearMonth, today)
  const outstanding = Math.max(0, offene.cents)
  if (outstanding <= 0) {
    return { ...totals, projected: false, actualIncome: totals.income, quelle: offene.quelle }
  }
  const income = totals.income + outstanding
  const savings = income - totals.expense
  return {
    income, expense: totals.expense, savings,
    savingsRatePercent: percentOf(savings, income),
    transferVolume: totals.transferVolume, transactionCount: totals.transactionCount,
    projected: true, actualIncome: totals.income, quelle: offene.quelle,
  }
}

export interface SavingsRateView {
  /** Quote in Prozent – nur aussagekräftig, wenn `defined` stimmt. */
  rate: number
  income: Cents
  expense: Cents
  savings: Cents
  defined: boolean
  /** Beruht auf Einnahmen, die erst noch kommen. */
  expected: boolean
  outstandingIncome: Cents
  text: string
  hint: string | null
}

/**
 * Sparquote des laufenden Monats – so, dass sie am Monatsanfang nicht lügt.
 *
 * Erik bekommt sein Gehalt am Monatsende. Am 5. stünden ein paar Ausgaben null
 * Einnahmen gegenüber; die nackte Rechnung ergäbe „unter −100 %", obwohl der
 * Monat ganz normal läuft. Für den laufenden Monat zählen deshalb die fest
 * erwarteten Einnahmen aus den wiederkehrenden Regeln mit – und die Anzeige
 * sagt ausdrücklich dazu, dass es eine Erwartung ist.
 *
 * Für abgeschlossene Monate bleibt alles wie gehabt: nur echte Zahlen.
 */
export function savingsRateView(
  totals: PeriodTotals,
  outstandingIncome: Cents,
  isCurrentMonth: boolean,
  quelle: EinnahmenQuelle = 'regeln',
  regel: RegelHerkunft | null = null,
): SavingsRateView {
  const basis = isCurrentMonth ? totals.income + Math.max(0, outstandingIncome) : totals.income
  const savings = basis - totals.expense
  const rate = percentOf(savings, basis)
  const expected = isCurrentMonth && outstandingIncome > 0
  if (basis <= 0) {
    return {
      rate: 0, income: basis, expense: totals.expense, savings, defined: false,
      expected, outstandingIncome, text: '–',
      hint: isCurrentMonth ? 'Noch keine Einnahmen in diesem Monat.' : null,
    }
  }
  return {
    rate, income: basis, expense: totals.expense, savings, defined: true,
    expected, outstandingIncome,
    text: `${rate < -100 ? 'unter −100' : prozent(rate)} %${expected ? ' erwartet' : ''}`,
    hint: !expected ? null
      : quelle === 'schnitt'
        ? 'Geschätzt aus dem Schnitt der letzten Monate. Trag deine Ausbildungsvergütung unter „Wiederkehrend" ein – dann wird daraus eine feste Zahl.'
        : quelle === 'regeln' && regel
          ? `Kommt aus deiner wiederkehrenden Zahlung „${regel.titel}", fällig am ${formatDay(regel.tag, 'short')}.`
          : 'Die Einnahmen, die diesen Monat noch kommen, sind mitgerechnet.',
  }
}

/** Ampel für die Monatsprognose: Läuft der Monat gut, mittel oder schlecht? */
export function forecastStatus(f: MonthForecast): {
  status: BudgetStatus
  label: string
  sentence: string
} {
  if (f.projectedIncome <= 0) {
    return {
      status: 'amber', label: 'Noch offen',
      sentence: 'Für diesen Monat sind noch keine Einnahmen bekannt – die Prognose sagt deshalb wenig.',
    }
  }
  const quote = percentOf(f.projectedSavings, f.projectedIncome)
  if (f.projectedSavings < 0) {
    return {
      status: 'red', label: 'Es wird knapp',
      sentence: 'So wie der Monat läuft, gibst du mehr aus, als hereinkommt.',
    }
  }
  if (quote < 15) {
    return {
      status: 'amber', label: 'Geht auf',
      sentence: `Am Monatsende bleiben voraussichtlich ${prozent(quote)} % übrig – wenig Luft, aber kein Minus.`,
    }
  }
  return {
    status: 'green', label: 'Läuft gut',
    sentence: `Am Monatsende bleiben voraussichtlich ${prozent(quote)} % übrig.`,
  }
}

export function monthTotals(
  transactions: Transaction[],
  yearMonth: string,
  excluded?: Set<string>,
): PeriodTotals {
  return periodTotals(transactions, monthStart(yearMonth), monthEnd(yearMonth), excluded)
}

export interface CategoryTotal {
  categoryId: string | null
  name: string
  color: string | null
  amount: Cents
  share: number
  count: number
}

export function totalsByCategory(
  transactions: Transaction[],
  categories: Category[],
  from: DayString,
  to: DayString,
  kind: 'expense' | 'income' = 'expense',
): CategoryTotal[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const acc = new Map<string, { amount: Cents; count: number }>()
  let total = 0
  for (const tx of transactions) {
    if (!isCounted(tx) || tx.type !== kind || !inRange(tx, from, to)) continue
    const key = tx.category_id ?? '__none__'
    const cur = acc.get(key) ?? { amount: 0, count: 0 }
    cur.amount += tx.amount_cents
    cur.count += 1
    acc.set(key, cur)
    total += tx.amount_cents
  }
  const out: CategoryTotal[] = []
  for (const [key, v] of acc) {
    const cat = key === '__none__' ? null : byId.get(key)
    out.push({
      categoryId: key === '__none__' ? null : key,
      name: cat?.name ?? 'Nicht kategorisiert',
      color: cat?.color ?? null,
      amount: v.amount,
      share: total === 0 ? 0 : Math.round((v.amount / total) * 1000) / 10,
      count: v.count,
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

export function totalsByAccount(
  transactions: Transaction[],
  accounts: Account[],
  from: DayString,
  to: DayString,
): { accountId: string; name: string; amount: Cents }[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const acc = new Map<string, Cents>()
  for (const tx of transactions) {
    if (!isCounted(tx) || tx.type !== 'expense' || !inRange(tx, from, to)) continue
    acc.set(tx.account_id, (acc.get(tx.account_id) ?? 0) + tx.amount_cents)
  }
  return [...acc.entries()]
    .map(([accountId, amount]) => ({ accountId, name: byId.get(accountId)?.name ?? '?', amount }))
    .sort((a, b) => b.amount - a.amount)
}

/** Buchungen eines Kontos (auch als Transferziel), neueste zuerst. */
export function transactionsForAccount(
  transactions: Transaction[],
  accountId: string,
  from?: DayString,
): Transaction[] {
  return transactions
    .filter((t) => !t.deleted_at && (from === undefined || t.booked_on >= from)
      && (t.account_id === accountId || t.to_account_id === accountId))
    .sort((a, b) => (a.booked_on < b.booked_on ? 1 : -1))
}

/** Die häufigsten Händler/Empfänger-Werte für einen Buchungstyp. */
export function topMerchants(transactions: Transaction[], type: TransactionType, limit = 5): string[] {
  const counts = new Map<string, number>()
  for (const t of transactions) {
    if (t.deleted_at || t.type !== type || !t.merchant) continue
    counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name)
}

// ------------------------------------------------------------------ Budgets

export type BudgetStatus = 'green' | 'amber' | 'red'

export interface BudgetProgress {
  budget: Budget
  categoryName: string
  categoryColor: string | null
  spent: Cents
  limit: Cents
  remaining: Cents
  usedPercent: number
  status: BudgetStatus
  daysLeft: number
  paceExpectedPercent: number
  onTrack: boolean
}

export function budgetStatus(spent: Cents, limit: Cents, warnAtPercent: number): BudgetStatus {
  if (limit <= 0) return 'green'
  const used = (spent / limit) * 100
  if (used > 100) return 'red'
  if (used >= warnAtPercent) return 'amber'
  return 'green'
}

export function budgetProgress(
  budgets: Budget[],
  transactions: Transaction[],
  categories: Category[],
  yearMonth: string,
  today: DayString = todayString(),
): BudgetProgress[] {
  const from = monthStart(yearMonth)
  const to = monthEnd(yearMonth)
  const catById = new Map(categories.map((c) => [c.id, c]))
  // Ein Budget auf einer Oberkategorie zählt auch die Buchungen ihrer
  // Unterkategorien. Sonst wäre ein Budget auf "Fixkosten" immer bei 0 %,
  // obwohl die Buchungen unter "Sprit", "Abos" usw. liegen.
  const childrenOf = new Map<string, Set<string>>()
  for (const c of categories) {
    if (!c.parent_id) continue
    const set = childrenOf.get(c.parent_id) ?? new Set<string>()
    set.add(c.id)
    childrenOf.set(c.parent_id, set)
  }
  const familyOf = (id: string): Set<string> => {
    const out = new Set<string>([id])
    const queue = [id]
    let guard = 0
    while (queue.length && guard++ < 500) {
      const cur = queue.shift()!
      for (const child of childrenOf.get(cur) ?? []) {
        if (out.has(child)) continue
        out.add(child)
        queue.push(child)
      }
    }
    return out
  }
  const totalDays = diffDays(from, to) + 1
  const elapsed = today < from ? 0 : today > to ? totalDays : diffDays(from, today) + 1

  return budgets
    .filter((b) => !b.deleted_at && b.valid_from <= to && (!b.valid_to || b.valid_to >= from))
    .map((b) => {
      const family = b.category_id ? familyOf(b.category_id) : null
      let spent = 0
      for (const tx of transactions) {
        if (!isCounted(tx) || tx.type !== 'expense' || !inRange(tx, from, to)) continue
        if (family && (!tx.category_id || !family.has(tx.category_id))) continue
        spent += tx.amount_cents
      }
      const cat = b.category_id ? catById.get(b.category_id) : null
      const usedPercent = b.amount_cents === 0 ? 0 : Math.round((spent / b.amount_cents) * 1000) / 10
      const paceExpected = Math.round((elapsed / totalDays) * 1000) / 10
      return {
        budget: b,
        categoryName: cat?.name ?? 'Gesamtbudget',
        categoryColor: cat?.color ?? null,
        spent,
        limit: b.amount_cents,
        remaining: b.amount_cents - spent,
        usedPercent,
        status: budgetStatus(spent, b.amount_cents, b.warn_at_percent),
        daysLeft: Math.max(0, totalDays - elapsed),
        paceExpectedPercent: paceExpected,
        onTrack: usedPercent <= paceExpected + 5,
      }
    })
    .sort((a, b) => b.usedPercent - a.usedPercent)
}

// ---------------------------------------------------------------- Prognosen

export interface MonthForecast {
  yearMonth: string
  elapsedDays: number
  totalDays: number
  actualIncome: Cents
  actualExpense: Cents
  expectedIncome: Cents
  projectedExpense: Cents
  projectedIncome: Cents
  plannedIncome: Cents
  plannedExpense: Cents
  projectedSavings: Cents
  projectedSavingsRate: number
}

/**
 * Ø Tagesausgaben der letzten (bis zu) drei abgeschlossenen Monate.
 * Dieselbe Drei-Monats-Betrachtung wie bei expectedIncomeRest() – ein
 * einzelner Monat kann ein Ausreißer sein (Weihnachten, Urlaubsreise),
 * drei Monate glätten das. Monate ohne Ausgaben (z. B. vor Kontoeröffnung)
 * zählen nicht mit. null kommt zurück, wenn es gar keine Vormonate mit
 * Ausgaben gibt – dann kann nicht historisch geschätzt werden.
 */
function historicalDailyExpense(
  transactions: Transaction[],
  yearMonth: string,
  lookbackMonths = 3,
): number | null {
  const tagesschnitte: number[] = []
  for (let i = 1; i <= lookbackMonths; i++) {
    const m = addMonthsToYearMonth(yearMonth, -i)
    const t = monthTotals(transactions, m)
    if (t.expense <= 0) continue
    const tage = diffDays(monthStart(m), monthEnd(m)) + 1
    tagesschnitte.push(t.expense / tage)
  }
  if (!tagesschnitte.length) return null
  return tagesschnitte.reduce((a, b) => a + b, 0) / tagesschnitte.length
}

/**
 * Monatsprognose: bereits gebuchte Werte plus Hochrechnung des Restmonats
 * plus fest geplante Zahlungen (status = 'planned').
 * Ergebnis ist ausdrücklich eine Schätzung, keine Zusage.
 */
export function forecastMonth(
  transactions: Transaction[],
  yearMonth: string,
  today: DayString = todayString(),
  /**
   * Einnahmen, die im Rest des Monats noch sicher kommen (Gehalt am 28.).
   * Ohne sie sagt die Prognose am Monatsanfang „es wird knapp", obwohl der
   * Monat völlig normal läuft.
   */
  erwarteteEinnahmen: Cents = 0,
): MonthForecast {
  const from = monthStart(yearMonth)
  const to = monthEnd(yearMonth)
  const totalDays = diffDays(from, to) + 1
  const elapsed = today < from ? 0 : today > to ? totalDays : diffDays(from, today) + 1

  let actualIncome = 0
  let actualExpense = 0
  let plannedIncome = 0
  let plannedExpense = 0
  for (const tx of transactions) {
    if (tx.deleted_at || tx.type === 'transfer' || !inRange(tx, from, to)) continue
    if (tx.status === 'planned') {
      if (tx.booked_on < today) continue
      if (tx.type === 'income') plannedIncome += tx.amount_cents
      else plannedExpense += tx.amount_cents
    } else if (tx.status !== 'void') {
      if (tx.type === 'income') actualIncome += tx.amount_cents
      else actualExpense += tx.amount_cents
    }
  }

  const remainingDays = Math.max(0, totalDays - elapsed)
  /**
   * Tagesschnitt für die Hochrechnung des Restmonats.
   *
   * Nur den bisherigen Tagesschnitt des laufenden Monats zu nehmen, ist
   * gerade am Monatsanfang unbrauchbar: Am 2. eines Monats wiegt eine
   * einzelne Ausgabe (oder gar keine) mehr als der ganze restliche Monat –
   * die Hochrechnung läge dann entweder nahe null oder würde durch einen
   * einzelnen großen Einkauf wild nach oben ausschlagen. Deshalb wird der
   * bisherige Tagesschnitt mit dem Tagesschnitt der letzten drei Monate
   * gemischt: Am Monatsanfang zählt größtenteils die Erfahrung aus den
   * Vormonaten, gegen Monatsende größtenteils der tatsächliche Verlauf
   * dieses Monats. Der Übergang ist linear über den Anteil des bereits
   * vergangenen Monats (elapsed / totalDays) – kein Sprung, sondern ein
   * gleitender Wechsel von Erfahrungswert zu echtem Verlauf.
   * Gibt es keine Vormonate mit Ausgaben (z. B. ganz neue App), bleibt es
   * beim bisherigen Verhalten: nur der laufende Tagesschnitt zählt.
   */
  const dailyBurnBisher = elapsed > 0 ? actualExpense / elapsed : 0
  const dailyBurnSchnitt = historicalDailyExpense(transactions, yearMonth)
  const anteilVergangen = totalDays > 0 ? Math.min(1, elapsed / totalDays) : 1
  const dailyBurn = dailyBurnSchnitt === null
    ? dailyBurnBisher
    : dailyBurnSchnitt * (1 - anteilVergangen) + dailyBurnBisher * anteilVergangen
  const projectedExpense = Math.round(actualExpense + dailyBurn * remainingDays) + plannedExpense
  const projectedIncome = actualIncome + plannedIncome + Math.max(0, erwarteteEinnahmen)
  const projectedSavings = projectedIncome - projectedExpense

  return {
    yearMonth,
    elapsedDays: elapsed,
    totalDays,
    actualIncome,
    actualExpense,
    expectedIncome: Math.max(0, erwarteteEinnahmen),
    projectedExpense,
    projectedIncome,
    plannedIncome,
    plannedExpense,
    projectedSavings,
    projectedSavingsRate: percentOf(projectedSavings, projectedIncome),
  }
}

/** Reihe für Diagramme: Einnahmen/Ausgaben/Sparbetrag je Monat. */
export function monthlySeries(
  transactions: Transaction[],
  months: string[],
): { month: string; income: Cents; expense: Cents; savings: Cents; rate: number }[] {
  return months.map((m) => {
    const t = monthTotals(transactions, m)
    return { month: m, income: t.income, expense: t.expense, savings: t.savings, rate: t.savingsRatePercent }
  })
}

/** Vermögensverlauf am Monatsende. */
export function netWorthSeries(
  accounts: Account[],
  transactions: Transaction[],
  months: string[],
): { month: string; value: Cents }[] {
  return months.map((m) => {
    const balances = accountBalances(accounts, transactions, monthEnd(m))
    return { month: m, value: netWorth(accounts, balances) }
  })
}
