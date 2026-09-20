/**
 * Turnen, Phase 1: Element anlegen, Training erfassen, beides wiederfinden.
 *
 * Die Kernlogik ist in `turnen-elemente.test.ts` und `turnen-sicherheit.test.ts`
 * einzeln nachgerechnet. Hier geht es um das, was Unit-Tests nicht zeigen: ob
 * der Erfassungsweg im echten Browser in wenigen Berührungen durchläuft, ob
 * die Zahlen danach auf der Übersicht stehen, ob ein zweites Speichern keine
 * Dublette erzeugt – und ob das Handy dieselbe Einheit sieht.
 *
 * Aufruf:  node tests/turnen-e2e.mjs
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54396 })
const web = await starteWebserver(8089)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')

/** Ein Element über die Oberfläche anlegen. */
async function legeElementAn(g, { name, geraet, buchstabe }) {
  await geh(g, '/turnen/elemente', 1500)
  const knopf = g.page.locator('button', { hasText: /^\+ (Element|Erstes Element)$/ }).first()
  await knopf.click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  if (buchstabe) {
    await g.page.locator('.modal .field', { hasText: 'Schwierigkeit' }).locator('input').first().fill(buchstabe)
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1200)
}

/**
 * Ein Training erfassen – und dabei zählen, wie viele Berührungen es kostet.
 * Das ist der eigentliche Prüfgegenstand dieses Moduls.
 */
async function erfasseTraining(g, { geraet, tipps }) {
  let beruehrungen = 0
  await geh(g, '/turnen/training', 1500)
  await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  beruehrungen++
  await g.page.waitForTimeout(800)

  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  beruehrungen++
  await g.page.waitForTimeout(600)

  for (const [elementName, anzahl] of Object.entries(tipps)) {
    const zeile = g.page.locator('.turn-zeile', { hasText: elementName }).first()
    for (let i = 0; i < anzahl; i++) {
      await zeile.locator('.turn-zaehler-knopf').first().click()
      beruehrungen++
    }
  }

  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  beruehrungen++
  await g.page.waitForTimeout(1500)
  return beruehrungen
}

let pc, handy
try {
  /* ------------------------------------------------------ Bereich da? */
  pc = await starteGeraet({ name: 'turnen-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)
  await geh(pc, '/turnen', 2000)
  const start = await text(pc)
  pruefe('Der Bereich Turnen ist erreichbar', /Turnen/.test(start))
  pruefe('Er zeigt die drei Reiter',
    /Übersicht/.test(start) && /Elemente/.test(start) && /Training/.test(start))

  /* --------------------------------------------------- Elemente anlegen */
  await legeElementAn(pc, { name: 'Doppelsalto', geraet: 'Boden', buchstabe: 'D' })
  await legeElementAn(pc, { name: 'Flick-Flack', geraet: 'Boden', buchstabe: 'A' })
  await legeElementAn(pc, { name: 'Kippe', geraet: 'Reck', buchstabe: 'A' })

  await geh(pc, '/turnen/elemente', 1500)
  const liste = await text(pc)
  pruefe('Alle drei Elemente stehen in der Liste',
    /Doppelsalto/.test(liste) && /Flick-Flack/.test(liste) && /Kippe/.test(liste))
  pruefe('Ein frisches Element gilt als „nie trainiert"', /nie trainiert/.test(liste))
  pruefe('Der Status steht dabei', /Neu/.test(liste))

  /* -------------------------------------------------- Nach Gerät filtern */
  await pc.page.locator('.chip', { hasText: 'Reck' }).first().click()
  await pc.page.waitForTimeout(800)
  const nurReck = await text(pc)
  pruefe('Der Gerätefilter blendet andere Geräte aus',
    /Kippe/.test(nurReck) && !/Doppelsalto/.test(nurReck))
  await pc.page.locator('.chip', { hasText: 'Alle' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ------------------------------------------------- Training erfassen */
  const beruehrungen = await erfasseTraining(pc, {
    geraet: 'Boden',
    tipps: { 'Doppelsalto': 3, 'Flick-Flack': 2 },
  })
  // Zwei Elemente, fuenf gelungene Versuche: oeffnen + Geraet + 5 Tipps +
  // speichern = 8. Mehr als zehn hiesse, der Weg ist zu lang.
  pruefe('Das Erfassen kostet wenige Berührungen', beruehrungen <= 10, `${beruehrungen} Berührungen`)

  const nachTraining = await text(pc)
  pruefe('Die Einheit steht in der Liste', /Boden/.test(nachTraining))
  pruefe('Mit der Zahl der Versuche', /5 Versuche/.test(nachTraining), nachTraining.match(/[^\n]*Versuche[^\n]*/)?.[0])

  /* --------------------------------------- Elementliste kennt das Training */
  await geh(pc, '/turnen/elemente', 1500)
  const nachher = await text(pc)
  pruefe('Das trainierte Element gilt jetzt als „heute trainiert"', /heute trainiert/.test(nachher))
  pruefe('Das untrainierte Element bleibt „nie trainiert"', /nie trainiert/.test(nachher))

  /* ---------------------------------------------------- Die Übersicht */
  await geh(pc, '/turnen', 2000)
  const uebersicht = await text(pc)
  pruefe('Die Übersicht nennt die letzte Einheit', /Letzte Einheit/.test(uebersicht))
  pruefe('Sie zeigt alle sechs Geräte',
    ['Boden', 'Pauschenpferd', 'Ringe', 'Sprung', 'Barren', 'Reck'].every((g) => uebersicht.includes(g)))
  pruefe('Sie nennt, was lange nicht dran war', /Lange nicht trainiert/.test(uebersicht))
  pruefe('Und was noch Arbeit braucht', /Braucht noch Arbeit/.test(uebersicht))

  /* --------------------------------- Zweimal speichern: keine Dubletten */
  await abgleich(pc)
  const nachErstem = server.zeilen('gym_attempts').length
  pruefe('Auf dem Server liegen zwei Versuchszeilen', nachErstem === 2, `${nachErstem} Zeilen`)

  // Dieselbe Einheit oeffnen und unveraendert wieder speichern.
  await geh(pc, '/turnen/training', 1500)
  await pc.page.locator('.list-row').first().click()
  await pc.page.waitForTimeout(900)
  await pc.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await pc.page.waitForTimeout(1500)
  await abgleich(pc)

  const nachZweitem = server.zeilen('gym_attempts').length
  pruefe('Ein zweites Speichern erzeugt KEINE Dublette',
    nachZweitem === nachErstem, `${nachErstem} vorher, ${nachZweitem} nachher`)

  const einheiten = server.zeilen('workout_sessions').filter((s) => s.discipline === 'turnen')
  pruefe('Und auch keine zweite Einheit', einheiten.length === 1, `${einheiten.length} Einheiten`)

  /* ------------------------------- Einheit OHNE Einzelversuche */
  await geh(pc, '/turnen/training', 1500)
  await pc.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal .turn-geraet', { hasText: 'Ringe' }).first().click()
  await pc.page.waitForTimeout(500)
  await pc.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await pc.page.waitForTimeout(1500)
  const ohneVersuche = await text(pc)
  pruefe('Eine Einheit ohne einen einzigen Versuch lässt sich speichern', /Ringe/.test(ohneVersuche))

  await abgleich(pc)
  pruefe('Sie legt dabei keine Versuchszeile an',
    server.zeilen('gym_attempts').length === nachZweitem)

  /* ------------------------------------------- Das Handy sieht dasselbe */
  handy = await starteGeraet({ name: 'turnen-handy', url: web.url, viewport: { width: 390, height: 844 } })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)

  await geh(handy, '/turnen/elemente', 2000)
  const handyElemente = await text(handy)
  pruefe('Handy sieht dieselben Elemente',
    /Doppelsalto/.test(handyElemente) && /Kippe/.test(handyElemente))

  await geh(handy, '/turnen/training', 2000)
  const handyTraining = await text(handy)
  pruefe('Handy sieht dieselbe Einheit', /5 Versuche/.test(handyTraining))

  /* ------------------------------ Kein seitliches Wegrutschen am Handy */
  await geh(handy, '/turnen', 2000)
  const breite = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    fenster: window.innerWidth,
  }))
  pruefe('Kein seitliches Wegrutschen auf 390 px',
    breite.doc <= breite.fenster + 1, `${breite.doc} px Inhalt, ${breite.fenster} px Fenster`)

  /* -------------------------------- Zählerflächen sind gross genug */
  await geh(handy, '/turnen/training', 1500)
  await handy.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await handy.page.waitForTimeout(800)
  await handy.page.locator('.modal .turn-geraet', { hasText: 'Boden' }).first().click()
  await handy.page.waitForTimeout(600)
  const hoehe = await handy.page.locator('.turn-zaehler-knopf').first().evaluate((el) => el.getBoundingClientRect().height)
  pruefe('Die Zählerflächen sind mindestens 56 px hoch', hoehe >= 56, `${Math.round(hoehe)} px`)

  /* ------------------------------------------------- Konsolenfehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
} finally {
  await pc?.stop()
  await handy?.stop()
  await web.stop()
  await server.stop()
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
