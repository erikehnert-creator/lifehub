/**
 * Doppelte Tagesarten – der gemeldete „doppelte Auswahl"-Fehler, an seiner Wurzel.
 *
 * ---------------------------------------------------------------------------
 * Was gemeldet wurde
 *
 * Im Editor einer Aufgabenvorlage standen bei den Tagesarten Einträge doppelt:
 * Frühschicht, Frühschicht, Spätschicht, Spätschicht.
 *
 * ---------------------------------------------------------------------------
 * Was es NICHT ist
 *
 * Eine Vorlage kann gar keine zwei Tagesarten tragen: `task_templates` hat eine
 * einzelne Spalte `day_type_id`, und das Feld ist ein Auswahlmenü mit genau
 * einem Wert. Mengenartig ist die Auswahl also schon per Bauart – es gibt keine
 * Liste, in der sich etwas doppeln könnte.
 *
 * ---------------------------------------------------------------------------
 * Was es ist
 *
 * Doppelt sind die TAGESARTEN SELBST. `day_types` hat keine Eindeutigkeit –
 * weder lokal als UNIQUE noch in `NATUERLICHER_SCHLUESSEL` – und der
 * Beispielbestand legt sie mit gewürfelten IDs an. Wer LifeHub auf einem
 * zweiten Gerät zum ersten Mal öffnet, erzeugt einen zweiten Satz. Das
 * Auswahlmenü listet danach beide.
 *
 * Und das wirkt sich aus, ohne dass irgendwo etwas rot wird: Die Automatik
 * vergleicht die Kennung EXAKT (`vorlageGiltAm`). Hängt die Vorlage am einen
 * Zwilling und der Arbeitsplan am anderen, entstehen aus ihr GAR KEINE
 * Aufgaben mehr. Nicht doppelte also – gar keine.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { planeZusammenfuehrung, type DublettenZeile, type Verweis } from '../src/core/dubletten'
import { reconcileTemplateTasks } from '../src/core/automation'
import type { TaskTemplate } from '../src/core/types'

const ALT = '2026-08-20T10:00:00Z'
const NEU = '2026-09-13T16:00:00Z'

/** Eriks sieben Tagesarten – einmal echt, einmal vom zweiten Gerät. */
const tagesarten: DublettenZeile[] = [
  { id: 'f-alt', name: 'Frühschicht', art: 'work', created_at: ALT },
  { id: 's-alt', name: 'Spätschicht', art: 'work', created_at: ALT },
  { id: 'n-alt', name: 'Nachtschicht', art: 'work', created_at: ALT },
  { id: 'bs-alt', name: 'Berufsschule', art: 'school', created_at: ALT },
  { id: 'u-alt', name: 'Urlaub', art: 'vacation', created_at: ALT },
  { id: 'fr-alt', name: 'Frei', art: 'off', created_at: ALT },
  { id: 'k-alt', name: 'Krank', art: 'sick', created_at: ALT },
  { id: 'f-neu', name: 'Frühschicht', art: 'work', created_at: NEU },
  { id: 's-neu', name: 'Spätschicht', art: 'work', created_at: NEU },
  { id: 'n-neu', name: 'Nachtschicht', art: 'work', created_at: NEU },
  { id: 'bs-neu', name: 'Berufsschule', art: 'school', created_at: NEU },
  { id: 'u-neu', name: 'Urlaub', art: 'vacation', created_at: NEU },
  { id: 'fr-neu', name: 'Frei', art: 'off', created_at: NEU },
  { id: 'k-neu', name: 'Krank', art: 'sick', created_at: NEU },
]

const verweise: Verweis[] = [
  // Der bemalte Arbeitsplan hängt am alten Satz …
  { tabelle: 'day_assignments', feld: 'day_type_id', zeile: 'a1', ziel: 'f-alt' },
  { tabelle: 'day_assignments', feld: 'day_type_id', zeile: 'a2', ziel: 'f-alt' },
  { tabelle: 'day_assignments', feld: 'day_type_id', zeile: 'a3', ziel: 's-alt' },
  // … die Vorlage aber am neuen. Genau daran geht sie still kaputt.
  { tabelle: 'task_templates', feld: 'day_type_id', zeile: 'tpl-auto', ziel: 'f-neu' },
]

describe('Eriks doppelte Tagesarten', () => {
  const plaene = planeZusammenfuehrung(tagesarten, verweise)

  it('erkennt genau sieben Paare', () => {
    expect(plaene.length).toBe(7)
    for (const p of plaene) expect(p.aufloesen.length).toBe(1)
  })

  it('behält bei Frühschicht die Zeile, an der der Arbeitsplan hängt', () => {
    const f = plaene.find((p) => p.behalten.name === 'Frühschicht')!
    expect(f.behalten.id).toBe('f-alt')
    expect(f.grund).toContain('2')
  })

  it('hängt die Vorlage auf die bleibende Tagesart um', () => {
    const f = plaene.find((p) => p.behalten.name === 'Frühschicht')!
    const tpl = f.umzuege.find((u) => u.tabelle === 'task_templates')
    expect(tpl).toBeTruthy()
    expect(tpl!.zeile).toBe('tpl-auto')
  })

  it('verliert keinen einzigen Verweis', () => {
    const umgehaengt = plaene.flatMap((p) => p.umzuege).map((u) => `${u.tabelle}|${u.zeile}`)
    const aufgeloest = new Set(plaene.flatMap((p) => p.aufloesen).map((z) => z.id))
    const betroffen = verweise.filter((v) => aufgeloest.has(v.ziel)).map((v) => `${v.tabelle}|${v.zeile}`)
    for (const b of betroffen) expect(umgehaengt).toContain(b)
  })

  it('entscheidet auf PC und Handy gleich', () => {
    const andersHerum = planeZusammenfuehrung([...tagesarten].reverse(), verweise)
    const a = plaene.map((p) => p.behalten.id).sort()
    const b = andersHerum.map((p) => p.behalten.id).sort()
    expect(b).toEqual(a)
  })

  it('hält gleichnamige Tagesarten VERSCHIEDENER Art auseinander', () => {
    // "Frei" als Schicht und "Frei" als Urlaubsart waeren zwei Dinge.
    const zeilen: DublettenZeile[] = [
      { id: 'x', name: 'Frei', art: 'off', created_at: ALT },
      { id: 'y', name: 'Frei', art: 'vacation', created_at: ALT },
    ]
    expect(planeZusammenfuehrung(zeilen, [])).toEqual([])
  })

  it('lässt eine einzelne Tagesart in Ruhe', () => {
    const zeilen: DublettenZeile[] = [{ id: 'x', name: 'Frühschicht', art: 'work', created_at: ALT }]
    expect(planeZusammenfuehrung(zeilen, [])).toEqual([])
  })

  it('rührt Tagesarten im Papierkorb nicht an', () => {
    const zeilen: DublettenZeile[] = [
      { id: 'x', name: 'Frühschicht', art: 'work', created_at: ALT },
      { id: 'y', name: 'Frühschicht', art: 'work', created_at: NEU, deleted_at: NEU },
    ]
    expect(planeZusammenfuehrung(zeilen, [])).toEqual([])
  })

  it('kommt auch mit drei gleichen Tagesarten zurecht', () => {
    const zeilen: DublettenZeile[] = [
      { id: 'a', name: 'Frühschicht', art: 'work', created_at: ALT },
      { id: 'b', name: 'Frühschicht', art: 'work', created_at: NEU },
      { id: 'c', name: 'Frühschicht', art: 'work', created_at: NEU },
    ]
    const p = planeZusammenfuehrung(zeilen, [])
    expect(p.length).toBe(1)
    expect(p[0].aufloesen.length).toBe(2)
  })
})

/* ------------------------------------------------ Die eigentliche Auswirkung */

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 'test', server_rev: null,
}

const AUTO_PUTZEN: TaskTemplate = {
  ...basis, id: 'tpl-auto', title: 'Auto putzen', description: null,
  duration_minutes: 30, priority: 2,
  weekday: null, day_type_id: 'f-neu', interval_weeks: 1,
  anchor_date: '2026-09-01', is_active: 1, last_generated_on: null, scheduled_time: null,
}

const TAGE = ['2026-09-01', '2026-09-02', '2026-09-03']

describe('Was doppelte Tagesarten anrichten', () => {
  it('die Vorlage greift nicht mehr, wenn sie am anderen Zwilling hängt', () => {
    const plan = reconcileTemplateTasks({
      templates: [AUTO_PUTZEN],
      assignments: TAGE.map((day) => ({ day, day_type_id: 'f-alt' })),
      tasks: [], today: '2026-09-01',
    })
    // Kein Fehler, keine Meldung – es passiert einfach nichts mehr.
    expect(plan.anlegen.length).toBe(0)
  })

  it('nach dem Zusammenführen entstehen die Aufgaben wieder', () => {
    const plaene = planeZusammenfuehrung(tagesarten, verweise)
    const f = plaene.find((p) => p.behalten.name === 'Frühschicht')!
    // Umhängen, wie state/dubletten.ts es tut.
    const repariert: TaskTemplate = { ...AUTO_PUTZEN, day_type_id: f.behalten.id }
    const plan = reconcileTemplateTasks({
      templates: [repariert],
      assignments: TAGE.map((day) => ({ day, day_type_id: f.behalten.id })),
      tasks: [], today: '2026-09-01',
    })
    expect(plan.anlegen.length).toBe(TAGE.length)
  })

  it('erzeugt dabei keine doppelten Aufgaben', () => {
    const plan = reconcileTemplateTasks({
      templates: [{ ...AUTO_PUTZEN, day_type_id: 'f-alt' }],
      assignments: TAGE.map((day) => ({ day, day_type_id: 'f-alt' })),
      tasks: [], today: '2026-09-01',
    })
    const tage = plan.anlegen.map((a) => a.values.scheduled_on)
    expect(tage.length).toBe(TAGE.length)
    expect(new Set(tage).size).toBe(tage.length)
    // Auch die wiederholbaren IDs muessen sich unterscheiden.
    expect(new Set(plan.anlegen.map((a) => a.id)).size).toBe(tage.length)
  })

  it('eine Vorlage ohne Tagesart bleibt von alldem unberührt', () => {
    const plan = reconcileTemplateTasks({
      templates: [{ ...AUTO_PUTZEN, day_type_id: null }],
      assignments: TAGE.map((day) => ({ day, day_type_id: 'f-alt' })),
      tasks: [], today: '2026-09-01',
    })
    expect(plan.anlegen.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------- Vorbeugung */

describe('Damit es nicht wieder passiert', () => {
  it('der Beispielbestand leitet die Tagesart-ID aus dem Kürzel ab', () => {
    const seed = fs.readFileSync(path.join(__dirname, '../src/db/seed.ts'), 'utf8')
    const stelle = seed.slice(seed.indexOf('dayTypes.forEach'))
    expect(stelle).toContain("stableId('day_types', code)")
  })

  it('beide Verweisquellen sind im Dublettensucher eingetragen', () => {
    // Wird hier eine vergessen, zeigt sie nach dem Zusammenfuehren auf eine
    // Tagesart im Papierkorb.
    const src = fs.readFileSync(path.join(__dirname, '../src/state/dubletten.ts'), 'utf8')
    const stelle = src.slice(src.indexOf('function tagesartVerweise'))
    expect(stelle).toContain("nimm('day_assignments', 'day_type_id')")
    expect(stelle).toContain("nimm('task_templates', 'day_type_id')")
  })

  it('jede Spalte, die auf eine Tagesart zeigt, ist erfasst', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.ts'), 'utf8')
    const src = fs.readFileSync(path.join(__dirname, '../src/state/dubletten.ts'), 'utf8')
    const stelle = src.slice(src.indexOf('function tagesartVerweise'), src.indexOf('Was gerade doppelt'))
    // Alle Tabellen im Schema mit einer Spalte day_type_id
    const tabellen = new Set<string>()
    for (const m of schema.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n    \);/g)) {
      if (m[2].includes('day_type_id')) tabellen.add(m[1])
    }
    expect(tabellen.size).toBeGreaterThan(0)
    for (const t of tabellen) expect(stelle).toContain(`nimm('${t}', 'day_type_id')`)
  })
})
