/**
 * Wie sicher ein Element steht – und was LifeHub daraus vorschlagen darf.
 *
 * ---------------------------------------------------------------------------
 * Die Schwellen stehen hier, und nur hier
 *
 * Sie sind eine **Verabredung**, keine Messung. Es gibt keine Studie, die
 * sagt, ab welcher Trefferquote ein Turnelement „sicher" ist – das hängt vom
 * Element, vom Gerät und vom Turner ab. Die Zahlen unten sind bewusst rund
 * gewählt, damit man sie im Kopf nachrechnen kann, und sie stehen an einer
 * Stelle, damit sie sich an einer Stelle ändern lassen.
 *
 * Was daraus folgt, ist immer nur ein **Vorschlag**. Der Status eines
 * Elements gehört dem Turner; `statusVorschlag()` schreibt nichts, es
 * antwortet. Die Oberfläche zeigt den Vorschlag neben dem gesetzten Status
 * und übernimmt ihn erst auf Knopfdruck.
 *
 * ---------------------------------------------------------------------------
 * Warum es eine Mindestzahl gibt
 *
 * Dieselbe Überlegung wie bei `MINDESTTAGE` in `core/zusammenhaenge.ts`: Aus
 * drei Versuchen lässt sich nichts ableiten. Zwei davon gelungen wären 67 %
 * und bedeuteten gar nichts. Unterhalb der Mindestzahl gibt es deshalb
 * keinen Vorschlag – nicht einen vorsichtigen, sondern keinen.
 */
import type { GymAttempt } from '../types'
import type { ElementStatus } from './status'
import { versucheGesamt } from './versuche'

export const SCHWELLEN = {
  /** Darunter wird nichts vorgeschlagen. */
  mindestVersuche: 10,
  /** Wie weit zurück geschaut wird. Turnform ändert sich; alte Versuche sagen wenig. */
  fensterTage: 56,
  /** Ab dieser Trefferquote gilt ein Element als sicher – ohne Sturz und ohne Hilfe. */
  sicher: 0.9,
  /** Darunter gilt es als im Aufbau. */
  unsicher: 0.6,
} as const

export interface Trefferbild {
  /** Versuche im betrachteten Fenster. */
  versuche: number
  clean: number
  shaky: number
  failed: number
  /** Blöcke, die mit Hilfestellung geturnt wurden. */
  mitHilfe: number
  /** clean / versuche, oder `null` wenn es keine Versuche gab. */
  quote: number | null
}

const LEER: Trefferbild = { versuche: 0, clean: 0, shaky: 0, failed: 0, mitHilfe: 0, quote: null }

/**
 * Das Trefferbild eines Elements über die übergebenen Versuchsblöcke.
 *
 * Die Auswahl (welches Element, welches Zeitfenster) trifft der Aufrufer –
 * diese Funktion zählt nur. Gelöschte Blöcke zählen nicht mit; sie gehören
 * zu einer Einheit, die es nicht mehr gibt.
 */
export function trefferbild(bloecke: GymAttempt[]): Trefferbild {
  let clean = 0, shaky = 0, failed = 0, mitHilfe = 0
  for (const b of bloecke) {
    if (b.deleted_at) continue
    clean += b.clean ?? 0
    shaky += b.shaky ?? 0
    failed += b.failed ?? 0
    if (b.with_help) mitHilfe++
  }
  const versuche = clean + shaky + failed
  if (versuche === 0) return { ...LEER, mitHilfe }
  return { versuche, clean, shaky, failed, mitHilfe, quote: clean / versuche }
}

export interface Vorschlag {
  /** Was LifeHub vorschlagen würde – oder `null`, wenn die Datenlage nicht reicht. */
  status: ElementStatus | null
  /** Ein Satz, der den Vorschlag begründet. Steht so auch in der Oberfläche. */
  grund: string
}

/**
 * Ein Statusvorschlag aus dem Trefferbild.
 *
 * `wettkampfreif` wird nie vorgeschlagen: Ob ein Element unter Druck steht,
 * lässt sich aus Trainingszahlen nicht ablesen. `neu` ebensowenig – das ist
 * der Ausgangszustand, kein Ergebnis einer Beobachtung.
 *
 * Hilfestellung deckelt den Vorschlag: Wer ein Element im Fenster auch nur
 * einmal mit Hilfe geturnt hat, bekommt höchstens „unsicher" vorgeschlagen.
 * Ein gelungener Versuch mit Hilfe ist fachlich etwas anderes als einer ohne.
 */
export function statusVorschlag(bild: Trefferbild): Vorschlag {
  if (bild.versuche < SCHWELLEN.mindestVersuche) {
    return {
      status: null,
      grund: `Zu wenige Versuche für eine Aussage (${bild.versuche} von ${SCHWELLEN.mindestVersuche}).`,
    }
  }

  const prozent = Math.round((bild.quote ?? 0) * 100)

  if (bild.mitHilfe > 0) {
    const genug = (bild.quote ?? 0) >= SCHWELLEN.unsicher
    return {
      status: genug ? 'unsicher' : 'aufbau',
      grund: `${prozent} % gelungen, aber ${bild.mitHilfe}× mit Hilfestellung.`,
    }
  }

  if ((bild.quote ?? 0) >= SCHWELLEN.sicher && bild.failed === 0) {
    return { status: 'sicher', grund: `${prozent} % gelungen, kein Sturz, ohne Hilfe.` }
  }
  if ((bild.quote ?? 0) >= SCHWELLEN.unsicher) {
    return {
      status: 'unsicher',
      grund: bild.failed > 0
        ? `${prozent} % gelungen, aber ${bild.failed}× gestürzt.`
        : `${prozent} % gelungen – noch nicht verlässlich.`,
    }
  }
  return { status: 'aufbau', grund: `Erst ${prozent} % gelungen.` }
}

/**
 * Weicht der gesetzte Status vom Vorschlag ab?
 *
 * Nur dann zeigt die Oberfläche den Vorschlag überhaupt an – sonst stünde
 * neben jedem Element eine Zeile, die bestätigt, was ohnehin dasteht.
 */
export function vorschlagAbweichend(gesetzt: string, v: Vorschlag): boolean {
  return v.status !== null && v.status !== gesetzt
}
