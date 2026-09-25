/**
 * Was passiert, wenn der Server hinter dem Code zurückliegt.
 *
 * ---------------------------------------------------------------------------
 * Der Anlass
 *
 * Nach den Turnen-Phasen kannte Eriks Supabase-Projekt acht Tabellen noch
 * nicht – die Migration war eingecheckt, aber nicht eingespielt. Die App
 * meldete daraufhin bei jedem Abgleich eine Wand aus Text: achtmal derselbe
 * Erklärungssatz, einmal je Tabelle. Der Hinweis verdeckte den halben
 * Bildschirm und verbarg genau die Auskunft, auf die es ankam.
 *
 * Geprüft wird hier deshalb dreierlei:
 *
 *   1. Der Hinweis ist EIN kurzer Satz, egal wie viele Tabellen fehlen.
 *   2. Alles andere wird trotzdem abgeglichen – ein fehlendes Turnen-Schema
 *      darf die Buchungen nicht aufhalten.
 *   3. Die Diagnose sagt, welche Tabellen es sind und was zu tun ist.
 *
 * Aufruf:  node tests/sync-schema-e2e.mjs
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
/* Schemastand und Tabellenzahl kommen aus dem Schema selbst. Eingetragene
   Zahlen stimmen nur bis zur naechsten Migration und sind danach still
   falsch - `schema.ts` hat keine Importe und laesst sich hier deshalb
   unmittelbar laden. */
const { MIGRATIONS, SYNCED_TABLES } = await import('../src/db/schema.ts')
const HOECHSTE_MIGRATION = Math.max(...MIGRATIONS.map((m) => m.id))
const ZAHL_TABELLEN = SYNCED_TABLES.length

const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)

/* Genau die acht, die in Eriks Oberflaeche gemeldet wurden. */
const TURNEN = [
  'gym_elements', 'gym_attempts',
  'gym_routines', 'gym_routine_elements',
  'gym_routine_versions', 'gym_routine_version_elements',
  'gym_competitions', 'gym_results',
]

const server = await starteNachbau({ port: 54401, fehlendeTabellen: TURNEN })
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')

let pc
try {
  pc = await starteGeraet({ name: 'schema-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))

  /* =============================== Abgleich mit unvollstaendigem Schema */
  const meldung = await abgleich(pc)
  pruefe('Der Abgleich meldet das unvollständige Schema',
    /Server-Schema unvollständig/.test(meldung), meldung)
  pruefe('Er nennt die Zahl der fehlenden Tabellen',
    /8 Tabellen fehlen/.test(meldung), meldung)
  pruefe('Er sagt in einem Satz, was zu tun ist',
    /Migration/.test(meldung), meldung)

  /* ---------------------------------------- Der Hinweis bleibt kompakt */
  pruefe('Die Meldung ist kurz', meldung.length < 160, `${meldung.length} Zeichen`)
  const erklaerungen = (meldung.match(/Migration/g) ?? []).length
  pruefe('Der Erklärungstext steht genau einmal da', erklaerungen === 1,
    `${erklaerungen}-mal`)
  pruefe('Keine einzelne Tabelle im Hinweis',
    !/gym_elements|gym_results/.test(meldung), meldung)

  /* ------------------------------- Der Rest wird trotzdem abgeglichen */
  const konten = server.zeilen('accounts').length
  pruefe('Die übrigen Tabellen sind trotzdem angekommen', konten > 0,
    `${konten} Konten auf dem Server`)
  const tabellenDa = [...server.tabellen.keys()].filter((t) => !TURNEN.includes(t))
  pruefe('Und zwar viele davon', tabellenDa.length >= 20, `${tabellenDa.length} Tabellen`)
  pruefe('Von den fehlenden liegt nichts auf dem Server',
    TURNEN.every((t) => !server.tabellen.has(t)))

  /* --------------------------------- Der Status sagt nicht „alles gut" */
  await geh(pc, '/heute', 1500)
  const leiste = await text(pc)
  pruefe('Die Statuszeile behauptet nicht, alles sei synchronisiert',
    !/Gerade abgeglichen/.test(leiste) || /Server-Schema veraltet/.test(leiste),
    leiste.split(/\r?\n/).find((z) => /abgeglichen|Schema|Sync/.test(z)) ?? '(keine Zeile)')

  /* ------------------------------------------------- Die Diagnose */
  await geh(pc, '/einstellungen/sync', 2000)
  const diagnose = await text(pc)
  pruefe('Die Diagnose ist da', /Diagnose/.test(diagnose))
  // Beide Zahlen werden ABGELEITET und nicht eingetragen: Eine feste 16 war
  // nur bis zur naechsten Migration richtig und danach still falsch.
  pruefe(`Sie nennt den Schemastand des Geräts (Migration ${HOECHSTE_MIGRATION})`,
    new RegExp(`Migration ${HOECHSTE_MIGRATION}`).test(diagnose),
    diagnose.split(/\r?\n/).find((z) => /Migration \d/.test(z)))
  pruefe(`Sie nennt die Zahl der Tabellen im Abgleich (${ZAHL_TABELLEN})`,
    new RegExp(String(ZAHL_TABELLEN)).test(diagnose))
  pruefe('Sie sagt, wie viele dem Server fehlen', /8 Tabellen/.test(diagnose))
  pruefe('Und nennt die Datei, die auszuführen ist',
    /0001_init\.sql/.test(diagnose))

  await pc.page.locator('button', { hasText: 'Details anzeigen' }).first().click()
  await pc.page.waitForTimeout(700)
  const details = await text(pc)
  pruefe('Hinter „Details anzeigen" stehen die Tabellen',
    TURNEN.every((t) => details.includes(t)),
    TURNEN.filter((t) => !details.includes(t)).join(', ') || 'alle da')

  /* ==================================== Nach dem Einspielen ist Ruhe */
  server.setzeFehlendeTabellen([])
  // Der erste Lauf ist noch die Erstverbindung („Diesen Bestand auf den
  // Server laden"): Sie war vorhin am fehlenden Schema gescheitert und wird
  // deshalb erneut angeboten. Danach laeuft der gewoehnliche Abgleich.
  const erstlauf = await abgleich(pc)
  pruefe('Nach dem Einspielen kommt die Erstverbindung durch',
    /Auf den Server geladen/.test(erstlauf), erstlauf)

  const danach = await abgleich(pc)
  pruefe('Und der gewöhnliche Abgleich läuft sauber durch',
    /^Synchronisiert/.test(danach), danach)
  pruefe('Und meldet nichts Fehlendes mehr',
    !/unvollständig/.test(danach), danach)
  pruefe('Die Turnen-Tabellen sind jetzt auf dem Server',
    TURNEN.every((t) => server.tabellen.has(t)),
    TURNEN.filter((t) => !server.tabellen.has(t)).join(', ') || 'alle da')

  await geh(pc, '/einstellungen/sync', 2000)
  const sauber = await text(pc)
  pruefe('Die Diagnose meldet keine fehlenden Tabellen mehr',
    /Dem Server fehlen\s*keine/.test(sauber.replace(/\r?\n/g, ' ')),
    sauber.split(/\r?\n/).find((z) => /fehlen/.test(z)))

  /* ------------------------------------------------- Konsolenfehler */
  const echte = pc.fehler.filter(
    (f) => !/favicon|manifest|Failed to load resource|404|PGRST205/i.test(f))
  pruefe('Keine unerwarteten Fehler in der Konsole', echte.length === 0,
    echte.slice(0, 2).join(' | '))
} finally {
  await pc?.stop()
  await server.stop()
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
