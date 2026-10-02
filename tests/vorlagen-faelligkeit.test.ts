/**
 * Die allgemeine Invariante wiederkehrender Aufgaben.
 *
 * ---------------------------------------------------------------------------
 * Warum es diese Prüfung neben `vorlagen-taeglich.test.ts` gibt
 *
 * Die dortige Prüfung nimmt „Dehnung" als Beispiel und bildet EIN Gerät nach.
 * Sie war grün, während die Aufgabe im Alltag trotzdem Tage auslies. Der
 * Unterschied liegt in zwei Dingen, die sie nicht nachbildet:
 *
 *   1. **Der Tagesübertrag rechnet auf einer veralteten Momentaufnahme.**
 *      `state/automatik.ts` liest `stand.tasks` EINMAL am Anfang eines Laufs
 *      und ruft danach erst den Abgleich (der schreibt) und dann
 *      `carryOverPatches(stand.tasks, …)` – mit der Liste von vorhin. Die
 *      Aufgabe, die der Abgleich für heute gerade angelegt hat, steht dort
 *      noch nicht drin.
 *
 *   2. **Zwei Geräte.** PC und Handy laufen unabhängig, jedes mit eigener
 *      Tagessperre für den Übertrag, und gleichen danach ab.
 *
 * Geprüft wird deshalb nicht „Dehnung funktioniert", sondern die Invariante
 * selbst, für jede Art von Vorlage:
 *
 *   **Ist eine aktive Vorlage an einem lokalen Kalendertag fällig, steht ihre
 *   reguläre Tagesinstanz an diesem Tag genau einmal zur Verfügung.**
 *
 * „Dehnung" bleibt als benannter Regressionsfall darin enthalten.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  reconcileTemplateTasks, templateTaskId, VORPLANUNG_TAGE,
} from '../src/core/automation'
import { carryOverPatches, tasksForDay } from '../src/core/planner'
import { addDays, weekdayIndex } from '../src/core/dates'
import type { TaskTemplate } from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 'test', server_rev: null,
}

function vorlage(teil: Partial<TaskTemplate> & { id: string; title: string }): TaskTemplate {
  return {
    ...basis, description: null, duration_minutes: 15, priority: 2,
    weekday: null, day_type_id: null, interval_weeks: 1,
    anchor_date: null, is_active: 1, last_generated_on: null, scheduled_time: null,
    ...teil,
  } as TaskTemplate
}

/** „Dehnung": jeden Tag, unabhängig von der Tagesart. */
const DEHNUNG = vorlage({ id: 'tpl-dehnung', title: 'Dehnung', anchor_date: '2026-09-01' })

const START = '2026-09-01' // ein Dienstag

type Zeile = Record<string, any>

/**
 * Eine monoton steigende Uhr für die Nachbildung.
 *
 * Die Wiederbelebungsregel vergleicht Zeitstempel (`deleted_at` gegen
 * `updated_at` von Vorlage und Tagesart). Mit `new Date()` lägen in einem
 * Testlauf mehrere Schritte in derselben Millisekunde, und der Vergleich
 * wäre reiner Zufall.
 */
let takt = 0
const uhr = () => new Date(Date.UTC(2026, 0, 1) + (takt += 1000)).toISOString()

/**
 * Ein Gerät – so nah am echten Ablauf, wie es ohne Browser geht.
 *
 * Wichtig ist die Reihenfolge innerhalb eines Laufs, weil genau daraus der
 * gemeldete Fehler entsteht: erst die Momentaufnahme, dann der Abgleich (der
 * schreibt), dann der Übertrag auf der Momentaufnahme von vorhin.
 */
function geraet(opts: {
  name?: string
  templates: TaskTemplate[]
  assignments?: { day: string; day_type_id: string }[]
  zeilen?: Zeile[]
  byId?: Map<string, Zeile>
}) {
  const templates = opts.templates
  const assignments = opts.assignments ?? []
  const zeilen: Zeile[] = opts.zeilen ?? []
  const byId: Map<string, Zeile> = opts.byId ?? new Map()
  let uebertragTag = ''
  // Die Schleifensperre aus state/automatik.ts: Dieselbe Änderungsliste
  // zweimal hintereinander wird NICHT ausgeführt, sondern gemeldet. Sie gehört
  // in die Nachbildung, weil sie im Ernstfall genau das verhindern würde, was
  // hier geprüft wird – das Anlegen der heutigen Aufgabe.
  let letzteAenderungen = ''

  const abgleichen = (heute: string) => {
    for (let runde = 0; runde < 12; runde++) {
      const plan = reconcileTemplateTasks({
        templates, assignments, tasks: zeilen as any,
        today: heute, horizonDays: VORPLANUNG_TAGE,
        exists: (id) => byId.has(id),
      })
      const signatur = JSON.stringify(plan)
      const etwasZuTun = plan.anlegen.length + plan.aendern.length
        + plan.wiederherstellen.length + plan.entfernen.length > 0
      if (etwasZuTun && signatur === letzteAenderungen) {
        throw new Error(
          `Die Schleifensperre hat zugeschlagen (${heute}): dieselbe Änderungsliste zweimal. `
          + `Im Alltag bedeutet das, dass die Aufgabe nicht angelegt wird.`,
        )
      }
      letzteAenderungen = signatur
      if (!etwasZuTun) return
      for (const a of plan.anlegen) {
        const row: Zeile = {
          ...a.values, deleted_at: null, carried_count: 0, carried_from: null,
          pinned_day: 0, scheduled_end_on: null, due_on: null, show_from: null,
          completed_at: null, created_at: uhr(), updated_at: uhr(),
        }
        zeilen.push(row)
        byId.set(row.id, row)
      }
      for (const a of plan.aendern) Object.assign(byId.get(a.id)!, a.patch)
      for (const w of plan.wiederherstellen) {
        Object.assign(byId.get(w.id)!, w.values, { deleted_at: null, updated_at: uhr() })
      }
      for (const e of plan.entfernen) {
        Object.assign(byId.get(e.id)!, { deleted_at: uhr(), updated_at: uhr() })
      }
    }
    throw new Error('Der Abgleich kommt nicht zur Ruhe – er dreht sich im Kreis.')
  }

  const ich = {
    name: opts.name ?? 'Gerät',
    zeilen, byId,
    /** Ein Lauf der Automatik, wie state/automatik.ts ihn ausführt. */
    lauf(heute: string) {
      // Die Momentaufnahme, mit der der Übertrag später rechnet: der Stand von
      // VOR dem Abgleich, ohne gelöschte Zeilen – genau `stand.tasks`.
      const momentaufnahme = zeilen.filter((z) => !z.deleted_at).map((z) => ({ ...z }))
      abgleichen(heute)
      if (uebertragTag !== heute) {
        uebertragTag = heute
        for (const u of carryOverPatches(momentaufnahme as any, heute)) {
          const zeile = byId.get(u.id)
          if (zeile && !zeile.deleted_at) Object.assign(zeile, u.patch)
        }
        abgleichen(heute)
      }
      return ich
    },
    /** Ein Kalendertag, an dem LifeHub geöffnet wird. */
    tag(heute: string) {
      ich.lauf(heute)
      // Nach dem Schreiben läuft der Abgleich erneut (Datenänderung).
      ich.lauf(heute)
      return ich
    },
    sichtbar(tag: string) { return tasksForDay(zeilen as any, tag, tag) },
    /**
     * Die REGULÄRE Tagesinstanz einer Vorlage – an ihrer wiederholbaren ID
     * erkannt.
     *
     * Bewusst nicht „alle Aufgaben dieser Vorlage": Eine unerledigte Aufgabe
     * von Dienstag steht am Mittwoch zu Recht noch da (Tagesübertrag), auch
     * wenn die Vorlage mittwochs gar nicht fällig ist. Das ist kein Fehler,
     * sondern der Sinn des Übertrags. Die Invariante gilt der Instanz, die der
     * Tag selbst hervorbringt.
     */
    vonVorlage(tag: string, tplId: string) {
      const id = templateTaskId(tplId, tag)
      return ich.sichtbar(tag).filter((t: any) => t.id === id)
    },
    /** Alles, was an diesem Tag von dieser Vorlage sichtbar ist – auch Übertragenes. */
    alleVonVorlage(tag: string, tplId: string) {
      return ich.sichtbar(tag).filter((t: any) => t.template_id === tplId)
    },
    mitTitel(tag: string, titel: string) {
      return ich.sichtbar(tag).filter((t: any) => t.title === titel)
    },
    abhaken(tag: string, titel: string) {
      for (const t of ich.mitTitel(tag, titel)) {
        (t as any).status = 'done'
        ;(t as any).completed_at = `${tag}T20:00:00Z`
      }
      return ich
    },
  }
  return ich
}

/** Zwei Geräte auf demselben Bestand – der Abgleich führt sie über die ID zusammen. */
function zweiGeraete(templates: TaskTemplate[], assignments: { day: string; day_type_id: string }[] = []) {
  const zeilen: Zeile[] = []
  const byId = new Map<string, Zeile>()
  const pc = geraet({ name: 'PC', templates, assignments, zeilen, byId })
  const handy = geraet({ name: 'Handy', templates, assignments, zeilen, byId })
  return { pc, handy, zeilen, byId }
}

/* ======================================================= Die Invariante */

/**
 * Ist die Vorlage an diesem Tag fällig? Bewusst unabhängig von
 * `reconcileTemplateTasks` formuliert – sonst prüfte der Test die Umsetzung
 * gegen sich selbst.
 */
function faelligAm(
  tpl: TaskTemplate, tag: string, tagesart: Map<string, string>,
): boolean {
  if (!tpl.is_active || tpl.deleted_at) return false
  if (tpl.weekday && weekdayIndex(tag) !== tpl.weekday) return false
  if (tpl.day_type_id && tagesart.get(tag) !== tpl.day_type_id) return false
  if (tpl.interval_weeks > 1) {
    // Derselbe Bezug wie in der Anwendung: Ankerdatum, sonst der Anlegetag.
    const anker = tpl.anchor_date ?? String(tpl.created_at ?? '').slice(0, 10)
    const tage = Math.round(
      (Date.parse(`${tag}T00:00:00Z`) - Date.parse(`${anker}T00:00:00Z`)) / 86400000,
    )
    if (((Math.floor(tage / 7) % tpl.interval_weeks) + tpl.interval_weeks) % tpl.interval_weeks !== 0) {
      return false
    }
  }
  return true
}

/** Der Kern: 14 Tage durchspielen und die Invariante an jedem Tag prüfen. */
function vierzehnTage(opts: {
  templates: TaskTemplate[]
  assignments?: { day: string; day_type_id: string }[]
  start?: string
  tage?: number
  /** Nach dem Tag aufgerufen – etwa zum Abhaken. */
  nachTag?: (g: ReturnType<typeof geraet>, tag: string) => void
}) {
  const assignments = opts.assignments ?? []
  const tagesart = new Map(assignments.map((a) => [a.day, a.day_type_id]))
  const g = geraet({ templates: opts.templates, assignments })
  const start = opts.start ?? START
  const anzahl = opts.tage ?? 14
  const abweichungen: string[] = []

  for (let i = 0; i < anzahl; i++) {
    const tag = addDays(start, i)
    g.tag(tag)
    for (const tpl of opts.templates) {
      const soll = faelligAm(tpl, tag, tagesart) ? 1 : 0
      const ist = g.vonVorlage(tag, tpl.id).length
      if (ist !== soll) abweichungen.push(`${tag} · ${tpl.title}: ${ist} statt ${soll}`)
    }
    opts.nachTag?.(g, tag)
  }
  return { g, abweichungen }
}

/* ============================================================== Prüfungen */

describe('Invariante: eine fällige Vorlage steht an ihrem Tag genau einmal da', () => {
  it('täglich, nie abgehakt – 14 Tage', () => {
    const { abweichungen } = vierzehnTage({ templates: [DEHNUNG] })
    expect(abweichungen).toEqual([])
  })

  it('täglich, jeden Tag abgehakt – 14 Tage', () => {
    const { abweichungen } = vierzehnTage({
      templates: [DEHNUNG],
      nachTag: (g, tag) => g.abhaken(tag, 'Dehnung'),
    })
    expect(abweichungen).toEqual([])
  })

  it('täglich, jeden zweiten Tag abgehakt – 14 Tage', () => {
    let n = 0
    const { abweichungen } = vierzehnTage({
      templates: [DEHNUNG],
      nachTag: (g, tag) => { if (n++ % 2 === 0) g.abhaken(tag, 'Dehnung') },
    })
    expect(abweichungen).toEqual([])
  })

  it('Wochentagsregel: nur dienstags', () => {
    const dienstags = vorlage({
      id: 'tpl-di', title: 'Werkstatt aufräumen', weekday: 2, anchor_date: START,
    })
    const { abweichungen } = vierzehnTage({ templates: [dienstags] })
    expect(abweichungen).toEqual([])
  })

  it('Tagesartregel: nur an Spätschichttagen', () => {
    const assignments = Array.from({ length: 14 }, (_, i) => ({
      day: addDays(START, i), day_type_id: i % 3 === 0 ? 'spaet' : 'frueh',
    }))
    const nurSpaet = vorlage({
      id: 'tpl-spaet', title: 'Auto putzen', day_type_id: 'spaet', anchor_date: START,
    })
    const { abweichungen } = vierzehnTage({ templates: [nurSpaet], assignments })
    expect(abweichungen).toEqual([])
  })

  it('alle zwei Wochen – der Rhythmus bleibt über 28 Tage stehen', () => {
    const zweiwoechig = vorlage({
      id: 'tpl-2w', title: 'Ölwechsel prüfen', interval_weeks: 2, anchor_date: START,
    })
    const { abweichungen } = vierzehnTage({ templates: [zweiwoechig], tage: 28 })
    expect(abweichungen).toEqual([])
  })

  it('alle zwei Wochen OHNE hinterlegtes Ankerdatum – der Rhythmus wandert nicht mit', () => {
    /* Der eigentliche Fehler: Ohne Ankerdatum nahm die Fälligkeitsrechnung
       „heute" als Bezugspunkt. Damit wanderte der Bezug jeden Tag mit, und
       „alle zwei Wochen" hiess in Wahrheit „von heute aus die nächsten sieben
       Tage" – also jeden Tag aufs Neue. Sichtbar wird das hier: Der Plan, den
       LifeHub am Montag rechnet, und der vom Dienstag müssen für dieselben
       Tage dieselbe Antwort geben. */
    const ohneAnker = vorlage({
      id: 'tpl-2w-lose', title: 'Fenster putzen', interval_weeks: 2, anchor_date: null,
    })
    const sollTage = (heute: string) => new Set(
      reconcileTemplateTasks({
        templates: [ohneAnker], assignments: [], tasks: [],
        today: heute, horizonDays: VORPLANUNG_TAGE,
      }).anlegen.map((a) => a.values.scheduled_on as string),
    )

    const vomErsten = sollTage(START)
    for (let i = 1; i <= 10; i++) {
      const spaeter = addDays(START, i)
      const dann = sollTage(spaeter)
      // Alle Tage, die BEIDE Läufe überblicken, müssen gleich beurteilt werden.
      for (let k = 0; k < VORPLANUNG_TAGE - i; k++) {
        const tag = addDays(spaeter, k)
        expect(dann.has(tag), `${spaeter} beurteilt ${tag} anders als ${START}`)
          .toBe(vomErsten.has(tag))
      }
    }
  })

  it('alle zwei Wochen: die Automatik räumt nichts wieder ab, was sie selbst angelegt hat', () => {
    /* Die zweite Hälfte desselben Fehlers. Ein wandernder Bezugspunkt liess
       Aufgaben entstehen, die am Folgetag „nicht mehr passten" – die Automatik
       löschte sie wieder. Eine gelöschte Zeile sperrt ihren Tag aber dauerhaft
       gegen ein Neuanlegen (`belegt`), und damit war der Tag verloren. */
    const zweiwoechig = vorlage({
      id: 'tpl-2w', title: 'Ölwechsel prüfen', interval_weeks: 2, anchor_date: null,
    })
    const g = geraet({ templates: [zweiwoechig] })
    for (let i = 0; i < 28; i++) g.tag(addDays(START, i))
    const abgeraeumt = g.zeilen.filter((z) => z.deleted_at)
    expect(abgeraeumt.map((z) => `${z.scheduled_on} (${z.deleted_at})`)).toEqual([])
  })

  it('deaktivierte Vorlage kommt nicht', () => {
    const aus = vorlage({ id: 'tpl-aus', title: 'Pausiert', is_active: 0, anchor_date: START })
    const { abweichungen } = vierzehnTage({ templates: [aus] })
    expect(abweichungen).toEqual([])
  })

  it('Monatswechsel', () => {
    const { abweichungen } = vierzehnTage({ templates: [DEHNUNG], start: '2026-09-25', tage: 14 })
    expect(abweichungen).toEqual([])
  })

  it('Jahreswechsel', () => {
    const { abweichungen } = vierzehnTage({ templates: [DEHNUNG], start: '2026-12-26', tage: 14 })
    expect(abweichungen).toEqual([])
  })

  it('Sommerzeitende – die Nacht mit 25 Stunden', () => {
    const { abweichungen } = vierzehnTage({ templates: [DEHNUNG], start: '2026-10-20', tage: 14 })
    expect(abweichungen).toEqual([])
  })

  it('Sommerzeitbeginn – die Nacht mit 23 Stunden', () => {
    const { abweichungen } = vierzehnTage({ templates: [DEHNUNG], start: '2027-03-22', tage: 14 })
    expect(abweichungen).toEqual([])
  })

  it('mehrere Vorlagen nebeneinander', () => {
    const assignments = Array.from({ length: 14 }, (_, i) => ({
      day: addDays(START, i), day_type_id: i % 2 === 0 ? 'frueh' : 'spaet',
    }))
    const { abweichungen } = vierzehnTage({
      templates: [
        DEHNUNG,
        vorlage({ id: 'tpl-di', title: 'Werkstatt', weekday: 2, anchor_date: START }),
        vorlage({ id: 'tpl-spaet', title: 'Auto putzen', day_type_id: 'spaet', anchor_date: START }),
        vorlage({ id: 'tpl-2w', title: 'Ölwechsel', interval_weeks: 2, anchor_date: START }),
      ],
      assignments,
    })
    expect(abweichungen).toEqual([])
  })
})

describe('App-Neustart, Pausen und mehrfache Läufe', () => {
  it('App war 40 Tage zu – der erste Tag danach hat genau eine', () => {
    const g = geraet({ templates: [DEHNUNG] })
    g.tag(START)
    const spaeter = addDays(START, 40)
    g.tag(spaeter)
    expect(g.vonVorlage(spaeter, DEHNUNG.id)).toHaveLength(1)
    // Und die Tage danach ebenfalls.
    for (let i = 1; i <= 5; i++) {
      const tag = addDays(spaeter, i)
      g.tag(tag)
      expect(g.vonVorlage(tag, DEHNUNG.id), `am ${tag}`).toHaveLength(1)
    }
  })

  it('mehrfaches Öffnen am selben Tag erzeugt keine Dublette', () => {
    const g = geraet({ templates: [DEHNUNG] })
    g.tag(START)
    for (let i = 0; i < 6; i++) g.lauf(START)
    expect(g.vonVorlage(START, DEHNUNG.id)).toHaveLength(1)
  })

  it('einmalige Aufgaben bleiben unberührt', () => {
    const g = geraet({ templates: [DEHNUNG] })
    g.zeilen.push({
      id: 'einmalig', title: 'Reifen wechseln', description: null, scheduled_time: null,
      status: 'open', bucket: 'today', scheduled_on: addDays(START, 2), duration_minutes: 60,
      priority: 3, template_id: null, sort_order: 0, deleted_at: null,
      carried_count: 0, carried_from: null, pinned_day: 0, scheduled_end_on: null,
      due_on: null, show_from: null, completed_at: null,
    })
    g.byId.set('einmalig', g.zeilen[g.zeilen.length - 1])
    for (let i = 0; i < 6; i++) g.tag(addDays(START, i))
    const zeile = g.byId.get('einmalig')!
    expect(zeile.deleted_at).toBe(null)
    // Sie wandert mit dem Übertrag mit, bleibt aber erhalten.
    expect(zeile.title).toBe('Reifen wechseln')
  })
})

describe('Ein Tag, den die Automatik selbst geräumt hat, bleibt heilbar', () => {
  /**
   * Der dritte gefundene Fehler, und der heimtückischste: Eine gelöschte
   * Zeile sperrt ihren Vorlagentag dauerhaft gegen ein Neuanlegen (`belegt`).
   * Das ist richtig, solange ERIK die Aufgabe gelöscht hat. Räumt die
   * Automatik sie selbst ab – weil die Vorlage den Tag gerade nicht mehr
   * will –, und will die Vorlage den Tag später wieder, blieb der Tag für
   * immer leer. Ein Tagesarttausch hin und zurück genügte.
   */
  const zielTag = addDays(START, 10)

  /** Ein Gerät mit veränderlichen Tagesarten. */
  function buehne(tpl: TaskTemplate) {
    const zuordnung: { day: string; day_type_id: string; updated_at?: string | null }[] = []
    const zeilen: Zeile[] = []
    const byId = new Map<string, Zeile>()
    const g = geraet({ templates: [tpl], assignments: zuordnung, zeilen, byId })
    return {
      g, zuordnung,
      setzeTagesart(tag: string, art: string) {
        const da = zuordnung.find((a) => a.day === tag)
        if (da) { da.day_type_id = art; da.updated_at = uhr() }
        else zuordnung.push({ day: tag, day_type_id: art, updated_at: uhr() })
      },
    }
  }

  it('Tagesart weg und zurück: die Aufgabe kommt wieder', () => {
    const nurSpaet = vorlage({
      id: 'tpl-spaet', title: 'Auto putzen', day_type_id: 'spaet', anchor_date: START,
    })
    const b = buehne(nurSpaet)
    b.setzeTagesart(zielTag, 'spaet')
    b.g.tag(START)
    expect(b.g.byId.get(templateTaskId(nurSpaet.id, zielTag))?.deleted_at, 'angelegt').toBe(null)

    b.setzeTagesart(zielTag, 'frueh')
    b.g.lauf(START)
    expect(b.g.byId.get(templateTaskId(nurSpaet.id, zielTag))?.deleted_at, 'weggeräumt').not.toBe(null)

    b.setzeTagesart(zielTag, 'spaet')
    b.g.lauf(START)
    expect(b.g.vonVorlage(zielTag, nurSpaet.id), `am ${zielTag} nach dem Zurückstellen`)
      .toHaveLength(1)
  })

  it('Vorlage pausiert und wieder eingeschaltet: die Aufgaben kommen wieder', () => {
    const tpl = vorlage({ id: 'tpl-pause', title: 'Dehnung', anchor_date: START })
    const templates = [tpl]
    const g = geraet({ templates })
    g.tag(START)
    const tag = addDays(START, 5)
    expect(g.vonVorlage(tag, tpl.id), 'vor dem Pausieren').toHaveLength(1)

    // Pausieren: die Automatik räumt alles ab, was noch bevorsteht.
    templates[0] = { ...tpl, is_active: 0, updated_at: uhr() } as TaskTemplate
    g.lauf(START)
    expect(g.vonVorlage(tag, tpl.id), 'pausiert').toHaveLength(0)

    // Wieder einschalten.
    templates[0] = { ...tpl, is_active: 1, updated_at: uhr() } as TaskTemplate
    g.lauf(START)
    expect(g.vonVorlage(tag, tpl.id), 'wieder eingeschaltet').toHaveLength(1)
    // Und über die nächsten Tage bleibt es bei einer je Tag.
    for (let i = 0; i < 7; i++) {
      const t = addDays(START, i)
      g.tag(t)
      expect(g.vonVorlage(t, tpl.id), `am ${t}`).toHaveLength(1)
    }
  })

  it('von Hand gelöscht bleibt gelöscht – daran ändert sich nichts', () => {
    const g = geraet({ templates: [DEHNUNG] })
    g.tag(START)
    const tag = addDays(START, 4)
    const zeile = g.byId.get(templateTaskId(DEHNUNG.id, tag))!
    zeile.deleted_at = uhr()      // Erik wischt sie weg
    g.lauf(START)
    expect(g.vonVorlage(tag, DEHNUNG.id), 'nach dem Wegwischen').toHaveLength(0)
    // Auch nach mehreren Läufen und Tagen kommt sie nicht zurück.
    g.tag(addDays(START, 1)).tag(addDays(START, 2))
    expect(g.vonVorlage(tag, DEHNUNG.id), 'später').toHaveLength(0)
    // Der FOLGETAG ist davon aber unberührt.
    expect(g.vonVorlage(addDays(tag, 1), DEHNUNG.id), 'Folgetag').toHaveLength(1)
  })

  it('eine von Hand eingetragene Aufgabe verhindert die Wiederbelebung', () => {
    // Sonst stünde nach dem Zurückstellen der Tagesart die eigene Eintragung
    // neben der wiedergeholten – zweimal dasselbe an einem Tag.
    const nurSpaet = vorlage({
      id: 'tpl-hand', title: 'Auto putzen', day_type_id: 'spaet', anchor_date: START,
    })
    const b = buehne(nurSpaet)
    b.setzeTagesart(zielTag, 'spaet')
    b.g.tag(START)
    b.setzeTagesart(zielTag, 'frueh')
    b.g.lauf(START)

    const eigene: Zeile = {
      id: 'von-hand', title: 'Auto putzen', description: null, scheduled_time: null,
      status: 'open', bucket: 'scheduled', scheduled_on: zielTag, duration_minutes: null,
      priority: 2, template_id: null, sort_order: 0, deleted_at: null,
      carried_count: 0, carried_from: null, pinned_day: 0, scheduled_end_on: null,
      due_on: null, show_from: null, completed_at: null,
      created_at: uhr(), updated_at: uhr(),
    }
    b.g.zeilen.push(eigene)
    b.g.byId.set(eigene.id, eigene)

    b.setzeTagesart(zielTag, 'spaet')
    b.g.lauf(START)
    const sichtbar = b.g.sichtbar(zielTag).filter((t: any) => t.title === 'Auto putzen')
    expect(sichtbar, `am ${zielTag}`).toHaveLength(1)
    expect(sichtbar[0].id).toBe('von-hand')
  })

  it('die Wiederbelebung dreht sich nicht im Kreis', () => {
    // Läuft der Abgleich nach der Wiederbelebung erneut, darf er nichts mehr
    // finden – sonst schlägt die Schleifensperre der Nachbildung zu.
    const nurSpaet = vorlage({
      id: 'tpl-ruhe', title: 'Auto putzen', day_type_id: 'spaet', anchor_date: START,
    })
    const b = buehne(nurSpaet)
    b.setzeTagesart(zielTag, 'spaet')
    b.g.tag(START)
    b.setzeTagesart(zielTag, 'frueh')
    b.g.lauf(START)
    b.setzeTagesart(zielTag, 'spaet')
    for (let i = 0; i < 5; i++) b.g.lauf(START)
    expect(b.g.vonVorlage(zielTag, nurSpaet.id)).toHaveLength(1)
  })
})

describe('Heute und Planner sagen dasselbe', () => {
  /**
   * Die Wochenansicht des Planners hatte eine eigene Zeile:
   *   data.tasks.filter((t) => !t.deleted_at && t.scheduled_on === d)
   * Das ist knapp daneben, und zwar in beide Richtungen. Der Test hält beide
   * Abweichungen fest, damit niemand die Abkürzung wieder einbaut.
   */
  const lage = () => {
    const g = geraet({ templates: [DEHNUNG] })
    // Fünf Tage nicht geöffnet: Es liegen mehrere offene Tagesinstanzen an
    // ihren Tagen, und „Heute" verdeckt alle bis auf eine.
    g.tag(START)
    const heute = addDays(START, 5)
    g.tag(heute)
    return { g, heute }
  }

  it('die verdeckten Tagesinstanzen dürfen auch in der Woche nicht auftauchen', () => {
    const { g, heute } = lage()
    const ueberHeute = g.sichtbar(heute)
    const roh = g.zeilen.filter((t) => !t.deleted_at && t.scheduled_on === heute)
    // Die Abkürzung sieht mehr, als „Heute" zeigt – genau das war der Fehler.
    expect(roh.length).toBeGreaterThan(0)
    expect(ueberHeute.filter((t: any) => t.scheduled_on === heute)).toHaveLength(1)
    // Und das ist der Maßstab: Was „Heute" zeigt, zeigt der Planner auch.
    expect(tasksForDay(g.zeilen as any, heute, heute).map((t: any) => t.id))
      .toEqual(ueberHeute.map((t: any) => t.id))
  })

  it('eine abgesagte Aufgabe zählt nirgends mit', () => {
    const { g, heute } = lage()
    const abgesagt = {
      id: 'abgesagt', title: 'Doch nicht', description: null, scheduled_time: null,
      status: 'cancelled', bucket: 'today', scheduled_on: heute, duration_minutes: 45,
      priority: 2, template_id: null, sort_order: 0, deleted_at: null,
      carried_count: 0, carried_from: null, pinned_day: 0, scheduled_end_on: null,
      due_on: null, show_from: null, completed_at: null,
    }
    g.zeilen.push(abgesagt)
    g.byId.set(abgesagt.id, abgesagt)
    expect(g.sichtbar(heute).map((t: any) => t.id)).not.toContain('abgesagt')
    // Die Abkürzung hätte sie mitgezählt – auch in der Auslastung des Tages.
    expect(g.zeilen.filter((t) => !t.deleted_at && t.scheduled_on === heute).map((t) => t.id))
      .toContain('abgesagt')
  })

  it('kein Bildschirm filtert Aufgaben an tasksForDay vorbei', () => {
    // Quelltextprüfung, weil die Bildschirme React-Bauteile sind: Wer Aufgaben
    // eines Tages zeigt, nimmt die gemeinsame Fachlogik – keine zweite,
    // leicht abweichende Rechnung.
    const dateien = [
      'src/screens/Today.tsx',
      'src/screens/planner/DayView.tsx',
      'src/screens/planner/WeekView.tsx',
    ]
    for (const datei of dateien) {
      const text = readFileSync(new URL(`../${datei}`, import.meta.url), 'utf8')
      expect(text, `${datei} nimmt tasksForDay()`).toMatch(/tasksForDay\s*\(/)
      expect(text, `${datei} filtert Aufgaben selbst nach scheduled_on`)
        .not.toMatch(/data\.tasks[\s\S]{0,140}?\.filter\([\s\S]{0,140}?scheduled_on\s*===/)
    }
  })
})

describe('PC und Handy', () => {
  it('beide Geräte, 14 Tage abwechselnd geöffnet – genau eine je Tag', () => {
    const { pc, handy } = zweiGeraete([DEHNUNG])
    for (let i = 0; i < 14; i++) {
      const tag = addDays(START, i)
      // Beide öffnen denselben Tag; jedes hat seine eigene Tagessperre für den
      // Übertrag, und beide arbeiten auf dem abgeglichenen Bestand.
      pc.tag(tag)
      handy.tag(tag)
      expect(pc.vonVorlage(tag, DEHNUNG.id), `PC am ${tag}`).toHaveLength(1)
      expect(handy.vonVorlage(tag, DEHNUNG.id), `Handy am ${tag}`).toHaveLength(1)
    }
  })

  it('am Handy abgehakt – der PC sieht dieselbe Aufgabe', () => {
    const { pc, handy } = zweiGeraete([DEHNUNG])
    for (let i = 0; i < 7; i++) {
      const tag = addDays(START, i)
      pc.tag(tag)
      handy.tag(tag)
      handy.abhaken(tag, 'Dehnung')
      expect(pc.vonVorlage(tag, DEHNUNG.id), `PC am ${tag}`).toHaveLength(1)
      expect(pc.vonVorlage(tag, DEHNUNG.id)[0].status).toBe('done')
    }
  })

  it('nur das Handy wird benutzt, der PC kommt nach einer Woche dazu', () => {
    const { pc, handy } = zweiGeraete([DEHNUNG])
    for (let i = 0; i < 7; i++) handy.tag(addDays(START, i))
    const tag = addDays(START, 7)
    handy.tag(tag)
    pc.tag(tag)
    expect(handy.vonVorlage(tag, DEHNUNG.id)).toHaveLength(1)
    expect(pc.vonVorlage(tag, DEHNUNG.id)).toHaveLength(1)
    expect(pc.vonVorlage(tag, DEHNUNG.id)[0].id)
      .toBe(handy.vonVorlage(tag, DEHNUNG.id)[0].id)
  })

  it('die Zeile mit der wiederholbaren ID überlebt jeden Tag', () => {
    const { pc, handy, byId } = zweiGeraete([DEHNUNG])
    for (let i = 0; i < 14; i++) {
      const tag = addDays(START, i)
      pc.tag(tag)
      handy.tag(tag)
      const kanonisch = byId.get(templateTaskId(DEHNUNG.id, tag))
      expect(kanonisch, `kanonische Zeile für ${tag}`).toBeDefined()
      expect(kanonisch!.deleted_at, `kanonische Zeile für ${tag} ist gelöscht`).toBe(null)
    }
  })
})
