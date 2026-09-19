/**
 * PLAN · ARBEITSPLAN – Schichten auf den Kalender malen, Tagesarten pflegen.
 */
import React, { useMemo, useState } from 'react'
import { Card, Modal, Field, Chips, Confirm } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import {
  todayString, formatDay, startOfWeek, endOfWeek, daysInRange,
  monthOf, formatMonth, addMonthsToYearMonth, monthStart, monthEnd, weekdayIndex,
} from '../../core/dates'
import type { DayType } from '../../core/types'

/**
 * Die Farben, die für eine Tagesart zur Wahl stehen.
 *
 * Bewusst diese sieben und nicht die Diagrammpalette: Der Arbeitsplan ist
 * eine Fläche voller Kacheln, und Grün heisst in dieser App bereits
 * „erledigt/Feiertag". Die Arbeitstage teilen sich eine Familie und
 * unterscheiden sich in der Helligkeit nach Tageszeit.
 */
const TAGESART_FARBEN = [
  { name: 'Frühschicht (hellblau)', wert: 'var(--tag-frueh)' },
  { name: 'Spätschicht (blau)', wert: 'var(--tag-spaet)' },
  { name: 'Nachtschicht (dunkelblau)', wert: 'var(--tag-nacht)' },
  { name: 'Schule (violett)', wert: 'var(--tag-schule)' },
  { name: 'Urlaub (warm)', wert: 'var(--tag-urlaub)' },
  { name: 'Frei (grau)', wert: 'var(--tag-frei)' },
  { name: 'Krank (rosé)', wert: 'var(--tag-krank)' },
]

/* --------------------------------------------------------- Arbeitsplan */

export function WorkView() {
  const data = useData()
  const m = useMutations()
  const [month, setMonth] = useState(monthOf(todayString()))
  const [editMode, setEditMode] = useState(false)
  const [brush, setBrush] = useState<string | null>(null)          // gewählte Tagesart ("Pinsel")
  const [pending, setPending] = useState<Record<string, string | null>>({})
  const [editingType, setEditingType] = useState<DayType | 'new' | null>(null)

  const dayTypes = data.dayTypes.filter((t) => !t.deleted_at)
  const typeById = useMemo(() => new Map(dayTypes.map((t) => [t.id, t])), [dayTypes])

  // Kalendergitter: volle Wochen von Montag bis Sonntag
  const gridStart = startOfWeek(monthStart(month))
  const gridEnd = endOfWeek(monthEnd(month))
  const days = daysInRange(gridStart, gridEnd)

  const assignedId = (day: string): string | null => {
    if (day in pending) return pending[day]
    const a = data.dayAssignments.find((x) => !x.deleted_at && x.day === day)
    return a ? a.day_type_id : null
  }

  const paint = (day: string) => {
    if (!editMode || !brush) return
    setPending((p) => ({ ...p, [day]: brush === '__clear' ? null : brush }))
  }

  const save = () => {
    // Als EIN Stapel: eine Datenbanktransaktion, ein Nachladen am Ende. Wer
    // einen Monat bemalt, schreibt dreißig Zeilen – einzeln wären das dreißig
    // vollständige Neuladungen des Datenbildes.
    //
    // Die Zuordnung Tag → vorhandene Zeile steht vorher als Nachschlagewerk
    // bereit, statt für jeden Tag die ganze Liste zu durchsuchen.
    const vorhanden = new Map(
      data.dayAssignments.filter((x) => !x.deleted_at).map((x) => [x.day, x]),
    )
    const n = m.batch(() => {
      let geschrieben = 0
      for (const [day, typeId] of Object.entries(pending)) {
        const existing = vorhanden.get(day)
        if (typeId === null) {
          if (existing) { m.removeQuiet('day_assignments', existing.id); geschrieben++ }
        } else if (existing) {
          if (existing.day_type_id !== typeId) { m.patch('day_assignments', existing.id, { day_type_id: typeId }); geschrieben++ }
        } else {
          m.create('day_assignments', { day, day_type_id: typeId }); geschrieben++
        }
      }
      return geschrieben
    })
    setPending({})
    setEditMode(false)
    setBrush(null)
    m.toast(n ? `${n} Tage gespeichert` : 'Nichts geändert')
  }

  const monthDays = days.filter((d) => monthOf(d) === month)
  const stats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of monthDays) {
      const id = assignedId(d)
      const name = id ? typeById.get(id)?.name ?? '?' : 'ohne Angabe'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [monthDays, data.dayAssignments, pending, typeById])

  const pendingCount = Object.keys(pending).length

  return (
    <>
      <Card className="mb16" title={`Arbeitsplan · ${formatMonth(month)}`}
        sub={editMode
          ? 'Tagesart oben wählen, dann die Tage antippen. Zum Schluss speichern.'
          : 'Der Plan ist gegen versehentliches Verstellen geschützt. Zum Ändern auf „Bearbeiten" tippen.'}
        action={
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, -1))}>←</button>
            <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, 1))}>→</button>
            {!editMode
              ? <button className="btn btn-sm btn-primary" onClick={() => setEditMode(true)}>Bearbeiten</button>
              : <>
                  <button className="btn btn-sm" onClick={() => { setPending({}); setEditMode(false); setBrush(null) }}>Abbrechen</button>
                  <button className="btn btn-sm btn-primary" onClick={save}>
                    Speichern{pendingCount ? ` (${pendingCount})` : ''}
                  </button>
                </>}
          </div>
        }>

        {editMode && (
          <div className="chips mb16">
            {dayTypes.map((t) => (
              <button key={t.id} className={`chip ${brush === t.id ? 'active' : ''}`}
                onClick={() => setBrush(brush === t.id ? null : t.id)}>
                <span className="dot" style={{ background: t.color ?? 'var(--surface-3)' }} />
                {t.name}
              </button>
            ))}
            <button className={`chip ${brush === '__clear' ? 'active' : ''}`}
              onClick={() => setBrush(brush === '__clear' ? null : '__clear')}>🧽 Eintrag entfernen</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, maxWidth: 560 }}>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', paddingBottom: 4 }}>{d}</div>
          ))}
          {days.map((d) => {
            const inMonth = monthOf(d) === month
            const isToday = d === todayString()
            const id = assignedId(d)
            const t = id ? typeById.get(id) : null
            const changed = d in pending
            const holiday = data.holidays.find((h: any) => !h.deleted_at && h.day === d)
            return (
              <button key={d} onClick={() => paint(d)}
                disabled={!editMode || !brush}
                title={holiday ? holiday.name : formatDay(d)}
                style={{
                  aspectRatio: '1', borderRadius: 8, padding: 2,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: t?.color ?? 'var(--surface-2)',
                  color: t ? '#fff' : 'var(--text-muted)',
                  opacity: inMonth ? 1 : 0.32,
                  outline: changed ? '2px solid var(--accent)' : isToday ? '2px solid var(--text)' : 'none',
                  outlineOffset: -2,
                  cursor: editMode && brush ? 'pointer' : 'default',
                }}>
                <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 600 }}>{Number(d.slice(8, 10))}</span>
                {t && <span style={{ fontSize: 9, fontWeight: 700 }}>{t.short_code}</span>}
                {!t && holiday && <span style={{ fontSize: 8 }}>F</span>}
              </button>
            )
          })}
        </div>

        <div className="legend">
          {stats.map(([name, n]) => (
            <span className="legend-item" key={name}>
              <span className="legend-swatch" style={{ background: dayTypes.find((t) => t.name === name)?.color ?? 'var(--surface-3)' }} />
              {name}: <strong>{n}</strong>
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Tagesarten" sub="Schichten, Schule, Urlaub – frei anpassbar"
          action={<button className="btn btn-sm" onClick={() => setEditingType('new')}>+ Neu</button>}>
          <div className="list">
            {dayTypes.map((t) => (
              <button className="list-row" key={t.id} onClick={() => setEditingType(t)} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="dot" style={{ background: t.color ?? 'var(--surface-3)' }} />
                <span className="list-main">
                  <span className="list-title">{t.name} <span className="muted">({t.short_code})</span></span>
                  <span className="list-sub">
                    {t.default_start && t.default_end ? `${t.default_start}–${t.default_end}` : 'ohne feste Zeiten'}
                    {t.break_minutes ? ` · ${t.break_minutes} min Pause` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Schnell eintragen" sub="Ganze Zeiträume auf einmal setzen – etwa eine Berufsschulwoche.">
          <BulkAssign />
        </Card>
      </div>

      {editingType && <DayTypeEditor dayType={editingType === 'new' ? null : editingType} onClose={() => setEditingType(null)} />}
    </>
  )
}

function BulkAssign() {
  const data = useData()
  const m = useMutations()
  const [from, setFrom] = useState(monthStart(monthOf(todayString())))
  const [to, setTo] = useState(monthEnd(monthOf(todayString())))
  const [typeId, setTypeId] = useState('')
  const [skipWeekend, setSkipWeekend] = useState(true)

  const apply = () => {
    if (!typeId) return
    // Ein Zeitraum kann ein ganzes Jahr sein. Ohne Stapel wären das 365
    // vollständige Neuladungen – die App stünde dabei sichtbar still.
    const vorhanden = new Map(
      data.dayAssignments.filter((a) => !a.deleted_at).map((a) => [a.day, a]),
    )
    const n = m.batch(() => {
      let gesetzt = 0
      for (const d of daysInRange(from, to)) {
        if (skipWeekend && weekdayIndex(d) >= 6) continue
        const existing = vorhanden.get(d)
        if (existing) m.patch('day_assignments', existing.id, { day_type_id: typeId })
        else m.create('day_assignments', { day: d, day_type_id: typeId })
        gesetzt++
      }
      return gesetzt
    })
    m.toast(`${n} Tage gesetzt`)
  }

  return (
    <>
      <div className="grid grid-2 keep2">
        <Field label="Von"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Bis"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Tagesart">
        <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">wählen…</option>
          {data.dayTypes.filter((t) => !t.deleted_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <label className="row small mt8">
        <input type="checkbox" checked={skipWeekend} onChange={(e) => setSkipWeekend(e.target.checked)} /> Wochenenden auslassen
      </label>
      <button className="btn btn-primary mt12" onClick={apply} disabled={!typeId}>Eintragen</button>
    </>
  )
}

function DayTypeEditor({ dayType, onClose }: { dayType: DayType | null; onClose: () => void }) {
  const m = useMutations()
  const data = useData()
  const [name, setName] = useState(dayType?.name ?? '')
  const [code, setCode] = useState(dayType?.short_code ?? '')
  const [kind, setKind] = useState(dayType?.kind ?? 'work')
  const [start, setStart] = useState(dayType?.default_start ?? '')
  const [end, setEnd] = useState(dayType?.default_end ?? '')
  const [breakMin, setBreakMin] = useState(dayType?.break_minutes ?? 0)
  const [color, setColor] = useState(dayType?.color ?? 'var(--tag-frueh)')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    if (!name.trim() || !code.trim()) return
    const payload = {
      name: name.trim(), short_code: code.trim(), kind,
      default_start: start || null, default_end: end || null,
      break_minutes: breakMin, color,
      counts_as_workday: kind === 'work' || kind === 'school' ? 1 : 0,
      sort_order: dayType?.sort_order ?? data.dayTypes.length,
    }
    if (dayType) m.patch('day_types', dayType.id, payload, 'Tagesart geändert')
    else m.create('day_types', payload, 'Tagesart angelegt')
    onClose()
  }

  return (
    <Modal open title={dayType ? 'Tagesart bearbeiten' : 'Neue Tagesart'} onClose={onClose}
      footer={<>
        {dayType && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save}>Speichern</button>
      </>}>
      <div className="grid grid-2 keep2">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Kürzel"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} /></Field>
      </div>
      <Field label="Art">
        <Chips options={[
          { value: 'work', label: 'Arbeit' }, { value: 'school', label: 'Schule' },
          { value: 'vacation', label: 'Urlaub' }, { value: 'off', label: 'Frei' },
          { value: 'sick', label: 'Krank' },
        ]} value={kind} onChange={(v) => setKind(v as any)} />
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Beginn"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ende"><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Pause (Minuten)"><input className="input" type="number" value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} /></Field>
      <Field label="Farbe" hint="Zurückhaltende Töne – Grün bleibt für „erledigt“ und Feiertage reserviert.">
        <div className="chips">
          {TAGESART_FARBEN.map((f) => (
            <button key={f.wert} type="button" title={f.name} aria-label={f.name}
              onClick={() => setColor(f.wert)}
              style={{ width: 26, height: 26, borderRadius: 8, background: f.wert,
                outline: color === f.wert ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </Field>
      <Confirm open={confirmDelete} title="Tagesart löschen?" message="Bereits zugeordnete Tage verlieren ihre Zuordnung." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('day_types', dayType!.id, 'Tagesart gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}
