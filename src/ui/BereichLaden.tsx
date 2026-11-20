/**
 * Lädt einen Bereich der App erst, wenn er gebraucht wird.
 *
 * Turnen und Einstellungen sind groß und werden nicht bei jedem Start
 * gebraucht. Sie liegen deshalb in eigenen Dateien (`React.lazy`), und der
 * Start lädt nur noch, was „Heute" sofort braucht.
 *
 * Zwei Dinge können dabei schiefgehen, und beide dürfen die App nicht
 * weiß werden lassen:
 *   1. Der Bereich ist noch nicht da (kurzer Moment, schlechtes Netz)
 *      → ein ruhiger Platzhalter statt eines leeren Bildschirms.
 *   2. Die Datei lässt sich nicht holen (offline, und der Bereich wurde noch
 *      nie geöffnet; oder eine alte Seite kennt Dateinamen, die es nach einer
 *      Veröffentlichung nicht mehr gibt)
 *      → eine verständliche Meldung mit „Neu laden" statt eines Absturzes.
 *      Die eigenen Daten sind davon nicht berührt: Sie liegen in der lokalen
 *      Datenbank und nicht in diesen Dateien.
 */
import React, { Suspense } from 'react'

function Platzhalter() {
  return (
    <div className="card" role="status" aria-live="polite" style={{ margin: '24px 0' }}>
      <p className="muted" style={{ margin: 0 }}>Lädt …</p>
    </div>
  )
}

interface Zustand { fehler: boolean }

class Auffangnetz extends React.Component<{ children: React.ReactNode; bereich: string }, Zustand> {
  state: Zustand = { fehler: false }

  static getDerivedStateFromError(): Zustand {
    return { fehler: true }
  }

  componentDidUpdate(vorher: { bereich: string }) {
    // Wer zu einem anderen Bereich wechselt, bekommt einen neuen Versuch.
    if (vorher.bereich !== this.props.bereich && this.state.fehler) this.setState({ fehler: false })
  }

  render() {
    if (!this.state.fehler) return this.props.children
    return (
      <div className="card" role="alert" style={{ margin: '24px 0' }}>
        <h3 style={{ marginTop: 0 }}>Dieser Bereich konnte nicht geladen werden</h3>
        <p className="muted">
          Vermutlich fehlt gerade die Verbindung, oder die App wurde inzwischen aktualisiert.
          Deine Daten sind nicht betroffen – sie liegen auf diesem Gerät.
        </p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Neu laden</button>
      </div>
    )
  }
}

/** Umhüllt einen lazy geladenen Bereich mit Platzhalter und Auffangnetz. */
export function BereichLaden({ bereich, children }: { bereich: string; children: React.ReactNode }) {
  return (
    <Auffangnetz bereich={bereich}>
      <Suspense fallback={<Platzhalter />}>{children}</Suspense>
    </Auffangnetz>
  )
}
