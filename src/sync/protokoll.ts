/**
 * Ein Wettkampfprotokoll zur Edge Function schicken.
 *
 * Reiner Transport – dieselbe Bauart wie `fatsecret.ts`: Zugangstoken holen,
 * Anfrage stellen, Antwort deuten, Netzwerkfehler in Sätze übersetzen, die
 * jemandem weiterhelfen.
 *
 * Die PDF verlässt das Gerät nur für die Dauer dieser einen Anfrage. Die
 * Funktion legt sie nirgends ab und schreibt nichts in die Datenbank – sie
 * gibt Vorschläge zurück (siehe supabase/functions/wettkampf-import/index.ts).
 */
import { accessToken } from './auth'
import { resolvedSyncUrl, resolvedSyncKey } from './config'
import type { ImportAntwort } from '../core/turnen/protokollImport'

/**
 * Was LifeHub gar nicht erst abschickt.
 *
 * Dieselbe Grenze wie in der Funktion. Sie hier ein zweites Mal zu prüfen
 * spart bei einer versehentlich gewählten Videodatei den ganzen Upload –
 * und sagt es sofort statt nach einer Minute.
 */
export const HOECHSTGROESSE = 8 * 1024 * 1024

export class ImportFehler extends Error {
  constructor(public code: string, text: string) {
    super(text)
    this.name = 'ImportFehler'
  }
}

/** Eine Datei, bevor sie das Gerät verlässt. */
export function pruefeDatei(datei: File): ImportFehler | null {
  if (datei.size > HOECHSTGROESSE) {
    return new ImportFehler('zu_gross',
      `Die Datei ist ${(datei.size / 1024 / 1024).toFixed(1)} MB gross. `
      + `LifeHub nimmt höchstens ${HOECHSTGROESSE / 1024 / 1024} MB an.`)
  }
  if (!datei.size) {
    return new ImportFehler('keine_datei', 'Die Datei ist leer.')
  }
  // Der Dateityp des Browsers ist nur ein Hinweis; die Funktion prüft
  // zusätzlich die PDF-Signatur. Hier geht es darum, den offensichtlichen
  // Fehlgriff sofort zu melden.
  const endung = datei.name.toLowerCase().endsWith('.pdf')
  if (datei.type && datei.type !== 'application/pdf' && !endung) {
    return new ImportFehler('keine_pdf', 'Das ist keine PDF-Datei.')
  }
  return null
}

function basisUrl(settingsUrl: string): string {
  return `${resolvedSyncUrl(settingsUrl).replace(/\/+$/, '')}/functions/v1/wettkampf-import`
}

/**
 * Das Protokoll hochladen und die Vorschläge holen.
 *
 * Wirft `ImportFehler` mit einem Code, den die Oberfläche anzeigen kann:
 * `nicht_angemeldet`, `nicht_erreichbar`, `nicht_veroeffentlicht`, plus die
 * Codes der Funktion (`keine_pdf`, `zu_gross`, `keine_textebene`,
 * `format_unbekannt`, `keine_teilnehmer`, `pdf_kaputt`).
 */
export async function ladeProtokoll(
  settings: { sync_url: string; sync_key: string },
  datei: File,
): Promise<ImportAntwort> {
  const vorab = pruefeDatei(datei)
  if (vorab) throw vorab

  const url = resolvedSyncUrl(settings.sync_url)
  const key = resolvedSyncKey(settings.sync_key)
  if (!url || !key) {
    throw new ImportFehler('nicht_angemeldet',
      'Für den Import wird die Serververbindung gebraucht. Melde dich unter Einstellungen → Synchronisation an.')
  }
  const token = await accessToken(url, key)
  if (!token) {
    throw new ImportFehler('nicht_angemeldet',
      'Nicht angemeldet. Melde dich unter Einstellungen → Synchronisation an.')
  }

  const form = new FormData()
  form.append('datei', datei, datei.name)

  let res: Response
  try {
    res = await fetch(basisUrl(settings.sync_url), {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        // Content-Type setzt der Browser selbst - mit der Grenzkennung des
        // Formulars. Von Hand gesetzt fehlte sie, und der Server faende keine
        // Datei.
      },
      body: form,
    })
  } catch {
    throw new ImportFehler('nicht_erreichbar',
      'Der Server ist nicht erreichbar. Der Import braucht eine Verbindung – gespeichert wird danach wieder auf dem Gerät.')
  }

  if (res.status === 404) {
    throw new ImportFehler('nicht_veroeffentlicht',
      'Die Importfunktion ist auf dem Server noch nicht veröffentlicht. '
      + 'Einmal `npx supabase functions deploy wettkampf-import` ausführen.')
  }

  const text = await res.text()
  let daten: any = null
  try { daten = JSON.parse(text) } catch { /* unten behandelt */ }

  if (!res.ok || !daten?.ok) {
    throw new ImportFehler(
      daten?.code ?? 'unerwartet',
      daten?.message ?? `Der Server hat den Import abgelehnt (${res.status}).`,
    )
  }
  return daten as ImportAntwort
}
