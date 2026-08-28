/**
 * Einheitliches Zielsystem: finanziell, körperlich, Gewohnheit, Projekt.
 * Ein Fortschrittsmodell für alle Zielarten.
 */
import type { Goal } from './types'
import { type DayString, diffDays, todayString } from './dates'

export interface GoalProgress {
  goal: Goal
  current: number
  start: number
  target: number
  percent: number
  remaining: number
  daysLeft: number | null
  neededPerMonth: number | null
  projectedDate: DayString | null
  pace: 'ahead' | 'on_track' | 'behind' | 'unknown'
  reached: boolean
}

/**
 * Farbe des Fortschrittsbalkens.
 * Verlauf von Dunkelrot über Orange und Gelb nach Grün – der Balken sagt
 * damit auf einen Blick, wie weit ein Ziel ist, ohne dass man die Zahl liest.
 */
export function progressColor(percent: number): string {
  const p = Math.min(100, Math.max(0, percent))
  if (p >= 100) return 'var(--good)'
  if (p >= 80) return '#3faf3f'
  if (p >= 60) return '#8bb61c'
  if (p >= 45) return '#c9a41a'
  if (p >= 30) return '#e08a1e'
  if (p >= 15) return '#d1591f'
  return '#a52222'
}

export function goalProgress(
  goal: Goal,
  currentValue: number,
  today: DayString = todayString(),
): GoalProgress {
  // Prozent-Ziele führen ihren Fortschritt direkt – ohne Start- und Zielwert.
  if (goal.goal_kind === 'percent') {
    const percent = Math.min(100, Math.max(0, goal.progress_percent ?? 0))
    const daysLeftP = goal.target_on ? diffDays(today, goal.target_on) : null
    const daysElapsedP = Math.max(1, diffDays(goal.start_on, today))
    let paceP: GoalProgress['pace'] = 'unknown'
    if (goal.target_on) {
      const totalDays = Math.max(1, diffDays(goal.start_on, goal.target_on))
      const expected = clamp((daysElapsedP / totalDays) * 100, 0, 100)
      paceP = percent >= expected + 5 ? 'ahead' : percent >= expected - 5 ? 'on_track' : 'behind'
    }
    return {
      goal, current: percent, start: 0, target: 100, percent,
      remaining: 100 - percent, daysLeft: daysLeftP, neededPerMonth: null,
      projectedDate: null, pace: paceP, reached: percent >= 100,
    }
  }
  const start = goal.start_value ?? 0
  const target = goal.target_value ?? 0
  const span = target - start
  const done = currentValue - start
  const percent = span === 0 ? (currentValue >= target ? 100 : 0) : clamp(Math.round((done / span) * 1000) / 10, 0, 999)
  const remaining = target - currentValue

  const daysLeft = goal.target_on ? diffDays(today, goal.target_on) : null
  const daysElapsed = Math.max(1, diffDays(goal.start_on, today))
  const perDay = done / daysElapsed
  const neededPerMonth =
    daysLeft && daysLeft > 0 ? Math.round((remaining / daysLeft) * 30.4) : null

  let projectedDate: DayString | null = null
  if (perDay > 0 && remaining > 0) {
    const daysNeeded = Math.ceil(remaining / perDay)
    if (daysNeeded < 3650) {
      const d = new Date(today)
      d.setDate(d.getDate() + daysNeeded)
      projectedDate = d.toISOString().slice(0, 10)
    }
  }

  let pace: GoalProgress['pace'] = 'unknown'
  if (goal.target_on) {
    const totalDays = Math.max(1, diffDays(goal.start_on, goal.target_on))
    const expectedPercent = clamp((daysElapsed / totalDays) * 100, 0, 100)
    if (percent >= expectedPercent + 5) pace = 'ahead'
    else if (percent >= expectedPercent - 5) pace = 'on_track'
    else pace = 'behind'
  }

  return {
    goal, current: currentValue, start, target, percent, remaining,
    daysLeft, neededPerMonth, projectedDate, pace,
    reached: span >= 0 ? currentValue >= target : currentValue <= target,
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function paceLabel(pace: GoalProgress['pace']): string {
  switch (pace) {
    case 'ahead': return 'über Plan'
    case 'on_track': return 'im Plan'
    case 'behind': return 'hinter Plan'
    default: return 'kein Zieldatum'
  }
}
