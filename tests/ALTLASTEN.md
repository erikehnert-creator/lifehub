# Skripte, die hier nicht laufen

Ein Teil der Prüfskripte stammt aus einer früheren Linux-Arbeitsumgebung. Sie haben
Pfade fest eingebaut, die es auf Eriks PC nicht gibt:

- `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` – der Browser
- `/home/claude/lifehub/app/dist` – der Projektordner

Aufgerufen laufen sie nicht in einen verständlichen Fehler, sondern in eine
Zeitüberschreitung oder ein „Datei nicht gefunden" – deshalb steht hier, welche das
sind, statt dass jemand eine halbe Stunde sucht.

| Datei | Was sie einmal geprüft hat |
|---|---|
| `tests/sync-e2e.mjs` | Zwei Geräte, ein Server: vollständiger Abgleich |
| `tests/sync-e2e-cascade.mjs` | Abgleich über mehrere Bereiche hinweg |
| `tests/sync-e2e-offline-backlog.mjs` | Gerät zwei Wochen offline, danach Rückstand |
| `tests/repair-e2e.mjs` | Reparatur doppelter Zeilen |
| `tests/pages-check.mjs` | Auslieferung aus einem Unterordner, Service Worker |
| `tests/live-check.mjs`, `tests/blick.mjs`, `tests/_s.mjs` | Rundgänge durch die Bildschirme |
| `tests/diag-konten.mjs`, `tests/schliessen-oeffnen.mjs` | Kurzdiagnosen |
| `shot.mjs`, `b.sh` | Bildschirmfotos, Hilfsskript |

`tests/mock-supabase.mjs` läuft grundsätzlich überall, braucht aber ein Postgres auf
`127.0.0.1:5432` mit Benutzer `postgres` und Passwort `test`.

## Was hier tatsächlich läuft

```
npm test                            # Unit-Tests
npx tsc --noEmit
node tests/automatik-e2e.mjs        # Vorlagen planen, nachziehen, aufräumen
node tests/heute-mobil-e2e.mjs      # Termine ohne Scrollen auf 390x844
node tests/migration-e2e.mjs        # alte Datenbank überlebt die Migration
node tests/sync-ganzzahlen-e2e.mjs  # Abgleich gegen einen strengen Server
```

`sync-ganzzahlen-e2e.mjs` bringt seinen Server selbst mit – einen kleinen Nachbau, der
die Spaltentypen aus `supabase/migrations/0001_init.sql` liest und wie PostgreSQL
ablehnt. Er braucht keine Datenbankinstallation und läuft deshalb auch in GitHub
Actions.

## Warum sie nicht einfach repariert wurden

Die Sync-Skripte oben brauchen ein echtes Postgres mit dem Serverschema. Sie auf
Windows umzuschreiben, ohne sie danach laufen lassen zu können, hieße: ungeprüften
Code hinterlassen, der aussieht, als würde er etwas prüfen. Das ist schlechter als ein
Skript, von dem klar dasteht, dass es hier nicht läuft.

Wer sie wiederbeleben will, braucht als Erstes ein Postgres mit
`tests/pg-supabase-shim.sql` und `supabase/migrations/0001_init.sql`; die festen Pfade
lassen sich dann so aus der Repo-Wurzel ableiten, wie es `sync-ganzzahlen-e2e.mjs`
vormacht.
