/**
 * Importtoken: erzeugen und zu einem Abdruck verrechnen.
 *
 * Liegt in `_shared`, weil beide Seiten dieselbe Rechnung brauchen: LifeHub
 * legt den Zugang an und speichert den Abdruck, die Edge Function bildet den
 * Abdruck der eingehenden Anfrage und sucht ihn. Zwei Fassungen, die auch nur
 * in der Schreibweise der Hexziffern auseinanderliegen, ergäben einen Zugang,
 * der sich anlegen, aber nie benutzen lässt – und der Fehler wäre von außen
 * nicht von „falsches Token" zu unterscheiden.
 *
 * Reines Web Crypto, also in Browser, Deno und Node gleichermaßen vorhanden.
 */

/**
 * Ein neues Token: 32 Zufallsbytes, als base64url.
 *
 * 32 Bytes, weil das auch gegen jemanden reicht, der systematisch probiert –
 * der Endpunkt ist aus dem Internet erreichbar. Base64url, damit es ohne
 * Umkodierung in eine Kopfzeile und in den Kurzbefehl passt.
 *
 * Dieses Token wird NIRGENDS gespeichert. Erik sieht es beim Anlegen einmal;
 * danach existiert nur noch sein Abdruck.
 */
export function erzeugeToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let roh = ''
  for (const b of bytes) roh += String.fromCharCode(b)
  return btoa(roh).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 als Hexzeichenkette, Kleinbuchstaben. */
export async function tokenAbdruck(token: string): Promise<string> {
  const daten = new TextEncoder().encode(token)
  const puffer = await crypto.subtle.digest('SHA-256', daten)
  return [...new Uint8Array(puffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Wie ein Token aussehen muss, damit es überhaupt geprüft wird.
 *
 * Spart der Funktion eine Datenbankabfrage bei offensichtlichem Unsinn und
 * hält die Antwortzeit bei Müll gleichmäßig kurz.
 */
export function siehtWieTokenAus(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(token)
}
