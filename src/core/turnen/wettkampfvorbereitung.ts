/**
 * Wettkampfvorbereitung: Welcher Wettkampf kommt als Nächstes, und was sagen
 * meine aktuellen Daten je Gerät dazu?
 *
 * ---------------------------------------------------------------------------
 * Eine Zusammenführung, keine zweite Bewertung
 *
 * Dieses Modul rechnet **nichts** neu aus. Es gibt genau drei eigene
 * Gedankengänge:
 *
 *   1. Welcher Wettkampf kommt als Nächstes (über `kuenftigeWettkaempfe`).
 *   2. Wie viele Kalendertage es bis dahin sind (über `tagDifferenz`).
 *   3. Welche Geräte die Vorbereitung überhaupt betrifft (21.6).
 *
 * Alles andere kommt fertig herein:
 *
 *   - Elementstabilität je Kürelement → Phase 2D (`trainingsfokus.ts`)
 *   - Lage der Kür aus ihren Elementen → Phase 2D (`lageAus`)
 *   - Kür am Stück → Phase 2E (`kuerdurchgaenge.ts`)
 *   - auffällige Kürelemente → Phase 2D (`GeraetFokus.auffaellige`)
 *   - Schwierigkeitssumme → Phase 2A (`schwierigkeitAus`)
 *   - letzter Wettkampf mit relativer Position → Phase 2C (`analyse.ts`)
 *   - Fassungsidentität der Kür → Phase 2E/2A (`fassungsId`, über
 *     `KuerDurchgaenge.fassungId`)
 *
 * Es gibt deshalb keine zweite Element-, Kür-, Fokus- oder Fassungsrechnung,
 * und bei einer Änderung an 2D oder 2E ändert sich diese Ansicht mit.
 *
 * ---------------------------------------------------------------------------
 * Kein Readiness Score
 *
 * Es gibt hier **keine Zahl von 0 bis 100** und nichts, was „82 %
 * wettkampfbereit" heisst. Eine solche Zahl müsste Elementstabilität,
 * Kürstabilität, Schwierigkeit, Tagesform, Wettkampferfahrung und den
 * Zeitabstand gegeneinander gewichten – und für keine dieser Gewichtungen
 * steht in LifeHub eine Grundlage. Sie wäre Scheingenauigkeit: eine Zahl, die
 * genau aussieht, weil sie zwei Stellen hat.
 *
 * Stattdessen stehen die Dimensionen **getrennt** nebeneinander: Kür
 * vorhanden, Elemente, Kür am Stück, letzter vollständiger Durchgang. Jede
 * davon ist für sich nachvollziehbar und zeigt, woraus sie entstand.
 *
 * `GeraeteStand` fasst sie zu einer Kategorie zusammen – aber nur zu einer
 * **beobachtenden**: `stabile_basis` heisst „die erfassten Trainingsdaten
 * zeigen keine der definierten offenen Baustellen" und ausdrücklich nicht
 * „wettkampfbereit".
 *
 * ---------------------------------------------------------------------------
 * Keine Trainingswissenschaft
 *
 * Es steht nirgends, ob 24 Tage reichen, ob Erik spät dran ist, ob jetzt eine
 * Belastungsspitze oder eine Entlastung angebracht wäre, oder ob unter
 * vierzehn Tagen keine neuen Elemente mehr dazukommen sollten. Dazu müsste
 * LifeHub ein Periodisierungsmodell haben; es hat keines, und ein erfundenes
 * wäre schlimmer als keines (TURNEN_ARCHITEKTUR.md, 21.14).
 *
 * Der Countdown ist **ausschliesslich kalendarisch**.
 *
 * ---------------------------------------------------------------------------
 * Keine Kausalität zwischen Wettkampf und Training
 *
 * Ein E-Wert im Protokoll gehört zur ganzen Kür, nicht zu einem Element. Es
 * steht deshalb nirgends „Reck ist schwach, weil Element X unsicher ist".
 * Die beiden Beobachtungen stehen **getrennt** da – im Training fallen diese
 * Elemente auf, und im letzten Wettkampf lag die Ausführung dort und dort im
 * Feld –, und was daraus folgt, entscheidet Erik.
 *
 * ---------------------------------------------------------------------------
 * Keine Tabelle, keine Schemaänderung
 *
 * Ein künftiger Wettkampf ist eine ganz gewöhnliche Zeile in
 * `gym_competitions`, deren `day` in der Zukunft liegt und zu der es noch
 * keine `gym_results` gibt. Countdown, Status und Gerätestand sind
 * **gerechnet** – es gibt keine Tabelle für Wettkampfbereitschaft, keine für
 * Wettkampfziele und kein `status`-Feld am Wettkampf (21.2).
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import { relativeDay } from '../dates'
import type { GymCompetition, GymResult } from '../types'
import { GERAETE } from './geraete'
import { kuenftigeWettkaempfe, vergangeneWettkaempfe } from './wettkampf'
import { schwierigkeitAus, type Schwierigkeit } from './kueren'
import {
  DURCHGANG_LAGE_LABEL,
  type DurchgangsBild, type KuerDurchgangsLage,
} from './kuerdurchgaenge'
// Das Beobachtungsfenster des ganzen Moduls - 56 Tage, eine Quelle.
import { SCHWELLEN } from './sicherheit'
import {
  LAGE_LABEL, STABILITAET_LABEL,
  type ElementLage, type GeraetFokus, type TrainingsfokusBild, type TrainingsLage,
} from './trainingsfokus'
import {
  MINDESTFELD_FUER_FOKUS, liegtUnten,
  type Messwert, type WettkampfAnalyse,
} from './analyse'

/* ========================================================== Countdown */

/** Bis zu dieser Spanne formuliert `relativeDay()` selbst. */
export const RELATIVER_TAG_GRENZE = 7

/**
 * Wie weit der Wettkampf weg ist – in Worten.
 *
 * Bis zu einer Woche übernimmt das der vorhandene `relativeDay()`: „heute",
 * „morgen", „übermorgen", „in 5 Tagen". Darüber hinaus zeigt er das Datum,
 * und das ist hier zu wenig – „in 24 Tagen" ist die Auskunft, nach der man
 * sucht. Deshalb nur jenseits seiner Grenze eine eigene Formulierung, und
 * zwar mit derselben Wortwahl.
 *
 * Gerechnet wird **nicht** hier: `tageHin` kommt aus `tagDifferenz` über zwei
 * lokale Kalendertage. Kein `toISOString()`, keine 86 400 000, keine zweite
 * Tageslogik.
 */
export function countdownText(day: DayString, heute: DayString, tageHin: number): string {
  if (Math.abs(tageHin) <= RELATIVER_TAG_GRENZE) return relativeDay(day, heute)
  return tageHin > 0 ? `in ${tageHin} Tagen` : `vor ${-tageHin} Tagen`
}

/* ===================================================== Geräteumfang */

/**
 * Woher die Liste der Geräte kommt, auf die sich die Vorbereitung bezieht.
 *
 * **LifeHub weiss nicht, welche Geräte ein Wettkampf umfasst.**
 * `gym_competitions` hat kein solches Feld, und es ist auch nicht ableitbar:
 * Ein künftiger Wettkampf hat noch keine Ergebniszeilen, aus denen sich der
 * Geräteumfang ergäbe, und ob ein Wettkampf Mehrkampf oder Gerätefinale ist,
 * steht nirgends. Ein erfundenes „alle sechs Geräte" wäre bei jedem
 * Gerätefinale falsch (TURNEN_ARCHITEKTUR.md, 21.6).
 *
 * Deshalb wird **abgeleitet statt behauptet**, in dieser Reihenfolge:
 *
 *   `ergebniszeilen`  Zu diesem Wettkampf stehen schon Ergebniszeilen – dann
 *                     sind das die Geräte, an denen gestartet wird. Das ist
 *                     die genaueste Auskunft, die es gibt.
 *   `wettkampfkueren` Sonst die Geräte mit einer aktiven Wettkampfkür. Das ist
 *                     eine Annahme über die Vorbereitung, keine über den
 *                     Wettkampf – und die Oberfläche sagt das dazu.
 *   `keine`           Weder noch: Es gibt nichts zu zeigen.
 */
export type GeraeteHerkunft = 'ergebniszeilen' | 'wettkampfkueren' | 'keine'

export const HERKUNFT_TEXT: Record<GeraeteHerkunft, string> = {
  ergebniszeilen: 'Geräte aus den bereits erfassten Ergebniszeilen dieses Wettkampfs.',
  wettkampfkueren:
    'Geräte aus den aktuellen Wettkampfküren. Welche Geräte dieser Wettkampf '
    + 'umfasst, erfasst LifeHub nicht.',
  keine: 'Es ist keine aktive Wettkampfkür hinterlegt.',
}

export function geraeteUmfang(
  wettkampf: GymCompetition | null,
  ergebnisse: GymResult[],
  fokus: TrainingsfokusBild,
): { keys: string[]; herkunft: GeraeteHerkunft } {
  // Immer in Wettkampfreihenfolge, nie in der Reihenfolge der Datenzeilen.
  const reihe = (keys: Set<string>) => GERAETE.filter((g) => keys.has(g.key)).map((g) => g.key)

  if (wettkampf) {
    const ausErgebnissen = new Set(
      ergebnisse
        .filter((r) => !r.deleted_at && r.competition_id === wettkampf.id)
        .map((r) => r.apparatus))
    if (ausErgebnissen.size) {
      return { keys: reihe(ausErgebnissen), herkunft: 'ergebniszeilen' }
    }
  }

  const mitKuer = new Set(fokus.geraete.filter((g) => g.kuer).map((g) => g.apparatus))
  if (mitKuer.size) return { keys: reihe(mitKuer), herkunft: 'wettkampfkueren' }

  return { keys: [], herkunft: 'keine' }
}

/* ======================================================= Gerätestand */

/**
 * Die zusammenfassende Kategorie je Gerät – **beobachtend, nicht bewertend.**
 *
 * Sie entsteht ausschliesslich aus zwei vorhandenen Kategorien: der Lage der
 * Kürelemente aus Phase 2D (`TrainingsLage`) und der Lage der Durchgänge aus
 * Phase 2E (`KuerDurchgangsLage`). Es kommt keine dritte Messung dazu und
 * keine Gewichtung – dieselben Eingaben ergeben in `Analyse` und hier
 * dieselben Worte.
 *
 * Die Reihenfolge ist die Dringlichkeit:
 *
 *   | Kategorie | wann |
 *   |---|---|
 *   | `kuer_fehlt` | keine aktive Wettkampfkür am Gerät |
 *   | `elemente_auffaellig` | Phase 2D sagt `gemischt` oder `instabil` |
 *   | `kuer_am_stueck_auffaellig` | Phase 2E sagt `gemischt` oder `instabil` |
 *   | `daten_fehlen` | eine der beiden Seiten hat zu wenig Daten |
 *   | `stabile_basis` | beide Seiten sagen `stabil` |
 *
 * `elemente_auffaellig` verdeckt dabei **nichts**: Die Lage der Durchgänge
 * steht in der Anzeige daneben, immer. Die Kategorie entscheidet nur, was
 * zuerst ins Auge fällt.
 *
 * **`stabile_basis` ist keine Zusage.** Es heisst: Die aktuell erfassten
 * Trainingsdaten zeigen keine der hier definierten offenen Baustellen. Über
 * den Wettkampftag sagt es nichts – nicht über die Tagesform, nicht über die
 * Halle, nicht über das Kampfgericht und nicht über die Nerven.
 */
export type GeraeteStand =
  | 'kuer_fehlt'
  | 'elemente_auffaellig'
  | 'kuer_am_stueck_auffaellig'
  | 'daten_fehlen'
  | 'stabile_basis'

export const STAND_LABEL: Record<GeraeteStand, string> = {
  kuer_fehlt: 'keine Wettkampfkür',
  elemente_auffaellig: 'Kürelemente auffällig',
  kuer_am_stueck_auffaellig: 'Kür am Stück auffällig',
  daten_fehlen: 'zu wenig Daten',
  stabile_basis: 'keine offenen Punkte',
}

/**
 * Was die Kategorie bedeutet – an EINER Stelle formuliert.
 *
 * Damit die Einschränkung zu `stabile_basis` nirgends verlorengeht: Eine
 * Oberfläche, die die Kategorie selbst beschriftet, lässt den Vorbehalt beim
 * zweiten Einbau weg.
 */
export const STAND_ERKLAERUNG: Record<GeraeteStand, string> = {
  kuer_fehlt:
    'An diesem Gerät ist keine Kür als Wettkampfkür gesetzt – damit gibt es '
    + 'keine Grundlage, gegen die sich der Trainingsstand lesen liesse.',
  elemente_auffaellig:
    'Einzelne Elemente der Kür fallen im Training auf. Die Gründe stehen je '
    + 'Element daneben.',
  kuer_am_stueck_auffaellig:
    'Die Einzelelemente stehen, die ganze Kür am Stück bisher nicht '
    + 'durchgängig sauber.',
  daten_fehlen:
    'Zu wenig erfasste Versuche oder Durchgänge für eine Aussage. Das ist '
    + 'keine Aussage über die Kür, sondern über die Datenlage.',
  stabile_basis:
    'Die aktuell erfassten Trainingsdaten zeigen keinen der definierten '
    + 'offenen Punkte. Das ist keine Zusage über den Wettkampf.',
}

const AUFFAELLIG_LAGE: TrainingsLage[] = ['gemischt', 'instabil']
const AUFFAELLIG_DURCHGANG: KuerDurchgangsLage[] = ['gemischt', 'instabil']

export function standAus(
  lage: TrainingsLage,
  durchgangsLage: KuerDurchgangsLage,
): GeraeteStand {
  if (lage === 'keine_kuer') return 'kuer_fehlt'
  if (AUFFAELLIG_LAGE.includes(lage)) return 'elemente_auffaellig'
  if (AUFFAELLIG_DURCHGANG.includes(durchgangsLage)) return 'kuer_am_stueck_auffaellig'
  if (lage === 'zu_wenig_daten' || durchgangsLage === 'zu_wenig_daten') return 'daten_fehlen'
  return 'stabile_basis'
}

/* ==================================================== Letzter Start */

/**
 * Was am letzten ausgewerteten Wettkampf an diesem Gerät stand.
 *
 * Rein beschreibend und **vollständig aus Phase 2C übernommen** – inklusive
 * der relativen Position im Feld. Fehlende Werte bleiben `null` und werden
 * nirgends als 0 gezeigt.
 */
export interface LetzterStart {
  day: DayString
  name: string
  /**
   * Die Messwerte aus Phase 2C – **durchgereicht, nicht kopiert.**
   *
   * Jeder trägt Wert, Rang, Feldgrösse, Median und Bestwert so, wie 2C sie
   * gerechnet hat. Beschriftet wird mit `platzImFeld()` aus demselben Modul;
   * die interne Vergleichszahl `position` erscheint nirgends in der
   * Oberfläche.
   */
  d: Messwert
  e: Messwert
  final: Messwert
  /** Die Feldgrösse, oder `null` ohne Vergleichsfeld. */
  feldgroesse: number | null
  /**
   * Lag die Endnote im unteren Teil des Feldes? `null` = nicht sagbar.
   *
   * Über `liegtUnten()` aus Phase 2C und nur ab `MINDESTFELD_FUER_FOKUS`
   * Turnern: In einem Feld von zwei kann die Position nur 0 oder 1 sein, und
   * „unter der Feldmitte" wäre dort ein Münzwurf.
   *
   * **Keine Verbindung zum Training.** Diese Angabe steht neben den
   * auffälligen Elementen und nicht als deren Folge (21.10).
   */
  endnoteUnten: boolean | null
  /** Dasselbe für den E-Wert (Ausführung). */
  ausfuehrungUnten: boolean | null
  /** Die damals geturnte, eingefrorene Kürfassung – oder `null`. */
  versionId: string | null
}

/* =================================================== Gerätestand ganz */

/** Was sich zu einem Gerät für den kommenden Wettkampf sagen lässt. */
export interface GeraetVorbereitung {
  apparatus: string
  name: string
  /** Die zusammenfassende Kategorie – siehe `GeraeteStand`. */
  stand: GeraeteStand

  /* -------------------------------------------------- Wettkampfkür */
  /** Name der aktiven Wettkampfkür, oder `null`: keine hinterlegt. */
  kuerName: string | null
  /** Schwierigkeitssumme der Kürelemente. **Kein D-Wert.** `null` ohne Kür. */
  schwierigkeit: Schwierigkeit | null
  /** Plätze der Kür, deren Element gelöscht wurde. */
  geloeschtePlaetze: number[]

  /* ------------------------------------------- Einzelelemente (2D) */
  /** Die Lage der Kürelemente – unverändert aus Phase 2D. */
  elementLage: TrainingsLage
  /** Zahl der Kürelemente mit vorhandenem Element. */
  elemente: number
  /** Auffällige Kürelemente, das dringendste zuerst – aus Phase 2D. */
  auffaellige: ElementLage[]

  /* ------------------------------------------- Kür am Stück (2E) */
  /** Die Lage der Durchgänge – unverändert aus Phase 2E. */
  durchgangsLage: KuerDurchgangsLage
  /** Die Durchgänge der **aktuellen** Fassung im Fenster, oder `null`. */
  durchgaenge: DurchgangsBild | null
  /** Durchgänge **früherer** Fassungen – nie hinzugezählt (Phase 2E). */
  fruehere: { durchgaenge: number; fassungen: number } | null
  /**
   * Die aktuelle Kürfassung hat noch keinen Durchgang, eine frühere schon.
   *
   * Der Fall aus Abschnitt 21.13: acht stabile Durchgänge der alten Fassung
   * sagen über die neue nichts. Die Anzeige muss dann „aktuelle Fassung noch
   * nicht erfasst" sagen und nicht „8 stabile Durchgänge".
   */
  neueFassung: boolean

  /* ------------------------------------------- Letzter Wettkampf (2C) */
  letzterStart: LetzterStart | null
  /**
   * Weicht die aktuelle Kür von der beim letzten Wettkampf geturnten ab?
   *
   * `null` heisst **nicht entscheidbar**: Es gibt keinen letzten Start, am
   * Start war keine Fassung hinterlegt, oder es gibt heute keine Kür. Ein
   * `false` an dieser Stelle wäre eine Behauptung.
   *
   * Verglichen werden die **Inhalts-IDs** aus `fassungsId()` – dieselbe
   * Rechnung, die auch die Durchgänge einer Fassung zuordnet. Keine zweite
   * Versionierungslogik.
   */
  kuerGeaendert: boolean | null

  /** Fertig formulierte Beobachtungen, in der Reihenfolge der Anzeige. */
  hinweise: string[]
}

/* ========================================================= Gesamtbild */

export interface WettkampfZiel {
  /** Der nächste bevorstehende Wettkampf, oder `null`. */
  naechster: GymCompetition | null
  /** Kalendertage bis dahin: 0 = heute. `null` ohne Wettkampf. */
  tageHin: number | null
  /** „in 24 Tagen", „morgen", „heute". `null` ohne Wettkampf. */
  countdown: string | null
  /** Weitere bevorstehende Wettkämpfe, chronologisch – ohne den nächsten. */
  weitere: GymCompetition[]
  /**
   * Vergangene Wettkämpfe ohne eine einzige Ergebniszeile, jüngster zuerst.
   *
   * **Keine Annahme über eine Teilnahme.** Festgestellt wird allein, dass der
   * Termin vorbei ist und noch nichts erfasst wurde (21.9). Nichts wird
   * automatisch erzeugt, kein Status gesetzt, keine Platzierung geraten.
   */
  ohneErgebnis: GymCompetition[]
  /** Die Geräte der Vorbereitung, in Wettkampfreihenfolge. */
  geraete: GeraetVorbereitung[]
  /** Woher der Geräteumfang kommt – siehe `GeraeteHerkunft`. */
  herkunft: GeraeteHerkunft
}

export interface WettkampfZielEingang {
  wettkaempfe: GymCompetition[]
  ergebnisse: GymResult[]
  /**
   * Der fertige Trainingsfokus aus Phase 2D/2E.
   *
   * Er trägt je Gerät die aktive Wettkampfkür, die Lage ihrer Elemente, die
   * auffälligen Elemente und die Durchgänge der aktuellen Fassung. Genau
   * deshalb braucht dieses Modul weder Elemente noch Versuche noch Küren
   * selbst – es würde dieselben Rechnungen ein zweites Mal anstellen.
   */
  fokus: TrainingsfokusBild
  /** Der jüngste ausgewertete Wettkampf aus Phase 2C, oder `null`. */
  analyse: WettkampfAnalyse | null
  heute: DayString
  tagDifferenz: (von: DayString, bis: DayString) => number
}

/**
 * Der ganze Wettkampfstand – in einem Durchgang.
 *
 * Bewusst **ein** Aufruf, wie `trainingsfokus()` und `trainingsplanung()`: Die
 * Oberfläche merkt sich das Ergebnis und rechnet nicht bei jedem Zeichnen neu.
 * Innerhalb dieser Funktion ist alles ein Nachschlagen – die Wettkämpfe werden
 * einmal sortiert, die Ergebniszeilen des letzten Wettkampfs einmal indiziert.
 */
export function wettkampfvorbereitung(e: WettkampfZielEingang): WettkampfZiel {
  const kuenftig = kuenftigeWettkaempfe(e.wettkaempfe, e.heute)
  const naechster = kuenftig[0] ?? null
  const tageHin = naechster ? e.tagDifferenz(e.heute, naechster.day) : null

  const { keys, herkunft } = geraeteUmfang(naechster, e.ergebnisse, e.fokus)
  const fokusVon = new Map<string, GeraetFokus>()
  for (const g of e.fokus.geraete) fokusVon.set(g.apparatus, g)

  /* Der letzte Wettkampf: der jüngste AUSGEWERTETE aus Phase 2C – aber nur,
     wenn er wirklich vorbei ist. Wer am Wettkampftag schon Noten eintraegt,
     soll nicht „seit dem letzten Wettkampf" ueber denselben Wettkampf lesen,
     der gerade noch als der naechste darueber steht. */
  const analyse = e.analyse && e.analyse.wettkampf.day < e.heute ? e.analyse : null
  const analyseVon = new Map<string, WettkampfAnalyse['geraete'][number]>()
  for (const g of analyse?.geraete ?? []) analyseVon.set(g.apparatus, g)
  const versionVon = new Map<string, string | null>()
  if (analyse) {
    for (const r of e.ergebnisse) {
      if (r.deleted_at || r.competition_id !== analyse.wettkampf.id) continue
      versionVon.set(r.apparatus, r.routine_version_id ?? null)
    }
  }

  const geraete: GeraetVorbereitung[] = []
  for (const key of keys) {
    const f = fokusVon.get(key)
    if (!f) continue
    geraete.push(geraetVorbereitung(
      f, analyse, analyseVon.get(key) ?? null, versionVon.get(key) ?? null))
  }

  return {
    naechster,
    tageHin,
    countdown: naechster && tageHin !== null
      ? countdownText(naechster.day, e.heute, tageHin) : null,
    weitere: kuenftig.slice(1),
    ohneErgebnis: wettkaempfeOhneErgebnis(e.wettkaempfe, e.ergebnisse, e.heute),
    geraete,
    herkunft,
  }
}

/**
 * Vergangene Wettkämpfe, zu denen keine einzige Ergebniszeile steht.
 *
 * Nur eine Feststellung über die Datenlage. Ein vergangenes Datum heisst
 * **nicht**, dass teilgenommen wurde – es kann ein abgesagter Termin sein,
 * eine Verletzung, eine Absage. Deshalb entsteht hier nichts: kein Ergebnis,
 * kein Status, keine Platzierung (21.9).
 */
export function wettkaempfeOhneErgebnis(
  wettkaempfe: GymCompetition[],
  ergebnisse: GymResult[],
  heute: DayString,
): GymCompetition[] {
  const mitErgebnis = new Set<string>()
  for (const r of ergebnisse) {
    if (!r.deleted_at) mitErgebnis.add(r.competition_id)
  }
  return vergangeneWettkaempfe(wettkaempfe, heute).filter((w) => !mitErgebnis.has(w.id))
}

/* ==================================================== Ein Gerät */

function geraetVorbereitung(
  f: GeraetFokus,
  analyse: WettkampfAnalyse | null,
  g: WettkampfAnalyse['geraete'][number] | null,
  versionId: string | null,
): GeraetVorbereitung {
  const stand = standAus(f.lage, f.durchgangsLage)

  /* Die Schwierigkeitssumme ueber dieselbe Funktion wie Kuerliste und
     Wettkampfdetail (`schwierigkeitAus`). Geloeschte Plaetze gehen als `null`
     mit ein: Sie zaehlen zur Zahl der Plaetze, steuern aber keinen Wert bei -
     genau so, wie es die Kuerliste auch zeigt. */
  const schwierigkeit = f.kuer
    ? schwierigkeitAus([
      ...f.kuerElemente.map((x) => x.element),
      ...f.geloeschtePlaetze.map(() => null),
    ])
    : null

  const aktuell = f.durchgaenge?.aktuell ?? null
  const fruehere = f.durchgaenge?.fruehere ?? null
  const neueFassung = !!f.kuer && !!aktuell && aktuell.durchgaenge === 0
    && !!fruehere && fruehere.durchgaenge > 0

  /* Ein grosses genug Feld fuer eine Aussage ueber "oben/unten"? Dieselbe
     Schwelle wie in 2C - nicht eine zweite daneben. */
  const genugFeld = !!g && g.feldgroesse !== null
    && g.feldgroesse >= MINDESTFELD_FUER_FOKUS

  const letzterStart: LetzterStart | null = analyse && g
    ? {
      day: analyse.wettkampf.day,
      name: analyse.wettkampf.name,
      d: g.d,
      e: g.e,
      final: g.final,
      feldgroesse: g.feldgroesse,
      endnoteUnten: genugFeld ? liegtUnten(g.final) : null,
      ausfuehrungUnten: genugFeld ? liegtUnten(g.e) : null,
      versionId,
    }
    : null

  /* Hat sich die Kuer seit dem letzten Wettkampf geaendert?
     Verglichen werden zwei Inhalts-IDs aus derselben Rechnung: die Fassung,
     auf die das damalige Ergebnis zeigt, und die ID des JETZIGEN Zustands der
     Kuer (`KuerDurchgaenge.fassungId`, gerechnet ueber `fassungsId`). Fehlt
     eine der beiden, ist die Frage nicht entscheidbar - dann `null`. */
  const jetzigeFassung = f.durchgaenge?.fassungId ?? null
  const kuerGeaendert = letzterStart?.versionId && jetzigeFassung
    ? letzterStart.versionId !== jetzigeFassung
    : null

  return {
    apparatus: f.apparatus,
    name: f.name,
    stand,
    kuerName: f.kuer?.name ?? null,
    schwierigkeit,
    geloeschtePlaetze: f.geloeschtePlaetze,
    elementLage: f.lage,
    elemente: f.kuerElemente.length,
    auffaellige: f.auffaellige,
    durchgangsLage: f.durchgangsLage,
    durchgaenge: aktuell,
    fruehere,
    neueFassung,
    letzterStart,
    kuerGeaendert,
    hinweise: hinweiseFuer(f, aktuell, fruehere, neueFassung, kuerGeaendert),
  }
}

/* ======================================================== Hinweise */

/** „heute", „gestern", „vor 5 Tagen" – aus einer Zahl von Tagen. */
export function vorTagen(tage: number): string {
  if (tage === 0) return 'heute'
  if (tage === 1) return 'gestern'
  return `vor ${tage} Tagen`
}

/**
 * Die Beobachtungen zu einem Gerät – fertig formuliert.
 *
 * An **einer** Stelle, damit dieselbe Lage überall gleich heisst und die
 * Oberfläche keine eigenen Sätze erfindet. Jeder Satz nennt eine vorhandene
 * Zahl oder eine vorhandene Kategorie; keiner zieht einen Schluss, und keiner
 * verbindet eine Trainingsbeobachtung mit einem Wettkampfwert.
 */
function hinweiseFuer(
  f: GeraetFokus,
  aktuell: DurchgangsBild | null,
  fruehere: { durchgaenge: number; fassungen: number } | null,
  neueFassung: boolean,
  kuerGeaendert: boolean | null,
): string[] {
  const out: string[] = []

  if (!f.kuer) {
    out.push('Keine Kür an diesem Gerät als Wettkampfkür gesetzt.')
    return out
  }

  if (f.geloeschtePlaetze.length) {
    out.push(f.geloeschtePlaetze.length === 1
      ? 'Ein Platz der Kür zeigt auf ein gelöschtes Element.'
      : `${f.geloeschtePlaetze.length} Plätze der Kür zeigen auf gelöschte Elemente.`)
  }

  out.push(`Einzelelemente: ${LAGE_LABEL[f.lage]}.`)
  if (f.auffaellige.length) {
    out.push(f.auffaellige.length === 1
      ? `Ein auffälliges Kürelement: ${f.auffaellige[0].element.name}.`
      : `${f.auffaellige.length} auffällige Kürelemente.`)
  }

  if (neueFassung && fruehere) {
    // Der Fall aus 21.13. Die Zahl der frueheren Durchgaenge steht dabei,
    // damit sichtbar ist, was NICHT mitgezaehlt wird.
    out.push(
      'Die aktuelle Kürfassung ist noch nicht erfasst – '
      + `${fruehere.durchgaenge === 1 ? 'ein Durchgang' : `${fruehere.durchgaenge} Durchgänge`} `
      + `${fruehere.fassungen === 1 ? 'einer früheren Fassung' : 'früherer Fassungen'} `
      + 'zählen dafür nicht.')
  } else if (!aktuell || aktuell.durchgaenge === 0) {
    out.push('Noch kein Kürdurchgang der aktuellen Fassung erfasst.')
  } else {
    out.push(
      `Kür am Stück: ${DURCHGANG_LAGE_LABEL[f.durchgangsLage]} `
      + `(${aktuell.sauber} von ${aktuell.durchgaenge} sauber `
      + `in ${SCHWELLEN.fensterTage} Tagen).`)
    out.push(aktuell.tageHerKomplett !== null
      ? `Letzte vollständige Kür: ${vorTagen(aktuell.tageHerKomplett)}.`
      : 'Noch kein vollständig geturnter Durchgang der aktuellen Fassung.')
  }

  if (kuerGeaendert === true) {
    // Beschreibend. Ausdruecklich NICHT "die neue Kuer ist besser" - dazu
    // fehlen die Wertungsregeln (21.10).
    out.push('Die Kür wurde seit dem letzten Wettkampf geändert.')
  }

  return out
}

/* =============================================== Anschluss an 3A/3B */

/**
 * Der kurze Wettkampfkontext für eine Kopfzeile – Phase 3B (21.12).
 *
 * Nur der Termin und der Abstand. **Keine zweite Wochenplanung**, keine
 * Verteilung, keine Aussage, was deshalb zu tun wäre.
 */
export function zielKurztext(ziel: WettkampfZiel): string | null {
  if (!ziel.naechster || !ziel.countdown) return null
  return `${ziel.naechster.name} · ${ziel.countdown}`
}

/**
 * Der Wettkampfkontext zu einem Gerät – Phase 3A (21.11).
 *
 * Zwei Zeilen höchstens: wie weit der Wettkampf weg ist, und wie es an diesem
 * Gerät aktuell steht. **Der Vorschlag selbst bleibt Phase 3A** – diese
 * Funktion ändert keine Priorität, keine Reihenfolge und keinen Inhalt, und
 * aus „in 12 Tagen" folgt hier nichts. Eine Periodisierung nach Tagen bis zum
 * Wettkampf gibt es in LifeHub nicht (21.14).
 */
export function wettkampfHinweis(ziel: WettkampfZiel, apparatus: string): string[] {
  if (!ziel.naechster || !ziel.countdown) return []
  const g = ziel.geraete.find((x) => x.apparatus === apparatus)
  if (!g) return []

  const zeilen = [`Wettkampf ${ziel.countdown}`]
  if (g.stand === 'kuer_fehlt') {
    zeilen.push('keine Wettkampfkür hinterlegt')
  } else if (AUFFAELLIG_DURCHGANG.includes(g.durchgangsLage)) {
    zeilen.push(`Kür am Stück ${DURCHGANG_LAGE_LABEL[g.durchgangsLage]}`)
  } else if (g.auffaellige.length) {
    zeilen.push(g.auffaellige.length === 1
      ? '1 auffälliges Kürelement'
      : `${g.auffaellige.length} auffällige Kürelemente`)
  }
  return zeilen
}

/** Die Stabilität eines einzelnen Kürelements, wie sie überall heisst. */
export function elementStabilitaetText(l: ElementLage): string {
  return STABILITAET_LABEL[l.stabilitaet]
}

/**
 * **Phase 3C bewertet keine Wettkampfbereitschaft.**
 *
 * Diese Konstante steht hier wie `ELEMENTE_SIND_NICHT_DIE_KUER` in
 * `trainingsfokus.ts`: als Merkposten im Quelltext. Wer hier einen Score, eine
 * Prozentzahl, eine Peaking-Kurve oder eine Aussage über die Erfolgsaussicht
 * einbaut, verlässt den Rahmen dieses Moduls – und zwar nicht aus Vorsicht,
 * sondern weil in LifeHub keine Daten dafür stehen.
 */
export const KEIN_READINESS_SCORE = true
