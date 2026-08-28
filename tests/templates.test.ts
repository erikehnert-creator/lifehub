import { describe, it, expect } from 'vitest'
import { planTasksFromTemplates } from '../src/core/planner'
import type { TaskTemplate } from '../src/core/types'

const base = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null, version: 1, last_device_id: 't', server_rev: null,
}

function tpl(over: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    ...base, id: 'tpl1', title: 'Auto putzen', description: null,
    duration_minutes: 45, priority: 2, weekday: 2, day_type_id: 'spaet',
    interval_weeks: 1, anchor_date: null, is_active: 1, last_generated_on: null, ...over,
  }
}

// August 2026: 4. = Dienstag, 11. = Dienstag, 18. = Dienstag
const assignments = [
  { day: '2026-08-04', day_type_id: 'spaet' },
  { day: '2026-08-11', day_type_id: 'frueh' },
  { day: '2026-08-18', day_type_id: 'spaet' },
]

describe('Aufgabenvorlagen', () => {
  it('erzeugt nur an passendem Wochentag UND passender Tagesart', () => {
    const out = planTasksFromTemplates([tpl()], assignments, [], '2026-08-01', '2026-08-31')
    expect(out.map((o) => o.day)).toEqual(['2026-08-04', '2026-08-18'])
    expect(out[0].title).toBe('Auto putzen')
    expect(out[0].duration_minutes).toBe(45)
  })

  it('ignoriert die Tagesart, wenn keine gefordert ist', () => {
    const out = planTasksFromTemplates([tpl({ day_type_id: null })], assignments, [], '2026-08-01', '2026-08-31')
    expect(out.map((o) => o.day)).toEqual(['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25'])
  })

  it('legt nichts doppelt an', () => {
    const existing = [{ template_id: 'tpl1', scheduled_on: '2026-08-04', deleted_at: null }]
    const out = planTasksFromTemplates([tpl()], assignments, existing, '2026-08-01', '2026-08-31')
    expect(out.map((o) => o.day)).toEqual(['2026-08-18'])
  })

  it('beachtet einen Zwei-Wochen-Rhythmus', () => {
    const out = planTasksFromTemplates(
      [tpl({ day_type_id: null, interval_weeks: 2, anchor_date: '2026-08-04' })],
      assignments, [], '2026-08-01', '2026-08-31',
    )
    expect(out.map((o) => o.day)).toEqual(['2026-08-04', '2026-08-18'])
  })

  it('erzeugt nichts für inaktive oder gelöschte Vorlagen', () => {
    expect(planTasksFromTemplates([tpl({ is_active: 0 })], assignments, [], '2026-08-01', '2026-08-31')).toHaveLength(0)
    expect(planTasksFromTemplates([tpl({ deleted_at: 'x' })], assignments, [], '2026-08-01', '2026-08-31')).toHaveLength(0)
  })
})
