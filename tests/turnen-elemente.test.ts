/**
 * Was sich aus Versuchen über ein Element sagen lässt.
 *
 * Geprüft wird vor allem, was still falsch würde: ein gelöschtes Training,
 * das weiterzählt; ein „heute trainiert", das als ein Tag her gilt; ein
 * Element, dessen Historie beim Löschen eines anderen Elements kippt.
 */
import { describe, it, expect } from 'vitest'
import {
  bloeckeMitTag, elementBild, geraetBilder, langeNichtTrainiert,
} from '../src/core/turnen/elemente'
import { GERAETE, geraet, geraetName, istGeraet, nachGeraet } from '../src/core/turnen/geraete'
import { BRAUCHT_ARBEIT, ELEMENT_STATUS, istStatus, statusLabel, VORSCHLAGBAR } from '../src/core/turnen/status'
import { diffDays } from '../src/core/dates'
import type { GymAttempt, GymElement } from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 't', server_rev: null,
}

const el = (id: string, apparatus: string, name = id, extra: Partial<GymElement> = {}): GymElement => ({
  ...basis, id, apparatus, name,
  difficulty_letter: null, difficulty_value: null, element_group: null,
  is_dismount: 0, hold_element: 0, status: 'neu', video_url: null, note: null,
  is_active: 1, sort_order: 0, ...extra,
} as GymElement)

const blk = (id: string, session: string, element: string, c: number, s = 0, f = 0, help = 0): GymAttempt => ({
  ...basis, id, session_id: session, element_id: element,
  clean: c, shaky: s, failed: f, with_help: help, note: null, sort_order: 0,
} as GymAttempt)

const HEUTE = '2026-09-20'
const einheit = (id: string, day: string, deleted: string | null = null) => ({ id, day, deleted_at: deleted })

/* ------------------------------------------------------------- Geräte */

describe('Die Geräte', () => {
  it('sind die sechs Herrengeräte in Wettkampfreihenfolge', () => {
    expect(GERAETE.map((g) => g.key)).toEqual([
      'boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck',
    ])
    expect(GERAETE.map((g) => g.reihenfolge)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('haben eindeutige Schlüssel und Kurzformen', () => {
    expect(new Set(GERAETE.map((g) => g.key)).size).toBe(6)
    expect(new Set(GERAETE.map((g) => g.kurz)).size).toBe(6)
  })

  it('lassen sich nachschlagen', () => {
    expect(geraet('ringe')!.name).toBe('Ringe')
    expect(geraet('trampolin')).toBeNull()
    expect(istGeraet('reck')).toBe(true)
    expect(istGeraet('quatsch')).toBe(false)
  })

  it('zeigen einen unbekannten Schlüssel im Klartext statt „Unbekannt"', () => {
    // Stuende in der Datenbank ein fremdes Geraet, will man sehen WELCHES.
    expect(geraetName('trampolin')).toBe('trampolin')
    expect(geraetName(null)).toBe('—')
  })

  it('sortieren nach Wettkampfreihenfolge, Unbekanntes ans Ende', () => {
    const liste = [{ apparatus: 'reck' }, { apparatus: 'boden' }, { apparatus: 'xyz' }, { apparatus: 'ringe' }]
    expect([...liste].sort(nachGeraet).map((x) => x.apparatus))
      .toEqual(['boden', 'ringe', 'reck', 'xyz'])
  })
})

/* -------------------------------------------------------------- Status */

describe('Die Statusstufen', () => {
  it('sind zentral definiert und eindeutig', () => {
    expect(ELEMENT_STATUS.map((s) => s.key))
      .toEqual(['neu', 'aufbau', 'unsicher', 'sicher', 'wettkampfreif'])
    expect(new Set(ELEMENT_STATUS.map((s) => s.reihenfolge)).size).toBe(5)
  })

  it('kennen einen unbekannten Wert nicht', () => {
    expect(istStatus('sicher')).toBe(true)
    expect(istStatus('halbwegs')).toBe(false)
    // Faellt auf die erste Stufe zurueck, statt zu werfen.
    expect(statusLabel('halbwegs')).toBe('Neu')
  })

  it('schlagen wettkampfreif niemals selbst vor', () => {
    expect(VORSCHLAGBAR).not.toContain('wettkampfreif')
    expect(VORSCHLAGBAR).not.toContain('neu')
  })

  it('markieren die Stufen, die Arbeit brauchen', () => {
    expect(BRAUCHT_ARBEIT).toEqual(['neu', 'aufbau', 'unsicher'])
  })
})

/* ------------------------------------------------- Blöcke und Einheiten */

describe('Versuche mit ihrem Trainingstag verbinden', () => {
  it('verbindet über die Einheit', () => {
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 5)],
      [einheit('s1', '2026-09-18')],
    )
    expect(paare.length).toBe(1)
    expect(paare[0].day).toBe('2026-09-18')
  })

  it('übergeht Blöcke einer GELÖSCHTEN Einheit', () => {
    // Sonst zaehlte ein geloeschtes Training weiter mit.
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 5)],
      [einheit('s1', '2026-09-18', '2026-09-19T10:00:00Z')],
    )
    expect(paare).toEqual([])
  })

  it('übergeht gelöschte Blöcke', () => {
    const geloescht = { ...blk('b1', 's1', 'e1', 5), deleted_at: '2026-09-19T10:00:00Z' }
    expect(bloeckeMitTag([geloescht], [einheit('s1', '2026-09-18')])).toEqual([])
  })

  it('übergeht Blöcke ohne Einheit', () => {
    expect(bloeckeMitTag([blk('b1', 'weg', 'e1', 5)], [])).toEqual([])
  })
})

/* -------------------------------------------------------- Elementbild */

describe('Das Bild eines Elements', () => {
  const element = el('e1', 'boden', 'Doppelsalto')

  it('meldet „nie trainiert" sauber', () => {
    const b = elementBild(element, [], HEUTE, diffDays)
    expect(b.zuletzt).toBeNull()
    expect(b.tageHer).toBeNull()
    expect(b.einheiten).toBe(0)
    expect(b.versucheGesamt).toBe(0)
    expect(b.vorschlag.status).toBeNull()
  })

  it('zählt heute trainiert als NULL Tage her', () => {
    const paare = bloeckeMitTag([blk('b1', 's1', 'e1', 3)], [einheit('s1', HEUTE)])
    const b = elementBild(element, paare, HEUTE, diffDays)
    expect(b.tageHer).toBe(0)
    expect(b.zuletzt).toBe(HEUTE)
  })

  it('nimmt den jüngsten Tag, auch bei unsortierter Eingabe', () => {
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 3), blk('b2', 's2', 'e1', 2), blk('b3', 's3', 'e1', 1)],
      [einheit('s1', '2026-09-01'), einheit('s2', '2026-09-18'), einheit('s3', '2026-09-10')],
    )
    const b = elementBild(element, paare, HEUTE, diffDays)
    expect(b.zuletzt).toBe('2026-09-18')
    expect(b.tageHer).toBe(2)
    expect(b.einheiten).toBe(3)
    expect(b.versucheGesamt).toBe(6)
  })

  it('zählt zwei Blöcke am selben Tag als EINE Einheit', () => {
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 3), blk('b2', 's1', 'e1', 2)],
      [einheit('s1', '2026-09-18')],
    )
    expect(elementBild(element, paare, HEUTE, diffDays).einheiten).toBe(1)
  })

  it('rechnet nur Versuche dieses Elements', () => {
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 3), blk('b2', 's1', 'e2', 99)],
      [einheit('s1', '2026-09-18')],
    )
    expect(elementBild(element, paare, HEUTE, diffDays).versucheGesamt).toBe(3)
  })

  it('lässt alte Versuche aus dem Sicherheitsfenster heraus', () => {
    // Vor einem Jahr 20x gelungen sagt ueber heute nichts.
    const paare = bloeckeMitTag([blk('b1', 's1', 'e1', 20)], [einheit('s1', '2025-09-18')])
    const b = elementBild(element, paare, HEUTE, diffDays)
    expect(b.versucheGesamt).toBe(20)      // Historie bleibt
    expect(b.fenster.versuche).toBe(0)     // Bewertung nicht
    expect(b.vorschlag.status).toBeNull()
  })
})

/* ----------------------------------------------------------- Je Gerät */

describe('Das Bild eines Geräts', () => {
  const elemente = [
    el('e1', 'boden', 'Doppelsalto', { status: 'unsicher' }),
    el('e2', 'boden', 'Flick-Flack', { status: 'sicher' }),
    el('e3', 'reck', 'Kippe', { status: 'neu' }),
  ]

  it('zählt Elemente, Versuche und Einheiten je Gerät', () => {
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 4), blk('b2', 's1', 'e2', 6), blk('b3', 's2', 'e3', 5)],
      [einheit('s1', '2026-09-18'), einheit('s2', '2026-09-10')],
    )
    const bilder = geraetBilder(elemente, paare, HEUTE, diffDays, BRAUCHT_ARBEIT)
    const boden = bilder.get('boden')!
    expect(boden.elemente).toBe(2)
    expect(boden.versuche).toBe(10)
    expect(boden.einheiten).toBe(1)
    expect(boden.zuletzt).toBe('2026-09-18')
    expect(boden.tageHer).toBe(2)
    expect(boden.brauchtArbeit).toBe(1)     // nur das unsichere

    const reck = bilder.get('reck')!
    expect(reck.tageHer).toBe(10)
    expect(reck.brauchtArbeit).toBe(1)      // "neu" zaehlt als Arbeit
  })

  it('zeigt ein Gerät ohne Training mit leerer Historie', () => {
    const bilder = geraetBilder(elemente, [], HEUTE, diffDays, BRAUCHT_ARBEIT)
    expect(bilder.get('boden')!.tageHer).toBeNull()
    expect(bilder.get('boden')!.versuche).toBe(0)
    expect(bilder.get('boden')!.elemente).toBe(2)
  })

  it('zählt archivierte Elemente nicht mit', () => {
    const mitArchiv = [...elemente, el('e4', 'boden', 'Alt', { is_active: 0, status: 'unsicher' })]
    const bilder = geraetBilder(mitArchiv, [], HEUTE, diffDays, BRAUCHT_ARBEIT)
    expect(bilder.get('boden')!.elemente).toBe(2)
    expect(bilder.get('boden')!.brauchtArbeit).toBe(1)
  })

  it('beschädigt die Historie nicht, wenn ein Element gelöscht wurde', () => {
    // Der Block zeigt auf ein geloeschtes Element: Das Geraet ist unbekannt,
    // also faellt der Block heraus - aber nichts anderes kippt.
    const geloescht = [
      { ...el('e1', 'boden'), deleted_at: '2026-09-19T10:00:00Z' } as GymElement,
      el('e2', 'boden', 'Flick-Flack'),
    ]
    const paare = bloeckeMitTag(
      [blk('b1', 's1', 'e1', 4), blk('b2', 's1', 'e2', 6)],
      [einheit('s1', '2026-09-18')],
    )
    const bilder = geraetBilder(geloescht, paare, HEUTE, diffDays, BRAUCHT_ARBEIT)
    expect(bilder.get('boden')!.versuche).toBe(6)
    expect(bilder.get('boden')!.elemente).toBe(1)
  })
})

/* ------------------------------------------------- Lange nicht trainiert */

describe('Lange nicht trainiert', () => {
  const mach = (id: string, tage: number | null, name = id) => ({
    element: el(id, 'boden', name), zuletzt: null, tageHer: tage,
    einheiten: 0, versucheGesamt: 0,
    fenster: { versuche: 0, clean: 0, shaky: 0, failed: 0, mitHilfe: 0, quote: null },
    vorschlag: { status: null, grund: '' },
  })

  it('stellt nie trainierte Elemente ganz nach vorn', () => {
    const liste = langeNichtTrainiert([mach('a', 30), mach('b', null), mach('c', 5)] as any)
    expect(liste[0].element.id).toBe('b')
    expect(liste[1].element.id).toBe('a')
  })

  it('sortiert danach nach Liegezeit, absteigend', () => {
    const liste = langeNichtTrainiert([mach('a', 5), mach('b', 40), mach('c', 20)] as any)
    expect(liste.map((x) => x.element.id)).toEqual(['b', 'c', 'a'])
  })

  it('übergeht archivierte Elemente', () => {
    const archiviert = { ...mach('x', 99), element: el('x', 'boden', 'Alt', { is_active: 0 }) }
    const liste = langeNichtTrainiert([archiviert, mach('a', 5)] as any)
    expect(liste.map((x) => x.element.id)).toEqual(['a'])
  })

  it('liefert höchstens so viele wie gewünscht', () => {
    const viele = Array.from({ length: 20 }, (_, i) => mach(`e${i}`, i))
    expect(langeNichtTrainiert(viele as any, 5).length).toBe(5)
    expect(langeNichtTrainiert(viele as any, 3).length).toBe(3)
  })
})
