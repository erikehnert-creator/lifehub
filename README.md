# LifeHub

Deine persönliche Zentrale für **Finanzen, Aufgaben, Termine, Arbeitsplan, Ernährung,
Training, Schlaf, Körperdaten und Ziele** – in einer Anwendung, auf Windows und Smartphone.

> **Grundprinzip:** Deine Daten liegen als echte SQLite-Datenbank auf deinem Gerät.
> Die App funktioniert vollständig offline. Nichts wird übertragen, solange du keinen
> Server einträgst. Alles ist jederzeit vollständig exportierbar.

---

## 1. Sofort loslegen: die Datei `LifeHub.html`

**Das ist der einfachste Weg – nichts installieren, nichts einrichten.**

`LifeHub.html` ist die komplette App in **einer einzigen Datei**. Alles ist darin
eingebettet: Programm, Design und die Datenbank-Engine. Du kannst sie einfach
doppelklicken – sie öffnet sich im Browser und funktioniert sofort, auch ohne Internet.

* **Windows:** Datei doppelklicken. Für den schnellen Zugriff:
  Rechtsklick → *An Taskleiste anheften* oder ein Lesezeichen im Browser anlegen.
* **Android:** Datei aufs Handy schicken (E-Mail an dich selbst, USB, Cloud) und in
  *Dateien* antippen → mit Chrome öffnen.
* **iPhone:** Datei in der App *Dateien* ablegen und antippen – sie öffnet sich in Safari.

Getestet in Firefox und Chrome, auf Desktop und im Handyformat: Die App startet, speichert
und behält deine Daten auch nach dem Schließen.

> **Zwei Dinge, die du wissen musst.**
> Erstens: Die Daten hängen an *dieser* Datei an *diesem* Gerät in *diesem* Browser.
> Verschiebst du die Datei in einen anderen Ordner, ist die App leer – der Browser
> behandelt sie dann als andere Herkunft. Lass sie also liegen, wo sie ist.
> Zweitens: Sollte dein Browser lokales Speichern blockieren, zeigt LifeHub oben einen
> roten Hinweis. Dann nutze Abschnitt 2 – oder sichere regelmäßig per Export.

Für den dauerhaften Einsatz unterwegs ist die gehostete Fassung (Abschnitt 2) besser:
eigenes App-Icon, Vollbild, verlässlicher Speicher, und du kannst mehrere Geräte
synchronisieren.

---

## 2. Richtig installieren – als App auf dem Smartphone

LifeHub ist eine installierbare Web-App (PWA). Dafür braucht sie eine erreichbare
Adresse. Der einfachste dauerhafte Weg ist kostenlos.

### Variante A – Ordner hochladen, ohne Programmierkenntnisse

Im Paket liegt der fertige Ordner **`dist/`**. Das ist die komplette App als statische
Dateien, ein Server ist nicht nötig.

1. Gehe auf **app.netlify.com/drop**.
2. Ziehe den Ordner `dist` in das Feld.
3. Du bekommst sofort eine Adresse wie `https://irgendwas.netlify.app`.
4. **iPhone:** Adresse in **Safari** öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.
   **Android:** in Chrome öffnen → Menü → *App installieren*.

Danach: eigenes Icon, Vollbild ohne Browserleiste, vollständiger Offline-Betrieb.

### Variante B – GitHub Pages (dauerhaft, mit automatischem Neubau)

1. Auf github.com ein **privates Repository** anlegen, z. B. `lifehub`.
2. Diesen Ordner hochladen:
   ```bash
   git init && git add . && git commit -m "LifeHub"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/lifehub.git
   git push -u origin main
   ```
3. Im Repository: **Settings → Pages → Source: „GitHub Actions"**.
4. Der mitgelieferte Workflow baut und veröffentlicht automatisch. Nach ein bis zwei
   Minuten steht die Adresse dort.

### Variante C – selbst bauen und im WLAN testen

Du brauchst **Node.js 20 oder neuer** (kostenlos von nodejs.org).

```bash
npm install          # einmalig
npm run dev          # Entwicklung: http://localhost:5173
npm run build        # erzeugt den Ordner dist/
npm run build:single # erzeugt LifeHub.html (die Einzeldatei)
npm run serve:lan    # zeigt eine Adresse fürs Handy im selben WLAN
npm test             # 58 Tests der Geld- und Finanzlogik
```

> **Wichtig:** Handy und PC haben zunächst **getrennte Datenbestände**. Für einen
> gemeinsamen Stand richte die Synchronisation ein (Abschnitt 4). Ohne Server bleibt
> jedes Gerät für sich; der Austausch läuft dann über Export und Import.

**Zum Ausprobieren:** *Einstellungen → Daten & Backup → Beispieldaten erzeugen* füllt die
App mit 6 Monaten realistischer Daten, damit du alle Auswertungen siehst.
*Datenbank zurücksetzen* macht alles wieder sauber.

---

## 3. Als Windows-Programm mit Setup.exe

```bash
npm run tauri:build
```

Ergebnis: `src-tauri/target/release/bundle/nsis/LifeHub_1.0.0_x64-setup.exe`
(ca. 10 MB) sowie eine `.msi`. Damit installierst du LifeHub wie ein normales
Windows-Programm.

**Einmalige Voraussetzung:** Die Rust-Toolchain (`rustup` von rustup.rs) und die
*Visual Studio Build Tools* mit „Desktopentwicklung mit C++". Das ist eine größere
Installation; wenn du das umgehen willst, nutze einfach die Web-Variante aus
Abschnitt 2 – funktional ist sie identisch.

Beim ersten Start warnt Windows SmartScreen, weil die Datei nicht kostenpflichtig
signiert ist: *Weitere Informationen → Trotzdem ausführen*.

---

## 4. Synchronisation zwischen PC und Handy

*Einstellungen → Synchronisation.* Trage dort die URL und den öffentlichen Schlüssel
eines Postgres-Backends ein (Supabase-kompatibel, im kostenlosen Tarif ausreichend).
Die Datei `supabase/migrations/0001_init.sql` legt das passende Serverschema an.

So funktioniert es:

* Jede Änderung wird **sofort lokal** gespeichert und in ein Änderungsjournal geschrieben.
* Ist Internet vorhanden, wird das Journal gesendet und Änderungen anderer Geräte geholt.
* Der Abgleich läuft über eine **serverseitig vergebene laufende Nummer**, nicht über
  Zeitstempel – so kann strukturell keine Änderung übersprungen werden.
* Bei gleichzeitigen Änderungen wird **feldweise** zusammengeführt. Beträge, Konten und
  Datum einer Buchung werden **nie** automatisch zusammengeführt: solche Fälle landen
  sichtbar in der Konfliktliste.

Ohne Server funktioniert alles unverändert – nur eben pro Gerät getrennt.

---

## 5. Deine Daten

*Einstellungen → Daten & Backup*

| Format | Wofür |
|---|---|
| **JSON (Vollexport)** | Vollständige Sicherung. Daraus lässt sich alles wiederherstellen. |
| **JSON (Auswertung)** | Vorberechnete Kennzahlen – das Format für KI-Auswertungen. |
| **CSV** | Buchungen, Trackingwerte, Aufgaben für Excel. |
| **SQLite (.db)** | Die Datenbankdatei selbst, mit jedem SQLite-Werkzeug lesbar. |

**Empfehlung:** einmal pro Woche einen Vollexport herunterladen und in einen Ordner
legen, der selbst gesichert wird. Synchronisation ist kein Backup – sie repliziert
auch das Löschen.

**Import:** *Einstellungen → Import* liest CSV/TSV (aus Excel: *Speichern unter → CSV*).
Spalten werden automatisch erkannt, danach zeigt eine **Vorschau**, wie viele Datensätze
importiert werden und wo es Probleme gibt. Jeder Import lässt sich mit einem Klick
vollständig zurücknehmen.

**KI-Zugriff:** *Einstellungen → KI-Zugriff* erzeugt die Auswertungsdatei. Sie beantwortet
Fragen wie „Wie hoch war meine Sparquote in den letzten sechs Monaten?" oder
„Wie entwickelt sich mein Gewicht?", ohne dass eine KI deine Rohdaten braucht.

---

## 6. Was drin ist

**Finanzen** – Konten aller Typen inkl. Bargeld und GIVE-Card, frei anlegbar und
löschbar (Finanzen → Konten oder Einstellungen → Konten) · Einnahmen, Ausgaben,
Transfers · Kategorien mit Ober- und Unterkategorien · Budgets mit Ampel, die auch
die Unterkategorien mitzählen · Sparbetrag und Sparquote · Diagramme ·
Vermögensentwicklung · Monatsprognose · wiederkehrende Zahlungen · Kassensturz ·
Finanztag mit Checkliste aus deinem tatsächlichen Datenstand

**Planer** – Aufgaben mit **frei eingetragener Dauer** (Stunden und Minuten) ·
Inbox ohne Datum · Heute/Woche/Monat · Termine · Feiertage ·
**Arbeitsplan als Kalender**: Tage stehen unter ihrem Wochentag; zum Ändern auf
„Bearbeiten", dann Tagesart wählen und die passenden Tage antippen, zum Schluss
speichern – dazwischen ist der Plan gegen Verstellen geschützt ·
**Aufgabenvorlagen**: „immer dienstags, wenn Spätschicht ist: Auto putzen" –
die App plant sie für die nächsten vier Wochen vor

**Tagesrhythmus** – statt fester Uhrzeiten gibst du nur an, **wie viele Stunden du
schläfst** (Standard 8). Der Rest ergibt sich: 24 Stunden minus Schlaf sind
verplanbar.

**Tracking** – du bestimmst selbst, was getrackt wird (Einstellungen →
Trackingwerte): ein-/ausschalten oder eigene Werte anlegen. Voreingestellt sind
Kalorien, Protein, Kohlenhydrate, Fett, **Zucker**, Wasser, Gewicht, Schlaf,
Schlafqualität, Energie, Stimmung, Hautstatus und **Pickelanzahl** ·
**Zielbereiche mit individueller Toleranz** (🟢 optimal, 🟡 Toleranz, 🔴 außerhalb) ·
**Aktivität** wird als Tätigkeit festgehalten (Turntraining, Ausdauerlauf, HIIT,
Bauchworkout …), nicht als Schrittzahl · zum Hautstatus gehört ein Freitextfeld
für das genaue Bild

**Training** – Einheiten dokumentieren mit Datum, Uhrzeit, Bezeichnung,
**frei eingetragener Dauer**, Status (absolviert / geplant / ausgefallen),
Anstrengung und Notizen; bei „ausgefallen" fragt die App nach dem Grund ·
Trainingspläne legst du selbst an, mit beliebig vielen Wochen (A/B, A/B/C …)

**Ziele** – Fortschritt einfach als **Prozentwert** eintragen. Der Balken läuft von
Dunkelrot über Orange und Gelb nach Grün. Bei 100 % gilt das Ziel als erreicht und
wandert unter **„Erfolgreich bestandene Ziele"** – gelöscht wird nichts.
Wer will, kann den Fortschritt weiterhin automatisch aus einem Kontostand oder
einem Trackingwert ziehen lassen.

**Analysen** – Jahresübersicht als Heatmap · Zusammenhänge zwischen Werten ·
automatische Hinweise, jeder mit aufklappbarem Rechenweg

## 7. Aufbau des Projekts

```
src/
  core/       Fachlogik – reine Funktionen, ohne Datenbank und ohne Oberfläche
              money · dates · finance · metrics · planner · recurrence · goals
              insights · financeDay
  db/         Schema, Migrationen, Repository-Schicht, Startdaten
  charts/     Diagramm-Engine (SVG, ohne Fremdbibliothek)
  ui/         Designsystem und Grundkomponenten
  screens/    Die Bereiche der App
  io/         Export und Import
  sync/       Synchronisation und Konfliktauflösung
tests/        Tests der Finanzberechnungen
src-tauri/    Windows-Hülle
supabase/     Serverschema für die Synchronisation
```

Die wichtigste Regel: In `src/core` gibt es **keinen** Datenbank- oder Netzzugriff.
Dadurch sind alle Finanzberechnungen deterministisch und vollständig testbar.

```bash
npm test         # Tests der Geld- und Finanzlogik
npm run build    # Typprüfung + Produktionsbuild
```

---

## 8. Wie die Daten auf den PC – und später aufs Handy kommen

### Heute: die Daten liegen auf dem PC

LifeHub speichert im Speicher deines Browsers. Damit sie zusätzlich als **echte
Dateien** vorliegen, gibt es *Einstellungen → Daten & Backup → Automatische Ablage
in einem Ordner*: Du wählst einmalig einen Ordner, danach schreibt die App dort
selbstständig

* `lifehub.db` – die Datenbank, mit jedem SQLite-Werkzeug lesbar
* `lifehub.json` – der Vollexport, aus dem sich alles wiederherstellen lässt
* `Sicherungen/lifehub-JJJJ-MM-TT.json` – eine datierte Kopie pro Tag, die letzten 30

Gesichert wird beim Schließen der App, alle 15 Minuten und auf Knopfdruck.
Funktioniert in **Chrome und Edge**; Firefox und Safari erlauben Browsern keinen
Ordnerzugriff.

**Wählst du dafür einen Ordner in OneDrive**, liegen deine Daten damit automatisch
in OneDrive und werden von dort weiter gesichert.

### Später: dieselben Daten auf dem Handy

Drei Wege, vom einfachsten zum besten:

**A – OneDrive als Übergabeordner (heute schon möglich, manuell).**
Am PC landet `lifehub.json` automatisch in OneDrive. Am Handy öffnest du LifeHub
über deine Adresse, gehst auf *Einstellungen → Daten & Backup → Export-Datei
auswählen* und holst die Datei aus der OneDrive-App.
*Vorteil:* keine zusätzliche Technik. *Nachteil:* Du musst selbst daran denken, und
es geht nur in eine Richtung – am Handy erfasste Buchungen kommen so nicht zurück.

**B – Echte Synchronisation über ein eigenes Postgres-Backend (eingebaut).**
Unter *Einstellungen → Synchronisation* trägst du URL und Schlüssel eines
Supabase-Projekts ein; `supabase/migrations/0001_init.sql` legt das Serverschema an.
Danach gleichen PC und Handy **beide Richtungen automatisch** ab, mit
feldweiser Zusammenführung und sichtbarer Konfliktliste. Einrichtung einmalig etwa
zehn Minuten am PC, im kostenlosen Tarif ausreichend.
*Das ist der einzige Weg, der wirklich beidseitig funktioniert.*

**C – OneDrive direkt in der App (denkbar, aber mit Haken).**
Technisch ließe sich die App über Microsofts Graph-API an OneDrive anmelden und
`lifehub.db` dort ablegen und lesen. Nötig wären eine kostenlose App-Registrierung
und ein Anmeldevorgang in der App.
*Der Haken:* Eine Synchronisation über eine einzelne Datei kennt nur „wer zuletzt
speichert, gewinnt". Erfasst du morgens etwas am Handy und mittags etwas am PC,
überschreibt der zweite Speichervorgang die Änderungen des ersten – ohne Warnung.
Genau dagegen ist Weg B gebaut. Deshalb: nur sinnvoll, wenn immer nur ein Gerät
schreibt.

**Empfehlung:** Kurzfristig A (kostet nichts und ist sofort da), sobald du wirklich
auf beiden Geräten erfasst, B.

## 9. Bekannte Grenzen

* **Einzeldatei `LifeHub.html`:** Die Daten hängen am Speicherort der Datei. Verschiebst
  du sie, startet die App leer. Für den dauerhaften Einsatz ist die gehostete Fassung
  (Abschnitt 2) die bessere Wahl.
* **iPhone:** Als Web-App sind Push-Benachrichtigungen eingeschränkt und es gibt kein
  Widget. Wird die App sehr lange nicht geöffnet, kann iOS den lokalen Speicher räumen –
  deshalb entweder regelmäßig öffnen, Synchronisation einrichten oder Backups ziehen.
* **Belege und Fotos** sind im Datenmodell vorgesehen, in der Oberfläche aber noch nicht
  umgesetzt.
* **OCR, Bankanbindung und externe Kalender** sind bewusst noch nicht enthalten;
  die Architektur ist darauf vorbereitet.
