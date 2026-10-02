/**
 * Wochenplanung: Welche Inhalte verteile ich auf meine kommenden Turneinheiten?
 *
 * ---------------------------------------------------------------------------
 * Eine Verteilung, keine zweite Prioritätsrechnung
 *
 * Phase 3A beantwortet „was sollte ich trainieren?" und begründet jede Zeile.
 * Phase 3B beantwortet **nur noch** „wie verteile ich diese bereits begründeten
 * Inhalte auf die Trainingstage, die es gibt?".
 *
 * Deshalb wird hier **nichts** neu bewertet: nicht welches Gerät schwach ist,
 * nicht welche Elemente auffallen, nicht welche Kandidaten in Frage kommen,
 * nicht ob eine Kür instabil ist. Das gehört 2C bis 3A und kommt fertig herein
 * (`PlanungsBild`). Selbst die **Reihe**, in der Geräte an die Reihe kommen, und
 * die **Rollenabbildung** sind aus `trainingsplanung.ts` importiert
 * (`nachDringlichkeit`, `rolleAus`) – eine zweite Sortierregel wäre eine zweite
 * Antwort auf dieselbe Frage und würde beim nächsten Eingriff auseinanderlaufen.
 *
 * ---------------------------------------------------------------------------
 * Kein zweiter Kalender und kein zweiter Aufgabenplaner
 *
 * Ein Trainingstermin ist in LifeHub eine Zeile in **`workout_sessions`** mit
 * `status = 'planned'` und `discipline = 'turnen'` – dieselbe Tabelle, in der
 * auch die absolvierten Einheiten stehen, und dieselbe Statuslogik, die
 * `Tracking` und `Heute` schon benutzen. Eine solche Einheit taucht deshalb von
 * selbst in der Trainingsübersicht und in der Heute-Karte auf.
 *
 * Damit gilt **`status` trennt geplant von durchgeführt**, und zwar an genau
 * einer Stelle. Eine geplante Einheit, deren Tag vorbei ist, wird **nicht**
 * stillschweigend als absolviert behandelt; sie erscheint als überfällig.
 *
 * Kein eigenes Terminmodell, keine Wochentagsliste im Quelltext, keine
 * gespiegelten Kalendereinträge.
 *
 * ---------------------------------------------------------------------------
 * Tagesarten sind Kontext, keine Bedingung
 *
 * Tagesart und freie Zeit eines Tages kommen aus dem vorhandenen
 * `computeCapacity()` und werden **angezeigt**. Sie schränken die Verteilung
 * nicht ein: Turnen hängt nicht davon ab, dass ein Arbeitsplan gepflegt ist.
 *
 * Und ausdrücklich **keine physiologischen Aussagen**: Dass nach einer
 * Frühschicht ein bestimmtes Gerät ungeeignet sei, steht nirgends in LifeHub und
 * wäre erfunden.
 *
 * ---------------------------------------------------------------------------
 * Nichts davon wird gespeichert
 *
 * Gespeichert sind nur die **Termine** – und die waren schon vorher Daten. Die
 * Verteilung selbst ist gerechnet: Nach dem ersten absolvierten Training ändert
 * sich der Trainingsfokus, und damit muss sich auch der Rest der Woche ändern
 * dürfen. Eine festgeschriebene Wochenplanung wäre ab dem ersten Training
 * falsch, ohne dass es auffällt – dieselbe Überlegung wie in 17.1 und 19.9.
 *
 * Die Eingriffe des Nutzers (Gerät auf einen anderen Tag, tauschen, entfernen,
 * hinzunehmen) laufen deshalb wie in Phase 3A über eine reine Funktion auf dem
 * Arbeitsspeicherzustand (`wocheMitAuswahl`).
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import { relativeDay } from '../dates'
import { geraet } from './geraete'
import {
  PLAN_SCHWELLEN, nachDringlichkeit, planMitAuswahl, rolleAus,
  type GeraetPlan, type Inhalt, type PlanungsBild, type Rolle,
} from './trainingsplanung'

/* ========================================================== Schwellen */

/**
 * Die Regeln der Wochenverteilung – eine **Produktheuristik**, keine Messung
 * und ausdrücklich **keine trainingswissenschaftlich optimale Verteilung.**
 *
 * Es gibt keine Untersuchung, die sagt, wie viele Geräte in vierzehn Tagen
 * wie oft vorkommen sollten. Die Zahlen sind eine Verabredung, stehen an einer
 * Stelle und lassen sich an einer Stelle ändern – dieselbe Zurückhaltung wie
 * bei `SCHWELLEN` (sicherheit.ts), `DURCHGANG_SCHWELLEN` (kuerdurchgaenge.ts)
 * und `PLAN_SCHWELLEN` (trainingsplanung.ts).
 */
export const WOCHEN_SCHWELLEN = {
  /**
   * Wie weit nach vorn geschaut wird: vierzehn Tage.
   *
   * **Ein rollender Zeitraum, kein Kalenderausschnitt** – und das ist eine
   * Entscheidung gegen die vorhandene Montagswoche (`startOfWeek`): Eine feste
   * Woche zeigte am Samstag fast nichts mehr an, obwohl gerade dann die
   * nächsten Einheiten interessant sind. Vierzehn Tage statt sieben, weil zwei
   * bis drei Einheiten je Woche sonst kaum eine Verteilung ergeben.
   *
   * Es entsteht dadurch **kein neuer Wochenbegriff**: Gerechnet wird mit
   * `tagDifferenz` und beschriftet mit `relativeDay()` – beides vorhanden.
   */
  horizontTage: 14,
  /** Darunter gilt eine Einheit als kurz – nur wenn eine Dauer hinterlegt ist. */
  kurzMinuten: 60,
  /** Ab hier gilt sie als lang. Ändert nur die Beschriftung, nicht die Plätze. */
  langMinuten: 120,
  /** Plätze in einer kurzen Einheit. Sonst gilt `PLAN_SCHWELLEN.maxGeraete`. */
  geraeteKurz: 2,
} as const

/**
 * Wie viel in eine Einheit passt – **qualitativ**.
 *
 * `unbekannt` ist der Normalfall: Zu einer geplanten Einheit steht selten eine
 * Dauer. Dann wird nichts über die Kapazität behauptet und es gilt die normale
 * Platzzahl. Eine Dauer wird nur benutzt, wenn sie **tatsächlich** an der
 * Einheit steht – geraten wird keine.
 */
export type Kapazitaet = 'kurz' | 'normal' | 'lang' | 'unbekannt'

export const KAPAZITAET_LABEL: Record<Kapazitaet, string> = {
  kurz: 'kurze Einheit',
  normal: 'normale Einheit',
  lang: 'lange Einheit',
  unbekannt: '',
}

export function kapazitaetAus(dauerMinuten: number | null | undefined): Kapazitaet {
  if (!dauerMinuten || dauerMinuten <= 0) return 'unbekannt'
  if (dauerMinuten < WOCHEN_SCHWELLEN.kurzMinuten) return 'kurz'
  if (dauerMinuten >= WOCHEN_SCHWELLEN.langMinuten) return 'lang'
  return 'normal'
}

/** Wie viele Geräte in eine Einheit dieser Kapazität passen. */
export function plaetzeFuer(kapazitaet: Kapazitaet): number {
  // Nach oben wird die Phase-3A-Grenze NICHT angehoben: Eine lange Einheit
  // bekommt nicht vier Geraete, sonst waere 3A stillschweigend umgangen.
  return kapazitaet === 'kurz' ? WOCHEN_SCHWELLEN.geraeteKurz : PLAN_SCHWELLEN.maxGeraete
}

/* ============================================================= Eingang */

/** Ein kommender Trainingstermin, wie die Oberfläche ihn übergibt. */
export interface TerminEingang {
  /** Die Zeile aus `workout_sessions` – `status: 'planned'`, Turnen. */
  sessionId: string
  day: DayString
  titel: string | null
  /** Die an der Einheit hinterlegte Dauer, oder `null`. Wird nicht geraten. */
  dauerMinuten: number | null
  /** Name der Tagesart des Tages, falls hinterlegt – nur Kontext. */
  tagesart: string | null
  /** Freie Minuten des Tages aus `computeCapacity()`, falls bekannt – nur Kontext. */
  freieMinuten: number | null
}

export interface WochenEingang {
  /**
   * Der fertige Phase-3A-Vorschlag.
   *
   * Wird **nicht** neu gerechnet. Alles, was über Priorität, Auffälligkeit,
   * Kandidaten und Kürstabilität entscheidet, steht hier schon drin.
   */
  plan: PlanungsBild
  /** Alle geplanten Turneinheiten; die Auswahl des Zeitraums trifft dieses Modul. */
  termine: TerminEingang[]
  heute: DayString
  tagDifferenz: (von: DayString, bis: DayString) => number
}

/* ============================================================ Ausgang */

/** Warum ein Gerät keinen Platz bekommen hat. */
export type OffenGrund = 'keine_plaetze' | 'keine_einheit'

export const OFFEN_TEXT: Record<OffenGrund, string> = {
  keine_plaetze:
    'Für diese Geräte war in den vorhandenen Einheiten kein Platz mehr. Sie verschwinden nicht – sie stehen hier.',
  keine_einheit:
    'Es ist kein Turntraining geplant, auf das sich diese Geräte verteilen liessen.',
}

export interface OffenerPosten {
  apparatus: string
  name: string
  rolle: Rolle
  grund: OffenGrund
  /**
   * Die Inhalte aus Phase 3A – auch hier vollständig.
   *
   * Ein offener Posten ist kein leerer Platzhalter: Schiebt der Nutzer ihn in
   * eine Einheit, muss dort sofort stehen, was zu tun wäre. Sonst bekäme er
   * eine Überschrift ohne Inhalt.
   */
  inhalte: Inhalt[]
  /** Die Begründung aus Phase 3A – unverändert. */
  warum: string[]
}

/** Ein Gerät, wie es in einer geplanten Einheit steht. */
export interface EinheitGeraet {
  apparatus: string
  name: string
  rolle: Rolle
  /** Die Inhalte aus Phase 3A. Bei einer Wiederholung nur der Kürdurchgang. */
  inhalte: Inhalt[]
  /**
   * Zweites Auftreten desselben Geräts in diesem Zeitraum.
   *
   * Erlaubt nur, wenn die **Kür** das Problem ist – dann ist mehrmaliges
   * Durchturnen genau die Aufgabe (Phase 2E). Die Elementarbeit wird dabei
   * nicht wiederholt.
   */
  wiederholung: boolean
  /** Warum dieses Gerät – aus Phase 3A übernommen. */
  warum: string[]
}

export interface GeplanteEinheit {
  sessionId: string
  day: DayString
  /** „heute", „morgen", „in 4 Tagen" – über den vorhandenen `relativeDay()`. */
  label: string
  titel: string | null
  tagesart: string | null
  freieMinuten: number | null
  kapazitaet: Kapazitaet
  plaetze: number
  geraete: EinheitGeraet[]
}

export interface UeberfaelligerTermin {
  sessionId: string
  day: DayString
  label: string
}

export interface WochenBild {
  /** Die kommenden Einheiten im Zeitraum, chronologisch. */
  einheiten: GeplanteEinheit[]
  /** Was nirgends unterkam – nichts verschwindet stillschweigend. */
  offen: OffenerPosten[]
  /**
   * Geplante Termine, deren Tag vorbei ist, ohne dass Training erfasst wurde.
   *
   * Sie werden **nicht** als absolviert behandelt und bekommen keine Inhalte:
   * Geplant ist nicht durchgeführt.
   */
  ueberfaellig: UeberfaelligerTermin[]
  /** Kein kommender Termin im Zeitraum bekannt. */
  keineTermine: boolean
  /**
   * Genau eine Einheit: Dann gilt der Phase-3A-Vorschlag unverändert.
   *
   * Er wird ausdrücklich **nicht** neu verteilt – bei einer einzigen Einheit
   * gäbe es nichts zu verteilen, und ein abweichendes Ergebnis wäre nur
   * verwirrend.
   */
  eineEinheit: boolean
  /** Wie weit geschaut wurde – für die Beschriftung. */
  horizontTage: number
}

/* ==================================================== Die Verteilung */

/**
 * Darf ein Gerät ein zweites Mal vorkommen?
 *
 * Nur wenn die **Kür am Stück** das Problem ist (`kuer_zuerst` aus Phase 3A,
 * also Empfehlung `kuer_unter_belastung`): Dann ist mehrmaliges Durchturnen
 * genau die Aufgabe und keine unnötige Wiederholung. In jedem anderen Fall
 * bringt dasselbe Gerät zweimal in derselben Woche nichts, was der Plan
 * begründen könnte.
 */
function darfWiederholen(g: GeraetPlan): boolean {
  return g.reihenfolgeArt === 'kuer_zuerst'
    && g.inhalte.some((i) => i.art === 'durchgang')
}

/** Bei einer Wiederholung bleibt nur die Kür am Stück übrig. */
function wiederholungsInhalte(g: GeraetPlan): Inhalt[] {
  return g.inhalte
    .filter((i) => i.art === 'durchgang')
    .map((i) => ({
      ...i,
      key: `${i.key}:wdh`,
      warum: [...i.warum,
        'Zweiter Durchgangstermin in diesem Zeitraum – die ganze Übung kommt '
        + 'derzeit nicht verlässlich durch.'],
    }))
}

/** Passt dieses Gerät noch in diese Einheit? */
function passt(einheit: GeplanteEinheit, rolle: Rolle, apparatus: string): boolean {
  if (einheit.geraete.length >= einheit.plaetze) return false
  if (einheit.geraete.some((x) => x.apparatus === apparatus)) return false
  if (rolle === 'schwerpunkt') {
    const schon = einheit.geraete.filter((x) => x.rolle === 'schwerpunkt').length
    // Die Phase-3A-Grenze gilt JE EINHEIT weiter und wird hier nicht angehoben.
    if (schon >= PLAN_SCHWELLEN.maxSchwerpunkte) return false
  }
  return true
}

/**
 * Die Wochenplanung – in einem Durchgang.
 *
 * **Die Verteilungsregeln, ausgeschrieben:**
 *
 *   1. Einheiten chronologisch. Plätze je Einheit: `PLAN_SCHWELLEN.maxGeraete`,
 *      bei einer nachweislich kurzen Einheit weniger. Höchstens
 *      `PLAN_SCHWELLEN.maxSchwerpunkte` Schwerpunkte je Einheit – die
 *      Phase-3A-Heuristik gilt weiter und wird nicht umgangen.
 *   2. Geräte mit Inhalt in der Phase-3A-Reihe (`nachDringlichkeit`).
 *   3. **Reihum**: Die erste Einheit bekommt das erste Gerät, die zweite das
 *      zweite, dann wieder von vorn. So landen nicht alle Schwerpunkte am
 *      ersten Tag – der Grund, warum überhaupt verteilt wird.
 *   4. Passt ein Gerät in die gerade betrachtete Einheit nicht (Plätze voll
 *      oder schon zwei Schwerpunkte), rückt es in die nächste Einheit, in die
 *      es passt.
 *   5. Bleiben zum Schluss Plätze frei, darf ein Gerät ein zweites Mal – aber
 *      nur, wenn die Kür das Problem ist, und dann nur mit dem Kürdurchgang.
 *   6. Was übrig bleibt, steht unter „Noch offen".
 *
 * Die Inhalte eines Geräts bleiben **zusammen**: Elementarbeit, Entwicklung und
 * Kürdurchgang desselben Geräts auf zwei Tage zu zerlegen hiesse, an einem Tag
 * an Element A zu arbeiten und an einem anderen die Kür zu turnen, in der es
 * vorkommt. Verteilt werden deshalb Geräte, nicht einzelne Zeilen.
 */
export function wochenplanung(e: WochenEingang): WochenBild {
  const horizont = WOCHEN_SCHWELLEN.horizontTage

  /* ------------------------------------------------------- Die Termine */
  const kommend: TerminEingang[] = []
  const ueberfaellig: UeberfaelligerTermin[] = []
  for (const t of e.termine) {
    const abstand = e.tagDifferenz(e.heute, t.day)
    if (abstand < 0) {
      ueberfaellig.push({
        sessionId: t.sessionId, day: t.day, label: relativeDay(t.day, e.heute),
      })
      continue
    }
    if (abstand > horizont) continue
    kommend.push(t)
  }
  kommend.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1
    : a.sessionId.localeCompare(b.sessionId)))
  ueberfaellig.sort((a, b) => (a.day < b.day ? 1 : -1))

  const einheiten: GeplanteEinheit[] = kommend.map((t) => {
    const kapazitaet = kapazitaetAus(t.dauerMinuten)
    return {
      sessionId: t.sessionId,
      day: t.day,
      label: relativeDay(t.day, e.heute),
      titel: t.titel,
      tagesart: t.tagesart,
      freieMinuten: t.freieMinuten,
      kapazitaet,
      plaetze: plaetzeFuer(kapazitaet),
      geraete: [],
    }
  })

  /* ------------------------------------------------------- Die Geräte */
  // Alle Geraete mit Inhalt, in der Phase-3A-Reihe. Nicht nur die drei, die 3A
  // fuer EINE Einheit ausgewaehlt hat: Bei mehreren Einheiten gibt es mehr
  // Plaetze, und ein viertes Geraet mit Inhalt gehoert dann dazu.
  const kandidaten = e.plan.geraete
    .filter((g) => g.inhalte.length > 0)
    .map((g) => ({ g, rolle: g.rolle ?? rolleAus(g.prioritaet) }))
    .sort((a, b) => nachDringlichkeit(
      { prioritaet: a.g.prioritaet, tageHer: a.g.tageHer, apparatus: a.g.apparatus },
      { prioritaet: b.g.prioritaet, tageHer: b.g.tageHer, apparatus: b.g.apparatus }))

  const offen: OffenerPosten[] = []

  if (!einheiten.length) {
    // Kein Termin: nichts wird verteilt, und es wird auch kein Tag erfunden.
    for (const k of kandidaten) {
      offen.push({
        apparatus: k.g.apparatus, name: k.g.name, rolle: k.rolle,
        grund: 'keine_einheit', inhalte: k.g.inhalte, warum: k.g.warum,
      })
    }
    return {
      einheiten: [], offen, ueberfaellig, keineTermine: true,
      eineEinheit: false, horizontTage: horizont,
    }
  }

  if (einheiten.length === 1) {
    /* Genau eine Einheit: der Phase-3A-Vorschlag, unveraendert uebernommen.
       Verteilt wird nichts - es gibt nichts zu verteilen, und ein abweichendes
       Ergebnis waere nur verwirrend. */
    const dreiA = planMitAuswahl(e.plan)
    einheiten[0].geraete = dreiA
      .slice(0, einheiten[0].plaetze)
      .map((g) => ({
        apparatus: g.apparatus,
        name: g.name,
        rolle: g.rolle ?? rolleAus(g.prioritaet),
        inhalte: g.inhalte,
        wiederholung: false,
        warum: g.warum,
      }))
    // Was 3A schon nicht unterbrachte - und was eine kurze Einheit abschneidet.
    const gesetzt = new Set(einheiten[0].geraete.map((g) => g.apparatus))
    for (const k of kandidaten) {
      if (gesetzt.has(k.g.apparatus)) continue
      offen.push({
        apparatus: k.g.apparatus, name: k.g.name, rolle: k.rolle,
        grund: 'keine_plaetze', inhalte: k.g.inhalte, warum: k.g.warum,
      })
    }
    return {
      einheiten, offen, ueberfaellig, keineTermine: false,
      eineEinheit: true, horizontTage: horizont,
    }
  }

  /* ------------------------------------- Reihum über die Einheiten verteilen */
  const uebrig = [...kandidaten]
  let zeiger = 0
  while (uebrig.length) {
    let gesetzt = false
    // Ein Durchlauf ueber alle noch offenen Geraete, beginnend beim Zeiger:
    // Das erste, das irgendwo passt, kommt dorthin.
    for (let i = 0; i < uebrig.length; i++) {
      const k = uebrig[i]
      // Reihum: ab der Einheit, die als naechste dran ist.
      let ziel: GeplanteEinheit | null = null
      for (let n = 0; n < einheiten.length; n++) {
        const kandidat = einheiten[(zeiger + n) % einheiten.length]
        if (passt(kandidat, k.rolle, k.g.apparatus)) {
          ziel = kandidat
          zeiger = (zeiger + n + 1) % einheiten.length
          break
        }
      }
      if (!ziel) continue
      ziel.geraete.push({
        apparatus: k.g.apparatus,
        name: k.g.name,
        rolle: k.rolle,
        inhalte: k.g.inhalte,
        wiederholung: false,
        warum: k.g.warum,
      })
      uebrig.splice(i, 1)
      gesetzt = true
      break
    }
    // Nichts mehr unterzubringen: der Rest bleibt offen.
    if (!gesetzt) break
  }

  for (const k of uebrig) {
    offen.push({
      apparatus: k.g.apparatus, name: k.g.name, rolle: k.rolle,
      grund: 'keine_plaetze', inhalte: k.g.inhalte, warum: k.g.warum,
    })
  }

  /* ------------------------------ Freie Plätze: die Kür noch einmal am Stück
     Nur wenn NICHTS offen geblieben ist. Ein Gerät ein zweites Mal zu bringen,
     während ein anderes mit Inhalt gar nicht vorkommt, wäre die schlechtere
     Verteilung - auch dann, wenn der freie Platz an der Schwerpunktgrenze
     entstanden ist und das offene Gerät ihn nicht nehmen könnte. */
  const nichtsOffen = !offen.some((o) => o.grund === 'keine_plaetze')
  for (const einheit of nichtsOffen ? einheiten : []) {
    while (einheit.geraete.length < einheit.plaetze) {
      const k = kandidaten.find((x) =>
        darfWiederholen(x.g)
        && !einheit.geraete.some((y) => y.apparatus === x.g.apparatus)
        && einheiten.some((u) => u.geraete.some((y) => y.apparatus === x.g.apparatus)))
      if (!k) break
      einheit.geraete.push({
        apparatus: k.g.apparatus,
        name: k.g.name,
        // Eine Wiederholung ist kein zweiter Schwerpunkt - sie soll die
        // Schwerpunktgrenze der Einheit nicht aufbrauchen.
        rolle: 'nebenfokus',
        inhalte: wiederholungsInhalte(k.g),
        wiederholung: true,
        warum: k.g.warum,
      })
    }
  }

  // Innerhalb einer Einheit: Schwerpunkt zuerst, dann Wettkampfreihenfolge.
  const ROLLEN: Rolle[] = ['schwerpunkt', 'nebenfokus', 'wartung']
  for (const einheit of einheiten) {
    einheit.geraete.sort((a, b) =>
      ROLLEN.indexOf(a.rolle) - ROLLEN.indexOf(b.rolle)
      || (geraet(a.apparatus)?.reihenfolge ?? 99) - (geraet(b.apparatus)?.reihenfolge ?? 99))
  }

  return {
    einheiten, offen, ueberfaellig, keineTermine: false,
    eineEinheit: false, horizontTage: horizont,
  }
}

/* ==================================================== Die Wahl des Nutzers */

/**
 * Was der Nutzer an der Verteilung geändert hat.
 *
 * Alles nur im Arbeitsspeicher, aus demselben Grund wie in Phase 3A: Nach dem
 * ersten absolvierten Training ändert sich der Trainingsfokus, und der Rest der
 * Woche muss sich ändern dürfen. Eine festgeschriebene Zuordnung wäre ab dann
 * falsch.
 */
export interface WochenAuswahl {
  /**
   * Verschiebungen: Gerät → Einheit, in die es gehören soll.
   *
   * Reicht für „verschieben" **und** „tauschen": Ein Tausch ist zwei
   * Verschiebungen, und so braucht es keinen eigenen Fall.
   */
  verschoben?: Readonly<Record<string, string>>
  /** Geräte, die der Nutzer aus der Woche genommen hat. */
  ohne?: readonly string[]
}

/**
 * Die Woche, wie der Nutzer sie haben will.
 *
 * Eine reine Funktion – dasselbe Muster wie `planMitAuswahl()`, und aus
 * demselben Grund: So lassen sich die Fälle einzeln nachrechnen, statt sie
 * durch die Oberfläche klicken zu müssen.
 *
 *   - ein verschobenes Gerät steht in der genannten Einheit, auch wenn dort
 *     eigentlich kein Platz wäre (der Nutzer entscheidet über seine Woche)
 *   - ein entferntes Gerät fällt heraus und steht unter „Noch offen"
 *   - eine Verschiebung auf eine unbekannte Einheit wird übergangen
 */
export function wocheMitAuswahl(bild: WochenBild, a: WochenAuswahl = {}): WochenBild {
  const ohne = new Set(a.ohne ?? [])
  const verschoben = a.verschoben ?? {}
  const bekannt = new Set(bild.einheiten.map((u) => u.sessionId))

  const einheiten: GeplanteEinheit[] = bild.einheiten.map((u) => ({ ...u, geraete: [] }))
  const vonId = new Map(einheiten.map((u) => [u.sessionId, u]))
  const offen: OffenerPosten[] = [...bild.offen]

  for (const alt of bild.einheiten) {
    for (const g of alt.geraete) {
      if (ohne.has(g.apparatus)) {
        // Eine Wiederholung verschwindet einfach; das Geraet selbst steht ja
        // schon an seinem ersten Tag und muss nicht als offen gemeldet werden.
        if (!g.wiederholung && !offen.some((o) => o.apparatus === g.apparatus)) {
          offen.push({
            apparatus: g.apparatus, name: g.name, rolle: g.rolle,
            grund: 'keine_plaetze', inhalte: g.inhalte, warum: g.warum,
          })
        }
        continue
      }
      const wunsch = verschoben[g.apparatus]
      const ziel = wunsch && bekannt.has(wunsch)
        ? vonId.get(wunsch)!
        : vonId.get(alt.sessionId)!
      // Ein Geraet nicht zweimal in dieselbe Einheit: Bei einem Tausch koennte
      // es sonst neben seiner eigenen Wiederholung landen.
      if (ziel.geraete.some((x) => x.apparatus === g.apparatus && x.wiederholung === g.wiederholung)) {
        continue
      }
      ziel.geraete.push(g)
    }
  }

  // Ein hinzugewaehltes Geraet: eine Verschiebung von "offen" in eine Einheit.
  for (const [apparatus, ziel] of Object.entries(verschoben)) {
    if (ohne.has(apparatus) || !bekannt.has(ziel)) continue
    const schonDrin = einheiten.some((u) => u.geraete.some((g) => g.apparatus === apparatus))
    if (schonDrin) continue
    const posten = offen.find((o) => o.apparatus === apparatus)
    if (!posten) continue
    vonId.get(ziel)!.geraete.push({
      apparatus,
      name: posten.name,
      rolle: posten.rolle,
      inhalte: posten.inhalte,
      wiederholung: false,
      warum: posten.warum,
    })
    const i = offen.findIndex((o) => o.apparatus === apparatus)
    if (i >= 0) offen.splice(i, 1)
  }

  const ROLLEN: Rolle[] = ['schwerpunkt', 'nebenfokus', 'wartung']
  for (const u of einheiten) {
    u.geraete.sort((x, y) =>
      ROLLEN.indexOf(x.rolle) - ROLLEN.indexOf(y.rolle)
      || (geraet(x.apparatus)?.reihenfolge ?? 99) - (geraet(y.apparatus)?.reihenfolge ?? 99))
  }

  return { ...bild, einheiten, offen }
}

/* ============================================================ Anzeige */

/** „2 Einheiten geplant" – Einzahl ist kein Sonderfall zum Vergessen. */
export function einheitenLabel(n: number): string {
  return n === 1 ? '1 Einheit geplant' : `${n} Einheiten geplant`
}

/** Die Geräte einer Einheit als ein Satz – für die Kopfzeile. */
export function geraeteSatz(u: GeplanteEinheit): string {
  if (!u.geraete.length) return 'noch nichts zugeordnet'
  return u.geraete.map((g) => g.name).join(' · ')
}
