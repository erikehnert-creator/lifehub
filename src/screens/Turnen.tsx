/**
 * TURNEN – der Rahmen: Reiter und Adressen.
 *
 * Eigener Bereich und kein Reiter unter Tracking: Dort liegen bereits sechs
 * Reiter, und das Turnen-Modul braucht selbst eine Unterteilung – zwei
 * Reiterebenen übereinander sind nicht bedienbar.
 *
 * Sechs Reiter: Übersicht, Elemente, Training, Küren, Wettkämpfe, Analyse.
 * Der PDF-Import aus Phase 2B2 ist bewusst KEIN Reiter, sondern ein Weg in den
 * Wettkampfeditor hinein. „Geräte" wird NIE ein Reiter: Ein Gerät ist kein Ort,
 * an den man geht, sondern die Gliederung von allem anderen – es ist die Achse
 * der Übersicht und der Filter in den Elementen.
 *
 * ---------------------------------------------------------------------------
 * Warum die Analyse einen eigenen Reiter bekommt
 *
 * Sie beantwortet eine andere Frage als die Wettkämpfe. Dort steht, WAS geturnt
 * wurde – hier, wo das im Feld stand. Unter „Wettkämpfe" wäre es ein zweiter
 * langer Abschnitt in einem Reiter, der schon Liste, Editor, Import und Verlauf
 * trägt.
 *
 * Sechs Reiter passen nicht mehr nebeneinander auf ein Handy – die Leiste
 * scrollt deshalb waagerecht und zeigt den Überlauf an (`Tabs`, `.ueberlauf`).
 * Das war schon vor dem sechsten so und ist nachgemessen: `turnen-analyse-e2e`
 * prüft bei 390 px, dass der Reiter erreichbar ist.
 */
import React from 'react'
import { Tabs } from '../ui/components'
import { UebersichtView } from './turnen/Uebersicht'
import { ElementeView } from './turnen/Elemente'
import { TrainingView } from './turnen/Training'
import { KuerenView } from './turnen/Kueren'
import { WettkaempfeView } from './turnen/Wettkaempfe'
import { AnalyseView } from './turnen/Analyse'

export function TurnenScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  const tabs = [
    { key: '', label: 'Übersicht' },
    { key: 'elemente', label: 'Elemente' },
    { key: 'training', label: 'Training' },
    { key: 'kueren', label: 'Küren' },
    { key: 'wettkaempfe', label: 'Wettkämpfe' },
    { key: 'analyse', label: 'Analyse' },
  ]
  const geh = (k: string) => navigate(`#/turnen${k ? '/' + k : ''}`)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Turnen</div>
        </div>
      </div>
      <Tabs tabs={tabs} active={sub} onChange={geh} />
      {sub === '' && (
        <UebersichtView
          onZuElementen={() => geh('elemente')}
          onZuTraining={() => geh('training')} />
      )}
      {sub === 'elemente' && <ElementeView />}
      {sub === 'training' && <TrainingView onZuElementen={() => geh('elemente')} />}
      {sub === 'kueren' && <KuerenView onZuElementen={() => geh('elemente')} />}
      {sub === 'wettkaempfe' && <WettkaempfeView onZuKueren={() => geh('kueren')} />}
      {sub === 'analyse' && <AnalyseView onZuWettkaempfen={() => geh('wettkaempfe')} />}
    </div>
  )
}
