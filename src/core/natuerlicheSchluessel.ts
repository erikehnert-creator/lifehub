/**
 * Tabellen mit einem natürlichen Schlüssel – und was daraus folgt.
 *
 * ---------------------------------------------------------------------------
 * Das Problem
 *
 * Vier Tabellen haben neben der ID noch einen zweiten eindeutigen Wert:
 *
 *   settings          key    („layout_prefs", „fatsecret_import" …)
 *   metrics           key    („calories", „fiber_g" …)
 *   day_assignments   day    genau eine Tagesart je Tag
 *   day_notes         day    genau eine Notiz je Tag
 *
 * Lokal steht das als UNIQUE im Schema. Auf dem Server steht es NICHT – dort
 * ist nur die ID eindeutig. Legen PC und Handy dieselbe Sache unabhängig
 * voneinander an (jedes mit einer eigenen Zufalls-ID), nimmt der Server beide
 * an. Beim nächsten Abgleich holt sich jedes Gerät die fremde Zeile, und
 * SQLite löst den UNIQUE-Konflikt auf seine Weise: `INSERT OR REPLACE` LÖSCHT
 * die vorhandene Zeile und setzt die neue an ihre Stelle. Ohne Fehler, ohne
 * Meldung.
 *
 * Genau das ist mit den Ballaststoffen passiert. Die Metrik `fiber_g` kam am
 * 13.09.2026 dazu – in derselben Fassung, in der ein Sortierwert von 23.5 den
 * Abgleich der Tabelle `metrics` zum Stehen brachte (siehe Migration 9). Bis
 * das behoben war, hatten PC und Handy jeweils ihre eigene Ballaststoff-Metrik
 * angelegt und ihre Tageswerte darauf geschrieben. Danach lief der Abgleich
 * wieder, beide Metriken erreichten den Server, und jedes Gerät ersetzte seine
 * eigene durch die fremde. Zurück blieben Tageswerte, die auf eine Metrik
 * zeigten, die es nicht mehr gab: geschrieben, gespeichert, synchronisiert –
 * und nirgends sichtbar.
 *
 * ---------------------------------------------------------------------------
 * Die Abhilfe
 *
 * Die ID wird aus dem natürlichen Schlüssel abgeleitet, statt gewürfelt zu
 * werden (siehe core/ids.ts, stableId). Dann erzeugen PC und Handy für
 * „Ballaststoffe" oder „Notiz vom 14.09." dieselbe ID, der Server führt sie
 * über den Primärschlüssel zusammen, und es kann gar nicht erst zwei geben.
 *
 * Für Zeilen, die vor dieser Änderung entstanden sind, hilft das nicht mehr –
 * die haben ihre Zufalls-ID schon. Dafür gibt es `entscheideKollision()`: Wenn
 * beim Abgleich zwei Zeilen mit demselben natürlichen Schlüssel aufeinander
 * treffen, wird nach einer festen Regel entschieden, welche bleibt. Fest,
 * damit PC und Handy unabhängig voneinander zum selben Ergebnis kommen und
 * nicht abwechselnd die jeweils andere zur Siegerin erklären.
 *
 * Hier steht nur das Entscheiden – ohne Datenbank, dadurch prüfbar. Angewandt
 * wird es in db/repo.ts (beim Anlegen) und sync/engine.ts (beim Holen).
 */
import { stableId } from './ids'

/** Tabelle → Spalte, die neben der ID eindeutig ist. */
export const NATUERLICHER_SCHLUESSEL: Record<string, string> = {
  settings: 'key',
  metrics: 'key',
  day_assignments: 'day',
  day_notes: 'day',
}

/**
 * Die ID, die sich aus dem natürlichen Schlüssel ergibt.
 *
 * `null`, wenn die Tabelle keinen hat oder der Wert fehlt – dann bleibt es
 * bei einer gewöhnlichen Zufalls-ID.
 */
export function natuerlicheId(table: string, zeile: Record<string, any>): string | null {
  const feld = NATUERLICHER_SCHLUESSEL[table]
  if (!feld) return null
  const wert = zeile?.[feld]
  if (wert === null || wert === undefined || wert === '') return null
  return stableId('natuerlicher-schluessel', table, String(wert))
}

/**
 * Bei welchen Tabellen darf der Schlüssel einer aufgelösten Dublette
 * umbenannt werden?
 *
 * Nur dort, wo er technisch ist. `metrics.key` und `settings.key` sind
 * Bezeichner, die niemand liest – eine aufgelöste Zeile kann deshalb einen
 * abgewandelten Schlüssel bekommen und als gelöscht weiterleben, bis der
 * Server sie ebenfalls als gelöscht kennt. Bei `day_assignments.day` und
 * `day_notes.day` steht dort ein Datum: echter Inhalt, der nicht verbogen
 * werden darf.
 */
export const SCHLUESSEL_UMBENENNBAR: Record<string, boolean> = {
  settings: true,
  metrics: true,
  day_assignments: false,
  day_notes: false,
}

/** Der Schlüssel, unter dem eine aufgelöste Dublette abgelegt wird. */
export function aufgeloesterSchluessel(schluessel: string, id: string): string {
  return `${schluessel}#dublette-${id.slice(0, 8)}`
}

/** Ist das ein Schlüssel, der aus einer aufgelösten Dublette stammt? */
export function istAufgeloest(schluessel: string): boolean {
  return /#dublette-/.test(schluessel ?? '')
}

export interface Kollision {
  /** Die ID, die bleibt. */
  bleibt: string
  /** Die ID, die aufgelöst wird. */
  weicht: string
}

/**
 * Welche von zwei Zeilen mit demselben natürlichen Schlüssel bleibt.
 *
 * Die kleinere ID gewinnt. Das ist keine inhaltliche Aussage – es gibt keine –
 * sondern eine, die auf jedem Gerät gleich ausfällt. Eine Regel wie „die
 * ältere" oder „die mit mehr Einträgen" wäre inhaltlich hübscher, hinge aber
 * an Daten, die die Geräte im Moment der Entscheidung unterschiedlich sehen
 * können; dann erklärt der PC die eine zur Siegerin, das Handy die andere, und
 * die beiden schieben sich die Zeile gegenseitig hin und her.
 *
 * Was an der weichenden Zeile hängt, geht dabei nicht verloren: Die
 * aufrufende Stelle hängt es vorher um (siehe sync/engine.ts).
 */
export function entscheideKollision(a: string, b: string): Kollision {
  return a < b ? { bleibt: a, weicht: b } : { bleibt: b, weicht: a }
}

/**
 * Wohin Verweise zeigen, wenn eine Zeile aufgelöst wird.
 *
 * Nur `metrics` hat überhaupt Verweise auf sich – die Tageswerte und die
 * Zielbereiche. Fehlt hier eine Tabelle, zeigen deren Zeilen nach dem
 * Auflösen ins Leere und sind damit unsichtbar; genau das war der
 * Ballaststoff-Fehler. `tests/natuerliche-schluessel.test.ts` erinnert daran.
 */
export const VERWEISE_AUF: Record<string, { tabelle: string; feld: string }[]> = {
  metrics: [
    { tabelle: 'metric_entries', feld: 'metric_id' },
    { tabelle: 'metric_targets', feld: 'metric_id' },
  ],
  settings: [],
  day_assignments: [],
  day_notes: [],
}
