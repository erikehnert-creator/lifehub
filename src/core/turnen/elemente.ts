/**
 * Was sich aus den Versuchen über ein Element sagen lässt.
 *
 * Zuletzt trainiert, wie oft, wie lange her – alles gerechnet, nichts
 * gespeichert. Als Spalten am Element müssten diese Werte bei jedem Training
 * nachgezogen werden, und der erste vergessene Nachzug machte sie still
 * falsch (siehe TURNEN_ARCHITEKTUR.md, 2.3).
 *
 * Reine Logik ohne Datenbank und ohne React: Der Aufrufer reicht die Zeilen
 * herein, die er ohnehin geladen hat.
 */
import type { DayString } from '../dates'
import type { GymAttempt, GymElement } from '../types'
import { trefferbild, statusVorschlag, SCHWELLEN, type Trefferbild, type Vorschlag } from './sicherheit'

/** Die Einheit, auf die ein Versuchsblock zeigt – auf den Tag reduziert. */
export interface EinheitTag {
  id: string
  day: DayString
  deleted_at?: string | null
}

/**
 * Versuchsblöcke mit dem Tag ihrer Einheit verbinden.
 *
 * Ein Block ohne Einheit wird übergangen: Das passiert, wenn die Einheit
 * gelöscht wurde. Die Historie eines Elements darf daran nicht hängenbleiben,
 * aber sie darf auch nicht so tun, als hätte das Training stattgefunden.
 */
export function bloeckeMitTag(
  bloecke: GymAttempt[],
  einheiten: EinheitTag[],
): { block: GymAttempt; day: DayString }[] {
  const tagVon = new Map<string, DayString>()
  for (const e of einheiten) {
    if (e.deleted_at) continue
    tagVon.set(e.id, e.day)
  }
  const out: { block: GymAttempt; day: DayString }[] = []
  for (const b of bloecke) {
    if (b.deleted_at) continue
    const day = tagVon.get(b.session_id)
    if (!day) continue
    out.push({ block: b, day })
  }
  return out
}

export interface ElementBild {
  element: GymElement
  /** Tag des letzten Trainings, oder `null`. */
  zuletzt: DayString | null
  /** Tage seit dem letzten Training, oder `null`, wenn es keines gab. */
  tageHer: number | null
  /** Zahl der Einheiten, in denen das Element vorkam (gesamt). */
  einheiten: number
  /** Versuche gesamt, über die ganze Historie. */
  versucheGesamt: number
  /** Trefferbild im Beobachtungsfenster (siehe SCHWELLEN.fensterTage). */
  fenster: Trefferbild
  vorschlag: Vorschlag
}

/**
 * Das Bild eines Elements: wann zuletzt, wie oft, wie sicher.
 *
 * `heute` wird übergeben statt gelesen, damit sich Grenzfälle prüfen lassen –
 * „heute trainiert" muss 0 Tage ergeben und nicht 1.
 */
export function elementBild(
  element: GymElement,
  bloecke: { block: GymAttempt; day: DayString }[],
  heute: DayString,
  tagDifferenz: (von: DayString, bis: DayString) => number,
): ElementBild {
  const meine = bloecke.filter((b) => b.block.element_id === element.id)

  let zuletzt: DayString | null = null
  const tage = new Set<string>()
  let versuche = 0
  for (const { block, day } of meine) {
    if (!zuletzt || day > zuletzt) zuletzt = day
    tage.add(day)
    versuche += (block.clean ?? 0) + (block.shaky ?? 0) + (block.failed ?? 0)
  }

  // Nur was im Fenster liegt, geht in die Sicherheitsbewertung ein.
  const grenze = meine.length ? tagMinus(heute, SCHWELLEN.fensterTage, tagDifferenz) : heute
  const imFenster = meine.filter((b) => b.day >= grenze).map((b) => b.block)
  const fenster = trefferbild(imFenster)

  return {
    element,
    zuletzt,
    tageHer: zuletzt ? Math.max(0, tagDifferenz(zuletzt, heute)) : null,
    einheiten: tage.size,
    versucheGesamt: versuche,
    fenster,
    vorschlag: statusVorschlag(fenster),
  }
}

/**
 * Ein Datum um n Tage zurück – über dieselbe Differenzfunktion wie überall.
 *
 * Bewusst über Zeichenketten und Differenz statt über `Date`: So bleibt die
 * Rechnung frei von der Zeitzone des Geräts, genau wie im Rest von LifeHub.
 */
function tagMinus(tag: DayString, n: number, tagDifferenz: (a: DayString, b: DayString) => number): DayString {
  const d = new Date(`${tag}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  const zurueck = d.toISOString().slice(0, 10)
  // Nur zur Sicherheit: Wenn die Differenz nicht passt, lieber das Fenster
  // zu gross als zu klein - ein zu grosses Fenster verschweigt nichts.
  return tagDifferenz(zurueck, tag) >= n ? zurueck : '0000-01-01'
}

/* --------------------------------------------------------- Je Gerät */

export interface GeraetBild {
  apparatus: string
  /**
   * Einheiten mit mindestens einem Versuch an diesem Gerät.
   *
   * Gezählt werden SITZUNGEN, nicht Tage. Der Unterschied fällt erst auf,
   * wenn an einem Tag zweimal trainiert wurde – dann sind es zwei Einheiten
   * und nicht eine.
   */
  einheiten: number
  versuche: number
  zuletzt: DayString | null
  tageHer: number | null
  /** Elemente an diesem Gerät, die Aufmerksamkeit brauchen. */
  brauchtArbeit: number
  elemente: number
}

/**
 * Das Bild eines Geräts – für die Kacheln auf der Übersicht.
 *
 * Gezählt wird über die Versuche, nicht über die Einheiten: Eine Einheit
 * „Turnen" ohne einen einzigen Versuch sagt nicht, an welchem Gerät sie
 * stattfand. Für „zuletzt trainiert je Gerät" ist das die ehrlichere Zahl.
 *
 * ---------------------------------------------------------------------------
 * Eine Einheit, mehrere Geräte
 *
 * Ein normales Turntraining geht über Boden, Barren und Reck. Diese Rechnung
 * zählt jedes Gerät für sich: Die Sitzung erscheint bei allen drei Geräten
 * als trainiert, bleibt aber EINE Einheit. Die Dauer der Sitzung taucht hier
 * bewusst gar nicht auf – sie hängt an der Sitzung und liesse sich sonst
 * dreifach zählen.
 */
export function geraetBilder(
  elemente: GymElement[],
  bloecke: { block: GymAttempt; day: DayString }[],
  heute: DayString,
  tagDifferenz: (von: DayString, bis: DayString) => number,
  brauchtArbeitStatus: readonly string[],
): Map<string, GeraetBild> {
  const geraetVon = new Map<string, string>()
  for (const e of elemente) {
    if (e.deleted_at) continue
    geraetVon.set(e.id, e.apparatus)
  }

  const out = new Map<string, GeraetBild>()
  const hole = (apparatus: string): GeraetBild => {
    let b = out.get(apparatus)
    if (!b) {
      b = { apparatus, einheiten: 0, versuche: 0, zuletzt: null, tageHer: null, brauchtArbeit: 0, elemente: 0 }
      out.set(apparatus, b)
    }
    return b
  }

  for (const e of elemente) {
    if (e.deleted_at || !e.is_active) continue
    const b = hole(e.apparatus)
    b.elemente++
    if (brauchtArbeitStatus.includes(e.status)) b.brauchtArbeit++
  }

  // Je Geraet die Sitzungen, in denen es vorkam. Ueber die SITZUNG und nicht
  // ueber den Tag: Wer an einem Tag zweimal in die Halle geht, hat zweimal
  // trainiert.
  const sitzungenJeGeraet = new Map<string, Set<string>>()
  for (const { block, day } of bloecke) {
    const apparatus = geraetVon.get(block.element_id)
    if (!apparatus) continue
    const b = hole(apparatus)
    b.versuche += (block.clean ?? 0) + (block.shaky ?? 0) + (block.failed ?? 0)
    if (!b.zuletzt || day > b.zuletzt) b.zuletzt = day
    if (!sitzungenJeGeraet.has(apparatus)) sitzungenJeGeraet.set(apparatus, new Set())
    sitzungenJeGeraet.get(apparatus)!.add(block.session_id)
  }

  for (const [apparatus, sitzungen] of sitzungenJeGeraet) {
    const b = hole(apparatus)
    b.einheiten = sitzungen.size
  }
  for (const b of out.values()) {
    b.tageHer = b.zuletzt ? Math.max(0, tagDifferenz(b.zuletzt, heute)) : null
  }
  return out
}

/**
 * Elemente, die am längsten nicht drankamen.
 *
 * Nie trainierte Elemente stehen ganz oben: Ein Element, das seit der
 * Aufnahme nie geturnt wurde, ist dringender als eines, das vor drei Wochen
 * dran war. Gefolgt von den ältesten.
 */
export function langeNichtTrainiert(bilder: ElementBild[], anzahl = 5): ElementBild[] {
  return [...bilder]
    .filter((b) => !b.element.deleted_at && b.element.is_active)
    .sort((a, b) => {
      if (a.tageHer === null && b.tageHer === null) return a.element.name.localeCompare(b.element.name)
      if (a.tageHer === null) return -1
      if (b.tageHer === null) return 1
      return b.tageHer - a.tageHer
    })
    .slice(0, anzahl)
}

/* ------------------------------------------------ Geräte einer Einheit */

/**
 * Welche Geräte in einer Einheit vorkamen – abgeleitet, nicht gespeichert.
 *
 * ---------------------------------------------------------------------------
 * Warum das keine Spalte an der Sitzung ist
 *
 * Ein Turntraining geht über mehrere Geräte. Man könnte sie an der Sitzung
 * vermerken – dann müsste dieser Vermerk aber bei jedem Zähler nachgezogen
 * werden, und der erste vergessene Nachzug wäre eine Sitzung, die an einem
 * Gerät steht, an dem nichts passiert ist.
 *
 * Jedes Element trägt sein Gerät ohnehin (`gym_elements.apparatus`), und
 * jeder Versuch zeigt auf ein Element. Das Gerät ist damit bereits
 * eindeutig ableitbar – eine Spalte dafür wäre eine zweite Quelle für
 * dieselbe Auskunft.
 *
 * Ein Versuch, dessen Element gelöscht wurde, wird übergangen: Sein Gerät
 * ist nicht mehr feststellbar, und Raten wäre schlechter als Schweigen.
 */
export function geraeteDerEinheit(
  sessionId: string,
  versuche: GymAttempt[],
  elemente: GymElement[],
): string[] {
  const geraetVon = new Map<string, string>()
  for (const e of elemente) {
    if (e.deleted_at) continue
    geraetVon.set(e.id, e.apparatus)
  }
  const gefunden = new Set<string>()
  for (const v of versuche) {
    if (v.deleted_at || v.session_id !== sessionId) continue
    if ((v.clean ?? 0) + (v.shaky ?? 0) + (v.failed ?? 0) === 0) continue
    const g = geraetVon.get(v.element_id)
    if (g) gefunden.add(g)
  }
  return [...gefunden]
}

/**
 * Je Einheit die Geräte – in einem Durchgang für eine ganze Liste.
 *
 * Für die Einheitenliste: `geraeteDerEinheit` je Zeile aufzurufen wäre bei
 * zweihundert Einheiten zweihundert Durchläufe über alle Versuche.
 */
export function geraeteJeEinheit(
  versuche: GymAttempt[],
  elemente: GymElement[],
): Map<string, Set<string>> {
  const geraetVon = new Map<string, string>()
  for (const e of elemente) {
    if (e.deleted_at) continue
    geraetVon.set(e.id, e.apparatus)
  }
  const out = new Map<string, Set<string>>()
  for (const v of versuche) {
    if (v.deleted_at) continue
    if ((v.clean ?? 0) + (v.shaky ?? 0) + (v.failed ?? 0) === 0) continue
    const g = geraetVon.get(v.element_id)
    if (!g) continue
    if (!out.has(v.session_id)) out.set(v.session_id, new Set())
    out.get(v.session_id)!.add(g)
  }
  return out
}
