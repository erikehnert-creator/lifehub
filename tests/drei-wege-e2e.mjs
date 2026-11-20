/**
 * Drei echte Wege durch die App, auf dem Handy (390 × 844), von vorn bis hinten:
 *
 *  1. Unterwegs eine Aufgabe festhalten, abends auf „Heute" abhaken.
 *  2. Eine Ausgabe erfassen und in den Buchungen wiederfinden.
 *  3. Einen wöchentlichen Termin anlegen und ihn heute und im Kalender sehen.
 *
 * Aufruf:  node tests/drei-wege-e2e.mjs   (nach `npm run build:single`)
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
  for (let i = 0; i < 200; i++) { if (await page.$('.page')) return; await pause(page, 300) }
  throw new Error('App startet nicht')
}
async function oeffne(page, hash) {
  await page.goto(DATEI + hash)
  await page.reload()
  await warteAufApp(page)
  await pause(page, 1000)
}
const tagString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const konsole = []
  page.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text()) })
  page.on('pageerror', (e) => konsole.push(String(e)))
  await oeffne(page, '#/heute')

  console.log('\n=== Weg 1: Aufgabe festhalten und abhaken ===')
  await page.locator('.fab').click()
  await pause(page, 300)
  await page.locator('.modal button', { hasText: 'Aufgabe' }).first().click()
  await pause(page, 300)
  await page.locator('.modal input.input').first().fill('Öl fürs Auto bestellen')
  await page.locator('.modal .chip', { hasText: 'Heute' }).first().click()
  await page.locator('.modal button', { hasText: 'Aufgabe erstellen' }).click()
  await pause(page, 700)
  pruefe('Der Dialog schließt sich', await page.locator('[role=dialog]').count() === 0)
  await oeffne(page, '#/heute')
  const zeile = page.locator('.list-row', { hasText: 'Öl fürs Auto bestellen' }).first()
  pruefe('Die Aufgabe steht auf Heute', await zeile.count() > 0)
  await zeile.locator('.checkbox').click()
  await pause(page, 500)
  pruefe('Abhaken wirkt sofort', await page.locator('.list-row.done', { hasText: 'Öl fürs Auto bestellen' }).count() > 0)
  await oeffne(page, '#/heute')
  pruefe('… und bleibt nach dem Neuladen abgehakt',
    await page.locator('.list-row.done', { hasText: 'Öl fürs Auto bestellen' }).count() > 0)

  console.log('\n=== Weg 2: Ausgabe erfassen ===')
  await page.locator('.fab').click()
  await pause(page, 300)
  await page.locator('.modal button', { hasText: 'Buchung' }).first().click()
  await pause(page, 400)
  await page.keyboard.type('1250')
  await page.locator('.modal input[placeholder="z. B. REWE"]').fill('Wegetest Markt')
  await page.locator('.modal button', { hasText: /^Speichern$/ }).click()
  await pause(page, 800)
  pruefe('Der Dialog schließt sich', await page.locator('[role=dialog]').count() === 0)
  await oeffne(page, '#/finanzen/buchungen')
  const buchungen = await page.locator('body').innerText()
  pruefe('Die Buchung steht in der Liste', buchungen.includes('Wegetest Markt'))
  pruefe('… mit 12,50 €', /12,50/.test(buchungen))

  console.log('\n=== Weg 3: Wöchentlicher Termin ===')
  await oeffne(page, '#/heute')
  await page.locator('.fab').click()
  await pause(page, 300)
  await page.locator('.modal button', { hasText: 'Termin' }).first().click()
  await pause(page, 400)
  await page.locator('.modal input.input').first().fill('Fußball Verein')
  const start = new Date(); start.setDate(start.getDate() - 21)
  await page.locator('.modal input[type=date]').first().fill(tagString(start))
  await page.locator('.modal .chips button', { hasText: 'Wöchentlich' }).first().click()
  await page.locator('.modal input[type=time]').nth(0).fill('18:00')
  await page.locator('.modal input[type=time]').nth(1).fill('19:30')
  await page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await pause(page, 800)
  await oeffne(page, '#/heute')
  pruefe('Der Termin steht heute im Band',
    (await page.locator('.termin-band').innerText().catch(() => '')).includes('Fußball Verein'))
  await oeffne(page, '#/plan/kalender')
  pruefe('… und im Kalender', (await page.locator('body').innerText()).includes('Fußball Verein'))
  await oeffne(page, '#/plan')
  const plan = await page.locator('body').innerText()
  pruefe('… und im Tagesplan', plan.includes('Fußball Verein'))

  const querScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  pruefe('Kein seitliches Wegrutschen', !querScroll)
  const echte = konsole.filter((t) => !/favicon|manifest|sw\.js|Service ?Worker|net::ERR_FILE_NOT_FOUND/i.test(t))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))

  await browser.close()
  console.log(`\n=== ${fehler === 0 ? 'alles bestanden' : fehler + ' Prüfung(en) fehlgeschlagen'} ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
