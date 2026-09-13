/**
 * FatSecret-Anbindung – der serverseitige Teil.
 *
 * ---------------------------------------------------------------------------
 * Warum es diesen Teil überhaupt gibt
 *
 * LifeHub ist eine statische Seite: Alles, was im Browser-Bündel steht, kann
 * jeder lesen, der die Seite aufruft. Der Consumer Secret von FatSecret darf
 * deshalb unter keinen Umständen dort hinein – mit ihm könnte ein Fremder im
 * Namen dieser Anwendung Anfragen stellen. FatSecret schreibt aus genau
 * diesem Grund selbst vor, dass Zugangsdaten über einen eigenen Server
 * ("proxy server") laufen.
 *
 * Also läuft der gesamte OAuth-Teil hier, in einer Supabase Edge Function:
 *
 *   Browser  ──(Supabase-Anmeldung)──▶  diese Funktion  ──(OAuth 1.0)──▶ FatSecret
 *
 * Im Browser landen nur fertige Nährwerte. Weder der Consumer Secret noch das
 * Zugangstoken des FatSecret-Kontos verlassen jemals diesen Server, und ein
 * FatSecret-Passwort sieht LifeHub nie – man meldet sich bei FatSecret selbst
 * an und erlaubt den Zugriff dort.
 *
 * ---------------------------------------------------------------------------
 * Welches Verfahren, und warum dieses
 *
 * FatSecret bietet zwei Verfahren an. OAuth 2.0 unterstützt ausschließlich
 * "client_credentials" – damit spricht man für die Anwendung, nicht für eine
 * Person, und kommt an ein persönliches Ernährungstagebuch gar nicht heran.
 * Für fremde Tagebücher gibt es nur das dreibeinige OAuth 1.0 über
 * authentication.fatsecret.com. Deshalb OAuth 1.0 mit HMAC-SHA1 – nicht aus
 * Nostalgie, sondern weil es für diesen Zweck das einzige offiziell
 * vorgesehene Verfahren ist.
 *
 * ---------------------------------------------------------------------------
 * Einrichtung (einmalig, siehe auch README)
 *
 *   supabase secrets set FATSECRET_CONSUMER_KEY=...  FATSECRET_CONSUMER_SECRET=...
 *   supabase functions deploy fatsecret --no-verify-jwt
 *
 * `--no-verify-jwt` ist nötig, weil FatSecret den Nutzer nach der Freigabe auf
 * /callback zurückschickt – ein gewöhnlicher Browser-Aufruf ohne Anmeldetoken.
 * Jede andere Route prüft das Token selbst (siehe `nutzer()`), der Callback
 * ordnet sich stattdessen über den einmaligen oauth_token zu.
 */

/**
 * Die FatSecret-Adressen – jeweils mit der Methode, die FatSecret dort verlangt.
 *
 * Die Methode ist hier kein Nebensache: Sie ist der erste Teil der
 * Signaturbasis. Wer mit GET signiert, wo POST verlangt ist, bekommt keine
 * Meldung über die Methode, sondern `Invalid signature` – und sucht dann den
 * Fehler beim Schlüssel, beim Encoding oder bei der Uhrzeit.
 *
 * Laut Dokumentation (Stand 13.09.2026):
 *   request_token   „This API supports HTTP method POST."
 *   authorize       einfacher GET-Aufruf im Browser, nicht signiert
 *   access_token    „This API supports HTTP method GET."
 * https://platform.fatsecret.com/docs/guides/authentication/oauth1/three-legged
 *
 * Wird eine dieser Zeilen geändert, muss `tests/fatsecret-oauth.test.ts`
 * mitgeändert werden – der Test liest diese Datei und rechnet die Zuordnung
 * von Adresse zu Methode nach.
 */
const FATSECRET_REQUEST_TOKEN = 'https://authentication.fatsecret.com/oauth/request_token' // POST
const FATSECRET_AUTHORIZE = 'https://authentication.fatsecret.com/oauth/authorize'         // GET, unsigniert
const FATSECRET_ACCESS_TOKEN = 'https://authentication.fatsecret.com/oauth/access_token'   // GET
const FATSECRET_API = 'https://platform.fatsecret.com/rest/server.api'                     // GET

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ------------------------------------------------------------- OAuth 1.0 */

/**
 * Prozentkodierung nach RFC 3986.
 * `encodeURIComponent` lässt ! * ' ( ) stehen – FatSecret erwartet sie kodiert,
 * und eine abweichende Kodierung führt zu einer falschen Signatur.
 */
function enc(v: string): string {
  return encodeURIComponent(v).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

async function hmacSha1(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

/**
 * Signierte OAuth-1.0-Anfrage.
 *
 * Die Signaturbasis ist empfindlich: Methode, URL und ALLE Parameter –
 * die eigenen wie die oauth_* – sortiert, einzeln kodiert, dann das Ganze
 * noch einmal kodiert. Ein vergessener Parameter ergibt keinen Fehler mit
 * Hinweis, sondern nur ein dürres "invalid signature".
 */
async function oauthRequest(opts: {
  url: string
  params: Record<string, string>
  consumerKey: string
  consumerSecret: string
  token?: string
  tokenSecret?: string
  /**
   * Pflichtangabe, und zwar mit Absicht.
   *
   * Vorher stand hier `method?: ... ` mit `?? 'GET'`. Wer die Angabe vergaß,
   * bekam stillschweigend GET – und weil die Methode in die Signaturbasis
   * eingeht, antwortete FatSecret nicht mit „falsche Methode", sondern mit
   * einem dürren `Invalid signature`. Genau so ist der Aufruf des
   * request_token-Endpunkts monatelang falsch geblieben: FatSecret verlangt
   * dort POST (siehe FATSECRET_REQUEST_TOKEN), geschickt wurde GET.
   *
   * Ohne Vorgabewert ist das Vergessen kein leiser Fehlgriff mehr, sondern
   * fällt beim Veröffentlichen auf.
   */
  method: 'GET' | 'POST'
}): Promise<string> {
  const method = opts.method
  const alle: Record<string, string> = {
    ...opts.params,
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  }
  if (opts.token) alle.oauth_token = opts.token

  const normalisiert = Object.keys(alle)
    .sort()
    .map((k) => `${enc(k)}=${enc(alle[k])}`)
    .join('&')
  const basis = [method, enc(opts.url), enc(normalisiert)].join('&')
  const schluessel = `${enc(opts.consumerSecret)}&${enc(opts.tokenSecret ?? '')}`
  alle.oauth_signature = await hmacSha1(schluessel, basis)

  const query = Object.keys(alle)
    .map((k) => `${enc(k)}=${enc(alle[k])}`)
    .join('&')

  const res = method === 'GET'
    ? await fetch(`${opts.url}?${query}`)
    : await fetch(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query,
    })

  const text = await res.text()
  if (!res.ok) throw new Error(`FatSecret ${res.status}: ${text.slice(0, 300)}`)
  return text
}

function parseFormEncoded(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const paar of text.split('&')) {
    const [k, v] = paar.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
  }
  return out
}

/* ------------------------------------------------------------- Datenbank */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** Direkter Tabellenzugriff mit Dienstschlüssel – die Tabellen sind sonst gesperrt. */
async function db(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Datenbank ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/** Wer stellt die Anfrage? Aus dem Supabase-Anmeldetoken, nicht aus dem Rumpf. */
async function nutzer(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const u = await res.json()
  return u?.id ? { id: u.id, email: u.email ?? '' } : null
}

/* ---------------------------------------------------------------- Routen */

const CONSUMER_KEY = Deno.env.get('FATSECRET_CONSUMER_KEY') ?? ''
const CONSUMER_SECRET = Deno.env.get('FATSECRET_CONSUMER_SECRET') ?? ''

/** Schritt 1: Anfrage-Token holen und den Nutzer zu FatSecret schicken. */
async function starten(userId: string, rueckkehr: string, callbackUrl: string) {
  const antwort = await oauthRequest({
    url: FATSECRET_REQUEST_TOKEN,
    method: 'POST',                       // FatSecret verlangt hier POST
    params: { oauth_callback: callbackUrl },
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
  })
  const p = parseFormEncoded(antwort)
  if (!p.oauth_token || !p.oauth_token_secret) {
    throw new Error('FatSecret hat kein Anfrage-Token geliefert.')
  }
  // Das Geheimnis zum Anfrage-Token muss den Nutzerwechsel zu FatSecret und
  // zurück überleben. Es hier zu hinterlegen ist auch die Zuordnung: Der
  // Callback kommt ohne Anmeldung zurück und findet über den oauth_token,
  // zu wem er gehört.
  await db('fatsecret_pending', {
    method: 'POST',
    body: JSON.stringify({
      oauth_token: p.oauth_token,
      oauth_token_secret: p.oauth_token_secret,
      user_id: userId,
      redirect_to: rueckkehr,
    }),
  })
  return { authorize_url: `${FATSECRET_AUTHORIZE}?oauth_token=${enc(p.oauth_token)}` }
}

/** Schritt 2: FatSecret schickt den Nutzer mit einem Verifizierer zurück. */
async function callback(url: URL): Promise<Response> {
  const oauthToken = url.searchParams.get('oauth_token') ?? ''
  const verifier = url.searchParams.get('oauth_verifier') ?? ''

  const offen = await db(`fatsecret_pending?oauth_token=eq.${enc(oauthToken)}&select=*`)
  const eintrag = offen?.[0]
  if (!eintrag) {
    return new Response(
      'Diese Freigabe ist abgelaufen oder wurde schon verwendet. Bitte in LifeHub erneut auf „Verbinden" tippen.',
      { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
  const ziel = eintrag.redirect_to || '/'

  try {
    if (!verifier) throw new Error('FatSecret hat die Freigabe abgebrochen.')
    const antwort = await oauthRequest({
      url: FATSECRET_ACCESS_TOKEN,
      method: 'GET',                      // FatSecret verlangt hier GET
      params: { oauth_verifier: verifier },
      consumerKey: CONSUMER_KEY,
      consumerSecret: CONSUMER_SECRET,
      token: oauthToken,
      tokenSecret: eintrag.oauth_token_secret,
    })
    const p = parseFormEncoded(antwort)
    if (!p.oauth_token || !p.oauth_token_secret) throw new Error('Kein Zugangstoken erhalten.')

    await db('fatsecret_accounts', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: eintrag.user_id,
        oauth_token: p.oauth_token,
        oauth_token_secret: p.oauth_token_secret,
        connected_at: new Date().toISOString(),
      }),
    })
    await db(`fatsecret_pending?oauth_token=eq.${enc(oauthToken)}`, { method: 'DELETE' })
    return Response.redirect(`${ziel}${ziel.includes('?') ? '&' : '?'}fatsecret=ok`, 302)
  } catch (err) {
    await db(`fatsecret_pending?oauth_token=eq.${enc(oauthToken)}`, { method: 'DELETE' }).catch(() => {})
    const grund = enc(String((err as Error)?.message ?? err).slice(0, 200))
    return Response.redirect(`${ziel}${ziel.includes('?') ? '&' : '?'}fatsecret=fehler&grund=${grund}`, 302)
  }
}

/** Das gespeicherte Zugangstoken dieses Nutzers. */
async function konto(userId: string): Promise<{ oauth_token: string; oauth_token_secret: string } | null> {
  const rows = await db(`fatsecret_accounts?user_id=eq.${userId}&select=oauth_token,oauth_token_secret`)
  return rows?.[0] ?? null
}

/**
 * Schritt 3: Das Tagebuch eines Tages holen.
 *
 * `date` ist bei FatSecret die Anzahl Tage seit dem 1. Januar 1970 – nicht
 * etwa ein Datum. Die Umrechnung passiert im Browser (core/fatsecret.ts), weil
 * dort auch die Zeitzone des Nutzers bekannt ist.
 */
async function tagebuch(userId: string, tage: number[]): Promise<Response> {
  const k = await konto(userId)
  if (!k) return json({ error: 'nicht_verbunden' }, 409)

  const ergebnis: Record<string, unknown> = {}
  for (const tag of tage.slice(0, 62)) {
    const text = await oauthRequest({
      url: FATSECRET_API,
      method: 'GET',
      params: { method: 'food_entries.get.v2', format: 'json', date: String(tag) },
      consumerKey: CONSUMER_KEY,
      consumerSecret: CONSUMER_SECRET,
      token: k.oauth_token,
      tokenSecret: k.oauth_token_secret,
    })
    let daten: any = null
    try { daten = JSON.parse(text) } catch { daten = null }
    // FatSecret antwortet auf Fehler mit HTTP 200 und einem error-Objekt.
    // Ein abgelaufenes oder zurückgezogenes Token sieht genau so aus – das
    // muss als solches herauskommen und nicht als "der Tag war leer".
    if (daten?.error) {
      const code = Number(daten.error.code ?? 0)
      if (code === 4 || code === 8 || code === 14) return json({ error: 'anmeldung_abgelaufen' }, 401)
      return json({ error: 'fatsecret', detail: String(daten.error.message ?? '') }, 502)
    }
    ergebnis[String(tag)] = daten
  }
  await db(`fatsecret_accounts?user_id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_sync_at: new Date().toISOString() }),
  }).catch(() => {})
  return json({ days: ergebnis })
}

/* ----------------------------------------------------------------- Einstieg */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const pfad = url.pathname.replace(/^.*\/fatsecret/, '').replace(/^\//, '') || 'status'

  // Der Rückweg von FatSecret: ein gewöhnlicher Browser-Aufruf, ohne Anmeldung.
  if (pfad === 'callback') {
    try { return await callback(url) } catch (err) {
      return new Response(`Fehler: ${(err as Error)?.message ?? err}`, { status: 500 })
    }
  }

  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    // Getrennt benannt, weil die Abhilfe unterschiedlich ist: Meist ist nur
    // eines der beiden Geheimnisse gesetzt, und dann sucht man lange, wenn
    // die Meldung nur „fehlen" sagt. Die Werte selbst stehen hier nirgends.
    const fehlt = !CONSUMER_KEY && !CONSUMER_SECRET
      ? 'FATSECRET_CONSUMER_KEY und FATSECRET_CONSUMER_SECRET sind auf dem Server nicht gesetzt.'
      : !CONSUMER_KEY
        ? 'FATSECRET_CONSUMER_KEY ist auf dem Server nicht gesetzt (FATSECRET_CONSUMER_SECRET schon).'
        : 'FATSECRET_CONSUMER_SECRET ist auf dem Server nicht gesetzt (FATSECRET_CONSUMER_KEY schon).'
    return json({ error: 'nicht_eingerichtet', detail: fehlt }, 503)
  }

  const u = await nutzer(req)
  if (!u) return json({ error: 'nicht_angemeldet' }, 401)

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

    switch (pfad) {
      case 'status': {
        const k = await db(`fatsecret_accounts?user_id=eq.${u.id}&select=connected_at,last_sync_at`)
        return json({ connected: !!k?.[0], ...(k?.[0] ?? {}) })
      }
      case 'start': {
        const rueckkehr = String(body.redirect_to ?? '')
        if (!/^https?:\/\//.test(rueckkehr)) return json({ error: 'redirect_to fehlt' }, 400)
        const callbackUrl = `${url.origin}${url.pathname.replace(/\/start$/, '')}/callback`
        return json(await starten(u.id, rueckkehr, callbackUrl))
      }
      case 'diary': {
        const tage = Array.isArray(body.dates) ? body.dates.map(Number).filter(Number.isFinite) : []
        if (!tage.length) return json({ error: 'dates fehlt' }, 400)
        return await tagebuch(u.id, tage)
      }
      case 'disconnect': {
        await db(`fatsecret_accounts?user_id=eq.${u.id}`, { method: 'DELETE' })
        return json({ connected: false })
      }
      default:
        return json({ error: 'unbekannte_route', pfad }, 404)
    }
  } catch (err) {
    return json({ error: 'serverfehler', detail: String((err as Error)?.message ?? err) }, 500)
  }
})
