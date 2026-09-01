# Wichtige Regeln für dieses Projekt

Dieses Projekt hat ZWEI Ausgaben, die bei jeder Änderung beide aktuell gehalten
werden müssen:

1. **Handy (PWA)**: `dist/` wird bei jedem `git push` auf `main` automatisch von
   GitHub Actions gebaut und auf GitHub Pages veröffentlicht (siehe
   `.github/workflows/pages.yml`). Das läuft von allein.

2. **PC (Einzeldatei)**: `LifeHub.html` ist eine eingecheckte, aber NICHT
   automatisch gebaute Datei. Nach JEDER Änderung am Code MUSS zusätzlich
   `npm run build:single` ausgeführt und die neue `LifeHub.html` mit committet
   werden – sonst bleibt die PC-Version auf dem alten Stand hängen, während das
   Handy schon aktuell ist.

## Datenbank-Schema: lokal UND Server IMMER zusammen ändern

Neue Spalten werden lokal in `src/db/schema.ts` per `ALTER TABLE ... ADD COLUMN`
in einem neuen Migrationsblock hinzugefügt. Bei JEDER neuen Spalte dort MUSS
zeitgleich derselbe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` in
`supabase/migrations/0001_init.sql` ergänzt werden (idempotent, nie DROP/TRUNCATE/
DELETE verwenden). Fehlt die Server-Spalte, schlägt die Synchronisation für genau
diese Tabelle bei jedem Versuch fehl (das ist schon zweimal passiert: einmal bei
calendar_events, einmal bei tasks).

Nach einer Schema-Änderung den Nutzer aktiv daran erinnern, die aktualisierte
`supabase/migrations/0001_init.sql` einmal im SQL-Editor seines Supabase-Projekts
auszuführen – ohne das bleibt die neue Spalte nur lokal vorhanden.

## Vor jedem Commit

`npm test` muss grün sein (aktuell 135 Tests). `npx tsc --noEmit` muss fehlerfrei
sein.
