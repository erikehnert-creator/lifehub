/**
 * FatSecret: aus dem Ernährungstagebuch von fatsecret.com wird der Tag in LifeHub.
 *
 * Hier steht ausschließlich das Rechnen und Umformen – kein Netzwerk, keine
 * Zugangsdaten, keine Datenbank. Das ist Absicht: Genau dieser Teil hat die
 * unangenehmen Sonderfälle (FatSecret liefert Zahlen als Text, eine einzelne
 * Mahlzeit als Objekt statt als Liste, Datumsangaben als Tage seit 1970), und
 * genau diese Sonderfälle will man prüfen können, ohne einen Server zu haben.
 *
 * Der Weg der Daten:
 *
 *   FatSecret food_entries.get.v2
 *        → parseFoodEntries()      Rohantwort in saubere Zeilen
 *        → reconcileFoodEntries()  Abgleich gegen das, was schon in LifeHub steht
 *        → aggregateDay()          Tagessummen
 *        → metric_entries          dieselben Kalorien/Makros wie bisher
 *
 * Der letzte Schritt ist der wichtige: LifeHub bekommt KEIN zweites
 * Ernährungssystem neben dem bestehenden. Die Tageswerte landen dort, wo
 * Zielbereiche, Verlauf, Analysen und die Heute-Seite sie ohnehin schon
 * suchen. Die einzelnen Lebensmittel kommen als Begründung daneben.
 */
import type { DayString } from './dates'
import { stableId } from './ids'

/* ------------------------------------------------------------------ Datum */

/**
 * FatSecret gibt Tage als Anzahl Tage seit dem 1. Januar 1970 an.
 *
 * Bewusst ohne `new Date(tag)`: Dessen Ergebnis hängt an der Zeitzone des
 * Geräts. Ein Handy in einer anderen Zeitzone würde damit den Nachbartag
 * abfragen – und der Tag, den man gerade ansieht, bliebe leer.
 */
export function dayToEpochDay(day: DayString): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

export function epochDayToDay(dateInt: number): DayString {
  const d = new Date(dateInt * 86400000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/* ------------------------------------------------------------ Rohantwort */

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'other'

export interface FatSecretEntry {
  /** food_entry_id – der einzige stabile Anker, den FatSecret liefert. */
  externalId: string
  foodId: string | null
  day: DayString
  meal: Meal
  name: string
  servingDescription: string | null
  numberOfUnits: number | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  saturated_fat_g: number | null
  sodium_mg: number | null
}

/** FatSecret liefert alle Zahlen als Text – und fehlende Werte gar nicht. */
function zahl(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function text(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'other']
function meal(v: any): Meal {
  const s = String(v ?? '').toLowerCase()
  return (MEALS as string[]).includes(s) ? (s as Meal) : 'other'
}

/**
 * Macht aus der Antwort von food_entries.get.v2 eine gewöhnliche Liste.
 *
 * Zwei Fallen von FatSecret, die beide schon produktiv Fehler verursacht
 * haben (deshalb stehen sie hier ausdrücklich):
 *
 *  1. Bei GENAU EINEM Eintrag ist `food_entry` ein Objekt, bei mehreren eine
 *     Liste. Wer nur `.map()` aufruft, verliert still den ersten Tag, an dem
 *     man nur eine Kleinigkeit gegessen hat.
 *  2. Ein leerer Tag liefert kein leeres Array, sondern gar kein
 *     `food_entries`-Feld.
 */
export function parseFoodEntries(raw: any, fallbackDay?: DayString): FatSecretEntry[] {
  const container = raw?.food_entries ?? raw
  const roh = container?.food_entry
  if (!roh) return []
  const liste: any[] = Array.isArray(roh) ? roh : [roh]

  const out: FatSecretEntry[] = []
  for (const e of liste) {
    const externalId = text(e?.food_entry_id)
    if (!externalId) continue // ohne Anker kein verlässlicher Abgleich
    const dateInt = zahl(e?.date_int)
    const day = dateInt !== null ? epochDayToDay(dateInt) : fallbackDay
    if (!day) continue
    out.push({
      externalId,
      foodId: text(e?.food_id),
      day,
      meal: meal(e?.meal),
      name: text(e?.food_entry_name) ?? text(e?.food_entry_description) ?? 'Unbenannt',
      servingDescription: text(e?.food_entry_description),
      numberOfUnits: zahl(e?.number_of_units),
      calories: zahl(e?.calories),
      protein_g: zahl(e?.protein),
      carbs_g: zahl(e?.carbohydrate),
      fat_g: zahl(e?.fat),
      fiber_g: zahl(e?.fiber),
      sugar_g: zahl(e?.sugar),
      saturated_fat_g: zahl(e?.saturated_fat),
      sodium_mg: zahl(e?.sodium),
    })
  }
  return out
}

/* -------------------------------------------------------------- Tageswerte */

/** Die Metriken, die aus dem Tagebuch berechnet werden – Schlüssel wie in seed.ts. */
export const ERNAEHRUNGS_METRIKEN = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
] as const
export type ErnaehrungsMetrik = (typeof ERNAEHRUNGS_METRIKEN)[number]

/** Welche Metriken die Aufgabenstellung ausdrücklich verlangt. */
export const PFLICHT_METRIKEN: ErnaehrungsMetrik[] = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']

export type Tageswerte = Record<ErnaehrungsMetrik, number | null>

/**
 * Tagessummen aus den einzelnen Lebensmitteln.
 *
 * Ein Nährwert, den KEIN Eintrag des Tages mitbringt, bleibt `null` statt 0 –
 * „null Ballaststoffe gegessen" und „FatSecret kennt zu diesen Lebensmitteln
 * keine Ballaststoffangabe" sind zwei verschiedene Aussagen, und nur die
 * erste darf als Zahl in einem Zielbereich landen.
 */
export function aggregateDay(entries: FatSecretEntry[]): Tageswerte {
  const out = {} as Tageswerte
  for (const key of ERNAEHRUNGS_METRIKEN) {
    let summe = 0
    let gesehen = false
    for (const e of entries) {
      const v = e[key]
      if (v === null || v === undefined) continue
      summe += v
      gesehen = true
    }
    out[key] = gesehen ? Math.round(summe * 100) / 100 : null
  }
  return out
}

/* ----------------------------------------------------------------- IDs */

/**
 * Zeilen-ID eines importierten Lebensmittels, abgeleitet aus der
 * food_entry_id. Damit trifft ein zweiter Abgleich dieselbe Zeile wieder –
 * egal ob er vom PC oder vom Handy kommt.
 */
export function foodEntryRowId(externalId: string): string {
  return stableId('fatsecret-lebensmittel', externalId)
}

/**
 * Zeilen-ID des Tageswerts einer Metrik.
 *
 * Bewusst über den Metrik-SCHLÜSSEL („calories") und nicht über die
 * Metrik-ID: Legen zwei Geräte ihre eingebauten Metriken an, bevor sie sich
 * das erste Mal abgleichen, haben sie für „Kalorien" unterschiedliche IDs.
 * Über den Schlüssel entsteht trotzdem genau eine Tageswert-Zeile, und der
 * Abgleich räumt die Metrik-ID danach von allein gerade.
 */
export function nutritionEntryId(metricKey: string, day: DayString): string {
  return stableId('fatsecret-tageswert', metricKey, day)
}

/* -------------------------------------------------------------- Abgleich */

/** Was von einer bereits gespeicherten Zeile für den Abgleich zählt. */
export interface LokalesLebensmittel {
  id: string
  day: DayString
  external_id: string | null
  source: string
  deleted_at: string | null
  meal: string
  name: string
  serving_description: string | null
  number_of_units: number | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  saturated_fat_g: number | null
  sodium_mg: number | null
}

export interface LebensmittelPlan {
  anlegen: { id: string; values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  /** In FatSecret gelöschte Einträge – hier ebenfalls entfernen. */
  entfernen: { id: string; name: string }[]
}

const NAEHRWERTE = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g',
  'saturated_fat_g', 'sodium_mg',
] as const

function gleich(a: any, b: any): boolean {
  if (a === undefined) a = null
  if (b === undefined) b = null
  if (a === null || b === null) return a === b
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a) === String(b)
}

/**
 * Gleicht einen einzelnen Tag ab.
 *
 * `lokal` soll ALLE Zeilen dieses Tages enthalten, auch die gelöschten:
 * Ein Eintrag, den man in LifeHub bewusst entfernt hat, darf beim nächsten
 * Abgleich nicht wieder auftauchen.
 *
 * Von Hand in LifeHub erfasste Lebensmittel (`source` ≠ 'fatsecret') bleiben
 * unangetastet. FatSecret ist hier die Quelle für seine eigenen Einträge und
 * für sonst nichts.
 */
export function reconcileFoodEntries(opts: {
  day: DayString
  remote: FatSecretEntry[]
  lokal: LokalesLebensmittel[]
  syncedAt: string
}): LebensmittelPlan {
  const plan: LebensmittelPlan = { anlegen: [], aendern: [], entfernen: [] }
  const desTages = opts.lokal.filter((l) => l.day === opts.day)

  const lokalNachExtern = new Map<string, LokalesLebensmittel>()
  for (const l of desTages) {
    if (l.source !== 'fatsecret' || !l.external_id) continue
    // Bei (theoretischen) Doppelten gewinnt die erste; die zweite fällt unten
    // als „nicht mehr in FatSecret vorhanden" heraus.
    if (!lokalNachExtern.has(l.external_id)) lokalNachExtern.set(l.external_id, l)
  }

  const gesehen = new Set<string>()
  let sort = 0
  for (const e of opts.remote) {
    if (e.day !== opts.day) continue
    gesehen.add(e.externalId)
    const vorhanden = lokalNachExtern.get(e.externalId)
    const werte: Record<string, any> = {
      day: e.day,
      meal: e.meal,
      name: e.name,
      serving_description: e.servingDescription,
      number_of_units: e.numberOfUnits,
      external_food_id: e.foodId,
      sort_order: sort++,
    }
    for (const k of NAEHRWERTE) werte[k] = e[k]

    if (!vorhanden) {
      plan.anlegen.push({
        id: foodEntryRowId(e.externalId),
        values: {
          id: foodEntryRowId(e.externalId),
          ...werte,
          source: 'fatsecret',
          external_id: e.externalId,
          synced_at: opts.syncedAt,
        },
      })
      continue
    }
    if (vorhanden.deleted_at) continue // in LifeHub bewusst entfernt

    const patch: Record<string, any> = {}
    for (const [k, v] of Object.entries(werte)) {
      if (k === 'sort_order') continue // reine Anzeigereihenfolge, kein Grund zu schreiben
      if (!gleich((vorhanden as any)[k], v)) patch[k] = v
    }
    if (Object.keys(patch).length) {
      patch.synced_at = opts.syncedAt
      plan.aendern.push({ id: vorhanden.id, patch })
    }
  }

  // In FatSecret gelöscht → hier auch weg. Nur eigene Importe, nie von Hand
  // Erfasstes.
  for (const l of desTages) {
    if (l.deleted_at || l.source !== 'fatsecret' || !l.external_id) continue
    if (gesehen.has(l.external_id)) continue
    plan.entfernen.push({ id: l.id, name: l.name })
  }
  return plan
}

/** Ist an diesem Tag überhaupt etwas zu tun? */
export function planIstLeer(p: LebensmittelPlan): boolean {
  return p.anlegen.length === 0 && p.aendern.length === 0 && p.entfernen.length === 0
}

/* ------------------------------------------------------- Tageswerte buchen */

export interface MetrikZeile {
  id: string
  metric_id: string
  day: DayString
  value_num: number | null
  source: string
  deleted_at: string | null
}

export interface TageswertPlan {
  anlegen: { id: string; values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  /** Wiederherstellen: Zeile ist gelöscht, wird aber wieder gebraucht. */
  wiederherstellen: { id: string; patch: Record<string, any> }[]
  /** Konkurrierende Werte desselben Tages, die sonst doppelt zählen würden. */
  ersetzen: { id: string; metrik: string }[]
  /** FatSecret hat für diesen Wert nichts mehr – der eigene Eintrag muss weg. */
  entfernen: { id: string; metrik: string }[]
}

/**
 * Schreibt die Tagessummen dorthin, wo LifeHub Nährwerte schon immer sucht:
 * in die metric_entries.
 *
 * Der heikle Punkt ist die Doppelzählung. Ein Tageswert wird über ALLE
 * Einträge des Tages summiert (siehe core/metrics.ts, dayValue). Stünde neben
 * dem importierten Wert noch ein von Hand eingetragener, zeigte LifeHub die
 * Kalorien des Tages doppelt an – und zwar ohne dass irgendwo ein Fehler
 * sichtbar wäre. Deshalb gilt: Für einen Tag, den FatSecret liefert, ist
 * FatSecret die Quelle. Konkurrierende Einträge werden entfernt – als Soft
 * Delete, also wiederherstellbar über den Papierkorb, und die aufrufende
 * Stelle meldet es dem Nutzer, statt es still zu tun.
 */
export function planNutritionMetrics(opts: {
  day: DayString
  werte: Tageswerte
  /** Nur die Metriken, die es gibt und die eingeschaltet sind. */
  metriken: { id: string; key: string }[]
  /** Alle metric_entries dieses Tages, auch die gelöschten. */
  vorhanden: MetrikZeile[]
  syncedAt: string
}): TageswertPlan {
  const plan: TageswertPlan = {
    anlegen: [], aendern: [], wiederherstellen: [], ersetzen: [], entfernen: [],
  }

  for (const metrik of opts.metriken) {
    if (!(ERNAEHRUNGS_METRIKEN as readonly string[]).includes(metrik.key)) continue
    const wert = opts.werte[metrik.key as ErnaehrungsMetrik]
    const id = nutritionEntryId(metrik.key, opts.day)
    const zeilen = opts.vorhanden.filter((z) => z.metric_id === metrik.id && z.day === opts.day)
    const eigene = zeilen.find((z) => z.id === id)
    const fremde = zeilen.filter((z) => z.id !== id && !z.deleted_at)

    if (wert === null) {
      // FatSecret kennt zu diesem Tag keinen solchen Wert mehr. Der eigene
      // Eintrag muss weg – ein von Hand erfasster bleibt unberührt, sonst
      // löschte ein leerer Tag die Handeingabe gleich mit.
      if (eigene && !eigene.deleted_at) plan.entfernen.push({ id: eigene.id, metrik: metrik.key })
      continue
    }

    for (const f of fremde) plan.ersetzen.push({ id: f.id, metrik: metrik.key })

    const values = {
      id,
      metric_id: metrik.id,
      day: opts.day,
      value_num: wert,
      source: 'fatsecret',
      at_time: null,
      note: null,
      import_batch_id: null,
    }
    if (!eigene) {
      plan.anlegen.push({ id, values })
    } else if (eigene.deleted_at) {
      plan.wiederherstellen.push({ id, patch: { value_num: wert, source: 'fatsecret' } })
    } else if (Number(eigene.value_num) !== wert) {
      plan.aendern.push({ id, patch: { value_num: wert, source: 'fatsecret' } })
    }
  }
  return plan
}
