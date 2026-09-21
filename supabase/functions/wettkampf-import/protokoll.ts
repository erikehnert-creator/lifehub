/**
 * Wettkampfprotokolle lesen – die reine Logik.
 *
 * Bewusst frei von Deno-, Browser- und PDF-Aufrufen: Diese Datei bekommt
 * fertige Textstücke mit Koordinaten und gibt Struktur zurück. Genau wie
 * `aggregat.ts` beim Schlafimport lässt sie sich damit aus den Tests laden und
 * gegen feste Beispiele nachrechnen, ohne dass ein PDF im Spiel ist.
 *
 * ---------------------------------------------------------------------------
 * Welches Format hier gelesen wird
 *
 * Ausschliesslich der Protokolltyp der Wettkampfsoftware **SCORE** des
 * Sächsischen Turn-Verbands, wie ihn die Sächsischen Einzelmeisterschaften
 * 2026 ausgeworfen haben. Das ist **kein** allgemeiner Wettkampf-PDF-Leser.
 * Ein anderes Layout wird nicht erraten, sondern mit `format_unbekannt`
 * abgelehnt – lieber keine Auskunft als eine falsche.
 *
 * Der Aufbau, Seite für Seite:
 *
 *   Zeile 1   Klasse, z. B. „LK 2 AK 18-29"
 *   Zeile 2   zwei getrennte Textblöcke: der Wettkampfname links,
 *             „<Ort>, <TT.MM.JJJJ>" rechts
 *   Zeile 3   Spaltenköpfe: Rang Name Verein Boden Pferd Ringe Sprung
 *             Barren Reck Gesamt
 *   danach    je Teilnehmer eine Zeile
 *   zuletzt   „Seite 1/1"
 *
 * ---------------------------------------------------------------------------
 * Warum über Koordinaten und nicht über den zusammengefügten Text
 *
 * Der zusammengefügte Text ist an zwei Stellen mehrdeutig, die Koordinaten
 * nicht sind:
 *
 *   - **Wettkampfname und Ort** stehen in der PDF als zwei Blöcke nebeneinander
 *     und werden beim Zusammenfügen mit einem Leerzeichen verbunden. Wo der
 *     Name aufhört, liesse sich danach nur raten („… männlich Bad Schandau").
 *   - **Name und Verein**: Drei Teilnehmer in diesem Protokoll haben keinen
 *     Jahrgang. Im Fliesstext steht dann „Nachname, Vorname SV Beispielstadt" ohne
 *     Trennung. Als Textstücke sind es zwei Blöcke in zwei Spalten.
 *
 * Eine Teilnehmerzeile besteht aus genau 16 Spaltenbündeln, von links:
 *
 *   Rang | Name (+ Jahrgang darunter) | Verein
 *   | D,E(,Abzug) | Endnote |  … sechsmal …  | Gesamt
 *
 * D, E und ein etwaiger Abzug stehen **übereinander in derselben Spalte**,
 * die Endnote daneben. Deshalb wird innerhalb eines Bündels von oben nach
 * unten gelesen.
 */

/** Ein Textstück aus der PDF, mit seiner Position auf der Seite. */
export interface TextStueck {
  text: string
  /** Abstand vom linken Rand. Wächst nach rechts. */
  x: number
  /** Abstand vom unteren Rand. Wächst nach OBEN (PDF-Konvention). */
  y: number
}

/**
 * Wie sicher ein Wert erkannt wurde.
 *
 * Bewusst drei Stufen und keine Prozentzahl: Für eine Wahrscheinlichkeit gäbe
 * es hier keine Grundlage. Entweder die Struktur ist eindeutig, oder sie ist
 * es nicht, oder der Wert fehlt.
 */
export type Sicherheit = 'exact' | 'ambiguous' | 'missing'

export interface Wert<T> {
  wert: T | null
  sicherheit: Sicherheit
  /** Was im Protokoll stand – auch dann, wenn es sich nicht deuten liess. */
  roh: string | null
}

const fehlt = <T>(): Wert<T> => ({ wert: null, sicherheit: 'missing', roh: null })
const genau = <T>(wert: T, roh: string): Wert<T> => ({ wert, sicherheit: 'exact', roh })
const unklar = <T>(wert: T | null, roh: string): Wert<T> => ({ wert, sicherheit: 'ambiguous', roh })

export interface GeraetWertung {
  /** Schlüssel aus core/turnen/geraete.ts. */
  apparatus: string
  d: Wert<number>
  e: Wert<number>
  /**
   * Neutralabzug, als **Betrag**.
   *
   * Das Protokoll schreibt ihn negativ („-1.0"), LifeHub speichert ihn positiv
   * (`gym_results.penalty`), weil `plausibilitaet()` mit `D + E − Abzug`
   * rechnet. Beides meint dasselbe; die Umrechnung steht hier und nirgends
   * sonst.
   */
  penalty: Wert<number>
  final: Wert<number>
  /**
   * Unveränderte Kennzeichnungen aus dem Protokoll, etwa `(+)`.
   *
   * **Nicht gedeutet.** Was `(+)` am D-Wert bedeutet, geht aus dem Protokoll
   * allein nicht hervor; eine erfundene Bedeutung wäre schlimmer als keine.
   * Die Marke wird mitgeführt und angezeigt, sonst nichts.
   */
  marker: string[]
}

export interface Teilnehmer {
  /** 1-basiert, wie im PDF. */
  seite: number
  /** Die Klasse der Seite, z. B. „LK 2 AK 18-29". */
  klasse: string
  rang: Wert<number>
  name: Wert<string>
  jahrgang: Wert<number>
  verein: Wert<string>
  geraete: GeraetWertung[]
  gesamt: Wert<number>
}

export interface ProtokollErgebnis {
  wettkampf: {
    name: Wert<string>
    ort: Wert<string>
    /** ISO-Tag, z. B. „2026-05-10". */
    tag: Wert<string>
  }
  teilnehmer: Teilnehmer[]
  seiten: number
  /** Was auffiel, ohne den Import zu verhindern. */
  warnungen: string[]
}

/**
 * Ein Protokoll, mit dem dieser Leser nichts anfangen kann.
 *
 * Die Zuweisung steht ausgeschrieben im Rumpf und nicht als
 * Parametereigenschaft (`constructor(public code: …)`). Node kann Typen nur
 * herausstreichen, nicht übersetzen – eine Parametereigenschaft bricht dort
 * mit `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Und aus Node geladen wird diese
 * Datei: vom Nachbau in den Browserprüfungen und vom Integrationslauf.
 */
export class ProtokollFehler extends Error {
  code: ProtokollFehlerCode

  constructor(code: ProtokollFehlerCode, text: string) {
    super(text)
    this.name = 'ProtokollFehler'
    this.code = code
  }
}

export type ProtokollFehlerCode =
  | 'keine_textebene'
  | 'format_unbekannt'
  | 'keine_teilnehmer'

export const FEHLERTEXTE: Record<ProtokollFehlerCode, string> = {
  keine_textebene: 'Diese PDF enthält keinen lesbaren Text. Gescannte Protokolle kann LifeHub nicht lesen.',
  format_unbekannt: 'Der Aufbau dieser PDF ist LifeHub nicht bekannt. Erkannt wird bisher nur das Protokoll der Wettkampfsoftware SCORE.',
  keine_teilnehmer: 'In dieser PDF steht kein Teilnehmer, den LifeHub lesen könnte.',
}

/* ================================================== Geräte des Protokolls */

/**
 * Die Spaltenköpfe des Protokolls und die Gerätschlüssel von LifeHub.
 *
 * **Diese Liste muss zu `core/turnen/geraete.ts` passen.** Sie steht hier ein
 * zweites Mal, weil eine Edge Function nicht in das Bündel der App
 * hineinsehen kann – dieselbe Lage wie bei `stabileId.ts` beim Schlafimport.
 * `tests/turnen-protokoll.test.ts` rechnet die Gleichheit nach.
 *
 * Die Reihenfolge ist zugleich die Prüfung: Steht sie in einer PDF anders da,
 * wird nicht zugeordnet, sondern abgelehnt.
 */
export const PROTOKOLL_GERAETE: { kopf: string; apparatus: string }[] = [
  { kopf: 'Boden', apparatus: 'boden' },
  { kopf: 'Pferd', apparatus: 'pauschenpferd' },
  { kopf: 'Ringe', apparatus: 'ringe' },
  { kopf: 'Sprung', apparatus: 'sprung' },
  { kopf: 'Barren', apparatus: 'barren' },
  { kopf: 'Reck', apparatus: 'reck' },
]

const KOPF_ERWARTET = ['Rang', 'Name', 'Verein', ...PROTOKOLL_GERAETE.map((g) => g.kopf), 'Gesamt']

/** Spaltenbündel je Teilnehmer: Rang, Name, Verein, 6×(Wertung, Endnote), Gesamt. */
const BUENDEL_JE_ZEILE = 3 + PROTOKOLL_GERAETE.length * 2 + 1

/* ========================================================== Hilfsmittel */

/**
 * Wie weit zwei Textstücke senkrecht auseinanderliegen dürfen und noch zur
 * selben Teilnehmerzeile gehören.
 *
 * Gemessen: Eine Zeile ohne Abzug ist rund 9 Einheiten hoch, eine mit Abzug
 * rund 17. Der Abstand zur nächsten Zeile beträgt rund 23. Verkettet wird
 * über die Lücke zwischen zwei *aufeinanderfolgenden* Werten – die ist
 * innerhalb einer Zeile nie grösser als 8.
 */
const ZEILEN_LUECKE = 12

/** Wie nah zwei Textstücke waagerecht stehen müssen, um eine Spalte zu sein. */
const SPALTEN_BREITE = 5

/** Eine Zahl aus dem Protokoll – „2.9", „8.666", „-1.0", „1.9 (+)". */
function leseZahl(roh: string): { zahl: number | null; marker: string[] } {
  const marker: string[] = []
  let rest = roh
  // Kennzeichnungen abtrennen, ohne sie zu deuten.
  rest = rest.replace(/\(([^)]*)\)/g, (_all, inhalt) => {
    marker.push(`(${inhalt})`)
    return ' '
  })
  const treffer = rest.trim().match(/^-?\d+(?:[.,]\d+)?$/)
  if (!treffer) return { zahl: null, marker }
  const zahl = Number(treffer[0].replace(',', '.'))
  return { zahl: Number.isFinite(zahl) ? zahl : null, marker }
}

/** „10.05.2026" → „2026-05-10". */
function leseTag(roh: string): string | null {
  const t = roh.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!t) return null
  const [, tag, monat, jahr] = t
  const m = Number(monat)
  const d = Number(tag)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${jahr}-${monat.padStart(2, '0')}-${tag.padStart(2, '0')}`
}

/** Textstücke zu Zeilen verketten – von oben nach unten. */
function inZeilen(stuecke: TextStueck[]): TextStueck[][] {
  const sortiert = [...stuecke].sort((a, b) => b.y - a.y)
  const zeilen: TextStueck[][] = []
  let aktuell: TextStueck[] | null = null
  let letztes = 0
  for (const s of sortiert) {
    if (aktuell === null || letztes - s.y > ZEILEN_LUECKE) {
      aktuell = []
      zeilen.push(aktuell)
    }
    aktuell.push(s)
    letztes = s.y
  }
  return zeilen
}

/**
 * Eine Zeile in Spaltenbündel zerlegen – links nach rechts, innen oben nach
 * unten.
 *
 * Das „oben nach unten" ist der Kern: D, E und Abzug stehen übereinander in
 * derselben Spalte.
 */
function inBuendel(zeile: TextStueck[]): TextStueck[][] {
  const sortiert = [...zeile].sort((a, b) => a.x - b.x || b.y - a.y)
  const buendel: TextStueck[][] = []
  for (const s of sortiert) {
    const letzte = buendel[buendel.length - 1]
    if (letzte && Math.abs(letzte[0].x - s.x) < SPALTEN_BREITE) letzte.push(s)
    else buendel.push([s])
  }
  return buendel
}

/* ============================================================== Parsen */

/**
 * Ein Protokoll lesen.
 *
 * `seiten[i]` sind die Textstücke der Seite i+1. Leere Seiten sind erlaubt und
 * werden übergangen – eine Deckblattseite soll den Import nicht verhindern.
 */
export function parseProtokoll(seiten: TextStueck[][]): ProtokollErgebnis {
  const mitText = seiten.filter((s) => s.some((t) => t.text.trim()))
  if (!mitText.length) {
    throw new ProtokollFehler('keine_textebene', FEHLERTEXTE.keine_textebene)
  }

  const warnungen: string[] = []
  const teilnehmer: Teilnehmer[] = []
  let name: Wert<string> = fehlt()
  let ort: Wert<string> = fehlt()
  let tag: Wert<string> = fehlt()
  let seitenGelesen = 0

  for (const [i, roh] of seiten.entries()) {
    const stuecke = roh
      .map((s) => ({ text: s.text.trim(), x: s.x, y: s.y }))
      .filter((s) => s.text)
    if (!stuecke.length) continue

    const zeilen = inZeilen(stuecke)
    if (zeilen.length < 4) {
      warnungen.push(`Seite ${i + 1} hat zu wenige Zeilen und wurde übergangen.`)
      continue
    }

    // --- Kopf: Klasse, Titel, Spaltenköpfe
    const klasse = zeilen[0].sort((a, b) => a.x - b.x).map((s) => s.text).join(' ').trim()

    const titel = [...zeilen[1]].sort((a, b) => a.x - b.x)
    const kopf = [...zeilen[2]].sort((a, b) => a.x - b.x).map((s) => s.text)

    // Die Strukturpruefung. Sie steht bewusst frueh und ist hart: Ein Protokoll
    // mit anderen Spalten wuerde sonst still falsch zugeordnet.
    if (kopf.length !== KOPF_ERWARTET.length
      || kopf.some((k, n) => k !== KOPF_ERWARTET[n])) {
      throw new ProtokollFehler(
        'format_unbekannt',
        `${FEHLERTEXTE.format_unbekannt} (Seite ${i + 1}: „${kopf.join(' ')}")`,
      )
    }

    if (name.sicherheit === 'missing' && titel.length) {
      name = genau(titel[0].text, titel[0].text)
    }
    if (tag.sicherheit === 'missing' && titel.length > 1) {
      // „Bannewitz, 10.05.2026" – das Datum am Ende ist der feste Anker, der
      // Ort steht davor. Ein mehrteiliger Ort bleibt dadurch erhalten.
      const letzter = titel[titel.length - 1].text
      const geteilt = letzter.match(/^(.*),\s*([^,]+)$/)
      if (geteilt) {
        const iso = leseTag(geteilt[2])
        if (iso) {
          tag = genau(iso, geteilt[2])
          ort = genau(geteilt[1].trim(), geteilt[1].trim())
        } else {
          ort = unklar<string>(null, letzter)
          tag = unklar<string>(null, letzter)
        }
      } else {
        ort = unklar<string>(null, letzter)
        tag = unklar<string>(null, letzter)
      }
    }

    seitenGelesen++

    // --- Körper
    for (const zeile of zeilen.slice(3)) {
      const nurWerte = zeile.filter((s) => !/^Seite\s+\d+\s*\/\s*\d+$/.test(s.text))
      if (!nurWerte.length) continue

      const buendel = inBuendel(nurWerte)
      if (buendel.length !== BUENDEL_JE_ZEILE) {
        warnungen.push(
          `Seite ${i + 1}: eine Zeile mit ${buendel.length} statt ${BUENDEL_JE_ZEILE} Spalten wurde übergangen `
          + `(„${buendel.map((b) => b.map((s) => s.text).join(' ')).join(' | ').slice(0, 80)}").`,
        )
        continue
      }

      teilnehmer.push(leseTeilnehmer(buendel, i + 1, klasse))
    }
  }

  if (!seitenGelesen) {
    throw new ProtokollFehler('format_unbekannt', FEHLERTEXTE.format_unbekannt)
  }
  if (!teilnehmer.length) {
    throw new ProtokollFehler('keine_teilnehmer', FEHLERTEXTE.keine_teilnehmer)
  }

  return { wettkampf: { name, ort, tag }, teilnehmer, seiten: seitenGelesen, warnungen }
}

/** Ein Spaltenbündel-Satz zu einem Teilnehmer. */
function leseTeilnehmer(buendel: TextStueck[][], seite: number, klasse: string): Teilnehmer {
  const rangRoh = buendel[0].map((s) => s.text).join(' ')
  const rangZahl = leseZahl(rangRoh)

  const namensSpalte = buendel[1]
  const nameRoh = namensSpalte[0]?.text ?? ''
  // Der Jahrgang steht UNTER dem Namen, in derselben Spalte. Drei Teilnehmer
  // dieses Protokolls haben keinen - das ist kein Fehler.
  const jahrRoh = namensSpalte[1]?.text ?? ''
  const jahrTreffer = jahrRoh.match(/^(19|20)\d{2}$/)

  const vereinRoh = buendel[2].map((s) => s.text).join(' ')

  const geraete: GeraetWertung[] = PROTOKOLL_GERAETE.map((g, n) => {
    const wertung = buendel[3 + n * 2]
    const endnote = buendel[4 + n * 2]
    return leseGeraet(g.apparatus, wertung, endnote)
  })

  const gesamtRoh = buendel[buendel.length - 1].map((s) => s.text).join(' ')
  const gesamtZahl = leseZahl(gesamtRoh)

  return {
    seite,
    klasse,
    rang: rangZahl.zahl === null ? unklar<number>(null, rangRoh) : genau(rangZahl.zahl, rangRoh),
    name: nameRoh ? genau(nameRoh, nameRoh) : fehlt(),
    jahrgang: jahrTreffer ? genau(Number(jahrRoh), jahrRoh)
      : jahrRoh ? unklar<number>(null, jahrRoh) : fehlt(),
    verein: vereinRoh ? genau(vereinRoh, vereinRoh) : fehlt(),
    geraete,
    gesamt: gesamtZahl.zahl === null ? unklar<number>(null, gesamtRoh) : genau(gesamtZahl.zahl, gesamtRoh),
  }
}

/**
 * Ein Gerätebündel: D und E übereinander, darunter womöglich ein Abzug,
 * daneben die Endnote.
 *
 * Es wird **nichts gerechnet**. Der Abzug wird nur vom Vorzeichen des
 * Protokolls in den Betrag überführt, den LifeHub speichert.
 */
function leseGeraet(
  apparatus: string,
  wertung: TextStueck[],
  endnote: TextStueck[],
): GeraetWertung {
  const marker: string[] = []
  const zahlen = wertung.map((s) => {
    const z = leseZahl(s.text)
    marker.push(...z.marker)
    return { ...z, roh: s.text }
  })

  // Von oben nach unten: D, E, dann ein etwaiger Abzug. Der Abzug ist im
  // Protokoll negativ und dadurch eindeutig von D und E zu unterscheiden.
  const d = zahlen[0]
  const e = zahlen[1]
  const abzug = zahlen.find((z) => z.zahl !== null && z.zahl < 0)

  const endRoh = endnote.map((s) => s.text).join(' ')
  const endZahl = leseZahl(endRoh)
  marker.push(...endZahl.marker)

  return {
    apparatus,
    d: !d ? fehlt() : d.zahl === null ? unklar<number>(null, d.roh) : genau(d.zahl, d.roh),
    e: !e ? fehlt() : e.zahl === null ? unklar<number>(null, e.roh) : genau(e.zahl, e.roh),
    penalty: !abzug ? fehlt() : genau(Math.abs(abzug.zahl as number), abzug.roh),
    final: endZahl.zahl === null ? unklar<number>(null, endRoh) : genau(endZahl.zahl, endRoh),
    marker: [...new Set(marker)],
  }
}

/* ======================================================== Nachrechnen */

/**
 * Geht `D + E − Abzug` an diesem Gerät mit der Endnote auf?
 *
 * Rein beschreibend, wie `plausibilitaet()` in der App. LifeHub korrigiert
 * nichts und lehnt nichts ab – es gibt Wertungen, in die weitere Werte
 * einfliessen. `null`, wenn sich nichts sagen lässt.
 */
export function stimmtRechnung(g: GeraetWertung): boolean | null {
  if (g.d.wert === null || g.e.wert === null || g.final.wert === null) return null
  const summe = g.d.wert + g.e.wert - (g.penalty.wert ?? 0)
  return Math.abs(Math.round((summe - g.final.wert) * 1000) / 1000) < 0.0005
}

/**
 * Teilnehmer, deren Name zu einer Suche passt.
 *
 * Sucht unabhängig von Gross- und Kleinschreibung und von der Reihenfolge
 * „Nachname, Vorname" gegen „Vorname Nachname" – im Protokoll steht die eine
 * Form, im Kopf hat man die andere.
 */
export function findeNamen(teilnehmer: Teilnehmer[], suche: string): Teilnehmer[] {
  const teile = suche.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (!teile.length) return []
  return teilnehmer.filter((t) => {
    const name = (t.name.wert ?? '').toLowerCase()
    return teile.every((s) => name.includes(s))
  })
}
