/**
 * Zwei Geräte, ein Server: der vollständige Abgleich einmal durchgespielt.
 *
 * "PC"    = die Einzeldatei LifeHub.html über file://
 * "Handy" = die gehostete Fassung aus dist/ über http, in Handygröße
 *
 * Beide sprechen mit dem Nachbau der Supabase-Schnittstellen, der auf einer
 * echten Postgres-Datenbank mit dem erzeugten Serverschema läuft.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SUPA = 'http://127.0.0.1:54321'
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

/* ------------------------------------------------- dist/ über http anbieten */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join('/home/claude/lifehub/app/dist', rel === '/' ? 'index.html' : rel)
  if (!file.startsWith('/home/claude/lifehub/app/dist') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nicht gefunden'); return
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})
await new Promise((r) => site.listen(8080, r))

/* ------------------------------------------------------------- Hilfsmittel */
const log = (...a) => console.log(...a)
const fails = []
const norm = (v) => String(v).replace(/\u00a0/g, ' ').trim()
function pruefe(name, ist, soll) {
  const ok = norm(ist) === norm(soll)
  log(`${ok ? '  ok ' : '  FEHLER '} ${name}: ${ist}${ok ? '' : `  (erwartet: ${soll})`}`)
  if (!ok) fails.push(name)
}

async function starte(name, url, viewport) {
  const dir = `/tmp/e2e-${name}`
  fs.rmSync(dir, { recursive: true, force: true })
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: EXE, viewport })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url)
  await page.waitForSelector('#root > *', { timeout: 40000 })
  await page.waitForTimeout(2500)
  return { ctx, page, url, errors, name }
}

const geh = async (d, hash) => { await d.page.goto(d.url + '#' + hash); await d.page.waitForTimeout(1200) }

async function einrichten(d) {
  await geh(d, '/einstellungen/sync')
  await d.page.locator('input[placeholder*="supabase.co"]').fill(SUPA)
  await d.page.locator('input[placeholder*="supabase.co"]').blur()
  await d.page.waitForTimeout(300)
  const felder = d.page.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(ANON)
  await felder.nth(1).blur()
  await d.page.waitForTimeout(500)
  await d.page.locator('input[type=email]').fill(MAIL)
  await d.page.locator('input[type=password]').fill(PASS)
  await d.page.locator('button', { hasText: 'Anmelden' }).click()
  await d.page.waitForTimeout(2500)
  const txt = await d.page.innerText('#root')
  return txt.includes('angemeldet als')
}

async function abgleich(d, fresh = false) {
  await geh(d, '/einstellungen/sync')
  if (fresh) {
    await d.page.locator('button', { hasText: 'Dieses Gerät vom Server befüllen' }).click()
    await d.page.waitForTimeout(600)
    await d.page.locator('.modal button', { hasText: 'Vom Server befüllen' }).click()
  } else if (await d.page.locator('button', { hasText: 'Diesen Bestand auf den Server laden' }).count()) {
    // Erstverbindung: Dieses Gerät bringt die Daten mit.
    await d.page.locator('button', { hasText: 'Diesen Bestand auf den Server laden' }).click()
    await d.page.waitForTimeout(600)
    await d.page.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
  } else {
    await d.page.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
  }
  for (let i = 0; i < 120; i++) {
    await d.page.waitForTimeout(1000)
    const t = await d.page.innerText('#root')
    const m = t.match(/(Synchronisiert:[^\n]*|Vom Server übernommen:[^\n]*|Auf den Server geladen:[^\n]*|Synchronisation fehlgeschlagen:[^\n]*|Nicht angemeldet[^\n]*)/)
    if (m) return m[1]
  }
  return '(keine Rückmeldung)'
}

const vermoegen = async (d) => {
  await geh(d, '/finanzen')
  await d.page.waitForTimeout(1500)
  return ((await d.page.innerText('#root')).match(/Gesamtvermögen\s*\n?\s*([^\n]+)/) || ['', '—'])[1]
}

/* ================================================================== Ablauf */

log('\n1) PC starten und die echten Daten einspielen')
const pc = await starte('pc', 'file:///home/claude/lifehub/LifeHub.html', { width: 1280, height: 900 })
await geh(pc, '/einstellungen')
await pc.page.locator('button', { hasText: 'Daten & Backup' }).first().click()
await pc.page.waitForTimeout(500)
await pc.page.locator('input[type=file][accept*="json"]').first().setInputFiles('/home/claude/lifehub/LifeHub-Daten-Erik.json')
await pc.page.waitForTimeout(1500)
await pc.page.locator('.modal .btn-primary').first().click()
await pc.page.waitForTimeout(4000)
pruefe('PC Gesamtvermögen nach Import', await vermoegen(pc), '15.106 €')

log('\n2) PC mit dem Server verbinden und alles hochladen')
pruefe('PC angemeldet', await einrichten(pc), 'true')
const r1 = await abgleich(pc)
log('   →', r1)
pruefe('PC hat Daten gesendet', /(Synchronisiert: [1-9]\d* gesendet|Auf den Server geladen: [1-9]\d*)/.test(r1), 'true')

log('\n3) Handy starten (gehostete Fassung) und vom Server befüllen')
const handy = await starte('handy', 'http://127.0.0.1:8080/', { width: 390, height: 844 })
pruefe('Handy angemeldet', await einrichten(handy), 'true')
const r2 = await abgleich(handy, true)
log('   →', r2)
pruefe('Handy Gesamtvermögen', await vermoegen(handy), '15.106 €')

const buchungenHandy = async () => {
  await geh(handy, '/finanzen/buchungen')
  await handy.page.waitForTimeout(1200)
  return ((await handy.page.innerText('#root')).match(/(\d+) Buchungen/) || ['', '0'])[1]
}
pruefe('Handy Buchungen', await buchungenHandy(), '67')

log('\n4) Auf dem Handy eine Buchung erfassen')
await geh(handy, '/finanzen')
await handy.page.locator('.fab, button.fab').first().click()
await handy.page.waitForTimeout(800)
await handy.page.locator('.modal button', { hasText: 'Ausgabe' }).first().click()
await handy.page.waitForTimeout(700)
for (const k of ['1', '2', '3', '4']) {
  await handy.page.locator('.numpad button', { hasText: new RegExp('^' + k + '$') }).first().click()
}
await handy.page.locator('button', { hasText: 'Weitere Angaben' }).click()
await handy.page.waitForTimeout(400)
await handy.page.locator('input[placeholder*="REWE"]').fill('Test vom Handy')
await handy.page.locator('.modal .btn-primary, button.btn-primary').last().click()
await handy.page.waitForTimeout(2000)
const r3 = await abgleich(handy)
log('   →', r3)
pruefe('Handy hat gesendet', /(Synchronisiert: [1-9]\d* gesendet|Auf den Server geladen: [1-9]\d*)/.test(r3), 'true')

log('\n5) PC abgleichen – die Handybuchung muss ankommen')
const r4 = await abgleich(pc)
log('   →', r4)
await geh(pc, '/finanzen/buchungen')
await pc.page.waitForTimeout(1500)
const pcText = await pc.page.innerText('#root')
pruefe('PC kennt die Handybuchung', pcText.includes('Test vom Handy'), 'true')
pruefe('PC Buchungen', (pcText.match(/(\d+) Buchungen/) || ['', '0'])[1], '68')

log('\n6) Änderung am PC – muss zurück aufs Handy')
await pc.page.locator('.list-row', { hasText: 'Test vom Handy' }).first().click()
await pc.page.waitForTimeout(800)
await pc.page.locator('.modal input').first().fill('55,50')
await pc.page.locator('.modal .btn-primary', { hasText: 'Speichern' }).click()
await pc.page.waitForTimeout(1500)
log('   →', await abgleich(pc))
log('   →', await abgleich(handy))
await geh(handy, '/finanzen/buchungen')
await handy.page.waitForTimeout(1500)
pruefe('Handy sieht den neuen Betrag', (await handy.page.innerText('#root')).includes('55,50'), 'true')

log('\n7) Beleg am PC anhängen – muss aufs Handy wandern')
await geh(pc, '/finanzen/buchungen')
await pc.page.waitForTimeout(1000)
await pc.page.locator('.list-row', { hasText: 'Test vom Handy' }).first().click()
await pc.page.waitForTimeout(800)
await pc.page.locator('.modal input[type=file][accept*="pdf"]').first().setInputFiles('/tmp/kassenzettel.jpg')
await pc.page.waitForTimeout(1500)
await pc.page.locator('.modal .btn-primary', { hasText: 'Speichern' }).click()
await pc.page.waitForTimeout(1200)
log('   →', await abgleich(pc))
log('   →', await abgleich(handy))
await geh(handy, '/finanzen/buchungen')
await handy.page.waitForTimeout(1500)
pruefe('Handy zeigt das Beleg-Symbol', (await handy.page.innerText('#root')).includes('📎'), 'true')
await handy.page.locator('.list-row', { hasText: 'Test vom Handy' }).first().click()
await handy.page.waitForTimeout(1000)
pruefe('Beleg auf dem Handy vorhanden',
  (await handy.page.innerText('.modal')).includes('kassenzettel'), 'true')
const bild = await handy.page.locator('.modal .list-row button').first()
await bild.click()
await handy.page.waitForTimeout(1000)
pruefe('Belegbild lässt sich öffnen', await handy.page.locator('.modal img').count() > 0, 'true')
await handy.page.keyboard.press('Escape'); await handy.page.waitForTimeout(400)
await handy.page.keyboard.press('Escape'); await handy.page.waitForTimeout(600)

log('\n8) Löschen am Handy – muss am PC verschwinden')
await geh(handy, '/finanzen/buchungen')
await handy.page.locator('.list-row', { hasText: 'Test vom Handy' }).first().click()
await handy.page.waitForTimeout(800)
await handy.page.locator('.modal-foot button', { hasText: 'Löschen' }).first().click()
await handy.page.waitForTimeout(700)
// Der Bestätigungsdialog liegt über dem Editor – gezielt dort klicken
// Der Bestätigungsdialog steckt im Editor-Fenster – deshalb die innere Ebene
await handy.page.screenshot({ path: '/tmp/s-handy-loeschen.png' })
await handy.page.locator('.overlay .overlay .modal-foot button', { hasText: 'Löschen' }).click()
await handy.page.waitForTimeout(1500)
log('   →', await abgleich(handy))
log('   →', await abgleich(pc))
await geh(pc, '/finanzen/buchungen')
await pc.page.waitForTimeout(1500)
const nachLoeschen = await pc.page.innerText('#root')
pruefe('PC: Buchung ist weg', !nachLoeschen.includes('Test vom Handy'), 'true')
pruefe('PC Buchungen wieder', (nachLoeschen.match(/(\d+) Buchungen/) || ['', '0'])[1], '67')

log('\n9) Beide offline geändert – Konflikt bei einem Betrag')
await pc.ctx.setOffline(true); await handy.ctx.setOffline(true)
const zeile = async (d) => {
  await geh(d, '/finanzen/buchungen')
  await d.page.locator('.list-row').first().click()
  await d.page.waitForTimeout(800)
}
await zeile(pc)
await pc.page.locator('.modal input').first().fill('11,11')
await pc.page.locator('.modal .btn-primary', { hasText: 'Speichern' }).click()
await pc.page.waitForTimeout(1000)
await zeile(handy)
await handy.page.locator('.modal input').first().fill('22,22')
await handy.page.locator('.modal .btn-primary', { hasText: 'Speichern' }).click()
await handy.page.waitForTimeout(1000)
// Nacheinander online nehmen – sonst löst der selbsttätige Abgleich die beiden
// Änderungen hintereinander auf und es gibt gar keinen echten Zusammenstoß.
// Das Handy bleibt offline, bis der PC seine Fassung auf dem Server hat.
await pc.ctx.setOffline(false)
log('   → PC   ', await abgleich(pc))
await handy.ctx.setOffline(false)
log('   → Handy', await abgleich(handy))

// Welches Gerät zuletzt abgleicht, entscheidet, wo der Konflikt auftaucht –
// mit dem selbsttätigen Abgleich ist das nicht mehr vorherbestimmt.
const konfliktZahl = async (d) => {
  await geh(d, '/einstellungen/sync')
  await d.page.waitForTimeout(1000)
  const m = (await d.page.innerText('#root')).match(/Offene Konflikte\s*\n?\s*(\d+)/)
  return Number(m?.[1] ?? 0)
}
const proPC = await konfliktZahl(pc)
const proHandy = await konfliktZahl(handy)
log(`   Konflikte – PC: ${proPC}, Handy: ${proHandy}`)
pruefe('Konflikt wird gemeldet statt still überschrieben', proPC + proHandy > 0, 'true')

const betroffen = proHandy > 0 ? handy : pc
const anderes = betroffen === handy ? pc : handy

log('\n10) Konflikt entscheiden (auf dem Gerät, das ihn hat)')
await geh(betroffen, '/einstellungen/sync')
await betroffen.page.waitForTimeout(1000)
const kkarte = betroffen.page.locator('.card', { hasText: 'entscheiden' }).first()
pruefe('Konfliktkarte sichtbar', await kkarte.count(), '1')
const ktext = await kkarte.innerText()
pruefe('Konflikt nennt beide Werte', /22,22/.test(ktext) && /11,11/.test(ktext), 'true')
pruefe('Konflikt in Klartext', /Buchung/.test(ktext) && /Betrag/.test(ktext), 'true')
await kkarte.locator('button', { hasText: 'Meine Fassung' }).click()
await betroffen.page.waitForTimeout(2000)
pruefe('Konflikt ist erledigt', await konfliktZahl(betroffen), '0')

// Der entschiedene Wert muss sich auf beiden Geräten durchsetzen
const entschieden = /Dieses Gerät:\s*([\d.,]+)/.exec(ktext)?.[1] ?? '22,22'
log('   → entschieden auf', entschieden)
log('   →', await abgleich(betroffen))
log('   →', await abgleich(anderes))
await geh(anderes, '/finanzen/buchungen')
await anderes.page.waitForTimeout(1500)
pruefe('Das andere Gerät übernimmt die Entscheidung',
  (await anderes.page.innerText('#root')).includes(entschieden), 'true')

log('\n11) Fremder Zugang darf nichts sehen')
const fremd = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'fremd@test.de', password: 'geheim123' }),
}).then((r) => r.json())
const fremdRows = await fetch(`${SUPA}/rest/v1/transactions?server_rev=gt.0&limit=500`, {
  headers: { apikey: ANON, Authorization: `Bearer ${fremd.access_token}` },
}).then((r) => r.json())
pruefe('Fremder sieht Buchungen', Array.isArray(fremdRows) ? fremdRows.length : 'Fehler', '0')
const ohneLogin = await fetch(`${SUPA}/rest/v1/transactions?server_rev=gt.0`, { headers: { apikey: ANON } })
pruefe('Ohne Anmeldung abgewiesen', ohneLogin.status, '401')

log('\nJS-Fehler PC   :', pc.errors.length, pc.errors.slice(0, 3))
log('JS-Fehler Handy:', handy.errors.length, handy.errors.slice(0, 3))

await pc.ctx.close(); await handy.ctx.close(); site.close()
log(fails.length ? `\nFEHLGESCHLAGEN: ${fails.join(', ')}` : '\nAlle Prüfungen bestanden.')
process.exit(fails.length ? 1 : 0)
