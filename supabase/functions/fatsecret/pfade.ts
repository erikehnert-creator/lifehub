/**
 * Adressen rund um den OAuth-Rückweg – der Teil, der ohne Deno auskommt.
 *
 * Ausgelagert, weil genau hier der Fehler saß und weil er sich von außen nicht
 * ansehen ließ: `index.ts` läuft in Deno, benutzt `Deno.env` und `Deno.serve`
 * und ist aus den Tests nicht aufrufbar. Was hier steht, ist reines Rechnen mit
 * Zeichenketten und deshalb prüfbar.
 *
 * ---------------------------------------------------------------------------
 * Der Fehler, um den es geht
 *
 * Die Rückkehradresse für FatSecret wurde aus der eingehenden Anfrage gebaut:
 *
 *     `${url.origin}${url.pathname.replace(/\/start$/, '')}/callback`
 *
 * Das sieht richtig aus und ist es auch – wenn `url.pathname` das wäre, was
 * außen in der Adresszeile steht. Ist es aber nicht: **Supabase entfernt das
 * Präfix `/functions/v1`, bevor die Funktion die Anfrage sieht.** Innen steht
 * also `/fatsecret/start`, nicht `/functions/v1/fatsecret/start`.
 *
 * Heraus kam damit
 *     https://<projekt>.supabase.co/fatsecret/callback
 * und dorthin schickte FatSecret den Nutzer nach der Freigabe. Supabase kennt
 * diesen Pfad nicht und antwortet
 *     {"error":"Requested path is invalid"}
 *
 * Die Freigabe selbst hatte zu diesem Zeitpunkt längst geklappt – nur der
 * Rückweg führte ins Leere. Deshalb wird die Adresse jetzt nicht mehr aus der
 * Anfrage abgeleitet, sondern aus `SUPABASE_URL` zusammengesetzt, mit dem
 * Präfix ausgeschrieben. Was Supabase intern mit dem Pfad macht, ist dann egal.
 */

/** Der Pfad, unter dem die Funktion von außen erreichbar ist. */
export const FUNKTIONS_PFAD = '/functions/v1/fatsecret'

/**
 * Die Adresse, die FatSecret als `oauth_callback` bekommt.
 *
 * `supabaseUrl` ist `SUPABASE_URL` – in einer Edge Function immer gesetzt und
 * immer die von außen sichtbare Projektadresse. Der zweite Wert ist nur die
 * Rückfallebene für den örtlichen Betrieb, wo die Variable fehlen kann.
 */
export function callbackAdresse(supabaseUrl: string, anfrageOrigin: string): string {
  const basis = (supabaseUrl || anfrageOrigin || '').replace(/\/+$/, '')
  return `${basis}${FUNKTIONS_PFAD}/callback`
}

/**
 * Welche Route ist gemeint?
 *
 * Muss mit beiden Schreibweisen zurechtkommen: Supabase liefert innen
 * `/fatsecret/callback`, örtlich oder hinter einem Proxy kann auch
 * `/functions/v1/fatsecret/callback` ankommen. Ohne Pfadangabe gilt `status`.
 */
export function routeVonPfad(pathname: string): string {
  return (pathname ?? '')
    .replace(/^.*\/fatsecret/, '')
    .replace(/^\//, '')
    .replace(/\/+$/, '')
    || 'status'
}

/**
 * Wohin nach der Freigabe zurückgeleitet werden darf.
 *
 * Die Adresse kommt vom Client, und die Funktion leitet den Browser dorthin
 * weiter – ungeprüft wäre das eine offene Weiterleitung: Wer einen Aufruf an
 * `/start` unterschieben kann, bestimmt, wohin der Nutzer nach einer echten,
 * erfolgreich aussehenden FatSecret-Anmeldung landet.
 *
 * Deshalb eine Liste statt einer Formprüfung. `http(s)://` allein sagt nur,
 * dass es eine Adresse ist, nicht dass es LifeHub ist.
 */
export const ERLAUBTE_RUECKWEGE = [
  'https://erikehnert-creator.github.io/lifehub/',
]

export function rueckwegErlaubt(
  kandidat: string, erlaubte: string[] = ERLAUBTE_RUECKWEGE,
): boolean {
  let u: URL
  try { u = new URL(kandidat) } catch { return false }

  // Für die Entwicklung am eigenen Rechner.
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
    return true
  }
  if (u.protocol !== 'https:') return false

  return erlaubte.some((e) => {
    let a: URL
    try { a = new URL(e) } catch { return false }
    // Herkunft muss gleich sein, und der Pfad muss darunter liegen. Ohne den
    // Pfadvergleich käme auch …github.io/etwas-anderes/ durch; ohne den
    // Herkunftsvergleich sogar …github.io.fremde-seite.de.
    return u.origin === a.origin && u.pathname.startsWith(a.pathname)
  })
}
