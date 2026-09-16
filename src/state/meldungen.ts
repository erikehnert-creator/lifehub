/**
 * Was die Automatik von selbst erledigt hat.
 *
 * Bisher als Toast: „9 fällige Zahlungen gebucht" erschien dort, wo man gerade
 * war – auf dem Einkaufszettel, mitten in den Zielen. Eine Meldung, die nichts
 * mit der offenen Seite zu tun hat, unterbricht, statt zu informieren. Jetzt
 * sammelt sie sich hier und steht auf „Heute", bis man sie wegklickt.
 *
 * Bewusst nicht in der Datenbank: Das ist ein Protokoll dieser Sitzung auf
 * diesem Gerät, keine Information, die das andere Gerät braucht. Dort läuft
 * die Automatik selbst und sagt es selbst.
 */
import { useSyncExternalStore } from 'react'

export interface AutomatikMeldung {
  id: number
  text: string
  zeit: string
}

let meldungen: AutomatikMeldung[] = []
let naechsteId = 1
const hoerer = new Set<() => void>()

function melden() { for (const h of hoerer) h() }

/** Höchstens so viele stehen da – ältere fallen heraus. */
const HOECHSTENS = 5

export function automatikMelden(text: string, jetzt = new Date()): void {
  const zeit = `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`
  meldungen = [{ id: naechsteId++, text, zeit }, ...meldungen].slice(0, HOECHSTENS)
  melden()
}

export function automatikMeldungVerwerfen(id: number): void {
  meldungen = meldungen.filter((m) => m.id !== id)
  melden()
}

export function automatikMeldungenAlle(): AutomatikMeldung[] {
  return meldungen
}

export function useAutomatikMeldungen(): AutomatikMeldung[] {
  return useSyncExternalStore(
    (h) => { hoerer.add(h); return () => { hoerer.delete(h) } },
    () => meldungen,
    () => meldungen,
  )
}
