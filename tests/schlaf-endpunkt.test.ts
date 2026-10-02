/**
 * Der Schlafendpunkt, von der Anfrage bis in die Tabelle.
 *
 * ---------------------------------------------------------------------------
 * Was hier geprüft wird – und warum es das vorher nicht gab
 *
 * `schlaf.test.ts` rechnet die Aggregation nach, `schlaf-kurzbefehl.test.ts`
 * die Formen, die ein iOS-Kurzbefehl erzeugt, `schlaf-e2e.mjs` den Weg vom
 * Server in die Oberfläche. Dazwischen lag ein blinder Fleck: die
 * Verarbeitung der Anfrage selbst – Autorisierung, Rumpf, Schreibentscheidung,
 * Rückgabe. Sie stand in `index.ts` und lief nur auf Deno, war also von keiner
 * Prüfung erreichbar. Genau dort sassen zwei Fehler (siehe `verarbeite.ts`).
 *
 * Die Datenbank ist hier ein kleiner PostgREST-Nachbau im Arbeitsspeicher: Er
 * versteht die Abfragen, die die Funktion wirklich stellt, und sonst nichts.
 * Alle Daten sind erfunden; ein echtes Token kommt nirgends vor.
 */
import { describe, it, expect } from 'vitest'
import { verarbeiteAnfrage, schreibeNacht, type Datenbank } from '../supabase/functions/schlaf/verarbeite'
import { tokenAbdruck } from '../supabase/functions/_shared/importToken'
import { idAusSchluessel } from '../supabase/functions/_shared/stabileId'

const NUTZER = '11111111-1111-1111-1111-111111111111'
/** Erfunden, aber in der Form eines echten Tokens (base64url, 43 Zeichen). */
const TOKEN = 'ZGllc2VzVG9rZW5Jc3RFcmZ1bmRlbl9udXJGdWVyVGVzdA'

/* ------------------------------------------------- Ein winziger PostgREST */

interface Zeile { [k: string]: any }

function nachbau(opts: { tokenWiderrufen?: boolean; tokenFehlt?: boolean; schreibfehler?: string } = {}) {
  const tabellen: Record<string, Zeile[]> = { import_tokens: [], sleep_sessions: [] }
  const aufrufe: string[] = []

  const anlegen = async () => {
    if (opts.tokenFehlt) return
    tabellen.import_tokens.push({
      id: 'tok-1', user_id: NUTZER, label: 'iPhone',
      token_hash: await tokenAbdruck(TOKEN), scope: 'schlaf',
      last_used_at: null, revoked_at: opts.tokenWiderrufen ? '2026-09-01T00:00:00Z' : null,
      deleted_at: null,
    })
  }

  /** Nur die Bedingungen, die die Funktion wirklich benutzt: eq und is.null. */
  const passt = (zeile: Zeile, bedingungen: [string, string][]) =>
    bedingungen.every(([feld, ausdruck]) => {
      if (ausdruck === 'is.null') return zeile[feld] === null || zeile[feld] === undefined
      if (ausdruck.startsWith('eq.')) return String(zeile[feld]) === decodeURIComponent(ausdruck.slice(3))
      return true
    })

  const db: Datenbank = async (pfad, init) => {
    aufrufe.push(`${init?.method ?? 'GET'} ${pfad}`)
    const [name, abfrage = ''] = pfad.split('?')
    const tabelle = tabellen[name] ?? (tabellen[name] = [])
    const bedingungen: [string, string][] = []
    for (const teil of abfrage.split('&')) {
      if (!teil) continue
      const [k, ...rest] = teil.split('=')
      const v = rest.join('=')
      if (['select', 'limit', 'order'].includes(k)) continue
      bedingungen.push([k, v])
    }
    const treffer = tabelle.filter((z) => passt(z, bedingungen))

    if (!init?.method || init.method === 'GET') {
      return treffer.map((z) => ({ ...z }))
    }
    if (init.method === 'PATCH') {
      if (opts.schreibfehler && name === 'sleep_sessions') throw new Error(opts.schreibfehler)
      const patch = JSON.parse(String(init.body))
      for (const z of treffer) Object.assign(z, patch)
      return treffer.map((z) => ({ ...z }))
    }
    if (init.method === 'POST') {
      if (opts.schreibfehler && name === 'sleep_sessions') throw new Error(opts.schreibfehler)
      const neu = JSON.parse(String(init.body))
      for (const z of (Array.isArray(neu) ? neu : [neu])) {
        if (tabelle.some((x) => x.id === z.id)) {
          throw new Error('Datenbank 409: duplicate key value violates unique constraint')
        }
        tabelle.push({ deleted_at: null, note: null, ...z })
      }
      return neu
    }
    throw new Error(`nicht nachgebaut: ${init.method}`)
  }

  return { db, tabellen, aufrufe, anlegen }
}

let uhr = 0
const jetzt = () => `2026-09-30T08:00:${String(uhr++ % 60).padStart(2, '0')}.000Z`

async function anfragen(n: ReturnType<typeof nachbau>, rumpf: string, opts: {
  methode?: string
  auth?: string
} = {}) {
  return verarbeiteAnfrage(
    {
      methode: opts.methode ?? 'POST',
      authorization: opts.auth ?? `Bearer ${TOKEN}`,
      rumpf: async () => rumpf,
    },
    { db: n.db, jetzt },
  )
}

/* ------------------------------------------------------------ Testdaten */

/** Eine Nacht in der Zeilenform, die der Kurzbefehl wirklich schickt. */
function nacht(tag: string, opts: { von?: string; bis?: string; deutsch?: boolean } = {}) {
  const vortag = new Date(Date.parse(`${tag}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const von = opts.von ?? `${vortag}T23:00:00+02:00`
  const bis = opts.bis ?? `${tag}T07:00:00+02:00`
  const kern = opts.deutsch ? 'Kernschlaf' : 'AsleepCore'
  const bett = opts.deutsch ? 'Im Bett' : 'InBed'
  return [
    `${von}|${bis}|${kern}|Sleep Cycle`,
    `${von}|${bis}|${bett}|Sleep Cycle`,
  ].join('\n')
}

/* ================================================================ Prüfungen */

describe('Autorisierung', () => {
  it('ohne Token: 401, und die Tabelle bleibt unberührt', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, nacht('2026-09-29'), { auth: '' })
    expect(a.status).toBe(401)
    expect(n.tabellen.sleep_sessions).toHaveLength(0)
  })

  it('unbekanntes Token: 401 – und dieselbe Antwort wie ohne Token', async () => {
    const n = nachbau({ tokenFehlt: true }); await n.anlegen()
    const a = await anfragen(n, nacht('2026-09-29'))
    expect(a.status).toBe(401)
    expect(a.rumpf).toEqual({ fehler: 'Zugang ungueltig' })
  })

  it('widerrufenes Token: 401', async () => {
    const n = nachbau({ tokenWiderrufen: true }); await n.anlegen()
    expect((await anfragen(n, nacht('2026-09-29'))).status).toBe(401)
  })

  it('GET statt POST: 405, ohne dass der Rumpf gelesen wird', async () => {
    const n = nachbau(); await n.anlegen()
    let gelesen = false
    const a = await verarbeiteAnfrage(
      { methode: 'GET', authorization: `Bearer ${TOKEN}`, rumpf: async () => { gelesen = true; return '' } },
      { db: n.db, jetzt },
    )
    expect(a.status).toBe(405)
    expect(gelesen).toBe(false)
  })

  it('das Token taucht in keiner Antwort auf', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, nacht('2026-09-29'))
    expect(JSON.stringify(a.rumpf)).not.toContain(TOKEN)
  })

  it('ein gelungener Import vermerkt „zuletzt benutzt"', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29'))
    expect(n.tabellen.import_tokens[0].last_used_at).toBeTruthy()
  })
})

describe('Der gewöhnliche Fall', () => {
  it('ein gültiger Datensatz landet als Nacht in der Tabelle', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, nacht('2026-09-29'))
    expect(a.status).toBe(200)
    expect(a.rumpf).toMatchObject({ naechte: 1, neu: 1, geaendert: 0, unveraendert: 0 })
    expect(a.rumpf.tage).toEqual(['2026-09-29'])
    const [zeile] = n.tabellen.sleep_sessions
    expect(zeile.day).toBe('2026-09-29')
    expect(zeile.duration_min).toBe(480)
    expect(zeile.id).toBe(idAusSchluessel('sleep_sessions', '2026-09-29'))
  })

  it('mehrere Nächte auf einmal', async () => {
    const n = nachbau(); await n.anlegen()
    const rumpf = ['2026-09-27', '2026-09-28', '2026-09-29'].map((t) => nacht(t)).join('\n')
    const a = await anfragen(n, rumpf)
    expect(a.rumpf).toMatchObject({ naechte: 3, neu: 3 })
    expect(n.tabellen.sleep_sessions).toHaveLength(3)
  })

  it('derselbe Import zweimal: keine zweite Zeile, keine neue Version', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29'))
    const version = n.tabellen.sleep_sessions[0].version
    const a = await anfragen(n, nacht('2026-09-29'))
    expect(a.rumpf).toMatchObject({ naechte: 1, neu: 0, geaendert: 0, unveraendert: 1 })
    expect(n.tabellen.sleep_sessions).toHaveLength(1)
    expect(n.tabellen.sleep_sessions[0].version).toBe(version)
  })

  it('überlappende Importzeiträume ergeben keine Dubletten', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, ['2026-09-27', '2026-09-28'].map((t) => nacht(t)).join('\n'))
    await anfragen(n, ['2026-09-28', '2026-09-29'].map((t) => nacht(t)).join('\n'))
    expect(n.tabellen.sleep_sessions.map((z) => z.day).sort())
      .toEqual(['2026-09-27', '2026-09-28', '2026-09-29'])
  })

  it('ein nachträglich korrigierter Wert wird übernommen', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29'))
    await anfragen(n, nacht('2026-09-29', { bis: '2026-09-29T08:00:00+02:00' }))
    expect(n.tabellen.sleep_sessions).toHaveLength(1)
    expect(n.tabellen.sleep_sessions[0].duration_min).toBe(540)
  })

  it('eine von Hand geschriebene Notiz überlebt den Import', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29'))
    n.tabellen.sleep_sessions[0].note = 'unruhig'
    await anfragen(n, nacht('2026-09-29', { bis: '2026-09-29T08:00:00+02:00' }))
    expect(n.tabellen.sleep_sessions[0].note).toBe('unruhig')
  })

  it('ein deutsches iPhone liefert dieselbe Nacht', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, nacht('2026-09-29', { deutsch: true }))
    expect(a.rumpf).toMatchObject({ naechte: 1, neu: 1 })
    expect(n.tabellen.sleep_sessions[0].duration_min).toBe(480)
  })
})

describe('Schlaf über Mitternacht, Tagesgrenze und Zeitumstellung', () => {
  it('die Nacht zählt zum Morgen des Aufwachens', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29'))   // 28. 23:00 bis 29. 07:00
    expect(n.tabellen.sleep_sessions[0].day).toBe('2026-09-29')
  })

  it('kurz nach Mitternacht eingeschlafen – der Tag bleibt der Aufwachtag', async () => {
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29', { von: '2026-09-29T00:30:00+02:00' }))
    expect(n.tabellen.sleep_sessions[0].day).toBe('2026-09-29')
  })

  it('Sommerzeitende: die 25-Stunden-Nacht wird richtig gerechnet', async () => {
    // In der Nacht zum 25.10.2026 wird die Uhr von 3:00 auf 2:00 zurückgestellt.
    // Von 23:00+02:00 bis 07:00+01:00 sind das NEUN Stunden, nicht acht.
    const n = nachbau(); await n.anlegen()
    await anfragen(n, [
      '2026-10-24T23:00:00+02:00|2026-10-25T07:00:00+01:00|AsleepCore|Sleep Cycle',
    ].join('\n'))
    expect(n.tabellen.sleep_sessions[0].day).toBe('2026-10-25')
    expect(n.tabellen.sleep_sessions[0].duration_min).toBe(540)
  })

  it('Sommerzeitbeginn: die 23-Stunden-Nacht ebenso', async () => {
    // In der Nacht zum 29.03.2026 geht es von 2:00 auf 3:00 vor.
    const n = nachbau(); await n.anlegen()
    await anfragen(n, [
      '2026-03-28T23:00:00+01:00|2026-03-29T07:00:00+02:00|AsleepCore|Sleep Cycle',
    ].join('\n'))
    expect(n.tabellen.sleep_sessions[0].day).toBe('2026-03-29')
    expect(n.tabellen.sleep_sessions[0].duration_min).toBe(420)
  })
})

describe('Was zurückgewiesen wird – und was nur gezählt', () => {
  it('ein leerer Rumpf: 400', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, '')
    expect(a.status).toBe(400)
    expect(n.tabellen.sleep_sessions).toHaveLength(0)
  })

  it('ein völlig unbrauchbarer Rumpf: 400 mit Begründung', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, 'völliger Unfug ohne Trennzeichen')
    expect(a.status).toBe(400)
    expect(String(a.rumpf.fehler)).toContain('Zeile 1')
  })

  it('EINE kaputte Probe kippt die Sendung nicht mehr', async () => {
    // Der Kern der Änderung vom 30.09.2026: Der Kurzbefehl schickt drei Tage
    // Apple Health. Eine einzige Probe mit leerem Feld „Wert" liess vorher
    // drei Tage lang nichts ankommen.
    const n = nachbau(); await n.anlegen()
    const rumpf = [
      nacht('2026-09-29'),
      '2026-09-29T12:00:00+02:00|2026-09-29T12:30:00+02:00||Sleep Cycle', // Wert leer
      'völliger unfug',
    ].join('\n')
    const a = await anfragen(n, rumpf)
    expect(a.status).toBe(200)
    expect(a.rumpf).toMatchObject({ empfangen: 4, angenommen: 2, zurueckgewiesen: 2, naechte: 1, neu: 1 })
    expect(a.rumpf.gruende).toHaveLength(2)
    expect(n.tabellen.sleep_sessions[0].duration_min).toBe(480)
  })

  it('sind ALLE Werte leer, ist es ein Fehler und kein stilles 200', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, [
      '2026-09-28T23:00:00+02:00|2026-09-29T07:00:00+02:00||Sleep Cycle',
      '2026-09-29T23:00:00+02:00|2026-09-30T07:00:00+02:00||Sleep Cycle',
    ].join('\n'))
    expect(a.status).toBe(400)
    expect(a.rumpf.zurueckgewiesen).toBe(2)
  })

  it('unbekannte Werte werden gezählt, nicht verschwiegen', async () => {
    const n = nachbau(); await n.anlegen()
    const a = await anfragen(n, [
      '2026-09-28T23:00:00+02:00|2026-09-29T07:00:00+02:00|Sonnenschein|Sleep Cycle',
    ].join('\n'))
    expect(a.status).toBe(200)
    expect(a.rumpf).toMatchObject({ empfangen: 1, angenommen: 1, nicht_deutbar: 1, naechte: 0 })
    expect(String(a.rumpf.hinweis)).toContain('Wert')
  })
})

describe('Der Erfolg muss echt sein', () => {
  it('scheitert das Schreiben, kommt kein 200 zurück', async () => {
    const n = nachbau({ schreibfehler: 'Datenbank 500: kaputt' }); await n.anlegen()
    const a = await anfragen(n, nacht('2026-09-29'))
    expect(a.status).toBe(500)
    expect(a.rumpf.neu).toBe(0)
    expect(a.rumpf.gescheitert).toBe(1)
  })

  it('eine gelöschte Nacht kommt beim erneuten Import zurück', async () => {
    /* Der Fehler, den erst diese Prüfung sichtbar gemacht hat: Die Abfrage
       auf die vorhandene Zeile las `deleted_at` nicht mit. Lag die Nacht im
       Papierkorb und schickte der Kurzbefehl dieselben Werte noch einmal,
       entschied der Vergleich auf „gleich" – es wurde nichts geschrieben, und
       die Antwort meldete `unveraendert: 1`. In LifeHub blieb die Nacht
       unsichtbar, bei jedem Versuch aufs Neue. */
    const n = nachbau(); await n.anlegen()
    await anfragen(n, nacht('2026-09-29'))
    n.tabellen.sleep_sessions[0].deleted_at = '2026-09-29T10:00:00Z'

    const a = await anfragen(n, nacht('2026-09-29'))
    expect(a.rumpf).toMatchObject({ geaendert: 1, unveraendert: 0 })
    expect(n.tabellen.sleep_sessions[0].deleted_at).toBe(null)
  })

  it('eine vorhandene Zeile mit fremder ID wird aktualisiert, nicht verdoppelt', async () => {
    /* Auf dem Server ist nur die ID eindeutig, auf dem Gerät aber `day`.
       Legte die Funktion eine zweite Zeile für denselben Tag an, entschied
       beim Holen `loeseSchluesselkollision()`, welche bleibt – und löschte
       die andere örtlich. Verlor die frisch importierte, war sie ohne jede
       Meldung weg. */
    const n = nachbau(); await n.anlegen()
    n.tabellen.sleep_sessions.push({
      id: 'alte-zufalls-id', user_id: NUTZER, day: '2026-09-29',
      start_at: 'x', end_at: 'y', duration_min: 111, note: 'von Hand',
      version: 3, deleted_at: null,
    })
    const a = await anfragen(n, nacht('2026-09-29'))
    expect(n.tabellen.sleep_sessions).toHaveLength(1)
    expect(n.tabellen.sleep_sessions[0].id).toBe('alte-zufalls-id')
    expect(n.tabellen.sleep_sessions[0].duration_min).toBe(480)
    expect(n.tabellen.sleep_sessions[0].note).toBe('von Hand')
    expect(a.rumpf).toMatchObject({ geaendert: 1 })
  })

  it('schreibeNacht legt unter der abgeleiteten ID an, wenn nichts da ist', async () => {
    const n = nachbau(); await n.anlegen()
    const was = await schreibeNacht(n.db, NUTZER, {
      day: '2026-09-29', start_at: 'a', end_at: 'b', duration_min: 400,
      awake_min: null, in_bed_min: null, core_min: null, deep_min: null, rem_min: null,
      source: 'Sleep Cycle',
    }, jetzt)
    expect(was).toBe('neu')
    expect(n.tabellen.sleep_sessions[0].id).toBe(idAusSchluessel('sleep_sessions', '2026-09-29'))
  })
})
