/**
 * Ein Symbolsatz für die ganze App.
 *
 * Vorher standen Emoji in der Navigation: Geldsack orange, Zielscheibe rot,
 * Zahnrad grau – vier Zeichenstile, deren Farben nichts bedeuteten und sich
 * mit den Status- und Bereichsfarben stritten. Liniensymbole nehmen die Farbe
 * ihrer Umgebung an (`currentColor`) und sehen auf jedem System gleich aus.
 *
 * Alle Symbole teilen dasselbe Raster: 24 × 24, Strich 1.8, runde Enden. Wer
 * eines ergänzt, zeichnet es im selben Raster – sonst wirkt es neben den
 * anderen zu fett oder zu dünn, auch wenn die Größe stimmt.
 */
import React from 'react'

export type IconName =
  | 'heute' | 'finanzen' | 'plan' | 'tracking' | 'kalender' | 'einkauf' | 'ziele'
  | 'analysen' | 'suche' | 'einstellungen' | 'mehr' | 'plus' | 'pfeil-rechts'
  | 'training' | 'ernaehrung' | 'schlaf' | 'gewicht' | 'aufgaben' | 'hinweis'
  | 'sync' | 'schliessen' | 'bearbeiten'

const PFADE: Record<IconName, React.ReactNode> = {
  heute: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  finanzen: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M16 14.5h2" /></>,
  plan: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="m8 12 2.5 2.5L16 9" /></>,
  tracking: <path d="M3 12h4l2.5-6 5 12L17 12h4" />,
  kalender: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  einkauf: <><path d="M3 4h2.2l2.2 11h10.4l2-7.5H6.4" /><circle cx="9" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>,
  ziele: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" /></>,
  analysen: <><path d="M4 20V4M4 20h16" /><path d="m8 15 3.5-4 3 2.5L20 7" /></>,
  suche: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></>,
  einstellungen: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" /><circle cx="12" cy="12" r="7" /></>,
  mehr: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  'pfeil-rechts': <path d="m10 6 6 6-6 6" />,
  training: <><path d="M6.5 8v8M17.5 8v8M4 10v4M20 10v4M6.5 12h11" /></>,
  ernaehrung: <><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" /><path d="M16.5 21V3c-2 1.5-3 4-3 7 0 2 1 3 3 3" /></>,
  schlaf: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  gewicht: <><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="M9 9.5a4.5 4.5 0 0 1 6 0l-2 2.5" /></>,
  aufgaben: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2 2.1-2.2M3.5 18l1.2 1.2 2.1-2.2" /></>,
  hinweis: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.2" /></>,
  sync: <><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" /><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2" /></>,
  schliessen: <path d="M6 6l12 12M18 6 6 18" />,
  bearbeiten: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
}

export function Icon({ name, size = 18, className, title }: {
  name: IconName
  size?: number
  className?: string
  /** Nur setzen, wenn das Symbol allein steht – neben Text ist es Schmuck. */
  title?: string
}) {
  return (
    <svg className={`icon${className ? ' ' + className : ''}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {PFADE[name]}
    </svg>
  )
}

/**
 * Welcher Bereich welche Farbe trägt.
 *
 * Bewusst nur vier. Alles andere bleibt neutral – eine Farbe für jede Seite
 * wäre keine Orientierung mehr, sondern Buntheit. Die Farben selbst stehen als
 * Tokens in theme.css (`--bereich-*`) und liegen alle abseits von Grün,
 * Bernstein, Orange und Rot: Diese vier sind für Zustände reserviert.
 */
export const BEREICH_FARBE: Record<string, string | undefined> = {
  finanzen: 'var(--bereich-finanzen)',
  plan: 'var(--bereich-plan)',
  kalender: 'var(--bereich-plan)',
  tracking: 'var(--bereich-tracking)',
  ziele: 'var(--bereich-ziele)',
}
