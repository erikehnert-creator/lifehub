/**
 * Server-Verbindung: fest im Build hinterlegt, damit man auf einem neuen Gerät
 * nur noch E-Mail und Passwort eingeben muss – statt Projekt-URL und
 * öffentlichem Schlüssel, die man sonst jedes Mal aus dem Supabase-Dashboard
 * heraussuchen und abtippen müsste.
 *
 * Der "anon public"-Schlüssel ist bewusst nicht geheim (siehe Hinweistext in
 * den Einstellungen): er benennt nur das Projekt, ohne eigene Anmeldung gibt
 * der Server damit trotzdem nichts heraus. Ihn hier fest einzutragen ist für
 * eine Einzelnutzer-App wie diese unbedenklich.
 *
 * Einmalig ausfüllen (Supabase-Projekt → Project Settings → API):
 */
export const DEFAULT_SYNC_URL = ''
export const DEFAULT_SYNC_KEY = ''

/** true, sobald oben eine feste Server-Verbindung hinterlegt wurde. */
export function hasBuiltinSyncDefaults(): boolean {
  return !!DEFAULT_SYNC_URL && !!DEFAULT_SYNC_KEY
}

/**
 * Die tatsächlich zu verwendende Server-Adresse: eine von Hand eingetragene
 * Einstellung geht immer vor (z. B. für einen Test- oder Zweitserver), sonst
 * greift die eingebaute Werkseinstellung.
 */
export function resolvedSyncUrl(settingsUrl: string): string {
  return settingsUrl || DEFAULT_SYNC_URL
}

export function resolvedSyncKey(settingsKey: string): string {
  return settingsKey || DEFAULT_SYNC_KEY
}
