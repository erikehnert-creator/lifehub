/**
 * Aus Apple-Health-Proben wird eine Nacht.
 *
 * ---------------------------------------------------------------------------
 * Warum die Rechnung hier steht und nicht im Kurzbefehl
 *
 * Ein iOS-Kurzbefehl kann rechnen, aber nicht geprüft werden. Was er tut,
 * sieht man erst am Ergebnis, und wenn er sich verrechnet, fällt das
 * frühestens auf, wenn eine Zahl komisch aussieht. Deshalb schickt der
 * Kurzbefehl nur, was er ohne Nachdenken ablesen kann – die rohen Proben –
 * und die Rechnung passiert hier, wo sie `tests/schlaf.test.ts` nachrechnet.
 *
 * ---------------------------------------------------------------------------
 * Was Apple Health überhaupt liefert
 *
 * `HKCategoryTypeIdentifierSleepAnalysis`, in Stücken von wenigen Minuten.
 * Jedes Stück trägt einen Wert:
 *
 *   InBed              im Bett (iPhone, Sleep Cycle) – ÜBERLAPPT die anderen
 *   Asleep             schlafend, ohne Angabe der Phase (ältere Quellen)
 *   AsleepUnspecified  dasselbe, neuere Schreibweise
 *   AsleepCore         Leichtschlaf   ┐
 *   AsleepDeep         Tiefschlaf     ├ nur Apple Watch und ähnliche Geräte
 *   AsleepREM          REM-Schlaf     ┘
 *   Awake              wach, im Bett
 *
 * Eine „Schlafqualität" gibt es in HealthKit NICHT. Sleep Cycle zeigt zwar
 * eine Prozentzahl, behält sie aber für sich – sie steht in keiner
 * Health-Probe. Was LifeHub daraus macht, ist deshalb höchstens eine eigene
 * Bewertung und darf nicht so tun, als käme sie von Sleep Cycle.
 *
 * ---------------------------------------------------------------------------
 * Die beiden Fallen
 *
 * 1. `InBed` überlappt mit den Schlafphasen. Wer alles zusammenzählt, kommt
 *    auf die doppelte Nacht.
 * 2. Zwei Quellen (etwa Apple Watch UND Sleep Cycle) schreiben dieselbe Nacht
 *    jeweils vollständig. Aufsummiert wären das vierzehn Stunden Schlaf.
 *
 * Beides löst dieselbe Maßnahme: Es wird nicht summiert, sondern die
 * VEREINIGUNG der Zeiträume gemessen. Zwei Quellen, die dasselbe sagen,
 * ergeben dann dasselbe Ergebnis wie eine.
 */

export type Art = 'schlaf' | 'wach' | 'bett'
export type Phase = 'core' | 'deep' | 'rem' | 'unbekannt'

export interface Probe {
  /** ISO 8601 mit Zeitzonenversatz, z. B. 2026-09-20T23:14:00+02:00 */
  start: string
  ende: string
  /** Der Wert der Health-Probe, in beliebiger Schreibweise. */
  wert: string
  /** Woher die Probe stammt, z. B. „Sleep Cycle". Freiwillig. */
  quelle?: string
}

export interface Zeitraum { von: number; bis: number }

export interface Nacht {
  /** Der Tag, dem die Nacht zugerechnet wird: der Morgen des Aufwachens. */
  day: string
  start_at: string
  end_at: string
  /** Tatsächlich geschlafen – die Vereinigung aller Schlafphasen. */
  duration_min: number
  /** Wach, aber im Bett. */
  awake_min: number | null
  in_bed_min: number | null
  core_min: number | null
  deep_min: number | null
  rem_min: number | null
  /** Die Quellen, die zu dieser Nacht beigetragen haben, alphabetisch. */
  source: string | null
}

/* ------------------------------------------------------------ Deutung */

/**
 * Den Health-Wert deuten – großzügig, weil die Schreibweise je nach Quelle
 * und iOS-Fassung schwankt: `AsleepCore`, `asleepCore`,
 * `HKCategoryValueSleepAnalysisAsleepCore`, in Kurzbefehlen auch schlicht
 * `Core` oder „In Bed" mit Leerzeichen.
 */
export function deute(wert: string): { art: Art; phase: Phase } | null {
  const w = (wert ?? '').toLowerCase().replace(/[\s_-]/g, '')
  if (!w) return null
  const hat = (s: string) => w.includes(s)

  if (hat('inbed')) return { art: 'bett', phase: 'unbekannt' }
  // "awake" muss vor den Schlafphasen stehen: "asleepawake" gibt es nicht,
  // aber "awake" enthaelt kein "asleep" und umgekehrt - die Reihenfolge
  // schuetzt trotzdem vor kuenftigen Schreibweisen.
  if (hat('awake')) return { art: 'wach', phase: 'unbekannt' }
  if (hat('core')) return { art: 'schlaf', phase: 'core' }
  if (hat('deep')) return { art: 'schlaf', phase: 'deep' }
  if (hat('rem')) return { art: 'schlaf', phase: 'rem' }
  if (hat('asleep')) return { art: 'schlaf', phase: 'unbekannt' }
  return null
}

/* -------------------------------------------------------------- Zeit */

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/

/** Ist das ein Zeitpunkt, mit dem sich rechnen lässt? */
export function istZeitpunkt(s: unknown): s is string {
  return typeof s === 'string' && ISO.test(s.trim()) && Number.isFinite(Date.parse(s.trim()))
}

/**
 * Der Kalendertag, wie ihn die Uhr am Ort zeigte.
 *
 * Bei einem Zeitstempel mit Versatz (`…+02:00`) steht die Ortszeit wörtlich
 * im Text – der Datumsteil IST der lokale Tag. Nur bei `Z` muss gerechnet
 * werden, und dann kennt man die Zeitzone des Geräts nicht: Dann gilt UTC.
 * Der Kurzbefehl schickt deshalb mit Versatz.
 */
export function lokalerTag(iso: string): string {
  const m = ISO.exec(iso.trim())
  if (!m) throw new Error(`kein Zeitpunkt: ${iso}`)
  if (m[7] && m[7] !== 'Z') return `${m[1]}-${m[2]}-${m[3]}`
  return new Date(Date.parse(iso)).toISOString().slice(0, 10)
}

/**
 * Zeiträume verschmelzen, die sich berühren oder überlappen.
 *
 * Das ist die ganze Abwehr gegen doppeltes Zählen – bei `InBed` neben den
 * Phasen und bei zwei Quellen, die dieselbe Nacht schreiben.
 */
export function vereinige(zeitraeume: Zeitraum[]): Zeitraum[] {
  const gueltig = zeitraeume.filter((z) => z.bis > z.von).sort((a, b) => a.von - b.von)
  const out: Zeitraum[] = []
  for (const z of gueltig) {
    const letzter = out[out.length - 1]
    if (letzter && z.von <= letzter.bis) letzter.bis = Math.max(letzter.bis, z.bis)
    else out.push({ ...z })
  }
  return out
}

/** Volle Minuten in einer Menge von Zeiträumen. */
export function minuten(zeitraeume: Zeitraum[]): number {
  const ms = vereinige(zeitraeume).reduce((s, z) => s + (z.bis - z.von), 0)
  return Math.round(ms / 60000)
}

/* ----------------------------------------------------------- Aufbauen */

/**
 * Aus den Proben einer Nacht einen Datensatz bauen.
 *
 * `null`, wenn nichts Verwertbares dabei ist – das ist kein Fehler, sondern
 * der Normalfall an einem Morgen, an dem noch nichts gemessen wurde.
 *
 * Die Zuordnung zum Tag erfolgt über das AUFWACHEN, nicht über das
 * Einschlafen: Wer um 23:30 einschläft und um 7:00 aufsteht, hat „in der
 * Nacht auf den 29." geschlafen, und am 29. will er die Zahl sehen.
 */
export function baueNacht(proben: Probe[]): Nacht | null {
  const nach: Record<Art, Zeitraum[]> = { schlaf: [], wach: [], bett: [] }
  const phasen: Record<Phase, Zeitraum[]> = { core: [], deep: [], rem: [], unbekannt: [] }
  const quellen = new Set<string>()
  let hatPhasen = false

  for (const p of proben ?? []) {
    if (!istZeitpunkt(p?.start) || !istZeitpunkt(p?.ende)) continue
    const von = Date.parse(p.start)
    const bis = Date.parse(p.ende)
    if (!(bis > von)) continue
    const gedeutet = deute(p.wert)
    if (!gedeutet) continue
    nach[gedeutet.art].push({ von, bis })
    if (gedeutet.art === 'schlaf') {
      phasen[gedeutet.phase].push({ von, bis })
      if (gedeutet.phase !== 'unbekannt') hatPhasen = true
    }
    if (p.quelle) quellen.add(String(p.quelle).trim())
  }

  const schlaf = vereinige(nach.schlaf)
  const bett = vereinige(nach.bett)
  if (schlaf.length === 0 && bett.length === 0) return null

  // Der Rahmen der Nacht: alles, was zur Nacht gehoert - auch die Zeit im
  // Bett vor dem Einschlafen.
  const rahmen = vereinige([...schlaf, ...bett, ...nach.wach])
  const start = Math.min(...rahmen.map((z) => z.von))
  const ende = Math.max(...rahmen.map((z) => z.bis))

  // "Wach" zaehlt nur, soweit es INNERHALB der Nacht liegt - eine Wachprobe,
  // die sich nur am Rand anlehnt, ist kein naechtliches Aufwachen.
  const wach = vereinige(nach.wach)

  const originalStart = proben.find((p) => istZeitpunkt(p?.start) && Date.parse(p.start) === start)?.start
  const originalEnde = proben.find((p) => istZeitpunkt(p?.ende) && Date.parse(p.ende) === ende)?.ende

  return {
    day: lokalerTag(originalEnde ?? new Date(ende).toISOString()),
    start_at: originalStart ?? new Date(start).toISOString(),
    end_at: originalEnde ?? new Date(ende).toISOString(),
    duration_min: minuten(schlaf),
    awake_min: wach.length ? minuten(wach) : null,
    in_bed_min: bett.length ? minuten(bett) : null,
    // Phasen nur nennen, wenn die Quelle sie wirklich geliefert hat. Sonst
    // stuenden dort drei Nullen, die wie eine Messung aussehen.
    core_min: hatPhasen ? minuten(phasen.core) : null,
    deep_min: hatPhasen ? minuten(phasen.deep) : null,
    rem_min: hatPhasen ? minuten(phasen.rem) : null,
    source: quellen.size ? [...quellen].sort().join(', ') : null,
  }
}

/**
 * Proben nach Nächten trennen.
 *
 * Getrennt wird an einer Lücke von mindestens `luecke` Minuten, in der weder
 * geschlafen noch im Bett gelegen wurde. Vier Stunden sind bewusst großzügig:
 * Wer nachts eine Stunde wach im Wohnzimmer sitzt, hat immer noch EINE Nacht
 * gehabt; ein Mittagsschlaf liegt weiter weg.
 */
export function teileInNaechte(proben: Probe[], luecke = 240): Probe[][] {
  const brauchbar = (proben ?? [])
    .filter((p) => istZeitpunkt(p?.start) && istZeitpunkt(p?.ende) && deute(p?.wert))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  if (!brauchbar.length) return []

  const gruppen: Probe[][] = [[brauchbar[0]]]
  let bisher = Date.parse(brauchbar[0].ende)
  for (const p of brauchbar.slice(1)) {
    const von = Date.parse(p.start)
    if (von - bisher > luecke * 60000) gruppen.push([p])
    else gruppen[gruppen.length - 1].push(p)
    bisher = Math.max(bisher, Date.parse(p.ende))
  }
  return gruppen
}

/** Alle Nächte aus einer Ladung Proben – eine je zusammenhängendem Block. */
export function baueNaechte(proben: Probe[], luecke = 240): Nacht[] {
  const out: Nacht[] = []
  for (const gruppe of teileInNaechte(proben, luecke)) {
    const n = baueNacht(gruppe)
    if (n) out.push(n)
  }
  // Bei mehreren Blöcken am selben Tag (Nacht plus Mittagsschlaf) gewinnt der
  // längere: „Schlaf am 29." meint die Nacht, nicht das Nickerchen.
  const jeTag = new Map<string, Nacht>()
  for (const n of out) {
    const da = jeTag.get(n.day)
    if (!da || n.duration_min > da.duration_min) jeTag.set(n.day, n)
  }
  return [...jeTag.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
}

/* ----------------------------------------------------------- Prüfung */

export interface Pruefergebnis {
  ok: boolean
  fehler?: string
  proben?: Probe[]
}

/** Wie viele Proben eine Sendung höchstens enthalten darf. */
export const HOECHSTZAHL_PROBEN = 2000

/**
 * Den Rumpf einer Anfrage prüfen, bevor irgendetwas damit gerechnet wird.
 *
 * Streng, weil der Endpunkt aus dem Internet erreichbar ist: Was nicht
 * eindeutig als Probe erkennbar ist, wird abgewiesen – nicht stillschweigend
 * übergangen. Eine Sendung, die zur Hälfte Unsinn ist, soll auffallen.
 */
export function pruefeRumpf(rumpf: unknown): Pruefergebnis {
  if (!rumpf || typeof rumpf !== 'object') return { ok: false, fehler: 'Rumpf ist kein Objekt' }
  const roh = (rumpf as any).proben ?? (rumpf as any).samples
  if (!Array.isArray(roh)) return { ok: false, fehler: 'Feld „proben" fehlt oder ist keine Liste' }
  if (roh.length === 0) return { ok: false, fehler: 'Keine Proben enthalten' }
  if (roh.length > HOECHSTZAHL_PROBEN) {
    return { ok: false, fehler: `Zu viele Proben (${roh.length}, erlaubt ${HOECHSTZAHL_PROBEN})` }
  }

  const proben: Probe[] = []
  for (let i = 0; i < roh.length; i++) {
    const p = roh[i]
    if (!p || typeof p !== 'object') return { ok: false, fehler: `Probe ${i + 1} ist kein Objekt` }
    const start = p.start ?? p.startDate ?? p.von
    const ende = p.ende ?? p.end ?? p.endDate ?? p.bis
    const wert = p.wert ?? p.value ?? p.stage
    if (!istZeitpunkt(start)) return { ok: false, fehler: `Probe ${i + 1}: „start" ist kein ISO-Zeitpunkt` }
    if (!istZeitpunkt(ende)) return { ok: false, fehler: `Probe ${i + 1}: „ende" ist kein ISO-Zeitpunkt` }
    if (Date.parse(ende) < Date.parse(start)) return { ok: false, fehler: `Probe ${i + 1}: endet vor ihrem Beginn` }
    if (typeof wert !== 'string' || !wert.trim()) return { ok: false, fehler: `Probe ${i + 1}: „wert" fehlt` }
    const quelle = p.quelle ?? p.source
    proben.push({
      start: String(start).trim(),
      ende: String(ende).trim(),
      wert: String(wert).trim(),
      quelle: typeof quelle === 'string' && quelle.trim() ? quelle.trim().slice(0, 120) : undefined,
    })
  }
  return { ok: true, proben }
}
