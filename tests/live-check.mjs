/**
 * Ruft die tatsächlich veröffentlichte Seite auf – wie ein Handy es täte –
 * und prüft, ob LifeHub dort startet.
 */
import { chromium } from 'playwright'

const URL = process.argv[2]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const page = await ctx.newPage()
const fehler = []
const nichtGefunden = []
page.on('pageerror', (e) => fehler.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()) })
page.on('response', (r) => { if (r.status() >= 400) nichtGefunden.push(`${r.status()} ${r.url()}`) })

const res = await page.goto(URL, { waitUntil: 'domcontentloaded' })
console.log('HTTP-Status:', res.status())
let gestartet = false
try {
  await page.waitForSelector('#root > *', { timeout: 40000 })
  await page.waitForTimeout(5000)
  gestartet = (await page.innerText('#root')).includes('Finanzen')
} catch { /* bleibt false */ }
console.log('App startet:', gestartet ? 'JA' : 'NEIN')
console.log('Titel     :', await page.title())
console.log('Fehlschläge beim Laden:', nichtGefunden.length, nichtGefunden.slice(0, 5))
console.log('JS-Fehler :', fehler.length, fehler.slice(0, 3))
await page.screenshot({ path: '/tmp/live.png' })
await b.close()
