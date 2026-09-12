/**
 * Die Heute-Seite auf dem Handy – gemessen, nicht geschätzt.
 *
 * Die eigentliche Anforderung lautet: „Auf dem Smartphone darf man nicht erst
 * nach unten scrollen müssen, um die heutigen Termine zu sehen." Das ist eine
 * Aussage über Pixel, und Pixel kann man nachrechnen. Deshalb legt dieser Test
 * einen echten Termin für heute an und misst danach, wo er auf einem 390×844
 * großen Bildschirm tatsächlich steht.
 *
 * Aufruf:  node tests/heute-mobil-e2e.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, 'LifeHub.html').replace(/\\/g, '/')

let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
  if (bedingung) console.log(`  OK   ${name} ${zusatz}`)
  else { console.log(`  FEHL ${name} ${zusatz}`); fehler++ }
}

async function warteAuf(page, fn, ms = 40000, was = 'Bedingung') {
  const bis = Date.now() + ms
  for (;;) {
    if (await page.evaluate(fn)) return true
    if (Date.now() > bis) { console.log(`  ! Zeitüberschreitung: ${was}`); return false }
    await page.waitForTimeout(250)
  }
}

const HAT_APP = () => !!document.querySelector('.page')

async function main() {
  const browser = await chromium.launch()
  // iPhone 13/14 in Standardgröße – das Gerät, auf dem es zählt.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })

  const konsolenfehler = []
  page.on('console', (m) => { if (m.type() === 'error') konsolenfehler.push(m.text()) })
  page.on('pageerror', (e) => konsolenfehler.push(String(e)))

  console.log('\n=== Heute-Seite auf dem Handy ===\n')
  await page.goto(DATEI)
  await warteAuf(page, HAT_APP, 60000, 'App startet')

  /* -------------------------------------------- 1. Zwei Termine für heute */
  for (const [titel, von, bis, ort] of [
    ['Zahnarzt Dr. Sommer', '09:30', '10:15', 'Altenberger Str. 4'],
    ['Schicht-Übergabe GMT', '14:00', '14:30', 'Werkstatt'],
  ]) {
    await page.locator('.fab, button:has-text("+ Erfassen")').first().click()
    await page.waitForTimeout(400)
    await page.locator('button:has-text("Termin")').first().click()
    await page.waitForTimeout(400)
    await page.locator('.modal input.input').first().fill(titel)
    const zeiten = page.locator('.modal input[type=time]')
    if (await zeiten.count() >= 2) {
      await zeiten.nth(0).fill(von)
      await zeiten.nth(1).fill(bis)
    }
    // „Ort" ist das letzte Textfeld des Formulars – Datum und Uhrzeiten haben
    // eigene Eingabearten und fallen deshalb heraus.
    await page.locator('.modal input.input:not([type=date]):not([type=time])').last().fill(ort)
    await page.locator('.modal button:has-text("Termin erstellen")').first().click()
    await page.waitForTimeout(900)
  }

  await page.goto(DATEI + '#/heute')
  await page.reload()
  await warteAuf(page, HAT_APP, 60000, 'Heute-Seite')
  await page.waitForTimeout(1500)

  /* ---------------------------------------- 2. Ist das Band überhaupt da? */
  const hatBand = await page.locator('.termin-band').count() > 0
  pruefe('Termine stehen in einem eigenen Band', hatBand)
  if (!hatBand) {
    console.log('     (ohne Termine ist der Rest nicht messbar – abgebrochen)')
    await browser.close()
    process.exit(1)
  }

  /* ------------------------------- 3. Ohne Scrollen sichtbar? Nachgemessen */
  const mass = await page.evaluate(() => {
    const band = document.querySelector('.termin-band')
    const zeilen = [...document.querySelectorAll('.termin-zeile')]
    const letzte = zeilen[zeilen.length - 1]
    return {
      bandOben: Math.round(band.getBoundingClientRect().top),
      letzteUnten: Math.round(letzte.getBoundingClientRect().bottom),
      sichtbareHoehe: window.innerHeight,
      scrollY: window.scrollY,
      zeilen: zeilen.length,
      // Die untere Navigationsleiste verdeckt den unteren Rand.
      navHoehe: Math.round(document.querySelector('.mobile-nav')?.getBoundingClientRect().height ?? 0),
    }
  })
  const platz = mass.sichtbareHoehe - mass.navHoehe
  console.log(`     gemessen: Band beginnt bei ${mass.bandOben} px, letzte Zeile endet bei `
    + `${mass.letzteUnten} px, nutzbare Höhe ${platz} px (${mass.zeilen} Termine)`)

  pruefe('Seite ist nicht gescrollt', mass.scrollY === 0)
  pruefe('Das Terminband beginnt im sichtbaren Bereich', mass.bandOben >= 0 && mass.bandOben < platz,
    `(${mass.bandOben} px)`)
  pruefe('Alle heutigen Termine sind ohne Scrollen zu sehen', mass.letzteUnten <= platz,
    `(${mass.letzteUnten} px von ${platz} px)`)

  /* ------------------------------------- 4. Steht es vor den Aufgaben? */
  const reihenfolge = await page.evaluate(() => {
    const band = document.querySelector('.termin-band')?.getBoundingClientRect().top ?? 1e9
    const karten = [...document.querySelectorAll('.card')]
      .map((c) => ({ titel: c.textContent?.slice(0, 40) ?? '', oben: c.getBoundingClientRect().top }))
    return { band, ersteKarte: karten[0]?.oben ?? 1e9, titelErsteKarte: karten[0]?.titel ?? '' }
  })
  pruefe('Termine stehen vor allen Karten', reihenfolge.band < reihenfolge.ersteKarte,
    `(Band ${Math.round(reihenfolge.band)} px, erste Karte ${Math.round(reihenfolge.ersteKarte)} px)`)

  /* ------------------------------------- 5. Datum, Uhrzeit, Bezeichnung */
  const inhalt = await page.evaluate(() => {
    const z = document.querySelector('.termin-zeile')
    return {
      zeit: z?.querySelector('.termin-zeit')?.textContent ?? '',
      titel: z?.querySelector('.termin-titel')?.textContent ?? '',
      ort: z?.querySelector('.termin-ort')?.textContent ?? '',
      kopf: document.querySelector('.termin-band-titel')?.textContent ?? '',
      datumImKopf: document.querySelector('.page-sub')?.textContent ?? '',
    }
  })
  pruefe('Uhrzeit ist zu sehen', /\d{2}:\d{2}/.test(inhalt.zeit), `("${inhalt.zeit.trim()}")`)
  pruefe('Bezeichnung ist zu sehen', inhalt.titel.length > 0, `("${inhalt.titel}")`)
  pruefe('Ort/Zusatz ist zu sehen', inhalt.ort.length > 0, `("${inhalt.ort}")`)
  pruefe('Das Datum steht darüber', /\d/.test(inhalt.datumImKopf), `("${inhalt.datumImKopf.trim()}")`)

  /* -------------------------------- 6. Schriftgröße der Uhrzeit vs. Titel */
  const groessen = await page.evaluate(() => ({
    zeit: parseFloat(getComputedStyle(document.querySelector('.termin-zeit')).fontSize),
    titel: parseFloat(getComputedStyle(document.querySelector('.termin-titel')).fontSize),
    listeSonst: parseFloat(getComputedStyle(document.querySelector('.list-title') ?? document.body).fontSize),
  }))
  pruefe('Die Uhrzeit ist größer als der Termintitel', groessen.zeit > groessen.titel,
    `(${groessen.zeit} px vs. ${groessen.titel} px)`)
  pruefe('Termine heben sich von gewöhnlichen Listenzeilen ab',
    groessen.titel >= groessen.listeSonst, `(${groessen.titel} px vs. ${groessen.listeSonst} px)`)

  /* --------------------------------------- 7. Antippen öffnet die Vorschau */
  await page.locator('.termin-zeile').first().click()
  await page.waitForTimeout(600)
  const vorschau = await page.evaluate(() => {
    const d = document.querySelector('.detail')
    return {
      offen: !!d,
      text: d?.textContent ?? '',
      hatBearbeiten: [...document.querySelectorAll('.modal button')].some((b) => b.textContent?.includes('Bearbeiten')),
    }
  })
  pruefe('Termin antippen öffnet die Detailvorschau', vorschau.offen)
  pruefe('Die Vorschau nennt Uhrzeit und Ort',
    vorschau.text.includes('09:30') && vorschau.text.includes('Altenberger'),
    `(${vorschau.text.slice(0, 80).replace(/\s+/g, ' ')})`)
  pruefe('Von der Vorschau geht es in den Editor', vorschau.hatBearbeiten)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  /* ------------------------------------------- 8. Aufgabe genauso bedienbar */
  const aufgabe = page.locator('.list-main').first()
  if (await aufgabe.count() > 0) {
    await aufgabe.click()
    await page.waitForTimeout(600)
    const d = await page.evaluate(() => ({
      offen: !!document.querySelector('.detail'),
      zeilen: document.querySelectorAll('.detail-zeile').length,
    }))
    pruefe('Aufgabe antippen öffnet dieselbe Art Vorschau', d.offen, `(${d.zeilen} Angaben)`)
    await page.keyboard.press('Escape')
  }

  /* ------------------------------------------------- 9. Nichts kaputt */
  const querScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  pruefe('Kein seitliches Wegrutschen', !querScroll)

  const echteFehler = konsolenfehler.filter((t) =>
    !/favicon|manifest|sw\.js|Service ?Worker|net::ERR_FILE_NOT_FOUND/i.test(t))
  pruefe('Keine Fehler in der Konsole', echteFehler.length === 0, echteFehler.slice(0, 2).join(' | '))

  await page.screenshot({ path: path.join(WURZEL, 'tests', 'heute-mobil.png') })
  console.log('     Bildschirmfoto: tests/heute-mobil.png')

  await browser.close()
  console.log(`\n=== ${fehler === 0 ? 'alles bestanden' : fehler + ' Prüfung(en) fehlgeschlagen'} ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
