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
import { addDays, nowIso, todayString } from '../core/dates'
import type { DayString } from '../core/dates'
import {
  aggregateDay, dayToEpochDay, oauthRueckweg, parseFoodEntries, parseMonthDays,
  planNutritionMetrics, reconcileFoodEntries, type FatSecretEntry,
} from '../core/fatsecret'
import {
  LEERER_STAND, abgleichFaellig, ersterTagDesMonats, nachzuholendeTage, naechsteMonate,
  standNachMonaten, type ImportStand, type MonatsBefund,
} from '../core/fatsecretImport'
import { PUBLIC_APP_URL } from '../sync/config'
import {
  FatSecretFehler, fatsecretMonate, fatsecretStatus, fatsecretTagebuch, fatsecretTrennen,
  fatsecretVerbinden, type FatSecretStatus,
} from '../sync/fatsecret'
import { list } from '../db/repo'

/** Wie viele Tage ein gewöhnlicher Abgleich zurückgeht. */
export const ABGLEICH_TAGE = 7

/**
 * Wie viele Monate eine Runde des historischen Imports prüft.
 *
 * Sechs Monate sind sechs Aufrufe – wenig genug, dass eine Runde schnell
 * vorbei ist, und genug, dass ein Jahr Historie in zwei Runden erfasst ist.
 */
const MONATE_JE_RUNDE = 6

/**
 * Wie viele Tage in EINER Anfrage an die Edge Function gehen.
 *
 * Dort wird daraus je Tag ein Aufruf an FatSecret. Zu viele auf einmal, und
 * die Funktion läuft in ihre Zeitgrenze; zu wenige, und der Import braucht
 * unnötig viele Runden.
 */
const TAGE_JE_ANFRAGE = 10

export interface AbgleichErgebnis {
  ok: boolean
  tage: number
  neu: number
  geaendert: number
  entfernt: number
  ersetzt: number
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
    const leer: AbgleichErgebnis = { ok: false, tage: 0, neu: 0, geaendert: 0, entfernt: 0, ersetzt: 0, meldung: '' }
    try {
      const tage = abzugleichendeTage(anzahlTage)
      const roh = await fatsecretTagebuch(settings, tage.map(dayToEpochDay))
      const ergebnis = anwenden(tage, roh, mutations, data)
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
  const importSchritt = useCallback(async (): Promise<{ weiter: boolean; tage: number }> => {
    const stand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }
    if (stand.fertig) return { weiter: false, tage: 0 }

    const monate = naechsteMonate(stand, MONATE_JE_RUNDE, todayString())
    if (!monate.length) {
      mutations.setSetting('fatsecret_import', { ...stand, fertig: true })
      return { weiter: false, tage: 0 }
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
    let geschrieben = 0
    for (let i = 0; i < alleTage.length; i += TAGE_JE_ANFRAGE) {
      const haeppchen = alleTage.slice(i, i + TAGE_JE_ANFRAGE)
      const tagesdaten = await fatsecretTagebuch(settings, haeppchen.map(dayToEpochDay))
      const e = anwenden(haeppchen, tagesdaten, mutations, data)
      geschrieben += e.neu + e.geaendert
    }

    const neuerStand = standNachMonaten(stand, befunde)
    mutations.setSetting('fatsecret_import', neuerStand)
    return { weiter: !neuerStand.fertig, tage: alleTage.length }
  }, [settings.sync_url, settings.sync_key, mutations, data])

  /**
   * Der Abgleich, der von selbst läuft.
   *
   * Holt die letzten Tage nach (dort wird nachgetragen und korrigiert) und
   * schiebt danach den historischen Import ein Stück weiter, solange er noch
   * nicht durch ist. Beides zusammen ist der Grund, warum man den Knopf
   * „Jetzt abgleichen" im Alltag nicht mehr braucht.
   *
   * Tut nichts, wenn der letzte Lauf noch keine Viertelstunde her ist – außer
   * der historische Import läuft noch, dann geht der weiter.
   */
  const automatisch = useCallback(async (): Promise<void> => {
    const stand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }
    const faellig = abgleichFaellig(stand.zuletzt, Date.now())
    if (!faellig && stand.fertig) return

    try {
      if (faellig) {
        const tage = nachzuholendeTage(todayString(), addDays)
        const roh = await fatsecretTagebuch(settings, tage.map(dayToEpochDay))
        anwenden(tage, roh, mutations, data)
      }
      if (!stand.fertig) await importSchritt()
      // Erst NACH dem Schreiben vermerken: Bricht etwas ab, gilt der Lauf als
      // nicht geschehen und wird beim nächsten Mal wiederholt.
      const jetzt: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }
      mutations.setSetting('fatsecret_import', { ...jetzt, zuletzt: nowIso() })
    } catch (err) {
      // Leise: Der automatische Lauf soll niemanden mit einer Meldung
      // unterbrechen. Wer wissen will, woran es liegt, drückt den Knopf.
      setFehler(err instanceof FatSecretFehler ? err.message : String((err as Error)?.message ?? err))
    }
  }, [settings.sync_url, settings.sync_key, mutations, data, importSchritt])

  const importStand: ImportStand = { ...LEERER_STAND, ...(data.settings.fatsecret_import ?? {}) }

  return {
    status, laeuft, fehler, rueckweg, importStand,
    statusLaden, verbinden, trennen, abgleichen, importSchritt, automatisch,
  }
}

/* ------------------------------------------------------------- Ausführung */

/** Die Metriken, in die die Tagessummen geschrieben werden. */
function ernaehrungsMetriken(data: ReturnType<typeof useApp>['data']) {
  return data.metrics
    .filter((m) => !m.deleted_at && m.group_key === 'nutrition' && m.is_enabled)
    .map((m) => ({ id: m.id, key: m.key }))
}

function anwenden(
  tage: DayString[],
  roh: Record<string, any>,
  mutations: ReturnType<typeof useApp>['mutations'],
  data: ReturnType<typeof useApp>['data'],
): AbgleichErgebnis {
  const syncedAt = nowIso()
  const metriken = ernaehrungsMetriken(data)
  let neu = 0, geaendert = 0, entfernt = 0, ersetzt = 0, verarbeitet = 0

  for (const tag of tage) {
    const antwort = roh[String(dayToEpochDay(tag))]
    if (antwort === undefined) continue
    const eintraege: FatSecretEntry[] = parseFoodEntries(antwort, tag)

    /* ------------------------------------------------ einzelne Lebensmittel */
    // Gelöschte Zeilen gehören dazu: Was in LifeHub bewusst entfernt wurde,
    // darf der nächste Abgleich nicht zurückholen.
    const lokal = list('food_entries', { includeDeleted: true, where: 'day = ?', params: [tag] }) as any[]
    const plan = reconcileFoodEntries({ day: tag, remote: eintraege, lokal, syncedAt })

    for (const a of plan.anlegen) {
      if (mutations.exists('food_entries', a.id)) continue
      mutations.create('food_entries', a.values)
      neu++
    }
    for (const a of plan.aendern) { mutations.patch('food_entries', a.id, a.patch); geaendert++ }
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

    for (const a of mp.anlegen) {
      if (mutations.exists('metric_entries', a.id)) continue
      mutations.create('metric_entries', a.values)
    }
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
  const meldung = teile.length
    ? `${verarbeitet} Tage abgeglichen: ${teile.join(' · ')}.`
    : `${verarbeitet} Tage abgeglichen – alles war schon aktuell.`

  return { ok: true, tage: verarbeitet, neu, geaendert, entfernt, ersetzt, meldung }
}
