/**
 * Der Schlafimport, ohne Deno: Anfrage rein, Antwort raus.
 *
 * ---------------------------------------------------------------------------
 * Warum das hier steht und nicht in index.ts
 *
 * `index.ts` läuft auf Deno und lässt sich von einer gewöhnlichen Prüfung
 * nicht starten. Solange die ganze Verarbeitung dort stand, war genau der
 * Teil ungeprüft, an dem der gemeldete Fehler sitzen konnte: Autorisierung,
 * Rumpf, Schreibentscheidung, Rückgabe. Geprüft war nur die Rechnung
 * (`aggregat.ts`).
 *
 * Deshalb liegt die Verarbeitung jetzt hier, mit der Datenbank als Parameter.
 * `index.ts` ist nur noch die Deno-Hülle: Umgebung lesen, CORS, `Deno.serve`.
 * Es ist derselbe Ablauf wie vorher, an derselben Stelle nachlesbar – nur
 * eben aufrufbar.
 *
 * ---------------------------------------------------------------------------
 * Zwei Fehler, die dabei sichtbar geworden sind
 *
 * 1. **Eine gelöschte Nacht kam nie zurück.** Die Abfrage auf die vorhandene
 *    Zeile las `deleted_at` gar nicht mit. Stand die Nacht im Papierkorb und
 *    schickte der Kurzbefehl dieselben Werte noch einmal, entschied
 *    `entscheideSchreiben()` auf „gleich" – und es wurde nichts geschrieben.
 *    Der Kurzbefehl meldete `unveraendert: 1`, in LifeHub blieb die Nacht
 *    unsichtbar. Genau die Sorte Erfolgsmeldung, die es nicht geben darf.
 *
 * 2. **Der Server konnte zwei Zeilen für denselben Tag bekommen.** Gesucht
 *    wurde nur über die aus dem Tag abgeleitete ID. Lag für den Tag eine
 *    Zeile mit einer ANDEREN ID (etwa aus einer älteren Fassung), fand die
 *    Funktion sie nicht und legte eine zweite an. Auf dem Server stört das
 *    niemanden – dort ist nur die ID eindeutig. Auf dem Gerät ist `day`
 *    UNIQUE: Beim Holen entscheidet `loeseSchluesselkollision()` (sync/
 *    engine.ts) nach einer festen Regel, welche der beiden bleibt, und die
 *    andere wird örtlich gelöscht. Verliert die frisch importierte, ist sie
 *    weg – ohne Fehler, ohne Meldung, und bei jedem weiteren Import aufs
 *    Neue. Gesucht wird deshalb jetzt über `(user_id, day)`: Was da ist, wird
 *    aktualisiert, egal unter welcher ID.
 */
import {
  baueNaechte, entscheideSchreiben, nichtDeutbareProben, pruefeRumpf,
  HOECHSTZAHL_PROBEN, type Nacht,
} from './aggregat.ts'
import { idAusSchluessel } from '../_shared/stabileId.ts'
import { siehtWieTokenAus, tokenAbdruck } from '../_shared/importToken.ts'

/**
 * Der Tabellenzugriff, den die Verarbeitung braucht.
 *
 * Absichtlich die rohe PostgREST-Form und keine hübschere Abstraktion: So
 * steht in der Prüfung dieselbe Abfrage wie im Betrieb, und eine falsch
 * geschriebene Bedingung fällt dort auf statt erst auf dem Server.
 */
export type Datenbank = (pfad: string, init?: RequestInit) => Promise<any>

export interface Anfrage {
  methode: string
  /** Der Wert der Kopfzeile `Authorization`, unverändert. */
  authorization: string
  /** Der Rumpf als Text – wird nur gelesen, wenn die Autorisierung steht. */
  rumpf: () => Promise<string>
}

export interface Antwort {
  status: number
  rumpf: Record<string, unknown>
}

export interface Umgebung {
  db: Datenbank
  /** Für die Prüfung einsetzbar. */
  jetzt?: () => string
  /** Protokoll ohne Personenbezug – nie Token, nie Rumpf. */
  protokoll?: (text: string) => void
  fehlerProtokoll?: (text: string) => void
}

/** Ab hier gilt eine Sendung als zu gross, noch bevor sie geparst wird. */
export const HOECHSTLAENGE_RUMPF = 2_000_000

/* ------------------------------------------------------------ Autorisierung */

/**
 * Wem gehört dieses Token?
 *
 * Nur ein Token, das es gibt, nicht widerrufen und nicht gelöscht ist, führt
 * zu einer Nutzerkennung. Alles andere ergibt `null`, und der Aufrufer
 * antwortet mit 401 – ohne zu verraten, woran es lag.
 */
export async function besitzer(
  db: Datenbank, token: string,
): Promise<{ id: string; user_id: string } | null> {
  if (!siehtWieTokenAus(token)) return null
  const hash = await tokenAbdruck(token)
  const treffer = await db(
    `import_tokens?token_hash=eq.${encodeURIComponent(hash)}`
    + `&revoked_at=is.null&deleted_at=is.null&scope=eq.schlaf&select=id,user_id&limit=1`,
  )
  const zeile = Array.isArray(treffer) ? treffer[0] : null
  return zeile?.user_id ? { id: zeile.id, user_id: zeile.user_id } : null
}

/* ---------------------------------------------------------------- Schreiben */

export type Schreibergebnis = 'neu' | 'geaendert' | 'gleich'

/** Die Spalten, die für die Schreibentscheidung gebraucht werden. */
const SPALTEN = 'id,version,note,deleted_at,duration_min,start_at,end_at,'
  + 'awake_min,in_bed_min,core_min,deep_min,rem_min,source'

/**
 * Eine Nacht schreiben – anlegen, aktualisieren oder stehen lassen.
 *
 * Gesucht wird über `(user_id, day)`, nicht über die ID: `day` ist der
 * natürliche Schlüssel dieser Tabelle, und es darf je Tag genau eine Zeile
 * geben (auf dem Gerät erzwingt das UNIQUE, auf dem Server niemand). Findet
 * sich eine Zeile, wird SIE aktualisiert – auch wenn sie eine andere ID
 * trägt. Neu angelegt wird mit der aus dem Tag abgeleiteten ID, damit zwei
 * Geräte dieselbe Zeile erzeugen statt zweier.
 *
 * Eine von Hand geschriebene Notiz bleibt stehen: Der Import kennt sie nicht
 * und darf sie nicht mit `null` überschreiben.
 */
export async function schreibeNacht(
  db: Datenbank, userId: string, nacht: Nacht, jetzt: () => string,
): Promise<Schreibergebnis> {
  const vorhanden = await db(
    `sleep_sessions?user_id=eq.${userId}&day=eq.${encodeURIComponent(nacht.day)}`
    + `&select=${SPALTEN}&order=id.asc`,
  )
  const alt = Array.isArray(vorhanden) ? vorhanden[0] : null
  const id = alt?.id ?? idAusSchluessel('sleep_sessions', nacht.day)

  // Eine gelöschte Zeile ist NICHT „gleich": Sie ist unsichtbar, und der
  // Kurzbefehl schickt die Nacht ja gerade, weil es sie geben soll.
  const geloescht = !!alt?.deleted_at
  const was = geloescht ? 'geaendert' : entscheideSchreiben(alt, nacht)
  if (was === 'gleich') return 'gleich'

  const zeile: Record<string, any> = {
    id,
    user_id: userId,
    day: nacht.day,
    start_at: nacht.start_at,
    end_at: nacht.end_at,
    duration_min: nacht.duration_min,
    awake_min: nacht.awake_min,
    in_bed_min: nacht.in_bed_min,
    core_min: nacht.core_min,
    deep_min: nacht.deep_min,
    rem_min: nacht.rem_min,
    source: nacht.source,
    note: alt?.note ?? null,
    created_at: alt ? undefined : jetzt(),
    updated_at: jetzt(),
    deleted_at: null,
    version: (Number(alt?.version) || 0) + 1,
    last_device_id: 'apple-health',
  }
  for (const k of Object.keys(zeile)) if (zeile[k] === undefined) delete zeile[k]

  if (alt) {
    await db(`sleep_sessions?id=eq.${encodeURIComponent(id)}&user_id=eq.${userId}`, {
      method: 'PATCH', body: JSON.stringify(zeile),
    })
    return 'geaendert'
  }
  await db('sleep_sessions', { method: 'POST', body: JSON.stringify(zeile) })
  return 'neu'
}

/* ------------------------------------------------------------- Verarbeitung */

/**
 * Eine Anfrage des Kurzbefehls von vorn bis hinten.
 *
 * Die Antwort ist die Diagnose: Wer mit dem Kurzbefehl eine Schnellansicht
 * anhängt, sieht daran, an welcher Stelle es klemmt – wie viele Proben
 * ankamen, wie viele davon brauchbar waren, wie viele Nächte daraus wurden
 * und was davon wirklich geschrieben wurde. Ein 200 ohne Wirkung gibt es
 * nicht mehr: Kam etwas an und wurde nichts daraus, steht das als Zahl da.
 */
export async function verarbeiteAnfrage(a: Anfrage, u: Umgebung): Promise<Antwort> {
  const jetzt = u.jetzt ?? (() => new Date().toISOString())
  const melde = u.protokoll ?? (() => {})
  const meldeFehler = u.fehlerProtokoll ?? (() => {})

  if (a.methode !== 'POST') return { status: 405, rumpf: { fehler: 'Nur POST' } }

  const token = (a.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
  let wer: { id: string; user_id: string } | null
  try {
    wer = await besitzer(u.db, token)
  } catch (e) {
    meldeFehler(`Tokenpruefung fehlgeschlagen: ${String(e).slice(0, 200)}`)
    return { status: 500, rumpf: { fehler: 'Interner Fehler' } }
  }
  // Bewusst dieselbe Antwort fuer "kein Token", "unbekannt" und "widerrufen".
  if (!wer) return { status: 401, rumpf: { fehler: 'Zugang ungueltig' } }

  let roher: string
  try {
    roher = await a.rumpf()
  } catch {
    return { status: 400, rumpf: { fehler: 'Rumpf nicht lesbar' } }
  }
  if (roher.length > HOECHSTLAENGE_RUMPF) {
    return { status: 413, rumpf: { fehler: 'Sendung zu gross' } }
  }

  // Ist der Rumpf kein JSON, wird er als TEXT weitergereicht statt abgewiesen.
  // Ein iOS-Kurzbefehl bekommt ein JSON-Array nur mit Muehe zustande; die
  // Zeilenform start|ende|wert|quelle dagegen ohne jede Verrenkung.
  let rumpf: unknown
  try { rumpf = JSON.parse(roher) } catch { rumpf = roher }

  const geprueft = pruefeRumpf(rumpf)
  if (!geprueft.ok) {
    return {
      status: 400,
      rumpf: {
        fehler: geprueft.fehler,
        empfangen: geprueft.empfangen ?? 0,
        zurueckgewiesen: geprueft.zurueckgewiesen?.length ?? 0,
        gruende: (geprueft.zurueckgewiesen ?? []).slice(0, 3).map((z) => z.grund),
        hoechstzahl: HOECHSTZAHL_PROBEN,
      },
    }
  }

  const proben = geprueft.proben!
  const empfangen = geprueft.empfangen ?? proben.length
  const zurueckgewiesen = geprueft.zurueckgewiesen ?? []
  const nichtDeutbar = nichtDeutbareProben(proben)
  const naechte = baueNaechte(proben)

  /** Was in jeder Antwort steht – damit sich jede Stufe nachvollziehen lässt. */
  const bericht = {
    empfangen,
    angenommen: proben.length,
    zurueckgewiesen: zurueckgewiesen.length,
    nicht_deutbar: nichtDeutbar,
    ...(zurueckgewiesen.length
      ? { gruende: zurueckgewiesen.slice(0, 3).map((z) => z.grund) }
      : {}),
  }

  if (naechte.length === 0) {
    melde(`Schlafimport: ${empfangen} empfangen, keine auswertbare Nacht`)
    return {
      status: 200,
      rumpf: {
        ...bericht,
        naechte: 0, neu: 0, geaendert: 0, unveraendert: 0, tage: [],
        hinweis: nichtDeutbar === proben.length && proben.length > 0
          ? 'Keine der Proben trug einen deutbaren Wert – im Kurzbefehl ist das Feld „Wert" '
            + 'vermutlich leer oder falsch belegt.'
          : 'Keine auswertbaren Schlafproben',
      },
    }
  }

  let neu = 0, geaendert = 0, gleich = 0
  const gescheitert: string[] = []
  for (const n of naechte) {
    try {
      const was = await schreibeNacht(u.db, wer.user_id, n, jetzt)
      if (was === 'neu') neu++
      else if (was === 'geaendert') geaendert++
      else gleich++
    } catch (e) {
      // Eine Nacht, die nicht durchgeht, darf die anderen nicht mitnehmen –
      // sie muss aber in der Antwort stehen, sonst sieht 200 aus wie Erfolg.
      meldeFehler(`Schreiben fehlgeschlagen (${n.day}): ${String(e).slice(0, 300)}`)
      gescheitert.push(n.day)
    }
  }

  try {
    await u.db(`import_tokens?id=eq.${encodeURIComponent(wer.id)}`, {
      method: 'PATCH', body: JSON.stringify({ last_used_at: jetzt() }),
    })
  } catch (e) {
    // Nur ein Vermerk „zuletzt benutzt" – daran soll kein Import scheitern.
    meldeFehler(`Tokenvermerk fehlgeschlagen: ${String(e).slice(0, 200)}`)
  }

  melde(
    `Schlafimport: ${empfangen} Proben, ${naechte.length} Nacht/Naechte, `
    + `${neu} neu, ${geaendert} geaendert, ${gleich} unveraendert`
    + (gescheitert.length ? `, ${gescheitert.length} gescheitert` : ''),
  )

  // Ging KEINE Nacht durch, ist das kein Erfolg – auch wenn HTTP geantwortet hat.
  const status = gescheitert.length === naechte.length ? 500 : 200
  return {
    status,
    rumpf: {
      ...bericht,
      naechte: naechte.length,
      neu, geaendert, unveraendert: gleich,
      tage: naechte.map((n) => n.day),
      ...(gescheitert.length
        ? { gescheitert: gescheitert.length, gescheiterte_tage: gescheitert,
            fehler: 'Mindestens eine Nacht konnte nicht gespeichert werden' }
        : {}),
    },
  }
}
