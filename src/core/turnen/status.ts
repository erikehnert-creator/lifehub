/**
 * Der Sicherheitsstand eines Elements.
 *
 * Zentral hier und nirgends sonst: Stünden die Bezeichner als freie
 * Zeichenketten in den Bildschirmen, hiesse dasselbe später an drei Stellen
 * unterschiedlich, und ein Tippfehler wäre ein stiller Filter, der nichts
 * mehr findet.
 *
 * ---------------------------------------------------------------------------
 * Warum fünf Stufen und keine Leiter
 *
 * Es ist ausdrücklich **keine** Reihenfolge, die man nur vorwärts geht. Ein
 * Element, das sicher stand, kann nach einer Pause wieder unsicher sein –
 * das ist der Normalfall im Turnen und kein Rückschritt, der versteckt
 * werden müsste. `reihenfolge` dient nur der Anzeige.
 *
 * `wettkampfreif` ist die einzige Stufe, die LifeHub **niemals von selbst
 * vorschlägt**. Ob ein Element unter Wettkampfdruck steht, weiss nur der
 * Turner; aus Trainingszahlen lässt sich das nicht ablesen.
 */

export type ElementStatus = 'neu' | 'aufbau' | 'unsicher' | 'sicher' | 'wettkampfreif'

export interface StatusDef {
  key: ElementStatus
  label: string
  /** Ein Satz, der die Stufe von der benachbarten abgrenzt. */
  beschreibung: string
  reihenfolge: number
  /** Wie die Stufe in der Oberfläche eingefärbt wird – vorhandene Tokens. */
  ton: 'neutral' | 'warnung' | 'kritisch' | 'gut'
}

export const ELEMENT_STATUS: StatusDef[] = [
  {
    key: 'neu', label: 'Neu', reihenfolge: 1, ton: 'neutral',
    beschreibung: 'Aufgenommen, aber noch nicht oder kaum trainiert.',
  },
  {
    key: 'aufbau', label: 'Im Aufbau', reihenfolge: 2, ton: 'kritisch',
    beschreibung: 'Wird erarbeitet – gelingt noch selten oder nur mit Hilfe.',
  },
  {
    key: 'unsicher', label: 'Unsicher', reihenfolge: 3, ton: 'warnung',
    beschreibung: 'Steht meistens, aber nicht verlässlich.',
  },
  {
    key: 'sicher', label: 'Sicher', reihenfolge: 4, ton: 'gut',
    beschreibung: 'Gelingt zuverlässig und ohne Hilfe.',
  },
  {
    key: 'wettkampfreif', label: 'Wettkampfreif', reihenfolge: 5, ton: 'gut',
    beschreibung: 'Steht auch unter Druck. Diese Stufe setzt nur du.',
  },
]

const NACH_KEY = new Map(ELEMENT_STATUS.map((s) => [s.key, s]))

export function statusDef(key: string | null | undefined): StatusDef {
  return NACH_KEY.get((key ?? '') as ElementStatus) ?? ELEMENT_STATUS[0]
}

export function statusLabel(key: string | null | undefined): string {
  return statusDef(key).label
}

export function istStatus(key: unknown): key is ElementStatus {
  return typeof key === 'string' && NACH_KEY.has(key as ElementStatus)
}

/**
 * Die Stufen, die LifeHub selbst vorschlagen darf.
 *
 * `wettkampfreif` fehlt mit Absicht – siehe oben. `neu` ebenfalls: Es ist
 * der Ausgangszustand, kein Ergebnis einer Beobachtung.
 */
export const VORSCHLAGBAR: ElementStatus[] = ['aufbau', 'unsicher', 'sicher']

/** Stufen, bei denen ein Element Aufmerksamkeit braucht – für Übersicht und Filter. */
export const BRAUCHT_ARBEIT: ElementStatus[] = ['neu', 'aufbau', 'unsicher']
