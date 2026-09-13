/**
 * FatSecret-Anbindung – der Teil im Browser.
 *
 * Hier steht bewusst NICHTS Geheimes. Diese Datei spricht ausschließlich mit
 * der eigenen Edge Function (supabase/functions/fatsecret), und die spricht
 * mit FatSecret. Consumer Secret und Zugangstoken bleiben dort; hierher kommen
 * nur fertige Nährwerte.
 *
 * Ausgewiesen wird man mit derselben Anmeldung wie beim normalen Abgleich –
 * eine zweite Anmeldung gibt es nicht, und ein FatSecret-Passwort wird nie
 * abgefragt.
 */
import { accessToken } from './auth'
import { resolvedSyncKey, resolvedSyncUrl } from './config'

export interface FatSecretStatus {
  connected: boolean
  connected_at?: string | null
  last_sync_at?: string | null
}

/** Ein Fehler, den der Nutzer versteht – plus die Ursache für die Anzeige. */
export class FatSecretFehler extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export const MELDUNGEN: Record<string, string> = {
  nicht_eingerichtet:
    'Auf dem Server fehlen noch die FatSecret-Zugangsdaten. Bis die hinterlegt sind, kann LifeHub nichts abrufen.',
  nicht_angemeldet:
    'Für FatSecret muss LifeHub beim eigenen Server angemeldet sein – siehe Einstellungen → Synchronisation.',
  nicht_verbunden:
    'Mit FatSecret ist noch kein Konto verbunden.',
  anmeldung_abgelaufen:
    'FatSecret hat den Zugriff beendet (abgelaufen oder in FatSecret zurückgezogen). Bitte einmal neu verbinden.',
  fatsecret:
    'FatSecret hat die Anfrage abgelehnt.',
  nicht_veroeffentlicht:
    'Die FatSecret-Funktion ist auf dem Server noch nicht veröffentlicht (supabase functions deploy fatsecret).',
  serverfehler:
    'Auf dem eigenen Server ist beim FatSecret-Zugriff etwas schiefgegangen. Die LifeHub-Daten sind davon nicht betroffen.',
  unbekannte_route:
    'Die FatSecret-Funktion auf dem Server ist älter als diese Fassung von LifeHub. Bitte einmal neu veröffentlichen.',
  nicht_erreichbar:
    'Der eigene Server war nicht erreichbar. Prüfe die Internetverbindung; dein Ernährungstagebuch in LifeHub bleibt unverändert.',
  fatsecret_key_falsch:
    'FatSecret kennt diesen Consumer Key nicht. Prüfe im Developer Portal, ob du ihn vollständig kopiert hast, '
    + 'und setze ihn neu (supabase secrets set FATSECRET_CONSUMER_KEY=...).',
  fatsecret_secret_falsch:
    'Der Consumer Key stimmt – FatSecret nimmt ihn an. Das Consumer Secret passt aber nicht dazu: '
    + 'Damit unterschriebene Anfragen weist FatSecret ab. Hol das Secret im Developer Portal neu '
    + '(bei Bedarf neu erzeugen) und setze es noch einmal.',
  kein_tagebuchzugriff:
    'Der FatSecret-Schlüssel darf das persönliche Tagebuch nicht lesen. Im FatSecret Developer Portal muss für diesen Schlüssel '
    + '3-Legged OAuth freigeschaltet sein.',
}

/**
 * Antworten von FatSecret, die nicht „kaputt" heißen, sondern „darf nicht".
 *
 * FatSecret gibt dafür keinen eigenen Fehlercode heraus, sondern schreibt es
 * in den Text. Ohne diese Zuordnung stünde beim häufigsten Einrichtungsfehler
 * nur „FatSecret hat die Anfrage abgelehnt" da – wahr, aber nicht hilfreich.
 */
export function feinerCode(code: string, detail: string): string {
  if (code !== 'fatsecret') return code
  const d = detail.toLowerCase()
  if (/scope|not authori[sz]ed|permission|not allowed|invalid method|premier/.test(d)) {
    return 'kein_tagebuchzugriff'
  }
  return code
}

function basisUrl(settingsUrl: string): string {
  return `${resolvedSyncUrl(settingsUrl).replace(/\/+$/, '')}/functions/v1/fatsecret`
}

async function ruf(
  settings: { sync_url: string; sync_key: string },
  pfad: string,
  body?: Record<string, unknown>,
): Promise<any> {
  const url = resolvedSyncUrl(settings.sync_url)
  const key = resolvedSyncKey(settings.sync_key)
  const token = await accessToken(url, key)
  if (!token) throw new FatSecretFehler('nicht_angemeldet', MELDUNGEN.nicht_angemeldet)

  // Ein abgebrochener Netzwerkaufruf wirft einen TypeError ohne brauchbaren
  // Text („Failed to fetch"). Ohne diese Umdeutung stünde das so in der
  // Oberfläche – und sähe aus, als wäre in LifeHub etwas kaputt.
  let res: Response
  try {
    res = await fetch(`${basisUrl(settings.sync_url)}/${pfad}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    throw new FatSecretFehler('nicht_erreichbar', MELDUNGEN.nicht_erreichbar)
  }
  const text = await res.text()
  let daten: any = null
  try { daten = text ? JSON.parse(text) : null } catch { /* keine JSON-Antwort */ }

  if (!res.ok) {
    // 404 heißt hier fast immer: Die Funktion ist noch nicht veröffentlicht.
    // Das ist der wahrscheinlichste Fehler überhaupt und verdient deshalb eine
    // Antwort, mit der man etwas anfangen kann.
    if (res.status === 404 && !daten?.error) {
      throw new FatSecretFehler('nicht_veroeffentlicht', MELDUNGEN.nicht_veroeffentlicht)
    }
    const roh = String(daten?.error ?? `http_${res.status}`)
    const code = feinerCode(roh, String(daten?.detail ?? ''))
    // Die Einzelheit steht nur dann dabei, wenn die Meldung selbst sie nicht
    // ohnehin schon erklärt – sonst liest man dasselbe zweimal.
    const detail = daten?.detail && code === roh ? ` (${daten.detail})` : ''
    throw new FatSecretFehler(code, (MELDUNGEN[code] ?? `FatSecret: ${res.status} ${res.statusText}`) + detail)
  }
  return daten
}

export async function fatsecretStatus(
  settings: { sync_url: string; sync_key: string },
): Promise<FatSecretStatus> {
  return await ruf(settings, 'status')
}

/**
 * Startet die Freigabe und liefert die Adresse, auf der man sie bei FatSecret
 * erteilt. Zurück kommt der Nutzer über die Edge Function auf `rueckkehr`.
 */
export async function fatsecretVerbinden(
  settings: { sync_url: string; sync_key: string },
  rueckkehr: string,
): Promise<string> {
  const daten = await ruf(settings, 'start', { redirect_to: rueckkehr })
  if (!daten?.authorize_url) throw new FatSecretFehler('unerwartet', 'Der Server hat keine Freigabe-Adresse geliefert.')
  return daten.authorize_url as string
}

export async function fatsecretTrennen(
  settings: { sync_url: string; sync_key: string },
): Promise<void> {
  await ruf(settings, 'disconnect')
}

/**
 * Holt die Tagebücher mehrerer Tage auf einmal.
 * `dates` sind Tage seit dem 1. Januar 1970 (so will es FatSecret, siehe
 * core/fatsecret.ts). Zurück kommt die Rohantwort je Tag – das Auswerten
 * passiert in core/fatsecret.ts, damit es prüfbar bleibt.
 */
export async function fatsecretTagebuch(
  settings: { sync_url: string; sync_key: string },
  dates: number[],
): Promise<Record<string, any>> {
  const daten = await ruf(settings, 'diary', { dates })
  return (daten?.days ?? {}) as Record<string, any>
}
