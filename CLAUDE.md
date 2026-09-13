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

`tests/schema-parity.test.ts` rechnet das bei jedem `npm test` nach: Es baut das
lokale Schema wirklich auf und vergleicht jede gesendete Spalte mit
`0001_init.sql`. Vergisst man die Server-Seite, schlägt der Test fehl und nennt
die fehlende `ALTER TABLE`-Zeile wörtlich. Verlass dich trotzdem nicht allein
darauf – der Test prüft die Datei, nicht Eriks Server.

Nach einer Schema-Änderung den Nutzer aktiv daran erinnern, die aktualisierte
`supabase/migrations/0001_init.sql` einmal im SQL-Editor seines Supabase-Projekts
auszuführen – ohne das bleibt die neue Spalte nur lokal vorhanden.

## Vor jedem Commit

`npm test` muss grün sein (aktuell 391 Tests). `npx tsc --noEmit` muss fehlerfrei
sein.

Bei Änderungen an der Automatik (core/automation.ts, state/automatik.ts) oder an der
Heute-Seite zusätzlich die beiden Browser-Prüfungen laufen lassen – sie arbeiten gegen
die gebaute `LifeHub.html`, also vorher `npm run build:single`:

```
node tests/automatik-e2e.mjs     # plant ein, zieht nach, räumt auf, dreht sich nicht
node tests/heute-mobil-e2e.mjs   # misst nach, ob die Termine ohne Scrollen dastehen
```

Bei einer neuen Migration in `src/db/schema.ts` zusätzlich:

```
node tests/migration-e2e.mjs        # legt Daten in der VORHERIGEN Fassung an und
                                    # prueft, ob sie die Migration ueberleben
node tests/sync-ganzzahlen-e2e.mjs  # Abgleich gegen einen Server, der Typen ernst
                                    # nimmt - erst scheitern, dann durchlaufen
node tests/dubletten-e2e.mjs        # doppelte Konten zusammenfuehren, ohne dass
                                    # eine Buchung dabei verlorengeht
```

Welche Fassung dabei die „vorherige" ist, sucht der Test selbst: die jüngste mit
einer niedrigeren höchsten Migrationsnummer als HEAD. Ein festes `HEAD~1` wäre
nur an dem Tag richtig, an dem die Migration entsteht – ein Commit später prüfte
er die neue Fassung gegen sich selbst und wäre still bedeutungslos. Für einen
anderen Ausgangspunkt: `LIFEHUB_MIGRATION_BASIS=<commit> node tests/migration-e2e.mjs`.

Die Automatik läuft nach JEDER Datenänderung erneut und schreibt dabei selbst Daten.
Das endet nur, weil der zweite Durchlauf nichts mehr findet. Wer dort ein Feld ergänzt,
muss es in `gleich()` (core/automation.ts) sauber vergleichbar machen – sonst findet
jeder Lauf dieselbe „Änderung" erneut und die App dreht sich im Kreis. `automatik-e2e`
prüft genau das.

## Wo das Projekt liegt

Seit dem 13.09.2026 ist der Arbeitsordner

    …/Claude Gedächtniss/02 Projekte/LifeHub

also im Obsidian-Vault. Daneben liegt dort `_Projektablage/` mit persönlichen
Unterlagen, darunter dem Supabase-Datenbankpasswort. Dieses Repository ist
öffentlich: `_Projektablage/` ist per `.gitignore` als ganzer Ordner
ausgeschlossen, und ihr Inhalt gehört niemals in einen Commit, eine Notiz oder
einen Bericht.

Der frühere Ordner `Dokumente/Projekte/LifeHub-Projekt` wird nicht mehr benutzt.

## Werte, die PostgreSQL ablehnt

SQLite prüft Spaltentypen nicht: `sort_order INTEGER` ist dort eine Neigung, kein
Versprechen, und 23.5 bleibt einfach stehen. PostgreSQL antwortet darauf mit
`22P02` – und weil eine Tabelle immer als Ganzes gesendet wird, scheitert daran
nicht die eine Zeile, sondern der Push der kompletten Tabelle, bei jedem Versuch
aufs Neue. Genau so ist „Ballaststoffe 23.5" wochenlang unbemerkt geblieben.

Wer eine Zahl in eine ganzzahlige Spalte schreibt, prüft deshalb, dass sie
ganzzahlig IST. `core/ganzzahlen.ts` fängt den Rest beim Senden ab,
`tests/sortierwerte.test.ts` prüft den Seed, `tests/schema-parity.test.ts`
vergleicht auch die Typen.

## Nicht alle Testskripte laufen hier

Mehrere ältere Skripte in `tests/` stammen aus einer Linux-Umgebung und haben
Pfade wie `/home/claude/…` fest eingebaut. Welche das sind und was stattdessen
läuft, steht in `tests/ALTLASTEN.md`. Nicht wundern, wenn eines davon in eine
Zeitüberschreitung läuft.
