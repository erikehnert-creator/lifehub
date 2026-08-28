/**
 * Erzeugt das Postgres-Schema für die Synchronisation aus dem lokalen
 * SQLite-Schema. So können Client und Server nicht auseinanderlaufen.
 *
 *   node scripts/gen-supabase-sql.mjs > supabase/migrations/0001_init.sql
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const src = readFileSync(new URL('../src/db/schema.ts', import.meta.url), 'utf8')

const baseMatch = src.match(/const BASE = `([\s\S]*?)`/)
const base = baseMatch[1]

// Alle Migrationen der Reihe nach einsammeln – nicht nur die erste.
// Sonst fehlen dem Server genau die Spalten, die später dazugekommen sind,
// und der erste Abgleich scheitert mit einem unverständlichen Fehler.
const blocks = [...src.matchAll(/sql: `([\s\S]*?)`,\n  \}/g)].map((m) => m[1])
if (!blocks.length) throw new Error('Keine Migration in src/db/schema.ts gefunden')
let sql = blocks.join('\n').replace(/\$\{BASE\}/g, base)

// Nur synchronisierte Tabellen; die rein lokalen bleiben auf dem Gerät
const LOCAL_ONLY = ['sync_state', 'change_log', 'conflicts']

// Kommentarzeilen entfernen, damit die Anweisungen sauber erkannt werden
sql = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
const statements = sql.split(';').map((s) => s.trim()).filter(Boolean)
const tables = []
const alters = []
const relaxed = []
const out = []

out.push(`-- LifeHub – Serverschema für die Synchronisation
-- Erzeugt aus src/db/schema.ts. Nicht von Hand bearbeiten, sondern neu erzeugen:
--   node scripts/gen-supabase-sql.mjs > supabase/migrations/0001_init.sql

-- Eine einzige globale Sequenz vergibt server_rev. Der Client fragt
-- "gib mir alles mit server_rev > mein Cursor" – dadurch kann strukturell
-- keine Änderung übersprungen werden. Zeitstempel wären dafür unbrauchbar,
-- weil Geräteuhren falsch gehen.
CREATE SEQUENCE IF NOT EXISTS server_rev_seq;

CREATE OR REPLACE FUNCTION set_server_rev() RETURNS trigger AS $$
BEGIN
  NEW.server_rev := nextval('server_rev_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`)

for (const stmt of statements) {
  const m = stmt.match(/^CREATE TABLE (\w+) \(([\s\S]*)\)$/)
  if (m) {
    const name = m[1]
    if (LOCAL_ONLY.includes(name)) continue
    tables.push(name)
    let body = m[2]
      .split('\n')
      .map((line) => line.replace(/--.*$/, '').trimEnd())
      .filter((l) => l.trim())
      .join('\n')
      // Nur lokale Spalten entfernen
      .replace(/^\s*_dirty[^,]*,?\s*$/gm, '')
      .replace(/^\s*_conflict[^,]*,?\s*$/gm, '')
      // Typen übersetzen
      .replace(/\bTEXT PRIMARY KEY\b/g, 'text PRIMARY KEY')
      .replace(/server_rev\s+INTEGER/g, 'server_rev bigint')
      .replace(/\bINTEGER\b/g, 'integer')
      .replace(/\bREAL\b/g, 'double precision')
      .replace(/\bTEXT\b/g, 'text')
      .replace(/,\s*$/, '')

    // Eindeutigkeit auf fachlichen Schlüsseln (settings.key, metrics.key …)
    // gilt auf dem Server bewusst NICHT. Zwei Geräte legen vor ihrem ersten
    // Abgleich völlig zu Recht denselben Schlüssel mit verschiedenen IDs an –
    // eine harte Bedingung würde daraus einen kompletten Abgleichsabbruch
    // machen. Identität ist hier die ID; die fachliche Eindeutigkeit stellt
    // jedes Gerät lokal für sich her.
    body = body.replace(/(\w+)((?:\s+\w+)*?)\s+UNIQUE\b/g, (_all, col, type) => {
      relaxed.push(`${name}.${col}`)
      return `${col}${type}`
    })

    out.push(`CREATE TABLE IF NOT EXISTS ${name} (
  user_id uuid NOT NULL DEFAULT auth.uid(),
${body}
);`)
    continue
  }
  const idx = stmt.match(/^CREATE (UNIQUE )?INDEX (\w+) ON (\w+)\(([^)]*)\)/)
  if (idx && !LOCAL_ONLY.includes(idx[3])) {
    // Auch hier bewusst ohne UNIQUE – siehe Begründung oben.
    if (idx[1]) relaxed.push(`${idx[3]}(${idx[4]})`)
    out.push(`CREATE INDEX IF NOT EXISTS ${idx[2]} ON ${idx[3]}(user_id, ${idx[4]});`)
    continue
  }

  // Nachträglich ergänzte Spalten aus späteren Migrationen
  const alter = stmt.match(/^ALTER TABLE (\w+) ADD COLUMN ([\s\S]+)$/)
  if (alter && !LOCAL_ONLY.includes(alter[1])) {
    const col = alter[2]
      .replace(/\bINTEGER\b/g, 'integer')
      .replace(/\bREAL\b/g, 'double precision')
      .replace(/\bTEXT\b/g, 'text')
      .trim()
    alters.push(`ALTER TABLE ${alter[1]} ADD COLUMN IF NOT EXISTS ${col};`)
  }
}

if (alters.length) {
  out.push('-- Spalten aus späteren Migrationen')
  out.push(alters.join('\n'))
}

out.push('\n-- server_rev: Sequenz, Index und Trigger je Tabelle')
for (const t of tables) {
  out.push(`ALTER TABLE ${t} ALTER COLUMN server_rev SET DEFAULT nextval('server_rev_seq');
CREATE INDEX IF NOT EXISTS ix_${t}_rev ON ${t}(server_rev);
DROP TRIGGER IF EXISTS trg_${t}_rev ON ${t};
CREATE TRIGGER trg_${t}_rev BEFORE INSERT OR UPDATE ON ${t}
  FOR EACH ROW EXECUTE FUNCTION set_server_rev();`)
}

out.push(`
-- Rechte: Nur angemeldete Personen dürfen überhaupt zugreifen. Der öffentliche
-- Schlüssel allein (Rolle "anon") bekommt bewusst nichts – er dient nur dazu,
-- das Projekt zu benennen.
--
-- Der Entzug für "anon" ist Absicht und kein Übereifer: Supabase vergibt für
-- neue Tabellen im Schema "public" von Haus aus Rechte an anon. Die
-- Zeilensicherheit fängt das zwar ab (ohne Anmeldung ist auth.uid() leer und
-- es passt keine Zeile), aber dann hinge alles an einer einzigen Regel. Ohne
-- Tabellenrecht kommt anon gar nicht erst so weit – zwei Schlösser statt einem.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE server_rev_seq TO authenticated;
REVOKE ALL ON SCHEMA public FROM anon;
REVOKE ALL ON SEQUENCE server_rev_seq FROM anon;`)
for (const t of tables) {
  out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO authenticated;
REVOKE ALL ON ${t} FROM anon;`)
}

out.push(`
-- Zeilensicherheit: Jede Tabelle ist standardmäßig gesperrt und gibt nur die
-- eigenen Zeilen frei. Das ist die wichtigste Schutzmaßnahme überhaupt –
-- eine Tabelle ohne diese Regeln wäre für jeden mit dem öffentlichen
-- Schlüssel lesbar.`)
for (const t of tables) {
  out.push(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${t}_own ON ${t};
CREATE POLICY ${t}_own ON ${t} FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());`)
}

// Ein einziger Blick statt vierzig: Wie hoch ist mein höchster Zählerstand?
out.push(`
-- Neuigkeiten-Anzeiger
--
-- Ohne diesen Blick müsste ein Gerät alle ${tables.length} Tabellen einzeln
-- abfragen, nur um festzustellen, dass sich nichts getan hat. Mit ihm genügt
-- eine Anfrage: Ist der Zählerstand höher als der zuletzt gesehene, lohnt sich
-- ein Abgleich.
--
-- security_invoker = true ist hier entscheidend: Ohne diese Angabe liefe die
-- Ansicht mit den Rechten ihres Erstellers und würde die Zeilensicherheit
-- umgehen. So gilt sie auch hier, und jeder sieht nur den eigenen Stand.
CREATE OR REPLACE VIEW sync_head WITH (security_invoker = true) AS
SELECT max(rev) AS server_rev FROM (
${tables.map((t) => `  SELECT max(server_rev) AS rev FROM ${t}`).join('\n  UNION ALL\n')}
) AS alle;

GRANT SELECT ON sync_head TO authenticated;
REVOKE ALL ON sync_head FROM anon;`)

out.push(`
-- Prüfung: Es darf weder eine Tabelle ohne Zeilensicherheit noch eine ohne
-- Regel geben. Die Abfrage geht bewusst über pg_class samt Schema – ein
-- Vergleich allein über den Namen würde auch Indizes treffen und die Prüfung
-- damit wertlos machen.
DO $$
DECLARE ohne_rls text; ohne_regel text; anon_rechte text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO ohne_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  SELECT string_agg(c.relname, ', ') INTO ohne_regel
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = c.relname
    );

  IF ohne_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabellen ohne Zeilensicherheit: %', ohne_rls;
  END IF;
  IF ohne_regel IS NOT NULL THEN
    RAISE EXCEPTION 'Tabellen ohne Zugriffsregel: %', ohne_regel;
  END IF;

  SELECT string_agg(DISTINCT table_name, ', ') INTO anon_rechte
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'anon';
  IF anon_rechte IS NOT NULL THEN
    RAISE EXCEPTION 'Der oeffentliche Schluessel haette noch Rechte auf: %', anon_rechte;
  END IF;

  RAISE NOTICE 'Schema vollstaendig: alle Tabellen sind gesichert, anon hat keine Rechte.';
END $$;`)

mkdirSync(new URL('../supabase/migrations', import.meta.url), { recursive: true })
const text = out.join('\n\n') + '\n'
writeFileSync(new URL('../supabase/migrations/0001_init.sql', import.meta.url), text)
console.error(`${tables.length} Tabellen erzeugt`)
if (relaxed.length) {
  console.error(`ohne UNIQUE auf dem Server (bewusst): ${relaxed.join(', ')}`)
}
