/**
 * Turnen, Phase 3D: Der Wettkampfabstand verschiebt die Priorität.
 *
 * Die Regeln selbst sind in `turnen-vorbereitungsstrategie.test.ts` einzeln
 * nachgerechnet – inklusive des Kernfalls „derselbe Datenstand, drei
 * Abstände". Hier geht es um den Weg, den die Unit-Tests nicht zeigen:
 *
 *   Wettkampf weit in der Zukunft → Phase 3A zeigt Entwicklungsarbeit →
 *   Wettkampfdatum näher setzen, **sonst nichts ändern** → die Phase wechselt
 *   und der Vorschlag priorisiert nachvollziehbar anders → auf wenige Tage
 *   verschieben → der Entwicklungskandidat ist zurückgestellt → Durchgänge
 *   erfassen → der Vorschlag reagiert → Wettkampf löschen → die normale
 *   Phase-3A-Planung kehrt zurück
 *
 * Dazu die Stellen, an denen eine solche Schicht typischerweise Schaden
 * anrichtet:
 *
 *   - ohne Wettkampf darf der Vorschlag nicht anders aussehen als vor 3D
 *   - der zurückgestellte Inhalt darf nicht in „Noch offen" auftauchen
 *   - es darf kein Strategie-Datensatz entstehen
 *   - ein stabiles Gerät darf durch den nahen Termin kein Problem bekommen
 *   - am Wettkampftag darf kein Trainingsplan erfunden werden
 *
 * Dazu: 390 px, dunkler Modus, keine Konsolenfehler.
 *
 * Aufruf:  node tests/turnen-vorbereitung-e2e.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

/* Der Protokollbestand ist hier nicht Beiwerk, sondern Voraussetzung:
   Entwicklungsarbeit entsteht in Phase 3A nur bei der 2D-Empfehlung
   `schwierigkeit_pruefen`, und die braucht den Fokus „Schwierigkeit" aus
   Phase 2C - also ein Vergleichsfeld. Von Hand eingetragene Noten haben
   keines. Ohne Entwicklungsinhalt haette Phase 3D nichts zu verschieben. */
const FIXTURE = path.join(WURZEL, 'tests', 'fixtures', 'protokoll-score-2026.json')
if (!brauche(FIXTURE, 'Der Protokollbestand fehlt.')) process.exit(0)
const seitenBestand = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

const { parseProtokoll } = await import('../supabase/functions/wettkampf-import/protokoll.ts')
const bestand = parseProtokoll(seitenBestand)
const erik = bestand.teilnehmer.find((t) => (t.name.wert ?? '').startsWith('Ehnert'))
if (!erik) {
  console.log('\n  ÜBERSPRUNGEN: Kein Eintrag „Ehnert" im Bestand.\n')
  process.exit(0)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-vb-'))
const PDF_DATEI = path.join(TMP, 'Bezirksmeisterschaft 2026 Einzel.pdf')
fs.writeFileSync(PDF_DATEI, '%PDF-1.4\n% Platzhalter\n')

const server = await starteNachbau({ port: 54415, protokoll: seitenBestand })
const web = await starteWebserver(8107)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

function tagIn(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const zielKarte = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächster Wettkampf' }).first()
const zielText = async (g) => (await zielKarte(g).innerText()).replace(/\n/g, ' | ')

const planBlock = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächstes Training' }).first()
const planText = async (g) => (await planBlock(g).innerText()).replace(/\n/g, ' | ')

/** Die Geräte des 3A-Vorschlags mit ihren Inhalten, in Reihenfolge. */
const vorschlag = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('.card-title')?.textContent?.includes('Nächstes Training'))
  if (!karte) return []
  return [...karte.querySelectorAll('.np-geraet')].map((el) => ({
    name: el.querySelector('.np-name')?.textContent?.trim() ?? '',
    rolle: el.querySelector('.np-rolle')?.textContent?.trim() ?? '',
    inhalte: [...el.querySelectorAll('.np-inhalt')].map((x) => ({
      art: x.querySelector('.np-art')?.textContent?.trim() ?? '',
      text: x.querySelector('.np-inhalt-text')?.textContent?.trim() ?? '',
    })),
    zurueckgestellt: el.querySelector('.np-zurueckgestellt')?.textContent?.trim() ?? null,
  }))
})

/** Die Vorbereitungsphase, wie sie in der Wettkampfkarte steht. */
const phase = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('.card-title')?.textContent?.includes('Nächster Wettkampf'))
  const el = karte?.querySelector('.wz-phase .pill')
  return el ? el.textContent.trim() : null
})

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
 * Einen Wettkampf anlegen – mit Noten an einem Gerät, damit Phase 2C einen
 * Fokus bilden kann. Ohne Wettkampfbefund gibt es in 3A keine
 * Entwicklungsarbeit, und dann hätte 3D nichts zu verschieben.
 */
async function legeWettkampfAn(g, { name, tag, noten }) {
  await geh(g, '/turnen/wettkaempfe', 1600)
  await g.page.locator('button', { hasText: /^\+ Wettkampf$/ }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('input').first().fill(name)
  await modal.locator('input[type=date]').first().fill(tag)
  await g.page.waitForTimeout(400)
  if (noten) {
    await modal.locator('.turn-geraet', { hasText: noten.geraet }).first().click()
    await g.page.waitForTimeout(600)
    for (const [label, wert] of Object.entries(noten.werte)) {
      await modal.locator('.wk-liste .field', { hasText: label })
        .locator('input').first().fill(wert)
      await g.page.waitForTimeout(150)
    }
  }
  await modal.locator('button', { hasText: /^Speichern$/ }).first().click()
  await g.page.waitForTimeout(1800)
}

/** Das Datum eines vorhandenen Wettkampfs ändern. */
async function verschiebeWettkampf(g, { name, tag }) {
  await geh(g, '/turnen/wettkaempfe', 1600)
  await g.page.locator('.list-row', { hasText: name }).first().click()
  await g.page.waitForTimeout(900)
  await g.page.locator('.modal button', { hasText: 'Bearbeiten' }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('input[type=date]').first().fill(tag)
  await g.page.waitForTimeout(400)
  await modal.locator('button', { hasText: /^Speichern$/ }).first().click()
  await g.page.waitForTimeout(1800)
}

async function loescheWettkampf(g, { name }) {
  await geh(g, '/turnen/wettkaempfe', 1600)
  await g.page.locator('.list-row', { hasText: name }).first().click()
  await g.page.waitForTimeout(900)
  await g.page.locator('.modal button', { hasText: 'Löschen' }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal button', { hasText: 'Löschen' }).last().click()
  await g.page.waitForTimeout(1500)
}

async function erfasseTraining(g, { geraet, tipps, durchgaenge }) {
  await geh(g, '/turnen/training', 1600)
  await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await g.page.waitForTimeout(900)
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
    for (let n = 0; n < (d.stuerze ?? 0); n++) {
      await zeile.locator('.turn-zaehlfeld').filter({ hasText: 'Stürze' })
        .locator('button', { hasText: '+' }).first().click()
    }
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1900)
}

/** In die Wochenansicht umschalten. */
async function zurWoche(g) {
  const knopf = planBlock(g).locator('.segment button', { hasText: 'Kommende Einheiten' }).first()
  if (!(await knopf.count())) return false
  if ((await knopf.getAttribute('aria-pressed')) !== 'true') {
    await knopf.click()
    await g.page.waitForTimeout(900)
  }
  return true
}

async function zurEinheit(g) {
  const knopf = planBlock(g).locator('.segment button', { hasText: 'Nächste Einheit' }).first()
  if (!(await knopf.count())) return
  if ((await knopf.getAttribute('aria-pressed')) !== 'true') {
    await knopf.click()
    await g.page.waitForTimeout(900)
  }
}

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'vb-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  /* ============ Schritt 1: ein echtes Wettkampfprotokoll importieren ====
     Nur damit gibt es ein Vergleichsfeld und damit überhaupt einen
     Wettkampffokus - siehe die Begründung oben am Dateikopf. */
  await geh(pc, '/einstellungen', 1500)
  const namensfeld = pc.page.locator('input[placeholder="dein Vorname"]').first()
  if (await namensfeld.count()) {
    await namensfeld.fill('Erik Ehnert')
    await pc.page.waitForTimeout(700)
  }
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal input[type=file]').first().setInputFiles(PDF_DATEI)
  await pc.page.waitForTimeout(1800)
  await pc.page.locator('.modal .list-row').filter({ hasText: erik.name.wert }).first().click()
  await pc.page.waitForTimeout(1200)
  await pc.page.locator('.modal').last()
    .locator('button', { hasText: 'Import bestätigen' }).first().click()
  await pc.page.waitForTimeout(2000)
  await abgleich(pc)
  pruefe('Der importierte Wettkampf bringt Vergleichswerte mit',
    server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length > 0,
    `${server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length}`)

  /* ====== Schritt 2: Küren an drei Geräten, je mit einem Kandidaten ======
     Je Gerät zwei Kürelemente und ein schwierigeres Element AUSSERHALB der
     Kür. Welches Gerät daraus Entwicklungsarbeit bekommt, entscheidet das
     Protokoll - der Test sucht es sich und schreibt es nicht vor. */
  const GERAETE = [
    { name: 'Barren', a: 'Felge vorwärts', b: 'Kippe zum Handstand', k: 'Diamidow' },
    { name: 'Reck', a: 'Riesenfelge', b: 'Konterfelge', k: 'Tkatschew' },
    { name: 'Ringe', a: 'Muskelaufzug', b: 'Kreuzhang', k: 'Honma' },
  ]
  for (const g of GERAETE) {
    await legeElementAn(pc, { name: g.a, geraet: g.name, buchstabe: 'B', wert: '0,2' })
    await legeElementAn(pc, { name: g.b, geraet: g.name, buchstabe: 'C', wert: '0,3' })
    await legeElementAn(pc, { name: g.k, geraet: g.name, buchstabe: 'E', wert: '0,5' })
    await legeWettkampfKuerAn(pc, {
      name: `${g.name}kür 2026`, geraet: g.name, elemente: [g.a, g.b],
    })
  }
  /* Alle Elemente stabil turnen - den Kandidaten eingeschlossen, sonst nennt
     Phase 2D ihn nicht. Dazu saubere Kürdurchgänge. */
  for (const g of GERAETE) {
    await erfasseTraining(pc, {
      geraet: g.name,
      tipps: { [g.a]: { clean: 12 }, [g.b]: { clean: 12 }, [g.k]: { clean: 12 } },
      durchgaenge: [{ komplett: true }, { komplett: true }, { komplett: true }, { komplett: true }],
    })
  }
  await abgleich(pc)

  /* ========== Schritt 3: ohne kommenden Wettkampf – der Stand von vor 3D */
  await geh(pc, '/turnen', 2600)
  const ohneWk = await vorschlag(pc)
  pruefe('Ohne kommenden Wettkampf steht ein Vorschlag da',
    ohneWk.length > 0, JSON.stringify(ohneWk))
  pruefe('Und keine Vorbereitungsphase',
    (await phase(pc)) === null, `${await phase(pc)}`)
  pruefe('Der Block nennt auch keinen Wettkampfabstand',
    !/Wettkampf in \d+ Tagen/.test(await planText(pc)), (await planText(pc)).slice(0, 300))

  /** Das Gerät, an dem Phase 3A Entwicklungsarbeit vorschlägt. */
  const mitEntwicklung = ohneWk.find((g) => g.inhalte.some((i) => /Entwicklung/i.test(i.art)))
  pruefe('Mindestens ein Gerät zeigt Entwicklungsarbeit – sonst prüft der Rest nichts',
    !!mitEntwicklung, JSON.stringify(ohneWk.map((g) => [g.name, g.inhalte.map((i) => i.art)])))
  const GERAET = mitEntwicklung?.name ?? ohneWk[0]?.name
  const amGeraet = async () => (await vorschlag(pc)).find((g) => g.name === GERAET)
  pruefe('Nichts ist dabei zurückgestellt',
    ohneWk.every((g) => g.zurueckgestellt === null), JSON.stringify(ohneWk))

  /* ============ Schritt 4: Wettkampf weit in der Zukunft – Entwicklung */
  await legeWettkampfAn(pc, { name: 'Sachsenmeisterschaft', tag: tagIn(60) })
  await geh(pc, '/turnen', 2600)
  pruefe('Die Phase heisst Entwicklung',
    (await phase(pc)) === 'Entwicklung', `${await phase(pc)}`)
  const weit = await vorschlag(pc)
  pruefe('Der Vorschlag ist derselbe wie ohne Wettkampf',
    JSON.stringify(weit.map((g) => g.inhalte)) === JSON.stringify(ohneWk.map((g) => g.inhalte)),
    `${JSON.stringify(weit.map((g) => g.inhalte))} != ${JSON.stringify(ohneWk.map((g) => g.inhalte))}`)
  pruefe('Nichts ist zurückgestellt', weit.every((g) => g.zurueckgestellt === null))
  pruefe('Die Karte erklärt die Phase in einem Satz',
    /noch Zeit/.test(await zielText(pc)), (await zielText(pc)).slice(0, 500))

  /* ===== Schritt 5: nur das Datum näher setzen – sonst nichts geändert */
  await verschiebeWettkampf(pc, { name: 'Sachsenmeisterschaft', tag: tagIn(20) })
  await geh(pc, '/turnen', 2600)
  pruefe('Die Phase wechselt auf Stabilisierung',
    (await phase(pc)) === 'Stabilisierung', `${await phase(pc)}`)
  const mittel = await amGeraet()
  pruefe(`${GERAET} steht weiterhin im Vorschlag`,
    !!mittel, JSON.stringify(await vorschlag(pc)))
  pruefe('Die Entwicklungsarbeit ist noch da, steht aber nicht mehr vorn',
    mittel.inhalte.some((i) => /Entwicklung/i.test(i.art))
      && !/Entwicklung/i.test(mittel.inhalte[0].art),
    JSON.stringify(mittel.inhalte))
  pruefe('Nichts ist in dieser Phase zurückgestellt',
    mittel.zurueckgestellt === null, `${mittel.zurueckgestellt}`)
  pruefe('Der Block nennt den Abstand',
    /Wettkampf in 20 Tagen/.test(await planText(pc)), (await planText(pc)).slice(0, 400))

  /* ======= Schritt 6: auf wenige Tage verschieben – wettkampfnah ======= */
  await verschiebeWettkampf(pc, { name: 'Sachsenmeisterschaft', tag: tagIn(6) })
  await geh(pc, '/turnen', 2600)
  pruefe('Die Phase wechselt auf wettkampfnah',
    (await phase(pc)) === 'wettkampfnah', `${await phase(pc)}`)
  const nah = await amGeraet()
  pruefe('Die Entwicklungsarbeit steht nicht mehr im aktiven Vorschlag',
    !nah.inhalte.some((i) => /Entwicklung/i.test(i.art)),
    JSON.stringify(nah.inhalte))
  pruefe('Sie ist dafür ausdrücklich als zurückgestellt benannt',
    nah.zurueckgestellt && /zurückgestellt/.test(nah.zurueckgestellt),
    `${nah.zurueckgestellt}`)
  pruefe('Die Kür am Stück steht weiterhin da',
    nah.inhalte.some((i) => /Kür am Stück/i.test(i.art)),
    JSON.stringify(nah.inhalte))
  pruefe(`${GERAET} wird dadurch nicht zum Problemgerät`,
    nah.rolle === mittel.rolle, `${mittel.rolle} -> ${nah.rolle}`)

  /* ---------------------- Nachvollziehbarkeit: keine Blackbox */
  const warumKnopf = planBlock(pc).locator('.np-geraet').filter({ hasText: GERAET })
    .first().locator('button', { hasText: 'Warum dieses Gerät' }).first()
  if (await warumKnopf.count()) {
    await warumKnopf.click()
    await pc.page.waitForTimeout(700)
    const begruendung = await planBlock(pc).locator('.np-geraet')
      .filter({ hasText: GERAET }).first().innerText()
    pruefe('Die Begründung sagt, was ohne Wettkampfkontext dagestanden hätte',
      /Ohne Wettkampfkontext/.test(begruendung), begruendung.replace(/\n/g, ' | ').slice(0, 500))
    pruefe('Und was die Vorbereitung daran geändert hat',
      /zurückgestellt/.test(begruendung), begruendung.replace(/\n/g, ' | ').slice(0, 500))
  } else {
    pruefe('Der Begründungsknopf ist erreichbar', false, 'np-warum fehlt')
  }

  /* ========= Schritt 7: Phase 3B nennt die Phase, plant aber wie bisher */
  await zurWoche(pc)
  const wochenText = await planText(pc)
  pruefe('Die Wochenansicht nennt die Phase',
    /wettkampfnah/.test(wochenText), wochenText.slice(0, 400))
  const kandidatName = (nah.zurueckgestellt ? GERAETE.find((g) => g.name === GERAET)?.k : null)
    ?? 'Tkatschew'
  pruefe('Der zurückgestellte Kandidat steht nicht unter „Noch offen"',
    !new RegExp(kandidatName).test(wochenText), `${kandidatName}: ${wochenText.slice(0, 600)}`)
  await zurEinheit(pc)

  /* ==== Schritt 8: Durchgänge erfassen – der Vorschlag reagiert weiter == */
  await erfasseTraining(pc, {
    geraet: GERAET,
    durchgaenge: [{ komplett: false, stuerze: 1 }, { komplett: false, stuerze: 1 },
      { komplett: false, stuerze: 1 }, { komplett: false, stuerze: 1 },
      { komplett: false, stuerze: 1 }, { komplett: false, stuerze: 1 }],
  })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  const danach = await amGeraet()
  pruefe('Nach sechs Abbrüchen führt die Kür am Stück',
    danach && /Kür am Stück/i.test(danach.inhalte[0].art),
    JSON.stringify(danach?.inhalte))
  pruefe('Die Entwicklungsarbeit bleibt zurückgestellt oder entfällt ganz',
    !danach.inhalte.some((i) => /Entwicklung/i.test(i.art)),
    JSON.stringify(danach.inhalte))

  /* =============== Schritt 9: kein persistierter Strategie-Datensatz === */
  const tabellen = Object.keys(server.alleTabellen ? server.alleTabellen() : {})
  pruefe('Es ist keine Tabelle für die Vorbereitung entstanden',
    tabellen.filter((t) => /phase|strategy|strategie|readiness|vorbereitung/i.test(t)).length === 0,
    JSON.stringify(tabellen))
  const einstellungen = server.zeilen('settings').filter((z) => !z.deleted_at)
  pruefe('Und keine Einstellung',
    einstellungen.filter((z) => /phase|strategie|vorbereitung|readiness/i.test(z.key ?? '')).length === 0,
    JSON.stringify(einstellungen.map((z) => z.key)))

  /* ============= Schritt 10: Wettkampf auf heute – Wettkampftag ======== */
  await verschiebeWettkampf(pc, { name: 'Sachsenmeisterschaft', tag: tagIn(0) })
  await geh(pc, '/turnen', 2600)
  pruefe('Die Phase heisst Wettkampftag',
    (await phase(pc)) === 'Wettkampftag', `${await phase(pc)}`)
  const tagText = await planText(pc)
  pruefe('Es steht die Feststellung da und kein Trainingsplan',
    /Heute ist Wettkampf/.test(tagText), tagText.slice(0, 400))
  pruefe('Kein Gerät wird für heute vorgeschlagen',
    (await vorschlag(pc)).length === 0, JSON.stringify(await vorschlag(pc)))
  pruefe('Und kein erfundenes Aufwärmprogramm',
    !/aufwärm|Satz|Sätze|Wiederholung|Minuten/i.test(tagText), tagText.slice(0, 400))
  pruefe('Der Erfassungsweg bleibt erreichbar',
    (await planBlock(pc).locator('button', { hasText: 'Training frei erfassen' }).count()) > 0)

  /* ========= Schritt 11: Wettkampf löschen – zurück zur normalen Planung */
  await loescheWettkampf(pc, { name: 'Sachsenmeisterschaft' })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  pruefe('Ohne Wettkampf ist die Phase wieder weg',
    (await phase(pc)) === null, `${await phase(pc)}`)
  const zurueck = await vorschlag(pc)
  pruefe('Der normale Phase-3A-Vorschlag ist zurück',
    zurueck.length > 0 && zurueck.every((g) => g.zurueckgestellt === null),
    JSON.stringify(zurueck))
  pruefe('Und der Block nennt keinen Wettkampfabstand mehr',
    !/Wettkampf in \d+ Tagen/.test(await planText(pc)), (await planText(pc)).slice(0, 300))
  pruefe('Der vergangene Wettkampf bleibt dabei erhalten',
    server.zeilen('gym_competitions').filter((z) => !z.deleted_at).length === 1,
    `${server.zeilen('gym_competitions').filter((z) => !z.deleted_at).length}`)

  /* ============================================ Handy: 390 px und dunkel */
  await legeWettkampfAn(pc, { name: 'Pokalturnen', tag: tagIn(5) })
  await abgleich(pc)

  handy = await starteGeraet({
    name: 'vb-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen', 3000)

  pruefe('Das Handy zeigt die Phase',
    (await phase(handy)) === 'wettkampfnah', `${await phase(handy)}`)
  const handyPlan = await vorschlag(handy)
  pruefe('Und den zurückgestellten Kandidaten',
    handyPlan.some((g) => g.zurueckgestellt !== null), JSON.stringify(handyPlan))

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Die Übersicht läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)
  const passt = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll(
      '.wz-phase, .wz-phase-satz, .np-phase, .np-zurueckgestellt')]
    return els.length > 0 && els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die neuen Zeilen passen in die Breite', passt)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(900)
  pruefe('Im dunklen Modus steht dasselbe da',
    (await phase(handy)) === 'wettkampfnah', `${await phase(handy)}`)
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.wz-phase .pill')
    if (!el) return null
    const s = getComputedStyle(el)
    return { farbe: s.color, grund: s.backgroundColor }
  })
  pruefe('Und die Phasenpille hat eine eigene Farbe',
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
