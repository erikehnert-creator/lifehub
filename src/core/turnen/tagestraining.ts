/**
 * Tagestraining: Was steht heute konkret an, und welcher Tageskontext gilt?
 *
 * ---------------------------------------------------------------------------
 * Eine Auswahl, keine neue Trainingslogik
 *
 * Phase 3A sagt, was sich lohnt. 3D verschiebt die Priorität nach dem
 * Wettkampfabstand. 3B verteilt das Ergebnis auf die vorhandenen Termine.
 * **Phase 3E wählt daraus den heutigen Termin aus** und stellt ihn neben den
 * Tageskontext.
 *
 * Dieses Modul entscheidet deshalb **nicht**:
 *
 *   - welches Gerät wichtig ist (2C/2D)
 *   - welche Elemente auffallen (2D)
 *   - ob Schwierigkeit oder Ausführung der Ansatzpunkt ist (2C)
 *   - ob Entwicklungsarbeit zurückgestellt wird (3D)
 *   - wie die Wettkampfphase lautet (3D)
 *   - welches Gerät an welchen Tag kommt (3B)
 *
 * Es liest diese Antworten und ordnet sie dem heutigen Tag zu.
 *
 * ---------------------------------------------------------------------------
 * Die Abhängigkeitsrichtung
 *
 *     2C / 2D / 2E ──> 3A ──> 3D ──> 3B ──> **3E**
 *
 * Nur nach unten. `wochenplanung.ts` und `vorbereitungsstrategie.ts`
 * importieren dieses Modul ausdrücklich nicht; es gibt keine Rückkopplung
 * `3E → 3A` oder `3E → 3D`. Ein Test liest die `import`-Zeilen und hält das
 * fest.
 *
 * ---------------------------------------------------------------------------
 * Schlaf ist Kontext, kein Trainingsregler
 *
 * Die Nacht auf heute steht neben der Einheit, weil sie zum Tag gehört. Sie
 * **verändert nichts**: Sie entfernt kein Gerät, verbietet keine
 * Schwierigkeit, streicht keinen Kürdurchgang, reduziert kein Volumen und
 * behauptet kein Verletzungsrisiko. „Nur sechs Stunden geschlafen, also heute
 * kein schweres Element" wäre eine trainingswissenschaftliche Aussage, für die
 * in LifeHub nichts steht.
 *
 * Es gibt deshalb auch **keine Schlafampel und keine Bewertung**. Der
 * Zielbereich der Metrik `sleep_h` (7–9 h) existiert und wird hier bewusst
 * nicht herangezogen – eine Kategorie „zu wenig geschlafen" neben einem
 * Trainingsplan liest sich als Anweisung, und genau die soll es noch nicht
 * geben.
 *
 * Die Nacht wird hier auch **nicht gerechnet**: `NachtKontext` kommt fertig
 * herein. Welche Schlafepisode zu welchem Kalendertag gehört, entscheidet
 * ausschliesslich `sleep_sessions.day` – der Morgen des Aufwachens, gesetzt
 * beim Import (`supabase/functions/schlaf/aggregat.ts`). Damit zählt die Nacht
 * von Sonntagabend bis Montagmorgen zum Montag, ganz ohne eine zweite
 * Datumsdefinition in diesem Modul.
 *
 * ---------------------------------------------------------------------------
 * Keine minutengenaue Planung
 *
 * Die Entscheidung aus Phase 3A bleibt: **keine Minuten je Gerät.** Auch wenn
 * 90 Minuten bekannt sind, steht hier nirgends „37 min Barren". Verwendet wird
 * ausschliesslich die vorhandene qualitative Kapazität
 * (`kapazitaetAus`, `plaetzeFuer` aus `wochenplanung.ts`) – keine zweite
 * Kapazitätsrechnung.
 *
 * ---------------------------------------------------------------------------
 * Die Session ist die einzige Wahrheit über die Durchführung
 *
 * Erfasst wird mit dem **vorhandenen** Weg: dieselbe `workout_sessions`-Zeile
 * wird auf `completed` gesetzt, die Versuche gehen nach `gym_attempts`, die
 * Durchgänge nach `gym_routine_runs`. Es entsteht **keine zweite Session** und
 * keine parallele Erfassungsoberfläche.
 *
 * Gespeichert wird von diesem Modul **nichts**. Es gibt keine Tabelle
 * `daily_training_plan`, `readiness` oder `daily_adjustment`: Der heutige Plan
 * ergibt sich aus Terminen, Trainingsdaten und Tageskontext und ändert sich
 * mit ihnen. Was wirklich passiert ist, steht in den drei Tabellen oben.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import type { DayString } from '../dates'
import { relativeDay } from '../dates'
import type { WorkoutSession } from '../types'
import {
  KAPAZITAET_LABEL, kapazitaetAus, plaetzeFuer,
  type EinheitGeraet, type Kapazitaet, type WochenBild,
} from './wochenplanung'
import type { VorbereitungsBild } from './vorbereitungsstrategie'

/* ============================================================== Status */

/**
 * Was heute los ist.
 *
 * Die Reihenfolge der Prüfung ist die Dringlichkeit: Ein Wettkampf schlägt
 * alles, ein offener Termin schlägt einen schon erfassten (es steht ja noch
 * etwas aus), und „nichts geplant" ist die letzte Antwort – nie die erste.
 *
 *   | Status | wann |
 *   |---|---|
 *   | `wettkampftag` | Phase 3D sagt Wettkampftag |
 *   | `geplant` | heute steht mindestens ein Turntermin offen |
 *   | `erfasst` | heute ist mindestens eine Turneinheit erfasst |
 *   | `ausgefallen` | heute ist ein Termin als ausgefallen vermerkt |
 *   | `kein_training` | keines davon |
 */
export type TagesStatus =
  | 'wettkampftag'
  | 'geplant'
  | 'erfasst'
  | 'ausgefallen'
  | 'kein_training'

export const STATUS_TEXT: Record<TagesStatus, string> = {
  wettkampftag: 'Heute ist Wettkampf.',
  geplant: 'Heute ist Turntraining geplant.',
  erfasst: 'Heutiges Turntraining erfasst.',
  ausgefallen: 'Der heutige Turntermin ist als ausgefallen vermerkt.',
  kein_training: 'Heute ist kein Turntraining geplant.',
}

/* ============================================================ Kapazität */

/**
 * Woher die Kapazität des heutigen Tages kommt.
 *
 *   `dauer`  An der Einheit steht eine Dauer. **Damit hat Phase 3B schon
 *            gerechnet** (`plaetzeFuer`), und 3E stellt deshalb nichts
 *            zusätzlich zurück – sonst wirkte dieselbe Angabe zweimal.
 *   `tag`    Keine Dauer an der Einheit, aber die freie Zeit des Tages ist
 *            bekannt (`computeCapacity().freeMinutes`). Phase 3B lässt sie
 *            bewusst aussen vor, damit Turnen nicht an einem gepflegten
 *            Arbeitsplan hängt; für **heute** ist sie dagegen die genaueste
 *            Auskunft, die es gibt. Nur hier darf 3E etwas zurückstellen.
 *   `keine`  Weder noch – dann wird über die Kapazität nichts behauptet.
 */
export type KapazitaetsQuelle = 'dauer' | 'tag' | 'keine'

export const QUELLE_TEXT: Record<KapazitaetsQuelle, string> = {
  dauer: 'aus der hinterlegten Dauer der Einheit',
  tag: 'aus der heute noch freien Zeit',
  keine: '',
}

export interface TagesKapazitaet {
  /** Die vorhandene qualitative Kategorie – keine neue Rechnung. */
  kapazitaet: Kapazitaet
  quelle: KapazitaetsQuelle
  /** Die Dauer an der Einheit, falls hinterlegt. Wird nicht geraten. */
  dauerMinuten: number | null
  /** Freie Minuten des Tages aus `computeCapacity()`, falls bekannt. */
  freieMinuten: number | null
  /** Wie viele Geräteplätze das ergibt – über `plaetzeFuer()`. */
  plaetze: number
}

/**
 * Die Kapazität des heutigen Tages – aus vorhandenen Angaben.
 *
 * **Eine Dauer an der Einheit gewinnt.** Sie ist die Angabe über das Training
 * selbst; die freie Zeit des Tages ist nur die Angabe über den Tag. Geraten
 * wird keine von beiden.
 */
export function tagesKapazitaet(
  dauerMinuten: number | null,
  freieMinuten: number | null,
): TagesKapazitaet {
  if (dauerMinuten && dauerMinuten > 0) {
    const kapazitaet = kapazitaetAus(dauerMinuten)
    return {
      kapazitaet, quelle: 'dauer', dauerMinuten, freieMinuten,
      plaetze: plaetzeFuer(kapazitaet),
    }
  }
  if (freieMinuten !== null && freieMinuten > 0) {
    const kapazitaet = kapazitaetAus(freieMinuten)
    return {
      kapazitaet, quelle: 'tag', dauerMinuten: null, freieMinuten,
      plaetze: plaetzeFuer(kapazitaet),
    }
  }
  return {
    kapazitaet: 'unbekannt', quelle: 'keine',
    dauerMinuten: null, freieMinuten,
    plaetze: plaetzeFuer('unbekannt'),
  }
}

/** Der Grund, warum ein Gerät heute zurückgestellt ist – an einer Stelle. */
export const ZURUECK_GRUND = 'kurze verfügbare Einheit'

/** „kurze Einheit · aus der heute noch freien Zeit" – oder leer. */
export function kapazitaetText(k: TagesKapazitaet): string {
  const label = KAPAZITAET_LABEL[k.kapazitaet]
  if (!label) return ''
  const quelle = QUELLE_TEXT[k.quelle]
  return quelle ? `${label} · ${quelle}` : label
}

/* ============================================================== Eingang */

/**
 * Die Nacht auf heute – **fertig gerechnet** aus `sleep_sessions`.
 *
 * Dieses Modul aggregiert keine Schlafepisoden, berechnet keine
 * Schlafmetriken und deutet keine Sleep-Cycle-Daten. Es bekommt die Zeile und
 * zeigt, was darin steht (Abschnitt 23.6).
 */
export interface NachtKontext {
  /** Der Tag, dem die Nacht zugerechnet ist: der Morgen des Aufwachens. */
  day: DayString
  /** Tatsächlich geschlafen, in Minuten. */
  dauerMinuten: number
  von: string
  bis: string
  /** Woher die Werte stammen, z. B. „Apple Health". */
  quelle: string | null
}

/** Eine Turneinheit von heute, wie die Oberfläche sie übergibt. */
export interface TagesSitzung {
  sessionId: string
  status: WorkoutSession['status']
  titel: string | null
  dauerMinuten: number | null
  /**
   * Erfasste Elementversuche dieser Einheit – nur für die Zusammenfassung.
   *
   * Gezählt vom Aufrufer über die vorhandenen Bilder; dieses Modul sieht
   * `gym_attempts` nicht.
   */
  versuche: number
  /** Erfasste Kürdurchgänge dieser Einheit. */
  durchgaenge: number
  /** Die Gerätenamen der erfassten Versuche, in Wettkampfreihenfolge. */
  geraete: string[]
}

export interface TagesTrainingEingang {
  heute: DayString
  /** **Alle** Turneinheiten mit dem heutigen Tag – jeder Status, ungefiltert. */
  sitzungenHeute: TagesSitzung[]
  /**
   * Das fertige Phase-3B-Bild.
   *
   * Die heutigen Inhalte kommen daraus und werden **nicht** neu verteilt.
   * Weil 3B auf dem von 3D angepassten Plan sitzt, kann eine wettkampfnah
   * zurückgestellte Entwicklungsarbeit hier gar nicht wieder auftauchen.
   */
  woche: WochenBild
  /** Das fertige Phase-3D-Bild – nur für den Wettkampftag und die Anzeige. */
  vorbereitung: VorbereitungsBild
  /** Name der Tagesart, falls hinterlegt – reiner Kontext. */
  tagesart: string | null
  /** Freie Minuten des Tages aus `computeCapacity()`, oder `null`. */
  freieMinuten: number | null
  /** Die Nacht auf heute, oder `null`. */
  nacht: NachtKontext | null
  /**
   * Heute eingetragener Wert der vorhandenen Metrik `energy`, oder `null`.
   *
   * Reiner Kontext und Eriks eigene Angabe. Es entsteht dafür **kein** neues
   * Datenmodell, und es wird nichts daraus gefolgert.
   */
  energie: number | null
}

/* ============================================================== Ausgang */

/** Eine heute offene Turneinheit mit ihren Inhalten. */
export interface TagesEinheit {
  sessionId: string
  titel: string | null
  kapazitaet: TagesKapazitaet
  /** Die Geräte aus Phase 3B – Reihenfolge unverändert. */
  geraete: EinheitGeraet[]
  /**
   * Wegen der heutigen Kapazität nicht eingeplant – **nicht gelöscht.**
   *
   * Sie stehen hier, werden in der Oberfläche benannt und lassen sich
   * zurückholen. Nichts davon gilt als absolviert.
   */
  zurueckgestellt: EinheitGeraet[]
}

/** Eine heute schon erfasste Turneinheit – rein beschreibend. */
export interface ErfassteEinheit {
  sessionId: string
  titel: string | null
  dauerMinuten: number | null
  versuche: number
  durchgaenge: number
  geraete: string[]
}

export interface TagesKontext {
  tagesart: string | null
  kapazitaet: TagesKapazitaet
  nacht: NachtKontext | null
  energie: number | null
}

export interface TagesTrainingBild {
  status: TagesStatus
  tag: DayString
  /** Die heute offenen Einheiten – **alle**, keine stille Auswahl. */
  einheiten: TagesEinheit[]
  /** Was heute schon erfasst ist. */
  erfasst: ErfassteEinheit[]
  /** Heute als ausgefallen vermerkte Termine. */
  ausgefallen: { sessionId: string; titel: string | null }[]
  /** Der nächste geplante Turntermin **nach** heute, oder `null`. */
  naechsteEinheit: { sessionId: string; day: DayString; label: string } | null
  kontext: TagesKontext
}

/**
 * Das heutige Trainingsbild – in einem Durchgang.
 *
 * Betrifft **einen** Kalendertag und wenige Zeilen: Die Wochenverteilung, die
 * Wettkampfphase und die Trainingsbilder kommen fertig herein. Es wird nichts
 * über den gesamten Bestand gelesen.
 */
export function tagestraining(e: TagesTrainingEingang): TagesTrainingBild {
  /* Die heutigen Einheiten aus Phase 3B - mit ihren Inhalten. Die Reihenfolge
     ist die von 3B (Tag, dann Session-ID): Es gibt an einer `workout_session`
     keine Uhrzeit, und eine erfundene Sortierung waere schlechter als eine
     feste. Mehrere Termine am selben Tag werden ALLE gezeigt; still einen
     davon zu waehlen hiesse, den anderen zu verlieren (23.4). */
  const inhalteVon = new Map(
    e.woche.einheiten.filter((u) => u.day === e.heute).map((u) => [u.sessionId, u]))

  const offene = e.sitzungenHeute.filter((s) => s.status === 'planned')
  const einheiten: TagesEinheit[] = offene.map((s) => {
    const aus3B = inhalteVon.get(s.sessionId)
    const kapazitaet = tagesKapazitaet(s.dauerMinuten, e.freieMinuten)
    const alle = aus3B?.geraete ?? []
    const { geraete, zurueckgestellt } = nachKapazitaet(alle, kapazitaet)
    return { sessionId: s.sessionId, titel: s.titel, kapazitaet, geraete, zurueckgestellt }
  })

  const erfasst: ErfassteEinheit[] = e.sitzungenHeute
    .filter((s) => s.status === 'completed')
    .map((s) => ({
      sessionId: s.sessionId,
      titel: s.titel,
      dauerMinuten: s.dauerMinuten,
      versuche: s.versuche,
      durchgaenge: s.durchgaenge,
      geraete: s.geraete,
    }))

  const ausgefallen = e.sitzungenHeute
    .filter((s) => s.status === 'skipped')
    .map((s) => ({ sessionId: s.sessionId, titel: s.titel }))

  /* Der naechste Termin NACH heute - aus derselben 3B-Liste, die schon
     chronologisch ist. Kein zweites Durchsuchen der Sitzungen. */
  const naechste = e.woche.einheiten.find((u) => u.day > e.heute) ?? null

  return {
    status: statusAus(e.vorbereitung, offene.length, erfasst.length, ausgefallen.length),
    tag: e.heute,
    einheiten,
    erfasst,
    ausgefallen,
    naechsteEinheit: naechste
      ? {
        sessionId: naechste.sessionId,
        day: naechste.day,
        label: relativeDay(naechste.day, e.heute),
      }
      : null,
    kontext: {
      tagesart: e.tagesart,
      // Ohne offene Einheit gilt die Kapazitaet des Tages selbst.
      kapazitaet: einheiten[0]?.kapazitaet ?? tagesKapazitaet(null, e.freieMinuten),
      nacht: e.nacht,
      energie: e.energie,
    },
  }
}

export function statusAus(
  vorbereitung: VorbereitungsBild,
  offen: number,
  erfasst: number,
  ausgefallen: number,
): TagesStatus {
  if (vorbereitung.phase === 'wettkampftag') return 'wettkampftag'
  if (offen > 0) return 'geplant'
  if (erfasst > 0) return 'erfasst'
  if (ausgefallen > 0) return 'ausgefallen'
  return 'kein_training'
}

/**
 * Die Geräte auf die heutige Kapazität zuschneiden.
 *
 * **Nicht neu priorisiert.** Die Reihe bleibt die von 3B, also die von 3A;
 * zurückgestellt wird von hinten. Ein `schwerpunkt` wird dabei **nie**
 * verdrängt – er ist genau das, was auch in einer kurzen Einheit bleiben soll.
 *
 * Und nur bei `quelle === 'tag'`: Steht an der Einheit eine Dauer, hat Phase
 * 3B die Plätze damit schon begrenzt, und was dort nicht hineinpasste, steht
 * in `WochenBild.offen`. Dasselbe ein zweites Mal anzuwenden würde die Einheit
 * doppelt kürzen.
 */
export function nachKapazitaet(
  alle: EinheitGeraet[],
  k: TagesKapazitaet,
): { geraete: EinheitGeraet[]; zurueckgestellt: EinheitGeraet[] } {
  if (k.quelle !== 'tag' || alle.length <= k.plaetze) {
    return { geraete: alle, zurueckgestellt: [] }
  }

  const geraete = [...alle]
  const zurueckgestellt: EinheitGeraet[] = []
  // Von hinten, und nur was kein Schwerpunkt ist.
  for (let i = geraete.length - 1; i >= 0 && geraete.length > k.plaetze; i--) {
    if (geraete[i].rolle === 'schwerpunkt') continue
    zurueckgestellt.unshift(geraete[i])
    geraete.splice(i, 1)
  }
  return { geraete, zurueckgestellt }
}

/* ======================================================= Nutzerwahl */

/**
 * Was der Nutzer für heute selbst entscheidet.
 *
 * **Nichts davon wird gespeichert.** Für einen „heutigen Plan" gibt es kein
 * Datenmodell, und es soll keines geben: Was wirklich trainiert wurde, steht
 * hinterher in `gym_attempts`, `gym_routine_runs` und der Session. Eine
 * gespeicherte Tagesauswahl wäre ab dem ersten erfassten Versuch eine zweite
 * Wahrheit – dieselbe Überlegung wie bei `planMitAuswahl()` in Phase 3A und
 * `wocheMitAuswahl()` in Phase 3B.
 */
export interface TagesAuswahl {
  /** Geräte, die der Nutzer für heute abgewählt hat. */
  ohne?: readonly string[]
  /** Zurückgestellte Geräte, die er doch mitnehmen will. */
  zusatz?: readonly string[]
  /** Entfernte Inhalte, je `Inhalt.key`. */
  ohneInhalte?: readonly string[]
}

/**
 * Das Tagesbild, wie der Nutzer es haben will – eine reine Funktion.
 *
 * Dieselben Fälle wie in 3A und 3B, damit sie sich einzeln nachrechnen lassen:
 *
 *   - ein abgewähltes Gerät wandert in die zurückgestellten, nicht ins Nichts
 *   - ein zurückgeholtes Gerät steht wieder an seinem Platz in der 3B-Reihe
 *   - ein entfernter Inhalt fällt heraus; bleibt nichts übrig, bleibt das
 *     Gerät trotzdem stehen
 */
export function tagMitAuswahl(
  bild: TagesTrainingBild,
  a: TagesAuswahl = {},
): TagesTrainingBild {
  const ohne = new Set(a.ohne ?? [])
  const zusatz = new Set(a.zusatz ?? [])
  const ohneInhalte = new Set(a.ohneInhalte ?? [])
  if (!ohne.size && !zusatz.size && !ohneInhalte.size) return bild

  const einheiten = bild.einheiten.map((u) => {
    // Erst die Reihe von 3B wiederherstellen, dann neu aufteilen - so landet
    // ein zurueckgeholtes Geraet an seinem Platz und nicht am Ende.
    const reihe = [...u.geraete, ...u.zurueckgestellt]
    const platz = new Map(
      [...u.geraete, ...u.zurueckgestellt].map((g, i) => [g.apparatus, i]))
    reihe.sort((x, y) => (platz.get(x.apparatus) ?? 0) - (platz.get(y.apparatus) ?? 0))

    const warZurueck = new Set(u.zurueckgestellt.map((g) => g.apparatus))
    const geraete: EinheitGeraet[] = []
    const zurueckgestellt: EinheitGeraet[] = []
    for (const g of reihe) {
      const drin = ohne.has(g.apparatus)
        ? false
        : zusatz.has(g.apparatus) || !warZurueck.has(g.apparatus)
      const gefiltert = ohneInhalte.size
        ? { ...g, inhalte: g.inhalte.filter((i) => !ohneInhalte.has(i.key)) }
        : g
      if (drin) geraete.push(gefiltert)
      else zurueckgestellt.push(gefiltert)
    }
    return { ...u, geraete, zurueckgestellt }
  })

  return { ...bild, einheiten }
}

/* ====================================================== Für die Anzeige */

/** „3 Geräte heute" – Einzahl ist kein Sonderfall zum Vergessen. */
export function geraeteHeuteLabel(n: number): string {
  return n === 1 ? '1 Gerät heute' : `${n} Geräte heute`
}

/** „12 Versuche · 2 Kürdurchgänge" – nur erfasste Zahlen, kein Urteil. */
export function erfasstText(u: ErfassteEinheit): string {
  const teile: string[] = []
  if (u.geraete.length) teile.push(u.geraete.join(' · '))
  if (u.versuche > 0) teile.push(u.versuche === 1 ? '1 Versuch' : `${u.versuche} Versuche`)
  if (u.durchgaenge > 0) {
    teile.push(u.durchgaenge === 1 ? '1 Kürdurchgang' : `${u.durchgaenge} Kürdurchgänge`)
  }
  // Ausdruecklich kein "gut gelaufen" und kein "Ziel erreicht": Erfasst ist
  // erfasst, und was es wert war, entscheidet nicht die App.
  return teile.join(' · ')
}

/**
 * **Schlaf ist in Phase 3E kein Trainingsregler.**
 *
 * Merkposten im Quelltext, wie `KEINE_PERIODISIERUNG` in
 * `vorbereitungsstrategie.ts` und `KEIN_READINESS_SCORE` in
 * `wettkampfvorbereitung.ts`: Wer hier aus der Nacht ein Gerät entfernt, eine
 * Schwierigkeit verbietet, ein Volumen reduziert, eine Ampel baut oder ein
 * Verletzungsrisiko behauptet, verlässt den Rahmen – nicht aus Vorsicht,
 * sondern weil in LifeHub keine Daten dafür stehen.
 */
export const SCHLAF_IST_KONTEXT = true
