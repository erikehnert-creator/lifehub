/**
 * Anmeldung am Synchronisationsserver (Supabase-kompatibel).
 *
 * Warum überhaupt eine Anmeldung: Auf dem Server sind alle Tabellen mit
 * Zeilensicherheit gesperrt und geben ausschließlich die Zeilen frei, die zum
 * angemeldeten Benutzer gehören. Der öffentliche Schlüssel allein reicht
 * deshalb nicht aus, um Daten zu lesen – und genau so soll es sein.
 *
 * Die Sitzung liegt bewusst im localStorage und NICHT in der Datenbank:
 * Die Datenbank wird synchronisiert, ein Zugangstoken hat dort nichts verloren.
 * Jedes Gerät meldet sich einmal selbst an.
 */

const KEY = 'lifehub.session'

export interface Session {
  access_token: string
  refresh_token: string
  /** Unix-Zeit in Sekunden, ab der das Token erneuert werden muss. */
  expires_at: number
  email: string
  user_id: string
  url: string
}

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s?.access_token || !s?.refresh_token) return null
    return s as Session
  } catch {
    return null
  }
}

function write(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch { /* privater Modus: dann eben nur für diese Sitzung */ }
}

export function currentSession(): Session | null {
  return read()
}

export function isSignedIn(): boolean {
  return read() !== null
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

async function authRequest(url: string, anonKey: string, path: string, body: any): Promise<any> {
  const res = await fetch(`${base(url)}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    const msg = json?.error_description || json?.msg || json?.message || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  return json
}

function toSession(url: string, data: any): Session {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: nowSeconds() + Number(data.expires_in ?? 3600),
    email: data.user?.email ?? '',
    user_id: data.user?.id ?? '',
    url: base(url),
  }
}

/** Meldet dieses Gerät an und merkt sich die Sitzung. */
export async function signIn(url: string, anonKey: string, email: string, password: string): Promise<Session> {
  const data = await authRequest(url, anonKey, 'token?grant_type=password', { email, password })
  const session = toSession(url, data)
  write(session)
  return session
}

export function signOut() {
  write(null)
}

/**
 * Liefert ein gültiges Zugangstoken und erneuert es rechtzeitig.
 * Schlägt die Erneuerung fehl, wird die Sitzung verworfen – dann fragt die App
 * wieder nach dem Passwort, statt bei jedem Abgleich stumm zu scheitern.
 */
export async function accessToken(url: string, anonKey: string): Promise<string | null> {
  const s = read()
  if (!s) return null
  if (s.url !== base(url)) return null
  if (s.expires_at - 60 > nowSeconds()) return s.access_token
  try {
    const data = await authRequest(url, anonKey, 'token?grant_type=refresh_token', { refresh_token: s.refresh_token })
    const next = toSession(url, data)
    if (!next.email) next.email = s.email
    if (!next.user_id) next.user_id = s.user_id
    write(next)
    return next.access_token
  } catch {
    write(null)
    return null
  }
}

/* ------------------------------------------------- Rolle bei der Erstverbindung */

/**
 * Welche Rolle dieses Gerät beim ersten Abgleich eingenommen hat.
 *
 * Das ist die Lehre aus einem echten Fehler: Ein frisch gestartetes LifeHub
 * legt Beispielkonten an. Lief der automatische Abgleich los, bevor jemand
 * entschieden hatte, schob das neue Gerät diese Beispielkonten auf den Server –
 * und danach standen sie auf allen Geräten doppelt. Deshalb wird jetzt vor der
 * ersten Übertragung eine bewusste Entscheidung verlangt:
 *
 *   'quelle'  – dieses Gerät hat die richtigen Daten und füllt den Server
 *   'kopie'   – dieses Gerät ist neu und übernimmt den Serverstand
 *
 * Solange nichts gewählt ist, überträgt LifeHub von sich aus gar nichts.
 */
export type SyncRolle = 'quelle' | 'kopie'
const ROLLE = 'lifehub.sync.rolle'

export function syncRolle(): SyncRolle | null {
  try {
    const v = localStorage.getItem(ROLLE)
    return v === 'quelle' || v === 'kopie' ? v : null
  } catch { return null }
}

export function setSyncRolle(r: SyncRolle) {
  try { localStorage.setItem(ROLLE, r) } catch { /* privater Modus */ }
}

export function clearSyncRolle() {
  try { localStorage.removeItem(ROLLE) } catch { /* egal */ }
}

/** Meldet der App, dass sich an Anmeldung oder Rolle etwas geändert hat. */
export function meldeSyncAenderung() {
  try { window.dispatchEvent(new Event('lifehub:sync-geaendert')) } catch { /* egal */ }
}
