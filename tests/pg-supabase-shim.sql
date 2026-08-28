-- Das Stückchen Supabase, das eine nackte Postgres-Installation nicht hat.
--
-- Damit lässt sich das erzeugte Serverschema unverändert einspielen und die
-- Zeilensicherheit greift beim Testen genauso wie später bei Supabase:
-- auth.uid() liest die Nutzerkennung aus derselben Einstellung, die auch
-- Supabase setzt (request.jwt.claim.sub).

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT anon, authenticated, service_role TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase vergibt auf neue Tabellen im Schema public standardmäßig Rechte an
-- anon. Genau das soll das Schema anschließend wieder zurücknehmen – ohne
-- diese Zeile würde der Test die Rücknahme nie prüfen.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
