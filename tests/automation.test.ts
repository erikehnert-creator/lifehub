/**
 * Die Automatik: Aufgaben aus Vorlagen und Buchungen aus wiederkehrenden
 * Zahlungen.
 *
 * Der Schwerpunkt liegt bewusst auf dem, was NICHT passieren darf –
 * nachträglich veränderte Finanzhistorie, doppelte Aufgaben auf zwei Geräten,
 * wiederauferstandene Einträge. Dass etwas entsteht, merkt man sofort; dass
 * still etwas Falsches entstanden ist, merkt man erst viel später.
 */
import { describe, it, expect } from 'vitest'
import {
  reconcileTemplateTasks, duePayments, templateTaskId, recurringBookingId,
} from '../src/core/automation'
import { stableId } from '../src/core/ids'
import { buildRRule } from '../src/core/recurrence'
import type { RecurringRule, Task, TaskTemplate } from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null, version: 1, last_device_id: 'g1', server_rev: null,
}

/* September 2026: 14. = Montag, 18. = Freitag, 21. = Montag, 25. = Freitag */
const HEUTE = '2026-09-14'

function tpl(over: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    ...basis, id: 'tpl-training', title: 'Training', description: null,
    duration_minutes: 60, priority: 2, weekday: 1, day_type_id: null,
    interval_weeks: 1, anchor_date: null, is_active: 1, last_generated_on: null,
    scheduled_time: '18:00', ...over,
  }
}

function task(over: Partial<Task> = {}): Task {
  return {
    ...basis, id: 'x', title: 'Training', description: null, note: null,
    status: 'open', bucket: 'scheduled', scheduled_on: null, scheduled_time: null,
    due_on: null, due_time: null, duration_minutes: 60, priority: 2,
    category: null, project_id: null, parent_task_id: null, recurring_id: null,
    completed_at: null, energy: null, sort_order: 0, template_id: 'tpl-training',
    show_from: null, pinned_day: 0, carried_count: 0, carried_from: null,
    scheduled_end_on: null, progress_total: null, progress_done: null, ...over,
  }
}

/** Eine Aufgabe, wie die Automatik sie selbst erzeugt hätte. */
function erzeugt(day: string, over: Partial<Task> = {}): Task {
  return task({
    id: templateTaskId('tpl-training', day),
    scheduled_on: day, scheduled_time: '18:00', ...over,
  })
}

function abgleich(opts: Partial<Parameters<typeof reconcileTemplateTasks>[0]> = {}) {
  return reconcileTemplateTasks({
    templates: [tpl()], assignments: [], tasks: [], today: HEUTE, horizonDays: 27, ...opts,
  })
}

/* ------------------------------------------------------ Aufgaben: Anlegen */

describe('Aufgaben aus Vorlagen entstehen von selbst', () => {
  it('plant alle passenden Tage im Vorlauf ein – ohne Knopfdruck', () => {
    const plan = abgleich()
    expect(plan.anlegen.map((a) => a.values.scheduled_on))
      .toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'])
    expect(plan.anlegen[0].values.scheduled_time).toBe('18:00')
    expect(plan.anlegen[0].values.template_id).toBe('tpl-training')
  })

  it('legt an zwei Tagen pro Woche an, wenn es zwei Vorlagen gibt', () => {
    const plan = abgleich({
      templates: [tpl(), tpl({ id: 'tpl-lauf', title: 'Laufen', weekday: 5, scheduled_time: '07:00' })],
    })
    const montage = plan.anlegen.filter((a) => a.values.title === 'Training').length
    const freitage = plan.anlegen.filter((a) => a.values.title === 'Laufen').length
    expect(montage).toBe(4)
    expect(freitage).toBe(4)
  })

  it('legt nichts an, was schon da ist – zweiter Durchlauf bleibt leer', () => {
    const ersterPlan = abgleich()
    const bestand = ersterPlan.anlegen.map((a) => task({ ...a.values } as Partial<Task>))
    const zweiterPlan = abgleich({ tasks: bestand })
    expect(zweiterPlan.anlegen).toHaveLength(0)
    expect(zweiterPlan.aendern).toHaveLength(0)
    expect(zweiterPlan.entfernen).toHaveLength(0)
  })

  it('holt eine von Hand gelöschte Aufgabe nicht zurück', () => {
    const geloescht = erzeugt('2026-09-21', { deleted_at: '2026-09-15T10:00:00Z' })
    const plan = abgleich({ tasks: [geloescht] })
    expect(plan.anlegen.map((a) => a.values.scheduled_on)).not.toContain('2026-09-21')
  })

  it('erzeugt nichts aus pausierten oder gelöschten Vorlagen', () => {
    expect(abgleich({ templates: [tpl({ is_active: 0 })] }).anlegen).toHaveLength(0)
    expect(abgleich({ templates: [tpl({ deleted_at: 'weg' })] }).anlegen).toHaveLength(0)
  })
})

/* ----------------------------------------------------- Aufgaben: Nachziehen */

describe('Eine geänderte Vorlage zieht ihre Aufgaben nach', () => {
  it('ändert die Uhrzeit aller noch bevorstehenden Aufgaben', () => {
    const bestand = ['2026-09-14', '2026-09-21', '2026-09-28'].map((d) => erzeugt(d))
    const plan = abgleich({ templates: [tpl({ scheduled_time: '17:30' })], tasks: bestand })
    expect(plan.aendern).toHaveLength(3)
    for (const a of plan.aendern) expect(a.patch.scheduled_time).toBe('17:30')
    expect(plan.entfernen).toHaveLength(0)
  })

  it('lässt vergangene Aufgaben in Ruhe', () => {
    const vergangen = erzeugt('2026-09-07')             // vor HEUTE
    const kommend = erzeugt('2026-09-21')
    const plan = abgleich({
      templates: [tpl({ scheduled_time: '17:30' })],
      tasks: [vergangen, kommend],
    })
    expect(plan.aendern.map((a) => a.id)).toEqual([kommend.id])
  })

  it('lässt erledigte Aufgaben in Ruhe – auch wenn sie noch in der Zukunft liegen', () => {
    const erledigt = erzeugt('2026-09-21', { status: 'done', completed_at: '2026-09-14T20:00:00Z' })
    const plan = abgleich({ templates: [tpl({ scheduled_time: '17:30' })], tasks: [erledigt] })
    expect(plan.aendern).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
  })

  it('zieht Titel, Dauer, Priorität und Beschreibung ebenfalls nach', () => {
    const plan = abgleich({
      templates: [tpl({ title: 'Krafttraining', duration_minutes: 90, priority: 3, description: 'Beintag' })],
      tasks: [erzeugt('2026-09-21')],
    })
    expect(plan.aendern[0].patch).toEqual({
      title: 'Krafttraining', duration_minutes: 90, priority: 3, description: 'Beintag',
    })
  })

  it('fasst eine Aufgabe nicht an, die der Tagesübertrag schon verschoben hat', () => {
    // Sie gehört jetzt dem Tag, auf den sie gerutscht ist – nicht mehr der Vorlage.
    const verschoben = task({
      id: 'verschoben', scheduled_on: HEUTE, scheduled_time: '18:00',
      carried_count: 2, carried_from: '2026-09-07',
    })
    const plan = abgleich({ templates: [tpl({ scheduled_time: '17:30' })], tasks: [verschoben] })
    expect(plan.aendern).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
  })
})

/* -------------------------------------------------------- Aufgaben: Löschen */

describe('Eine gelöschte Vorlage nimmt ihre Zukunft mit', () => {
  const bestand = [
    erzeugt('2026-09-07'),                                    // vergangen
    erzeugt('2026-09-14'),                                    // heute
    erzeugt('2026-09-21'),                                    // zukünftig
    erzeugt('2026-09-28', { status: 'done' }),                // erledigt
  ]

  it('entfernt die noch bevorstehenden, offenen Aufgaben', () => {
    const plan = abgleich({ templates: [tpl({ deleted_at: 'weg' })], tasks: bestand })
    expect(plan.entfernen.map((e) => e.id).sort())
      .toEqual([templateTaskId('tpl-training', '2026-09-14'), templateTaskId('tpl-training', '2026-09-21')].sort())
    for (const e of plan.entfernen) expect(e.grund).toBe('vorlage-weg')
  })

  it('lässt vergangene und erledigte Aufgaben als Historie stehen', () => {
    const plan = abgleich({ templates: [tpl({ deleted_at: 'weg' })], tasks: bestand })
    const entfernt = new Set(plan.entfernen.map((e) => e.id))
    expect(entfernt.has(templateTaskId('tpl-training', '2026-09-07'))).toBe(false)
    expect(entfernt.has(templateTaskId('tpl-training', '2026-09-28'))).toBe(false)
  })

  it('räumt auf, wenn der Wochentag der Vorlage wechselt', () => {
    // Montag -> Freitag: die Montagsaufgaben gehören nicht mehr dazu.
    const plan = abgleich({ templates: [tpl({ weekday: 5 })], tasks: bestand })
    expect(plan.entfernen.every((e) => e.grund === 'tag-passt-nicht')).toBe(true)
    expect(plan.anlegen.map((a) => a.values.scheduled_on))
      .toEqual(['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09'])
  })

  it('räumt Doppelte aus der Zeit vor den wiederholbaren IDs ab', () => {
    const a = task({ id: 'alt-zufaellig-1', scheduled_on: '2026-09-21', scheduled_time: '18:00' })
    const b = task({ id: 'alt-zufaellig-2', scheduled_on: '2026-09-21', scheduled_time: '18:00' })
    const plan = abgleich({ tasks: [a, b] })
    expect(plan.entfernen).toEqual([{ id: 'alt-zufaellig-2', titel: 'Training', grund: 'doppelt' }])
    expect(plan.anlegen.map((x) => x.values.scheduled_on)).not.toContain('2026-09-21')
  })
})

/* ------------------------------------------------------- Zwei Geräte */

describe('Zwei Geräte erzeugen dieselbe Zeile, nicht zwei', () => {
  it('vergibt für dieselbe Vorlage am selben Tag dieselbe ID', () => {
    expect(templateTaskId('tpl-training', '2026-09-21'))
      .toBe(templateTaskId('tpl-training', '2026-09-21'))
  })

  it('vergibt für verschiedene Tage und Vorlagen verschiedene IDs', () => {
    const ids = new Set([
      templateTaskId('tpl-training', '2026-09-21'),
      templateTaskId('tpl-training', '2026-09-22'),
      templateTaskId('tpl-lauf', '2026-09-21'),
    ])
    expect(ids.size).toBe(3)
  })

  it('verwechselt Aufgabe und Buchung nicht, auch bei gleichen Bestandteilen', () => {
    expect(templateTaskId('abc', '2026-09-21')).not.toBe(recurringBookingId('abc', '2026-09-21'))
  })

  it('erzeugt eine gültige UUID-Form', () => {
    expect(stableId('test', 'a', 'b'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('legt nichts an, was die Datenbank unter dieser ID schon kennt', () => {
    // Der Fall: Das andere Gerät hat es gerade angelegt, der Abgleich hat die
    // Zeile schon gebracht, die Aufgabenliste im Speicher ist aber noch alt.
    const bekannt = new Set([templateTaskId('tpl-training', '2026-09-21')])
    const plan = abgleich({ exists: (id) => bekannt.has(id) })
    expect(plan.anlegen.map((a) => a.values.scheduled_on)).not.toContain('2026-09-21')
    expect(plan.anlegen).toHaveLength(3)
  })
})

/* -------------------------------------------------- Wiederkehrende Zahlungen */

function regel(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    ...basis, id: 'r-miete', kind: 'transaction', title: 'Miete',
    rrule: buildRRule({ freq: 'MONTHLY', byMonthDay: [1] }),
    starts_on: '2026-07-01', ends_on: null,
    template_json: JSON.stringify({ type: 'expense', amount_cents: 2000, account_id: 'k1' }),
    auto_book: 1, lead_days: 5, last_generated_on: null, is_active: 1, ...over,
  }
}

describe('Wiederkehrende Zahlungen buchen sich selbst', () => {
  it('bucht jede fällige Zahlung, ohne dass jemand bestätigt', () => {
    const f = duePayments({ rules: [regel()], transactions: [], today: '2026-09-14' })
    expect(f.map((x) => x.day)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(f[0].values.amount_cents).toBe(2000)
    expect(f[0].values.status).toBe('booked')
    expect(f[0].values.recurring_id).toBe('r-miete')
  })

  it('bucht nichts doppelt, wenn die Buchung schon existiert', () => {
    const vorhanden = [{ recurring_id: 'r-miete', booked_on: '2026-08-01', deleted_at: null }]
    const f = duePayments({ rules: [regel()], transactions: vorhanden, today: '2026-09-14' })
    expect(f.map((x) => x.day)).toEqual(['2026-07-01', '2026-09-01'])
  })

  it('vergibt geräteübergreifend dieselbe ID für dieselbe Fälligkeit', () => {
    const a = duePayments({ rules: [regel()], transactions: [], today: '2026-09-14' })
    const b = duePayments({ rules: [regel()], transactions: [], today: '2026-09-14' })
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id))
    expect(a[0].id).toBe(recurringBookingId('r-miete', '2026-07-01'))
  })

  it('holt eine von Hand gelöschte automatische Buchung nicht zurück', () => {
    const geloescht = new Set([recurringBookingId('r-miete', '2026-08-01')])
    const f = duePayments({
      rules: [regel()], transactions: [], today: '2026-09-14',
      exists: (id) => geloescht.has(id),
    })
    expect(f.map((x) => x.day)).toEqual(['2026-07-01', '2026-09-01'])
  })

  it('bucht nichts mehr aus einer gelöschten oder pausierten Regel', () => {
    expect(duePayments({ rules: [regel({ deleted_at: 'weg' })], transactions: [], today: '2026-09-14' })).toHaveLength(0)
    expect(duePayments({ rules: [regel({ is_active: 0 })], transactions: [], today: '2026-09-14' })).toHaveLength(0)
  })
})

describe('Bestandsschutz: gebuchte Zahlungen bleiben, wie sie waren', () => {
  it('ändert historische Buchungen nicht, wenn der Betrag der Vorlage steigt', () => {
    // Drei Zahlungen zu 20 € sind gebucht, danach steigt die Vorlage auf 25 €.
    const gebucht = [
      { recurring_id: 'r-abo', booked_on: '2026-07-01', deleted_at: null },
      { recurring_id: 'r-abo', booked_on: '2026-08-01', deleted_at: null },
      { recurring_id: 'r-abo', booked_on: '2026-09-01', deleted_at: null },
    ]
    const neueRegel = regel({
      id: 'r-abo', title: 'Abo',
      template_json: JSON.stringify({ type: 'expense', amount_cents: 2500, account_id: 'k1' }),
    })
    const f = duePayments({ rules: [neueRegel], transactions: gebucht, today: '2026-09-14' })

    // Nichts Fälliges mehr offen – und vor allem: keine Anweisung, die
    // vorhandenen Buchungen anzufassen. duePayments legt ausschließlich NEUE
    // Buchungen an; die drei alten bleiben unberührt bei 20 €.
    expect(f).toHaveLength(0)

    // Die nächste Fälligkeit nach der Änderung nimmt dann den neuen Betrag.
    const oktober = duePayments({ rules: [neueRegel], transactions: gebucht, today: '2026-10-05' })
    expect(oktober.map((x) => x.day)).toEqual(['2026-10-01'])
    expect(oktober[0].values.amount_cents).toBe(2500)
  })

  it('erzeugt nach dem Löschen der Vorlage nichts Neues mehr', () => {
    const gebucht = [{ recurring_id: 'r-abo', booked_on: '2026-09-01', deleted_at: null }]
    const f = duePayments({
      rules: [regel({ id: 'r-abo', deleted_at: 'weg' })],
      transactions: gebucht, today: '2026-10-05',
    })
    expect(f).toHaveLength(0)
    // Die vorhandene Buchung steht weiterhin in der Liste, die hineingegeben
    // wurde – gelöscht wird sie von dieser Seite aus nie.
    expect(gebucht).toHaveLength(1)
  })
})
