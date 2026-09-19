/**
 * FINANZEN · KONTEN – Liste, ein Konto von innen, Editor, Kassensturz.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, MoneyInput } from '../../ui/components'
import { BarChart, LineChart, ChartFrame } from '../../charts'
import { useData, useMutations } from '../../state/store'
import {
  accountBalances, accountBalance, effectOnAccount, transactionsForAccount,
} from '../../core/finance'
import { formatMoney, formatMoneyAxis, parseAmountToCents, toEuro, centsToInput } from '../../core/money'
import {
  todayString, monthOf, formatDay, monthLabelShort, lastMonths,
  addMonthsToYearMonth, monthStart, monthEnd,
} from '../../core/dates'
import type { Account, Transaction } from '../../core/types'
import { TransactionForm } from '../QuickAdd'

export const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'checking', label: 'Girokonto' },
  { value: 'cash', label: 'Bargeld' },
  { value: 'savings', label: 'Sparkonto' },
  { value: 'money_market', label: 'Tagesgeld' },
  { value: 'credit_card', label: 'Kreditkarte' },
  { value: 'depot', label: 'Depot' },
  { value: 'loan', label: 'Kredit' },
  { value: 'custom', label: 'Sonstiges' },
]

/* ---------------------------------------------------------------- Konten */

export function AccountsTab() {
  const data = useData()
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
