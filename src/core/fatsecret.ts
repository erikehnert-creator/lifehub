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
import {
  NAEHRWERTE, NAEHRWERT_KEYS, type NaehrwertKey, type Naehrwertsatz,
} from './naehrwerte'

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

export interface FatSecretEntry extends Naehrwertsatz {
  /** food_entry_id – der einzige stabile Anker, den FatSecret liefert. */
  externalId: string
  foodId: string | null
  day: DayString
  meal: Meal
  name: string
  servingDescription: string | null
  numberOfUnits: number | null
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
/**
 * Die Tage eines Monats, an denen überhaupt etwas im Tagebuch steht.
 *
 * Aus `food_entries.get_month.v2`. Die Übersicht enthält laut Doku nur Tage
 * mit Einträgen – damit kostet ein ganzer Monat einen Aufruf, und man weiß
 * danach, welche Tage sich einzeln zu holen lohnen. Ohne sie müsste der
 * historische Import jeden einzelnen Tag abfragen, auch die leeren.
 *
 * Dieselben zwei Fallen wie bei den Tageseinträgen: Bei genau einem Tag ist
 * `day` ein Objekt statt einer Liste, und ein leerer Monat hat gar kein
 * `day`-Feld.
 */
export function parseMonthDays(raw: any): DayString[] {
  const container = raw?.month ?? raw
  const roh = container?.day
  if (!roh) return []
  const liste: any[] = Array.isArray(roh) ? roh : [roh]

  const out: DayString[] = []
  for (const d of liste) {
    const dateInt = zahl(d?.date_int)
    if (dateInt === null) continue
    out.push(epochDayToDay(dateInt))
  }
  return [...new Set(out)].sort()
}

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
    // Die Nährwerte kommen aus der Liste in core/naehrwerte.ts, nicht aus
    // sechzehn einzeln hingeschriebenen Zeilen. Ein neuer Wert ist dort ein
    // Eintrag – und wird hier ohne weiteres Zutun mitgelesen.
    const werte = {} as Naehrwertsatz
    for (const n of NAEHRWERTE) werte[n.key] = zahl(e?.[n.feld])

    out.push({
      externalId,
      foodId: text(e?.food_id),
      day,
      meal: meal(e?.meal),
      name: text(e?.food_entry_name) ?? text(e?.food_entry_description) ?? 'Unbenannt',
      servingDescription: text(e?.food_entry_description),
      numberOfUnits: zahl(e?.number_of_units),
      ...werte,
    })
  }
  return out
}

/* -------------------------------------------------------------- Tageswerte */

/**
 * Die Metriken, die aus dem Tagebuch berechnet werden.
 *
 * Abgeleitet aus core/naehrwerte.ts – der Metrikschlüssel IST der Name der
 * Spalte in `food_entries`. Das ist kein Zufall, sondern die Voraussetzung
 * dafür, dass `aggregateDay()` die Tagessummen ohne Übersetzungstabelle bilden
 * kann.
 */
export const ERNAEHRUNGS_METRIKEN = NAEHRWERT_KEYS
export type ErnaehrungsMetrik = NaehrwertKey

export type Tageswerte = Naehrwertsatz

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
export interface LokalesLebensmittel extends Naehrwertsatz {
  id: string
  day: DayString
  external_id: string | null
  source: string
  deleted_at: string | null
  meal: string
  name: string
  serving_description: string | null
  number_of_units: number | null
}

export interface LebensmittelPlan {
  anlegen: { id: string; values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  /** Wieder da in FatSecret - also auch wieder hier. Siehe unten. */
  wiederherstellen: { id: string; values: Record<string, any> }[]
  /** In FatSecret gelöschte Einträge – hier ebenfalls entfernen. */
  entfernen: { id: string; name: string }[]
}

/**
 * Die Felder, die beim Abgleich einer schon gespeicherten Zeile verglichen und
 * nötigenfalls nachgezogen werden.
 *
 * Muss vollständig sein: Ein Feld, das hier fehlt, wird beim ersten Import
 * geschrieben, danach aber nie mehr aktualisiert – korrigiert man die Portion
 * in FatSecret, bliebe der alte Wert stehen, ohne dass irgendwo ein Fehler
 * auftaucht. `tests/fatsecret.test.ts` rechnet die Liste gegen die
 * Schnittstelle nach.
 */

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
  const plan: LebensmittelPlan = { anlegen: [], aendern: [], wiederherstellen: [], entfernen: [] }
  const desTages = opts.lokal.filter((l) => l.day === opts.day)

  // Die Zuordnung über die food_entry_id geht bewusst über ALLE übergebenen
  // Zeilen, nicht nur über die dieses Tages.
  //
  // Grund: Die Zeilen-ID leitet sich allein aus der food_entry_id ab, nicht
  // aus dem Tag. Verschiebt man einen Eintrag in FatSecret auf einen anderen
  // Tag – das Abendessen war doch von gestern –, behält er seine Kennung.
  // Wer nur den Tag ansieht, findet ihn dort nicht, will ihn neu anlegen und
  // scheitert am schon vergebenen Primärschlüssel; am alten Tag fällt er
  // gleichzeitig als „nicht mehr vorhanden" heraus. Der Eintrag wäre damit
  // verschwunden statt umgezogen. So wandert er einfach mit.
  const lokalNachExtern = new Map<string, LokalesLebensmittel>()
  for (const l of opts.lokal) {
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
    for (const k of NAEHRWERT_KEYS) werte[k] = e[k]

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
    if (vorhanden.deleted_at) {
      // Steht der Eintrag in FatSecret wieder da, gehört er auch wieder hierher.
      //
      // Früher blieb er gelöscht („in LifeHub bewusst entfernt"). Das war
      // richtig, solange LifeHub eine eigene Ernährungserfassung hatte. Seit
      // FatSecret die Quelle ist, ist es falsch: Ein Eintrag verschwindet hier
      // nur, weil er DORT verschwunden war – kommt er zurück, war das eine
      // Korrektur in FatSecret und keine Entscheidung in LifeHub.
      //
      // Wer einen Eintrag loswerden will, löscht ihn in FatSecret. Das ist die
      // gleiche Regel wie für alles andere auch: eine Quelle, ein Ort zum
      // Ändern.
      plan.wiederherstellen.push({
        id: vorhanden.id,
        values: { ...werte, synced_at: opts.syncedAt },
      })
      continue
    }

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
  return p.anlegen.length === 0 && p.aendern.length === 0
    && p.wiederherstellen.length === 0 && p.entfernen.length === 0
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
    const desTages = opts.vorhanden.filter((z) => z.day === opts.day)

    // Die eigene Zeile wird an ihrer ID erkannt, NICHT an der Metrik-ID.
    //
    // Das ist der Unterschied zwischen „funktioniert" und „Ballaststoffe
    // kommen nie an". Die ID ist aus Schlüssel und Tag abgeleitet und damit
    // auf jedem Gerät dieselbe; die Metrik-ID ist es nicht. Zeigt die Zeile
    // aus historischen Gründen auf eine andere Metrik-ID (siehe unten), fand
    // die frühere Fassung sie nicht, plante ein Anlegen – und das scheiterte
    // still am schon vergebenen Primärschlüssel. Der Wert war geschrieben,
    // aber unter einer Metrik, die es nicht mehr gab, und damit unsichtbar;
    // und weil jeder weitere Abgleich dieselbe Entscheidung traf, blieb es
    // dabei.
    const eigene = desTages.find((z) => z.id === id)

    // Fremde Zeilen sind nur die, die WIRKLICH auf diese Metrik zeigen –
    // sonst würde ein Handeintrag einer anderen Metrik mit abgeräumt.
    const fremde = desTages.filter((z) => z.metric_id === metrik.id && z.id !== id && !z.deleted_at)

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
    // `metric_id` gehört in jeden Patch: Zeigt die vorhandene Zeile auf eine
    // veraltete Metrik, wird sie damit beim nächsten Abgleich von selbst
    // geradegezogen, ohne dass jemand etwas anstoßen muss.
    const zeigtFalsch = !!eigene && eigene.metric_id !== metrik.id
    if (!eigene) {
      plan.anlegen.push({ id, values })
    } else if (eigene.deleted_at) {
      plan.wiederherstellen.push({ id, patch: { value_num: wert, source: 'fatsecret', metric_id: metrik.id } })
    } else if (Number(eigene.value_num) !== wert || zeigtFalsch) {
      const patch: Record<string, any> = { value_num: wert, source: 'fatsecret' }
      if (zeigtFalsch) patch.metric_id = metrik.id
      plan.aendern.push({ id, patch })
    }
  }
  return plan
}

/* ----------------------------------------------- Rückweg aus der Freigabe */

export interface Rueckweg {
  /** Die Adresse, auf die FatSecret nach der Freigabe zurückführt. */
  url: string
  /**
   * true, wenn die Freigabe über die Webfassung läuft, weil die laufende
   * Fassung keine Adresse hat, auf die zurückgeleitet werden kann.
   */
  ueberWeb: boolean
}

/**
 * Wohin FatSecret nach der Freigabe zurückkehrt.
 *
 * Läuft LifeHub über http(s), führt der Weg auf genau diese Seite zurück.
 * Läuft es als Einzeldatei per Doppelklick, geht das nicht:
 *
 *   - `file:///C:/…/LifeHub.html` ist keine Adresse, die ein OAuth-Dienst
 *     aufrufen kann. Ein Server leitet nicht auf die Festplatte des Besuchers.
 *   - `location.origin` ist in diesem Fall die Zeichenkette `"null"`. Wer
 *     `origin + pathname` zusammensetzt, erhält `null/C:/…` – und die Edge
 *     Function weist das zu Recht ab („redirect_to fehlt"), weil sie nur
 *     http:// und https:// annimmt. Genau daran ist die Verbindung aus der
 *     PC-Fassung bisher gescheitert.
 *
 * Dann führt der Rückweg auf die öffentliche Webfassung. Das ist kein Notnagel:
 * Das FatSecret-Token liegt hinterher serverseitig an der Supabase-Anmeldung,
 * nicht im Browser. Die Einzeldatei erkennt die Verbindung deshalb genauso,
 * sobald sie mit demselben Konto angemeldet ist – ohne selbst je ein Token
 * gesehen zu haben.
 *
 * Ein Windows-Pfad wird dabei nirgends gelesen oder weitergereicht.
 */
export function oauthRueckweg(
  ort: { protocol: string; origin: string; pathname: string },
  oeffentlicheAdresse: string,
  ziel = '#/einstellungen/ernaehrung',
): Rueckweg {
  const ueberWeb = !/^https?:$/i.test(ort.protocol ?? '')
  if (ueberWeb) {
    // Genau ein Schrägstrich am Ende, ob die Adresse einen mitbringt oder nicht.
    const basis = oeffentlicheAdresse.replace(/#.*$/, '').replace(/\/*$/, '/')
    return { url: basis + ziel, ueberWeb }
  }
  return { url: `${ort.origin}${ort.pathname}${ziel}`, ueberWeb }
}
