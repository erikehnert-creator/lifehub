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
  const hat = (...s: string[]) => s.some((x) => w.includes(x))

  // Auf einem deutschen iPhone gibt Kurzbefehle den Wert UEBERSETZT zurueck:
  // "Im Bett", "Kernschlaf", "Tiefschlaf", "Wach". Wer nur die englischen
  // Namen kennt, findet dann gar nichts und meldet "keine auswertbaren
  // Schlafproben" - ohne dass irgendetwas kaputt waere. Deshalb stehen beide
  // Sprachen hier.
  //
  // Die REIHENFOLGE traegt die Bedeutung: "Kernschlaf" und "Tiefschlaf"
  // enthalten beide "schlaf". Wuerde "schlaf" zuerst geprueft, verloeren
  // alle Phasen ihre Unterscheidung und stuenden als "unbekannt" da.
  if (hat('inbed', 'imbett')) return { art: 'bett', phase: 'unbekannt' }
  if (hat('awake', 'wach')) return { art: 'wach', phase: 'unbekannt' }
  if (hat('core', 'kern')) return { art: 'schlaf', phase: 'core' }
  if (hat('deep', 'tief')) return { art: 'schlaf', phase: 'deep' }
  if (hat('rem')) return { art: 'schlaf', phase: 'rem' }
  if (hat('asleep', 'schlaf', 'schlummer')) return { art: 'schlaf', phase: 'unbekannt' }
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

/**
 * Proben, deren Wert sich nicht deuten liess.
 *
 * `baueNacht()` übergeht sie – zu Recht, denn eine Probe mit unbekanntem Wert
 * ist keine Messung. Sie zu ZÄHLEN ist trotzdem nötig: „200 empfangen, 0
 * Nächte" ist eine Auskunft, mit der man weitersuchen kann. „Keine
 * auswertbaren Schlafproben" allein ist eine Sackgasse – man weiss nicht, ob
 * nichts ankam oder ob alles Angekommene unverständlich war.
 */
export function nichtDeutbareProben(proben: Probe[]): number {
  let n = 0
  for (const p of proben ?? []) if (!deute(p?.wert)) n++
  return n
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

/** Ein Eintrag, mit dem sich nichts anfangen liess – und warum. */
export interface Zurueckweisung {
  /** Die Stelle in der Sendung, so wie die jeweilige Stufe sie gezählt hat. */
  nummer: number
  grund: string
}

export interface Pruefergebnis {
  ok: boolean
  fehler?: string
  proben?: Probe[]
  /** Wie viele Einträge die Sendung überhaupt enthielt. */
  empfangen?: number
  /**
   * Einträge, die übergangen wurden – einzeln benannt.
   *
   * ---------------------------------------------------------------------
   * Warum nicht mehr die ganze Sendung daran scheitert
   *
   * Vorher brachte EIN unbrauchbarer Eintrag die gesamte Übertragung zu Fall:
   * 400, nichts gespeichert. Der Kurzbefehl schickt aber drei Tage Apple
   * Health auf einmal, und dort genügt eine einzige Probe, deren Feld „Wert"
   * leer geblieben ist – dann kommt drei Tage lang nichts an, obwohl
   * zweihundert andere Proben tadellos sind. Von aussen sieht das aus wie
   * „der Schlafimport geht nicht mehr".
   *
   * Dass ausgerechnet ein LEERER Wert tödlich war, stand ausserdem im
   * Widerspruch zum Rest: Ein Wert, den `deute()` nicht kennt, wurde
   * stillschweigend übergangen. Beide tragen dieselbe Menge Information,
   * nämlich keine.
   *
   * Jetzt gilt: Der EINZELNE Eintrag fällt heraus und wird gezählt, die
   * Sendung läuft weiter. Stillschweigend ist das nicht – die Antwort nennt
   * Anzahl und Gründe. Bleibt NICHTS Brauchbares übrig, ist es weiterhin ein
   * Fehler; sonst hiesse „200, 0 Nächte" wieder, es sei alles in Ordnung.
   *
   * Streng bleibt, was die Verpackung betrifft: ein leerer Rumpf, ein Rumpf,
   * der wie JSON aussieht und keines ist, und die Höchstzahl.
   */
  zurueckgewiesen?: Zurueckweisung[]
}

/** Wie viele Proben eine Sendung höchstens enthalten darf. */
export const HOECHSTZAHL_PROBEN = 2000

/**
 * Das Trennzeichen der Zeilenform: `start|ende|wert|quelle`.
 *
 * Warum es diese Form überhaupt gibt, steht bei `probenAusText()`.
 */
export const FELDTRENNER = '|'

/**
 * Typografische Anführungszeichen zu geraden machen.
 *
 * iOS ersetzt beim Tippen `"` durch `„ "` – auch in den Textfeldern der
 * Kurzbefehle. Ein JSON-Rumpf, der so entstanden ist, sieht für einen
 * Menschen völlig richtig aus und ist für `JSON.parse` Müll. Das kostet
 * einen Abend, wenn man es nicht weiß.
 *
 * Angewandt wird das NUR, wenn das strenge Parsen schon gescheitert ist –
 * ein Rumpf, der als JSON durchgeht, wird nie angefasst.
 */
function geradeAnfuehrungszeichen(text: string): string {
  return text.replace(/[“”„‟″«»]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
}

/**
 * Eine Zeile der Form `start|ende|wert|quelle` zu einer Probe.
 *
 * `quelle` darf fehlen. Mehr als vier Felder gelten als Fehler und nicht als
 * „der Rest ist egal" – eine Zeile, die anders aufgebaut ist als gedacht,
 * soll auffallen.
 */
function probeAusZeile(zeile: string): Record<string, string> | null {
  const teile = zeile.split(FELDTRENNER).map((t) => t.trim())
  if (teile.length < 3 || teile.length > 4) return null
  return { start: teile[0], ende: teile[1], wert: teile[2], quelle: teile[3] ?? '' }
}

/**
 * Aus einem Stück Text eine Liste von Proben machen.
 *
 * ---------------------------------------------------------------------------
 * Warum das sein muss
 *
 * Der iOS-Kurzbefehl kann eine Liste nicht zuverlässig als JSON-Array
 * abschicken. Setzt man im Anfragetext (JSON) das Feld `proben` auf eine
 * Variable, macht Kurzbefehle daraus je nach Fassung eine Zeichenkette, eine
 * Liste von Zeichenketten oder etwas dazwischen – aber nur selten das Array
 * aus Objekten, das hier gebraucht wird. Genau daran ist der erste Versuch
 * gescheitert: `Feld „proben" fehlt oder ist keine Liste`.
 *
 * Statt den Kurzbefehl zu verbiegen, nimmt der Endpunkt jetzt auch Text
 * entgegen – und zwar in drei Formen, die alle im Kurzbefehl ohne Klimmzüge
 * entstehen:
 *
 *   1. Zeilenform (empfohlen, weil ohne Klammern und Anführungszeichen):
 *        2026-09-28T23:00:00+02:00|2026-09-29T07:00:00+02:00|AsleepCore|Sleep Cycle
 *      Eine Zeile je Probe. Hier kann iOS nichts durch typografische
 *      Anführungszeichen kaputtmachen, weil gar keine vorkommen.
 *
 *   2. Ein vollständiges JSON-Array: `[{…},{…}]`
 *
 *   3. Aneinandergereihte Objekte, mit oder ohne abschliessendes Komma:
 *        {…},{…},
 *      Genau das entsteht, wenn man im Kurzbefehl in einer Schleife Text
 *      zusammenhängt.
 *
 * Geprüft wird danach in allen Fällen gleich streng. Die Nachsicht betrifft
 * nur die VERPACKUNG, nicht den Inhalt.
 */
export function probenAusText(
  text: string,
): { ok: boolean; fehler?: string; roh?: unknown[]; empfangen?: number; zurueckgewiesen?: Zurueckweisung[] } {
  const roh = (text ?? '').trim()
  if (!roh) return { ok: false, fehler: 'Der Rumpf ist leer' }

  // --- JSON, in seinen drei Erscheinungsformen
  if (roh.startsWith('[') || roh.startsWith('{')) {
    let text2 = roh
      .replace(/\}\s*[\r\n]+\s*\{/g, '},{')   // Objekte, die nur durch Zeilenumbruch getrennt sind
      .replace(/,\s*$/, '')                    // ein abschliessendes Komma
    if (!text2.startsWith('[')) text2 = `[${text2}]`

    for (const versuch of [text2, geradeAnfuehrungszeichen(text2)]) {
      try {
        const geparst = JSON.parse(versuch)
        const liste = Array.isArray(geparst) ? geparst : [geparst]
        return { ok: true, roh: liste }
      } catch { /* naechster Versuch */ }
    }
    const hatKrumme = /[“”„‘’]/.test(roh)
    return {
      ok: false,
      fehler: hatKrumme
        ? 'Der Text ist kein gueltiges JSON – er enthaelt typografische Anfuehrungszeichen. '
          + 'In den iOS-Einstellungen unter Allgemein > Tastatur die „Intelligente Interpunktion" ausschalten.'
        : 'Der Text ist kein gueltiges JSON',
    }
  }

  // --- Zeilenform
  const zeilen = roh.split(/[\r\n]+/).map((z) => z.trim()).filter(Boolean)
  const liste: Record<string, string>[] = []
  const zurueckgewiesen: Zurueckweisung[] = []
  for (let i = 0; i < zeilen.length; i++) {
    const p = probeAusZeile(zeilen[i])
    if (!p) {
      // Diese eine Zeile fällt heraus, die Sendung läuft weiter – siehe
      // `Pruefergebnis.zurueckgewiesen`.
      zurueckgewiesen.push({
        nummer: i + 1,
        grund: `Zeile ${i + 1} hat nicht die Form start${FELDTRENNER}ende${FELDTRENNER}wert${FELDTRENNER}quelle`,
      })
      continue
    }
    liste.push(p)
  }
  // Keine einzige brauchbare Zeile: Dann ist nicht ein Eintrag schief, sondern
  // die Sendung als Ganzes – und das ist ein Fehler, kein Hinweis.
  if (!liste.length) {
    return { ok: false, fehler: zurueckgewiesen[0]?.grund, empfangen: zeilen.length, zurueckgewiesen }
  }
  return { ok: true, roh: liste, empfangen: zeilen.length, zurueckgewiesen }
}

/**
 * Eine bereits entpackte Liste prüfen.
 *
 * Streng, weil der Endpunkt aus dem Internet erreichbar ist: Was nicht
 * eindeutig als Probe erkennbar ist, wird nicht stillschweigend übernommen.
 * Es fällt einzeln heraus, wird gezählt und benannt (siehe
 * `Pruefergebnis.zurueckgewiesen`); bleibt gar nichts übrig, ist die Sendung
 * als Ganzes falsch und wird abgewiesen.
 *
 * Ein Eintrag darf auch eine Zeichenkette in Zeilenform sein: Kurzbefehle
 * schickt eine Liste mitunter als Liste von Texten.
 */
export function pruefeListe(roh: unknown[]): Pruefergebnis {
  if (roh.length === 0) return { ok: false, fehler: 'Keine Proben enthalten' }
  if (roh.length > HOECHSTZAHL_PROBEN) {
    return { ok: false, fehler: `Zu viele Proben (${roh.length}, erlaubt ${HOECHSTZAHL_PROBEN})` }
  }

  const proben: Probe[] = []
  const zurueckgewiesen: Zurueckweisung[] = []
  /** Diesen einen Eintrag übergehen – benannt, nicht stillschweigend. */
  const weg = (i: number, grund: string) => { zurueckgewiesen.push({ nummer: i + 1, grund }) }

  for (let i = 0; i < roh.length; i++) {
    let p: any = roh[i]
    if (typeof p === 'string') {
      const ausZeile = probeAusZeile(p.trim())
      if (!ausZeile) {
        weg(i, `Probe ${i + 1} ist Text, aber nicht in der Form `
          + `start${FELDTRENNER}ende${FELDTRENNER}wert${FELDTRENNER}quelle`)
        continue
      }
      p = ausZeile
    }
    if (!p || typeof p !== 'object') { weg(i, `Probe ${i + 1} ist kein Objekt`); continue }
    const start = p.start ?? p.startDate ?? p.von
    const ende = p.ende ?? p.end ?? p.endDate ?? p.bis
    const wert = p.wert ?? p.value ?? p.stage
    if (!istZeitpunkt(start)) { weg(i, `Probe ${i + 1}: „start" ist kein ISO-Zeitpunkt`); continue }
    if (!istZeitpunkt(ende)) { weg(i, `Probe ${i + 1}: „ende" ist kein ISO-Zeitpunkt`); continue }
    if (Date.parse(ende) < Date.parse(start)) { weg(i, `Probe ${i + 1}: endet vor ihrem Beginn`); continue }
    if (typeof wert !== 'string' || !wert.trim()) { weg(i, `Probe ${i + 1}: „wert" fehlt`); continue }
    const quelle = p.quelle ?? p.source
    proben.push({
      start: String(start).trim(),
      ende: String(ende).trim(),
      wert: String(wert).trim(),
      quelle: typeof quelle === 'string' && quelle.trim() ? quelle.trim().slice(0, 120) : undefined,
    })
  }

  // Bleibt nichts übrig, ist nicht ein Eintrag schief, sondern die Sendung.
  if (!proben.length) {
    return { ok: false, fehler: zurueckgewiesen[0]?.grund ?? 'Keine Proben enthalten',
      empfangen: roh.length, zurueckgewiesen }
  }
  return { ok: true, proben, empfangen: roh.length, zurueckgewiesen }
}

/**
 * Den Rumpf einer Anfrage prüfen, bevor irgendetwas damit gerechnet wird.
 *
 * Nimmt entgegen, was ein iOS-Kurzbefehl ohne Verrenkungen erzeugen kann:
 *
 *   { "proben": [ {…}, {…} ] }   das saubere Array (unverändert gültig)
 *   { "proben": "…" }            Text in einer der Formen von `probenAusText`
 *   { "proben": [ "a|b|c|d" ] }  Liste von Texten
 *   [ {…}, {…} ]                 das Array ohne Umschlag
 *   "…"                          der ganze Rumpf als Text
 *
 * Die Nachsicht endet bei der Verpackung. Jede einzelne Probe muss danach
 * dieselbe Prüfung bestehen wie vorher.
 */
export function pruefeRumpf(rumpf: unknown): Pruefergebnis {
  let roh: unknown = rumpf
  /** Was schon beim Auspacken herausfiel, geht nicht verloren. */
  let ausText: Zurueckweisung[] = []
  let empfangen: number | undefined

  if (rumpf && typeof rumpf === 'object' && !Array.isArray(rumpf)) {
    const feld = (rumpf as any).proben ?? (rumpf as any).samples
    if (feld === undefined || feld === null) {
      return { ok: false, fehler: 'Feld „proben" fehlt' }
    }
    roh = feld
  }

  if (typeof roh === 'string') {
    const entpackt = probenAusText(roh)
    ausText = entpackt.zurueckgewiesen ?? []
    empfangen = entpackt.empfangen
    if (!entpackt.ok) {
      return { ok: false, fehler: entpackt.fehler, empfangen, zurueckgewiesen: ausText }
    }
    roh = entpackt.roh
  }

  if (!Array.isArray(roh)) {
    return { ok: false, fehler: 'Feld „proben" ist weder eine Liste noch Text' }
  }
  const ergebnis = pruefeListe(roh)
  return {
    ...ergebnis,
    // Gezählt wird, was ANKAM – nicht, was das Auspacken übrig gelassen hat.
    empfangen: empfangen ?? ergebnis.empfangen,
    zurueckgewiesen: [...ausText, ...(ergebnis.zurueckgewiesen ?? [])],
  }
}

/* ------------------------------------------------- Anlegen oder ändern */

/** Die Felder, die aus Apple Health stammen – und nur die. */
export const IMPORT_FELDER = [
  'start_at', 'end_at', 'duration_min', 'awake_min',
  'in_bed_min', 'core_min', 'deep_min', 'rem_min', 'source',
] as const

export type Entscheidung = 'neu' | 'geaendert' | 'gleich'

/**
 * Was mit einer eingegangenen Nacht geschehen soll.
 *
 * Drei Fälle, und der dritte ist der wichtigste:
 *
 *   neu        Für diesen Tag steht noch nichts da.
 *   geaendert  Es steht etwas da, und Apple Health sagt inzwischen etwas
 *              anderes – etwa, weil die Uhr nachträglich korrigiert hat.
 *   gleich     Es steht dasselbe da. Dann wird NICHT geschrieben.
 *
 * Der dritte Fall ist der Alltag: Läuft der Kurzbefehl morgens zweimal, oder
 * greift die Automation beim Entsperren mehrfach, kommt dieselbe Nacht
 * mehrfach an. Ohne diesen Vergleich bekäme sie jedes Mal eine neue
 * `version` und ein neues `updated_at` – und der Abgleich schöbe jedes Mal
 * eine Änderung über alle Geräte, für die sich nichts geändert hat.
 *
 * Verglichen wird als Text, weil aus der Datenbank Zahlen auch als
 * Zeichenkette zurückkommen können; `null` und „nicht gesetzt" gelten
 * dabei als dasselbe.
 */
export function entscheideSchreiben(
  alt: Record<string, any> | null | undefined,
  neu: Nacht,
): Entscheidung {
  if (!alt) return 'neu'
  const gleich = IMPORT_FELDER.every(
    (f) => String(alt[f] ?? '') === String((neu as any)[f] ?? ''),
  )
  return gleich ? 'gleich' : 'geaendert'
}
