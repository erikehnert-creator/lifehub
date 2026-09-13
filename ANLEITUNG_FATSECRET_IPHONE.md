# FatSecret mit LifeHub verbinden

Diese Anleitung führt von null bis zum ersten übernommenen Lebensmittel. Sie setzt
kein Entwicklerwissen voraus. Arbeite sie der Reihe nach ab – Teil C ist der einzige,
für den du ein schwarzes Fenster (die Eingabeaufforderung) brauchst.

**Was am Ende dasteht:** Du trägst dein Essen weiter wie bisher in der FatSecret-App
auf dem iPhone ein. LifeHub holt sich daraus die einzelnen Lebensmittel und rechnet die
Tageswerte für Kalorien, Protein, Kohlenhydrate, Fett und Ballaststoffe.

**Wichtig vorweg – ein häufiges Missverständnis:**
Es wird **nicht die App auf deinem iPhone** mit LifeHub gekoppelt. Verbunden wird dein
**FatSecret-Konto**, also das Konto, mit dem du in der App angemeldet bist. Deine
Einträge liegen bei FatSecret auf deren Servern, und genau dort holt LifeHub sie ab.
Das hat eine angenehme Folge: Es ist völlig egal, ob du am iPhone, am PC oder im Browser
etwas eingetragen hast.

**Zeitbedarf:** etwa 30–45 Minuten, davon das meiste Warten und Abtippen.

---

## Was du brauchst

| | |
|---|---|
| Ein FatSecret-Konto | Hast du – es ist das, mit dem du in der iPhone-App angemeldet bist |
| Dein LifeHub-Konto | E-Mail und Passwort, die du in LifeHub unter *Einstellungen → Synchronisation* verwendest |
| Zugang zu Supabase | Das Projekt, das LifeHub schon für die Synchronisation benutzt |
| Einen PC mit Internet | Für Teil B und C |

Bereits erledigt (musst du **nicht** noch einmal machen):

- `0001_init.sql` im Supabase SQL-Editor ausgeführt
- `0002_fatsecret.sql` im Supabase SQL-Editor ausgeführt

---

## Deine festen Werte

Diese drei Adressen brauchst du unterwegs. Schreib sie dir irgendwohin, wo du sie
kopieren kannst:

| Was | Wert |
|---|---|
| **Project Ref** (deine Supabase-Projektkennung) | `smlmywkagudkkbrijpld` |
| **Callback-Adresse** (für FatSecret) | `https://smlmywkagudkkbrijpld.supabase.co/functions/v1/fatsecret/callback` |
| **LifeHub im Netz** | `https://erikehnert-creator.github.io/lifehub/` |

> Der Consumer Key und das Consumer Secret aus Teil B stehen **absichtlich nicht** in
> dieser Anleitung. Sie gehören nur in das Supabase-Fenster aus Teil C und in keine
> Datei, die irgendwo mitgesichert wird.

---

## A. FatSecret auf dem iPhone vorbereiten

Hier ist fast nichts zu tun – das ist Absicht. Du musst nur sicher wissen, **welches**
Konto du gleich freigibst.

1. Öffne auf dem iPhone die **FatSecret**-App.
2. Tippe unten rechts auf **Mehr** (drei Punkte bzw. Menüsymbol).
3. Tippe ganz oben auf deinen Namen bzw. auf **Konto** / **Mein Konto**.
4. **Notiere dir die E-Mail-Adresse**, die dort steht. Genau dieses Konto musst du in
   Teil D freigeben.

   Falls dort *„Mit Google angemeldet"* oder *„Mit Apple angemeldet"* steht: merk dir
   das. In Teil D musst du dann denselben Knopf benutzen und nicht E-Mail + Passwort.

5. Trage zum Test ein beliebiges Lebensmittel für **heute** ein, zum Beispiel beim
   Frühstück. Das brauchst du in Teil E.

**Was du in der iPhone-App NICHT einstellen musst:**

- Es gibt dort keinen Schalter für LifeHub, und du brauchst auch keinen.
- Du musst nichts exportieren, nichts teilen und keine Datei verschicken.
- Du musst in der App nichts „synchronisieren" – sie tut das von selbst, sobald du
  online bist.

---

## B. FatSecret Developer Portal – Anwendung anlegen

Hier holst du dir zwei Zeichenketten ab: **Consumer Key** und **Consumer Secret**. Sie
sind der Ausweis, mit dem *LifeHub* (nicht du) bei FatSecret anklopft.

1. Öffne am PC **<https://platform.fatsecret.com>**.
2. Klicke oben rechts auf **Sign Up** bzw. **Login**.

   Das ist ein **eigenes Konto** für Entwickler – es ist nicht dasselbe wie dein
   normales FatSecret-Konto vom iPhone, auch wenn du dieselbe E-Mail verwenden kannst.
   Wenn du noch keines hast: Registrieren, E-Mail bestätigen, einloggen.

3. Wähle die kostenlose Stufe (*Basic* / *Free*), wenn du gefragt wirst.

   Zur Frage, ob **Premier** nötig ist: In der FatSecret-Dokumentation ist die Methode
   für das Tagebuch (`food_entries.get.v2`) **nicht** als *Premier Exclusive*
   gekennzeichnet, und auch bei der Beschreibung des dreibeinigen OAuth steht keine
   Stufenanforderung. Nach heutigem Stand reicht also die kostenlose Stufe. Sicher
   zugesagt wird es nirgends – falls FatSecret den Zugriff später doch verweigert,
   sagt LifeHub dir das im Klartext (siehe Teil G, Zeile *Tagebuchzugriff nicht
   erlaubt*), und dann müsstest du FatSecret anschreiben.

4. Gehe zu **Dashboard → Applications → Add / Create Application**.
5. Fülle aus:

   | Feld | Was hinein |
   |---|---|
   | Application Name | `LifeHub` |
   | Description | `Persönliche App, übernimmt mein eigenes Ernährungstagebuch.` |
   | Application URL | `https://erikehnert-creator.github.io/lifehub/` |
   | Application Type | Web Application |

6. **Der wichtigste Schalter:** Suche die Einstellung für **OAuth** und schalte
   **3-Legged OAuth** (oft *„Allow 3-legged OAuth"*, *„User authorization"* oder
   *„Profile access"*) **ein**.

   Ohne diesen Schalter kann LifeHub nur allgemeine Lebensmitteldaten abfragen, aber
   niemals *dein* Tagebuch. Das ist der Fehler, der am häufigsten passiert.

7. Trage als **Callback URL** / **Redirect URI** genau das hier ein – ohne Leerzeichen,
   ohne Schrägstrich am Ende:

   ```
   https://smlmywkagudkkbrijpld.supabase.co/functions/v1/fatsecret/callback
   ```

8. Speichern.
9. Öffne die angelegte Anwendung. Dort stehen:

   - **Consumer Key** – eine lange Zeichenkette aus Ziffern und Buchstaben
   - **Consumer Secret** – ebenfalls lang; oft erst nach einem Klick auf *Show* sichtbar

   Kopiere beide in ein Textfenster, das du gleich wieder schließt. Nicht in OneDrive
   speichern, nicht in WhatsApp schicken, nicht in eine Notiz im Vault.

10. Falls du im Portal einen Abschnitt **IP Restrictions** siehst: Du kannst ihn
    ignorieren. Die IP-Sperre von FatSecret gilt für OAuth 2.0 – LifeHub benutzt
    OAuth 1.0 und ist genau deshalb so gebaut. Eine Supabase-Funktion hat keine feste
    IP-Adresse, über OAuth 2.0 wäre das gar nicht zuverlässig zu betreiben.

---

## C. Supabase vorbereiten

Hier hinterlegst du die beiden Zeichenketten aus Teil B auf deinem Server und
veröffentlichst die Funktion, die zwischen LifeHub und FatSecret vermittelt.

**Schon erledigt:** `0001_init.sql` und `0002_fatsecret.sql` hast du bereits im
SQL-Editor ausgeführt. Du musst sie nicht noch einmal ausführen.

### C.1 Das Fenster öffnen

1. Drücke `Windows-Taste`, tippe `powershell`, Enter.
2. Wechsle in den LifeHub-Ordner. Wenn LifeHub nach dem Umzug am neuen Ort liegt:

   ```
   cd "$HOME\OneDrive\Dokumente\Claude Gedächtniss\02 Projekte\LifeHub"
   ```

   Prüfe mit `ls`, ob dort `package.json` und der Ordner `supabase` liegen. Wenn ja,
   bist du richtig.

### C.2 Anmelden

```
npx supabase login
```

Beim ersten Mal fragt npx, ob das Paket installiert werden darf → `y` und Enter.
Es öffnet sich der Browser; melde dich bei Supabase an und bestätige. Danach steht im
schwarzen Fenster, dass du angemeldet bist.

> Geprüft mit Supabase CLI **2.117.0** und Node.js 24. Node.js muss mindestens
> Version 20 sein; deine Version zeigt `node --version`.

### C.3 Projekt verknüpfen

```
npx supabase link --project-ref smlmywkagudkkbrijpld
```

Du wirst nach dem **Datenbank-Passwort** deines Supabase-Projekts gefragt. Beim Tippen
erscheinen keine Zeichen – das ist normal, tippe einfach zu Ende und drücke Enter.

> Woher die Project Ref kommt, falls du sie je neu brauchst: Sie ist der mittlere Teil
> deiner Projektadresse `https://` **`smlmywkagudkkbrijpld`** `.supabase.co`. In Supabase
> steht sie unter *Project Settings → General → Reference ID*.

### C.4 Die beiden Zeichenketten hinterlegen

Ersetze `DEIN_KEY` und `DEIN_SECRET` durch die Werte aus Teil B, Schritt 9. Die
Anführungszeichen bleiben stehen.

```
npx supabase secrets set FATSECRET_CONSUMER_KEY="DEIN_KEY" FATSECRET_CONSUMER_SECRET="DEIN_SECRET"
```

Die Werte liegen danach bei Supabase und werden nie wieder angezeigt. Das ist der
Zweck der Übung: Sie kommen dadurch nie in LifeHub, nie in die `LifeHub.html` und nie
in dein Backup.

Prüfen, dass beide angekommen sind (zeigt nur die **Namen**, nicht die Werte):

```
npx supabase secrets list
```

### C.5 Die Funktion veröffentlichen

```
npx supabase functions deploy fatsecret --no-verify-jwt
```

Falls die Meldung kommt, dass **Docker** nicht läuft, nimm stattdessen:

```
npx supabase functions deploy fatsecret --no-verify-jwt --use-api
```

`--use-api` baut die Funktion auf Supabases Servern statt auf deinem PC – dann brauchst
du kein Docker.

**Warum `--no-verify-jwt`?** FatSecret schickt dich nach der Freigabe zurück, ohne eine
LifeHub-Anmeldung mitzuschicken – das kann FatSecret gar nicht. Ohne diesen Schalter
würde Supabase genau diesen Rückweg abweisen. Alle anderen Wege der Funktion (Status
abfragen, Tagebuch holen, trennen) prüfen deine Anmeldung weiterhin selbst.

### C.6 Kurz nachsehen

Öffne in Supabase **Edge Functions**. Dort muss `fatsecret` stehen, mit einem aktuellen
Zeitstempel. Wenn ja, ist Teil C fertig.

---

## D. Verbindung herstellen (auf dem iPhone)

Ab hier brauchst du den PC nicht mehr.

1. Öffne auf dem iPhone **Safari**.
2. Rufe auf: **`https://erikehnert-creator.github.io/lifehub/`**
3. Melde dich mit deinem **LifeHub-Konto** an, falls du noch nicht angemeldet bist:
   *Einstellungen → Synchronisation → E-Mail und Passwort → Anmelden*.

   Es muss dasselbe Konto sein, das du auch am PC benutzt. Sonst landet die
   FatSecret-Verbindung bei einem anderen Nutzer, und der PC sieht sie später nicht.
4. Gehe zu **Einstellungen**.
5. Öffne **Ernährung**.
6. Tippe auf **Mit FatSecret verbinden**.
7. Es öffnet sich die Anmeldeseite von **FatSecret**.
8. Melde dich mit **genau dem Konto aus Teil A** an – der E-Mail-Adresse, die du dir
   dort notiert hast. Wenn dort *„Mit Google/Apple angemeldet"* stand, nimm denselben
   Knopf.

   > Das ist die Stelle, an der am ehesten etwas schiefgeht: Wer hier aus Versehen ein
   > zweites FatSecret-Konto anlegt oder benutzt, verbindet ein leeres Tagebuch. LifeHub
   > holt dann brav null Einträge ab und meldet keinen Fehler.

9. FatSecret fragt, ob LifeHub auf dein Tagebuch zugreifen darf → **Zugriff erlauben**
   (*Allow* / *Authorize*).
10. Safari kehrt von selbst zu LifeHub zurück, auf die Ernährungsseite.
11. Dort muss unter **Verbindung** jetzt **verbunden** stehen.

    Steht dort noch *getrennt*: Seite einmal neu laden. Hilft das nicht → Teil G.

---

## E. Funktionstest

Jetzt prüfst du, dass wirklich Daten ankommen – und dass ein zweiter Abgleich nichts
doppelt anlegt.

### E.1 Ein Lebensmittel eintragen

1. Öffne die **FatSecret-App** auf dem iPhone.
2. Trage für **heute** ein leicht erkennbares Lebensmittel ein, zum Beispiel
   **Haferflocken, 100 g** zum Frühstück.
3. Warte kurz und bleib online – die App schickt den Eintrag von selbst zu FatSecret.
   Du musst nichts exportieren.

### E.2 Nach LifeHub holen

4. Öffne LifeHub (Webfassung auf dem iPhone oder die `LifeHub.html` am PC).
5. **Einstellungen → Ernährung → Jetzt abgleichen (7 Tage)**.
6. Warte, bis die Rückmeldung erscheint.

### E.3 Nachsehen, ob alles da ist

7. Gehe zu **Tracking → heutiger Tag**.
8. Unter **Gegessen** muss dein Lebensmittel stehen – mit Name, Mahlzeit und Portion.
9. Prüfe die Tageswerte. Für Haferflocken, 100 g, sollten grob passen:

   | Wert | Größenordnung |
   |---|---|
   | Kalorien | ~370 kcal |
   | Protein | ~13 g |
   | Kohlenhydrate | ~59 g |
   | Fett | ~7 g |
   | Ballaststoffe | ~10 g |

   Die genauen Zahlen hängen vom Produkt ab, das du in FatSecret gewählt hast. Wichtig
   ist nur: Es stehen Zahlen da, und sie stimmen mit dem überein, was die FatSecret-App
   dir für den Tag anzeigt.

   > Steht bei **Ballaststoffe** nichts: Das liegt fast immer am Lebensmittel, nicht an
   > LifeHub. Nicht jedes Produkt in FatSecrets Datenbank hat eine Ballaststoffangabe.
   > LifeHub schreibt dann bewusst **nichts** statt einer Null – „null Ballaststoffe
   > gegessen" und „dazu gibt es keine Angabe" sind zwei verschiedene Aussagen.

### E.4 Keine Dublette

10. Tippe **noch einmal** auf *Jetzt abgleichen (7 Tage)*.
11. Sieh wieder unter **Gegessen** nach: Das Lebensmittel muss **genau einmal**
    dastehen, nicht zweimal. Die Tageswerte dürfen sich nicht verdoppelt haben.

### E.5 Eine Änderung wird nachgezogen

12. Ändere in der FatSecret-App den Testeintrag, zum Beispiel von **100 g** auf
    **200 g**.
13. Gleiche in LifeHub erneut ab.
14. Unter **Gegessen** muss weiterhin **eine** Zeile stehen – jetzt mit den neuen
    Werten. Es darf keine zweite Zeile dazukommen.

    Das funktioniert, weil LifeHub die Zeile an FatSecrets eigener Eintrags-Nummer
    wiedererkennt und nicht am Namen.

### E.6 Am PC gegenprüfen

15. Öffne die `LifeHub.html` am PC.
16. **Einstellungen → Synchronisation → Jetzt synchronisieren**.
17. Gehe zu **Tracking → heutiger Tag**: Dort muss dasselbe Lebensmittel mit denselben
    Werten stehen.

    Das läuft über die normale LifeHub-Synchronisation, nicht über FatSecret – die
    Lebensmittel sind ganz gewöhnliche LifeHub-Daten, sobald sie einmal geholt wurden.

---

## F. Die lokale PC-Fassung (`LifeHub.html`)

**Warum die Verbindung nicht direkt aus der Einzeldatei geht**

Du öffnest `LifeHub.html` per Doppelklick. Die Adresse lautet dann
`file:///C:/…/LifeHub.html`. FatSecret muss dich nach der Freigabe irgendwohin
zurückschicken – aber eine Datei auf deiner Festplatte ist keine Adresse, die ein
Server im Internet aufrufen kann. Es gibt dorthin schlicht keinen Weg.

**Was LifeHub deshalb tut**

Tippst du in der Einzeldatei auf *Mit FatSecret verbinden*, steht auf dem Knopf
„(öffnet die Webfassung)", und es öffnet sich ein neues Fenster mit
`https://erikehnert-creator.github.io/lifehub/`. Die Freigabe erteilst du dort. Deine
geöffnete PC-Fassung bleibt dabei offen.

**Warum die Einzeldatei die Verbindung danach trotzdem kennt**

Das FatSecret-Zugangstoken landet nicht im Browser, sondern **auf deinem Supabase-Server,
hinterlegt bei deinem LifeHub-Konto**. Die Einzeldatei ist mit demselben Konto
angemeldet – also fragt sie den Server und bekommt dieselbe Antwort wie das iPhone.
Auf deiner Festplatte liegt zu keinem Zeitpunkt ein FatSecret-Token.

**Was du anklicken musst**

1. `LifeHub.html` öffnen.
2. **Einstellungen → Ernährung**.
3. Falls dort noch *getrennt* steht: auf **Verbindung prüfen** tippen.
4. Jetzt muss **verbunden** dastehen, und *Jetzt abgleichen* funktioniert wie am iPhone.

Wenn du Teil D schon auf dem iPhone gemacht hast, brauchst du in der PC-Fassung nur
Schritt 3. Ein zweites Mal freigeben musst du nichts.

---

## G. Fehlerbehebung

| Was du siehst | Was es bedeutet | Was du tust |
|---|---|---|
| „Auf dem Server fehlen noch die FatSecret-Zugangsdaten" | Teil C.4 fehlt oder nur eine der beiden Zeichenketten ist gesetzt | `npx supabase secrets list` – stehen dort **beide** Namen? Sonst C.4 wiederholen. Die Meldung sagt inzwischen, welcher der beiden fehlt. |
| „Die FatSecret-Funktion ist auf dem Server noch nicht veröffentlicht" | Teil C.5 fehlt oder ist fehlgeschlagen | C.5 wiederholen, bei Docker-Meldung mit `--use-api`. Danach in Supabase unter *Edge Functions* nachsehen, ob `fatsecret` dasteht. |
| **401** / „Der Server hat die Anmeldung abgelehnt" | Deine LifeHub-Anmeldung ist abgelaufen | *Einstellungen → Synchronisation* → abmelden, neu anmelden. Danach *Verbindung prüfen*. |
| **403** | Supabase weist die Funktion ab | Meist hat der Deploy `--no-verify-jwt` vergessen. C.5 genau so wiederholen, wie es dort steht. |
| **404** | Die Funktion gibt es unter dem Namen nicht | Der Funktionsname muss `fatsecret` sein (klein geschrieben). C.5 wiederholen. |
| „Der FatSecret-Schlüssel darf das persönliche Tagebuch nicht lesen" | 3-Legged OAuth ist für deinen Schlüssel nicht freigeschaltet – **der häufigste Fehler** | Teil B, Schritt 6. Danach im Portal speichern, in LifeHub *trennen* und Teil D neu machen. |
| Kein Premier/API-Zugang, FatSecret verweigert trotz Schritt 6 | FatSecret verlangt für dein Konto doch eine höhere Stufe | Im Developer Portal Support anschreiben und nach Tagebuchzugriff (`food_entries.get.v2`, 3-legged OAuth) fragen. Bis dahin bleibt die Ernährungserfassung von Hand. |
| „Diese Freigabe ist abgelaufen oder wurde schon verwendet" | Zwischen *Verbinden* und *Erlauben* war zu viel Zeit, oder du hast den Rückweg-Link zweimal geöffnet | In LifeHub erneut auf *Mit FatSecret verbinden* tippen und zügig durchklicken. |
| „Die Freigabe hat nicht geklappt" nach der Rückkehr | Du hast bei FatSecret **Abbrechen** / **Deny** gedrückt | Teil D noch einmal, diesmal *Zugriff erlauben*. |
| Verbindung steht, aber es kommen **0 Einträge** | Fast immer: **falsches FatSecret-Konto** freigegeben | In LifeHub *trennen*. In Safari bei FatSecret abmelden. Teil D wiederholen und dabei genau die E-Mail aus Teil A verwenden. |
| „Der eigene Server war nicht erreichbar" | Kein Internet, oder Supabase gerade nicht erreichbar | Verbindung prüfen und später erneut abgleichen. Deine LifeHub-Daten sind davon nicht betroffen. |
| „Die FatSecret-Funktion auf dem Server ist älter als diese Fassung" | Die Edge Function ist ein alter Stand | C.5 noch einmal ausführen. |
| Callback-Fehler bei FatSecret, Seite bleibt hängen | Die Callback-Adresse im Portal weicht ab | Teil B, Schritt 7 – Zeichen für Zeichen vergleichen. Kein Leerzeichen, kein Schrägstrich am Ende, `https` nicht `http`. |
| „Invalid consumer key" o. ä. | Consumer Key falsch kopiert (oft ein Leerzeichen mitkopiert) | C.4 wiederholen, beim Kopieren auf Leerzeichen am Anfang/Ende achten. |
| Freigabe bricht direkt ab, Key ist aber richtig | Dann ist das **Secret** falsch | C.4 wiederholen. Im Portal notfalls ein neues Secret erzeugen und beide Werte neu setzen. |
| „Für FatSecret muss LifeHub beim eigenen Server angemeldet sein" | Du bist in LifeHub nicht angemeldet | *Einstellungen → Synchronisation* → anmelden. |
| Normale LifeHub-Synchronisation läuft, FatSecret nicht | Das sind zwei verschiedene Dinge: Die Synchronisation gleicht LifeHub mit deinem Server ab, FatSecret holt von FatSecret | Teil C komplett durchgehen – die Edge Function ist unabhängig vom Rest. |
| Im Web verbunden, in der `LifeHub.html` noch „getrennt" | Die Einzeldatei hat den Status nur noch nicht abgefragt | Teil F, Schritt 3: **Verbindung prüfen**. Bist du in der Einzeldatei mit einem *anderen* Konto angemeldet, hilft nur: abmelden und mit demselben Konto anmelden. |

---

## Was die Schnittstelle grundsätzlich nicht kann

Damit du nicht danach suchst:

- **Nur lesen.** LifeHub kann nichts nach FatSecret zurückschreiben. Erfasst wird
  weiterhin dort.
- **Kein Anstoß von außen.** FatSecret meldet sich nicht, wenn du etwas einträgst.
  Abgeglichen wird, wenn du die Ernährungsseite öffnest oder den Knopf drückst.
  Deshalb holt ein Abgleich immer die letzten sieben Tage mit – Nachträge und
  Korrekturen kommen so noch an.
- **Keine Getränkemenge.** Wasser trägst du weiter von Hand ein.
- **FatSecret hat Vorrang.** Für einen Tag, den FatSecret liefert, gilt dessen Zahl.
  Ein konkurrierender Handeintrag wandert in den Papierkorb, damit nicht beide Werte
  zusammengezählt werden. Der Abgleich sagt dir, wenn das passiert ist.
- **Mehrfach abgleichen schadet nie.** Zweimal drücken, PC und iPhone gleichzeitig –
  es entsteht nichts doppelt. LifeHub erkennt jeden Eintrag an FatSecrets eigener
  Nummer wieder.

---

## Quellen

- FatSecret, Tagebuch abrufen: <https://platform.fatsecret.com/docs/v2/food_entries.get>
- FatSecret, dreibeiniges OAuth 1.0: <https://platform.fatsecret.com/docs/guides/authentication/oauth1/three-legged>
- FatSecret, IP-Sperre gilt für OAuth 2.0: <https://github.com/fatsecret-group/postman-fatsecret-apis/blob/main/readme.md>
- Supabase CLI: <https://supabase.com/docs/guides/local-development/cli/getting-started>

Stand: 13.09.2026, geprüft gegen Supabase CLI 2.117.0.
