/**
 * FINANZEN · WIEDERKEHREND – Gehalt, Miete, Abos. Gebucht wird von selbst.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, MoneyInput } from '../../ui/components'
import { AttachmentList } from '../../ui/attachments'
import { useData, useMutations } from '../../state/store'
import { formatMoney, parseAmountToCents, centsToInput } from '../../core/money'
import { todayString, formatDay, relativeDay } from '../../core/dates'
import { describeRRule, nextOccurrence, buildRRule } from '../../core/recurrence'
import { duePayments } from '../../core/automation'

/* --------------------------------------------------------- Wiederkehrend */

export function RecurringTab() {
  const data = useData()
  const today = todayString()
  const [editing, setEditing] = useState<any | 'new' | null>(null)

  const rules = data.recurring.filter((r) => !r.deleted_at && r.kind === 'transaction')

  /**
   * Was gerade fällig ist und gleich von selbst gebucht wird.
   *
   * Reine Anzeige. Gebucht wird in state/automatik.ts, kurz nach dem Öffnen –
   * es gibt hier bewusst keinen Knopf mehr dafür. Zwei Stellen, die dieselbe
   * Buchung anlegen können, waren genau die Sorte doppelter Logik, an der man
   * sich später die Finger verbrennt.
   *
   * Jede entstandene Buchung ist danach eigenständig: Ändert sich später der
   * Betrag der Regel, bleiben die bereits gebuchten Beträge, wie sie waren.
   */
  const due = useMemo(
    () => duePayments({ rules: data.recurring, transactions: data.transactions, today }),
    [data.recurring, data.transactions, today],
  )
  const accById = new Map(data.accounts.map((a) => [a.id, a]))
  const catById = new Map(data.categories.map((c) => [c.id, c]))

  return (
    <>
      <Card className="mb16" title="Wiederkehrende Zahlungen"
        sub="Gehalt, Miete, Abos. Fällige Zahlungen bucht LifeHub von selbst, ohne Nachfrage. Ein geänderter Betrag gilt ab jetzt: Schon gebuchte Zahlungen behalten ihren alten Betrag – sie sind ein Beleg über etwas, das passiert ist."
        action={<button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>+ Zahlung</button>}>
        <div className="row">
          <Stat small label="Aktive Regeln" value={String(rules.filter((r) => r.is_active).length)} />
          <Stat small label="Wird gerade gebucht" value={String(due.length)} />
        </div>
        {due.length > 0 && (
          <div className="hint-box mt12 small">
            {due.slice(0, 5).map((d) => `${formatDay(d.day, 'short')} ${d.titel}`).join(' · ')}
            {due.length > 5 ? ` … und ${due.length - 5} weitere` : ''}
            <div className="mt8">Diese bucht LifeHub gleich von selbst – einen Moment.</div>
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
  const [description, setDescription] = useState(tpl.description ?? '')
  const [note, setNote] = useState(tpl.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    const cents = parseAmountToCents(amount)
    if (!title.trim() || cents === null || cents <= 0) return
    const payload = {
      kind: 'transaction', title: title.trim(),
      rrule: buildRRule({ freq: 'MONTHLY', byMonthDay: [dayOfMonth] }),
      starts_on: startsOn, ends_on: endsOn || null,
      template_json: JSON.stringify({
        type, amount_cents: cents, account_id: accountId, category_id: categoryId || null,
        description: description.trim() || null, note: note.trim() || null,
      }),
      lead_days: 5, is_active: 1,
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
      <Field label="Beschreibung"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Notiz"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
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
