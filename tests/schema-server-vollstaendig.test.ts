/**
 * Kennt der Server jede synchronisierte Tabelle – und zwar vollständig?
 *
 * ---------------------------------------------------------------------------
 * Warum es diesen Test neben `schema-parity.test.ts` gibt
 *
 * Der Nachbar prüft die **Spalten**: Kennt der Server jede Spalte, die der
 * Abgleich schickt? Das ist der Fehler, an dem `calendar_events` und `tasks`
 * schon zweimal gescheitert sind.
 *
 * Eine Tabelle kann aber auch vorhanden und trotzdem unbrauchbar sein. Sie
 * braucht ausserdem:
 *
 *   • **Zeilensicherheit**, sonst wäre sie für jeden mit dem öffentlichen
 *     Schlüssel lesbar – die wichtigste Schutzmassnahme überhaupt
 *   • eine **Zugriffsregel**, sonst sieht auch der Angemeldete keine Zeile
 *   • **Rechte für `authenticated`** und keine für `anon`
 *   • `server_rev` mit Vorgabewert, Index und **Auslöser**, sonst bekommt der
 *     Client Änderungen nie zu sehen: Er fragt „gib mir alles mit
 *     server_rev > mein Stand"
 *   • einen Platz im **Neuigkeiten-Anzeiger** `sync_head`, sonst merkt kein
 *     Gerät, dass sich in dieser Tabelle etwas getan hat
 *
 * Fehlt eines davon, sieht in der Oberfläche nichts kaputt aus. Es
 * synchronisiert nur still nicht.
 *
 * ---------------------------------------------------------------------------
 * Was dieser Test NICHT kann
 *
 * Er prüft die **Datei**, nicht Eriks Server. Ob `0001_init.sql` dort auch
 * ausgeführt wurde, weiss nur der Server selbst – dafür gibt es die Diagnose
 * unter Einstellungen → Synchronisation.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SYNCED_TABLES, LOCAL_ONLY_TABLES, MIGRATIONS } from '../src/db/schema'

const SERVER_SQL = path.join(__dirname, '..', 'supabase', 'migrations', '0001_init.sql')
const sql = fs.readFileSync(SERVER_SQL, 'utf8')

/** Tabellen, die `0001_init.sql` wirklich anlegt. */
const angelegt = new Set(
  [...sql.matchAll(/^CREATE TABLE IF NOT EXISTS (\w+) \(/gm)].map((m) => m[1]))

/** Die Liste, die sich die Datei am Ende selbst zur Prüfung vorhält. */
const selbstPruefung = (() => {
  const m = sql.match(/meine_tabellen text\[\] := ARRAY\[([^\]]*)\]/)
  if (!m) return new Set<string>()
  return new Set([...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))
})()

const hat = (muster: RegExp) => muster.test(sql)

describe('Der Server bekommt jede synchronisierte Tabelle', () => {
  it('liest die Datei überhaupt ein', () => {
    // Absicherung gegen einen Test, der still nichts mehr prueft, weil sich
    // die Schreibweise der erzeugten Datei geaendert hat.
    expect(angelegt.size).toBeGreaterThan(40)
    expect(selbstPruefung.size).toBeGreaterThan(40)
  })

  it('legt genau die synchronisierten Tabellen an – keine mehr, keine weniger', () => {
    const zuviel = [...angelegt].filter((t) => !(SYNCED_TABLES as readonly string[]).includes(t))
    const zuwenig = SYNCED_TABLES.filter((t) => !angelegt.has(t))
    expect(zuwenig, `In 0001_init.sql fehlt CREATE TABLE für: ${zuwenig.join(', ')}\n`
      + 'Erzeuge die Datei neu: node scripts/gen-supabase-sql.mjs').toEqual([])
    expect(zuviel, `0001_init.sql legt Tabellen an, die nicht synchronisiert werden: ${zuviel.join(', ')}`)
      .toEqual([])
  })

  it('lässt die rein lokalen Tabellen aus', () => {
    for (const t of LOCAL_ONLY_TABLES) {
      expect(angelegt.has(t), `${t} gehört auf das Gerät und nicht auf den Server`).toBe(false)
    }
  })

  it.each(SYNCED_TABLES.map((t) => [t]))('%s: Zeilensicherheit und Zugriffsregel', (t) => {
    expect(hat(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`)),
      `${t}: ENABLE ROW LEVEL SECURITY fehlt – die Tabelle wäre ohne Anmeldung lesbar`).toBe(true)
    expect(hat(new RegExp(`CREATE POLICY ${t}_own ON ${t} FOR ALL`)),
      `${t}: die Zugriffsregel fehlt – auch der Angemeldete sähe keine Zeile`).toBe(true)
    expect(hat(new RegExp(`USING \\(user_id = auth\\.uid\\(\\)\\)`)),
      'die Regel muss auf user_id = auth.uid() prüfen').toBe(true)
  })

  it.each(SYNCED_TABLES.map((t) => [t]))('%s: Rechte für authenticated, keine für anon', (t) => {
    expect(hat(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO authenticated`)),
      `${t}: authenticated darf nicht zugreifen`).toBe(true)
    expect(hat(new RegExp(`REVOKE ALL ON ${t} FROM anon`)),
      `${t}: anon behält Rechte – zwei Schlösser statt einem, siehe gen-supabase-sql.mjs`).toBe(true)
  })

  it.each(SYNCED_TABLES.map((t) => [t]))('%s: server_rev mit Vorgabe, Index und Auslöser', (t) => {
    expect(hat(new RegExp(`ALTER TABLE ${t} ALTER COLUMN server_rev SET DEFAULT nextval`)),
      `${t}: server_rev bekommt keinen Wert – der Client sähe die Zeile nie`).toBe(true)
    expect(hat(new RegExp(`CREATE INDEX IF NOT EXISTS ix_${t}_rev ON ${t}\\(server_rev\\)`)),
      `${t}: der Index auf server_rev fehlt`).toBe(true)
    expect(hat(new RegExp(`CREATE TRIGGER trg_${t}_rev BEFORE INSERT OR UPDATE ON ${t}`)),
      `${t}: ohne Auslöser bleibt server_rev bei einer Änderung stehen`).toBe(true)
  })

  it.each(SYNCED_TABLES.map((t) => [t]))('%s: steht im Neuigkeiten-Anzeiger', (t) => {
    expect(hat(new RegExp(`SELECT max\\(server_rev\\) AS rev FROM ${t}\\b`)),
      `${t}: fehlt in sync_head – kein Gerät merkt, dass sich hier etwas getan hat`).toBe(true)
  })

  it.each(SYNCED_TABLES.map((t) => [t]))('%s: steht in der Selbstprüfung der Datei', (t) => {
    expect(selbstPruefung.has(t),
      `${t}: fehlt in meine_tabellen – die Prüfung am Dateiende ginge daran vorbei`).toBe(true)
  })
})

describe('Die Datei bleibt ungefährlich', () => {
  it('löscht nichts', () => {
    // Erik fuehrt diese Datei auf einer Datenbank mit echten Daten aus. Ein
    // DROP oder DELETE darin waere nicht wiedergutzumachen.
    const gefaehrlich = sql.split(/\r?\n/)
      .map((z, i) => ({ z: z.trim(), nr: i + 1 }))
      .filter(({ z }) => !z.startsWith('--'))
      .filter(({ z }) => /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|DROP\s+COLUMN|DROP\s+SCHEMA)\b/i.test(z))
    expect(gefaehrlich.map((g) => `Zeile ${g.nr}: ${g.z}`), 'Diese Datei darf nichts löschen').toEqual([])
  })

  it('lässt sich mehrfach ausführen', () => {
    // Jede Tabelle mit IF NOT EXISTS, jede Regel mit DROP POLICY IF EXISTS
    // davor. Sonst scheiterte der zweite Lauf - und Erik fuehrt sie nach
    // jeder Migration erneut aus.
    for (const t of SYNCED_TABLES) {
      expect(hat(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`)),
        `${t}: ohne IF NOT EXISTS scheitert der zweite Lauf`).toBe(true)
      expect(hat(new RegExp(`DROP POLICY IF EXISTS ${t}_own ON ${t}`)),
        `${t}: ohne DROP POLICY IF EXISTS scheitert der zweite Lauf`).toBe(true)
    }
    for (const spalte of sql.matchAll(/^ALTER TABLE (\w+) ADD COLUMN (?!IF NOT EXISTS)/gm)) {
      expect.fail(`ALTER TABLE ${spalte[1]} ADD COLUMN ohne IF NOT EXISTS – der zweite Lauf scheitert`)
    }
  })

  it('bringt Sequenz, Funktion und Anzeiger mit', () => {
    expect(hat(/CREATE SEQUENCE IF NOT EXISTS server_rev_seq/)).toBe(true)
    expect(hat(/CREATE OR REPLACE FUNCTION set_server_rev\(\)/)).toBe(true)
    expect(hat(/CREATE OR REPLACE VIEW sync_head WITH \(security_invoker = true\)/)).toBe(true)
    expect(hat(/GRANT SELECT ON sync_head TO authenticated/)).toBe(true)
    expect(hat(/REVOKE ALL ON sync_head FROM anon/)).toBe(true)
  })
})

describe('Die neuen Turnen-Tabellen sind vollständig dabei', () => {
  // Namentlich, weil genau diese acht in der Oberflaeche als fehlend
  // gemeldet wurden. Der Test darueber prueft dasselbe allgemein; diese
  // Liste macht den Anlass auffindbar.
  const TURNEN = [
    'gym_elements', 'gym_attempts',
    'gym_routines', 'gym_routine_elements',
    'gym_routine_versions', 'gym_routine_version_elements',
    'gym_competitions', 'gym_results',
  ]

  it('stehen in SYNCED_TABLES', () => {
    for (const t of TURNEN) expect(SYNCED_TABLES).toContain(t)
  })

  it('werden vom lokalen Schema angelegt', () => {
    const lokal = MIGRATIONS.map((m) => m.sql).join('\n')
    for (const t of TURNEN) {
      expect(new RegExp(`CREATE TABLE ${t} \\(`).test(lokal), `${t} fehlt in schema.ts`).toBe(true)
    }
  })

  it('stehen vollständig im Serverschema', () => {
    for (const t of TURNEN) {
      expect(angelegt.has(t), `${t} fehlt in 0001_init.sql`).toBe(true)
    }
  })
})
