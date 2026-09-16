/**
 * Bildschirmfotos aller Hauptseiten – Schreibtisch und Handy, hell und dunkel.
 *
 * Für die Gestaltung ist das das Gegenstück zu den Prüfskripten: Die prüfen,
 * OB etwas funktioniert, das hier zeigt, WIE es aussieht. Vier Fassungen je
 * Seite, weil ein Entwurf, der nur am hellen Schreibtischbildschirm überzeugt,
 * die Hälfte der Wirklichkeit verfehlt – Erik sieht LifeHub überwiegend auf
 * dem Handy.
 *
 * Nebenbei wird gemessen, was sich messen lässt: seitliches Überstehen,
 * Antippflächen unter 40 px und Texte unter 12 px. Das sind die drei Dinge,
 * die auf dem Handy wirklich stören und die man auf einem Bild leicht
 * übersieht.
 *
 * Fotografiert wird mit dem eingebauten Beispielbestand (6 Monate Buchungen,
 * Tracking, Training) – eine leere App sieht anders aus als eine benutzte, und
 * echte Daten gehören nicht in Bildschirmfotos.
 *
 * Aufruf:  node tests/ansicht.mjs [seite ...]
 *          node tests/ansicht.mjs heute tracking
 *          node tests/ansicht.mjs --unterseiten     auch die Reiter (hell)
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, process.env.LIFEHUB_HTML ?? 'LifeHub.html').split(path.sep).join('/')
const ZIEL = path.join(WURZEL, 'tests', 'ansichten')

const SEITEN = {
  heute: '#/heute',
  finanzen: '#/finanzen',
  plan: '#/plan',
  tracking: '#/tracking',
  kalender: '#/plan/kalender',
  einkauf: '#/einkauf',
  ziele: '#/ziele',
  analysen: '#/analysen',
  zusammenhaenge: '#/analysen/zusammenhaenge',
  suche: '#/suche',
  einstellungen: '#/einstellungen',
}

/** Die Reiter unterhalb der Hauptseiten – nur hell, Handy und Schreibtisch. */
const UNTERSEITEN = {
  'finanzen-buchungen': '#/finanzen/buchungen',
  'finanzen-konten': '#/finanzen/konten',
  'finanzen-budgets': '#/finanzen/budgets',
  'finanzen-wiederkehrend': '#/finanzen/wiederkehrend',
  'finanzen-finanztag': '#/finanzen/finanztag',
  'finanzen-investments': '#/finanzen/investments',
  'plan-woche': '#/plan/woche',
  'plan-inbox': '#/plan/inbox',
  'plan-alle': '#/plan/alle',
  'plan-arbeit': '#/plan/arbeit',
  'plan-vorlagen': '#/plan/vorlagen',
  'tracking-verlauf': '#/tracking/verlauf',
  'tracking-training': '#/tracking/training',
  'tracking-koerper': '#/tracking/koerper',
  'tracking-ziele': '#/tracking/ziele',
  'einstellungen-konten': '#/einstellungen/konten',
  'einstellungen-kategorien': '#/einstellungen/kategorien',
  'einstellungen-tracking': '#/einstellungen/tracking',
  'einstellungen-ernaehrung': '#/einstellungen/ernaehrung',
  'einstellungen-daten': '#/einstellungen/daten',
  'einstellungen-sicherheit': '#/einstellungen/sicherheit',
  'einstellungen-import': '#/einstellungen/import',
  'einstellungen-papierkorb': '#/einstellungen/papierkorb',
  'einstellungen-sync': '#/einstellungen/sync',
  'einstellungen-ki': '#/einstellungen/ki',
}

const GERAETE = [
  // `hasTouch` ist nicht kosmetisch: Daran haengt `@media (pointer: coarse)`,
  // und damit die groesseren Antippflaechen. Ohne das misst man am Handy die
  // Schreibtischfassung und haelt sie faelschlich fuer zu klein.
  { name: 'handy', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { name: 'desktop', viewport: { width: 1400, height: 1000 } },
]
const MODI = ['light', 'dark']

const argumente = process.argv.slice(2)
const mitUnterseiten = argumente.includes('--unterseiten')
const gewuenscht = argumente.filter((a) => !a.startsWith('--'))
const seiten = Object.entries(SEITEN).filter(([k]) => !gewuenscht.length || gewuenscht.includes(k))

/** Den Beispielbestand anlegen – derselbe Knopf, den Erik in den Einstellungen hat. */
async function beispieldaten(p) {
  await p.goto(DATEI + '#/einstellungen/daten')
  const knopf = p.locator('button', { hasText: 'Beispieldaten erzeugen' })
  for (let i = 0; i < 50 && !(await knopf.count()); i++) await p.waitForTimeout(100)
  if (!(await knopf.count())) throw new Error('Knopf „Beispieldaten erzeugen" nicht gefunden')
  await knopf.first().click()
  await p.locator('text=/Beispieldatensätze angelegt/').first().waitFor({ timeout: 60000 })
  await p.waitForTimeout(1500)
}

/** Was auf dem Handy wirklich stört – und sich messen lässt. */
async function messen(p) {
  return await p.evaluate(() => {
    const doc = document.documentElement
    const ueberstand = Math.max(0, doc.scrollWidth - doc.clientWidth)

    /*
     * Gemessen wird die TREFFBARE Flaeche, nicht der Kasten.
     *
     * Beides ist nicht dasselbe: Ein Haekchenkaestchen darf 21 px gross
     * aussehen und trotzdem 44 px weit treffbar sein, wenn ein unsichtbares
     * Pseudoelement die Flaeche aufspannt (siehe .checkbox in theme.css). Wer
     * nur getBoundingClientRect misst, meldet dort einen Mangel, den es nicht
     * gibt - und uebersieht umgekehrt ein Element, das von einem anderen
     * ueberdeckt wird.
     *
     * Deshalb wird von der Mitte aus zwanzig Pixel nach oben und unten
     * getippt und nachgesehen, ob dort noch dasselbe herauskommt.
     */
    const trifft = (el, x, y) => {
      const ziel = document.elementFromPoint(x, y)
      return !!ziel && (ziel === el || el.contains(ziel) || ziel.contains(el))
    }

    const klein = []
    for (const el of document.querySelectorAll('button, .btn, a, input, select, .chip, .checkbox')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.bottom < 0 || r.top > innerHeight) continue      // nicht im Bild
      // Was ohnehin hoch genug ist, braucht keine Probe. Die Probe ist nur da,
      // um Flaechen zu erkennen, die GROESSER sind als ihr Kasten.
      if (r.height >= 40) continue
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      // 19 statt 20: Bei einer Flaeche von genau 40 px liegt 20 px auf der
      // Kante, und dort entscheidet der Nachbar.
      if (trifft(el, x, y - 19) && trifft(el, x, y + 19)) continue
      klein.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.height)}px`)
    }

    // Diagrammbeschriftungen zaehlen nicht mit: Achsen duerfen kleiner sein,
    // sie werden gelesen, waehrend man auf die Kurve schaut, nicht fuer sich.
    const winzig = []
    for (const el of document.querySelectorAll('body *')) {
      if (el.ownerSVGElement || el.tagName === 'svg') continue
      if (!el.textContent?.trim() || el.children.length) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size && size < 12) {
        winzig.push(`${Math.round(size * 10) / 10}px .${el.className || el.tagName.toLowerCase()}: ${el.textContent.trim().slice(0, 24)}`)
      }
    }
    return { ueberstand, klein: [...new Set(klein)], winzig: [...new Set(winzig)] }
  })
}

async function main() {
  fs.mkdirSync(ZIEL, { recursive: true })
  const browser = await chromium.launch()
  const befunde = []

  for (const geraet of GERAETE) {
    for (const modus of MODI) {
      const ctx = await browser.newContext({
        viewport: geraet.viewport, colorScheme: modus,
        hasTouch: !!geraet.hasTouch, isMobile: !!geraet.isMobile,
      })
      const p = await ctx.newPage()
      await p.goto(DATEI)
      for (let i = 0; i < 200 && !(await p.$('.page')); i++) await p.waitForTimeout(100)
      await p.waitForTimeout(1500)
      await beispieldaten(p)

      const liste = [...seiten]
      if (mitUnterseiten && modus === 'light') liste.push(...Object.entries(UNTERSEITEN))
      for (const [name, hash] of liste) {
        await p.goto(DATEI + hash)
        await p.waitForTimeout(900)
        // Die Suche zeigt leer nur ein Eingabefeld – mit einem Begriff das, wofür sie da ist.
        if (name === 'suche') {
          await p.locator('input').first().fill('REWE')
          await p.waitForTimeout(700)
        }
        // Zuerst der erste Bildschirm – das, was man ohne Scrollen sieht.
        await p.screenshot({ path: path.join(ZIEL, `${name}-${geraet.name}-${modus}.png`) })
        if (geraet.name === 'handy' && modus === 'light') {
          befunde.push({ seite: name, ...(await messen(p)) })
        }
        // Dann die ganze Seite. Gescrollt wird in .content, nicht im Dokument –
        // `fullPage` allein sähe deshalb nur den ersten Bildschirm. Für die
        // Aufnahme wird die Höhenbegrenzung kurz aufgehoben.
        const lang = await p.addStyleTag({ content:
          'html,body,#root,.app,.main{height:auto!important;overflow:visible!important}' +
          '.content{overflow:visible!important;flex:none!important}' })
        await p.waitForTimeout(200)
        await p.screenshot({ path: path.join(ZIEL, `${name}-${geraet.name}-${modus}-lang.png`), fullPage: true })
        await lang.evaluate((el) => el.remove())
      }
      await ctx.close()
    }
  }
  await browser.close()

  console.log(`\nBilder in ${path.relative(WURZEL, ZIEL)}\n`)
  console.log('Handy (390 px), gemessen:')
  for (const b of befunde) {
    const teile = []
    if (b.ueberstand > 0) teile.push(`${b.ueberstand}px seitlich über den Rand`)
    if (b.klein.length) teile.push(`${b.klein.length} Antippfläche(n) unter 40px`)
    if (b.winzig.length) teile.push(`${b.winzig.length} Text(e) unter 12px`)
    console.log(`  ${b.seite.padEnd(14)} ${teile.length ? teile.join(' · ') : 'unauffällig'}`)
    for (const k of b.klein.slice(0, 3)) console.log(`      ${k}`)
    for (const w of b.winzig.slice(0, 3)) console.log(`      ${w}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
