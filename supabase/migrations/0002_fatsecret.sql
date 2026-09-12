-- LifeHub – FatSecret-Anbindung, Servertabellen
--
-- Diese beiden Tabellen sind bewusst NICHT Teil der Synchronisation und werden
-- deshalb auch nicht von scripts/gen-supabase-sql.mjs erzeugt. Sie enthalten
-- Zugangstoken, und Zugangstoken haben auf einem Gerät nichts verloren – erst
-- recht nicht in einer Datenbankdatei, die zwischen Handy und PC hin- und
-- hergeschoben wird.
--
-- Beide haben Zeilensicherheit an und KEINE Freigaben. Das ist kein Versehen:
-- Ohne Freigabe kommt ausschließlich der Dienstschlüssel heran, und den kennt
-- nur die Edge Function. Weder der öffentliche Projektschlüssel noch ein
-- angemeldeter Nutzer kann diese Zeilen lesen – auch nicht die eigenen.
--
-- Einmalig im SQL-Editor des Supabase-Projekts ausführen.

-- Angefangene, noch nicht abgeschlossene Freigaben.
-- Lebt nur für die Dauer eines Besuchs bei FatSecret und ist gleichzeitig die
-- Zuordnung: Der Rückweg von FatSecret kommt ohne Anmeldung und findet über
-- den oauth_token, zu welchem LifeHub-Konto er gehört.
CREATE TABLE IF NOT EXISTS fatsecret_pending (
  oauth_token        text PRIMARY KEY,
  oauth_token_secret text NOT NULL,
  user_id            uuid NOT NULL,
  redirect_to        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Das dauerhafte Zugangstoken je LifeHub-Konto.
-- Ein FatSecret-Passwort steht hier nicht und wird auch nie erfragt – die
-- Anmeldung passiert bei FatSecret selbst.
CREATE TABLE IF NOT EXISTS fatsecret_accounts (
  user_id            uuid PRIMARY KEY,
  oauth_token        text NOT NULL,
  oauth_token_secret text NOT NULL,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  last_sync_at       timestamptz
);

ALTER TABLE fatsecret_pending  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fatsecret_accounts ENABLE ROW LEVEL SECURITY;

-- Liegengebliebene Freigaben aufräumen (jemand hat den Vorgang abgebrochen).
-- Ohne Zeitplan – die Edge Function ruft es nicht auf, es schadet aber auch
-- nicht, die Funktion gelegentlich von Hand auszuführen.
CREATE OR REPLACE FUNCTION fatsecret_pending_aufraeumen() RETURNS void AS $$
  DELETE FROM fatsecret_pending WHERE created_at < now() - interval '1 hour';
$$ LANGUAGE sql;
