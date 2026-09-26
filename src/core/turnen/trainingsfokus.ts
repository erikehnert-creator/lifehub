/**
 * Trainingsfokus: was Aufmerksamkeit verdient – und welche vorhandenen Elemente
 * dafür plausible Kandidaten sind.
 *
 * ---------------------------------------------------------------------------
 * Zwei Ebenen, die nicht vermischt werden
 *
 *   **Gerätepriorität**   Welches Gerät verdient mehr Aufmerksamkeit? Das
 *                         entscheidet allein der Wettkampf: Fokus aus Phase 2C,
 *                         relative Position, Abstand zum Feld.
 *   **Inhaltliche Lage**  Was an diesem Gerät konkret? Das entscheidet allein
 *                         das Training: Kür, Elementstatus, Versuche.
 *
 * Die eine Ebene sagt **wo**, die andere **was**. Sie werden erst am Schluss
 * zusammengeführt, und zwar in einer Tabelle, die ausgeschrieben dasteht
 * (`empfehlungAus`). Ein einziger gemeinsamer Zahlenwert über beide wäre genau
 * die Blackbox, die hier nicht entstehen soll.
 *
 * ---------------------------------------------------------------------------
 * Was hier NICHT behauptet wird
 *
 * **Kein Element verursacht einen E-Abzug.** Das Protokoll weist Abzüge nicht
 * je Element aus; welcher Kampfrichterabzug auf welches Element ging, weiss
 * LifeHub nicht und kann es nicht wissen. Ein auffälliges Element ist eine
 * **Beobachtung aus dem Training**, keine Ursache der Wettkampfnote.
 *
 * **Kein Element erhöht den D-Wert um X.** Ob ein Element angerechnet wird,
 * hängt an Elementgruppen, Anrechnungsgrenzen und der Wertungsvorschrift des
 * Zyklus – nichts davon steht in LifeHub. Deshalb heisst es „als Kandidat
 * prüfen" und nicht „einbauen bringt 0,3".
 *
 * **Keine neue Zeitlogik und keine zweite Stabilitätswahrheit.** Gerechnet wird
 * mit `SCHWELLEN` aus `sicherheit.ts` (Fenster 56 Tage, mindestens 10 Versuche)
 * und `KUER_SCHWELLEN.langeHerTage` aus `kueren.ts` (28 Tage). Die vier
 * Stabilitätsstufen sind eine **Abbildung** von `statusVorschlag()`, keine
 * eigene Rechnung.
 *
 * ---------------------------------------------------------------------------
 * Nichts davon wird gespeichert
 *
 * Der Trainingsfokus ändert sich mit jedem Training, jeder Statusänderung,
 * jeder Küränderung und jedem Wettkampf. Eine gespeicherte Empfehlung wäre ab
 * dem nächsten Zähler falsch, ohne dass es jemand bemerkt – dieselbe
 * Überlegung wie bei „zuletzt trainiert" (TURNEN_ARCHITEKTUR.md, 2.3). Es gibt
 * deshalb **keine Tabelle** zu dieser Phase.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import type {
  GymAttempt, GymElement, GymRoutine, GymRoutineElement,
} from '../types'
import { GERAETE, geraet, geraetName } from './geraete'
import { SCHWELLEN, trefferbild, statusVorschlag, type Trefferbild } from './sicherheit'
import { KUER_SCHWELLEN, kuerElemente, wettkampfKuerJeGeraet } from './kueren'
import { bloeckeMitTag, elementBild, type EinheitTag } from './elemente'
import {
  liegtUnten, richtung,
  type Fokus, type VerlaufsPunkt, type WettkampfAnalyse,
} from './analyse'

/* ========================================================= Stabilität */

/**
 * Wie verlässlich ein Element im Training steht.
 *
 * **Eine Abbildung, keine zweite Rechnung.** Die Stufen kommen aus
 * `statusVorschlag()` in `sicherheit.ts`, das seit Phase 1 dieselben Schwellen
 * benutzt:
 *
 *   | `statusVorschlag()` | hier |
 *   |---|---|
 *   | kein Vorschlag (< 10 Versuche im Fenster) | `zu_wenig_daten` |
 *   | `sicher` (≥ 90 % gelungen, kein Sturz, keine Hilfe) | `stabil` |
 *   | `unsicher` (≥ 60 %, oder Hilfe im Spiel) | `gemischt` |
 *   | `aufbau` (< 60 %) | `instabil` |
 *
 * Damit gilt hier automatisch, was dort gilt: Die Stichprobengrösse zählt (ein
 * Element mit 1 von 1 gelungen ist `zu_wenig_daten`, nicht `stabil`), und
 * Hilfestellung deckelt (wer im Fenster auch nur einmal mit Hilfe geturnt hat,
 * kommt nie über `gemischt`).
 */
export type Stabilitaet = 'zu_wenig_daten' | 'stabil' | 'gemischt' | 'instabil'

export const STABILITAET_LABEL: Record<Stabilitaet, string> = {
  zu_wenig_daten: 'zu wenig Daten',
  stabil: 'stabil',
  gemischt: 'gemischt',
  instabil: 'instabil',
}

export function stabilitaetAus(bild: Trefferbild): Stabilitaet {
  const v = statusVorschlag(bild)
  if (v.status === null) return 'zu_wenig_daten'
  if (v.status === 'sicher') return 'stabil'
  if (v.status === 'unsicher') return 'gemischt'
  return 'instabil'
}

/* ====================================================== Auffälligkeit */

/**
 * Warum ein Element im Training auffällt.
 *
 * Die Reihenfolge ist die Dringlichkeit, von oben nach unten abnehmend. Sie
 * trägt die Sortierung – eine eigene Punktzahl dafür wäre eine Zahl, die man
 * anzeigen möchte und nicht sollte.
 */
export type AuffaelligkeitArt =
  | 'geloescht'
  | 'archiviert'
  | 'instabil'
  | 'mitHilfe'
  | 'gemischt'
  | 'nieTrainiert'
  | 'langeHer'
  | 'statusAufbau'
  | 'statusUnsicher'
  | 'statusNeu'

const DRINGLICHKEIT: AuffaelligkeitArt[] = [
  'geloescht', 'archiviert', 'instabil', 'mitHilfe', 'gemischt',
  'nieTrainiert', 'langeHer', 'statusAufbau', 'statusUnsicher', 'statusNeu',
]

export interface Auffaelligkeit {
  art: AuffaelligkeitArt
  /** Schon formuliert, damit es überall gleich heisst. */
  text: string
  tageHer?: number
}

/* ========================================================= Elementlage */

/** Ein Element mit allem, was Training und Kür darüber hergeben. */
export interface ElementLage {
  element: GymElement
  /** Platz in der aktuellen Wettkampfkür, oder `null`: nicht darin. */
  platz: number | null
  zuletzt: DayString | null
  tageHer: number | null
  /** Trefferbild im Fenster von `SCHWELLEN.fensterTage`. */
  fenster: Trefferbild
  stabilitaet: Stabilitaet
  auffaellig: Auffaelligkeit[]
  /**
   * Sortierschlüssel, klein heisst dringender.
   *
   * Nur intern – er erscheint nirgends in der Oberfläche. Dort stehen die
   * Gründe selbst.
   */
  dringlichkeit: number
}

function auffaelligkeiten(
  element: GymElement | null,
  fenster: Trefferbild,
  stabilitaet: Stabilitaet,
  tageHer: number | null,
  inKuer: boolean,
): Auffaelligkeit[] {
  const out: Auffaelligkeit[] = []
  if (!element) return [{ art: 'geloescht', text: 'Element gelöscht' }]

  if (inKuer && !element.is_active) {
    out.push({ art: 'archiviert', text: 'archiviert, steht aber in der Kür' })
  }
  if (stabilitaet === 'instabil') {
    const p = Math.round((fenster.quote ?? 0) * 100)
    out.push({ art: 'instabil', text: `erst ${p} % gelungen (${fenster.versuche} Versuche)` })
  }
  if (fenster.mitHilfe > 0) {
    out.push({ art: 'mitHilfe', text: `${fenster.mitHilfe}× mit Hilfestellung` })
  }
  if (stabilitaet === 'gemischt' && fenster.mitHilfe === 0) {
    const p = Math.round((fenster.quote ?? 0) * 100)
    out.push({
      art: 'gemischt',
      text: fenster.failed > 0
        ? `${p} % gelungen, ${fenster.failed}× gestürzt`
        : `${p} % gelungen – noch nicht verlässlich`,
    })
  }
  if (tageHer === null) {
    out.push({ art: 'nieTrainiert', text: 'nie trainiert' })
  } else if (tageHer >= KUER_SCHWELLEN.langeHerTage) {
    out.push({ art: 'langeHer', tageHer, text: `seit ${tageHer} Tagen nicht trainiert` })
  }
  // Der gesetzte Status zaehlt mit - aber NICHT gegen die eigenen Zahlen.
  //
  // Er kommt vom Turner und weiss Dinge, die keine Zaehlung hergibt; wo die
  // Datenlage nichts sagt, ist er die einzige Auskunft. Steht das Element
  // im Fenster aber nachweislich `stabil` (mindestens zehn Versuche, ueber
  // 90 % gelungen, kein Sturz, keine Hilfe), dann ist ein alter Status "neu"
  // oder "unsicher" ein nicht nachgezogener Eintrag und kein Trainingsproblem.
  // Ihn dann als Auffaelligkeit zu fuehren zaehlte dieselbe Tatsache zweimal -
  // und liess eine Kuer mit lauter gelungenen Versuchen als instabil
  // erscheinen. Genau dafuer gibt es `vorschlagAbweichend()` in
  // `sicherheit.ts`: Die Elementliste zeigt dort den abweichenden Vorschlag an.
  if (stabilitaet !== 'stabil') {
    if (element.status === 'aufbau') out.push({ art: 'statusAufbau', text: 'Status: im Aufbau' })
    if (element.status === 'unsicher') out.push({ art: 'statusUnsicher', text: 'Status: unsicher' })
    if (element.status === 'neu') out.push({ art: 'statusNeu', text: 'Status: neu' })
  }

  return out
}

function lageVon(
  element: GymElement | null,
  platz: number | null,
  bild: { zuletzt: DayString | null; tageHer: number | null; fenster: Trefferbild } | null,
): ElementLage | null {
  if (!element) return null
  const fenster = bild?.fenster ?? trefferbild([])
  const stabilitaet = stabilitaetAus(fenster)
  const tageHer = bild?.tageHer ?? null
  const auffaellig = auffaelligkeiten(element, fenster, stabilitaet, tageHer, platz !== null)
  const schlimmste = auffaellig.length
    ? Math.min(...auffaellig.map((a) => DRINGLICHKEIT.indexOf(a.art)))
    : DRINGLICHKEIT.length
  return {
    element,
    platz,
    zuletzt: bild?.zuletzt ?? null,
    tageHer,
    fenster,
    stabilitaet,
    auffaellig,
    dringlichkeit: schlimmste,
  }
}

/* ======================================================= Trainingslage */

/**
 * Wie es um die aktuelle Wettkampfkür eines Geräts steht.
 *
 * **Produktheuristik, ausgeschrieben:**
 *
 *   | Lage | wann |
 *   |---|---|
 *   | `keine_kuer` | keine aktive Wettkampfkür am Gerät |
 *   | `zu_wenig_daten` | kein Element der Kür hat genug Versuche im Fenster und keinen aussagenden Status |
 *   | `stabil` | kein auffälliges Element |
 *   | `gemischt` | genau ein auffälliges Element |
 *   | `instabil` | **mehrere** auffällige Elemente |
 *
 * „Mehrere" heisst zwei. Das ist die Schwelle, an der aus einem Einzelfall ein
 * Zustand der Kür wird – eine Verabredung wie alle Schwellen in diesem Modul,
 * und keine Messung.
 */
export type TrainingsLage = 'keine_kuer' | 'zu_wenig_daten' | 'stabil' | 'gemischt' | 'instabil'

export const LAGE_LABEL: Record<TrainingsLage, string> = {
  keine_kuer: 'keine Wettkampfkür hinterlegt',
  zu_wenig_daten: 'zu wenig Trainingsdaten',
  stabil: 'stabil',
  gemischt: 'gemischt',
  instabil: 'instabil',
}

/** Ab wie vielen auffälligen Kürelementen die Kür als instabil gilt. */
export const MEHRERE = 2

export function lageAus(kuer: GymRoutine | null, elemente: ElementLage[]): TrainingsLage {
  if (!kuer) return 'keine_kuer'
  const auffaellige = elemente.filter((e) => e.auffaellig.length > 0)
  if (auffaellige.length >= MEHRERE) return 'instabil'
  // Ohne Aussage zu keinem Element ist die Kuer nicht "stabil", sondern
  // unbekannt - sonst gilt eine nie trainierte Kuer als in Ordnung.
  const mitAussage = elemente.some(
    (e) => e.stabilitaet !== 'zu_wenig_daten' || e.auffaellig.length > 0)
  if (!mitAussage) return 'zu_wenig_daten'
  if (auffaellige.length === 1) return 'gemischt'
  return 'stabil'
}

/* ========================================================= Empfehlung */

export type Empfehlung =
  | 'schwierigkeit_pruefen'
  | 'stabilisieren'
  | 'technik_stabilitaet'
  | 'wartung'
  | 'halten'
  | 'zu_wenig_daten'

export const EMPFEHLUNG_LABEL: Record<Empfehlung, string> = {
  schwierigkeit_pruefen: 'Schwierigkeit gezielt prüfen',
  stabilisieren: 'Erst die Kür stabilisieren',
  technik_stabilitaet: 'Technik und Stabilität',
  wartung: 'Halten, einzelne Elemente auffrischen',
  halten: 'Stand halten',
  zu_wenig_daten: 'zu wenig Daten',
}

/**
 * Wettkampffokus und Trainingslage zu einer Empfehlung – als Tabelle.
 *
 *   | 2C-Fokus | Trainingslage | Empfehlung |
 *   |---|---|---|
 *   | `zu_wenig_daten` | – | `zu_wenig_daten` |
 *   | `schwierigkeit` | `instabil` | `stabilisieren` |
 *   | `schwierigkeit` | sonst | `schwierigkeit_pruefen` |
 *   | `ausfuehrung` | – | `technik_stabilitaet` |
 *   | `beides` | `instabil` oder `gemischt` | `stabilisieren` |
 *   | `beides` | sonst | `schwierigkeit_pruefen` |
 *   | `halten` | ein auffälliges Element oder mehr | `wartung` |
 *   | `halten` | sonst | `halten` |
 *
 * Die beiden wichtigen Zeilen:
 *
 * **Schwierigkeit bei instabiler Kür ergibt Stabilisieren, nicht mehr
 * Schwierigkeit.** Ein schweres Element, das schon in der Kür steht und dort
 * wackelt, ist ein Grund weniger für ein noch schwereres.
 *
 * **`beides` sucht nicht pauschal Schwierigkeit.** Schon ein einzelnes
 * auffälliges Element genügt, um zuerst auf Stabilität zu gehen – bei `beides`
 * ist die Ausführung ja ohnehin unter dem Feld. Die Schwelle ist hier
 * absichtlich strenger als bei `schwierigkeit`.
 *
 * **Aus `halten` wird nie ein Problemgerät.** Es wird höchstens `wartung`, und
 * das heisst „halten, einzelne Elemente auffrischen".
 */
export function empfehlungAus(fokus: Fokus, lage: TrainingsLage, auffaellige: number): Empfehlung {
  if (fokus === 'zu_wenig_daten') return 'zu_wenig_daten'
  if (fokus === 'ausfuehrung') return 'technik_stabilitaet'
  if (fokus === 'schwierigkeit') {
    return lage === 'instabil' ? 'stabilisieren' : 'schwierigkeit_pruefen'
  }
  if (fokus === 'beides') {
    return lage === 'instabil' || lage === 'gemischt' ? 'stabilisieren' : 'schwierigkeit_pruefen'
  }
  return auffaellige > 0 ? 'wartung' : 'halten'
}

/* ====================================================== Gerätepriorität */

/**
 * Wie viel Aufmerksamkeit ein Gerät verdient.
 *
 * **Keine Gesamtnote von 0 bis 100.** Vier Kategorien, und die Grundlage steht
 * daneben:
 *
 *   | Priorität | wann |
 *   |---|---|
 *   | `zu_wenig_daten` | kein Vergleichsfeld |
 *   | `hoch` | `beides`; oder eine Seite unter dem Feld **und** die Endnote unter der Feldmitte; oder eine Seite unter dem Feld **und** die Kür instabil |
 *   | `mittel` | eine Seite unter dem Feld, aber die Endnote trägt noch |
 *   | `halten` | nichts unter dem Feld |
 *
 * Die Endnote entscheidet mit, weil sie sagt, ob die schwächere Seite bereits
 * Plätze kostet: Eine niedrige Schwierigkeit neben einer sehr guten Ausführung
 * kann im Feld trotzdem vorn landen – dann ist es kein dringender Fall.
 *
 * Die Kür entscheidet mit, weil eine wackelnde Kür den Wettkampfbefund
 * bestätigt. Aus einem `halten`-Gerät macht sie dagegen **nichts** Dringendes;
 * dort führt sie höchstens zu `wartung`.
 */
export type Prioritaet = 'hoch' | 'mittel' | 'halten' | 'zu_wenig_daten'

export const PRIORITAET_LABEL: Record<Prioritaet, string> = {
  hoch: 'hoch',
  mittel: 'mittel',
  halten: 'halten',
  zu_wenig_daten: 'zu wenig Daten',
}

const PRIORITAET_REIHE: Prioritaet[] = ['hoch', 'mittel', 'halten', 'zu_wenig_daten']

export function prioritaetAus(
  fokus: Fokus,
  endnoteUnten: boolean | null,
  lage: TrainingsLage,
): Prioritaet {
  if (fokus === 'zu_wenig_daten') return 'zu_wenig_daten'
  if (fokus === 'halten') return 'halten'
  if (fokus === 'beides') return 'hoch'
  // schwierigkeit oder ausfuehrung: eine Seite liegt unter dem Feld.
  if (endnoteUnten === true || lage === 'instabil') return 'hoch'
  return 'mittel'
}

/* ========================================================= Gerätefokus */

export interface GeraetFokus {
  apparatus: string
  name: string
  prioritaet: Prioritaet
  /** Der Fokus aus Phase 2C – unverändert übernommen. */
  wettkampfFokus: Fokus
  lage: TrainingsLage
  empfehlung: Empfehlung
  /** Ein bis drei Datenpunkte, ausschliesslich aus vorhandenen Daten. */
  begruendung: string[]
  kuer: GymRoutine | null
  /** Die Elemente der aktuellen Wettkampfkür, in Kürreihenfolge. */
  kuerElemente: ElementLage[]
  /** Plätze der Kür, deren Element gelöscht wurde. */
  geloeschtePlaetze: number[]
  /** Auffällige Kürelemente, das dringendste zuerst. */
  auffaellige: ElementLage[]
  /** Mögliche schwierigere Elemente – nur als Kandidaten. */
  kandidaten: ElementLage[]
  /** Warum es keine Kandidaten gibt, falls es keine gibt. */
  keineKandidaten: KeinKandidat | null
  /** Beschreibender Hinweis aus mehreren Wettkämpfen, oder `null`. */
  verlaufshinweis: string | null
  /** Gelungene Versuche der Kürelemente im Fenster – Quote und Basis. */
  kuerQuote: { quote: number; versuche: number } | null
}

export type KeinKandidat =
  | 'keine_kuer'
  | 'kein_vergleichswert'
  | 'keine_schwierigeren'
  | 'keine_stabilen'

export const KEIN_KANDIDAT_TEXT: Record<KeinKandidat, string> = {
  keine_kuer:
    'Ohne hinterlegte Wettkampfkür gibt es keinen Bezugspunkt, gegen den ein Element „schwieriger" wäre.',
  kein_vergleichswert:
    'An keinem Element der Kür steht ein Schwierigkeitswert – ohne den ist nicht vergleichbar, was schwieriger ist.',
  keine_schwierigeren:
    'Es gibt an diesem Gerät kein erfasstes Element mit höherem Schwierigkeitswert, das nicht schon in der Kür steht.',
  keine_stabilen:
    'Schwierigere Elemente sind erfasst, stehen aber im Training noch nicht stabil.',
}

export interface TrainingsfokusBild {
  geraete: GeraetFokus[]
  /** Gibt es überhaupt einen ausgewerteten Wettkampf? */
  hatWettkampf: boolean
  /** Gibt es überhaupt erfasste Versuche? */
  hatTraining: boolean
}

export interface TrainingsfokusEingang {
  /** Der jüngste ausgewertete Wettkampf aus Phase 2C, oder `null`. */
  analyse: WettkampfAnalyse | null
  /** Verlauf je Gerät aus Phase 2C – nur als Kontext. */
  verlauf: Map<string, VerlaufsPunkt[]>
  elemente: GymElement[]
  versuche: GymAttempt[]
  einheiten: EinheitTag[]
  kueren: GymRoutine[]
  kuerVerknuepfungen: GymRoutineElement[]
  heute: DayString
  tagDifferenz: (von: DayString, bis: DayString) => number
}

/**
 * Der ganze Trainingsfokus – in einem Durchgang.
 *
 * Bewusst **ein** Aufruf: Die Oberfläche merkt sich das Ergebnis und rechnet
 * nicht bei jedem Zeichnen neu. Die Versuche werden einmal mit ihren Tagen
 * verbunden und einmal je Element ausgewertet; danach ist alles ein
 * Nachschlagen.
 */
export function trainingsfokus(e: TrainingsfokusEingang): TrainingsfokusBild {
  const bloecke = bloeckeMitTag(e.versuche, e.einheiten)
  // Geloeschte Elemente heraus, und zwar HIER: `list()` filtert sie beim Laden
  // schon weg, aber diese Funktion ist rein und darf sich nicht darauf
  // verlassen. `kuerElemente()` gibt fuer ein fehlendes Element `null` zurueck -
  // genau so soll ein geloeschtes Element auch erscheinen.
  const vorhanden = e.elemente.filter((x) => !x.deleted_at)

  // Ein Bild je Element, einmal. `elementBild` filtert selbst nach Element -
  // je Geraet neu aufzurufen waere ein Durchlauf je Element ueber alle Bloecke.
  const bildVon = new Map<string, ReturnType<typeof elementBild>>()
  for (const el of vorhanden) {
    bildVon.set(el.id, elementBild(el, bloecke, e.heute, e.tagDifferenz))
  }

  const kuerJeGeraet = wettkampfKuerJeGeraet(e.kueren)
  const analyseVon = new Map<string, WettkampfAnalyse['geraete'][number]>()
  for (const g of e.analyse?.geraete ?? []) analyseVon.set(g.apparatus, g)

  const geraete: GeraetFokus[] = []

  for (const g of GERAETE) {
    const kuer = kuerJeGeraet.get(g.key) ?? null
    const eintraege = kuer ? kuerElemente(kuer.id, e.kuerVerknuepfungen, vorhanden) : []

    const kuerLagen: ElementLage[] = []
    const geloeschtePlaetze: number[] = []
    for (const { element, platz } of eintraege) {
      if (!element) {
        geloeschtePlaetze.push(platz)
        continue
      }
      const lage = lageVon(element, platz, bildVon.get(element.id) ?? null)
      if (lage) kuerLagen.push(lage)
    }

    const lage = lageAus(kuer, kuerLagen)
    const auffaellige = kuerLagen
      .filter((x) => x.auffaellig.length > 0)
      .sort((a, b) => a.dringlichkeit - b.dringlichkeit
        || (b.tageHer ?? 9999) - (a.tageHer ?? 9999)
        || a.element.name.localeCompare(b.element.name))

    const wettkampf = analyseVon.get(g.key) ?? null
    const fokus: Fokus = wettkampf?.fokus ?? 'zu_wenig_daten'
    const endnoteUnten = wettkampf ? liegtUnten(wettkampf.final) : null

    const prioritaet = prioritaetAus(fokus, endnoteUnten, lage)
    const empfehlung = empfehlungAus(fokus, lage, auffaellige.length)

    const { kandidaten, grund } = kandidatenFuer(
      g.key, vorhanden, kuer, kuerLagen, bildVon)

    geraete.push({
      apparatus: g.key,
      name: geraetName(g.key),
      prioritaet,
      wettkampfFokus: fokus,
      lage,
      empfehlung,
      begruendung: begruendungFuer(wettkampf, lage, auffaellige, kuerQuoteAus(kuerLagen), kuer),
      kuer,
      kuerElemente: kuerLagen,
      geloeschtePlaetze,
      auffaellige,
      kandidaten,
      keineKandidaten: kandidaten.length ? null : grund,
      verlaufshinweis: verlaufshinweisFuer(e.verlauf.get(g.key) ?? []),
      kuerQuote: kuerQuoteAus(kuerLagen),
    })
  }

  // Sortiert nach Prioritaet, darin nach der relativen Endnotenposition
  // (schwaechste zuerst), darin nach Wettkampfreihenfolge. Kein Punktwert.
  geraete.sort((a, b) => {
    const pa = PRIORITAET_REIHE.indexOf(a.prioritaet)
    const pb = PRIORITAET_REIHE.indexOf(b.prioritaet)
    if (pa !== pb) return pa - pb
    const fa = analyseVon.get(a.apparatus)?.final.position ?? 1
    const fb = analyseVon.get(b.apparatus)?.final.position ?? 1
    if (fa !== fb) return fa - fb
    return (geraet(a.apparatus)?.reihenfolge ?? 99) - (geraet(b.apparatus)?.reihenfolge ?? 99)
  })

  return {
    geraete,
    hatWettkampf: !!e.analyse,
    hatTraining: bloecke.length > 0,
  }
}

/* ========================================================== Kandidaten */

/**
 * Mögliche schwierigere Elemente – ausdrücklich nur als Kandidaten.
 *
 * Ein Element kommt in die Liste, wenn **alle** vier Bedingungen zutreffen:
 *
 *   1. Es gehört zu diesem Gerät, ist erfasst und nicht archiviert.
 *   2. Es steht **nicht** in der aktuellen Wettkampfkür.
 *   3. Sein Schwierigkeitswert ist **höher als der niedrigste** Wert in der
 *      Kür. Das ist der Platz, den es überhaupt einnehmen könnte; „höher als
 *      irgendetwas" wäre keine Aussage.
 *   4. Es steht im Training `stabil` – und damit ohne Hilfe und mit genug
 *      Versuchen, weil `stabilitaetAus()` das aus `sicherheit.ts` mitbringt.
 *
 * **Was hier nicht geprüft wird, weil LifeHub es nicht weiss:** Elementgruppen,
 * Anrechnungsgrenzen, Verbindungen, die Wertungsvorschrift des Zyklus. Deshalb
 * steht in der Oberfläche „als Kandidat prüfen" und nirgends, dass der D-Wert
 * dadurch steigt.
 */
function kandidatenFuer(
  apparatus: string,
  elemente: GymElement[],
  kuer: GymRoutine | null,
  kuerLagen: ElementLage[],
  bildVon: Map<string, ReturnType<typeof elementBild>>,
): { kandidaten: ElementLage[]; grund: KeinKandidat | null } {
  if (!kuer) return { kandidaten: [], grund: 'keine_kuer' }

  const inKuer = new Set(kuerLagen.map((x) => x.element.id))
  const werte = kuerLagen
    .map((x) => x.element.difficulty_value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!werte.length) return { kandidaten: [], grund: 'kein_vergleichswert' }
  const niedrigster = Math.min(...werte)

  const schwierigere = elemente.filter((el) => {
    if (el.apparatus !== apparatus || !el.is_active) return false
    if (inKuer.has(el.id)) return false
    const v = el.difficulty_value
    return typeof v === 'number' && Number.isFinite(v) && v > niedrigster
  })
  if (!schwierigere.length) return { kandidaten: [], grund: 'keine_schwierigeren' }

  const kandidaten = schwierigere
    .map((el) => lageVon(el, null, bildVon.get(el.id) ?? null))
    .filter((x): x is ElementLage => !!x && x.stabilitaet === 'stabil')
    .sort((a, b) => (b.element.difficulty_value ?? 0) - (a.element.difficulty_value ?? 0)
      || a.element.name.localeCompare(b.element.name))

  return { kandidaten, grund: kandidaten.length ? null : 'keine_stabilen' }
}

/* ========================================================= Begründung */

/** Die gelungenen Versuche aller Kürelemente im Fenster – Quote und Basis. */
export function kuerQuoteAus(kuerLagen: ElementLage[]): { quote: number; versuche: number } | null {
  let clean = 0
  let versuche = 0
  for (const x of kuerLagen) {
    clean += x.fenster.clean
    versuche += x.fenster.versuche
  }
  // Dieselbe Mindestzahl wie fuer den Statusvorschlag: Unter zehn Versuchen
  // ist eine Prozentzahl keine Auskunft.
  if (versuche < SCHWELLEN.mindestVersuche) return null
  return { quote: clean / versuche, versuche }
}

const WOCHEN = Math.round(SCHWELLEN.fensterTage / 7)

/**
 * Ein bis drei Datenpunkte – nur aus vorhandenen Daten.
 *
 * Die Reihenfolge ist immer dieselbe: Wettkampf, Training, auffälligstes
 * Element. Fehlt eine Ebene, fehlt ihr Satz – erfunden wird keiner. Fehlt die
 * Trainingsbasis ganz, sagt der zweite Satz genau das.
 */
export function begruendungFuer(
  wettkampf: WettkampfAnalyse['geraete'][number] | null,
  lage: TrainingsLage,
  auffaellige: ElementLage[],
  quote: { quote: number; versuche: number } | null,
  kuer: GymRoutine | null,
): string[] {
  const out: string[] = []

  if (wettkampf && wettkampf.hatVergleich) {
    out.push(wettkampf.begruendung)
  } else if (wettkampf) {
    out.push('Zu diesem Wettkampf liegt kein Vergleichsfeld vor – die Werte stehen '
      + 'ohne Plätze da.')
  } else {
    out.push('Für dieses Gerät ist kein Wettkampfergebnis erfasst.')
  }

  if (!kuer) {
    out.push('Am Gerät ist keine Wettkampfkür hinterlegt; ohne sie gibt es keine '
      + 'Elementebene.')
  } else if (quote) {
    const p = Math.round(quote.quote * 100)
    out.push(`In den letzten ${WOCHEN} Wochen waren ${p} % der ${quote.versuche} erfassten `
      + `Versuche an Elementen dieser Kür gelungen.`)
  } else {
    out.push(`In den letzten ${WOCHEN} Wochen sind zu den Elementen dieser Kür zu wenige `
      + `Versuche erfasst (unter ${SCHWELLEN.mindestVersuche}) – für konkrete `
      + 'Elementempfehlungen fehlt die Trainingsbasis.')
  }

  const erstes = auffaellige[0]
  if (erstes) {
    const gruende = erstes.auffaellig.slice(0, 2).map((a) => a.text).join(', ')
    out.push(`Im Training fällt „${erstes.element.name}" auf: ${gruende}. `
      + 'Das ist eine Beobachtung aus dem Training, keine Ursache der Wettkampfnote.')
  } else if (lage === 'stabil') {
    out.push('An den Elementen dieser Kür fällt im Training derzeit nichts auf.')
  }

  return out
}

/* ========================================================== Verlauf */

/**
 * Ein beschreibender Satz aus mehreren Wettkämpfen – oder `null`.
 *
 * **Der jüngste Wettkampf ist die Momentaufnahme**, aus der die Empfehlung
 * kommt. Die älteren geben nur Zusammenhang. Es wird **nicht** gewichtet
 * gemittelt: Plätze aus verschieden grossen Feldern zu verrechnen ergäbe eine
 * Zahl, die nichts bedeutet (TURNEN_ARCHITEKTUR.md, 16.9).
 *
 * Genannt wird eine Richtung nur, wenn `richtung()` sie trägt – also bei
 * durchgehend steigenden oder fallenden Werten und erst ab drei. Und immer
 * beschreibend: **keine Ursache**.
 */
export function verlaufshinweisFuer(punkte: VerlaufsPunkt[]): string | null {
  const mitPosition = punkte.filter((p) => p.position !== null)
  if (mitPosition.length < 2) return null
  const n = mitPosition.length

  /** Wie sich eine Reihe von Positionen entwickelt hat – oder `null`. */
  const wortFuer = (werte: (number | null)[]): 'hoeher' | 'niedriger' | null => {
    const r = richtung(werte)
    return r === 'hoeher' || r === 'niedriger' ? r : null
  }

  const gesamt = wortFuer(mitPosition.map((p) => p.position))
  const dSeite = wortFuer(mitPosition.map((p) => p.dPosition))
  const eSeite = wortFuer(mitPosition.map((p) => p.ePosition))

  const satz = (was: string, r: 'hoeher' | 'niedriger') =>
    `${was} lag über die letzten ${n} Wettkämpfe durchgehend `
    + `${r === 'hoeher' ? 'höher' : 'niedriger'}.`

  // Die Seite zuerst, wenn sie sich bewegt hat: „E-Position schwaecher
  // geworden" ist die brauchbarere Auskunft als „Position im Feld".
  const teile: string[] = []
  if (dSeite) teile.push(satz('Deine Position bei der Schwierigkeit', dSeite))
  if (eSeite) teile.push(satz('Deine Position bei der Ausführung', eSeite))
  if (!teile.length && gesamt) teile.push(satz('Deine Position im Feld', gesamt))

  if (teile.length) return teile.join(' ')
  return `${n} Wettkämpfe mit Vergleichsfeld – ohne durchgehende Richtung.`
}

/* ==================================================== Was NICHT geht */

/**
 * Ob eine Kür am Stück geturnt wurde, weiss LifeHub nicht.
 *
 * `gym_attempts` zählt Versuche je **Element** je Einheit. Dass diese Versuche
 * eine zusammenhängende Kür waren – erst Element 1, dann 2, ohne Absetzen –
 * steht nirgends, und es lässt sich auch nicht ableiten: Zehn saubere
 * Einzelversuche an acht Elementen sind etwas anderes als eine durchgeturnte
 * Kür, und genau dieser Unterschied ist im Turnen der entscheidende.
 *
 * Deshalb behauptet dieses Modul **nirgends**, eine Kür sei „sicher" oder
 * „durchturnfähig". `TrainingsLage` beschreibt ausdrücklich nur die **Elemente**
 * der Kür, einzeln betrachtet. Die Oberfläche sagt das mit.
 *
 * Wollte man es wissen, bräuchte es eine kleine eigene Erfassung – ein
 * Durchgang mit Datum, Kürfassung und Ergebnis. Das ist eine eigene Phase und
 * ausdrücklich nicht Teil dieser.
 */
export const KUER_AM_STUECK_UNBEKANNT = true

/** Was die Oberfläche dazu sagt. */
export const KUER_AM_STUECK_TEXT =
  'Beurteilt werden die Elemente der Kür einzeln. Ob du die Kür am Stück '
  + 'durchgeturnt hast, erfasst LifeHub nicht – und leitet es auch nicht aus '
  + 'Einzelversuchen ab.'
