/**
 * Turnen, Phase 2A: Küren anlegen, ordnen, markieren – und wiederfinden.
 *
 * Die Kernlogik ist in `turnen-kueren.test.ts` einzeln nachgerechnet. Hier
 * geht es um das, was Unit-Tests nicht zeigen:
 *
 *   - Überlebt eine von Hand gesetzte Reihenfolge das Speichern und das
 *     erneute Öffnen?
 *   - Deaktiviert sich die alte Wettkampfkür wirklich, wenn eine neue
 *     markiert wird – und bleibt das Nachbargerät davon unberührt?
 *   - Erzeugt ein zweites Speichern eine Dublette?
 *   - Was passiert, wenn PC und Handy OFFLINE je eine andere Kür desselben
 *     Geräts markieren und danach abgleichen? Das ist der eigentliche
 *     Prüfgegenstand: Danach darf es genau EINE aktive geben, und beide
 *     Geräte müssen dieselbe zeigen.
 *
 * Aufruf:  node tests/turnen-kueren-e2e.mjs
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

const server = await starteNachbau({ port: 54397 })
const web = await starteWebserver(8091)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')

/** Einen Eintragstext in seine Zeilen zerlegen, ohne Leerraum am Rand. */
const zerlege = (t) => String(t).trim().split(/\r?\n/).map((z) => z.trim()).filter(Boolean)

/* --------------------------------------------------------------- Hilfen */

async function legeElementAn(g, { name, geraet, buchstabe, wert }) {
  await geh(g, '/turnen/elemente', 1400)
  await g.page.locator('button', { hasText: /^\+ (Element|Erstes Element)$/ }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  if (buchstabe) {
    await g.page.locator('.modal .field', { hasText: 'Schwierigkeit' }).locator('input').first().fill(buchstabe)
  }
  if (wert) {
    await g.page.locator('.modal .field', { hasText: 'Wert' }).locator('input').first().fill(wert)
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1100)
}

/** Den Kür-Editor öffnen: entweder neu oder über die Zeile mit diesem Namen. */
async function oeffneKuer(g, name) {
  await geh(g, '/turnen/kueren', 1400)
  if (name) {
    await g.page.locator('.list-row', { hasText: name }).first().click()
  } else {
    await g.page.locator('button', { hasText: /^\+ (Kür|Erste Kür)$/ }).first().click()
  }
  await g.page.waitForTimeout(800)
}

/**
 * Die Elementnamen in der Reihenfolge, in der sie im Editor stehen.
 *
 * Nur der Name, ohne die Schwierigkeit daneben - `.kuer-name` enthaelt beides.
 */
async function folge(g) {
  return (await g.page.locator('.modal .kuer-zeile .kuer-name-text').allInnerTexts())
    .map((t) => t.trim())
}

async function elementeHinzufuegen(g, namen) {
  await g.page.locator('.modal button', { hasText: '+ Element' }).first().click()
  await g.page.waitForTimeout(800)
  // Der Waehler liegt ueber dem Editor - das zuletzt geoeffnete Fenster.
  const waehler = g.page.locator('.modal').last()
  for (const n of namen) {
    await waehler.locator('.list-row', { hasText: n }).first().click()
    await g.page.waitForTimeout(250)
  }
  await waehler.locator('button', { hasText: 'Fertig' }).first().click()
  await g.page.waitForTimeout(700)
}

async function speichere(g) {
  await g.page.locator('.modal').last().locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1400)
}

/** Eine Kür anlegen, mit Namen, Gerät und Elementen. */
async function legeKuerAn(g, { name, geraet, elemente = [], wettkampf = false }) {
  await oeffneKuer(g, null)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(400)
  if (elemente.length) await elementeHinzufuegen(g, elemente)
  if (wettkampf) {
    await g.page.locator('.modal label', { hasText: 'Aktive Wettkampfkür' })
      .locator('input[type=checkbox]').first().check()
  }
  await speichere(g)
}

/**
 * Steht diese Kuer in der Liste als Wettkampfkuer?
 *
 * Geprueft wird die LETZTE Zeile des Eintrags - dort steht die Marke. Ein
 * blosses Suchen nach dem Wort waere wertlos, sobald eine Kuer "Wettkampf"
 * im Namen traegt; genau daran ist diese Pruefung schon einmal
 * vorbeigelaufen und hat alles bestanden.
 */
async function istWettkampf(g, name) {
  await geh(g, '/turnen/kueren', 1300)
  const zeile = g.page.locator('.list-row', { hasText: name }).first()
  if (!(await zeile.count())) return null
  const zeilen = zerlege(await zeile.innerText())
  return zeilen[zeilen.length - 1] === 'Wettkampfkür'
}

let pc, handy
try {
  /* ==================================================== Reiter erreichbar */
  pc = await starteGeraet({ name: 'kueren-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await geh(pc, '/turnen', 1800)
  const reiter = await text(pc)
  pruefe('Der Bereich Turnen zeigt jetzt vier Reiter',
    ['Übersicht', 'Elemente', 'Training', 'Küren'].every((r) => reiter.includes(r)))

  await geh(pc, '/turnen/kueren', 1500)
  pruefe('Der Reiter Küren ist leer und sagt das auch', /Noch keine Kür/.test(await text(pc)))

  /* ------------------------------------------------ Elementkatalog fuellen */
  await legeElementAn(pc, { name: 'Rondat', geraet: 'Boden', buchstabe: 'A', wert: '0,1' })
  await legeElementAn(pc, { name: 'Flick-Flack', geraet: 'Boden', buchstabe: 'A', wert: '0,1' })
  await legeElementAn(pc, { name: 'Doppelsalto', geraet: 'Boden', buchstabe: 'D', wert: '0,4' })
  await legeElementAn(pc, { name: 'Schraubensalto', geraet: 'Boden', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Auerbachsalto', geraet: 'Boden', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Stützkehre', geraet: 'Barren', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Felge', geraet: 'Barren', buchstabe: 'A', wert: '0,1' })

  /* ================================= Neue Bodenkuer mit fuenf Elementen */
  await oeffneKuer(pc, null)
  await pc.page.locator('.modal input').first().fill('Große Bodenkür')
  await pc.page.locator('.modal .turn-geraet', { hasText: 'Boden' }).first().click()
  await pc.page.waitForTimeout(400)

  await pc.page.locator('.modal button', { hasText: '+ Element' }).first().click()
  await pc.page.waitForTimeout(800)
  const waehler = pc.page.locator('.modal').last()
  const angeboten = await waehler.innerText()
  pruefe('Der Wähler zeigt nur Elemente des Geräts',
    /Rondat/.test(angeboten) && !/Stützkehre/.test(angeboten))
  pruefe('Mit Status und Schwierigkeit', /Neu/.test(angeboten) && /A 0,1/.test(angeboten))

  await waehler.locator('input[placeholder="Suchen…"]').fill('salto')
  await pc.page.waitForTimeout(500)
  const gesucht = await waehler.innerText()
  pruefe('Die Suche filtert', /Doppelsalto/.test(gesucht) && !/Rondat/.test(gesucht))
  await waehler.locator('input[placeholder="Suchen…"]').fill('')
  await pc.page.waitForTimeout(400)

  for (const n of ['Rondat', 'Flick-Flack', 'Doppelsalto', 'Schraubensalto', 'Auerbachsalto']) {
    await waehler.locator('.list-row', { hasText: n }).first().click()
    await pc.page.waitForTimeout(250)
  }
  pruefe('Der Wähler bleibt offen und zählt mit',
    /5 Elemente aufgenommen/.test(await waehler.innerText()))
  await waehler.locator('button', { hasText: 'Fertig' }).first().click()
  await pc.page.waitForTimeout(700)

  const nachAufnahme = await folge(pc)
  pruefe('Fünf Elemente stehen in der Kür', nachAufnahme.length === 5, nachAufnahme.join(' · '))

  const summenZeile = await pc.page.locator('.modal .kuer-kopf-wert').first().innerText()
  pruefe('Die Summe heisst „Schwierigkeitssumme der Elemente"',
    /Schwierigkeitssumme der Elemente/.test(summenZeile), summenZeile)
  pruefe('Sie ist NICHT als D-Wert oder D-Note bezeichnet',
    !/D-Wert|D-Note/.test(summenZeile), summenZeile)
  pruefe('Und sie stimmt – 0,1+0,1+0,4+0,3+0,2 = 1,1',
    /1,1/.test(summenZeile), summenZeile)

  /* -------------------------------------------- Reihenfolge veraendern */
  // Doppelsalto (Platz 3) ans Ende: zweimal nach unten.
  const dritte = pc.page.locator('.modal .kuer-zeile').nth(2)
  await dritte.locator('button[aria-label="nach unten"]').click()
  await pc.page.waitForTimeout(250)
  await pc.page.locator('.modal .kuer-zeile').nth(3).locator('button[aria-label="nach unten"]').click()
  await pc.page.waitForTimeout(250)

  const gewuenscht = await folge(pc)
  pruefe('Das Verschieben ändert die Reihenfolge',
    gewuenscht[4] === 'Doppelsalto', gewuenscht.join(' · '))

  const hoehe = await pc.page.locator('.modal .kuer-knopf').first()
    .evaluate((el) => el.getBoundingClientRect().height)
  pruefe('Die Ordnungsknöpfe sind mindestens 44 px hoch', hoehe >= 44, `${Math.round(hoehe)} px`)

  const obersterAus = await pc.page.locator('.modal .kuer-zeile').first()
    .locator('button[aria-label="nach oben"]').isDisabled()
  pruefe('Am oberen Rand ist „nach oben" abgeschaltet', obersterAus)

  await speichere(pc)

  /* -------------------------------- Neu oeffnen: dieselbe Reihenfolge */
  await oeffneKuer(pc, 'Große Bodenkür')
  const wieder = await folge(pc)
  pruefe('Nach dem erneuten Öffnen steht dieselbe Reihenfolge',
    JSON.stringify(wieder) === JSON.stringify(gewuenscht),
    `${gewuenscht.join(' · ')}  ->  ${wieder.join(' · ')}`)

  /* ------------------------------------------------- Element entfernen */
  await pc.page.locator('.modal .kuer-zeile', { hasText: 'Auerbachsalto' })
    .first().locator('button[aria-label="entfernen"]').click()
  await pc.page.waitForTimeout(300)
  const nachEntfernen = await folge(pc)
  pruefe('Ein Element lässt sich entfernen',
    nachEntfernen.length === 4 && !nachEntfernen.includes('Auerbachsalto'),
    nachEntfernen.join(' · '))
  const summeDanach = await pc.page.locator('.modal .kuer-kopf-wert').first().innerText()
  pruefe('Die Summe zieht sofort nach – 0,9', /0,9/.test(summeDanach), summeDanach)
  await speichere(pc)

  await geh(pc, '/turnen/kueren', 1300)
  pruefe('Die Liste nennt die Zahl der Elemente',
    /4 Elemente/.test(await text(pc)))

  /* ----------------------------- Zweites Speichern ohne Aenderung */
  await abgleich(pc)
  const nachErstem = server.zeilen('gym_routine_elements').filter((z) => !z.deleted_at).length
  pruefe('Auf dem Server liegen vier Kürplätze', nachErstem === 4, `${nachErstem} Zeilen`)

  await oeffneKuer(pc, 'Große Bodenkür')
  await speichere(pc)
  await abgleich(pc)
  const nachZweitem = server.zeilen('gym_routine_elements').filter((z) => !z.deleted_at).length
  pruefe('Ein zweites Speichern erzeugt KEINE Dublette',
    nachZweitem === nachErstem, `${nachErstem} vorher, ${nachZweitem} nachher`)
  pruefe('Und auch keine zweite Kür',
    server.zeilen('gym_routines').filter((z) => !z.deleted_at).length === 1)

  /* ============================================== Aktive Wettkampfkuer */
  await oeffneKuer(pc, 'Große Bodenkür')
  await pc.page.locator('.modal label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().check()
  await speichere(pc)
  pruefe('Die erste Bodenkür ist die Wettkampfkür', await istWettkampf(pc, 'Große Bodenkür'))

  await legeKuerAn(pc, {
    name: 'Trainingsvariante', geraet: 'Boden',
    elemente: ['Rondat', 'Flick-Flack', 'Schraubensalto'],
  })
  pruefe('Eine zweite Bodenkür steht daneben',
    /Trainingsvariante/.test(await text(pc)))
  pruefe('Sie ist noch keine Wettkampfkür', (await istWettkampf(pc, 'Trainingsvariante')) === false)

  // Die zweite markieren - die erste muss sich von selbst deaktivieren.
  await oeffneKuer(pc, 'Trainingsvariante')
  await pc.page.locator('.modal label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().check()
  await speichere(pc)

  pruefe('Die zweite Kür ist jetzt die Wettkampfkür', await istWettkampf(pc, 'Trainingsvariante'))
  pruefe('Die erste wurde dabei deaktiviert',
    (await istWettkampf(pc, 'Große Bodenkür')) === false)

  await geh(pc, '/turnen/kueren', 1300)
  const bodenZeilen = await pc.page.locator('.card', { hasText: 'Boden' })
    .locator('.list-row').allInnerTexts()
  const bodenAktive = bodenZeilen.map(zerlege)
    .filter((z) => z[z.length - 1] === 'Wettkampfkür').map((z) => z[0])
  pruefe('Am Boden steht genau eine Wettkampfkür',
    bodenAktive.length === 1, `${bodenAktive.length}: ${bodenAktive.join(', ')}`)

  /* ------------------------------ Barren darf gleichzeitig aktiv sein */
  await legeKuerAn(pc, {
    name: 'Barrenkür', geraet: 'Barren',
    elemente: ['Stützkehre', 'Felge'], wettkampf: true,
  })
  pruefe('Die Barrenkür ist ebenfalls Wettkampfkür', await istWettkampf(pc, 'Barrenkür'))
  pruefe('Und die Bodenkür bleibt es trotzdem', await istWettkampf(pc, 'Trainingsvariante'))

  /* ------------------------------------- Gruppierung und Darstellung */
  const liste = await text(pc)
  pruefe('Die Liste gruppiert nach Gerät', /Boden/.test(liste) && /Barren/.test(liste))
  pruefe('Sie nennt die Schwierigkeitssumme je Kür', /Summe 0,9/.test(liste),
    liste.split(/\r?\n/).find((z) => /Summe/.test(z)))
  pruefe('Und weist auf noch nicht sichere Elemente hin', /neue Elemente/.test(liste))

  /* ===================================== Geloeschtes Element in der Kuer */
  await geh(pc, '/turnen/elemente', 1400)
  await pc.page.locator('.list-row', { hasText: 'Schraubensalto' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  const warnung = await pc.page.locator('.modal').last().innerText()
  pruefe('Das Löschen nennt die Küren, in denen das Element steht',
    /Trainingsvariante/.test(warnung), warnung.split(/\r?\n/).slice(0, 4).join(' | '))
  pruefe('Und weist auf Archivieren als verlustfreien Weg hin', /Aktiv/.test(warnung))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(1300)

  await oeffneKuer(pc, 'Trainingsvariante')
  const mitLuecke = await pc.page.locator('.modal').first().innerText()
  pruefe('Die Kür bleibt lesbar und behält den Platz',
    /Gelöschtes Element/.test(mitLuecke))
  pruefe('Die Summe täuscht dabei keine Vollständigkeit vor',
    /ohne Wert/.test(mitLuecke),
    mitLuecke.split(/\r?\n/).find((z) => /Schwierigkeitssumme/.test(z)))
  const nochDa = await folge(pc)
  pruefe('Es fehlt keine Zeile', nochDa.length === 3, nochDa.join(' · '))
  await pc.page.locator('.modal').first().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ================================================= Das Handy sieht es */
  await abgleich(pc)
  handy = await starteGeraet({ name: 'kueren-handy', url: web.url, viewport: { width: 390, height: 844 } })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)

  await geh(handy, '/turnen/kueren', 2000)
  const amHandy = await text(handy)
  pruefe('Handy sieht dieselben Küren',
    /Trainingsvariante/.test(amHandy) && /Barrenkür/.test(amHandy))
  pruefe('Und dieselbe Wettkampfkür', await istWettkampf(handy, 'Trainingsvariante'))

  await oeffneKuer(handy, 'Große Bodenkür')
  const handyFolge = await folge(handy)
  // Der Schraubensalto ist inzwischen geloescht. Sein PLATZ muss auf dem
  // Handy an derselben Stelle stehen wie auf dem PC - das ist der eigentliche
  // Beweis, dass die Reihenfolge und nicht nur die Elemente hinueberkommen.
  const erwartet = ['Rondat', 'Flick-Flack', 'Gelöschtes Element', 'Doppelsalto']
  pruefe('Die Reihenfolge ist auf dem Handy dieselbe',
    JSON.stringify(handyFolge) === JSON.stringify(erwartet),
    `${erwartet.join(' · ')}  ->  ${handyFolge.join(' · ')}`)
  pruefe('Auch der Platz des gelöschten Elements steht auf beiden Geräten gleich',
    handyFolge[2] === 'Gelöschtes Element', handyFolge.join(' · '))
  await handy.page.locator('.modal').first().locator('button', { hasText: 'Abbrechen' }).first().click()
  await handy.page.waitForTimeout(600)

  /* ---------------------------------- Kein Wegrutschen auf 390 px */
  await geh(handy, '/turnen/kueren', 1500)
  const breite = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Kein seitliches Wegrutschen auf 390 px in der Liste',
    breite.doc <= breite.fenster + 1, `${breite.doc} px Inhalt, ${breite.fenster} px Fenster`)

  await oeffneKuer(handy, 'Trainingsvariante')
  const imEditor = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Auch der Editor bleibt auf 390 px im Rahmen',
    imEditor.doc <= imEditor.fenster + 1, `${imEditor.doc} px Inhalt, ${imEditor.fenster} px Fenster`)

  const knopfHandy = await handy.page.locator('.modal .kuer-knopf').first()
    .evaluate((el) => el.getBoundingClientRect())
  pruefe('Die Ordnungsknöpfe sind am Handy voll bedienbar',
    knopfHandy.height >= 44 && knopfHandy.width >= 44,
    `${Math.round(knopfHandy.width)}×${Math.round(knopfHandy.height)} px`)
  pruefe('Und stehen vollständig im Bild',
    knopfHandy.right <= 390, `rechte Kante bei ${Math.round(knopfHandy.right)} px`)

  /* ---------------------------------------------------- Dunkle Ansicht */
  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(800)
  const dunkel = await handy.page.evaluate(() => {
    const zeile = document.querySelector('.kuer-zeile')
    if (!zeile) return null
    const s = getComputedStyle(zeile)
    const t = getComputedStyle(document.documentElement)
    return { hintergrund: s.backgroundColor, thema: document.documentElement.getAttribute('data-theme'), text: t.color }
  })
  pruefe('Die dunkle Ansicht greift auch im Küreditor',
    dunkel?.thema === 'dark', JSON.stringify(dunkel))
  await handy.page.emulateMedia({ colorScheme: 'light' })
  await handy.page.waitForTimeout(500)
  await handy.page.locator('.modal').first().locator('button', { hasText: 'Abbrechen' }).first().click()
  await handy.page.waitForTimeout(600)

  /* ===================================================================
     Offline: Zwei Geraete markieren unabhaengig voneinander
     ===================================================================
     Der eigentliche Pruefgegenstand. Erst wird die Wettkampfkuer am Boden
     ganz aufgehoben und der Stand auf beiden Geraeten gleichgezogen -
     sonst waere eine der beiden Markierungen nur eine Bestaetigung des
     Bestehenden und der Konflikt gar keiner.

     Dann markiert der PC "Grosse Bodenkuer", das Handy "Trainingsvariante",
     beide offline, beide am Boden. Nach dem Abgleich muss GENAU EINE
     gelten, beide Geraete muessen dieselbe zeigen, und keiner der beiden
     Zeitpunkte darf dabei verlorengehen.                                 */

  await oeffneKuer(pc, 'Trainingsvariante')
  await pc.page.locator('.modal label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().uncheck()
  await speichere(pc)
  pruefe('Die Wettkampfkür lässt sich ganz aufheben',
    (await istWettkampf(pc, 'Trainingsvariante')) === false)
  pruefe('Dabei rückt die ältere Markierung NICHT nach',
    (await istWettkampf(pc, 'Große Bodenkür')) === false)
  pruefe('Und der Barren behält seine', await istWettkampf(pc, 'Barrenkür'))

  await abgleich(pc)
  await abgleich(handy)

  await pc.ctx.setOffline(true)
  await handy.ctx.setOffline(true)

  await oeffneKuer(pc, 'Große Bodenkür')
  await pc.page.locator('.modal label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().check()
  await speichere(pc)
  pruefe('Offline markiert der PC seine Kür', await istWettkampf(pc, 'Große Bodenkür'))

  // Das Handy traegt die andere ein - es weiss vom PC nichts.
  await oeffneKuer(handy, 'Trainingsvariante')
  await handy.page.locator('.modal label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().check()
  await speichere(handy)
  pruefe('Offline markiert das Handy seine Kür', await istWettkampf(handy, 'Trainingsvariante'))

  await pc.ctx.setOffline(false)
  await handy.ctx.setOffline(false)
  await pc.page.waitForTimeout(600)

  // Beide gleichen ab, danach beide noch einmal, damit jeder den Stand
  // des anderen wirklich gesehen hat.
  await abgleich(pc)
  await abgleich(handy)
  await abgleich(pc)
  await abgleich(handy)

  await geh(pc, '/turnen/kueren', 1500)
  const pcZeilen = await pc.page.locator('.card', { hasText: 'Boden' }).locator('.list-row').allInnerTexts()
  await geh(handy, '/turnen/kueren', 1500)
  const handyZeilen = await handy.page.locator('.card', { hasText: 'Boden' }).locator('.list-row').allInnerTexts()

  /**
   * Welche Kuer traegt die Marke?
   *
   * Ueber den Namen in der ersten Zeile und die Marke in der letzten - nicht
   * ueber die Reihenfolge der Liste. Die Wettkampfkuer steht zwar oben, aber
   * genau das ist hier der Pruefgegenstand und darf nicht vorausgesetzt
   * werden.
   */
  const marke = (zeilen) => zeilen
    .map(zerlege)
    .filter((z) => z[z.length - 1] === 'Wettkampfkür')
    .map((z) => z[0])

  const pcMark = marke(pcZeilen)
  const handyMark = marke(handyZeilen)

  pruefe('Nach dem Abgleich gilt am Boden genau EINE Wettkampfkür',
    pcMark.length === 1, `PC sieht ${pcMark.length}: ${pcMark.join(', ')}`)
  pruefe('Das Handy sieht ebenfalls genau eine',
    handyMark.length === 1, `Handy sieht ${handyMark.length}: ${handyMark.join(', ')}`)
  pruefe('Und beide Geräte zeigen dieselbe',
    pcMark[0] === handyMark[0], `PC: ${pcMark[0]} · Handy: ${handyMark[0]}`)
  pruefe('Es ist die später markierte – das Handy hat zuletzt entschieden',
    handyMark[0] === 'Trainingsvariante', handyMark[0])

  pruefe('Die Barrenkür ist davon unberührt geblieben',
    await istWettkampf(pc, 'Barrenkür'))

  /* ------------------------------------- Beide Geraete, gleicher Bestand */
  const kuerenServer = server.zeilen('gym_routines').filter((z) => !z.deleted_at)
  pruefe('Auf dem Server liegen drei Küren', kuerenServer.length === 3, `${kuerenServer.length}`)

  // Beide offline gesetzten Zeitpunkte stehen noch da. Die unterlegene Kuer
  // wird nicht zurueckgesetzt - sie ist nur nicht mehr die juengste. Genau
  // deshalb gibt es nach dem Abgleich keinen Zwischenzustand: Niemand muss
  // eine zweite Zeile nachziehen, damit die Rechnung aufgeht.
  const boden = kuerenServer.filter((z) => z.apparatus === 'boden')
  const mitZeitpunkt = boden.filter((z) => z.competition_since)
  pruefe('Beide offline gesetzten Zeitpunkte sind erhalten – verloren geht nichts',
    mitZeitpunkt.length === 2, `${mitZeitpunkt.length} von ${boden.length} Bodenküren`)

  const juengste = [...mitZeitpunkt]
    .sort((a, b) => String(a.competition_since).localeCompare(String(b.competition_since)))
    .pop()
  pruefe('Die jüngste Markierung auf dem Server ist die, die beide Geräte zeigen',
    juengste?.name === handyMark[0], `Server: ${juengste?.name} · Anzeige: ${handyMark[0]}`)

  /* ------------------------------------------------- Konsolenfehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/i.test(f))
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
