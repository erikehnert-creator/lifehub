/**
 * Was das Turnen-Modul kostet – mit einem realistischen Bestand.
 *
 * Der allgemeine Benchmark (`performance-benchmark.mjs`) misst die App als
 * Ganzes, aber mit LEEREN Turntabellen. Das sagt nichts darüber, wie sich der
 * Erfassungsweg anfühlt, wenn sechzig Elemente und zwei Jahre Training
 * dahinterliegen – und genau das ist die Frage, an der das Modul hängt.
 *
 * Gemessen wird deshalb:
 *   1. Navigation in den Bereich Turnen (Übersicht rechnet alle Elementbilder)
 *   2. Öffnen des Erfassungswegs (Elementliste je Gerät aufbauen)
 *   3. Ein Zählertipp (reine Zustandsänderung, muss unmerklich sein)
 *   4. Speichern einer Einheit mit zwölf Elementen (ein Stapel)
 *
 * Seit Phase 2A zusätzlich die Küren – dieselbe Frage, andere Seite:
 *
 *   5. Navigation zu den Küren (rechnet je Kür Summe und Problemstellen)
 *   6. Eine Kür öffnen
 *   7. Ein Element hinzufügen
 *   8. Die Reihenfolge ändern
 *   9. Die Kür speichern
 *
 * Aufruf:  node tests/turnen-benchmark.mjs [elemente] [einheiten] [kueren]
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteGeraet, anmelden, abgleich, geh, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import { stableId } from '../supabase/functions/_shared/stabileId.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ELEMENTE = Number(process.argv[2] ?? 60)
const EINHEITEN = Number(process.argv[3] ?? 200)
const KUEREN = Number(process.argv[4] ?? 20)

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)

const GERAETE = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']
const server = await starteNachbau({ port: 54395 })
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const jetzt = () => new Date().toISOString()
const USER = '11111111-1111-1111-1111-111111111111'
let rev = 10000

function lege(tabelle, zeile) {
  if (!server.tabellen.has(tabelle)) server.tabellen.set(tabelle, new Map())
  server.tabellen.get(tabelle).set(zeile.id, {
    ...zeile, user_id: USER,
    created_at: jetzt(), updated_at: jetzt(), deleted_at: null,
    version: 1, last_device_id: 'bench', server_rev: ++rev,
  })
}

/* ---------------------------------------- Einen Bestand aufbauen */

const tagVor = (n) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const elementIds = []
for (let i = 0; i < ELEMENTE; i++) {
  const id = `el-${i}`
  elementIds.push(id)
  lege('gym_elements', {
    id, apparatus: GERAETE[i % GERAETE.length], name: `Element ${i + 1}`,
    difficulty_letter: 'ABCDEF'[i % 6], difficulty_value: 0.1 * (1 + (i % 6)),
    element_group: (i % 5) + 1, is_dismount: i % 9 === 0 ? 1 : 0, hold_element: 0,
    status: ['neu', 'aufbau', 'unsicher', 'sicher', 'wettkampfreif'][i % 5],
    video_url: null, note: null, is_active: 1, sort_order: i,
  })
}

let versuchsZeilen = 0
for (let s = 0; s < EINHEITEN; s++) {
  const sid = `ses-${s}`
  const tag = tagVor(s * 3)
  lege('workout_sessions', {
    id: sid, day: tag, plan_day_id: null, title: 'Turnen', type: null,
    started_at: null, ended_at: null, duration_minutes: 90,
    status: 'completed', perceived_effort: null, note: null, discipline: 'turnen',
  })
  // Je Einheit ein Geraet, zehn Elemente davon.
  const geraet = GERAETE[s % GERAETE.length]
  const passende = elementIds.filter((_, i) => GERAETE[i % GERAETE.length] === geraet).slice(0, 10)
  for (const [i, eid] of passende.entries()) {
    lege('gym_attempts', {
      id: stableId('gym_attempts', sid, eid),
      session_id: sid, element_id: eid,
      clean: 3 + (i % 4), shaky: i % 3, failed: i % 5 === 0 ? 1 : 0,
      with_help: i % 7 === 0 ? 1 : 0, note: null, sort_order: i,
    })
    versuchsZeilen++
  }
}

/* ------------------------------------------------ Kueren dazulegen
 *
 * Zwanzig Kueren mit fuenf bis fuenfzehn Plaetzen - der Bestand, den Erik
 * fuer die Messung vorgegeben hat. Je Geraet mehrere, damit die Gruppierung
 * wirklich etwas zu tun hat, und je Geraet genau EINE mit einem Zeitpunkt,
 * damit die abgeleitete Wettkampfkuer nicht trivial ausfaellt.
 */
let kuerPlaetze = 0
for (let k = 0; k < KUEREN; k++) {
  const id = `kuer-${k}`
  const geraet = GERAETE[k % GERAETE.length]
  // Die erste Kuer je Geraet traegt einen Zeitpunkt, die spaeteren nicht -
  // sonst haette die Ableitung je Geraet nur einen Bewerber.
  const zeitpunkt = k < GERAETE.length
    ? new Date(Date.now() - (GERAETE.length - k) * 86400000).toISOString()
    : null
  lege('gym_routines', {
    id, apparatus: geraet, name: `Kür ${k + 1}`,
    note: null, competition_since: zeitpunkt, is_active: 1,
  })
  const passende = elementIds.filter((_, i) => GERAETE[i % GERAETE.length] === geraet)
  const anzahl = 5 + (k % 11)          // 5 bis 15
  for (let p = 0; p < anzahl; p++) {
    lege('gym_routine_elements', {
      id: `kuer-${k}-p${p}`, routine_id: id,
      // Bei weniger als 15 Elementen je Geraet kommen Elemente mehrfach vor -
      // das ist erlaubt und genau der Fall, den die Anzeige aushalten muss.
      element_id: passende[p % passende.length],
      position: p, note: null,
    })
    kuerPlaetze++
  }
}

console.log(`\n=== Turnen-Benchmark ===\n`)
console.log(`  Bestand: ${ELEMENTE} Elemente, ${EINHEITEN} Einheiten, ${versuchsZeilen} Versuchszeilen`)
console.log(`           ${KUEREN} Küren mit ${kuerPlaetze} Plätzen\n`)

const messungen = []
const miss = async (name, fn) => {
  const t = Date.now()
  await fn()
  const ms = Date.now() - t
  messungen.push({ name, ms })
  console.log(`  ${String(ms).padStart(6)} ms  ${name}`)
}

let pc
try {
  pc = await starteGeraet({ name: 'turnen-bench', url: EINZELDATEI })
  await anmelden(pc, ZUGANG)
  await abgleich(pc)
  await abgleich(pc)        // zweiter Lauf: alles da, nichts mehr zu holen

  // Aufwaermen, damit nicht der erste Seitenaufbau gemessen wird.
  await geh(pc, '/heute', 1500)

  await miss('Navigation → Turnen (Übersicht)', async () => {
    await pc.page.goto(pc.url.split('#')[0] + '#/turnen')
    await pc.page.waitForSelector('.turn-kachel', { timeout: 30000 })
  })

  await miss('Navigation → Elemente', async () => {
    await pc.page.goto(pc.url.split('#')[0] + '#/turnen/elemente')
    await pc.page.waitForSelector('.list-row', { timeout: 30000 })
  })

  await geh(pc, '/turnen/training', 1500)
  await miss('Erfassungsweg öffnen (Gerät wählen)', async () => {
    await pc.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
    await pc.page.waitForSelector('.modal .turn-geraet', { timeout: 30000 })
    await pc.page.locator('.modal .turn-geraet').first().click()
    await pc.page.waitForSelector('.turn-zaehler-knopf', { timeout: 30000 })
  })

  await miss('Ein Zählertipp', async () => {
    await pc.page.locator('.turn-zaehler-knopf').first().click()
    await pc.page.waitForTimeout(0)
  })

  await miss('Einheit speichern (12 Elemente)', async () => {
    // Je Elementzeile drei Knoepfe - der erste jeder Zeile ist "gelungen".
    // Nur so viele, wie es wirklich gibt: Ein Griff ins Leere liesse
    // Playwright dreissig Sekunden warten und die Messung waere Unsinn.
    const knoepfe = pc.page.locator('.turn-zaehler-knopf')
    const zeilen = Math.floor((await knoepfe.count()) / 3)
    for (let i = 0; i < Math.min(12, zeilen); i++) await knoepfe.nth(i * 3).click()
    await pc.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
    await pc.page.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
  })

  await miss('Übersicht nach dem Speichern', async () => {
    await pc.page.goto(pc.url.split('#')[0] + '#/turnen')
    await pc.page.waitForSelector('.turn-kachel', { timeout: 30000 })
  })

  /* ------------------------------------------------------------ Küren */

  await miss('Navigation → Küren', async () => {
    await pc.page.goto(pc.url.split('#')[0] + '#/turnen/kueren')
    await pc.page.waitForSelector('.list-row', { timeout: 30000 })
  })

  await miss('Eine Kür öffnen', async () => {
    await pc.page.locator('.list-row').first().click()
    await pc.page.waitForSelector('.modal .kuer-zeile', { timeout: 30000 })
  })

  await miss('Ein Element hinzufügen', async () => {
    const vorher = await pc.page.locator('.modal .kuer-zeile').count()
    await pc.page.locator('.modal button', { hasText: '+ Element' }).first().click()
    await pc.page.waitForSelector('.modal input[placeholder="Suchen…"]', { timeout: 30000 })
    await pc.page.locator('.modal').last().locator('.list-row').first().click()
    await pc.page.locator('.modal').last().locator('button', { hasText: 'Fertig' }).first().click()
    // Warten, bis der Platz wirklich in der Liste steht - sonst misst die
    // Uhr nur den Klick und nicht das Neuzeichnen.
    await pc.page.waitForFunction(
      (n) => document.querySelectorAll('.modal .kuer-zeile').length === n + 1,
      vorher, { timeout: 30000 })
  })

  await miss('Reihenfolge ändern', async () => {
    await pc.page.locator('.modal .kuer-zeile').first()
      .locator('button[aria-label="nach unten"]').click()
    await pc.page.waitForFunction(() => {
      const erste = document.querySelector('.modal .kuer-zeile .kuer-platz')
      return erste && erste.textContent.trim() === '1'
    }, null, { timeout: 30000 })
  })

  await miss('Kür speichern', async () => {
    await pc.page.locator('.modal').last().locator('button', { hasText: 'Speichern' }).first().click()
    await pc.page.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
  })

  await miss('Abgleich nach den Küränderungen', async () => {
    await abgleich(pc)
  })

  const fehler = pc.fehler.filter((f) => !/favicon|manifest|Failed to load resource/i.test(f))
  if (fehler.length) console.log(`\n  ACHTUNG: ${fehler.length} Konsolenfehler: ${fehler[0]}`)
} finally {
  await pc?.stop()
  await server.stop()
}

console.log('')
const langsam = messungen.filter((m) => m.ms > 1000)
if (langsam.length) {
  console.log(`  Über eine Sekunde: ${langsam.map((m) => m.name).join(', ')}`)
} else {
  console.log('  Alles unter einer Sekunde.')
}
console.log('')
