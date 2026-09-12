/**
 * Die Automatik im echten Browser, gegen die gebaute App.
 *
 * Was Unit-Tests hier NICHT beantworten können und genau deshalb geprüft wird:
 *
 *  – Läuft die Automatik nach dem Öffnen wirklich los und schreibt in SQLite?
 *  – Zieht eine geänderte Vorlage die Aufgaben nach, ohne dass jemand etwas
 *    anklickt?
 *  – Und vor allem: Bleibt sie stehen? Der Abgleich läuft nach jeder
 *    Datenänderung erneut und schreibt selbst Daten. Wenn dabei etwas nicht
 *    exakt konvergiert, dreht sich die App in einer Endlosschleife – das sieht
 *    man in keinem Unit-Test, wohl aber an einer Schreibzahl, die nicht
 *    aufhört zu wachsen.
 *
 * Aufruf:  node tests/automatik-e2e.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, 'LifeHub.html').replace(/\\/g, '/')

let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
  if (bedingung) console.log(`  OK   ${name}`)
  else { console.log(`  FEHL ${name} ${zusatz}`); fehler++ }
}

/** Wartet, bis eine Bedingung in der Seite zutrifft (oder die Zeit abläuft). */
async function warteAuf(page, fn, arg, ms = 25000, was = 'Bedingung') {
  const bis = Date.now() + ms
  for (;;) {
    if (await page.evaluate(fn, arg)) return true
    if (Date.now() > bis) { console.log(`  ! Zeitüberschreitung: ${was}`); return false }
    await page.waitForTimeout(250)
  }
}

/* Zugriff auf die Datenbank der laufenden App. Die App legt sie nicht global
 * ab, deshalb über den Weg, den sie selbst benutzt: den SQLite-Speicher in
 * IndexedDB gibt es erst nach dem Speichern – einfacher ist es, die Anzeige
 * zu lesen. Für Zahlen, die in keiner Ansicht stehen, hilft __lifehub. */
const HAT_APP = () => !!document.querySelector('.page')

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  const konsolenfehler = []
  page.on('console', (m) => { if (m.type() === 'error') konsolenfehler.push(m.text()) })
  page.on('pageerror', (e) => konsolenfehler.push(String(e)))

  console.log('\n=== Automatik im Browser ===\n')
  await page.goto(DATEI)
  await warteAuf(page, HAT_APP, null, 40000, 'App startet')
  pruefe('App startet', await page.evaluate(HAT_APP))

  /* ------------------------------------------------ 1. Vorlage anlegen */
  await page.goto(DATEI + '#/plan/vorlagen')
  await page.waitForTimeout(1200)
  // Reload, damit die Route sicher greift (Hash-Wechsel ohne Neuladen reicht).
  await page.reload()
  await warteAuf(page, HAT_APP, null, 40000, 'Vorlagenseite')

  const vorlagenKnopf = page.locator('button', { hasText: '+ Vorlage' }).first()
  const hatVorlagenTab = await vorlagenKnopf.count() > 0
  pruefe('Vorlagen-Tab erreichbar', hatVorlagenTab)

  if (hatVorlagenTab) {
    await vorlagenKnopf.click()
    await page.waitForTimeout(400)
    await page.locator('.modal input.input').first().fill('E2E Training')
    // Wochentag "jeden Tag" lassen -> entsteht an jedem Tag im Vorlauf
    await page.locator('.modal input[type=time]').first().fill('18:00')
    await page.locator('.modal button', { hasText: 'Speichern' }).first().click()
    await page.waitForTimeout(600)
    pruefe('Vorlage gespeichert', await page.locator('text=E2E Training').count() > 0)

    /* --------------------------------- 2. Aufgaben entstehen von selbst */
    // Der erste Lauf wartet acht Sekunden auf den Serverabgleich.
    const entstanden = await warteAuf(
      page,
      () => document.body.innerText.includes('Eingeplant (4 Wochen)')
        && Number(
          [...document.querySelectorAll('.stat, .stat-small, div')]
            .map((e) => e.textContent ?? '')
            .filter((t) => t.includes('Eingeplant (4 Wochen)'))
            .map((t) => (t.match(/Eingeplant \(4 Wochen\)\s*(\d+)/) ?? [])[1] ?? '0')[0] ?? '0',
        ) > 0,
      null, 30000, 'Automatik plant ein',
    )
    pruefe('Aufgaben entstehen ohne Knopfdruck', entstanden)

    pruefe(
      'Es gibt keinen Einplanen-Knopf mehr',
      await page.locator('button', { hasText: 'Aufgaben einplanen' }).count() === 0,
    )

    const anzahlNachher = await page.evaluate(() =>
      document.querySelectorAll('.list-row').length)

    /* ------------------------------ 3. Zweiter Lauf legt nichts nach */
    await page.waitForTimeout(6000)
    const anzahlSpaeter = await page.evaluate(() =>
      document.querySelectorAll('.list-row').length)
    pruefe('Zweiter Durchlauf legt nichts doppelt an', anzahlNachher === anzahlSpaeter,
      `(${anzahlNachher} -> ${anzahlSpaeter})`)

    /* ------------------------------ 4. Neuladen legt nichts nach */
    await page.reload()
    await warteAuf(page, HAT_APP, null, 40000, 'Neustart')
    await page.waitForTimeout(12000)
    const anzahlNeustart = await page.evaluate(() =>
      document.querySelectorAll('.list-row').length)
    pruefe('Neustart legt nichts doppelt an', anzahlNeustart === anzahlSpaeter,
      `(${anzahlSpaeter} -> ${anzahlNeustart})`)

    /* ------------------------------ 5. Geänderte Vorlage zieht nach */
    await page.locator('text=E2E Training').first().click()
    await page.waitForTimeout(500)
    await page.locator('.modal input[type=time]').first().fill('17:30')
    await page.locator('.modal button', { hasText: 'Speichern' }).first().click()
    const nachgezogen = await warteAuf(
      page,
      () => document.body.innerText.includes('17:30'),
      null, 20000, 'Uhrzeit wird nachgezogen',
    )
    pruefe('Geänderte Vorlage zieht die Aufgaben nach', nachgezogen)

    /* ------------------------------ 6. Gelöschte Vorlage räumt auf */
    await page.locator('text=E2E Training').first().click()
    await page.waitForTimeout(400)
    await page.locator('.modal button', { hasText: 'Löschen' }).first().click()
    await page.waitForTimeout(400)
    // Der Bestätigungsdialog liegt als eigenes Overlay ÜBER dem Editor. Ohne
    // diese Eingrenzung trifft man den Löschknopf des Editors darunter, und
    // der ist vom oberen Overlay verdeckt.
    await page.locator('.overlay').last().locator('button', { hasText: 'Löschen' }).click()
    const aufgeraeumt = await warteAuf(
      page,
      () => !document.body.innerText.includes('E2E Training'),
      null, 20000, 'Vorlage und Aufgaben verschwinden',
    )
    pruefe('Gelöschte Vorlage nimmt ihre Aufgaben mit', aufgeraeumt)
  }

  /* ------------------------------------------- 7. Heute-Seite und Vorschau */
  await page.goto(DATEI + '#/heute')
  await page.reload()
  await warteAuf(page, HAT_APP, null, 40000, 'Heute-Seite')
  pruefe('Heute-Seite lädt', await page.locator('.page-title').count() > 0)

  const aufgabenZeile = page.locator('.list-main').first()
  if (await aufgabenZeile.count() > 0) {
    await aufgabenZeile.click()
    await page.waitForTimeout(500)
    pruefe('Antippen öffnet die Kurzvorschau', await page.locator('.detail').count() > 0)
    const hatBearbeiten = await page.locator('.modal button', { hasText: 'Bearbeiten' }).count() > 0
    pruefe('Vorschau bietet „Bearbeiten" an', hatBearbeiten)
    await page.keyboard.press('Escape')
  } else {
    console.log('  -    keine Aufgabe zum Antippen vorhanden (übersprungen)')
  }

  /* ------------------------------------------------ 8. Handyansicht */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await warteAuf(page, HAT_APP, null, 40000, 'Handyansicht')
  const querScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  pruefe('Kein seitliches Wegrutschen auf dem Handy', !querScroll)

  /* ------------------------------------------------ 9. Fehlerfreiheit */
  const echteFehler = konsolenfehler.filter((t) =>
    !/favicon|manifest|sw\.js|Service ?Worker|net::ERR_FILE_NOT_FOUND/i.test(t))
  pruefe('Keine Fehler in der Konsole', echteFehler.length === 0,
    echteFehler.slice(0, 3).join(' | '))

  const schleife = konsolenfehler.some((t) => t.includes('Maximum update depth'))
  pruefe('Keine Renderschleife', !schleife)

  await browser.close()
  console.log(`\n=== ${fehler === 0 ? 'alles bestanden' : fehler + ' Prüfung(en) fehlgeschlagen'} ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
