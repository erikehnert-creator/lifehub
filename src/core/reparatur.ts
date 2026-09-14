/**
 * Verwaiste Tageswerte wieder ihrer Metrik zuordnen – das Entscheiden.
 *
 * ---------------------------------------------------------------------------
 * Woher die Verwaisung kommt
 *
 * Ausführlich in core/natuerlicheSchluessel.ts. Kurz: Zwei Geräte legten
 * dieselbe eingebaute Metrik unabhängig voneinander an, jedes mit einer
 * eigenen ID. Der Server nahm beide, beim Abgleich ersetzte jedes Gerät seine
 * durch die fremde – und die Tageswerte zeigten danach auf eine Metrik, die es
 * nicht mehr gab. Sie waren nicht verloren, nur unsichtbar: `dayValue()` sucht
 * über `metric_id`, und die stimmte nicht mehr.
 *
 * ---------------------------------------------------------------------------
 * Warum sich das zuverlässig zuordnen lässt
 *
 * Die Tageswerte aus FatSecret tragen eine ID, die aus Metrik-SCHLÜSSEL und
 * Tag abgeleitet ist (`nutritionEntryId`). Aus einer verwaisten Zeile lässt
 * sich damit zurückrechnen, zu welcher Metrik sie gehört – ohne Raten: Es wird
 * geprüft, ob die ID der Zeile genau die ist, die für diesen Schlüssel und
 * diesen Tag herauskäme. Trifft keine zu, bleibt die Zeile unangetastet und
 * wird nur gezählt. Erfunden wird nichts.
 *
 * Hier steht ausschließlich das Entscheiden – ohne Datenbank, dadurch prüfbar.
 * Ausgeführt wird der Plan in db/reparatur.ts.
 */
import { nutritionEntryId } from './fatsecret'

/** Eine Zeile, deren `metric_id` auf nichts mehr zeigt. */
export interface VerwaisterTageswert {
  id: string
  day: string
  metric_id: string
}

export interface ReparaturPlan {
  /** Tageswerte, die wieder auf ihre Metrik zeigen sollen. */
  tageswerte: { id: string; metric_id: string }[]
  /** Zielbereiche, die dabei mit umziehen. */
  zielbereiche: { id: string; metric_id: string }[]
  /** Verwaiste Zeilen, die sich nicht zuordnen ließen – nur gezählt. */
  ungeklaert: number
  /** Welche Metriken betroffen waren, für die Meldung an den Nutzer. */
  metriken: string[]
}

export const LEERER_PLAN: ReparaturPlan = {
  tageswerte: [], zielbereiche: [], ungeklaert: 0, metriken: [],
}

export function planIstLeer(p: ReparaturPlan): boolean {
  return p.tageswerte.length === 0 && p.zielbereiche.length === 0
}

/**
 * Den Reparaturplan aufstellen.
 *
 * `zielbereiche` sind ALLE metric_targets, auch die verwaisten – nur so lässt
 * sich erkennen, dass zu einer wiederhergestellten Metrik noch ein
 * Zielbereich gehört, der mit umziehen muss. Ohne ihn stünden die Werte zwar
 * wieder da, aber ohne grün/gelb/rot.
 */
export function planeReparatur(
  verwaist: VerwaisterTageswert[],
  metriken: { id: string; key: string; name: string }[],
  zielbereiche: { id: string; metric_id: string; period?: string | null }[],
): ReparaturPlan {
  if (!verwaist.length) return LEERER_PLAN

  const plan: ReparaturPlan = { tageswerte: [], zielbereiche: [], ungeklaert: 0, metriken: [] }
  const betroffen = new Set<string>()

  // Von der verschwundenen Metrik-ID auf die richtige. Aus den Tageswerten
  // gewonnen und danach auch für die Zielbereiche brauchbar, die selbst keine
  // ableitbare ID haben.
  const umzug = new Map<string, string>()

  // Je Tag einmal die abgeleiteten IDs aller Metriken bilden, statt für jede
  // verwaiste Zeile erneut. Bei drei Jahren Historie ist das der Unterschied
  // zwischen ein paar tausend und ein paar hunderttausend Hashwerten.
  const jeTag = new Map<string, Map<string, { id: string; name: string }>>()
  const fuerTag = (tag: string) => {
    let m = jeTag.get(tag)
    if (!m) {
      m = new Map()
      for (const metrik of metriken) m.set(nutritionEntryId(metrik.key, tag), metrik)
      jeTag.set(tag, m)
    }
    return m
  }

  for (const zeile of verwaist) {
    const passend = fuerTag(zeile.day).get(zeile.id)
    if (!passend) { plan.ungeklaert++; continue }
    plan.tageswerte.push({ id: zeile.id, metric_id: passend.id })
    umzug.set(zeile.metric_id, passend.id)
    betroffen.add(passend.name)
  }

  if (umzug.size) {
    const hatSchonZiel = new Set(
      zielbereiche
        .filter((z) => (z.period ?? 'daily') === 'daily' && !umzug.has(z.metric_id))
        .map((z) => z.metric_id),
    )
    for (const ziel of zielbereiche) {
      const neu = umzug.get(ziel.metric_id)
      // Nur, wenn die richtige Metrik noch keinen eigenen Zielbereich hat –
      // sonst stünden hinterher zwei gültige nebeneinander.
      if (!neu || hatSchonZiel.has(neu)) continue
      plan.zielbereiche.push({ id: ziel.id, metric_id: neu })
      hatSchonZiel.add(neu)
    }
  }

  plan.metriken = [...betroffen].sort()
  return plan
}
