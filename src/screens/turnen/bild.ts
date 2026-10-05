/**
 * TURNEN · ÜBERSICHT – die eine Rechnung hinter allen Blöcken oben.
 *
 * ---------------------------------------------------------------------------
 * Warum das hier und nicht in jeder Komponente
 *
 * **Nächstes Training** (3A), **Kommende Einheiten** (3B) und **Nächster
 * Wettkampf** (3C) stehen untereinander auf derselben Seite und brauchen
 * dieselben Zwischenergebnisse: die Wettkampfanalyse aus 2C, die Kürdurchgänge
 * aus 2E und den Trainingsfokus aus 2D. Würde jeder Block sie selbst rechnen,
 * liefe dieselbe Auswertung dreimal je Zeichnung – und, was schlimmer wäre,
 * drei Zustände nebeneinander, die nach einer Datenänderung nicht zwingend
 * gleichzeitig aktuell sind.
 *
 * Deshalb **ein** `useMemo` an einer Stelle. Es hängt an denselben Daten wie
 * bisher; was danach kommt, ist ein Nachschlagen.
 *
 * Die Reihenfolge darin ist die Abhängigkeitsrichtung und keine Geschmacksfrage:
 * 2C und 2E füttern 2D, 2D füttert 3A und 3C, und 3D nimmt beide fertig
 * entgegen und gibt den angepassten 3A-Plan an 3B weiter. Kein Modul ruft
 * zurück nach oben.
 *
 * Gespeichert wird nichts davon (3A/3B/3C haben keine Tabelle). Nach dem
 * nächsten erfassten Training rechnet dieser Haken von selbst neu.
 */
import { useMemo } from 'react'
import { useData } from '../../state/store'
import { todayString, diffDays } from '../../core/dates'
import { BRAUCHT_ARBEIT } from '../../core/turnen/status'
import { bloeckeMitTag, geraetBilder } from '../../core/turnen/elemente'
import { analyseBild } from '../../core/turnen/analyse'
import { durchgaengeJeGeraet } from '../../core/turnen/kuerdurchgaenge'
import { trainingsfokus } from '../../core/turnen/trainingsfokus'
import { trainingsplanung, type PlanungsBild } from '../../core/turnen/trainingsplanung'
import { wettkampfvorbereitung, type WettkampfZiel } from '../../core/turnen/wettkampfvorbereitung'
import {
  planMitVorbereitung, vorbereitungsstrategie,
  type VorbereitungsAnpassung, type VorbereitungsBild,
} from '../../core/turnen/vorbereitungsstrategie'

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
}

export function useTurnenBild(): TurnenBild {
  const data = useData()
  const heute = todayString()

  return useMemo(() => {
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
}
