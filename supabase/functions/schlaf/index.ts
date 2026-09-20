/**
 * Schlafimport aus Apple Health.
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
 * Das Sicherheitsmodell
 *
 * Auf dem iPhone liegt AUSSCHLIESSLICH ein Importtoken – kein Dienstschlüssel,
 * kein Passwort, kein Supabase-Anmeldetoken.
 *
 *   • Erik legt den Zugang in LifeHub an. Dort entstehen 32 zufällige Bytes;
 *     gespeichert wird nur deren SHA-256-Abdruck (`import_tokens.token_hash`).
 *     Das Token selbst sieht er genau einmal und trägt es in den Kurzbefehl
 *     ein. Danach ist es nirgends mehr abrufbar – auch nicht für LifeHub.
 *   • Diese Funktion bildet den Abdruck der eingehenden Anfrage und sucht ihn.
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
 * findet unten statt, nicht davor.
 */
import { baueNaechte, pruefeRumpf, entscheideSchreiben, HOECHSTZAHL_PROBEN } from './aggregat.ts'
import { idAusSchluessel } from '../_shared/stabileId.ts'
import { tokenAbdruck, siehtWieTokenAus } from '../_shared/importToken.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Der Kurzbefehl ist kein Browser – CORS ist nur für Prüfungen von Hand da. */
const KOPF = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const antwort = (status: number, rumpf: unknown) =>
  new Response(JSON.stringify(rumpf), { status, headers: KOPF })

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

/**
 * Wem gehört dieses Token?
 *
 * Nur ein Token, das es gibt, nicht widerrufen und nicht gelöscht ist, führt
 * zu einer Nutzerkennung. Alles andere ergibt `null`, und der Aufrufer
 * antwortet mit 401 – ohne zu verraten, woran es lag.
 */
async function besitzer(token: string): Promise<{ id: string; user_id: string } | null> {
  if (!siehtWieTokenAus(token)) return null
  const hash = await tokenAbdruck(token)
  const treffer = await db(
    `import_tokens?token_hash=eq.${encodeURIComponent(hash)}`
    + `&revoked_at=is.null&deleted_at=is.null&scope=eq.schlaf&select=id,user_id&limit=1`,
  )
  const zeile = Array.isArray(treffer) ? treffer[0] : null
  return zeile?.user_id ? { id: zeile.id, user_id: zeile.user_id } : null
}

const jetzt = () => new Date().toISOString()

/**
 * Eine Nacht schreiben – anlegen oder aktualisieren.
 *
 * Die ID kommt aus dem Tag (`idAusSchluessel`), genau wie in der App. Deshalb
 * trifft ein zweiter Import derselben Nacht dieselbe Zeile: Aus „morgens
 * zweimal ausgeführt" werden keine zwei Nächte.
 *
 * Eine von Hand geschriebene Notiz bleibt stehen – der Import kennt sie nicht
 * und darf sie nicht mit `null` überschreiben.
 */
async function schreibeNacht(userId: string, nacht: Record<string, any>): Promise<'neu' | 'geaendert' | 'gleich'> {
  const id = idAusSchluessel('sleep_sessions', nacht.day)
  const vorhanden = await db(
    `sleep_sessions?id=eq.${id}&user_id=eq.${userId}`
    + `&select=id,version,note,duration_min,start_at,end_at,awake_min,in_bed_min,core_min,deep_min,rem_min,source`,
  )
  const alt = Array.isArray(vorhanden) ? vorhanden[0] : null

  const was = entscheideSchreiben(alt, nacht as any)
  if (was === 'gleich') return 'gleich'

  const zeile = {
    id,
    user_id: userId,
    day: nacht.day,
    start_at: nacht.start_at,
    end_at: nacht.end_at,
    duration_min: nacht.duration_min,
    awake_min: nacht.awake_min,
    in_bed_min: nacht.in_bed_min,
    core_min: nacht.core_min,
    deep_min: nacht.deep_min,
    rem_min: nacht.rem_min,
    source: nacht.source,
    note: alt?.note ?? null,
    created_at: alt ? undefined : jetzt(),
    updated_at: jetzt(),
    deleted_at: null,
    version: (Number(alt?.version) || 0) + 1,
    last_device_id: 'apple-health',
  }
  for (const k of Object.keys(zeile)) {
    if ((zeile as any)[k] === undefined) delete (zeile as any)[k]
  }

  if (alt) {
    await db(`sleep_sessions?id=eq.${id}&user_id=eq.${userId}`, {
      method: 'PATCH', body: JSON.stringify(zeile),
    })
    return 'geaendert'
  }
  await db('sleep_sessions', { method: 'POST', body: JSON.stringify(zeile) })
  return 'neu'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: KOPF })
  if (req.method !== 'POST') return antwort(405, { fehler: 'Nur POST' })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()

  let wer: { id: string; user_id: string } | null
  try {
    wer = await besitzer(token)
  } catch (e) {
    console.error('Tokenpruefung fehlgeschlagen:', String(e).slice(0, 200))
    return antwort(500, { fehler: 'Interner Fehler' })
  }
  // Bewusst dieselbe Antwort fuer "kein Token", "unbekannt" und "widerrufen".
  if (!wer) return antwort(401, { fehler: 'Zugang ungueltig' })

  let rumpf: unknown
  let roher: string
  try {
    roher = await req.text()
  } catch {
    return antwort(400, { fehler: 'Rumpf nicht lesbar' })
  }
  // Grobe Schranke, bevor ueberhaupt geparst wird.
  if (roher.length > 2_000_000) return antwort(413, { fehler: 'Sendung zu gross' })

  // Ist der Rumpf kein JSON, wird er als TEXT weitergereicht statt abgewiesen.
  // Ein iOS-Kurzbefehl bekommt ein JSON-Array nur mit Muehe zustande; die
  // Zeilenform start|ende|wert|quelle dagegen ohne jede Verrenkung. Was
  // erlaubt ist, steht bei pruefeRumpf() - geprueft wird danach gleich streng.
  try {
    rumpf = JSON.parse(roher)
  } catch {
    rumpf = roher
  }

  const geprueft = pruefeRumpf(rumpf)
  if (!geprueft.ok) return antwort(400, { fehler: geprueft.fehler, hoechstzahl: HOECHSTZAHL_PROBEN })

  const naechte = baueNaechte(geprueft.proben!)
  if (naechte.length === 0) {
    return antwort(200, { naechte: 0, neu: 0, geaendert: 0, hinweis: 'Keine auswertbaren Schlafproben' })
  }

  let neu = 0, geaendert = 0, gleich = 0
  try {
    for (const n of naechte) {
      const was = await schreibeNacht(wer.user_id, n)
      if (was === 'neu') neu++
      else if (was === 'geaendert') geaendert++
      else gleich++
    }
    await db(`import_tokens?id=eq.${wer.id}`, {
      method: 'PATCH', body: JSON.stringify({ last_used_at: jetzt() }),
    })
  } catch (e) {
    // Der Fehlertext kann Spaltennamen enthalten, aber niemals das Token.
    console.error('Schreiben fehlgeschlagen:', String(e).slice(0, 300))
    return antwort(500, { fehler: 'Konnte nicht speichern' })
  }

  console.log(`Schlafimport: ${naechte.length} Nacht/Naechte, ${neu} neu, ${geaendert} geaendert, ${gleich} unveraendert`)
  return antwort(200, {
    naechte: naechte.length,
    neu,
    geaendert,
    unveraendert: gleich,
    tage: naechte.map((n) => n.day),
  })
})
