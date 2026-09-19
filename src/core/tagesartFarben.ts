/**
 * Welche Farbe eine Tagesart bekommt – reine Logik, ohne Datenbank.
 *
 * Bis September 2026 kamen die Farben aus der Diagrammpalette. Das hatte zwei
 * Haken: „Urlaub" und „Frei" waren beide grün und kaum auseinanderzuhalten,
 * und Grün heisst in dieser App bereits etwas – erledigt, im Rahmen,
 * Feiertag. Eine Schichtfläche im Kalender sollte nicht nebenbei „gut"
 * sagen. Die Nachtschicht wiederum trug das Rot für „kritisch".
 *
 * Jetzt tragen die Arbeitstage EINE Familie (blau) und unterscheiden sich in
 * der Helligkeit nach der Tageszeit: je später der Beginn, desto dunkler.
 * Das ist nicht nur ruhiger, es ist auch ablesbar – und es trifft ebenso
 * selbst angelegte Schichten, die anders heissen als die mitgelieferten.
 */

export const TAGESART_FARBE = {
  frueh: 'var(--tag-frueh)',
  spaet: 'var(--tag-spaet)',
  nacht: 'var(--tag-nacht)',
  schule: 'var(--tag-schule)',
  urlaub: 'var(--tag-urlaub)',
  frei: 'var(--tag-frei)',
  krank: 'var(--tag-krank)',
} as const

/**
 * Eine Farbe aus der alten Diagrammpalette (oder gar keine) gilt als „nicht
 * bewusst gewählt" und darf ersetzt werden. Alles andere hat Erik selbst
 * eingestellt und bleibt, wie es ist.
 */
export function istStandardTagesartFarbe(color: string | null | undefined): boolean {
  return !color || /^var\(--series-\d+\)$/.test(color)
}

/**
 * Die passende Farbe zu Art und Anfangszeit.
 *
 * Ein Arbeitstag ohne Anfangszeit (Bereitschaft, Rufdienst) bekommt den
 * mittleren Ton: Er ist Arbeit, aber ohne Aussage über die Tageszeit.
 */
export function tagesartFarbe(kind: string, defaultStart: string | null | undefined): string {
  if (kind === 'school') return TAGESART_FARBE.schule
  if (kind === 'vacation') return TAGESART_FARBE.urlaub
  if (kind === 'sick') return TAGESART_FARBE.krank
  if (kind !== 'work') return TAGESART_FARBE.frei
  if (!defaultStart) return TAGESART_FARBE.spaet
  const stunde = Number(defaultStart.slice(0, 2))
  if (!Number.isFinite(stunde)) return TAGESART_FARBE.spaet
  if (stunde >= 20 || stunde < 4) return TAGESART_FARBE.nacht
  if (stunde >= 12) return TAGESART_FARBE.spaet
  return TAGESART_FARBE.frueh
}
