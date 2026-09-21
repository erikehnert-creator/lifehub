/**
 * Wettkämpfe und ihre Ergebnisse.
 *
 * ---------------------------------------------------------------------------
 * Es wird keine Wertungsformel erfunden
 *
 * D-Wert, E-Wert, Neutralabzüge und Endnote werden **eingetragen**, wie sie
 * auf dem Protokoll stehen – nicht auseinander gerechnet. LifeHub behauptet
 * nirgends, dass D + E − Abzug die Endnote ergibt: Je nach Wettkampf und Liga
 * fliessen weitere Werte ein, und eine selbstgebaute Rechnung wäre nach einem
 * Olympiazyklus falsch und sähe trotzdem richtig aus
 * (TURNEN_ARCHITEKTUR.md, 4.2).
 *
 * `plausibilitaet()` stellt die beiden Zahlen nebeneinander und enthält sich
 * eines Urteils. Sie blockiert nichts.
 *
 * ---------------------------------------------------------------------------
 * Fehlende Werte sind nicht null
 *
 * Ein nicht eingetragener E-Wert ist `null` und bleibt es. Er wird nirgends
 * als 0 angezeigt, nicht in eine Summe genommen und nicht in einen Verlauf
 * gezeichnet – eine 0,0 im Notenverlauf wäre ein Einbruch, den es nie gab.
 *
 * Reine Logik ohne Datenbank und ohne React.
 */
import { stableId } from '../ids'
import type { DayString } from '../dates'
import type { GymCompetition, GymResult } from '../types'
import { GERAETE, geraet } from './geraete'

/* ========================================================== Noten lesen */

/**
 * Eine eingetippte Note in eine Zahl – oder `null`.
 *
 * Nimmt Komma wie Punkt: Am Handy liefert die Zehnertastatur je nach
 * Spracheinstellung das eine oder das andere, und ein Protokoll schreibt
 * „13,250".
 *
 * Leer bleibt leer. Das ist der wichtigste Fall dieser Funktion: `Number('')`
 * ist 0, und eine 0 an dieser Stelle wäre eine Note, die niemand geturnt hat.
 */
export function leseNote(text: string | null | undefined): number | null {
  const roh = String(text ?? '').trim().replace(',', '.')
  if (!roh) return null
  const n = Number(roh)
  return Number.isFinite(n) ? n : null
}

/**
 * Eine Note, wie sie dasteht: „13,25", „13,0", „—".
 *
 * Nachkommastellen werden gekürzt, aber mindestens eine bleibt: „13" läse
 * sich wie eine Zählung, „13,0" wie eine Note. Drei sind das Maximum – mehr
 * kennt keine Wertungsvorschrift.
 */
export function formatNote(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const gerundet = Math.round(n * 1000) / 1000
  let text = gerundet.toFixed(3)
  while (text.endsWith('0') && !text.endsWith('.0')) text = text.slice(0, -1)
  return text.replace('.', ',')
}

/**
 * Eine ganze Zahl (Platzierung) aus einem Feld – oder `null`.
 *
 * Nimmt das Komma wie `leseNote` entgegen, obwohl eine Platzierung keine
 * Nachkommastellen hat: Am Handy steht die Zehnertastatur noch vom Notenfeld
 * her auf Komma, und ein „3,“ aus einem Vertipper soll die 3 ergeben und
 * nicht die ganze Eingabe verwerfen.
 */
export function lesePlatz(text: string | null | undefined): number | null {
  const roh = String(text ?? '').trim().replace(',', '.')
  if (!roh) return null
  const n = Number(roh)
  // PostgreSQL weist eine Kommazahl in einer integer-Spalte mit 22P02 ab und
  // damit den Push der ganzen Tabelle (siehe CLAUDE.md).
  return Number.isFinite(n) ? Math.round(n) : null
}

/* ===================================================== Ergebnisse planen */

/**
 * Die ID eines Ergebnisses – Wettkampf plus Gerät.
 *
 * Damit trifft ein zweites Speichern dieselbe Zeile, und zwei Geräte
 * erzeugen offline nicht zwei.
 *
 * ---------------------------------------------------------------------------
 * Ein Ergebnis je Wettkampf und Gerät
 *
 * Ob ein echtes Protokoll Vorrunde und Finale in EINEM Dokument führt, lässt
 * sich ohne ein solches Protokoll nicht beantworten – und wird deshalb nicht
 * geraten. Ein Gerätefinale wird bis dahin als eigener Wettkampf erfasst
 * („Landesmeisterschaft – Gerätefinale"), was fachlich vertretbar ist: Es hat
 * ein eigenes Datum, eine eigene Platzierung und ein eigenes Protokoll.
 *
 * Käme später eine Runde dazu, wäre es eine Spalte plus ein Zusatz an genau
 * dieser einen Rechnung. Damit vorhandene Zeilen dabei nicht verwaisen, muss
 * die leere Runde dann weiterhin die heutige ID ergeben – deshalb steht die
 * Rechnung hier und nirgends sonst.
 */
export function ergebnisId(competitionId: string, apparatus: string): string {
  return stableId('gym_results', competitionId, apparatus)
}

/** Ein Geräteergebnis, wie es die Oberfläche im Arbeitsspeicher hält. */
export interface ErgebnisEingabe {
  apparatus: string
  /** Die ausgewählte Kür – oder `null`. Wird beim Speichern eingefroren. */
  routineId: string | null
  /**
   * Die bereits festgehaltene Fassung, falls das Ergebnis schon eine hat.
   *
   * Sie bleibt stehen, solange Erik die Kür nicht wechselt. Ein gespeichertes
   * Ergebnis darf seine historische Fassung NICHT dadurch verlieren, dass es
   * noch einmal geöffnet und gespeichert wird.
   */
  versionId: string | null
  d: string
  e: string
  penalty: string
  final: string
  rank: string
  note: string
}

/** Eine leere Eingabe für ein Gerät. */
export function leereEingabe(apparatus: string): ErgebnisEingabe {
  return {
    apparatus, routineId: null, versionId: null,
    d: '', e: '', penalty: '', final: '', rank: '', note: '',
  }
}

/** Eine vorhandene Ergebniszeile zurück in eine Eingabe. */
export function eingabeAus(r: GymResult): ErgebnisEingabe {
  return {
    apparatus: r.apparatus,
    routineId: null,
    versionId: r.routine_version_id ?? null,
    d: r.d_score === null || r.d_score === undefined ? '' : formatNote(r.d_score),
    e: r.e_score === null || r.e_score === undefined ? '' : formatNote(r.e_score),
    penalty: r.penalty === null || r.penalty === undefined ? '' : formatNote(r.penalty),
    final: r.final_score === null || r.final_score === undefined ? '' : formatNote(r.final_score),
    rank: r.rank_apparatus === null || r.rank_apparatus === undefined ? '' : String(r.rank_apparatus),
    note: r.note ?? '',
  }
}

/** Die Werte einer Eingabe, wie sie in die Datenbank gehen. */
export function werteAus(competitionId: string, e: ErgebnisEingabe): Record<string, any> {
  return {
    competition_id: competitionId,
    apparatus: e.apparatus,
    routine_version_id: e.versionId,
    d_score: leseNote(e.d),
    e_score: leseNote(e.e),
    penalty: leseNote(e.penalty),
    final_score: leseNote(e.final),
    rank_apparatus: lesePlatz(e.rank),
    note: e.note.trim() || null,
  }
}

/**
 * Trägt diese Eingabe überhaupt etwas?
 *
 * Ein Gerät ohne jede Angabe erzeugt keine Zeile. „Ich bin an fünf Geräten
 * gestartet" heisst fünf Zeilen, nicht sechs mit einer leeren.
 *
 * Eine hinterlegte Kür allein genügt: „Ich habe die Kür geturnt, die Noten
 * trage ich nach" ist ein gültiger Zwischenstand.
 */
export function eingabeIstLeer(e: ErgebnisEingabe): boolean {
  return !e.d.trim() && !e.e.trim() && !e.penalty.trim() && !e.final.trim()
    && !e.rank.trim() && !e.note.trim() && !e.routineId && !e.versionId
}

export interface ErgebnisPlan {
  anlegen: { id: string; values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  entfernen: string[]
}

const FELDER = [
  'apparatus', 'routine_version_id', 'd_score', 'e_score',
  'penalty', 'final_score', 'rank_apparatus', 'note',
] as const

/**
 * Was beim Speichern der Ergebnisse eines Wettkampfs zu tun ist.
 *
 * Dasselbe Muster wie `planeVersuche` und `planeKuerElemente`, und aus
 * demselben Grund: Die Fälle, die sonst erst im Betrieb auffallen, lassen
 * sich einzeln nachrechnen –
 *
 *   - zweimal dasselbe speichern ändert nichts
 *   - ein Gerät ohne Angaben erzeugt keine Zeile
 *   - ein leergeräumtes Gerät verliert seine Zeile wieder
 */
export function planeErgebnisse(
  competitionId: string,
  eingaben: ErgebnisEingabe[],
  vorhanden: GymResult[],
): ErgebnisPlan {
  const plan: ErgebnisPlan = { anlegen: [], aendern: [], entfernen: [] }

  const daIst = new Map<string, GymResult>()
  for (const r of vorhanden) {
    if (r.deleted_at || r.competition_id !== competitionId) continue
    daIst.set(r.apparatus, r)
  }

  const gesehen = new Set<string>()
  for (const e of eingaben) {
    gesehen.add(e.apparatus)
    const alt = daIst.get(e.apparatus)

    if (eingabeIstLeer(e)) {
      if (alt) plan.entfernen.push(alt.id)
      continue
    }

    const werte = werteAus(competitionId, e)
    if (!alt) {
      plan.anlegen.push({ id: ergebnisId(competitionId, e.apparatus), values: werte })
      continue
    }

    // Nur schreiben, wenn sich wirklich etwas unterscheidet. Sonst schoebe
    // jedes Oeffnen eines Wettkampfs eine Aenderung ueber den Abgleich, fuer
    // die sich nichts geaendert hat.
    const patch: Record<string, any> = {}
    for (const feld of FELDER) {
      const neu = (werte as any)[feld]
      const bisher = (alt as any)[feld]
      if (String(neu ?? '') !== String(bisher ?? '')) patch[feld] = neu
    }
    if (Object.keys(patch).length) plan.aendern.push({ id: alt.id, patch })
  }

  for (const [apparatus, alt] of daIst) {
    if (!gesehen.has(apparatus)) plan.entfernen.push(alt.id)
  }

  return plan
}

export function planIstLeer(plan: ErgebnisPlan): boolean {
  return plan.anlegen.length === 0 && plan.aendern.length === 0 && plan.entfernen.length === 0
}

/* ===================================================== Plausibilität */

/**
 * Die Rechnung D + E − Abzug neben der eingetragenen Endnote.
 *
 * **Kein Urteil.** LifeHub sagt nicht, welche der beiden Zahlen stimmt, und
 * hindert niemanden am Speichern. Es gibt Wertungen, in die weitere Werte
 * einfliessen; eine Abweichung ist deshalb kein Fehler, sondern höchstens
 * ein Grund, noch einmal auf das Protokoll zu schauen.
 *
 * Erscheint nur, wenn D, E und Endnote alle dastehen – sonst verglichen wir
 * eine Zahl mit einer Lücke.
 *
 * `null`, wenn nichts zu sagen ist.
 */
export function plausibilitaet(e: ErgebnisEingabe): string | null {
  const d = leseNote(e.d)
  const ev = leseNote(e.e)
  const f = leseNote(e.final)
  if (d === null || ev === null || f === null) return null

  const abzug = leseNote(e.penalty) ?? 0
  const rechnung = Math.round((d + ev - abzug) * 1000) / 1000
  if (Math.abs(rechnung - f) < 0.0005) return null

  return `D + E${abzug ? ' − Abzug' : ''} ergibt ${formatNote(rechnung)}, `
    + `eingetragen ist ${formatNote(f)}. Beides kann richtig sein.`
}

/* ======================================================== Auswertung */

/** Ein Wettkampf mit seinen Ergebnissen, fertig sortiert. */
export interface WettkampfBild {
  wettkampf: GymCompetition
  ergebnisse: GymResult[]
  /** Geräte mit einer eingetragenen Endnote. */
  mitEndnote: number
  /** Die höchste eingetragene Endnote, oder `null`. */
  beste: number | null
  /** Die niedrigste eingetragene Endnote, oder `null`. */
  schwaechste: number | null
}

/**
 * Ein Wettkampf mit seinen Ergebnissen – nach Wettkampfreihenfolge geordnet.
 *
 * `beste` und `schwaechste` sind bewusst nur dann gesetzt, wenn mindestens
 * DREI Geräte eine Endnote tragen. Bei zweien ist „die bessere und die
 * schlechtere" keine Auskunft, sondern eine Umschreibung von „zwei Zahlen",
 * und die Marken in der Anzeige wären nur Lärm.
 */
export const MINDEST_GERAETE_FUER_MARKE = 3

export function wettkampfBild(
  wettkampf: GymCompetition,
  alle: GymResult[],
): WettkampfBild {
  const ergebnisse = alle
    .filter((r) => !r.deleted_at && r.competition_id === wettkampf.id)
    .sort((a, b) => {
      const ra = geraet(a.apparatus)?.reihenfolge ?? 99
      const rb = geraet(b.apparatus)?.reihenfolge ?? 99
      return ra - rb || a.apparatus.localeCompare(b.apparatus)
    })

  const noten = ergebnisse
    .map((r) => r.final_score)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))

  const genug = noten.length >= MINDEST_GERAETE_FUER_MARKE
  return {
    wettkampf,
    ergebnisse,
    mitEndnote: noten.length,
    beste: genug ? Math.max(...noten) : null,
    schwaechste: genug ? Math.min(...noten) : null,
  }
}

/** Welcher Wert eines Ergebnisses ausgewertet wird. */
export type NotenArt = 'final_score' | 'd_score' | 'e_score'

export const NOTEN_ARTEN: { key: NotenArt; label: string }[] = [
  { key: 'final_score', label: 'Endnote' },
  { key: 'd_score', label: 'D-Wert' },
  { key: 'e_score', label: 'E-Wert' },
]

export interface VerlaufPunkt {
  day: DayString
  name: string
  wert: number
}

/**
 * Der Verlauf einer Note an einem Gerät – chronologisch.
 *
 * Wettkämpfe ohne diesen Wert fehlen in der Reihe, statt mit einer 0 zu
 * erscheinen. Eine Lücke ist ehrlich; eine 0 wäre ein Einbruch, den es nie
 * gab.
 */
export function verlauf(
  apparatus: string,
  art: NotenArt,
  wettkaempfe: GymCompetition[],
  ergebnisse: GymResult[],
): VerlaufPunkt[] {
  const wkVon = new Map<string, GymCompetition>()
  for (const w of wettkaempfe) {
    if (w.deleted_at) continue
    wkVon.set(w.id, w)
  }

  const punkte: VerlaufPunkt[] = []
  for (const r of ergebnisse) {
    if (r.deleted_at || r.apparatus !== apparatus) continue
    const w = wkVon.get(r.competition_id)
    if (!w) continue
    const wert = r[art]
    if (typeof wert !== 'number' || !Number.isFinite(wert)) continue
    punkte.push({ day: w.day, name: w.name, wert })
  }
  return punkte.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

/**
 * Ab wie vielen Punkten eine Linie gezeichnet wird.
 *
 * Darunter stehen die Werte als Liste da. Zwei Punkte ergeben immer eine
 * Gerade, und eine Gerade sieht nach Entwicklung aus, wo nur zwei Zahlen
 * sind – dieselbe Überlegung wie bei `MINDESTTAGE` in
 * `core/zusammenhaenge.ts`, nur eine Stufe schwächer: Hier wird nichts
 * behauptet, es wird nur gezeichnet.
 */
export const MINDESTPUNKTE_LINIE = 3

export interface GeraetBilanz {
  apparatus: string
  /** Wettkämpfe mit einem Ergebnis an diesem Gerät. */
  starts: number
  /** Bestwert der Endnote, oder `null`. */
  bestEndnote: VerlaufPunkt | null
  bestD: VerlaufPunkt | null
  /** Der letzte Start an diesem Gerät, oder `null`. */
  letzter: VerlaufPunkt | null
}

/**
 * Was sich je Gerät über die Wettkämpfe sagen lässt – rein beschreibend.
 *
 * Kein Gesamtwert über alle Geräte, keine Rangfolge zwischen ihnen. Eine
 * Bodennote und eine Pauschenpferdnote sind nicht dieselbe Währung; sie zu
 * einer Kennzahl zu verrechnen hiesse, eine Wertung zu erfinden.
 */
export function geraetBilanzen(
  wettkaempfe: GymCompetition[],
  ergebnisse: GymResult[],
): Map<string, GeraetBilanz> {
  const out = new Map<string, GeraetBilanz>()
  for (const g of GERAETE) {
    const endnoten = verlauf(g.key, 'final_score', wettkaempfe, ergebnisse)
    const dwerte = verlauf(g.key, 'd_score', wettkaempfe, ergebnisse)

    // Starts zaehlen ueber die Ergebniszeilen, nicht ueber die Endnoten: Ein
    // Start, bei dem nur der D-Wert notiert wurde, ist trotzdem ein Start.
    const wkIds = new Set(wettkaempfe.filter((w) => !w.deleted_at).map((w) => w.id))
    const starts = ergebnisse.filter(
      (r) => !r.deleted_at && r.apparatus === g.key && wkIds.has(r.competition_id)).length
    if (!starts) continue

    const hoechster = (p: VerlaufPunkt[]) =>
      p.length ? p.reduce((a, b) => (b.wert > a.wert ? b : a)) : null

    out.set(g.key, {
      apparatus: g.key,
      starts,
      bestEndnote: hoechster(endnoten),
      bestD: hoechster(dwerte),
      letzter: endnoten.length ? endnoten[endnoten.length - 1] : null,
    })
  }
  return out
}

/**
 * Der nächste noch bevorstehende und der zuletzt vergangene Wettkampf.
 *
 * `heute` wird übergeben statt gelesen, damit sich die Grenzfälle prüfen
 * lassen: Ein Wettkampf am heutigen Tag gilt als der nächste, nicht als der
 * letzte.
 */
export function naechsterUndLetzter(
  wettkaempfe: GymCompetition[],
  heute: DayString,
): { naechster: GymCompetition | null; letzter: GymCompetition | null } {
  const offen = wettkaempfe.filter((w) => !w.deleted_at)
  const kuenftig = offen.filter((w) => w.day >= heute).sort((a, b) => (a.day < b.day ? -1 : 1))
  const vergangen = offen.filter((w) => w.day < heute).sort((a, b) => (a.day > b.day ? -1 : 1))
  return { naechster: kuenftig[0] ?? null, letzter: vergangen[0] ?? null }
}
