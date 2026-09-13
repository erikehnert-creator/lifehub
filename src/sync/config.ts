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
export const DEFAULT_SYNC_URL = 'https://smlmywkagudkkbrijpld.supabase.co'
export const DEFAULT_SYNC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtbG15d2thZ3Vka2ticmlqcGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MzE5MzMsImV4cCI6MjEwMzIwNzkzM30.obyaIVYA-E6aTwEtlIvn6uRyUs0p7yYM5Zer_qNGw9I'

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

/**
 * Die öffentliche Adresse der Webfassung (GitHub Pages).
 *
 * Gebraucht wird sie für den Rückweg aus der FatSecret-Freigabe. Läuft LifeHub
 * als Einzeldatei per Doppelklick, ist die eigene Adresse `file:///C:/…` – und
 * dorthin kann kein OAuth-Dienst zurückleiten. `location.origin` ist dann
 * obendrein die Zeichenkette `"null"`, was zusammengesetzt zu einer Adresse
 * wie `null/C:/…` führt; die Edge Function weist sie zu Recht ab.
 *
 * Statt dessen läuft die einmalige Freigabe über die Webfassung. Das Token
 * liegt danach serverseitig bei der Supabase-Anmeldung – nicht im Browser –,
 * deshalb sieht die Einzeldatei die Verbindung anschließend genauso.
 */
export const PUBLIC_APP_URL = 'https://erikehnert-creator.github.io/lifehub/'
