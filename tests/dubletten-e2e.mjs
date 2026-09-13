/**
 * Doppelte Konten zusammenführen – im Browser, an einer echten Buchung.
 *
 * Die Unit-Tests prüfen die Entscheidung: welche Zeile bleibt und was umgehängt
 * werden muss. Was sie NICHT prüfen können, ist der Teil, bei dem es wehtut –
 * ob nach dem Klick das Geld noch da ist.
 *
 * Genau darum geht es hier. An Eriks zweiter GIVE-Card hingen 48,37 €. Wer beim
 * Aufräumen „die neuen einfach löscht", löscht sie mit, und es fällt erst auf,
 * wenn der Kontostand nicht mehr stimmt.
 *
 * Ablauf:
 *   1. Ein zweites Konto mit demselben Namen anlegen.
 *   2. Eine Buchung darauf setzen – das ist das, was verlorengehen könnte.
 *   3. Zusammenführen.
 *   4. Nachsehen: ein Konto weniger, Betrag noch da, Karte verschwunden.
 *
 * Aufruf:  node tests/dubletten-e2e.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATEI = 'file:///' + path.join(WURZEL, 'LifeHub.html').split(path.sep).join('/')

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
  else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehler++ }
}

async function warteAufApp(p, ms = 60000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(300)
  }
  return false
}

const geh = async (p, hash) => { await p.goto(DATEI + '#' + hash); await p.waitForTimeout(1500) }

/**
 * Wie viele Kontokarten tragen diesen Namen?
 *
 * Nicht über den Seitentext gezählt: Dort steht der Name zweimal je Karte –
 * einmal als Überschrift, einmal als Kontoart. Ein Zähler darauf meldete
 * doppelt so viele Konten, wie es gibt, und der Test wäre von Anfang an rot,
 * ohne dass irgendetwas kaputt wäre.
 */
async function anzahlKonten(p, name) {
  await geh(p, '/finanzen/konten')
  await p.waitForTimeout(900)
  return await p.evaluate(
    (n) => [...document.querySelectorAll('.card')]
      .filter((c) => (c.innerText.split('\n')[1] ?? '').trim() === n).length,
    name,
  )
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-dub-'))
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profil'), {
    viewport: { width: 1400, height: 1000 },
  })
  const p = ctx.pages()[0] ?? await ctx.newPage()
  const konsole = []
  p.on('pageerror', (e) => konsole.push(String(e)))

  console.log('\n=== Doppelte Konten zusammenführen ===\n')

  await p.goto(DATEI)
  pruefe('App startet', await warteAufApp(p))
  await p.waitForTimeout(2500)

  /* ------------------------------------------ 1. Zweites „Bargeld" anlegen */
  const vorher = await anzahlKonten(p, 'Bargeld')
  pruefe('Zunächst gibt es genau ein Bargeld-Konto', vorher === 1, `${vorher}`)

  await p.locator('button', { hasText: '+ Konto' }).first().click()
  await p.waitForTimeout(900)
  await p.locator('.modal input').first().fill('Bargeld')
  // Auch den Kontotyp setzen. Gleicher Name bei anderem Typ gilt absichtlich
  // NICHT als Dublette - ein Giro "Ruecklage" und ein Sparkonto "Ruecklage"
  // sind zwei Konten. Erik's Faelle kamen beide aus demselben Beispielbestand,
  // hatten also denselben Typ; genau das stellt der Test nach.
  await p.locator('.modal select').first().selectOption({ label: 'Bargeld' })
  await p.waitForTimeout(300)
  await p.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await p.waitForTimeout(1800)

  const doppelt = await anzahlKonten(p, 'Bargeld')
  pruefe('Jetzt steht Bargeld doppelt da', doppelt === 2, `${doppelt}`)

  /* --------------------------------------- 2. Buchung auf das zweite Konto */
  await geh(p, '/finanzen/buchungen')
  await p.locator('button', { hasText: '+ Buchung' }).first().click()
  await p.waitForTimeout(1200)

  await p.locator('.modal .field', { hasText: 'Betrag' }).locator('input').first().fill('48,37')
  await p.waitForTimeout(300)

  // Die Kontoauswahl ist die Liste, in der die Konten stehen. Das eben
  // angelegte Bargeld ist dort der LETZTE Eintrag dieses Namens.
  const gewaehlt = await p.evaluate(() => {
    const sel = [...document.querySelectorAll('.modal select')]
      .find((s) => [...s.options].some((o) => o.text.includes('Bargeld')))
    if (!sel) return null
    const treffer = [...sel.options].map((o, i) => [o.text, i])
      .filter(([t]) => String(t).includes('Bargeld'))
    if (!treffer.length) return null
    sel.selectedIndex = treffer[treffer.length - 1][1]
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return String(treffer[treffer.length - 1][0])
  })
  pruefe('Die Buchung geht auf das zweite Bargeld-Konto', gewaehlt !== null, String(gewaehlt))
  await p.waitForTimeout(400)

  await p.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await p.waitForTimeout(2000)

  const mitBuchung = await p.evaluate(() => document.body.innerText)
  pruefe('Die Buchung ist angelegt', /48,37/.test(mitBuchung))

  /* --------------------------------------------------- 3. Zusammenführen */
  await geh(p, '/einstellungen/sync')
  await p.waitForTimeout(1500)
  const karte = p.locator('.card', { hasText: 'Doppelte Konten und Kategorien' })
  pruefe('Die Aufräumkarte erscheint von selbst', await karte.count() > 0)

  const kartentext = await karte.first().innerText().catch(() => '')
  pruefe('Sie nennt das betroffene Konto', /Bargeld/.test(kartentext))
  pruefe('Sie kündigt an, dass etwas umgehängt wird', /zieh|Eintr/i.test(kartentext),
    (kartentext.split('\n').find((z) => /zieh|Eintr/i.test(z)) ?? '').trim())

  await karte.locator('button', { hasText: 'Zusammenführen' }).first().click()
  await p.waitForTimeout(2500)

  // Die Rückmeldung kommt als Hinweis der App, nicht aus der Karte: Die ist in
  // diesem Moment schon verschwunden, weil nichts mehr doppelt ist. Stünde der
  // Text nur dort, hätte der Knopf aus Sicht des Nutzers einfach nichts getan.
  const meldung = await p.evaluate(() => document.body.innerText)
  pruefe('Die App meldet, was geschehen ist', /aufgeloest|aufgelöst/i.test(meldung),
    (meldung.split('\n').find((z) => /aufgeloest|aufgelöst/i.test(z)) ?? '(keine)').trim())

  /* --------------------------------------------------------- 4. Nachsehen */
  const nachher = await anzahlKonten(p, 'Bargeld')
  pruefe('Bargeld steht wieder genau einmal da', nachher === 1, `${nachher}`)

  const kontenText = await p.evaluate(() => document.body.innerText)
  pruefe('Die 48,37 € sind noch da', /48,37/.test(kontenText),
    /48,37/.test(kontenText) ? 'am verbliebenen Konto' : 'VERLOREN')

  await geh(p, '/finanzen/buchungen')
  await p.waitForTimeout(1200)
  const buchungen = await p.evaluate(() => document.body.innerText)
  pruefe('Die Buchung selbst steht noch in der Liste', /48,37/.test(buchungen))

  await geh(p, '/einstellungen/sync')
  await p.waitForTimeout(1500)
  const wieder = await p.locator('.card', { hasText: 'Doppelte Konten und Kategorien' }).count()
  pruefe('Die Karte ist danach verschwunden', wieder === 0)

  pruefe('Keine Fehler in der Konsole', konsole.length === 0, konsole.slice(0, 2).join(' | '))

  await ctx.close()
  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
