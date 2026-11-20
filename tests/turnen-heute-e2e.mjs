/**
 * Turnen, Phase 3E: Die heutige Turneinheit im Browser.
 *
 * Die Auswahlregeln sind in `turnen-tagestraining.test.ts` einzeln
 * nachgerechnet. Hier geht es um den Weg, den die Unit-Tests nicht zeigen –
 * und um die Invariante, an der diese Phase hängt:
 *
 *   Turntermin für heute anlegen → Übersicht zeigt „Heute" mit den
 *   Phase-3B-Inhalten → Schlaf und Tagesart stehen im Kontext → Training
 *   **aus dem Heute-Block** öffnen → es öffnet sich DIESELBE geplante
 *   Session → erfassen → sie ist danach `completed`, und es ist **keine
 *   zweite Session** entstanden → die Übersicht rechnet neu
 *
 * Dazu die Stellen, an denen eine Tagesansicht typischerweise Schaden
 * anrichtet:
 *
 *   - eine zweite Session neben dem geplanten Termin (Dublette)
 *   - ein erfasstes Training, das weiter als bevorstehend dasteht
 *   - ein erfundenes Training an einem Tag ohne Termin
 *   - Schlaf, der plötzlich den Plan verändert
 *   - derselbe Plan zweimal untereinander (Heute und Nächstes Training)
 *   - eine neue Tabelle oder Einstellung für den heutigen Plan
 *   - ein erfundener Trainingsplan am Wettkampftag, oder ein eigener
 *     Turntermin, der dort still verschwindet
 *
 * Dazu: 390 px, dunkler Modus, kein Überlauf, keine Konsolenfehler.
 *
 * Aufruf:  node tests/turnen-heute-e2e.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { idAusSchluessel, stableId } from '../supabase/functions/_shared/stabileId.ts'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54417 })
const web = await starteWebserver(8109)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }
const NUTZER = '11111111-1111-1111-1111-111111111111'

function tagIn(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ------------------------------------------------ Daten auf dem Server */

function store(name) {
  if (!server.tabellen.has(name)) server.tabellen.set(name, new Map())
  return server.tabellen.get(name)
}

function lege(tabelle, zeile) {
  const jetzt = new Date().toISOString()
  const s = store(tabelle)
  const alt = s.get(zeile.id)
  s.set(zeile.id, {
    user_id: NUTZER, note: null, deleted_at: null,
    created_at: alt?.created_at ?? jetzt,
    ...zeile,
    updated_at: jetzt,
    version: (alt?.version ?? 0) + 1,
    last_device_id: 'e2e',
    server_rev: server.naechsteRev(),
  })
}

/**
 * Eine Nacht direkt auf dem Server.
 *
 * `day` ist der Morgen des Aufwachens – genau so setzt es der Import. Die
 * Nacht beginnt am Vorabend und endet morgens; dass sie trotzdem dem heutigen
 * Tag zugerechnet wird, ist der Punkt (23.6).
 */
function legeNacht({ day, dauer, quelle = 'Apple Health' }) {
  const vortag = new Date(`${day}T00:00:00`)
  vortag.setDate(vortag.getDate() - 1)
  const vor = `${vortag.getFullYear()}-${String(vortag.getMonth() + 1).padStart(2, '0')}-${String(vortag.getDate()).padStart(2, '0')}`
  lege('sleep_sessions', {
    id: `nacht-${day}`,
    day,
    start_at: `${vor}T22:42:00+02:00`,
    end_at: `${day}T05:58:00+02:00`,
    duration_min: dauer,
    awake_min: null, in_bed_min: dauer + 20,
    core_min: null, deep_min: null, rem_min: null,
    source: quelle,
  })
}

/**
 * Den heutigen Tag auf eine kurze Frühschicht stellen.
 *
 * **Keine neue Tagesart und keine zweite Zuordnung.** Der Beispielbestand
 * (`db/seed.ts`) legt für jeden Tag schon eine `day_assignments`-Zeile an und
 * kennt die Frühschicht bereits – beide mit einer aus dem Kürzel bzw. dem Tag
 * abgeleiteten ID. Eine frei gewählte ID ergäbe eine ZWEITE Zeile für
 * denselben Tag, und weil `day` lokal UNIQUE ist, löst das beim Holen
 * `INSERT OR REPLACE` aus – ohne Meldung (siehe CLAUDE.md). Genau daran ist
 * die erste Fassung dieses Tests gescheitert: Die Tagesart kam nicht an, und
 * `computeCapacity()` rechnete einen freien Tag.
 *
 * Geschrieben wird deshalb mit **denselben** abgeleiteten IDs: Lief das Seed,
 * werden die vorhandenen Zeilen an ihrer Stelle geändert; lief es nicht,
 * entstehen sie. Beides ohne Dublette.
 *
 * Die Arbeitszeit kommt über `start_override`/`end_override` an der Zuordnung:
 * 06:00 bis 21:10 sind 910 Minuten, womit von 960 wachen Minuten 50 frei
 * bleiben – nach `kapazitaetAus()` eine „kurze Einheit" mit zwei Plätzen.
 */
function stelleKurzenArbeitstag({ tag, von, bis }) {
  const tagesart = stableId('day_types', 'F')
  lege('day_types', {
    id: tagesart, name: 'Frühschicht', short_code: 'F',
    kind: 'work', color: 'var(--tag-frueh)',
    default_start: '06:00', default_end: '14:30',
    break_minutes: 30, counts_as_workday: 1, sort_order: 0,
  })
  const vorhanden = server.zeilen('day_assignments')
    .find((z) => z.day === tag && !z.deleted_at)
  lege('day_assignments', {
    id: vorhanden?.id ?? idAusSchluessel('day_assignments', tag),
    day: tag, day_type_id: tagesart,
    start_override: von, end_override: bis,
  })
}

/* --------------------------------------------------------- Ablesehilfen */

const heuteKarte = (g) =>
  g.page.locator('.card').filter({ has: g.page.locator('.card-title', { hasText: /^Heute$/ }) }).first()
const heuteText = async (g) => (await heuteKarte(g).innerText()).replace(/\n/g, ' | ')

const planKarte = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächstes Training' })

/** Die Geräte des Heute-Blocks mit ihren Inhalten. */
const heuteGeraete = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('.card-title')?.textContent?.trim() === 'Heute')
  if (!karte) return []
  return [...karte.querySelectorAll('.ht-geraet')].map((el) => ({
    name: el.querySelector('.ht-name')?.textContent?.trim() ?? '',
    rolle: el.querySelector('.np-rolle')?.textContent?.trim() ?? '',
    inhalte: [...el.querySelectorAll('.ht-inhalt')].map((x) => ({
      art: x.querySelector('.np-art')?.textContent?.trim() ?? '',
      text: x.querySelector('.ht-inhalt-text')?.textContent?.trim() ?? '',
    })),
  }))
})

/** Die heute zurückgestellten Geräte. */
const zurueckgestellt = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('.card-title')?.textContent?.trim() === 'Heute')
  if (!karte) return []
  return [...karte.querySelectorAll('.ht-zurueck-zeile')].map((el) => ({
    name: el.querySelector('.ht-name')?.textContent?.trim() ?? '',
    grund: el.querySelector('.muted')?.textContent?.trim() ?? '',
  }))
})

const turnSitzungen = () => server.zeilen('workout_sessions')
  .filter((z) => z.discipline === 'turnen')

/* --------------------------------------------------------------- Hilfen */

async function legeElementAn(g, { name, geraet, buchstabe, wert }) {
  await geh(g, '/turnen/elemente', 1400)
  await g.page.locator('button', { hasText: /^\+ (Element|Erstes Element)$/ }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  if (buchstabe) {
    await g.page.locator('.modal .field', { hasText: 'Schwierigkeit' })
      .locator('input').first().fill(buchstabe)
  }
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

/**
 * Einen Wettkampf anlegen – der vorhandene Weg über den Reiter Wettkämpfe.
 *
 * Nur Name und Datum: Für den Wettkampftag zählt allein, dass Phase 3D ihn
 * auf heute sieht. Noten gehören zu Phase 2C und sind hier ohne Belang.
 */
async function legeWettkampfAn(g, { name, tag }) {
  await geh(g, '/turnen/wettkaempfe', 1600)
  await g.page.locator('button', { hasText: /^\+ (Wettkampf|Erster Wettkampf)$/ }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('input').first().fill(name)
  await modal.locator('input[type=date]').first().fill(tag)
  await g.page.waitForTimeout(400)
  await modal.locator('button', { hasText: /^Speichern$/ }).first().click()
  await g.page.waitForTimeout(1800)
}

/** Einen Turntermin über die Wochenansicht anlegen – der vorhandene Weg. */
async function legeTerminAn(g, { inTagen, dauer }) {
  await geh(g, '/turnen', 2400)
  /* Den Umschalter traegt je Tag eine andere Karte: An einem Tag mit Termin
     ist es "Heute", sonst "Naechstes Training". Gesucht wird deshalb die
     Karte, die ihn WIRKLICH hat - und nicht die, die zuerst dasteht. */
  const traeger = g.page.locator('.card')
    .filter({ has: g.page.locator('.segment button', { hasText: 'Kommende Einheiten' }) })
    .first()
  const knopf = traeger.locator('.segment button', { hasText: 'Kommende Einheiten' }).first()
  if ((await knopf.getAttribute('aria-pressed')) !== 'true') {
    await knopf.click()
    await g.page.waitForTimeout(900)
  }
  await traeger.locator('button', { hasText: '+ Turntermin' }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('input[type=date]').first().fill(tagIn(inTagen))
  if (dauer) await modal.locator('input[type=number]').first().fill(String(dauer))
  await modal.locator('button', { hasText: 'Planen' }).first().click()
  await g.page.waitForTimeout(1700)
}

/** Ein Training erfassen – aus dem bereits offenen Editor. */
async function erfasseImEditor(g, { geraet, tipps, durchgaenge }) {
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(700)
  for (const [elementName, guete] of Object.entries(tipps ?? {})) {
    const zeile = g.page.locator('.turn-zeile', { hasText: elementName }).first()
    const knoepfe = zeile.locator('.turn-zaehler-knopf')
    for (const [welche, anzahl] of Object.entries(guete)) {
      const index = welche === 'clean' ? 0 : welche === 'shaky' ? 1 : 2
      for (let i = 0; i < anzahl; i++) await knoepfe.nth(index).click()
    }
  }
  for (const [i, d] of (durchgaenge ?? []).entries()) {
    await g.page.locator('.modal button', { hasText: '+ Durchgang' }).first().click()
    await g.page.waitForTimeout(400)
    const zeile = g.page.locator('.modal .turn-durchgang').nth(i)
    if (d.komplett === false) {
      await zeile.locator('.turn-durchgang-schalter').first().click()
      await g.page.waitForTimeout(150)
    }
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1900)
}

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'ht-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  /* ============= Schritt 1: Elemente und Wettkampfküren an drei Geräten */
  const GERAETE = [
    { name: 'Barren', a: 'Felge vorwärts', b: 'Kippe zum Handstand' },
    { name: 'Reck', a: 'Riesenfelge', b: 'Konterfelge' },
    { name: 'Ringe', a: 'Muskelaufzug', b: 'Kreuzhang' },
  ]
  for (const g of GERAETE) {
    await legeElementAn(pc, { name: g.a, geraet: g.name, buchstabe: 'B', wert: '0,2' })
    await legeElementAn(pc, { name: g.b, geraet: g.name, buchstabe: 'C', wert: '0,3' })
    await legeWettkampfKuerAn(pc, {
      name: `${g.name}kür 2026`, geraet: g.name, elemente: [g.a, g.b],
    })
  }
  await abgleich(pc)

  /* ========== Schritt 2: ohne heutigen Termin wird nichts erfunden ===== */
  await geh(pc, '/turnen', 2600)
  const ohneTermin = await heuteText(pc)
  pruefe('Ohne Turntermin sagt Heute das klar',
    /Heute ist kein Turntraining geplant/.test(ohneTermin), ohneTermin.slice(0, 300))
  pruefe('Und erfindet kein Gerät für heute',
    (await heuteGeraete(pc)).length === 0, JSON.stringify(await heuteGeraete(pc)))
  pruefe('Der Vorschlag steht dafür als „Nächstes Training" da',
    (await planKarte(pc).count()) > 0)
  pruefe('Ohne Schlafdaten steht das auch dort',
    /keine Schlafdaten vor/.test(ohneTermin), ohneTermin.slice(0, 400))

  /* ================= Schritt 3: Schlaf und Tagesart auf den Server ===== */
  legeNacht({ day: tagIn(0), dauer: 378 })
  // Eine Frueschicht von 06:00 bis 21:10 laesst 50 freie Minuten uebrig -
  // damit sagt die vorhandene Kapazitaetsrechnung "kurze Einheit".
  stelleKurzenArbeitstag({ tag: tagIn(0), von: '06:00', bis: '21:10' })
  await abgleich(pc)

  await geh(pc, '/turnen', 2600)
  const mitSchlaf = await heuteText(pc)
  pruefe('Der Schlaf der letzten Nacht steht im Tageskontext',
    /Schlaf letzte Nacht/.test(mitSchlaf) && /6 h 18 min/.test(mitSchlaf),
    mitSchlaf.slice(0, 400))
  pruefe('Die Tagesart steht dabei',
    /Frühschicht/.test(mitSchlaf), mitSchlaf.slice(0, 400))
  pruefe('Und keine Bewertung des Schlafs',
    !/zu wenig|ausreichend|gut geschlafen|schlecht|erholt|Ampel/i.test(mitSchlaf),
    mitSchlaf.slice(0, 500))

  /* ============== Schritt 4: Turntermin für heute – Heute wird primär == */
  await legeTerminAn(pc, { inTagen: 0 })
  await abgleich(pc)
  pruefe('Der Termin liegt als geplante Turneinheit auf dem Server',
    turnSitzungen().filter((z) => z.status === 'planned' && z.day === tagIn(0)).length === 1,
    JSON.stringify(turnSitzungen().map((z) => `${z.day}/${z.status}`)))
  const terminId = turnSitzungen().find((z) => z.status === 'planned' && z.day === tagIn(0)).id

  await geh(pc, '/turnen', 2800)
  const mitTermin = await heuteText(pc)
  pruefe('Heute meldet das geplante Training',
    /Heute ist Turntraining geplant/.test(mitTermin), mitTermin.slice(0, 300))
  const geraeteHeute = await heuteGeraete(pc)
  pruefe('Die Phase-3B-Inhalte stehen darunter',
    geraeteHeute.length > 0 && geraeteHeute[0].inhalte.length > 0,
    JSON.stringify(geraeteHeute))
  pruefe('„Nächstes Training" steht nicht zusätzlich daneben – kein Plan zweimal',
    (await planKarte(pc).count()) === 0,
    (await pc.page.innerText('#root')).replace(/\n/g, ' | ').slice(0, 300))
  pruefe('Die Wochenansicht bleibt über den Umschalter erreichbar',
    (await heuteKarte(pc).locator('.segment button', { hasText: 'Kommende Einheiten' }).count()) > 0)

  /* ========== Schritt 5: kurze Tageskapazität stellt sichtbar zurück === */
  pruefe('Die Kapazität des Tages steht da',
    /kurze Einheit/.test(mitTermin), mitTermin.slice(0, 400))
  const zurueck = await zurueckgestellt(pc)
  pruefe('Was heute nicht hineinpasst, steht als zurückgestellt da',
    zurueck.length > 0, JSON.stringify(zurueck))
  pruefe('Mit seinem Grund',
    zurueck.every((z) => /kurze verfügbare Einheit/.test(z.grund)), JSON.stringify(zurueck))
  pruefe('Es sind keine Minuten je Gerät zu sehen',
    !/\d+\s*min\s*·\s*\d+\s*min/.test(mitTermin), mitTermin.slice(0, 500))
  const schwerpunkte = geraeteHeute.filter((g) => /Schwerpunkt/i.test(g.rolle))
  pruefe('Ein Schwerpunkt wurde dabei nicht verdrängt',
    zurueck.every((z) => !schwerpunkte.some((s) => s.name === z.name)),
    `${JSON.stringify(zurueck)} vs ${JSON.stringify(schwerpunkte)}`)

  /* ---- Zurückholen ist möglich und bleibt eine Sache dieser Ansicht --- */
  await heuteKarte(pc).locator('button', { hasText: '+ heute mitnehmen' }).first().click()
  await pc.page.waitForTimeout(800)
  pruefe('Ein zurückgestelltes Gerät lässt sich für heute mitnehmen',
    (await heuteGeraete(pc)).length === geraeteHeute.length + 1,
    `${geraeteHeute.length} -> ${(await heuteGeraete(pc)).length}`)
  pruefe('Und die Änderung lässt sich zurücknehmen',
    (await heuteKarte(pc).locator('button', { hasText: 'zurücksetzen' }).count()) > 0)
  await heuteKarte(pc).locator('button', { hasText: 'zurücksetzen' }).first().click()
  await pc.page.waitForTimeout(700)
  pruefe('Danach steht wieder der unveränderte Phase-3B-Stand da',
    (await zurueckgestellt(pc)).length === zurueck.length
      && (await heuteGeraete(pc)).length === geraeteHeute.length,
    JSON.stringify(await zurueckgestellt(pc)))

  /* Gespeichert wird davon nichts (23.10). Der Abgleich fuehrt ueber die
     Einstellungen und verlaesst den Block dabei - genau deshalb steht die
     Pruefung auf die Auswahl VOR ihm und die auf den Server danach. */
  await abgleich(pc)
  const einstellungen = server.zeilen('settings').filter((z) => !z.deleted_at)
  pruefe('Es entsteht keine Einstellung für den heutigen Plan',
    einstellungen.filter((z) => /heute|tagesplan|daily|turnen/i.test(z.key ?? '')).length === 0,
    JSON.stringify(einstellungen.map((z) => z.key)))
  await geh(pc, '/turnen', 2600)
  pruefe('Und die Tagesauswahl überlebt den Seitenwechsel nicht – sie ist nirgends abgelegt',
    (await zurueckgestellt(pc)).length === zurueck.length,
    JSON.stringify(await zurueckgestellt(pc)))

  /* ====== Schritt 6: Training AUS dem Heute-Block – dieselbe Session ==== */
  const vorher = turnSitzungen().length
  await heuteKarte(pc).locator('button', { hasText: 'Training erfassen' }).first().click()
  await pc.page.waitForTimeout(1600)
  pruefe('Der Editor öffnet sich direkt',
    (await pc.page.locator('.modal').count()) > 0)
  // Der Tag im Editor ist der der geplanten Einheit - er wird nicht geaendert.
  const datumImEditor = await pc.page.locator('.modal input[type=date]').first().inputValue()
  pruefe('Und zwar auf dem heutigen Tag',
    datumImEditor === tagIn(0), `${datumImEditor} != ${tagIn(0)}`)

  await erfasseImEditor(pc, {
    geraet: 'Reck',
    tipps: { Riesenfelge: { clean: 10 }, Konterfelge: { clean: 10 } },
    durchgaenge: [{ komplett: true }, { komplett: true }],
  })
  await abgleich(pc)

  /* ============= Schritt 7: keine Dublette – die Invariante ============ */
  pruefe('Es ist KEINE zweite Session entstanden',
    turnSitzungen().length === vorher,
    `${vorher} -> ${turnSitzungen().length}: ${JSON.stringify(turnSitzungen().map((z) => `${z.day}/${z.status}`))}`)
  const danach = turnSitzungen().find((z) => z.id === terminId)
  pruefe('Dieselbe Session ist jetzt absolviert',
    danach && danach.status === 'completed', JSON.stringify(danach))
  pruefe('Und keine geplante Turneinheit bleibt für heute offen',
    turnSitzungen().filter((z) => z.status === 'planned' && z.day === tagIn(0)).length === 0,
    JSON.stringify(turnSitzungen().map((z) => `${z.day}/${z.status}`)))
  pruefe('Die Versuche hängen an dieser Session',
    server.zeilen('gym_attempts').every((z) => z.session_id === terminId),
    JSON.stringify(server.zeilen('gym_attempts').map((z) => z.session_id)))
  pruefe('Die Kürdurchgänge ebenso',
    server.zeilen('gym_routine_runs').length === 2
      && server.zeilen('gym_routine_runs').every((z) => z.session_id === terminId),
    `${server.zeilen('gym_routine_runs').length}`)

  /* =========== Schritt 8: die Übersicht rechnet neu, ohne Knopfdruck === */
  await geh(pc, '/turnen', 2800)
  const nachErfassen = await heuteText(pc)
  pruefe('Heute meldet das erfasste Training',
    /Heutiges Turntraining erfasst/.test(nachErfassen), nachErfassen.slice(0, 300))
  pruefe('Mit den tatsächlich erfassten Zahlen',
    /20 Versuche/.test(nachErfassen) && /2 Kürdurchgänge/.test(nachErfassen),
    nachErfassen.slice(0, 400))
  pruefe('Und ohne Erfolgsaussage',
    !/gut|stark|schwach|Ziel erreicht|erfolgreich/i.test(nachErfassen),
    nachErfassen.slice(0, 400))
  pruefe('Es steht kein offenes Gerät mehr für heute da',
    (await heuteGeraete(pc)).length === 0, JSON.stringify(await heuteGeraete(pc)))
  pruefe('Der Vorschlag für die nächste Einheit ist wieder da',
    (await planKarte(pc).count()) > 0)

  /* ======= Schritt 9: 2D/2E/3A reagieren auf die neuen Daten =========== */
  /* Ausdruecklich NICHT am Analyse-Reiter: Der Trainingsfokus steht dort
     hinter einem Wettkampf mit eingetragenen Noten, und in diesem Test gibt
     es keinen - der Reiter zeigt zu Recht seinen Leerzustand. Geprueft wird
     an den zwei Stellen, die ohne Protokoll etwas aussagen. */
  const uebersicht = (await pc.page.innerText('#root')).replace(/\n/g, ' | ')
  pruefe('Die erfasste Einheit zählt in der Übersicht als absolviert mit',
    /Einheiten gesamt \| 1/.test(uebersicht), uebersicht.slice(0, 500))

  await geh(pc, '/turnen/elemente', 2400)
  const elemente = (await pc.page.innerText('#root')).replace(/\n/g, ' | ')
  pruefe('Die trainierten Elemente gelten als heute trainiert – die Grundlage von 2D',
    (elemente.match(/heute trainiert/g) ?? []).length >= 2, elemente.slice(0, 600))
  pruefe('Und die nicht trainierten bleiben unberührt',
    /nie trainiert|vor \d+ Tagen/.test(elemente), elemente.slice(0, 600))

  /* ========= Schritt 10: ein Termin für morgen – Heute bleibt leer ===== */
  await legeTerminAn(pc, { inTagen: 1 })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  const mitMorgen = await heuteText(pc)
  pruefe('Ein Termin von morgen macht heute kein Training',
    /Heutiges Turntraining erfasst/.test(mitMorgen), mitMorgen.slice(0, 300))
  pruefe('Er wird aber als nächste Turneinheit genannt',
    /Nächste Turneinheit/.test(mitMorgen) && /morgen/.test(mitMorgen),
    mitMorgen.slice(0, 400))

  /* ============== Schritt 11: keine Tabelle für den Tagesplan ========== */
  const tabellen = [...server.tabellen.keys()]
  pruefe('Es ist keine Tabelle für den heutigen Plan entstanden',
    tabellen.filter((t) => /daily|tagesplan|heute|readiness|adjustment/i.test(t)).length === 0,
    JSON.stringify(tabellen))
  pruefe('Die Prüfung sieht dabei wirklich Tabellen',
    tabellen.includes('workout_sessions') && tabellen.includes('sleep_sessions'),
    JSON.stringify(tabellen))

  /* ======= Schritt 12: Wettkampftag – kein erfundener Trainingsplan ==== */
  /* Zusätzlich ein eigener Turntermin für heute: Er darf am Wettkampftag
     nicht verschwinden und nicht still übergangen werden - die Entscheidung
     darüber bleibt bei Erik (23.8). */
  await legeTerminAn(pc, { inTagen: 0 })
  await abgleich(pc)
  pruefe('Ein eigener Turntermin für heute liegt als geplant vor',
    turnSitzungen().filter((z) => z.status === 'planned' && z.day === tagIn(0)).length === 1,
    JSON.stringify(turnSitzungen().map((z) => `${z.day}/${z.status}`)))

  await legeWettkampfAn(pc, { name: 'Landesfinale', tag: tagIn(0) })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  const wettkampftag = await heuteText(pc)
  pruefe('Heute meldet den Wettkampf',
    /Heute ist Wettkampf/.test(wettkampftag), wettkampftag.slice(0, 400))
  pruefe('Und schlägt dafür kein Training vor',
    (await heuteGeraete(pc)).length === 0, JSON.stringify(await heuteGeraete(pc)))
  pruefe('Kein erfundenes Aufwärmprogramm, keine Sätze, keine Minuten',
    !/aufwärm|Sätze|Wiederholung|Ernährung/i.test(wettkampftag), wettkampftag.slice(0, 500))
  pruefe('Der eigene Turntermin wird getrennt genannt statt übergangen',
    /eigener Turntermin|eigene Turntermine/.test(wettkampftag), wettkampftag.slice(0, 500))
  pruefe('Er lässt sich öffnen, ohne dass Heute einen Plan dafür erfindet',
    (await heuteKarte(pc).locator('button', { hasText: 'Termin öffnen' }).count()) > 0)
  pruefe('Und bleibt als geplante Einheit erhalten',
    turnSitzungen().filter((z) => z.status === 'planned' && z.day === tagIn(0)).length === 1,
    JSON.stringify(turnSitzungen().map((z) => `${z.day}/${z.status}`)))
  pruefe('„Nächstes Training" steht auch am Wettkampftag nicht zusätzlich daneben',
    (await planKarte(pc).count()) === 0, wettkampftag.slice(0, 300))
  pruefe('Der Schlaf bleibt dabei reiner Kontext',
    /Schlaf letzte Nacht/.test(wettkampftag)
      && !/zu wenig|ausreichend|erholt|Ampel/i.test(wettkampftag),
    wettkampftag.slice(0, 500))

  /* ============================================ Handy: 390 px und dunkel */
  handy = await starteGeraet({
    name: 'ht-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen', 3000)

  const handyText = await heuteText(handy)
  pruefe('Das Handy zeigt den Heute-Block',
    /Heute/.test(handyText), handyText.slice(0, 300))
  pruefe('Mit dem Schlaf im Kontext',
    /6 h 18 min/.test(handyText), handyText.slice(0, 400))

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Die Übersicht läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)
  const passt = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll(
      '.ht-status, .ht-kontext, .ht-kontext-teil, .ht-erfasst-zeile, .ht-naechste')]
    return els.length > 0 && els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die Heute-Zeilen passen in die Breite', passt)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(900)
  pruefe('Im dunklen Modus steht dasselbe da',
    /6 h 18 min/.test(await heuteText(handy)))
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.ht-status')
    if (!el) return null
    return { farbe: getComputedStyle(el).color, grund: getComputedStyle(document.body).backgroundColor }
  })
  pruefe('Und hebt sich vom Hintergrund ab',
    !!kontrast && kontrast.farbe !== kontrast.grund, JSON.stringify(kontrast))
  await handy.page.emulateMedia({ colorScheme: 'light' })

  /* ==================================================== Keine Fehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|415|422/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
} catch (fehler) {
  console.log(`\n  ABBRUCH: ${fehler?.stack ?? fehler}\n`)
  fehlend.push('Abbruch')
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
