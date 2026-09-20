/**
 * TURNEN – der Rahmen: Reiter und Adressen.
 *
 * Eigener Bereich und kein Reiter unter Tracking: Dort liegen bereits sechs
 * Reiter, und das Turnen-Modul braucht selbst eine Unterteilung – zwei
 * Reiterebenen übereinander sind nicht bedienbar.
 *
 * Die Reiterliste ist bewusst so gebaut, dass Küren und Wettkämpfe später
 * nur zwei Einträge mehr sind (TURNEN_ARCHITEKTUR.md, Phasen 2 und 3). „Geräte"
 * wird NIE ein Reiter: Ein Gerät ist kein Ort, an den man geht, sondern die
 * Gliederung von allem anderen – es ist die Achse der Übersicht und der Filter
 * in den Elementen.
 */
import React from 'react'
import { Tabs } from '../ui/components'
import { UebersichtView } from './turnen/Uebersicht'
import { ElementeView } from './turnen/Elemente'
import { TrainingView } from './turnen/Training'

export function TurnenScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  const tabs = [
    { key: '', label: 'Übersicht' },
    { key: 'elemente', label: 'Elemente' },
    { key: 'training', label: 'Training' },
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
    </div>
  )
}
