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

`npm test` muss grün sein (aktuell 1.916 Tests). `npx tsc --noEmit` muss fehlerfrei
sein.

Auf Eriks Rechner sind es **1.935**: `tests/turnen-vergleich-echt.test.ts` rechnet
den Konkurrenzvergleich gegen das echte Wettkampfprotokoll und übergeht sich
selbst, wo das PDF oder `unpdf` fehlt (20 übersprungene Prüfungen). Die
Abweichung ist Absicht - das Protokoll gehoert nicht ins Repository.

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

Genau das ist trotzdem passiert: Am 16.09.2026 entstanden dort neun Commits,
teils Dinge, die es hier schon gab – darunter eine ZWEITE Migration 10 mit
anderen Spalten. Sie wurden per Merge übernommen (keine History umgeschrieben);
die doppelt gebauten Teile nahmen die Fassung dieses Ordners, weil sie zum
Server passt. Datenbanken, die die fremde Migration 10 schon trugen, gleicht
`src/db/altstand.ts` beim Öffnen an. **Vor jeder Arbeit prüfen, dass der
Arbeitsordner dieser hier ist** (`git rev-parse --show-toplevel`).

## Karten einer Seite neu schneiden: die alte Auswahl mitnehmen

Welche Karten eine Seite zeigt und in welcher Reihenfolge, steht je Seite unter
einer Kennung in `settings.layout_prefs` (`usePageLayout`). Wer die Karten einer
Seite anders zuschneidet, darf die Kennung nicht einfach hochzählen und den Rest
sich selbst überlassen: Die gespeicherte Auswahl bleibt dann zwar liegen, greift
aber nie wieder – die Seite steht für Erik plötzlich in Werkseinstellung da, ohne
Meldung, ohne erkennbaren Grund.

Genau das ist beim UI-Umbau im September 2026 zweimal passiert (`heute` → `heute2`,
`finanzen_uebersicht` → `finanzen_uebersicht2`).

Deshalb: Eine neue Kennung bekommt einen `LayoutUmzug` mitgegeben, der alte
Karten-IDs auf neue abbildet (`migriereLayout` in `core/layout.ts`). Zwei Regeln,
beide darauf ausgelegt, im Zweifel nichts wegzunehmen:

- Eine alte ID ohne Eintrag verfällt; mehrere alte dürfen auf dieselbe neue zeigen.
- Beim Zusammenlegen genügt EINE sichtbare Quelle, damit die neue Karte sichtbar
  ist – sonst verschwindet mit „Schlaf & Gewicht" auch die Ernährung.

Geschrieben wird beim Umzug nichts. Die alte Einstellung bleibt stehen, die neue
entsteht erst bei der nächsten Änderung des Nutzers – ein Schreibvorgang während
des Renderns wäre hier sonst kaum zu vermeiden. `tests/layout-umzug.test.ts`
prüft das.

## Schlafimport: zwei Stellen rechnen dieselbe ID

Der Schlaf kommt ueber einen iOS-Kurzbefehl in die Edge Function `schlaf` und von
dort in `sleep_sessions`. Die ID einer Nacht leitet sich aus `day` ab
(`NATUERLICHER_SCHLUESSEL`). Damit ist der Import von selbst wiederholbar - und
genau daran haengt auch die Gefahr:

**App und Edge Function muessen bitgenau dieselbe ID ausrechnen.** Weichen sie ab,
entsteht je Nacht eine zweite Zeile, und weil `day` lokal UNIQUE ist, loescht
`INSERT OR REPLACE` beim Holen still die vorhandene. Derselbe Mechanismus, der
Eriks Ballaststoffwerte verschwinden liess.

Deshalb liegt die Rechnung genau EINMAL in `supabase/functions/_shared/stabileId.ts`;
`src/core/ids.ts` reicht sie nur weiter. Dasselbe gilt fuer die Abdruckbildung der
Importtoken (`_shared/importToken.ts`). Wer dort etwas aendert, aendert beide Seiten
zugleich - `tests/schlaf-import.test.ts` rechnet die Gleichheit nach.

Die Aggregation der Health-Proben steht in `supabase/functions/schlaf/aggregat.ts`
und ist bewusst frei von Deno-Aufrufen, damit die Tests sie laden koennen (wie
`pfade.ts` bei FatSecret). Sie rechnet mit der VEREINIGUNG der Zeitraeume, nicht
mit ihrer Summe: `InBed` ueberlappt die Schlafphasen, und zwei Quellen (Apple Watch
UND Sleep Cycle) schreiben dieselbe Nacht jeweils vollstaendig.

**Eine Schlafqualitaet gibt es in HealthKit nicht.** Sleep Cycle behaelt seine
Prozentzahl in der eigenen App. Was LifeHub daraus machte, waere LifeHubs Zahl -
sie darf nicht als Sleep-Cycle-Wert ausgegeben werden. Die Bewertung leistet der
Zielbereich von `sleep_h`.

**Die Verarbeitung steht in `verarbeite.ts`, nicht in `index.ts`** (seit
30.09.2026). `index.ts` ist nur noch die Deno-Huelle: Umgebung, CORS,
Tabellenzugriff, `Deno.serve`. Autorisierung, Rumpf, Schreibentscheidung und
Rueckgabe liegen in `verarbeite.ts` und sind von
`tests/schlaf-endpunkt.test.ts` aus aufrufbar. Solange das alles in `index.ts`
stand, lief es nur auf Deno - und war damit von keiner Pruefung erreichbar.
Genau dort sassen zwei Fehler:

1. **Eine geloeschte Nacht kam nie zurueck.** Die Abfrage auf die vorhandene
   Zeile las `deleted_at` nicht mit. Lag die Nacht im Papierkorb und schickte
   der Kurzbefehl dieselben Werte noch einmal, entschied der Vergleich auf
   „gleich" - es wurde nichts geschrieben, und die Antwort meldete
   `unveraendert: 1`. In LifeHub blieb die Nacht unsichtbar, bei jedem Versuch
   aufs Neue.
2. **Der Server konnte zwei Zeilen fuer denselben Tag bekommen.** Gesucht
   wurde nur ueber die abgeleitete ID. Lag fuer den Tag eine Zeile mit einer
   ANDEREN ID, legte die Funktion eine zweite an. Auf dem Server stoert das
   niemanden; auf dem Geraet ist `day` UNIQUE, und beim Holen loescht
   `loeseSchluesselkollision()` eine der beiden - moeglicherweise die frisch
   importierte, ohne Meldung. Gesucht wird deshalb ueber `(user_id, day)`.

**Eine einzelne kaputte Probe kippt die Sendung nicht mehr.** Vorher war eine
Probe mit leerem Feld „Wert" ein 400 fuer die ganze Uebertragung - und der
Kurzbefehl schickt drei Tage Apple Health auf einmal. Jetzt faellt der einzelne
Eintrag heraus, wird gezaehlt und in der Antwort benannt
(`empfangen`/`angenommen`/`zurueckgewiesen`/`nicht_deutbar`). Abgewiesen wird
die Sendung nur noch, wenn NICHTS Brauchbares uebrig bleibt - ein „200, 0
Naechte" ohne Erklaerung soll es nicht geben. Streng bleibt die Verpackung:
leerer Rumpf, JSON das keines ist, Hoechstzahl.

**Nach jeder Aenderung unter `supabase/functions/schlaf/` reicht ein Push nicht:**

```
npx supabase functions deploy schlaf --no-verify-jwt
```

`--no-verify-jwt` ist Absicht: Die Anfrage traegt bewusst kein Supabase-Token,
sondern das Importtoken. Geprueft wird in der Funktion, nicht davor.

```
npx vitest run tests/schlaf-endpunkt.test.ts   # Anfrage -> Verarbeitung -> Tabelle
node tests/schlaf-e2e.mjs   # Kurzbefehl -> Edge Function -> Abgleich -> Anzeige
```

## Eindeutige Spalten: die ID muss sich daraus ableiten

Vier Tabellen haben neben der ID einen zweiten eindeutigen Wert – `settings.key`,
`metrics.key`, `day_assignments.day`, `day_notes.day`. Lokal steht das als UNIQUE
im Schema, auf dem Server NICHT. Legen PC und Handy dieselbe Sache unabhängig
voneinander an, nimmt der Server beide Zeilen an, und beim Holen löst SQLite den
UNIQUE-Konflikt auf die schlechteste denkbare Weise: `INSERT OR REPLACE` LÖSCHT
die vorhandene Zeile. Ohne Fehler, ohne Meldung. Alles, was darauf zeigte, zeigt
danach ins Leere.

Genau so sind Eriks Ballaststoff-Tageswerte verschwunden: gespeichert,
synchronisiert – und auf eine Metrik verweisend, die es nicht mehr gab.

Deshalb gilt: **Eine neue eindeutige Spalte gehört in `NATUERLICHER_SCHLUESSEL`
(core/natuerlicheSchluessel.ts).** Dann leitet `insert()` die ID daraus ab, beide
Geräte erzeugen dieselbe Zeile, und es kann gar nicht erst zwei geben. Wer eine
Tabelle mit Verweisen darauf anlegt, trägt die Verweise zusätzlich in
`VERWEISE_AUF` ein – sonst hängen sie beim Auflösen einer Altlast in der Luft.

`tests/natuerliche-schluessel.test.ts` liest die UNIQUE-Spalten aus dem Schema und
schlägt fehl, wenn eine davon in der Liste fehlt.

```
node tests/ballaststoffe-e2e.mjs   # zwei Geraete, eine doppelte Metrik: der
                                   # Wert muss trotzdem dastehen
```

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

## Die Edge Function sieht einen gekuerzten Pfad

Supabase entfernt `/functions/v1`, bevor die Funktion die Anfrage sieht: Innen
steht `/fatsecret/start`, aussen `/functions/v1/fatsecret/start`. Wer daraus
eine Adresse fuer die Aussenwelt baut, erzeugt eine, die es nicht gibt – genau
so ist der OAuth-Rueckweg von FatSecret ins Leere gelaufen
(`{"error":"Requested path is invalid"}`), nachdem die Freigabe schon geklappt
hatte.

Adressen nach aussen deshalb immer aus `SUPABASE_URL` plus ausgeschriebenem
Praefix zusammensetzen, nie aus `url.pathname`. Beides steht in
`supabase/functions/fatsecret/pfade.ts`, und `tests/fatsecret-callback.test.ts`
rechnet es nach.

`pfade.ts` ist bewusst frei von Deno-Aufrufen: `index.ts` selbst laesst sich aus
den Tests nicht laden, und `supabase/` wird von `npx tsc --noEmit` auch nicht
erfasst (tsconfig kennt nur `src` und `tests`).

**Nach jeder Aenderung unter `supabase/functions/` reicht ein Push nicht** – die
Funktion muss eigens veroeffentlicht werden:

```
npx supabase functions deploy fatsecret --no-verify-jwt
```

## Der Protokollimport laeuft MIT JWT-Pruefung

`supabase/functions/wettkampf-import/` liest Wettkampfprotokolle als PDF. Im
Gegensatz zu `schlaf` wird sie OHNE `--no-verify-jwt` veroeffentlicht:

```
npx supabase functions deploy wettkampf-import
```

Der Grund ist der Absender. Der Schlafimport kommt von einem iOS-Kurzbefehl,
der kein Supabase-Anmeldetoken hat und deshalb ein eigenes Importtoken traegt.
Der Protokollimport kommt aus LifeHub selbst, wo Erik ohnehin angemeldet ist -
also prueft Supabase das Token, bevor die Anfrage ankommt.

Die Funktion **schreibt nichts in die Datenbank** und braucht den
Dienstschluessel nicht. Sie gibt Vorschlaege zurueck; gespeichert wird in
LifeHub nach ausdruecklicher Bestaetigung. Die PDF wird nicht abgelegt und
nicht protokolliert.

Die fachliche Logik liegt in `protokoll.ts` daneben und ist frei von Deno- und
PDF-Aufrufen - dasselbe Muster wie `aggregat.ts` beim Schlaf. Nur so laesst
sie sich aus `npm test` laden.

```
node tests/protokoll-integration.mjs   # PDF -> Werte, gegen das echte
                                       # Protokoll; braucht `npm install
                                       # --no-save unpdf`
node tests/turnen-import-e2e.mjs       # der Weg durch die Oberflaeche
node tests/turnen-analyse-e2e.mjs      # Vergleichswerte, Analysereiter,
                                       # 390 px, dunkler Modus, Loeschen
```

### Der Konkurrenzvergleich speichert KEINE fremden Personendaten

Seit dem 25.09.2026 (Phase 2C, Migration 17) rechnet LifeHub beim Import aus,
wo Erik in seinem Teilnehmerfeld stand. Dafuer braucht die Rechnung die anderen
Turner - danach duerfen sie nicht uebrig bleiben. Das haengt an zwei baulichen
Tatsachen, nicht an einer Absicht:

- `VergleichsTeilnehmer` (`core/turnen/vergleich.ts`) hat **kein Feld** fuer
  Name, Jahrgang oder Verein. Eingekocht wird in `ausProtokoll()`
  (`core/turnen/protokollImport.ts`) - das ist die eine Stelle, an der steht,
  was weitergeht.
- `gym_benchmarks` hat **keine Spalte** dafuer. Gespeichert werden Feldgroesse,
  Median, Bestwert, mein Platz und die Zahl der Gleichplatzierten.

Wer dort etwas ergaenzt, aendert beides zugleich. `tests/protokoll-datenschutz.test.ts`
liest die Spalten aus `schema.ts` UND aus `0001_init.sql` und schlaegt fehl,
sobald eine davon ein Personenwort traegt; `turnen-analyse-e2e.mjs` prueft es am
Serverbestand nach dem Abgleich.

**Geraete werden nie ueber rohe Punktzahlen verglichen.** Am Sprung reichten
11,000 fuer den ersten Platz, am Barren reichten 11,633 fuer den vierten.
Gerangt wird ausschliesslich innerhalb derselben Messgroesse an demselben Geraet
(TURNEN_ARCHITEKTUR.md, 16.1).

**`gym_results.rank_apparatus` und `gym_benchmarks.final_rank` sind nicht
dasselbe:** der eine steht im Protokoll, der andere ist eine Rechnung von
LifeHub. Den einen fuer den anderen zu benutzen ist der Fehler, den die getrennte
Tabelle verhindert.

### Der Trainingsfokus rechnet und speichert NICHTS

Seit dem 26.09.2026 (Phase 2D) leitet LifeHub aus Wettkampf, Kuer und Training
Trainingsprioritaeten ab (`core/turnen/trainingsfokus.ts`, angezeigt unter der
Leistungsanalyse im Reiter Analyse). **Es gibt dafuer keine Tabelle und keine
Migration.** Der Fokus aendert sich mit jedem Zaehler, jeder Statusaenderung,
jeder Kueraenderung und jedem Wettkampf - eine gespeicherte Empfehlung waere ab
dem naechsten Training falsch, ohne dass es auffaellt.

**Zwei Ebenen, getrennt gehalten:** Die Geraetepriorität kommt allein aus dem
Wettkampf (Fokus aus 2C, relative Position, Abstand zum Feld), die inhaltliche
Lage allein aus Kuer und Training. Zusammengefuehrt werden sie in einer
ausgeschriebenen Tabelle (`empfehlungAus`), nicht in einem Zahlenwert. Es gibt
keine Gesamtnote.

**Die Stabilitaetsstufen sind eine ABBILDUNG von `statusVorschlag()`** aus
`sicherheit.ts` - keine zweite Rechnung:

    kein Vorschlag (< 10 Versuche)  -> zu_wenig_daten
    sicher                          -> stabil
    unsicher                        -> gemischt
    aufbau                          -> instabil

Damit gelten dort automatisch die vorhandenen Schwellen: Fenster 56 Tage,
mindestens 10 Versuche, 0,9 / 0,6, und Hilfestellung deckelt. Wer eine Schwelle
aendern will, aendert sie in `sicherheit.ts` - nicht daneben.

**Der gesetzte Status zaehlt nicht gegen die eigenen Zahlen.** Beim Anlegen steht
jedes Element auf "neu". Hat es danach 24 von 24 Versuchen sauber, ist "neu" ein
nicht nachgezogener Eintrag und kein Trainingsproblem. Genau das war zuerst
falsch: Die Kuer galt als instabil, obwohl nichts wackelte, weil dieselbe
Tatsache zweimal gezaehlt wurde. `turnen-trainingsfokus-e2e` hat es gefunden.

**Elemente einzeln stabil ist NICHT dasselbe wie "die Kuer steht".**
`gym_attempts` zaehlt Versuche je ELEMENT. Seit Phase 2E gibt es dafuer die
Kuerdurchgaenge (siehe unten) - eine eigene Messgroesse, die neben der
Elementlage steht und nie mit ihr verrechnet wird. Ohne erfasste Durchgaenge
behauptet das Modul weiterhin nirgends, eine Kuer sei "sicher".

**Kein Element verursacht einen Abzug.** Das Protokoll weist Abzuege nicht je
Element aus. Ein auffaelliges Element ist eine BEOBACHTUNG aus dem Training,
keine Ursache der Wettkampfnote - und ein Kandidat ist ein Kandidat, kein
Punktgewinn: Elementgruppen und Anrechnungsgrenzen stehen nicht in LifeHub.
`turnen-trainingsfokus.test.ts` haelt beides am Wortlaut fest.

```
node tests/turnen-trainingsfokus-e2e.mjs   # Import -> Kuer -> Training ->
                                           # der Fokus aendert sich nachvollziehbar
```

### Kuerdurchgaenge sind KEINE Elementversuche

Seit dem 26.09.2026 (Phase 2E, Migration 18) erfasst LifeHub komplette
Kuerdurchgaenge: `gym_routine_runs`, Fachlogik in
`core/turnen/kuerdurchgaenge.ts`, Erfassung im vorhandenen Trainingsweg,
Auswertung im Trainingsfokus.

**Zwei getrennte Messgroessen, zwei Tabellen.** `gym_attempts` zaehlt Versuche
je ELEMENT, `gym_routine_runs` die ganze Uebung am Stueck. Ein Durchgang erzeugt
KEINE gym_attempts - waere es so, saehe eine achtmal geturnte Kuer wie 64
gezielte Elementversuche aus, und die Elementstatistik waere verfaelscht. Ein
abgebrochener Durchgang ist ein vollwertiger Datensatz; gerade die Abbrueche
sind die Auskunft.

**Der Bezug geht auf die FASSUNG, nie auf die lebende Kuer.**
`routine_version_id` zeigt auf `gym_routine_versions` - dieselbe Tabelle und
dieselbe Rechnung wie bei den Wettkampfergebnissen (`fassungen.ts`). Keine
zweite Versionierung. Weil die Fassungs-ID aus dem INHALT kommt, teilen alle
Durchgaenge einer unveraenderten Kuer dieselbe Fassung, und nach einer
Kueraenderung bleiben die alten bei ihrer alten - die Auswertung der aktuellen
Wettkampfkuer zaehlt nur die der JETZIGEN Fassung, die uebrigen stehen getrennt
darunter.

**Gewoehnliche Zufalls-ID, keine abgeleitete** (Grund wie in 13.3): Mehrere
Durchgaenge derselben Kuer in einer Einheit sind der Normalfall.

**Wer im Trainingseditor mehrere Durchgaenge in EINEM Stapel speichert, muss die
in diesem Stapel schon eingefrorenen Fassungen mitfuehren.** `planeFassung()`
prueft gegen `data.gymRoutineVersions`, und das ist ein Abbild von VOR dem
Stapel - ohne diese Liste legte der zweite Durchgang derselben Kuer dieselbe
Fassung erneut an und das Speichern scheiterte mit "UNIQUE constraint failed:
gym_routine_versions.id". Genau der Normalfall war betroffen;
`turnen-kuerdurchgaenge-e2e` hat es gefunden.

**Die Kuerstabilitaet hat EIGENE Schwellen** (0,75 / 0,40 bei mindestens drei
Durchgaengen), nicht die der Elemente (0,9 / 0,6). Eine ganze Uebung am Stueck
durchzubringen ist schwerer als ein einzelnes Element sauber zu turnen. Das
Zeitfenster ist dagegen dasselbe wie ueberall (56 Tage) - keine zweite
Zeitlogik.

**Damit kann Phase 2D erstmals unterscheiden:** Elemente stabil + Kuer instabil
ergibt `kuer_unter_belastung` ("ganze Kuer am Stueck ueben") und NICHT mehr
Schwierigkeit. Ohne erfasste Durchgaenge verhaelt sich die Regel wie in 2D, und
die Begruendung sagt ausdruecklich, dass die Kuerstabilitaet nicht erfasst ist -
Einzelelementdaten gelten nicht als Ersatz.

**Ein Wettkampfergebnis ist kein Trainingsdurchgang.** Aus `gym_results`
entsteht nie ein `gym_routine_run`; das Modul kennt die Wettkampftypen nicht
einmal. Am Quelltext geprueft.

```
node tests/turnen-kuerdurchgaenge-e2e.mjs   # erfassen -> auswerten -> Kuer
                                            # aendern -> alte Fassung bleibt
                                            # historisch getrennt
```

### Der Trainingsvorschlag ist eine Umsortierung, keine neue Rechnung

Seit dem 28.09.2026 (Phase 3A) beantwortet LifeHub "was turne ich heute?":
`core/turnen/trainingsplanung.ts`, angezeigt als Block **Naechstes Training**
oben auf Turnen -> Uebersicht (`screens/turnen/NaechstesTraining.tsx`).
**Keine Tabelle, keine Migration, kein neuer Reiter.**

**Das Modul rechnet nichts neu.** Es nimmt `trainingsfokus()` aus 2D fertig
entgegen und ordnet es um: Der Fokus ist nach GERAET gebaut, um zu erklaeren, wo
etwas liegenbleibt - ein Trainingsvorschlag ist nach EINHEIT gebaut. Es hat
darum keine eigene Stabilitaetsschwelle, keine zweite Zeitlogik (Wartung nutzt
dieselben 28 Tage wie `KUER_SCHWELLEN.langeHerTage`) und keine Punktzahl ueber
Geraete. Neu sind nur Auswahl- und Reihenfolgeregeln, und die stehen
ausgeschrieben in `PLAN_SCHWELLEN` und `reihenfolgeArtFuer`.

**Hoechstens drei Geraete, hoechstens zwei Schwerpunkte.** Die Reihe entsteht aus
Prioritaet, dann "am laengsten nicht trainiert", dann Wettkampfreihenfolge. Der
zweite Schluessel ist der Grund, warum kein Geraet wochenlang verschwindet.
Dazu ein **Wartungsplatz**: Eine Staerke (`halten`/`zu_wenig_daten`), die seit
28 Tagen nicht angefasst wurde, bekommt den letzten Platz und verdraengt
hoechstens einen Nebenfokus - nie einen Schwerpunkt.

**Drei Arten von Inhalt, und die Bedingungen kommen aus 2D:** Elementarbeit aus
den auffaelligen Kuerelementen, Entwicklungsarbeit NUR bei der Empfehlung
`schwierigkeit_pruefen`, Kuerdurchgaenge aus der Kuerstabilitaet. Die
Reihenfolge im Geraet folgt ebenfalls der 2D-Empfehlung
(`kuer_unter_belastung` -> Kuer zuerst) - nicht ueberall dieselbe.

**Ohne Trainingsdaten gibt es KEINE Elementempfehlung.** Ohne einen einzigen
erfassten Versuch faellt jedes Kuerelement automatisch als "nie trainiert" auf;
daraus eine Liste zu bauen saehe nach Auskunft aus, waere aber nur die
Feststellung, dass nichts erfasst ist. Das steht als Hinweis daneben. Ein
Kuerdurchgang ist trotzdem moeglich - er ist keine Elementempfehlung.

**Keine erfundenen Mengen und KEINE Zeitplanung.** Der Umfang ist
`kurz`/`normal`/`schwerpunkt`; die einzige Zahl steht am Kuerdurchgang und ist
eine Spanne von hoechstens zwei. Es gibt keine Trainingsdauer, keine Minuten je
Geraet und keinen Verteilungsschluessel - "90 Minuten -> 40/40/10" sieht nach
einer Rechnung aus, hinter der keine steht. Eine solche Verteilung war gebaut
und wurde vor dem Commit als Scope-Ueberschreitung wieder entfernt;
`turnen-trainingsplanung.test.ts` prueft am Quelltext, dass sie nicht
zurueckkommt. Zeit gehoert zu Phase 5.

**Die Auswahlregeln sind eine Produktheuristik**, keine
trainingswissenschaftlich optimale Verteilung: Drei Geraete, zwei Schwerpunkte
und 28 Tage sind eine Verabredung und stehen an einer Stelle
(`PLAN_SCHWELLEN`).

**Nichts wird gespeichert - auch nicht die Wahl des Nutzers.** Abwaehlen,
Umstellen, Entfernen und Dazunehmen gehen durch `planMitAuswahl()`, eine reine
Funktion auf dem Arbeitsspeicherzustand der Komponente. Deshalb rechnet
`trainingsplanung()` die Inhalte ALLER sechs Geraete: Ein nachtraeglich
gewaehltes Geraet hat sofort etwas anzuzeigen, ohne zweite Rechnung. Am Handy
steht wieder der volle Vorschlag, auch wenn am PC eben etwas abgewaehlt wurde.

**Erfasst wird mit dem vorhandenen Weg** (`gym_attempts`, `gym_routine_runs`).
Es gibt keine zweite Trainingserfassung und keinen "Plan erledigt"-Zustand.
Der Plan sagt WAS, nicht WANN - Kalender, Schichtplan und Termine bleiben
Phase 5.

```
node tests/turnen-trainingsplanung-e2e.mjs   # ohne Daten -> gutes Training ->
                                             # abgebrochene Durchgaenge ->
                                             # schlechtes Training: der
                                             # Vorschlag reagiert jedes Mal
```

### Die Wochenplanung verteilt nur - sie bewertet nichts neu

Seit dem 28.09.2026 (Phase 3B) beantwortet LifeHub "an welchen kommenden
Trainingstagen setze ich welche Schwerpunkte?": `core/turnen/wochenplanung.ts`,
angezeigt als zweite Ansicht **Kommende Einheiten** im Block Naechstes Training
(`screens/turnen/Wochenplan.tsx`). **Keine Tabelle, keine Migration.**

**Ein Turntermin ist eine `workout_sessions`-Zeile mit `status = 'planned'` und
`discipline = 'turnen'`** - dieselbe Tabelle wie die absolvierten Einheiten und
dieselbe Statuslogik, die `Tracking` und `Heute` schon benutzen. Es gibt deshalb
keinen zweiten Kalender, keine Wochentagsliste im Quelltext und kein eigenes
Terminmodell. Ein hier geplanter Termin erscheint von selbst unter Tracking ->
Geplant und auf Heute.

**Warum nicht aus `workout_plan_days`?** Geprueft: Die Tabelle kennt keine
Disziplin - ob ein Plantag Turnen oder Kraft ist, steht nur im freien Text.
Tagesarten unterscheiden Arbeit/frei, Kalendereintraege und Aufgaben sind freier
Text. Raten waere schlechter als fragen, deshalb gibt es eine kleine
Anlegemoeglichkeit in der Wochenansicht.

**Der Trainingseditor unter `Tracking` setzt die Disziplin mit** (seit
30.09.2026). Vorher konnte er sie nicht setzen, und eine dort angelegte Einheit
blieb ohne `discipline` - der Turnenbereich kannte sie damit nicht: Ein
geplanter Turntermin fehlte in den kommenden Einheiten, eine erfasste Einheit
fehlte unter "Einheiten gesamt". Zugeordnet wird ueber das Feld, NICHT ueber den
Titel - "Turntraining" hinzuschreiben ist eine Vermutung, keine Zuordnung. Beim
Bearbeiten ist der Anfangswert die eigene Disziplin der Einheit, sonst ginge sie
beim Speichern verloren. `turnen-wochenplanung-e2e` prueft beides (Anlegen und
Bearbeiten).

**`status` trennt geplant von durchgefuehrt, an einer Stelle.** Der
Turnen-Speicherweg setzt beim Erfassen `status: 'completed'` - ohne diese Zeile
bliebe eine erfasste Einheit auf "planned" stehen und wuerde erneut verplant. Ein
vergangener Termin ohne Erfassung gilt als ueberfaellig, nicht als absolviert.
Die Turnuebersicht zaehlt fuer "Letzte Einheit" und "Einheiten gesamt" nur
Einheiten, die NICHT geplant sind - sonst stuende "Letzte Einheit" in der
Zukunft.

**Der Zeitraum sind die kommenden 14 Tage, kein Kalenderausschnitt.** Bewusst
gegen die vorhandene Montagswoche: Eine feste Woche zeigte am Samstag fast nichts
mehr. Es entsteht dabei KEIN neuer Datumshelfer - gerechnet wird mit
`tagDifferenz`, beschriftet mit `relativeDay()` und `weekdayLong()`. Der Test
prueft am Quelltext, dass kein `new Date()` und kein `86400000` im Modul steht.

**Verteilt wird reihum**, hoechstens drei Geraete und zwei Schwerpunkte JE
EINHEIT (die Phase-3A-Heuristik gilt weiter und wird nicht angehoben, auch nicht
fuer eine lange Einheit). Die Reihe und die Rollenabbildung sind aus
`trainingsplanung.ts` IMPORTIERT (`nachDringlichkeit`, `rolleAus`) - eine zweite
Sortierregel waere eine zweite Antwort auf dieselbe Frage. Bei genau einem Termin
gilt der Phase-3A-Vorschlag unveraendert. Was nicht passt, steht unter "Noch
offen" und verschwindet nicht.

**Dieselbe Kuer darf mehrfach**, aber nur wenn die Kuer das Problem ist
(`kuer_zuerst`), nur mit dem Durchgang - und nur, wenn nichts offen geblieben
ist. Ein Geraet zweimal zu bringen, waehrend ein anderes gar nicht vorkommt,
waere die schlechtere Verteilung; der Unit-Test hat das gefunden.

**Tagesart und freie Zeit sind Kontext, keine Bedingung.** Beides kommt aus dem
vorhandenen `computeCapacity()` und wird nur angezeigt. Die freie Zeit begrenzt
die Plaetze ausdruecklich NICHT - sonst haengte Turnen am gepflegten
Arbeitsplan. Nur eine an der Einheit hinterlegte Dauer tut das (kurz/normal/lang,
keine Minuten je Geraet). Und keine physiologischen Aussagen zu Schichten.

**Nichts wird gespeichert ausser den Terminen selbst** - auch nicht die
Nutzerwahl (verschieben, tauschen, entfernen, einplanen). Sie geht durch
`wocheMitAuswahl()`, eine reine Funktion. Nach dem ersten absolvierten Training
aendert sich der Fokus, und der Rest der Woche muss sich aendern duerfen.

```
node tests/turnen-wochenplanung-e2e.mjs   # Termine anlegen -> verteilt ->
                                          # erste Einheit erfassen -> Termin
                                          # geschlossen, zweite reagiert
```

## FatSecret laeuft von selbst

Seit dem 13.09.2026 holt LifeHub die Ernaehrung ohne Knopfdruck: `automatisch()`
in `state/ernaehrung.ts`, angestossen aus `App.tsx` beim Start, beim Zurueck-
kehren ins Fenster und bei Wieder-online. Einen Zeitgeber gibt es NUR, solange
der Erstimport laeuft (`automatikTaktMs`). Der Knopf bleibt fuer den Notfall.

Zwei Dinge laufen dort getrennt:

  laufend      Die letzten Tage erneut holen (dort wird nachgetragen und
               korrigiert). Wie lange der letzte Abruf her sein muss, haengt
               am Anlass (`MINDESTABSTAND_MS`: Start 15 s, Vordergrund/online
               5 min) und wird je GERAET gemessen (localStorage), nicht am
               synchronisierten `zuletzt` - sonst ueberspringt das Handy beim
               Oeffnen das Fruehstueck, weil der PC eben abgeglichen hat.
               `fatsecret-alltag-e2e.mjs` prueft genau das.
  historisch   Monat fuer Monat rueckwaerts. `food_entries.get_month.v2`
               nennt je Monat NUR die Tage mit Eintraegen, deshalb kostet ein
               Jahr zwoelf Aufrufe statt 365.

**Wie weit „die letzten Tage" zurueckreichen, ist gerechnet und nicht
festgeschrieben** (`nachlaufTage` in `core/fatsecretImport.ts`, seit
30.09.2026). Vorher waren es immer genau drei. Drei decken ab, was in
FatSecret nachgetragen wird - nicht aber, dass LifeHub eine Woche lang nicht
geoeffnet wurde: Die vier Tage davor wurden nie geholt und blieben dauerhaft
leer, und der Historienlauf half nicht, denn der galt als „fertig". Gerechnet
wird jetzt ab dem letzten wirklichen Abruf DIESES Geraets: mindestens drei
Tage, hoechstens ein Monat. Das ist keine Verlaengerung ins Blaue - der
Zeitraum IST die entstandene Luecke, und im Alltag bleibt es bei drei Tagen.
Wer mehr braucht, nimmt den Historienlauf.

**„Kein Eintrag" und „keine Antwort" sind zwei verschiedene Dinge.** Beide
ergeben nach dem Auswerten eine leere Liste, die Folgen sind aber
gegensaetzlich: Ein leerer Tag heisst „in FatSecret geloescht, hier also
auch", und der Abgleich raeumt die Mahlzeiten UND die Tageswerte dieses Tages
ab. Kam zu einem Tag nur keine lesbare Antwort - Wartungsseite, abge-
schnittener Rumpf, Netzwackler -, war das Datenverlust auf Ansage, gemeldet
als „1 Tag abgeglichen". Entschieden wird das jetzt an einer Stelle
(`pruefeTagesantwort` in `core/fatsecret.ts`): Eine Antwort ist brauchbar,
wenn sie ein Objekt ist; ein leeres Objekt zaehlt dazu. Die Edge Function
nimmt unlesbare Tage aus `days` heraus und nennt sie unter `unlesbar`, der
Client ueberspringt sie, zaehlt sie (`AbgleichErgebnis.unvollstaendig`) und
meldet den Lauf als unvollstaendig - `ok` ist nur wahr, wenn JEDER angefragte
Tag verarbeitet wurde.

**Der Historienlauf hakt keinen Monat ab, dessen Tage nicht angekommen sind.**
Sonst wandert `geprueftBis` ueber die Luecke hinweg, der Lauf erreicht
„fertig", und die fehlenden Tage holt niemand mehr.

Der Fortschritt steht in `settings.fatsecret_import` - also im mitsynchro-
nisierten Einstellungsspeicher. Das ist Absicht: Das Handy macht dort weiter,
wo der PC aufgehoert hat, statt die Historie ein zweites Mal zu holen.

**Ein Ende gibt es nicht zu erfragen.** FatSecret nennt kein Anlegedatum des
Kontos. Der Lauf hoert nach zwoelf leeren Monaten in Folge auf, und zusaetzlich
an einem festen Boden. Wer die Zahl senkt, riskiert, dass eine laengere Pause
die halbe Historie abschneidet.

`sync-ganzzahlen-e2e.mjs` hat einen FEST eingetragenen Altstand (89caf3f), im
Gegensatz zu `migration-e2e.mjs`: Er prueft einen bestimmten historischen
Fehler, nicht Migrationen allgemein.

## Nachladen: nur die betroffene Tabelle

`loadAll()` las bis zum 13.09.2026 bei JEDER Aenderung alle rund vierzig
Tabellen neu ein. Bei einer kleinen Datenbank faellt das nicht auf. Mit drei
Jahren Ernaehrungshistorie sind es rund 23.000 Zeilen - und der historische
FatSecret-Import schreibt sie einzeln. Gemessen: Die Seite **stuerzte ab**,
bevor sechs Monate importiert waren.

Jetzt gilt:

- `LADER` in `state/store.tsx` ordnet jede Tabelle ihrem Platz im Datenbild zu.
  `loadAll()` baut sich daraus zusammen - die Abfragen stehen an EINER Stelle.
- Eine Mutation laedt nur ihre eigene Tabelle nach (`beruehrt`).
- Wer in einer Schleife schreibt, nimmt `mutations.batch(...)`: eine
  Datenbanktransaktion, ein Nachladen am Ende, nur fuer die beruehrten
  Tabellen.

**Neue Schleife, die schreibt? Immer in `batch` packen.** Sonst kehrt das
Problem an dieser Stelle zurueck, ohne dass irgendwo ein Test rot wird - es
wird einfach langsam. Vorhandene Beispiele: der FatSecret-Import
(`state/ernaehrung.ts`), die Automatik (`state/automatik.ts`), die
Dublettenzusammenfuehrung (`state/dubletten.ts`), "Von gestern uebernehmen"
(`screens/Tracking.tsx`).

`db.export()` ist nachgemessen und KEIN Problem: bei 23.100 Zeilen (2 MB)
unter 1 ms, weil es nur den WASM-Speicher kopiert. Das Schreiben nach
IndexedDB ist ohnehin auf 250 ms gedrosselt.

Gemessen wird mit `node tests/performance-benchmark.mjs [monate]`. Der Lauf
bringt seinen eigenen Server mit und treibt den echten Importpfad. Fuer einen
Vorher/Nachher-Vergleich: `LIFEHUB_HTML=<andere.html>`.

## Wiederkehrende Aufgaben: die Invariante

Fuer jede aktive Vorlage und jeden lokalen Kalendertag gilt:

> **Ist die Vorlage an diesem Tag faellig, steht ihre regulaere Tagesinstanz an
> diesem Tag genau einmal zur Verfuegung.**

„Regulaer" heisst: die Zeile mit der wiederholbaren ID
(`templateTaskId(vorlage, tag)`). Eine unerledigte Aufgabe von gestern, die
der Tagesuebertrag mitgenommen hat, steht daneben zu Recht auch an einem Tag,
an dem die Vorlage gar nicht faellig waere - das ist der Sinn des Uebertrags
und kein Verstoss gegen die Invariante.

Daraus folgt, was NICHT passieren darf:

- Eine Vortagesaufgabe blockiert eine neue Faelligkeit.
- Eine erledigte Tagesinstanz verhindert die naechste Wiederholung.
- Ein App-Neustart verliert Aufgaben.
- PC und Handy erkennen verschiedene Tagesinstanzen.
- Wiederholtes Rechnen oder Abgleichen erzeugt Dubletten.

`tests/vorlagen-faelligkeit.test.ts` prueft das ueber 14 Tage, fuer jede Art
von Vorlage (taeglich, Wochentag, Tagesart, mehrwoechig, deaktiviert), ueber
Monats- und Jahreswechsel, ueber beide Zeitumstellungen und mit zwei Geraeten.
Die Nachbildung bildet zwei Dinge ab, die `vorlagen-taeglich.test.ts` nicht
kennt und ohne die der Fehler nicht auftritt:

1. **Der Tagesuebertrag rechnet auf einer veralteten Momentaufnahme.**
   `state/automatik.ts` liest `stand.tasks` EINMAL am Anfang eines Laufs, ruft
   dann den Abgleich (der schreibt) und danach `carryOverPatches` - mit der
   Liste von vorhin.
2. **Die Schleifensperre.** Dieselbe Aenderungsliste zweimal hintereinander
   wird nicht ausgefuehrt. Im Ernstfall wuerde damit genau das unterbleiben,
   worum es geht: das Anlegen der heutigen Aufgabe.

**Ein Rhythmus braucht einen festen Bezugstag.** `vorlageGiltAm()` nahm bei
fehlendem `anchor_date` HEUTE als Bezug - und der wandert taeglich mit. Eine
zweiwoechige Vorlage war damit jeden Tag faellig, denn von heute aus liegt
heute immer in Woche 0. Schlimmer noch: Die Aufgaben, die gestern fuer
naechste Woche entstanden waren, raeumte der Abgleich heute als „Tag passt
nicht mehr" wieder ab - und eine geloeschte Zeile sperrt ihren Tag dauerhaft
gegen ein Neuanlegen (`belegt`). Der Bezug ist jetzt `ankerTag()`:
Ankerdatum, sonst der Anlegetag der Vorlage.

**Ein Tag, den die Automatik selbst geraeumt hat, bleibt heilbar.** Eine
geloeschte Zeile sperrt ihren Vorlagentag dauerhaft gegen ein Neuanlegen
(`belegt` zaehlt auch geloeschte Zeilen mit) - richtig, solange ERIK die
Aufgabe geloescht hat. Raeumt die Automatik sie selbst ab, weil die Vorlage
den Tag gerade nicht mehr will, und will die Vorlage den Tag spaeter wieder,
blieb der Tag fuer immer leer. Ein Tagesarttausch hin und zurueck genuegte,
und eine pausierte und wieder eingeschaltete Vorlage kam nie zurueck.

Unterschieden wird an den vorhandenen Zeitstempeln, ohne neues Feld
(`VorlagenPlan.wiederherstellen`): Die Zeile lebt wieder auf, wenn NACH ihrer
Loeschung etwas geaendert wurde, das den Tag wieder faellig macht - die
Vorlage selbst (`updated_at`) oder, bei einer an eine Tagesart gebundenen
Vorlage, die Zuordnung dieses Tages. Loescht Erik eine Aufgabe von Hand,
aendert sich danach nichts davon, und sie bleibt geloescht. Deshalb muessen
die Tageszuordnungen ihr `updated_at` mitbringen (`state/automatik.ts`).

**Heute und Planner nehmen dieselbe Fachlogik.** `tasksForDay()` entscheidet,
welche Aufgaben an einem Tag stehen - auf „Heute", in der Tagesansicht UND in
der Wochenansicht. Dort stand bis zum 30.09.2026 eine eigene Zeile
(`data.tasks.filter(t => t.scheduled_on === d)`), und die war in beide
Richtungen daneben: Sie zeigte fuer heute die Aufgaben mit, die „Heute"
bewusst verdeckt, zaehlte abgesagte in die Auslastung und liess weg, was
liegengeblieben ist oder eine Frist hat. Zwei Bildschirme sagten ueber
denselben Tag Verschiedenes.
