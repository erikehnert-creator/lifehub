/**
 * Kürdurchgänge: ob die ganze Übung am Stück funktioniert.
 *
 * ---------------------------------------------------------------------------
 * Die Lücke, die diese Datei schliesst
 *
 * Bis Phase 2D konnte LifeHub sagen, wie einzelne Elemente stehen – aber nicht,
 * ob die **Kür** steht. Zehn saubere Einzelversuche an acht Elementen sind
 * etwas anderes als eine durchgeturnte Kür, und genau dieser Unterschied ist im
 * Turnen der entscheidende: Am Ende einer Übung ist man müde, und das
 * schwierigste Element kommt selten zuerst.
 *
 * Ein Durchgang ist deshalb ein **eigener Datensatz** (`gym_routine_runs`) und
 * kein Sonderfall von `gym_attempts`. Er erzeugt auch keine: Wäre es so, sähe
 * eine achtmal geturnte Kür wie 64 gezielte Elementversuche aus, und die
 * Elementstatistik wäre verfälscht.
 *
 * **Ein abgebrochener Durchgang ist ein Durchgang.** Gerade die Abbrüche sind
 * die Auskunft.
 *
 * ---------------------------------------------------------------------------
 * Die Fassung entscheidet, nicht die Kür
 *
 * Jeder Durchgang zeigt auf eine unveränderliche Fassung
 * (`gym_routine_versions`), erzeugt mit derselben Rechnung wie bei den
 * Wettkämpfen (`fassungen.ts`). Keine zweite Versionierung.
 *
 * Weil die Fassungs-ID aus dem **Inhalt** kommt, ergibt sich das gewünschte
 * Verhalten von selbst: Alle Durchgänge einer unveränderten Kür teilen dieselbe
 * Fassung; ändert Erik die Kür, gehören die alten Durchgänge weiterhin zur
 * alten Fassung, und die Auswertung der aktuellen Wettkampfkür vermischt sie
 * **nicht** mit den neuen. Eine neue Kür kann andere Elemente und eine andere
 * Schwierigkeit haben – ihre Durchgänge sind nicht vergleichbar.
 *
 * ---------------------------------------------------------------------------
 * Was hier nicht passiert
 *
 * Keine Kampfrichterwertung, keine Note, keine Punktzahl. Gezählt wird, was
 * beobachtbar ist: durchgekommen oder nicht, Stürze, Unterbrechungen, Hilfe.
 * `quality` ist ein subjektiver Eindruck in vier Stufen, wird angezeigt und geht
 * in **keine** Rechnung ein.
 *
 * Ein Wettkampfergebnis ist **kein** Trainingsdurchgang. Aus `gym_results`
 * entsteht hier nie ein Durchgang; beides steht in der Analyse nebeneinander.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import type {
  GymElement, GymRoutine, GymRoutineElement, GymRoutineRun, GymRoutineVersion,
} from '../types'
import { GERAETE } from './geraete'
import { SCHWELLEN } from './sicherheit'
import { wettkampfKuerJeGeraet } from './kueren'
import { fassungsId, fassungsInhalt } from './fassungen'
import type { EinheitTag } from './elemente'

/* ========================================================== Schwellen */

/**
 * Die Schwellen der Kürstabilität – eine **Produktheuristik**, keine Messung.
 *
 * Sie sind ausdrücklich **andere** als die der Elementstabilität
 * (`SCHWELLEN` in `sicherheit.ts`: 0,9 und 0,6), weil ein Kürdurchgang eine
 * andere Messgrösse ist. Eine ganze Übung am Stück ohne Sturz, ohne Absetzen
 * und ohne Hilfe durchzubringen ist deutlich schwerer als ein einzelnes
 * Element sauber zu turnen; 90 % sauberer Durchgänge zu verlangen hiesse, jeden
 * Turner als instabil zu führen.
 *
 * Das **Zeitfenster** ist dagegen dasselbe wie überall im Modul
 * (`SCHWELLEN.fensterTage`, 56 Tage): Eine zweite, abweichende Zeitlogik wäre
 * genau das, was hier nicht entstehen soll.
 */
export const DURCHGANG_SCHWELLEN = {
  /**
   * Darunter gibt es keine Aussage.
   *
   * Bei zwei Durchgängen kann die Quote nur 0, 0,5 oder 1 sein – daraus eine
   * Kategorie zu machen hiesse, einen Münzwurf als Auskunft auszugeben.
   */
  mindestDurchgaenge: 3,
  /** Ab diesem Anteil sauberer Durchgänge gilt die Kür als stabil. */
  stabil: 0.75,
  /** Darunter gilt sie als instabil. */
  gemischt: 0.4,
} as const

/** Wie viele Wochen das Fenster umfasst – für die Beschriftung. */
export const FENSTER_WOCHEN = Math.round(SCHWELLEN.fensterTage / 7)

/* ====================================================== Ein Durchgang */

/** Ein Durchgang mit dem Tag seiner Einheit. */
export interface DurchgangMitTag {
  run: GymRoutineRun
  day: DayString
}

/** Die vier Felder, aus denen gerechnet wird. `quality` ist nicht dabei. */
export type DurchgangsKern = Pick<
  GymRoutineRun, 'completed' | 'falls' | 'interruptions' | 'with_help'
>

/**
 * Ein **sauberer** Durchgang: durchgekommen, ohne Sturz, ohne Absetzen, ohne
 * Hilfe.
 *
 * Alle vier zusammen, weil jedes einzelne die Übung im Wettkampf beenden würde
 * oder Abzug kostet. „Komplett, aber zweimal abgesetzt" ist kein sauberer
 * Durchgang – und genau deshalb steht die Zahl der Vollendungen in der Anzeige
 * getrennt daneben.
 */
export function istSauber(r: DurchgangsKern): boolean {
  return !!r.completed && !r.falls && !r.interruptions && !r.with_help
}

/* ======================================================= Das Bild */

export type KuerDurchgangsLage = 'zu_wenig_daten' | 'stabil' | 'gemischt' | 'instabil'

export const DURCHGANG_LAGE_LABEL: Record<KuerDurchgangsLage, string> = {
  zu_wenig_daten: 'zu wenig Durchgänge',
  stabil: 'stabil',
  gemischt: 'gemischt',
  instabil: 'instabil',
}

export interface DurchgangsBild {
  durchgaenge: number
  komplett: number
  sturzfrei: number
  unterbrechungsfrei: number
  ohneHilfe: number
  /** Komplett **und** sturzfrei **und** unterbrechungsfrei **und** ohne Hilfe. */
  sauber: number
  /** `sauber / durchgaenge`, oder `null` ohne Durchgänge. */
  sauberQuote: number | null
  /** Stürze insgesamt – für die Anzeige, nicht für die Kategorie. */
  stuerzeGesamt: number
  zuletzt: DayString | null
  tageHer: number | null
  /** Der letzte Durchgang, der komplett geturnt wurde. */
  zuletztKomplett: DayString | null
  tageHerKomplett: number | null
  lage: KuerDurchgangsLage
}

const LEER: DurchgangsBild = {
  durchgaenge: 0, komplett: 0, sturzfrei: 0, unterbrechungsfrei: 0, ohneHilfe: 0,
  sauber: 0, sauberQuote: null, stuerzeGesamt: 0,
  zuletzt: null, tageHer: null, zuletztKomplett: null, tageHerKomplett: null,
  lage: 'zu_wenig_daten',
}

/**
 * Die Kategorie aus dem Anteil sauberer Durchgänge.
 *
 * Nur diese eine Quote trägt die Kategorie – nicht vier Quoten und ein
 * Gewichtungsschlüssel. Die Einzelzahlen stehen in der Anzeige daneben, damit
 * nachvollziehbar ist, woraus sie entsteht.
 */
export function lageAus(durchgaenge: number, sauber: number): KuerDurchgangsLage {
  if (durchgaenge < DURCHGANG_SCHWELLEN.mindestDurchgaenge) return 'zu_wenig_daten'
  const quote = sauber / durchgaenge
  if (quote >= DURCHGANG_SCHWELLEN.stabil) return 'stabil'
  if (quote >= DURCHGANG_SCHWELLEN.gemischt) return 'gemischt'
  return 'instabil'
}

/**
 * Was eine Reihe von Durchgängen hergibt.
 *
 * Die Auswahl (welche Fassung, welches Zeitfenster) trifft der Aufrufer – diese
 * Funktion zählt nur.
 */
export function durchgangsBild(
  liste: DurchgangMitTag[],
  heute: DayString,
  tagDifferenz: (von: DayString, bis: DayString) => number,
): DurchgangsBild {
  if (!liste.length) return { ...LEER }

  let komplett = 0
  let sturzfrei = 0
  let unterbrechungsfrei = 0
  let ohneHilfe = 0
  let sauber = 0
  let stuerzeGesamt = 0
  let zuletzt: DayString | null = null
  let zuletztKomplett: DayString | null = null

  for (const { run, day } of liste) {
    if (run.completed) komplett++
    if (!run.falls) sturzfrei++
    if (!run.interruptions) unterbrechungsfrei++
    if (!run.with_help) ohneHilfe++
    if (istSauber(run)) sauber++
    stuerzeGesamt += run.falls ?? 0
    if (!zuletzt || day > zuletzt) zuletzt = day
    if (run.completed && (!zuletztKomplett || day > zuletztKomplett)) zuletztKomplett = day
  }

  const tage = (tag: DayString | null) =>
    tag ? Math.max(0, tagDifferenz(tag, heute)) : null

  return {
    durchgaenge: liste.length,
    komplett, sturzfrei, unterbrechungsfrei, ohneHilfe, sauber,
    sauberQuote: sauber / liste.length,
    stuerzeGesamt,
    zuletzt,
    tageHer: tage(zuletzt),
    zuletztKomplett,
    tageHerKomplett: tage(zuletztKomplett),
    lage: lageAus(liste.length, sauber),
  }
}

/* ================================================= Durchgänge zuordnen */

/**
 * Durchgänge mit dem Tag ihrer Einheit verbinden.
 *
 * Ein Durchgang ohne Einheit wird übergangen – dasselbe Muster wie
 * `bloeckeMitTag()` bei den Elementversuchen: Die Einheit wurde gelöscht, und
 * die Historie darf nicht so tun, als hätte das Training stattgefunden.
 */
export function durchgaengeMitTag(
  runs: GymRoutineRun[],
  einheiten: EinheitTag[],
): DurchgangMitTag[] {
  const tagVon = new Map<string, DayString>()
  for (const e of einheiten) {
    if (e.deleted_at) continue
    tagVon.set(e.id, e.day)
  }
  const out: DurchgangMitTag[] = []
  for (const r of runs) {
    if (r.deleted_at) continue
    const day = tagVon.get(r.session_id)
    if (!day) continue
    out.push({ run: r, day })
  }
  return out
}

/** Nur was im Beobachtungsfenster liegt. */
export function imFenster(
  liste: DurchgangMitTag[],
  heute: DayString,
  tagDifferenz: (von: DayString, bis: DayString) => number,
  tage: number = SCHWELLEN.fensterTage,
): DurchgangMitTag[] {
  return liste.filter((d) => tagDifferenz(d.day, heute) <= tage)
}

/** Chronologisch, älteste zuerst – für die Verlaufsliste. */
export function chronologisch(liste: DurchgangMitTag[]): DurchgangMitTag[] {
  return [...liste].sort((a, b) =>
    (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)
    || (a.run.sort_order ?? 0) - (b.run.sort_order ?? 0)
    || String(a.run.created_at).localeCompare(String(b.run.created_at))
    || a.run.id.localeCompare(b.run.id))
}

/* ===================================================== Je Gerät */

export interface KuerDurchgaenge {
  apparatus: string
  /** Die aktive Wettkampfkür, oder `null`. */
  kuer: GymRoutine | null
  /**
   * Die Fassungs-ID des **jetzigen** Zustands dieser Kür, oder `null`.
   *
   * Aus dem Inhalt gerechnet (`fassungsId`), nicht aus der Datenbank gelesen:
   * So steht sie auch dann bereit, wenn diese Fassung noch nie eingefroren
   * wurde – dann gibt es eben noch keine Durchgänge zu ihr.
   */
  fassungId: string | null
  /** Durchgänge der aktuellen Fassung im Fenster. */
  aktuell: DurchgangsBild
  /** Dieselben Durchgänge, chronologisch – für die Liste. */
  verlauf: DurchgangMitTag[]
  /**
   * Durchgänge **anderer** Fassungen derselben Kür im Fenster.
   *
   * Getrennt gehalten und nie hinzugezählt: Eine geänderte Kür hat andere
   * Elemente und eine andere Schwierigkeit.
   */
  fruehere: { durchgaenge: number; fassungen: number }
}

export interface DurchgangsEingang {
  runs: GymRoutineRun[]
  versionen: GymRoutineVersion[]
  einheiten: EinheitTag[]
  kueren: GymRoutine[]
  kuerVerknuepfungen: GymRoutineElement[]
  elemente: GymElement[]
  heute: DayString
  tagDifferenz: (von: DayString, bis: DayString) => number
}

/**
 * Je Gerät die Durchgänge der aktuellen Wettkampfkür – und getrennt davon die
 * der früheren Fassungen.
 *
 * Bewusst **ein** Aufruf für alle Geräte: Die Durchgänge werden einmal mit
 * ihren Tagen verbunden und einmal nach Fassung gruppiert, danach ist alles ein
 * Nachschlagen.
 */
export function durchgaengeJeGeraet(e: DurchgangsEingang): Map<string, KuerDurchgaenge> {
  const mitTag = imFenster(
    durchgaengeMitTag(e.runs, e.einheiten), e.heute, e.tagDifferenz)

  // Fassung -> zu welcher Kuer sie gehoert. Ueber die Fassungszeile, nicht
  // ueber den Durchgang: Der kennt nur seine Fassung, und das genuegt.
  const kuerVonFassung = new Map<string, string>()
  for (const v of e.versionen) {
    if (v.deleted_at) continue
    kuerVonFassung.set(v.id, v.routine_id)
  }

  const jeFassung = new Map<string, DurchgangMitTag[]>()
  for (const d of mitTag) {
    const liste = jeFassung.get(d.run.routine_version_id)
    if (liste) liste.push(d)
    else jeFassung.set(d.run.routine_version_id, [d])
  }

  const kuerJeGeraet = wettkampfKuerJeGeraet(e.kueren)
  const vorhanden = e.elemente.filter((x) => !x.deleted_at)

  const out = new Map<string, KuerDurchgaenge>()
  for (const g of GERAETE) {
    const kuer = kuerJeGeraet.get(g.key) ?? null
    const fassungId = kuer
      ? fassungsId(fassungsInhalt(kuer, e.kuerVerknuepfungen, vorhanden))
      : null

    const aktuelleListe = fassungId ? jeFassung.get(fassungId) ?? [] : []

    // Fruehere Fassungen DERSELBEN Kuer - nicht die anderer Kueren desselben
    // Geraets: Eine archivierte Nebenkuer ist keine fruehere Fassung.
    let fruehereDurchgaenge = 0
    const fruehereFassungen = new Set<string>()
    if (kuer) {
      for (const [vid, liste] of jeFassung) {
        if (vid === fassungId) continue
        if (kuerVonFassung.get(vid) !== kuer.id) continue
        fruehereDurchgaenge += liste.length
        fruehereFassungen.add(vid)
      }
    }

    out.set(g.key, {
      apparatus: g.key,
      kuer,
      fassungId,
      aktuell: durchgangsBild(aktuelleListe, e.heute, e.tagDifferenz),
      verlauf: chronologisch(aktuelleListe),
      fruehere: { durchgaenge: fruehereDurchgaenge, fassungen: fruehereFassungen.size },
    })
  }
  return out
}

/* ==================================================== Erfassung planen */

/** Was die Oberfläche je Durchgang festhält. */
export interface DurchgangsEingabe {
  completed: boolean
  falls: number
  interruptions: number
  withHelp: boolean
  quality: GymRoutineRun['quality']
  note?: string | null
}

export function leereEingabe(): DurchgangsEingabe {
  return { completed: true, falls: 0, interruptions: 0, withHelp: false, quality: null, note: null }
}

/**
 * Die Werte eines Durchgangs, wie sie in die Datenbank gehen.
 *
 * Die ID vergibt der Aufrufer nicht – `m.create()` erzeugt eine gewöhnliche
 * Zufalls-ID. Warum keine abgeleitete: siehe Migration 18 und
 * TURNEN_ARCHITEKTUR.md, 13.3. Mehrere Durchgänge derselben Kür in derselben
 * Einheit sind der Normalfall.
 */
export function werteAus(
  sessionId: string,
  versionId: string,
  e: DurchgangsEingabe,
  sortOrder: number,
): Record<string, any> {
  return {
    session_id: sessionId,
    routine_version_id: versionId,
    completed: e.completed ? 1 : 0,
    falls: Math.max(0, Math.round(e.falls || 0)),
    interruptions: Math.max(0, Math.round(e.interruptions || 0)),
    with_help: e.withHelp ? 1 : 0,
    quality: e.quality ?? null,
    note: e.note?.trim() || null,
    sort_order: sortOrder,
  }
}

/** Ein Durchgang, wie die Oberfläche ihn im Arbeitsspeicher hält. */
export interface DurchgangsStand {
  /** Die vorhandene Zeile, falls dieser Durchgang schon gespeichert war. */
  id: string | null
  /** Die Fassung, auf die er zeigt – beim Speichern eingefroren. */
  versionId: string
  eingabe: DurchgangsEingabe
}

export interface DurchgangsPlan {
  anlegen: { values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  entfernen: string[]
}

export function planIstLeer(plan: DurchgangsPlan): boolean {
  return !plan.anlegen.length && !plan.aendern.length && !plan.entfernen.length
}

const FELDER = [
  'routine_version_id', 'completed', 'falls', 'interruptions',
  'with_help', 'quality', 'note', 'sort_order',
] as const

/**
 * Was beim Speichern einer Einheit mit ihren Durchgängen zu tun ist.
 *
 * Dasselbe Muster wie `planeVersuche()` und `planeErgebnisse()`, und aus
 * demselben Grund: Die Fälle, die sonst erst im Betrieb auffallen, lassen sich
 * einzeln nachrechnen –
 *
 *   - zweimal dasselbe speichern ändert nichts (kein neues `updated_at`, keine
 *     neue `version`, kein Abgleich für nichts)
 *   - ein aus der Liste genommener Durchgang verliert seine Zeile
 *   - `sort_order` folgt der Reihenfolge in der Liste
 *
 * `anlegen` trägt **keine** ID: Sie entsteht beim Schreiben als gewöhnliche
 * Zufalls-ID (siehe Dateikopf und Migration 18).
 */
export function planeDurchgaenge(
  staende: DurchgangsStand[],
  vorhanden: GymRoutineRun[],
): DurchgangsPlan {
  const plan: DurchgangsPlan = { anlegen: [], aendern: [], entfernen: [] }

  const daIst = new Map<string, GymRoutineRun>()
  for (const r of vorhanden) {
    if (r.deleted_at) continue
    daIst.set(r.id, r)
  }

  const gesehen = new Set<string>()
  for (const [i, st] of staende.entries()) {
    const werte = werteAus('', st.versionId, st.eingabe, i)
    delete (werte as any).session_id

    if (!st.id || !daIst.has(st.id)) {
      plan.anlegen.push({ values: werte })
      continue
    }
    gesehen.add(st.id)
    const alt = daIst.get(st.id)!
    const patch: Record<string, any> = {}
    for (const feld of FELDER) {
      const neu = (werte as any)[feld]
      if (String(neu ?? '') !== String((alt as any)[feld] ?? '')) patch[feld] = neu
    }
    if (Object.keys(patch).length) plan.aendern.push({ id: alt.id, patch })
  }

  for (const [id] of daIst) {
    if (!gesehen.has(id)) plan.entfernen.push(id)
  }

  return plan
}

/** Eine Zeile zurück in eine Eingabe – zum Bearbeiten. */
export function eingabeAus(r: GymRoutineRun): DurchgangsEingabe {
  return {
    completed: !!r.completed,
    falls: r.falls ?? 0,
    interruptions: r.interruptions ?? 0,
    withHelp: !!r.with_help,
    quality: r.quality ?? null,
    note: r.note ?? null,
  }
}

/** Eine Zeile in einem Satz – für die Verlaufsliste. */
export function durchgangText(r: GymRoutineRun): string {
  const teile: string[] = [r.completed ? 'komplett' : 'abgebrochen']
  teile.push(r.falls === 1 ? '1 Sturz' : `${r.falls ?? 0} Stürze`)
  if (r.interruptions) {
    teile.push(r.interruptions === 1 ? '1 Unterbrechung' : `${r.interruptions} Unterbrechungen`)
  }
  if (r.with_help) teile.push('mit Hilfe')
  return teile.join(' · ')
}

/** „1 Durchgang" oder „5 Durchgänge" – Einzahl ist kein Sonderfall zum Vergessen. */
export function durchgaengeLabel(n: number): string {
  return n === 1 ? '1 Durchgang' : `${n} Durchgänge`
}

export const QUALITAET_LABEL: Record<NonNullable<GymRoutineRun['quality']>, string> = {
  sehr_gut: 'sehr gut',
  gut: 'gut',
  gemischt: 'gemischt',
  schlecht: 'schlecht',
}
