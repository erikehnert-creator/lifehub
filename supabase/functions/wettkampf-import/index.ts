/**
 * Wettkampfprotokolle einlesen: PDF hinein, Vorschläge heraus.
 *
 * ---------------------------------------------------------------------------
 * Warum das hier läuft und nicht im Bündel
 *
 * `LifeHub.html` liegt bei rund 2 MB. Eine PDF-Bibliothek brächte etwa ein
 * weiteres MB mit – auf jedem Seitenaufruf, auch bei den 364 Tagen im Jahr,
 * an denen niemand ein Protokoll importiert. Der Import ist ohnehin kein
 * Offline-Vorgang: Die Protokolle kommen aus dem Netz.
 *
 * Es ist dasselbe Muster wie beim Schlafimport – Edge Function als Transport
 * plus Extraktion, die fachliche Logik daneben in einer reinen Datei
 * (`protokoll.ts`), die sich aus den Tests laden lässt.
 *
 * ---------------------------------------------------------------------------
 * Das Sicherheitsmodell
 *
 * Anders als beim Schlafimport trägt die Anfrage hier ein **echtes
 * Supabase-Anmeldetoken**: Sie kommt aus LifeHub selbst, wo Erik ohnehin
 * angemeldet ist. Deshalb wird diese Funktion MIT JWT-Prüfung
 * veröffentlicht – Supabase weist eine Anfrage ohne gültiges Token ab, bevor
 * sie hier ankommt. Es gibt kein Importtoken und keinen offenen Endpunkt.
 *
 * Der **Dienstschlüssel wird nicht gebraucht und nicht gelesen**: Diese
 * Funktion schreibt nichts in die Datenbank. Sie gibt Vorschläge zurück;
 * gespeichert wird erst in LifeHub, nach ausdrücklicher Bestätigung, über den
 * gewöhnlichen Weg mit der Zeilensicherheit des angemeldeten Kontos.
 *
 * Die PDF wird **nicht abgelegt**. Sie lebt für die Dauer der Anfrage im
 * Arbeitsspeicher und ist danach weg.
 *
 * Was NICHT protokolliert wird: die PDF, ihr Inhalt, Namen, Vereine,
 * Jahrgänge, Noten. Im Protokoll stehen nur Seitenzahl, Teilnehmerzahl und
 * Dauer.
 *
 * ---------------------------------------------------------------------------
 * Veröffentlichen (ein Push reicht NICHT):
 *
 *   npx supabase functions deploy wettkampf-import
 *
 * **Ohne** `--no-verify-jwt`, im Gegensatz zu `schlaf` – siehe oben.
 */
// unpdf bringt eine für Server und Edge gebaute Fassung von pdf.js mit und
// läuft in Deno ohne Zutun. Die Version steht fest: Ein stillschweigender
// Sprung auf eine neue Hauptversion würde die Textextraktion ändern, und die
// Deutung hängt an deren Koordinaten.
import { getDocumentProxy } from 'npm:unpdf@1.8.1'
import {
  parseProtokoll, ProtokollFehler, FEHLERTEXTE,
  type TextStueck,
} from './protokoll.ts'

/**
 * Die Obergrenze für eine hochgeladene PDF.
 *
 * Das Beispielprotokoll mit zwölf Seiten wiegt 1,2 MB. Acht MB lassen viel
 * Luft für ein Protokoll mit hundert Seiten und sind zugleich klein genug,
 * dass eine versehentlich gewählte Videodatei sofort abprallt, statt den
 * Arbeitsspeicher der Funktion zu füllen.
 */
const HOECHSTGROESSE = 8 * 1024 * 1024

/** Mehr Seiten liest LifeHub nicht – darunter liegt kein Wettkampfprotokoll mehr. */
const HOECHSTSEITEN = 200

const KOPF = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const antwort = (status: number, rumpf: unknown) =>
  new Response(JSON.stringify(rumpf), { status, headers: KOPF })

const fehler = (status: number, code: string, text: string) =>
  antwort(status, { ok: false, code, message: text })

/** Fängt die PDF-Signatur ab, bevor irgendetwas geparst wird. */
function siehtWiePdfAus(bytes: Uint8Array): boolean {
  // %PDF-
  return bytes.length > 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
    && bytes[3] === 0x46 && bytes[4] === 0x2d
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: KOPF })
  if (req.method !== 'POST') return fehler(405, 'methode', 'Nur POST.')

  const begonnen = Date.now()
  let bytes: Uint8Array

  /* ------------------------------------------------ Datei entgegennehmen */
  try {
    const typ = req.headers.get('content-type') ?? ''
    if (typ.includes('multipart/form-data')) {
      const form = await req.formData()
      const datei = form.get('datei')
      if (!(datei instanceof File)) {
        return fehler(400, 'keine_datei', 'Es wurde keine Datei mitgeschickt.')
      }
      if (datei.size > HOECHSTGROESSE) {
        return fehler(413, 'zu_gross',
          `Die Datei ist ${(datei.size / 1024 / 1024).toFixed(1)} MB gross. Mehr als ${HOECHSTGROESSE / 1024 / 1024} MB nimmt LifeHub nicht an.`)
      }
      bytes = new Uint8Array(await datei.arrayBuffer())
    } else {
      const roh = await req.arrayBuffer()
      if (roh.byteLength > HOECHSTGROESSE) {
        return fehler(413, 'zu_gross',
          `Die Datei ist ${(roh.byteLength / 1024 / 1024).toFixed(1)} MB gross. Mehr als ${HOECHSTGROESSE / 1024 / 1024} MB nimmt LifeHub nicht an.`)
      }
      bytes = new Uint8Array(roh)
    }
  } catch {
    return fehler(400, 'unlesbar', 'Die Anfrage liess sich nicht lesen.')
  }

  if (!bytes.length) return fehler(400, 'keine_datei', 'Es wurde keine Datei mitgeschickt.')
  if (!siehtWiePdfAus(bytes)) {
    return fehler(415, 'keine_pdf', 'Das ist keine PDF-Datei.')
  }

  /* ------------------------------------------------------ Text herausholen */
  let seiten: TextStueck[][]
  let geleseneSeiten = 0
  const extrahiertAb = Date.now()
  try {
    const pdf = await getDocumentProxy(bytes)
    geleseneSeiten = pdf.numPages
    if (geleseneSeiten > HOECHSTSEITEN) {
      return fehler(413, 'zu_viele_seiten',
        `Die PDF hat ${geleseneSeiten} Seiten. LifeHub liest höchstens ${HOECHSTSEITEN}.`)
    }
    seiten = []
    for (let s = 1; s <= geleseneSeiten; s++) {
      const seite = await pdf.getPage(s)
      const inhalt = await seite.getTextContent()
      seiten.push(inhalt.items
        .filter((i: any) => typeof i.str === 'string' && i.str.trim())
        .map((i: any) => ({
          text: i.str.trim(),
          x: Math.round(i.transform[4]),
          y: Math.round(i.transform[5]),
        })))
    }
  } catch (e) {
    // Absichtlich ohne den Inhalt der Datei im Text: Eine kaputte PDF soll
    // nicht halb im Protokoll landen.
    console.error('PDF nicht lesbar:', (e as Error)?.name ?? 'Fehler')
    return fehler(422, 'pdf_kaputt', 'Diese PDF liess sich nicht öffnen. Möglicherweise ist sie beschädigt oder verschlüsselt.')
  }
  const extrahiert = Date.now() - extrahiertAb

  if (!seiten.some((s) => s.length)) {
    return fehler(422, 'keine_textebene', FEHLERTEXTE.keine_textebene)
  }

  /* ------------------------------------------------------------- Deuten */
  const geparstAb = Date.now()
  try {
    const ergebnis = parseProtokoll(seiten)
    const geparst = Date.now() - geparstAb

    console.log(`Protokoll gelesen: ${ergebnis.seiten} Seiten, ${ergebnis.teilnehmer.length} Teilnehmer, `
      + `${extrahiert} ms Text, ${geparst} ms Deutung, ${Date.now() - begonnen} ms gesamt`)

    return antwort(200, {
      ok: true,
      ...ergebnis,
      dauer: { extrahiert, geparst, gesamt: Date.now() - begonnen },
    })
  } catch (e) {
    if (e instanceof ProtokollFehler) {
      console.log(`Protokoll abgelehnt: ${e.code}`)
      return fehler(422, e.code, e.message)
    }
    console.error('Unerwarteter Fehler beim Deuten:', (e as Error)?.name ?? 'Fehler')
    return fehler(500, 'unerwartet', 'Beim Lesen des Protokolls ist etwas schiefgegangen.')
  }
})
