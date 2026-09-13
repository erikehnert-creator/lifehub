/**
 * Der Weg zurück durch das FatSecret-Tagebuch – bis zum ersten Tag.
 *
 * ---------------------------------------------------------------------------
 * Was die Schnittstelle hergibt (recherchiert am 13.09.2026)
 *
 * FatSecret sagt nirgends, seit wann ein Konto besteht. `profile.get` liefert
 * Größe, Zielgewicht und das Datum der letzten Wiegung – kein Anlegedatum.
 * Ein „hole alles seit Tag 1" gibt es also nicht.
 *
 * Was es gibt, ist `food_entries.get_month.v2`: eine Monatsübersicht, die
 * **nur die Tage enthält, an denen etwas eingetragen wurde**
 * („Days with no food diary entries are not included"). Damit kostet ein
 * ganzer Monat genau einen Aufruf, und man erfährt daraus, welche Tage sich
 * im Einzelnen zu holen lohnen.
 *
 * Daraus folgt die Strategie: Monat für Monat rückwärts. Jeder Monat nennt
 * seine Tage, die Tage werden einzeln geholt (dort stehen die Nährwerte, die
 * die Übersicht nicht hat), und irgendwann kommen nur noch leere Monate.
 *
 * ---------------------------------------------------------------------------
 * Wann ist „der erste Tag" erreicht?
 *
 * Das lässt sich nicht erfragen, nur erschließen. Ein einzelner leerer Monat
 * beweist nichts – wer zwei Wochen Urlaub macht oder eine Pause einlegt, hat
 * eine Lücke. Deshalb wird erst nach `LEERE_MONATE_BIS_ENDE` leeren Monaten in
 * Folge abgebrochen, und zusätzlich gibt es einen Boden (`FRUEHESTER_MONAT`),
 * damit der Lauf auch dann endet, wenn FatSecret dauerhaft leere Monate
 * liefert statt eines Fehlers.
 *
 * Zwölf leere Monate sind bewusst großzügig: Der Import läuft ohnehin im
 * Hintergrund, und ein Jahr zu viel zu prüfen kostet zwölf Aufrufe. Ein Jahr
 * zu früh aufzuhören kostet die halbe Historie.
 *
 * ---------------------------------------------------------------------------
 * Hier steht nur das Rechnen – kein Netz, keine Datenbank. Ausgeführt wird der
 * Plan in state/ernaehrung.ts.
 */
import type { DayString } from './dates'

/** Ein Monat als `YYYY-MM`. */
export type MonatString = string

/** So viele leere Monate in Folge gelten als „davor war nichts mehr". */
export const LEERE_MONATE_BIS_ENDE = 12

/**
 * Weiter zurück wird nicht gesucht. FatSecret gibt es seit 2007; ein Tagebuch
 * davor kann es nicht geben. Der Boden ist die Notbremse für den Fall, dass
 * die Schnittstelle statt eines Fehlers dauerhaft leere Monate liefert.
 */
export const FRUEHESTER_MONAT: MonatString = '2006-01'

export interface ImportStand {
  /** Ältester Monat, der bereits vollständig geprüft wurde. */
  geprueftBis: MonatString | null
  /** Leere Monate in Folge, gezählt ab dem zuletzt gefundenen Eintrag. */
  leereMonate: number
  /** true, sobald der Rückwärtslauf abgeschlossen ist. */
  fertig: boolean
  /** Der älteste Tag, an dem etwas gefunden wurde. */
  aeltesterTag: DayString | null
  /** Wie viele Tage mit Einträgen bisher gefunden wurden. */
  gefundeneTage: number
  /** Zeitpunkt des letzten erfolgreichen Abgleichs (ISO). */
  zuletzt: string | null
}

export const LEERER_STAND: ImportStand = {
  geprueftBis: null,
  leereMonate: 0,
  fertig: false,
  aeltesterTag: null,
  gefundeneTage: 0,
  zuletzt: null,
}

/* ------------------------------------------------------------ Monatsrechnen */

export function monatVon(tag: DayString): MonatString {
  return tag.slice(0, 7)
}

export function vorherigerMonat(m: MonatString): MonatString {
  const [j, mo] = m.split('-').map(Number)
  return mo === 1
    ? `${j - 1}-12`
    : `${j}-${String(mo - 1).padStart(2, '0')}`
}

/** Der erste Tag des Monats – das ist der Wert, den FatSecret als `date` will. */
export function ersterTagDesMonats(m: MonatString): DayString {
  return `${m}-01`
}

/* ------------------------------------------------------------- Der Fahrplan */

/**
 * Welche Monate als Nächstes zu prüfen sind.
 *
 * Beim ersten Lauf ist das der laufende Monat, danach geht es von
 * `geprueftBis` aus weiter rückwärts. Ist der Lauf abgeschlossen oder der
 * Boden erreicht, kommt eine leere Liste zurück – der Aufrufer hört damit von
 * selbst auf, ohne dass er die Abbruchbedingung kennen muss.
 */
export function naechsteMonate(
  stand: ImportStand, anzahl: number, heute: DayString,
): MonatString[] {
  if (stand.fertig || anzahl <= 0) return []

  const out: MonatString[] = []
  let m = stand.geprueftBis ? vorherigerMonat(stand.geprueftBis) : monatVon(heute)
  while (out.length < anzahl && m >= FRUEHESTER_MONAT) {
    out.push(m)
    m = vorherigerMonat(m)
  }
  return out
}

/** Was eine geprüfte Monatsrunde ergeben hat. */
export interface MonatsBefund {
  monat: MonatString
  /** Die Tage dieses Monats, an denen etwas im Tagebuch steht. */
  tage: DayString[]
}

/**
 * Der neue Stand nach einer Runde.
 *
 * Die Befunde werden in der Reihenfolge verarbeitet, in der gesucht wurde –
 * also von neu nach alt. Ein Monat mit Einträgen setzt den Zähler der leeren
 * Monate zurück: Eine Lücke mitten in der Historie soll den Lauf nicht beenden.
 */
export function standNachMonaten(
  stand: ImportStand, befunde: MonatsBefund[],
): ImportStand {
  let neu: ImportStand = { ...stand }

  for (const b of [...befunde].sort((x, y) => (x.monat < y.monat ? 1 : -1))) {
    if (b.tage.length > 0) {
      neu.leereMonate = 0
      neu.gefundeneTage += b.tage.length
      const aeltester = [...b.tage].sort()[0]
      if (!neu.aeltesterTag || aeltester < neu.aeltesterTag) neu.aeltesterTag = aeltester
    } else {
      neu.leereMonate += 1
    }
    // Immer setzen, auch bei leeren Monaten: Sonst liefe der Lauf bei einer
    // Unterbrechung wieder bei demselben Monat los und käme nie voran.
    neu.geprueftBis = b.monat
  }

  if (neu.leereMonate >= LEERE_MONATE_BIS_ENDE) neu.fertig = true
  if (neu.geprueftBis && vorherigerMonat(neu.geprueftBis) < FRUEHESTER_MONAT) neu.fertig = true

  return neu
}

/* ---------------------------------------------------- Der laufende Abgleich */

/**
 * Wie viele Tage zurück ein gewöhnlicher Abgleich erneut ansieht.
 *
 * Drei: heute, gestern, vorgestern.
 *
 * Nicht nur heute, weil in FatSecret abends nachgetragen und am nächsten Tag
 * eine Portion korrigiert wird – das käme sonst nie an. Und nicht mehr, weil
 * jeder Tag einen Aufruf kostet und die Historie ohnehin einmal vollständig
 * geholt wurde. Wer einen weit zurückliegenden Tag korrigiert, stößt den
 * Historienabgleich von Hand an (siehe `historieErneut` in state/ernaehrung.ts).
 */
export const NACHLAUF_TAGE = 3

/**
 * Die Tage, die ein laufender Abgleich erneut holt – neueste zuerst.
 *
 * Bewusst ohne Datumsrechnung über `new Date(tag)`: Dessen Ergebnis hängt an
 * der Zeitzone des Geräts, und ein Handy in einer anderen Zeitzone fragte dann
 * den Nachbartag ab.
 */
export function nachzuholendeTage(
  heute: DayString, addDays: (d: DayString, n: number) => DayString, anzahl = NACHLAUF_TAGE,
): DayString[] {
  const out: DayString[] = []
  for (let i = 0; i < anzahl; i++) out.push(addDays(heute, -i))
  return out
}

/**
 * Ist ein Abgleich fällig?
 *
 * Der Abstand ist kein Geschmack, sondern Rücksicht: FatSecret meldet sich
 * nicht von selbst, wenn sich etwas ändert – abgefragt werden muss also
 * regelmäßig, aber jeder Lauf kostet einen Aufruf je Tag. Eine Viertelstunde
 * ist häufig genug, dass man das Nachtragen vom Handy am PC bemerkt, und
 * selten genug, dass ein offener Browser keine Last erzeugt.
 */
export const ABGLEICH_ABSTAND_MS = 15 * 60 * 1000

export function abgleichFaellig(
  zuletzt: string | null, jetzt: number, abstand = ABGLEICH_ABSTAND_MS,
): boolean {
  if (!zuletzt) return true
  const t = Date.parse(zuletzt)
  if (!Number.isFinite(t)) return true
  return jetzt - t >= abstand
}

/**
 * Der Stand für einen erneuten Historienlauf.
 *
 * Gebraucht, wenn in FatSecret ein weit zurückliegender Tag korrigiert wurde:
 * Der laufende Abgleich sieht nur drei Tage zurück und bekäme davon nichts mit.
 *
 * Zurückgesetzt wird nur der Suchfortschritt, nicht das Ergebnis. Was schon in
 * LifeHub steht, bleibt stehen und wird beim erneuten Lauf aktualisiert statt
 * ein zweites Mal angelegt – die Zeilen-IDs stammen aus der food_entry_id von
 * FatSecret, ein zweiter Durchlauf trifft also dieselben Zeilen wieder.
 */
export function standFuerNeuenLauf(stand: ImportStand): ImportStand {
  return { ...stand, geprueftBis: null, leereMonate: 0, fertig: false }
}
