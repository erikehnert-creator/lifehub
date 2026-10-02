/**
 * Schlafimport aus Apple Health – die Deno-Hülle.
 *
 * ---------------------------------------------------------------------------
 * Der Weg
 *
 *   Sleep Cycle → Apple Health → iOS-Kurzbefehl → DIESE FUNKTION → LifeHub
 *
 * Sleep Cycle hat keine brauchbare öffentliche Schnittstelle, und Apple Health
 * liegt auf dem iPhone – ein Server kann dort nicht hineinsehen. Also liest
 * der Kurzbefehl die Proben und schickt sie hierher.
 *
 * ---------------------------------------------------------------------------
 * Was hier steht und was nicht
 *
 * Hier steht nur, was Deno braucht: Umgebungsvariablen, CORS, der
 * Tabellenzugriff über den Dienstschlüssel und `Deno.serve`. Die eigentliche
 * Verarbeitung – Autorisierung, Rumpf, Schreibentscheidung, Rückgabe – liegt
 * in `verarbeite.ts` und ist von dort aus prüfbar
 * (`tests/schlaf-endpunkt.test.ts`). Solange sie hier stand, war genau der
 * Teil ungeprüft, an dem ein Fehler am teuersten ist.
 *
 * ---------------------------------------------------------------------------
 * Das Sicherheitsmodell
 *
 * Auf dem iPhone liegt AUSSCHLIESSLICH ein Importtoken – kein Dienstschlüssel,
 * kein Passwort, kein Supabase-Anmeldetoken.
 *
 *   • Erik legt den Zugang in LifeHub an. Dort entstehen 32 zufällige Bytes;
 *     gespeichert wird nur deren SHA-256-Abdruck (`import_tokens.token_hash`).
 *     Das Token selbst sieht er genau einmal und trägt es in den Kurzbefehl
 *     ein. Danach ist es nirgends mehr abrufbar – auch nicht für LifeHub.
 *   • Die Funktion bildet den Abdruck der eingehenden Anfrage und sucht ihn.
 *     Nur so kommt sie an die Nutzerkennung. Der Rumpf der Anfrage bestimmt
 *     NICHT, wem die Daten gehören – sonst könnte jeder mit einem beliebigen
 *     Token in fremde Konten schreiben.
 *   • Widerrufen: `revoked_at` setzen. Ab dem nächsten Abgleich ist der Zugang
 *     tot, ohne dass irgendetwas anderes angefasst werden muss.
 *   • Der Dienstschlüssel bleibt hier auf dem Server, in der Umgebung.
 *
 * Was NICHT geloggt wird: das Token, sein Abdruck und der Rumpf. Im Protokoll
 * stehen nur Anzahl und Ergebnis.
 *
 * ---------------------------------------------------------------------------
 * Veröffentlichen (ein Push reicht NICHT):
 *
 *   npx supabase functions deploy schlaf --no-verify-jwt
 *
 * `--no-verify-jwt` ist hier Absicht und kein Versehen: Die Anfrage trägt
 * bewusst KEIN Supabase-Anmeldetoken, sondern das Importtoken. Die Prüfung
 * findet in `verarbeite.ts` statt, nicht davor.
 */
import { verarbeiteAnfrage } from './verarbeite.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Der Kurzbefehl ist kein Browser – CORS ist nur für Prüfungen von Hand da. */
const KOPF = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Direkter Tabellenzugriff mit Dienstschlüssel – die Tabellen sind sonst gesperrt. */
async function db(pfad: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Datenbank ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: KOPF })

  const { status, rumpf } = await verarbeiteAnfrage(
    {
      methode: req.method,
      authorization: req.headers.get('Authorization') ?? '',
      rumpf: () => req.text(),
    },
    {
      db,
      protokoll: (t) => console.log(t),
      // Der Fehlertext kann Spaltennamen enthalten, aber niemals das Token.
      fehlerProtokoll: (t) => console.error(t),
    },
  )
  return new Response(JSON.stringify(rumpf), { status, headers: KOPF })
})
