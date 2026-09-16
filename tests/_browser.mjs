/**
 * Woher der Browser für die Prüfungen kommt.
 *
 * Die Prüfungen sind in einer Linux-Umgebung entstanden, in der Chromium an
 * einem festen Pfad lag. Dieser Pfad stand danach in neun Dateien – und auf
 * Eriks Windows-Rechner gibt es ihn nicht. Die Folge war still und ärgerlich:
 * `node tests/sync-e2e.mjs` brach sofort mit „executable doesn't exist" ab.
 * Prüfungen, die nirgends laufen, prüfen nichts.
 *
 * Playwright bringt seinen eigenen Browser mit und findet ihn von allein,
 * wenn man ihm keinen Pfad vorschreibt. Genau das ist hier der Normalfall;
 * der feste Pfad gilt nur noch, wenn es ihn wirklich gibt.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const VORGEGEBEN = process.env.LIFEHUB_CHROMIUM
const LINUX_SANDKASTEN = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/** Der auszuführende Browser – oder undefined für Playwrights eigenen. */
export function browserPfad() {
  for (const p of [VORGEGEBEN, LINUX_SANDKASTEN]) {
    if (p && fs.existsSync(p)) return p
  }
  return undefined
}

/**
 * Startoptionen mit allem, was übergeben wurde, plus dem Browserpfad – aber
 * nur, wenn es ihn gibt. `executablePath: undefined` ist für Playwright nicht
 * dasselbe wie „nicht gesetzt", deshalb wird der Schlüssel sonst weggelassen.
 */
export function startOptionen(weitere = {}) {
  const pfad = browserPfad()
  return pfad ? { ...weitere, executablePath: pfad } : { ...weitere }
}

/* ------------------------------------------------------------------ Pfade */

/**
 * Dieselbe Geschichte wie beim Browser: Auch „file:///home/claude/lifehub/…"
 * stand fest verdrahtet in den Prüfungen und zeigt auf Eriks Rechner ins
 * Leere. Alles hier wird deshalb aus dem Ort dieser Datei abgeleitet.
 */
export const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Die gebaute PC-Einzeldatei als file://-Adresse. */
export const EINZELDATEI = 'file:///' + path.join(WURZEL, 'LifeHub.html').split(path.sep).join('/')

/** Der Ordner, den GitHub Pages ausliefert – die Handy-Fassung. */
export const DIST = path.join(WURZEL, 'dist')

/**
 * Ein echter Datenbestand zum Einspielen. Bewusst NICHT im Repo: Das sind
 * Eriks tatsaechliche Finanz- und Gesundheitsdaten. Wer diese Pruefungen
 * fahren will, legt einen Export daneben oder setzt LIFEHUB_ECHTDATEN.
 */
export const ECHTDATEN = process.env.LIFEHUB_ECHTDATEN
  ?? path.join(WURZEL, 'LifeHub-Daten-Erik.json')

/** Ein eigener, leerer Browserprofil-Ordner je Gerät. */
export function profilOrdner(name) {
  const dir = path.join(os.tmpdir(), 'lifehub-e2e-' + name)
  fs.rmSync(dir, { recursive: true, force: true })
  return dir
}

/** Meldet sich mit einem klaren Satz ab, wenn eine Voraussetzung fehlt. */
export function brauche(pfad, hinweis) {
  if (fs.existsSync(pfad)) return true
  console.log(`
  ÜBERSPRUNGEN: ${hinweis}
  (nicht gefunden: ${pfad})
`)
  return false
}
