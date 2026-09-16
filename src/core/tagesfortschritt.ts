/**
 * Fortschritt statt Urteil, solange der Tag noch läuft.
 *
 * Nach dem Frühstück stehen 400 kcal von 2.450 da. Mit Zielbereichen bewertet
 * heißt das „außerhalb" – rot, um neun Uhr morgens, für einen völlig normalen
 * Tag. Eine Tagessumme lässt sich erst sinnvoll bewerten, wenn der Tag im
 * Wesentlichen vorbei ist.
 *
 * Deshalb gilt für Werte, die sich über den Tag aufsummieren (Kalorien,
 * Makros, Ballaststoffe, Wasser):
 *
 *   heute, vor BEWERTUNG_AB_STUNDE   Fortschritt zum Ziel, neutral gefärbt
 *   heute, ab BEWERTUNG_AB_STUNDE    Zielbereich mit Statusfarbe
 *   vergangene Tage                  Zielbereich mit Statusfarbe
 *
 * Werte, die nicht summiert werden (Gewicht, Schlaf, Befinden), stehen nach dem
 * Eintragen fest und werden sofort bewertet.
 */
import type { DayString } from './dates'

/** Ab dieser Stunde gilt der heutige Tag als „im Wesentlichen gegessen". */
export const BEWERTUNG_AB_STUNDE = 20

export function tagIstAbgeschlossen(day: DayString, heute: DayString, stunde: number): boolean {
  if (day < heute) return true
  if (day > heute) return false
  return stunde >= BEWERTUNG_AB_STUNDE
}

/**
 * Darf dieser Wert an diesem Tag schon mit Statusfarben bewertet werden?
 * `aggregation` ist die des Trackingwerts ('sum', 'last', 'avg').
 */
export function darfBewerten(aggregation: string | null | undefined, day: DayString, heute: DayString, stunde: number): boolean {
  if (aggregation !== 'sum') return true
  return tagIstAbgeschlossen(day, heute, stunde)
}

/** Anteil am Tagesziel in Prozent, gerundet. Ohne Ziel oder Wert: null. */
export function fortschrittProzent(wert: number | null, ziel: number | null | undefined): number | null {
  if (wert === null || !ziel || ziel <= 0) return null
  return Math.round((wert / ziel) * 100)
}
