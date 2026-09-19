/**
 * FINANZEN · BUDGETS – Fortschritt je Kategorie, gemessen am Zeitanteil.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, StatusPill, MoneyInput } from '../../ui/components'
import { Meter, seriesColor } from '../../charts'
import { useData, useMutations } from '../../state/store'
import { budgetProgress } from '../../core/finance'
import { formatMoney, parseAmountToCents, centsToInput } from '../../core/money'
import { todayString, monthOf, formatMonth, monthStart } from '../../core/dates'
import type { Budget } from '../../core/types'

/* --------------------------------------------------------------- Budgets */

export function BudgetsTab() {
  const data = useData()
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
                <Meter percent={b.usedPercent} status={b.status === 'green' ? 'neutral' : b.status === 'amber' ? 'warning' : 'critical'} markerPercent={b.paceExpectedPercent} />
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
