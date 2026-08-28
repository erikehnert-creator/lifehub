import type { Goal } from '../core/types'
import type { AppData } from '../state/store'
import { dayValue } from '../core/metrics'
import { todayString } from '../core/dates'
import { toEuro } from '../core/money'

/** Ist-Wert eines Ziels – je nach Zielart aus Konto, Metrik oder manuell. */
export function currentValueForGoal(goal: Goal, data: AppData, balances: Map<string, number>): number {
  if (goal.goal_kind === 'percent') return goal.progress_percent ?? 0
  if (goal.goal_kind === 'amount' && goal.target_account_id) {
    return toEuro(balances.get(goal.target_account_id) ?? 0)
  }
  if (goal.goal_kind === 'metric_target' && goal.metric_id) {
    const metric = data.metrics.find((m) => m.id === goal.metric_id)
    if (!metric) return goal.manual_current ?? 0
    // letzten vorhandenen Wert suchen
    const entries = data.metricEntries
      .filter((e) => !e.deleted_at && e.metric_id === metric.id && e.value_num !== null)
      .sort((a, b) => (a.day < b.day ? 1 : -1))
    return entries.length ? entries[0].value_num! : (goal.start_value ?? 0)
  }
  if (goal.goal_kind === 'count') {
    return goal.manual_current ?? 0
  }
  return goal.manual_current ?? 0
}
