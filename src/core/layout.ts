/**
 * Bausteine für frei anpassbare Seiten.
 *
 * Erik will auf jeder Seite selbst festlegen können, welche Karten zu sehen
 * sind und in welcher Reihenfolge – nicht nur auf "Heute". Deshalb ist das
 * hier bewusst seitenunabhängig gehalten: eine Seite meldet nur ihre Karten
 * an (feste ID, Titel, ob sie ohne Einstellung sichtbar ist), der Rest ist
 * reine Logik ohne React- oder Datenbankzugriff – gut testbar, und genau das,
 * was beim Zusammenführen von gespeicherter Einstellung und aktuellem
 * Kartenangebot schiefgehen kann (gelöschte Karte, neue Karte).
 */

export interface LayoutCardDef {
  id: string
  title: string
  /** Sichtbar, solange der Nutzer nichts eingestellt hat. Default: true. */
  defaultVisible?: boolean
}

/** Was pro Seite gespeichert wird: vollständige Reihenfolge + ausgeblendete Karten. */
export interface LayoutPref {
  order: string[]
  hidden: string[]
}

export interface ResolvedLayoutCard extends LayoutCardDef {
  visible: boolean
}

/**
 * Verschmilzt das aktuelle Kartenangebot einer Seite mit dem, was der Nutzer
 * gespeichert hat, zur endgültigen Anzeigereihenfolge.
 *
 * - Keine gespeicherte Einstellung: Standardreihenfolge, `defaultVisible`
 *   entscheidet über die Sichtbarkeit.
 * - Eine gespeicherte Karten-ID, die es nicht mehr gibt (ein App-Update hat
 *   eine Karte entfernt): wird stillschweigend übersprungen, kein Absturz.
 * - Eine Karte, die es beim Speichern der Einstellung noch nicht gab (ein
 *   App-Update hat eine neue Karte gebracht): wird ans Ende gehängt und ist
 *   sichtbar – sonst würde eine neue Karte nach einem Update einfach nie
 *   auftauchen, ohne dass irgendwer das bemerkt.
 */
export function resolveLayout(
  defs: LayoutCardDef[],
  pref: LayoutPref | null | undefined,
): ResolvedLayoutCard[] {
  const byId = new Map(defs.map((d) => [d.id, d]))
  const hidden = new Set(pref?.hidden ?? [])
  const knownFromPref = new Set(pref?.order ?? [])
  const seen = new Set<string>()
  const ordered: LayoutCardDef[] = []

  for (const id of pref?.order ?? []) {
    const def = byId.get(id)
    if (!def || seen.has(id)) continue
    seen.add(id)
    ordered.push(def)
  }
  for (const def of defs) {
    if (seen.has(def.id)) continue
    seen.add(def.id)
    ordered.push(def)
  }

  return ordered.map((def) => ({
    ...def,
    visible: knownFromPref.has(def.id) ? !hidden.has(def.id) : (def.defaultVisible ?? true),
  }))
}

/** Eine Karten-ID in einer Reihenfolge um eine Position verschieben. Am Rand passiert nichts. */
export function moveInOrder(order: string[], id: string, direction: -1 | 1): string[] {
  const idx = order.indexOf(id)
  if (idx < 0) return order
  const target = idx + direction
  if (target < 0 || target >= order.length) return order
  const next = order.slice()
  ;[next[idx], next[target]] = [next[target], next[idx]]
  return next
}

/**
 * Baut aus einer möglicherweise unvollständigen (oder fehlenden) Einstellung
 * eine vollständige Einstellung über alle aktuell bekannten Karten – Grundlage
 * für Umschalten und Verschieben in der Bearbeitungsleiste.
 */
function normalizedPref(defs: LayoutCardDef[], pref: LayoutPref | null | undefined): LayoutPref {
  const resolved = resolveLayout(defs, pref)
  return {
    order: resolved.map((c) => c.id),
    hidden: resolved.filter((c) => !c.visible).map((c) => c.id),
  }
}

/** Sichtbarkeit einer Karte umschalten – liefert eine vollständige, speicherbare Einstellung zurück. */
export function toggleCardVisible(
  defs: LayoutCardDef[],
  pref: LayoutPref | null | undefined,
  id: string,
): LayoutPref {
  const full = normalizedPref(defs, pref)
  const hidden = new Set(full.hidden)
  if (hidden.has(id)) hidden.delete(id)
  else hidden.add(id)
  return { order: full.order, hidden: [...hidden] }
}

/** Eine Karte in der gespeicherten Reihenfolge verschieben – liefert eine vollständige, speicherbare Einstellung zurück. */
export function moveCard(
  defs: LayoutCardDef[],
  pref: LayoutPref | null | undefined,
  id: string,
  direction: -1 | 1,
): LayoutPref {
  const full = normalizedPref(defs, pref)
  return { order: moveInOrder(full.order, id, direction), hidden: full.hidden }
}

/**
 * Beschreibt, woher eine neu geschnittene Seite ihre alte Einstellung holt.
 *
 * `karten` bildet alte Karten-IDs auf neue ab. Mehrere alte dürfen auf
 * dieselbe neue zeigen (zwei Karten wurden zu einer zusammengelegt); eine
 * alte ID ohne Eintrag verfällt (die Karte gibt es nicht mehr).
 */
export interface LayoutUmzug {
  von: string
  karten: Record<string, string>
}

/**
 * Rechnet eine Einstellung der alten Seite in die neue um.
 *
 * Zwei Regeln, beide darauf ausgelegt, im Zweifel nichts wegzunehmen:
 *
 * - Reihenfolge: alte IDs werden übersetzt, Unbekanntes fällt weg, Dubletten
 *   behalten ihr erstes Vorkommen. Wer „Prognose" nach oben gezogen hatte,
 *   findet „Dieser Monat" oben wieder.
 * - Sichtbarkeit: eine neue Karte gilt nur dann als ausgeblendet, wenn ALLE
 *   alten Karten, die in ihr aufgegangen sind, ausgeblendet waren. Sonst
 *   verschwände beim Zusammenlegen zweier Karten der sichtbare Teil mit.
 *
 * Gibt `null` zurück, wenn es nichts zu übernehmen gibt – dann greift die
 * Standardanordnung der neuen Seite.
 */
export function migriereLayout(
  alt: LayoutPref | null | undefined,
  karten: Record<string, string>,
): LayoutPref | null {
  if (!alt || !alt.order?.length) return null
  const versteckt = new Set(alt.hidden ?? [])
  const order: string[] = []
  const gesehen = new Set<string>()
  /** Je neuer Karte: war mindestens eine ihrer Quellen sichtbar? */
  const sichtbar = new Map<string, boolean>()

  for (const alteId of alt.order) {
    const neu = karten[alteId]
    if (!neu) continue
    if (!gesehen.has(neu)) { gesehen.add(neu); order.push(neu) }
    sichtbar.set(neu, (sichtbar.get(neu) ?? false) || !versteckt.has(alteId))
  }
  if (!order.length) return null
  return { order, hidden: order.filter((id) => !sichtbar.get(id)) }
}
