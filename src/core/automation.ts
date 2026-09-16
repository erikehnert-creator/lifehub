/**
 * Automatik: was LifeHub ohne Nachfragen selbst erzeugt, nachzieht und aufräumt.
 *
 * Zwei Dinge laufen hier zusammen, weil sie dieselbe Frage beantworten –
 * „was müsste laut einer Vorlage eigentlich dastehen, und was steht schon da?“:
 *
 *   1. Aufgaben aus Aufgabenvorlagen (wiederkehrende Verabredungen)
 *   2. Buchungen aus wiederkehrenden Zahlungen (Miete, Gehalt, Abos)
 *
 * So ähnlich die beiden aussehen, so unterschiedlich ist ihr Umgang mit der
 * Vergangenheit – und das ist Absicht, kein Versehen:
 *
 *   Aufgaben  ziehen nach. Wird aus „Training 18:00“ in der Vorlage
 *             „Training 17:30“, dann ist 17:30 ab sofort die Wahrheit, auch
 *             für die schon eingeplanten Tage, die noch bevorstehen.
 *
 *   Zahlungen ziehen NICHT nach. Eine gebuchte Zahlung ist ein Beleg über
 *             etwas, das tatsächlich passiert ist. Wird die Vorlage von 20 €
 *             auf 25 € geändert, waren die drei bereits gebuchten Zahlungen
 *             trotzdem 20 € – sie nachträglich zu ändern würde die eigene
 *             Finanzhistorie fälschen. Nur was danach neu entsteht, ist 25 €.
 *
 * Beide Seiten sind wiederholbar: zweimal ausführen ändert nichts, und zwei
 * Geräte, die es gleichzeitig tun, erzeugen dieselbe Zeile statt zwei (siehe
 * stableId in core/ids.ts).
 */
import type { DayString } from './dates'
import { addDays, daysInRange, diffDays, weekdayIndex, todayString } from './dates'
import type { RecurringRule, Task, TaskTemplate } from './types'
import { stableId } from './ids'
import { dueRecurringBookings } from './finance'

/** Wie weit im Voraus Aufgaben aus Vorlagen entstehen. */
export const VORPLANUNG_TAGE = 27

/* --------------------------------------------------------------- Identität */

/**
 * Die ID der Aufgabe, die aus dieser Vorlage an diesem Tag entsteht.
 * Auf jedem Gerät dieselbe – deshalb kann dieselbe Aufgabe nicht zweimal
 * entstehen, auch wenn PC und Handy gerade nichts voneinander wissen.
 */
export function templateTaskId(templateId: string, day: DayString): string {
  return stableId('aufgabe-aus-vorlage', templateId, day)
}

/** Dasselbe für die Buchung, die aus einer wiederkehrenden Zahlung entsteht. */
export function recurringBookingId(ruleId: string, day: DayString): string {
  return stableId('buchung-aus-zahlung', ruleId, day)
}

/* --------------------------------------------------- Aufgaben aus Vorlagen */

/** Die Felder, die eine Vorlage ihren Aufgaben vorgibt. */
const VORGEGEBENE_FELDER = ['title', 'description', 'duration_minutes', 'priority', 'scheduled_time'] as const

/** Was von einer Aufgabe gebraucht wird, um sie einer Vorlage zuzuordnen. */
export type VorlagenAufgabe = Pick<
  Task,
  'id' | 'template_id' | 'scheduled_on' | 'scheduled_time' | 'title' | 'description'
  | 'duration_minutes' | 'priority' | 'status' | 'deleted_at'
> & { carried_count?: number | null }

export interface VorlagenPlan {
  /** Neu anzulegende Aufgaben, jeweils mit ihrer wiederholbaren ID. */
  anlegen: { id: string; values: Record<string, any> }[]
  /** Aufgaben, deren Vorlage sich geändert hat – nur noch zukünftige, offene. */
  aendern: { id: string; titel: string; patch: Record<string, any> }[]
  /** Aufgaben, die es laut Vorlage nicht mehr geben darf. */
  entfernen: { id: string; titel: string; grund: 'vorlage-weg' | 'tag-passt-nicht' | 'doppelt' }[]
}

/** Titel vergleichbar machen: Groß-/Kleinschreibung und Randleerzeichen egal. */
function titelSchluessel(titel: string | null | undefined): string {
  return (titel ?? '').trim().toLowerCase()
}

/** Leere Werte einheitlich behandeln: '' und undefined sind dasselbe wie NULL. */
function leer(v: any): any {
  return v === undefined || v === '' ? null : v
}

/**
 * Vergleich, der die Automatik nicht in eine Endlosschleife schickt.
 * Zahlenfelder kommen aus SQLite mal als Zahl, mal als Text zurück – ohne
 * diese Angleichung fände jeder Durchlauf dieselbe „Änderung“ erneut.
 */
function gleich(a: any, b: any): boolean {
  const x = leer(a)
  const y = leer(b)
  if (x === null || y === null) return x === y
  if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y)
  return String(x) === String(y)
}

/** Gilt die Vorlage an diesem Tag? */
function vorlageGiltAm(
  tpl: TaskTemplate, day: DayString, dayTypeOf: Map<DayString, string>, from: DayString,
): boolean {
  if (tpl.weekday && weekdayIndex(day) !== tpl.weekday) return false
  if (tpl.day_type_id && dayTypeOf.get(day) !== tpl.day_type_id) return false
  if (tpl.interval_weeks > 1) {
    const anchor = tpl.anchor_date ?? from
    const weeks = Math.floor(diffDays(anchor, day) / 7)
    if (((weeks % tpl.interval_weeks) + tpl.interval_weeks) % tpl.interval_weeks !== 0) return false
  }
  return true
}

/**
 * Gleicht den Aufgabenbestand mit den Vorlagen ab.
 *
 * Bestandsschutz gilt für alles, was vorbei oder erledigt ist, und für
 * Aufgaben, die der Tagesübertrag schon einmal weitergeschoben hat: Die
 * gehören nicht mehr der Vorlage, sondern dem Tag, an dem sie gelandet sind.
 * Sie werden weder geändert noch entfernt – sonst räumte die Automatik dem
 * Nutzer die eigene Tagesplanung unter den Händen weg.
 *
 * `templates` und `tasks` sollen BEIDE auch die gelöschten Zeilen enthalten:
 * Eine gelöschte Vorlage muss ihre zukünftigen Aufgaben mitnehmen, und eine
 * von Hand gelöschte Aufgabe darf nicht beim nächsten Durchlauf wieder
 * auferstehen.
 */
export function reconcileTemplateTasks(opts: {
  templates: TaskTemplate[]
  assignments: { day: DayString; day_type_id: string }[]
  tasks: VorlagenAufgabe[]
  today?: DayString
  horizonDays?: number
  /** Kennt die Datenbank diese ID schon (auch als gelöschte Zeile)? */
  exists?: (id: string) => boolean
}): VorlagenPlan {
  const today = opts.today ?? todayString()
  const from = today
  const to = addDays(today, opts.horizonDays ?? VORPLANUNG_TAGE)
  const dayTypeOf = new Map(opts.assignments.map((a) => [a.day, a.day_type_id]))

  /* ------------------------------------------------------------------ Soll */
  const soll = new Map<string, { tpl: TaskTemplate; day: DayString }>()
  for (const tpl of opts.templates) {
    if (tpl.deleted_at || !tpl.is_active) continue
    for (const day of daysInRange(from, to)) {
      if (!vorlageGiltAm(tpl, day, dayTypeOf, from)) continue
      soll.set(`${tpl.id}|${day}`, { tpl, day })
    }
  }

  /* ------------------------------------------------------------------- Ist */
  const plan: VorlagenPlan = { anlegen: [], aendern: [], entfernen: [] }
  // Ein Schlüssel gilt als belegt, sobald irgendeine Zeile dazu existiert –
  // auch eine gelöschte. Sonst käme eine von Hand entfernte Aufgabe zurück.
  const belegt = new Set<string>()
  // Alle lebenden Aufgaben je Vorlagentag. Früher entschied hier die
  // Reihenfolge der Liste, wer bei einem Doppel überlebt – und das traf
  // regelmäßig die Zeile mit der wiederholbaren ID. Jetzt liegen erst alle
  // Kandidaten eines Tages beisammen, dann wird bewusst ausgewählt.
  const proTag = new Map<string, VorlagenAufgabe[]>()
  // Von Hand angelegte Aufgaben je Tag, nach Titel. Wer „Dehnung" heute selbst
  // einträgt, soll sie nicht ein zweites Mal von der Automatik bekommen.
  const vonHand = new Map<string, Set<string>>()

  for (const t of opts.tasks) {
    if (!t.scheduled_on) continue
    if (!t.template_id) {
      if (t.deleted_at || t.status === 'cancelled') continue
      const titel = vonHand.get(t.scheduled_on)
      if (titel) titel.add(titelSchluessel(t.title))
      else vonHand.set(t.scheduled_on, new Set([titelSchluessel(t.title)]))
      continue
    }
    const key = `${t.template_id}|${t.scheduled_on}`
    belegt.add(key)
    if (t.deleted_at) continue
    const liste = proTag.get(key)
    if (liste) liste.push(t)
    else proTag.set(key, [t])
  }

  /**
   * Bestandsschutz: Was vorbei, erledigt oder schon einmal weitergeschoben ist,
   * gehört nicht mehr der Vorlage – es wird weder geändert noch entfernt.
   */
  const geschuetzt = (t: VorlagenAufgabe): boolean =>
    t.scheduled_on! < today || t.status === 'done' || t.status === 'cancelled'
    || (t.carried_count ?? 0) > 0

  for (const [key, liste] of proTag) {
    const ziel = soll.get(key)
    if (!ziel) {
      // Die Vorlage ist weg oder pausiert, oder dieser Tag passt nicht mehr.
      const vorlageId = liste[0].template_id
      const nochAktiv = opts.templates.some((x) => x.id === vorlageId && !x.deleted_at && x.is_active)
      for (const t of liste) {
        if (geschuetzt(t)) continue
        plan.entfernen.push({ id: t.id, titel: t.title, grund: nochAktiv ? 'tag-passt-nicht' : 'vorlage-weg' })
      }
      continue
    }

    // Wer den Tag vertritt: bevorzugt die Zeile mit der wiederholbaren ID.
    // Wird die weggeräumt, sperrt ihre gelöschte Zeile den Tag für immer gegen
    // ein Neuanlegen – genau daran ist die tägliche Vorlage gescheitert.
    const kanonisch = templateTaskId(ziel.tpl.id, ziel.day)
    const haupt = liste.find((t) => t.id === kanonisch)
      ?? liste.find((t) => !geschuetzt(t))
      ?? liste[0]

    for (const t of liste) {
      if (t.id === haupt.id || geschuetzt(t)) continue
      // Zwei Aufgaben für denselben Vorlagentag. Eine reicht.
      plan.entfernen.push({ id: t.id, titel: t.title, grund: 'doppelt' })
    }

    if (geschuetzt(haupt)) continue
    const patch: Record<string, any> = {}
    for (const feld of VORGEGEBENE_FELDER) {
      const wunsch = leer((ziel.tpl as any)[feld])
      if (!gleich((haupt as any)[feld], wunsch)) patch[feld] = wunsch
    }
    if (Object.keys(patch).length) plan.aendern.push({ id: haupt.id, titel: haupt.title, patch })
  }

  /* -------------------------------------------------------------- Fehlende */
  for (const [key, { tpl, day }] of soll) {
    if (belegt.has(key)) continue
    // Heute schon von Hand eingetragen? Dann ist der Tag versorgt.
    if (vonHand.get(day)?.has(titelSchluessel(tpl.title))) continue
    const id = templateTaskId(tpl.id, day)
    // Doppelte Absicherung gegen einen Schlüsselkonflikt: Wenn die Zeile schon
    // existiert, die Zuordnung über template_id|Tag sie aber nicht gefunden
    // hat, würde ein INSERT die Datenbank mit einem Fehler stehen lassen.
    if (opts.exists?.(id)) continue
    plan.anlegen.push({
      id,
      values: {
        id,
        title: tpl.title,
        description: leer(tpl.description),
        scheduled_time: leer(tpl.scheduled_time),
        status: 'open',
        bucket: 'scheduled',
        scheduled_on: day,
        duration_minutes: tpl.duration_minutes,
        priority: tpl.priority,
        template_id: tpl.id,
        sort_order: 0,
      },
    })
  }
  plan.anlegen.sort((a, b) => (a.values.scheduled_on < b.values.scheduled_on ? -1 : 1))
  return plan
}

/* ------------------------------------------------- Buchungen aus Zahlungen */

export interface FaelligeBuchung {
  id: string
  ruleId: string
  titel: string
  day: DayString
  betragCents: number
  values: Record<string, any>
}

/**
 * Welche wiederkehrenden Zahlungen fällig sind und noch nicht gebucht wurden.
 *
 * Die Buchungswerte entstehen genau hier und nirgends sonst. Vorher stand
 * dieselbe Vorlage an zwei Stellen (Automatik und Finanzen-Knopf) – zwei
 * Kopien, die auseinanderdriften können, sobald eine davon ein Feld dazubekommt.
 */
export function duePayments(opts: {
  rules: RecurringRule[]
  transactions: { recurring_id: string | null; booked_on: DayString; deleted_at: string | null }[]
  today?: DayString
  /** Kennt die Datenbank diese ID schon (auch als gelöschte Zeile)? */
  exists?: (id: string) => boolean
}): FaelligeBuchung[] {
  const today = opts.today ?? todayString()
  const faellig = dueRecurringBookings(opts.rules, opts.transactions as any, today)
  const out: FaelligeBuchung[] = []
  for (const d of faellig) {
    const id = recurringBookingId(d.rule.id, d.day)
    // Eine von Hand gelöschte automatische Buchung bleibt gelöscht. Ohne
    // diese Abfrage stünde sie beim nächsten Öffnen wieder da.
    if (opts.exists?.(id)) continue
    const betrag = Number(d.template.amount_cents ?? 0)
    out.push({
      id,
      ruleId: d.rule.id,
      titel: d.rule.title,
      day: d.day,
      betragCents: betrag,
      values: {
        id,
        type: d.template.type ?? 'expense',
        booked_on: d.day,
        value_on: null,
        amount_cents: betrag,
        currency: 'EUR',
        account_id: d.template.account_id,
        to_account_id: d.template.to_account_id ?? null,
        category_id: d.template.category_id ?? null,
        merchant: d.rule.title,
        description: d.template.description ?? null,
        note: d.template.note ?? 'Automatisch aus einer wiederkehrenden Zahlung gebucht',
        status: 'booked',
        recurring_id: d.rule.id,
      },
    })
  }
  return out
}
