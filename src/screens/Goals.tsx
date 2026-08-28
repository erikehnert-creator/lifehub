/**
 * ZIELE – ein System für finanzielle, körperliche und persönliche Ziele.
 *
 * Der Regelfall ist das Prozentziel: Du trägst ein, wie weit du bist.
 * Der Balken färbt sich von Dunkelrot über Orange und Gelb nach Grün.
 * Bei 100 % gilt das Ziel als erreicht und wandert aus der Übersicht in
 * die Liste der bestandenen Ziele – gelöscht wird nichts.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, Collapsible } from '../ui/components'
import { useData, useMutations } from '../state/store'
import { accountBalances } from '../core/finance'
import { goalProgress, paceLabel, progressColor } from '../core/goals'
import { currentValueForGoal } from './goalHelpers'
import { formatMoney, formatNumber } from '../core/money'
import { todayString, formatDay } from '../core/dates'
import type { Goal } from '../core/types'

const DOMAINS = [
  { value: 'finance', label: '💰 Finanzen' },
  { value: 'body', label: '📏 Körper' },
  { value: 'fitness', label: '🏋️ Fitness' },
  { value: 'habit', label: '🔁 Gewohnheit' },
  { value: 'learning', label: '📚 Lernen' },
  { value: 'project', label: '🧩 Projekt' },
]

export function GoalsScreen() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const today = todayString()

  const goals = data.goals.filter((g) => !g.deleted_at)
  const done = goals.filter((g) => g.status === 'reached')
  const active = goals.filter((g) => g.status === 'active' || g.status === 'paused')

  const render = (g: Goal, compact = false) => {
    const current = currentValueForGoal(g, data, balances)
    const p = goalProgress(g, current, today)
    const isPercent = g.goal_kind === 'percent'
    const isMoney = g.domain === 'finance' && !isPercent
    const fmt = (n: number) => isMoney ? formatMoney(Math.round(n * 100), { compact: true }) : formatNumber(n, 1)
    const color = progressColor(p.percent)

    return (
      <Card key={g.id} title={<>{g.icon ?? '🎯'} {g.name}</>}
        sub={g.description ?? DOMAINS.find((d) => d.value === g.domain)?.label}
        action={<button className="btn btn-sm btn-ghost" onClick={() => setEditing(g)}>Bearbeiten</button>}>

        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
          <span className="stat-value" style={{ color, fontSize: 26 }}>{formatNumber(p.percent, p.percent % 1 === 0 ? 0 : 1)} %</span>
          {!isPercent && <span className="muted small">{fmt(p.current)} von {fmt(p.target)}</span>}
        </div>

        <div className="meter" style={{ height: 12 }}>
          <div className="meter-fill" style={{ width: `${Math.min(100, p.percent)}%`, background: color }} />
        </div>

        {!compact && (
          <>
            {isPercent && g.status !== 'reached' && (
              <div className="chips mt12">
                {[-10, -5, +5, +10].map((d) => (
                  <button key={d} className="chip sm"
                    onClick={() => {
                      const next = Math.min(100, Math.max(0, (g.progress_percent ?? 0) + d))
                      m.patch('goals', g.id, {
                        progress_percent: next,
                        ...(next >= 100 ? { status: 'reached', completed_on: today } : {}),
                      }, next >= 100 ? 'Ziel erreicht 🎉' : 'Fortschritt aktualisiert')
                    }}>{d > 0 ? `+${d}` : d} %</button>
                ))}
                <button className="chip sm" onClick={() => setEditing(g)}>genauer eintragen…</button>
              </div>
            )}

            <div className="row mt8" style={{ justifyContent: 'space-between' }}>
              {g.target_on && (
                <span className={`pill ${p.pace === 'ahead' ? 'good' : p.pace === 'behind' ? 'warn' : ''}`}>
                  {paceLabel(p.pace)}
                </span>
              )}
              {g.status === 'paused' && <span className="pill">pausiert</span>}
            </div>

            <div className="hint-box mt12 small">
              {p.percent >= 100
                ? <>Geschafft{g.completed_on ? ` am ${formatDay(g.completed_on)}` : ''}.</>
                : <>Noch <strong>{isPercent ? `${formatNumber(100 - p.percent, 0)} %` : fmt(p.remaining)}</strong> bis zum Ziel. </>}
              {p.daysLeft !== null && p.daysLeft > 0 && p.percent < 100 &&
                <> Zieldatum {formatDay(g.target_on!)} · noch {p.daysLeft} Tage.</>}
              {!isPercent && p.neededPerMonth !== null && p.neededPerMonth > 0 && p.percent < 100 &&
                <> Erforderlich: <strong>{fmt(p.neededPerMonth)}</strong> pro Monat.</>}
              {!isPercent && p.projectedDate && p.percent < 100 &&
                <> Beim bisherigen Tempo erreicht am {formatDay(p.projectedDate)} <span className="muted">(Prognose)</span>.</>}
            </div>

            {p.percent >= 100 && g.status !== 'reached' && (
              <button className="btn btn-primary mt12"
                onClick={() => m.patch('goals', g.id, { status: 'reached', completed_on: today }, 'Ziel abgeschlossen 🎉')}>
                Ziel abschließen
              </button>
            )}
          </>
        )}
      </Card>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Ziele</div>
          <div className="page-sub">Finanzielle und persönliche Ziele in einem System</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ziel</button>
        </div>
      </div>

      {goals.length === 0 ? (
        <Empty icon="🎯" title="Noch keine Ziele"
          hint="Trage ein Ziel ein und danach nur noch, wie weit du bist. Den Rest zeigt der Balken."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Erstes Ziel</button>} />
      ) : (
        <>
          {active.length > 0 && <div className="grid grid-2">{active.map((g) => render(g))}</div>}
          {active.length === 0 && (
            <Empty icon="✅" title="Alle Ziele erreicht"
              hint="Zeit für ein neues." action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Neues Ziel</button>} />
          )}

          {done.length > 0 && (
            <div className="mt16">
              <Collapsible label={`🏆 Erfolgreich bestandene Ziele (${done.length})`} defaultOpen={false}>
                <div className="grid grid-2 mt12">
                  {done.map((g) => (
                    <Card key={g.id} title={<>{g.icon ?? '🏆'} {g.name}</>}
                      sub={g.completed_on ? `abgeschlossen am ${formatDay(g.completed_on)}` : 'abgeschlossen'}
                      action={
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn btn-sm btn-ghost"
                            onClick={() => m.patch('goals', g.id, { status: 'active', completed_on: null }, 'Wieder aktiv')}>
                            Wieder öffnen
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(g)}>…</button>
                        </div>
                      }>
                      <div className="meter" style={{ height: 10 }}>
                        <div className="meter-fill" style={{ width: '100%', background: 'var(--good)' }} />
                      </div>
                    </Card>
                  ))}
                </div>
              </Collapsible>
            </div>
          )}
        </>
      )}

      {editing && <GoalEditor goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function GoalEditor({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const [name, setName] = useState(goal?.name ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [domain, setDomain] = useState(goal?.domain ?? 'habit')
  const [kind, setKind] = useState(goal?.goal_kind ?? 'percent')
  const [percent, setPercent] = useState(String(goal?.progress_percent ?? 0).replace('.', ','))
  const [accountId, setAccountId] = useState(goal?.target_account_id ?? '')
  const [metricId, setMetricId] = useState(goal?.metric_id ?? '')
  const [startValue, setStartValue] = useState(goal?.start_value != null ? String(goal.start_value).replace('.', ',') : '0')
  const [targetValue, setTargetValue] = useState(goal?.target_value != null ? String(goal.target_value).replace('.', ',') : '')
  const [startOn, setStartOn] = useState(goal?.start_on ?? today)
  const [targetOn, setTargetOn] = useState(goal?.target_on ?? '')
  const [status, setStatus] = useState(goal?.status ?? 'active')
  const [icon, setIcon] = useState(goal?.icon ?? '🎯')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null }
  const pct = Math.min(100, Math.max(0, num(percent) ?? 0))

  const save = () => {
    if (!name.trim()) return
    const reached = kind === 'percent' && pct >= 100
    const payload = {
      name: name.trim(), description: description || null, domain, goal_kind: kind,
      progress_percent: kind === 'percent' ? pct : null,
      target_account_id: kind === 'amount' ? accountId || null : null,
      metric_id: kind === 'metric_target' ? metricId || null : null,
      manual_current: null,
      start_value: kind === 'percent' ? 0 : num(startValue) ?? 0,
      target_value: kind === 'percent' ? 100 : num(targetValue),
      start_on: startOn, target_on: targetOn || null,
      status: reached ? 'reached' : status,
      completed_on: reached ? (goal?.completed_on ?? today) : null,
      icon, color: null,
    }
    if (goal) m.patch('goals', goal.id, payload, reached ? 'Ziel erreicht 🎉' : 'Ziel geändert')
    else m.create('goals', payload, 'Ziel angelegt')
    onClose()
  }

  return (
    <Modal open title={goal ? 'Ziel bearbeiten' : 'Neues Ziel'} onClose={onClose}
      footer={<>
        {goal && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Speichern</button>
      </>}>
      <div className="grid grid-2 keep2">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Symbol"><input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={2} /></Field>
      </div>
      <Field label="Beschreibung"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Bereich">
        <Chips options={DOMAINS.map((d) => ({ value: d.value, label: d.label }))} value={domain} onChange={(v) => setDomain(v as any)} />
      </Field>

      <Field label="Wie wird der Fortschritt gemessen?">
        <Chips options={[
          { value: 'percent', label: 'Prozent (selbst eintragen)' },
          { value: 'amount', label: 'Kontostand' },
          { value: 'metric_target', label: 'Trackingwert' },
        ]} value={kind} onChange={(v) => setKind(v as any)} />
      </Field>

      {kind === 'percent' && (
        <Field label="Fortschritt in Prozent" hint="0 bis 100. Bei 100 % gilt das Ziel als erreicht.">
          <div className="row">
            <input className="input" style={{ maxWidth: 110 }} inputMode="decimal"
              value={percent} onChange={(e) => setPercent(e.target.value)} />
            <span className="muted">%</span>
            <div className="meter" style={{ flex: 1, height: 12, minWidth: 120 }}>
              <div className="meter-fill" style={{ width: `${pct}%`, background: progressColor(pct) }} />
            </div>
          </div>
          <div className="chips mt8">
            {[0, 25, 50, 75, 100].map((v) => (
              <button key={v} className="chip sm" onClick={() => setPercent(String(v))}>{v} %</button>
            ))}
          </div>
        </Field>
      )}

      {kind === 'amount' && (
        <>
          <Field label="Konto" hint="Der Kontostand ist automatisch der Ist-Wert.">
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">wählen…</option>
              {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-2 keep2">
            <Field label="Startwert"><input className="input" value={startValue} onChange={(e) => setStartValue(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Zielwert"><input className="input" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} inputMode="decimal" /></Field>
          </div>
        </>
      )}

      {kind === 'metric_target' && (
        <>
          <Field label="Trackingwert" hint="Der zuletzt erfasste Wert ist der Ist-Wert.">
            <select className="select" value={metricId} onChange={(e) => setMetricId(e.target.value)}>
              <option value="">wählen…</option>
              {data.metrics.filter((x) => !x.deleted_at).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
            </select>
          </Field>
          <div className="grid grid-2 keep2">
            <Field label="Startwert"><input className="input" value={startValue} onChange={(e) => setStartValue(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Zielwert"><input className="input" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} inputMode="decimal" /></Field>
          </div>
        </>
      )}

      <div className="grid grid-2 keep2">
        <Field label="Start"><input className="input" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} /></Field>
        <Field label="Zieldatum"><input className="input" type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <Chips options={[
          { value: 'active', label: 'Aktiv' }, { value: 'paused', label: 'Pausiert' },
          { value: 'reached', label: 'Erreicht' }, { value: 'abandoned', label: 'Verworfen' },
        ]} value={status} onChange={(v) => setStatus(v as any)} />
      </Field>
      <Confirm open={confirmDelete} title="Ziel löschen?"
        message="Es wandert in den Papierkorb. Erreichte Ziele musst du nicht löschen – sie stehen unter „Erfolgreich bestandene Ziele“."
        danger onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('goals', goal!.id, 'Ziel gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}
