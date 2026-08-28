/**
 * Sichtprüfung: Alle neuen Ansichten einmal öffnen, Bildschirmfotos machen
 * und melden, wenn dabei ein Fehler in der Konsole auftaucht.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ZIEL = '/tmp/blick'
fs.rmSync(ZIEL, { recursive: true, force: true })
fs.mkdirSync(ZIEL, { recursive: true })
fs.rmSync('/tmp/blick-profil', { recursive: true, force: true })

const ctx = await chromium.launchPersistentContext('/tmp/blick-profil', {
  executablePath: EXE, viewport: { width: 1280, height: 950 },
})
const page = ctx.pages()[0] ?? await ctx.newPage()
const fehler = []
page.on('pageerror', (e) => fehler.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()) })

await page.goto('file:///home/claude/lifehub/LifeHub.html')
await page.waitForSelector('#root > *', { timeout: 40000 })
await page.waitForTimeout(3000)

// Echte Daten einspielen
await page.goto('file:///home/claude/lifehub/LifeHub.html#/einstellungen')
await page.waitForTimeout(1200)
await page.locator('button', { hasText: 'Daten & Backup' }).first().click()
await page.waitForTimeout(600)
await page.locator('input[type=file][accept*="json"]').first().setInputFiles('/home/claude/lifehub/LifeHub-Daten-Erik.json')
await page.waitForTimeout(1500)
await page.locator('.modal .btn-primary').first().click()
await page.waitForTimeout(4000)

const schuss = async (name, hash, warten = 1800) => {
  await page.goto('file:///home/claude/lifehub/LifeHub.html#' + hash)
  await page.waitForTimeout(warten)
  await page.screenshot({ path: `${ZIEL}/${name}.png`, fullPage: false })
  console.log('  ', name)
}

console.log('Desktop:')
for (const [n, h] of [
  ['01-heute', '/heute'],
  ['02-finanzen', '/finanzen'],
  ['03-konten', '/finanzen/konten'],
  ['04-wiederkehrend', '/finanzen/wiederkehrend'],
  ['05-kalender', '/plan/kalender'],
  ['06-plan-heute', '/plan'],
  ['07-alle-aufgaben', '/plan/alle'],
  ['08-einkauf', '/einkauf'],
  ['09-tracking', '/tracking'],
  ['10-verlauf', '/tracking/verlauf'],
  ['11-training', '/tracking/training'],
  ['12-analysen', '/analysen'],
  ['18-prognose', '/finanzen'],
]) await schuss(n, h)

// Kontoansicht öffnen
await page.goto('file:///home/claude/lifehub/LifeHub.html#/finanzen/konten')
await page.waitForTimeout(1500)
await page.locator('.konto-kopf').first().click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${ZIEL}/13-kontoansicht.png` })
console.log('   13-kontoansicht')
await page.keyboard.press('Escape')

// Diagramm groß
await page.goto('file:///home/claude/lifehub/LifeHub.html#/finanzen')
await page.waitForTimeout(1800)
await page.locator('.chart-tap').first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${ZIEL}/14-diagramm-gross.png` })
console.log('   14-diagramm-gross')
await page.keyboard.press('Escape')

// Kalender: Woche und Termin-Editor
await page.goto('file:///home/claude/lifehub/LifeHub.html#/plan/kalender')
await page.waitForTimeout(1500)
await page.locator('.tabs').nth(1).locator('.tab-btn', { hasText: 'Woche' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${ZIEL}/15-kalender-woche.png` })
console.log('   15-kalender-woche')
await page.locator('button', { hasText: '+ Termin' }).first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${ZIEL}/16-termin-editor.png` })
console.log('   16-termin-editor')
await page.keyboard.press('Escape')

// Aufgaben-Editor
await page.goto('file:///home/claude/lifehub/LifeHub.html#/plan/alle')
await page.waitForTimeout(1500)
const zeile = page.locator('.aufgabe .list-main').first()
if (await zeile.count()) {
  await zeile.click(); await page.waitForTimeout(1000)
  await page.screenshot({ path: `${ZIEL}/17-aufgabe-editor.png` })
  console.log('   17-aufgabe-editor')
  await page.keyboard.press('Escape')
}

// Handygröße
console.log('Handy:')
const handy = await ctx.newPage()
handy.on('pageerror', (e) => fehler.push('handy: ' + String(e)))
await handy.setViewportSize({ width: 390, height: 844 })
for (const [n, h] of [
  ['h1-heute', '/heute'],
  ['h2-finanzen', '/finanzen'],
  ['h3-kalender', '/plan/kalender'],
  ['h4-einkauf', '/einkauf'],
  ['h5-plan', '/plan'],
]) {
  await handy.goto('file:///home/claude/lifehub/LifeHub.html#' + h)
  await handy.waitForTimeout(2200)
  await handy.screenshot({ path: `${ZIEL}/${n}.png` })
  console.log('  ', n)
}

console.log('\nJS-Fehler:', fehler.length, fehler.slice(0, 6))
await ctx.close()
process.exit(fehler.length ? 1 : 0)
