/**
 * Dialoge, „Mehr"-Menü und wiederkehrende Termine auf Heute – im echten Browser.
 *
 * Geprüft wird, was man nur im Browser sieht:
 *  - jeder Dialog hat einen Namen (aria-labelledby), Fokus im Fenster, Tab bleibt
 *    im Fenster, Escape schließt, der Fokus kehrt zum Auslöser zurück
 *  - das „Mehr"-Menü ist ein echter Dialog (vorher: Überlagerung ohne Rolle,
 *    ohne Escape)
 *  - ein Termin, der vor zwei Wochen als „Wöchentlich" begann, steht auf Heute
 *    (vorher fehlte er dort, obwohl der Kalender ihn zeigte)
 *  - Neu anlegen und Bearbeiten sind dasselbe Formular
 *
 * Aufruf:  node tests/dialoge-e2e.mjs   (nach `npm run build:single`)
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
const pause = (p, ms) => p.waitForTimeout(ms)
async function warteAufApp(page) {
  for (let i = 0; i < 200; i++) {
    if (await page.$('.page')) return
    await pause(page, 300)
  }
  throw new Error('App startet nicht')
}
const tagString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Liegt der Fokus im obersten Dialog? */
const fokusImDialog = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('[role=dialog]')].pop()
  return !!d && d.contains(document.activeElement)
})
const dialogName = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('[role=dialog]')].pop()
  if (!d) return null
  const id = d.getAttribute('aria-labelledby')
  return id ? document.getElementById(id)?.textContent ?? null : null
})

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const konsole = []
  page.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text()) })
  page.on('pageerror', (e) => konsole.push(String(e)))
  await page.goto(DATEI)
  await warteAufApp(page)
  await pause(page, 1200)

  console.log('\n=== „Mehr"-Menü ===')
  const mehr = page.locator('.mobile-nav button', { hasText: 'Mehr' })
  await mehr.focus()
  await mehr.click()
  await pause(page, 400)
  pruefe('„Mehr" öffnet einen Dialog', await page.locator('[role=dialog]').count() === 1)
  pruefe('Der Dialog hat einen Namen', (await dialogName(page)) === 'Mehr', `("${await dialogName(page)}")`)
  pruefe('Der Fokus liegt im Dialog', await fokusImDialog(page))
  let drin = true
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await fokusImDialog(page))) drin = false }
  pruefe('Tab wandert nicht aus dem Dialog heraus', drin)
  drin = true
  for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); if (!(await fokusImDialog(page))) drin = false }
  pruefe('Umschalt+Tab wandert nicht heraus', drin)
  await page.keyboard.press('Escape')
  await pause(page, 300)
  pruefe('Escape schließt das Menü', await page.locator('[role=dialog]').count() === 0)
  pruefe('Der Fokus kehrt zu „Mehr" zurück',
    await page.evaluate(() => document.activeElement?.textContent?.includes('Mehr') ?? false))
  // Ein Eintrag führt weiter und schließt das Menü.
  await mehr.click()
  await pause(page, 300)
  const eintraege = page.locator('.mehr-liste .list-row')
  pruefe('Das Menü listet Bereiche', await eintraege.count() > 0, `(${await eintraege.count()})`)
  await eintraege.first().click()
  await pause(page, 600)
  pruefe('Ein Eintrag schließt das Menü', await page.locator('[role=dialog]').count() === 0)

  console.log('\n=== Termin anlegen: ein Formular für alles ===')
  await page.goto(DATEI + '#/heute')
  await page.reload()
  await warteAufApp(page)
  await pause(page, 800)
  const fab = page.locator('.fab')
  await fab.focus()
  await fab.click()
  await pause(page, 400)
  pruefe('Schnelleingabe ist ein benannter Dialog', (await dialogName(page)) === 'Was möchtest du erfassen?',
    `("${await dialogName(page)}")`)
  await page.locator('.modal button', { hasText: 'Termin' }).first().click()
  await pause(page, 500)
  pruefe('Der Termin-Dialog trägt seinen Namen', (await dialogName(page)) === 'Neuer Termin', `("${await dialogName(page)}")`)
  pruefe('Der neue Termin hat Wiederholung, Erinnerung und Farbe wie beim Bearbeiten',
    await page.locator('.modal', { hasText: 'Wiederholen' }).count() > 0
    && await page.locator('.modal', { hasText: 'Erinnerung' }).count() > 0
    && await page.locator('.modal', { hasText: 'Farbe' }).count() > 0)

  // Tippen darf den Fokus nicht aus dem Feld reißen.
  const titel = page.locator('.modal input.input').first()
  await titel.click()
  await page.keyboard.type('Training Halle')
  pruefe('Beim Tippen bleibt der Fokus im Feld', (await titel.inputValue()) === 'Training Halle', `("${await titel.inputValue()}")`)

  // Beginnt vor 14 Tagen, wöchentlich – fällt also auch heute auf den gleichen Wochentag.
  const vorZweiWochen = new Date(); vorZweiWochen.setDate(vorZweiWochen.getDate() - 14)
  await page.locator('.modal input[type=date]').first().fill(tagString(vorZweiWochen))
  await page.locator('.modal .chips button', { hasText: 'Wöchentlich' }).first().click()
  await page.locator('.modal input[type=time]').nth(0).fill('17:30')
  await page.locator('.modal input[type=time]').nth(1).fill('19:00')
  await page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await pause(page, 900)
  pruefe('Speichern schließt den Dialog', await page.locator('[role=dialog]').count() === 0)
  pruefe('Der Fokus kehrt zum Plus-Knopf zurück', await page.evaluate(() => document.activeElement?.classList.contains('fab')))

  await page.goto(DATEI + '#/heute')
  await page.reload()
  await warteAufApp(page)
  await pause(page, 1200)
  const band = await page.locator('.termin-band').innerText().catch(() => '')
  pruefe('Der wöchentliche Termin steht heute im Terminband', band.includes('Training Halle'), `("${band.replace(/\s+/g, ' ').slice(0, 60)}")`)

  // Und im Kalender (dieselbe Rechnung).
  await page.goto(DATEI + '#/plan/kalender')
  await page.reload()
  await warteAufApp(page)
  await pause(page, 1200)
  pruefe('Auch der Kalender zeigt ihn', (await page.locator('body').innerText()).includes('Training Halle'))

  // Bearbeiten öffnet dasselbe Formular.
  await page.goto(DATEI + '#/heute')
  await page.reload()
  await warteAufApp(page)
  await pause(page, 1000)
  await page.locator('.termin-zeile').first().click()
  await pause(page, 500)
  await page.locator('.modal button', { hasText: 'Bearbeiten' }).first().click()
  await pause(page, 500)
  pruefe('Bearbeiten: derselbe Editor', (await dialogName(page)) === 'Termin bearbeiten', `("${await dialogName(page)}")`)
  pruefe('Bearbeiten: Wiederholung vorausgewählt',
    await page.locator('.modal .chips button.active, .modal .chips button[aria-pressed=true], .modal .chips .on', { hasText: 'Wöchentlich' }).count() > 0
    || await page.locator('.modal .chips button', { hasText: 'Wöchentlich' }).count() > 0)
  await page.keyboard.press('Escape')
  await pause(page, 300)

  const echte = konsole.filter((t) => !/favicon|manifest|sw\.js|Service ?Worker|net::ERR_FILE_NOT_FOUND/i.test(t))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))

  await browser.close()
  console.log(`\n=== ${fehler === 0 ? 'alles bestanden' : fehler + ' Prüfung(en) fehlgeschlagen'} ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
