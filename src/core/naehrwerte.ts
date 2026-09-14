/**
 * Die Nährwerte – an EINER Stelle.
 *
 * ---------------------------------------------------------------------------
 * Warum das eine eigene Datei ist
 *
 * Ein Nährwert kam bisher an sieben Stellen vor: als Feld in der FatSecret-
 * Antwort, als Feld im eingelesenen Eintrag, als Spalte in `food_entries`, in
 * der Liste der zu vergleichenden Felder, in der Liste der Tagessummen, als
 * Metrik im Seed und als Spalte im Serverschema. Sechzehn Nährwerte mal sieben
 * Stellen sind 112 Gelegenheiten, eine zu vergessen – und das Vergessen fällt
 * nicht auf: Der Wert wird dann einfach nicht übernommen, ohne Fehler, ohne
 * Meldung. Genau so eine Lücke stand hinter „Ballaststoffe kommen nicht an"
 * (dort war es eine andere Ursache, aber dieselbe Art von Stille).
 *
 * Jetzt steht die Liste einmal hier. Alles, was sich daraus ableiten lässt,
 * wird abgeleitet; was sich nicht ableiten lässt – die SQL-Spalten und die
 * Metriken im Seed –, rechnet `tests/naehrwerte.test.ts` dagegen nach und
 * nennt die fehlende Zeile wörtlich.
 *
 * ---------------------------------------------------------------------------
 * Einheiten
 *
 * Wie FatSecret sie liefert (Doku zu `food_entries.get.v2`), ohne Umrechnung.
 * Umrechnen wäre eine zusätzliche Fehlerquelle für nichts: Die Metrik trägt
 * dieselbe Einheit, und beim Vergleich mit FatSecret stehen dann dieselben
 * Zahlen da.
 */

/** Ein Nährwert: wie er bei FatSecret heißt und wie er in LifeHub heißt. */
export interface Naehrwert {
  /** Spalte in `food_entries` UND Schlüssel der Metrik in `metrics`. */
  readonly key: string
  /** Feldname in der Antwort von FatSecret. */
  readonly feld: string
  /** Anzeigename, muss mit dem Namen der Metrik im Seed übereinstimmen. */
  readonly name: string
  /** Einheit, wie FatSecret sie liefert. */
  readonly einheit: 'kcal' | 'g' | 'mg' | 'µg'
  /**
   * Gehört der Wert zu den großen Vieren plus Ballaststoffe, die LifeHub oben
   * zeigt? Der Rest ist Beiwerk und wird eingeklappt dargestellt.
   */
  readonly wichtig: boolean
}

/**
 * Alle Nährwerte, die FatSecret je Eintrag liefert.
 *
 * Die Reihenfolge ist die Anzeigereihenfolge: erst die, nach denen man täglich
 * schaut, dann der Rest.
 */
export const NAEHRWERTE = [
  { key: 'calories', feld: 'calories', name: 'Kalorien', einheit: 'kcal', wichtig: true },
  { key: 'protein_g', feld: 'protein', name: 'Protein', einheit: 'g', wichtig: true },
  { key: 'carbs_g', feld: 'carbohydrate', name: 'Kohlenhydrate', einheit: 'g', wichtig: true },
  { key: 'fat_g', feld: 'fat', name: 'Fett', einheit: 'g', wichtig: true },
  { key: 'fiber_g', feld: 'fiber', name: 'Ballaststoffe', einheit: 'g', wichtig: true },
  { key: 'sugar_g', feld: 'sugar', name: 'Zucker', einheit: 'g', wichtig: false },
  { key: 'saturated_fat_g', feld: 'saturated_fat', name: 'Gesättigte Fettsäuren', einheit: 'g', wichtig: false },
  { key: 'poly_fat_g', feld: 'polyunsaturated_fat', name: 'Mehrfach ungesättigte Fettsäuren', einheit: 'g', wichtig: false },
  { key: 'mono_fat_g', feld: 'monounsaturated_fat', name: 'Einfach ungesättigte Fettsäuren', einheit: 'g', wichtig: false },
  { key: 'cholesterol_mg', feld: 'cholesterol', name: 'Cholesterin', einheit: 'mg', wichtig: false },
  { key: 'sodium_mg', feld: 'sodium', name: 'Natrium', einheit: 'mg', wichtig: false },
  { key: 'potassium_mg', feld: 'potassium', name: 'Kalium', einheit: 'mg', wichtig: false },
  { key: 'calcium_mg', feld: 'calcium', name: 'Calcium', einheit: 'mg', wichtig: false },
  { key: 'iron_mg', feld: 'iron', name: 'Eisen', einheit: 'mg', wichtig: false },
  { key: 'vitamin_a_ug', feld: 'vitamin_a', name: 'Vitamin A', einheit: 'µg', wichtig: false },
  { key: 'vitamin_c_mg', feld: 'vitamin_c', name: 'Vitamin C', einheit: 'mg', wichtig: false },
] as const satisfies readonly Naehrwert[]

export type NaehrwertKey = (typeof NAEHRWERTE)[number]['key']

/** Die Schlüssel in derselben Reihenfolge – für Schleifen über alle Werte. */
export const NAEHRWERT_KEYS = NAEHRWERTE.map((n) => n.key) as readonly NaehrwertKey[]

/** Ein Satz Nährwerte, wie er an einem Eintrag oder an einem Tag hängt. */
export type Naehrwertsatz = { [K in NaehrwertKey]: number | null }

/** Die fünf, die oben stehen: Kalorien, die drei Makros, Ballaststoffe. */
export const WICHTIGE_NAEHRWERTE = NAEHRWERTE.filter((n) => n.wichtig)
  .map((n) => n.key) as readonly NaehrwertKey[]

/** Nachschlagen, ohne jedes Mal durch die Liste zu laufen. */
const NACH_KEY = new Map<string, Naehrwert>(NAEHRWERTE.map((n) => [n.key, n]))
export function naehrwert(key: string): Naehrwert | undefined {
  return NACH_KEY.get(key)
}

/** Ist dieser Metrikschlüssel ein Nährwert, den FatSecret liefert? */
export function istNaehrwert(key: string): key is NaehrwertKey {
  return NACH_KEY.has(key)
}
