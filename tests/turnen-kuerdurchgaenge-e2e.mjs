/**
 * Turnen, Phase 2E: Kürdurchgänge im Browser.
 *
 * Die Rechnung ist in `turnen-kuerdurchgaenge.test.ts` einzeln nachgerechnet.
 * Hier geht es um den Weg, den Unit-Tests nicht zeigen:
 *
 *   Training öffnen → Kür wählen → drei Durchgänge erfassen → Analyse öffnen
 *   → Kürstabilität stimmt → **Kür ändern** → neuer Durchgang → die alten
 *   Durchgänge bleiben bei ihrer alten Fassung und werden nicht mitgezählt
 *
 * Der letzte Schritt ist der eigentliche Prüfgegenstand: Eine geänderte Kür ist
 * eine andere Übung, und ihre Durchgänge dürfen nicht vermischt werden.
 *
 * Dazu: keine künstlichen Elementversuche, Wettkampfdaten unberührt, Abgleich
 * PC ↔ Handy, Einheit löschen, 390 px, dunkler Modus.
 *
 * Aufruf:  node tests/turnen-kuerdurchgaenge-e2e.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54406 })
const web = await starteWebserver(8097)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')
const offene = (t) => server.zeilen(t).filter((z) => !z.deleted_at)

/** Die Trainingsfokus-Kachel eines Geräts in der Analyse. */
const fokusKarte = (g, geraet) =>
  g.page.locator('.card').filter({ hasText: 'Trainingsfokus' })
    .locator('.wk-karte').filter({ hasText: new RegExp(`^${geraet}`) }).first()

/* --------------------------------------------------------------- Hilfen */

async function legeElementAn(g, { name, geraet, wert }) {
  await geh(g, '/turnen/elemente', 1400)
  await g.page.locator('button', { hasText: /^\+ (Element|Erstes Element)$/ }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  if (wert) {
    await g.page.locator('.modal .field', { hasText: 'Wert' })
      .locator('input').first().fill(wert)
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1100)
}

async function legeWettkampfKuerAn(g, { name, geraet, elemente }) {
  await geh(g, '/turnen/kueren', 1400)
  await g.page.locator('button', { hasText: /^\+ (Kür|Erste Kür)$/ }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(400)
  await g.page.locator('.modal button', { hasText: '+ Element' }).first().click()
  await g.page.waitForTimeout(800)
  const waehler = g.page.locator('.modal').last()
  for (const n of elemente) {
    await waehler.locator('.list-row', { hasText: n }).first().click()
    await g.page.waitForTimeout(250)
  }
  await waehler.locator('button', { hasText: 'Fertig' }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal').last()
    .locator('label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().check()
  await g.page.waitForTimeout(300)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1500)
}

/** Ein Element zu einer bestehenden Kür hinzufügen – die Kür ändert sich damit. */
async function ergaenzeKuer(g, { kuer, element }) {
  await geh(g, '/turnen/kueren', 1400)
  await g.page.locator('.list-row', { hasText: kuer }).first().click()
  await g.page.waitForTimeout(900)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: '+ Element' }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal').last()
    .locator('.list-row', { hasText: element }).first().click()
  await g.page.waitForTimeout(300)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: 'Fertig' }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1500)
}

/**
 * Eine Trainingseinheit mit Kürdurchgängen erfassen.
 *
 * `durchgaenge` ist eine Liste von `{ komplett, stuerze, absetzen, hilfe }`.
 */
async function erfasseDurchgaenge(g, { geraet, durchgaenge }) {
  await geh(g, '/turnen/training', 1500)
  await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(700)

  for (const [i, d] of durchgaenge.entries()) {
    await g.page.locator('.modal button', { hasText: '+ Durchgang' }).first().click()
    await g.page.waitForTimeout(400)
    const zeile = g.page.locator('.modal .turn-durchgang').nth(i)

    // Reihenfolge der Schalter: [komplett/abgebrochen, ..., mit/ohne Hilfe]
    if (d.komplett === false) {
      await zeile.locator('.turn-durchgang-schalter').first().click()
      await g.page.waitForTimeout(150)
    }
    if (d.hilfe) {
      await zeile.locator('.turn-durchgang-schalter').last().click()
      await g.page.waitForTimeout(150)
    }
    for (let n = 0; n < (d.stuerze ?? 0); n++) {
      await zeile.locator('.turn-zaehlfeld').filter({ hasText: 'Stürze' })
        .locator('button', { hasText: '+' }).first().click()
    }
    for (let n = 0; n < (d.absetzen ?? 0); n++) {
      await zeile.locator('.turn-zaehlfeld').filter({ hasText: 'Unterbrechungen' })
        .locator('button', { hasText: '+' }).first().click()
    }
  }

  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1800)
}

/** Die Einzelheiten einer Fokuskachel aufklappen. */
async function klappeAuf(g, geraet) {
  const karte = fokusKarte(g, geraet)
  const knopf = karte.locator('button').filter({ hasText: /Einzelheiten/ }).first()
  if (await knopf.count()) {
    const offen = await karte.locator('.tf-block').count()
    if (!offen) {
      await knopf.click()
      await g.page.waitForTimeout(700)
    }
  }
  return karte.innerText()
}

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'kd-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await legeElementAn(pc, { name: 'Felge vorwärts', geraet: 'Barren', wert: '0,2' })
  await legeElementAn(pc, { name: 'Kippe zum Handstand', geraet: 'Barren', wert: '0,3' })
  await legeElementAn(pc, { name: 'Doppelsalto Abgang', geraet: 'Barren', wert: '0,5' })
  await legeWettkampfKuerAn(pc, {
    name: 'Barrenkür 2026', geraet: 'Barren',
    elemente: ['Felge vorwärts', 'Kippe zum Handstand'],
  })

  /* ------------------------------- Ohne Durchgänge: klare Aussage */
  await geh(pc, '/turnen/analyse', 1800)
  pruefe('Ohne Wettkampf gibt es noch keine Analyse',
    /Noch kein Wettkampfergebnis/.test(await text(pc)))

  /* ======================== Schritt 1: drei saubere Durchgänge erfassen */
  await erfasseDurchgaenge(pc, {
    geraet: 'Barren',
    durchgaenge: [{}, {}, {}],   // dreimal komplett, sturzfrei, ohne Hilfe
  })

  await abgleich(pc)
  pruefe('Drei Durchgänge liegen auf dem Server',
    offene('gym_routine_runs').length === 3, `${offene('gym_routine_runs').length}`)
  pruefe('Sie zeigen alle auf dieselbe Kürfassung',
    new Set(offene('gym_routine_runs').map((r) => r.routine_version_id)).size === 1)
  pruefe('Die Fassung ist eingefroren worden',
    offene('gym_routine_versions').length === 1,
    `${offene('gym_routine_versions').length}`)

  /* ----------------------- Kein Doppelzählen: keine künstlichen Versuche */
  pruefe('Ein Kürdurchgang erzeugt KEINE Elementversuche',
    offene('gym_attempts').length === 0, `${offene('gym_attempts').length} gym_attempts`)
  pruefe('Und genau eine Trainingseinheit',
    offene('workout_sessions').length === 1, `${offene('workout_sessions').length}`)

  const ersteZeile = offene('gym_routine_runs')[0]
  pruefe('Ein Durchgang ist als komplett festgehalten', ersteZeile.completed === 1)
  pruefe('Mit null Stürzen und null Unterbrechungen',
    ersteZeile.falls === 0 && ersteZeile.interruptions === 0)
  pruefe('Und ohne Hilfe', ersteZeile.with_help === 0)
  pruefe('Die Durchgänge sind fortlaufend sortiert',
    offene('gym_routine_runs').map((r) => r.sort_order).sort().join(',') === '0,1,2')

  /* ===================== Schritt 2: Analyse zeigt die Kürstabilität */
  // Die Analyse braucht einen Wettkampf, damit eine Kachel entsteht. Von Hand
  // erfasst genuegt - Vergleichswerte sind hier nicht der Gegenstand.
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: /^\+ (Wettkampf|Erster Wettkampf)$/ }).first().click()
  await pc.page.waitForTimeout(800)
  const neu = pc.page.locator('.modal').last()
  await neu.locator('.field', { hasText: 'Name' }).locator('input').first().fill('Testwettkampf')
  await neu.locator('.turn-geraet', { hasText: 'Barren' }).first().click()
  await pc.page.waitForTimeout(400)
  const felder = neu.locator('.wk-karte').filter({ hasText: 'Barren' }).first()
  await felder.locator('.field', { hasText: 'D-Wert' }).locator('input').first().fill('3,0')
  await felder.locator('.field', { hasText: 'E-Wert' }).locator('input').first().fill('8,5')
  await felder.locator('.field', { hasText: 'Endnote' }).locator('input').first().fill('11,5')
  await neu.locator('button', { hasText: 'Speichern' }).first().click()
  await pc.page.waitForTimeout(1800)

  await geh(pc, '/turnen/analyse', 2200)
  const nachDreien = await klappeAuf(pc, 'Barren')

  pruefe('Die Kachel nennt die Kür am Stück',
    /kür am stück/i.test(nachDreien), nachDreien.slice(0, 300).replace(/\n/g, ' | '))
  pruefe('Kürstabilität ist stabil – drei von drei sauber',
    /Kürstabilität: stabil/.test(nachDreien),
    nachDreien.replace(/\n/g, ' | ').slice(0, 600))
  pruefe('Die Einzelzahlen stehen daneben',
    /komplett/.test(nachDreien) && /sturzfrei/.test(nachDreien)
      && /ohne Absetzen/.test(nachDreien) && /ohne Hilfe/.test(nachDreien))
  pruefe('Zuletzt komplett wird genannt', /zuletzt komplett/i.test(nachDreien))
  pruefe('Die Verlaufsliste steht da', /komplett · 0 Stürze/.test(nachDreien))

  /* ============ Schritt 3: Kür ändern – alte Durchgänge bleiben getrennt */
  await ergaenzeKuer(pc, { kuer: 'Barrenkür 2026', element: 'Doppelsalto Abgang' })

  await geh(pc, '/turnen/analyse', 2200)
  const nachAenderung = await klappeAuf(pc, 'Barren')
  pruefe('Nach der Küränderung zählt die neue Fassung keinen Durchgang',
    /noch kein Durchgang erfasst/i.test(nachAenderung)
      || /Noch kein Durchgang erfasst/.test(nachAenderung),
    nachAenderung.replace(/\n/g, ' | ').slice(0, 600))
  pruefe('Die drei alten stehen als frühere Fassung getrennt da',
    /Frühere Kürfassung/.test(nachAenderung) && /3 Durchgänge/.test(nachAenderung),
    nachAenderung.replace(/\n/g, ' | ').slice(0, 700))
  pruefe('Und werden ausdrücklich nicht mitgezählt',
    /Nicht mitgezählt/.test(nachAenderung))

  await abgleich(pc)
  pruefe('Die alten Durchgänge zeigen unverändert auf ihre alte Fassung',
    offene('gym_routine_runs').length === 3
      && new Set(offene('gym_routine_runs').map((r) => r.routine_version_id)).size === 1,
    `${offene('gym_routine_runs').length} Durchgänge`)

  /* =================== Schritt 4: neuer Durchgang auf der neuen Fassung */
  await erfasseDurchgaenge(pc, {
    geraet: 'Barren',
    durchgaenge: [{ komplett: false, stuerze: 1 }],
  })
  await abgleich(pc)

  pruefe('Jetzt liegen vier Durchgänge vor',
    offene('gym_routine_runs').length === 4, `${offene('gym_routine_runs').length}`)
  pruefe('Auf zwei verschiedenen Fassungen',
    new Set(offene('gym_routine_runs').map((r) => r.routine_version_id)).size === 2)
  pruefe('Und es gibt zwei eingefrorene Fassungen',
    offene('gym_routine_versions').length === 2,
    `${offene('gym_routine_versions').length}`)

  const abbruch = offene('gym_routine_runs').find((r) => r.completed === 0)
  pruefe('Der Abbruch ist als solcher festgehalten', !!abbruch && abbruch.falls === 1,
    JSON.stringify(abbruch && { completed: abbruch.completed, falls: abbruch.falls }))

  await geh(pc, '/turnen/analyse', 2200)
  const nachNeuem = await klappeAuf(pc, 'Barren')
  pruefe('Die neue Fassung zählt genau einen Durchgang',
    /1 Durchgang|Durchgänge\s*1/.test(nachNeuem.replace(/\n/g, ' ')),
    nachNeuem.replace(/\n/g, ' | ').slice(0, 700))
  pruefe('Bei einem Durchgang gibt es noch keine Aussage',
    /zu wenig Durchgänge/.test(nachNeuem),
    nachNeuem.replace(/\n/g, ' | ').slice(0, 700))
  pruefe('Die drei alten bleiben als frühere Fassung sichtbar',
    /3 Durchgänge/.test(nachNeuem))

  /* ====================== Wettkampfdaten bleiben unberührt */
  pruefe('Es ist kein Durchgang aus dem Wettkampfergebnis entstanden',
    offene('gym_results').length === 1 && offene('gym_routine_runs').length === 4,
    `${offene('gym_results').length} Ergebnisse, ${offene('gym_routine_runs').length} Durchgänge`)

  /* ============================================ Handy: Abgleich, 390 px */
  handy = await starteGeraet({
    name: 'kd-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen/analyse', 2400)
  const handyText = await klappeAuf(handy, 'Barren')
  pruefe('Das Handy sieht dieselben Durchgänge nach dem Abgleich',
    /kür am stück/i.test(handyText) && /3 Durchgänge/.test(handyText),
    handyText.replace(/\n/g, ' | ').slice(0, 400))

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Die Analyse läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)

  const zahlenPassen = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll('.kd-zahlen, .kd-eintrag')]
    return els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die Durchgangszahlen passen in die Breite', zahlenPassen)

  /* --------------------------------- Erfassung am Handy bei 390 px */
  await geh(handy, '/turnen/training', 1800)
  await handy.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await handy.page.waitForTimeout(800)
  await handy.page.locator('.modal .turn-geraet', { hasText: 'Barren' }).first().click()
  await handy.page.waitForTimeout(700)
  await handy.page.locator('.modal button', { hasText: '+ Durchgang' }).first().click()
  await handy.page.waitForTimeout(500)
  const formPasst = await handy.page.evaluate(() => {
    const el = document.querySelector('.turn-durchgang')
    return el ? el.scrollWidth <= el.clientWidth + 2 : false
  })
  pruefe('Das Erfassungsfeld passt am Handy in die Breite', formPasst)
  const hoehe = await handy.page.locator('.turn-durchgang-schalter').first()
    .evaluate((el) => el.getBoundingClientRect().height)
  pruefe('Die Schalter sind mit dem Daumen zu treffen', hoehe >= 40, `${Math.round(hoehe)} px`)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(700)
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.turn-durchgang')
    if (!el) return null
    const s = getComputedStyle(el)
    return { farbe: s.color, grund: s.backgroundColor }
  })
  pruefe('Im dunklen Modus hat die Erfassung eine eigene Farbe',
    !!kontrast && kontrast.farbe !== kontrast.grund, JSON.stringify(kontrast))
  await handy.page.emulateMedia({ colorScheme: 'light' })
  await handy.page.locator('.modal button', { hasText: 'Abbrechen' }).first().click()
  await handy.page.waitForTimeout(600)

  /* ==================================== Einheit löschen nimmt Durchgänge mit */
  await geh(pc, '/turnen/training', 1800)
  await pc.page.locator('.list-row').first().click()
  await pc.page.waitForTimeout(900)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).last().click()
  await pc.page.waitForTimeout(1800)
  await abgleich(pc)

  pruefe('Mit der Einheit gehen ihre Durchgänge',
    offene('gym_routine_runs').length < 4,
    `${offene('gym_routine_runs').length} übrig`)
  pruefe('Die eingefrorenen Fassungen bleiben – sie gehören zur Geschichte',
    offene('gym_routine_versions').length === 2,
    `${offene('gym_routine_versions').length}`)

  /* ==================================================== Keine Fehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|415|422/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
} finally {
  await pc?.stop?.()
  await handy?.stop?.()
  await web?.stop?.()
  await server?.stop?.()
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
