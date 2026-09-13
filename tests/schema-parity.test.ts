/**
 * Lokales Schema gegen Server-Schema.
 *
 * Der Abgleich schickt jede Spalte einer synchronisierten Tabelle an den
 * Server, die nicht mit `_` beginnt (siehe `stripLocal` in sync/engine.ts).
 * Kennt PostgREST eine davon nicht, scheitert der Abgleich für genau diese
 * Tabelle – bei jedem Versuch aufs Neue, ohne dass in der Oberfläche etwas
 * kaputt aussieht. Genau das ist hier schon zweimal passiert, einmal bei
 * `calendar_events`, einmal bei `tasks`; deshalb steht die Regel „lokal und
 * Server immer zusammen ändern" auch in CLAUDE.md.
 *
 * Eine Regel, an die man sich erinnern muss, ist keine. Dieser Test rechnet
 * sie nach: Er baut das lokale Schema wirklich auf (alle Migrationen in einer
 * SQLite-Datenbank im Speicher, keine Textdeutung) und liest daneben
 * `supabase/migrations/0001_init.sql` – die Datei, die Erik im SQL-Editor
 * seines Supabase-Projekts ausführt.
 *
 * Schlägt er fehl, fehlt die Spalte auf dem Server, nicht im Test.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { MIGRATIONS, SYNCED_TABLES } from '../src/db/schema'

const SERVER_SQL = path.join(__dirname, '..', 'supabase', 'migrations', '0001_init.sql')

/** Das lokale Schema so, wie die App es auf dem Gerät wirklich anlegt. */
async function lokaleSpalten(): Promise<Map<string, Set<string>>> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  for (const m of MIGRATIONS) db.run(m.sql)

  const out = new Map<string, Set<string>>()
  const tabellen = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )[0]
  for (const zeile of tabellen.values) {
    const name = String(zeile[0])
    const spalten = db.exec(`SELECT name FROM pragma_table_info('${name}')`)[0]
    out.set(name, new Set((spalten?.values ?? []).map((r) => String(r[0]))))
  }
  db.close()
  return out
}

/**
 * Das Server-Schema aus der Datei lesen.
 *
 * Ausführen ginge nur gegen ein echtes Postgres – für einen Test, der bei
 * jedem `npm test` mitlaufen soll, ist das zu viel verlangt. Gelesen wird
 * deshalb der Text, aber über die Klammern statt über die Zeilen: In der
 * Datei stehen mal eine, mal fünf Spalten in derselben Zeile
 * (`id text PRIMARY KEY, day text NOT NULL, note text NOT NULL,`) – ein
 * zeilenweiser Leser übersähe die hinteren stillschweigend und der Test wäre
 * genau dort blind, wo er gebraucht wird.
 */
function serverSpalten(): Map<string, Set<string>> {
  const roh = fs.readFileSync(SERVER_SQL, 'utf8')
  // Zeilenkommentare raus, bevor irgendetwas gedeutet wird.
  const text = roh
    .split(/\r?\n/)
    .map((z) => z.replace(/--.*$/, ''))
    .join('\n')

  const out = new Map<string, Set<string>>()
  const merke = (tabelle: string, spalte: string) => {
    if (!out.has(tabelle)) out.set(tabelle, new Set())
    out.get(tabelle)!.add(spalte)
  }

  /* ------------------------------------------------ CREATE TABLE ... ( … ) */
  const kopf = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/gi
  for (let m = kopf.exec(text); m; m = kopf.exec(text)) {
    // Von der öffnenden Klammer bis zu der, die sie wieder schließt.
    const von = m.index + m[0].length
    let tiefe = 1
    let i = von
    for (; i < text.length && tiefe > 0; i++) {
      if (text[i] === '(') tiefe++
      else if (text[i] === ')') tiefe--
    }
    const rumpf = text.slice(von, i - 1)

    // Auf oberster Ebene an Kommas trennen – geschachtelte Klammern wie
    // `numeric(12,2)` oder `DEFAULT auth.uid()` dürfen nicht mittrennen.
    const teile: string[] = []
    let stueck = ''
    let t = 0
    for (const c of rumpf) {
      if (c === '(') t++
      else if (c === ')') t--
      if (c === ',' && t === 0) {
        teile.push(stueck)
        stueck = ''
      } else stueck += c
    }
    teile.push(stueck)

    for (const teil of teile) {
      const wort = teil.trim().match(/^(\w+)\b/)
      if (!wort) continue
      // Tabellenbedingungen sind keine Spalten.
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)$/i.test(wort[1])) continue
      merke(m[1], wort[1])
    }
  }

  /* ------------------------------ ALTER TABLE ... ADD COLUMN (Nachzügler) */
  const nach = /ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)\b/gi
  for (let m = nach.exec(text); m; m = nach.exec(text)) merke(m[1], m[2])

  return out
}

describe('Lokales Schema und Server-Schema passen zusammen', () => {
  let lokal: Map<string, Set<string>>
  let server: Map<string, Set<string>>

  beforeAll(async () => {
    lokal = await lokaleSpalten()
    server = serverSpalten()
  })

  it('liest beide Schemata überhaupt ein', () => {
    // Absicherung gegen einen Test, der still nichts mehr prüft, weil die
    // Schreibweise der Datei sich geändert hat und der Leser leer ausgeht.
    expect(lokal.size).toBeGreaterThan(40)
    expect(server.size).toBeGreaterThan(40)
  })

  it.each(SYNCED_TABLES.map((t) => [t]))('%s: der Server kennt jede Spalte', (tabelle) => {
    const hier = lokal.get(tabelle)
    expect(hier, `Tabelle ${tabelle} fehlt im lokalen Schema`).toBeTruthy()
    const dort = server.get(tabelle)
    expect(dort, `Tabelle ${tabelle} fehlt in 0001_init.sql`).toBeTruthy()

    // `_dirty` und `_conflict` bleiben absichtlich auf dem Gerät.
    const gesendet = [...hier!].filter((c) => !c.startsWith('_')).sort()
    const fehlend = gesendet.filter((c) => !dort!.has(c))
    expect(
      fehlend,
      `In 0001_init.sql fehlt für ${tabelle}:\n` +
        fehlend.map((c) => `  ALTER TABLE ${tabelle} ADD COLUMN IF NOT EXISTS ${c} ...;`).join('\n'),
    ).toEqual([])
  })
})
