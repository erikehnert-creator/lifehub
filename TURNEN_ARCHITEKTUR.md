# Turnen in LifeHub – Architektur und Umsetzungsplan

**Stand:** 22.09.2026 · **Phase 1, 1.1, 2A, 2B1 und 2B2 umgesetzt** (Migrationen 14, 15 und 16,
Bereich `#/turnen` mit allen fünf Reitern, Protokollimport über eine Edge Function).
**Geklärt:** Kür mit D-Wert · Erfassung je Element mit Zählern · Protokolle als PDF.

**Die Phasen 2 und 3 haben die Plätze getauscht.** Die Küren kamen am 21.09.2026 vor
den Wettkämpfen an die Reihe, weil sie ohne Wettkampfdaten nützlich sind, die
Wettkämpfe ohne Küren aber nur halb (der Verweis auf die geturnte Kür hätte ins
Leere gezeigt). Aus Phase 3 wurde damit **Phase 2A**, aus Phase 2 **Phase 2B**.

**Phase 2B ist anschliessend in zwei Teile zerfallen:** **2B1** (Wettkämpfe,
Ergebnisse, unveränderliche Kürfassungen) und **2B2** (PDF-Import) sind seit
dem 22.09.2026 beide umgesetzt. Am Umfang ändert das nichts, nur an der
Reihenfolge.

Dieses Dokument hält fest, was der Bestand hergibt, welches Datenmodell daraus folgt und
in welchen Schritten das Turnen-Modul entstehen soll. Es ist die Grundlage für alle
weiteren Sitzungen zu diesem Thema.

---

## 1. Was im Bestand schon da ist – und was davon lebt

Vor dem Entwurf steht die Bestandsaufnahme. Sie fällt unangenehmer aus als erwartet.

### 1.1 Die Trainingstabellen

| Tabelle | Zustand | Wer benutzt sie |
|---|---|---|
| `workout_sessions` | **lebendig** | Heute, Tracking → Training, Analysen, Jahresheatmap |
| `workout_plans` | **lebendig (nur lesend)** | `usePlannedWorkout` auf Heute |
| `workout_plan_days` | **lebendig (nur lesend)** | dito |
| `exercises` | **tot** | nirgends – 15 Zeilen aus dem Beispielbestand |
| `workout_plan_exercises` | **tot** | nirgends |
| `workout_sets` | **tot** | nirgends |

Nachgeprüft: `workout_sets`, `exercises` und `workout_plan_exercises` tauchen außerhalb
von `db/schema.ts`, `db/seed.ts` und dem Lader in `state/store.tsx` in **keiner einzigen
Bildschirmdatei** auf. Sie werden angelegt, geladen und über den Abgleich hin- und
hergeschoben – gelesen werden sie nie.

**Das ist die wichtigste Lehre dieser Analyse.** Es gab schon einmal ein ausführlich
entworfenes Trainingsdatenmodell mit Übungen, Sätzen und Planübungen. Es ist nie benutzt
worden, weil das Erfassen offenbar zu aufwendig war. Ein Turnen-Modul, das jeden Versuch
an jedem Element einzeln eintragen lässt, läuft in genau dieselbe Falle – nur mit mehr
Tabellen.

Daraus folgt die oberste Entwurfsregel für dieses Modul:

> **Die Erfassung entscheidet über den Erfolg, nicht das Datenmodell.**
> Wenn das Festhalten eines Trainings am Handy länger als eine Minute dauert, ist das
> Modul tot – egal wie gut die Auswertung wäre.

### 1.2 Was `workout_sessions` bereits kann

```
day, plan_day_id, title, type, started_at, ended_at,
duration_minutes, status, perceived_effort, note
```

Damit ist die Trainingseinheit als solche bereits vollständig abgebildet, und sie hängt
schon überall drin: in der Heute-Karte „Training", in der Statistik „Einheiten (30 Tage)",
in der Jahresheatmap und in `Analysen`. **Eine zweite Sitzungstabelle fürs Turnen würde
alle diese Zahlen spalten** – „Trainingstage" wäre plötzlich zweierlei.

### 1.3 Der Rest der Architektur

| Baustein | Was er kann | Bedeutung fürs Turnen |
|---|---|---|
| `day_types` + `day_assignments` | Schichten je Tag (Früh/Spät/Nacht/BS/Frei) | Grundlage der Trainingsplanung |
| `task_templates` + `core/automation.ts` | „jeden Dienstag, nur bei Spätschicht" → legt Aufgaben an | Montag Übungen / Mittwoch neue Elemente lässt sich damit abbilden |
| `core/planner.ts` | `freeSlots`, `computeCapacity`, `wakingWindow` | „wann passt Training in den Tag" |
| `core/zusammenhaenge.ts` | verzögerte Korrelation, `MINDESTTAGE = 20`, p-Wert für Mehrfachtests korrigiert | die Messlatte für jede Aussage – siehe 6.2 |
| `core/insights.ts` | Hinweise mit Herleitung und Vorbehalt | Muster für Turn-Hinweise |
| `ui/components.tsx` | Card, Stat, Tabs, Segment, Chips, Meter, Empty, Modal, Field, Confirm, StatusPill, Collapsible, DurationInput | reicht für das ganze Modul – keine neuen Bauteile nötig |
| `charts/index.tsx` | BarChart, LineChart, DonutChart, Sparkline, Meter, YearHeatmap, RankBars, ChartFrame | dito |
| `attachments` | Dateien an beliebige Zeilen | **stark eingeschränkt, siehe 1.4** |

### 1.4 Anhänge: die harte Grenze

`src/io/files.ts` setzt `MAX_ATTACHMENT_BYTES = 4 MB`, und `ui/attachments.tsx` schreibt
die Datei als **Base64 in die synchronisierte Tabelle** (`attachments.data_url`).
`remote_path` und `upload_state` existieren als Spalten, werden aber nie gefüllt –
Supabase Storage ist **nicht** angebunden (`upload_state` steht immer auf `'local'`).

Folgen:

- **Videos von Elementen sind über diesen Weg unmöglich.** Ein 20-Sekunden-Video vom
  Handy hat 30–80 MB, Base64 macht daraus 40–110 MB, und es liefe durch jeden Abgleich.
  Bei 23.000 Ernährungszeilen ist die App schon einmal abgestürzt; das hier wäre
  schlimmer.
- **Ein Foto eines Wettkampfprotokolls passt**, wenn es vorher verkleinert wird
  (~1–3 MB). Jedes Foto vergrößert aber dauerhaft die synchronisierte Datenbank.

→ Video im Element: **nur als Verweis** (`video_url`, z. B. YouTube, iCloud-Link,
Dateien-App). Echte Dateiablage erst, wenn Supabase Storage angebunden ist – das ist ein
eigenes Vorhaben, nicht Teil des Turnen-Moduls.

### 1.5 Was jede neue Tabelle kostet

`sync/engine.ts` läuft dreimal über `SYNCED_TABLES` (senden, holen, aufräumen) – eine
Anfrage je Tabelle. Derzeit sind es **47 Tabellen**. Beim Schlafmodul haben zwei neue
Tabellen den vollen Abgleich messbar um rund 5 % verlängert (6.383 → 6.960 ms im
Benchmark).

Sechs Turn-Tabellen auf einmal wären also rund +13 % auf jeden Abgleich. Das ist kein
Ausschlusskriterium, aber ein Grund, **die Tabellen in Phasen einzuführen und nach jeder
Phase zu messen** – nicht alle sechs auf Vorrat anzulegen.

---

## 2. Die Entwurfsentscheidungen

### 2.1 Eine Sitzung, zwei Detailebenen

**Entscheidung: `workout_sessions` bleibt die einzige Trainingseinheit.**

```
                    workout_sessions
                  (Tag, Dauer, Anstrengung, Notiz, Status)
                            │
              ┌─────────────┴─────────────┐
              │                           │
        workout_sets                 gym_attempts
     (Kraft: Sätze, Wdh., kg)    (Gerät: Element, Versuche, Güte)
      — existiert, bisher tot —          — neu —
```

Das ist ausdrücklich **keine zweite Trainingsdatenbank**: Die Sitzungs- und Planebene
ist geteilt, nur die Detailtabellen unterscheiden sich – so wie sie sich für jede zwei
Sportarten unterscheiden würden. Ein Freitag mit Kraft und Kondition benutzt
`workout_sets` (und weckt damit endlich die tote Struktur), ein Mittwoch am Gerät
benutzt `gym_attempts`. Eine Einheit darf beides haben.

**Warum `exercises` NICHT als Elementkatalog dient:** Die Spalten dort
(`tracks_weight`, `tracks_reps`, `muscle_groups`, `is_bodyweight`) sind für ein
Turnelement allesamt bedeutungslos, und die fachlichen Felder eines Elements (Gerät,
Wertigkeit, Elementgruppe, Sicherheitsstand) fehlen vollständig. Die Tabelle
„wiederzuverwenden" hieße, sieben leere Spalten mitzuschleppen und sieben neue
anzuhängen – bei null geerbtem Code, weil `exercises` nirgends benutzt wird. Der Gewinn
wäre eine gesparte Tabelle, der Preis wären zwei Begriffe in einem Topf.

`exercises` behält seine Rolle für **Kraft und Kondition** und wird dort später endlich
gefüllt.

### 2.2 Wie eine Einheit als Turntraining erkennbar wird

Eine neue, freiwillige Spalte auf `workout_sessions`:

```sql
ALTER TABLE workout_sessions ADD COLUMN discipline TEXT;   -- 'turnen' | 'kraft' | NULL
```

Nicht über `type`: Dort steht heute der Schwerpunkt aus dem Trainingsplan („Kraft",
„Ganzkörper") als freier Text. Denselben Platz mit einer Bedeutungsangabe zu belegen,
wäre genau die Sorte Magic String, die später niemand mehr auseinanderhält.

Eine Einheit ohne Versuche soll trotzdem als Turntraining zählen können – deshalb eine
Spalte und nicht „hat Versuche".

### 2.3 Die neuen Tabellen

Sechs insgesamt, aber **nicht auf einmal** (Phasen siehe Abschnitt 8).

#### `gym_elements` — der Elementkatalog

```
id, name, apparatus, difficulty_letter, difficulty_value,
element_group, status, video_url, note, is_active, sort_order
```

| Feld | Bedeutung | Anmerkung |
|---|---|---|
| `apparatus` | `boden`, `pauschenpferd`, `ringe`, `sprung`, `barren`, `reck` | Zeichenkette, keine Fremdschlüsseltabelle – siehe 2.4 |
| `difficulty_letter` | `A`…`I` | frei, weil vom Wertungssystem abhängig (offene Frage 1) |
| `difficulty_value` | 0.1 … | numerisch, damit sich summieren lässt |
| `element_group` | I…V | bei Kür relevant, bei Pflicht leer |
| `status` | `neu`, `aufbau`, `unsicher`, `sicher`, `wettkampfreif` | der Stand, den **du** setzt |
| `video_url` | Verweis | keine Datei, siehe 1.4 |

**Bewusst NICHT gespeichert**, sondern gerechnet: „zuletzt trainiert",
„Trainingshäufigkeit", „Trefferquote". Das sind Ableitungen aus `gym_attempts`. Sie als
Spalten zu führen hieße, sie bei jedem Training nachziehen zu müssen – und der erste
vergessene Nachzug macht sie still falsch.

**Zusätzlich fachlich sinnvoll** (über die Anforderung hinaus, aber ohne Ballast):

- `is_dismount` (Abgang) — bei Küren zählt der Abgang gesondert
- `hold_element` (Haltekraftteil) — an Ringen der eigene Trainingsgegenstand
- `prerequisite_element_id` — „Vorübung für". Macht später die Empfehlung klüger
  („für X fehlt dir noch Y"), kostet jetzt nur eine Spalte.

Vorgeschlagen wird, `is_dismount` und `hold_element` aufzunehmen und
`prerequisite_element_id` erst in Phase 3, wenn die Empfehlung gebaut wird.

#### `gym_attempts` — was in einer Einheit an einem Element passiert ist

```
id, session_id, element_id, attempts, clean, shaky, failed,
with_help, note, sort_order
```

Eine Zeile je **Element und Einheit**, nicht je Versuch. Bei zwölf Elementen an einem
Abend sind das zwölf Zeilen statt sechzig – und für jede Frage, die das Modul beantworten
soll („wie sicher ist das Element", „wann zuletzt"), reichen Zählerstände vollkommen.

Die Güteeinteilung **gelungen / wacklig / gestürzt** ist bewusst dreistufig: Zwei Stufen
verlieren den entscheidenden Zwischenzustand („steht, aber nicht sicher"), fünf Stufen
werden am Handy nicht mehr ehrlich ausgefüllt.

`with_help` (Anzahl mit Hilfestellung) steht getrennt, weil ein gelungener Versuch mit
Hilfe fachlich etwas völlig anderes ist als einer ohne – und weil der Übergang von „mit"
zu „ohne" der eigentliche Fortschritt ist, den man sehen will.

#### `gym_routines` und `gym_routine_elements` — Küren

**Umgesetzt am 21.09.2026 (Migration 15), und anders als hier ursprünglich
entworfen.** Der Entwurf stand so:

```
gym_routines:          id, name, apparatus, version, status, valid_from, note
gym_routine_elements:  id, routine_id, element_id, sort_order, note
```

Umgesetzt ist:

```
gym_routines:          id, apparatus, name, note, competition_since, is_active
gym_routine_elements:  id, routine_id, element_id, position, note
```

Was sich geändert hat und warum, steht in Abschnitt 13. Der Kern: `status` und
`version` sind entfallen, `competition_since` ist dazugekommen – ein Zeitpunkt
statt eines Kennzeichens, weil „je Gerät höchstens eine aktive Wettkampfkür"
sich als Kennzeichen über zwei Geräte hinweg nicht halten lässt.

Zur **Schwierigkeit**: siehe 4.2. Es wird nichts erfunden.

#### `gym_competitions` und `gym_results` — Wettkämpfe

**Umgesetzt am 21.09.2026 (Migration 16), und an drei Stellen anders als hier
entworfen.** Der Entwurf stand so:

```
gym_competitions:  id, day, name, location, class_name, note, rank_allround
gym_results:       id, competition_id, apparatus, routine_id, d_value, e_value,
                   penalty, final_score, rank, note
```

Umgesetzt ist:

```
gym_competitions:  id, day, name, location, class_name,
                   rank_allround, score_allround, protocol_url, note
gym_results:       id, competition_id, apparatus, routine_version_id,
                   d_score, e_score, penalty, final_score, rank_apparatus, note
```

Die drei Unterschiede und ihre Begründung stehen in Abschnitt 14.5. Der
wichtigste: **`routine_version_id` statt `routine_id`.** Ein Verweis auf die
lebende Kür hätte alte Wettkämpfe mitverändert, sobald die Kür bearbeitet wird
– dazu Abschnitt 14.1 und die beiden neuen Tabellen darunter.

Getrennt, weil ein Mehrkampf sechs Gerätewertungen und **eine** Mehrkampfplatzierung hat.
In einer Tabelle stünden Name und Datum sechsmal, und die Mehrkampfplatzierung hätte
keinen Platz.

`penalty` (Neutralabzüge: Zeit, Linie, Sturzabzüge außerhalb der E-Note) steht getrennt,
weil es auf den meisten Protokollen getrennt ausgewiesen ist und `final_score` sonst nicht
nachvollziehbar wäre. Gerechnet wird nichts – siehe 4.2.

### 2.4 Warum Geräte eine Zeichenkette sind und keine Tabelle

Sechs Werte, die sich seit Jahrzehnten nicht ändern. Eine Tabelle dafür kostet eine
Abgleichrunde, eine Ladeabfrage und einen Fremdschlüssel – und bringt nichts, was eine
Konstante in `core/turnen/geraete.ts` nicht auch könnte. Dort stehen dann auch Reihenfolge,
Kurzname und Farbe.

Die geforderte Erweiterbarkeit bleibt: Ein siebtes Gerät ist eine Zeile in dieser
Konstante. Für Frauengeräte (Stufenbarren, Schwebebalken) oder Trampolin genügt dasselbe.

---

## 3. Beziehungen im Überblick

```
   day_types ──< day_assignments                       task_templates
       │              │                                      │
       │              │  (Schicht je Tag)                     │ (erzeugt Aufgaben)
       ▼              ▼                                      ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                   Planung / Kalender                        │
  └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
   workout_plans ──< workout_plan_days ──< workout_plan_exercises
                              │                    (Kraft, bisher tot)
                              ▼
                    workout_sessions  ◄── discipline: 'turnen' | 'kraft'
                       │          │
          ┌────────────┘          └────────────┐
          ▼                                    ▼
    workout_sets                          gym_attempts
   (exercise_id)                          (element_id)
          │                                    │
          ▼                                    ▼
      exercises                           gym_elements ──┐
                                               ▲         │
                              gym_routine_elements       │
                                               ▲         │
                                        gym_routines     │
                                               ▲         │
                         (nur Herkunft, nie für          │
                          die Anzeige aufgelöst)         │
                                               ┆         │
   gym_competitions ──< gym_results ──> gym_routine_versions
                        (routine_version_id)        │
                                                    ▼
                                   gym_routine_version_elements
                                   (eingefrorene Kopie: Name,
                                    Schwierigkeit, Gruppe,
                                    Abgang, Reihenfolge)
                                                          │
                          metrics / metric_entries ◄──────┘
                          (optional: Tageswerte wie „Turnminuten")
```

Bestehende Tabellen sind unverändert bis auf **eine** neue Spalte auf
`workout_sessions`. Alles Neue hängt daran, nichts Bestehendes hängt am Neuen – das
Modul lässt sich deshalb jederzeit abschalten, ohne dass etwas anderes bricht.

---

## 4. Die beiden fachlichen Fallen

### 4.1 Kür – geklärt am 20.09.2026

**Erik turnt Kür mit D-Wert.** Damit steht das Datenmodell oben richtig, und die Fragen,
die das Modul beantworten soll, sind die schwierigkeitsbezogenen:

- `difficulty_letter` und `difficulty_value` je Element werden **wirklich gebraucht**
- `element_group` (I–V) ist relevant, weil eine Kür die Gruppen abdecken muss
- `is_dismount` ist relevant (Abgang zählt gesondert)
- „Wo fehlt mir Schwierigkeit?" ist eine sinnvolle Frage – und die Summe der
  Elementwertigkeiten je Gerät ist ihre Grundlage (mit dem Vorbehalt aus 4.2)
- `gym_routines` verwaltet **eigene** Küren, keine vorgegebenen Pflichtübungen

Die Pflicht-Variante entfällt damit aus der Planung. Sollte später eine Liga mit
Pflichtübungen dazukommen, wäre das ein eigener `status`-Wert an `gym_routines` und kein
Umbau.

### 4.2 Es werden keine Wertungsregeln erfunden

Der Code of Points ist umfangreich, ändert sich je Olympiazyklus und unterscheidet sich
je Liga. Eine selbstgebaute D-Wert-Rechnung wäre nach einem Jahr falsch und sähe trotzdem
richtig aus.

Deshalb:

- **D-Wert, E-Wert, Endnote werden eingetragen**, nicht gerechnet.
- Für Küren darf LifeHub eine **„Summe der Schwierigkeiten"** anzeigen – klar beschriftet
  als Orientierungswert und ausdrücklich **nicht** als D-Note. Anschlussboni,
  Elementgruppenanforderungen, die Zehn-Elemente-Regel und der Abgangsbonus fließen
  nicht ein, und das steht auch so daneben.
- Sollen echte Regeln kommen, dann als **eigener Regelblock**
  (`core/turnen/wertung/<code-2025>.ts`) mit Jahreszahl im Namen, eigenen Tests und einer
  klaren Angabe, welche Fassung er abbildet. Nie verstreut in der Oberfläche.

---

## 5. Import von Wettkampfprotokollen

### 5.1 Digitale Protokolle: PDF aus einer Wettkampfsoftware

> **Umgesetzt am 22.09.2026 als Phase 2B2.** Die Vermutungen dieses Abschnitts
> haben sich bestätigt: Textebene vorhanden, Edge Function statt Bündel,
> fachliche Logik daneben. Was das echte Protokoll darüber hinaus gezeigt hat –
> und was der Leser deshalb wirklich tut – steht in **Abschnitt 15**.

**Geklärt am 20.09.2026.** Die Protokolle kommen als PDF aus einer Wettkampfsoftware.
Das ist der günstigste Fall: Solche PDFs haben in aller Regel eine **Textebene**, die
Werte stehen also als Zeichen da und müssen nicht erkannt, sondern nur gefunden werden.

Zwei Wege, den Text herauszuholen:

| Wo | Vorteil | Nachteil |
|---|---|---|
| **Im Browser** (`pdfjs-dist`) | funktioniert offline, kein Server nötig | rund 1 MB zusätzlich im Bündel – `LifeHub.html` liegt schon bei 1,92 MB |
| **In einer Edge Function** | Bündel bleibt klein, Logik zentral prüfbar | braucht Internet; PDF muss hochgeladen werden |

**Empfehlung: Edge Function.** LifeHub hat mit `schlaf` bereits das Muster dafür, das
Bündel bleibt schlank, und der Import ist ohnehin kein Offline-Vorgang – die Protokolle
kommen aus dem Netz. Die Zuordnungslogik („welche Zahl ist der E-Wert") liegt dann als
reine, prüfbare Funktion daneben, genau wie `aggregat.ts` beim Schlaf.

**Das Beispiel-PDF kam am 22.09.2026** – die Sächsischen Einzelmeisterschaften 2026 aus
der Wettkampfsoftware SCORE. Es hat eine saubere Textebene, und zwar eine mit
Koordinaten, die mehr hergibt als der blosse Fliesstext (Abschnitt 15.2). Die
Einschränkung von damals gilt aber weiter: **Ein zweites Protokoll aus einem anderen
Wettkampf steht noch aus.** Erst daran zeigt sich, was am Layout fest ist und was nicht.

Auch beim PDF gilt die Regel aus 5.2 unverändert: **vorschlagen, nicht speichern.** Ein
PDF-Layout kann sich ändern, und eine stillschweigend falsch zugeordnete Endnote fällt
Jahre später nicht mehr auf.

### 5.2 Papierprotokolle

LifeHub hat **keine** Texterkennung, und es gibt keinen eingebauten Weg dorthin. Drei
Möglichkeiten:

1. **Von Hand eintragen, Foto daranhängen** (empfohlen für Phase 2)
   Sechs Zahlen je Gerät, ein paarmal im Jahr. Das Foto (verkleinert, < 4 MB) bleibt als
   Beleg. Kein Risiko, keine fremde Abhängigkeit, sofort verfügbar.

2. **Texterkennung auf dem Gerät**
   iOS kann Text in Bildern erkennen (Live Text). Über einen Kurzbefehl ließe sich das
   Ergebnis wie beim Schlafimport an eine Edge Function schicken. Reizvoll, aber die
   Zuordnung „welche Zahl ist der E-Wert" bleibt unzuverlässig.

3. **Texterkennung in einer Edge Function** über einen Bilderkennungsdienst.
   Genauer, aber: fremder Dienst, laufende Kosten, ein weiterer Schlüssel, und Protokolle
   sind personenbezogene Leistungsdaten.

In **jedem** Fall gilt die Regel, die du gesetzt hast, und sie wird im Entwurf
festgeschrieben:

> Erkannte Werte werden **vorgeschlagen**, nie gespeichert. Der Entwurf zeigt das Foto
> neben den erkannten Feldern; jedes Feld ist einzeln bestätigbar und änderbar. Ein Feld,
> das die Erkennung nicht sicher lesen konnte, bleibt **leer** – es wird nichts geraten.
> Gespeichert wird erst auf Knopfdruck.

Empfehlung: Phase 2 baut den Eingabeweg (1) samt Datenmodell, und zwar so, dass ein
späterer Vorschlagsschritt nur ein vorgelagerter Entwurf ist – kein Umbau.

---

## 6. Auswertung

### 6.1 Was belastbar ist

Beschreibend, ohne statistische Behauptung – das geht ab dem ersten Datensatz:

- Endnote, D-Wert, E-Wert je Gerät über die Zeit (Linie, wenige Punkte, ehrlich beschriftet)
- Trainingshäufigkeit je Gerät (Balken, letzte 4/12 Wochen)
- Tage seit dem letzten Training je Element – die wertvollste Liste überhaupt
- Elemente nach Status, Trefferquote je Element (gelungen / Versuche)
- Anteil mit Hilfestellung über die Zeit je Element
- Welche Elemente der aktiven Kür gerade `unsicher` sind

### 6.2 Was **nicht** geht – und warum

Der Wunsch „Zusammenhang zwischen Trainingshäufigkeit und Wettkampfleistung" ist der
gefährlichste Punkt der ganzen Anforderung.

`core/zusammenhaenge.ts` verlangt **mindestens 20 gemeinsame Datenpunkte**, mit dieser
Begründung im Code: *„Bei zwanzig Tagen wird ein Korrelationskoeffizient von 0,44 gerade
bedeutsam. Darunter ist praktisch jeder Wert mit Zufall vereinbar – eine Aussage aus zehn
Tagen ist keine Aussage, sondern eine Behauptung."*

Ein Turner hat pro Jahr vielleicht **fünf bis zehn Wettkämpfe**. Selbst über drei Jahre
kommen kaum zwanzig zusammen, und sie sind nicht vergleichbar (andere Übung, andere
Kampfrichter, andere Liga). Eine Korrelation darüber wäre eine Zahl ohne Aussage – und
sie sähe überzeugend aus.

**Entscheidung: Das Turnen-Modul zeigt keine Korrelation gegen Wettkampfergebnisse.**
Stattdessen stellt es beide Verläufe nebeneinander und überlässt die Deutung dir. Wenn
irgendwann genug Wettkämpfe zusammenkommen, greift dieselbe `belastbar`-Prüfung wie
überall sonst – und erst dann.

Was dagegen zulässig ist: Zusammenhänge gegen **Tageswerte**, weil davon hunderte
existieren – etwa Schlaf gegen Trainingsqualität, sofern letztere als Tageswert geführt
wird. Das läuft über die vorhandene Maschinerie, mit ihren vorhandenen Bremsen.

---

## 7. Oberfläche und Navigation

### 7.1 Eigener Bereich, nicht ein Reiter unter Tracking

`Tracking` hat bereits sechs Reiter (Tag, Verlauf, Training, Schlaf, Körper,
Zielbereiche). Ein siebter wäre eng, und das Turnen-Modul braucht selbst eine
Unterteilung – zwei Reiterebenen übereinander sind unbedienbar.

**Empfehlung: neuer Bereich `#/turnen`** in `NAV_MORE` (neben Kalender, Einkauf, Ziele,
Analysen). Dazu ein Verweis von Tracking → Training dorthin, damit man ihn findet.

### 7.2 Reiter

```
Übersicht · Elemente · Training · Küren · Wettkämpfe
```

Stand 21.09.2026 sind die ersten vier davon gebaut; **Wettkämpfe** ist Phase 2B
und wird ein fünfter Eintrag in derselben Liste, ohne weiteren Umbau.

**„Geräte" ist bewusst kein eigener Reiter.** Ein Gerät ist kein Ort, an den man geht,
sondern die Gliederung von allem anderen. Es ist die Achse der Übersicht und der Filter
in Elementen, Küren und Wettkämpfen.

| Reiter | Inhalt |
|---|---|
| **Übersicht** | Sechs Gerätekacheln: Tage seit letztem Training, Zahl unsicherer Elemente, letzte Endnote. Darunter „Lange nicht trainiert" (die Top-5-Liste) und die nächsten Wettkämpfe. Eine Bildschirmhöhe, nicht mehr. |
| **Elemente** | Liste, nach Gerät gefiltert, nach Status oder letztem Training sortierbar. Antippen öffnet die Elementansicht mit Verlauf, Notiz und Videoverweis. |
| **Training** | Die Einheiten mit `discipline='turnen'`. Ganz oben der Knopf, um die heutige Einheit zu erfassen. |
| **Küren** | *(Phase 2A, umgesetzt)* Nach Gerät gruppiert, je Kür Name, Zahl der Elemente, Schwierigkeitssumme und Hinweis auf unsichere Elemente. Die aktive Wettkampfkür steht oben und trägt eine Marke; Archiviertes liegt hinter einem Schalter. Antippen öffnet den Editor mit der sortierbaren Elementfolge. |
| **Wettkämpfe** | *(Phase 2B1, umgesetzt)* Chronologisch, mit dem nächsten und dem letzten Wettkampf oben. Antippen zeigt je Gerät eine kompakte Karte mit D, E, Abzug, Endnote, Platzierung und der damals geturnten Kürfassung; beste und niedrigste Note sind markiert. Darunter die Auswertung: Verläufe je Gerät, Bestwerte, Starts. |

### 7.3 Der Erfassungsweg – der wichtigste Bildschirm

Aus 1.1 folgt: Hier entscheidet sich alles. Der Entwurf für Phase 1:

1. **Einheit anlegen** — Datum ist heute, Dauer vorbelegt, ein Tippen auf das Gerät.
2. **Elemente dieses Geräts erscheinen als Liste** — die zuletzt trainierten oben.
3. **Je Element drei Zähler** (gelungen / wacklig / gestürzt) mit großen +-Flächen.
   Kein Formular, kein Dialog je Element, kein Speichern zwischendurch.
4. **Fertig** — ein Knopf, ein `batch`-Schreibvorgang.

Nicht erfasste Elemente erzeugen keine Zeile. Wer nur „Boden, 45 min" festhalten will,
speichert die Einheit ohne einen einzigen Versuch – das muss ausdrücklich in Ordnung sein
und darf nirgends als Lücke angemahnt werden.

Gestaltung: bestehende Farbmarken (`--bereich-tracking` als Bereichsfarbe, die
`--tag-*`-Töne für Geräte-Unterscheidung), bestehende Bauteile, keine Emoji-Symbole,
Dark Mode automatisch über die Tokens.

---

## 8. Phasenplan

Jede Phase ist für sich nützlich und endet mit grünen Tests, gebauter `LifeHub.html`,
Benchmark und Commit. Keine Phase legt Tabellen „auf Vorrat" an.

### Phase 1 — Elemente und Erfassung *(empfohlener Start)*

**Ziel:** Ab dem ersten Tag beantwortbar: Was habe ich wann trainiert, was ist unsicher,
was liegt zu lange zurück.

| | |
|---|---|
| **Migration 14** | `gym_elements`, `gym_attempts`, `workout_sessions.discipline` |
| **Server** | `0001_init.sql` neu erzeugen (Generator läuft jetzt unter Windows), Erinnerung an das Einspielen |
| **Kernlogik** | `core/turnen/geraete.ts` (Gerätekonstanten)<br>`core/turnen/elemente.ts` (zuletzt trainiert, Häufigkeit, Liegezeit)<br>`core/turnen/sicherheit.ts` (Trefferquote, Statusvorschlag aus Versuchen) |
| **Oberfläche** | `screens/Turnen.tsx` (Rahmen)<br>`screens/turnen/Uebersicht.tsx`<br>`screens/turnen/Elemente.tsx`<br>`screens/turnen/Training.tsx` (der Erfassungsweg aus 7.3) |
| **Anbindung** | `App.tsx` (Bereich + Route), `state/store.tsx` (zwei `LADER`-Einträge) |
| **Tests** | `tests/turnen-elemente.test.ts` — Liegezeit, Häufigkeit, Grenzfälle (nie trainiert, heute trainiert, gelöschte Einheit)<br>`tests/turnen-sicherheit.test.ts` — Trefferquote, Hilfestellung, Statusvorschlag, Division durch null<br>`tests/turnen-e2e.mjs` — Element anlegen, Einheit erfassen, Zahlen stimmen, PC↔Handy<br>plus `migration-e2e`, `sync-ganzzahlen-e2e`, `dubletten-e2e` (Pflicht bei neuer Migration) |
| **Messen** | Benchmark vorher/nachher — Erwartung ~+5 % Abgleich durch zwei Tabellen |

**Bewusst nicht in Phase 1:** Küren, Wettkämpfe, Empfehlungen, Video. Erst muss sich
zeigen, dass die Erfassung im Alltag durchgehalten wird. Genau daran ist `workout_sets`
gescheitert.

### Phase 2A — Küren *(umgesetzt am 21.09.2026, Migration 15)*

`gym_routines`, `gym_routine_elements` · `core/turnen/kueren.ts` ·
`screens/turnen/Kueren.tsx` · Reihenfolge, mehrere Varianten je Gerät, aktive
Wettkampfkür · „Schwierigkeitssumme der Elemente" mit Vorbehalt (4.2) · Anzeige,
welche Elemente einer Kür gerade unsicher oder lange nicht dran waren.

Was die Umsetzung konkretisiert hat, steht in Abschnitt 13.

### Phase 2B1 — Wettkämpfe und historische Kürfassungen *(umgesetzt am 21.09.2026, Migration 16)*

`gym_competitions`, `gym_results`, `gym_routine_versions`,
`gym_routine_version_elements` · `core/turnen/fassungen.ts`,
`core/turnen/wettkampf.ts` · `screens/turnen/Wettkaempfe.tsx` · Eingabe von Hand ·
Verläufe je Gerät · unveränderliche Kürfassungen, damit alte Wettkämpfe von
späteren Küränderungen nicht berührt werden.

Was die Umsetzung konkretisiert hat, steht in Abschnitt 14.

### Phase 2B2 — PDF-Import *(umgesetzt am 22.09.2026, keine Migration)*

`supabase/functions/wettkampf-import/` (Edge Function plus reiner Leser) ·
`core/turnen/protokollImport.ts` · `sync/protokoll.ts` · Knopf im Reiter
Wettkämpfe. Gelesen wird der Protokolltyp der Wettkampfsoftware SCORE –
ausdrücklich kein universeller Wettkampf-PDF-Importer.

Was die Umsetzung konkretisiert hat, steht in Abschnitt 15.

### Phase 4 — Auswertung

`screens/turnen/`-Erweiterung und/oder ein Block unter `Analysen` · nur die Auswertungen
aus 6.1 · ausdrücklich **ohne** Korrelation gegen Wettkampfergebnisse (6.2).

### Phase 5 — Empfehlung und Planung

`core/turnen/empfehlung.ts` — reine Logik, ohne Datenbank, gut prüfbar.
Eingang: Liegezeiten, Status, Gerätehäufigkeit, kommende Wettkämpfe, `day_assignments`
(Schicht), freie Fenster aus `core/planner.ts`.
Ausgang: eine begründete Liste („Pauschenpferd seit 18 Tagen nicht – und in drei Wochen
Wettkampf").

Der Ausfall-Ersatz („Spätschicht am Mittwoch → wann stattdessen") baut darauf auf und
nutzt `freeSlots` sowie die vorhandenen `task_templates`.
`tests/turnen-empfehlung.test.ts` prüft vor allem, dass **keine** Empfehlung entsteht,
wenn die Datenlage sie nicht trägt.

---

## 9. Risiken und Stolperstellen

| Risiko | Warum es ernst ist | Gegenmaßnahme |
|---|---|---|
| **Die Erfassung wird nicht durchgehalten** | `workout_sets` ist genau daran gestorben | Phase 1 dreht sich um den Erfassungsweg, nicht um Vollständigkeit. Nach vier Wochen ehrlich prüfen, ob Daten drin sind. |
| **Abgleich wird langsamer** | Jede Tabelle kostet drei Anfragen je Abgleich; 47 sind es schon | Tabellen phasenweise, Benchmark nach jeder Phase |
| **Videos sprengen die Datenbank** | Anhänge liegen als Base64 in der synchronisierten Tabelle, 4 MB Grenze | Nur Verweise. Echte Ablage erst mit Supabase Storage – eigenes Vorhaben. |
| **Erfundene Wertungsregeln** | Sähen richtig aus, wären nach einem Zyklus falsch | Werte eintragen statt rechnen; Regeln nur als datierter Regelblock |
| **Scheinkorrelation Training ↔ Wettkampf** | n ≈ 5–10, weit unter `MINDESTTAGE = 20` | Gar nicht erst anbieten (6.2) |
| **Pflicht/Kür falsch angenommen** | Verschiebt den Schwerpunkt von Phase 2/3 komplett | Offene Frage 1 vor Phase 2 klären |
| **Zwei Trainingswelten** | Getrennte Sitzungstabellen würden „Trainingstage" spalten | Eine `workout_sessions`, zwei Detailtabellen (2.1) |
| **OCR rät Werte** | Eine falsche Endnote im Protokoll fällt Jahre später nicht mehr auf | Vorschlagen statt speichern; unsichere Felder bleiben leer (5.2) |
| **Schema nur lokal geändert** | Abgleich der Tabelle scheitert dann bei jedem Versuch | `0001_init.sql` mit erzeugen, `schema-parity.test.ts` beachten, Einspielen erinnern |

---

## 10. Offene Fragen – Stand 22.09.2026

### Beantwortet

| Frage | Antwort | Folge |
|---|---|---|
| Pflicht oder Kür? | **Kür mit D-Wert** | `difficulty_*`, `element_group`, `is_dismount` werden gebraucht; Phase 3 verwaltet eigene Küren (4.1) |
| Erfassungstiefe? | **Je Element mit Zählern** | Phase 1 wie entworfen; der Erfassungsweg aus 7.3 ist der entscheidende Bildschirm |
| Digitale Protokolle? | **PDF aus Wettkampfsoftware** | Import machbar, über eine Edge Function statt im Bündel (5.1) |
| Wie sieht ein echtes Protokoll aus? | **Am 22.09.2026 lag eines vor** (SCORE, Sächsischer Turn-Verband) | Phase 2B2 umgesetzt; der Aufbau und die Regeln stehen in Abschnitt 15 |

### Noch offen

1. **Ein Protokoll aus einem ANDEREN Wettkampf.** Die Frage von damals ist zur
   Hälfte beantwortet: Ein Protokoll liegt vor, und der Importer liest es. Was
   am Layout fest ist und was am einzelnen Wettkampf hängt, zeigt sich aber
   erst an einem zweiten. Besonders aufschlussreich wären: ein Gerätefinale
   (hat es Runden in einem Dokument? siehe 14.6), ein Mannschaftswettkampf,
   ein Protokoll einer anderen Software und eines aus einem anderen Verband.

2. **Was bedeutet `(+)` im Protokoll?** Elf Zeilen tragen die Kennzeichnung am
   D-Wert. Aus dem Protokoll allein geht nicht hervor, wofür sie steht.
   LifeHub führt sie unverändert mit und deutet sie nicht. Sobald es jemand
   sicher sagen kann, liesse sich daraus eine Angabe machen – vorher nicht.

3. **Nicht blockierend, erst für Phase 5:** Trainierst du nach einem Vereinsplan mit
   festen Tagen, oder legst du die Tage selbst? Davon hängt ab, ob die
   Ersatz-Empfehlung bei Schichtkollision überhaupt freie Wahl hat.

4. **Nicht blockierend, erst für Phase 1 im Detail:** Welche Elemente turnst du
   tatsächlich? Der Elementkatalog startet leer – ein Grundbestand deiner Elemente je
   Gerät würde den ersten Abend in der Halle deutlich abkürzen. Das lässt sich aber auch
   nebenbei beim ersten Erfassen anlegen.

---

## 11. Empfehlung

**Mit Phase 1 beginnen, und sie klein halten.**

Zwei Tabellen, eine Spalte, vier Bildschirmdateien, drei Kernmodule, drei Testdateien.
Kein Import, keine Wertungsrechnung, keine Empfehlung, kein Video.

Der Grund steht in Abschnitt 1.1: In diesem Projekt liegt bereits ein vollständig
entworfenes, nie benutztes Trainingsdatenmodell. Der Unterschied zwischen einem Modul,
das lebt, und einem, das im Schema verstaubt, entscheidet sich nicht am Entwurf, sondern
daran, ob das Erfassen am Mittwochabend in der Halle in unter einer Minute erledigt ist.

Alles Weitere – Küren, Wettkämpfe, Auswertung, Empfehlungen – baut auf den Daten auf, die
Phase 1 erzeugt. Ohne sie sind es leere Listen.

---

## 12. Was die Umsetzung von Phase 1 konkretisiert hat

Der Plan hat sich getragen; umgeplant wurde nichts. An fünf Stellen hat die
Umsetzung ihn geschärft:

### 12.1 `with_help` ist ein Kennzeichen, keine Anzahl

Geplant war „Anzahl mit Hilfestellung". Umgesetzt ist ein Kennzeichen für den
ganzen Block (`with_help INTEGER`, 0 oder 1).

Grund ist der Erfassungsweg: Neben den drei grossen Zählerflächen wäre ein
vierter Zähler am Handy nicht mehr ehrlich auszufüllen. Für den Fortschritt,
den man sehen will – von „mit Hilfe" nach „ohne" – genügt das Kennzeichen:
Über die Wochen kippen die Blöcke von markiert nach unmarkiert, und genau das
ist die Aussage.

Im Statusvorschlag deckelt es weiterhin: Ein Element, das im Fenster auch nur
einmal mit Hilfe geturnt wurde, bekommt höchstens „unsicher" vorgeschlagen.

### 12.2 Die Gesamtzahl der Versuche wird nicht gespeichert

Geplant war `attempts` neben `clean`, `shaky`, `failed`. Umgesetzt ist nur
die Dreiteilung; die Summe wird gerechnet.

Zwei Quellen für dieselbe Zahl können auseinanderlaufen – eine kann es nicht.
Der Fall „ich habe zehn Versuche gemacht, aber nur sechs gezählt" ist damit
nicht abbildbar, und das ist richtig so: Die Zähler *sind* die Aufzeichnung.

### 12.3 Kein UNIQUE-Index auf (session_id, element_id)

Der Dublettenschutz läuft allein über die abgeleitete ID
(`stableId('gym_attempts', session_id, element_id)`). Ein zusätzlicher
UNIQUE-Index wäre überflüssig und riskant:

`tests/natuerliche-schluessel.test.ts` erkennt nur **einspaltige** UNIQUE
(`/CREATE UNIQUE INDEX \w+ ON (\w+)\((\w+)\)/`). Ein zusammengesetzter Index
liefe also durch die Prüfung hindurch – während `gen-supabase-sql.mjs` ihn auf
dem Server streicht. Genau diese Asymmetrie (lokal UNIQUE, auf dem Server
nicht) lässt `INSERT OR REPLACE` beim Holen still Zeilen löschen; so sind
Eriks Ballaststoffwerte verschwunden.

### 12.4 Fünf Statusstufen, nicht vier

`wettkampfreif` ist dazugekommen. Im Kürturnen ist „steht im Training sicher"
etwas anderes als „steht unter Wettkampfdruck", und diese Unterscheidung ist
gerade das, was man wissen will.

LifeHub schlägt diese Stufe **niemals** selbst vor – aus Trainingszahlen lässt
sie sich nicht ablesen. Sie setzt nur der Turner.

### 12.5 Die Schwellen des Statusvorschlags

Sie stehen in `core/turnen/sicherheit.ts` und nirgends sonst:

| | Wert | Bedeutung |
|---|---|---|
| `mindestVersuche` | 10 | Darunter **kein** Vorschlag – nicht einmal ein vorsichtiger |
| `fensterTage` | 56 | Acht Wochen; ältere Versuche sagen über die heutige Form wenig |
| `sicher` | 0,9 | Ab 90 % gelungen, ohne Sturz und ohne Hilfe |
| `unsicher` | 0,6 | Darunter gilt es als „im Aufbau" |

Sie sind eine **Verabredung, keine Messung** – es gibt keine Studie dazu, und
das steht auch so im Code. Rund gewählt, damit man sie im Kopf nachrechnen
kann. Die Mindestzahl folgt derselben Überlegung wie `MINDESTTAGE = 20` in
`core/zusammenhaenge.ts`: Aus drei Versuchen lässt sich nichts ableiten.

### 12.6 Gemessen

`tests/turnen-benchmark.mjs`, mit 60 Elementen, 200 Einheiten und 2.000
Versuchszeilen:

| | |
|---|---|
| Navigation → Turnen | 17 ms |
| Navigation → Elemente | 12 ms |
| Erfassungsweg öffnen | 267 ms |
| Ein Zählertipp | 45 ms |
| Einheit mit 12 Elementen speichern | 423 ms |

Der Gesamtbenchmark blieb unverändert (Kaltstart 2.267 → 2.255 ms, Abgleich
6.766 → 6.733 ms) – die erwarteten ~5 % für zwei neue Tabellen sind nicht
eingetreten, weil die Tabellen dort leer sind. Mit wachsendem Bestand ist mit
den üblichen Kosten je Tabelle zu rechnen.

Im E2E gemessen: **acht Berührungen** für eine Einheit mit fünf Versuchen an
zwei Elementen.

### 12.7 Eine Einheit über mehrere Geräte – ohne Schemaänderung

Nachgereicht am 20.09.2026. Ein normales Turntraining geht über Boden, Barren
und Reck; der erste Erfassungsweg ließ nur ein Gerät je Sitzung zu.

**Eine Datenbankänderung war dafür nicht nötig.** Jedes Element trägt sein
Gerät (`gym_elements.apparatus`), und jeder Versuch zeigt auf ein Element –
das Gerät einer Sitzung ist damit bereits ableitbar. Eine Spalte `apparatus`
an `workout_sessions` wäre eine zweite Quelle für dieselbe Auskunft gewesen,
die bei jedem Zähler hätte nachgezogen werden müssen.

Der Speicherpfad trug das ohnehin schon: `planeVersuche()` bekommt alle
gezählten Elemente, nicht die eines Geräts. Die Grenze saß ausschließlich in
der Oberfläche.

Geändert wurde deshalb:

- **`geraeteDerEinheit()` / `geraeteJeEinheit()`** in `core/turnen/elemente.ts` –
  leiten die Geräte einer Sitzung aus ihren Versuchen ab. Ein Versuch, dessen
  Element gelöscht wurde, wird übergangen: Sein Gerät ist nicht mehr
  feststellbar, und Raten wäre schlechter als Schweigen.
- **Das Gerät im Erfassungsweg ist ein Umschalter**, kein Merkmal der Einheit.
  Die Zählerstände liegen nach Element-ID im Arbeitsspeicher und überleben den
  Wechsel deshalb von selbst. Benutzte Geräte tragen eine Marke mit der Zahl
  ihrer Versuche.
- **Der Titel nennt alle benutzten Geräte** („Boden · Barren · Reck"), nicht
  das zuletzt angezeigte.
- **`geraetBilder()` zählt Sitzungen statt Tage.** Der Unterschied fällt erst
  auf, wenn an einem Tag zweimal trainiert wurde – dann sind es zwei
  Einheiten. Eine Sitzung über drei Geräte erscheint bei allen dreien als
  trainiert und bleibt trotzdem eine Einheit.

Die **Dauer** taucht im Gerätebild bewusst gar nicht auf. Sie hängt an der
Sitzung; je Gerät geführt ließe sie sich bei drei Geräten dreifach zählen. Ein
Test hält das fest.

---

## 13. Was die Umsetzung von Phase 2A konkretisiert hat

Der Plan hat sich getragen; umgeplant wurde nichts. An sieben Stellen hat die
Umsetzung ihn geschärft — die erste davon ist die wichtigste.

### 13.1 Die aktive Wettkampfkür ist ein Zeitpunkt, kein Kennzeichen

Gefordert war: **je Gerät höchstens eine aktive Wettkampfkür.** Markiert man
Kür B, während Kür A aktiv war, soll B gelten und A sich deaktivieren – atomar,
ohne Zwischenzustand nach dem Abgleich.

Der naheliegende Weg wäre ein Kennzeichen `is_competition_routine` je Zeile,
beim Markieren in einer Transaktion umgehängt. **Lokal ginge das. Über zwei
Geräte hinweg nicht.**

`sync/engine.ts` führt Zeilen **einzeln** zusammen (`mergeRows`). Markiert der
PC offline Kür B und das Handy offline Kür C, gewinnt jede der beiden Zeilen für
sich: B trägt danach eine 1, weil der PC sie zuletzt angefasst hat, und C
ebenfalls, weil das Handy sie zuletzt angefasst hat. Zurück blieben zwei aktive
Wettkampfküren an einem Gerät – genau der Zustand, der nicht vorkommen darf.

Ein mehrspaltiger UNIQUE-Index wäre keine Abhilfe, sondern eine Falle. Aus
demselben Grund, der schon in 12.3 steht: `tests/natuerliche-schluessel.test.ts`
erkennt nur **einspaltige** UNIQUE, während `gen-supabase-sql.mjs` sie auf dem
Server streicht. Lokal eindeutig, auf dem Server nicht – und genau diese
Asymmetrie lässt `INSERT OR REPLACE` beim Holen still Zeilen löschen.

Gespeichert wird deshalb nur, **wann** eine Kür zur Wettkampfkür erklärt wurde:

```sql
competition_since TEXT    -- ISO-Zeitpunkt, oder NULL
```

Welche Kür es **ist**, rechnet jedes Gerät daraus aus: die jüngste unter den
nicht archivierten Küren dieses Geräts (`wettkampfKuer()` in
`core/turnen/kueren.ts`). Gleichstand auf die Millisekunde entscheidet die
kleinere ID – dieselbe Regel wie in `entscheideKollision`, und aus demselben
Grund: Sie muss auf jedem Gerät gleich ausfallen.

Damit ist die Bedingung **strukturell nicht verletzbar**. Es gibt keine zweite
Zeile, die nachgezogen werden müsste, also kann der Nachzug auch nicht
ausbleiben. Es ist dieselbe Überlegung wie bei „zuletzt trainiert" (2.3) und den
„Geräten einer Einheit" (12.7): Was sich ableiten lässt, wird nicht gespeichert.

**Das dokumentierte Verhalten bei Offline-Konflikten** lautet deshalb: Die
spätere Entscheidung gilt, und die frühere geht nicht verloren – sie behält
ihren Zeitpunkt und ist nur nicht mehr die jüngste. Beide Geräte kommen nach dem
Abgleich unabhängig voneinander zum selben Ergebnis. Eine eigene Konfliktengine
brauchte es dafür nicht; die vorhandene feldweise Zusammenführung genügt, weil
je Zeile nur ein Feld betroffen ist. `tests/turnen-kueren-e2e.mjs` fährt genau
diesen Fall mit zwei echten Browsern.

**Das Aufheben braucht ein Gegenstück.** Nur den jüngsten Zeitpunkt zu löschen
liesse die nächstältere Kür nachrücken – „keine Wettkampfkür an diesem Gerät"
wäre dann nicht ausdrückbar. Deshalb verlieren beim Aufheben **alle** Küren des
Geräts ihren Zeitpunkt (`zuLoeschendeZeitpunkte()`).

### 13.2 `is_active` und die Wettkampfmarke sind nicht dasselbe

Die Frage, ob beide Angaben nötig sind, beantwortet der Alltag mit ja – aber sie
bedeuten Verschiedenes:

| | Bedeutung |
|---|---|
| `is_active` | archiviert oder nicht – wortgleich mit `gym_elements.is_active` |
| `competition_since` | wann diese Kür zur Wettkampfkür erklärt wurde |

Eine Trainingsvariante ist nicht archiviert und trotzdem keine Wettkampfkür. Ein
gemeinsames `status`-Feld (`entwurf`/`aktiv`/`archiv`, wie ursprünglich
entworfen) müsste beides in eine Achse pressen und könnte „archivierte Kür, die
2025 die Wettkampfkür war" nicht mehr ausdrücken.

`version` und `valid_from` aus dem Entwurf sind ersatzlos entfallen. Eine Kür
als Nachfolgerin einer früheren zu führen ist erst dann etwas wert, wenn ein
Wettkampf darauf zeigt – und das ist Phase 2B. Vorsorglich angelegt wären es
zwei Felder, die Phase 2A nicht füllt und niemand liest.

### 13.3 `gym_routine_elements` bekommt eine gewöhnliche Zufalls-ID

Die abgeleitete ID (`stableId`) ist in LifeHub der Schutz davor, dass zwei
Geräte unabhängig voneinander dieselbe Sache anlegen. Hier passt sie **nicht**:

- **nicht aus `(routine_id, element_id)`** — ein Element darf in einer Kür
  mehrfach vorkommen. Zwei gleiche Elemente wären sonst dieselbe Zeile.
- **nicht aus `(routine_id, position)`** — dann änderte jedes Verschieben die
  ID, und ein Umsortieren wäre für den Abgleich ein Löschen und Neuanlegen der
  halben Kür.

Die Gefahr, gegen die abgeleitete IDs schützen, besteht hier ohnehin nicht: Ein
Element in eine Kür aufzunehmen ist eine bewusste Handlung an *einem* Gerät.
Tun es zwei Geräte offline gleichzeitig, sind das zwei Aufnahmen und keine
doppelte – beide bleiben stehen, die Reihenfolge wird von Hand geradegerückt.
Stilles Wegwerfen wäre schlimmer.

`position` ist deshalb **nur ein Sortierwert, kein Schlüssel**. Gleichstand ist
erlaubt; `kuerElemente()` bricht ihn fest über `created_at` und `id`, damit
jedes Gerät dieselbe Reihenfolge zeigt.

### 13.4 Gelöschte Elemente: kein Schnappschuss

Geprüft wurde, ob `gym_routine_elements` Name und Schwierigkeit des Elements
mitschreiben sollte, damit eine Kür ein Löschen übersteht. **Entschieden: nein.**

| dafür | dagegen |
|---|---|
| Die Kür bleibt nach einem Löschen vollständig lesbar | Zwei Quellen für denselben Namen – benennt Erik ein Element um, zeigt die Kür weiter den alten. Genau die „zweite Quelle", die dieses Dokument an drei Stellen ablehnt |
| | Der verlustfreie Weg existiert schon: **Archivieren** (`is_active = 0`). Archivierte Elemente bleiben geladen und in ihrer Kür vollständig lesbar |
| | Zwei Spalten mehr auf jeder Zeile, für einen Fall, der eintreten *kann* statt regelmässig einzutreten |

Stattdessen drei Dinge, die zusammen dasselbe leisten:

1. **Der Platz bleibt.** `kuerElemente()` gibt den Eintrag mit `element: null`
   zurück, statt ihn zu überspringen. Die Kür behält ihre Länge und ihre
   Reihenfolge; die Zeile steht als „Gelöschtes Element" da.
2. **Die Summe lügt nicht.** Ein Platz ohne Element zählt als Platz ohne Wert.
   `schwierigkeitText()` schreibt dann „0,2 (1 von 3 ohne Wert)" statt einer
   Zahl, die vollständig aussieht.
3. **Das Löschen warnt vorher.** Der Elementeditor nennt die Küren, in denen das
   Element steht, und weist auf das Archivieren hin. Keine stillen Datenverluste
   heisst hier vor allem: nicht ohne Bescheid.

### 13.5 Die Reihenfolge geht über Knöpfe, nicht über Ziehen

Ziehen und Fallenlassen wäre der schönere Weg und im vorhandenen Stack der
unzuverlässigste. Das eingebaute HTML-Ziehen (`draggable`) kennt auf
Berührungsbildschirmen keine Ereignisse – am Handy passiert schlicht nichts. Ein
eigener Nachbau über Zeigerereignisse müsste Scrollen, langes Drücken und den
Bildschirmrand selbst behandeln, und zwar in einem Dialog, der ohnehin scrollt.
Eine Fremdbibliothek dafür wäre die erste im Projekt und läge im Bündel, das
schon bei 1,98 MB liegt.

Umgesetzt sind zwei 44-px-Knöpfe je Zeile (hoch/runter) plus Entfernen – 44 px
ist das Mass, das Apple und Google als kleinste sichere Trefferfläche nennen.
Der E2E misst nach, dass sie am Handy auch wirklich so gross sind und
vollständig im Bild stehen.

Die Reihenfolge liegt dabei im Arbeitsspeicher und wird **einmal** geschrieben
(`planeKuerElemente()`, dasselbe Muster wie `planeVersuche()`). Ein
Schreibvorgang je Tippen wäre bei zehn Verschiebungen zehn Abgleichrunden für
ein Zwischenergebnis. Geschrieben werden nur die Plätze, die sich wirklich
bewegt haben.

### 13.6 Gemessen

`tests/turnen-benchmark.mjs`, mit 60 Elementen, 200 Einheiten, 2.000
Versuchszeilen und 20 Küren mit 191 Plätzen:

| | |
|---|---|
| Navigation → Küren | 7 ms |
| Eine Kür öffnen | 39 ms |
| Ein Element hinzufügen | 528 ms |
| Reihenfolge ändern | 33 ms |
| Kür speichern | 38 ms |

Die 528 ms beim Hinzufügen sind zum grössten Teil das Aufbauen des
Auswahlfensters, nicht das Aufnehmen selbst – dieselbe Grössenordnung wie das
Öffnen des Erfassungswegs (268 ms), der dieselbe Elementliste baut. Deshalb
bleibt der Wähler nach einer Aufnahme offen: Fünf Elemente kosten so fünf
Berührungen und einen Aufbau, nicht fünf.

Der Gesamtbenchmark: Abgleich 6.642 → 6.719 ms (**+1,2 %** für zwei neue
Tabellen), Kaltstart 2.263 → 2.247 ms (unverändert). Die erwartete
Grössenordnung aus 1.5 ist damit bestätigt.

### 13.7 Was Phase 2A ausdrücklich NICHT angefasst hat

An `workout_sessions` wurde **nichts** geändert. Erwogen war ein optionaler
`routine_id`-Verweis, um später „komplette Kür geturnt" festhalten zu können –
und wieder verworfen: Phase 2A füllt ihn nicht, und ein Feld, das niemand
schreibt, ist beim Lesen nicht von einem zu unterscheiden, das jemand vergessen
hat.

Die Anbindung ans Training ist auch ohne Vorsorge offen. Eine Kür ist eine
geordnete Liste von `element_id`; ein Versuch zeigt ebenfalls auf ein Element.
„Welche Elemente der aktiven Kür wurden in dieser Einheit geturnt" lässt sich
daraus schon heute beantworten, ohne eine einzige neue Spalte. Was für „komplette
Kür geturnt" fehlt, ist die Angabe *welche Kür* – und die gehört an die Einheit,
wenn es so weit ist, nicht vorher.

---

## 14. Was die Umsetzung von Phase 2B1 konkretisiert hat

Phase 2 des ursprünglichen Plans ist in zwei Teile zerfallen:

- **2B1 – Wettkämpfe und historische Kürfassungen** *(umgesetzt am 21.09.2026,
  Migration 16)*
- **2B2 – PDF-Import** – wartet weiterhin auf ein echtes Beispielprotokoll
  (offene Frage 1)

Der Grund ist der Import selbst: Ohne ein Protokoll lässt sich weder das
Layout erkennen noch ein Test schreiben, der etwas beweist. Alles andere an
Phase 2 hängt nicht daran.

### 14.1 Die zentrale Entscheidung: echte Fassungszeilen

Ein Wettkampfergebnis muss historisch stabil bleiben. Turnt Erik im Oktober
eine Reckkür und ändert sie im Dezember, muss der Oktober-Wettkampf weiterhin
zeigen, *was damals geturnt wurde*.

Ein `gym_results.routine_id`-Verweis auf `gym_routines` leistet das nicht. Die
Kür dahinter ist veränderlich: Nach der Dezemberänderung zeigte der
Oktober-Wettkampf die Dezemberfassung – ohne Fehler, ohne Meldung, und niemand
merkte es. Dasselbe gilt für die Elemente; ein umbenanntes oder gelöschtes
`gym_element` würde die Anzeige eines Jahre alten Wettkampfs verändern.

Abgewogen wurden zwei Wege:

| | **Fassungstabellen** (gewählt) | **JSON-Schnappschuss am Ergebnis** |
|---|---|---|
| Tabellen | zwei neue | keine |
| Abgleichkosten | zwei Runden mehr | keine |
| „Welche Wettkämpfe mit dieser Fassung?" | ein Vergleich | alle Ergebniszeilen parsen |
| Zwei Wettkämpfe, dieselbe Kür | teilen sich eine Fassung | zwei gleiche Blöcke |
| Anzeige | dieselben Zeilen wie die lebende Kür | ein zweiter Weg daneben |
| Muster im Projekt | vorhanden | neu – strukturiertes JSON gibt es in Nutzdaten sonst nicht |

Der Schnappschuss wäre **billiger**, aber nicht **sauberer** – und nur das war
die Bedingung, unter der er zulässig gewesen wäre. `settings.value_json` ist
ein Einstellungsblock, die `*_json` in `conflicts` sind rein lokal; ein drittes
Muster nur an dieser Stelle hätte niemand vermutet.

**Entschieden: `gym_routine_versions` und `gym_routine_version_elements`.**

### 14.2 Das ist keine zweite Quelle für den aktuellen Zustand

Dieses Dokument lehnt an drei Stellen gespeicherte Ableitungen ab („zuletzt
trainiert", „Geräte einer Einheit", die aktive Wettkampfkür). Eine Fassung
verstösst nicht dagegen, weil sie einen **anderen Gegenstand** beschreibt:
nicht, wie die Kür *ist*, sondern wie sie an einem Tag *war*. Das lässt sich
aus dem Heute grundsätzlich nicht ableiten – es ist die einzige Art von Angabe,
die gespeichert werden *muss*.

Der aktuelle Zustand bleibt allein in `gym_routines` und
`gym_routine_elements`. In die Fassungstabellen wird nie geschrieben, wenn sich
die lebende Kür ändert.

### 14.3 Wann eine Fassung entsteht – und warum es kein „Version erstellen" gibt

Erwogen war ein ausdrücklicher Knopf. Umgesetzt ist: **Die Fassung entsteht
beim Auswählen einer Kür für ein Ergebnis**, ohne weiteren Handgriff.

Der Grund ist derselbe wie bei der Erfassung (1.1): Ein zusätzlicher Schritt,
den man vergessen kann, wird vergessen. Ein Knopf „Version erstellen" wäre
genau dann nicht gedrückt worden, wenn er gebraucht würde – und der Verlust
fiele erst Jahre später auf, wenn niemand mehr weiss, was damals geturnt wurde.

Die ID kommt aus dem **Inhalt** (`fassungsId()`): Kür, Gerät, Name und die
ganze Elementfolge. Daraus folgt alles, was die Bedienung einfach hält:

- Zweimal dieselbe unveränderte Kür einfrieren trifft dieselbe Zeile. Zwei
  Wettkämpfe mit derselben Kür teilen sich eine Fassung.
- Ein zweites Speichern desselben Ergebnisses schreibt nichts.
- Zwei Geräte, die offline dieselbe Kür einfrieren, erzeugen dieselbe ID; der
  Server führt sie über den Primärschlüssel zusammen.
- Ändert sich der Inhalt, ist es eine andere Fassung mit einer anderen ID. Die
  alte bleibt unberührt stehen, und genau darauf zeigen die alten Ergebnisse.

Es ist ausdrücklich **kein Git für Turnübungen**: Es gibt keine Versionsnummern,
keine Historie zum Durchblättern, kein Zurücksetzen. Es gibt nur „die Fassung,
mit der dieser Wettkampf geturnt wurde", beschriftet mit dem Tag, an dem sie
zum ersten Mal festgehalten wurde.

### 14.4 Welche Felder eingefroren werden

| Feld | eingefroren | warum |
|---|---|---|
| `name` | **ja** | Umbenennen darf die Historie nicht umschreiben |
| `difficulty_letter` / `_value` | **ja** | die Schwierigkeit von damals; die Summe muss reproduzierbar bleiben |
| `element_group` | **ja** | gehört zur Zusammensetzung der Übung |
| `is_dismount` | **ja** | der Abgang zählt gesondert und prägt die Übung |
| `position` | **ja** | die Reihenfolge *ist* die Kür |
| `apparatus`, Kürname | **ja** | beides ist an der lebenden Kür änderbar |
| `element_id`, `routine_id` | nur als Herkunft | zeigen womöglich auf gelöschte Zeilen und werden für die Anzeige nie aufgelöst |
| `status` | **nein** | Der Sicherheitsstand beschreibt den Turner *heute*. Gespeichert würde ausserdem der Stand im Moment des Einfrierens und nicht der am Wettkampftag – eine Zahl, die richtig aussieht und es nicht ist. |
| `video_url`, Elementnotiz | **nein** | Trainingshilfen, kein Bestandteil der Übung |
| Notiz am Kürplatz | **nein** | Arbeitsnotiz. Sie mitzufrieren hiesse, dass eine korrigierte Rechtschreibung eine neue Fassung erzeugt. |
| `hold_element` | **nein** | für die Anzeige der Übung ohne Bedeutung |

`position` wird beim Einfrieren **neu von 0 an vergeben**. In der lebenden
`gym_routine_elements` ist sie nur ein Sortierwert und darf Lücken und
Dubletten haben (13.3); in einer Fassung ist sie lückenlos, und darauf baut die
abgeleitete ID der Platzzeilen.

Ein Platz, dessen Element beim Einfrieren schon gelöscht war, heisst
„Gelöschtes Element" und behält seinen Platz. Ihn zu überspringen hiesse, die
Kür beim Einfrieren stillschweigend zu kürzen.

### 14.5 Wettkämpfe und Ergebnisse

```
gym_competitions:  id, day, name, location, class_name,
                   rank_allround, score_allround, protocol_url, note
gym_results:       id, competition_id, apparatus, routine_version_id,
                   d_score, e_score, penalty, final_score, rank_apparatus, note
```

Getrennt, weil ein Mehrkampf sechs Gerätewertungen und **eine**
Mehrkampfplatzierung hat (2.3).

- **`score_allround`** ist dazugekommen. Die Summe der sechs Endnoten ist nicht
  zwingend die Mehrkampfnote; sie zu rechnen hiesse, eine Wertung zu erfinden.
  Also abschreiben, wie `rank_allround` auch.
- **`penalty`** bleibt wie geplant ein eigenes Feld. Neutralabzüge stehen auf
  den meisten Protokollen getrennt, und ohne das Feld wäre `final_score` nicht
  nachvollziehbar.
- **`protocol_url`** ist ein *Verweis*, keine Datei – dasselbe Muster wie
  `gym_elements.video_url` und aus demselben Grund (1.4). Anhänge liegen in
  LifeHub als Base64 in einer synchronisierten Tabelle; ein Wettkampfprotokoll
  gehört dort nicht hinein.
- **`rank_apparatus`** statt `rank`: `RANK` ist in PostgreSQL ein
  Fensterfunktionsname. Als Spaltenname wäre er zulässig, aber die Prüfungen
  führen das erzeugte SQL nicht wirklich in Postgres aus (`_supabase-nachbau`
  liest nur die Typen aus `0001_init.sql`) – ein Irrtum an dieser Stelle fiele
  erst in Eriks SQL-Editor auf.
- **Kein Wettkampftyp** (Mehrkampf/Finale) und **keine Runde**. Siehe 14.6.

Die ID eines Ergebnisses leitet sich aus `(competition_id, apparatus)` ab.
Damit trifft ein zweites Speichern dieselbe Zeile, und zwei Geräte erzeugen
offline nicht zwei.

### 14.6 Offen gelassen: mehrere Durchgänge je Gerät

Ob ein echtes Protokoll Vorrunde und Finale in **einem** Dokument führt, lässt
sich ohne ein solches Protokoll nicht beantworten. Es wurde deshalb **nicht
geraten**.

Umgesetzt ist ein Ergebnis je Wettkampf und Gerät. Ein Gerätefinale wird bis
auf Weiteres als **eigener Wettkampf** erfasst („Landesmeisterschaft –
Gerätefinale Reck"). Das ist fachlich vertretbar: Es hat ein eigenes Datum,
eine eigene Platzierung und ein eigenes Protokoll. Zwei Wettkämpfe am selben
Tag sind ausdrücklich möglich – `gym_competitions.day` hat deshalb **keinen**
natürlichen Schlüssel.

Käme später eine Runde dazu, wäre es eine Spalte plus ein Zusatz an genau einer
Rechnung (`ergebnisId()` in `core/turnen/wettkampf.ts`). Damit vorhandene
Zeilen dabei nicht verwaisen, müsste die leere Runde weiterhin die heutige ID
ergeben – deshalb steht die Rechnung dort und nirgends sonst.

### 14.7 Es wird weiterhin nichts gerechnet

`plausibilitaet()` stellt D + E − Abzug neben die eingetragene Endnote, wenn
alle drei dastehen und sie nicht übereinstimmen:

> „D + E ergibt 12,0, eingetragen ist 12,5. Beides kann richtig sein."

Kein Urteil, kein Hindernis beim Speichern, keine Angabe darüber, welche Zahl
stimmt. Ein Test hält fest, dass der Satz die Wörter „falsch" und „Fehler"
nicht enthält.

Fehlende Noten bleiben `null`, erscheinen als „—" und fehlen im Notenverlauf
ganz. Eine 0,0 wäre dort ein Einbruch, den es nie gab.

### 14.8 Auswertung: was zulässig ist

Umgesetzt sind nur beschreibende Auswertungen (6.1):

- Verlauf je Gerät für Endnote, D-Wert und E-Wert
- Bestwert und letzter Wert je Gerät
- Zahl der Starts je Gerät

**Unter drei Werten wird keine Linie gezeichnet**, sondern es stehen die
einzelnen Werte da. Zwei Punkte ergeben immer eine Gerade, und eine Gerade
sieht nach Entwicklung aus, wo nur zwei Zahlen sind (`MINDESTPUNKTE_LINIE`).

**Keine Korrelation gegen Training** (6.2), **keine Rangfolge zwischen den
Geräten** und keine Gesamtkennzahl über Geräte hinweg: Eine Boden- und eine
Pauschenpferdnote sind nicht dieselbe Währung.

Innerhalb *eines* Wettkampfs werden die beste und die niedrigste Endnote
markiert – aber erst ab drei Geräten mit Endnote
(`MINDEST_GERAETE_FUER_MARKE`). Bei zweien wäre „die bessere und die
schlechtere" keine Auskunft, sondern eine Umschreibung von „zwei Zahlen".

### 14.9 Was 2B2 vorbereitet ist – ohne einen Parser

Kein `pdfjs-dist`, kein OCR, kein Dummy-Parser. Vorbereitet ist allein die
**Form**, in der ein Importer später Werte anbieten würde:

`ErgebnisEingabe` (`core/turnen/wettkampf.ts`) ist die zeichenkettenbasierte
Eingabe, die der Editor hält; `leseNote()`, `lesePlatz()`, `werteAus()` und
`plausibilitaet()` arbeiten ausschliesslich darauf. Ein Importer erzeugt
dieselben Objekte, der Editor zeigt sie, und gespeichert wird erst auf
Knopfdruck – die Regel aus 5.2 („vorschlagen, nicht speichern") ist damit
baulich schon erfüllt, ohne dass eine Zeile Importcode existiert.

### 14.10 Datenintegrität

| Fall | Verhalten |
|---|---|
| Wettkampf löschen | Ergebnisse werden im selben Stapel mitgelöscht; Fassungen bleiben – sie gehören zur Geschichte, nicht zu diesem Eintrag |
| Lebende Kür löschen | Fassungen unberührt. Der Löschdialog nennt die Wettkämpfe, die mit ihr geturnt wurden, und sagt, dass sie unverändert bleiben |
| Element umbenennen | Fassung unberührt – sie trägt den Namen von damals |
| Element löschen/archivieren | Fassung unberührt und vollständig lesbar |
| Zweimal speichern | keine Dublette: abgeleitete IDs bei Ergebnis und Fassung, und `planeErgebnisse` schreibt nur echte Unterschiede |
| Offline erfassen | gewöhnliche Zeilen, gewöhnlicher Abgleich, keine Sonderbehandlung |

### 14.11 Gemessen

`tests/turnen-benchmark.mjs`, mit 60 Elementen, 200 Einheiten, 2.000
Versuchszeilen, 20 Küren (191 Plätze) und 25 Wettkämpfen (111 Ergebnisse,
51 Fassungszeilen):

| | |
|---|---|
| Navigation → Wettkämpfe | 8 ms |
| Einen Wettkampf öffnen | 43 ms |
| Historische Kürfassung öffnen | 709 ms (einschliesslich Schliessen) |
| Ein Ergebnis bearbeiten | 29 ms |
| Wettkampf speichern | 247 ms |

Gesamtabgleich vorher/nachher, je **zwei** Läufe: 7.121 / 6.855 ms gegen
7.070 / 6.870 ms. Die beiden Verteilungen überlappen vollständig – **die vier
neuen Tabellen kosten weniger als die Messstreuung dieses Rechners**. Eine
Prozentangabe wäre hier erfunden. Kaltstart 2.338 / 2.293 gegen 2.292 / 2.276
ms, also unverändert.

Die Erwartung aus 1.5 (rund 2,5 % je zwei Tabellen) liess sich damit nicht
bestätigen und auch nicht widerlegen. Sie gilt für Tabellen mit Inhalt; im
Benchmark sind die neuen leer.

---

## 15. Phase 2B2: der Protokollimport

Umgesetzt am 22.09.2026. **Keine neue Migration** – der Import schreibt in die
Tabellen aus Phase 2B1 und legt keine eigenen an.

Grundlage ist erstmals ein echtes Protokoll: *Sächsische Einzelmeisterschaften
männlich*, Bannewitz, 10.05.2026, erzeugt von der Wettkampfsoftware **SCORE**
des Sächsischen Turn-Verbands. 12 Seiten, 12 Leistungs- und Altersklassen,
95 Teilnehmer, 570 Gerätewertungen.

### 15.1 Wie das Protokoll aufgebaut ist

Jede Seite trägt genau eine Klasse und ist gleich gebaut:

```
Zeile 1   LK 2 AK 18-29
Zeile 2   Sächsische Einzelmeisterschaften männlich | Bannewitz, 10.05.2026
Zeile 3   Rang Name Verein Boden Pferd Ringe Sprung Barren Reck Gesamt
danach    je Teilnehmer eine Zeile
zuletzt   Seite 1/1
```

Die Spaltenreihenfolge ist auf allen zwölf Seiten identisch. **Boden ·
Pferd · Ringe · Sprung · Barren · Reck · Gesamt** – geprüft, nicht
angenommen.

Eine Teilnehmerzeile besteht aus genau **16 Spaltenbündeln**:

```
Rang │ Name        │ Verein │ 2.9   │ 11.566 │ 3.1   │ … │ 67.181
     │ (Jahrgang)  │        │ 8.666 │        │ 8.266 │   │
     │             │        │ (-1.0)│        │       │   │
```

D-Wert, E-Wert und ein etwaiger Abzug stehen **übereinander in derselben
Spalte**, die Endnote daneben.

### 15.2 Warum über Koordinaten gelesen wird und nicht über den Fliesstext

Der zusammengefügte Text ist an zwei Stellen mehrdeutig, die Koordinaten
nicht sind:

| Stelle | im Fliesstext | als Textstücke |
|---|---|---|
| Wettkampfname und Ort | „… männlich Bannewitz, 10.05.2026" – wo hört der Name auf? Bei „Bad Schandau" wäre jede Regel falsch | zwei Blöcke, x = 31 und x = 689 |
| Name und Verein | Drei Teilnehmer haben **keinen Jahrgang**. Dann steht dort „Nachname, Vorname SV Beispielstadt" ohne Trennung | zwei Blöcke, x = 60 und x = 179 |

Deshalb bekommt der Leser Textstücke mit x/y und keine Zeichenkette. Die
Regeln, die daraus folgen:

1. **Zeilen** entstehen durch senkrechte Verkettung: Zwei aufeinanderfolgende
   Werte gehören zusammen, solange zwischen ihnen weniger als 12 Einheiten
   liegen. Gemessen: eine Zeile ohne Abzug ist rund 9 Einheiten hoch, eine mit
   Abzug 17, der Abstand zur nächsten Zeile 23.
2. **Spalten** entstehen durch waagerechte Gruppierung: weniger als 5 Einheiten
   Abstand heisst dieselbe Spalte.
3. Innerhalb einer Spalte wird **von oben nach unten** gelesen – das ist die
   Reihenfolge D, E, Abzug.
4. Der **Spaltenkopf wird hart geprüft**. Steht dort etwas anderes, wird
   abgelehnt (`format_unbekannt`), nicht geraten.
5. Eine Zeile, die nicht 16 Bündel hat, wird mit einer Warnung übergangen –
   der Rest des Protokolls geht dadurch nicht verloren.

### 15.3 Die Sonderfälle, die in diesem Protokoll wirklich vorkommen

| Fall | Anzahl | Was daraus folgt |
|---|---|---|
| **Abzüge** (−0.3, −1.0, −2.0, −3.0, −4.0) | 13 Wertungen in 12 Zeilen | Stehen als dritter Wert unter D und E, immer negativ. LifeHub führt sie als **Betrag**, weil `plausibilitaet()` mit `D + E − Abzug` rechnet. D, E und Endnote verschieben sich dadurch nicht. |
| **Kennzeichnung `(+)`** | 11 Zeilen | Hängt am D-Wert, im selben Textstück: `"1.9 (+)"`. Die Zahl wird gelesen, die Marke **unverändert mitgeführt und nicht gedeutet** – was sie bedeutet, geht aus dem Protokoll nicht hervor. |
| **Nullwerte** | 6 Zeilen | `0.0 / 0.000 / 0.000` ist eine echte Null und wird als Null übernommen. **Fehlend ist nicht null**: Ein nicht vorhandener Abzug bleibt `null` und erscheint als „—". |
| **Kein Jahrgang** | 3 Teilnehmer | Der Jahrgang steht als zweites Stück unter dem Namen. Fehlt er, bleibt er leer – der Verein rutscht nicht in den Namen. |
| **Zweistellige Ränge** | 20 Teilnehmer | Bis Rang 17. Keine Sonderbehandlung nötig. |
| **Mehrteilige Namen** | 5 | Zwei Wörter vor dem Komma oder zwei dahinter – ein Textstück, keine Trennung nötig. |
| **Mehrteilige Vereine** | 20 verschiedene | Abkürzung plus Ort, mit Jahreszahl, mit Bindestrich, mit „zu" – die ganze Spalte gehört zum Verein |

**Nachgerechnet:** In allen 570 Gerätewertungen geht `D + E − Abzug` mit der
Endnote auf. Das ist die schärfste Probe darauf, dass nichts verrutscht ist –
und ausdrücklich **keine** Wertungsregel, die LifeHub anwendet. Gerechnet wird
weiterhin nichts; die Prüfung dient dem Leser, nicht der Note.

### 15.4 Die Architektur

```
Browser                    Edge Function                   Browser
─────────                  ─────────────                   ─────────
PDF wählen
  │  multipart + JWT
  └────────────────────►   index.ts
                           ├─ Grösse ≤ 8 MB
                           ├─ %PDF-Signatur
                           ├─ Seiten ≤ 200
                           ├─ unpdf → Textstücke
                           └─ protokoll.ts  (rein, testbar)
                                  │  Vorschläge
                                  └──────────────────────► Teilnehmer wählen
                                                             │
                                                           protokollImport.ts
                                                             │
                                                           ErgebnisEingabe[]
                                                             │
                                                           derselbe Editor
                                                           wie die Handeingabe
                                                             │
                                                           „Import bestätigen"
                                                             │
                                                           planeErgebnisse()
```

**Der Parser läuft nicht im Bündel.** `LifeHub.html` liegt bei 2 MB; eine
PDF-Bibliothek brächte rund ein weiteres MB mit, auf jedem Seitenaufruf. Der
Import ist ohnehin kein Offline-Vorgang. Geprüft: `pdfjs` kommt im Bündel
nicht vor; es ist um 9 kB gewachsen (Oberfläche und Abbildung).

**Die fachliche Logik liegt neben der Funktion**, nicht darin:
`protokoll.ts` ist frei von Deno-, Browser- und PDF-Aufrufen und bekommt
fertige Textstücke. Dasselbe Muster wie `aggregat.ts` beim Schlaf – und der
Grund, warum sich 43 Tests gegen das echte Protokoll rechnen lassen, ohne dass
ein PDF im Spiel ist.

### 15.5 Das Sicherheitsmodell

Anders als beim Schlafimport, und der Unterschied ist Absicht:

| | Schlafimport | Protokollimport |
|---|---|---|
| Anfrage kommt von | iOS-Kurzbefehl | LifeHub selbst |
| Nachweis | Importtoken (SHA-256-Abdruck in der Datenbank) | **Supabase-Anmeldetoken** |
| Veröffentlicht mit | `--no-verify-jwt` | **ohne** – Supabase prüft vorher |
| Dienstschlüssel | gebraucht (schreibt in die Datenbank) | **nicht gebraucht und nicht gelesen** |
| Schreibt in die Datenbank | ja | **nein** |

Die Funktion gibt Vorschläge zurück, sonst nichts. Gespeichert wird in
LifeHub, nach ausdrücklicher Bestätigung, über den gewöhnlichen Weg mit der
Zeilensicherheit des angemeldeten Kontos.

**Die PDF wird nicht abgelegt.** Sie lebt für die Dauer der Anfrage im
Arbeitsspeicher. Im Protokoll der Funktion stehen nur Seitenzahl,
Teilnehmerzahl und Dauer – keine Namen, keine Vereine, keine Noten, kein
Dateiinhalt.

### 15.6 Der Bedienablauf

1. **Turnen → Wettkämpfe → „Protokoll importieren"**
2. PDF auswählen. Grösse und Endung werden schon hier geprüft, damit ein
   Fehlgriff nicht erst nach dem Upload auffällt.
3. **Teilnehmer wählen.** Die Liste zeigt Name, Jahrgang, Verein, Klasse und
   Rang. Gesucht wird über alles davon. Steht in den Einstellungen ein Name,
   wird der passende Eintrag als **Vorschlag** markiert – aber nur bei genau
   einem Treffer, und nichts wird übernommen.
4. **Der gewöhnliche Wettkampfeditor geht auf**, vorbefüllt. Kein zweiter
   Bildschirm, kein zweites Eingabemodell.
5. Korrigieren, je Gerät eine **Kür wählen** (wird dann wie in 2B1
   eingefroren), und **„Import bestätigen"**.

Erst der letzte Klick schreibt. Vorher steht nichts in der Datenbank – dafür
gibt es eine eigene Prüfung im E2E.

**Ein zweiter Import desselben Protokolls** aktualisiert den vorhandenen
Wettkampf, statt einen zweiten anzulegen: Erkannt wird er über Tag und Namen,
die Ergebniszeilen führt `planeErgebnisse()` über `(Wettkampf, Gerät)`
zusammen. Wer wirklich einen zweiten Eintrag will – Mehrkampf und
Gerätefinale am selben Tag –, legt ihn von Hand an.

### 15.7 Unsicherheit

Drei Stufen, keine Prozentzahl: `exact`, `ambiguous`, `missing`. Für eine
Wahrscheinlichkeit gäbe es hier keine Grundlage – die Struktur ist eindeutig
oder sie ist es nicht.

Was nicht sicher gelesen wurde, steht über den Feldern, mit dem **Rohtext aus
dem Protokoll** daneben. Bei diesem Protokoll ist die Liste leer: Alles wurde
eindeutig erkannt. Ein fehlender Abzug zählt bewusst **nicht** als
Unsicherheit – kein Abzug ist der Normalfall.

### 15.8 Was der Import ablehnt

| Code | Wann |
|---|---|
| `keine_pdf` | keine PDF-Signatur, oder schon im Browser die falsche Endung |
| `zu_gross` | über 8 MB |
| `zu_viele_seiten` | über 200 Seiten |
| `pdf_kaputt` | beschädigt oder verschlüsselt |
| `keine_textebene` | gescanntes Protokoll ohne Text |
| `format_unbekannt` | andere Spaltenköpfe |
| `keine_teilnehmer` | richtiges Format, aber keine Zeile |
| `nicht_veroeffentlicht` | die Funktion ist noch nicht auf dem Server |

Jeder Fall nennt einen Satz, mit dem sich etwas anfangen lässt, und weist bei
`format_unbekannt` auf die Handeingabe hin.

### 15.9 Was dieser Importer NICHT ist

**Kein universeller Wettkampf-PDF-Importer.** Getestet ist genau ein
Protokolltyp: die PDF-Ausgabe der Wettkampfsoftware SCORE, wie sie der
Sächsische Turn-Verband 2026 erzeugt hat. Ein anderes Layout wird abgelehnt,
nicht erraten.

**Keine Texterkennung.** Ein gescanntes Protokoll ohne Textebene wird
abgelehnt. OCR bliebe ein späterer Ausbau und brächte die Fragen aus 5.2
wieder mit – sie wäre nur dann vertretbar, wenn erkannte Werte weiterhin
vorgeschlagen und nicht gespeichert werden.

**Bekannte Grenzen:**

- Der Wettkampfname kommt aus der Kopfzeile und lautet bei diesem Protokoll
  für alle Klassen gleich. Enthielte eine PDF mehrere Wettkämpfe, bekäme man
  einen Namen für alle.
- Die **Klasse** wird als Text in `class_name` übernommen („LK 2 AK 18-29").
  LifeHub deutet sie nicht.
- Eine **Platzierung je Gerät** steht in diesem Protokolltyp nicht; das Feld
  bleibt leer und lässt sich von Hand füllen.
- Die Teilnehmersuche ist absichtlich grosszügig und findet über Name,
  Verein, Jahrgang und Klasse. Zu „LK 2 AK 18-29" erscheinen deshalb auch
  Teilnehmer anderer Klassen, deren Jahrgang eine 2 enthält. Die Klasse steht
  in jeder Zeile daneben.
- `(+)` bleibt ungedeutet.

### 15.10 Gemessen

Gegen das echte Protokoll (1,19 MB, 12 Seiten, 95 Teilnehmer), dreimal
gelaufen, jedes Mal gleich:

| | |
|---|---|
| PDF → Textstücke (`unpdf`) | 86 ms |
| Textstücke → Struktur (`protokoll.ts`) | 4 ms |
| zusammen auf dem Server | **90 ms** |

In der Oberfläche, gegen den örtlichen Nachbau:

| | |
|---|---|
| Hochladen und Teilnehmerliste (95 Namen) zeigen | 52 ms |
| Teilnehmer wählen und Vorschau aufbauen | 256 ms |
| Import bestätigen (Wettkampf + 6 Ergebnisse + Fassung) | 251 ms |

Die Übertragung selbst hängt an der Verbindung und ist hier nicht gemessen:
1,19 MB sind bei 10 Mbit/s rund eine Sekunde. Der Gesamtabgleich blieb
unverändert (6.690 ms gegen 6.870/7.070 ms in Phase 2B1) – der Import legt
keine Tabelle an.

### 15.11 Der Testbestand und die Daten anderer Leute

Das Protokoll nennt 95 Teilnehmer mit Namen, Jahrgang und Verein, überwiegend
Minderjährige. **Dieses Repository ist öffentlich.** Weder die PDF noch ein
Textbestand mit Klarnamen gehört hinein.

`tests/fixtures/protokoll-score-2026.json` trägt deshalb **ersetzte Namen,
Jahrgänge und Vereine**. Der Name allein genügte nicht: Jahrgang und Verein
grenzen zusammen mit Klasse, Platzierung und sechs Noten eine Person ebenso
ein – und das Protokoll dazu steht im Netz.

Unverändert bleibt alles, woran geprüft wird: sämtliche Zahlen, Abzüge,
Kennzeichnungen, Nullwerte, Ränge, Klassen, die Koordinaten – und die
**Struktur** der Personenangaben:

- **ob** ein Jahrgang dasteht (drei Teilnehmer haben keinen)
- **wer** sich einen Verein teilt (gleiche Vereine werden gleich ersetzt)
- die Form der Vereinsnamen (mehrteilig, mit Jahreszahl, mit Bindestrich, mit „zu")
- die Form der Personennamen (auch die fünf zwei- und dreiteiligen)

Die Ersatzvereine sind zahlreicher als die echten. Fielen zwei echte auf
denselben Ersatz, teilten sich Teilnehmer einen Verein, die ihn nicht teilen –
und die Prüfung „wer gehört zusammen" ginge daran vorbei.

Eriks eigene Zeile steht im Klartext – es sind seine Daten.

`.gitignore` schliesst **jede** PDF aus, nicht nur die eine. Dieselbe
Überlegung wie bei `_Projektablage/`: Eine Liste vergisst man, ein Muster
nicht.

**Was in der Geschichte steht, ändert das nicht.** Der erste Testbestand
(Commit `bfb3fda`) trug bereits ersetzte Namen, aber noch die echten Vereine
und Jahrgänge; in `acdb6ab` standen drei echte Nachnamen als Beispiele in
diesem Dokument. Beides ist gepusht. Wer das bereinigen will, muss die
Geschichte umschreiben und erzwungen pushen – das ist eine Entscheidung für
den Eigentümer des Repositories, nicht für ein Werkzeug.

Neu erzeugen:

```
node scripts/protokoll-fixture.mjs <pdf> tests/fixtures/<name>.json --behalte Ehnert
```

Den ganzen Weg samt PDF prüft `tests/protokoll-integration.mjs`. Er läuft
nicht in `npm test`, weil er `unpdf` und das echte Protokoll braucht, und
meldet sich ab, wenn eines fehlt:

```
npm install --no-save unpdf
node tests/protokoll-integration.mjs "<pfad/zum/protokoll.pdf>"
```

### 15.12 Veröffentlichen

Ein Push reicht **nicht**. Die Funktion muss eigens veröffentlicht werden:

```
npx supabase functions deploy wettkampf-import
```

**Ohne** `--no-verify-jwt`, im Gegensatz zu `schlaf` – siehe 15.5. Bis dahin
meldet der Import „Die Importfunktion ist auf dem Server noch nicht
veröffentlicht"; alles andere am Turnen-Modul läuft davon unberührt weiter.

Eine Datenbankänderung gibt es in dieser Phase nicht: `0001_init.sql` ist
unverändert.
