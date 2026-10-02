/**
 * Was als Turneinheit zählt – an einer Stelle.
 *
 * ---------------------------------------------------------------------------
 * Warum es diese Datei gibt
 *
 * Seit Phase 3B steht in `workout_sessions` beides: absolvierte Einheiten und
 * **geplante Termine in der Zukunft**. Dieselbe Tabelle, unterschieden allein
 * durch `status`. Das ist richtig so – zwei Tabellen für „Training" wären eine
 * zweite Kalenderstruktur.
 *
 * Es macht aber jede Kennzahl zu einer Entscheidung, und diese Entscheidung
 * darf nicht an drei Bildschirmen dreimal getroffen werden. Genau daran ist
 * „Letzte Einheit" aufgefallen: Der Bildschirm sortierte nach Datum absteigend
 * und nahm den ersten – seit es geplante Termine gibt, stand dort ein
 * Training, das erst noch stattfindet.
 *
 * ---------------------------------------------------------------------------
 * Die Festlegung
 *
 * **Absolviert** ist eine Einheit, wenn sie stattgefunden hat: Ihr Tag liegt
 * bis einschliesslich heute, und ihr Status sagt nicht das Gegenteil.
 * `planned` (steht noch aus), `skipped` (ausgefallen) und `rest` (Ruhetag)
 * sagen das Gegenteil.
 *
 * Der Tag wird **örtlich** verglichen, über die vorhandenen Datumshelfer:
 * Kalendertage sind in LifeHub Zeichenketten `YYYY-MM-DD`, und der Vergleich
 * zweier solcher Zeichenketten ist derselbe wie der ihrer Kalendertage. Ein
 * `new Date()` käme hier nur in die Nähe der Zeitzone.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import { todayString } from '../dates'

/** Der Wert in `workout_sessions.discipline`, der eine Turneinheit kennzeichnet. */
export const DISZIPLIN_TURNEN = 'turnen'

/**
 * Die Disziplinen, die der allgemeine Trainingseditor anbietet.
 *
 * `null` ist kein Versehen, sondern der Bestand vor Migration 14 und der
 * Normalfall für alles, was kein Turnen ist – eine Einheit ohne Kennzeichen
 * ist keine Lücke (siehe `WorkoutSession.discipline` in core/types.ts).
 */
export const DISZIPLINEN: { wert: string | null; label: string }[] = [
  { wert: null, label: 'Ohne Zuordnung' },
  { wert: DISZIPLIN_TURNEN, label: 'Turnen' },
]

/** Zustände, die ausdrücklich bedeuten: an diesem Tag wurde nicht trainiert. */
export const NICHT_ABSOLVIERT = ['planned', 'skipped', 'rest'] as const

/** Das Wenige, das eine Einheit für diese Entscheidungen mitbringen muss. */
export interface EinheitAuswahl {
  day: DayString
  status: string
  discipline: string | null
  deleted_at: string | null
}

/** Eine Turneinheit – gelöschte zählen nirgends mit. */
export function istTurnen(s: EinheitAuswahl): boolean {
  return !s.deleted_at && s.discipline === DISZIPLIN_TURNEN
}

/**
 * Hat diese Einheit stattgefunden?
 *
 * Zwei Bedingungen, und die zweite ist die, die gefehlt hat: Ein Datum in der
 * Zukunft ist keine vergangene Aktivität – auch dann nicht, wenn jemand die
 * Einheit versehentlich als „absolviert" mit morgigem Datum angelegt hat.
 */
export function istAbsolviert(s: EinheitAuswahl, heute: DayString = todayString()): boolean {
  if (s.deleted_at) return false
  if ((NICHT_ABSOLVIERT as readonly string[]).includes(s.status)) return false
  return s.day <= heute
}

/**
 * Die absolvierten Turneinheiten – neueste zuerst.
 *
 * Diese Reihenfolge ist Teil der Zusage: `[0]` IST die letzte Einheit, und
 * `length` ist „Einheiten gesamt". Wer beides getrennt ausrechnet, bekommt
 * irgendwann zwei verschiedene Antworten.
 */
export function absolvierteTurneinheiten<T extends EinheitAuswahl>(
  alle: T[], heute: DayString = todayString(),
): T[] {
  return alle
    .filter((s) => istTurnen(s) && istAbsolviert(s, heute))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/** Die neueste tatsächlich absolvierte Turneinheit, oder `null`. */
export function letzteTurneinheit<T extends EinheitAuswahl>(
  alle: T[], heute: DayString = todayString(),
): T | null {
  return absolvierteTurneinheiten(alle, heute)[0] ?? null
}

/**
 * Die geplanten Turntermine – ältester zuerst.
 *
 * Auch vergangene: Ein Termin, dessen Tag vorbei ist, ohne dass Training
 * erfasst wurde, ist überfällig und nicht etwa erledigt. Wer nur die
 * kommenden will, schneidet selbst ab – die Wochenplanung tut genau das
 * (`wochenplanung.ts`).
 */
export function geplanteTurntermine<T extends EinheitAuswahl>(alle: T[]): T[] {
  return alle
    .filter((s) => istTurnen(s) && s.status === 'planned')
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}
