/**
 * Wo stand ich in meinem Teilnehmerfeld?
 *
 * ---------------------------------------------------------------------------
 * Diese Datei sieht keine Personendaten
 *
 * `VergleichsTeilnehmer` hat **kein Feld für Name, Jahrgang oder Verein**. Das
 * ist keine Nachlässigkeit, sondern der Punkt: Die Vergleichsrechnung kann
 * fremde Personendaten nicht weitergeben, weil sie sie nie bekommt. Was aus
 * dem Protokoll herüberkommt, filtert `ausProtokoll()` – eine Stelle, an der
 * nachzulesen ist, was mitgeht.
 *
 * Gespeichert wird danach nur das Ergebnis dieser Rechnung: Feldgrösse,
 * Median, Bestwert und mein Platz. Aus diesen Zahlen lässt sich keine Person
 * zurückgewinnen (TURNEN_ARCHITEKTUR.md, 16.2).
 *
 * ---------------------------------------------------------------------------
 * Es wird keine Wertung erfunden
 *
 * Gerechnet wird ausschliesslich **innerhalb einer Messgrösse an einem Gerät**:
 * mein D-Wert gegen die D-Werte derselben Gruppe an demselben Gerät. Nie wird
 * eine Bodennote gegen eine Pferdnote gehalten, nie D gegen E verrechnet, nie
 * ein Gesamtwert aus Teilwerten gebildet.
 *
 * Reine Logik ohne Datenbank, ohne Netzwerk und ohne React.
 */
import { stableId } from '../ids'
import { GERAETE, istGeraet } from './geraete'

/** Der Mehrkampf als Messgrösse neben den sechs Geräten. */
export const MEHRKAMPF = 'mehrkampf'

/** Woher Vergleichswerte stammen können. */
export const QUELLE_SCORE_PDF = 'score-pdf'

/**
 * Ein Teilnehmer, soweit der Vergleich ihn braucht.
 *
 * Bewusst ohne Name, Jahrgang und Verein – siehe Dateikopf.
 */
export interface VergleichsTeilnehmer {
  /** Die Leistungs- und Altersklasse, z. B. „LK 2 AK 18-29". */
  klasse: string
  /** Der Mehrkampfplatz aus dem Protokoll, nur für die Stimmigkeitsprüfung. */
  rang: number | null
  gesamt: number | null
  geraete: {
    apparatus: string
    d: number | null
    e: number | null
    final: number | null
  }[]
}

/* ============================================================== Zahlen */

/**
 * Eine Note als Ganzzahl in Tausendsteln – oder `null`.
 *
 * Verglichen wird nie auf Gleitkommazahlen. Zwei gleich gedruckte Noten ergeben
 * zwar dasselbe `double`, aber eine gerechnete Zahl tut das nicht zwingend, und
 * ein Gleichstand, der an der siebzehnten Stelle auseinandergeht, wäre keiner
 * mehr. Drei Nachkommastellen sind das Maximum jeder Wertungsvorschrift und
 * genau das, was `formatNote()` anzeigt.
 */
export function milli(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  return Math.round(n * 1000)
}

/** Aus Tausendsteln zurück in eine Note. */
export function ausMilli(n: number | null): number | null {
  return n === null ? null : n / 1000
}

/**
 * Der Median einer aufsteigend sortierten Reihe in Tausendsteln.
 *
 * Bei gerader Anzahl das Mittel der beiden mittleren Werte. Kein Mittelwert
 * über alles: Bei sechs Turnern zieht ein einzelner Ausrutscher den Mittelwert
 * weit vom Feld weg – und „das typische Niveau" ist genau das, was er dann
 * nicht mehr beschreibt.
 */
function medianVon(sortiert: number[]): number {
  const n = sortiert.length
  const mitte = Math.floor(n / 2)
  return n % 2 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2
}

/* =============================================================== Rang */

/** Mein Platz in einer Reihe von Werten – und wie die Reihe aussieht. */
export interface RangWert {
  /** 1 + Anzahl der echt besseren Werte. */
  rang: number
  /** Wie viele denselben Wert haben, mich eingeschlossen. 1 heisst: allein. */
  gleich: number
  /** Wie viele diesen Wert überhaupt haben – nur unter ihnen wird gerangt. */
  anzahl: number
  /** In Tausendsteln, wie alle Werte dieser Struktur. */
  median: number
  best: number
}

/**
 * Mein Platz unter den anderen – höher ist besser.
 *
 * `rang = 1 + Anzahl der echt höheren Werte`. Bei Gleichstand bekommen alle
 * denselben Platz, und `gleich` sagt, wie viele es sind: Zwei Turner mit
 * demselben D-Wert, einer darüber, ergibt für beide **Platz 2 geteilt** – und
 * nicht Platz 2 und Platz 3.
 *
 * **Fehlende Werte zählen nicht mit.** Wer an diesem Gerät keinen E-Wert hat,
 * ist keine 0, sondern steht nicht in dieser Reihe; `anzahl` ist deshalb nicht
 * zwingend die Feldgrösse. Eine ausgewiesene 0 ist dagegen ein Wert und bleibt
 * drin – fehlend und null sind nicht dasselbe.
 *
 * `null`, wenn ich selbst keinen Wert habe: Dann gibt es nichts zu vergleichen.
 */
export function rangIn(werte: (number | null)[], mein: number | null): RangWert | null {
  if (mein === null) return null
  const da = werte.filter((w): w is number => w !== null)
  if (!da.length) return null

  let hoeher = 0
  let gleich = 0
  for (const w of da) {
    if (w > mein) hoeher++
    else if (w === mein) gleich++
  }
  // Mein eigener Wert muss in der Reihe stehen, sonst waere der Platz von
  // aussen gerechnet - und "1. von 5" hiesse in Wahrheit "1. von 6".
  if (!gleich) return null

  const sortiert = da.slice().sort((a, b) => a - b)
  return {
    rang: 1 + hoeher,
    gleich,
    anzahl: da.length,
    median: medianVon(sortiert),
    best: sortiert[sortiert.length - 1],
  }
}

/**
 * Wo ich im Feld stehe – 0 bis 1, höher ist besser.
 *
 * Die eine Zahl, mit der sich **Geräte untereinander** vergleichen lassen. Sie
 * ist der **normierte Mittelrang**:
 *
 *     Mittelrang = Platz + (Gleichstand − 1) / 2
 *     Position   = (Anzahl − Mittelrang) / (Anzahl − 1)
 *
 * Gleichwertig, und manchmal anschaulicher, als Anteil des Feldes hinter mir:
 *
 *     Position = (Anzahl echt schlechterer + 0,5 · (Gleichstand − 1)) / (Anzahl − 1)
 *
 * ---------------------------------------------------------------------------
 * Warum der Mittelrang und nicht einfach „wie viele sind schlechter"
 *
 * Gleichplatzierte belegen einen **Bereich** von Rängen, nicht einen Rang. Zwei
 * Turner mit demselben D-Wert an der Spitze belegen die Plätze 1 und 2; drei
 * gleiche in der Mitte eines Feldes von fünf belegen 2, 3 und 4. Der Mittelrang
 * gibt jedem die Mitte seines Bereichs – das ist die übliche Behandlung von
 * Bindungen und die einzige, die nach beiden Seiten gleich verfährt.
 *
 * Nur „Anzahl der echt schlechteren" zu zählen tat das **nicht**: Bei einem
 * vollständig gleichen Feld ist niemand schlechter, und alle sechs Turner
 * bekämen die Position 0 – ein Feld, in dem alle dasselbe geturnt haben, stünde
 * als „ganz unten" da und löste sogar eine Fokusempfehlung aus. Mit dem
 * Mittelrang ergibt dieser Fall genau **0,5**: weder stark noch schwach, was
 * das einzig Richtige ist. Die Prüfungen in `turnen-vergleich.test.ts` rechnen
 * das für Feldgrössen von 2 bis 20 nach.
 *
 * ---------------------------------------------------------------------------
 * Was die Formel leistet
 *
 * | Fall | Position |
 * |---|---|
 * | Erster allein | 1,0 |
 * | Letzter allein | 0,0 |
 * | alle gleich | 0,5 |
 * | zwei geteilte Erste von 6 | 0,9 |
 * | zwei geteilte Letzte von 6 | 0,1 |
 * | Plätze 3 und 4 von 6 geteilt | 0,5 |
 *
 * Sie ist **spiegelsymmetrisch**: Position im Feld plus Position im umgekehrten
 * Feld ergibt immer 1. Das ist die Probe darauf, dass Gleichstände weder nach
 * oben noch nach unten bevorzugt werden – `turnen-vergleich.test.ts` rechnet
 * sie für mehrere Felder durch.
 *
 * **Warum überhaupt normiert:** „1. von 6" und „4. von 6" sind vergleichbar,
 * „2. von 3" und „2. von 20" sind es nicht. Ohne die Feldgrösse im Nenner wäre
 * jeder Vergleich zwischen zwei Geräten oder zwei Wettkämpfen schief.
 *
 * **Was sie nicht ist:** kein Leistungsindex, keine Note, keine
 * Wahrscheinlichkeit. Sie erscheint nirgends in der Oberfläche – dort stehen
 * Platz und Feldgrösse. Sie ordnet intern und trägt die Fokusregel, nichts
 * weiter.
 *
 * `null` bei einem Feld von einem: Ein Platz unter sich allein ist kein Platz.
 */
export function position(r: RangWert | null): number | null {
  if (!r) return null
  return positionAus(r.rang, r.gleich, r.anzahl)
}

/**
 * Dieselbe Rechnung aus den einzelnen Zahlen.
 *
 * Gebraucht für gespeicherte Vergleichswerte: Dort stehen Platz, Gleichstand
 * und Anzahl in eigenen Spalten, und `RangWert` mit seinen Tausendsteln erst
 * wieder zusammenzubauen, nur um eine Position zu bekommen, wäre ein Umweg mit
 * einer Fehlerquelle.
 *
 * Gerechnet wird beim Lesen und nichts davon gespeichert – die Formel lässt
 * sich deshalb ändern, ohne einen Bestand nachzuziehen.
 */
export function positionAus(
  rang: number | null | undefined,
  gleich: number | null | undefined,
  anzahl: number | null | undefined,
): number | null {
  if (rang === null || rang === undefined) return null
  if (gleich === null || gleich === undefined) return null
  if (anzahl === null || anzahl === undefined || anzahl < 2) return null
  // Die Mitte des Rangbereichs, den die Gleichplatzierten gemeinsam belegen.
  const mittelrang = rang + (gleich - 1) / 2
  return (anzahl - mittelrang) / (anzahl - 1)
}

/* ========================================================= Gruppe bilden */

/** Warum es keinen Vergleich gibt. */
export type KeinVergleich = 'keine_klasse' | 'allein' | 'raenge_widerspruechlich'

export const KEIN_VERGLEICH_TEXT: Record<KeinVergleich, string> = {
  keine_klasse:
    'Im Protokoll steht keine Klasse. Ohne sie ist nicht bestimmbar, gegen wen verglichen würde.',
  allein:
    'In dieser Klasse steht nur ein Teilnehmer. Ein Platz unter sich allein ist kein Platz.',
  raenge_widerspruechlich:
    'Die Plätze dieser Klasse widersprechen sich – im Protokoll stehen offenbar mehrere '
    + 'getrennte Wertungen unter derselben Beschriftung. LifeHub vergleicht dann nicht.',
}

export interface GruppeErgebnis {
  gruppe: VergleichsTeilnehmer[]
  klasse: string
  grund: KeinVergleich | null
}

/**
 * Wer zu meiner Vergleichsgruppe gehört.
 *
 * **Nur dieselbe Klasse desselben Protokolls.** Niemals alle Teilnehmer des
 * PDFs: In einem Protokoll stehen Zwölfjährige neben Erwachsenen,
 * Leistungsklasse 1 neben 4. Ein Platz „14. von 95" wäre keine Auskunft,
 * sondern eine falsche.
 *
 * Eine Klasse darf sich über mehrere Seiten ziehen – gruppiert wird über den
 * Klassentext, nicht über die Seite.
 *
 * **Stimmigkeitsprüfung:** Innerhalb einer Wertung folgt aus gleichem Platz
 * derselbe Gesamtwert. Steht unter derselben Klasse zweimal Platz 1 mit
 * verschiedenen Gesamtwerten, sind es zwei getrennte Wertungen, die das
 * Protokoll nur gleich beschriftet (etwa Vorkampf und Finale). Dann wird nicht
 * verglichen, statt zwei Felder zu vermischen. Echte Gleichplatzierungen
 * bleiben davon unberührt: Bei ihnen stimmt der Gesamtwert überein.
 */
export function gruppeVon(
  alle: VergleichsTeilnehmer[],
  ich: VergleichsTeilnehmer,
): GruppeErgebnis {
  const klasse = ich.klasse.trim()
  if (!klasse) return { gruppe: [], klasse: '', grund: 'keine_klasse' }

  const gruppe = alle.filter((t) => t.klasse.trim() === klasse)
  if (gruppe.length < 2) return { gruppe, klasse, grund: 'allein' }

  const gesamtJeRang = new Map<number, Set<number | null>>()
  for (const t of gruppe) {
    if (t.rang === null) continue
    const da = gesamtJeRang.get(t.rang) ?? new Set<number | null>()
    da.add(milli(t.gesamt))
    gesamtJeRang.set(t.rang, da)
  }
  for (const werte of gesamtJeRang.values()) {
    if (werte.size > 1) return { gruppe, klasse, grund: 'raenge_widerspruechlich' }
  }

  return { gruppe, klasse, grund: null }
}

/* ===================================================== Vergleich rechnen */

/** Der Vergleich für eine Messgrösse – ein Gerät oder den Mehrkampf. */
export interface VergleichsZeile {
  /** Gerätschlüssel oder `MEHRKAMPF`. */
  scope: string
  klasse: string
  /** Die ganze Gruppe – nicht zwingend `anzahl` einer einzelnen Reihe. */
  feldgroesse: number
  final: RangWert | null
  d: RangWert | null
  e: RangWert | null
}

/**
 * Der ganze Vergleich: die Geräte, an denen ich stand, und der Mehrkampf.
 *
 * Geräte ohne eigenen Start kommen nicht vor. Am Mehrkampf wird nur die
 * Gesamtwertung gerangt – D und E gibt es dort nicht, und eine Summe der sechs
 * D-Werte wäre eine erfundene Zahl.
 */
export function vergleiche(
  alle: VergleichsTeilnehmer[],
  ich: VergleichsTeilnehmer,
): { zeilen: VergleichsZeile[]; klasse: string; grund: KeinVergleich | null } {
  const { gruppe, klasse, grund } = gruppeVon(alle, ich)
  if (grund) return { zeilen: [], klasse, grund }

  const wertVon = (t: VergleichsTeilnehmer, apparatus: string) =>
    t.geraete.find((g) => g.apparatus === apparatus) ?? null

  const zeilen: VergleichsZeile[] = []
  for (const g of GERAETE) {
    const meins = wertVon(ich, g.key)
    if (!meins) continue
    const reihe = (feld: 'd' | 'e' | 'final') =>
      rangIn(gruppe.map((t) => milli(wertVon(t, g.key)?.[feld] ?? null)), milli(meins[feld]))
    const zeile: VergleichsZeile = {
      scope: g.key,
      klasse,
      feldgroesse: gruppe.length,
      final: reihe('final'),
      d: reihe('d'),
      e: reihe('e'),
    }
    if (zeile.final || zeile.d || zeile.e) zeilen.push(zeile)
  }

  const mk = rangIn(gruppe.map((t) => milli(t.gesamt)), milli(ich.gesamt))
  if (mk) {
    zeilen.push({
      scope: MEHRKAMPF, klasse, feldgroesse: gruppe.length, final: mk, d: null, e: null,
    })
  }

  return { zeilen, klasse, grund: null }
}

/* ========================================================= Speicherform */

/** Die ID eines Vergleichswerts – Wettkampf plus Messgrösse. */
export function benchmarkId(competitionId: string, scope: string): string {
  return stableId('gym_benchmarks', competitionId, scope)
}

/**
 * Die Vergleichszeilen als Datenbankwerte.
 *
 * Die ID rechnet sich aus Wettkampf und Messgrösse – wie bei `gym_results`. Ein
 * zweiter Import desselben Protokolls trifft deshalb dieselben Zeilen und legt
 * keine zweiten an.
 */
export function benchmarkWerte(
  competitionId: string,
  zeilen: VergleichsZeile[],
  jetzt: string,
  quelle: string = QUELLE_SCORE_PDF,
): { id: string; scope: string; values: Record<string, any> }[] {
  return zeilen.map((z) => ({
    id: benchmarkId(competitionId, z.scope),
    scope: z.scope,
    values: {
      competition_id: competitionId,
      scope: z.scope,
      cohort_label: z.klasse || null,
      cohort_size: z.feldgroesse,
      final_rank: z.final?.rang ?? null,
      final_tie_count: z.final?.gleich ?? null,
      final_count: z.final?.anzahl ?? null,
      final_median: ausMilli(z.final?.median ?? null),
      final_best: ausMilli(z.final?.best ?? null),
      d_rank: z.d?.rang ?? null,
      d_tie_count: z.d?.gleich ?? null,
      d_count: z.d?.anzahl ?? null,
      d_median: ausMilli(z.d?.median ?? null),
      d_best: ausMilli(z.d?.best ?? null),
      e_rank: z.e?.rang ?? null,
      e_tie_count: z.e?.gleich ?? null,
      e_count: z.e?.anzahl ?? null,
      e_median: ausMilli(z.e?.median ?? null),
      e_best: ausMilli(z.e?.best ?? null),
      source: quelle,
      computed_at: jetzt,
    },
  }))
}

/** Gehört dieser Schlüssel zu einer Messgrösse, die LifeHub kennt? */
export function istScope(scope: string): boolean {
  return scope === MEHRKAMPF || istGeraet(scope)
}

/* ============================================================== Plan */

/** Eine bereits gespeicherte Vergleichszeile, soweit der Plan sie braucht. */
export interface VorhandenerBenchmark {
  id: string
  scope: string
  deleted_at?: string | null
  /** Die übrigen Spalten, um Unverändertes nicht neu zu schreiben. */
  [feld: string]: any
}

/**
 * Die Felder, an denen ein Vergleichswert hängt.
 *
 * `computed_at` steht bewusst NICHT dabei: Der Zeitstempel sagt, wann gerechnet
 * wurde, und wandert nur mit, wenn sich auch eine Zahl geändert hat. Sonst
 * schöbe jeder Reimport eine Änderung über den Abgleich, obwohl das Ergebnis
 * dasselbe ist.
 */
const BENCHMARK_FELDER = [
  'competition_id', 'scope', 'cohort_label', 'cohort_size',
  'final_rank', 'final_tie_count', 'final_count', 'final_median', 'final_best',
  'd_rank', 'd_tie_count', 'd_count', 'd_median', 'd_best',
  'e_rank', 'e_tie_count', 'e_count', 'e_median', 'e_best',
  'source',
] as const

export interface BenchmarkPlan {
  anlegen: { id: string; values: Record<string, any> }[]
  aendern: { id: string; patch: Record<string, any> }[]
  entfernen: string[]
}

export function benchmarkPlanIstLeer(plan: BenchmarkPlan): boolean {
  return !plan.anlegen.length && !plan.aendern.length && !plan.entfernen.length
}

/**
 * Was beim Speichern mit den Vergleichswerten zu tun ist.
 *
 * Dasselbe Muster wie `planeErgebnisse()`: Die Fälle, die sonst erst im Betrieb
 * auffallen, lassen sich einzeln nachrechnen.
 *
 * ---------------------------------------------------------------------------
 * `zeilen === null` heisst: gewöhnliches Speichern
 *
 * Ein Wettkampf, der irgendwann importiert wurde, wird später von Hand
 * bearbeitet – eine Notiz, ein korrigierter Ort. Dabei dürfen die
 * Vergleichswerte **nicht** verschwinden, nur weil dieses Speichern kein
 * Protokoll dabeihat. Aufgeräumt wird dann allein, was verwaist ist.
 *
 * ---------------------------------------------------------------------------
 * Verwaiste Zeilen
 *
 * Nimmt Erik im Editor ein Gerät heraus, verliert es sein Ergebnis – und der
 * Vergleichswert dazu hat keinen Bezug mehr. Er geht mit. Der Mehrkampf hängt
 * am Wettkampf und nicht an einem Gerät und bleibt deshalb stehen.
 *
 * ---------------------------------------------------------------------------
 * Reimport
 *
 * Die IDs rechnen sich aus Wettkampf und Messgrösse. Ein zweiter Import
 * derselben Datei trifft dieselben Zeilen und schreibt dieselben Zahlen – es
 * entsteht keine zweite Zeile zum selben Ergebnis. Geschrieben wird nur, was
 * sich unterscheidet; sonst schöbe jeder Import eine Änderung über den
 * Abgleich, für die sich nichts geändert hat.
 */
export function planeBenchmarks(
  competitionId: string,
  zeilen: VergleichsZeile[] | null,
  aktiveGeraete: string[],
  vorhanden: VorhandenerBenchmark[],
  jetzt: string,
  quelle: string = QUELLE_SCORE_PDF,
): BenchmarkPlan {
  const plan: BenchmarkPlan = { anlegen: [], aendern: [], entfernen: [] }

  const daIst = new Map<string, VorhandenerBenchmark>()
  for (const b of vorhanden) {
    if (b.deleted_at) continue
    daIst.set(b.scope, b)
  }

  const geraeteDa = new Set(aktiveGeraete)
  const gehoertNochDazu = (scope: string) => scope === MEHRKAMPF || geraeteDa.has(scope)

  if (zeilen === null) {
    for (const [scope, b] of daIst) {
      if (!gehoertNochDazu(scope)) plan.entfernen.push(b.id)
    }
    return plan
  }

  const gewollt = benchmarkWerte(competitionId, zeilen, jetzt, quelle)
    .filter((w) => gehoertNochDazu(w.scope))

  const gesehen = new Set<string>()
  for (const w of gewollt) {
    gesehen.add(w.scope)
    const alt = daIst.get(w.scope)
    if (!alt) {
      plan.anlegen.push({ id: w.id, values: w.values })
      continue
    }
    const patch: Record<string, any> = {}
    for (const feld of BENCHMARK_FELDER) {
      const neu = w.values[feld]
      if (String(neu ?? '') !== String(alt[feld] ?? '')) patch[feld] = neu
    }
    if (Object.keys(patch).length) {
      patch.computed_at = w.values.computed_at
      plan.aendern.push({ id: alt.id, patch })
    }
  }

  for (const [scope, b] of daIst) {
    if (!gesehen.has(scope)) plan.entfernen.push(b.id)
  }

  return plan
}
