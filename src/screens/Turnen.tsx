/**
 * TURNEN – der Rahmen: Reiter und Adressen.
 *
 * Eigener Bereich und kein Reiter unter Tracking: Dort liegen bereits sechs
 * Reiter, und das Turnen-Modul braucht selbst eine Unterteilung – zwei
 * Reiterebenen übereinander sind nicht bedienbar.
 *
 * Küren sind seit Phase 2A der vierte Reiter. Wettkämpfe sind später ein
 * fünfter Eintrag in derselben Liste und sonst nichts – die Struktur bleibt
 * dafür so, wie sie ist (TURNEN_ARCHITEKTUR.md, Phase 2B). „Geräte"
 * wird NIE ein Reiter: Ein Gerät ist kein Ort, an den man geht, sondern die
 * Gliederung von allem anderen – es ist die Achse der Übersicht und der Filter
 * in den Elementen.
 */
import React from 'react'
import { Tabs } from '../ui/components'
import { UebersichtView } from './turnen/Uebersicht'
import { ElementeView } from './turnen/Elemente'
import { TrainingView } from './turnen/Training'
import { KuerenView } from './turnen/Kueren'

export function TurnenScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  const tabs = [
    { key: '', label: 'Übersicht' },
    { key: 'elemente', label: 'Elemente' },
    { key: 'training', label: 'Training' },
    { key: 'kueren', label: 'Küren' },
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
    </div>
  )
}
