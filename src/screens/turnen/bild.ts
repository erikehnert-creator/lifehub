/**
 * TURNEN · ÜBERSICHT – die eine Rechnung hinter allen Blöcken oben.
 *
 * ---------------------------------------------------------------------------
 * Warum das hier und nicht in jeder Komponente
 *
 * **Heute** (3E), **Nächstes Training** (3A), **Kommende Einheiten** (3B) und
 * **Nächster Wettkampf** (3C/3D) stehen untereinander auf derselben Seite und
 * brauchen dieselben Zwischenergebnisse: die Wettkampfanalyse aus 2C, die
 * Kürdurchgänge aus 2E und den Trainingsfokus aus 2D. Würde jeder Block sie
 * selbst rechnen, liefe dieselbe Auswertung mehrfach je Zeichnung – und, was
 * schlimmer wäre, mehrere Zustände nebeneinander, die nach einer
 * Datenänderung nicht zwingend gleichzeitig aktuell sind.
 *
 * Die Reihenfolge darin ist die Abhängigkeitsrichtung und keine Geschmacksfrage:
 * 2C und 2E füttern 2D, 2D füttert 3A und 3C, 3D nimmt beide fertig entgegen
 * und gibt den angepassten 3A-Plan an 3B weiter, und 3E wählt daraus den
 * heutigen Termin. Kein Modul ruft zurück nach oben.
 *
 * ---------------------------------------------------------------------------
 * Zwei Haken, nicht einer
 *
 * `kern` hängt an den **Turndaten** (Elemente, Versuche, Küren, Fassungen,
 * Durchgänge, Wettkämpfe, Vergleichswerte). Das ist die teure Rechnung.
 *
 * `tag` hängt zusätzlich an **Terminen, Tagesplan, Schlaf und Metriken** – an
 * Daten also, die sich viel häufiger ändern, ohne dass 2C bis 3D davon
 * betroffen wären. Getrennt gehalten, damit eine umgebuchte Aufgabe nicht die
 * ganze Wettkampfanalyse neu rechnet.
 *
 * Seit Phase 3E wird die **Wochenverteilung (3B) hier** gerechnet und nicht
 * mehr in `Wochenplan.tsx`: Phase 3E braucht sie, um den heutigen Termin
 * daraus zu nehmen, und zwei Verteilungen wären zwei Antworten auf dieselbe
 * Frage.
 *
 * Gespeichert wird nichts davon (3A bis 3E haben keine Tabelle). Nach dem
 * nächsten erfassten Training rechnen diese Haken von selbst neu.
 */
import { useMemo } from 'react'
import { useData } from '../../state/store'
import { todayString, diffDays } from '../../core/dates'
import { computeCapacity } from '../../core/planner'
import { BRAUCHT_ARBEIT } from '../../core/turnen/status'
import { bloeckeMitTag, geraetBilder, geraeteJeEinheit } from '../../core/turnen/elemente'
import { versucheGesamt } from '../../core/turnen/versuche'
import { GERAETE } from '../../core/turnen/geraete'
import { analyseBild } from '../../core/turnen/analyse'
import { durchgaengeJeGeraet } from '../../core/turnen/kuerdurchgaenge'
import { trainingsfokus } from '../../core/turnen/trainingsfokus'
import { istTurnen, geplanteTurntermine } from '../../core/turnen/einheiten'
import { trainingsplanung, type PlanungsBild } from '../../core/turnen/trainingsplanung'
import { wettkampfvorbereitung, type WettkampfZiel } from '../../core/turnen/wettkampfvorbereitung'
import {
  planMitVorbereitung, vorbereitungsstrategie,
  type VorbereitungsAnpassung, type VorbereitungsBild,
} from '../../core/turnen/vorbereitungsstrategie'
import {
  wochenplanung, type TerminEingang, type WochenBild,
} from '../../core/turnen/wochenplanung'
import {
  tagestraining,
  type NachtKontext, type TagesSitzung, type TagesTrainingBild,
} from '../../core/turnen/tagestraining'

/** Die Metrik, aus der die subjektive Tagesform kommt – falls erfasst. */
const ENERGIE_METRIK = 'energy'

export interface TurnenBild {
  /**
   * Phase 3A: der Trainingsvorschlag – **nach** dem Wettkampfkontext aus 3D.
   *
   * Trägt auch Phase 3B: Die Wochenansicht verteilt genau diese Inhalte und
   * weiss von Wettkämpfen nichts. Gibt es keinen kommenden Wettkampf, ist das
   * dasselbe Objekt wie `rohplan`.
   */
  plan: PlanungsBild
  /** Derselbe Vorschlag ohne Wettkampfkontext – für den Vergleich. */
  rohplan: PlanungsBild
  /** Phase 3C: der kommende Wettkampf und der Stand je Gerät. */
  ziel: WettkampfZiel
  /** Phase 3D: Vorbereitungsphase und Leitlinie je Gerät. */
  vorbereitung: VorbereitungsBild
  /** Phase 3D: was sie am Vorschlag geändert hat. Leer = nichts. */
  anpassungen: Map<string, VorbereitungsAnpassung>
  /** Phase 3B: die Verteilung auf die kommenden Termine. */
  woche: WochenBild
  /** Phase 3E: was heute ansteht, plus Tageskontext. */
  tag: TagesTrainingBild
}

export function useTurnenBild(): TurnenBild {
  const data = useData()
  const heute = todayString()

  /* =============================================== 2C · 2E · 2D · 3A · 3D */
  const kern = useMemo(() => {
    const bloecke = bloeckeMitTag(data.gymAttempts, data.workoutSessions)
    const analyse = analyseBild(data.gymCompetitions, data.gymResults, data.gymBenchmarks)
    const durchgaenge = durchgaengeJeGeraet({
      runs: data.gymRoutineRuns,
      versionen: data.gymRoutineVersions,
      einheiten: data.workoutSessions,
      kueren: data.gymRoutines,
      kuerVerknuepfungen: data.gymRoutineElements,
      elemente: data.gymElements,
      heute,
      tagDifferenz: diffDays,
    })
    const fokus = trainingsfokus({
      analyse: analyse.aktuell,
      verlauf: analyse.verlauf,
      elemente: data.gymElements,
      versuche: data.gymAttempts,
      einheiten: data.workoutSessions,
      kueren: data.gymRoutines,
      kuerVerknuepfungen: data.gymRoutineElements,
      durchgaenge,
      heute,
      tagDifferenz: diffDays,
    })
    const rohplan = trainingsplanung({
      fokus,
      geraetBilder: geraetBilder(data.gymElements, bloecke, heute, diffDays, BRAUCHT_ARBEIT),
    })
    // Phase 3C bekommt den FERTIGEN Fokus und die FERTIGE Analyse - es
    // rechnet weder Elemente noch Kueren noch Durchgaenge ein zweites Mal.
    const ziel = wettkampfvorbereitung({
      wettkaempfe: data.gymCompetitions,
      ergebnisse: data.gymResults,
      fokus,
      analyse: analyse.aktuell,
      heute,
      tagDifferenz: diffDays,
    })
    /* Phase 3D sitzt HINTER 3A: Sie nimmt den fertigen Plan und gibt einen
       Plan derselben Form zurueck. Ohne kommenden Wettkampf ist das dasselbe
       Objekt - deshalb verhaelt sich 3A/3B dann Zeichen fuer Zeichen wie
       vorher, und zwar nicht durch Absicht, sondern durch Bauart. */
    const vorbereitung = vorbereitungsstrategie(ziel)
    const { plan, anpassungen } = planMitVorbereitung(rohplan, vorbereitung)

    return { plan, rohplan, ziel, vorbereitung, anpassungen }
  }, [
    data.gymCompetitions, data.gymResults, data.gymBenchmarks,
    data.gymElements, data.gymAttempts, data.workoutSessions,
    data.gymRoutines, data.gymRoutineElements,
    data.gymRoutineRuns, data.gymRoutineVersions, heute,
  ])

  /* ========================================================= 3B · 3E */
  const tagesbild = useMemo(() => {
    /**
     * Die geplanten Turntermine mit Tagesart und freier Zeit.
     *
     * Beides über die vorhandene Tagesrechnung `computeCapacity()` – nicht
     * über eine zweite Kapazitätslogik im Turnen-Modul.
     */
    const termine: TerminEingang[] = geplanteTurntermine(data.workoutSessions).map((s) => {
      const zuordnung = data.dayAssignments.find((a) => !a.deleted_at && a.day === s.day) ?? null
      const tagesart = zuordnung
        ? data.dayTypes.find((t) => t.id === zuordnung.day_type_id) ?? null
        : null
      const kapazitaet = computeCapacity(
        s.day, zuordnung, tagesart, data.timeBlocks, data.tasks, data.events,
        data.settings.sleep_hours ?? 8)
      return {
        sessionId: s.id,
        day: s.day,
        titel: s.title || null,
        dauerMinuten: s.duration_minutes ?? null,
        tagesart: tagesart?.name ?? null,
        freieMinuten: kapazitaet.freeMinutes,
      }
    })

    const woche = wochenplanung({ plan: kern.plan, termine, heute, tagDifferenz: diffDays })

    /* ------------------------------------------- Die Turneinheiten von heute
       ALLE, egal welcher Status: Phase 3E unterscheidet offen von erfasst und
       von ausgefallen selbst, und still eine davon zu uebergehen hiesse, sie
       zu verlieren. */
    const geraeteJeSitzung = geraeteJeEinheit(data.gymAttempts, data.gymElements)
    const versucheJeSitzung = new Map<string, number>()
    for (const v of data.gymAttempts) {
      if (v.deleted_at) continue
      versucheJeSitzung.set(v.session_id,
        (versucheJeSitzung.get(v.session_id) ?? 0) + versucheGesamt(v))
    }
    const durchgaengeJeSitzung = new Map<string, number>()
    for (const r of data.gymRoutineRuns) {
      if (r.deleted_at) continue
      durchgaengeJeSitzung.set(r.session_id, (durchgaengeJeSitzung.get(r.session_id) ?? 0) + 1)
    }

    const sitzungenHeute: TagesSitzung[] = data.workoutSessions
      .filter((s) => istTurnen(s) && s.day === heute)
      .map((s) => ({
        sessionId: s.id,
        status: s.status,
        titel: s.title || null,
        dauerMinuten: s.duration_minutes ?? null,
        versuche: versucheJeSitzung.get(s.id) ?? 0,
        durchgaenge: durchgaengeJeSitzung.get(s.id) ?? 0,
        // In Wettkampfreihenfolge, nicht in der Reihenfolge der Versuche -
        // wie in der Trainingsliste.
        geraete: GERAETE
          .filter((g) => geraeteJeSitzung.get(s.id)?.has(g.key))
          .map((g) => g.name),
      }))

    const terminHeute = termine.find((t) => t.day === heute) ?? null

    /* ------------------------------------------------- Die Nacht auf heute
       `sleep_sessions.day` IST der Morgen des Aufwachens (gesetzt beim
       Import). Die Nacht von Sonntagabend auf Montagmorgen traegt also den
       Montag - es braucht hier keine zweite Datumsdefinition und kein
       Zusammenrechnen von Schlafepisoden. */
    const nachtZeile = data.sleepSessions.find((n) => !n.deleted_at && n.day === heute) ?? null
    const nacht: NachtKontext | null = nachtZeile
      ? {
        day: nachtZeile.day,
        dauerMinuten: nachtZeile.duration_min,
        von: nachtZeile.start_at,
        bis: nachtZeile.end_at,
        quelle: nachtZeile.source,
      }
      : null

    /* Die vorhandene Metrik `energy` - Eriks eigene Angabe, reiner Kontext.
       Es entsteht dafuer kein neues Feld und es wird nichts daraus gefolgert. */
    const energieMetrik = data.metrics.find(
      (x) => !x.deleted_at && x.key === ENERGIE_METRIK) ?? null
    const energieEintrag = energieMetrik
      ? data.metricEntries.find(
        (x) => !x.deleted_at && x.metric_id === energieMetrik.id && x.day === heute) ?? null
      : null

    const tag = tagestraining({
      heute,
      sitzungenHeute,
      woche,
      vorbereitung: kern.vorbereitung,
      tagesart: terminHeute?.tagesart ?? tagesartVon(data, heute),
      freieMinuten: terminHeute?.freieMinuten ?? freieMinutenVon(data, heute),
      nacht,
      energie: energieEintrag?.value_num ?? null,
    })

    return { woche, tag }
  }, [
    kern, heute,
    data.workoutSessions, data.dayAssignments, data.dayTypes,
    data.timeBlocks, data.tasks, data.events, data.settings,
    data.gymAttempts, data.gymElements, data.gymRoutineRuns,
    data.sleepSessions, data.metrics, data.metricEntries,
  ])

  return { ...kern, ...tagesbild }
}

/**
 * Tagesart und freie Zeit für heute, wenn **kein** Turntermin ansteht.
 *
 * Beides kommt aus derselben `computeCapacity()`-Rechnung wie bei den
 * Terminen. Zwei kleine Helfer statt eines dritten Aufrufs im Haken, damit
 * die Reihenfolge dort lesbar bleibt.
 */
function zuordnungVon(data: ReturnType<typeof useData>, tag: string) {
  const zuordnung = data.dayAssignments.find((a) => !a.deleted_at && a.day === tag) ?? null
  const tagesart = zuordnung
    ? data.dayTypes.find((t) => t.id === zuordnung.day_type_id) ?? null
    : null
  return { zuordnung, tagesart }
}

function tagesartVon(data: ReturnType<typeof useData>, tag: string): string | null {
  return zuordnungVon(data, tag).tagesart?.name ?? null
}

function freieMinutenVon(data: ReturnType<typeof useData>, tag: string): number | null {
  const { zuordnung, tagesart } = zuordnungVon(data, tag)
  return computeCapacity(
    tag, zuordnung, tagesart, data.timeBlocks, data.tasks, data.events,
    data.settings.sleep_hours ?? 8).freeMinutes
}
