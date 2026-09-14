/**
 * Zeitversetzte Zusammenhänge – was hängt womit zusammen, und wie viel später?
 *
 * ---------------------------------------------------------------------------
 * Warum zeitversetzt
 *
 * Die bisherige Auswertung vergleicht denselben Tag mit sich selbst: Zucker
 * heute gegen Haut heute. Genau das ist bei der Haut aber die uninteressante
 * Frage. Was am Montag gegessen wurde, sieht man frühestens am Dienstag, eher
 * am Mittwoch. Ein Vergleich ohne Versatz findet dort also systematisch
 * nichts – und das sieht aus wie „kein Zusammenhang", obwohl nur am falschen
 * Tag nachgesehen wurde.
 *
 * Geprüft werden deshalb mehrere Verzögerungen nebeneinander (0, 1, 2, 3, 5
 * und 7 Tage).
 *
 * ---------------------------------------------------------------------------
 * Warum das statistisch heikel ist – und was dagegen getan wird
 *
 * Wer sechs Verzögerungen ausprobiert und danach die stärkste zeigt, findet
 * fast immer etwas. Bei sechs Versuchen auf dem üblichen 5-%-Niveau liegt die
 * Wahrscheinlichkeit, rein zufällig mindestens einen „Treffer" zu erzeugen,
 * schon bei rund 26 %. Genau so entstehen Ernährungsmythen.
 *
 * Deshalb drei Vorkehrungen:
 *
 *   1. Es werden ALLE geprüften Verzögerungen zurückgegeben, nicht nur die
 *      beste. Die Oberfläche kann dann zeigen, dass 2 Tage auffällt und 1 und
 *      3 Tage nicht – was ein deutlicher Hinweis darauf ist, dass es Zufall war.
 *   2. Die Irrtumswahrscheinlichkeit wird ausgerechnet (nicht geschätzt) und
 *      für die Anzahl der Versuche korrigiert (Bonferroni).
 *   3. Unter einer Mindestzahl gemeinsamer Tage gilt gar nichts als belastbar,
 *      egal wie schön die Zahl aussieht.
 *
 * Und auch dann bleibt es eine Beobachtung. „Hängt zusammen" ist nicht
 * „verursacht"; die Formulierungen hier sagen deshalb nie das eine, wenn nur
 * das andere gemessen wurde.
 */
import type { DayString } from './dates'
import type { SeriesPoint } from './metrics'

/** Welche Verzögerungen geprüft werden, in Tagen. */
export const VERZOEGERUNGEN = [0, 1, 2, 3, 5, 7] as const

/**
 * Wie viele gemeinsame Tage es mindestens braucht.
 *
 * Bei zwanzig Tagen wird ein Korrelationskoeffizient von 0,44 gerade
 * bedeutsam. Darunter ist praktisch jeder Wert mit Zufall vereinbar – eine
 * Aussage aus zehn Tagen ist keine Aussage, sondern eine Behauptung.
 */
export const MINDESTTAGE = 20

export interface Befund {
  /** Metrikschlüssel des früheren Werts (z. B. 'sugar_g'). */
  ursache: string
  /** Metrikschlüssel des späteren Werts (z. B. 'skin'). */
  wirkung: string
  /** Um wie viele Tage der spätere Wert versetzt betrachtet wurde. */
  verzoegerung: number
  /** Korrelationskoeffizient nach Pearson, −1 … 1. */
  r: number
  /** Zahl der Tagespaare, auf denen die Zahl beruht. */
  n: number
  /**
   * Wahrscheinlichkeit, einen mindestens so starken Zusammenhang zu sehen,
   * obwohl in Wirklichkeit keiner besteht – bereits für die Zahl der
   * geprüften Verzögerungen korrigiert.
   */
  p: number
  /** Genug Tage UND unwahrscheinlich genug, um es überhaupt zu erwähnen. */
  belastbar: boolean
}

/* ------------------------------------------------------- Die Korrelation */

/**
 * Pearson-Korrelation zwischen dem früheren und dem um `verzoegerung` Tage
 * späteren Wert.
 *
 * Verglichen wird ausschließlich über das DATUM, nicht über die Position in
 * der Liste. Reihen können Lücken haben – ein Tag ohne Eintrag fehlt einfach –,
 * und über Positionen gerechnet verschöbe sich dadurch alles Nachfolgende um
 * einen Tag. Das Ergebnis wäre still falsch.
 */
export function verzoegerteKorrelation(
  frueher: SeriesPoint[],
  spaeter: SeriesPoint[],
  verzoegerung: number,
  tagPlus: (tag: DayString, n: number) => DayString,
): { r: number | null; n: number } {
  const nachTag = new Map<string, number>()
  for (const p of spaeter) if (p.value !== null) nachTag.set(p.day, p.value)

  const xs: number[] = []
  const ys: number[] = []
  for (const p of frueher) {
    if (p.value === null) continue
    const y = nachTag.get(tagPlus(p.day, verzoegerung))
    if (y === undefined) continue
    xs.push(p.value)
    ys.push(y)
  }

  const n = xs.length
  if (n < 3) return { r: null, n }

  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let zaehler = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    zaehler += a * b
    dx += a * a
    dy += b * b
  }
  // Steht ein Wert über den ganzen Zeitraum still, gibt es nichts zu
  // korrelieren – und die Formel teilte durch null.
  if (dx === 0 || dy === 0) return { r: null, n }
  return { r: Math.round((zaehler / Math.sqrt(dx * dy)) * 1000) / 1000, n }
}

/* ------------------------------------------------- Irrtumswahrscheinlichkeit */

/**
 * Regularisierte unvollständige Betafunktion, über Kettenbruch.
 *
 * Braucht man, um aus einem Korrelationskoeffizienten eine ehrliche
 * Irrtumswahrscheinlichkeit zu machen. Die sonst übliche Abkürzung – „ab 0,3
 * ist es was" – ist von der Zahl der Tage abhängig und deshalb bei kurzen
 * Reihen schlicht falsch.
 *
 * Verfahren nach Lentz; die Reihe konvergiert für die hier auftretenden
 * Größenordnungen in wenigen Dutzend Schritten.
 */
function betaKettenbruch(a: number, b: number, x: number): number {
  const WINZIG = 1e-30
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < WINZIG) d = WINZIG
  d = 1 / d
  let h = d

  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < WINZIG) d = WINZIG
    c = 1 + aa / c
    if (Math.abs(c) < WINZIG) c = WINZIG
    d = 1 / d
    h *= d * c

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < WINZIG) d = WINZIG
    c = 1 + aa / c
    if (Math.abs(c) < WINZIG) c = WINZIG
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-12) break
  }
  return h
}

/** Logarithmus der Gammafunktion – Näherung nach Lanczos. */
function logGamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += c[j] / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

function unvollstaendigeBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const vorfaktor = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  )
  return x < (a + 1) / (a + b + 2)
    ? (vorfaktor * betaKettenbruch(a, b, x)) / a
    : 1 - (vorfaktor * betaKettenbruch(b, a, 1 - x)) / b
}

/**
 * Wie wahrscheinlich ist ein so starker Zusammenhang, wenn in Wirklichkeit
 * keiner besteht? (zweiseitig)
 *
 * Über die t-Verteilung mit n−2 Freiheitsgraden – dasselbe, was ein
 * Statistikprogramm ausgibt.
 */
export function pWert(r: number, n: number): number {
  if (n < 3) return 1
  if (Math.abs(r) >= 1) return 0
  const df = n - 2
  const t = r * Math.sqrt(df / (1 - r * r))
  return unvollstaendigeBeta(df / 2, 0.5, df / (df + t * t))
}

/* --------------------------------------------------------- Die Auswertung */

export interface UntersuchungsOptionen {
  /** Wie viele Verzögerungen nebeneinander geprüft werden (für die Korrektur). */
  versuche?: number
  /** Ab welcher korrigierten Irrtumswahrscheinlichkeit etwas gilt. */
  schwelle?: number
  mindesttage?: number
}

/**
 * Ein Wertepaar über alle Verzögerungen prüfen.
 *
 * Zurück kommen ALLE Ergebnisse, nicht nur das beste. Das ist Absicht: Erst im
 * Nebeneinander sieht man, ob ein Ausschlag zu einem Muster gehört (2 und 3
 * Tage beide auffällig) oder allein dasteht (nur 5 Tage, 3 und 7 nicht) – und
 * Letzteres ist meistens Zufall.
 */
export function untersuche(
  ursache: string,
  wirkung: string,
  frueher: SeriesPoint[],
  spaeter: SeriesPoint[],
  tagPlus: (tag: DayString, n: number) => DayString,
  opt: UntersuchungsOptionen = {},
): Befund[] {
  const versuche = opt.versuche ?? VERZOEGERUNGEN.length
  const schwelle = opt.schwelle ?? 0.05
  const mindesttage = opt.mindesttage ?? MINDESTTAGE

  const out: Befund[] = []
  for (const v of VERZOEGERUNGEN) {
    const { r, n } = verzoegerteKorrelation(frueher, spaeter, v, tagPlus)
    if (r === null) continue
    // Bonferroni: Wer sechsmal hinsieht, muss sechsmal strenger sein.
    const p = Math.min(1, pWert(r, n) * versuche)
    out.push({
      ursache, wirkung, verzoegerung: v, r, n, p,
      belastbar: n >= mindesttage && p < schwelle,
    })
  }
  return out
}

/* ------------------------------------------------------ In Worte fassen */

export type Richtung = 'higher_better' | 'lower_better' | 'range' | 'neutral'

/** Wurde der spätere Wert besser oder schlechter? */
export function bewertung(r: number, richtung: Richtung): 'besser' | 'schlechter' | 'anders' {
  if (richtung === 'higher_better') return r > 0 ? 'besser' : 'schlechter'
  if (richtung === 'lower_better') return r > 0 ? 'schlechter' : 'besser'
  // Bei einem Zielbereich ist „mehr" weder gut noch schlecht.
  return 'anders'
}

export function staerke(r: number): string {
  const a = Math.abs(r)
  if (a < 0.2) return 'kaum'
  if (a < 0.4) return 'leicht'
  if (a < 0.6) return 'deutlich'
  return 'stark'
}

/**
 * Ein Befund in einem Satz – so, wie Erik ihn lesen soll.
 *
 * Bewusst beschreibend statt erklärend: „war … durchschnittlich schlechter",
 * nicht „verursacht". Die Datenmenge steht dabei, weil eine Zahl ohne sie
 * nichts wert ist.
 */
export function formuliere(
  b: Befund,
  nameUrsache: string,
  nameWirkung: string,
  richtungWirkung: Richtung,
): string {
  const wann = b.verzoegerung === 0
    ? 'am selben Tag'
    : b.verzoegerung === 1
      ? 'am Tag darauf'
      : `${b.verzoegerung} Tage später`
  const wie = bewertung(b.r, richtungWirkung)
  // „der Wert für …" statt nur des Namens: Die Metriknamen haben
  // unterschiedliche Geschlechter und Zahlformen („Hautstatus", „Pickel
  // gesamt", „Energie"). Ein Satz, der für alle grammatisch aufgeht, ist
  // wichtiger als einer, der bei einem Namen besonders elegant klingt.
  const teil = wie === 'anders'
    ? `lag der Wert für ${nameWirkung} ${wann} ${b.r > 0 ? 'höher' : 'niedriger'}`
    : `war der Wert für ${nameWirkung} ${wann} durchschnittlich ${wie}`
  return `An Tagen mit höherem ${nameUrsache} ${teil}. Datenbasis: ${b.n} Tage.`
}
