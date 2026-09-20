/**
 * Die Nacht als Tageswert – damit Ziele und Zusammenhänge sie sehen.
 *
 * ---------------------------------------------------------------------------
 * Warum beides nebeneinander steht
 *
 * `sleep_sessions` hält die Nacht selbst: wann sie begann, wie lange sie
 * dauerte, wie sie sich auf die Phasen verteilte. Die Metrik `sleep_h` hält
 * eine einzige Zahl je Tag – und an ihr hängt alles, was LifeHub mit Zahlen
 * anstellt: Eriks Zielbereich (7–9 h), der Verlauf, die Zusammenhangsrechnung
 * gegen Haut, Training und Ernährung.
 *
 * Beides zu vereinen hieße, eines davon zu verschlechtern: Entweder verlöre
 * die Nacht ihre Struktur, oder die Zusammenhangsrechnung müsste eine
 * Sonderbehandlung für Schlaf bekommen. Deshalb wird der Tageswert aus der
 * Nacht MITGEFÜHRT, und die Nacht bleibt die Quelle.
 *
 * ---------------------------------------------------------------------------
 * Warum das ohne Endlosschleife geht
 *
 * Die Automatik läuft nach jeder Datenänderung erneut, und diese Funktion
 * schreibt Daten. Das endet nur, weil der zweite Durchlauf nichts mehr
 * findet: Es wird ausschließlich das gemeldet, was sich beim Vergleich
 * wirklich unterscheidet – auf zwei Nachkommastellen gerundet, damit
 * Fließkommarauschen keinen Unterschied erzeugt, den es nicht gibt.
 *
 * Ein Wert, den Erik von Hand eingetragen hat, wird NICHT überschrieben.
 * Die Messung der Uhr ist nicht mehr wert als das, was er selbst notiert hat.
 */
import type { Metric, MetricEntry, SleepSession } from './types'
import type { DayString } from './dates'

/** Woran ein aus einer Nacht mitgeführter Tageswert zu erkennen ist. */
export const SCHLAF_QUELLE = 'sleep_session'

export interface SchlafwertAenderung {
  day: DayString
  stunden: number
  /** Gesetzt, wenn ein mitgeführter Eintrag schon da ist und nur nachzieht. */
  entryId?: string
}

/** Minuten in Stunden, auf zwei Nachkommastellen – 7 h 42 min → 7,7. */
export function stundenAusMinuten(minuten: number): number {
  return Math.round((minuten / 60) * 100) / 100
}

/**
 * Welche Tageswerte nachgezogen werden müssen.
 *
 * Leere Liste heißt: alles stimmt schon. Genau das ist der Normalfall und der
 * Grund, warum die Automatik zur Ruhe kommt.
 */
export function planeSchlafwerte(
  sitzungen: SleepSession[],
  metrik: Metric | null | undefined,
  eintraege: MetricEntry[],
): SchlafwertAenderung[] {
  if (!metrik) return []

  // Je Tag der vorhandene Eintrag - getrennt danach, ob er mitgefuehrt oder
  // von Hand ist. Von Hand gewinnt immer.
  const mitgefuehrt = new Map<string, MetricEntry>()
  const vonHand = new Set<string>()
  for (const e of eintraege) {
    if (e.deleted_at || e.metric_id !== metrik.id) continue
    if (e.source === SCHLAF_QUELLE) mitgefuehrt.set(e.day, e)
    else vonHand.add(e.day)
  }

  const out: SchlafwertAenderung[] = []
  for (const s of sitzungen) {
    if (s.deleted_at || !s.day) continue
    if (vonHand.has(s.day)) continue
    const stunden = stundenAusMinuten(s.duration_min ?? 0)
    if (!(stunden > 0)) continue
    const da = mitgefuehrt.get(s.day)
    if (da && Math.round((da.value_num ?? 0) * 100) / 100 === stunden) continue
    out.push({ day: s.day, stunden, entryId: da?.id })
  }
  return out
}
