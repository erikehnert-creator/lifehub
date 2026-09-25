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
 * Seit Phase 2B1 zusätzlich die Wettkämpfe:
 *
 *  10. Navigation zu den Wettkämpfen (rechnet je Zeile ein Bild)
 *  11. Einen Wettkampf öffnen (löst je Gerät eine Kürfassung auf)
 *  12. Ein Ergebnis bearbeiten
 *  13. Den Wettkampf speichern
 *
 * Seit Phase 2B2 zusätzlich der Protokollimport:
 *
 *  14. Protokoll hochladen und die Teilnehmerliste zeigen
 *  15. Teilnehmer wählen und die Vorschau aufbauen
 *  16. Den Import bestätigen
 *
 * Die PDF-Textextraktion steckt hier NICHT drin – der Nachbau deutet einen
 * fertigen Textbestand. Sie misst `tests/protokoll-integration.mjs` gegen
 * das echte Protokoll, mit derselben Bibliothek wie die Edge Function.
 *
 * Aufruf:  node tests/turnen-benchmark.mjs [elemente] [einheiten] [kueren] [wettkaempfe]
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteGeraet, anmelden, abgleich, geh, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import { stableId } from '../supabase/functions/_shared/stabileId.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ELEMENTE = Number(process.argv[2] ?? 60)
const EINHEITEN = Number(process.argv[3] ?? 200)
const KUEREN = Number(process.argv[4] ?? 20)
const WETTKAEMPFE = Number(process.argv[5] ?? 25)

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)

const GERAETE = ['boden', 'pauschenpferd', 'ringe', 'sprung', 'barren', 'reck']
/* Den Protokollbestand mitgeben, damit sich auch der Importweg messen
   laesst. Die PDF-Textextraktion steckt nicht darin - die misst
   tests/protokoll-integration.mjs gegen das echte Protokoll. */
const FIXTURE = path.join(WURZEL, 'tests', 'fixtures', 'protokoll-score-2026.json')
const protokollBestand = fs.existsSync(FIXTURE)
  ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null
const server = await starteNachbau({ port: 54395, protokoll: protokollBestand })
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

/* --------------------------------------- Wettkaempfe dazulegen
 *
 * Fuenfundzwanzig Wettkaempfe mit je drei bis sechs Geraetewertungen, und zu
 * jedem Reck- und Barrenergebnis eine eingefrorene Kuerfassung. Das ist der
 * Bestand, um den es bei der Anzeige wirklich geht: Die Wettkampfliste rechnet
 * je Zeile ein Bild, und das Detail loest je Geraet eine Fassung auf.
 *
 * Die IDs der Fassungen und Ergebnisse werden hier NICHT mit der Rechnung der
 * App gebildet (core/turnen/fassungen.ts laesst sich aus Node heraus nicht
 * laden). Das ist unschaedlich: Die Anzeige loest eine Fassung ueber
 * routine_version_id auf, und planeErgebnisse findet vorhandene Zeilen ueber
 * das Geraet - die abgeleitete ID braucht es nur beim NEU-Anlegen, und das
 * tut dieser Lauf nicht. Die IDs tragen deshalb ein eigenes Praefix, damit
 * niemand sie fuer echte haelt.
 */
let ergebnisZeilen = 0
let fassungsZeilen = 0
const fassungFuer = new Map()          // Geraet -> Fassungs-ID

for (const g of GERAETE) {
  // Je Geraet eine Fassung aus der ersten Kuer dieses Geraets.
  const kuerIndex = GERAETE.indexOf(g)
  if (kuerIndex >= KUEREN) continue
  const routineId = `kuer-${kuerIndex}`
  const passende = elementIds.filter((_, i) => GERAETE[i % GERAETE.length] === g)
  const anzahl = 5 + (kuerIndex % 11)
  const plaetze = []
  for (let p = 0; p < anzahl; p++) {
    const eid = passende[p % passende.length]
    const i = elementIds.indexOf(eid)
    plaetze.push({
      position: p,
      element_id: eid,
      name: `Element ${i + 1}`,
      difficulty_letter: 'ABCDEF'[i % 6],
      difficulty_value: 0.1 * (1 + (i % 6)),
      element_group: (i % 5) + 1,
      is_dismount: i % 9 === 0 ? 1 : 0,
    })
  }
  const versionId = stableId('bench-fassung', g, String(anzahl))
  fassungFuer.set(g, versionId)

  lege('gym_routine_versions', {
    id: versionId, routine_id: routineId, apparatus: g,
    name: `Kür ${kuerIndex + 1}`, frozen_at: tagVor(400) + 'T12:00:00Z',
  })
  fassungsZeilen++
  for (const p of plaetze) {
    lege('gym_routine_version_elements', {
      id: stableId('bench-platz', versionId, String(p.position)),
      version_id: versionId, ...p,
    })
    fassungsZeilen++
  }
}

for (let w = 0; w < WETTKAEMPFE; w++) {
  const id = `wk-${w}`
  lege('gym_competitions', {
    id, day: tagVor(w * 14), name: `Wettkampf ${w + 1}`,
    location: w % 3 === 0 ? 'Dresden' : 'Glashütte',
    class_name: 'LK3',
    rank_allround: (w % 8) + 1,
    score_allround: 68 + (w % 9) * 0.35,
    protocol_url: null, note: null,
  })
  // Drei bis sechs Geraete je Wettkampf.
  const wieViele = 3 + (w % 4)
  for (let i = 0; i < wieViele; i++) {
    const g = GERAETE[i]
    const d = 3.2 + (w % 7) * 0.1
    const e = 7.6 + (i % 5) * 0.15
    lege('gym_results', {
      id: stableId('bench-ergebnis', id, g),
      competition_id: id, apparatus: g,
      routine_version_id: fassungFuer.get(g) ?? null,
      d_score: Math.round(d * 1000) / 1000,
      // Jedes fuenfte Ergebnis ohne E-Wert - der Fall, der nirgends als 0
      // erscheinen darf.
      e_score: (w + i) % 5 === 0 ? null : Math.round(e * 1000) / 1000,
      penalty: (w + i) % 7 === 0 ? 0.1 : null,
      final_score: Math.round((d + e) * 1000) / 1000,
      rank_apparatus: (i % 6) + 1,
      note: null,
    })
    ergebnisZeilen++
  }
}

console.log(`\n=== Turnen-Benchmark ===\n`)
console.log(`  Bestand: ${ELEMENTE} Elemente, ${EINHEITEN} Einheiten, ${versuchsZeilen} Versuchszeilen`)
console.log(`           ${KUEREN} Küren mit ${kuerPlaetze} Plätzen\n`)
console.log(`           ${WETTKAEMPFE} Wettkämpfe mit ${ergebnisZeilen} Ergebnissen, ${fassungsZeilen} Fassungszeilen
`)

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

  /* ------------------------------------------------------ Wettkämpfe */

  await miss('Navigation → Wettkämpfe', async () => {
    await pc.page.goto(pc.url.split('#')[0] + '#/turnen/wettkaempfe')
    await pc.page.waitForSelector('.list-row', { timeout: 30000 })
  })

  await miss('Einen Wettkampf öffnen', async () => {
    await pc.page.locator('.list-row').first().click()
    await pc.page.waitForSelector('.modal .wk-karte', { timeout: 30000 })
  })

  await miss('Die historische Kürfassung öffnen', async () => {
    await pc.page.locator('.modal .wk-karte button', { hasText: 'Fassung vom' }).first().click()
    await pc.page.waitForSelector('.modal .kuer-zeile', { timeout: 30000 })
    await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
    await pc.page.waitForTimeout(200)
  })

  await miss('Ein Ergebnis bearbeiten', async () => {
    await pc.page.locator('.modal button', { hasText: 'Bearbeiten' }).first().click()
    await pc.page.waitForSelector('.modal .wk-felder input', { timeout: 30000 })
    const feld = pc.page.locator('.modal .wk-karte').first()
      .locator('.field', { hasText: 'E-Wert' }).locator('input').first()
    await feld.fill('8,45')
    // Warten, bis der Wert wirklich steht - sonst misst die Uhr den Tastendruck
    // und nicht das Neuzeichnen.
    await pc.page.waitForFunction(() => {
      const i = document.querySelector('.modal .wk-felder input')
      return i && i.value.length > 0
    }, null, { timeout: 30000 })
  })

  await miss('Wettkampf speichern', async () => {
    await pc.page.locator('.modal').last().locator('button', { hasText: 'Speichern' }).first().click()
    await pc.page.waitForSelector('.modal .wk-note', { timeout: 30000 })
  })

  await miss('Abgleich nach den Wettkampfänderungen', async () => {
    await abgleich(pc)
  })

  /* ------------------------------------------------ Protokollimport */

  if (protokollBestand) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-bench-'))
    const pdf = path.join(tmp, 'Protokoll.pdf')
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4 Platzhalter fuer die Messung'))

    await geh(pc, '/turnen/wettkaempfe', 1200)
    await miss('Protokoll hochladen und Teilnehmerliste zeigen', async () => {
      await pc.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
      await pc.page.waitForSelector('.modal input[type=file]', { state: 'attached', timeout: 30000 })
      await pc.page.locator('.modal input[type=file]').first().setInputFiles(pdf)
      // Gewartet wird, bis die Teilnehmer wirklich dastehen - nicht nur,
      // bis der Klick durch ist.
      await pc.page.waitForSelector('.modal .list-row', { timeout: 30000 })
    })

    await miss('Teilnehmer waehlen und Vorschau aufbauen', async () => {
      await pc.page.locator('.modal input[placeholder="Suchen…"]').first().fill('Ehnert')
      await pc.page.waitForFunction(
        () => document.querySelectorAll('.modal .list-row').length === 1, null, { timeout: 30000 })
      await pc.page.locator('.modal .list-row').first().click()
      await pc.page.waitForFunction(
        () => document.querySelectorAll('.modal .wk-karte').length === 6, null, { timeout: 30000 })
    })

    await miss('Import bestaetigen', async () => {
      await pc.page.locator('.modal').last()
        .locator('button', { hasText: 'Import bestätigen' }).first().click()
      await pc.page.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
    })

    fs.rmSync(tmp, { recursive: true, force: true })

    /* ------------------------------------------------------- Analyse */

    // Die Analyse wertet in EINEM Durchgang aus und merkt sich das Ergebnis
    // (`useMemo`). Gemessen wird deshalb der Wechsel auf den Reiter und danach
    // das Aufklappen eines Geraets - wuerde je Zeichnen neu gerechnet, faellt
    // das hier auf.
    await miss('Navigation → Analyse (mit Vergleichswerten)', async () => {
      await geh(pc, '/turnen/analyse', 0)
      await pc.page.waitForSelector('.wk-karte', { timeout: 30000 })
    })

    // Aufklappen laesst sich nur, wo es Vergleichswerte gibt. Die Analyse
    // zeigt den JUENGSTEN Wettkampf - im Messlauf ist das der eingesaete ohne
    // Protokoll, und dort steht bewusst kein Aufklapper.
    const aufklapper = pc.page.locator('.wk-karte button')
      .filter({ hasText: /Zahlen und Begründung/ })
    if (await aufklapper.count()) {
      await miss('Ein Geraet aufklappen', async () => {
        await aufklapper.first().click()
        await pc.page.waitForSelector('.an-tabelle', { timeout: 30000 })
      })
    }

    await miss('Zurueck zu den Wettkaempfen und wieder zur Analyse', async () => {
      await geh(pc, '/turnen/wettkaempfe', 0)
      await pc.page.waitForSelector('.list-row', { timeout: 30000 })
      await geh(pc, '/turnen/analyse', 0)
      await pc.page.waitForSelector('.wk-karte', { timeout: 30000 })
    })
  }

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
