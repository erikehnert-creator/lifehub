/**
 * Doppelte Konten und Kategorien zusammenführen.
 *
 * ---------------------------------------------------------------------------
 * Wie sie entstehen
 *
 * Ein frisch gestartetes LifeHub legt einen Beispielbestand an: Girokonto,
 * Bargeld, Tagesgeld, GIVE-Card, dazu die Kategorien. Öffnet man die App auf
 * einem zweiten Gerät – etwa die Webfassung, um FatSecret zu verbinden – und
 * lädt diesen Bestand auf den Server, liegen dort anschließend ZWEI Sätze:
 * die echten Konten und die eben erzeugten Beispielkonten. Beide haben
 * verschiedene IDs und denselben Namen, also erkennt der Abgleich sie nicht
 * als dasselbe und beide erscheinen nebeneinander.
 *
 * Das ist am 26.08.2026 schon einmal passiert. Damals half nur: Server leeren
 * und vom PC neu befüllen – möglich, weil noch nichts Echtes da war. Heute ist
 * es etwas da, deshalb dieser Weg.
 *
 * ---------------------------------------------------------------------------
 * Warum Zusammenführen und nicht Löschen
 *
 * Die Dublette ist nicht zwangsläufig leer. In Eriks Fall hing an der zweiten
 * GIVE-Card ein Bestand von 48,37 € – wer „die neuen einfach löscht", löscht
 * die Buchungen gleich mit. Deshalb wird nichts gelöscht, bevor alles, was
 * daran hängt, umgehängt ist:
 *
 *   transactions.account_id / .to_account_id
 *   account_checks.account_id
 *   goals.target_account_id
 *   recurring_rules.template_json  (dort steht die Kontokennung im JSON)
 *
 * Und für Kategorien entsprechend transactions.category_id, budgets.category_id
 * sowie categories.parent_id.
 *
 * Hier steht ausschließlich das Entscheiden und Zuordnen – kein Datenbankzugriff.
 * Ausgeführt wird der Plan in state/dubletten.ts, angezeigt vorher.
 */

/** Das Nötigste, um zwei Zeilen als dieselbe Sache zu erkennen. */
export interface DublettenZeile {
  id: string
  name: string
  /** Bei Konten der Kontotyp, bei Kategorien die Art (Einnahme/Ausgabe). */
  art?: string | null
  created_at?: string | null
  deleted_at?: string | null
  /** Nur bei Konten: ein Anfangsbestand ist ein starkes Zeichen für „echt". */
  opening_balance_cents?: number | null
}

/** Ein Verweis von irgendeiner Tabelle auf eine dieser Zeilen. */
export interface Verweis {
  tabelle: string
  feld: string
  /** Die Zeilen-ID, in der der Verweis steht. */
  zeile: string
  /** Worauf verwiesen wird. */
  ziel: string
}

export interface Zusammenfuehrung {
  /** Die Zeile, die bleibt. */
  behalten: DublettenZeile
  /** Die Zeilen, die darin aufgehen und danach im Papierkorb landen. */
  aufloesen: DublettenZeile[]
  /** Was umgehängt werden muss, damit nichts verlorengeht. */
  umzuege: Verweis[]
  /** In einem Satz, warum genau diese Zeile bleibt. */
  grund: string
}

/** Groß-/Kleinschreibung und Randleerzeichen sollen keinen Unterschied machen. */
function schluessel(z: DublettenZeile): string {
  return `${(z.name ?? '').trim().toLowerCase()}|${(z.art ?? '').trim().toLowerCase()}`
}

/**
 * Welche der gleichnamigen Zeilen bleibt.
 *
 * Die Reihenfolge der Kriterien ist der eigentliche Inhalt dieser Funktion:
 *
 *   1. Ein Anfangsbestand ≠ 0 wiegt am schwersten. Den hat nur ein Konto, das
 *      jemand wirklich eingerichtet hat – der Beispielbestand startet bei 0.
 *   2. Sonst die Zeile, an der mehr hängt. Bei Eriks GIVE-Card ist das die
 *      NEUERE: an ihr hingen die 48,37 €, am ursprünglichen Konto nichts.
 *      Verlorengehen kann dabei trotzdem nichts – was am anderen hängt, wird
 *      umgehängt, nicht verworfen.
 *   3. Sonst die ältere. Sie ist die, auf die sich Erinnerungen beziehen.
 *   4. Sonst die kleinere ID – damit zwei Geräte, die das unabhängig rechnen,
 *      zum selben Ergebnis kommen und nicht gegeneinander arbeiten.
 */
function besteZeile(gruppe: DublettenZeile[], anzahl: Map<string, number>): {
  zeile: DublettenZeile; grund: string
} {
  const sortiert = [...gruppe].sort((a, b) => {
    const aStart = Math.abs(Number(a.opening_balance_cents ?? 0)) > 0 ? 1 : 0
    const bStart = Math.abs(Number(b.opening_balance_cents ?? 0)) > 0 ? 1 : 0
    if (aStart !== bStart) return bStart - aStart

    const aN = anzahl.get(a.id) ?? 0
    const bN = anzahl.get(b.id) ?? 0
    if (aN !== bN) return bN - aN

    const aZ = a.created_at ?? ''
    const bZ = b.created_at ?? ''
    if (aZ !== bZ) return aZ < bZ ? -1 : 1

    return a.id < b.id ? -1 : 1
  })

  const gewaehlt = sortiert[0]
  const n = anzahl.get(gewaehlt.id) ?? 0
  const grund = Math.abs(Number(gewaehlt.opening_balance_cents ?? 0)) > 0
    ? 'hat einen Anfangsbestand'
    : n > 0
      ? `daran hängen ${n} Einträge`
      : 'ist die ältere'
  return { zeile: gewaehlt, grund }
}

/**
 * Gleichnamige Zeilen finden und je Gruppe einen Zusammenführungsplan bauen.
 *
 * Gelöschte Zeilen bleiben außen vor: Was im Papierkorb liegt, ist keine
 * Dublette mehr, und es wieder hervorzuholen wäre das Gegenteil von Aufräumen.
 */
export function planeZusammenfuehrung(
  zeilen: DublettenZeile[],
  verweise: Verweis[],
): Zusammenfuehrung[] {
  const anzahl = new Map<string, number>()
  for (const v of verweise) anzahl.set(v.ziel, (anzahl.get(v.ziel) ?? 0) + 1)

  const gruppen = new Map<string, DublettenZeile[]>()
  for (const z of zeilen) {
    if (z.deleted_at) continue
    const k = schluessel(z)
    if (!k.startsWith('|')) {                      // ohne Namen keine Aussage
      if (!gruppen.has(k)) gruppen.set(k, [])
      gruppen.get(k)!.push(z)
    }
  }

  const out: Zusammenfuehrung[] = []
  for (const gruppe of gruppen.values()) {
    if (gruppe.length < 2) continue
    const { zeile: behalten, grund } = besteZeile(gruppe, anzahl)
    const aufloesen = gruppe.filter((z) => z.id !== behalten.id)
    const wegIds = new Set(aufloesen.map((z) => z.id))
    out.push({
      behalten,
      aufloesen,
      umzuege: verweise.filter((v) => wegIds.has(v.ziel)),
      grund,
    })
  }
  // Die mit den meisten Umzügen zuerst – dort lohnt das Hinsehen am meisten.
  out.sort((a, b) => b.umzuege.length - a.umzuege.length)
  return out
}

/**
 * Die Kontokennung im `template_json` einer wiederkehrenden Zahlung ersetzen.
 *
 * Eigene Funktion, weil hier zwei Dinge schiefgehen können, die sonst
 * unbemerkt blieben: kaputtes JSON (dann bleibt der Text unverändert, statt
 * die Vorlage zu zerstören) und ein Feld, das es gar nicht gibt.
 */
export function ersetzeKontoImTemplate(
  templateJson: string, von: string, nach: string,
): string {
  let tpl: any
  try { tpl = JSON.parse(templateJson || '{}') } catch { return templateJson }
  if (!tpl || typeof tpl !== 'object') return templateJson

  let geaendert = false
  for (const feld of ['account_id', 'to_account_id']) {
    if (tpl[feld] === von) { tpl[feld] = nach; geaendert = true }
  }
  return geaendert ? JSON.stringify(tpl) : templateJson
}
