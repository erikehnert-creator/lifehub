/**
 * Doppelte Konten zusammenführen – nachgestellt mit Eriks echtem Fall.
 *
 * Am 13.09.2026 standen auf der Kontenseite acht Konten statt vier: Girokonto,
 * Bargeld, Tagesgeld und GIVE-Card jeweils zweimal. Entstanden, weil die
 * Webfassung beim ersten Öffnen ihren Beispielbestand angelegt und auf den
 * Server geladen hatte, wo schon Eriks echte Konten lagen.
 *
 * Die Falle dabei: Die Dublette ist nicht immer die leere. An der ZWEITEN
 * GIVE-Card hingen 48,37 €, am ursprünglichen Konto nichts. Wer „die neuen
 * einfach löscht", löscht dort die Buchungen mit.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ersetzeKontoImTemplate, planeZusammenfuehrung,
  type DublettenZeile, type Verweis,
} from '../src/core/dubletten'

/* ------------------------------------------------- Eriks Fall, nachgestellt */

const ALT = '2026-08-20T10:00:00Z'
const NEU = '2026-09-13T16:00:00Z'

const konten: DublettenZeile[] = [
  // Eriks echte Konten – mit Anfangsbestand, wo es einen gab.
  { id: 'giro-alt', name: 'Girokonto', art: 'giro', created_at: ALT, opening_balance_cents: 142551 },
  { id: 'bar-alt', name: 'Bargeld', art: 'bargeld', created_at: ALT, opening_balance_cents: 0 },
  { id: 'tages-alt', name: 'Tagesgeld', art: 'spar', created_at: ALT, opening_balance_cents: 1239220 },
  { id: 'give-alt', name: 'GIVE-Card', art: 'sonstiges', created_at: ALT, opening_balance_cents: 0 },
  // Der Beispielbestand der Webfassung – alles bei 0.
  { id: 'giro-neu', name: 'Girokonto', art: 'giro', created_at: NEU, opening_balance_cents: 0 },
  { id: 'bar-neu', name: 'Bargeld', art: 'bargeld', created_at: NEU, opening_balance_cents: 0 },
  { id: 'tages-neu', name: 'Tagesgeld', art: 'spar', created_at: NEU, opening_balance_cents: 0 },
  { id: 'give-neu', name: 'GIVE-Card', art: 'sonstiges', created_at: NEU, opening_balance_cents: 0 },
]

const verweise: Verweis[] = [
  // Buchungen auf den echten Konten
  { tabelle: 'transactions', feld: 'account_id', zeile: 't1', ziel: 'giro-alt' },
  { tabelle: 'transactions', feld: 'account_id', zeile: 't2', ziel: 'bar-alt' },
  { tabelle: 'transactions', feld: 'account_id', zeile: 't3', ziel: 'tages-alt' },
  // … und die 48,37 €, die ausgerechnet am NEUEN GIVE-Card-Konto hängen
  { tabelle: 'transactions', feld: 'account_id', zeile: 't4', ziel: 'give-neu' },
  { tabelle: 'transactions', feld: 'account_id', zeile: 't5', ziel: 'give-neu' },
]

describe('Eriks acht Konten', () => {
  const plaene = planeZusammenfuehrung(konten, verweise)

  it('erkennt genau vier Paare', () => {
    expect(plaene.length).toBe(4)
    for (const p of plaene) expect(p.aufloesen.length).toBe(1)
  })

  it('behält bei Girokonto und Tagesgeld das Konto mit Anfangsbestand', () => {
    const giro = plaene.find((p) => p.behalten.name === 'Girokonto')!
    expect(giro.behalten.id).toBe('giro-alt')
    expect(giro.grund).toBe('hat einen Anfangsbestand')

    const tages = plaene.find((p) => p.behalten.name === 'Tagesgeld')!
    expect(tages.behalten.id).toBe('tages-alt')
  })

  it('behält bei GIVE-Card das NEUE Konto – dort hängen die Buchungen', () => {
    // Der Fall, der beim blinden „neue löschen" 48,37 € gekostet hätte.
    const give = plaene.find((p) => p.behalten.name === 'GIVE-Card')!
    expect(give.behalten.id).toBe('give-neu')
    expect(give.grund).toBe('daran hängen 2 Einträge')
    expect(give.aufloesen.map((z) => z.id)).toEqual(['give-alt'])
  })

  it('behält bei Bargeld das Konto mit der Buchung', () => {
    const bar = plaene.find((p) => p.behalten.name === 'Bargeld')!
    expect(bar.behalten.id).toBe('bar-alt')
  })

  it('hängt jede Buchung der aufgelösten Konten um', () => {
    // Nichts darf auf ein Konto zeigen, das gleich im Papierkorb landet.
    const umgehaengt = plaene.flatMap((p) => p.umzuege.map((v) => v.zeile))
    const aufgeloest = new Set(plaene.flatMap((p) => p.aufloesen.map((z) => z.id)))
    for (const v of verweise) {
      if (aufgeloest.has(v.ziel)) expect(umgehaengt).toContain(v.zeile)
    }
  })

  it('verliert keinen einzigen Verweis', () => {
    // Die Summe aus „bleibt, wo es ist" und „wird umgehängt" muss stimmen.
    const aufgeloest = new Set(plaene.flatMap((p) => p.aufloesen.map((z) => z.id)))
    const bleibt = verweise.filter((v) => !aufgeloest.has(v.ziel)).length
    const zieht = plaene.reduce((n, p) => n + p.umzuege.length, 0)
    expect(bleibt + zieht).toBe(verweise.length)
  })
})

/* ------------------------------------------------------------ Grenzfälle */

describe('Wann NICHT zusammengeführt wird', () => {
  it('lässt einzelne Konten in Ruhe', () => {
    expect(planeZusammenfuehrung(
      [{ id: 'a', name: 'Girokonto', art: 'giro' }], [],
    )).toEqual([])
  })

  it('hält gleichnamige Konten verschiedener Art auseinander', () => {
    // „Sparen" als Konto und „Sparen" als Kategorie wäre dasselbe Wort, aber
    // nicht dieselbe Sache. Auch zwei Konten „Rücklage" – eines Giro, eines
    // Spar – sind zwei verschiedene Konten.
    const plaene = planeZusammenfuehrung([
      { id: 'a', name: 'Rücklage', art: 'giro' },
      { id: 'b', name: 'Rücklage', art: 'spar' },
    ], [])
    expect(plaene).toEqual([])
  })

  it('übersieht Unterschiede in Schreibweise und Leerzeichen nicht', () => {
    const plaene = planeZusammenfuehrung([
      { id: 'a', name: 'Bargeld', art: 'bargeld', created_at: ALT },
      { id: 'b', name: ' bargeld ', art: 'Bargeld', created_at: NEU },
    ], [])
    expect(plaene.length).toBe(1)
    expect(plaene[0].behalten.id).toBe('a')
  })

  it('rührt Zeilen im Papierkorb nicht an', () => {
    // Was gelöscht ist, ist keine Dublette – es zurückzuholen wäre das
    // Gegenteil von Aufräumen.
    const plaene = planeZusammenfuehrung([
      { id: 'a', name: 'Girokonto', art: 'giro' },
      { id: 'b', name: 'Girokonto', art: 'giro', deleted_at: '2026-09-01T00:00:00Z' },
    ], [])
    expect(plaene).toEqual([])
  })

  it('entscheidet auf zwei Geräten gleich', () => {
    // Ohne festes letztes Kriterium könnten PC und Handy verschiedene
    // Überlebende wählen und gegeneinander arbeiten.
    const a: DublettenZeile[] = [
      { id: 'zzz', name: 'Konto', art: 'giro' },
      { id: 'aaa', name: 'Konto', art: 'giro' },
    ]
    const p1 = planeZusammenfuehrung(a, [])
    const p2 = planeZusammenfuehrung([...a].reverse(), [])
    expect(p1[0].behalten.id).toBe('aaa')
    expect(p2[0].behalten.id).toBe('aaa')
  })

  it('kommt mit drei gleichen Konten zurecht', () => {
    const plaene = planeZusammenfuehrung([
      { id: 'a', name: 'Bargeld', art: 'bargeld', created_at: ALT },
      { id: 'b', name: 'Bargeld', art: 'bargeld', created_at: NEU },
      { id: 'c', name: 'Bargeld', art: 'bargeld', created_at: NEU },
    ], [])
    expect(plaene.length).toBe(1)
    expect(plaene[0].aufloesen.length).toBe(2)
  })
})

/* ----------------------------------------- Kontokennung in der Zahlungsvorlage */

describe('Wiederkehrende Zahlungen', () => {
  it('bekommen die neue Kontokennung auch im JSON', () => {
    const vorher = JSON.stringify({ type: 'expense', account_id: 'alt', amount_cents: 2000 })
    const nachher = ersetzeKontoImTemplate(vorher, 'alt', 'neu')
    expect(JSON.parse(nachher).account_id).toBe('neu')
    expect(JSON.parse(nachher).amount_cents).toBe(2000)
  })

  it('auch beim Zielkonto einer Umbuchung', () => {
    const vorher = JSON.stringify({ account_id: 'x', to_account_id: 'alt' })
    expect(JSON.parse(ersetzeKontoImTemplate(vorher, 'alt', 'neu')).to_account_id).toBe('neu')
  })

  it('bleiben unverändert, wenn das Konto gar nicht vorkommt', () => {
    const vorher = JSON.stringify({ account_id: 'x' })
    expect(ersetzeKontoImTemplate(vorher, 'alt', 'neu')).toBe(vorher)
  })

  it('überstehen kaputtes JSON, statt die Vorlage zu zerstören', () => {
    // Lieber eine Vorlage, die noch auf das alte Konto zeigt, als eine
    // zerschossene – die erste kann man sehen und richten.
    expect(ersetzeKontoImTemplate('{kaputt', 'alt', 'neu')).toBe('{kaputt')
    expect(ersetzeKontoImTemplate('', 'alt', 'neu')).toBe('')
  })
})

/* ----------------------------------------------- Vollständigkeit der Liste */

describe('Keine Tabelle vergessen', () => {
  it('sammelt jede Spalte ein, die auf ein Konto zeigt', () => {
    // Der gefährlichste Fehler wäre eine vergessene Tabelle: Sie zeigt nach dem
    // Zusammenführen auf ein Konto im Papierkorb, ohne dass jemand etwas merkt.
    // Deshalb wird das Schema gefragt, nicht das Gedächtnis.
    const schema = fs.readFileSync(path.join(__dirname, '..', 'src/db/schema.ts'), 'utf8')
    const sammler = fs.readFileSync(path.join(__dirname, '..', 'src/state/dubletten.ts'), 'utf8')

    const imSchema = new Set(
      [...schema.matchAll(/^\s*(\w*account_id)\s+TEXT/gmi)].map((m) => m[1].toLowerCase()),
    )
    expect(imSchema.size).toBeGreaterThan(0)
    for (const feld of imSchema) {
      expect(sammler.toLowerCase(), `${feld} wird in state/dubletten.ts nicht eingesammelt`)
        .toContain(feld)
    }
  })

  it('denkt auch an die Kontokennung im template_json', () => {
    const sammler = fs.readFileSync(path.join(__dirname, '..', 'src/state/dubletten.ts'), 'utf8')
    expect(sammler).toContain('template_json')
  })
})
