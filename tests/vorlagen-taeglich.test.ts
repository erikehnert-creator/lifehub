/**
 * Die tägliche Aufgabenvorlage – am Beispiel „Dehnung": jeden Tag, unabhängig
 * von der Tagesart, jede Woche.
 *
 * Warum dieser Test über MEHRERE Tage läuft und nicht nur einen Plan prüft:
 * Der gemeldete Fehler entstand erst im Zusammenspiel. Für jeden Tag legt die
 * Vorlage eine Aufgabe an; wurde eine davon nicht abgehakt, schob der
 * Tagesübertrag sie auf heute – genau dorthin, wo für heute schon eine lag.
 * Aus den zwei Zeilen räumte der Abgleich eine weg, und das traf regelmäßig
 * die Zeile mit der wiederholbaren ID. Deren gelöschte Zeile sperrt den Tag
 * dann für immer gegen ein Neuanlegen. Fiel danach die verbliebene Kopie weg,
 * stand für den Tag gar nichts mehr da – und die Automatik konnte das nicht
 * mehr heilen. Genau so verschwand „Dehnung".
 *
 * Einen einzelnen Planlauf hätte das nie gezeigt: templates.test.ts war grün.
 */
import { describe, it, expect } from 'vitest'
import { reconcileTemplateTasks, templateTaskId, VORPLANUNG_TAGE } from '../src/core/automation'
import { carryOverPatches, tasksForDay } from '../src/core/planner'
import { addDays, weekdayIndex } from '../src/core/dates'
import type { TaskTemplate } from '../src/core/types'

const base = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 'test', server_rev: null,
}

/** „Dehnung": jeden Tag · unabhängig von der Tagesart · jede Woche. */
const DEHNUNG: TaskTemplate = {
  ...base, id: 'tpl-dehnung', title: 'Dehnung', description: null,
  duration_minutes: 15, priority: 2,
  weekday: null, day_type_id: null, interval_weeks: 1,
  anchor_date: '2026-09-01', is_active: 1, last_generated_on: null, scheduled_time: null,
}

const START = '2026-09-01' // ein Dienstag

/**
 * Ein Gerät mit seinem Aufgabenbestand.
 *
 * Bildet nach, was state/automatik.ts wirklich tut: Der Abgleich läuft nach
 * JEDER Datenänderung erneut (und schreibt dabei selbst), der Tagesübertrag
 * dagegen genau einmal pro Kalendertag. Deshalb hier dieselbe Reihenfolge und
 * dieselbe Wiederholung bis zur Ruhe.
 */
function geraet(templates: TaskTemplate[] = [DEHNUNG], assignments: { day: string; day_type_id: string }[] = []) {
  const zeilen: any[] = []
  const byId = new Map<string, any>()
  let letzterUebertrag = ''

  const abgleichen = (heute: string) => {
    for (let runde = 0; runde < 8; runde++) {
      const plan = reconcileTemplateTasks({
        templates, assignments, tasks: zeilen as any,
        today: heute, horizonDays: VORPLANUNG_TAGE,
        exists: (id) => byId.has(id),
      })
      if (!plan.anlegen.length && !plan.aendern.length && !plan.entfernen.length) return
      for (const a of plan.anlegen) {
        const row = {
          ...a.values, deleted_at: null, carried_count: 0, carried_from: null,
          pinned_day: 0, scheduled_end_on: null, due_on: null, show_from: null,
        }
        zeilen.push(row)
        byId.set(row.id, row)
      }
      for (const a of plan.aendern) Object.assign(byId.get(a.id), a.patch)
      for (const e of plan.entfernen) byId.get(e.id).deleted_at = 'auto'
    }
    throw new Error('Der Abgleich kommt nicht zur Ruhe – er dreht sich im Kreis.')
  }

  return {
    zeilen, byId,
    /** Ein Tag, an dem LifeHub geöffnet wird. */
    tag(heute: string) {
      abgleichen(heute)
      if (letzterUebertrag !== heute) {
        letzterUebertrag = heute
        for (const u of carryOverPatches(zeilen as any, heute)) Object.assign(byId.get(u.id), u.patch)
        abgleichen(heute)
      }
      return this
    },
    /** Noch einmal öffnen, ohne dass ein neuer Tag begonnen hat. */
    nochmalOeffnen(heute: string) { abgleichen(heute); return this },
    /** Was an diesem Tag wirklich auf der Heute-Seite steht. */
    heute(tag: string) { return tasksForDay(zeilen as any, tag, tag) },
    dehnungenAm(tag: string) { return this.heute(tag).filter((t: any) => t.title === 'Dehnung') },
    abhaken(tag: string) {
      for (const t of this.dehnungenAm(tag)) { t.status = 'done'; t.completed_at = 'x' }
      return this
    },
  }
}

describe('Tägliche Vorlage „Dehnung"', () => {
  it('1. steht an jedem Tag genau einmal da – auch wenn nie abgehakt wird', () => {
    const g = geraet()
    for (let i = 0; i < 21; i++) {
      const tag = addDays(START, i)
      g.tag(tag)
      expect(g.dehnungenAm(tag), `am ${tag}`).toHaveLength(1)
    }
  })

  it('1b. dasselbe, wenn jeden Tag abgehakt wird', () => {
    const g = geraet()
    for (let i = 0; i < 21; i++) {
      const tag = addDays(START, i)
      g.tag(tag)
      expect(g.dehnungenAm(tag), `am ${tag}`).toHaveLength(1)
      g.abhaken(tag)
    }
  })

  it('2. alle sieben Wochentage, Montag bis Sonntag', () => {
    const g = geraet()
    const gesehen = new Set<number>()
    for (let i = 0; i < 7; i++) {
      const tag = addDays(START, i)
      g.tag(tag)
      expect(g.dehnungenAm(tag), `Wochentag ${weekdayIndex(tag)}`).toHaveLength(1)
      gesehen.add(weekdayIndex(tag))
    }
    expect([...gesehen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('3.–7. unabhängig von der Tagesart: Früh-, Spätschicht, Wochenende, Urlaub', () => {
    const tagesarten = [
      { day: addDays(START, 0), day_type_id: 'frueh' },
      { day: addDays(START, 1), day_type_id: 'spaet' },
      { day: addDays(START, 2), day_type_id: 'urlaub' },
      { day: addDays(START, 3), day_type_id: 'frei' },
      { day: addDays(START, 4), day_type_id: 'wochenende' },
      // Tag 5 absichtlich ohne Zuordnung – auch dann muss sie kommen.
    ]
    const g = geraet([DEHNUNG], tagesarten)
    for (let i = 0; i < 6; i++) {
      const tag = addDays(START, i)
      g.tag(tag)
      expect(g.dehnungenAm(tag), `Tagesart ${tagesarten[i]?.day_type_id ?? 'keine'}`).toHaveLength(1)
    }
  })

  it('3b. eine Vorlage MIT Tagesart bleibt an fremde Tagesarten gebunden', () => {
    // Gegenprobe: Sonst würde der Test oben auch dann grün, wenn die Tagesart
    // gar nicht mehr geprüft wird.
    const nurSpaet = { ...DEHNUNG, id: 'tpl-spaet', title: 'Auto putzen', day_type_id: 'spaet' }
    const g = geraet([nurSpaet], [
      { day: addDays(START, 0), day_type_id: 'frueh' },
      { day: addDays(START, 1), day_type_id: 'spaet' },
    ])
    g.tag(addDays(START, 0))
    expect(g.heute(addDays(START, 0)).filter((t: any) => t.title === 'Auto putzen')).toHaveLength(0)
    expect(g.heute(addDays(START, 1)).filter((t: any) => t.title === 'Auto putzen')).toHaveLength(1)
  })

  it('8. LifeHub wird erst mittags geöffnet – die Aufgabe ist trotzdem da', () => {
    // Der Abgleich hängt am Kalendertag, nicht an der Uhrzeit: Der erste Lauf
    // des Tages findet dieselbe Lage vor, egal ob 0:05 Uhr oder 13:00 Uhr.
    const g = geraet()
    g.tag(START)
    const spaeterAmTag = geraet()
    spaeterAmTag.tag(START)
    expect(g.dehnungenAm(START)).toHaveLength(1)
    expect(spaeterAmTag.dehnungenAm(START)).toHaveLength(1)
  })

  it('9. App war gestern zu – heute steht genau eine da, keine Altlast-Stapel', () => {
    const g = geraet()
    g.tag(START)            // Tag 1: alles entsteht, nichts wird abgehakt
    const spaeter = addDays(START, 5)
    g.tag(spaeter)          // fünf Tage später erst wieder geöffnet
    expect(g.dehnungenAm(spaeter)).toHaveLength(1)
  })

  it('9b. auch nach drei Wochen Pause bleibt es bei einer', () => {
    const g = geraet()
    g.tag(START)
    const spaeter = addDays(START, 20)
    g.tag(spaeter)
    expect(g.dehnungenAm(spaeter)).toHaveLength(1)
  })

  it('10. heute von Hand eingetragen: die Automatik legt keine zweite an', () => {
    const g = geraet()
    const tag = addDays(START, 3)
    // Erik legt „Dehnung" selbst an, bevor die Automatik für den Tag lief.
    g.zeilen.push({
      id: 'von-hand', title: 'Dehnung', description: null, scheduled_time: null,
      status: 'open', bucket: 'today', scheduled_on: tag, duration_minutes: null,
      priority: 2, template_id: null, sort_order: 0, deleted_at: null,
      carried_count: 0, carried_from: null, pinned_day: 0, scheduled_end_on: null,
    })
    g.tag(tag)
    expect(g.dehnungenAm(tag)).toHaveLength(1)
    expect(g.dehnungenAm(tag)[0].id).toBe('von-hand')
  })

  it('10b. Groß-/Kleinschreibung und Leerzeichen zählen dabei nicht', () => {
    const g = geraet()
    const tag = addDays(START, 3)
    g.zeilen.push({
      id: 'von-hand', title: '  dehnung ', description: null, scheduled_time: null,
      status: 'open', bucket: 'today', scheduled_on: tag, duration_minutes: null,
      priority: 2, template_id: null, sort_order: 0, deleted_at: null,
      carried_count: 0, carried_from: null, pinned_day: 0, scheduled_end_on: null,
    })
    g.tag(tag)
    expect(g.heute(tag)).toHaveLength(1)
  })

  it('11. mehrfaches Öffnen am selben Tag erzeugt keine Dublette', () => {
    const g = geraet()
    g.tag(START)
    for (let i = 0; i < 5; i++) g.nochmalOeffnen(START)
    expect(g.dehnungenAm(START)).toHaveLength(1)
    // Auch der volle Tageslauf darf sich nicht wiederholen.
    g.tag(START).tag(START)
    expect(g.dehnungenAm(START)).toHaveLength(1)
  })

  it('12. zwei Geräte erzeugen dieselbe Zeile, nicht zwei', () => {
    const pc = geraet()
    const handy = geraet()
    pc.tag(START)
    handy.tag(START)
    const idPc = pc.dehnungenAm(START)[0].id
    const idHandy = handy.dehnungenAm(START)[0].id
    expect(idPc).toBe(idHandy)
    expect(idPc).toBe(templateTaskId(DEHNUNG.id, START))

    // Abgleich: Beide Bestände zusammenwerfen – über die ID bleibt es eine.
    const zusammen = new Map<string, any>()
    for (const z of [...pc.zeilen, ...handy.zeilen]) zusammen.set(z.id, z)
    const nachSync = tasksForDay([...zusammen.values()] as any, START, START)
    expect(nachSync.filter((t: any) => t.title === 'Dehnung')).toHaveLength(1)
  })
})

describe('Die beiden Ursachen, einzeln festgehalten', () => {
  it('die Zeile mit der wiederholbaren ID wird nicht mehr weggeräumt', () => {
    // Genau der Vorgang, der jeden Tag einen Grabstein hinterließ.
    const g = geraet()
    g.tag(START)
    const zweiterTag = addDays(START, 1)
    g.tag(zweiterTag)
    const kanonisch = g.byId.get(templateTaskId(DEHNUNG.id, zweiterTag))
    expect(kanonisch).toBeDefined()
    expect(kanonisch.deleted_at).toBe(null)
  })

  it('fällt die getragene Kopie weg, bleibt der Tag nicht leer', () => {
    const g = geraet()
    g.tag(START)
    const zweiterTag = addDays(START, 1)
    g.tag(zweiterTag)
    // Was auch immer die eine sichtbare Aufgabe entfernt – von Hand, über das
    // andere Gerät, durch einen Abgleich: Der Tag muss heilbar bleiben.
    for (const t of g.dehnungenAm(zweiterTag)) t.deleted_at = 'von-hand'
    g.nochmalOeffnen(zweiterTag)
    // Von Hand gelöscht bleibt gelöscht – das ist so gewollt. Entscheidend ist,
    // dass der FOLGETAG davon nicht mehr betroffen ist.
    const dritterTag = addDays(START, 2)
    g.tag(dritterTag)
    expect(g.dehnungenAm(dritterTag)).toHaveLength(1)
  })

  it('nicht abgehakte Tage bleiben als Historie an ihrem Tag stehen', () => {
    const g = geraet()
    g.tag(START)
    const spaeter = addDays(START, 3)
    g.tag(spaeter)
    // Nichts wurde gelöscht – die versäumten Tage sind noch da, sie drängen
    // sich nur nicht alle in den heutigen Plan.
    const alle = g.zeilen.filter((z) => !z.deleted_at && z.title === 'Dehnung')
    expect(alle.length).toBeGreaterThan(20)
    expect(g.dehnungenAm(spaeter)).toHaveLength(1)
  })
})
