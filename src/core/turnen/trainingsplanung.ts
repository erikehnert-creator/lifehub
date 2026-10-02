/**
 * Trainingsplanung: Was wäre für die nächste Turneinheit ein sinnvoller Inhalt?
 *
 * ---------------------------------------------------------------------------
 * Eine Umsortierung, keine neue Wahrheit
 *
 * Dieses Modul rechnet **nichts** neu. Es nimmt den Trainingsfokus aus Phase 2D
 * – der seinerseits auf Wettkampfanalyse (2C), Elementstabilität (1),
 * Kürfassungen (2B) und Kürdurchgängen (2E) sitzt – und ordnet ihn in die Form
 * um, in der man vor dem Training danach fragt: erst das Gerät, dann was
 * daran.
 *
 * Deshalb gibt es hier keine einzige eigene Schwelle für Stabilität, keine
 * zweite Zeitlogik und keine Punktzahl über Geräte. Was hier hinzukommt, sind
 * ausschliesslich **Auswahl- und Reihenfolgeregeln**, und die stehen
 * ausgeschrieben da (`PLAN_SCHWELLEN`, `reihenfolgeArtFuer`, `waehleGeraete`).
 *
 * ---------------------------------------------------------------------------
 * Was hier NICHT behauptet wird
 *
 * **Keine Satz- und Wiederholungszahlen.** „Element X exakt siebenmal" wäre
 * eine erfundene Genauigkeit. Der Umfang ist eine von drei Kategorien
 * (`kurz`, `normal`, `schwerpunkt`); nur bei Kürdurchgängen steht eine Zahl,
 * und die ist eine Spanne von höchstens zwei – als Produktheuristik
 * dokumentiert (`DURCHGANGS_VORGABE`).
 *
 * **Keine physiologische Reihenfolge.** „Ringe immer zuerst" oder „Sprung nie
 * nach Barren" wären Erfahrungsregeln, zu denen in LifeHub keine Daten stehen.
 * Die Gerätereihenfolge kommt aus Priorität und Wettkampfreihenfolge, und der
 * Nutzer darf sie umstellen.
 *
 * **Kein automatisches Schwierigkeitsupgrade.** Ein Kandidat aus 2D heisst
 * „als Kandidat prüfen" und niemals „in die Kür einbauen". Die Küränderung
 * bleibt beim Turner und seinem Trainer – dieselbe Zurückhaltung wie in
 * `trainingsfokus.ts`, und aus demselben Grund: Elementgruppen,
 * Anrechnungsgrenzen und die Wertungsvorschrift des Zyklus stehen nicht in
 * LifeHub.
 *
 * **Keine Zeitplanung, auch keine grobe.** Es gibt keine Trainingsdauer, keine
 * Minuten je Gerät und keinen Verteilungsschlüssel. Wie viel Raum etwas bekommen
 * soll, sagt ausschliesslich der `Umfang` (`kurz`, `normal`, `schwerpunkt`) –
 * das ist transparent und behauptet keine Zeitverteilung. Zeit gehört zu einer
 * späteren Phase, zusammen mit Kalender und Schichtplan.
 *
 * ---------------------------------------------------------------------------
 * Nichts davon wird gespeichert
 *
 * Der Plan ändert sich mit jedem Zähler, jedem Durchgang, jeder Küränderung
 * und jedem Wettkampf. Ein gespeicherter Vorschlag wäre ab dem nächsten
 * Training falsch, ohne dass es jemand bemerkt – genau die Überlegung, mit der
 * schon der Trainingsfokus ohne Tabelle auskommt (TURNEN_ARCHITEKTUR.md, 17.1).
 * **Phase 3A legt deshalb keine Tabelle an und ändert kein Schema.**
 *
 * Die Wahl des Nutzers (Gerät abgewählt, Reihenfolge geändert, Inhalt
 * entfernt) lebt im Arbeitsspeicher der Oberfläche und geht durch
 * `planMitAuswahl()` – eine reine Funktion, damit sie prüfbar ist.
 *
 * Erfasst wird hinterher mit dem **vorhandenen** Weg: Elementversuche als
 * `gym_attempts`, Kürdurchgänge als `gym_routine_runs`. Es gibt keine zweite
 * Trainingserfassung und keinen „Plan erledigt"-Zustand.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import { GERAETE, geraet, geraetName } from './geraete'
import { KUER_SCHWELLEN } from './kueren'
import { SCHWELLEN } from './sicherheit'
import type { GeraetBild } from './elemente'
import type {
  ElementLage, GeraetFokus, Prioritaet, TrainingsfokusBild,
} from './trainingsfokus'
import type { Fokus } from './analyse'

/* ========================================================== Schwellen */

/**
 * Die Auswahlregeln – eine **Produktheuristik**, keine Messung.
 *
 * Alle drei Zahlen beantworten Fragen, zu denen es keine Daten gibt, sondern
 * nur eine Verabredung. Sie stehen hier, damit sie an einer Stelle stehen.
 *
 * **Ausdrücklich keine trainingswissenschaftlich optimale Verteilung.** Es gibt
 * keine Untersuchung, die sagt, dass drei Geräte je Einheit richtig sind oder
 * dass eine Stärke nach genau 28 Tagen wieder an die Reihe muss – das hängt am
 * Turner, am Trainingsstand und an der Woche. Die Zahlen sind bewusst rund
 * gewählt, damit man sie im Kopf nachvollziehen kann, und sie lassen sich an
 * dieser einen Stelle ändern. Dieselbe Zurückhaltung wie bei `SCHWELLEN` in
 * `sicherheit.ts` und `DURCHGANG_SCHWELLEN` in `kuerdurchgaenge.ts`.
 */
export const PLAN_SCHWELLEN = {
  /**
   * Wie viele Geräte ein Vorschlag höchstens nennt.
   *
   * Drei. Nicht sechs: Ein Trainingsvorschlag, der alle Geräte aufführt, ist
   * kein Vorschlag, sondern eine Geräteliste – und in zwei Stunden Halle sind
   * sechs Geräte ernsthaft nicht zu bearbeiten.
   */
  maxGeraete: 3,
  /**
   * Wie viele davon Schwerpunkt sein dürfen.
   *
   * Zwei. Drei Schwerpunkte sind keine Schwerpunkte mehr.
   */
  maxSchwerpunkte: 2,
  /**
   * Ab wie vielen Tagen ohne Training ein Gerät den Wartungsplatz bekommt.
   *
   * Dieselben 28 Tage wie `KUER_SCHWELLEN.langeHerTage`, und ausdrücklich
   * **keine** eigene Zahl: Es ist dieselbe Frage („woran sollte man beim
   * nächsten Training denken?"), nur auf das Gerät statt auf das Element
   * bezogen. Eine zweite Zeitlogik wäre genau das, was hier nicht entstehen
   * soll.
   */
  wartungTage: KUER_SCHWELLEN.langeHerTage,
} as const

/** Wie viele Wochen das Beobachtungsfenster umfasst – für Beschriftungen. */
export const FENSTER_WOCHEN = Math.round(SCHWELLEN.fensterTage / 7)

/**
 * Wie viele Kürdurchgänge vorgeschlagen werden – als Spanne.
 *
 * **Produktheuristik, und bewusst winzig.** Mehr als zwei vollständige
 * Durchgänge desselben Geräts in einer Einheit vorzuschlagen wäre eine
 * Belastungsaussage, und Belastungssteuerung kann LifeHub nicht (und soll es
 * in dieser Phase auch nicht).
 */
export const DURCHGANGS_VORGABE = {
  /** Wenn die Kür der Schwerpunkt ist. */
  kuerImVordergrund: { von: 1, bis: 2 },
  /** Sonst, und bei Wartung. */
  nebenbei: { von: 1, bis: 1 },
} as const

/* ============================================================== Rollen */

/** Welche Rolle ein Gerät in dieser Einheit hat. */
export type Rolle = 'schwerpunkt' | 'nebenfokus' | 'wartung'

export const ROLLE_LABEL: Record<Rolle, string> = {
  schwerpunkt: 'Schwerpunkt',
  nebenfokus: 'Nebenfokus',
  wartung: 'Wartung',
}

/**
 * Warum ein Gerät überhaupt im Vorschlag steht.
 *
 * Die Reihenfolge ist die Begründungsstärke – der erste zutreffende Grund wird
 * genannt, damit nicht vier Halbsätze übereinander stehen.
 */
export type AuswahlGrund =
  | 'prioritaet_hoch'
  | 'kuer_haelt_nicht'
  | 'neue_kuerfassung'
  | 'prioritaet_mittel'
  | 'lange_nicht_trainiert'
  | 'kuer_lange_nicht_komplett'
  | 'nutzerwahl'

/** Warum an einem Gerät nichts vorzuschlagen ist. */
export type NichtsZuTun =
  | 'keine_elemente'
  | 'keine_kuer_kein_auffaelliges'
  | 'alles_in_ordnung'

export const NICHTS_ZU_TUN_TEXT: Record<NichtsZuTun, string> = {
  keine_elemente:
    'An diesem Gerät ist noch kein Element angelegt – ohne Elemente und ohne Kür gibt es nichts vorzuschlagen.',
  keine_kuer_kein_auffaelliges:
    'Keine Wettkampfkür hinterlegt, und kein erfasstes Element fällt auf.',
  alles_in_ordnung:
    'Die Kürelemente stehen, die Kür kommt am Stück durch, und es ist kürzlich trainiert worden.',
}

/** Warum es gar keinen Vorschlag gibt. */
export type KeinPlanGrund = 'keine_elemente' | 'zu_wenig_daten'

export const KEIN_PLAN_TEXT: Record<KeinPlanGrund, string> = {
  keine_elemente:
    'Es ist noch kein Element angelegt. Lege zuerst die Elemente an, die du turnst – danach entsteht der Vorschlag von selbst.',
  zu_wenig_daten:
    'Noch zu wenig Daten für einen priorisierten Trainingsvorschlag. Erfasse ein Training oder hinterlege eine Wettkampfkür – bis dahin ist die freie Erfassung der richtige Weg.',
}

/* ============================================================ Inhalte */

/**
 * Die drei Arten von Inhalt – und warum es genau diese drei sind.
 *
 *   `element`      Arbeit an einem einzelnen Element der Kür, das auffällt.
 *   `entwicklung`  Ein schwierigeres Element **prüfen**, nicht einbauen.
 *   `durchgang`    Die ganze Kür am Stück (Phase 2E).
 *
 * `element` und `durchgang` sind zwei verschiedene Messgrössen und werden es
 * hier auch bleiben: Zehn saubere Einzelversuche an acht Elementen sind etwas
 * anderes als eine durchgeturnte Übung.
 */
export type InhaltArt = 'element' | 'entwicklung' | 'durchgang'

export const INHALT_ART_LABEL: Record<InhaltArt, string> = {
  element: 'Element',
  entwicklung: 'Entwicklung',
  durchgang: 'Kür am Stück',
}

/**
 * Wie viel Raum ein Inhalt bekommen soll.
 *
 * Drei Stufen und **keine Minuten**: „Barren – Schwerpunkt, Pauschenpferd –
 * kurz" ist nachvollziehbar, „40 / 40 / 10 min" behauptete eine Zeitverteilung,
 * für die es keine Grundlage gibt. Zeit gehört zu einer späteren Phase.
 */
export type Umfang = 'kurz' | 'normal' | 'schwerpunkt'

export const UMFANG_LABEL: Record<Umfang, string> = {
  kurz: 'kurz',
  normal: 'normal',
  schwerpunkt: 'Schwerpunkt',
}

export interface Inhalt {
  /**
   * Stabiler Schlüssel, aus Gerät, Art und Element gebildet.
   *
   * Keine Zufalls-ID: Der Schlüssel muss über ein Neuzeichnen hinweg derselbe
   * bleiben, sonst käme ein vom Nutzer entfernter Inhalt beim nächsten
   * Zähler zurück.
   */
  key: string
  art: InhaltArt
  /** Der Satz, der in der Liste steht. */
  text: string
  umfang: Umfang
  /** Warum dieser Inhalt erscheint – ausschliesslich vorhandene Daten. */
  warum: string[]
  /** Bei `element` und `entwicklung`: welches Element. Sonst `null`. */
  elementId: string | null
  /** Nur bei `durchgang`: wie viele, als Spanne. */
  durchgaenge: { von: number; bis: number } | null
}

/**
 * In welcher Reihenfolge die Inhalte eines Geräts stehen.
 *
 *   `elemente_zuerst`     Der Normalfall: erst die problematischen Elemente,
 *                         dann Entwicklung, dann die Kür am Stück.
 *   `kuer_zuerst`         Die Elemente stehen einzeln, die Kür nicht – dann ist
 *                         die ganze Übung der Ort und nicht das Einzelelement.
 *   `entwicklung_zuerst`  Kür und Elemente stehen, es geht um Schwierigkeit.
 *
 * Bewusst **nicht** überall dieselbe Reihenfolge: Genau diese Unterscheidung
 * ist der Gewinn aus Phase 2E.
 */
export type ReihenfolgeArt = 'elemente_zuerst' | 'kuer_zuerst' | 'entwicklung_zuerst'

export const REIHENFOLGE_TEXT: Record<ReihenfolgeArt, string> = {
  elemente_zuerst: 'Erst die einzelnen Elemente, die ganze Kür danach.',
  kuer_zuerst: 'Die Kür am Stück zuerst – die Einzelelemente stehen schon.',
  entwicklung_zuerst: 'Schwierigkeit zuerst – Kür und Elemente tragen.',
}

/* ======================================================= Ein Gerät */

export interface GeraetPlan {
  apparatus: string
  name: string
  prioritaet: Prioritaet
  /** Der Fokus aus Phase 2C – unverändert übernommen. */
  wettkampfFokus: Fokus
  /**
   * Die vorgeschlagene Rolle, oder `null`.
   *
   * `null` heisst: Dieses Gerät steht **nicht** im Vorschlag. Die Inhalte sind
   * trotzdem gerechnet – damit ein nachträglich hinzugewähltes Gerät sofort
   * etwas anzuzeigen hat, ohne eine zweite Rechnung.
   */
  rolle: Rolle | null
  auswahlGrund: AuswahlGrund | null
  /** Warum dieses Gerät in dieser Rolle erscheint – nur vorhandene Daten. */
  warum: string[]
  /** Die vorgeschlagenen Tätigkeiten, in fachlich sinnvoller Reihenfolge. */
  inhalte: Inhalt[]
  reihenfolgeArt: ReihenfolgeArt
  /**
   * Was am Datenstand auffällt, aber keine Trainingsaufgabe ist.
   *
   * Ein archiviertes Element in der Kür oder ein gelöschter Platz ist ein
   * nicht nachgezogener Eintrag und kein Trainingsproblem – es als Übung
   * vorzuschlagen wäre falsch, es zu verschweigen auch.
   */
  hinweise: string[]
  /** Warum an diesem Gerät nichts vorzuschlagen ist, falls nichts ist. */
  nichtsZuTun: NichtsZuTun | null
  /** Tage seit dem letzten Versuch an diesem Gerät, oder `null`. */
  tageHer: number | null
  /** Tage seit dem letzten kompletten Durchgang der **aktuellen** Fassung. */
  tageHerKomplett: number | null
  /** Sind an diesem Gerät überhaupt Versuche erfasst? */
  hatTrainingsdaten: boolean
}

export interface PlanungsBild {
  /** Alle sechs Geräte, in Vorschlagsreihenfolge zuerst. */
  geraete: GeraetPlan[]
  /** Die Gerätesschlüssel des Vorschlags, in Reihenfolge. */
  vorgeschlagen: string[]
  /** Warum es gar keinen Vorschlag gibt, falls es keinen gibt. */
  grund: KeinPlanGrund | null
  /** Gibt es überhaupt einen ausgewerteten Wettkampf? */
  hatWettkampf: boolean
  /** Gibt es überhaupt erfasste Versuche? */
  hatTraining: boolean
}

export interface PlanungsEingang {
  /** Das fertige Bild aus Phase 2D – die einzige Quelle für Priorität und Lage. */
  fokus: TrainingsfokusBild
  /**
   * Je Gerät, wann es zuletzt trainiert wurde – aus `geraetBilder()`.
   *
   * Nicht neu gerechnet: Dieselbe Zahl steht schon auf der Übersicht.
   */
  geraetBilder: Map<string, GeraetBild>
}

/* ================================================== Inhalte je Gerät */

/** Wie viele auffällige Elemente eine Rolle nennt. */
const ELEMENTE_JE_ROLLE: Record<Rolle, number> = {
  schwerpunkt: 3,
  nebenfokus: 2,
  wartung: 1,
}

/**
 * Der Satz zu einem auffälligen Element – aus dem dringendsten Grund.
 *
 * Die Zuordnung ist eine Tabelle und keine Kette von Sonderfällen, damit
 * nachvollziehbar ist, warum dort „stabilisieren" und nicht „auffrischen"
 * steht. `archiviert` und `geloescht` kommen hier nicht vor: Das sind
 * Datenstandshinweise, keine Übungen (siehe `hinweiseFuer`).
 */
function elementText(lage: ElementLage): string {
  const name = lage.element.name
  const arten = new Set(lage.auffaellig.map((a) => a.art))

  if (arten.has('instabil')) return `${name} gezielt stabilisieren`
  if (arten.has('mitHilfe')) return `${name} ohne Hilfestellung festigen`
  if (arten.has('gemischt')) return `${name} festigen`
  if (arten.has('nieTrainiert')) return `${name} erstmals gezielt trainieren`
  if (arten.has('langeHer')) return `${name} auffrischen`
  if (arten.has('statusAufbau')) return `${name} weiter aufbauen`
  return `${name} überprüfen`
}

/** Die Gründe eines Elements, wie sie schon in Phase 2D formuliert sind. */
function elementWarum(lage: ElementLage): string[] {
  return lage.auffaellig
    .filter((a) => a.art !== 'archiviert' && a.art !== 'geloescht')
    .slice(0, 2)
    .map((a) => a.text)
}

/**
 * Elementarbeit – nur wenn es zu diesem Gerät überhaupt Trainingsdaten gibt.
 *
 * Ohne einen einzigen erfassten Versuch fällt jedes Kürelement automatisch als
 * „nie trainiert" auf. Daraus eine Liste konkreter Elementempfehlungen zu
 * bauen sähe nach Auskunft aus, wäre aber nur die Feststellung, dass noch
 * nichts erfasst ist – die gehört als Hinweis daneben und nicht als Übung in
 * den Plan.
 */
function elementInhalte(g: GeraetFokus, rolle: Rolle, hatDaten: boolean): Inhalt[] {
  if (!hatDaten) return []
  const out: Inhalt[] = []
  const nutzbar = g.auffaellige.filter((x) => elementWarum(x).length > 0)
  for (const [i, lage] of nutzbar.slice(0, ELEMENTE_JE_ROLLE[rolle]).entries()) {
    out.push({
      key: `${g.apparatus}:element:${lage.element.id}`,
      art: 'element',
      text: elementText(lage),
      umfang: rolle === 'wartung' ? 'kurz' : i === 0 && rolle === 'schwerpunkt' ? 'schwerpunkt' : 'normal',
      warum: elementWarum(lage),
      elementId: lage.element.id,
      durchgaenge: null,
    })
  }
  return out
}

/**
 * Entwicklungsarbeit – nur wenn Phase 2D sie nahelegt.
 *
 * Bedingung ist die Empfehlung aus 2D, nicht eine eigene Regel:
 * `schwierigkeit_pruefen` heisst dort genau, dass Kür und Elemente tragen und
 * der Wettkampf die Schwierigkeit als schwächere Seite ausweist. Bei
 * `stabilisieren` oder `kuer_unter_belastung` wäre ein schwereres Element der
 * falsche Ort, und bei `halten`/`wartung` gibt es keinen Anlass.
 *
 * Genau **ein** Kandidat, der schwierigste. „Als Kandidat prüfen" ist eine
 * Sache, keine Liste – und die Küränderung bleibt beim Turner.
 */
function entwicklungInhalte(g: GeraetFokus): Inhalt[] {
  if (g.empfehlung !== 'schwierigkeit_pruefen') return []
  const k = g.kandidaten[0]
  if (!k) return []

  const wert = k.element.difficulty_value
  const warum: string[] = []
  if (typeof wert === 'number' && Number.isFinite(wert)) {
    warum.push(`Schwierigkeitswert ${wert} – höher als der niedrigste Wert in der Kür.`)
  }
  warum.push(`Im Training stabil: ${k.fenster.clean} von ${k.fenster.versuche} Versuchen `
    + `gelungen, ohne Hilfe (letzte ${FENSTER_WOCHEN} Wochen).`)

  return [{
    key: `${g.apparatus}:entwicklung:${k.element.id}`,
    art: 'entwicklung',
    // "pruefen" und nicht "einbauen": Elementgruppen, Anrechnungsgrenzen und
    // die Wertungsvorschrift des Zyklus stehen nicht in LifeHub.
    text: `${k.element.name} als Kandidaten prüfen`,
    umfang: 'normal',
    warum,
    elementId: k.element.id,
    durchgaenge: null,
  }]
}

/**
 * Kürdurchgänge – wann, und wie viele.
 *
 *   | Lage | Vorgabe |
 *   |---|---|
 *   | keine Wettkampfkür | kein Durchgang |
 *   | `kuer_unter_belastung` | 1–2, Schwerpunkt |
 *   | aktuelle Fassung ohne Durchgang | 1, normal – die Fassung ist unerfasst |
 *   | Wartung oder `halten` | 1, kurz |
 *   | sonst | 1, normal |
 *
 * Auch bei instabilen Einzelelementen steht ein Durchgang im Plan, nur klein
 * und hinten: Ob die Übung am Stück durchkommt, ist eine eigene Auskunft und
 * lässt sich aus Einzelversuchen nicht ableiten.
 */
function durchgangInhalte(g: GeraetFokus, rolle: Rolle): Inhalt[] {
  if (!g.kuer) return []

  const bild = g.durchgaenge?.aktuell ?? null
  const keineZurFassung = !bild || bild.durchgaenge === 0
  const fruehere = g.durchgaenge?.fruehere.durchgaenge ?? 0

  const vordergrund = g.empfehlung === 'kuer_unter_belastung'
  const vorgabe = vordergrund
    ? DURCHGANGS_VORGABE.kuerImVordergrund
    : DURCHGANGS_VORGABE.nebenbei

  const warum: string[] = []
  if (vordergrund) {
    warum.push('Die Einzelelemente stehen, die ganze Kür kommt aber nicht '
      + 'verlässlich durch – geübt werden muss die Übung am Stück.')
    // Die Zahlen dazu, damit der Satz nachrechenbar ist und nicht als
    // Behauptung dasteht.
    if (bild && bild.durchgaenge > 0) {
      warum.push(`Sauber waren ${bild.sauber} von ${bild.durchgaenge} Durchgängen `
        + `in den letzten ${FENSTER_WOCHEN} Wochen.`)
    }
  } else if (keineZurFassung && fruehere > 0) {
    // Der Fall aus Phase 2E: Die Kuer wurde geaendert, die alten Durchgaenge
    // gehoeren zur alten Fassung und zaehlen fuer die jetzige nicht.
    warum.push('Die aktuelle Kürfassung ist noch nicht mit einem Durchgang '
      + 'erfasst – die früheren gehören zur vorherigen Fassung.')
  } else if (keineZurFassung) {
    warum.push('Zur vollständigen Kür liegt noch kein erfasster Durchgang vor.')
  } else if (bild) {
    warum.push(`${bild.sauber} von ${bild.durchgaenge} Durchgängen waren komplett, `
      + `sturzfrei, ohne Absetzen und ohne Hilfe (letzte ${FENSTER_WOCHEN} Wochen).`)
    if (bild.tageHerKomplett !== null && bild.tageHerKomplett >= PLAN_SCHWELLEN.wartungTage) {
      warum.push(`Zuletzt komplett durchgeturnt vor ${bild.tageHerKomplett} Tagen.`)
    }
  }

  const text = vorgabe.von === vorgabe.bis
    ? 'Die Kür einmal vollständig turnen'
    : `${vorgabe.von}–${vorgabe.bis} vollständige Kürdurchgänge`

  return [{
    key: `${g.apparatus}:durchgang:kuer`,
    art: 'durchgang',
    text,
    umfang: vordergrund ? 'schwerpunkt' : rolle === 'wartung' ? 'kurz' : 'normal',
    warum,
    elementId: null,
    durchgaenge: { von: vorgabe.von, bis: vorgabe.bis },
  }]
}

/**
 * Die Reihenfolge innerhalb eines Geräts – aus der Empfehlung von Phase 2D.
 *
 * Nicht blind überall dieselbe: `kuer_unter_belastung` heisst ausdrücklich,
 * dass die Einzelelemente nicht der Ort sind, und `schwierigkeit_pruefen` bei
 * stabiler Kür heisst, dass Entwicklung die Aufgabe ist.
 */
export function reihenfolgeArtFuer(g: GeraetFokus): ReihenfolgeArt {
  if (g.empfehlung === 'kuer_unter_belastung') return 'kuer_zuerst'
  if (g.empfehlung === 'schwierigkeit_pruefen'
    && g.lage === 'stabil'
    && g.durchgangsLage !== 'instabil') return 'entwicklung_zuerst'
  return 'elemente_zuerst'
}

const ORDNUNG: Record<ReihenfolgeArt, InhaltArt[]> = {
  elemente_zuerst: ['element', 'entwicklung', 'durchgang'],
  kuer_zuerst: ['durchgang', 'element', 'entwicklung'],
  entwicklung_zuerst: ['entwicklung', 'element', 'durchgang'],
}

/** Datenstandshinweise – nicht als Übung, aber auch nicht verschwiegen. */
function hinweiseFuer(g: GeraetFokus, hatDaten: boolean): string[] {
  const out: string[] = []
  for (const lage of g.kuerElemente) {
    if (lage.auffaellig.some((a) => a.art === 'archiviert')) {
      out.push(`„${lage.element.name}" ist archiviert, steht aber in der Kür – `
        + 'Kür oder Status nachziehen.')
    }
  }
  if (g.geloeschtePlaetze.length) {
    const p = g.geloeschtePlaetze.join(', ')
    out.push(g.geloeschtePlaetze.length === 1
      ? `Platz ${p} der Kür zeigt auf ein gelöschtes Element.`
      : `Die Plätze ${p} der Kür zeigen auf gelöschte Elemente.`)
  }
  if (!hatDaten && g.kuer) {
    out.push('An diesem Gerät ist noch kein Versuch erfasst – ohne '
      + 'Trainingsdaten gibt es hier keine Elementempfehlung.')
  }
  if (g.keineKandidaten === 'keine_stabilen' && g.empfehlung === 'schwierigkeit_pruefen') {
    out.push('Schwierigere Elemente sind erfasst, stehen im Training aber noch '
      + 'nicht stabil – deshalb steht hier kein Kandidat.')
  }
  return out
}

/* ================================================= Warum dieses Gerät */

/**
 * Der Satz, der die Rolle begründet – und danach die Datenpunkte aus 2D.
 *
 * Die Datenpunkte werden **übernommen**, nicht neu formuliert: Phase 2D
 * garantiert schon, dass dort nur steht, was wirklich erfasst ist.
 */
function warumFuer(
  g: GeraetFokus,
  grund: AuswahlGrund,
  tageHer: number | null,
): string[] {
  const name = geraetName(g.apparatus)
  const kopf: Record<AuswahlGrund, string> = {
    prioritaet_hoch:
      `${name} steht als Schwerpunkt, weil der Wettkampfvergleich hier die `
      + 'grösste Lücke zeigt.',
    kuer_haelt_nicht:
      `${name} steht vorn, weil die Einzelelemente stehen, die ganze Kür aber `
      + 'nicht verlässlich durchkommt.',
    neue_kuerfassung:
      `${name} steht im Plan, weil die aktuelle Kürfassung noch nicht mit einem `
      + 'Durchgang erfasst ist.',
    prioritaet_mittel:
      `${name} steht als Nebenfokus – eine Seite liegt unter dem Feld, die `
      + 'Endnote trägt aber noch.',
    lange_nicht_trainiert: tageHer === null
      ? `${name} steht als Wartung, weil hier noch kein Training erfasst ist.`
      : `${name} steht als Wartung, weil hier seit ${tageHer} Tagen nicht `
        + 'trainiert wurde – kein Wettkampfnachteil, nur eine Lücke.',
    kuer_lange_nicht_komplett:
      `${name} steht im Plan, weil die Kür lange nicht vollständig geturnt wurde.`,
    nutzerwahl:
      `${name} hast du selbst dazugenommen.`,
  }
  return [kopf[grund], ...g.begruendung]
}

/* ==================================================== Geräte auswählen */

const PRIORITAET_REIHE: Prioritaet[] = ['hoch', 'mittel', 'halten', 'zu_wenig_daten']

/**
 * Die Rolle, die sich allein aus der Priorität ergibt.
 *
 * Sie bestimmt schon beim Rechnen der Inhalte, wie viele Elemente ein Gerät
 * nennt und mit welchem Umfang – deshalb steht sie hier und nicht erst bei der
 * Auswahl. Ein Gerät, das gar nicht vorgeschlagen wird, hat seine Inhalte
 * trotzdem in dieser Rolle gerechnet.
 *
 * **Exportiert für Phase 3B** (`wochenplanung.ts`): Wird ein Gerät dort auf
 * einen weiteren Trainingstag verteilt, das in Phase 3A keinen Platz bekam,
 * muss seine Rolle nach derselben Regel entstehen – nicht nach einer zweiten.
 */
export function rolleAus(prioritaet: Prioritaet): Rolle {
  if (prioritaet === 'hoch') return 'schwerpunkt'
  if (prioritaet === 'mittel') return 'nebenfokus'
  return 'wartung'
}

/**
 * Die Reihe, in der Geräte an die Reihe kommen – als Vergleichsfunktion.
 *
 * Drei Schlüssel: Priorität, dann **am längsten nicht trainiert** (nie
 * trainiert zuerst), dann Wettkampfreihenfolge. Der zweite ist der Grund,
 * warum kein Gerät wochenlang verschwindet.
 *
 * **Exportiert für Phase 3B**, und zwar ausdrücklich, damit die Wochenplanung
 * dieselbe Reihe benutzt. Eine zweite Sortierregel wäre eine zweite Antwort auf
 * dieselbe Frage – und sie würde beim nächsten Eingriff hier auseinanderlaufen.
 */
export function nachDringlichkeit(
  a: { prioritaet: Prioritaet; tageHer: number | null; apparatus: string },
  b: { prioritaet: Prioritaet; tageHer: number | null; apparatus: string },
): number {
  const pa = PRIORITAET_REIHE.indexOf(a.prioritaet)
  const pb = PRIORITAET_REIHE.indexOf(b.prioritaet)
  if (pa !== pb) return pa - pb
  const ta = a.tageHer ?? Infinity
  const tb = b.tageHer ?? Infinity
  if (ta !== tb) return tb - ta
  return (geraet(a.apparatus)?.reihenfolge ?? 99) - (geraet(b.apparatus)?.reihenfolge ?? 99)
}

/** Hat dieses Gerät überhaupt etwas, das sich vorschlagen liesse? */
function nichtsZuTunFuer(g: GeraetFokus, inhalte: Inhalt[]): NichtsZuTun | null {
  if (inhalte.length) return null
  if (!g.kuer && !g.kuerElemente.length && !g.auffaellige.length) {
    return g.kandidaten.length ? 'alles_in_ordnung' : 'keine_elemente'
  }
  if (!g.kuer) return 'keine_kuer_kein_auffaelliges'
  return 'alles_in_ordnung'
}

/**
 * Welches Gerät den Wartungsplatz verdient.
 *
 * Nur Geräte **ohne** Wettkampfbefund kommen dafür in Frage (`halten` oder
 * `zu_wenig_daten`): Ein Gerät mit Priorität `hoch` oder `mittel` wird ohnehin
 * normal gewählt, und es als „Wartung" zu führen wäre eine Untertreibung.
 *
 * Das Gerät darf einen `mittel`-Platz verdrängen, aber nie einen Schwerpunkt.
 * Genau dafür ist der Platz da: Eine Stärke, die vier Wochen nicht
 * angefasst wurde, soll nicht wochenlang aus dem Blick fallen, nur weil an
 * einem anderen Gerät dauerhaft mehr zu holen ist.
 */
function wartungsKandidat(
  kandidaten: { g: GeraetFokus; tageHer: number | null; inhalte: Inhalt[] }[],
): string | null {
  const infrage = kandidaten.filter((k) =>
    (k.g.prioritaet === 'halten' || k.g.prioritaet === 'zu_wenig_daten')
    && k.inhalte.length > 0
    && (k.tageHer === null || k.tageHer >= PLAN_SCHWELLEN.wartungTage))
  if (!infrage.length) return null
  // Nie trainiert zuerst, danach das am laengsten nicht trainierte.
  infrage.sort((a, b) => (b.tageHer ?? Infinity) - (a.tageHer ?? Infinity)
    || (geraet(a.g.apparatus)?.reihenfolge ?? 99) - (geraet(b.g.apparatus)?.reihenfolge ?? 99))
  return infrage[0].g.apparatus
}

/* ======================================================== Die Planung */

/**
 * Der Trainingsvorschlag – in einem Durchgang.
 *
 * Alle sechs Geräte bekommen ihre Inhalte gerechnet; die Auswahl entscheidet
 * nur, welche davon im Vorschlag stehen. Das kostet nichts (die Inhalte sind
 * ein Nachschlagen in Phase 2D) und macht das nachträgliche Hinzuwählen eines
 * Geräts zu einem Anzeigevorgang statt zu einer zweiten Rechnung.
 */
export function trainingsplanung(e: PlanungsEingang): PlanungsBild {
  const roh = e.fokus.geraete.map((g) => {
    const bild = e.geraetBilder.get(g.apparatus)
    const tageHer = bild?.tageHer ?? null
    const hatDaten = (bild?.versuche ?? 0) > 0
    const rolleFuerInhalte = rolleAus(g.prioritaet)

    const teile = [
      ...elementInhalte(g, rolleFuerInhalte, hatDaten),
      ...entwicklungInhalte(g),
      ...durchgangInhalte(g, rolleFuerInhalte),
    ]
    const art = reihenfolgeArtFuer(g)
    const ordnung = ORDNUNG[art]
    const inhalte = [...teile].sort((a, b) =>
      ordnung.indexOf(a.art) - ordnung.indexOf(b.art))

    return {
      g,
      tageHer,
      tageHerKomplett: g.durchgaenge?.aktuell.tageHerKomplett ?? null,
      hatDaten,
      inhalte,
      art,
      hinweise: hinweiseFuer(g, hatDaten),
    }
  })

  /* ------------------------------------------------------- Die Reihe
     Priorität, dann am längsten nicht trainiert, dann Wettkampfreihenfolge.
     Der zweite Schlüssel ist der Grund, warum kein Gerät wochenlang
     verschwindet: Bei gleicher Priorität kommt das dran, das länger liegt. */
  const waehlbar = roh.filter((r) => r.inhalte.length > 0)
  const reihe = [...waehlbar].sort((a, b) => nachDringlichkeit(
    { prioritaet: a.g.prioritaet, tageHer: a.tageHer, apparatus: a.g.apparatus },
    { prioritaet: b.g.prioritaet, tageHer: b.tageHer, apparatus: b.g.apparatus }))

  /* ------------------------------------------------------ Die Auswahl */
  const gewaehlt: { apparatus: string; rolle: Rolle; grund: AuswahlGrund }[] = []
  let schwerpunkte = 0

  for (const r of reihe) {
    if (gewaehlt.length >= PLAN_SCHWELLEN.maxGeraete) break
    if (r.g.prioritaet === 'hoch' && schwerpunkte < PLAN_SCHWELLEN.maxSchwerpunkte) {
      gewaehlt.push({
        apparatus: r.g.apparatus,
        rolle: 'schwerpunkt',
        grund: r.g.empfehlung === 'kuer_unter_belastung' ? 'kuer_haelt_nicht' : 'prioritaet_hoch',
      })
      schwerpunkte++
      continue
    }
    gewaehlt.push({
      apparatus: r.g.apparatus,
      rolle: r.g.prioritaet === 'halten' || r.g.prioritaet === 'zu_wenig_daten'
        ? 'wartung' : 'nebenfokus',
      grund: grundOhneSchwerpunkt(r.g, r.tageHer),
    })
  }

  // Der Wartungsplatz. Er greift erst, wenn die Schwerpunkte stehen, und
  // verdraengt hoechstens den letzten Nebenfokus - nie einen Schwerpunkt.
  const wartung = wartungsKandidat(
    waehlbar
      .filter((r) => !gewaehlt.some((x) => x.apparatus === r.g.apparatus))
      .map((r) => ({ g: r.g, tageHer: r.tageHer, inhalte: r.inhalte })))
  if (wartung) {
    const schonWartung = gewaehlt.some((x) => x.rolle === 'wartung')
    if (!schonWartung) {
      const letzter = gewaehlt[gewaehlt.length - 1]
      if (gewaehlt.length < PLAN_SCHWELLEN.maxGeraete) {
        gewaehlt.push({ apparatus: wartung, rolle: 'wartung', grund: 'lange_nicht_trainiert' })
      } else if (letzter && letzter.rolle !== 'schwerpunkt') {
        gewaehlt[gewaehlt.length - 1] = {
          apparatus: wartung, rolle: 'wartung', grund: 'lange_nicht_trainiert',
        }
      }
    }
  }

  const rolleVon = new Map(gewaehlt.map((x) => [x.apparatus, x]))

  const geraete: GeraetPlan[] = roh.map((r) => {
    const wahl = rolleVon.get(r.g.apparatus) ?? null
    return {
      apparatus: r.g.apparatus,
      name: r.g.name,
      prioritaet: r.g.prioritaet,
      wettkampfFokus: r.g.wettkampfFokus,
      rolle: wahl?.rolle ?? null,
      auswahlGrund: wahl?.grund ?? null,
      warum: wahl ? warumFuer(r.g, wahl.grund, r.tageHer) : r.g.begruendung,
      inhalte: r.inhalte,
      reihenfolgeArt: r.art,
      hinweise: r.hinweise,
      nichtsZuTun: nichtsZuTunFuer(r.g, r.inhalte),
      tageHer: r.tageHer,
      tageHerKomplett: r.tageHerKomplett,
      hatTrainingsdaten: r.hatDaten,
    }
  })

  // Vorgeschlagene zuerst, in Auswahlreihenfolge; danach der Rest in
  // Wettkampfreihenfolge, damit die Nachwahlliste immer gleich aussieht.
  const platz = new Map(gewaehlt.map((x, i) => [x.apparatus, i]))
  geraete.sort((a, b) => {
    const pa = platz.get(a.apparatus)
    const pb = platz.get(b.apparatus)
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return (geraet(a.apparatus)?.reihenfolge ?? 99) - (geraet(b.apparatus)?.reihenfolge ?? 99)
  })

  return {
    geraete,
    vorgeschlagen: gewaehlt.map((x) => x.apparatus),
    grund: grundFuer(e.fokus, waehlbar.length),
    hatWettkampf: e.fokus.hatWettkampf,
    hatTraining: e.fokus.hatTraining,
  }
}

function grundOhneSchwerpunkt(g: GeraetFokus, tageHer: number | null): AuswahlGrund {
  if (g.empfehlung === 'kuer_unter_belastung') return 'kuer_haelt_nicht'
  if (g.prioritaet === 'mittel') return 'prioritaet_mittel'
  if (g.prioritaet === 'hoch') return 'prioritaet_hoch'
  const bild = g.durchgaenge?.aktuell
  if (bild && bild.durchgaenge === 0 && (g.durchgaenge?.fruehere.durchgaenge ?? 0) > 0) {
    return 'neue_kuerfassung'
  }
  if (tageHer === null || tageHer >= PLAN_SCHWELLEN.wartungTage) return 'lange_nicht_trainiert'
  if (bild?.tageHerKomplett !== null && bild?.tageHerKomplett !== undefined
    && bild.tageHerKomplett >= PLAN_SCHWELLEN.wartungTage) {
    return 'kuer_lange_nicht_komplett'
  }
  return 'lange_nicht_trainiert'
}

/**
 * Warum es gar keinen Vorschlag gibt.
 *
 * Zwei verschiedene Fälle, und der Unterschied zählt: Ohne Elemente ist der
 * nächste Schritt „Elemente anlegen", ohne Daten „einmal trainieren und
 * erfassen". Beides ist etwas anderes als eine leere Liste.
 */
function grundFuer(fokus: TrainingsfokusBild, waehlbare: number): KeinPlanGrund | null {
  if (waehlbare > 0) return null
  const hatElemente = fokus.geraete.some(
    (g) => g.kuerElemente.length > 0 || g.kandidaten.length > 0 || g.auffaellige.length > 0)
  if (!hatElemente && !fokus.hatTraining) return 'keine_elemente'
  return 'zu_wenig_daten'
}

/* ==================================================== Die Wahl des Nutzers */

/**
 * Was der Nutzer am Vorschlag geändert hat.
 *
 * Alles optional und alles nur im Arbeitsspeicher: Der Plan ist ein Vorschlag
 * und keine Verpflichtung, und er soll sich mit dem nächsten Training von
 * selbst erneuern. Gespeichert wird davon nichts.
 */
export interface Auswahl {
  /** Vorgeschlagene Geräte, die der Nutzer abgewählt hat. */
  ohne?: readonly string[]
  /** Zusätzlich gewählte Geräte. */
  zusatz?: readonly string[]
  /** Eigene Gerätereihenfolge; unbekannte Schlüssel werden übergangen. */
  reihenfolge?: readonly string[]
  /** Entfernte Inhalte, je `Inhalt.key`. */
  ohneInhalte?: readonly string[]
}

/**
 * Der Plan, wie der Nutzer ihn haben will.
 *
 * Eine reine Funktion, damit sich die Fälle einzeln nachrechnen lassen –
 * dasselbe Muster wie bei `planeVersuche()` und `planeDurchgaenge()`:
 *
 *   - ein abgewähltes Gerät fällt heraus
 *   - ein hinzugewähltes Gerät kommt mit seinen gerechneten Inhalten hinzu,
 *     als `nutzerwahl` gekennzeichnet
 *   - ein entfernter Inhalt fällt heraus; bleibt dabei nichts übrig, bleibt
 *     das Gerät trotzdem stehen (der Nutzer hat es ja gewählt)
 *   - eine eigene Reihenfolge gilt, die übrigen folgen in Vorschlagsreihenfolge
 */
export function planMitAuswahl(bild: PlanungsBild, a: Auswahl = {}): GeraetPlan[] {
  const ohne = new Set(a.ohne ?? [])
  const zusatz = new Set(a.zusatz ?? [])
  const ohneInhalte = new Set(a.ohneInhalte ?? [])
  const vonKey = new Map(bild.geraete.map((g) => [g.apparatus, g]))

  const drin: GeraetPlan[] = []
  for (const key of bild.vorgeschlagen) {
    if (ohne.has(key) || zusatz.has(key)) continue
    const g = vonKey.get(key)
    if (g) drin.push(g)
  }
  for (const key of zusatz) {
    if (ohne.has(key)) continue
    const g = vonKey.get(key)
    // Ein Geraet ohne jeden Inhalt laesst sich nicht sinnvoll dazunehmen -
    // es stuende als leere Ueberschrift da.
    if (!g || !g.inhalte.length) continue
    drin.push(g.rolle ? g : {
      ...g,
      rolle: 'nebenfokus',
      auswahlGrund: 'nutzerwahl',
      warum: warumNutzerwahl(g),
    })
  }

  const gefiltert = drin.map((g) => ({
    ...g,
    inhalte: g.inhalte.filter((i) => !ohneInhalte.has(i.key)),
  }))

  const wunsch = (a.reihenfolge ?? []).filter((k) => gefiltert.some((g) => g.apparatus === k))
  if (!wunsch.length) return gefiltert

  const rang = new Map(wunsch.map((k, i) => [k, i]))
  return [...gefiltert].sort((x, y) => {
    const rx = rang.get(x.apparatus)
    const ry = rang.get(y.apparatus)
    if (rx !== undefined && ry !== undefined) return rx - ry
    if (rx !== undefined) return -1
    if (ry !== undefined) return 1
    return 0
  })
}

function warumNutzerwahl(g: GeraetPlan): string[] {
  return [`${g.name} hast du selbst dazugenommen.`, ...g.warum.slice(1)]
}

/* ============================================================ Anzeige */

/** „3 Geräte vorgeschlagen" – Einzahl ist kein Sonderfall zum Vergessen. */
export function geraeteLabel(n: number): string {
  return n === 1 ? '1 Gerät vorgeschlagen' : `${n} Geräte vorgeschlagen`
}

/** Die Geräte, die sich nachträglich dazunehmen lassen. */
export function nachwaehlbar(bild: PlanungsBild, a: Auswahl = {}): GeraetPlan[] {
  const drin = new Set(planMitAuswahl(bild, a).map((g) => g.apparatus))
  return bild.geraete
    .filter((g) => !drin.has(g.apparatus) && g.inhalte.length > 0)
    .sort((x, y) => (geraet(x.apparatus)?.reihenfolge ?? 99)
      - (geraet(y.apparatus)?.reihenfolge ?? 99))
}

/** Alle Geräteschlüssel in Wettkampfreihenfolge – für die Oberfläche. */
export const GERAETE_REIHE = GERAETE.map((g) => g.key)
