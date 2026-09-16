/**
 * Die Umbuchung im echten Browser, gegen die gebaute App.
 *
 * Der Unit-Test in tests/umbuchung.test.ts prüft die Regel. Er kann aber nicht
 * prüfen, was Erik gemeldet hat: dass der Speichern-Knopf blass bleibt. Genau
 * das entstand erst im Zusammenspiel von Zustand und Auswahlliste – die Liste
 * zeigte ein Zielkonto, der Zustand hatte keines. Deshalb hier der echte Weg:
 * „＋" antippen, Transfer wählen, Betrag tippen, auf den Knopf sehen, speichern
 * und nachrechnen, ob das Geld wirklich von einem Konto zum anderen gewandert
 * ist, ohne dass eine Einnahme oder Ausgabe daraus wurde.
 *
 * Aufruf:  node tests/umbuchung-e2e.mjs   (vorher: npm run build:single)
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

async function warteAuf(page, fn, ms = 30000, was = 'Bedingung') {
  const bis = Date.now() + ms
  for (;;) {
    if (await page.evaluate(fn)) return true
    if (Date.now() > bis) { console.log(`  ! Zeitüberschreitung: ${was}`); return false }
    await page.waitForTimeout(250)
  }
}

const HAT_APP = () => !!document.querySelector('.page')

/** Alle Kontosalden, so wie sie auf der Kontenseite stehen. */
async function salden(page, warteAufFn) {
  await page.goto(DATEI + '#/finanzen/konten')
  await page.reload()
  await warteAufFn(page, HAT_APP, 40000, 'Kontenseite')
  await page.waitForTimeout(2500)
  return page.evaluate(() => {
    const out = {}
    for (const kopf of document.querySelectorAll('.konto-kopf')) {
      const name = kopf.querySelector('.list-title')?.textContent?.trim()
      const betrag = kopf.querySelector('.stat-value')?.textContent?.trim()
      if (name && betrag) out[name] = betrag
    }
    return out
  })
}

function zuCent(text) {
  if (!text) return null
  const m = text.replace(/\s| |€/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(m)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })

  const konsolenfehler = []
  page.on('console', (m) => { if (m.type() === 'error') konsolenfehler.push(m.text()) })
  page.on('pageerror', (e) => konsolenfehler.push(String(e)))

  console.log('\n=== Umbuchung im Browser ===\n')
  await page.goto(DATEI + '#/finanzen')
  await warteAuf(page, HAT_APP, 40000, 'App startet')
  pruefe('App startet', await page.evaluate(HAT_APP))

  const vorher = await salden(page, warteAuf)
  const kontoNamen = Object.keys(vorher)
  pruefe('Es gibt mindestens zwei Konten', kontoNamen.length >= 2, `(${kontoNamen.join(', ')})`)

  /* ----------------------------------------- 1. Umbuchung anlegen */
  await page.goto(DATEI + '#/finanzen')
  await page.reload()
  await warteAuf(page, HAT_APP, 40000, 'Finanzseite')
  await page.waitForTimeout(1500)
  await page.locator('.fab').first().click()
  await page.waitForTimeout(400)
  await page.locator('.modal button', { hasText: 'Buchung' }).first().click()
  await page.waitForTimeout(400)

  await page.locator('.modal .chip', { hasText: 'Transfer' }).first().click()
  await page.waitForTimeout(400)

  const auswahlListen = page.locator('.modal select.select')
  pruefe('Transfer zeigt zwei Kontoauswahlen', await auswahlListen.count() >= 2)

  // Genau der gemeldete Fall: nichts an den Auswahllisten anfassen, nur den
  // Betrag tippen. Vorher blieb der Knopf danach blass.
  await page.locator('.modal input[inputmode=decimal], .modal input.input').first().fill('')
  await page.keyboard.type('15000') // Kasseneingabe: 150,00 €
  await page.waitForTimeout(500)

  const knopf = page.locator('.modal button', { hasText: /^Speichern$/ }).first()
  const gesperrt = await knopf.isDisabled()
  pruefe('Speichern ist NICHT gesperrt (der gemeldete Fehler)', !gesperrt)

  const vonKonto = await auswahlListen.nth(0).evaluate((el) => el.options[el.selectedIndex]?.text?.trim())
  const zielKonto = await auswahlListen.nth(1).evaluate((el) => el.options[el.selectedIndex]?.text?.trim())
  pruefe('Quell- und Zielkonto sind verschieden', vonKonto !== zielKonto, `(${vonKonto} -> ${zielKonto})`)

  if (gesperrt) {
    console.log('\n=== FEHLGESCHLAGEN: Umbuchung ist nicht speicherbar ===\n')
    await browser.close()
    process.exit(1)
  }

  await knopf.click()
  await page.waitForTimeout(1500)

  /* ----------------------------------------- 2. Wirkung nachrechnen */
  const nachher = await salden(page, warteAuf)

  const nameOhneIcon = (s) => s.replace(/^[^\p{L}\d]+/u, '').trim()
  const findeSaldo = (stand, name) => {
    for (const [k, v] of Object.entries(stand)) if (nameOhneIcon(k) === nameOhneIcon(name)) return zuCent(v)
    return null
  }

  const vonVorher = findeSaldo(vorher, vonKonto)
  const vonNachher = findeSaldo(nachher, vonKonto)
  const zielVorher = findeSaldo(vorher, zielKonto)
  const zielNachher = findeSaldo(nachher, zielKonto)

  if (vonVorher === null || zielVorher === null) {
    pruefe('Salden beider Konten ablesbar', false, `(${vonKonto}: ${vonVorher}, ${zielKonto}: ${zielVorher})`)
  } else {
    pruefe('Quellkonto ist um 150,00 € kleiner', vonNachher - vonVorher === -15000,
      `(${vonVorher} -> ${vonNachher})`)
    pruefe('Zielkonto ist um 150,00 € größer', zielNachher - zielVorher === +15000,
      `(${zielVorher} -> ${zielNachher})`)
    pruefe('Das Nettovermögen bleibt gleich',
      (vonNachher + zielNachher) === (vonVorher + zielVorher))
  }

  /* --------------------------------- 3. In der Liste sichtbar, 4. bearbeitbar */
  await page.goto(DATEI + '#/finanzen/buchungen')
  await page.reload()
  await warteAuf(page, HAT_APP, 40000, 'Buchungsliste')
  await page.waitForTimeout(2000)
  const alsTransfer = await page.evaluate(() => document.body.innerText.includes('Transfer')
    || document.body.innerText.includes('Umbuchung'))
  pruefe('Die Umbuchung taucht in den Buchungen auf', alsTransfer)
  const transferZeile = page.locator('.list-row', { hasText: /Transfer|Umbuchung/ }).first()
  if (await transferZeile.count() > 0) {
    await transferZeile.click()
    await page.waitForTimeout(700)
    const speichernKnopf = page.locator('.modal button', { hasText: 'Änderungen speichern' }).first()
    pruefe('Eine bestehende Umbuchung lässt sich bearbeiten',
      await speichernKnopf.count() > 0 && !(await speichernKnopf.isDisabled()))
  } else {
    pruefe('Eine bestehende Umbuchung lässt sich bearbeiten', false, '(keine Transferzeile gefunden)')
  }

  pruefe('Keine Fehler in der Konsole', konsolenfehler.length === 0, konsolenfehler.slice(0, 2).join(' | '))

  await browser.close()
  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
