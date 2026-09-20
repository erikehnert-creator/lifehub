/**
 * TURNEN · TRAINING – erfassen, während man in der Halle steht.
 *
 * ---------------------------------------------------------------------------
 * Warum dieser Bildschirm anders gebaut ist als der Rest
 *
 * In LifeHub liegt bereits ein vollständig entworfenes Trainingsdatenmodell,
 * das nie benutzt wurde: `exercises`, `workout_plan_exercises`, `workout_sets`
 * werden angelegt, geladen und synchronisiert – und von keinem Bildschirm
 * gelesen. Es ist nicht am Modell gescheitert, sondern daran, dass das
 * Erfassen zu aufwendig war.
 *
 * Deshalb gilt hier eine andere Messlatte als anderswo: **Zwischen zwei
 * Durchgängen muss ein Versuch mit einem Daumen festzuhalten sein.** Kein
 * Dialog je Element, kein Formular, kein Zwischenspeichern. Gerät antippen,
 * Zähler tippen, fertig.
 *
 * Daraus folgen drei Entscheidungen, die anderswo falsch wären:
 *
 *   - Die Zähler sind ungewöhnlich grosse Flächen (56 px hoch). Ein
 *     Zählerknopf in normaler Knopfgrösse trifft man mit chalkigen Fingern
 *     nicht.
 *   - Gezählt wird im Arbeitsspeicher; geschrieben wird EINMAL beim
 *     Speichern, als ein Stapel. Jeder Tipp einzeln in die Datenbank hiesse
 *     bei sechzig Versuchen sechzig Neuladungen des Datenbildes.
 *   - Eine Einheit ohne einen einzigen Versuch ist ausdrücklich gültig.
 *     „Boden, 45 min" ist ein vollständiger Eintrag und wird nirgends als
 *     Lücke angemahnt.
 */
import React, { useMemo, useState } from 'react'
import { Card, Modal, Field, Empty, Confirm, DurationInput } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { todayString, formatDay, formatDuration } from '../../core/dates'
import { GERAETE, geraetName, type GeraetKey } from '../../core/turnen/geraete'
import { GUETEN, planeVersuche, planIstLeer, versucheGesamt, type ZaehlerStand } from '../../core/turnen/versuche'
import { statusLabel } from '../../core/turnen/status'
import { geraeteDerEinheit, geraeteJeEinheit } from '../../core/turnen/elemente'
import type { GymAttempt, GymElement, WorkoutSession } from '../../core/types'

export function TrainingView({ onZuElementen }: { onZuElementen: () => void }) {
  const data = useData()
  const [offen, setOffen] = useState<WorkoutSession | 'neu' | null>(null)

  const einheiten = useMemo(
    () => data.workoutSessions
      .filter((s) => !s.deleted_at && s.discipline === 'turnen')
      .sort((a, b) => (a.day < b.day ? 1 : -1)),
    [data.workoutSessions],
  )

  const versucheJeEinheit = useMemo(() => {
    const m = new Map<string, GymAttempt[]>()
    for (const v of data.gymAttempts) {
      if (v.deleted_at) continue
      const liste = m.get(v.session_id)
      if (liste) liste.push(v)
      else m.set(v.session_id, [v])
    }
    return m
  }, [data.gymAttempts])

  /**
   * Je Einheit die benutzten Geräte – in einem Durchgang.
   *
   * Eine Einheit kann über mehrere Geräte gehen; die Liste nennt sie alle.
   * Je Zeile einzeln zu rechnen wäre bei zweihundert Einheiten zweihundert
   * Durchläufe über alle Versuche.
   */
  const geraeteJeSitzung = useMemo(
    () => geraeteJeEinheit(data.gymAttempts, data.gymElements),
    [data.gymAttempts, data.gymElements],
  )

  const hatElemente = data.gymElements.some((e) => !e.deleted_at && e.is_active)

  return (
    <>
      <div className="page-actions mb16">
        <button className="btn btn-primary btn-lg" onClick={() => setOffen('neu')}>
          + Training erfassen
        </button>
      </div>

      {!hatElemente && (
        <div className="hint-box small mb16">
          Es sind noch keine Elemente angelegt. Eine Einheit lässt sich trotzdem
          festhalten – „Boden, 45 min" ist ein vollständiger Eintrag.
          {' '}<button className="btn btn-sm btn-ghost" onClick={onZuElementen}>Elemente anlegen</button>
        </div>
      )}

      {einheiten.length === 0 ? (
        <Empty title="Noch kein Turntraining erfasst"
          hint="Nach dem Training kurz festhalten, was am Gerät war – das ist die Grundlage für alles Weitere." />
      ) : (
        <Card className="pad0" title={`${einheiten.length} Einheiten`}>
          <div className="list">
            {einheiten.slice(0, 40).map((s) => {
              const versuche = versucheJeEinheit.get(s.id) ?? []
              const gesamt = versuche.reduce((n, v) => n + versucheGesamt(v), 0)
              const geraete = GERAETE
                .filter((g) => geraeteJeSitzung.get(s.id)?.has(g.key))
                .map((g) => g.name)
              return (
                <button className="list-row" key={s.id} onClick={() => setOffen(s)}>
                  <span className="list-main">
                    <span className="list-title">{formatDay(s.day)}</span>
                    <span className="list-sub">
                      {geraete.length ? geraete.join(' · ') : s.title || 'ohne Gerät'}
                      {s.duration_minutes ? ` · ${formatDuration(s.duration_minutes)}` : ''}
                      {gesamt > 0 ? ` · ${gesamt} Versuche` : ''}
                    </span>
                  </span>
                  <span className="muted" aria-hidden="true">›</span>
                </button>
              )
            })}
          </div>
        </Card>
      )}

      {offen && (
        <EinheitEditor
          einheit={offen === 'neu' ? null : offen}
          onClose={() => setOffen(null)} />
      )}
    </>
  )
}

/* ------------------------------------------------------ Der Erfassungsweg */

function EinheitEditor({ einheit, onClose }: { einheit: WorkoutSession | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()

  const vorhandeneVersuche = useMemo(
    () => (einheit ? data.gymAttempts.filter((v) => !v.deleted_at && v.session_id === einheit.id) : []),
    [data.gymAttempts, einheit],
  )

  /**
   * Das gerade ANGEZEIGTE Geraet.
   *
   * Es ist ein Umschalter, kein Merkmal der Einheit: Ein Turntraining geht
   * ueber Boden, Barren und Reck, und alle drei gehoeren derselben Sitzung.
   * Welche Geraete tatsaechlich vorkamen, steht nirgends gespeichert - es
   * ergibt sich aus den Versuchen ueber `gym_elements.apparatus`
   * (core/turnen/elemente.ts, geraeteDerEinheit).
   *
   * Beim Bearbeiten wird mit dem ersten benutzten Geraet begonnen, damit man
   * sieht, was schon dasteht.
   */
  const geraetAusVersuchen = useMemo(() => {
    const benutzt = geraeteDerEinheit(einheit?.id ?? '', vorhandeneVersuche, data.gymElements)
    return (benutzt[0] as GeraetKey) ?? null
  }, [einheit, vorhandeneVersuche, data.gymElements])

  const [geraet, setGeraet] = useState<GeraetKey | null>(geraetAusVersuchen)
  const [day, setDay] = useState(einheit?.day ?? todayString())
  const [dauer, setDauer] = useState<number | null>(einheit?.duration_minutes ?? null)
  const [notiz, setNotiz] = useState(einheit?.note ?? '')
  const [loeschen, setLoeschen] = useState(false)

  /** Zählerstände im Arbeitsspeicher – geschrieben wird erst beim Speichern. */
  const [stand, setStand] = useState<Record<string, ZaehlerStand>>(() => {
    const out: Record<string, ZaehlerStand> = {}
    for (const v of vorhandeneVersuche) {
      out[v.element_id] = {
        elementId: v.element_id,
        clean: v.clean ?? 0, shaky: v.shaky ?? 0, failed: v.failed ?? 0,
        withHelp: !!v.with_help, note: v.note,
      }
    }
    return out
  })

  const elemente = useMemo(
    () => data.gymElements
      .filter((e) => !e.deleted_at && e.is_active && (!geraet || e.apparatus === geraet))
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
    [data.gymElements, geraet],
  )

  const hole = (id: string): ZaehlerStand =>
    stand[id] ?? { elementId: id, clean: 0, shaky: 0, failed: 0, withHelp: false }

  const zaehle = (id: string, feld: 'clean' | 'shaky' | 'failed', delta: 1 | -1) => {
    setStand((s) => {
      const alt = s[id] ?? { elementId: id, clean: 0, shaky: 0, failed: 0, withHelp: false }
      return { ...s, [id]: { ...alt, [feld]: Math.max(0, alt[feld] + delta) } }
    })
  }

  const hilfeUm = (id: string) => {
    setStand((s) => {
      const alt = s[id] ?? { elementId: id, clean: 0, shaky: 0, failed: 0, withHelp: false }
      return { ...s, [id]: { ...alt, withHelp: !alt.withHelp } }
    })
  }

  const gesamt = Object.values(stand).reduce((n, s) => n + s.clean + s.shaky + s.failed, 0)

  /**
   * Welche Geräte in dieser Einheit schon Versuche haben – aus dem
   * Zählerstand, nicht aus der Datenbank. So ist die Markierung sofort da,
   * noch bevor gespeichert wurde.
   */
  const benutzteGeraete = useMemo(() => {
    const geraetVon = new Map(data.gymElements.map((e) => [e.id, e.apparatus]))
    const zaehler = new Map<string, number>()
    for (const st of Object.values(stand)) {
      const n = st.clean + st.shaky + st.failed
      if (n === 0) continue
      const g = geraetVon.get(st.elementId)
      if (!g) continue
      zaehler.set(g, (zaehler.get(g) ?? 0) + n)
    }
    return zaehler
  }, [stand, data.gymElements])

  /**
   * Alles in EINEM Stapel: eine Datenbanktransaktion, ein Nachladen am Ende.
   * Einzeln geschrieben wären das bei zwölf Elementen dreizehn vollständige
   * Neuladungen des Datenbildes.
   */
  const speichern = () => {
    // Der Titel nennt ALLE Geraete der Einheit, nicht das gerade angezeigte.
    // Sonst hiesse ein Training ueber Boden, Barren und Reck "Reck", nur weil
    // dort zuletzt gezaehlt wurde.
    const benutzt = GERAETE.filter((g) => benutzteGeraete.has(g.key)).map((g) => g.name)
    const titel = benutzt.length
      ? benutzt.join(' · ')
      : geraet ? geraetName(geraet) : 'Turnen'
    m.batch(() => {
      const sessionId = einheit
        ? (m.patch('workout_sessions', einheit.id, {
            day, duration_minutes: dauer, note: notiz.trim() || null, title: titel,
          }), einheit.id)
        : m.create('workout_sessions', {
            day, plan_day_id: null, title: titel, type: null,
            started_at: null, ended_at: null, duration_minutes: dauer,
            status: 'completed', perceived_effort: null,
            note: notiz.trim() || null, discipline: 'turnen',
          })

      const plan = planeVersuche(sessionId, Object.values(stand), vorhandeneVersuche)
      if (!planIstLeer(plan)) {
        for (const a of plan.anlegen) m.create('gym_attempts', { id: a.id, ...a.values })
        for (const a of plan.aendern) m.patch('gym_attempts', a.id, a.patch)
        for (const id of plan.entfernen) m.removeQuiet('gym_attempts', id)
      }
    })
    m.toast(gesamt > 0 ? `Training gespeichert · ${gesamt} Versuche` : 'Training gespeichert')
    onClose()
  }

  return (
    <Modal open wide title={einheit ? 'Training bearbeiten' : 'Training erfassen'} onClose={onClose}
      footer={<>
        {einheit && <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={speichern}>Speichern</button>
      </>}>

      {/* Schritt 1: Gerät. Ein Umschalter – zwischen den Geräten lässt sich
          beliebig wechseln, alles gehört derselben Einheit. */}
      <Field label="Gerät" hint="Zum Wechseln antippen – alle Geräte gehören derselben Einheit.">
        <div className="turn-geraete">
          {GERAETE.map((g) => {
            const n = benutzteGeraete.get(g.key) ?? 0
            return (
              <button key={g.key} type="button"
                className={`turn-geraet${geraet === g.key ? ' aktiv' : ''}${n > 0 ? ' benutzt' : ''}`}
                onClick={() => setGeraet(g.key)}
                aria-label={`${g.name}${n > 0 ? `, ${n} Versuche` : ''}`}>
                <span className="turn-geraet-kurz">{g.kurz}</span>
                <span className="turn-geraet-name">{g.name}</span>
                {n > 0 && <span className="turn-geraet-marke">{n}</span>}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="grid grid-2 keep2">
        <Field label="Tag">
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Dauer">
          <DurationInput minutes={dauer} onChange={setDauer} />
        </Field>
      </div>

      {/* Schritt 2: Zählen. Nur wenn ein Gerät gewählt ist – sonst stünde hier
          die ganze Elementliste und der Bildschirm wäre wieder ein Formular. */}
      {!geraet ? (
        <div className="hint-box small">
          Gerät antippen, um dessen Elemente zu zählen. Du kannst jederzeit
          wechseln – Gezähltes bleibt erhalten. Ohne jedes Gerät wird nur die
          Einheit festgehalten, und das ist ausdrücklich in Ordnung.
        </div>
      ) : elemente.length === 0 ? (
        <Empty kompakt title={`Für ${geraetName(geraet)} sind noch keine Elemente angelegt.`}
          hint="Die Einheit lässt sich trotzdem speichern." />
      ) : (
        <div className="turn-zaehler-liste">
          {elemente.map((el) => (
            <ElementZeile key={el.id} element={el} stand={hole(el.id)}
              onZaehle={(feld, d) => zaehle(el.id, feld, d)}
              onHilfe={() => hilfeUm(el.id)} />
          ))}
        </div>
      )}

      <Field label="Notiz" hint="freiwillig">
        <textarea className="textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)}
          placeholder="z. B. Schulter zwickt, Abgang wieder sicher" />
      </Field>

      {gesamt > 0 && (
        <div className="small muted">
          {gesamt} Versuche an{' '}
          {Object.values(stand).filter((s) => s.clean + s.shaky + s.failed > 0).length} Elementen
          {benutzteGeraete.size > 1 && (
            <> · {GERAETE.filter((g) => benutzteGeraete.has(g.key)).map((g) => g.name).join(', ')}</>
          )}
        </div>
      )}

      <Confirm open={loeschen} title="Training löschen?"
        message="Die Einheit und die darin festgehaltenen Versuche wandern in den Papierkorb."
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => {
          m.batch(() => {
            for (const v of vorhandeneVersuche) m.removeQuiet('gym_attempts', v.id)
            m.remove('workout_sessions', einheit!.id, 'Training gelöscht')
          })
          setLoeschen(false)
          onClose()
        }} />
    </Modal>
  )
}

/**
 * Eine Elementzeile mit drei Zählern.
 *
 * Die Flächen sind bewusst gross: Wer zwischen zwei Durchgängen mit
 * Magnesium an den Fingern tippt, trifft keinen Knopf in normaler Grösse.
 * Das Zurückzählen steht klein daneben, weil es der seltene Fall ist.
 */
function ElementZeile({ element, stand, onZaehle, onHilfe }: {
  element: GymElement
  stand: ZaehlerStand
  onZaehle: (feld: 'clean' | 'shaky' | 'failed', delta: 1 | -1) => void
  onHilfe: () => void
}) {
  const gesamt = stand.clean + stand.shaky + stand.failed
  return (
    <div className={`turn-zeile${gesamt > 0 ? ' hat-versuche' : ''}`}>
      <div className="turn-zeile-kopf">
        <span className="turn-zeile-name">
          {element.name}
          {element.difficulty_letter && <span className="turn-wert">{element.difficulty_letter}</span>}
        </span>
        <span className="turn-zeile-status small muted">{statusLabel(element.status)}</span>
      </div>

      <div className="turn-zaehler">
        {GUETEN.map((g) => {
          const wert = stand[g.key]
          return (
            <button key={g.key} type="button"
              className={`turn-zaehler-knopf ton-${g.ton}${wert > 0 ? ' gesetzt' : ''}`}
              onClick={() => onZaehle(g.key, 1)}
              aria-label={`${element.name}: ${g.label} plus eins`}>
              <span className="turn-zaehler-zahl">{wert}</span>
              <span className="turn-zaehler-name">{g.kurz}</span>
            </button>
          )
        })}
      </div>

      {gesamt > 0 && (
        <div className="turn-zeile-fuss">
          <button type="button" className={`chip sm${stand.withHelp ? ' active' : ''}`} onClick={onHilfe}>
            mit Hilfe
          </button>
          <span style={{ flex: 1 }} />
          {GUETEN.map((g) => (
            stand[g.key] > 0 ? (
              <button key={g.key} type="button" className="btn btn-sm btn-ghost"
                onClick={() => onZaehle(g.key, -1)}
                aria-label={`${element.name}: ${g.label} minus eins`}>
                −{g.kurz}
              </button>
            ) : null
          ))}
        </div>
      )}
    </div>
  )
}
