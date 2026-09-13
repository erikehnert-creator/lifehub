/**
 * Der Weg in die FatSecret-Verbindung – besonders von der PC-Einzeldatei aus.
 *
 * Die Nährwert-Rechnerei steht in `fatsecret.test.ts`. Hier geht es um das
 * Drumherum, an dem die Verbindung bisher gescheitert ist:
 *
 *   - `location.origin` ist bei `file://` die Zeichenkette `"null"`. Wer
 *     `origin + pathname` zusammensetzt, schickt `null/C:/…/LifeHub.html` als
 *     Rückkehradresse los. Die Edge Function nimmt nur http(s) an und lehnt
 *     zu Recht ab – aus der PC-Fassung war die Verbindung damit unmöglich.
 *   - Und wenn etwas schiefgeht, soll dort ein Satz stehen, mit dem Erik etwas
 *     anfangen kann, kein HTTP-Code.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { oauthRueckweg } from '../src/core/fatsecret'
import { MELDUNGEN, feinerCode } from '../src/sync/fatsecret'
import { PUBLIC_APP_URL } from '../src/sync/config'

const WEB = 'https://erikehnert-creator.github.io/lifehub/'

describe('Rückweg aus der FatSecret-Freigabe', () => {
  it('bleibt auf der Seite, wenn LifeHub über https läuft', () => {
    const r = oauthRueckweg(
      { protocol: 'https:', origin: 'https://erikehnert-creator.github.io', pathname: '/lifehub/' },
      WEB,
    )
    expect(r.ueberWeb).toBe(false)
    expect(r.url).toBe('https://erikehnert-creator.github.io/lifehub/#/einstellungen/ernaehrung')
  })

  it('geht auch bei einem lokalen http-Server nicht über den Umweg', () => {
    const r = oauthRueckweg({ protocol: 'http:', origin: 'http://127.0.0.1:4173', pathname: '/' }, WEB)
    expect(r.ueberWeb).toBe(false)
    expect(r.url).toBe('http://127.0.0.1:4173/#/einstellungen/ernaehrung')
  })

  it('nimmt bei file:// die Webadresse statt der Festplatte', () => {
    // Genau der Fall, der bisher „redirect_to fehlt" ergab.
    const r = oauthRueckweg(
      { protocol: 'file:', origin: 'null', pathname: '/C:/Users/triva/OneDrive/LifeHub.html' },
      WEB,
    )
    expect(r.ueberWeb).toBe(true)
    expect(r.url).toBe('https://erikehnert-creator.github.io/lifehub/#/einstellungen/ernaehrung')
  })

  it('schickt niemals eine file://-Adresse oder einen Windows-Pfad los', () => {
    const r = oauthRueckweg(
      { protocol: 'file:', origin: 'null', pathname: '/C:/Users/triva/Dokumente/LifeHub.html' },
      WEB,
    )
    expect(r.url).not.toContain('file:')
    expect(r.url).not.toContain('C:')
    expect(r.url).not.toContain('null')
    expect(r.url).not.toContain('Users')
  })

  it('liefert immer eine Adresse, die die Edge Function annimmt', () => {
    // Die Function prüft /^https?:\/\//. Alles andere lehnt sie ab.
    const faelle = [
      { protocol: 'file:', origin: 'null', pathname: '/C:/x/LifeHub.html' },
      { protocol: 'https:', origin: 'https://a.de', pathname: '/b/' },
      { protocol: 'http:', origin: 'http://localhost:5173', pathname: '/' },
      { protocol: '', origin: '', pathname: '' },
    ]
    for (const f of faelle) expect(oauthRueckweg(f, WEB).url).toMatch(/^https?:\/\//)
  })

  it('setzt genau einen Schrägstrich, egal wie die Webadresse geschrieben ist', () => {
    const ort = { protocol: 'file:', origin: 'null', pathname: '/x.html' }
    for (const basis of [
      'https://erikehnert-creator.github.io/lifehub',
      'https://erikehnert-creator.github.io/lifehub/',
      'https://erikehnert-creator.github.io/lifehub//',
    ]) {
      expect(oauthRueckweg(ort, basis).url)
        .toBe('https://erikehnert-creator.github.io/lifehub/#/einstellungen/ernaehrung')
    }
  })

  it('nutzt die tatsächlich eingebaute Webadresse', () => {
    // Sonst prüften die Tests oben eine Adresse, die die App gar nicht kennt.
    expect(PUBLIC_APP_URL).toMatch(/^https:\/\//)
    expect(oauthRueckweg({ protocol: 'file:', origin: 'null', pathname: '/x' }, PUBLIC_APP_URL).url)
      .toContain(PUBLIC_APP_URL.replace(/\/*$/, '/'))
  })
})

describe('Fehlerfälle in verständlichen Sätzen', () => {
  const faelle: [string, RegExp][] = [
    ['nicht_eingerichtet', /Zugangsdaten/],
    ['nicht_veroeffentlicht', /veröffentlicht/],
    ['nicht_angemeldet', /angemeldet/],
    ['nicht_verbunden', /kein Konto verbunden/],
    ['anmeldung_abgelaufen', /neu verbinden/],
    ['nicht_erreichbar', /nicht erreichbar/],
    ['serverfehler', /schiefgegangen/],
    ['unbekannte_route', /neu veröffentlichen/],
    ['kein_tagebuchzugriff', /3-Legged OAuth/],
  ]

  it.each(faelle)('%s wird erklärt', (code, muster) => {
    expect(MELDUNGEN[code], `Für ${code} fehlt eine Meldung`).toBeTruthy()
    expect(MELDUNGEN[code]).toMatch(muster)
  })

  it('nennt in keiner Meldung einen HTTP- oder Postgres-Code', () => {
    for (const [code, text] of Object.entries(MELDUNGEN)) {
      expect(text, code).not.toMatch(/\b(4\d\d|5\d\d|22P02|OAuth-?1\.0 signature)\b/)
    }
  })

  it('deckt jeden Fehlercode ab, den die Edge Function ausgibt', () => {
    // Direkt aus der Funktion gelesen: Ein neuer Code dort ohne Meldung hier
    // ergäbe in der Oberfläche wieder „FatSecret: 400 Bad Request".
    const quelle = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'functions', 'fatsecret', 'index.ts'), 'utf8',
    )
    const codes = [...quelle.matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(codes.length).toBeGreaterThan(4)
    const ohne = [...new Set(codes)].filter((c) => !MELDUNGEN[c])
    expect(ohne, `Ohne verständliche Meldung: ${ohne.join(', ')}`).toEqual([])
  })

  it('erkennt „darf nicht" und verwechselt es nicht mit „kaputt"', () => {
    expect(feinerCode('fatsecret', 'Invalid scope: premier required')).toBe('kein_tagebuchzugriff')
    expect(feinerCode('fatsecret', 'User is not authorized to perform this action'))
      .toBe('kein_tagebuchzugriff')
    expect(feinerCode('fatsecret', 'Invalid method: food_entries.get.v2')).toBe('kein_tagebuchzugriff')
  })

  it('lässt andere FatSecret-Fehler in Ruhe', () => {
    expect(feinerCode('fatsecret', 'Missing required oauth parameter')).toBe('fatsecret')
    expect(feinerCode('anmeldung_abgelaufen', 'egal')).toBe('anmeldung_abgelaufen')
  })
})

describe('Was im Browser landet', () => {
  it('enthält kein Consumer Secret im Client-Code', () => {
    // Der ganze Sinn der Edge Function: Das Geheimnis bleibt auf dem Server.
    // Diese Prüfung schlägt an, falls jemand es „nur zum Testen" hereinnimmt.
    const dateien = ['src/sync/fatsecret.ts', 'src/core/fatsecret.ts', 'src/state/ernaehrung.ts']
    for (const d of dateien) {
      const text = fs.readFileSync(path.join(__dirname, '..', d), 'utf8')
      expect(text, d).not.toMatch(/CONSUMER_SECRET\s*=\s*['"][^'"]/)
      expect(text, d).not.toMatch(/oauth_consumer_secret/i)
      expect(text, d).not.toMatch(/oauth_signature\s*[=:]/i)
    }
  })

  it('trägt auch in der fertigen Einzeldatei kein Geheimnis mit sich', () => {
    // Der Quelltext allein reicht als Nachweis nicht: Ausgeliefert wird die
    // gebaute Datei, und die ist es, die Erik per Doppelklick öffnet und im
    // Zweifel weitergibt.
    const datei = path.join(__dirname, '..', 'LifeHub.html')
    if (!fs.existsSync(datei)) return          // vor dem ersten Build
    const text = fs.readFileSync(datei, 'utf8')
    for (const verboten of [
      'FATSECRET_CONSUMER_SECRET',
      'oauth_consumer_secret',
      'oauth_token_secret',
    ]) {
      expect(text.includes(verboten), `"${verboten}" steht in LifeHub.html`).toBe(false)
    }
  })

  it('spricht ausschließlich mit der eigenen Edge Function', () => {
    // Ein direkter Aufruf von platform.fatsecret.com aus dem Browser ginge nur
    // mit dem Consumer Secret im Bündel – genau das soll nicht passieren.
    const text = fs.readFileSync(path.join(__dirname, '..', 'src/sync/fatsecret.ts'), 'utf8')
    expect(text).not.toContain('platform.fatsecret.com')
    expect(text).not.toContain('authentication.fatsecret.com')
    expect(text).toContain('/functions/v1/fatsecret')
  })
})
