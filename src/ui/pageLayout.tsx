/**
 * Frei anpassbare Seiten – der React-Teil.
 *
 * Eine Seite meldet ihre Karten an (usePageLayout), bekommt dafür die fertig
 * sortierte/gefilterte Liste zurück und bindet den "Anpassen"-Knopf plus die
 * Bearbeitungsleiste ein. Die eigentliche Verschmelzungslogik steckt in
 * core/layout.ts und ist dort für sich getestet – hier geht es nur noch
 * darum, sie an den Einstellungen-Speicher zu hängen.
 *
 * Bewusst ohne Drag & Drop: Auf dem Handy sind Auf/Ab-Knöpfe zuverlässiger
 * zu treffen als etwas zu ziehen, und die App hat dafür keine Bibliothek.
 */
import React, { useState } from 'react'
import { useData, useMutations } from '../state/store'
import {
  resolveLayout, toggleCardVisible, moveCard,
  type LayoutCardDef, type ResolvedLayoutCard,
} from '../core/layout'

export function usePageLayout(pageId: string, defs: LayoutCardDef[]) {
  const data = useData()
  const m = useMutations()
  const [editMode, setEditMode] = useState(false)

  const allPrefs = data.settings.layout_prefs ?? {}
  const pref = allPrefs[pageId] ?? null
  const allCards = resolveLayout(defs, pref)
  const visibleCards = allCards.filter((c) => c.visible)

  const save = (next: ReturnType<typeof toggleCardVisible>) => {
    m.setSetting('layout_prefs', { ...allPrefs, [pageId]: next })
  }

  return {
    editMode,
    setEditMode,
    /** Alle Karten, auch ausgeblendete – für die Bearbeitungsleiste. */
    allCards,
    /** Nur die sichtbaren, in Anzeigereihenfolge – zum Rendern der Seite. */
    visibleCards,
    toggleVisible: (id: string) => save(toggleCardVisible(defs, pref, id)),
    moveUp: (id: string) => save(moveCard(defs, pref, id, -1)),
    moveDown: (id: string) => save(moveCard(defs, pref, id, 1)),
    /** Zurück auf die Standardanordnung dieser Seite. */
    resetLayout: () => {
      const { [pageId]: _entfernt, ...rest } = allPrefs
      m.setSetting('layout_prefs', rest)
    },
  }
}

export function LayoutEditToggle({ editMode, onToggle }: { editMode: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-ghost'}`}
      onClick={onToggle} title="Karten ein-/ausblenden und ordnen">
      ✏️ Anpassen
    </button>
  )
}

export function LayoutEditPanel({ cards, onToggleVisible, onMoveUp, onMoveDown, onReset }: {
  cards: ResolvedLayoutCard[]
  onToggleVisible: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  onReset: () => void
}) {
  return (
    <div className="card mb16">
      <div className="card-head">
        <div>
          <h3 className="card-title">Ansicht anpassen</h3>
          <div className="card-sub">Häkchen blendet ein/aus, Pfeile ändern die Reihenfolge</div>
        </div>
        <div className="card-action">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>Zurücksetzen</button>
        </div>
      </div>
      <div className="list">
        {cards.map((c, i) => (
          <div key={c.id} className="list-row">
            <label className="row" style={{ gap: 9, flex: 1, cursor: 'pointer' }}>
              <input type="checkbox" checked={c.visible} onChange={() => onToggleVisible(c.id)} />
              <span className={c.visible ? '' : 'muted'}>{c.title}</span>
            </label>
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0}
                onClick={() => onMoveUp(c.id)} aria-label={`${c.title} nach oben verschieben`}>↑</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={i === cards.length - 1}
                onClick={() => onMoveDown(c.id)} aria-label={`${c.title} nach unten verschieben`}>↓</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
