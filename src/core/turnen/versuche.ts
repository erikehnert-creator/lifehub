/**
 * Versuche einer Einheit: wie sie gezählt, abgeleitet und gespeichert werden.
 *
 * ---------------------------------------------------------------------------
 * Warum die ID abgeleitet wird
 *
 * Eine Einheit lässt sich mehrfach speichern – beim Nachtragen am Abend, beim
 * Korrigieren am nächsten Tag, oder weil zwei Geräte dieselbe Einheit
 * bearbeiten. Jedes Mal eine neue Zeile anzulegen ergäbe dieselbe Nacht
 * mehrfach; in LifeHub ist genau das schon zweimal teuer geworden (doppelte
 * Konten, doppelte Tagesarten).
 *
 * Deshalb leitet sich die ID aus `session_id` und `element_id` ab. Damit ist
 * sie auf jedem Gerät dieselbe, der Server führt die Zeilen über den
 * Primärschlüssel zusammen, und ein zweites Speichern trifft dieselbe Zeile.
 *
 * Ein zusätzlicher UNIQUE-Index auf das Paar wäre überflüssig und sogar
 * riskant: Er stünde lokal, nicht aber auf dem Server (der Generator streicht
 * UNIQUE bewusst) – und diese Asymmetrie lässt `INSERT OR REPLACE` beim Holen
 * still Zeilen löschen. Siehe CLAUDE.md.
 */
import { stableId } from '../ids'
import type { GymAttempt } from '../types'

/** Die drei Güten, in der Reihenfolge, in der sie in der Oberfläche stehen. */
export type Guete = 'clean' | 'shaky' | 'failed'

export interface GueteDef {
  key: Guete
  label: string
  /** Kurzform für die Zählerflächen am Handy. */
  kurz: string
  ton: 'gut' | 'warnung' | 'kritisch'
}

/**
 * Drei Stufen, nicht zwei und nicht fünf.
 *
 * Zwei verlieren den entscheidenden Zwischenzustand („steht, aber nicht
 * sicher"), fünf werden am Handy zwischen zwei Durchgängen nicht mehr ehrlich
 * ausgefüllt.
 */
export const GUETEN: GueteDef[] = [
  { key: 'clean', label: 'Gelungen', kurz: 'gelungen', ton: 'gut' },
  { key: 'shaky', label: 'Wacklig', kurz: 'wacklig', ton: 'warnung' },
  { key: 'failed', label: 'Gestürzt', kurz: 'gestürzt', ton: 'kritisch' },
]

/** Die ID einer Versuchszeile – auf jedem Gerät dieselbe. */
export function versuchId(sessionId: string, elementId: string): string {
  return stableId('gym_attempts', sessionId, elementId)
}

/** Wie viele Versuche insgesamt – gerechnet, nicht gespeichert. */
export function versucheGesamt(a: Pick<GymAttempt, 'clean' | 'shaky' | 'failed'>): number {
  return (a.clean ?? 0) + (a.shaky ?? 0) + (a.failed ?? 0)
}

/** Ist an diesem Block überhaupt etwas festgehalten? */
export function istLeer(a: Pick<GymAttempt, 'clean' | 'shaky' | 'failed'>): boolean {
  return versucheGesamt(a) === 0
}

/* -------------------------------------------------- Speichern vorbereiten */

/** Was die Oberfläche je Element gezählt hat. */
export interface ZaehlerStand {
  elementId: string
  clean: number
  shaky: number
  failed: number
  withHelp: boolean
  note?: string | null
}

export interface SchreibPlan {
  /** Neu anzulegen, mit bereits abgeleiteter ID. */
  anlegen: { id: string; values: Record<string, any> }[]
  /** Vorhandene Zeilen, die sich geändert haben. */
  aendern: { id: string; patch: Record<string, any> }[]
  /** Vorhandene Zeilen, an denen nichts mehr steht – sie gehören weg. */
  entfernen: string[]
}

/**
 * Was beim Speichern einer Einheit zu tun ist.
 *
 * Reine Rechnung ohne Datenbank, damit sich genau die Fälle prüfen lassen,
 * die sonst erst im Betrieb auffallen:
 *
 *   - zweimal dasselbe speichern ändert nichts (kein neues `updated_at`,
 *     keine neue `version`, kein Abgleich für nichts)
 *   - ein Element auf null zurückgezählt verschwindet wieder
 *   - ein Element ohne jeden Versuch wird gar nicht erst angelegt
 *
 * Die Einheit selbst (`workout_sessions`) wird hier nicht angefasst: Eine
 * Einheit ohne einen einzigen Versuch ist ausdrücklich gültig – „Boden,
 * 45 min" ist ein vollständiger Eintrag.
 */
export function planeVersuche(
  sessionId: string,
  staende: ZaehlerStand[],
  vorhanden: GymAttempt[],
): SchreibPlan {
  const plan: SchreibPlan = { anlegen: [], aendern: [], entfernen: [] }

  const daIst = new Map<string, GymAttempt>()
  for (const v of vorhanden) {
    if (v.deleted_at || v.session_id !== sessionId) continue
    daIst.set(v.element_id, v)
  }

  const gesehen = new Set<string>()
  for (const [i, s] of staende.entries()) {
    gesehen.add(s.elementId)
    const leer = s.clean + s.shaky + s.failed === 0
    const alt = daIst.get(s.elementId)

    if (leer) {
      // Auf null zurueckgezaehlt: Die Zeile hat keine Aussage mehr.
      if (alt) plan.entfernen.push(alt.id)
      continue
    }

    const werte = {
      session_id: sessionId,
      element_id: s.elementId,
      clean: s.clean,
      shaky: s.shaky,
      failed: s.failed,
      with_help: s.withHelp ? 1 : 0,
      note: s.note?.trim() || null,
      sort_order: i,
    }

    if (!alt) {
      plan.anlegen.push({ id: versuchId(sessionId, s.elementId), values: werte })
      continue
    }

    // Nur schreiben, wenn sich wirklich etwas unterscheidet. Sonst schoebe
    // jedes Oeffnen der Einheit eine Aenderung ueber alle Geraete, fuer die
    // sich nichts geaendert hat.
    const patch: Record<string, any> = {}
    for (const feld of ['clean', 'shaky', 'failed', 'with_help', 'note', 'sort_order'] as const) {
      if (String((alt as any)[feld] ?? '') !== String((werte as any)[feld] ?? '')) {
        patch[feld] = (werte as any)[feld]
      }
    }
    if (Object.keys(patch).length) plan.aendern.push({ id: alt.id, patch })
  }

  // Elemente, die beim Bearbeiten ganz aus der Liste genommen wurden.
  for (const [elementId, alt] of daIst) {
    if (!gesehen.has(elementId)) plan.entfernen.push(alt.id)
  }

  return plan
}

/** Hat der Plan überhaupt etwas zu tun? */
export function planIstLeer(plan: SchreibPlan): boolean {
  return plan.anlegen.length === 0 && plan.aendern.length === 0 && plan.entfernen.length === 0
}
