/**
 * Monatszählungen für die Analyse: wie viele Aufgaben wurden je Monat erledigt,
 * wie viele Trainingseinheiten absolviert. Reine Rechnung ohne Oberfläche, damit
 * sie getestet werden kann und der Bildschirm nur noch anzeigt.
 */
import type { Task, WorkoutSession } from './types'
import { monthOf } from './dates'

/** Erledigte Aufgaben je Monat, in der Reihenfolge von `monate` ("JJJJ-MM"). */
export function erledigteAufgabenJeMonat(
  aufgaben: Pick<Task, 'deleted_at' | 'completed_at'>[],
  monate: string[],
): { monat: string; anzahl: number }[] {
  const zaehler = new Map<string, number>()
  for (const t of aufgaben) {
    if (t.deleted_at || !t.completed_at) continue
    const monat = monthOf(t.completed_at.slice(0, 10))
    zaehler.set(monat, (zaehler.get(monat) ?? 0) + 1)
  }
  return monate.map((monat) => ({ monat, anzahl: zaehler.get(monat) ?? 0 }))
}

/** Absolvierte (nicht geplante, nicht gelöschte) Trainingseinheiten je Monat. */
export function trainingseinheitenJeMonat(
  einheiten: Pick<WorkoutSession, 'deleted_at' | 'status' | 'day'>[],
  monate: string[],
): { monat: string; anzahl: number }[] {
  const zaehler = new Map<string, number>()
  for (const s of einheiten) {
    if (s.deleted_at || s.status !== 'completed') continue
    const monat = monthOf(s.day)
    zaehler.set(monat, (zaehler.get(monat) ?? 0) + 1)
  }
  return monate.map((monat) => ({ monat, anzahl: zaehler.get(monat) ?? 0 }))
}
