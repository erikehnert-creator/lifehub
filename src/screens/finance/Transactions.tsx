/**
 * FINANZEN · BUCHUNGEN – eine Liste, Filter hinter einem Knopf.
 */
import React, { useMemo, useState } from 'react'
import { Card, Modal, Empty } from '../../ui/components'
import { AttachmentBadge } from '../../ui/attachments'
import { useData } from '../../state/store'
import { formatMoney } from '../../core/money'
import { formatDay, formatMonth } from '../../core/dates'
import type { Transaction } from '../../core/types'
import { TransactionForm } from '../QuickAdd'

/* ------------------------------------------------------------- Buchungen */

export function TransactionsTab({ openQuickAdd, params }: { openQuickAdd: (kind?: any) => void; params: Record<string, string> }) {
  const data = useData()
  const [query, setQuery] = useState('')
  // Von einem Finanztag-Punkt aus („12 Buchungen kategorisieren", „größere
  // Ausgaben prüfen") soll die Liste schon gefiltert ankommen, statt dass man
  // sich die gemeinten Buchungen von Hand wieder zusammensucht.
  const [type, setType] = useState<'all' | 'income' | 'expense' | 'transfer'>(
    () => (params.uncategorised || params.minAmount ? 'expense' : 'all'),
  )
  const [categoryId, setCategoryId] = useState<string>(() => (params.uncategorised ? '__none__' : ''))
  const [accountId, setAccountId] = useState<string>('')
  const [from, setFrom] = useState(() => params.since ?? '')
  const [to, setTo] = useState('')
  const [minAmount, setMinAmount] = useState<number | null>(() => (params.minAmount ? Number(params.minAmount) : null))
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [limit, setLimit] = useState(80)
  const aktiveFilter = [type !== 'all', !!categoryId, !!accountId, !!from, !!to, minAmount !== null].filter(Boolean).length
  const [filterOffen, setFilterOffen] = useState(aktiveFilter > 0)

  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts])
  const catById = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.transactions.filter((t) => {
      if (t.deleted_at) return false
      if (type !== 'all' && t.type !== type) return false
      if (categoryId === '__none__') { if (t.category_id) return false }
      else if (categoryId && t.category_id !== categoryId) return false
      if (accountId && t.account_id !== accountId && t.to_account_id !== accountId) return false
      if (from && t.booked_on < from) return false
      if (to && t.booked_on > to) return false
      if (minAmount !== null && t.amount_cents < minAmount) return false
      if (q) {
        const hay = [t.merchant, t.description, t.note, catById.get(t.category_id ?? '')?.name]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data.transactions, query, type, categoryId, accountId, from, to, minAmount, catById])

  const sum = filtered.reduce((s, t) => s + (t.type === 'income' ? t.amount_cents : t.type === 'expense' ? -t.amount_cents : 0), 0)

  return (
    <>
      <Card className="mb16">
        <div className="row buchung-suche">
          <input className="input" style={{ flex: '1 1 200px' }} placeholder="Suchen …" aria-label="Buchungen durchsuchen"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`btn${filterOffen ? ' btn-primary' : ''}`} onClick={() => setFilterOffen(!filterOffen)} aria-expanded={filterOffen}>
            Filter{aktiveFilter > 0 ? ` (${aktiveFilter})` : ''}
          </button>
        </div>
        {filterOffen && (
        <div className="buchung-filter mt12">
          <select className="select" style={{ flex: '1 1 140px' }} value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="all">Alle Typen</option>
            <option value="expense">Ausgaben</option>
            <option value="income">Einnahmen</option>
            <option value="transfer">Transfers</option>
          </select>
          <select className="select" style={{ flex: '1 1 150px' }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Alle Kategorien</option>
            <option value="__none__">Ohne Kategorie</option>
            {data.categories.filter((c) => !c.deleted_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ flex: '1 1 140px' }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Alle Konten</option>
            {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label className="field"><span className="field-label">von</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span className="field-label">bis</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        )}
        <div className="row mt8 small muted">
          <span>{filtered.length} Buchungen</span>
          <span>Saldo der Auswahl: <strong className="mono" style={{ color: 'var(--text)' }}>{formatMoney(sum, { sign: true })}</strong></span>
          {minAmount !== null && <span>nur ab {formatMoney(minAmount)}</span>}
          {(query || type !== 'all' || categoryId || accountId || from || to || minAmount !== null) && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setQuery(''); setType('all'); setCategoryId(''); setAccountId(''); setFrom(''); setTo(''); setMinAmount(null) }}>Filter zurücksetzen</button>
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
            {filtered.slice(0, limit).map((t, i, liste) => {
              const cat = t.category_id ? catById.get(t.category_id) : null
              const acc = accById.get(t.account_id)
              const target = t.to_account_id ? accById.get(t.to_account_id) : null
              // Eine Überschrift je Monat: Eine ungegliederte Kolonne von 134
              // Zeilen lässt sich nur lesen, nicht überblicken.
              const neuerMonat = i === 0 || liste[i - 1].booked_on.slice(0, 7) !== t.booked_on.slice(0, 7)
              return (
                <React.Fragment key={t.id}>
                {neuerMonat && <div className="liste-gruppe">{formatMonth(t.booked_on.slice(0, 7))}</div>}
                <button className="list-row" onClick={() => setEditing(t)}>
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
                </React.Fragment>
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
