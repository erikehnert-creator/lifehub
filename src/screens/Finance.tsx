/**
 * FINANZEN – Übersicht, Buchungen, Konten, Budgets, Wiederkehrend, Finanztag.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Tabs, Empty, Confirm, StatusPill, MoneyInput } from '../ui/components'
import { AttachmentList, AttachmentBadge } from '../ui/attachments'
import { BarChart, LineChart, DonutChart, Meter, RankBars, seriesColor, ChartFrame } from '../charts'
import { useData, useMutations } from '../state/store'
import {
  accountBalances, accountBalance, effectOnAccount, netWorth, availableMoney, savingsBalance, monthTotals,
  totalsByCategory, totalsByAccount, budgetProgress, forecastMonth,
  monthlySeries, netWorthSeries, isCounted, formatSavingsRate,
  expectedRecurring, expectedIncomeRest, savingsRateView, forecastStatus, dueRecurringBookings,
  transactionsForAccount,
} from '../core/finance'
import { formatMoney, formatMoneyAxis, parseAmountToCents, toEuro, centsToInput } from '../core/money'
import {
  todayString, monthOf, formatDay, formatMonth, monthLabelShort, lastMonths,
  addMonthsToYearMonth, monthStart, monthEnd, addDays, relativeDay,
} from '../core/dates'
import { describeRRule, nextOccurrence, buildRRule, occurrences } from '../core/recurrence'
import { generateFinanceDayChecklist } from '../core/financeDay'
import type { Account, Transaction, Category, Budget } from '../core/types'
import { TransactionForm } from './QuickAdd'

const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'checking', label: 'Girokonto' },
  { value: 'cash', label: 'Bargeld' },
  { value: 'savings', label: 'Sparkonto' },
  { value: 'money_market', label: 'Tagesgeld' },
  { value: 'credit_card', label: 'Kreditkarte' },
  { value: 'depot', label: 'Depot' },
  { value: 'loan', label: 'Kredit' },
  { value: 'custom', label: 'Sonstiges' },
]

export function FinanceScreen({ sub, navigate, openQuickAdd }: {
  sub: string; navigate: (r: string) => void; openQuickAdd: (kind?: any) => void
}) {
  const tabs = [
    { key: '', label: 'Übersicht' },
    { key: 'buchungen', label: 'Buchungen' },
    { key: 'konten', label: 'Konten' },
    { key: 'budgets', label: 'Budgets' },
    { key: 'wiederkehrend', label: 'Wiederkehrend' },
    { key: 'finanztag', label: 'Finanztag' },
  ]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Finanzen</div>
          <div className="page-sub">Konten, Buchungen, Budgets und Prognose</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => openQuickAdd('transaction')}>+ Buchung</button>
        </div>
      </div>
      <Tabs tabs={tabs} active={sub} onChange={(k) => navigate(`#/finanzen${k ? '/' + k : ''}`)} />
      {sub === '' && <Overview navigate={navigate} />}
      {sub === 'buchungen' && <TransactionsTab openQuickAdd={openQuickAdd} />}
      {sub === 'konten' && <AccountsTab />}
      {sub === 'budgets' && <BudgetsTab />}
      {sub === 'wiederkehrend' && <RecurringTab />}
      {sub === 'finanztag' && <FinanceDayTab navigate={navigate} />}
    </div>
  )
}

/* ------------------------------------------------------------- Übersicht */

function Overview({ navigate }: { navigate: (r: string) => void }) {
  const data = useData()
  const today = todayString()
  const [month, setMonth] = useState(monthOf(today))

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const totals = useMemo(() => monthTotals(data.transactions, month), [data.transactions, month])
  const prev = useMemo(() => monthTotals(data.transactions, addMonthsToYearMonth(month, -1)), [data.transactions, month])
  const months = useMemo(() => lastMonths(month, 12), [month])
  const series = useMemo(() => monthlySeries(data.transactions, months), [data.transactions, months])
  const worth = useMemo(() => netWorthSeries(data.accounts, data.transactions, months), [data.accounts, data.transactions, months])
  const byCat = useMemo(
    () => totalsByCategory(data.transactions, data.categories, monthStart(month), monthEnd(month)),
    [data.transactions, data.categories, month],
  )
  const byAcc = useMemo(
    () => totalsByAccount(data.transactions, data.accounts, monthStart(month), monthEnd(month)),
    [data.transactions, data.accounts, month],
  )
  const isCurrentMonth = month === monthOf(today)

  // Im laufenden Monat zählen die Einnahmen mit, die laut deinen Regeln noch
  // kommen – sonst stünde am Monatsanfang eine Sparquote von „unter −100 %".
  const offeneEinnahmen = useMemo(
    () => (isCurrentMonth
      ? expectedIncomeRest(data.transactions, data.recurring, month, today)
      : { cents: 0, quelle: 'keine' as const }),
    [data.transactions, data.recurring, month, today, isCurrentMonth],
  )

  // Prognose und Sparquote müssen dieselbe Geschichte erzählen – beide
  // rechnen deshalb mit denselben erwarteten Einnahmen.
  const forecast = useMemo(
    () => forecastMonth(data.transactions, month, today, offeneEinnahmen.cents),
    [data.transactions, month, today, offeneEinnahmen],
  )
  const budgets = useMemo(
    () => budgetProgress(data.budgets, data.transactions, data.categories, month, today),
    [data.budgets, data.transactions, data.categories, month, today],
  )

  const nw = netWorth(data.accounts, balances)
  const avail = availableMoney(data.accounts, balances)
  const saved = savingsBalance(data.accounts, balances)

  const quote = useMemo(
    () => savingsRateView(totals, offeneEinnahmen.cents, isCurrentMonth, offeneEinnahmen.quelle),
    [totals, offeneEinnahmen, isCurrentMonth],
  )
  const ampel = useMemo(() => forecastStatus(forecast), [forecast])

  const money = (c: number) => formatMoney(c, { compact: true })
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100))
  const expenseChange = pct(totals.expense, prev.expense)

  return (
    <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row">
        <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, -1))}>←</button>
        <strong style={{ minWidth: 130, textAlign: 'center' }}>{formatMonth(month)}</strong>
        <button className="btn btn-sm" disabled={month >= monthOf(today)} onClick={() => setMonth(addMonthsToYearMonth(month, 1))}>→</button>
        {!isCurrentMonth && <button className="btn btn-sm btn-ghost" onClick={() => setMonth(monthOf(today))}>Heute</button>}
      </div>

      <div className="grid grid-4 keep2">
        <Card><Stat label="Gesamtvermögen" value={money(nw)} sub={<span className="muted small">alle Konten</span>} /></Card>
        <Card><Stat label="Verfügbar" value={money(avail)} sub={<span className="muted small">ohne Sparkonten</span>} /></Card>
        <Card><Stat label={quote.expected ? 'Sparbetrag Monat · erwartet' : 'Sparbetrag Monat'} value={money(quote.savings)}
          delta={`Sparquote ${quote.text}`}
          deltaKind={quote.savings >= 0 ? 'up' : 'down'}
          sub={quote.hint ?? undefined} /></Card>
        <Card><Stat label="Rücklagen" value={money(saved)} sub={<span className="muted small">als Sparen markiert</span>} /></Card>
      </div>

      <div className="grid grid-2">
        <Card title="Einnahmen und Ausgaben" sub="letzte 12 Monate · antippen zum Vergrößern">
          <ChartFrame title="Einnahmen und Ausgaben" sub="letzte 12 Monate">
            {({ height }) => (
              <BarChart
                data={series.map((s) => ({ label: monthLabelShort(s.month), values: [s.income, s.expense] }))}
                seriesNames={['Einnahmen', 'Ausgaben']}
                height={height}
                axisLabel="Euro"
                formatValue={(v) => formatMoney(v)}
                formatAxis={formatMoneyAxis}
              />
            )}
          </ChartFrame>
        </Card>
        <Card title="Sparbetrag und Sparquote" sub="letzte 12 Monate · antippen zum Vergrößern">
          <ChartFrame title="Sparbetrag je Monat" sub="letzte 12 Monate">
            {({ height }) => (
              <BarChart
                data={series.map((s) => ({ label: monthLabelShort(s.month), values: [s.savings] }))}
                seriesNames={['Sparbetrag']}
                height={height}
                axisLabel="Euro"
                formatValue={(v) => formatMoney(v)}
                formatAxis={formatMoneyAxis}
              />
            )}
          </ChartFrame>
          <div className="mt12">
            <ChartFrame title="Sparquote je Monat"
              sub="Anteil der Einnahmen, der übrig bleibt · Werte unter −100 % sind bei −100 % abgeschnitten">
              {({ height, gross }) => (
                <LineChart
                  series={[{ name: 'Sparquote', points: series.map((s) => ({
                    label: monthLabelShort(s.month),
                    // Ein Monat mit 2,50 € Einnahmen und 163 € Ausgaben ergibt
                    // −6.440 % und drückt alle anderen Monate auf eine Linie.
                    value: Math.max(-100, Math.min(150, s.rate)),
                  })) }]}
                  formatValue={(v) => `${Math.round(v)} %`}
                  formatAxis={(v) => `${Math.round(v)} %`}
                  axisLabel="Prozent"
                  height={gross ? height : 130}
                  zeroBased
                />
              )}
            </ChartFrame>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title={`Ausgaben nach Kategorie · ${formatMonth(month, true)}`}
          sub={byCat.length ? `${formatMoney(totals.expense)} gesamt` : undefined}>
          {byCat.length ? (
            <ChartFrame title={`Ausgaben nach Kategorie · ${formatMonth(month)}`}
              sub={`${formatMoney(totals.expense)} gesamt`}>
              {({ gross }) => (
                <DonutChart
                  slices={byCat.slice(0, gross ? 14 : 8).map((c, i) => ({ label: c.name, value: c.amount, color: c.color ?? seriesColor(i) }))}
                  size={gross ? 240 : 168}
                  thickness={gross ? 30 : 22}
                  centerLabel="Ausgaben"
                  centerValue={formatMoney(totals.expense, { compact: true })}
                  maxLegend={gross ? 14 : 8}
                  formatValue={(v) => formatMoney(v)}
                />
              )}
            </ChartFrame>
          ) : <Empty icon="📊" title="Keine Ausgaben in diesem Monat" />}
        </Card>
        <Card title="Vermögensentwicklung" sub="Monatsende · antippen zum Vergrößern">
          <ChartFrame title="Vermögensentwicklung" sub="Stand am Monatsende">
            {({ height }) => (
              <LineChart
                series={[{ name: 'Vermögen', points: worth.map((w) => ({ label: monthLabelShort(w.month), value: toEuro(w.value) })) }]}
                formatValue={(v) => formatMoney(Math.round(v * 100))}
                formatAxis={(v) => formatMoneyAxis(Math.round(v * 100))}
                axisLabel="Euro"
                height={height}
              />
            )}
          </ChartFrame>
        </Card>
      </div>

      <div className="grid grid-2">
        {/* Die Prognose ist die Zahl, auf die man am Monatsanfang schaut.
            Deshalb bekommt sie eine Ampel: eine Farbe, die man von weitem sieht. */}
        <Card className={`forecast forecast-${ampel.status}`}
          title="Monatsprognose" sub="Schätzung auf Basis des bisherigen Verlaufs – keine Zusage">
          <div className="forecast-head">
            <div>
              <div className="forecast-label">{ampel.label}</div>
              <div className="forecast-big">{money(forecast.projectedSavings)}</div>
              <div className="small muted">bleiben voraussichtlich übrig</div>
            </div>
            <StatusPill status={ampel.status}>
              {formatSavingsRate(forecast.projectedSavingsRate, forecast.projectedIncome)}
            </StatusPill>
          </div>
          <Meter percent={Math.min(100, (forecast.elapsedDays / forecast.totalDays) * 100)}
            status={ampel.status === 'green' ? 'good' : ampel.status === 'amber' ? 'warning' : 'critical'} />
          <div className="grid grid-2 keep2 mt12" style={{ gap: 10 }}>
            <Stat small label="Erwartete Ausgaben" value={money(forecast.projectedExpense)} />
            <Stat small label="Erwartete Einnahmen" value={money(forecast.projectedIncome)} />
          </div>
          <div className="hint-box mt12">
            <strong>{ampel.sentence}</strong><br />
            Tag {forecast.elapsedDays} von {forecast.totalDays}. Bisher {formatMoney(forecast.actualExpense)} ausgegeben
            {forecast.plannedExpense > 0 && <>, {formatMoney(forecast.plannedExpense)} sind fest eingeplant</>}.
            Die Hochrechnung setzt den bisherigen Tagesschnitt fort.
            {forecast.expectedIncome > 0 && (
              <> Bei den Einnahmen sind {formatMoney(forecast.expectedIncome)} mitgerechnet, die noch kommen.</>
            )}
          </div>
        </Card>
        <Card title="Ausgaben nach Konto" sub={formatMonth(month, true)}>
          {byAcc.length
            ? <RankBars items={byAcc.map((a) => ({
                label: a.name, value: a.amount,
                color: data.accounts.find((x) => x.id === a.accountId)?.color ?? undefined,
              }))} formatValue={(v) => formatMoney(v)} />
            : <Empty icon="🏦" title="Keine Ausgaben" />}
          {expenseChange !== null && (
            <div className="hint-box mt12">
              {expenseChange > 0 ? `${expenseChange} % mehr` : `${-expenseChange} % weniger`} ausgegeben als
              im {formatMonth(addMonthsToYearMonth(month, -1), true)} ({formatMoney(prev.expense)}).
            </div>
          )}
        </Card>
      </div>

      {budgets.length > 0 && (
        <Card title="Budgets" action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen/budgets')}>Alle →</button>}>
          {budgets.slice(0, 5).map((b) => (
            <div className="progress-row" key={b.budget.id}>
              <div className="progress-head">
                <span className="dot" style={{ background: b.categoryColor ?? seriesColor(0) }} />
                <span>{b.categoryName}</span>
                <StatusPill status={b.status}>{Math.round(b.usedPercent)} %</StatusPill>
                <span className="val">{formatMoney(b.spent)} / {formatMoney(b.limit)}</span>
              </div>
              <Meter percent={b.usedPercent} status={b.status === 'green' ? 'good' : b.status === 'amber' ? 'warning' : 'critical'} markerPercent={b.paceExpectedPercent} />
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- Buchungen */

function TransactionsTab({ openQuickAdd }: { openQuickAdd: (kind?: any) => void }) {
  const data = useData()
  const m = useMutations()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [categoryId, setCategoryId] = useState<string>('')
  const [accountId, setAccountId] = useState<string>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [limit, setLimit] = useState(80)

  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts])
  const catById = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.transactions.filter((t) => {
      if (t.deleted_at) return false
      if (type !== 'all' && t.type !== type) return false
      if (categoryId && t.category_id !== categoryId) return false
      if (accountId && t.account_id !== accountId && t.to_account_id !== accountId) return false
      if (from && t.booked_on < from) return false
      if (to && t.booked_on > to) return false
      if (q) {
        const hay = [t.merchant, t.description, t.note, catById.get(t.category_id ?? '')?.name]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.transactions, query, type, categoryId, accountId, from, to, catById])

  const sum = filtered.reduce((s, t) => s + (t.type === 'income' ? t.amount_cents : t.type === 'expense' ? -t.amount_cents : 0), 0)

  return (
    <>
      <Card className="mb16">
        <div className="row">
          <input className="input" style={{ flex: '2 1 220px' }} placeholder="Suchen: Händler, Beschreibung, Notiz …"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="select" style={{ flex: '1 1 140px' }} value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="all">Alle Typen</option>
            <option value="expense">Ausgaben</option>
            <option value="income">Einnahmen</option>
            <option value="transfer">Transfers</option>
          </select>
          <select className="select" style={{ flex: '1 1 150px' }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Alle Kategorien</option>
            {data.categories.filter((c) => !c.deleted_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ flex: '1 1 140px' }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Alle Konten</option>
            {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="row" style={{ gap: 6, flex: '0 1 auto' }}>
            <span className="small muted">von</span>
            <input className="input" style={{ width: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="small muted">bis</span>
            <input className="input" style={{ width: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="row mt8 small muted">
          <span>{filtered.length} Buchungen</span>
          <span>Saldo der Auswahl: <strong className="mono" style={{ color: 'var(--text)' }}>{formatMoney(sum, { sign: true })}</strong></span>
          {(query || type !== 'all' || categoryId || accountId || from || to) && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setQuery(''); setType('all'); setCategoryId(''); setAccountId(''); setFrom(''); setTo('') }}>Filter zurücksetzen</button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Empty icon="🧾" title="Keine Buchungen gefunden"
          hint="Erfasse deine erste Buchung über die Schnelleingabe."
          action={<button className="btn btn-primary" onClick={() => openQuickAdd('transaction')}>+ Buchung erfassen</button>} />
      ) : (
        <Card className="pad0">
          <div className="list">
            {filtered.slice(0, limit).map((t) => {
              const cat = t.category_id ? catById.get(t.category_id) : null
              const acc = accById.get(t.account_id)
              const target = t.to_account_id ? accById.get(t.to_account_id) : null
              return (
                <button className="list-row" key={t.id} onClick={() => setEditing(t)}>
                  <span className="avatar" style={{ background: (cat?.color ?? 'var(--surface-3)') + '', color: '#fff' }}>
                    {t.type === 'transfer' ? '🔁' : cat?.icon ?? (t.type === 'income' ? '💰' : '💸')}
                  </span>
                  <span className="list-main">
                    <span className="list-title">{t.merchant || t.description || (t.type === 'transfer' ? `Transfer → ${target?.name ?? '?'}` : cat?.name ?? 'Ohne Kategorie')}</span>
                    <span className="list-sub">
                      {formatDay(t.booked_on)} · {acc?.name}
                      {cat && ` · ${cat.name}`}
                      {t.merchant && t.description && ` · ${t.description}`}
                      {t.status === 'planned' && ' · geplant'}
                      {!t.category_id && t.type === 'expense' && ' · ohne Kategorie'}
                      <AttachmentBadge entityType="transactions" entityId={t.id} />
                    </span>
                  </span>
                  <span className={`list-amount ${t.type === 'income' ? 'up' : ''}`}>
                    {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{formatMoney(t.amount_cents).replace('-', '')}
                  </span>
                </button>
              )
            })}
          </div>
          {filtered.length > limit && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button className="btn btn-sm" onClick={() => setLimit(limit + 200)}>Weitere {Math.min(200, filtered.length - limit)} anzeigen</button>
            </div>
          )}
        </Card>
      )}

      {editing && (
        <Modal open title="Buchung bearbeiten" onClose={() => setEditing(null)}>
          <TransactionForm tx={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- Konten */

export function AccountsTab() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [reconcile, setReconcile] = useState<Account | null>(null)
  const [detail, setDetail] = useState<Account | null>(null)

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const accounts = data.accounts.filter((a) => !a.deleted_at)

  return (
    <>
      <div className="page-actions mb16">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Konto</button>
      </div>
      <div className="grid grid-2">
        {accounts.map((a) => (
          <Card key={a.id}>
            {/* Ein Klick auf das Konto öffnet seinen eigenen Verlauf. */}
            <button className="row konto-kopf" style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setDetail(a)} title={`${a.name} ansehen`}>
              <span className="avatar" style={{ background: a.color ?? 'var(--surface-3)' }}>{a.icon ?? '🏦'}</span>
              <span className="list-main">
                <span className="list-title">{a.name}</span>
                <span className="list-sub">
                  {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}
                  {a.counts_as_savings ? ' · zählt als Sparen' : ''}
                  {!a.counts_as_available ? ' · nicht verfügbar' : ''}
                </span>
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className="stat-value sm mono" style={{ display: 'block' }}>{formatMoney(balances.get(a.id) ?? 0)}</span>
                <span className="small muted">Start {formatMoney(a.opening_balance_cents)}</span>
              </span>
              <span className="muted" style={{ marginLeft: 6 }}>›</span>
            </button>
            <div className="row mt12">
              <button className="btn btn-sm" onClick={() => setDetail(a)}>Ansehen</button>
              <button className="btn btn-sm" onClick={() => setReconcile(a)}>Kassensturz</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>Bearbeiten</button>
            </div>
          </Card>
        ))}
      </div>
      {detail && <AccountDetail account={detail} onClose={() => setDetail(null)}
        onEdit={() => { setEditing(detail); setDetail(null) }}
        onReconcile={() => { setReconcile(detail); setDetail(null) }} />}
      {editing && <AccountEditor account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {reconcile && <ReconcileDialog account={reconcile} current={balances.get(reconcile.id) ?? 0} onClose={() => setReconcile(null)} />}
    </>
  )
}

/**
 * Ein einzelnes Konto von innen.
 *
 * Die Kontenliste beantwortet „wie viel habe ich?" – diese Ansicht beantwortet
 * „wo ist es hin?". Deshalb steht hier der Verlauf des Kontostands neben den
 * Buchungen, die ihn erzeugt haben, und nicht noch einmal die Gesamtsumme.
 */
function AccountDetail({ account, onClose, onEdit, onReconcile }: {
  account: Account
  onClose: () => void
  onEdit: () => void
  onReconcile: () => void
}) {
  const data = useData()
  const today = todayString()
  const [monate, setMonate] = useState(6)
  const [bearbeiten, setBearbeiten] = useState<Transaction | null>(null)
  const [neu, setNeu] = useState(false)

  const von = monthStart(addMonthsToYearMonth(monthOf(today), -(monate - 1)))
  const stand = accountBalance(account, data.transactions)

  const buchungen = useMemo(
    () => transactionsForAccount(data.transactions, account.id, von),
    [data.transactions, account.id, von],
  )

  const monatsListe = useMemo(() => lastMonths(monthOf(today), monate), [today, monate])

  // Verlauf: Kontostand am jeweiligen Monatsende
  const verlauf = useMemo(
    () => monatsListe.map((m) => ({
      label: monthLabelShort(m),
      value: toEuro(accountBalance(account, data.transactions, monthEnd(m))),
    })),
    [monatsListe, account, data.transactions],
  )

  // Was ging rein, was ging raus – Transfers auf dieses Konto zählen mit.
  const proMonat = useMemo(() => monatsListe.map((m) => {
    let rein = 0, raus = 0
    for (const t of data.transactions) {
      if (t.deleted_at || t.status === 'void' || t.status === 'planned') continue
      if (monthOf(t.booked_on) !== m) continue
      const wirkung = effectOnAccount(t, account.id)
      if (wirkung > 0) rein += wirkung
      else raus += -wirkung
    }
    return { label: monthLabelShort(m), values: [rein, raus] }
  }), [monatsListe, data.transactions, account.id])

  const summeRein = proMonat.reduce((s, m) => s + m.values[0], 0)
  const summeRaus = proMonat.reduce((s, m) => s + m.values[1], 0)
  const catById = new Map(data.categories.map((c) => [c.id, c]))
  const accById = new Map(data.accounts.map((a) => [a.id, a]))

  return (
    <Modal open wide onClose={onClose}
      title={<span className="row" style={{ gap: 9 }}>
        <span className="avatar" style={{ background: account.color ?? 'var(--surface-3)' }}>{account.icon ?? '🏦'}</span>
        {account.name}
      </span>}
      footer={<>
        <button className="btn" onClick={onReconcile}>Kassensturz</button>
        <button className="btn" onClick={onEdit}>Bearbeiten</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={onClose}>Schließen</button>
      </>}>
      <div className="grid grid-3 keep2">
        <Stat label="Kontostand heute" value={formatMoney(stand)} />
        <Stat small label={`Eingegangen (${monate} Monate)`} value={formatMoney(summeRein)} />
        <Stat small label={`Abgegangen (${monate} Monate)`} value={formatMoney(summeRaus)} />
      </div>

      <Card title={`Buchungen (${buchungen.length})`} className="pad0"
        action={<button className="btn btn-sm btn-primary" onClick={() => setNeu(true)}>+ Buchung</button>}>
        {buchungen.length === 0 ? (
          <Empty icon="🧾" title="Keine Buchungen in diesem Zeitraum" />
        ) : (
          <div className="list">
            {buchungen.slice(0, 60).map((t) => {
              const wirkung = effectOnAccount(t, account.id)
              const cat = t.category_id ? catById.get(t.category_id) : null
              const gegen = t.type === 'transfer'
                ? accById.get(t.account_id === account.id ? (t.to_account_id ?? '') : t.account_id)?.name
                : null
              return (
                <button className="list-row" key={t.id} onClick={() => setBearbeiten(t)}>
                  <span className="avatar" style={{ background: cat?.color ?? 'var(--surface-3)' }}>
                    {t.type === 'transfer' ? '↔' : cat?.icon ?? '💸'}
                  </span>
                  <span className="list-main">
                    <span className="list-title">{t.merchant || t.description || cat?.name || (t.type === 'transfer' ? 'Umbuchung' : 'Buchung')}</span>
                    <span className="list-sub">
                      {formatDay(t.booked_on)}
                      {cat && ` · ${cat.name}`}
                      {t.merchant && t.description && ` · ${t.description}`}
                      {gegen && ` · ${wirkung > 0 ? 'von' : 'nach'} ${gegen}`}
                      {t.status === 'planned' && ' · geplant'}
                    </span>
                  </span>
                  <span className={`list-amount ${wirkung > 0 ? 'up' : ''}`}>
                    {wirkung > 0 ? '+' : '−'}{formatMoney(Math.abs(wirkung))}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {buchungen.length > 60 && (
          <div className="small muted" style={{ padding: '10px 16px' }}>
            Es werden die 60 neuesten gezeigt. Alle findest du unter „Buchungen" mit dem Kontofilter.
          </div>
        )}
      </Card>

      <Chips size="sm" value={monate} onChange={(v) => setMonate(v)}
        options={[{ value: 3, label: '3 Monate' }, { value: 6, label: '6 Monate' }, { value: 12, label: '12 Monate' }]} />

      <Card title="Kontostand am Monatsende" sub="antippen zum Vergrößern">
        <ChartFrame title={`Kontostand · ${account.name}`} sub="Stand am jeweiligen Monatsende">
          {({ height }) => (
            <LineChart
              series={[{ name: account.name, points: verlauf }]}
              height={height}
              axisLabel="Euro"
              formatValue={(v) => formatMoney(Math.round(v * 100))}
              formatAxis={(v) => formatMoneyAxis(Math.round(v * 100))}
            />
          )}
        </ChartFrame>
      </Card>

      <Card title="Rein und raus" sub="je Monat · antippen zum Vergrößern">
        <ChartFrame title={`Rein und raus · ${account.name}`} sub="Transfers auf dieses Konto zählen mit">
          {({ height }) => (
            <BarChart data={proMonat} seriesNames={['Eingegangen', 'Abgegangen']} height={height}
              axisLabel="Euro"
              formatValue={(v) => formatMoney(v)}
              formatAxis={formatMoneyAxis} />
          )}
        </ChartFrame>
      </Card>

      {bearbeiten && (
        <Modal open title="Buchung bearbeiten" onClose={() => setBearbeiten(null)}>
          <TransactionForm tx={bearbeiten} onDone={() => setBearbeiten(null)} />
        </Modal>
      )}
      {neu && (
        <Modal open title="Neue Buchung" onClose={() => setNeu(false)}>
          <TransactionForm onDone={() => setNeu(false)} defaultAccountId={account.id} />
        </Modal>
      )}
    </Modal>
  )
}

function AccountEditor({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState(account?.type ?? 'checking')
  const [opening, setOpening] = useState(account ? centsToInput(account.opening_balance_cents) : '0,00')
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? todayString())
  const [icon, setIcon] = useState(account?.icon ?? '🏦')
  const [color, setColor] = useState(account?.color ?? 'var(--series-1)')
  const [savings, setSavings] = useState(!!account?.counts_as_savings)
  const [available, setAvailable] = useState(account ? !!account.counts_as_available : true)
  const [inNetWorth, setInNetWorth] = useState(account ? !!account.include_in_net_worth : true)
  const [active, setActive] = useState(account ? !!account.is_active : true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(), type,
      opening_balance_cents: parseAmountToCents(opening) ?? 0,
      opening_date: openingDate, icon, color,
      counts_as_savings: savings ? 1 : 0,
      counts_as_available: available ? 1 : 0,
      include_in_net_worth: inNetWorth ? 1 : 0,
      is_active: active ? 1 : 0,
      currency: 'EUR',
      sort_order: account?.sort_order ?? data.accounts.length,
    }
    if (account) m.patch('accounts', account.id, payload, 'Konto geändert')
    else m.create('accounts', payload, 'Konto angelegt')
    onClose()
  }

  return (
    <Modal open title={account ? 'Konto bearbeiten' : 'Neues Konto'} onClose={onClose}
      footer={<>
        {account && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Speichern</button>
      </>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Kontotyp">
        <select className="select" value={type} onChange={(e) => setType(e.target.value as any)}>
          {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Anfangssaldo" hint="Cent wandern von rechts herein: 2000 wird zu 20,00 €"><MoneyInput value={opening} onChange={setOpening} allowNegative /></Field>
        <Field label="Stichtag"><input className="input" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} /></Field>
      </div>
      <div className="grid grid-2 keep2">
        <Field label="Symbol"><input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={2} /></Field>
        <Field label="Farbe">
          <div className="chips">
            {[1,2,3,4,5,6,7,8].map((i) => (
              <button key={i} type="button" onClick={() => setColor(`var(--series-${i})`)}
                style={{ width: 26, height: 26, borderRadius: 8, background: `var(--series-${i})`,
                  outline: color === `var(--series-${i})` ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </Field>
      </div>
      <Field label="Verhalten in den Auswertungen">
        <label className="row small"><input type="checkbox" checked={savings} onChange={(e) => setSavings(e.target.checked)} /> Zählt als Sparen (für die Sparquote)</label>
        <label className="row small"><input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} /> Zählt zum verfügbaren Geld</label>
        <label className="row small"><input type="checkbox" checked={inNetWorth} onChange={(e) => setInNetWorth(e.target.checked)} /> Zählt zum Gesamtvermögen</label>
        <label className="row small"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktiv</label>
      </Field>
      <Confirm open={confirmDelete} title="Konto löschen?"
        message="Buchungen bleiben erhalten, das Konto landet im Papierkorb."
        danger onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('accounts', account!.id, 'Konto gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

function ReconcileDialog({ account, current, onClose }: { account: Account; current: number; onClose: () => void }) {
  const m = useMutations()
  const [actual, setActual] = useState(centsToInput(current))
  const actualCents = parseAmountToCents(actual)
  const diff = actualCents === null ? 0 : actualCents - current

  return (
    <Modal open title={`Kassensturz · ${account.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" disabled={diff === 0 || actualCents === null}
          onClick={() => {
            m.create('transactions', {
              type: diff > 0 ? 'income' : 'expense', booked_on: todayString(),
              amount_cents: Math.abs(diff), currency: 'EUR', account_id: account.id,
              category_id: null, description: 'Korrektur Kassensturz', status: 'booked',
            }, 'Korrekturbuchung angelegt')
            onClose()
          }}>Differenz buchen</button>
      </>}>
      <div className="hint-box">
        Rechnerischer Stand: <strong>{formatMoney(current)}</strong>.
        Trage ein, was tatsächlich vorhanden ist – die Differenz wird als Korrekturbuchung erfasst.
      </div>
      <Field label="Tatsächlicher Stand">
        <MoneyInput value={actual} onChange={setActual} autoFocus allowNegative />
      </Field>
      {actualCents !== null && (
        <div className="stat">
          <span className="stat-label">Differenz</span>
          <span className={`stat-value sm mono ${diff === 0 ? '' : diff > 0 ? 'up' : 'down'}`}>{formatMoney(diff, { sign: true })}</span>
        </div>
      )}
    </Modal>
  )
}

/* --------------------------------------------------------------- Budgets */

function BudgetsTab() {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const month = monthOf(today)
  const [editing, setEditing] = useState<Budget | 'new' | null>(null)

  const progress = useMemo(
    () => budgetProgress(data.budgets, data.transactions, data.categories, month, today),
    [data.budgets, data.transactions, data.categories, month, today],
  )
  const totalLimit = progress.reduce((s, p) => s + p.limit, 0)
  const totalSpent = progress.reduce((s, p) => s + p.spent, 0)

  return (
    <>
      <div className="page-actions mb16">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Budget</button>
      </div>
      {progress.length === 0 ? (
        <Empty icon="🎯" title="Noch keine Budgets"
          hint="Ein Budget je Kategorie zeigt dir früh im Monat, ob es eng wird."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Erstes Budget</button>} />
      ) : (
        <>
          <div className="grid grid-3 mb16">
            <Card><Stat label="Budgetsumme" value={formatMoney(totalLimit, { compact: true })} /></Card>
            <Card><Stat label="Bereits ausgegeben" value={formatMoney(totalSpent, { compact: true })} /></Card>
            <Card><Stat label="Verbleibend" value={formatMoney(totalLimit - totalSpent, { compact: true })} /></Card>
          </div>
          <Card title={`Budgets · ${formatMonth(month)}`}>
            {progress.map((b) => (
              <div className="progress-row" key={b.budget.id}>
                <div className="progress-head">
                  <span className="dot" style={{ background: b.categoryColor ?? seriesColor(0) }} />
                  <button className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => setEditing(b.budget)}>{b.categoryName}</button>
                  <StatusPill status={b.status}>{Math.round(b.usedPercent)} %</StatusPill>
                  <span className="val">{formatMoney(b.spent)} / {formatMoney(b.limit)}</span>
                </div>
                <Meter percent={b.usedPercent} status={b.status === 'green' ? 'good' : b.status === 'amber' ? 'warning' : 'critical'} markerPercent={b.paceExpectedPercent} />
                <div className="small muted">
                  {b.remaining >= 0
                    ? `Noch ${formatMoney(b.remaining)} für ${b.daysLeft} Tage`
                    : `${formatMoney(-b.remaining)} über dem Limit`}
                  {' · '}Zeitanteil des Monats {Math.round(b.paceExpectedPercent)} %
                  {b.onTrack ? ' · im Rahmen' : ' · schneller als der Zeitanteil'}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
      {editing && <BudgetEditor budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function BudgetEditor({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? '')
  const [amount, setAmount] = useState(budget ? centsToInput(budget.amount_cents) : '')
  const [warnAt, setWarnAt] = useState(budget?.warn_at_percent ?? 80)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    const cents = parseAmountToCents(amount)
    if (cents === null || cents <= 0) return
    const payload = {
      category_id: categoryId || null, period: 'monthly', amount_cents: cents,
      valid_from: budget?.valid_from ?? monthStart(monthOf(todayString())),
      valid_to: null, warn_at_percent: warnAt, rollover: 0,
    }
    if (budget) m.patch('budgets', budget.id, payload, 'Budget geändert')
    else m.create('budgets', payload, 'Budget angelegt')
    onClose()
  }

  return (
    <Modal open title={budget ? 'Budget bearbeiten' : 'Neues Budget'} onClose={onClose}
      footer={<>
        {budget && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save}>Speichern</button>
      </>}>
      <Field label="Kategorie">
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Gesamtbudget (alle Ausgaben)</option>
          {data.categories.filter((c) => !c.deleted_at && c.kind === 'expense').map((c) => (
            <option key={c.id} value={c.id}>{c.icon ? c.icon + ' ' : ''}{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Monatliches Limit" hint="Cent wandern von rechts herein: 20000 wird zu 200,00 €"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
      <Field label="Warnschwelle" hint="Ab diesem Anteil wird die Ampel gelb.">
        <Chips options={[70, 75, 80, 85, 90].map((v) => ({ value: v, label: `${v} %` }))} value={warnAt} onChange={setWarnAt} />
      </Field>
      <Confirm open={confirmDelete} title="Budget löschen?" message="Das Budget wandert in den Papierkorb." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('budgets', budget!.id, 'Budget gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* --------------------------------------------------------- Wiederkehrend */

function RecurringTab() {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const [editing, setEditing] = useState<any | 'new' | null>(null)

  const rules = data.recurring.filter((r) => !r.deleted_at && r.kind === 'transaction')

  /**
   * Fällige Zahlungen als echte Buchungen anlegen.
   * Jede Buchung ist danach eigenständig – ändert sich später der Betrag der
   * Regel, bleiben die bereits gebuchten Beträge, wie sie waren.
   */
  const due = useMemo(
    () => dueRecurringBookings(data.recurring, data.transactions, today),
    [data.recurring, data.transactions, today],
  )

  const bookDue = () => {
    for (const d of due) {
      m.create('transactions', {
        type: d.template.type ?? 'expense', booked_on: d.day, value_on: null,
        amount_cents: d.template.amount_cents ?? 0, currency: 'EUR',
        account_id: d.template.account_id, to_account_id: d.template.to_account_id ?? null,
        category_id: d.template.category_id ?? null,
        merchant: d.rule.title, description: null, note: null,
        status: 'booked', recurring_id: d.rule.id,
      })
      m.patch('recurring_rules', d.rule.id, { last_generated_on: d.day })
    }
    m.toast(`${due.length} Zahlungen gebucht`)
  }
  const accById = new Map(data.accounts.map((a) => [a.id, a]))
  const catById = new Map(data.categories.map((c) => [c.id, c]))

  return (
    <>
      <Card className="mb16" title="Wiederkehrende Zahlungen"
        sub="Gehalt, Miete, Abos. Fällige Zahlungen bucht die App beim Öffnen von selbst; der Betrag gilt immer ab jetzt – gebuchte Zahlungen bleiben unangetastet."
        action={<button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>+ Zahlung</button>}>
        <div className="row">
          <Stat small label="Aktive Regeln" value={String(rules.filter((r) => r.is_active).length)} />
          <Stat small label="Fällig, noch nicht gebucht" value={String(due.length)} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={!due.length} onClick={bookDue}>
            {due.length ? `${due.length} fällige Zahlungen buchen` : 'Alles gebucht'}
          </button>
        </div>
        {due.length > 0 && (
          <div className="hint-box mt12 small">
            {due.slice(0, 5).map((d) => `${formatDay(d.day, 'short')} ${d.rule.title}`).join(' · ')}
            {due.length > 5 ? ` … und ${due.length - 5} weitere` : ''}
            <div className="mt8">Diese werden beim nächsten Öffnen ohnehin automatisch gebucht.</div>
          </div>
        )}
      </Card>
      {rules.length === 0 ? (
        <Empty icon="🔁" title="Keine wiederkehrenden Zahlungen"
          hint="Gehalt, Miete, Abos und Versicherungen einmal anlegen – danach kennt die App deine Fixkosten."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Anlegen</button>} />
      ) : (
        <Card className="pad0">
          <div className="list">
            {rules.map((r) => {
              const tpl = JSON.parse(r.template_json || '{}')
              const next = nextOccurrence(r.rrule, r.starts_on, today)
              const cat = tpl.category_id ? catById.get(tpl.category_id) : null
              return (
                <button className="list-row" key={r.id} onClick={() => setEditing(r)}>
                  <span className="avatar">{cat?.icon ?? (tpl.type === 'income' ? '💰' : '💸')}</span>
                  <span className="list-main">
                    <span className="list-title">{r.title}</span>
                    <span className="list-sub">
                      {describeRRule(r.rrule)}
                      {r.ends_on
                        ? (r.ends_on < today ? ` · beendet am ${formatDay(r.ends_on)}` : ` · läuft bis ${formatDay(r.ends_on)}`)
                        : ''}
                      {next && (!r.ends_on || next <= r.ends_on) ? ` · nächste ${relativeDay(next, today)}` : ''}
                      {tpl.account_id && ` · ${accById.get(tpl.account_id)?.name ?? ''}`}
                    </span>
                  </span>
                  <span className={`list-amount ${tpl.type === 'income' ? 'up' : ''}`}>
                    {tpl.type === 'income' ? '+' : '−'}{formatMoney(tpl.amount_cents ?? 0).replace('-', '')}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>
      )}
      {editing && <RecurringEditor rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function RecurringEditor({ rule, onClose }: { rule: any | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const tpl = rule ? JSON.parse(rule.template_json || '{}') : {}
  const [title, setTitle] = useState(rule?.title ?? '')
  const [type, setType] = useState<'income' | 'expense'>(tpl.type ?? 'expense')
  const [amount, setAmount] = useState(centsToInput(tpl.amount_cents ?? null))
  const [accountId, setAccountId] = useState(tpl.account_id ?? data.settings.default_account_id ?? data.accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(tpl.category_id ?? '')
  const [dayOfMonth, setDayOfMonth] = useState(() => {
    const md = rule?.rrule?.match(/BYMONTHDAY=(-?\d+)/)
    return md ? Number(md[1]) : 1
  })
  const [startsOn, setStartsOn] = useState(rule?.starts_on ?? todayString())
  const [endsOn, setEndsOn] = useState(rule?.ends_on ?? '')
  // Neue Regeln buchen von selbst. Bei Bestehenden bleibt es so, wie es war.
  const [autoBook, setAutoBook] = useState(rule ? rule.auto_book !== 0 : true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    const cents = parseAmountToCents(amount)
    if (!title.trim() || cents === null || cents <= 0) return
    const payload = {
      kind: 'transaction', title: title.trim(),
      rrule: buildRRule({ freq: 'MONTHLY', byMonthDay: [dayOfMonth] }),
      starts_on: startsOn, ends_on: endsOn || null,
      template_json: JSON.stringify({ type, amount_cents: cents, account_id: accountId, category_id: categoryId || null }),
      auto_book: autoBook ? 1 : 0, lead_days: 5, is_active: 1,
    }
    if (rule) m.patch('recurring_rules', rule.id, payload, 'Zahlung geändert')
    else m.create('recurring_rules', payload, 'Zahlung angelegt')
    onClose()
  }

  return (
    <Modal open title={rule ? 'Wiederkehrende Zahlung' : 'Neue wiederkehrende Zahlung'} onClose={onClose}
      footer={<>
        {rule && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save}>Speichern</button>
      </>}>
      <Field label="Bezeichnung"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Miete" autoFocus /></Field>
      <Field label="Art">
        <Chips options={[{ value: 'expense', label: 'Ausgabe' }, { value: 'income', label: 'Einnahme' }]} value={type} onChange={(v) => setType(v as any)} />
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Betrag" hint="Cent wandern von rechts herein: 2000 wird zu 20,00 €"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Tag im Monat">
          <select className="select" value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}.</option>)}
            <option value={-1}>Monatsletzter</option>
          </select>
        </Field>
      </div>
      <Field label="Konto">
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <label className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
        <input type="checkbox" style={{ marginTop: 4 }} checked={autoBook}
          onChange={(e) => setAutoBook(e.target.checked)} />
        <span>
          <strong>Von selbst buchen, wenn sie fällig ist</strong>
          <span className="small muted" style={{ display: 'block' }}>
            Sinnvoll bei allem, was ohnehin abgebucht wird. Abschalten, wenn der Betrag
            jedes Mal anders ist und du ihn selbst eintragen willst.
          </span>
        </span>
      </label>
      <Field label="Kategorie">
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Ohne Kategorie</option>
          {data.categories.filter((c) => !c.deleted_at && c.kind === type).map((c) => (
            <option key={c.id} value={c.id}>{c.icon ? c.icon + ' ' : ''}{c.name}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Gültig ab"><input className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></Field>
        <Field label="Gültig bis" hint="leer = unbefristet">
          <input className="input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>
      {rule && <AttachmentList entityType="recurring_rules" entityId={rule.id} />}
      <div className="hint-box small">
        Ändert sich der Betrag – etwa weil dein Gehalt steigt – änderst du ihn einfach hier.
        <strong> Bereits gebuchte Zahlungen bleiben unverändert</strong>; der neue Betrag gilt ab der
        nächsten Fälligkeit. Rückwirkend wird nichts angefasst.
      </div>
      <Confirm open={confirmDelete} title="Zahlung löschen?" message="Bereits erfasste Buchungen bleiben erhalten." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('recurring_rules', rule.id, 'Zahlung gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* -------------------------------------------------------------- Finanztag */

function FinanceDayTab({ navigate }: { navigate: (r: string) => void }) {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [actual, setActual] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const accounts = data.accounts.filter((a) => !a.deleted_at && a.is_active)
  const lastRun = data.financeDayRuns.find((r: any) => !r.deleted_at) ?? null
  const lastCheckOf = (id: string) =>
    data.accountChecks.find((c: any) => !c.deleted_at && c.account_id === id) ?? null

  const diffs = accounts.map((a) => {
    const expected = balances.get(a.id) ?? 0
    const raw = actual[a.id]
    const actualCents = raw === undefined || raw.trim() === '' ? null : parseAmountToCents(raw)
    return { account: a, expected, actualCents, diff: actualCents === null ? null : actualCents - expected }
  })
  const filled = diffs.filter((d) => d.actualCents !== null)
  const withDiff = filled.filter((d) => d.diff !== 0)

  const items = useMemo(() => generateFinanceDayChecklist({
    accounts, transactions: data.transactions, budgets: data.budgets,
    categories: data.categories, goals: data.goals, recurring: data.recurring,
    today, lastRunOn: lastRun?.ran_on ?? null,
  }).filter((i) => !i.key.startsWith('stale_') && !i.key.startsWith('cash_')),
  [accounts, data, today, lastRun])

  const openItems = items.filter((i) => !done.has(i.key))

  const saveReconciliation = () => {
    let corrections = 0
    for (const d of filled) {
      let correctionId: string | null = null
      if (d.diff !== 0 && d.diff !== null) {
        correctionId = m.create('transactions', {
          type: d.diff > 0 ? 'income' : 'expense', booked_on: today,
          amount_cents: Math.abs(d.diff), currency: 'EUR',
          account_id: d.account.id, to_account_id: null, category_id: null,
          merchant: null, description: 'Korrektur Kontenabgleich', note: note || null,
          status: 'booked',
        })
        corrections++
      }
      m.create('account_checks', {
        account_id: d.account.id, day: today,
        expected_cents: d.expected, actual_cents: d.actualCents!,
        correction_id: correctionId, note: note || null,
      })
    }
    m.create('finance_day_runs', {
      ran_on: today,
      checklist_json: JSON.stringify({
        accounts: filled.map((d) => ({ name: d.account.name, expected: d.expected, actual: d.actualCents, diff: d.diff })),
        checklist: items.map((i) => ({ key: i.key, title: i.title, done: done.has(i.key) })),
      }),
      completed_at: new Date().toISOString(), note: note || null,
    })
    setActual({}); setNote(''); setDone(new Set())
    m.toast(corrections ? `Abgeglichen · ${corrections} Korrekturbuchungen` : 'Abgeglichen · alles stimmte')
  }

  return (
    <>
      <Card className="mb16" title="Finanztag"
        sub="Der feste Termin, an dem du alle Konten mit der Realität abgleichst – damit die App denselben Stand hat wie deine Bank.">
        <div className="hint-box">
          <p style={{ marginTop: 0 }}>
            <strong>So läuft er ab:</strong> Du öffnest deine Banking-App und trägst unten für jedes Konto
            den tatsächlichen Stand ein. LifeHub zeigt sofort die Differenz zum errechneten Wert und legt
            beim Speichern für jede Abweichung eine Korrekturbuchung an. Danach stimmen beide Seiten wieder.
          </p>
          <p style={{ marginBottom: 0 }}>
            Bargeld läuft genauso mit: einmal zählen, Zahl eintragen, fertig. Darunter steht, was sonst
            noch ansteht – und zwar nur das, was gerade wirklich offen ist.
          </p>
        </div>
        <div className="row mt16">
          <Stat small label="Letzter Finanztag" value={lastRun ? formatDay(lastRun.ran_on) : 'noch keiner'} />
          <Stat small label="Konten abzugleichen" value={`${filled.length} / ${accounts.length}`} />
          <Stat small label="Offene Punkte" value={String(openItems.length)} />
        </div>
      </Card>

      <Card className="mb16" title="Kontenabgleich" sub={`Stand vom ${formatDay(today)}`}>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Konto</th>
                <th className="num">Laut LifeHub</th>
                <th className="num">Tatsächlich</th>
                <th className="num">Differenz</th>
                <th>Zuletzt geprüft</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => {
                const check = lastCheckOf(d.account.id)
                return (
                  <tr key={d.account.id}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 13, background: d.account.color ?? undefined }}>{d.account.icon ?? '🏦'}</span>
                        {d.account.name}
                      </span>
                    </td>
                    <td className="num">{formatMoney(d.expected)}</td>
                    <td className="num">
                      <MoneyInput value={actual[d.account.id] ?? ''} placeholder="eintragen" allowNegative
                        style={{ width: 118, textAlign: 'right' }}
                        onChange={(v) => setActual({ ...actual, [d.account.id]: v })} />
                    </td>
                    <td className="num">
                      {d.diff === null ? <span className="muted">–</span>
                        : d.diff === 0 ? <span className="pill good">stimmt</span>
                        : <strong style={{ color: d.diff > 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                            {formatMoney(d.diff, { sign: true })}
                          </strong>}
                    </td>
                    <td className="small muted">{check ? formatDay(check.day) : 'nie'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt16">
          <Field label="Notiz zum Abgleich" hint="optional – etwa woher eine Differenz kam">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {withDiff.length > 0 && (
          <div className="hint-box mt12">
            Beim Speichern werden <strong>{withDiff.length} Korrekturbuchungen</strong> angelegt:
            {' '}{withDiff.map((d) => `${d.account.name} ${formatMoney(d.diff!, { sign: true })}`).join(' · ')}
          </div>
        )}

        <button className="btn btn-primary mt16" disabled={!filled.length} onClick={saveReconciliation}>
          {filled.length ? `Abgleich speichern (${filled.length} Konten)` : 'Trage die tatsächlichen Stände ein'}
        </button>
      </Card>

      <Card title="Was sonst noch ansteht" sub="Nur Punkte, die gerade wirklich offen sind." className="pad0">
        {items.length === 0 ? (
          <div style={{ padding: 16 }}><Empty icon="✅" title="Nichts zu tun" hint="Deine Finanzen sind aktuell." /></div>
        ) : (
          <div className="list">
            {items.map((i) => {
              const isDone = done.has(i.key)
              return (
                <div className={`list-row ${isDone ? 'done' : ''}`} key={i.key}>
                  <button className={`checkbox ${isDone ? 'checked' : ''}`}
                    onClick={() => setDone((sset) => { const n = new Set(sset); n.has(i.key) ? n.delete(i.key) : n.add(i.key); return n })}>✓</button>
                  <span className="list-main">
                    <span className="list-title">{i.title}</span>
                    <span className="list-sub">{i.detail}</span>
                    <span className="list-sub" style={{ fontStyle: 'italic' }}>Warum: {i.reason}</span>
                  </span>
                  {i.action?.kind === 'open_budgets' && <button className="btn btn-sm" onClick={() => navigate('#/finanzen/budgets')}>Öffnen</button>}
                  {i.action?.kind === 'open_uncategorised' && <button className="btn btn-sm" onClick={() => navigate('#/finanzen/buchungen')}>Öffnen</button>}
                  {i.action?.kind === 'open_recurring' && <button className="btn btn-sm" onClick={() => navigate('#/finanzen/wiederkehrend')}>Öffnen</button>}
                  {i.action?.kind === 'open_goal' && <button className="btn btn-sm" onClick={() => navigate('#/ziele')}>Ziele</button>}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}
