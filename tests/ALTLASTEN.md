# Skripte, die hier nicht laufen

Ein Teil der Prüfskripte stammt aus einer früheren Linux-Arbeitsumgebung. Sie haben
Annahmen fest eingebaut, die es auf Eriks Rechner nicht gibt:

- `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` – der Browser
- `/home/claude/lifehub/app/dist` – der Projektordner
- ein Postgres auf `127.0.0.1:5432`, Benutzer `postgres`, Passwort `test`
- ein Export von Eriks echten Daten

Browser und Pfade sind seit dem 17.09.2026 erledigt (`_browser.mjs` leitet beides
ab). Was hier steht, ist der Rest.

## Am 20.09.2026 abgelöst

Die drei Sync-Prüfungen sind neu aufgesetzt. Sie brauchen weder Postgres noch ein
Passwort noch echte Daten und laufen dadurch überall – auch in GitHub Actions.

| Vorher | Jetzt |
|---|---|
| `sync-e2e.mjs` (Postgres + Eriks Datenexport) | `sync-e2e.mjs` – neu geschrieben |
| `sync-e2e-cascade.mjs` | aufgegangen in `sync-e2e.mjs`, Schritt 5 |
| `sync-e2e-offline-backlog.mjs` | aufgegangen in `sync-e2e.mjs`, Schritt 4 |

Warum zusammengelegt: Alle drei bauten dieselbe Bühne auf – zwei Geräte, ein
Server, anmelden, abgleichen. Getrennt hieß das dreimal dieselbe Einrichtung und
drei Fassungen derselben Klickfolge; änderte sich die Einstellungsseite, liefen
zwei davon still ins Leere. Geprüft wird weiterhin jeder der Fälle:

- **Schritt 4** ersetzt `offline-backlog`: Ein Gerät bleibt stehen, das andere
  häuft Änderungen an, danach muss alles ankommen.
- **Schritt 5** ersetzt `cascade`: Eine einzelne Tabelle scheitert beim Senden –
  die anderen müssen trotzdem durchgehen, und der Fehler muss gemeldet werden,
  statt still verschluckt zu werden.

`cascade` prüfte das ursprünglich gegen ein Postgres, dem in `calendar_events`
wirklich zwei Spalten fehlten. Diesen Zustand gibt es nicht mehr, und er ließe
sich auch nicht wiederherstellen: `tests/schema-parity.test.ts` rechnet bei jedem
`npm test` nach, dass lokales und Serverschema zusammenpassen. Der Server-Nachbau
stellt den Fehlerfall deshalb ausdrücklich nach (`setzeFehlerTabelle`).

Die gemeinsamen Teile liegen jetzt in:

- `_supabase-nachbau.mjs` – Supabase-Schnittstellen im Arbeitsspeicher, Typen aus
  `supabase/migrations/0001_init.sql`. Auch `sync-ganzzahlen-e2e.mjs` benutzt ihn
  (vorher stand er dort ein zweites Mal wörtlich im Text).
- `_sync-app.mjs` – ein Gerät starten, anmelden, abgleichen.

## Was weiterhin nicht von allein läuft

| Datei | Warum | Verhalten beim Aufruf |
|---|---|---|
| `repair-e2e.mjs` | braucht einen echten Datenexport | überspringt mit Hinweis |
| `blick.mjs` | dito (Rundgang durch die Bildschirme) | überspringt mit Hinweis |
| `pages-check.mjs` | prüft eine veröffentlichte Adresse | braucht eine erreichbare Seite |
| `live-check.mjs`, `_s.mjs` | Rundgänge aus der alten Umgebung | Zeitüberschreitung |
| `diag-konten.mjs`, `schliessen-oeffnen.mjs` | Kurzdiagnosen von Hand | Zeitüberschreitung |
| `mock-supabase.mjs` | braucht Postgres auf 127.0.0.1:5432 | bricht ohne Datenbank ab |
| `shot.mjs`, `b.sh` | Bildschirmfotos, Hilfsskript | – |

`repair-e2e.mjs` und `blick.mjs` brachen früher mit einem nackten `ENOENT` ab.
Sie sagen jetzt, was ihnen fehlt, und beenden sich mit 0 – ein fehlender
persönlicher Datenexport ist kein Testfehler.

Wer sie doch fahren will, legt einen Export daneben oder setzt
`LIFEHUB_ECHTDATEN=<pfad>`. **Dieser Export gehört nicht ins Repository.**

`mock-supabase.mjs` wird von keiner laufenden Prüfung mehr gebraucht – der
Nachbau hat ihn ersetzt. Er bleibt vorerst liegen, weil `schliessen-oeffnen.mjs`
ihn noch nennt.

## Was hier tatsächlich läuft

```
npm test                            # Unit-Tests
npx tsc --noEmit

npm run build:single                # die PC-Einzeldatei – die E2E-Pruefungen
npx vite build                      # und dist/ fuer die Handy-Fassung

node tests/automatik-e2e.mjs        # Vorlagen planen, nachziehen, aufräumen
node tests/heute-mobil-e2e.mjs      # Termine ohne Scrollen auf 390x844
node tests/sync-e2e.mjs             # zwei Geräte, ein Server, voller Abgleich
node tests/sync-ganzzahlen-e2e.mjs  # Abgleich gegen einen strengen Server
node tests/migration-e2e.mjs        # alte Datenbank überlebt die Migration
node tests/dubletten-e2e.mjs        # doppelte Einträge zusammenführen
node tests/ballaststoffe-e2e.mjs    # zwei Geräte, eine doppelte Metrik
node tests/fatsecret-alltag-e2e.mjs # Ernährung holt sich selbst nach
node tests/umbuchung-e2e.mjs        # Umbuchung zwischen zwei Konten
node tests/zusammenhaenge-e2e.mjs   # Zusammenhänge ohne Ursachenbehauptung
node tests/performance-benchmark.mjs
```

`sync-e2e.mjs` und `sync-ganzzahlen-e2e.mjs` bringen ihren Server selbst mit.

## Warum die übrigen nicht einfach repariert wurden

Die Rundgänge und Kurzdiagnosen oben sind Werkzeuge von Hand, keine Prüfungen mit
einer Aussage: Sie klicken sich durch und machen Bildschirmfotos. Sie auf Windows
umzuschreiben hieße, Code zu pflegen, der nichts behauptet. Was sie einmal
absichern sollten, prüfen heute `heute-mobil-e2e` und `automatik-e2e` gezielt.
