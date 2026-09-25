/**
 * Ein gelesenes Protokoll in einen Wettkampfentwurf überführen.
 *
 * ---------------------------------------------------------------------------
 * Der Importer schreibt nichts
 *
 * Diese Datei macht aus dem, was die Edge Function zurückgibt, **genau
 * dieselben** Objekte, die auch die Handeingabe erzeugt: einen
 * Wettkampfentwurf und `ErgebnisEingabe[]`. Ab da gibt es keinen zweiten Weg
 * mehr – der Editor zeigt sie, Erik ändert, was er ändern will, und
 * gespeichert wird über `planeErgebnisse()` wie bei jedem von Hand
 * eingetragenen Wettkampf.
 *
 * Das ist die Regel aus TURNEN_ARCHITEKTUR.md, 5.2: **vorschlagen, nicht
 * speichern.** Ein erkannter Wert, den niemand bestätigt hat, erreicht die
 * Datenbank nie.
 *
 * Reine Logik ohne Netzwerk, ohne Datenbank und ohne React.
 */
import type { GymCompetition } from '../types'
import { formatNote, leereEingabe, type ErgebnisEingabe } from './wettkampf'
import { GERAETE, geraetName } from './geraete'
import { vergleiche, type VergleichsTeilnehmer } from './vergleich'
import type {
  ProtokollErgebnis, Teilnehmer, Sicherheit,
} from '../../../supabase/functions/wettkampf-import/protokoll'

export type { ProtokollErgebnis, Teilnehmer, Sicherheit }

/** Was die Edge Function zurückgibt – gelungen oder nicht. */
export type ImportAntwort =
  | ({ ok: true; dauer?: { extrahiert: number; geparst: number; gesamt: number } } & ProtokollErgebnis)
  | { ok: false; code: string; message: string }

/* ================================================ Teilnehmer vorschlagen */

/**
 * Wer von den Gelesenen ist vermutlich der Turner?
 *
 * Ausdrücklich nur ein **Vorschlag**, und nur bei genau einem Treffer. Bei
 * zwei gleichnamigen Teilnehmern schlägt LifeHub keinen vor – dann entscheidet
 * der Mensch, der Jahrgang, Verein und Klasse danebenstehen sieht.
 *
 * Der Name kommt aus den Einstellungen, nicht aus dem Code. Steht dort nichts,
 * gibt es keinen Vorschlag und die volle Liste bleibt.
 */
export function vorschlagen(teilnehmer: Teilnehmer[], eigenerName: string): Teilnehmer | null {
  const teile = eigenerName.trim().toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (!teile.length) return null
  const treffer = teilnehmer.filter((t) => {
    const name = (t.name.wert ?? '').toLowerCase()
    return teile.every((s) => name.includes(s))
  })
  return treffer.length === 1 ? treffer[0] : null
}

/** Alle, deren Name zur Suche passt – für die Liste im Auswahlfenster. */
export function suchen(teilnehmer: Teilnehmer[], suche: string): Teilnehmer[] {
  const teile = suche.trim().toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (!teile.length) return teilnehmer
  return teilnehmer.filter((t) => {
    const text = [t.name.wert, t.verein.wert, t.klasse, t.jahrgang.wert]
      .filter(Boolean).join(' ').toLowerCase()
    return teile.every((s) => text.includes(s))
  })
}

/** Eine Zeile, wie sie im Auswahlfenster steht. */
export function teilnehmerZeile(t: Teilnehmer): string {
  return [
    t.jahrgang.wert ? String(t.jahrgang.wert) : null,
    t.verein.wert,
    t.klasse,
    t.rang.wert ? `Rang ${t.rang.wert}` : null,
  ].filter(Boolean).join(' · ')
}

/* ==================================================== Entwurf aufbauen */

/** Der Wettkampf, wie er nach dem Import im Editor stehen soll. */
export interface WettkampfEntwurf {
  name: string
  tag: string
  ort: string
  klasse: string
  rang: string
  gesamt: string
}

/**
 * Der Wettkampfentwurf aus Protokollkopf und gewähltem Teilnehmer.
 *
 * Die Klasse („LK 2 AK 18-29") geht in `class_name` – dafür reicht die
 * vorhandene Textspalte. Eine eigene Tabelle für Alters- und
 * Leistungsklassen wäre eine Tabelle für einen Text, den nur Erik liest.
 */
export function wettkampfEntwurf(
  protokoll: ProtokollErgebnis,
  t: Teilnehmer,
  heute: string,
): WettkampfEntwurf {
  return {
    name: protokoll.wettkampf.name.wert ?? '',
    // Ohne erkanntes Datum lieber heute als ein geratenes: Ein leeres
    // Pflichtfeld hielte den Editor auf, und heute ist als Platzhalter
    // erkennbar falsch, wo ein geratenes Datum es nicht wäre.
    tag: protokoll.wettkampf.tag.wert ?? heute,
    ort: protokoll.wettkampf.ort.wert ?? '',
    klasse: t.klasse,
    rang: t.rang.wert === null ? '' : String(t.rang.wert),
    gesamt: t.gesamt.wert === null ? '' : formatNote(t.gesamt.wert),
  }
}

/**
 * Die Geräteergebnisse eines Teilnehmers als Eingaben.
 *
 * Ein Gerät ohne jede Zahl erzeugt **keine** Eingabe – wer an fünf Geräten
 * gestartet ist, bekommt fünf Karten. Eine ausgewiesene **0 ist eine Zahl**
 * und bleibt erhalten: Fehlend und null sind nicht dasselbe.
 *
 * Die Kür bleibt leer. Welche Übung geturnt wurde, weiss das Protokoll nicht –
 * das entscheidet Erik im Editor.
 */
export function ergebnisEingaben(t: Teilnehmer): ErgebnisEingabe[] {
  const out: ErgebnisEingabe[] = []
  for (const g of GERAETE) {
    const w = t.geraete.find((x) => x.apparatus === g.key)
    if (!w) continue
    if (w.d.wert === null && w.e.wert === null && w.final.wert === null) continue
    out.push({
      ...leereEingabe(g.key),
      d: w.d.wert === null ? '' : formatNote(w.d.wert),
      e: w.e.wert === null ? '' : formatNote(w.e.wert),
      penalty: w.penalty.wert === null ? '' : formatNote(w.penalty.wert),
      final: w.final.wert === null ? '' : formatNote(w.final.wert),
    })
  }
  return out
}

/* ======================================================== Unsicherheit */

export interface Unsicher {
  /** Wo der Wert steht, ausgeschrieben – „Reck · E-Wert". */
  feld: string
  sicherheit: Exclude<Sicherheit, 'exact'>
  /** Was im Protokoll stand, falls überhaupt etwas dastand. */
  roh: string | null
}

/**
 * Welche Angaben LifeHub nicht sicher lesen konnte.
 *
 * Bewusst nur drei Stufen und keine Prozentzahl: Für eine Wahrscheinlichkeit
 * gäbe es hier keine Grundlage – die Struktur ist eindeutig oder sie ist es
 * nicht.
 *
 * Fehlende Abzüge zählen NICHT dazu. Kein Abzug ist der Normalfall und keine
 * Unsicherheit; ihn zu melden hiesse, bei fast jedem Import sechs Warnungen zu
 * zeigen, die nichts bedeuten.
 */
export function unsichereFelder(
  protokoll: ProtokollErgebnis,
  t: Teilnehmer,
): Unsicher[] {
  const out: Unsicher[] = []
  const pruefe = (feld: string, w: { sicherheit: Sicherheit; roh: string | null }) => {
    if (w.sicherheit !== 'exact') out.push({ feld, sicherheit: w.sicherheit, roh: w.roh })
  }

  pruefe('Wettkampfname', protokoll.wettkampf.name)
  pruefe('Ort', protokoll.wettkampf.ort)
  pruefe('Datum', protokoll.wettkampf.tag)
  pruefe('Platzierung', t.rang)
  pruefe('Gesamtpunktzahl', t.gesamt)

  for (const g of t.geraete) {
    const name = geraetName(g.apparatus)
    pruefe(`${name} · D-Wert`, g.d)
    pruefe(`${name} · E-Wert`, g.e)
    pruefe(`${name} · Endnote`, g.final)
  }
  return out
}

/* ==================================================== Vergleichsfeld */

/**
 * Ein gelesener Teilnehmer, auf das Nötige eingekocht.
 *
 * **Hier wird ausgesiebt.** `VergleichsTeilnehmer` hat kein Feld für Name,
 * Jahrgang oder Verein; was diese Funktion nicht überträgt, sieht die
 * Vergleichsrechnung nie – und kann deshalb auch nicht versehentlich
 * gespeichert werden. Das ist die eine Stelle, an der nachzulesen ist, was von
 * fremden Teilnehmern weitergeht: die Klasse, der Mehrkampfplatz, die
 * Gesamtpunktzahl und die Zahlen an den Geräten.
 *
 * Der Mehrkampfplatz geht mit, weil `gruppeVon()` an ihm prüft, ob die Gruppe
 * überhaupt EINE Wertung ist.
 */
export function ausProtokoll(t: Teilnehmer): VergleichsTeilnehmer {
  return {
    klasse: t.klasse,
    rang: t.rang.wert,
    gesamt: t.gesamt.wert,
    geraete: t.geraete.map((g) => ({
      apparatus: g.apparatus,
      d: g.d.wert,
      e: g.e.wert,
      final: g.final.wert,
    })),
  }
}

/**
 * Das Vergleichsfeld des gewählten Teilnehmers.
 *
 * Alle Teilnehmer gehen durch `ausProtokoll()`, bevor gerechnet wird – auch
 * die, die gar nicht in der Klasse stehen. Damit gibt es keinen Weg, auf dem
 * ein Name in die Rechnung gelangt.
 *
 * Gerechnet wird beim **Vorschauen**, gespeichert erst beim Bestätigen.
 */
export function vergleichFuer(
  protokoll: ProtokollErgebnis,
  t: Teilnehmer,
): ReturnType<typeof vergleiche> {
  return vergleiche(protokoll.teilnehmer.map(ausProtokoll), ausProtokoll(t))
}

/** Die Kennzeichnungen, die im Protokoll standen – unverändert und ungedeutet. */
export function markerListe(t: Teilnehmer): { geraet: string; marker: string[] }[] {
  return t.geraete
    .filter((g) => g.marker.length)
    .map((g) => ({ geraet: geraetName(g.apparatus), marker: g.marker }))
}

/* ================================================= Doppelter Wettkampf */

/**
 * Gibt es diesen Wettkampf schon?
 *
 * Über Tag und Namen, beides unempfindlich gegen Gross- und Kleinschreibung
 * und gegen Leerraum. Ein zweiter Import desselben Protokolls soll keinen
 * zweiten Wettkampf anlegen – aber entscheiden soll das Erik, nicht LifeHub:
 * Zwei Wettkämpfe am selben Tag mit demselben Namen sind denkbar (Mehrkampf
 * und Gerätefinale), deshalb wird nur gewarnt.
 */
export function schonVorhanden(
  wettkaempfe: GymCompetition[],
  entwurf: WettkampfEntwurf,
): GymCompetition | null {
  const name = entwurf.name.trim().toLowerCase()
  if (!name || !entwurf.tag) return null
  return wettkaempfe.find(
    (w) => !w.deleted_at && w.day === entwurf.tag
      && (w.name ?? '').trim().toLowerCase() === name) ?? null
}
