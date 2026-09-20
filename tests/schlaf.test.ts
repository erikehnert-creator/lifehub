/**
 * Aus Apple-Health-Proben wird eine Nacht – nachgerechnet.
 *
 * Die Rechnung steht bewusst nicht im iOS-Kurzbefehl, sondern in
 * `supabase/functions/schlaf/aggregat.ts`: Ein Kurzbefehl lässt sich nicht
 * prüfen, dieser Code schon. Geprüft wird vor allem, was still falsch wird –
 * doppelt gezählte Stunden, ein Tag daneben, eine erfundene Phase.
 */
import { describe, it, expect } from 'vitest'
import {
  deute, lokalerTag, vereinige, minuten, baueNacht, baueNaechte,
  teileInNaechte, pruefeRumpf, istZeitpunkt, HOECHSTZAHL_PROBEN,
} from '../supabase/functions/schlaf/aggregat'

const p = (start: string, ende: string, wert: string, quelle?: string) => ({ start, ende, wert, quelle })

/* ------------------------------------------------------------- Deutung */

describe('Die Health-Werte deuten', () => {
  it('erkennt die Schlafphasen in jeder Schreibweise', () => {
    for (const w of ['AsleepCore', 'asleepCore', 'HKCategoryValueSleepAnalysisAsleepCore', 'Core', 'core']) {
      expect(deute(w)).toEqual({ art: 'schlaf', phase: 'core' })
    }
    expect(deute('AsleepDeep')!.phase).toBe('deep')
    expect(deute('AsleepREM')!.phase).toBe('rem')
    expect(deute('asleep rem')!.phase).toBe('rem')
  })

  it('erkennt Schlaf ohne Phasenangabe', () => {
    expect(deute('Asleep')).toEqual({ art: 'schlaf', phase: 'unbekannt' })
    expect(deute('AsleepUnspecified')).toEqual({ art: 'schlaf', phase: 'unbekannt' })
  })

  it('hält „im Bett" und „wach" von „schlafend" getrennt', () => {
    expect(deute('InBed')!.art).toBe('bett')
    expect(deute('In Bed')!.art).toBe('bett')
    expect(deute('Awake')!.art).toBe('wach')
  })

  it('weist zurück, was keine Schlafprobe ist', () => {
    expect(deute('')).toBeNull()
    expect(deute('HeartRate')).toBeNull()
    expect(deute('Unfug')).toBeNull()
  })
})

/* ------------------------------------------------------ Tag und Zeitzone */

describe('Welchem Tag eine Nacht gehört', () => {
  it('nimmt den Morgen des Aufwachens, nicht den Abend', () => {
    const n = baueNacht([p('2026-09-28T23:30:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep')])!
    expect(n.day).toBe('2026-09-29')
  })

  it('liest den Tag aus der Ortszeit, nicht aus UTC', () => {
    // 00:30 Ortszeit am 29. ist 22:30 UTC am 28. – der Tag ist trotzdem der 29.
    expect(lokalerTag('2026-09-29T00:30:00+02:00')).toBe('2026-09-29')
    // Umgekehrt: 23:30 Ortszeit in Neuseeland.
    expect(lokalerTag('2026-09-29T23:30:00+13:00')).toBe('2026-09-29')
  })

  it('nimmt bei Z den UTC-Tag – die Gerätezeitzone ist dann unbekannt', () => {
    expect(lokalerTag('2026-09-28T22:30:00Z')).toBe('2026-09-28')
  })

  it('rechnet über die Umstellung auf Sommerzeit richtig', () => {
    // In der Nacht vom 28. auf den 29. März 2026 wird 02:00 zu 03:00.
    // Von 23:00+01:00 bis 07:00+02:00 sind es SIEBEN Stunden, nicht acht.
    const n = baueNacht([p('2026-03-28T23:00:00+01:00', '2026-03-29T07:00:00+02:00', 'Asleep')])!
    expect(n.duration_min).toBe(7 * 60)
    expect(n.day).toBe('2026-03-29')
  })

  it('rechnet über die Umstellung auf Winterzeit richtig', () => {
    // Am 25.10.2026 wird 03:00 zu 02:00 – neun Stunden statt acht.
    const n = baueNacht([p('2026-10-24T23:00:00+02:00', '2026-10-25T07:00:00+01:00', 'Asleep')])!
    expect(n.duration_min).toBe(9 * 60)
  })

  it('kommt mit einem Gerät in einer anderen Zeitzone zurecht', () => {
    const n = baueNacht([p('2026-09-28T23:00:00-05:00', '2026-09-29T06:30:00-05:00', 'Asleep')])!
    expect(n.duration_min).toBe(450)
    expect(n.day).toBe('2026-09-29')
  })
})

/* ------------------------------------------------------- Nicht doppelt */

describe('Was nicht doppelt gezählt werden darf', () => {
  it('„im Bett" zählt nicht als Schlaf', () => {
    const n = baueNacht([
      p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'InBed'),
      p('2026-09-28T23:20:00+02:00', '2026-09-29T06:50:00+02:00', 'Asleep'),
    ])!
    expect(n.in_bed_min).toBe(480)
    expect(n.duration_min).toBe(450)   // und NICHT 930
  })

  it('zwei Quellen für dieselbe Nacht ergeben eine Nacht', () => {
    // Apple Watch und Sleep Cycle schreiben beide die volle Nacht.
    const n = baueNacht([
      p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep', 'Apple Watch'),
      p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep', 'Sleep Cycle'),
    ])!
    expect(n.duration_min).toBe(480)   // nicht 960
    expect(n.source).toBe('Apple Watch, Sleep Cycle')
  })

  it('überlappende Phasen werden verschmolzen, nicht addiert', () => {
    const n = baueNacht([
      p('2026-09-29T00:00:00+02:00', '2026-09-29T02:00:00+02:00', 'AsleepCore'),
      p('2026-09-29T01:30:00+02:00', '2026-09-29T03:00:00+02:00', 'AsleepCore'),
    ])!
    expect(n.duration_min).toBe(180)   // 00:00–03:00, nicht 210
  })

  it('vereinige fasst zusammen, was sich berührt', () => {
    expect(vereinige([{ von: 0, bis: 10 }, { von: 10, bis: 20 }])).toEqual([{ von: 0, bis: 20 }])
    expect(vereinige([{ von: 0, bis: 10 }, { von: 20, bis: 30 }]).length).toBe(2)
    expect(vereinige([{ von: 5, bis: 5 }])).toEqual([])
  })

  it('minuten rundet auf volle Minuten', () => {
    expect(minuten([{ von: 0, bis: 90 * 1000 }])).toBe(2)
  })
})

/* ------------------------------------------------------------- Phasen */

describe('Schlafphasen', () => {
  const mitPhasen = [
    p('2026-09-28T23:00:00+02:00', '2026-09-29T01:00:00+02:00', 'AsleepCore'),
    p('2026-09-29T01:00:00+02:00', '2026-09-29T02:30:00+02:00', 'AsleepDeep'),
    p('2026-09-29T02:30:00+02:00', '2026-09-29T03:30:00+02:00', 'AsleepREM'),
    p('2026-09-29T03:30:00+02:00', '2026-09-29T07:00:00+02:00', 'AsleepCore'),
  ]

  it('zählt jede Phase für sich', () => {
    const n = baueNacht(mitPhasen)!
    expect(n.core_min).toBe(120 + 210)
    expect(n.deep_min).toBe(90)
    expect(n.rem_min).toBe(60)
  })

  it('die Phasen ergeben zusammen die Schlafdauer', () => {
    const n = baueNacht(mitPhasen)!
    expect(n.core_min! + n.deep_min! + n.rem_min!).toBe(n.duration_min)
  })

  it('ohne Phasen bleiben die Felder LEER statt null Minuten', () => {
    // Eine Quelle, die nur "Asleep" kennt (Sleep Cycle, aeltere Geraete),
    // darf nicht so aussehen, als haette sie null Minuten Tiefschlaf gemessen.
    const n = baueNacht([p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep')])!
    expect(n.core_min).toBeNull()
    expect(n.deep_min).toBeNull()
    expect(n.rem_min).toBeNull()
    expect(n.duration_min).toBe(480)
  })

  it('nächtliches Aufwachen steht getrennt', () => {
    const n = baueNacht([
      p('2026-09-28T23:00:00+02:00', '2026-09-29T02:00:00+02:00', 'AsleepCore'),
      p('2026-09-29T02:00:00+02:00', '2026-09-29T02:20:00+02:00', 'Awake'),
      p('2026-09-29T02:20:00+02:00', '2026-09-29T07:00:00+02:00', 'AsleepCore'),
    ])!
    expect(n.awake_min).toBe(20)
    expect(n.duration_min).toBe(180 + 280)
  })
})

/* ------------------------------------------------- Mehrere Nächte */

describe('Mehrere Nächte in einer Sendung', () => {
  const dreiNaechte = [
    p('2026-09-26T23:00:00+02:00', '2026-09-27T07:00:00+02:00', 'Asleep'),
    p('2026-09-27T23:30:00+02:00', '2026-09-28T06:30:00+02:00', 'Asleep'),
    p('2026-09-28T22:45:00+02:00', '2026-09-29T07:15:00+02:00', 'Asleep'),
  ]

  it('trennt sie an der Lücke dazwischen', () => {
    expect(teileInNaechte(dreiNaechte).length).toBe(3)
    const naechte = baueNaechte(dreiNaechte)
    expect(naechte.map((n) => n.day)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29'])
  })

  it('eine Stunde wach mitten in der Nacht trennt NICHT', () => {
    const n = baueNaechte([
      p('2026-09-28T23:00:00+02:00', '2026-09-29T01:00:00+02:00', 'Asleep'),
      p('2026-09-29T02:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep'),
    ])
    expect(n.length).toBe(1)
    expect(n[0].duration_min).toBe(120 + 300)
  })

  it('beim Mittagsschlaf gewinnt die längere Strecke des Tages', () => {
    const naechte = baueNaechte([
      p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep'),
      p('2026-09-29T14:00:00+02:00', '2026-09-29T14:40:00+02:00', 'Asleep'),
    ])
    expect(naechte.length).toBe(1)
    expect(naechte[0].duration_min).toBe(480)
  })

  it('liefert nichts, wenn nichts Verwertbares dabei ist', () => {
    expect(baueNacht([])).toBeNull()
    expect(baueNacht([p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'HeartRate')])).toBeNull()
    expect(baueNaechte([])).toEqual([])
  })

  it('übergeht eine Probe, die rückwärts läuft', () => {
    const n = baueNacht([
      p('2026-09-29T07:00:00+02:00', '2026-09-28T23:00:00+02:00', 'Asleep'),
      p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep'),
    ])!
    expect(n.duration_min).toBe(480)
  })
})

/* ------------------------------------------------------------ Prüfung */

describe('Was der Endpunkt annimmt', () => {
  const gut = { proben: [p('2026-09-28T23:00:00+02:00', '2026-09-29T07:00:00+02:00', 'Asleep')] }

  it('nimmt eine saubere Sendung an', () => {
    const e = pruefeRumpf(gut)
    expect(e.ok).toBe(true)
    expect(e.proben!.length).toBe(1)
  })

  it('versteht auch englische Feldnamen', () => {
    const e = pruefeRumpf({
      samples: [{ startDate: '2026-09-28T23:00:00+02:00', endDate: '2026-09-29T07:00:00+02:00', value: 'Asleep', source: 'Sleep Cycle' }],
    })
    expect(e.ok).toBe(true)
    expect(e.proben![0].quelle).toBe('Sleep Cycle')
  })

  it('weist alles zurück, was kein Objekt ist', () => {
    for (const x of [null, undefined, 'text', 42, []]) expect(pruefeRumpf(x as any).ok).toBe(false)
  })

  it('weist eine Sendung ohne Proben zurück', () => {
    expect(pruefeRumpf({}).ok).toBe(false)
    expect(pruefeRumpf({ proben: [] }).ok).toBe(false)
  })

  it('weist kaputte Zeitpunkte zurück, statt sie zu übergehen', () => {
    const e = pruefeRumpf({ proben: [{ start: 'gestern abend', ende: '2026-09-29T07:00:00+02:00', wert: 'Asleep' }] })
    expect(e.ok).toBe(false)
    expect(e.fehler).toContain('start')
  })

  it('weist eine Probe ohne Wert zurück', () => {
    const e = pruefeRumpf({ proben: [{ start: '2026-09-28T23:00:00+02:00', ende: '2026-09-29T07:00:00+02:00' }] })
    expect(e.ok).toBe(false)
  })

  it('weist eine Probe zurück, die vor ihrem Beginn endet', () => {
    const e = pruefeRumpf({ proben: [{ start: '2026-09-29T07:00:00+02:00', ende: '2026-09-28T23:00:00+02:00', wert: 'Asleep' }] })
    expect(e.ok).toBe(false)
  })

  it('begrenzt die Menge – der Endpunkt steht im Internet', () => {
    const viele = { proben: Array.from({ length: HOECHSTZAHL_PROBEN + 1 }, () => gut.proben[0]) }
    expect(pruefeRumpf(viele).ok).toBe(false)
  })

  it('kürzt eine übermäßig lange Quellenangabe', () => {
    const e = pruefeRumpf({ proben: [{ ...gut.proben[0], quelle: 'x'.repeat(500) }] })
    expect(e.proben![0].quelle!.length).toBe(120)
  })

  it('istZeitpunkt ist streng', () => {
    expect(istZeitpunkt('2026-09-29T07:00:00+02:00')).toBe(true)
    expect(istZeitpunkt('2026-09-29T07:00Z')).toBe(true)
    expect(istZeitpunkt('2026-13-29T07:00:00+02:00')).toBe(false)
    expect(istZeitpunkt(42)).toBe(false)
    expect(istZeitpunkt(null)).toBe(false)
  })
})
