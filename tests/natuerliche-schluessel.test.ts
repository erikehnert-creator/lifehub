/**
 * Der Ballaststoff-Fehler, an seiner Wurzel geprüft.
 *
 * Die Wurzel ist nicht FatSecret und nicht die Ernährungsseite, sondern eine
 * Eigenschaft des Abgleichs: Vier Tabellen haben neben der ID einen zweiten
 * eindeutigen Wert (`settings.key`, `metrics.key`, `day_assignments.day`,
 * `day_notes.day`). Lokal steht das als UNIQUE im Schema, auf dem Server
 * nicht. Legen zwei Geräte dieselbe Sache unabhängig voneinander an, nimmt der
 * Server beide Zeilen an – und beim Holen löscht `INSERT OR REPLACE` die
 * vorhandene still, um Platz für die fremde zu machen.
 *
 * Was auf die gelöschte Zeile zeigte, zeigt danach ins Leere. Genau so sind
 * Eriks Ballaststoff-Tageswerte unsichtbar geworden: geschrieben, gespeichert,
 * synchronisiert – und auf eine Metrik verweisend, die es nicht mehr gab.
 *
 * Geprüft wird deshalb beides: dass es gar nicht erst zwei Zeilen gibt
 * (abgeleitete IDs), und dass ein trotzdem vorhandener Altfall aufgelöst wird,
 * ohne dass etwas verlorengeht.
 */
import { describe, expect, it } from 'vitest'
import {
  NATUERLICHER_SCHLUESSEL, SCHLUESSEL_UMBENENNBAR, VERWEISE_AUF,
  aufgeloesterSchluessel, entscheideKollision, istAufgeloest, natuerlicheId,
} from '../src/core/natuerlicheSchluessel'
import { MIGRATIONS } from '../src/db/schema'

/* ------------------------------------------------------- Abgeleitete IDs */

describe('IDs aus dem natürlichen Schlüssel', () => {
  it('liefern auf jedem Gerät dieselbe ID', () => {
    // Der ganze Zweck: PC und Handy legen „Ballaststoffe" unabhängig
    // voneinander an und meinen trotzdem dieselbe Zeile.
    const pc = natuerlicheId('metrics', { key: 'fiber_g' })
    const handy = natuerlicheId('metrics', { key: 'fiber_g' })
    expect(pc).toBe(handy)
    expect(pc).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('unterscheiden verschiedene Schlüssel', () => {
    expect(natuerlicheId('metrics', { key: 'fiber_g' }))
      .not.toBe(natuerlicheId('metrics', { key: 'sugar_g' }))
  })

  it('unterscheiden gleiche Schlüssel in verschiedenen Tabellen', () => {
    // `settings.key` und `metrics.key` können denselben Text tragen, ohne
    // dass daraus dieselbe Zeile werden darf.
    expect(natuerlicheId('metrics', { key: 'x' }))
      .not.toBe(natuerlicheId('settings', { key: 'x' }))
  })

  it('lassen Tabellen ohne natürlichen Schlüssel in Ruhe', () => {
    expect(natuerlicheId('transactions', { key: 'egal' })).toBeNull()
  })

  it('greifen nicht, wenn der Schlüssel fehlt', () => {
    // Sonst bekämen alle Zeilen ohne Wert dieselbe ID.
    expect(natuerlicheId('day_notes', {})).toBeNull()
    expect(natuerlicheId('day_notes', { day: '' })).toBeNull()
    expect(natuerlicheId('day_notes', { day: null })).toBeNull()
  })
})

/* ------------------------------------------------- Die Liste selbst prüfen */

describe('Die Liste der natürlichen Schlüssel', () => {
  /** Aus dem Schema lesen, welche Spalten dort als eindeutig deklariert sind. */
  function eindeutigeSpaltenAusSchema(): Record<string, string> {
    const sql = MIGRATIONS.map((m) => m.sql).join('\n')
    const out: Record<string, string> = {}

    // Variante 1: `spalte TEXT NOT NULL UNIQUE` innerhalb von CREATE TABLE.
    for (const treffer of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\s*\);/g)) {
      const [, tabelle, rumpf] = treffer
      const spalte = rumpf.match(/(\w+)\s+TEXT[^,]*\bUNIQUE\b/)
      if (spalte) out[tabelle] = spalte[1]
    }
    // Variante 2: CREATE UNIQUE INDEX … ON tabelle(spalte)
    for (const treffer of sql.matchAll(/CREATE UNIQUE INDEX \w+ ON (\w+)\((\w+)\)/g)) {
      out[treffer[1]] = treffer[2]
    }
    return out
  }

  it('kennt jede Spalte, die das Schema als eindeutig führt', () => {
    // Der Test, der die Wiederholung verhindert: Wer künftig eine weitere
    // UNIQUE-Spalte anlegt, ohne sie hier einzutragen, baut denselben Fehler
    // noch einmal – nur an einer anderen Tabelle.
    const ausSchema = eindeutigeSpaltenAusSchema()
    const fehlend = Object.entries(ausSchema)
      .filter(([tabelle]) => !NATUERLICHER_SCHLUESSEL[tabelle])
      .map(([tabelle, spalte]) => `${tabelle}.${spalte}`)
    expect(
      fehlend,
      'Diese Spalten sind lokal eindeutig, auf dem Server aber nicht. Ohne '
      + 'Eintrag in NATUERLICHER_SCHLUESSEL löscht der Abgleich dort still '
      + 'Zeilen:\n  ' + fehlend.join('\n  '),
    ).toEqual([])
  })

  it('erfindet keine Tabelle, die es nicht gibt', () => {
    const ausSchema = eindeutigeSpaltenAusSchema()
    for (const [tabelle, spalte] of Object.entries(NATUERLICHER_SCHLUESSEL)) {
      expect(ausSchema[tabelle], `${tabelle} steht in der Liste`).toBe(spalte)
    }
  })

  it('sagt zu jeder Tabelle, ob ihr Schlüssel umbenannt werden darf', () => {
    for (const tabelle of Object.keys(NATUERLICHER_SCHLUESSEL)) {
      expect(typeof SCHLUESSEL_UMBENENNBAR[tabelle], tabelle).toBe('boolean')
    }
  })

  it('benennt keinen Schlüssel um, in dem echter Inhalt steht', () => {
    // In `day` steht ein Datum. Wer das verbiegt, um eine Dublette
    // wegzuräumen, verliert die Zuordnung zum Tag.
    expect(SCHLUESSEL_UMBENENNBAR.day_notes).toBe(false)
    expect(SCHLUESSEL_UMBENENNBAR.day_assignments).toBe(false)
  })

  it('kennt zu jeder Tabelle die Verweise auf sie', () => {
    for (const tabelle of Object.keys(NATUERLICHER_SCHLUESSEL)) {
      expect(Array.isArray(VERWEISE_AUF[tabelle]), tabelle).toBe(true)
    }
  })

  it('führt für metrics beide Verweistabellen', () => {
    // Genau hier ist der Schaden entstanden: Die Tageswerte zeigten auf eine
    // Metrik, die beim Abgleich verschwand. Fehlt metric_entries in dieser
    // Liste, passiert das wieder.
    const felder = VERWEISE_AUF.metrics.map((v) => `${v.tabelle}.${v.feld}`).sort()
    expect(felder).toEqual(['metric_entries.metric_id', 'metric_targets.metric_id'])
  })
})

/* ------------------------------------------------------ Die Entscheidung */

describe('Wenn zwei Zeilen denselben Schlüssel tragen', () => {
  it('entscheiden beide Geräte gleich', () => {
    // Die eigentliche Anforderung. Eine Regel, die auf zwei Geräten
    // verschieden ausfällt, führt dazu, dass sich die Geräte die Zeile
    // gegenseitig hin- und herschieben, statt sie aufzulösen.
    const ausSichtA = entscheideKollision('aaa', 'bbb')
    const ausSichtB = entscheideKollision('bbb', 'aaa')
    expect(ausSichtA).toEqual(ausSichtB)
    expect(ausSichtA.bleibt).toBe('aaa')
    expect(ausSichtA.weicht).toBe('bbb')
  })

  it('markiert die aufgelöste Zeile erkennbar', () => {
    const neu = aufgeloesterSchluessel('fiber_g', 'abcdef01-2345-6789-abcd-ef0123456789')
    expect(neu).not.toBe('fiber_g')
    expect(istAufgeloest(neu)).toBe(true)
    expect(istAufgeloest('fiber_g')).toBe(false)
  })

  it('vergibt für zwei aufgelöste Zeilen verschiedene Schlüssel', () => {
    // Sonst liefe das Aufräumen selbst in die UNIQUE-Bedingung.
    expect(aufgeloesterSchluessel('fiber_g', 'aaaaaaaa-1111'))
      .not.toBe(aufgeloesterSchluessel('fiber_g', 'bbbbbbbb-2222'))
  })
})
