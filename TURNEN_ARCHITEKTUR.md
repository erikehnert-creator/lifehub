# Turnen in LifeHub – Architektur und Umsetzungsplan

**Stand:** 21.09.2026 · **Phase 1, 1.1 und 2A umgesetzt** (Migrationen 14 und 15,
Bereich `#/turnen` mit den Reitern Übersicht · Elemente · Training · Küren).
**Geklärt:** Kür mit D-Wert · Erfassung je Element mit Zählern · Protokolle als PDF.

**Die Phasen 2 und 3 haben die Plätze getauscht.** Die Küren kamen am 21.09.2026 vor
den Wettkämpfen an die Reihe, weil sie ohne Wettkampfdaten nützlich sind, die
Wettkämpfe ohne Küren aber nur halb (`gym_results.routine_id` hätte ins Leere
gezeigt). Aus Phase 3 wurde damit **Phase 2A**, aus Phase 2 **Phase 2B**. Am Umfang
der beiden ändert das nichts.

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

```
gym_competitions:  id, day, name, location, class_name, note, rank_allround
gym_results:       id, competition_id, apparatus, routine_id, d_value, e_value,
                   penalty, final_score, rank, note
```

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
                                               │         │
                              gym_routine_elements       │
                                               ▲         │
                                               │         │
                                        gym_routines ────┤
                                               ▲         │
                                               │         │
   gym_competitions ──< gym_results ───────────┘         │
                            (routine_id, apparatus)      │
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

**Was noch fehlt, bevor das gebaut werden kann: ein Beispiel-PDF.** Ohne eines lässt sich
weder das Layout erkennen noch ein Test schreiben, der etwas beweist. Ein einziges genügt
– zwei aus verschiedenen Wettkämpfen wären besser, weil sich daran zeigt, was am Layout
fest ist und was nicht.

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
| **Wettkämpfe** | Chronologisch, je Wettkampf die Gerätewertungen. Antippen zeigt das Protokoll. |

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

### Phase 2B — Wettkämpfe

`gym_competitions`, `gym_results` (Migration 16) · `screens/turnen/Wettkaempfe.tsx` ·
Eingabe von Hand mit Protokollfoto · Verläufe je Gerät · Verknüpfung
`gym_results.routine_id` auf die Kür, mit der geturnt wurde ·
`tests/turnen-wettkampf.test.ts` (Endnote-Plausibilität: D+E−Abzug ≈ Endnote, aber als
**Hinweis**, nicht als Zwang – Protokolle haben Sonderfälle).

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

## 10. Offene Fragen – Stand 20.09.2026

### Beantwortet

| Frage | Antwort | Folge |
|---|---|---|
| Pflicht oder Kür? | **Kür mit D-Wert** | `difficulty_*`, `element_group`, `is_dismount` werden gebraucht; Phase 3 verwaltet eigene Küren (4.1) |
| Erfassungstiefe? | **Je Element mit Zählern** | Phase 1 wie entworfen; der Erfassungsweg aus 7.3 ist der entscheidende Bildschirm |
| Digitale Protokolle? | **PDF aus Wettkampfsoftware** | Import machbar, über eine Edge Function statt im Bündel (5.1) |

### Noch offen

1. **Ein Beispiel-PDF eines Wettkampfprotokolls** – blockiert den Importer in Phase 2,
   nichts davor. Zwei PDFs aus verschiedenen Wettkämpfen wären besser als eines, weil
   sich erst daran zeigt, was am Layout fest ist.

2. **Nicht blockierend, erst für Phase 5:** Trainierst du nach einem Vereinsplan mit
   festen Tagen, oder legst du die Tage selbst? Davon hängt ab, ob die
   Ersatz-Empfehlung bei Schichtkollision überhaupt freie Wahl hat.

3. **Nicht blockierend, erst für Phase 1 im Detail:** Welche Elemente turnst du
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
