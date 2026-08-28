/**
 * Schnelleingabe – der wichtigste Bedienpfad der App.
 * Ziel: vom Öffnen bis "gespeichert" in wenigen Sekunden und ≤ 4 Interaktionen.
 */
import React, { useMemo, useState } from 'react'
import { Modal, Field, Chips, DurationInput, MoneyInput, Confirm } from '../ui/components'
import { AttachmentList } from '../ui/attachments'
import { useData, useMutations } from '../state/store'
import { parseAmountToCents, formatMoney, centsToInput } from '../core/money'
import { todayString, formatDay, addDays } from '../core/dates'
import { defaultShowFrom } from '../core/planner'
import { topMerchants } from '../core/finance'
import type { Transaction, TransactionType } from '../core/types'
import { prepareFile, formatBytes } from '../io/files'

type Kind = 'transaction' | 'task' | 'event' | 'metric' | 'note'

const KINDS: { kind: Kind; icon: string; label: string }[] = [
  { kind: 'transaction', icon: '💸', label: 'Buchung' },
  { kind: 'task', icon: '✅', label: 'Aufgabe' },
  { kind: 'event', icon: '📅', label: 'Termin' },
  { kind: 'metric', icon: '📊', label: 'Tracking' },
  { kind: 'note', icon: '📝', label: 'Notiz' },
]

export function QuickAdd({ open, onClose, initialKind }: {
  open: boolean; onClose: () => void; initialKind?: Kind
}) {
  const [kind, setKind] = useState<Kind | null>(initialKind ?? null)
  React.useEffect(() => { if (open) setKind(initialKind ?? null) }, [open, initialKind])

  const title = kind ? KINDS.find((k) => k.kind === kind)!.label : 'Was möchtest du erfassen?'

  return (
    <Modal open={open} title={title} onClose={onClose}>
      {!kind && (
        <div className="grid grid-2 keep2" style={{ gap: 10 }}>
          {KINDS.map((k) => (
            <button key={k.kind} className="btn btn-lg" style={{ justifyContent: 'flex-start' }}
              onClick={() => setKind(k.kind)}>
              <span style={{ fontSize: 20 }}>{k.icon}</span> {k.label}
            </button>
          ))}
        </div>
      )}
      {kind === 'transaction' && <TransactionForm onDone={onClose} />}
      {kind === 'task' && <TaskForm onDone={onClose} />}
      {kind === 'event' && <EventForm onDone={onClose} />}
      {kind === 'metric' && <MetricForm onDone={onClose} />}
      {kind === 'note' && <NoteForm onDone={onClose} />}
    </Modal>
  )
}

/**
 * Buchung anlegen oder bearbeiten – ein einziges Formular für beides, damit
 * eine neue Buchung genauso aussieht wie eine bestehende beim Bearbeiten.
 */
export function TransactionForm({ tx, onDone, defaultType, defaultAccountId, defaultNote, defaultAmountCents }: {
  tx?: Transaction
  onDone: () => void
  defaultType?: TransactionType
  defaultAccountId?: string
  defaultNote?: string
  defaultAmountCents?: number
}) {
  const data = useData()
  const m = useMutations()
  const [type, setType] = useState<TransactionType>(tx?.type ?? defaultType ?? 'expense')
  const isTransfer = type === 'transfer'

  const [amount, setAmount] = useState(() =>
    tx ? centsToInput(tx.amount_cents) : defaultAmountCents ? centsToInput(defaultAmountCents) : '')
  const [day, setDay] = useState(tx?.booked_on ?? todayString())
  const [accountId, setAccountId] = useState(
    tx?.account_id ?? defaultAccountId ?? data.settings.default_account_id ?? data.accounts[0]?.id ?? '')
  const [toAccountId, setToAccountId] = useState(tx?.to_account_id ?? '')
  const [categoryId, setCategoryId] = useState(tx?.category_id ?? '')
  const [merchant, setMerchant] = useState(tx?.merchant ?? '')
  const [description, setDescription] = useState(tx?.description ?? '')
  const [note, setNote] = useState(tx?.note ?? defaultNote ?? '')
  const [status, setStatus] = useState<Transaction['status']>(tx?.status ?? 'booked')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [file, setFile] = useState<Awaited<ReturnType<typeof prepareFile>> | null>(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isTransfer && toAccountId === accountId) {
      const other = data.accounts.find((a) => !a.deleted_at && a.id !== accountId)
      if (other) setToAccountId(other.id)
    }
  }, [accountId, toAccountId, isTransfer, data.accounts])

  const cats = data.categories.filter((c) => !c.deleted_at && c.kind === (type === 'income' ? 'income' : 'expense'))
  const merchantLabel = type === 'income' ? 'Von' : 'Händler / Empfänger'
  const suggestions = useMemo(() => topMerchants(data.transactions, type), [data.transactions, type])

  const cents = parseAmountToCents(amount)
  const valid = cents !== null && cents > 0 && !!accountId && (!isTransfer || (toAccountId && toAccountId !== accountId))

  const pickFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setFileBusy(true); setFileError(null)
    try {
      setFile(await prepareFile(files[0]))
    } catch (e: any) {
      setFileError(e?.message ?? 'Die Datei konnte nicht gelesen werden.')
    } finally {
      setFileBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = () => {
    if (!valid || cents === null) return
    const payload = {
      type, booked_on: day, value_on: null, amount_cents: cents, currency: 'EUR',
      account_id: accountId, to_account_id: isTransfer ? (toAccountId || null) : null,
      category_id: isTransfer ? null : (categoryId || null),
      merchant: merchant || null, description: description || null, note: note || null,
      status, recurring_id: tx?.recurring_id ?? null, import_batch_id: tx?.import_batch_id ?? null,
      external_ref: tx?.external_ref ?? null,
    }
    if (tx) {
      m.patch('transactions', tx.id, payload, 'Buchung geändert')
    } else {
      const id = m.create('transactions', payload, `${formatMoney(cents)} erfasst`)
      if (file) {
        m.create('attachments', {
          entity_type: 'transactions', entity_id: id,
          filename: file.filename, mime_type: file.mime_type, size_bytes: file.size_bytes,
          sha256: file.sha256, data_url: file.data_url, width: file.width, height: file.height,
          upload_state: 'local', taken_at: new Date().toISOString(),
        })
      }
    }
    onDone()
  }

  return (
    <div>
      {!tx && (
        <Field label="Art">
          <Chips options={[
            { value: 'expense', label: 'Ausgabe' },
            { value: 'income', label: 'Einnahme' },
            { value: 'transfer', label: 'Transfer' },
          ]} value={type} onChange={(v) => setType(v as TransactionType)} />
        </Field>
      )}
      <div className="grid grid-2 keep2">
        <Field label="Betrag" hint="Cent wandern von rechts herein: 2000 wird zu 20,00 €">
          <MoneyInput value={amount} onChange={setAmount} autoFocus={!tx} />
        </Field>
        <Field label="Datum"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      </div>
      <Field label={isTransfer ? 'Von Konto' : 'Konto'}>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.icon ? a.icon + ' ' : ''}{a.name}</option>)}
        </select>
      </Field>
      {isTransfer ? (
        <Field label="Auf Konto">
          <select className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            {data.accounts.filter((a) => !a.deleted_at && a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.icon ? a.icon + ' ' : ''}{a.name}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Kategorie">
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Ohne Kategorie</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon ? c.icon + ' ' : ''}{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label={merchantLabel}>
        <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="z. B. REWE" />
        {suggestions.length > 0 && (
          <div className="chips mt8">
            {suggestions.map((s) => (
              <button key={s} type="button" className="chip sm" onClick={() => setMerchant(s)}>{s}</button>
            ))}
          </div>
        )}
      </Field>
      <Field label="Beschreibung"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Notiz"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="Status" hint="Geplante Buchungen zählen nicht in Salden und Statistik, erscheinen aber in der Prognose.">
        <Chips
          options={[{ value: 'booked', label: 'Gebucht' }, { value: 'planned', label: 'Geplant' }, { value: 'void', label: 'Storniert' }]}
          value={status} onChange={(v) => setStatus(v as any)} />
      </Field>

      {tx ? (
        <AttachmentList entityType="transactions" entityId={tx.id} />
      ) : (
        <Field label="Beleg">
          {file ? (
            <>
              {file.mime_type.startsWith('image/') ? (
                <img src={file.data_url} alt="Beleg"
                  style={{ width: '100%', maxHeight: '30vh', objectFit: 'contain', borderRadius: 10, background: 'var(--surface-2)' }} />
              ) : (
                <div className="hint-box">📄 {file.filename}</div>
              )}
              <div className="row mt8 small muted">
                <span>{file.filename} · {formatBytes(file.size_bytes)}</span>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setFile(null)}>Entfernen</button>
              </div>
            </>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" type="button" disabled={fileBusy}
                onClick={() => { if (fileRef.current) { fileRef.current.setAttribute('capture', 'environment'); fileRef.current.click() } }}>
                {fileBusy ? 'Wird gelesen …' : '📷 Foto aufnehmen'}
              </button>
              <button className="btn btn-sm" type="button" disabled={fileBusy}
                onClick={() => { if (fileRef.current) { fileRef.current.removeAttribute('capture'); fileRef.current.click() } }}>
                📎 Datei wählen
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden
            onChange={(e) => { void pickFile(e.target.files) }} />
          {fileError && <div className="hint-box mt8" style={{ color: 'var(--critical)' }}>{fileError}</div>}
        </Field>
      )}

      <div className="row mt16">
        {tx && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>
          {tx ? 'Änderungen speichern' : 'Speichern'}
        </button>
      </div>

      {tx && (
        <Confirm open={confirmDelete} title="Buchung löschen?"
          message="Die Buchung wandert in den Papierkorb und kann dort wiederhergestellt werden."
          danger onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { m.remove('transactions', tx.id, 'Buchung gelöscht'); setConfirmDelete(false); onDone() }} />
      )}
    </div>
  )
}

export function TaskForm({ onDone, initial }: { onDone: () => void; initial?: any }) {
  const m = useMutations()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [duration, setDuration] = useState<number | null>(initial?.duration_minutes ?? null)
  const [priority, setPriority] = useState<number>(initial?.priority ?? 2)
  const [when, setWhen] = useState<string>(initial?.scheduled_on ?? '')
  const [scheduledEndOn, setScheduledEndOn] = useState<string>(initial?.scheduled_end_on ?? '')
  const [frist, setFrist] = useState<string>(initial?.due_on ?? '')
  const [modus, setModus] = useState<'tag' | 'frist'>(
    initial?.due_on && !initial?.scheduled_on ? 'frist' : 'tag')
  const [fest, setFest] = useState(!!initial?.pinned_day)
  const [note, setNote] = useState(initial?.description ?? '')
  const [hatTeile, setHatTeile] = useState(!!initial?.progress_total)
  const [teileGesamt, setTeileGesamt] = useState<number>(initial?.progress_total ?? 2)

  const submit = () => {
    if (!title.trim()) return
    // „Bis wann" statt „an welchem Tag": Dann bleibt die Aufgabe liegen, bis
    // es Zeit wird, statt jeden Morgen mitzulaufen.
    const alsFrist = modus === 'frist' && frist
    const payload = {
      title: title.trim(), description: note || null, note: null,
      status: initial?.status ?? 'open',
      bucket: alsFrist ? 'scheduled' : when ? (when === todayString() ? 'today' : 'scheduled') : 'inbox',
      scheduled_on: alsFrist ? null : (when || null), scheduled_time: null,
      scheduled_end_on: alsFrist ? null : (scheduledEndOn && when && scheduledEndOn > when ? scheduledEndOn : null),
      due_on: alsFrist ? frist : null, due_time: null,
      show_from: null, pinned_day: fest && !alsFrist ? 1 : 0,
      carried_count: initial?.carried_count ?? 0, carried_from: initial?.carried_from ?? null,
      duration_minutes: duration, priority, category: null, project_id: null,
      parent_task_id: initial?.parent_task_id ?? null, recurring_id: null,
      completed_at: initial?.completed_at ?? null, energy: null, sort_order: 0,
      progress_total: hatTeile ? teileGesamt : null,
      progress_done: hatTeile ? Math.min(initial?.progress_done ?? 0, teileGesamt) : null,
    }
    if (initial) m.patch('tasks', initial.id, payload, 'Aufgabe geändert')
    else m.create('tasks', payload, 'Aufgabe erstellt')
    onDone()
  }

  return (
    <div>
      <Field label="Was ist zu tun?">
        <input className="input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="z. B. Öl fürs Auto bestellen" />
      </Field>
      <Field label="Wann?">
        <Chips size="sm" value={modus} onChange={(v) => setModus(v as 'tag' | 'frist')} options={[
          { value: 'tag', label: 'An einem Tag' },
          { value: 'frist', label: 'Bis zu einem Tag' },
        ]} />
      </Field>

      {modus === 'tag' ? (
        <Field label="Geplant für" hint="Ohne Datum landet die Aufgabe in der Inbox – das ist gewollt.">
          <div className="chips mb8">
            <button type="button" className={`chip${when === todayString() ? ' active' : ''}`} onClick={() => setWhen(todayString())}>Heute</button>
            <button type="button" className={`chip${when === addDays(todayString(), 1) ? ' active' : ''}`} onClick={() => setWhen(addDays(todayString(), 1))}>Morgen</button>
            <button type="button" className={`chip${when === addDays(todayString(), 7) ? ' active' : ''}`} onClick={() => setWhen(addDays(todayString(), 7))}>Nächste Woche</button>
            <button type="button" className={`chip${when === '' ? ' active' : ''}`} onClick={() => setWhen('')}>Inbox</button>
          </div>
          <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          {when && (
            <>
              <label className="row small mt8">
                <input type="checkbox" checked={fest} onChange={(e) => setFest(e.target.checked)} />
                Fester Termin – bleibt an diesem Tag stehen und wandert nicht mit
              </label>
              <Field label="Bis" hint="leer lassen für eine eintägige Aufgabe">
                <input className="input" type="date" value={scheduledEndOn} min={when}
                  onChange={(e) => setScheduledEndOn(e.target.value)} />
              </Field>
            </>
          )}
        </Field>
      ) : (
        <Field label="Muss erledigt sein bis"
          hint={frist
            ? `Taucht nicht täglich auf. Sie meldet sich ab ${formatDay(defaultShowFrom(frist, todayString()))} und wird zur Frist hin immer deutlicher.`
            : 'Die Aufgabe bleibt ruhig liegen und meldet sich rechtzeitig vor der Frist.'}>
          <div className="chips mb8">
            <button type="button" className={`chip${frist === addDays(todayString(), 7) ? ' active' : ''}`} onClick={() => setFrist(addDays(todayString(), 7))}>in einer Woche</button>
            <button type="button" className={`chip${frist === addDays(todayString(), 30) ? ' active' : ''}`} onClick={() => setFrist(addDays(todayString(), 30))}>in einem Monat</button>
            <button type="button" className={`chip${frist === addDays(todayString(), 183) ? ' active' : ''}`} onClick={() => setFrist(addDays(todayString(), 183))}>in einem halben Jahr</button>
          </div>
          <input className="input" type="date" value={frist} onChange={(e) => setFrist(e.target.value)} />
        </Field>
      )}
      <Field label="Dauer" hint="Frei eintragen – damit kann die App realistische Tagespläne bauen.">
        <DurationInput minutes={duration} onChange={setDuration} />
      </Field>
      <Field label="Priorität">
        <Chips options={[{ value: 1, label: 'Niedrig' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Hoch' }]}
          value={priority} onChange={setPriority} />
      </Field>
      <label className="row small">
        <input type="checkbox" checked={hatTeile} onChange={(e) => setHatTeile(e.target.checked)} />
        Aufgabe besteht aus mehreren Teilen
      </label>
      {hatTeile && (
        <Field label="Teile insgesamt" hint="z. B. 4 Teile drucken – dann lässt sich der Fortschritt 1/4, 2/4 … festhalten">
          <input className="input" type="number" min={2} style={{ maxWidth: 100 }}
            value={teileGesamt} onChange={(e) => setTeileGesamt(Math.max(2, Number(e.target.value) || 2))} />
        </Field>
      )}
      <Field label="Beschreibung">
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!title.trim()} onClick={submit}>
        {initial ? 'Speichern' : 'Aufgabe erstellen'}
      </button>
    </div>
  )
}

export function EventForm({ onDone, initial, defaultDay }: { onDone: () => void; initial?: any; defaultDay?: string }) {
  const m = useMutations()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [day, setDay] = useState(initial?.day ?? defaultDay ?? todayString())
  const [start, setStart] = useState(initial?.start_time ?? '')
  const [end, setEnd] = useState(initial?.end_time ?? '')
  const [allDay, setAllDay] = useState(!!initial?.all_day)
  const [location, setLocation] = useState(initial?.location ?? '')

  const submit = () => {
    if (!title.trim()) return
    const payload = {
      title: title.trim(), description: null, location: location || null,
      day, start_time: allDay ? null : (start || null), end_time: allDay ? null : (end || null),
      all_day: allDay ? 1 : 0, timezone: 'Europe/Berlin', rrule: null, exdates: null,
      color: null, source: 'local', external_uid: null,
    }
    if (initial) m.patch('calendar_events', initial.id, payload, 'Termin geändert')
    else m.create('calendar_events', payload, 'Termin erstellt')
    onDone()
  }

  return (
    <div>
      <Field label="Titel">
        <input className="input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Datum">
        <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 12 }}>
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Ganztägig
      </label>
      {!allDay && (
        <div className="row">
          <Field label="Von"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Bis"><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Ort">
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!title.trim()} onClick={submit}>
        {initial ? 'Speichern' : 'Termin erstellen'}
      </button>
    </div>
  )
}

function MetricForm({ onDone }: { onDone: () => void }) {
  const data = useData()
  const m = useMutations()
  const [day, setDay] = useState(todayString())
  const [values, setValues] = useState<Record<string, string>>({})
  const metrics = data.metrics.filter((x) => x.is_enabled && x.show_in_daily_form)

  const submit = () => {
    let count = 0
    for (const metric of metrics) {
      const raw = values[metric.id]
      if (raw === undefined || raw === '') continue
      const num = Number(raw.replace(',', '.'))
      if (!Number.isFinite(num)) continue
      const existing = data.metricEntries.find((e) => !e.deleted_at && e.metric_id === metric.id && e.day === day)
      if (existing) m.patch('metric_entries', existing.id, { value_num: num })
      else m.create('metric_entries', {
        metric_id: metric.id, day, at_time: null, value_num: num,
        value_text: null, note: null, source: 'manual', import_batch_id: null,
      })
      count++
    }
    m.reload()
    onDone()
  }

  return (
    <div>
      <Field label="Tag">
        <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      {metrics.map((metric) => {
        const existing = data.metricEntries.find((e) => !e.deleted_at && e.metric_id === metric.id && e.day === day)
        if (metric.key === 'sleep_h') {
          const minutes = values[metric.id] !== undefined
            ? (values[metric.id] === '' ? null : Math.round(Number(values[metric.id].replace(',', '.')) * 60))
            : (existing?.value_num !== undefined && existing?.value_num !== null ? Math.round(existing.value_num * 60) : null)
          return (
            <Field key={metric.id} label={metric.name}>
              <DurationInput minutes={minutes}
                onChange={(m2) => setValues({ ...values, [metric.id]: m2 === null ? '' : String(m2 / 60) })} />
            </Field>
          )
        }
        return (
          <Field key={metric.id} label={`${metric.name}${metric.unit ? ` (${metric.unit})` : ''}`}>
            <input className="input" inputMode="decimal"
              placeholder={existing?.value_num !== undefined && existing?.value_num !== null ? String(existing.value_num) : '–'}
              value={values[metric.id] ?? ''}
              onChange={(e) => setValues({ ...values, [metric.id]: e.target.value })} />
          </Field>
        )
      })}
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={submit}>Speichern</button>
    </div>
  )
}

function NoteForm({ onDone }: { onDone: () => void }) {
  const m = useMutations()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  return (
    <div>
      <Field label="Titel"><input className="input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Notiz"><textarea className="textarea" style={{ minHeight: 130 }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!body.trim()}
        onClick={() => { m.create('notes', { title: title || null, body, day: todayString(), pinned: 0 }, 'Notiz gespeichert'); onDone() }}>
        Speichern
      </button>
    </div>
  )
}
