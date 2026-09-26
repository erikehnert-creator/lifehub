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

`npm test` muss grün sein (aktuell 1.609 Tests). `npx tsc --noEmit` muss fehlerfrei
sein.

Auf Eriks Rechner sind es **1.628**: `tests/turnen-vergleich-echt.test.ts` rechnet
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

**Nach jeder Aenderung unter `supabase/functions/schlaf/` reicht ein Push nicht:**

```
npx supabase functions deploy schlaf --no-verify-jwt
```

`--no-verify-jwt` ist Absicht: Die Anfrage traegt bewusst kein Supabase-Token,
sondern das Importtoken. Geprueft wird in der Funktion, nicht davor.

```
node tests/schlaf-e2e.mjs   # Anzeige, Tageswert, zweiter Abgleich, PC<->Handy
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

**Was LifeHub NICHT weiss: ob eine Kuer am Stueck geturnt wurde.**
`gym_attempts` zaehlt Versuche je ELEMENT je Einheit; dass sie eine
zusammenhaengende Kuer waren, steht nirgends und laesst sich nicht ableiten.
Deshalb behauptet das Modul nirgends, eine Kuer sei "sicher" oder
"durchturnfaehig" - beurteilt werden die Elemente einzeln, und die Oberflaeche
sagt das mit. Wollte man es wissen, braeuchte es eine eigene Erfassung fuer
Durchgaenge; das ist eine eigene Phase.

**Kein Element verursacht einen Abzug.** Das Protokoll weist Abzuege nicht je
Element aus. Ein auffaelliges Element ist eine BEOBACHTUNG aus dem Training,
keine Ursache der Wettkampfnote - und ein Kandidat ist ein Kandidat, kein
Punktgewinn: Elementgruppen und Anrechnungsgrenzen stehen nicht in LifeHub.
`turnen-trainingsfokus.test.ts` haelt beides am Wortlaut fest.

```
node tests/turnen-trainingsfokus-e2e.mjs   # Import -> Kuer -> Training ->
                                           # der Fokus aendert sich nachvollziehbar
```

## FatSecret laeuft von selbst

Seit dem 13.09.2026 holt LifeHub die Ernaehrung ohne Knopfdruck: `automatisch()`
in `state/ernaehrung.ts`, angestossen aus `App.tsx` beim Start, beim Zurueck-
kehren ins Fenster und bei Wieder-online. Einen Zeitgeber gibt es NUR, solange
der Erstimport laeuft (`automatikTaktMs`). Der Knopf bleibt fuer den Notfall.

Zwei Dinge laufen dort getrennt:

  laufend      Heute, gestern, vorgestern erneut holen (dort wird nachgetragen
               und korrigiert). Wie lange der letzte Abruf her sein muss, haengt
               am Anlass (`MINDESTABSTAND_MS`: Start 15 s, Vordergrund/online
               5 min) und wird je GERAET gemessen (localStorage), nicht am
               synchronisierten `zuletzt` - sonst ueberspringt das Handy beim
               Oeffnen das Fruehstueck, weil der PC eben abgeglichen hat.
               `fatsecret-alltag-e2e.mjs` prueft genau das.
  historisch   Monat fuer Monat rueckwaerts. `food_entries.get_month.v2`
               nennt je Monat NUR die Tage mit Eintraegen, deshalb kostet ein
               Jahr zwoelf Aufrufe statt 365.

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
