/**
 * Vorbereitungsstrategie: Wie verschiebt sich der Trainingsfokus, wenn der
 * Wettkampf näher kommt?
 *
 * ---------------------------------------------------------------------------
 * Eine Umpriorisierung, keine Periodisierung
 *
 * Phase 3C sagt, **welcher** Wettkampf kommt und wie es je Gerät steht. Phase
 * 3D sagt, **welche der bereits bekannten Trainingsinhalte** LifeHub deshalb
 * zuerst nennt. Mehr nicht.
 *
 * Es gibt hier deshalb **keine** Belastungskurve, keine Superkompensation,
 * kein Deload, kein Tapering, keine Volumen- oder Intensitätssteuerung, keine
 * Minuten, keine Wiederholungszahlen, nichts aus Schlaf, Puls oder HRV. Das
 * wären sportwissenschaftliche Modelle, und LifeHub hat keines. Was hier
 * steht, sind **Produktregeln**: In welcher Reihenfolge eine App vorhandene
 * Vorschläge nennt, ist eine Produktentscheidung und keine Aussage über
 * Trainingswirkung.
 *
 * ---------------------------------------------------------------------------
 * Die Abhängigkeitsrichtung
 *
 *     2C Analyse ─┐
 *     2E Durchgänge ─┤
 *                  ├─> 2D Trainingsfokus ─┬─> 3C Wettkampfvorbereitung ─┐
 *                                         │                             │
 *                                         └─> 3A Trainingsplanung ──────┤
 *                                                                       v
 *                                                      3D Vorbereitungsstrategie
 *                                                                       │
 *                                                                       v
 *                                                        angepasster 3A-Plan
 *                                                                       │
 *                                                                       v
 *                                                            3B Wochenplanung
 *
 * **3D sitzt hinter 3A, nicht davor.** `trainingsplanung.ts` importiert dieses
 * Modul ausdrücklich **nicht** – es weiss nichts von Wettkämpfen. Stattdessen
 * nimmt `planMitVorbereitung()` den fertigen 3A-Plan und gibt einen Plan
 * **derselben Form** zurück. Damit gibt es
 *
 *   - keine zirkuläre Abhängigkeit (3A → 3D → 3A wäre genau das),
 *   - keine Änderung an `wochenplanung.ts`: Phase 3B bekommt den angepassten
 *     Plan und verteilt ihn wie bisher (21.12 bleibt gültig),
 *   - und die Garantie, dass **ohne kommenden Wettkampf nichts passiert**:
 *     `planMitVorbereitung()` gibt dann dasselbe Objekt zurück, das es bekommen
 *     hat. Nicht eine gleich aussehende Kopie – dasselbe.
 *
 * ---------------------------------------------------------------------------
 * Keine zweite Berechnung
 *
 * Elementstabilität, Kürstabilität, Wettkampffokus, Konkurrenzposition und
 * Trainingspriorität kommen **fertig** herein: Die Leitlinie je Gerät ist eine
 * Umbenennung von `GeraetVorbereitung.stand` aus 3C, und der steht seinerseits
 * nur aus der 2D- und der 2E-Kategorie da. Dieses Modul rechnet nichts über
 * Versuche, Durchgänge, Küren oder Wettkämpfe – es liest Kategorien und
 * sortiert eine Liste um.
 *
 * ---------------------------------------------------------------------------
 * Was 3D ausdrücklich nicht tut
 *
 * **Keine Kürsperre.** LifeHub sagt nie „du darfst die Kür jetzt nicht mehr
 * ändern". Erik und sein Trainer entscheiden das; ändert er sie zwei Tage
 * vorher, greift Phase 2E wie immer (neue Fassung, alte Durchgänge zählen
 * nicht), und 3D stellt das sachlich fest, ohne es zu dramatisieren.
 *
 * **Keine automatische Küränderung** und kein automatisches Einbauen eines
 * Kandidaten – dieselbe Zurückhaltung wie in 2D und 3A.
 *
 * **Kein Gerät wird künstlich verschlechtert.** Ein Gerät, das laut Daten
 * stabil ist, bekommt durch einen nahen Wettkampf keine Problemaufgabe. Es
 * bekommt höchstens „Kür festigen" statt „Kandidat prüfen".
 *
 * **Kein Score.** Keine Zahl von 0 bis 100, keine Prozentangabe, keine
 * Punktprognose. Fünf benannte Phasen, und was jede bedeutet, steht
 * ausgeschrieben da.
 *
 * **Nichts wird gespeichert.** Die Phase ergibt sich aus heutigem Datum,
 * nächstem Wettkampf und aktuellen Trainingsdaten. Verschiebt Erik den
 * Wettkampf, ändert sie sich; löscht er ihn, verschwindet sie. Eine Tabelle
 * `training_phase`, `readiness` oder `competition_strategy` gibt es nicht und
 * wäre ab der nächsten Terminänderung falsch.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { GymCompetition } from '../types'
import {
  type GeraetPlan, type Inhalt, type InhaltArt, type PlanungsBild,
  type ReihenfolgeArt,
} from './trainingsplanung'
import type { GeraetVorbereitung, WettkampfZiel } from './wettkampfvorbereitung'

/* ========================================================== Schwellen */

/**
 * Die Zeitgrenzen der Vorbereitungsphasen – eine **Produktheuristik**.
 *
 * **Ausdrücklich nicht sportwissenschaftlich optimal.** Es gibt keine
 * Untersuchung, die sagt, dass vierzehn Tage vor einem Wettkampf etwas anderes
 * gilt als fünfzehn. Die Zahlen beantworten eine Produktfrage – ab wann nennt
 * LifeHub die Wettkampfkür zuerst? – und keine Trainingsfrage.
 *
 * Beide Zahlen sind **absichtlich keine neuen**: Sie sind die beiden
 * Zeitkonventionen, die das Turnen-Modul schon hat.
 *
 *   `wettkampfnahTage: 14`
 *      Der rollende Planungshorizont aus Phase 3B
 *      (`WOCHEN_SCHWELLEN.horizontTage`). Innerhalb dieser Spanne liegt
 *      **jede** Einheit, die LifeHub überhaupt vorausplant, zwischen heute und
 *      dem Wettkampf – es gibt dann keinen geplanten Termin mehr, der nach dem
 *      Wettkampf läge. Das ist der nachvollziehbarste Punkt, ab dem „die
 *      aktuelle Kür zuerst" eine Produktaussage ohne Erfindung ist.
 *
 *   `stabilisierungTage: 28`
 *      Dieselbe Spanne, nach der ein Gerät als „lange nicht trainiert" gilt
 *      (`KUER_SCHWELLEN.langeHerTage`, zugleich `PLAN_SCHWELLEN.wartungTage`).
 *      Darüber hinaus passt noch ein vollständiger Wartungsumlauf über alle
 *      Geräte, bevor der Wettkampf überhaupt in Sicht kommt.
 *
 * `tests/turnen-vorbereitungsstrategie.test.ts` rechnet die Gleichheit mit
 * diesen beiden vorhandenen Konstanten nach. Wer dort eine ändert, bekommt
 * einen roten Test und keine stille Verschiebung dieser Phasen.
 */
export const VORBEREITUNG_SCHWELLEN = {
  /** Bis zu so vielen Tagen vor dem Wettkampf gilt `wettkampfnah`. */
  wettkampfnahTage: 14,
  /** Bis zu so vielen Tagen gilt `stabilisierung`, darüber `entwicklung`. */
  stabilisierungTage: 28,
} as const

/* ============================================================= Phasen */

/**
 * Die Vorbereitungsphase – **global**, weil der Termin global ist.
 *
 *   | Tage bis zum Wettkampf | Phase |
 *   |---|---|
 *   | kein Wettkampf | `keine` |
 *   | 0 (heute) | `wettkampftag` |
 *   | 1 … 14 | `wettkampfnah` |
 *   | 15 … 28 | `stabilisierung` |
 *   | ab 29 | `entwicklung` |
 *
 * Die Tageszahl entscheidet **nur** über die Produktstrategie. Sie sagt nichts
 * darüber, ob Erik leistungsfähig, ausgeruht oder vorbereitet ist – dazu
 * stehen in LifeHub keine Daten, und 14 Tage sind für den einen viel und für
 * den anderen wenig.
 *
 * Die konkrete Empfehlung bleibt trotz der globalen Phase **gerätespezifisch**
 * (siehe `GeraetLeitlinie`): Ein naher Wettkampf heisst nicht, dass alle sechs
 * Geräte denselben Zustand haben.
 */
export type VorbereitungsPhase =
  | 'keine'
  | 'entwicklung'
  | 'stabilisierung'
  | 'wettkampfnah'
  | 'wettkampftag'

export const PHASE_LABEL: Record<VorbereitungsPhase, string> = {
  keine: 'kein Wettkampf eingetragen',
  entwicklung: 'Entwicklung',
  stabilisierung: 'Stabilisierung',
  wettkampfnah: 'wettkampfnah',
  wettkampftag: 'Wettkampftag',
}

/**
 * Was die Phase für die **Anzeige** bedeutet – an einer Stelle formuliert.
 *
 * Jeder Satz beschreibt, was LifeHub tut, und nicht, was im Training richtig
 * wäre. „LifeHub nennt … zuerst" ist eine Aussage über die App; „jetzt keine
 * neuen Elemente mehr" wäre eine über den Sport.
 */
export const PHASE_LEITSATZ: Record<VorbereitungsPhase, string | null> = {
  keine: null,
  entwicklung:
    'Bis zum Wettkampf ist noch Zeit – der Vorschlag bleibt unverändert, '
    + 'Entwicklungsarbeit eingeschlossen.',
  stabilisierung:
    'Die aktuelle Wettkampfkür wird gegenüber neuer Entwicklungsarbeit stärker '
    + 'gewichtet. Kandidaten bleiben sichtbar, stehen aber hinten.',
  wettkampfnah:
    'LifeHub nennt jetzt die aktuell geplante Wettkampfübung zuerst. '
    + 'Entwicklungskandidaten sind zurückgestellt, nicht verworfen.',
  wettkampftag:
    'Heute ist Wettkampf. Für diesen Tag schlägt LifeHub kein Training vor.',
}

export function phaseAus(tageHin: number | null): VorbereitungsPhase {
  if (tageHin === null || tageHin < 0) return 'keine'
  if (tageHin === 0) return 'wettkampftag'
  if (tageHin <= VORBEREITUNG_SCHWELLEN.wettkampfnahTage) return 'wettkampfnah'
  if (tageHin <= VORBEREITUNG_SCHWELLEN.stabilisierungTage) return 'stabilisierung'
  return 'entwicklung'
}

/** Greift 3D in dieser Phase überhaupt in den Vorschlag ein? */
export function phaseGreiftEin(phase: VorbereitungsPhase): boolean {
  return phase === 'stabilisierung' || phase === 'wettkampfnah' || phase === 'wettkampftag'
}

/* ======================================================== Leitlinie */

/**
 * Was an diesem Gerät für die Vorbereitung im Vordergrund steht.
 *
 * **Eine Umbenennung, keine Rechnung.** Sie entsteht ausschliesslich aus
 * `GeraetVorbereitung.stand` und `neueFassung` aus Phase 3C – und der Stand
 * entsteht seinerseits nur aus der 2D- und der 2E-Kategorie. Es kommt keine
 * dritte Messung dazu, und kein Gerät wird dadurch schlechter: Ein Gerät mit
 * `stabile_basis` bekommt `kuer_halten` und keine Problemaufgabe (21.17).
 */
export type GeraetLeitlinie =
  | 'keine_kuer'
  | 'daten_fehlen'
  | 'kuer_erfassen'
  | 'kuerelemente_zuerst'
  | 'kuer_am_stueck_zuerst'
  | 'kuer_halten'

export const LEITLINIE_LABEL: Record<GeraetLeitlinie, string> = {
  keine_kuer: 'keine Wettkampfkür hinterlegt',
  daten_fehlen: 'zu wenig Daten für eine Aussage',
  kuer_erfassen: 'aktuelle Kürfassung erfassen',
  kuerelemente_zuerst: 'offene Kürelemente zuerst',
  kuer_am_stueck_zuerst: 'die Kür am Stück zuerst',
  kuer_halten: 'Kür festigen und halten',
}

export function leitlinieAus(g: GeraetVorbereitung): GeraetLeitlinie {
  if (g.stand === 'kuer_fehlt') return 'keine_kuer'
  if (g.stand === 'elemente_auffaellig') return 'kuerelemente_zuerst'
  if (g.stand === 'kuer_am_stueck_auffaellig') return 'kuer_am_stueck_zuerst'
  if (g.stand === 'daten_fehlen') {
    // Der Fall aus 21.13: Die Kuer wurde geaendert, die alten Durchgaenge
    // gehoeren zur alten Fassung. Sachlich benannt, nicht dramatisiert.
    return g.neueFassung ? 'kuer_erfassen' : 'daten_fehlen'
  }
  return 'kuer_halten'
}

export interface GeraetStrategie {
  apparatus: string
  name: string
  leitlinie: GeraetLeitlinie
}

/* ========================================================= Gesamtbild */

export interface VorbereitungsBild {
  phase: VorbereitungsPhase
  /** Kalendertage bis zum Wettkampf, oder `null`. Aus Phase 3C übernommen. */
  tageHin: number | null
  /** „in 18 Tagen", „morgen", „heute" – aus Phase 3C übernommen. */
  countdown: string | null
  /** Der nächste Wettkampf, oder `null`. */
  wettkampf: GymCompetition | null
  /** Der erklärende Satz zur Phase, oder `null`. */
  leitsatz: string | null
  /**
   * Die Leitlinie je Gerät, in der Reihenfolge von Phase 3C.
   *
   * Nur Geräte, die Phase 3C überhaupt zum Wettkampf zählt – also keine
   * erfundenen sechs Geräte (21.6).
   */
  geraete: GeraetStrategie[]
}

/**
 * Die Vorbereitungsleitlinie – aus dem fertigen Phase-3C-Bild.
 *
 * Bewusst **ein** Argument und kein eigener Datenzugriff: Alles, was diese
 * Funktion braucht, hat Phase 3C schon gerechnet. Sie ist damit so billig,
 * dass sie neben dem 3C-Aufruf nicht messbar ins Gewicht fällt.
 */
export function vorbereitungsstrategie(ziel: WettkampfZiel): VorbereitungsBild {
  const phase = phaseAus(ziel.tageHin)
  return {
    phase,
    tageHin: ziel.tageHin,
    countdown: ziel.countdown,
    wettkampf: ziel.naechster,
    leitsatz: PHASE_LEITSATZ[phase],
    /* Ohne kommenden Wettkampf gibt es keine Vorbereitung - also auch keine
       Leitlinie je Geraet. Phase 3C fuehrt die Geraete mit aktiver
       Wettkampfkuer auch dann, wenn kein Termin ansteht (sie sind die
       Grundlage des Geraeteumfangs); daraus hier Vorbereitungsaussagen zu
       machen hiesse, eine Vorbereitung auf nichts zu behaupten. */
    geraete: phase === 'keine' ? [] : ziel.geraete.map((g) => ({
      apparatus: g.apparatus,
      name: g.name,
      leitlinie: leitlinieAus(g),
    })),
  }
}

/* =============================================== Eingriff in den Plan */

/**
 * Was Phase 3D an einem Gerät des 3A-Plans geändert hat.
 *
 * **Keine Blackbox.** Zu jedem Eingriff steht hier, was ohne Wettkampfkontext
 * im Vorschlag gestanden hätte und was sich dadurch verschoben hat. Beide
 * Listen entstehen aus dem tatsächlichen Unterschied und nicht aus einer
 * Vorlage – steht hier etwas, ist es auch passiert.
 */
export interface VorbereitungsAnpassung {
  apparatus: string
  name: string
  leitlinie: GeraetLeitlinie
  /** Inhalte, die 3D aus dem aktiven Vorschlag genommen hat. Nicht gelöscht. */
  zurueckgestellt: Inhalt[]
  /** Hat sich die Reihenfolge der verbliebenen Inhalte geändert? */
  umsortiert: boolean
  /** Was ohne Wettkampfkontext dagestanden hätte. */
  ohneWettkampf: string[]
  /** Was Phase 3D daran geändert hat, und warum. */
  durchVorbereitung: string[]
}

export interface VorbereiteterPlan {
  /**
   * Der angepasste Plan – **dieselbe Form** wie der 3A-Plan.
   *
   * Damit brauchen `planMitAuswahl()`, `nachwaehlbar()`, die Oberfläche und
   * Phase 3B keine Änderung. Greift 3D nicht ein, ist das **dasselbe Objekt**,
   * das hereinkam.
   */
  plan: PlanungsBild
  bild: VorbereitungsBild
  /** Je Gerät, was sich geändert hat. Leer heisst: nichts geändert. */
  anpassungen: Map<string, VorbereitungsAnpassung>
}

/**
 * Die Umsortierung je Phase – **nur die Entwicklungsarbeit bewegt sich.**
 *
 * Die Reihenfolge von `element` und `durchgang` bleibt ausdrücklich, wie Phase
 * 2D sie bestimmt hat (`reihenfolgeArtFuer`): Ob am Einzelelement oder an der
 * ganzen Übung zu arbeiten ist, hat 2D aus Elementstabilität und
 * Kürstabilität entschieden, und ein Wettkampftermin weiss darüber nichts.
 * Würde 3D daran drehen, wäre das eine zweite Antwort auf dieselbe Frage.
 *
 *   | Phase | Entwicklungsarbeit |
 *   |---|---|
 *   | `keine`, `entwicklung` | bleibt, wo sie ist |
 *   | `stabilisierung` | rutscht hinter Kürelemente und Kür am Stück |
 *   | `wettkampfnah`, `wettkampftag` | wird zurückgestellt |
 *
 * **Zurückgestellt heisst nicht verworfen.** Der Inhalt bleibt in
 * `VorbereitungsAnpassung.zurueckgestellt` stehen, die Oberfläche nennt ihn,
 * und nach dem Wettkampf steht er von selbst wieder im Vorschlag.
 */
const ENTWICKLUNG: InhaltArt = 'entwicklung'

/**
 * Kann das Zurückstellen ein Gerät leer zurücklassen?
 *
 * Nein, und das ist keine Hoffnung, sondern eine Folge der vorhandenen Regeln:
 * Ein Entwicklungsinhalt entsteht in 3A nur bei der 2D-Empfehlung
 * `schwierigkeit_pruefen`, die eine aktive Wettkampfkür voraussetzt – und
 * sobald eine Kür da ist, legt 3A immer auch einen Kürdurchgang in den Plan.
 * Diese Funktion prüft es trotzdem nach: Bliebe nichts übrig, wird nichts
 * zurückgestellt. Ein Gerät als leere Überschrift stehen zu lassen wäre
 * schlechter als ein Kandidat zu viel.
 */
function darfZurueckstellen(inhalte: Inhalt[]): boolean {
  return inhalte.some((i) => i.art !== ENTWICKLUNG)
}

/** Die verbliebenen Inhalte mit der Entwicklungsarbeit am Ende. */
function entwicklungNachHinten(inhalte: Inhalt[]): Inhalt[] {
  // Stabil: Die relative Reihenfolge von `element` und `durchgang` bleibt.
  const vorn = inhalte.filter((i) => i.art !== ENTWICKLUNG)
  const hinten = inhalte.filter((i) => i.art === ENTWICKLUNG)
  return [...vorn, ...hinten]
}

/**
 * Die Reihenfolgeangabe, nachdem die Entwicklungsarbeit nicht mehr vorn steht.
 *
 * `entwicklung_zuerst` wäre danach schlicht falsch – und der Satz dazu steht in
 * der Oberfläche. Übrig bleiben Kürelemente und die Kür am Stück in
 * unveränderter Reihenfolge, und genau das sagt `elemente_zuerst`. Jede andere
 * Angabe bleibt, wie 2D sie gesetzt hat.
 */
function reihenfolgeNach(art: ReihenfolgeArt): ReihenfolgeArt {
  return art === 'entwicklung_zuerst' ? 'elemente_zuerst' : art
}

/** Der Satz über den zurückgestellten Inhalt – an einer Stelle. */
function zurueckgestelltText(n: number): string {
  return n === 1
    ? '1 Entwicklungskandidat ist bis nach dem Wettkampf zurückgestellt.'
    : `${n} Entwicklungskandidaten sind bis nach dem Wettkampf zurückgestellt.`
}

/**
 * Den 3A-Plan um den Wettkampfkontext ergänzen.
 *
 * **Ohne kommenden Wettkampf passiert nichts.** Dann – und auch in der
 * Entwicklungsphase, in der 3D bewusst nicht eingreift – kommt genau das
 * Objekt zurück, das hereinkam, und `anpassungen` ist leer. Phase 3A und 3B
 * verhalten sich damit Zeichen für Zeichen wie vorher.
 */
export function planMitVorbereitung(
  plan: PlanungsBild,
  bild: VorbereitungsBild,
): VorbereiteterPlan {
  const leer = new Map<string, VorbereitungsAnpassung>()
  if (!phaseGreiftEin(bild.phase)) return { plan, bild, anpassungen: leer }

  const leitlinieVon = new Map(bild.geraete.map((g) => [g.apparatus, g]))
  const anpassungen = new Map<string, VorbereitungsAnpassung>()

  const geraete: GeraetPlan[] = plan.geraete.map((g) => {
    const strategie = leitlinieVon.get(g.apparatus)
    // Ein Geraet, das Phase 3C nicht zum Wettkampf zaehlt, bleibt unberuehrt:
    // Es gehoert zur normalen Trainingsarbeit und nicht zur Vorbereitung.
    if (!strategie) return g

    const entwicklung = g.inhalte.filter((i) => i.art === ENTWICKLUNG)
    if (!entwicklung.length) return g

    const zurueckstellen = bild.phase !== 'stabilisierung' && darfZurueckstellen(g.inhalte)
    const inhalte = zurueckstellen
      ? g.inhalte.filter((i) => i.art !== ENTWICKLUNG)
      : entwicklungNachHinten(g.inhalte)

    const umsortiert = !zurueckstellen
      && g.inhalte.some((i, idx) => i.key !== inhalte[idx]?.key)
    if (!zurueckstellen && !umsortiert) return g

    const ohneWettkampf = entwicklung.map(
      (i) => `Ohne Wettkampfkontext stünde „${i.text}" an dieser Stelle im Vorschlag.`)
    const durchVorbereitung: string[] = []
    if (zurueckstellen) {
      durchVorbereitung.push(
        `${bild.countdown ? `Wettkampf ${bild.countdown}` : 'Wettkampf steht an'} – `
        + 'LifeHub nennt die aktuell geplante Wettkampfübung zuerst. '
        + zurueckgestelltText(entwicklung.length))
    } else {
      durchVorbereitung.push(
        `${bild.countdown ? `Wettkampf ${bild.countdown}` : 'Wettkampf steht an'} – `
        + 'die aktuelle Wettkampfkür steht vor der Entwicklungsarbeit. '
        + 'Der Kandidat bleibt im Vorschlag, aber hinten.')
    }
    durchVorbereitung.push(
      `Am Gerät gilt dabei: ${LEITLINIE_LABEL[strategie.leitlinie]}.`)

    anpassungen.set(g.apparatus, {
      apparatus: g.apparatus,
      name: g.name,
      leitlinie: strategie.leitlinie,
      zurueckgestellt: zurueckstellen ? entwicklung : [],
      umsortiert,
      ohneWettkampf,
      durchVorbereitung,
    })

    return {
      ...g,
      inhalte,
      reihenfolgeArt: reihenfolgeNach(g.reihenfolgeArt),
    }
  })

  // Hat sich wirklich nichts geaendert, bleibt es beim selben Objekt - damit
  // "ohne Eingriff ist es derselbe Plan" nicht nur fast stimmt.
  if (!anpassungen.size) return { plan, bild, anpassungen: leer }

  return { plan: { ...plan, geraete }, bild, anpassungen }
}

/* ====================================================== Für die Anzeige */

/**
 * Die Phase für eine Kopfzeile: „wettkampfnah · Wettkampf in 6 Tagen".
 *
 * `null`, wenn kein Wettkampf eingetragen ist – dann steht dort nichts, und
 * die Oberfläche sieht aus wie vor Phase 3D.
 */
export function phaseKurztext(bild: VorbereitungsBild): string | null {
  if (bild.phase === 'keine' || !bild.countdown) return null
  if (bild.phase === 'wettkampftag') return PHASE_LABEL.wettkampftag
  return `${PHASE_LABEL[bild.phase]} · Wettkampf ${bild.countdown}`
}

/**
 * Die zurückgestellten Inhalte eines Geräts als Satz, oder `null`.
 *
 * Nur für die Anzeige im 3A-Block. Der Inhalt selbst steht in der Anpassung.
 */
export function zurueckgestelltHinweis(
  anpassungen: Map<string, VorbereitungsAnpassung>,
  apparatus: string,
): string | null {
  const a = anpassungen.get(apparatus)
  if (!a || !a.zurueckgestellt.length) return null
  return zurueckgestelltText(a.zurueckgestellt.length)
}

/**
 * **Phase 3D steuert kein Training.**
 *
 * Merkposten im Quelltext, wie `KEIN_READINESS_SCORE` in
 * `wettkampfvorbereitung.ts` und `ELEMENTE_SIND_NICHT_DIE_KUER` in
 * `trainingsfokus.ts`: Wer hier Belastung, Volumen, Minuten, Wiederholungen,
 * ein Tapering oder eine Punktprognose einbaut, verlässt den Rahmen – nicht
 * aus Vorsicht, sondern weil in LifeHub keine Daten dafür stehen.
 */
export const KEINE_PERIODISIERUNG = true
