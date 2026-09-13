/**
 * Die HTTP-Methoden der drei OAuth-Schritte.
 *
 * Am 13.09.2026 kam beim ersten echten Verbindungsversuch nur
 *
 *     FatSecret 400: Invalid signature
 *
 * Die Signatur war rechnerisch einwandfrei. Falsch war die Methode: FatSecret
 * verlangt für `oauth/request_token` ausdrücklich POST, gesendet wurde GET –
 * `oauthRequest()` hatte `method?:` mit `?? 'GET'` als Vorgabewert, und der
 * Aufruf in `starten()` gab nichts an.
 *
 * Das ist deshalb so schwer zu finden, weil die Methode der ERSTE Teil der
 * Signaturbasis ist (`METHOD&url&params`). Eine falsche Methode ergibt keine
 * Meldung über die Methode, sondern eine falsche Signatur – man sucht dann beim
 * Schlüssel, beim Encoding oder bei der Uhrzeit. Nachgerechnet: dieselben Daten
 * einmal mit POST und einmal mit GET signiert ergeben
 * `tnnArxj06cWHq44gCs1OSKk/jLY=` gegen `OgeXpQpLHCLpVVnrQjAwHmPrU7c=`.
 *
 * Die Edge Function läuft in Deno und wird von `npx tsc --noEmit` nicht erfasst
 * (`tsconfig.json` kennt nur `src` und `tests`). Ein Tippfehler dort fällt sonst
 * erst beim Veröffentlichen auf – oder eben gar nicht. Deshalb liest dieser Test
 * die Datei und rechnet nach, welche Adresse mit welcher Methode aufgerufen wird.
 *
 * Quelle der Sollwerte (Stand 13.09.2026):
 * https://platform.fatsecret.com/docs/guides/authentication/oauth1/three-legged
 *   request_token  „This API supports HTTP method POST."
 *   access_token   „This API supports HTTP method GET."
 */
import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const QUELLE = path.join(__dirname, '..', 'supabase', 'functions', 'fatsecret', 'index.ts')

interface Aufruf {
  /** Der Name der Adress-Konstanten, z. B. FATSECRET_REQUEST_TOKEN. */
  ziel: string
  /** Die Methode, die dieser Aufruf mitgibt – null, wenn er keine mitgibt. */
  method: string | null
  /** Die Parameternamen, die mitsigniert werden. */
  params: string[]
}

/**
 * Alle `oauthRequest({ … })`-Aufrufe aus der Datei holen.
 *
 * Geklammert statt zeilenweise gelesen, und mit Tiefenzählung: Der Aufruf an die
 * FatSecret-API enthält ein `params: { method: 'food_entries.get.v2', … }`.
 * Dieses `method` ist ein FatSecret-Methodenname, nicht die HTTP-Methode. Ein
 * Leser, der nur nach `method:` sucht, verwechselt beide und hielte den Aufruf
 * für versorgt – der Test wäre dann grün und bedeutungslos.
 */
function aufrufe(): Aufruf[] {
  const text = fs.readFileSync(QUELLE, 'utf8')
  const out: Aufruf[] = []
  const start = /oauthRequest\(\{/g

  for (let m = start.exec(text); m; m = start.exec(text)) {
    let tiefe = 1
    let i = m.index + m[0].length
    const von = i
    for (; i < text.length && tiefe > 0; i++) {
      if (text[i] === '{') tiefe++
      else if (text[i] === '}') tiefe--
    }
    const rumpf = text.slice(von, i - 1)

    // Nur die oberste Ebene des Aufrufobjekts ansehen.
    let ebene = 0
    let obersteEbene = ''
    for (const c of rumpf) {
      if (c === '{' || c === '[') ebene++
      else if (c === '}' || c === ']') ebene--
      else if (ebene === 0) obersteEbene += c
    }

    out.push({
      ziel: obersteEbene.match(/url:\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? '(unbekannt)',
      method: obersteEbene.match(/method:\s*'(GET|POST)'/)?.[1] ?? null,
      params: [...rumpf.matchAll(/\b(oauth_callback|oauth_verifier)\b/g)].map((x) => x[1]),
    })
  }
  return out
}

/** Was FatSecret laut Dokumentation je Adresse verlangt. */
const SOLL: Record<string, 'GET' | 'POST'> = {
  FATSECRET_REQUEST_TOKEN: 'POST',
  FATSECRET_ACCESS_TOKEN: 'GET',
  FATSECRET_API: 'GET',
}

describe('OAuth-Methoden der Edge Function', () => {
  let gefunden: Aufruf[]
  let quelltext: string

  beforeAll(() => {
    gefunden = aufrufe()
    quelltext = fs.readFileSync(QUELLE, 'utf8')
  })

  it('findet überhaupt alle drei signierten Aufrufe', () => {
    // Absicherung gegen einen Test, der still nichts mehr prüft, weil der
    // Aufbau der Datei sich geändert hat und der Leser leer ausgeht.
    expect(gefunden.length).toBe(3)
    expect(gefunden.map((a) => a.ziel).sort()).toEqual([
      'FATSECRET_ACCESS_TOKEN', 'FATSECRET_API', 'FATSECRET_REQUEST_TOKEN',
    ])
  })

  it('gibt bei JEDEM signierten Aufruf eine Methode ausdrücklich an', () => {
    const ohne = gefunden.filter((a) => a.method === null).map((a) => a.ziel)
    expect(
      ohne,
      `Ohne ausdrückliche HTTP-Methode: ${ohne.join(', ')} – dann entscheidet ein `
      + 'Vorgabewert, und FatSecret antwortet nur mit "Invalid signature".',
    ).toEqual([])
  })

  it.each(Object.entries(SOLL))('%s wird mit %s aufgerufen', (ziel, soll) => {
    const a = gefunden.find((x) => x.ziel === ziel)
    expect(a, `Kein oauthRequest-Aufruf für ${ziel} gefunden`).toBeTruthy()
    expect(a!.method, `${ziel} muss ${soll} verwenden (FatSecret-Doku)`).toBe(soll)
  })

  it('signiert request_token niemals wieder mit GET', () => {
    // Der Fehler vom 13.09.2026, ausdrücklich benannt.
    const rt = gefunden.find((a) => a.ziel === 'FATSECRET_REQUEST_TOKEN')!
    expect(rt.method).not.toBe('GET')
    expect(rt.method).toBe('POST')
  })

  it('lässt die Methode nicht mehr auf einen Vorgabewert zurückfallen', () => {
    // Solange `method` Pflicht ist, kann ein neuer Aufruf sie nicht vergessen.
    expect(quelltext).not.toMatch(/method\?\s*:\s*'GET'\s*\|\s*'POST'/)
    expect(quelltext).not.toMatch(/opts\.method\s*\?\?/)
    expect(quelltext).toMatch(/^\s*method: 'GET' \| 'POST'$/m)
  })
})

describe('Aufbau der Signatur', () => {
  let quelltext: string
  beforeAll(() => { quelltext = fs.readFileSync(QUELLE, 'utf8') })

  it('nimmt für Basis-String und Versand dieselbe Methode', () => {
    // Der eigentliche Schutz gegen die ganze Fehlerklasse: Es gibt nur EINE
    // Variable. Zwei getrennte Werte könnten auseinanderlaufen, und dann wäre
    // die Signatur für eine andere Methode berechnet als die gesendete.
    expect(quelltext).toMatch(/const basis = \[method, enc\(opts\.url\), enc\(normalisiert\)\]/)
    expect(quelltext).toMatch(/const res = method === 'GET'/)
  })

  it('sortiert die Parameter und kodiert sie einzeln', () => {
    expect(quelltext).toMatch(/Object\.keys\(alle\)\s*\n?\s*\.sort\(\)/)
  })

  it('kodiert auch ! * \' ( ) – sonst stimmt die Signatur nicht', () => {
    expect(quelltext).toMatch(/\/\[!\*'\(\)\]\/g/)
  })

  it('baut den Signaturschlüssel aus beiden Geheimnissen', () => {
    expect(quelltext).toMatch(
      /const schluessel = `\$\{enc\(opts\.consumerSecret\)\}&\$\{enc\(opts\.tokenSecret \?\? ''\)\}`/,
    )
  })

  it('nimmt die Signatur selbst nicht in den Basis-String auf', () => {
    // oauth_signature wird NACH dem Basis-String gesetzt.
    const basisZeile = quelltext.indexOf('const basis = [method')
    const signaturZeile = quelltext.indexOf('alle.oauth_signature =')
    expect(basisZeile).toBeGreaterThan(0)
    expect(signaturZeile).toBeGreaterThan(basisZeile)
  })

  it('signiert oauth_callback mit und oauth_verifier auch', () => {
    // Beide gehen in die Signatur ein; fehlt einer, ist sie ungültig.
    const rt = aufrufe().find((a) => a.ziel === 'FATSECRET_REQUEST_TOKEN')!
    expect(rt.params).toContain('oauth_callback')
    const at = aufrufe().find((a) => a.ziel === 'FATSECRET_ACCESS_TOKEN')!
    expect(at.params).toContain('oauth_verifier')
  })

  it('ruft die Freigabeseite unsigniert auf, nur mit dem oauth_token', () => {
    // Schritt 2 ist ein gewöhnlicher Browser-Aufruf – dort wird nicht signiert.
    expect(quelltext).toMatch(/\$\{FATSECRET_AUTHORIZE\}\?oauth_token=\$\{enc\(p\.oauth_token\)\}/)
  })
})
