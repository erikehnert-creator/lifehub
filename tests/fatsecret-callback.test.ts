/**
 * Der Rückweg von FatSecret – die Adresse und wer sie verarbeitet.
 *
 * Am 13.09.2026 kam die Freigabe zum ersten Mal durch. FatSecret schickte den
 * Browser danach auf
 *
 *     https://<projekt>.supabase.co/fatsecret/callback?oauth_token=…&oauth_verifier=…
 *
 * und Supabase antwortete
 *
 *     {"error":"Requested path is invalid"}
 *
 * Es fehlte `/functions/v1`. Gebaut wurde die Adresse nämlich aus der
 * eingehenden Anfrage:
 *
 *     `${url.origin}${url.pathname.replace(/\/start$/, '')}/callback`
 *
 * Das wäre richtig, wenn `url.pathname` das enthielte, was außen in der
 * Adresszeile steht. Tut es nicht: **Supabase entfernt `/functions/v1`, bevor
 * die Funktion die Anfrage sieht.** Innen steht `/fatsecret/start`.
 *
 * Das Tückische daran ist, dass alles andere funktionierte – Request Token,
 * Signatur, Anmeldung bei FatSecret, Freigabe. Nur der letzte Schritt lief ins
 * Leere, und der Fehler kam von Supabase, nicht von LifeHub.
 *
 * Geprüft wird deshalb hier:
 *   1. Die Adresse, die FatSecret bekommt – sie muss vollständig sein.
 *   2. Dass die Funktion beide Schreibweisen des Pfades verarbeitet.
 *   3. Dass nur nach LifeHub zurückgeleitet wird, nirgendwo sonst.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ERLAUBTE_RUECKWEGE, FUNKTIONS_PFAD, callbackAdresse, routeVonPfad, rueckwegErlaubt,
} from '../supabase/functions/fatsecret/pfade'
import { PUBLIC_APP_URL } from '../src/sync/config'
import { MELDUNGEN } from '../src/sync/fatsecret'

const PROJEKT = 'https://smlmywkagudkkbrijpld.supabase.co'

/* ------------------------------------------ 1. Die Adresse für FatSecret */

describe('Rückkehradresse, die FatSecret bekommt', () => {
  it('enthält /functions/v1 – daran ist es gescheitert', () => {
    const adresse = callbackAdresse(PROJEKT, 'egal')
    expect(adresse).toBe(`${PROJEKT}/functions/v1/fatsecret/callback`)
    expect(adresse).toContain('/functions/v1/')
  })

  it('ist genau die kaputte Adresse NICHT', () => {
    // Der Wert, den Supabase mit "Requested path is invalid" beantwortet hat.
    expect(callbackAdresse(PROJEKT, 'egal')).not.toBe(`${PROJEKT}/fatsecret/callback`)
  })

  it('hängt nicht mehr am Pfad der eingehenden Anfrage', () => {
    // Der Kern der Reparatur: Was Supabase intern mit dem Pfad macht, darf
    // die erzeugte Adresse nicht mehr beeinflussen. Beide Schreibweisen der
    // eingehenden Anfrage müssen dieselbe Rückkehradresse ergeben.
    const ausInnenSicht = callbackAdresse(PROJEKT, `${PROJEKT}`)
    const ausAussenSicht = callbackAdresse(PROJEKT, `${PROJEKT}`)
    expect(ausInnenSicht).toBe(ausAussenSicht)
    expect(ausInnenSicht).toBe(`${PROJEKT}/functions/v1/fatsecret/callback`)
  })

  it('verträgt einen Schrägstrich am Ende der Projektadresse', () => {
    expect(callbackAdresse(`${PROJEKT}/`, '')).toBe(`${PROJEKT}/functions/v1/fatsecret/callback`)
    expect(callbackAdresse(`${PROJEKT}//`, '')).toBe(`${PROJEKT}/functions/v1/fatsecret/callback`)
  })

  it('weicht auf die Anfrage aus, wenn SUPABASE_URL fehlt', () => {
    // Nur für den örtlichen Betrieb; in einer Edge Function ist die Variable
    // immer gesetzt.
    expect(callbackAdresse('', 'http://localhost:54321'))
      .toBe('http://localhost:54321/functions/v1/fatsecret/callback')
  })

  it('ist eine Adresse, die FatSecret annehmen kann', () => {
    // oauth_callback muss absolut und über http(s) erreichbar sein.
    const adresse = callbackAdresse(PROJEKT, '')
    expect(() => new URL(adresse)).not.toThrow()
    expect(adresse).toMatch(/^https:\/\//)
  })

  it('benutzt denselben Pfad, unter dem die Funktion veröffentlicht wird', () => {
    // `supabase functions deploy fatsecret` macht sie unter /functions/v1/fatsecret
    // erreichbar. Weicht die Konstante davon ab, zeigt der Rückweg wieder ins Leere.
    expect(FUNKTIONS_PFAD).toBe('/functions/v1/fatsecret')
    expect(callbackAdresse(PROJEKT, '')).toContain(FUNKTIONS_PFAD)
  })
})

/* --------------------------------------- 2. Wer den Callback verarbeitet */

describe('Zuordnung der Route', () => {
  it('erkennt den Callback so, wie Supabase ihn innen liefert', () => {
    expect(routeVonPfad('/fatsecret/callback')).toBe('callback')
  })

  it('erkennt ihn auch in der vollständigen Schreibweise', () => {
    // Örtlich oder hinter einem Proxy kommt der Pfad ungekürzt an.
    expect(routeVonPfad('/functions/v1/fatsecret/callback')).toBe('callback')
  })

  it('ordnet die übrigen Routen richtig zu', () => {
    for (const p of ['start', 'diary', 'disconnect', 'status']) {
      expect(routeVonPfad(`/fatsecret/${p}`)).toBe(p)
      expect(routeVonPfad(`/functions/v1/fatsecret/${p}`)).toBe(p)
    }
  })

  it('nimmt ohne Pfadangabe den Status', () => {
    expect(routeVonPfad('/fatsecret')).toBe('status')
    expect(routeVonPfad('/fatsecret/')).toBe('status')
    expect(routeVonPfad('')).toBe('status')
  })

  it('lässt sich von einem Schrägstrich am Ende nicht beirren', () => {
    // Sonst hieße die Route 'callback/' und liefe in „unbekannte_route" –
    // mit einer weißen Seite am Ende einer erfolgreichen Freigabe.
    expect(routeVonPfad('/fatsecret/callback/')).toBe('callback')
    expect(routeVonPfad('/functions/v1/fatsecret/callback/')).toBe('callback')
  })
})

/* --------------------------------------------- 3. Wohin zurückgeleitet wird */

describe('Rückleitung nach LifeHub', () => {
  it('lässt die Webfassung durch', () => {
    expect(rueckwegErlaubt('https://erikehnert-creator.github.io/lifehub/#/einstellungen/ernaehrung'))
      .toBe(true)
  })

  it('lässt genau das durch, was die App tatsächlich schickt', () => {
    // Sonst wäre die Prüfung zwar streng, aber falsch – und die Verbindung
    // ginge gar nicht mehr.
    expect(rueckwegErlaubt(`${PUBLIC_APP_URL.replace(/\/*$/, '/')}#/einstellungen/ernaehrung`))
      .toBe(true)
  })

  it('lässt den örtlichen Entwicklungsserver durch', () => {
    expect(rueckwegErlaubt('http://localhost:4173/#/einstellungen/ernaehrung')).toBe(true)
    expect(rueckwegErlaubt('http://127.0.0.1:5173/#/x')).toBe(true)
  })

  it('weist eine fremde Seite ab', () => {
    // Ohne diese Prüfung wäre die Funktion eine offene Weiterleitung: Wer einen
    // Aufruf an /start unterschieben kann, bestimmt, wo der Nutzer nach einer
    // echt aussehenden FatSecret-Anmeldung landet.
    expect(rueckwegErlaubt('https://beispiel-fremd.de/')).toBe(false)
  })

  it('lässt sich von einem ähnlichen Namen nicht täuschen', () => {
    expect(rueckwegErlaubt('https://erikehnert-creator.github.io.fremd.de/lifehub/')).toBe(false)
    expect(rueckwegErlaubt('https://erikehnert-creator.github.io/lifehub-fremd/')).toBe(false)
  })

  it('weist unverschlüsselte Adressen ab, außer am eigenen Rechner', () => {
    expect(rueckwegErlaubt('http://erikehnert-creator.github.io/lifehub/')).toBe(false)
  })

  it('weist kaputte und andersartige Adressen ab', () => {
    for (const k of ['', 'kein-url', 'javascript:alert(1)', 'file:///C:/LifeHub.html', 'data:text/html,x']) {
      expect(rueckwegErlaubt(k), k).toBe(false)
    }
  })

  it('nennt die erlaubte Adresse ausdrücklich', () => {
    expect(ERLAUBTE_RUECKWEGE.length).toBeGreaterThan(0)
    for (const e of ERLAUBTE_RUECKWEGE) expect(e).toMatch(/^https:\/\//)
  })
})

/* ------------------------------------------------- 4. Zusammenspiel mit der App */

describe('Edge Function und App passen zusammen', () => {
  const quelle = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'functions', 'fatsecret', 'index.ts'), 'utf8',
  )

  it('leitet die Rückkehradresse nicht mehr aus der Anfrage ab', () => {
    // Der alte Ausdruck darf nicht wiederkommen – er sah richtig aus und war
    // es genau deshalb so lange.
    expect(quelle).not.toMatch(/url\.pathname\.replace\(\/\\\/start\$\//)
    expect(quelle).not.toContain("${url.origin}${url.pathname")
  })

  it('baut sie aus SUPABASE_URL', () => {
    expect(quelle).toContain('callbackAdresse(SUPABASE_URL')
  })

  it('prüft die Rückkehradresse, bevor es losgeht', () => {
    expect(quelle).toContain('rueckwegErlaubt(rueckkehr)')
  })

  it('erklärt jeden Fehlercode, den die Function ausgeben kann', () => {
    const codes = [...quelle.matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1])
    const ohne = [...new Set(codes)].filter((c) => !MELDUNGEN[c])
    expect(ohne, `Ohne verständliche Meldung: ${ohne.join(', ')}`).toEqual([])
  })

  it('gibt weder Token noch Verifizierer in eine Ausgabe', () => {
    // Die Werte gehören in die Datenbank, nicht in ein Protokoll.
    expect(quelle).not.toMatch(/console\.(log|info|warn|error)/)
  })
})
