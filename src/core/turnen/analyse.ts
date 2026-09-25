/**
 * Leistungsanalyse: was die Zahlen eines Wettkampfs hergeben – und was nicht.
 *
 * ---------------------------------------------------------------------------
 * Der Grundsatz: keine rohen Punktzahlen über Geräte hinweg
 *
 * Eine niedrigere Endnote ist **kein** schwächeres Gerät. Am Sprung reichten
 * 11,000 für den ersten Platz, am Boden reichten 11,566 für den vierten. Wer
 * die beiden Zahlen nebeneinanderlegt und daraus „Boden ist stärker" liest,
 * liest das Gegenteil dessen, was im Protokoll steht.
 *
 * Verglichen wird deshalb immer **innerhalb der Verteilung desselben Geräts**:
 * mein Platz im Feld, mein Abstand zum Median, mein Abstand zum Besten. Die
 * Rohwerte stehen daneben, weil man sie sehen will – gedeutet werden sie
 * geräteübergreifend nie.
 *
 * ---------------------------------------------------------------------------
 * Was hier bewusst NICHT passiert
 *
 * Keine Gesamtkennzahl über Geräte, kein gewichteter Index aus D und E, keine
 * Wahrscheinlichkeit, keine Vorhersage, keine Aussage über Ursachen. „Die
 * E-Werte lagen in den letzten drei Wettkämpfen höher" ist eine Beobachtung;
 * „dein Training hat die E-Note verbessert" wäre eine Behauptung, für die es
 * hier keine Grundlage gibt.
 *
 * Die eine normierte Zahl, die es gibt – `position()` aus `vergleich.ts` –
 * erscheint nirgends in der Oberfläche. Sie ordnet intern und trägt die
 * Fokusregel; dort stehen Platz und Feldgrösse.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import type { GymCompetition, GymResult } from '../types'
import { GERAETE, geraet, geraetName } from './geraete'
import { MEHRKAMPF, positionAus } from './vergleich'

/* ================================================== Eingang: Vergleichswerte */

/**
 * Ein gespeicherter Vergleichswert, soweit die Analyse ihn braucht.
 *
 * Strukturell und nicht `GymBenchmark`, damit die **Vorschau beim Import**
 * denselben Weg nimmt: Dort gibt es noch keine Datenbankzeilen, aber dieselben
 * Zahlen. Ein zweiter Analysepfad nur für die Vorschau wäre ein zweiter Ort,
 * an dem die Fokusregel auseinanderlaufen kann.
 */
export interface VergleichsWerte {
  competition_id: string
  scope: string
  cohort_label?: string | null
  cohort_size: number
  final_rank?: number | null
  final_tie_count?: number | null
  final_count?: number | null
  final_median?: number | null
  final_best?: number | null
  d_rank?: number | null
  d_tie_count?: number | null
  d_count?: number | null
  d_median?: number | null
  d_best?: number | null
  e_rank?: number | null
  e_tie_count?: number | null
  e_count?: number | null
  e_median?: number | null
  e_best?: number | null
  deleted_at?: string | null
}

/* ========================================================== Schwellen */

/**
 * Die Mitte des Feldes.
 *
 * Eine relative Position unter 0,5 heisst: Mein Mittelrang liegt in der unteren
 * Hälfte des Feldes, ich stehe also **unter dem Mittel meiner Konkurrenz**. Das
 * ist kein gewählter Schwellenwert, sondern die Mitte selbst – und der einzige
 * Vergleichspunkt, den die Fokusregel braucht.
 *
 * Wer genau in der Mitte steht, gilt **nicht** als unten: Mitte ist nicht
 * Schwäche. Das betrifft drei Fälle, die alle genau 0,5 ergeben – der Dritte von
 * fünf, zwei Gleichplatzierte auf den Rängen 3 und 4 von sechs, und ein Feld, in
 * dem **alle** dasselbe geturnt haben. Der letzte ist der wichtigste: Ohne die
 * Mittelrangbehandlung in `position()` fiele er auf 0 und löste an einem völlig
 * ausgeglichenen Gerät einen Fokus aus.
 */
export const FELDMITTE = 0.5

/**
 * Ab wie vielen Turnern im Feld ein Fokus benannt wird.
 *
 * Bei zwei Turnern kann eine Position nur 0 oder 1 sein – daraus einen
 * Trainingshinweis zu machen hiesse, einen Münzwurf als Auskunft auszugeben.
 * Der Platz selbst wird trotzdem angezeigt; er ist ja richtig.
 *
 * Produktheuristik, keine sportwissenschaftliche Grösse.
 */
export const MINDESTFELD_FUER_FOKUS = 3

/**
 * Ab wie vielen Wettkämpfen von einem Verlauf gesprochen wird.
 *
 * Dieselbe Überlegung wie `MINDESTPUNKTE_LINIE` in `wettkampf.ts`: Zwei Punkte
 * ergeben immer eine Richtung, und eine Richtung sieht nach Entwicklung aus, wo
 * nur zwei Zahlen sind.
 */
export const MINDESTWETTKAEMPFE_FUER_TREND = 3

/* =========================================================== Messwert */

/** Eine Messgrösse an einem Gerät: mein Wert und das Feld darum. */
export interface Messwert {
  /** Mein Rohwert aus dem Protokoll, oder `null`. */
  wert: number | null
  rang: number | null
  /** Wie viele denselben Wert hatten, mich eingeschlossen. `> 1` heisst geteilt. */
  gleich: number | null
  /** Wie viele diesen Wert überhaupt hatten – der Nenner von „X. von Y". */
  anzahl: number | null
  median: number | null
  best: number | null
  /** 0 bis 1, nur intern – siehe Dateikopf. */
  position: number | null
  /** Mein Wert minus Median. Positiv heisst über dem typischen Feld. */
  abstandMedian: number | null
  /** Mein Wert minus Bestwert. Nie positiv. */
  abstandBest: number | null
}

const LEER: Messwert = {
  wert: null, rang: null, gleich: null, anzahl: null, median: null, best: null,
  position: null, abstandMedian: null, abstandBest: null,
}

function rund(n: number): number {
  return Math.round(n * 1000) / 1000
}

function messwert(
  wert: number | null,
  rang: number | null | undefined,
  gleich: number | null | undefined,
  anzahl: number | null | undefined,
  median: number | null | undefined,
  best: number | null | undefined,
): Messwert {
  const m = median ?? null
  const b = best ?? null
  return {
    wert,
    rang: rang ?? null,
    gleich: gleich ?? null,
    anzahl: anzahl ?? null,
    median: m,
    best: b,
    position: positionAus(rang, gleich, anzahl),
    abstandMedian: wert !== null && m !== null ? rund(wert - m) : null,
    abstandBest: wert !== null && b !== null ? rund(wert - b) : null,
  }
}

/** Steht dieser Wert im unteren Teil des Feldes? `null`, wenn unbestimmbar. */
export function liegtUnten(m: Messwert): boolean | null {
  return m.position === null ? null : m.position < FELDMITTE
}

/* ============================================================= Fokus */

/**
 * Wo an diesem Gerät der Ansatzpunkt liegt.
 *
 * `zu_wenig_daten` ist keine Verlegenheitsantwort, sondern die richtige: Ohne
 * Vergleichsfeld oder ohne D- und E-Wert ist nicht zu sagen, was die Endnote
 * begrenzt.
 */
export type Fokus =
  | 'schwierigkeit'
  | 'ausfuehrung'
  | 'beides'
  | 'halten'
  | 'zu_wenig_daten'

export const FOKUS_LABEL: Record<Fokus, string> = {
  schwierigkeit: 'Schwierigkeit',
  ausfuehrung: 'Ausführung',
  beides: 'Schwierigkeit und Ausführung',
  halten: 'Stärke halten',
  zu_wenig_daten: 'zu wenig Daten',
}

/**
 * Die Fokusregel – vollständig, in vier Zeilen.
 *
 *   D unten und E unten  → beides
 *   nur D unten          → Schwierigkeit
 *   nur E unten          → Ausführung
 *   keines unten         → halten
 *
 * „Unten" heisst: unter der Mitte des eigenen Feldes an **diesem** Gerät
 * (`FELDMITTE`). Verglichen werden also relative Positionen, nie rohe D- oder
 * E-Differenzen zwischen verschiedenen Geräten – ein D von 2,9 ist am Boden
 * etwas anderes als am Sprung.
 *
 * Es wird **kein** Punktgewinn versprochen. „Hier liegt der Ansatzpunkt" sagt,
 * wo im Feld etwas fehlt; was eine höhere Schwierigkeit an Endnote bringt,
 * hängt an der Ausführung, die dann noch möglich ist, und das weiss diese
 * Rechnung nicht.
 *
 * Fehlt eine der beiden Positionen, wird nichts benannt: Aus einer Seite allein
 * lässt sich nicht sagen, welche die begrenzende ist.
 */
export function fokusVon(d: Messwert, e: Messwert, feldgroesse: number | null): Fokus {
  if (feldgroesse === null || feldgroesse < MINDESTFELD_FUER_FOKUS) return 'zu_wenig_daten'
  const dUnten = liegtUnten(d)
  const eUnten = liegtUnten(e)
  if (dUnten === null || eUnten === null) return 'zu_wenig_daten'
  if (dUnten && eUnten) return 'beides'
  if (dUnten) return 'schwierigkeit'
  if (eUnten) return 'ausfuehrung'
  return 'halten'
}

function platzText(m: Messwert): string {
  if (m.rang === null || m.anzahl === null) return 'ohne Vergleich'
  const geteilt = (m.gleich ?? 1) > 1 ? ' geteilt' : ''
  return `Platz ${m.rang}${geteilt} von ${m.anzahl}`
}

/**
 * Die Begründung in einem Satz – aus den Zahlen, nicht je Gerät hinterlegt.
 *
 * Die Prüfungen halten sich an `fokus`, nicht an diesen Text: Eine bessere
 * Formulierung soll keine Prüfung rot machen.
 */
export function begruendung(fokus: Fokus, d: Messwert, e: Messwert): string {
  const dp = platzText(d)
  const ep = platzText(e)
  switch (fokus) {
    case 'schwierigkeit':
      return `Deine Ausführung stand auf ${ep}, deine Schwierigkeit auf ${dp}. `
        + 'Im unteren Teil des Feldes liegt damit die Schwierigkeit.'
    case 'ausfuehrung':
      return `Deine Schwierigkeit stand auf ${dp}, deine Ausführung auf ${ep}. `
        + 'Im unteren Teil des Feldes liegt damit die Ausführung.'
    case 'beides':
      return `Schwierigkeit (${dp}) und Ausführung (${ep}) lagen beide im unteren `
        + 'Teil des Feldes.'
    case 'halten':
      return `Weder Schwierigkeit (${dp}) noch Ausführung (${ep}) lag im unteren `
        + 'Teil des Feldes.'
    default:
      return 'Für einen Ansatzpunkt fehlen Vergleichswerte – D- und E-Wert des '
        + 'Feldes sind dafür nötig.'
  }
}

/* ==================================================== Gerät und Wettkampf */

export interface GeraetAnalyse {
  apparatus: string
  name: string
  d: Messwert
  e: Messwert
  final: Messwert
  /** Wie viele Turner in meiner Klasse standen, oder `null`. */
  feldgroesse: number | null
  fokus: Fokus
  begruendung: string
  /** Gibt es überhaupt gespeicherte Vergleichswerte zu diesem Gerät? */
  hatVergleich: boolean
}

export interface WettkampfAnalyse {
  wettkampf: GymCompetition
  /** Gegen wen verglichen wurde, wie beim Import festgehalten. */
  klasse: string | null
  feldgroesse: number | null
  geraete: GeraetAnalyse[]
  /** Der Mehrkampf im Feld, oder `null`. */
  mehrkampf: Messwert | null
  /** Relativ stärkste Geräte – höchste Endnotenposition, bei Gleichstand mehrere. */
  staerkste: string[]
  /** Relativ schwächste Geräte. */
  schwaechste: string[]
  /** Geräte mit der höchsten ROHEN Endnote. */
  hoechsteRohnote: string[]
  /**
   * Führt die rohe Bestnote in die Irre?
   *
   * Wahr, wenn das Gerät mit der höchsten Endnote nicht das relativ stärkste
   * ist. Genau der Fall, um den es in dieser Phase geht.
   */
  rohnoteTaeuscht: boolean
  /** Geräte mit benanntem Ansatzpunkt, die stärksten Hebel zuerst. */
  hebel: GeraetAnalyse[]
  /** Hat dieser Wettkampf überhaupt ein Vergleichsfeld? */
  hatVergleich: boolean
}

function vergleichsIndex(benchmarks: VergleichsWerte[]): Map<string, VergleichsWerte> {
  const out = new Map<string, VergleichsWerte>()
  for (const b of benchmarks) {
    if (b.deleted_at) continue
    out.set(`${b.competition_id}|${b.scope}`, b)
  }
  return out
}

/**
 * Ein Wettkampf, vollständig ausgewertet.
 *
 * `benchmarks` darf leer sein – dann stehen die Rohwerte da und sonst nichts.
 * Ein von Hand erfasster Wettkampf bekommt **keine** erfundenen Geräteplätze
 * und keinen erfundenen Median.
 */
export function wettkampfAnalyse(
  wettkampf: GymCompetition,
  ergebnisse: GymResult[],
  benchmarks: VergleichsWerte[],
): WettkampfAnalyse {
  const index = vergleichsIndex(benchmarks)
  return analyseMitIndex(wettkampf, ergebnisse, index)
}

function analyseMitIndex(
  wettkampf: GymCompetition,
  ergebnisse: GymResult[],
  index: Map<string, VergleichsWerte>,
): WettkampfAnalyse {
  const meine = ergebnisse.filter(
    (r) => !r.deleted_at && r.competition_id === wettkampf.id)

  const geraete: GeraetAnalyse[] = []
  let feldgroesse: number | null = null
  let klasse: string | null = null

  for (const g of GERAETE) {
    const r = meine.find((x) => x.apparatus === g.key)
    if (!r) continue
    const b = index.get(`${wettkampf.id}|${g.key}`) ?? null
    if (b) {
      feldgroesse = b.cohort_size
      klasse = b.cohort_label ?? klasse
    }
    const d = messwert(r.d_score ?? null, b?.d_rank, b?.d_tie_count, b?.d_count, b?.d_median, b?.d_best)
    const e = messwert(r.e_score ?? null, b?.e_rank, b?.e_tie_count, b?.e_count, b?.e_median, b?.e_best)
    const final = messwert(
      r.final_score ?? null,
      b?.final_rank, b?.final_tie_count, b?.final_count, b?.final_median, b?.final_best)
    const fokus = fokusVon(d, e, b ? b.cohort_size : null)
    geraete.push({
      apparatus: g.key,
      name: geraetName(g.key),
      d, e, final,
      feldgroesse: b ? b.cohort_size : null,
      fokus,
      begruendung: begruendung(fokus, d, e),
      hatVergleich: !!b,
    })
  }

  // Der Mehrkampfvergleich braucht die eigene Gesamtnote. Raeumt Erik sie im
  // Editor weg, stuende sonst "Platz 2 von 6" ohne eine eigene Zahl daneben.
  const mkB = index.get(`${wettkampf.id}|${MEHRKAMPF}`) ?? null
  const eigeneGesamt = wettkampf.score_allround
  const mehrkampf = mkB && eigeneGesamt !== null && eigeneGesamt !== undefined
    ? messwert(
      eigeneGesamt,
      mkB.final_rank, mkB.final_tie_count, mkB.final_count, mkB.final_median, mkB.final_best)
    : null
  if (mkB) {
    feldgroesse = mkB.cohort_size
    klasse = mkB.cohort_label ?? klasse
  }

  // Relativ staerkste und schwaechste: ueber die POSITION der Endnote, nicht
  // ueber die Endnote. Bei Gleichstand stehen mehrere da - eine Rangfolge zu
  // erzwingen, wo zwei Geraete gleich im Feld stehen, waere erfunden.
  const mitPosition = geraete.filter((g) => g.final.position !== null)
  const hoch = mitPosition.length
    ? Math.max(...mitPosition.map((g) => g.final.position as number)) : null
  const tief = mitPosition.length
    ? Math.min(...mitPosition.map((g) => g.final.position as number)) : null
  const staerkste = hoch === null ? []
    : mitPosition.filter((g) => g.final.position === hoch).map((g) => g.apparatus)
  const schwaechste = tief === null || hoch === tief ? []
    : mitPosition.filter((g) => g.final.position === tief).map((g) => g.apparatus)

  const mitNote = geraete.filter((g) => g.final.wert !== null)
  const rohHoch = mitNote.length
    ? Math.max(...mitNote.map((g) => g.final.wert as number)) : null
  const hoechsteRohnote = rohHoch === null ? []
    : mitNote.filter((g) => g.final.wert === rohHoch).map((g) => g.apparatus)

  const rohnoteTaeuscht = staerkste.length > 0 && hoechsteRohnote.length > 0
    && !hoechsteRohnote.some((a) => staerkste.includes(a))

  // Hebel: nur Geraete mit benanntem Ansatzpunkt, das schwaechste zuerst.
  const hebel = geraete
    .filter((g) => g.fokus === 'schwierigkeit' || g.fokus === 'ausfuehrung' || g.fokus === 'beides')
    .sort((a, b) => (a.final.position ?? 1) - (b.final.position ?? 1)
      || (geraet(a.apparatus)?.reihenfolge ?? 99) - (geraet(b.apparatus)?.reihenfolge ?? 99))

  return {
    wettkampf,
    klasse,
    feldgroesse,
    geraete,
    mehrkampf,
    staerkste,
    schwaechste,
    hoechsteRohnote,
    rohnoteTaeuscht,
    hebel,
    hatVergleich: geraete.some((g) => g.hatVergleich) || !!mkB,
  }
}

/* ============================================================= Verlauf */

export interface VerlaufsPunkt {
  competitionId: string
  day: DayString
  name: string
  d: number | null
  e: number | null
  final: number | null
  /** Aus den Vergleichswerten, falls vorhanden. */
  rang: number | null
  gleich: number | null
  anzahl: number | null
  position: number | null
  abstandMedian: number | null
}

/** Ob die Werte eines Verlaufs in eine Richtung gehen – rein beschreibend. */
export type Richtung = 'hoeher' | 'niedriger' | 'gemischt' | 'zu_wenig'

/**
 * Die Richtung einer Reihe – und nichts über deren Ursache.
 *
 * Nur bei durchgehend steigenden oder durchgehend fallenden Werten wird eine
 * Richtung genannt. Alles andere ist `gemischt`; aus drei Zahlen, die auf und
 * ab gehen, eine Tendenz zu lesen wäre Rauschen mit Überschrift.
 *
 * Lücken zählen nicht mit: Ein Wettkampf ohne diesen Wert unterbricht die Reihe
 * nicht, er kommt in ihr nur nicht vor.
 */
export function richtung(werte: (number | null)[]): Richtung {
  const da = werte.filter((w): w is number => w !== null && Number.isFinite(w))
  if (da.length < MINDESTWETTKAEMPFE_FUER_TREND) return 'zu_wenig'
  let steigt = true
  let faellt = true
  for (let i = 1; i < da.length; i++) {
    if (da[i] <= da[i - 1]) steigt = false
    if (da[i] >= da[i - 1]) faellt = false
  }
  if (steigt) return 'hoeher'
  if (faellt) return 'niedriger'
  return 'gemischt'
}

/**
 * Der Verlauf an einem Gerät über die Wettkämpfe – chronologisch.
 *
 * **Keine Durchschnittsplätze.** „2. von 3" und „2. von 20" sind nicht
 * dasselbe, und ihr Mittel wäre keine Zahl, die etwas bedeutet. Vergleichbar
 * gemacht wird über `position`, in die die Feldgrösse eingeht.
 */
export function geraetVerlauf(
  apparatus: string,
  wettkaempfe: GymCompetition[],
  ergebnisse: GymResult[],
  benchmarks: VergleichsWerte[],
): VerlaufsPunkt[] {
  const index = vergleichsIndex(benchmarks)
  const wkVon = new Map<string, GymCompetition>()
  for (const w of wettkaempfe) {
    if (!w.deleted_at) wkVon.set(w.id, w)
  }

  const punkte: VerlaufsPunkt[] = []
  for (const r of ergebnisse) {
    if (r.deleted_at || r.apparatus !== apparatus) continue
    const w = wkVon.get(r.competition_id)
    if (!w) continue
    const b = index.get(`${w.id}|${apparatus}`) ?? null
    const final = r.final_score ?? null
    punkte.push({
      competitionId: w.id,
      day: w.day,
      name: w.name,
      d: r.d_score ?? null,
      e: r.e_score ?? null,
      final,
      rang: b?.final_rank ?? null,
      gleich: b?.final_tie_count ?? null,
      anzahl: b?.final_count ?? null,
      position: positionAus(b?.final_rank, b?.final_tie_count, b?.final_count),
      abstandMedian: final !== null && b?.final_median !== null && b?.final_median !== undefined
        ? rund(final - b.final_median) : null,
    })
  }
  return punkte.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

/* ========================================================== Gesamtbild */

export interface AnalyseBild {
  /** Der jüngste Wettkampf mit Ergebnissen, vollständig ausgewertet. */
  aktuell: WettkampfAnalyse | null
  /** Verlauf je Gerät, chronologisch. Nur Geräte mit mindestens einem Start. */
  verlauf: Map<string, VerlaufsPunkt[]>
  /** Wettkämpfe mit Ergebnissen, jüngste zuerst – nur Kopfdaten. */
  wettkaempfe: GymCompetition[]
  /** Wie viele davon ein Vergleichsfeld haben. */
  mitVergleich: number
}

/**
 * Alles, was der Analysereiter braucht – in einem Durchgang.
 *
 * Bewusst **ein** Aufruf und nicht sechs: Die Oberfläche merkt sich das
 * Ergebnis (`useMemo`) und wertet nicht bei jedem Zeichnen neu aus. Die
 * Wettkämpfe werden nur einmal indiziert; ausgewertet wird der jüngste, die
 * übrigen liefern ihre Verlaufspunkte.
 */
export function analyseBild(
  wettkaempfe: GymCompetition[],
  ergebnisse: GymResult[],
  benchmarks: VergleichsWerte[],
): AnalyseBild {
  const index = vergleichsIndex(benchmarks)

  const offen = wettkaempfe.filter((w) => !w.deleted_at)
  const mitErgebnis = new Set<string>()
  for (const r of ergebnisse) {
    if (!r.deleted_at) mitErgebnis.add(r.competition_id)
  }
  const relevant = offen
    .filter((w) => mitErgebnis.has(w.id))
    .sort((a, b) => (a.day > b.day ? -1 : a.day < b.day ? 1 : 0))

  const aktuell = relevant.length
    ? analyseMitIndex(relevant[0], ergebnisse, index) : null

  const verlauf = new Map<string, VerlaufsPunkt[]>()
  for (const g of GERAETE) {
    const punkte = geraetVerlauf(g.key, offen, ergebnisse, benchmarks)
    if (punkte.length) verlauf.set(g.key, punkte)
  }

  let mitVergleich = 0
  for (const w of relevant) {
    const hat = GERAETE.some((g) => index.has(`${w.id}|${g.key}`))
      || index.has(`${w.id}|${MEHRKAMPF}`)
    if (hat) mitVergleich++
  }

  return { aktuell, verlauf, wettkaempfe: relevant, mitVergleich }
}
