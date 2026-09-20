# Schlaf aus Sleep Cycle nach LifeHub bringen

Diese Anleitung führt von null bis zur ersten Nacht, die morgens von selbst in LifeHub
steht. Sie setzt kein Programmierwissen voraus. Du brauchst nur das iPhone und einmal
kurz LifeHub am PC.

**Zeitbedarf:** etwa 20 Minuten. Danach passiert es von allein.

---

## Wie das zusammenhängt

```
Sleep Cycle misst die Nacht
        ↓  (schreibt in Apple Health)
Apple Health
        ↓  (ein Kurzbefehl liest die Proben)
iOS-Kurzbefehl
        ↓  (schickt sie an eine Adresse, mit deinem Importtoken)
LifeHub-Endpunkt
        ↓  (rechnet sie zu einer Nacht zusammen)
LifeHub auf PC und Handy
```

**Warum dieser Umweg?** Sleep Cycle hat keine öffentliche Schnittstelle, über die
LifeHub die Daten abholen könnte. Und Apple Health liegt auf deinem iPhone – kein
Server kommt dort hinein. Es muss also das iPhone selbst sein, das die Daten
hinausschickt. Genau das tut der Kurzbefehl.

---

## Was LifeHub von Apple Health wirklich bekommt

Damit du weißt, was dich erwartet – und was **nicht**:

| Wert | Kommt an? | Bemerkung |
|---|---|---|
| Schlafbeginn | ✅ | wann du eingeschlafen bist |
| Schlafende | ✅ | wann du aufgewacht bist |
| Gesamtschlafdauer | ✅ | wird aus den Proben zusammengerechnet |
| Wachzeit in der Nacht | ✅ | wenn die Quelle sie meldet |
| Zeit im Bett | ✅ | meist ja, überlappt mit dem Schlaf |
| Core / Deep / REM | ⚠️ | **nur mit Apple Watch** oder einem vergleichbaren Gerät |
| Quelle der Messung | ✅ | z. B. „Sleep Cycle" |
| **Schlafqualität in %** | ❌ | **gibt es in Apple Health nicht** |

### Zur Schlafqualität, weil das die häufigste Enttäuschung ist

Sleep Cycle zeigt dir morgens eine Prozentzahl. **Diese Zahl steht nicht in Apple
Health.** Apple Health kennt keinen Datentyp „Schlafqualität" – Sleep Cycle rechnet sie
aus seinen eigenen Messungen aus und behält sie in seiner App.

LifeHub erfindet sie deshalb nicht. Es wäre ein Leichtes, aus Tiefschlafanteil und
Wachzeit eine Prozentzahl zu basteln – aber das wäre dann **LifeHubs** Zahl und nicht
die von Sleep Cycle, und du würdest zwei verschiedene Werte nebeneinander sehen und dich
fragen, welcher stimmt.

Wenn du eine Bewertung willst: In LifeHub unter *Tracking → Zielbereiche* steht für
`sleep_h` dein Zielbereich (7–9 Stunden). Daran misst LifeHub die Nacht – an deinem
eigenen Ziel, nicht an einer fremden Formel.

### Zu den Schlafphasen

Core, Tiefschlaf und REM misst **nur eine Apple Watch** (oder ein anderes Gerät, das das
kann). Sleep Cycle allein auf dem iPhone meldet nur, *dass* geschlafen wurde, nicht
*wie*. Hast du keine Watch, bleiben diese Felder in LifeHub leer – und zwar bewusst
leer und nicht auf null. Null hieße „null Minuten Tiefschlaf gemessen", und das wäre
falsch.

---

## Teil A – Vorbereiten (5 Minuten)

### A1. Sleep Cycle darf nach Health schreiben

1. **Health** öffnen (das weiße Symbol mit dem roten Herz)
2. Rechts oben auf dein **Profilbild** tippen
3. **Apps und Dienste** antippen
4. **Sleep Cycle** antippen
5. Sicherstellen, dass **Schlafanalyse** unter „Daten schreiben" auf **an** steht

> Steht Sleep Cycle nicht in der Liste: Öffne einmal die Sleep-Cycle-App, gehe dort in
> die Einstellungen und schalte die Apple-Health-Verbindung ein. Danach taucht sie hier auf.

### A2. Prüfen, dass wirklich Daten da sind

1. In **Health** unten auf **Durchsuchen**
2. **Schlaf** antippen
3. Du solltest die letzten Nächte sehen

> Steht hier nichts, hat Sleep Cycle noch nie geschrieben. Dann erst eine Nacht messen
> lassen – der Kurzbefehl kann nichts schicken, was nicht da ist.

### A3. Den Zugang in LifeHub anlegen

Am PC (oder im Browser auf dem Handy):

1. LifeHub öffnen
2. **Einstellungen → Synchronisation**
3. Zur Karte **„Schlafimport vom iPhone"** scrollen
4. Auf **+ Zugang** tippen
5. Einen Namen vergeben, z. B. `iPhone`
6. **Anlegen**
7. **Jetzt kommt das Wichtige:** Das Token wird **einmal** angezeigt.
   Tippe auf **Kopieren** und schicke es dir selbst – z. B. als Notiz an dich, oder in
   einen Chat mit dir selbst. Du brauchst es gleich auf dem iPhone.

> **Warum nur einmal?** LifeHub speichert das Token nicht, sondern nur dessen
> Prüfsumme. Selbst wenn jemand deine Datenbank läse, käme er daran nicht heran. Der
> Preis dafür: Verlierst du es, legst du einen neuen Zugang an und widerrufst den alten.
> Das dauert zehn Sekunden.

8. Kopiere dir außerdem die **Adresse** aus dem Feld darüber. Sie sieht so aus:

```
https://<dein-projekt>.supabase.co/functions/v1/schlaf
```

---

## Teil B – Den Kurzbefehl bauen (10 Minuten)

Jetzt am iPhone. Jeder Schritt einzeln – lass keinen aus.

### B1. Neuen Kurzbefehl anlegen

1. App **Kurzbefehle** öffnen
2. Unten auf **Kurzbefehle** (falls du woanders bist)
3. Rechts oben auf **+**
4. Oben auf **Neuer Kurzbefehl** tippen und umbenennen in: `Schlaf an LifeHub`

### B2. Die Schlafproben holen

5. Auf **Aktion hinzufügen** tippen
6. Ins Suchfeld `Health` eingeben
7. **Healthwerte suchen** antippen

   > Je nach iOS-Fassung heißt die Aktion **„Healthwerte suchen"**, **„Health-Sample
   > suchen"** oder englisch **„Find Health Samples"**. Es ist die Aktion, deren erste
   > Zeile mit *„Alle … Werte finden, bei denen …"* beginnt.

8. In der Aktion auf das blaue Wort hinter **Alle** tippen → **Schlafanalyse** wählen
9. Auf **Filter hinzufügen** tippen
10. Als Feld **Startdatum** wählen
11. Als Bedingung **ist nach** wählen
12. Als Wert **Datum** → gib ein: `vor 3 Tagen`

    > Warum drei Tage und nicht eine Nacht? Weil Apple Health nachträglich korrigiert
    > und du vielleicht mal einen Tag aussetzt. LifeHub erkennt Nächte, die es schon
    > hat, und schreibt sie nicht doppelt – es kostet dich also nichts, großzügig zu sein.

13. Ganz unten in der Aktion: **Sortieren nach** → **Startdatum**, **Reihenfolge** →
    **Älteste zuerst**
14. **Grenzwert** ausschalten (sonst bekommst du nur die erste Probe)

### B3. Die Proben in eine Liste verwandeln

15. **Aktion hinzufügen** → suche `Variable` → **Variable festlegen**
16. Namen eingeben: `Proben`
17. Auf **Eingabe** tippen → **Healthwerte** (das Ergebnis von oben) wählen

18. **Aktion hinzufügen** → suche `Text` → **Text**
19. In das Textfeld **nichts** eingeben (es bleibt leer)
20. **Aktion hinzufügen** → **Variable festlegen**, Name: `Liste`, Eingabe: **Text**

21. **Aktion hinzufügen** → suche `Wiederholen` → **Mit jedem Objekt wiederholen**
22. Auf **Eingabe** tippen → Variable **Proben** wählen

**Ab hier arbeitest du INNERHALB der Wiederholung** (die Aktionen rücken ein):

23. **Aktion hinzufügen** → **Text**
24. Füge in das Textfeld genau dies ein (die geschweiften Klammern mittippen):

```
{"start":"STARTDATUM","ende":"ENDDATUM","wert":"WERT","quelle":"QUELLE"},
```

25. Jetzt werden die vier Großbuchstaben-Wörter durch Variablen ersetzt. Für **jedes**:
    - Das Wort markieren (doppelt antippen)
    - Über der Tastatur erscheint eine Variablenleiste – tippe auf **Wiederholungsobjekt**
    - Es erscheint ein blaues Feld. Tippe **darauf** → **Details anzeigen**
    - Wähle:

| Ersetze | Wähle als Detail |
|---|---|
| `STARTDATUM` | **Startdatum** |
| `ENDDATUM` | **Enddatum** |
| `WERT` | **Wert** |
| `QUELLE` | **Quelle** |

26. Bei **Startdatum** und **Enddatum** noch einmal auf das blaue Feld tippen →
    **Format** → **ISO 8601** wählen.

    > **Das ist der wichtigste Schritt der ganzen Anleitung.** ISO 8601 schreibt die
    > Zeitzone mit (`2026-09-29T07:00:00+02:00`). Ohne sie weiß LifeHub nicht, ob
    > „07:00" deine Uhrzeit oder Weltzeit ist – und bei der Zeitumstellung im März und
    > Oktober käme eine Stunde zu viel oder zu wenig heraus.

27. **Aktion hinzufügen** → **Text** → füge ein: Variable `Liste`, direkt dahinter das
    Ergebnis des Textes aus Schritt 24
28. **Aktion hinzufügen** → **Variable festlegen**, Name: `Liste`, Eingabe: **Text**

**Jetzt aus der Wiederholung heraus** – die folgenden Aktionen stehen wieder links:

### B4. Absenden

29. **Aktion hinzufügen** → **Text** → füge ein:

```
{"proben":[LISTE]}
```

   Ersetze `LISTE` durch die Variable **Liste** (wie in Schritt 25).

   > Das eine überzählige Komma am Ende der Liste stört nicht – LifeHub kommt damit
   > zurecht. Falls du es sauber willst: Aktion **„Text ersetzen"** davor, suche `,]`,
   > ersetze durch `]`.

30. **Aktion hinzufügen** → suche `URL` → **Inhalte von URL abrufen**
31. In das URL-Feld die **Adresse aus Schritt A3.8** einsetzen
32. Auf den Pfeil **⌄** neben „Erweitert" tippen, um die Optionen aufzuklappen
33. **Methode** → **POST**
34. **Header** → auf **Header hinzufügen** tippen:
    - Schlüssel: `Authorization`
    - Wert: `Bearer ` und direkt dahinter **dein Token aus Schritt A3.7** einfügen

      > Zwischen `Bearer` und dem Token gehört **genau ein Leerzeichen**.

35. Noch einen Header hinzufügen:
    - Schlüssel: `Content-Type`
    - Wert: `application/json`
36. **Anfragetext** → **Datei** wählen
37. Darunter erscheint ein Feld – wähle dort den **Text** aus Schritt 29

### B5. Ausprobieren

38. Rechts oben auf **▶︎** (Abspielen) tippen
39. Beim ersten Mal fragt iOS nach Erlaubnis für Health → **Erlauben**
40. Und nach Erlaubnis, Daten zu senden → **Erlauben**

**Was jetzt kommen muss:** Unten erscheint eine Antwort wie

```json
{"naechte":3,"neu":3,"geaendert":0,"unveraendert":0,"tage":["2026-09-27","2026-09-28","2026-09-29"]}
```

| Antwort | Bedeutung | Was tun |
|---|---|---|
| `"naechte":3,"neu":3` | Es hat geklappt | Weiter zu Teil C |
| `"naechte":0` | Health hat nichts geliefert | Teil A2 prüfen, Zeitraum vergrößern |
| `{"fehler":"Zugang ungueltig"}` | Token falsch | Schritt 34 prüfen: Leerzeichen nach `Bearer`? |
| `{"fehler":"Kein gueltiges JSON"}` | Der Text stimmt nicht | Schritt 24 und 29 prüfen |
| `{"fehler":"Probe 1: „start" ist kein ISO-Zeitpunkt"}` | Format fehlt | Schritt 26 nachholen |

41. Öffne LifeHub → **Tracking → Schlaf**. Die Nächte müssen dort stehen.

> Falls nicht: In LifeHub einmal **Einstellungen → Synchronisation → Jetzt
> synchronisieren** drücken. Die Nächte liegen dann schon auf dem Server und müssen nur
> noch geholt werden.

---

## Teil C – Automatisch laufen lassen (5 Minuten)

Jetzt soll das morgens von selbst passieren.

### Welcher Auslöser?

Ich empfehle **Tageszeit**, und zwar aus einem konkreten Grund:

| Auslöser | Zuverlässig? | Haken |
|---|---|---|
| **Tageszeit** (empfohlen) | ✅ hoch | Läuft stur jeden Tag |
| **Aufwachen** | ⚠️ mittel | Feuert, wenn der Wecker klingelt – **bevor** Sleep Cycle fertig geschrieben hat |
| **App geschlossen: Sleep Cycle** | ⚠️ mittel | Nur wenn du die App wirklich öffnest und schließt |

Der **Aufwachen**-Auslöser klingt naheliegend, ist aber der unzuverlässigste: Er greift
in dem Moment, in dem der Wecker losgeht. Sleep Cycle schreibt seine Nacht aber erst,
wenn du den Alarm beendest und die Messung abschließt. Der Kurzbefehl liefe dann ins
Leere.

Eine feste Uhrzeit ein paar Stunden nach dem Aufstehen trifft dagegen immer – und weil
der Kurzbefehl drei Tage zurück liest und LifeHub nichts doppelt anlegt, ist es völlig
egal, ob er einmal zu spät oder zweimal läuft.

### C1. Die Automation anlegen

1. **Kurzbefehle** öffnen → unten auf **Automation**
2. Rechts oben auf **+** (bzw. **Neue Automation**)
3. **Tageszeit** antippen
4. **Uhrzeit** wählen: etwa `09:30` (nimm eine Zeit, zu der du garantiert wach bist)
5. **Täglich** wählen
6. **Weiter**
7. **Bestehenden Kurzbefehl ausführen** (bzw. erst **Kurzbefehl ausführen** wählen)
8. `Schlaf an LifeHub` auswählen
9. **Sofort ausführen** einschalten
10. **Vor dem Ausführen fragen** **ausschalten**
11. **Mitteilen, wenn ausgeführt** ausschalten (sonst bekommst du täglich eine Meldung)
12. **Fertig**

### Was iOS dabei einschränkt – ehrlich gesagt

- **Das iPhone muss entsperrt (oder zumindest eingeschaltet) sein.** Apple lässt
  Automationen, die auf Health zugreifen, nicht beliebig im Hintergrund laufen. In der
  Praxis heißt das: Die Automation greift, sobald du das Telefon das erste Mal benutzt.
- **Ich kann dir keine Garantie geben, dass sie jeden Tag exakt um 09:30 feuert.** iOS
  entscheidet das selbst und verschiebt gelegentlich.
- **Genau deshalb ist der Aufbau so gebaut, dass das nichts ausmacht:** Drei Tage
  Rückschau, und doppelte Nächte werden erkannt. Läuft sie einen Tag gar nicht, holt
  sie am nächsten alles nach.

Wenn du einmal nachhelfen willst: Den Kurzbefehl als Symbol auf den Home-Bildschirm
legen (im Kurzbefehl auf **⌄** → **Zum Home-Bildschirm**) und antippen.

---

## Wenn etwas nicht stimmt

| Problem | Ursache | Lösung |
|---|---|---|
| `Zugang ungueltig` | Token falsch, widerrufen oder Leerzeichen fehlt | Schritt 34 prüfen; notfalls neuen Zugang anlegen |
| `Sendung zu gross` | Zeitraum viel zu groß gewählt | In Schritt 12 auf `vor 3 Tagen` zurückstellen |
| Nächte sind um Stunden verschoben | ISO 8601 vergessen | Schritt 26 nachholen |
| Eine Nacht fehlt | Sleep Cycle hat sie nicht geschrieben | In Health nachsehen (Teil A2) |
| Schlafphasen bleiben leer | Keine Apple Watch | Normal, siehe oben |
| Zwei Nächte an einem Tag | Kann nicht passieren | LifeHub führt je Tag genau eine Nacht |
| Nichts kommt an, keine Fehlermeldung | Automation lief nicht | Kurzbefehl von Hand starten und Antwort ansehen |

### Den Zugang widerrufen

Wenn du das iPhone verkaufst oder das Token versehentlich herumgeschickt hast:

1. LifeHub → **Einstellungen → Synchronisation → Schlafimport vom iPhone**
2. Beim betreffenden Zugang auf **Widerrufen**

Ab sofort wird jede Anfrage mit diesem Token abgewiesen. Die bereits importierten Nächte
bleiben erhalten – widerrufen betrifft nur den Weg hinein, nicht das, was schon da ist.

---

## Was LifeHub mit den Nächten macht

- **Heute** zeigt eine Zeile: `Schlaf · 7 h 42 min · 00:30–07:00`
- **Tracking → Schlaf** zeigt den Verlauf, die einzelnen Nächte und – wenn vorhanden –
  die Phasen. Dort kannst du auch eine Notiz an eine Nacht hängen; die bleibt beim
  nächsten Import erhalten.
- Die Stundenzahl wandert zusätzlich in den Tageswert `sleep_h`. Daran hängen dein
  Zielbereich und die **Zusammenhänge** – LifeHub kann dadurch prüfen, ob dein Schlaf
  mit Haut, Training oder Ernährung zusammenhängt.

Ein Wert, den du **selbst** von Hand einträgst, wird vom Import **nicht**
überschrieben. Deine eigene Angabe gilt.
