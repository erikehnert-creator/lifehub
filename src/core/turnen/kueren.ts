/**
 * Küren: was in ihnen steht, was sich daraus sagen lässt – und welche gilt.
 *
 * Reine Logik ohne Datenbank und ohne React. Der Aufrufer reicht die Zeilen
 * herein, die er ohnehin geladen hat; alles hier ist gerechnet, nichts
 * gespeichert.
 *
 * ---------------------------------------------------------------------------
 * Es werden KEINE Wertungsregeln erfunden
 *
 * Die einzige Zahl, die dieses Modul über die Schwierigkeit einer Kür
 * ausrechnet, ist die schlichte Summe der eingetragenen `difficulty_value`.
 * Sie heisst „Schwierigkeitssumme der Elemente" und ist ausdrücklich **kein**
 * D-Wert und keine D-Note: Anschlussboni, Elementgruppenanforderungen, die
 * Zehn-Elemente-Regel, das Streichergebnis und der Abgangsbonus fliessen nicht
 * ein. Der Code of Points ändert sich je Olympiazyklus und je Liga – eine
 * selbstgebaute Rechnung wäre nach einem Jahr falsch und sähe trotzdem richtig
 * aus (TURNEN_ARCHITEKTUR.md, 4.2).
 *
 * Fehlende Werte werden deshalb auch nicht als 0 mitgezählt, sondern gezählt
 * und gemeldet. Eine Summe, die so tut, als wäre sie vollständig, ist
 * schlimmer als gar keine.
 */
import type { GymElement, GymRoutine, GymRoutineElement } from '../types'
import type { ElementBild } from './elemente'

/* ============================================================ Reihenfolge */

/** Ein Platz in einer Kür, samt dem Element, das dort steht. */
export interface KuerEintrag {
  eintrag: GymRoutineElement
  /**
   * Das Element – oder `null`, wenn es gelöscht wurde.
   *
   * Der Platz bleibt trotzdem bestehen. Eine Kür, aus der beim Löschen eines
   * Elements stillschweigend eine Zeile verschwände, wäre hinterher eine
   * andere Kür, ohne dass es jemand bemerkt.
   */
  element: GymElement | null
  /** 1-basiert, so wie es in der Oberfläche steht. */
  platz: number
}

/**
 * Die Elemente einer Kür, in fester Reihenfolge.
 *
 * `position` allein genügt dafür nicht: Sie ist ein Sortierwert und darf
 * doppelt vorkommen – etwa wenn zwei Geräte offline je ein Element ergänzt
 * haben. Ohne festen Nachrang zeigte danach jedes Gerät eine andere
 * Reihenfolge derselben Kür. `created_at` und `id` brechen den Gleichstand
 * auf beiden Geräten gleich.
 */
export function kuerElemente(
  routineId: string,
  verknuepfungen: GymRoutineElement[],
  elemente: GymElement[],
): KuerEintrag[] {
  const nachId = new Map<string, GymElement>()
  for (const e of elemente) nachId.set(e.id, e)

  return verknuepfungen
    .filter((v) => !v.deleted_at && v.routine_id === routineId)
    .sort((a, b) =>
      (a.position ?? 0) - (b.position ?? 0)
      || String(a.created_at).localeCompare(String(b.created_at))
      || a.id.localeCompare(b.id))
    .map((eintrag, i) => ({
      eintrag,
      element: nachId.get(eintrag.element_id) ?? null,
      platz: i + 1,
    }))
}

/**
 * Einen Eintrag um einen Platz verschieben.
 *
 * Arbeitet auf einer Liste, nicht auf der Datenbank: Die Oberfläche hält die
 * Reihenfolge im Arbeitsspeicher und schreibt sie einmal beim Speichern
 * (siehe `planeKuerElemente`). Ein Schreibvorgang je Tippen wäre bei zehn
 * Verschiebungen zehn Abgleichrunden für ein Zwischenergebnis.
 *
 * Gibt die unveränderte Liste zurück, wenn der Zug ins Leere ginge – der
 * Aufrufer muss den Rand nicht selbst prüfen.
 */
export function verschiebe<T>(liste: T[], index: number, richtung: -1 | 1): T[] {
  const ziel = index + richtung
  if (index < 0 || index >= liste.length || ziel < 0 || ziel >= liste.length) return liste
  const kopie = [...liste]
  const [raus] = kopie.splice(index, 1)
  kopie.splice(ziel, 0, raus)
  return kopie
}

/* ======================================================== Schwierigkeit */

export interface Schwierigkeit {
  /** Zahl der Plätze in der Kür, einschliesslich gelöschter Elemente. */
  elemente: number
  /** Summe der eingetragenen `difficulty_value`. */
  summe: number
  /** Plätze, die einen Wert beigesteuert haben. */
  mitWert: number
  /** Plätze ohne Wert – kein Wert eingetragen oder Element gelöscht. */
  ohneWert: number
  /**
   * Steht hinter jedem Platz ein Wert?
   *
   * Nur dann ist die Summe eine Aussage über die ganze Kür. Sonst ist sie die
   * Summe eines Teils, und die Oberfläche muss das dazusagen.
   */
  vollstaendig: boolean
  /** Die vorkommenden Schwierigkeitsbuchstaben mit ihrer Anzahl, A vor B. */
  buchstaben: { buchstabe: string; anzahl: number }[]
}

const LEER_SCHWIERIGKEIT: Schwierigkeit = {
  elemente: 0, summe: 0, mitWert: 0, ohneWert: 0, vollstaendig: false, buchstaben: [],
}

/**
 * Die Schwierigkeitssumme der Elemente einer Kür.
 *
 * Kein D-Wert. Siehe der Hinweis oben im Modul.
 *
 * Eine leere Kür gilt als NICHT vollständig: Null Elemente mit null Werten
 * sind formal lückenlos, aber „0,0 – vollständig" wäre über eine leere Kür
 * eine Aussage, die niemand treffen wollte.
 */
export function schwierigkeit(eintraege: KuerEintrag[]): Schwierigkeit {
  if (!eintraege.length) return LEER_SCHWIERIGKEIT

  let summe = 0
  let mitWert = 0
  const zaehler = new Map<string, number>()

  for (const { element } of eintraege) {
    const wert = element?.difficulty_value
    if (element && typeof wert === 'number' && Number.isFinite(wert)) {
      summe += wert
      mitWert++
    }
    const b = element?.difficulty_letter?.trim().toUpperCase()
    if (b) zaehler.set(b, (zaehler.get(b) ?? 0) + 1)
  }

  return {
    elemente: eintraege.length,
    // Gleitkomma: 0.1 + 0.2 ergäbe sonst 0.30000000000000004 in der Anzeige.
    // Drei Nachkommastellen sind mehr, als jede Wertungsvorschrift kennt.
    summe: Math.round(summe * 1000) / 1000,
    mitWert,
    ohneWert: eintraege.length - mitWert,
    vollstaendig: mitWert === eintraege.length,
    buchstaben: [...zaehler.entries()]
      .map(([buchstabe, anzahl]) => ({ buchstabe, anzahl }))
      .sort((a, b) => a.buchstabe.localeCompare(b.buchstabe)),
  }
}

/* ====================================================== Problemstellen */

export const KUER_SCHWELLEN = {
  /**
   * Ab wie vielen Tagen ein Element in einer Kür als „lange nicht trainiert"
   * gilt.
   *
   * Vier Wochen. Das ist eine **Verabredung, keine Messung** – dieselbe
   * Überlegung wie bei `SCHWELLEN` in `sicherheit.ts`. Bewusst kürzer als das
   * dortige Beobachtungsfenster von 56 Tagen: Dort geht es darum, ob genug
   * Versuche für eine Aussage zusammenkommen, hier darum, woran man beim
   * nächsten Training denken sollte.
   */
  langeHerTage: 28,
} as const

/** Warum ein Platz in einer Kür Aufmerksamkeit braucht. */
export type ProblemArt = 'geloescht' | 'neu' | 'aufbau' | 'unsicher' | 'langeHer' | 'nieTrainiert'

export interface Problemstelle {
  platz: number
  art: ProblemArt
  /** Was dasteht – schon fertig formuliert, damit es überall gleich heisst. */
  text: string
  /** Nur bei `langeHer`: wie lange. */
  tageHer?: number
}

/**
 * Was an einer Kür auffällt – rein beschreibend.
 *
 * Ausdrücklich **keine** Empfehlung. „Ersetze Element X durch Y" wäre eine
 * Aussage über Turnen, die LifeHub aus Zählerständen nicht treffen kann; sie
 * bliebe eine Behauptung in überzeugender Aufmachung. Hier steht nur, was in
 * den Daten sichtbar ist.
 *
 * Je Platz höchstens EIN Hinweis, und zwar der dringlichere: Ein Element, das
 * unsicher UND seit sechs Wochen nicht dran war, dreimal aufzuführen macht die
 * Liste unlesbar und die dringenden Fälle unauffindbar.
 */
export function problemstellen(
  eintraege: KuerEintrag[],
  bilder: Map<string, ElementBild>,
): Problemstelle[] {
  const out: Problemstelle[] = []

  for (const { element, platz } of eintraege) {
    if (!element) {
      out.push({ platz, art: 'geloescht', text: 'Element gelöscht' })
      continue
    }

    const bild = bilder.get(element.id)
    const tageHer = bild?.tageHer ?? null

    // Der Status, den der Turner gesetzt hat, wiegt schwerer als die
    // Liegezeit: Er weiss, ob das Element steht.
    if (element.status === 'aufbau') {
      out.push({ platz, art: 'aufbau', text: 'im Aufbau' })
      continue
    }
    if (element.status === 'unsicher') {
      out.push({ platz, art: 'unsicher', text: 'unsicher' })
      continue
    }
    if (element.status === 'neu') {
      out.push({ platz, art: 'neu', text: 'neu' })
      continue
    }
    if (tageHer === null) {
      out.push({ platz, art: 'nieTrainiert', text: 'nie trainiert' })
      continue
    }
    if (tageHer >= KUER_SCHWELLEN.langeHerTage) {
      out.push({ platz, art: 'langeHer', tageHer, text: `seit ${tageHer} Tagen nicht trainiert` })
    }
  }

  return out
}

/**
 * Die Problemstellen als kurze Sätze, wie sie in der Übersicht stehen.
 *
 * Gezählt statt aufgezählt: „2 unsichere Elemente" statt zweier Zeilen. In der
 * Kürliste ist Platz für eine Zeile, nicht für eine Liste.
 */
export function problemZusammenfassung(stellen: Problemstelle[]): string[] {
  const zaehle = (art: ProblemArt) => stellen.filter((s) => s.art === art).length
  const out: string[] = []

  const geloescht = zaehle('geloescht')
  if (geloescht) out.push(geloescht === 1 ? '1 gelöschtes Element' : `${geloescht} gelöschte Elemente`)

  const unsicher = zaehle('unsicher')
  if (unsicher) out.push(unsicher === 1 ? '1 unsicheres Element' : `${unsicher} unsichere Elemente`)

  const aufbau = zaehle('aufbau')
  if (aufbau) out.push(aufbau === 1 ? '1 Element im Aufbau' : `${aufbau} Elemente im Aufbau`)

  const neu = zaehle('neu')
  if (neu) out.push(neu === 1 ? '1 neues Element' : `${neu} neue Elemente`)

  const nie = zaehle('nieTrainiert')
  if (nie) out.push(nie === 1 ? '1 nie trainiertes Element' : `${nie} nie trainierte Elemente`)

  // Bei der Liegezeit zählt die längste, nicht die Anzahl: „3 Elemente lange
  // nicht trainiert" sagt weniger als „seit 47 Tagen nicht trainiert".
  const lange = stellen.filter((s) => s.art === 'langeHer')
  if (lange.length) {
    const max = Math.max(...lange.map((s) => s.tageHer ?? 0))
    out.push(lange.length === 1
      ? `1 Element seit ${max} Tagen nicht trainiert`
      : `${lange.length} Elemente lange nicht trainiert (längstens ${max} Tage)`)
  }

  return out
}

/* ================================================== Aktive Wettkampfkür */

/**
 * Die aktive Wettkampfkür eines Geräts – abgeleitet, nicht gespeichert.
 *
 * ---------------------------------------------------------------------------
 * Warum abgeleitet
 *
 * Gefordert ist: je Gerät höchstens EINE. Ein Kennzeichen je Zeile kann das
 * über zwei Geräte hinweg nicht halten. Der Abgleich führt Zeilen EINZELN
 * zusammen (`mergeRows` in sync/engine.ts): Markiert der PC offline Kür B und
 * das Handy offline Kür C, gewinnt jede der beiden Zeilen für sich – danach
 * stünden zwei Küren auf „aktiv". Ein mehrspaltiger UNIQUE-Index wäre keine
 * Abhilfe, sondern eine Falle (siehe Migration 15).
 *
 * Gespeichert wird deshalb nur, WANN eine Kür zur Wettkampfkür erklärt wurde.
 * Welche es IST, rechnet jedes Gerät daraus aus: die jüngste. Damit ist die
 * Bedingung strukturell nicht verletzbar, beide Geräte kommen zum selben
 * Ergebnis, und es geht nichts verloren – die unterlegene Kür behält ihren
 * Zeitpunkt und ist nur nicht mehr die jüngste.
 *
 * Es ist dieselbe Regel wie sonst überall in LifeHub: Die spätere Entscheidung
 * gilt. Nur ohne Schreibvorgang, und deshalb ohne Zwischenzustand.
 *
 * ---------------------------------------------------------------------------
 * Gleichstand
 *
 * Zwei Zeitpunkte auf die Millisekunde gleich sind praktisch ausgeschlossen,
 * aber nicht unmöglich. Dann entscheidet die kleinere ID – genau wie in
 * `entscheideKollision` (core/natuerlicheSchluessel.ts), und aus demselben
 * Grund: Die Regel muss auf jedem Gerät gleich ausfallen, sonst erklärt der PC
 * die eine zur Siegerin und das Handy die andere.
 *
 * Archivierte Küren zählen nicht mit. Wer die Wettkampfkür archiviert, nimmt
 * sie aus dem Rennen; trägt eine andere Kür desselben Geräts noch einen
 * Zeitpunkt, rückt sie nach.
 */
export function istKandidat(k: GymRoutine): boolean {
  return !k.deleted_at && !!k.is_active && !!k.competition_since
}

/** Gewinnt `a` gegen `b`? Jünger schlägt älter, bei Gleichstand kleinere ID. */
function schlaegt(a: GymRoutine, b: GymRoutine): boolean {
  const za = String(a.competition_since)
  const zb = String(b.competition_since)
  return za > zb || (za === zb && a.id < b.id)
}

export function wettkampfKuer(kueren: GymRoutine[], apparatus: string): GymRoutine | null {
  let beste: GymRoutine | null = null
  for (const k of kueren) {
    if (k.apparatus !== apparatus || !istKandidat(k)) continue
    if (!beste || schlaegt(k, beste)) beste = k
  }
  return beste
}

/** Je Gerät die aktive Wettkampfkür – in einem Durchgang für alle. */
export function wettkampfKuerJeGeraet(kueren: GymRoutine[]): Map<string, GymRoutine> {
  const out = new Map<string, GymRoutine>()
  for (const k of kueren) {
    if (!istKandidat(k)) continue
    const bisher = out.get(k.apparatus)
    if (!bisher || schlaegt(k, bisher)) out.set(k.apparatus, k)
  }
  return out
}

/**
 * Ist DIESE Kür die aktive Wettkampfkür ihres Geräts?
 *
 * Nimmt die ganze Liste entgegen und nicht nur die eine Zeile: Ob sie es ist,
 * hängt an den anderen Küren desselben Geräts. Eine Zeile allein kann die
 * Frage nicht beantworten – genau das ist der Punkt.
 */
export function istWettkampfKuer(kueren: GymRoutine[], kuer: GymRoutine): boolean {
  return wettkampfKuer(kueren, kuer.apparatus)?.id === kuer.id
}

/**
 * Welche Zeilen zu ändern sind, um die Wettkampfkür eines Geräts aufzuheben.
 *
 * Es genügt NICHT, den Zeitpunkt der aktiven Kür zu löschen: Dann rückte die
 * nächstjüngere nach, und „keine Wettkampfkür" wäre nicht ausdrückbar.
 * Deshalb verlieren alle Küren des Geräts ihren Zeitpunkt.
 *
 * Das Markieren braucht kein Gegenstück: Dort wird genau EINE Zeile
 * geschrieben, und die vorherige deaktiviert sich von selbst, weil sie nicht
 * mehr die jüngste ist.
 */
export function zuLoeschendeZeitpunkte(kueren: GymRoutine[], apparatus: string): string[] {
  return kueren
    .filter((k) => k.apparatus === apparatus && !k.deleted_at && !!k.competition_since)
    .map((k) => k.id)
}

/* ==================================================== Speichern planen */

/** Ein Platz, wie ihn die Oberfläche im Arbeitsspeicher hält. */
export interface KuerWunsch {
  /** Die vorhandene Zeile – oder `null` für einen neu hinzugefügten Platz. */
  id: string | null
  elementId: string
  note?: string | null
}

export interface KuerPlan {
  anlegen: { values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  entfernen: string[]
}

/**
 * Was beim Speichern einer Kür zu tun ist.
 *
 * Dasselbe Muster wie `planeVersuche` in versuche.ts, und aus demselben Grund:
 * Die Fälle, die sonst erst im Betrieb auffallen, lassen sich so einzeln
 * nachrechnen –
 *
 *   - zweimal dasselbe speichern ändert nichts (kein neues `updated_at`, keine
 *     neue `version`, kein Abgleich für nichts)
 *   - ein Verschieben berührt nur die Plätze, die sich wirklich verschoben
 *     haben, nicht die ganze Kür
 *   - ein entfernter Platz wird gelöscht und nicht stillschweigend übergangen
 *
 * `position` ist der Listenindex. Lücken entstehen dabei nicht, und zwei
 * gleiche Werte innerhalb einer Kür auch nicht – anders als nach einem
 * Abgleich, wo beides vorkommen darf (siehe `kuerElemente`).
 */
export function planeKuerElemente(
  routineId: string,
  wunsch: KuerWunsch[],
  vorhanden: GymRoutineElement[],
): KuerPlan {
  const plan: KuerPlan = { anlegen: [], aendern: [], entfernen: [] }

  const daIst = new Map<string, GymRoutineElement>()
  for (const v of vorhanden) {
    if (v.deleted_at || v.routine_id !== routineId) continue
    daIst.set(v.id, v)
  }

  const gesehen = new Set<string>()
  for (const [i, w] of wunsch.entries()) {
    const note = w.note?.trim() || null
    const alt = w.id ? daIst.get(w.id) : undefined

    if (!alt) {
      plan.anlegen.push({
        values: { routine_id: routineId, element_id: w.elementId, position: i, note },
      })
      continue
    }
    gesehen.add(alt.id)

    const patch: Record<string, any> = {}
    if (Number(alt.position ?? 0) !== i) patch.position = i
    if ((alt.note ?? null) !== note) patch.note = note
    // element_id wird nie geändert: Ein anderes Element an derselben Stelle
    // ist ein anderer Platz, kein umbenannter. Die Oberfläche entfernt und
    // fügt hinzu.
    if (Object.keys(patch).length) plan.aendern.push({ id: alt.id, patch })
  }

  for (const [id] of daIst) {
    if (!gesehen.has(id)) plan.entfernen.push(id)
  }

  return plan
}

/** Hat der Plan überhaupt etwas zu tun? */
export function planIstLeer(plan: KuerPlan): boolean {
  return plan.anlegen.length === 0 && plan.aendern.length === 0 && plan.entfernen.length === 0
}

/* ========================================================= Kürübersicht */

export interface KuerBild {
  kuer: GymRoutine
  eintraege: KuerEintrag[]
  schwierigkeit: Schwierigkeit
  stellen: Problemstelle[]
  /** Kurze Sätze für die Liste. */
  hinweise: string[]
  istWettkampf: boolean
}

/**
 * Das Bild einer Kür für die Liste – in einem Durchgang.
 *
 * Nimmt die schon gefilterten Verknüpfungen und Elemente entgegen, damit die
 * Liste sie einmal aufbaut und nicht je Kür erneut.
 */
export function kuerBild(
  kuer: GymRoutine,
  verknuepfungen: GymRoutineElement[],
  elemente: GymElement[],
  bilder: Map<string, ElementBild>,
  wettkampfJeGeraet: Map<string, GymRoutine>,
): KuerBild {
  const eintraege = kuerElemente(kuer.id, verknuepfungen, elemente)
  const stellen = problemstellen(eintraege, bilder)
  return {
    kuer,
    eintraege,
    schwierigkeit: schwierigkeit(eintraege),
    stellen,
    hinweise: problemZusammenfassung(stellen),
    istWettkampf: wettkampfJeGeraet.get(kuer.apparatus)?.id === kuer.id,
  }
}

/**
 * Die Schwierigkeitssumme, wie sie dasteht.
 *
 * An EINER Stelle formuliert, damit die Zahl nirgends ohne ihren Vorbehalt
 * erscheint. Fehlt ein Wert, wird das gesagt und nicht mit einer 0 überspielt.
 */
export function schwierigkeitText(s: Schwierigkeit): string {
  if (s.elemente === 0) return 'keine Elemente'
  if (s.mitWert === 0) return `kein Wert bei ${s.elemente} Elementen`
  const zahl = s.summe.toFixed(1).replace('.', ',')
  if (s.vollstaendig) return zahl
  return `${zahl} (${s.ohneWert} von ${s.elemente} ohne Wert)`
}

/** Küren sortieren: Wettkampfkür zuerst, Archiviertes zuletzt, sonst nach Namen. */
export function sortiereKueren(a: KuerBild, b: KuerBild): number {
  if (!!a.kuer.is_active !== !!b.kuer.is_active) return a.kuer.is_active ? -1 : 1
  if (a.istWettkampf !== b.istWettkampf) return a.istWettkampf ? -1 : 1
  return a.kuer.name.localeCompare(b.kuer.name)
}
