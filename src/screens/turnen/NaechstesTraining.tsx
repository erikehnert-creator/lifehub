/**
 * TURNEN · NÄCHSTES TRAINING – der Vorschlag, bevor man in die Halle geht.
 *
 * ---------------------------------------------------------------------------
 * Ein Block, kein Reiter
 *
 * Die Frage „was turne ich heute?" stellt sich beim Aufschlagen der
 * Turnübersicht, nicht nach zwei Klicks. Ein siebter Reiter wäre ausserdem
 * einer, der nach dem Training nichts mehr zu sagen hat.
 *
 * ---------------------------------------------------------------------------
 * Nichts davon wird gespeichert
 *
 * Der Vorschlag wird bei jeder Datenänderung neu gerechnet (`trainingsplanung`,
 * gemessen weit unter einer Millisekunde). Nach dem nächsten erfassten Training
 * steht hier von selbst etwas anderes – eine gespeicherte Empfehlung wäre ab
 * dann falsch, ohne dass es auffällt.
 *
 * Was der Nutzer am Vorschlag ändert – Gerät abwählen, Reihenfolge umstellen,
 * Inhalt entfernen, Gerät dazunehmen – lebt in den Zuständen dieser Komponente
 * und geht durch `planMitAuswahl()`. Diese Funktion ist rein, damit dieselben
 * Fälle in `turnen-trainingsplanung.test.ts` nachgerechnet werden können,
 * statt sie durch die Oberfläche klicken zu müssen.
 *
 * ---------------------------------------------------------------------------
 * Erfasst wird mit dem vorhandenen Weg
 *
 * Der Knopf führt in den Reiter **Training**. Dort entstehen Elementversuche
 * als `gym_attempts` und Kürdurchgänge als `gym_routine_runs`, genau wie
 * bisher. Es gibt keine zweite Trainingserfassung und keinen „Plan
 * erledigt"-Zustand: Der Plan ist eine Ansicht, kein Datensatz.
 */
import React, { useMemo, useState } from 'react'
import { Card } from '../../ui/components'
import { useData } from '../../state/store'
import { todayString, diffDays } from '../../core/dates'
import { BRAUCHT_ARBEIT } from '../../core/turnen/status'
import { bloeckeMitTag, geraetBilder } from '../../core/turnen/elemente'
import { analyseBild } from '../../core/turnen/analyse'
import { durchgaengeJeGeraet } from '../../core/turnen/kuerdurchgaenge'
import { trainingsfokus } from '../../core/turnen/trainingsfokus'
import {
  INHALT_ART_LABEL, KEIN_PLAN_TEXT, REIHENFOLGE_TEXT, ROLLE_LABEL, UMFANG_LABEL,
  geraeteLabel, nachwaehlbar, planMitAuswahl, trainingsplanung,
  type GeraetPlan, type PlanungsBild,
} from '../../core/turnen/trainingsplanung'

export function NaechstesTraining({ onZuTraining }: { onZuTraining: () => void }) {
  const data = useData()
  const heute = todayString()

  const [ohne, setOhne] = useState<string[]>([])
  const [zusatz, setZusatz] = useState<string[]>([])
  const [reihenfolge, setReihenfolge] = useState<string[]>([])
  const [ohneInhalte, setOhneInhalte] = useState<string[]>([])

  /**
   * Der Vorschlag.
   *
   * Dieselben Rechnungen wie im Trainingsfokus der Analyse, hier ein zweites
   * Mal: `useMemo` hängt an denselben Daten, und die Planung selbst ist ein
   * Nachschlagen. Ein gemeinsamer Zwischenspeicher über zwei Reiter hinweg
   * wäre ein zweiter Zustand, der veralten kann.
   */
  const bild: PlanungsBild = useMemo(() => {
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
    return trainingsplanung({
      fokus,
      geraetBilder: geraetBilder(data.gymElements, bloecke, heute, diffDays, BRAUCHT_ARBEIT),
    })
  }, [
    data.gymCompetitions, data.gymResults, data.gymBenchmarks,
    data.gymElements, data.gymAttempts, data.workoutSessions,
    data.gymRoutines, data.gymRoutineElements,
    data.gymRoutineRuns, data.gymRoutineVersions, heute,
  ])

  const plan = useMemo(
    () => planMitAuswahl(bild, { ohne, zusatz, reihenfolge, ohneInhalte }),
    [bild, ohne, zusatz, reihenfolge, ohneInhalte],
  )
  const frei = useMemo(
    () => nachwaehlbar(bild, { ohne, zusatz, reihenfolge, ohneInhalte }),
    [bild, ohne, zusatz, reihenfolge, ohneInhalte],
  )
  const geaendert = ohne.length > 0 || zusatz.length > 0
    || reihenfolge.length > 0 || ohneInhalte.length > 0

  const zurueck = () => {
    setOhne([])
    setZusatz([])
    setReihenfolge([])
    setOhneInhalte([])
  }

  /** Ein Gerät um einen Platz verschieben – die Reihenfolge IST die Liste. */
  const schiebe = (apparatus: string, richtung: -1 | 1) => {
    const jetzt = plan.map((g) => g.apparatus)
    const i = jetzt.indexOf(apparatus)
    const j = i + richtung
    if (i < 0 || j < 0 || j >= jetzt.length) return
    const neu = [...jetzt]
    const merk = neu[i]
    neu[i] = neu[j]
    neu[j] = merk
    setReihenfolge(neu)
  }

  if (bild.grund) {
    return (
      <Card className="mb16" title="Nächstes Training">
        <div className="muted small">{KEIN_PLAN_TEXT[bild.grund]}</div>
        <div className="row mt8">
          <button className="btn btn-sm btn-primary" onClick={onZuTraining}>
            Training frei erfassen
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="mb16" title="Nächstes Training"
      sub={`${geraeteLabel(plan.length)} – ein Vorschlag, keine Verpflichtung`}
      action={geaendert
        ? <button className="btn btn-sm btn-ghost" onClick={zurueck}>zurücksetzen</button>
        : undefined}>

      {!bild.hatWettkampf && (
        <div className="hint-box small mb8">
          Ohne Wettkampfprotokoll gibt es keine Gerätepriorität – der Vorschlag
          kommt hier allein aus dem Training.
        </div>
      )}

      {plan.length === 0 ? (
        <div className="muted small">
          Alle Geräte abgewählt.{' '}
          <button className="btn btn-sm btn-ghost" onClick={zurueck}>zurücksetzen</button>
        </div>
      ) : (
        <div className="np-liste">
          {plan.map((g, i) => (
            <NaechstesGeraet key={g.apparatus} g={g} nummer={i + 1}
              erste={i === 0} letzte={i === plan.length - 1}
              onWeg={() => setOhne([...ohne, g.apparatus])}
              onHoch={() => schiebe(g.apparatus, -1)}
              onRunter={() => schiebe(g.apparatus, 1)}
              onInhaltWeg={(key) => setOhneInhalte([...ohneInhalte, key])} />
          ))}
        </div>
      )}

      {frei.length > 0 && (
        <div className="np-nachwahl">
          <span className="np-nachwahl-kopf">Noch dazunehmen</span>
          {frei.map((g) => (
            <button key={g.apparatus} type="button" className="btn btn-sm"
              onClick={() => {
                setOhne(ohne.filter((k) => k !== g.apparatus))
                setZusatz([...zusatz, g.apparatus])
              }}>
              + {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="row mt8">
        <button className="btn btn-sm btn-primary" onClick={onZuTraining}>
          Training erfassen
        </button>
      </div>
    </Card>
  )
}

/**
 * Ein Gerät im Vorschlag.
 *
 * Die Kopfzeile trägt die Rolle, darunter stehen die Tätigkeiten, jede mit
 * ihrer Art und ihrem Umfang. **Keine Minuten** – der Umfang sagt, wie viel
 * Raum etwas bekommen soll, und behauptet keine Zeitverteilung.
 *
 * Die Begründungen sind **eingeklappt**: Ausgeschrieben wären es je Gerät fünf
 * bis acht Sätze, und aus dem Block würde eine Textwand. Sie fehlen aber
 * nicht – ein Tipp, und jede Zeile sagt, woraus sie entstanden ist.
 */
function NaechstesGeraet({
  g, nummer, erste, letzte, onWeg, onHoch, onRunter, onInhaltWeg,
}: {
  g: GeraetPlan
  nummer: number
  erste: boolean
  letzte: boolean
  onWeg: () => void
  onHoch: () => void
  onRunter: () => void
  onInhaltWeg: (key: string) => void
}) {
  const [offen, setOffen] = useState(false)

  return (
    <div className="np-geraet">
      <div className="np-kopf">
        <span className="np-nr">{nummer}.</span>
        <span className="np-name">{g.name}</span>
        {g.rolle && (
          <span className={`np-rolle np-rolle-${g.rolle}`}>{ROLLE_LABEL[g.rolle]}</span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onHoch}
          disabled={erste} aria-label={`${g.name} nach oben`}>↑</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRunter}
          disabled={letzte} aria-label={`${g.name} nach unten`}>↓</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onWeg}
          aria-label={`${g.name} abwählen`}>abwählen</button>
      </div>

      <div className="np-reihenfolge">{REIHENFOLGE_TEXT[g.reihenfolgeArt]}</div>

      {g.inhalte.length === 0 ? (
        <div className="muted small">Alle Inhalte entfernt – das Gerät bleibt stehen.</div>
      ) : (
        <div className="np-inhalte">
          {g.inhalte.map((i) => (
            <div className="np-inhalt" key={i.key}>
              <div className="np-inhalt-kopf">
                <span className={`np-art np-art-${i.art}`}>{INHALT_ART_LABEL[i.art]}</span>
                <span className="np-inhalt-text">{i.text}</span>
                <span className="np-umfang">{UMFANG_LABEL[i.umfang]}</span>
                <button type="button" className="btn btn-sm btn-ghost np-weg"
                  onClick={() => onInhaltWeg(i.key)}
                  aria-label={`„${i.text}" entfernen`}>×</button>
              </div>
              {offen && i.warum.length > 0 && (
                <div className="np-inhalt-grund">{i.warum.join(' ')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {g.hinweise.map((h) => <div className="np-hinweis" key={h}>{h}</div>)}

      <button type="button" className="btn btn-sm btn-ghost np-warum"
        onClick={() => setOffen(!offen)} aria-expanded={offen}>
        {offen ? '▴ Begründung zu' : '▾ Warum dieses Gerät?'}
      </button>
      {offen && (
        <div className="np-begruendung">
          {g.warum.map((s, i) => <p key={i}>{s}</p>)}
        </div>
      )}
    </div>
  )
}
