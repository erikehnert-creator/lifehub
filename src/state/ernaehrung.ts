/**
 * Der Ernährungsabgleich mit FatSecret: alles, was Daten tatsächlich anfasst.
 *
 * Die Arbeitsteilung ist Absicht:
 *
 *   core/fatsecret.ts   rechnet und entscheidet – ohne Netz, ohne Datenbank,
 *                       dadurch prüfbar
 *   sync/fatsecret.ts   redet mit der eigenen Edge Function
 *   diese Datei         führt die Entscheidungen aus
 *
 * Die wichtigste Eigenschaft ist, dass ein Abgleich nichts kaputt machen kann,
 * was schon da ist. Er legt nur an, was fehlt, ändert nur, was sich wirklich
 * unterscheidet, und scheitert lieber für einen einzelnen Tag, als eine halb
 * geschriebene Tagesbilanz zu hinterlassen: Jeder Tag wird für sich
 * abgearbeitet, und ein Tag, der schiefgeht, lässt die anderen unberührt.
 */
import { useCallback, useState } from 'react'
import { useApp } from './store'
import { addDays, diffDays, nowIso, todayString } from '../core/dates'
import type { DayString } from '../core/dates'
import {
  aggregateDay, dayToEpochDay, oauthRueckweg, parseFoodEntries, parseMonthDays,
  planNutritionMetrics, pruefeTagesantwort, reconcileFoodEntries, type FatSecretEntry,
} from '../core/fatsecret'
import {
  LEERER_STAND, MINDESTABSTAND_MS, abgleichFaellig, ersterTagDesMonats, nachlaufTage,
  naechsteMonate, standFuerNeuenLauf, standNachMonaten,
  type AbgleichAnlass, type ImportStand, type MonatsBefund,
} from '../core/fatsecretImport'
import { PUBLIC_APP_URL } from '../sync/config'
import {
  FatSecretFehler, fatsecretMonate, fatsecretStatus, fatsecretTagebuch, fatsecretTrennen,
  fatsecretVerbinden, type FatSecretStatus, type Tagebuch,
} from '../sync/fatsecret'
import { list } from '../db/repo'

/** Wie viele Tage ein gewöhnlicher Abgleich zurückgeht. */
export const ABGLEICH_TAGE = 7

/**
 * Wie viele Monate eine Runde des historischen Imports prüft.
 *
 * Ein Jahr je Runde. Das sind zwölf Aufrufe für die Monatsübersichten – wenig,
 * weil eine Übersicht einen ganzen Monat abdeckt. Die eigentliche Arbeit sind
 * die Tage darin, und die werden ohnehin in Häppchen geholt.
 *
 * Weniger wäre schonender, dauert aber länger: Jede Runde wartet auf den
 * nächsten Takt, drei Jahre Historie kämen sonst auf ein Vielfaches an
 * Wartezeit statt an Arbeit.
 */
const MONATE_JE_RUNDE = 12

/**
 * Wie viele Tage in EINER Anfrage an die Edge Function gehen.
 *
 * Dort wird daraus je Tag ein Aufruf an FatSecret. Zu viele auf einmal, und
 * die Funktion läuft in ihre Zeitgrenze; zu wenige, und der Import braucht
 * unnötig viele Runden.
 */
const TAGE_JE_ANFRAGE = 10

/**
 * Wann DIESES Gerät zuletzt die letzten Tage geholt hat.
 *
 * Bewusst nicht in den Einstellungen: Die werden synchronisiert, und dann
 * hielte ein Abgleich am PC das Handy davon ab, beim Öffnen nachzusehen.
 * Fehlt der Speicher (privates Fenster), gilt der Wert für die Sitzung.
 */
export const GERAET_ZULETZT_KEY = 'lifehub.fatsecret.geraetZuletzt'
let geraetZuletztFluechtig: string | null = null

function geraetZuletzt(): string | null {
  try { return localStorage.getItem(GERAET_ZULETZT_KEY) ?? geraetZuletztFluechtig } catch { return geraetZuletztFluechtig }
}

function geraetZuletztMerken(wann: string): void {
  geraetZuletztFluechtig = wann
  try { localStorage.setItem(GERAET_ZULETZT_KEY, wann) } catch { /* bleibt flüchtig */ }
}

/**
 * Der älteste Tag, den ein Abruf dieses Geräts nicht bestätigt bekommen hat.
 *
 * Getrennt von `GERAET_ZULETZT_KEY`, weil beide Angaben verschiedene Fragen
 * beantworten: „wann wurde zuletzt VERSUCHT" steuert die Häufigkeit, „ab wann
 * ist noch etwas offen" steuert, wie weit das Fenster zurückreicht. Fasste man
 * sie zusammen, hielte ein einziger dauerhaft stummer Tag den Zeitstempel für
 * immer fest – und jeder Fensterwechsel holte danach einen ganzen Monat.
 *
 * Ebenfalls je Gerät und nicht synchronisiert: Was DIESES Gerät gesehen hat,
 * geht kein anderes etwas an.
 */
export const GERAET_LUECKE_KEY = 'lifehub.fatsecret.geraetLuecke'
let geraetLueckeFluechtig: string | null = null

function offeneLuecke(): DayString | null {
  let roh: string | null = null
  try { roh = localStorage.getItem(GERAET_LUECKE_KEY) } catch { roh = null }
  const wert = roh ?? geraetLueckeFluechtig
  return wert && /^\d{4}-\d{2}-\d{2}$/.test(wert) ? wert : null
}

function lueckeMerken(tag: DayString | null): void {
  geraetLueckeFluechtig = tag
  try {
    if (tag) localStorage.setItem(GERAET_LUECKE_KEY, tag)
    else localStorage.removeItem(GERAET_LUECKE_KEY)
  } catch { /* bleibt flüchtig */ }
}

export interface AbgleichErgebnis {
  /** Nur wahr, wenn JEDER angefragte Tag verarbeitet wurde. */
  ok: boolean
  tage: number
  neu: number
  geaendert: number
  entfernt: number
  ersetzt: number
  /**
   * Angefragte Tage ohne brauchbare Antwort – übersprungen, nicht geleert.
   *
   * Sie sind der Grund, warum `ok` nicht einfach „es hat nichts geworfen"
   * bedeutet: Ein Abgleich, der die Hälfte der Tage nicht gesehen hat, ist
   * kein erfolgreicher Abgleich, auch wenn jeder Netzwerkaufruf geklappt hat.
   */
  unvollstaendig: number
  /** Die Tage, die übersprungen wurden – für die Anzeige, nicht für die Logik. */
  uebersprungen: DayString[]
  meldung: string
}

/**
 * Warum überhaupt mehrere Tage zurück und nicht nur heute:
 * In FatSecret trägt man abends nach, korrigiert am nächsten Tag eine Portion
 * oder ergänzt das Frühstück von vorgestern. Ein Abgleich, der nur den
 * heutigen Tag ansieht, bekäme davon nie etwas mit – und die Tagesbilanz in
 * LifeHub bliebe für immer auf dem Stand des ersten Abrufs stehen.
 */
export function abzugleichendeTage(tage = ABGLEICH_TAGE, heute = todayString()): DayString[] {
  const out: DayString[] = []
  for (let i = tage - 1; i >= 0; i--) out.push(addDays(heute, -i))
  return out
}

export function useFatSecret() {
  const { data, mutations } = useApp()
  const [laeuft, setLaeuft] = useState(false)
  const [status, setStatus] = useState<FatSecretStatus | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  const settings = { sync_url: data.settings.sync_url, sync_key: data.settings.sync_key }

  const statusLaden = useCallback(async () => {
    setFehler(null)
    try {
      setStatus(await fatsecretStatus(settings))
    } catch (err) {
      setStatus({ connected: false })
      setFehler(err instanceof FatSecretFehler ? err.message : String((err as Error)?.message ?? err))
    }
  }, [settings.sync_url, settings.sync_key])

  /**
   * Wohin FatSecret nach der Freigabe zurückkehrt – und ob dafür die
   * Webfassung gebraucht wird. Wird auch von der Oberfläche gelesen, damit
   * dort vorher dasteht, was gleich passiert, statt den Nutzer zu überraschen.
   */
  const rueckweg = oauthRueckweg(location, PUBLIC_APP_URL)

  const verbinden = useCallback(async () => {
    setFehler(null)
    try {
      // Der Rückweg führt auf die Ernährungsseite zurück. Den Hash-Teil hängt
      // die Edge Function beim Umleiten wieder an – FatSecret setzt seine
      // eigenen Parameter hinten dran und würde ihn sonst verschlucken.
      const ziel = await fatsecretVerbinden(settings, rueckweg.url)
      if (rueckweg.ueberWeb) {
        // Aus der Einzeldatei heraus: ein neues Fenster. Diese Fassung bleibt
        // offen, damit nach der Freigabe niemand seine geöffnete App verliert.
        window.open(ziel, '_blank', 'noopener')
      } else {
        location.href = ziel
      }
    } catch (err) {
      setFehler(err instanceof FatSecretFehler ? err.message : String((err as Error)?.message ?? err))
    }
  }, [settings.sync_url, settings.sync_key, rueckweg.url, rueckweg.ueberWeb])

  const trennen = useCallback(async () => {
    setFehler(null)
    try {
      await fatsecretTrennen(settings)
      setStatus({ connected: false })
      mutations.toast('FatSecret getrennt. Bereits importierte Tage bleiben erhalten.')
    } catch (err) {
      setFehler(err instanceof FatSecretFehler ? err.message : String((err as Error)?.message ?? err))
    }
  }, [settings.sync_url, settings.sync_key, mutations])

  const abgleichen = useCallback(async (anzahlTage = ABGLEICH_TAGE): Promise<AbgleichErgebnis> => {
    setLaeuft(true)
    setFehler(null)
    const leer: AbgleichErgebnis = {
      ok: false, tage: 0, neu: 0, geaendert: 0, entfernt: 0, ersetzt: 0,
      unvollstaendig: 0, uebersprungen: [], meldung: '',
    }
    try {
      const tage = abzugleichendeTage(anzahlTage)
      const tagebuch = await fatsecretTagebuch(settings, tage.map(dayToEpochDay))
      const ergebnis = mutations.batch(() => anwenden(tage, tagebuch, mutations, data))
      geraetZuletztMerken(nowIso())
      setStatus((s) => (s ? { ...s, last_sync_at: nowIso() } : s))
      return ergebnis
    } catch (err) {
      const meldung = err instanceof FatSecretFehler
        ? err.message
        : `Abgleich fehlgeschlagen: ${String((err as Error)?.message ?? err)}`
      setFehler(meldung)
      // Wichtig: Bis hierher wurde nichts geschrieben. Ein fehlgeschlagener
      // Abgleich lässt den vorhandenen Bestand unverändert stehen.
      return { ...leer, meldung }
    } finally {
      setLaeuft(false)
    }
  }, [settings.sync_url, settings.sync_key, mutations, data])

  /**
   * Eine Runde des historischen Imports – und sonst nichts.
   *
   * Bewusst EIN Schritt statt einer Schleife bis zum Ende: Der Lauf kann über
   * Jahre gehen, und ein Browserfenster, das man zwischendurch schließt, darf
   * nicht bedeuten, dass alles von vorn beginnt. Der Fortschritt steht nach
   * jeder Runde in den Einstellungen – und weil die mitsynchronisiert werden,
   * macht das Handy dort weiter, wo der PC aufgehört hat.
   *
   * Zurück kommt, ob es noch etwas zu tun gibt. Der Aufrufer entscheidet, wann
   * die nächste Runde läuft.
   */
  const importSchritt = useCallback(async (): Promise<{ weiter: boolean; tage: number; stand: ImportStand }> => {
    const stand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }
    if (stand.fertig) return { weiter: false, tage: 0, stand }

    const monate = naechsteMonate(stand, MONATE_JE_RUNDE, todayString())
    if (!monate.length) {
      const fertig = { ...stand, fertig: true }
      mutations.setSetting('fatsecret_import', fertig)
      return { weiter: false, tage: 0, stand: fertig }
    }

    // 1. Welche Tage haben überhaupt Einträge? Ein Aufruf je Monat.
    const roh = await fatsecretMonate(settings, monate.map((m) => dayToEpochDay(ersterTagDesMonats(m))))
    const befunde: MonatsBefund[] = monate.map((m) => ({
      monat: m,
      tage: parseMonthDays(roh[String(dayToEpochDay(ersterTagDesMonats(m)))]),
    }))

    // 2. Diese Tage im Einzelnen holen – dort stehen die Nährwerte, die die
    //    Monatsübersicht nicht hat. In Häppchen, damit weder FatSecret noch
    //    die Edge Function in einem Zug überlastet werden.
    const alleTage = befunde.flatMap((b) => b.tage).sort().reverse()
    /** Tage, zu denen FatSecret nichts Brauchbares geliefert hat. */
    const luecken = new Set<DayString>()
    for (let i = 0; i < alleTage.length; i += TAGE_JE_ANFRAGE) {
      const haeppchen = alleTage.slice(i, i + TAGE_JE_ANFRAGE)
      const tagesdaten = await fatsecretTagebuch(settings, haeppchen.map(dayToEpochDay))
      // Als EIN Stapel: eine Datenbanktransaktion, ein Nachladen am Ende. Ohne
      // das loeste jede einzelne geschriebene Zeile ein vollstaendiges
      // Neuladen aller Tabellen aus - bei zehn Tagen sind das gut 900 Zeilen
      // und damit 900 Neuladungen. Die alte Fassung hat den Import daran nicht
      // nur verlangsamt, sondern die Seite zum Absturz gebracht.
      const e = mutations.batch(() => anwenden(haeppchen, tagesdaten, mutations, data))
      for (const t of e.uebersprungen) luecken.add(t)
    }

    /* Nur die Monate abhaken, die WIRKLICH durch sind.
    
       Vorher wanderte `geprueftBis` in jedem Fall weiter – auch über einen
       Monat, dessen Tage gar nicht angekommen waren. Der Lauf ging dann zum
       nächsten Monat, erreichte irgendwann „fertig", und die Lücke war
       dauerhaft: Der laufende Abgleich sieht nur die letzten Tage, und der
       Historienlauf hielt sich für erledigt. Jetzt bleibt der erste
       unvollständige Monat stehen, und die nächste Runde beginnt wieder bei
       ihm. Die Monate werden von neu nach alt abgearbeitet, deshalb genügt
       es, beim ersten Loch abzubrechen. */
    const vollstaendig: MonatsBefund[] = []
    for (const b of [...befunde].sort((x, y) => (x.monat < y.monat ? 1 : -1))) {
      if (b.tage.some((t) => luecken.has(t))) break
      vollstaendig.push(b)
    }

    const neuerStand = standNachMonaten(stand, vollstaendig)
    mutations.setSetting('fatsecret_import', neuerStand)
    return { weiter: !neuerStand.fertig, tage: alleTage.length, stand: neuerStand }
  }, [settings.sync_url, settings.sync_key, mutations, data])

  /**
   * Der Abgleich, der von selbst läuft.
   *
   * Holt die letzten Tage nach (dort wird nachgetragen und korrigiert) und
   * schiebt danach den historischen Import ein Stück weiter, solange er noch
   * nicht durch ist. Beides zusammen ist der Grund, warum man den Knopf
   * „Jetzt abgleichen" im Alltag nicht mehr braucht.
   *
   * Tut nichts, wenn dieses Gerät die letzten Tage für den jeweiligen Anlass
   * gerade erst geholt hat (MINDESTABSTAND_MS) – außer der historische Import
   * läuft noch, dann geht der weiter.
   *
   * Zurück kommt, ob die Historie noch weitere Runden braucht. Der Aufrufer
   * kann die nächste dann gleich anstoßen, statt auf den nächsten Takt zu
   * warten – siehe App.tsx. Gemessen war genau das der Unterschied zwischen
   * „drei Jahre Historie in einer halben Minute" und „in drei Minuten": Die
   * Arbeit selbst dauert Sekunden, gewartet wurde auf die Uhr.
   */
  const automatisch = useCallback(async (anlass: AbgleichAnlass = 'weiter'): Promise<boolean> => {
    const stand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }
    const faellig = abgleichFaellig(geraetZuletzt(), Date.now(), MINDESTABSTAND_MS[anlass])
    if (!faellig && stand.fertig) return false

    /**
     * Die letzten Tage nachholen – so viele, wie seit dem letzten Abruf
     * dieses Geräts vergangen sind.
     *
     * Im Alltag sind das die drei Korrekturtage. War LifeHub eine Woche zu,
     * sind es sieben; höchstens ein Monat (`nachlaufTage`). Vorher waren es
     * immer genau drei – und alles, was länger zurücklag, wurde nie geholt.
     *
     * In Häppchen, weil die Edge Function je Tag einen Aufruf an FatSecret
     * macht und bei dreissig Tagen in einem Zug in ihre Zeitgrenze liefe.
     */
    const letzteTageHolen = async () => {
      const tage = nachlaufTage({
        heute: todayString(), zuletzt: geraetZuletzt(), abTag: offeneLuecke(), addDays, diffDays,
      })
      const offen: DayString[] = []
      for (let i = 0; i < tage.length; i += TAGE_JE_ANFRAGE) {
        const haeppchen = tage.slice(i, i + TAGE_JE_ANFRAGE)
        const tagebuch = await fatsecretTagebuch(settings, haeppchen.map(dayToEpochDay))
        const e = mutations.batch(() => anwenden(haeppchen, tagebuch, mutations, data))
        offen.push(...e.uebersprungen)
      }
      // Versucht wurde es – das steuert, wann der nächste Lauf fällig ist.
      geraetZuletztMerken(nowIso())
      // Was dabei offen blieb, hält das Fenster beim nächsten Mal so weit
      // offen, dass der Tag wieder mitkommt. Ohne diese Merkstelle waere er
      // nach drei Tagen aus dem Fenster gewandert und nie wieder geholt worden.
      lueckeMerken(offen.length ? [...offen].sort()[0] : null)
      return offen.length === 0
    }

    try {
      if (faellig) await letzteTageHolen()
      // Der Stand NACH dem Importschritt – und zwar der, den der Schritt
      // zurückgibt, nicht der aus `data`.
      //
      // Das war ein echter Fehler: `data` ist die Momentaufnahme vom letzten
      // Rendern. Wer daraus liest und zurückschreibt, überschreibt genau den
      // Fortschritt, den der Importschritt eben gespeichert hat. Der Lauf
      // begann dadurch bei jeder Runde wieder beim selben Monat – gemessen
      // 3531 geholte Tage, obwohl es nur 168 gab, und „fertig" wurde nie
      // erreicht. Von außen sah das aus wie „der Import ist langsam".
      const danach = stand.fertig ? stand : (await importSchritt()).stand
      // Eben fertig geworden: Die drei Tage noch einmal frisch holen. Ein
      // Erstimport über Jahre dauert, und was währenddessen in FatSecret
      // eingetragen wurde, soll nicht bis zum nächsten Öffnen warten.
      if (!stand.fertig && danach.fertig && !faellig) await letzteTageHolen()
      mutations.setSetting('fatsecret_import', { ...danach, zuletzt: nowIso() })
      return !danach.fertig
    } catch (err) {
      // Leise: Der automatische Lauf soll niemanden mit einer Meldung
      // unterbrechen. Wer wissen will, woran es liegt, drückt den Knopf.
      setFehler(err instanceof FatSecretFehler ? err.message : String((err as Error)?.message ?? err))
      // Nach einem Fehler NICHT sofort weitermachen: Sonst liefe der Lauf bei
      // einer abgelaufenen Freigabe in einer engen Schleife gegen den Server.
      return false
    }
  }, [settings.sync_url, settings.sync_key, mutations, data, importSchritt])

  /**
   * Die Historie noch einmal durchgehen.
   *
   * Für den Fall, dass in FatSecret ein Tag von vor drei Monaten korrigiert
   * wurde – der laufende Abgleich sieht nur drei Tage zurück und bekäme davon
   * nichts mit. Zurückgesetzt wird nur der Suchfortschritt; was schon da ist,
   * bleibt und wird aktualisiert statt doppelt angelegt.
   */
  const historieErneut = useCallback(() => {
    const stand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }
    mutations.setSetting('fatsecret_import', standFuerNeuenLauf(stand))
    mutations.toast('Historienabgleich gestartet – er läuft im Hintergrund weiter.')
  }, [mutations, data])

  const importStand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }

  return {
    status, laeuft, fehler, rueckweg, importStand,
    statusLaden, verbinden, trennen, abgleichen, importSchritt, automatisch, historieErneut,
  }
}

/* ------------------------------------------------------------- Ausführung */

/** Die Metriken, in die die Tagessummen geschrieben werden. */
function ernaehrungsMetriken(data: ReturnType<typeof useApp>['data']) {
  return data.metrics
    .filter((m) => !m.deleted_at && m.group_key === 'nutrition' && m.is_enabled)
    .map((m) => ({ id: m.id, key: m.key }))
}

/**
 * Die Antworten auf die Tage anwenden, für die es welche gibt.
 *
 * ---------------------------------------------------------------------------
 * Der Unterschied zwischen „leer" und „keine Antwort"
 *
 * Vorher stand hier `if (antwort === undefined) continue` – und das war die
 * einzige Absicherung. Sie griff aber nur, wenn der Tag ganz fehlte. Kam er
 * als `null` zurück (die Edge Function setzte das, sobald sich die Antwort
 * von FatSecret nicht als JSON lesen liess – Wartungsseite, abgeschnittener
 * Rumpf), dann las `parseFoodEntries(null)` eine leere Liste. Und eine leere
 * Liste heisst hier: „in FatSecret wurde alles gelöscht." Der Abgleich
 * entfernte daraufhin die Mahlzeiten dieses Tages UND seine Tageswerte –
 * und meldete „1 Tag abgeglichen".
 *
 * Jetzt entscheidet `pruefeTagesantwort()`, und ein Tag ohne brauchbare
 * Antwort wird übersprungen und gezählt. Was in LifeHub steht, bleibt
 * stehen; beim nächsten Abgleich wird der Tag erneut geholt.
 */
function anwenden(
  tage: DayString[],
  tagebuch: Tagebuch,
  mutations: ReturnType<typeof useApp>['mutations'],
  data: ReturnType<typeof useApp>['data'],
): AbgleichErgebnis {
  const syncedAt = nowIso()
  const metriken = ernaehrungsMetriken(data)
  let neu = 0, geaendert = 0, entfernt = 0, ersetzt = 0, verarbeitet = 0
  const uebersprungen: DayString[] = []

  for (const tag of tage) {
    const antwort = tagebuch.tage[String(dayToEpochDay(tag))]
    const geprueft = pruefeTagesantwort(antwort)
    if (!geprueft.brauchbar) { uebersprungen.push(tag); continue }
    const eintraege: FatSecretEntry[] = parseFoodEntries(antwort, tag)

    /* ------------------------------------------------ einzelne Lebensmittel */
    // Geholt wird der ganze Tag – auch die gelöschten Zeilen – UND jede Zeile,
    // die zu einer der gerade gelieferten food_entry_ids gehört, egal an
    // welchem Tag sie steht. Letzteres, damit ein in FatSecret auf einen
    // anderen Tag verschobener Eintrag mitwandern kann statt zu verschwinden
    // (siehe reconcileFoodEntries).
    const externIds = eintraege.map((e) => e.externalId)
    const platzhalter = externIds.map(() => '?').join(', ')
    const lokal = list('food_entries', {
      includeDeleted: true,
      where: externIds.length ? `day = ? OR external_id IN (${platzhalter})` : 'day = ?',
      params: [tag, ...externIds],
    }) as any[]
    const plan = reconcileFoodEntries({ day: tag, remote: eintraege, lokal, syncedAt })

    // Ohne `exists`-Abfrage: Die Abfrage oben holt jede Zeile, die der Plan
    // wiedererkennen könnte. Was hier ankommt, gibt es also wirklich noch nicht.
    for (const a of plan.anlegen) {
      mutations.create('food_entries', a.values)
      neu++
    }
    for (const a of plan.aendern) { mutations.patch('food_entries', a.id, a.patch); geaendert++ }
    for (const w of plan.wiederherstellen) {
      mutations.restoreRow('food_entries', w.id)
      mutations.patch('food_entries', w.id, w.values)
      neu++
    }
    for (const e of plan.entfernen) { mutations.removeQuiet('food_entries', e.id); entfernt++ }

    /* ------------------------------------------------------- Tagessummen */
    // Bewusst aus den EBEN geschriebenen Einträgen gerechnet, nicht aus dem
    // Zustand von vorhin: Sonst hinkt die Tagesbilanz immer einen Abgleich
    // hinterher.
    const werte = aggregateDay(eintraege)
    const vorhandeneWerte = list('metric_entries', {
      includeDeleted: true, where: 'day = ?', params: [tag],
    }) as any[]
    const mp = planNutritionMetrics({ day: tag, werte, metriken, vorhanden: vorhandeneWerte, syncedAt })

    // Ohne `exists`-Abfrage, und das ist Absicht: `vorhanden` enthält ALLE
    // Zeilen des Tages, auch die gelöschten, und die eigene Zeile wird an
    // ihrer ID erkannt. Was hier als „anlegen" ankommt, gibt es also
    // nachweislich noch nicht. Die frühere Abfrage übersprang dagegen still
    // genau den Fall, den sie hätte melden müssen – eine vorhandene Zeile,
    // die der Plan nicht wiedererkannt hatte.
    for (const a of mp.anlegen) mutations.create('metric_entries', a.values)
    for (const a of mp.aendern) mutations.patch('metric_entries', a.id, a.patch)
    for (const w of mp.wiederherstellen) {
      mutations.restoreRow('metric_entries', w.id)
      mutations.patch('metric_entries', w.id, w.patch)
    }
    for (const e of mp.ersetzen) { mutations.removeQuiet('metric_entries', e.id); ersetzt++ }
    for (const e of mp.entfernen) mutations.removeQuiet('metric_entries', e.id)

    verarbeitet++
  }

  const teile: string[] = []
  if (neu) teile.push(`${neu} neu`)
  if (geaendert) teile.push(`${geaendert} aktualisiert`)
  if (entfernt) teile.push(`${entfernt} entfernt`)
  if (ersetzt) teile.push(`${ersetzt} eigene Eingabe durch FatSecret ersetzt`)
  const kern = teile.length
    ? `${verarbeitet} Tage abgeglichen: ${teile.join(' · ')}.`
    : `${verarbeitet} Tage abgeglichen – alles war schon aktuell.`
  // Übersprungene Tage gehören in die Meldung, nicht nur ins Ergebnisobjekt:
  // „7 Tage abgeglichen", während drei davon gar nicht angesehen wurden, ist
  // genau die Erfolgsmeldung, die man nicht haben will.
  const meldung = uebersprungen.length
    ? `${kern} ${uebersprungen.length} Tag(e) hat FatSecret nicht beantwortet `
      + `(${uebersprungen.slice(0, 3).join(', ')}${uebersprungen.length > 3 ? ' …' : ''}) – `
      + 'sie bleiben unverändert und werden beim nächsten Mal erneut geholt.'
    : kern

  return {
    ok: uebersprungen.length === 0,
    tage: verarbeitet, neu, geaendert, entfernt, ersetzt,
    unvollstaendig: uebersprungen.length, uebersprungen, meldung,
  }
}
