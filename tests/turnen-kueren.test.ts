/**
 * Küren: Reihenfolge, Schwierigkeitssumme, Problemstellen, Wettkampfkür.
 *
 * Vier Dinge stehen hier im Mittelpunkt, weil sie sonst still schiefgehen:
 *
 *   1. Die Schwierigkeitssumme darf nie vollständig AUSSEHEN, wenn sie es
 *      nicht ist. Ein fehlender Wert wird gezählt, nicht als 0 verrechnet.
 *   2. Je Gerät gilt höchstens EINE Wettkampfkür – auch dann, wenn zwei Geräte
 *      offline je eine markiert haben. Das ist der eigentliche Prüfgegenstand.
 *   3. Ein gelöschtes Element darf eine Kür nicht zerstören. Der Platz bleibt.
 *   4. Zweimal dasselbe speichern darf keine Zeile anfassen.
 */
import { describe, it, expect } from 'vitest'
import {
  kuerElemente, verschiebe, schwierigkeit, schwierigkeitText,
  problemstellen, problemZusammenfassung, KUER_SCHWELLEN,
  wettkampfKuer, wettkampfKuerJeGeraet, istWettkampfKuer, zuLoeschendeZeitpunkte,
  planeKuerElemente, planIstLeer, sortiereKueren, kuerBild,
} from '../src/core/turnen/kueren'
import type { ElementBild } from '../src/core/turnen/elemente'
import type { GymElement, GymRoutine, GymRoutineElement } from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 't', server_rev: null,
}

const el = (id: string, name: string, opt: Partial<GymElement> = {}): GymElement => ({
  ...basis, id, apparatus: 'boden', name,
  difficulty_letter: null, difficulty_value: null, element_group: null,
  is_dismount: 0, hold_element: 0, status: 'sicher', video_url: null, note: null,
  is_active: 1, sort_order: 0, ...opt,
} as GymElement)

const verk = (id: string, routine: string, element: string,
  position: number, opt: Partial<GymRoutineElement> = {}): GymRoutineElement => ({
  ...basis, id, routine_id: routine, element_id: element, position, note: null, ...opt,
} as GymRoutineElement)

const kuer = (id: string, name: string, opt: Partial<GymRoutine> = {}): GymRoutine => ({
  ...basis, id, apparatus: 'boden', name, note: null,
  competition_since: null, is_active: 1, ...opt,
} as GymRoutine)

/** Ein Elementbild, reduziert auf das, was die Problemstellen brauchen. */
const bild = (element: GymElement, tageHer: number | null): ElementBild => ({
  element, zuletzt: null, tageHer, einheiten: 0, versucheGesamt: 0,
  fenster: { versuche: 0, clean: 0, shaky: 0, failed: 0, mitHilfe: 0, quote: null },
  vorschlag: { status: null, grund: '' },
} as unknown as ElementBild)

const bilderVon = (...paare: [GymElement, number | null][]) =>
  new Map(paare.map(([e, t]) => [e.id, bild(e, t)]))

/* ==================================================== Reihenfolge */

describe('Reihenfolge einer Kür', () => {
  const a = el('e1', 'Rondat')
  const b = el('e2', 'Flick-Flack')
  const c = el('e3', 'Doppelsalto')

  it('ordnet nach position', () => {
    const v = [verk('v3', 'k1', 'e3', 2), verk('v1', 'k1', 'e1', 0), verk('v2', 'k1', 'e2', 1)]
    const liste = kuerElemente('k1', v, [a, b, c])
    expect(liste.map((x) => x.element?.name)).toEqual(['Rondat', 'Flick-Flack', 'Doppelsalto'])
    expect(liste.map((x) => x.platz)).toEqual([1, 2, 3])
  })

  it('nimmt nur die Einträge dieser Kür', () => {
    const v = [verk('v1', 'k1', 'e1', 0), verk('v2', 'k2', 'e2', 0)]
    expect(kuerElemente('k1', v, [a, b])).toHaveLength(1)
  })

  it('übergeht gelöschte Verknüpfungen', () => {
    const v = [verk('v1', 'k1', 'e1', 0), verk('v2', 'k1', 'e2', 1, { deleted_at: '2026-02-01T00:00:00Z' })]
    expect(kuerElemente('k1', v, [a, b])).toHaveLength(1)
  })

  it('erlaubt dasselbe Element mehrfach', () => {
    const v = [verk('v1', 'k1', 'e1', 0), verk('v2', 'k1', 'e1', 1)]
    const liste = kuerElemente('k1', v, [a])
    expect(liste).toHaveLength(2)
    expect(liste.map((x) => x.element?.name)).toEqual(['Rondat', 'Rondat'])
  })

  it('bricht Gleichstand fest auf – beide Geräte sehen dieselbe Folge', () => {
    // Zwei Geraete haben offline je ein Element an Platz 1 ergaenzt.
    const pc = verk('v-b', 'k1', 'e2', 1, { created_at: '2026-03-01T10:00:00Z' })
    const handy = verk('v-a', 'k1', 'e3', 1, { created_at: '2026-03-01T09:00:00Z' })
    const links = kuerElemente('k1', [pc, handy], [b, c]).map((x) => x.eintrag.id)
    const rechts = kuerElemente('k1', [handy, pc], [b, c]).map((x) => x.eintrag.id)
    expect(links).toEqual(rechts)
    // Das aeltere created_at zuerst.
    expect(links).toEqual(['v-a', 'v-b'])
  })
})

describe('verschiebe', () => {
  it('tauscht mit dem Nachbarn', () => {
    expect(verschiebe(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(verschiebe(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('lässt die Liste am Rand unverändert', () => {
    const l = ['a', 'b', 'c']
    expect(verschiebe(l, 0, -1)).toBe(l)
    expect(verschiebe(l, 2, 1)).toBe(l)
    expect(verschiebe(l, 9, 1)).toBe(l)
  })
})

/* ================================================== Schwierigkeit */

describe('Schwierigkeitssumme der Elemente', () => {
  const mitWert = (id: string, wert: number | null, buchstabe: string | null = null) =>
    el(id, id, { difficulty_value: wert, difficulty_letter: buchstabe })

  const eintraege = (...elemente: GymElement[]) =>
    kuerElemente('k1', elemente.map((e, i) => verk(`v${i}`, 'k1', e.id, i)), elemente)

  it('summiert die eingetragenen Werte', () => {
    const s = schwierigkeit(eintraege(mitWert('a', 0.1), mitWert('b', 0.2), mitWert('c', 0.3)))
    expect(s.summe).toBe(0.6)
    expect(s.elemente).toBe(3)
    expect(s.mitWert).toBe(3)
    expect(s.vollstaendig).toBe(true)
  })

  it('rechnet Gleitkomma sauber ab – kein 0,30000000000000004', () => {
    expect(schwierigkeit(eintraege(mitWert('a', 0.1), mitWert('b', 0.2))).summe).toBe(0.3)
  })

  it('täuscht bei fehlendem Wert keine 0 vor, sondern zählt die Lücke', () => {
    const s = schwierigkeit(eintraege(mitWert('a', 0.3), mitWert('b', null), mitWert('c', 0.2)))
    expect(s.summe).toBe(0.5)
    expect(s.mitWert).toBe(2)
    expect(s.ohneWert).toBe(1)
    expect(s.vollstaendig).toBe(false)
    expect(schwierigkeitText(s)).toBe('0,5 (1 von 3 ohne Wert)')
  })

  it('sagt es, wenn kein einziger Wert eingetragen ist', () => {
    const s = schwierigkeit(eintraege(mitWert('a', null), mitWert('b', null)))
    expect(s.summe).toBe(0)
    expect(s.mitWert).toBe(0)
    expect(schwierigkeitText(s)).toBe('kein Wert bei 2 Elementen')
  })

  it('gilt bei einer leeren Kür nicht als vollständig', () => {
    const s = schwierigkeit([])
    expect(s.vollstaendig).toBe(false)
    expect(schwierigkeitText(s)).toBe('keine Elemente')
  })

  it('zählt die Schwierigkeitsbuchstaben, A vor B', () => {
    const s = schwierigkeit(eintraege(
      mitWert('a', 0.2, 'B'), mitWert('b', 0.1, 'A'), mitWert('c', 0.2, 'B'),
    ))
    expect(s.buchstaben).toEqual([
      { buchstabe: 'A', anzahl: 1 },
      { buchstabe: 'B', anzahl: 2 },
    ])
  })

  it('zählt ein gelöschtes Element als Platz ohne Wert', () => {
    const da = mitWert('a', 0.3)
    // Das zweite Element steckt in der Kuer, ist aber nicht mehr im Katalog.
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0), verk('v1', 'k1', 'weg', 1)], [da])
    const s = schwierigkeit(liste)
    expect(s.elemente).toBe(2)
    expect(s.summe).toBe(0.3)
    expect(s.ohneWert).toBe(1)
    expect(s.vollstaendig).toBe(false)
  })
})

/* =================================================== Problemstellen */

describe('Problemstellen – nur beschreibend', () => {
  it('nennt ein gelöschtes Element, ohne den Platz zu verlieren', () => {
    const da = el('a', 'Rondat')
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0), verk('v1', 'k1', 'weg', 1)], [da])
    expect(liste).toHaveLength(2)
    expect(liste[1].element).toBeNull()

    const stellen = problemstellen(liste, bilderVon([da, 0]))
    expect(stellen).toEqual([{ platz: 2, art: 'geloescht', text: 'Element gelöscht' }])
    expect(problemZusammenfassung(stellen)).toEqual(['1 gelöschtes Element'])
  })

  it('meldet unsichere Elemente und solche im Aufbau', () => {
    const u1 = el('u1', 'A', { status: 'unsicher' })
    const u2 = el('u2', 'B', { status: 'unsicher' })
    const au = el('au', 'C', { status: 'aufbau' })
    const liste = kuerElemente('k1',
      [verk('v0', 'k1', 'u1', 0), verk('v1', 'k1', 'u2', 1), verk('v2', 'k1', 'au', 2)],
      [u1, u2, au])
    const stellen = problemstellen(liste, bilderVon([u1, 0], [u2, 0], [au, 0]))
    expect(problemZusammenfassung(stellen)).toEqual(['2 unsichere Elemente', '1 Element im Aufbau'])
  })

  it('meldet, wie lange ein sicheres Element nicht dran war', () => {
    const e = el('a', 'Rondat', { status: 'sicher' })
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0)], [e])
    const stellen = problemstellen(liste, bilderVon([e, 34]))
    expect(stellen[0]).toMatchObject({ art: 'langeHer', tageHer: 34 })
    expect(problemZusammenfassung(stellen)).toEqual(['1 Element seit 34 Tagen nicht trainiert'])
  })

  it('schweigt knapp unterhalb der Schwelle', () => {
    const e = el('a', 'Rondat', { status: 'sicher' })
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0)], [e])
    expect(problemstellen(liste, bilderVon([e, KUER_SCHWELLEN.langeHerTage - 1]))).toEqual([])
    expect(problemstellen(liste, bilderVon([e, KUER_SCHWELLEN.langeHerTage]))).toHaveLength(1)
  })

  it('nennt ein nie trainiertes Element als solches', () => {
    const e = el('a', 'Rondat', { status: 'sicher' })
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0)], [e])
    const stellen = problemstellen(liste, bilderVon([e, null]))
    expect(stellen[0].art).toBe('nieTrainiert')
  })

  it('gibt je Platz höchstens einen Hinweis – den dringlicheren', () => {
    const e = el('a', 'Rondat', { status: 'unsicher' })
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0)], [e])
    const stellen = problemstellen(liste, bilderVon([e, 90]))
    expect(stellen).toHaveLength(1)
    expect(stellen[0].art).toBe('unsicher')
  })

  it('sagt bei mehreren Liegezeiten die längste', () => {
    const a = el('a', 'A', { status: 'sicher' })
    const b = el('b', 'B', { status: 'sicher' })
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0), verk('v1', 'k1', 'b', 1)], [a, b])
    const stellen = problemstellen(liste, bilderVon([a, 30], [b, 47]))
    expect(problemZusammenfassung(stellen)).toEqual(
      ['2 Elemente lange nicht trainiert (längstens 47 Tage)'])
  })

  it('schweigt über eine Kür aus lauter sicheren, frischen Elementen', () => {
    const e = el('a', 'Rondat', { status: 'wettkampfreif' })
    const liste = kuerElemente('k1', [verk('v0', 'k1', 'a', 0)], [e])
    expect(problemZusammenfassung(problemstellen(liste, bilderVon([e, 2])))).toEqual([])
  })
})

/* ================================================= Aktive Wettkampfkür */

describe('aktive Wettkampfkür', () => {
  it('ist keine, solange keine markiert wurde', () => {
    const a = kuer('a', 'Wettkampfkür')
    const b = kuer('b', 'Trainingsvariante')
    expect(wettkampfKuer([a, b], 'boden')).toBeNull()
  })

  it('ist die einzige markierte', () => {
    const a = kuer('a', 'A', { competition_since: '2026-03-01T10:00:00Z' })
    const b = kuer('b', 'B')
    expect(wettkampfKuer([a, b], 'boden')?.id).toBe('a')
  })

  it('wechselt zur jüngeren Markierung – die ältere deaktiviert sich von selbst', () => {
    const a = kuer('a', 'A', { competition_since: '2026-03-01T10:00:00Z' })
    const b = kuer('b', 'B', { competition_since: '2026-04-01T10:00:00Z' })
    expect(wettkampfKuer([a, b], 'boden')?.id).toBe('b')
    expect(istWettkampfKuer([a, b], a)).toBe(false)
    expect(istWettkampfKuer([a, b], b)).toBe(true)
  })

  it('hält je Gerät genau eine – auch wenn zwei Geräte offline je eine markiert haben', () => {
    // Der PC markiert B, das Handy markiert C. Beide Zeilen erreichen den
    // Server, beide tragen einen Zeitpunkt. Nach dem Abgleich muss trotzdem
    // GENAU EINE gelten, und zwar auf beiden Geraeten dieselbe.
    const a = kuer('a', 'A', { competition_since: '2026-03-01T10:00:00Z' })
    const b = kuer('b', 'B', { competition_since: '2026-04-01T08:00:00Z' })
    const c = kuer('c', 'C', { competition_since: '2026-04-01T09:00:00Z' })

    const aufDemPc = wettkampfKuer([a, b, c], 'boden')
    const aufDemHandy = wettkampfKuer([c, a, b], 'boden')
    expect(aufDemPc?.id).toBe('c')
    expect(aufDemHandy?.id).toBe('c')

    const aktive = [a, b, c].filter((k) => istWettkampfKuer([a, b, c], k))
    expect(aktive).toHaveLength(1)
  })

  it('entscheidet einen Gleichstand fest über die ID', () => {
    const gleich = '2026-04-01T09:00:00Z'
    const b = kuer('b', 'B', { competition_since: gleich })
    const a = kuer('a', 'A', { competition_since: gleich })
    expect(wettkampfKuer([b, a], 'boden')?.id).toBe('a')
    expect(wettkampfKuer([a, b], 'boden')?.id).toBe('a')
  })

  it('hält die Geräte auseinander – Boden und Barren dürfen gleichzeitig aktiv sein', () => {
    const boden = kuer('a', 'Boden', { competition_since: '2026-04-01T09:00:00Z' })
    const barren = kuer('b', 'Barren', { apparatus: 'barren', competition_since: '2026-04-02T09:00:00Z' })
    const je = wettkampfKuerJeGeraet([boden, barren])
    expect(je.get('boden')?.id).toBe('a')
    expect(je.get('barren')?.id).toBe('b')
    expect(je.size).toBe(2)
  })

  it('zählt archivierte und gelöschte Küren nicht mit', () => {
    const archiv = kuer('a', 'A', { competition_since: '2026-05-01T10:00:00Z', is_active: 0 })
    const weg = kuer('w', 'W', { competition_since: '2026-06-01T10:00:00Z', deleted_at: '2026-06-02T00:00:00Z' })
    const gilt = kuer('b', 'B', { competition_since: '2026-04-01T10:00:00Z' })
    expect(wettkampfKuer([archiv, weg, gilt], 'boden')?.id).toBe('b')
  })

  it('braucht zum Aufheben alle Zeitpunkte des Geräts, nicht nur den aktiven', () => {
    // Nur den juengsten zu loeschen liesse die naechstaeltere nachruecken -
    // "keine Wettkampfkuer" waere dann nicht ausdrueckbar.
    const a = kuer('a', 'A', { competition_since: '2026-03-01T10:00:00Z' })
    const b = kuer('b', 'B', { competition_since: '2026-04-01T10:00:00Z' })
    const c = kuer('c', 'C')
    const barren = kuer('d', 'D', { apparatus: 'barren', competition_since: '2026-04-01T10:00:00Z' })

    const ids = zuLoeschendeZeitpunkte([a, b, c, barren], 'boden')
    expect(ids.sort()).toEqual(['a', 'b'])

    // Nach dem Aufheben gilt am Boden keine, am Barren die unveraendert.
    const danach = [
      { ...a, competition_since: null }, { ...b, competition_since: null }, c, barren,
    ]
    expect(wettkampfKuer(danach, 'boden')).toBeNull()
    expect(wettkampfKuer(danach, 'barren')?.id).toBe('d')
  })
})

/* ==================================================== Speichern planen */

describe('planeKuerElemente', () => {
  const vorhanden = [
    verk('v0', 'k1', 'e1', 0),
    verk('v1', 'k1', 'e2', 1),
    verk('v2', 'k1', 'e3', 2),
  ]
  const wieGehabt = vorhanden.map((v) => ({ id: v.id, elementId: v.element_id, note: v.note }))

  it('tut nichts, wenn sich nichts geändert hat', () => {
    const plan = planeKuerElemente('k1', wieGehabt, vorhanden)
    expect(planIstLeer(plan)).toBe(true)
  })

  it('legt neue Plätze an und lässt die vorhandenen in Ruhe', () => {
    const plan = planeKuerElemente('k1', [...wieGehabt, { id: null, elementId: 'e4' }], vorhanden)
    expect(plan.anlegen).toHaveLength(1)
    expect(plan.anlegen[0].values).toMatchObject({ routine_id: 'k1', element_id: 'e4', position: 3 })
    expect(plan.aendern).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
  })

  it('schreibt beim Verschieben nur die Plätze, die sich bewegt haben', () => {
    // e3 nach vorn: e3 (2 -> 0), e1 (0 -> 1), e2 (1 -> 2). Alle drei bewegen
    // sich, also drei Aenderungen - aber keine Neuanlage und kein Loeschen.
    const plan = planeKuerElemente('k1', [wieGehabt[2], wieGehabt[0], wieGehabt[1]], vorhanden)
    expect(plan.anlegen).toHaveLength(0)
    expect(plan.entfernen).toHaveLength(0)
    expect(plan.aendern).toEqual([
      { id: 'v2', patch: { position: 0 } },
      { id: 'v0', patch: { position: 1 } },
      { id: 'v1', patch: { position: 2 } },
    ])
  })

  it('rührt beim Tausch der letzten beiden nur diese beiden an', () => {
    const plan = planeKuerElemente('k1', [wieGehabt[0], wieGehabt[2], wieGehabt[1]], vorhanden)
    expect(plan.aendern.map((a) => a.id).sort()).toEqual(['v1', 'v2'])
  })

  it('entfernt Plätze, die aus der Liste genommen wurden – und zieht die Reihenfolge nach', () => {
    const plan = planeKuerElemente('k1', [wieGehabt[0], wieGehabt[2]], vorhanden)
    expect(plan.entfernen).toEqual(['v1'])
    expect(plan.aendern).toEqual([{ id: 'v2', patch: { position: 1 } }])
  })

  it('erzeugt beim zweiten Speichern derselben Liste keine Dublette', () => {
    const erst = planeKuerElemente('k1', [...wieGehabt, { id: null, elementId: 'e4' }], vorhanden)
    expect(erst.anlegen).toHaveLength(1)

    // So, wie es nach dem ersten Speichern in der Datenbank steht.
    const danach = [...vorhanden, verk('v3', 'k1', 'e4', 3)]
    const nochmal = planeKuerElemente('k1',
      danach.map((v) => ({ id: v.id, elementId: v.element_id })), danach)
    expect(planIstLeer(nochmal)).toBe(true)
  })

  it('nimmt eine geänderte Notiz mit, eine gleiche nicht', () => {
    const mitNotiz = [{ ...wieGehabt[0], note: 'sauber anlaufen' }, wieGehabt[1], wieGehabt[2]]
    expect(planeKuerElemente('k1', mitNotiz, vorhanden).aendern)
      .toEqual([{ id: 'v0', patch: { note: 'sauber anlaufen' } }])

    const schonDa = [{ ...vorhanden[0], note: 'sauber anlaufen' }, vorhanden[1], vorhanden[2]]
    expect(planIstLeer(planeKuerElemente('k1', mitNotiz, schonDa))).toBe(true)
  })

  it('behandelt Leerzeichen in einer Notiz wie keine Notiz', () => {
    const leer = [{ ...wieGehabt[0], note: '   ' }, wieGehabt[1], wieGehabt[2]]
    expect(planIstLeer(planeKuerElemente('k1', leer, vorhanden))).toBe(true)
  })

  it('erlaubt dasselbe Element zweimal – es sind zwei Plätze, keine Dublette', () => {
    const plan = planeKuerElemente('k1', [...wieGehabt, { id: null, elementId: 'e1' }], vorhanden)
    expect(plan.anlegen).toHaveLength(1)
    expect(plan.anlegen[0].values.element_id).toBe('e1')
    expect(plan.entfernen).toHaveLength(0)
  })

  it('lässt die Plätze anderer Küren unberührt', () => {
    const fremd = [...vorhanden, verk('x', 'k2', 'e9', 0)]
    expect(planeKuerElemente('k1', wieGehabt, fremd).entfernen).toEqual([])
  })

  it('leert eine Kür vollständig, wenn alle Plätze entfernt wurden', () => {
    const plan = planeKuerElemente('k1', [], vorhanden)
    expect(plan.entfernen.sort()).toEqual(['v0', 'v1', 'v2'])
  })
})

/* ============================================================ Kürbild */

describe('kuerBild', () => {
  it('trägt Schwierigkeit, Hinweise und Wettkampfmarke zusammen', () => {
    const a = el('a', 'Rondat', { difficulty_value: 0.1, status: 'sicher' })
    const b = el('b', 'Doppelsalto', { difficulty_value: 0.4, status: 'unsicher' })
    const k = kuer('k1', 'Wettkampfkür', { competition_since: '2026-04-01T10:00:00Z' })
    const v = [verk('v0', 'k1', 'a', 0), verk('v1', 'k1', 'b', 1)]

    const bd = kuerBild(k, v, [a, b], bilderVon([a, 1], [b, 1]), wettkampfKuerJeGeraet([k]))
    expect(bd.eintraege).toHaveLength(2)
    expect(bd.schwierigkeit.summe).toBe(0.5)
    expect(bd.schwierigkeit.vollstaendig).toBe(true)
    expect(bd.hinweise).toEqual(['1 unsicheres Element'])
    expect(bd.istWettkampf).toBe(true)
  })

  it('sortiert Wettkampfkür nach vorn und Archiviertes nach hinten', () => {
    const wk = kuer('a', 'Wettkampf', { competition_since: '2026-04-01T10:00:00Z' })
    const var1 = kuer('b', 'Variante')
    const alt = kuer('c', 'Alte Fassung', { is_active: 0 })
    const je = wettkampfKuerJeGeraet([wk, var1, alt])
    const bilder = [alt, var1, wk].map((k) => kuerBild(k, [], [], new Map(), je))

    expect([...bilder].sort(sortiereKueren).map((b) => b.kuer.name))
      .toEqual(['Wettkampf', 'Variante', 'Alte Fassung'])
  })
})
