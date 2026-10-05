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

export interface TurnenBild {
  /** Phase 3A: der Trainingsvorschlag. Trägt auch Phase 3B. */
  plan: PlanungsBild
  /** Phase 3C: der kommende Wettkampf und der Stand je Gerät. */
  ziel: WettkampfZiel
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
    return {
      plan: trainingsplanung({
        fokus,
        geraetBilder: geraetBilder(data.gymElements, bloecke, heute, diffDays, BRAUCHT_ARBEIT),
      }),
      // Phase 3C bekommt den FERTIGEN Fokus und die FERTIGE Analyse - es
      // rechnet weder Elemente noch Kueren noch Durchgaenge ein zweites Mal.
      ziel: wettkampfvorbereitung({
        wettkaempfe: data.gymCompetitions,
        ergebnisse: data.gymResults,
        fokus,
        analyse: analyse.aktuell,
        heute,
        tagDifferenz: diffDays,
      }),
    }
  }, [
    data.gymCompetitions, data.gymResults, data.gymBenchmarks,
    data.gymElements, data.gymAttempts, data.workoutSessions,
    data.gymRoutines, data.gymRoutineElements,
    data.gymRoutineRuns, data.gymRoutineVersions, heute,
  ])
}
