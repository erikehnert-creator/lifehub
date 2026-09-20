/**
 * Trefferbild, Statusvorschlag und das Speichern einer Einheit.
 *
 * Zwei Dinge stehen hier im Mittelpunkt, weil sie sonst still schiefgehen:
 *
 *   1. Ein Vorschlag darf nie zu einer Behauptung werden. Unterhalb der
 *      Mindestzahl gibt es KEINEN Vorschlag – nicht einen vorsichtigen.
 *   2. Dieselbe Einheit zweimal speichern darf keine zweite Zeile erzeugen
 *      und auch keine leere Änderung über den Abgleich schieben.
 */
import { describe, it, expect } from 'vitest'
import {
  trefferbild, statusVorschlag, vorschlagAbweichend, SCHWELLEN,
} from '../src/core/turnen/sicherheit'
import {
  versuchId, versucheGesamt, istLeer, planeVersuche, planIstLeer, GUETEN,
} from '../src/core/turnen/versuche'
import type { GymAttempt } from '../src/core/types'

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null as string | null, version: 1, last_device_id: 't', server_rev: null,
}

const blk = (id: string, session: string, element: string,
  c: number, s = 0, f = 0, help = 0, note: string | null = null, sort = 0): GymAttempt => ({
  ...basis, id, session_id: session, element_id: element,
  clean: c, shaky: s, failed: f, with_help: help, note, sort_order: sort,
} as GymAttempt)

/* --------------------------------------------------------- Trefferbild */

describe('Das Trefferbild', () => {
  it('zählt zusammen und rechnet die Quote', () => {
    const b = trefferbild([blk('1', 's', 'e', 8, 1, 1)])
    expect(b.versuche).toBe(10)
    expect(b.clean).toBe(8)
    expect(b.quote).toBeCloseTo(0.8)
  })

  it('addiert über mehrere Blöcke', () => {
    const b = trefferbild([blk('1', 's1', 'e', 5), blk('2', 's2', 'e', 3, 2)])
    expect(b.versuche).toBe(10)
    expect(b.clean).toBe(8)
  })

  it('übergeht gelöschte Blöcke', () => {
    const weg = { ...blk('1', 's', 'e', 99), deleted_at: '2026-09-19T10:00:00Z' }
    const b = trefferbild([weg, blk('2', 's', 'e', 5)])
    expect(b.versuche).toBe(5)
  })

  it('ergibt ohne Versuche keine Quote – und keine Null', () => {
    // Null Prozent hiesse "nie gelungen". Keine Quote heisst "nicht gemessen".
    const b = trefferbild([])
    expect(b.versuche).toBe(0)
    expect(b.quote).toBeNull()
  })

  it('zählt Hilfestellung je Block, nicht je Versuch', () => {
    const b = trefferbild([blk('1', 's1', 'e', 5, 0, 0, 1), blk('2', 's2', 'e', 5)])
    expect(b.mitHilfe).toBe(1)
  })
})

/* ------------------------------------------------------ Statusvorschlag */

describe('Der Statusvorschlag', () => {
  const bild = (c: number, s = 0, f = 0, hilfe = 0) =>
    trefferbild([blk('1', 'x', 'e', c, s, f, hilfe)])

  it('schweigt unterhalb der Mindestzahl', () => {
    const v = statusVorschlag(bild(9))
    expect(v.status).toBeNull()
    expect(v.grund).toContain(String(SCHWELLEN.mindestVersuche))
  })

  it('schweigt auch bei gar keinen Versuchen', () => {
    expect(statusVorschlag(trefferbild([])).status).toBeNull()
  })

  it('schlägt „sicher" erst ohne Sturz und ohne Hilfe vor', () => {
    expect(statusVorschlag(bild(10)).status).toBe('sicher')
    // Derselbe Anteil, aber ein Sturz dabei:
    expect(statusVorschlag(bild(18, 0, 2)).status).toBe('unsicher')
  })

  it('deckelt bei Hilfestellung auf höchstens „unsicher"', () => {
    // Zehnmal gelungen, aber mit Hilfe - das ist nicht "sicher".
    const v = statusVorschlag(bild(10, 0, 0, 1))
    expect(v.status).toBe('unsicher')
    expect(v.grund).toContain('Hilfestellung')
  })

  it('schlägt „aufbau" vor, wenn es selten gelingt', () => {
    expect(statusVorschlag(bild(4, 3, 3)).status).toBe('aufbau')
  })

  it('schlägt niemals „wettkampfreif" oder „neu" vor', () => {
    const faelle = [bild(10), bild(20), bild(5, 5), bild(1, 1, 18), bild(15, 0, 0, 1)]
    for (const f of faelle) {
      const s = statusVorschlag(f).status
      expect(s).not.toBe('wettkampfreif')
      expect(s).not.toBe('neu')
    }
  })

  it('nennt immer einen Grund', () => {
    for (const f of [bild(3), bild(10), bild(5, 5), bild(10, 0, 0, 1)]) {
      expect(statusVorschlag(f).grund.length).toBeGreaterThan(5)
    }
  })

  it('genau an der Mindestzahl greift er', () => {
    expect(statusVorschlag(bild(SCHWELLEN.mindestVersuche)).status).not.toBeNull()
  })

  it('zeigt sich nur, wenn er vom gesetzten Status abweicht', () => {
    const v = statusVorschlag(bild(10))         // 'sicher'
    expect(vorschlagAbweichend('sicher', v)).toBe(false)
    expect(vorschlagAbweichend('neu', v)).toBe(true)
    // Ohne Vorschlag gibt es nichts zu zeigen.
    expect(vorschlagAbweichend('neu', statusVorschlag(bild(2)))).toBe(false)
  })

  it('die Schwellen stehen an einer Stelle und sind nachvollziehbar', () => {
    expect(SCHWELLEN.sicher).toBeGreaterThan(SCHWELLEN.unsicher)
    expect(SCHWELLEN.mindestVersuche).toBeGreaterThan(0)
    expect(SCHWELLEN.fensterTage).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------ Versuche */

describe('Versuchszeilen', () => {
  it('rechnen die Gesamtzahl, statt sie zu speichern', () => {
    expect(versucheGesamt({ clean: 3, shaky: 2, failed: 1 })).toBe(6)
    expect(istLeer({ clean: 0, shaky: 0, failed: 0 })).toBe(true)
    expect(istLeer({ clean: 0, shaky: 1, failed: 0 })).toBe(false)
  })

  it('haben drei Güten in fester Reihenfolge', () => {
    expect(GUETEN.map((g) => g.key)).toEqual(['clean', 'shaky', 'failed'])
  })

  it('bekommen dieselbe ID auf jedem Gerät', () => {
    expect(versuchId('s1', 'e1')).toBe(versuchId('s1', 'e1'))
  })

  it('und verschiedene IDs für verschiedene Paare', () => {
    expect(versuchId('s1', 'e1')).not.toBe(versuchId('s1', 'e2'))
    expect(versuchId('s1', 'e1')).not.toBe(versuchId('s2', 'e1'))
  })
})

/* ------------------------------------------------- Speichern der Einheit */

describe('Eine Einheit speichern', () => {
  const stand = (elementId: string, c: number, s = 0, f = 0, withHelp = false, note?: string) =>
    ({ elementId, clean: c, shaky: s, failed: f, withHelp, note })

  it('legt neue Blöcke mit abgeleiteter ID an', () => {
    const plan = planeVersuche('s1', [stand('e1', 5, 1)], [])
    expect(plan.anlegen.length).toBe(1)
    expect(plan.anlegen[0].id).toBe(versuchId('s1', 'e1'))
    expect(plan.anlegen[0].values.clean).toBe(5)
    expect(plan.anlegen[0].values.session_id).toBe('s1')
  })

  it('legt für ein Element OHNE Versuche gar nichts an', () => {
    const plan = planeVersuche('s1', [stand('e1', 0)], [])
    expect(planIstLeer(plan)).toBe(true)
  })

  it('ZWEIMAL dasselbe speichern ändert nichts', () => {
    // Der wichtigste Fall: keine Dublette, keine leere Aenderung, kein
    // Abgleich fuer nichts.
    const vorhanden = [blk(versuchId('s1', 'e1'), 's1', 'e1', 5, 1, 0, 0, null, 0)]
    const plan = planeVersuche('s1', [stand('e1', 5, 1)], vorhanden)
    expect(planIstLeer(plan)).toBe(true)
  })

  it('ändert nur die Felder, die sich unterscheiden', () => {
    const vorhanden = [blk(versuchId('s1', 'e1'), 's1', 'e1', 5, 1, 0, 0, null, 0)]
    const plan = planeVersuche('s1', [stand('e1', 7, 1)], vorhanden)
    expect(plan.anlegen.length).toBe(0)
    expect(plan.aendern.length).toBe(1)
    expect(plan.aendern[0].patch).toEqual({ clean: 7 })
  })

  it('entfernt einen Block, der auf null zurückgezählt wurde', () => {
    const vorhanden = [blk(versuchId('s1', 'e1'), 's1', 'e1', 5)]
    const plan = planeVersuche('s1', [stand('e1', 0)], vorhanden)
    expect(plan.entfernen).toEqual([versuchId('s1', 'e1')])
    expect(plan.anlegen.length).toBe(0)
  })

  it('entfernt einen Block, der ganz aus der Liste genommen wurde', () => {
    const vorhanden = [blk(versuchId('s1', 'e1'), 's1', 'e1', 5)]
    const plan = planeVersuche('s1', [], vorhanden)
    expect(plan.entfernen).toEqual([versuchId('s1', 'e1')])
  })

  it('fasst Blöcke anderer Einheiten nicht an', () => {
    const vorhanden = [blk(versuchId('s2', 'e1'), 's2', 'e1', 5)]
    const plan = planeVersuche('s1', [], vorhanden)
    expect(planIstLeer(plan)).toBe(true)
  })

  it('übergeht bereits gelöschte Blöcke und legt neu an', () => {
    const weg = { ...blk(versuchId('s1', 'e1'), 's1', 'e1', 5), deleted_at: '2026-09-19T10:00:00Z' }
    const plan = planeVersuche('s1', [stand('e1', 3)], [weg])
    expect(plan.anlegen.length).toBe(1)
    expect(plan.entfernen.length).toBe(0)
  })

  it('merkt sich die Reihenfolge der Elemente', () => {
    const plan = planeVersuche('s1', [stand('e1', 1), stand('e2', 1)], [])
    expect(plan.anlegen[0].values.sort_order).toBe(0)
    expect(plan.anlegen[1].values.sort_order).toBe(1)
  })

  it('schreibt die Hilfestellung als Kennzeichen', () => {
    const plan = planeVersuche('s1', [stand('e1', 3, 0, 0, true)], [])
    expect(plan.anlegen[0].values.with_help).toBe(1)
  })

  it('macht aus einer leeren Notiz null', () => {
    const plan = planeVersuche('s1', [stand('e1', 3, 0, 0, false, '   ')], [])
    expect(plan.anlegen[0].values.note).toBeNull()
  })

  it('kommt mit vielen Elementen zurecht und bleibt danach ruhig', () => {
    const staende = Array.from({ length: 30 }, (_, i) => stand(`e${i}`, i + 1))
    const plan = planeVersuche('s1', staende, [])
    expect(plan.anlegen.length).toBe(30)

    // Nach dem Schreiben findet ein zweiter Lauf nichts mehr.
    const geschrieben = plan.anlegen.map((a, i) =>
      blk(a.id, 's1', a.values.element_id, a.values.clean, 0, 0, 0, null, i))
    expect(planIstLeer(planeVersuche('s1', staende, geschrieben))).toBe(true)
  })
})
