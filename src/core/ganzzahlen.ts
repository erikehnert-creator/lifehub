/**
 * Werte, die SQLite durchlässt und PostgreSQL zurückweist.
 *
 * SQLite prüft Spaltentypen nicht. `sort_order INTEGER` ist dort eine Neigung,
 * kein Versprechen: Schreibt jemand 23.5 hinein, bleibt 23.5 stehen, und
 * `typeof()` sagt anschließend ehrlich `'real'`. PostgreSQL ist an derselben
 * Stelle streng und antwortet mit
 *
 *   22P02  invalid input syntax for type integer: "23.5"
 *
 * Das allein wäre halb so schlimm. Der Abgleich sendet eine Tabelle aber immer
 * als Ganzes, deshalb scheitert daran nicht die eine Zeile, sondern der Push
 * der kompletten Tabelle – und zwar bei jedem Versuch aufs Neue, während alle
 * anderen Tabellen unauffällig weiterlaufen. Genau so ist „Ballaststoffe" mit
 * Sortierwert 23.5 in Migration 8 wochenlang unbemerkt geblieben.
 *
 * Hier steht ausschließlich das Erkennen und Rechnen – kein Netzwerk, keine
 * Datenbank. Welche Spalten ganzzahlig sind, sagt SQLite selbst über
 * `pragma_table_info`; dadurch muss diese Liste nirgends doppelt gepflegt
 * werden und stimmt auch für Spalten, die es heute noch gar nicht gibt.
 */

/** Eine Zeile aus `pragma_table_info(<tabelle>)`. */
export interface SpaltenInfo {
  name: string
  type: string
}

/**
 * Die Spalten, die SQLite als ganzzahlig führt.
 *
 * Nur echtes INTEGER, nicht alles mit Integer-Neigung: `REAL`, `NUMERIC` und
 * `DOUBLE PRECISION` dürfen Nachkommastellen haben, und auf der Serverseite
 * stehen dort `double precision` bzw. `numeric`. Die mit `_` beginnenden
 * Spalten bleiben ohnehin auf dem Gerät und erreichen den Server nie.
 */
export function ganzzahlSpalten(info: SpaltenInfo[]): string[] {
  return info
    .filter((s) => !s.name.startsWith('_'))
    .filter((s) => /^INTEGER$/i.test(String(s.type ?? '').trim()))
    .map((s) => s.name)
}

export interface GebrochenerWert {
  spalte: string
  wert: number
  /** Was stattdessen gesendet werden kann, ohne die Reihenfolge zu drehen. */
  ganz: number
}

/**
 * Die Werte einer Zeile, die in einer ganzzahligen Spalte stehen, aber keine
 * ganze Zahl sind.
 *
 * `null` ist in Ordnung – eine leere Spalte ist kein Typfehler. Text ebenso:
 * SQLite gibt Zahlen je nach Weg mal als Zahl, mal als Zeichenkette zurück,
 * und `'23'` ist für PostgreSQL eine gültige Ganzzahl. Beanstandet wird nur,
 * was sich als Zahl lesen lässt und dabei einen Rest hat.
 */
export function gebrocheneWerte(
  zeile: Record<string, unknown>,
  spalten: string[],
): GebrochenerWert[] {
  const out: GebrochenerWert[] = []
  for (const spalte of spalten) {
    const roh = zeile[spalte]
    if (roh === null || roh === undefined || roh === '') continue
    const zahl = typeof roh === 'number' ? roh : Number(roh)
    if (!Number.isFinite(zahl) || Number.isInteger(zahl)) continue
    out.push({ spalte, wert: zahl, ganz: Math.round(zahl) })
  }
  return out
}

/**
 * Ein Satz, den Erik lesen kann, statt `22P02`.
 *
 * Bewusst mit der Tabelle und dem tatsächlichen Wert darin: Ohne beides ist
 * die Meldung zwar freundlich, aber nicht nachschlagbar.
 */
export function berichtigungsText(
  befunde: { tabelle: string; spalte: string; wert: number; ganz: number }[],
): string {
  if (!befunde.length) return ''
  const teile = befunde.map(
    (b) => `${b.tabelle}.${b.spalte} ${b.wert} → ${b.ganz}`,
  )
  const was = teile.length === 1 ? 'Ein Wert war' : `${teile.length} Werte waren`
  return `${was} keine ganze Zahl und hätte den Abgleich dieser Tabelle blockiert; berichtigt: ${teile.join(', ')}.`
}
