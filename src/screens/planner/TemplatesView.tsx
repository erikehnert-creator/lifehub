/**
 * PLAN · VORLAGEN – wiederkehrende Aufgaben, an den Plan gekoppelt.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, DurationInput } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { todayString, formatDay, formatDuration, addDays, weekdayShort } from '../../core/dates'
import { VORPLANUNG_TAGE } from '../../core/automation'

/* ------------------------------------------------------------- Vorlagen */

export function TemplatesView() {
  const data = useData()
  const [editing, setEditing] = useState<any | 'new' | null>(null)
  const today = todayString()

  const templates = data.taskTemplates.filter((t: any) => !t.deleted_at)
  const typeById = new Map(data.dayTypes.map((t) => [t.id, t]))
  const WEEK = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

  // Was die Automatik aus diesen Vorlagen bereits eingeplant HAT. Früher stand
  // hier eine Vorschau auf das, was ein Knopfdruck erzeugen wuerde – den Knopf
  // gibt es nicht mehr, also ist die ehrlichere Auskunft der tatsächliche Plan.
  const horizont = addDays(today, VORPLANUNG_TAGE)
  const eingeplant = useMemo(
    () => data.tasks
      .filter((t) => !t.deleted_at && t.template_id && t.scheduled_on
        && t.scheduled_on >= today && t.scheduled_on <= horizont)
      .sort((a, b) => (a.scheduled_on! < b.scheduled_on! ? -1 : a.scheduled_on! > b.scheduled_on! ? 1
        : (a.scheduled_time ?? '99:99').localeCompare(b.scheduled_time ?? '99:99'))),
    [data.tasks, today, horizont],
  )

  return (
    <>
      <Card className="mb16" title="Aufgabenvorlagen"
        sub={'Wiederkehrende Aufgaben, die an deinen Plan gekoppelt sind – etwa „immer dienstags, wenn Spätschicht ist: Auto putzen“. Was hier steht, plant LifeHub von selbst ein.'}
        action={<button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>+ Vorlage</button>}>
        <div className="row">
          <Stat small label="Vorlagen" value={String(templates.filter((t: any) => t.is_active).length)} />
          <Stat small label="Eingeplant (4 Wochen)" value={String(eingeplant.length)} />
        </div>
        <div className="hint-box mt12 small">
          Es gibt keinen Knopf mehr zum Einplanen – das läuft automatisch, auf jedem Gerät,
          und legt nichts doppelt an. Änderst du eine Vorlage, ziehen alle noch bevorstehenden
          Aufgaben daraus nach; erledigte und vergangene bleiben unangetastet.
        </div>
      </Card>

      {templates.length === 0 ? (
        <Empty icon="🔁" title="Noch keine Vorlagen"
          hint="Eine Vorlage merkt sich, was an bestimmten Tagen ansteht, und plant es für dich vor."
          action={<button className="btn btn-primary" onClick={() => setEditing('new')}>+ Erste Vorlage</button>} />
      ) : (
        <Card className="pad0 mb16">
          <div className="list">
            {templates.map((t: any) => (
              <button className="list-row" key={t.id} onClick={() => setEditing(t)}>
                <span className="avatar">🔁</span>
                <span className="list-main">
                  <span className="list-title">{t.title}</span>
                  <span className="list-sub">
                    {t.weekday ? `jeden ${WEEK[t.weekday]}` : 'jeden Tag'}
                    {t.interval_weeks > 1 ? ` (alle ${t.interval_weeks} Wochen)` : ''}
                    {t.day_type_id ? ` · nur bei ${typeById.get(t.day_type_id)?.name ?? '?'}` : ''}
                    {t.duration_minutes ? ` · ${formatDuration(t.duration_minutes)}` : ''}
                    {!t.is_active ? ' · pausiert' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {eingeplant.length > 0 && (
        <Card title="Schon eingeplant" sub="Die nächsten vier Wochen">
          <div className="list">
            {eingeplant.slice(0, 20).map((p) => (
              <div className="list-row" key={p.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="list-main">
                  <span className="list-title">{p.title}</span>
                  <span className="list-sub">
                    {weekdayShort(p.scheduled_on!)} {formatDay(p.scheduled_on!)}
                    {p.scheduled_time ? ` · ${p.scheduled_time}` : ''}
                    {p.status === 'done' ? ' · erledigt' : ''}
                  </span>
                </span>
                {p.duration_minutes && <span className="list-amount">{formatDuration(p.duration_minutes)}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function TemplateEditor({ template, onClose }: { template: any | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [title, setTitle] = useState(template?.title ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [duration, setDuration] = useState<number | null>(template?.duration_minutes ?? null)
  const [time, setTime] = useState<string>(template?.scheduled_time ?? '')
  const [priority, setPriority] = useState(template?.priority ?? 2)
  const [weekday, setWeekday] = useState<number>(template?.weekday ?? 0)
  const [dayTypeId, setDayTypeId] = useState(template?.day_type_id ?? '')
  const [intervalWeeks, setIntervalWeeks] = useState(template?.interval_weeks ?? 1)
  const [active, setActive] = useState(template ? !!template.is_active : true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    if (!title.trim()) return
    const payload = {
      title: title.trim(), description: description || null,
      duration_minutes: duration, priority, scheduled_time: time || null,
      weekday: weekday || null, day_type_id: dayTypeId || null,
      interval_weeks: intervalWeeks, anchor_date: template?.anchor_date ?? todayString(),
      is_active: active ? 1 : 0, last_generated_on: null,
    }
    if (template) m.patch('task_templates', template.id, payload, 'Vorlage geändert')
    else m.create('task_templates', payload, 'Vorlage angelegt')
    onClose()
  }

  return (
    <Modal open title={template ? 'Vorlage bearbeiten' : 'Neue Vorlage'} onClose={onClose}
      footer={<>
        {template && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Speichern</button>
      </>}>
      <Field label="Aufgabe"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Auto putzen" autoFocus /></Field>
      <Field label="Wochentag">
        <select className="select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          <option value={0}>jeden Tag</option>
          {['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((d, i) => (
            <option key={d} value={i + 1}>jeden {d}</option>
          ))}
        </select>
      </Field>
      <Field label="Nur an diesen Tagen" hint="So entsteht die Aufgabe nur, wenn der Tag auch wirklich passt.">
        <select className="select" value={dayTypeId} onChange={(e) => setDayTypeId(e.target.value)}>
          <option value="">unabhängig von der Tagesart</option>
          {data.dayTypes.filter((t) => !t.deleted_at).map((t) => <option key={t.id} value={t.id}>nur bei {t.name}</option>)}
        </select>
      </Field>
      <Field label="Rhythmus">
        <Chips options={[
          { value: 1, label: 'jede Woche' }, { value: 2, label: 'alle 2 Wochen' },
          { value: 3, label: 'alle 3 Wochen' }, { value: 4, label: 'alle 4 Wochen' },
        ]} value={intervalWeeks} onChange={setIntervalWeeks} />
      </Field>
      <Field label="Uhrzeit" hint="Ändert sie sich später, wandern alle noch bevorstehenden Aufgaben aus dieser Vorlage mit.">
        <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
      <Field label="Dauer"><DurationInput minutes={duration} onChange={setDuration} /></Field>
      <Field label="Priorität">
        <Chips options={[{ value: 1, label: 'Niedrig' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Hoch' }]}
          value={priority} onChange={setPriority} />
      </Field>
      <Field label="Beschreibung"><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label className="row small"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Aktiv</label>
      <Confirm open={confirmDelete} title="Vorlage löschen?"
        message="Noch bevorstehende Aufgaben aus dieser Vorlage verschwinden mit. Erledigte und vergangene bleiben als Historie erhalten." danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('task_templates', template.id, 'Vorlage gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}
