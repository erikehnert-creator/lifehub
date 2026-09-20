/**
 * Die Geräte im Gerätturnen der Männer.
 *
 * ---------------------------------------------------------------------------
 * Warum das eine Konstante ist und keine Tabelle
 *
 * Sechs Werte, die sich seit Jahrzehnten nicht ändern. Eine Tabelle dafür
 * kostet in LifeHub drei Abgleichanfragen je Synchronisation (senden, holen,
 * aufräumen – `sync/engine.ts` läuft dreimal über `SYNCED_TABLES`), eine
 * Ladeabfrage und einen Fremdschlüssel. Dafür bekäme man nichts, was hier
 * nicht auch steht.
 *
 * Die Erweiterbarkeit bleibt: Ein siebtes Gerät ist eine Zeile mehr. Für die
 * Frauengeräte (Stufenbarren, Schwebebalken) oder Trampolin genügt dasselbe.
 * In der Datenbank steht nur der Schlüssel als Text – eine neue Zeile hier
 * braucht deshalb keine Migration.
 *
 * Farben stehen bewusst NICHT dabei. Wo Geräte farblich zu unterscheiden
 * sind, nehmen die Diagramme `seriesColor(i)` aus `charts/index.tsx`. Eigene
 * Gerätefarben wären neue Einzelfarben neben den Tokens – und die `--tag-*`
 * zu übernehmen hieße, die Schichtfarben ein zweites Mal zu belegen.
 */

export type GeraetKey =
  | 'boden' | 'pauschenpferd' | 'ringe' | 'sprung' | 'barren' | 'reck'

export interface Geraet {
  key: GeraetKey
  /** Voller Name, wie er in der Halle gesagt wird. */
  name: string
  /** Zwei Zeichen für enge Stellen – Kacheln, Tabellenköpfe, Filterleisten. */
  kurz: string
  /** Wettkampfreihenfolge der Männer. Danach wird überall sortiert. */
  reihenfolge: number
}

/** In Wettkampfreihenfolge – so steht es auf jedem Protokoll. */
export const GERAETE: Geraet[] = [
  { key: 'boden', name: 'Boden', kurz: 'Bo', reihenfolge: 1 },
  { key: 'pauschenpferd', name: 'Pauschenpferd', kurz: 'Pf', reihenfolge: 2 },
  { key: 'ringe', name: 'Ringe', kurz: 'Ri', reihenfolge: 3 },
  { key: 'sprung', name: 'Sprung', kurz: 'Sp', reihenfolge: 4 },
  { key: 'barren', name: 'Barren', kurz: 'Ba', reihenfolge: 5 },
  { key: 'reck', name: 'Reck', kurz: 'Re', reihenfolge: 6 },
]

const NACH_KEY = new Map(GERAETE.map((g) => [g.key, g]))

/** Ein Gerät zu seinem Schlüssel – oder `null`, wenn der Schlüssel unbekannt ist. */
export function geraet(key: string | null | undefined): Geraet | null {
  return NACH_KEY.get((key ?? '') as GeraetKey) ?? null
}

/**
 * Der Name zu einem Schlüssel, notfalls der Schlüssel selbst.
 *
 * Fällt auf den rohen Wert zurück statt auf „Unbekannt": Stünde in der
 * Datenbank ein Gerät, das es hier nicht gibt, will man sehen WELCHES.
 */
export function geraetName(key: string | null | undefined): string {
  return geraet(key)?.name ?? (key || '—')
}

/** Ist das ein Gerät, das LifeHub kennt? */
export function istGeraet(key: unknown): key is GeraetKey {
  return typeof key === 'string' && NACH_KEY.has(key as GeraetKey)
}

/** Sortierschlüssel für beliebige Zeilen mit einem `apparatus`-Feld. */
export function nachGeraet<T extends { apparatus?: string | null }>(a: T, b: T): number {
  const ra = geraet(a.apparatus)?.reihenfolge ?? 99
  const rb = geraet(b.apparatus)?.reihenfolge ?? 99
  return ra - rb
}
