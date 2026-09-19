/**
 * FINANZEN · INVESTMENTS – manuell erfasst, bewusst ohne Kursdaten.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, StatusPill, MoneyInput } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import {
  summarizeInvestment, summarizePortfolio, maxSellCostBasis, validateSellCostBasis,
} from '../../core/investments'
import { formatMoney, parseAmountToCents, centsToInput } from '../../core/money'
import { todayString, formatDay } from '../../core/dates'
import type { Investment, InvestmentMove } from '../../core/types'

/* -------------------------------------------------------- Investments */

/**
 * Manuelles Investment-Tracking (z. B. Trading212) – bewusst ohne Kursdaten.
 *
 * Erfasst wird nur, wie viel Geld in eine Position eingesetzt wurde und was
 * bei einem (Teil-)Verkauf zurückkam. Anders als bei den normalen Konten
 * fließt das hier weder in netWorth/availableMoney noch in die Kontostände
 * ein – siehe core/investments.ts. Das ist eine bewusste Abgrenzung für
 * diese Ausbaustufe, keine technische Notwendigkeit.
 */
export function InvestmentsTab() {
  const data = useData()
  const [editing, setEditing] = useState<Investment | 'new' | null>(null)
  const [detail, setDetail] = useState<Investment | null>(null)

  const investments = data.investments.filter((i) => !i.deleted_at)
  const movesByInvestment = useMemo(() => {
    const map = new Map<string, InvestmentMove[]>()
    for (const mv of data.investmentMoves) {
      const list = map.get(mv.investment_id)
      if (list) list.push(mv)
      else map.set(mv.investment_id, [mv])
    }
    return map
  }, [data.investmentMoves])

  const portfolio = useMemo(
    () => summarizePortfolio(data.investments, movesByInvestment),
    [data.investments, movesByInvestment],
  )

  // Bei einer Änderung an einem Investment (z. B. gerade gelöscht) zeigt die
  // Detailansicht sonst noch den alten Stand – hier wird sie synchron gehalten.
  const detailCurrent = detail ? investments.find((i) => i.id === detail.id) ?? null : null

  return (
    <>
      <Card className="mb16" title="Investments" sub="Manuell erfasst · keine Kursdaten, keine Kopplung an Kontostände oder Gesamtvermögen">
        <div className="grid grid-3 keep2">
          <Stat small label="Eingesetzt (aktuell)" value={formatMoney(portfolio.totalRemaining)} sub={<span className="muted small">von {formatMoney(portfolio.totalInvested)} insgesamt</span>} />
          <Stat small label="Realisierter Gewinn/Verlust" value={formatMoney(portfolio.totalRealizedProfitLoss, { sign: true })} />
          <Stat small label="Positionen" value={`${portfolio.openCount} offen · ${portfolio.closedCount} geschlossen`} />
        </div>
      </Card>

      <div className="page-actions mb16">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Investment</button>
      </div>

      {investments.length === 0 ? (
        <Empty icon="📈" title="Noch keine Investments erfasst"
          hint="Lege eine Position an, z. B. dein Trading212-Depot oder einen einzelnen ETF."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Erstes Investment</button>} />
      ) : (
        <div className="grid grid-2">
          {investments.map((inv) => {
            const summary = summarizeInvestment(movesByInvestment.get(inv.id) ?? [])
            return (
              <Card key={inv.id}>
                <button className="row konto-kopf" style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => setDetail(inv)} title={`${inv.name} ansehen`}>
                  <span className="avatar" style={{ background: 'var(--surface-3)' }}>📈</span>
                  <span className="list-main">
                    <span className="list-title">{inv.name}</span>
                    <span className="list-sub">
                      {inv.note || `${formatMoney(summary.totalInvested)} insgesamt eingesetzt`}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span className="stat-value sm mono" style={{ display: 'block' }}>{formatMoney(summary.remainingBasis)}</span>
                    <span className="small muted">eingesetzt aktuell</span>
                  </span>
                  <span className="muted" style={{ marginLeft: 6 }}>›</span>
                </button>
                <div className="row mt12">
                  <StatusPill status={summary.isClosed ? 'green' : 'amber'}>{summary.isClosed ? 'geschlossen' : 'offen'}</StatusPill>
                  {summary.realizedProfitLoss !== 0 && (
                    <span className={`small ${summary.realizedProfitLoss > 0 ? 'up' : 'down'}`}>
                      Realisiert: {formatMoney(summary.realizedProfitLoss, { sign: true })}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => setDetail(inv)}>Ansehen</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(inv)}>Bearbeiten</button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {detailCurrent && (
        <InvestmentDetail investment={detailCurrent} moves={movesByInvestment.get(detailCurrent.id) ?? []}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detailCurrent); setDetail(null) }} />
      )}
      {editing && <InvestmentEditor investment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Ein einzelnes Investment von innen: alle Bewegungen, neueste zuerst. */
function InvestmentDetail({ investment, moves, onClose, onEdit }: {
  investment: Investment; moves: InvestmentMove[]; onClose: () => void; onEdit: () => void
}) {
  const m = useMutations()
  const [neu, setNeu] = useState<'buy' | 'sell' | null>(null)

  const active = moves.filter((mv) => !mv.deleted_at)
  const sorted = [...active].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  const summary = summarizeInvestment(active)

  return (
    <Modal open wide title={investment.name} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onEdit}>Bearbeiten</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={onClose}>Schließen</button>
      </>}>
      <div className="grid grid-3 keep2">
        <Stat small label="Eingesetzt aktuell" value={formatMoney(summary.remainingBasis)} sub={<span className="muted small">von {formatMoney(summary.totalInvested)} insgesamt</span>} />
        <Stat small label="Verkaufserlöse gesamt" value={formatMoney(summary.totalProceeds)} />
        <Stat small label="Realisierter Gewinn/Verlust" value={formatMoney(summary.realizedProfitLoss, { sign: true })} />
      </div>

      {investment.note && <div className="hint-box">{investment.note}</div>}

      <Card title={`Bewegungen (${sorted.length})`} className="pad0"
        action={<div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setNeu('buy')}>+ Kauf</button>
          <button className="btn btn-sm btn-primary" disabled={summary.remainingBasis <= 0} onClick={() => setNeu('sell')}>+ Verkauf</button>
        </div>}>
        {sorted.length === 0 ? (
          <Empty icon="💶" title="Noch keine Bewegungen" hint="Starte mit dem ersten Kauf." />
        ) : (
          <div className="list">
            {sorted.map((mv) => {
              const pnl = mv.kind === 'sell' ? mv.amount_cents - (mv.cost_basis_cents ?? 0) : null
              return (
                <div className="list-row" key={mv.id}>
                  <span className="avatar" style={{ background: 'var(--surface-3)' }}>{mv.kind === 'buy' ? '⬇' : '⬆'}</span>
                  <span className="list-main">
                    <span className="list-title">{mv.kind === 'buy' ? 'Kauf' : 'Verkauf'} · {formatMoney(mv.amount_cents)}</span>
                    <span className="list-sub">
                      {formatDay(mv.day)}
                      {mv.kind === 'sell' && ` · Einsatz verkauft ${formatMoney(mv.cost_basis_cents ?? 0)}`}
                      {pnl !== null && ` · G/V ${formatMoney(pnl, { sign: true })}`}
                      {mv.note && ` · ${mv.note}`}
                    </span>
                  </span>
                  <button className="btn btn-sm btn-ghost" onClick={() => m.remove('investment_moves', mv.id, 'Bewegung gelöscht')}>Löschen</button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {neu && (
        <InvestmentMoveEditor investment={investment} moves={active} kind={neu} onClose={() => setNeu(null)} />
      )}
    </Modal>
  )
}

function InvestmentEditor({ investment, onClose }: { investment: Investment | null; onClose: () => void }) {
  const m = useMutations()
  const [name, setName] = useState(investment?.name ?? '')
  const [note, setNote] = useState(investment?.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    if (!name.trim()) return
    const payload = { name: name.trim(), note: note.trim() || null }
    if (investment) m.patch('investments', investment.id, payload, 'Investment geändert')
    else m.create('investments', payload, 'Investment angelegt')
    onClose()
  }

  return (
    <Modal open title={investment ? 'Investment bearbeiten' : 'Neues Investment'} onClose={onClose}
      footer={<>
        {investment && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Speichern</button>
      </>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Trading212 – MSCI World ETF" autoFocus /></Field>
      <Field label="Notiz" hint="optional"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Confirm open={confirmDelete} title="Investment löschen?"
        message="Die erfassten Bewegungen bleiben erhalten, das Investment landet im Papierkorb."
        danger onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('investments', investment!.id, 'Investment gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/** Formular für eine Bewegung – Kauf oder Verkauf, je nach `kind`. */
function InvestmentMoveEditor({ investment, moves, kind, onClose }: {
  investment: Investment; moves: InvestmentMove[]; kind: 'buy' | 'sell'; onClose: () => void
}) {
  const m = useMutations()
  const remainingBasis = maxSellCostBasis(moves)

  const [day, setDay] = useState(todayString())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  // Verkauf: vollständig (ganzer Rest-Einsatz) oder Teilverkauf (frei eingegeben).
  const [full, setFull] = useState(true)
  const [costBasisInput, setCostBasisInput] = useState(centsToInput(remainingBasis))

  const amountCents = parseAmountToCents(amount)
  const costBasisCents = kind === 'sell'
    ? (full ? remainingBasis : (parseAmountToCents(costBasisInput) ?? 0))
    : null
  const sellValidation = kind === 'sell' ? validateSellCostBasis(remainingBasis, costBasisCents ?? 0) : { ok: true }

  const valid = amountCents !== null && amountCents > 0 && (kind === 'buy' || sellValidation.ok)

  const save = () => {
    if (!valid) return
    m.create('investment_moves', {
      investment_id: investment.id,
      day,
      kind,
      amount_cents: amountCents,
      cost_basis_cents: kind === 'sell' ? costBasisCents : null,
      note: note.trim() || null,
    }, kind === 'buy' ? 'Kauf erfasst' : 'Verkauf erfasst')
    onClose()
  }

  return (
    <Modal open title={kind === 'buy' ? 'Kauf erfassen' : 'Verkauf erfassen'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!valid}>Speichern</button>
      </>}>
      <Field label="Datum"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      <Field label={kind === 'buy' ? 'Eingesetztes Kapital' : 'Erlös'} hint="Cent wandern von rechts herein: 2000 wird zu 20,00 €">
        <MoneyInput value={amount} onChange={setAmount} autoFocus />
      </Field>

      {kind === 'sell' && (
        <>
          <Field label="Art des Verkaufs">
            <Chips options={[{ value: 'full', label: 'Vollständiger Verkauf' }, { value: 'partial', label: 'Teilverkauf' }]}
              value={full ? 'full' : 'partial'}
              onChange={(v) => {
                const isFull = v === 'full'
                setFull(isFull)
                if (isFull) setCostBasisInput(centsToInput(remainingBasis))
              }} />
          </Field>
          <Field label="Davon eingesetztes Kapital verkauft"
            hint={`Verfügbar: ${formatMoney(remainingBasis)} – hieraus ergibt sich der Gewinn/Verlust dieser Bewegung`}>
            {full
              ? <input className="input" value={costBasisInput} readOnly />
              : <MoneyInput value={costBasisInput} onChange={setCostBasisInput} />}
          </Field>
          {!sellValidation.ok && <div className="hint-box small" style={{ color: 'var(--critical)' }}>{sellValidation.message}</div>}
          {sellValidation.ok && amountCents !== null && costBasisCents !== null && (
            <div className="hint-box small">
              Gewinn/Verlust dieser Bewegung: <strong className={amountCents - costBasisCents >= 0 ? 'up' : 'down'}>
                {formatMoney(amountCents - costBasisCents, { sign: true })}
              </strong>
            </div>
          )}
        </>
      )}

      <Field label="Notiz" hint="optional"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  )
}
