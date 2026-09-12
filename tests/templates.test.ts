/**
 * Wann eine Aufgabenvorlage an einem Tag überhaupt gilt.
 *
 * Hier geht es nur um die Auswahl der Tage – Wochentag, Tagesart, Rhythmus.
 * Was danach mit den Aufgaben passiert (nachziehen, aufräumen, nicht doppeln),
 * steht in automation.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { reconcileTemplateTasks } from '../src/core/automation'
import type { TaskTemplate } from '../src/core/types'

const base = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null, version: 1, last_device_id: 't', server_rev: null,
}

function tpl(over: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    ...base, id: 'tpl1', title: 'Auto putzen', description: null,
    duration_minutes: 45, priority: 2, weekday: 2, day_type_id: 'spaet',
    interval_weeks: 1, anchor_date: null, is_active: 1, last_generated_on: null,
    scheduled_time: null, ...over,
  }
}

// August 2026: 4. = Dienstag, 11. = Dienstag, 18. = Dienstag, 25. = Dienstag
const assignments = [
  { day: '2026-08-04', day_type_id: 'spaet' },
  { day: '2026-08-11', day_type_id: 'frueh' },
  { day: '2026-08-18', day_type_id: 'spaet' },
]

/** Die Tage, an denen laut Vorlage etwas entstehen soll. */
function tage(templates: TaskTemplate[], von = '2026-08-01', tageVoraus = 30): string[] {
  return reconcileTemplateTasks({
    templates, assignments, tasks: [], today: von, horizonDays: tageVoraus,
  }).anlegen.map((a) => a.values.scheduled_on)
}

describe('Aufgabenvorlagen', () => {
  it('erzeugt nur an passendem Wochentag UND passender Tagesart', () => {
    const plan = reconcileTemplateTasks({
      templates: [tpl()], assignments, tasks: [], today: '2026-08-01', horizonDays: 30,
    })
    expect(plan.anlegen.map((a) => a.values.scheduled_on)).toEqual(['2026-08-04', '2026-08-18'])
    expect(plan.anlegen[0].values.title).toBe('Auto putzen')
    expect(plan.anlegen[0].values.duration_minutes).toBe(45)
  })

  it('ignoriert die Tagesart, wenn keine gefordert ist', () => {
    expect(tage([tpl({ day_type_id: null })]))
      .toEqual(['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25'])
  })

  it('legt nichts doppelt an', () => {
    const vorhanden = [{
      id: 'schon-da', template_id: 'tpl1', scheduled_on: '2026-08-04',
      scheduled_time: null, title: 'Auto putzen', description: null,
      duration_minutes: 45, priority: 2, status: 'open' as const, deleted_at: null,
    }]
    const plan = reconcileTemplateTasks({
      templates: [tpl()], assignments, tasks: vorhanden, today: '2026-08-01', horizonDays: 30,
    })
    expect(plan.anlegen.map((a) => a.values.scheduled_on)).toEqual(['2026-08-18'])
    expect(plan.aendern).toHaveLength(0)
  })

  it('beachtet einen Zwei-Wochen-Rhythmus', () => {
    expect(tage([tpl({ day_type_id: null, interval_weeks: 2, anchor_date: '2026-08-04' })]))
      .toEqual(['2026-08-04', '2026-08-18'])
  })

  it('erzeugt nichts für inaktive oder gelöschte Vorlagen', () => {
    expect(tage([tpl({ is_active: 0 })])).toHaveLength(0)
    expect(tage([tpl({ deleted_at: 'x' })])).toHaveLength(0)
  })

  it('erzeugt an jedem Tag, wenn kein Wochentag gesetzt ist', () => {
    expect(tage([tpl({ weekday: null, day_type_id: null })], '2026-08-01', 3))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
  })
})
