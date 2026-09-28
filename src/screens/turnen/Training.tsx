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
import { wettkampfKuerJeGeraet } from '../../core/turnen/kueren'
import { fassungsInhalt, planeFassung } from '../../core/turnen/fassungen'
import {
  QUALITAET_LABEL, durchgangText, eingabeAus as durchgangAus, leereEingabe,
  planeDurchgaenge, planIstLeer as durchgangsPlanIstLeer,
  type DurchgangsEingabe, type DurchgangsStand,
} from '../../core/turnen/kuerdurchgaenge'
import { nowIso } from '../../core/dates'
import type {
  GymAttempt, GymElement, GymRoutine, GymRoutineRun, WorkoutSession,
} from '../../core/types'

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

  /* ------------------------------------------------------ Kuerdurchgaenge */

  /** Die Durchgaenge dieser Einheit, die schon gespeichert sind. */
  const vorhandeneDurchgaenge = useMemo(
    () => data.gymRoutineRuns.filter(
      (r) => !r.deleted_at && einheit && r.session_id === einheit.id),
    [data.gymRoutineRuns, einheit],
  )

  /**
   * Die Kuer je Durchgang – ueber die Fassung, nicht ueber die lebende Kuer.
   *
   * Zum Anzeigen genuegt der Name der Fassung; welche lebende Kuer dahinter
   * steht, ist hier ohne Belang und koennte sogar geloescht sein.
   */
  const fassungVon = useMemo(() => {
    const m = new Map<string, { name: string; apparatus: string; routineId: string }>()
    for (const v of data.gymRoutineVersions) {
      if (v.deleted_at) continue
      m.set(v.id, { name: v.name, apparatus: v.apparatus, routineId: v.routine_id })
    }
    return m
  }, [data.gymRoutineVersions])

  /**
   * Durchgaenge im Arbeitsspeicher – wie die Zaehler.
   *
   * `routineId` statt `versionId`: Eingefroren wird erst beim Speichern, damit
   * ein Durchgang die Fassung von genau diesem Moment bekommt und nicht die von
   * dem Moment, in dem das Formular aufging.
   */
  interface DurchgangsZeile {
    /** Ortlicher Schluessel fuer React – keine Datenbank-ID. */
    key: string
    id: string | null
    apparatus: string
    routineId: string | null
    /** Nur bei vorhandenen Zeilen: die Fassung, auf die sie schon zeigt. */
    versionId: string | null
    eingabe: DurchgangsEingabe
  }

  const [durchgaenge, setDurchgaenge] = useState<DurchgangsZeile[]>(() =>
    vorhandeneDurchgaenge
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        || String(a.created_at).localeCompare(String(b.created_at)))
      .map((r, i) => ({
        key: `da-${i}`,
        id: r.id,
        apparatus: fassungVon.get(r.routine_version_id)?.apparatus ?? '',
        routineId: fassungVon.get(r.routine_version_id)?.routineId ?? null,
        versionId: r.routine_version_id,
        eingabe: durchgangAus(r),
      })))

  /** Die aktive Wettkampfkuer je Geraet – der Vorschlag beim Hinzufuegen. */
  const wettkampfKueren = useMemo(
    () => wettkampfKuerJeGeraet(data.gymRoutines), [data.gymRoutines])

  /** Alle Kueren des gewaehlten Geraets – zur Auswahl. */
  const kuerenDesGeraets = useMemo(
    () => data.gymRoutines
      .filter((k) => !k.deleted_at && k.is_active && k.apparatus === geraet)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [data.gymRoutines, geraet],
  )

  const durchgaengeDesGeraets = durchgaenge.filter((d) => !geraet || d.apparatus === geraet)

  const durchgangHinzu = () => {
    if (!geraet) return
    const vorschlag = wettkampfKueren.get(geraet) ?? kuerenDesGeraets[0] ?? null
    setDurchgaenge((liste) => [...liste, {
      key: `neu-${Date.now()}-${liste.length}`,
      id: null,
      apparatus: geraet,
      routineId: vorschlag?.id ?? null,
      versionId: null,
      eingabe: leereEingabe(),
    }])
  }

  const durchgangAendern = (key: string, teil: Partial<DurchgangsZeile>) =>
    setDurchgaenge((liste) => liste.map((d) => (d.key === key ? { ...d, ...teil } : d)))

  const durchgangFeld = (key: string, feld: keyof DurchgangsEingabe, wert: any) =>
    setDurchgaenge((liste) => liste.map(
      (d) => (d.key === key ? { ...d, eingabe: { ...d.eingabe, [feld]: wert } } : d)))

  const durchgangWeg = (key: string) =>
    setDurchgaenge((liste) => liste.filter((d) => d.key !== key))

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

      /* ---------------------------------------------------- Kuerdurchgaenge
         Die Kuer wird JETZT eingefroren, mit derselben Rechnung wie beim
         Wettkampf (fassungen.ts) - keine zweite Versionierung. Ist diese
         Fassung schon da, wird nichts geschrieben und nur ihre ID benutzt.
         Bei einer bereits gespeicherten Zeile bleibt ihre alte Fassung
         stehen: Ein Durchgang von damals darf nicht nachtraeglich zur
         heutigen Kuer gehoeren. */
      const jetzt = nowIso()
      const staende: DurchgangsStand[] = []
      /**
       * Fassungen, die IN DIESEM Stapel schon angelegt wurden.
       *
       * `data.gymRoutineVersions` ist ein Abbild von VOR dem Stapel und kennt
       * sie noch nicht. Ohne diese Liste legte der zweite Durchgang derselben
       * Kuer dieselbe Fassung ein zweites Mal an - und genau daran scheiterte
       * das Speichern mit "UNIQUE constraint failed". Mehrere Durchgaenge
       * derselben Kuer in einer Einheit sind der Normalfall; gefunden hat es
       * `turnen-kuerdurchgaenge-e2e`.
       */
      const frischEingefroren = new Set<string>()
      for (const d of durchgaenge) {
        let versionId = d.versionId
        if (!versionId) {
          const kuer = data.gymRoutines.find((k) => k.id === d.routineId)
          if (!kuer) continue
          const fplan = planeFassung(
            fassungsInhalt(kuer, data.gymRoutineElements, data.gymElements),
            data.gymRoutineVersions, jetzt)
          if (fplan.version && !frischEingefroren.has(fplan.id)) {
            m.create('gym_routine_versions', { id: fplan.version.id, ...fplan.version.values })
            for (const pl of fplan.plaetze) {
              m.create('gym_routine_version_elements', { id: pl.id, ...pl.values })
            }
          }
          frischEingefroren.add(fplan.id)
          versionId = fplan.id
        }
        staende.push({ id: d.id, versionId, eingabe: d.eingabe })
      }

      const dPlan = planeDurchgaenge(staende, vorhandeneDurchgaenge)
      if (!durchgangsPlanIstLeer(dPlan)) {
        for (const a of dPlan.anlegen) {
          m.create('gym_routine_runs', { session_id: sessionId, ...a.values })
        }
        for (const a of dPlan.aendern) m.patch('gym_routine_runs', a.id, a.patch)
        for (const id of dPlan.entfernen) m.removeQuiet('gym_routine_runs', id)
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

      {/* Schritt 3: Kuerdurchgaenge. Eine andere Messgroesse als die Zaehler
          oben - die ganze Uebung am Stueck. Mehrere Durchgaenge in derselben
          Einheit sind der Normalfall. */}
      {geraet && (
        <Field label="Kürdurchgänge"
          hint="Die ganze Kür am Stück – auch ein Abbruch ist ein Durchgang.">
          {kuerenDesGeraets.length === 0 ? (
            <div className="hint-box small">
              Für {geraetName(geraet)} ist noch keine Kür angelegt. Ein Durchgang
              braucht eine Kür, damit er sich auf deren Fassung beziehen kann.
            </div>
          ) : (
            <>
              {durchgaengeDesGeraets.map((d, i) => (
                <DurchgangZeile key={d.key} nummer={i + 1} zeile={d}
                  kueren={kuerenDesGeraets}
                  fassungName={d.versionId ? fassungVon.get(d.versionId)?.name ?? null : null}
                  onKuer={(routineId) => durchgangAendern(d.key, { routineId })}
                  onFeld={(feld, wert) => durchgangFeld(d.key, feld, wert)}
                  onWeg={() => durchgangWeg(d.key)} />
              ))}
              <button type="button" className="btn btn-sm mt8" onClick={durchgangHinzu}>
                + Durchgang
              </button>
            </>
          )}
        </Field>
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
        message="Die Einheit, die darin festgehaltenen Versuche und ihre Kürdurchgänge wandern in den Papierkorb. Die eingefrorenen Kürfassungen bleiben erhalten – sie gehören zur Geschichte."
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => {
          m.batch(() => {
            for (const v of vorhandeneVersuche) m.removeQuiet('gym_attempts', v.id)
            // Die Durchgaenge gehoeren zu dieser Einheit und zu keiner anderen -
            // dasselbe Muster wie bei den Versuchen. Die eingefrorenen
            // Kuerfassungen bleiben: Sie gehoeren zur Geschichte, nicht zu
            // diesem einen Training.
            for (const r of vorhandeneDurchgaenge) m.removeQuiet('gym_routine_runs', r.id)
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

/**
 * Ein Kürdurchgang in der Erfassung.
 *
 * Die Reihenfolge der Angaben ist die Reihenfolge, in der man sie nach einem
 * Durchgang weiss: **durchgekommen?** zuerst, dann Stürze, dann Absetzen, dann
 * Hilfe. Die Qualität steht zuletzt und darf leer bleiben – sie geht in keine
 * Rechnung ein.
 *
 * „Komplett" ist vorbelegt, weil der Normalfall das Durchkommen ist. Ein
 * Abbruch ist damit ein Tipp, kein Formular.
 */
function DurchgangZeile({ nummer, zeile, kueren, fassungName, onKuer, onFeld, onWeg }: {
  nummer: number
  zeile: {
    key: string
    id: string | null
    routineId: string | null
    versionId: string | null
    eingabe: DurchgangsEingabe
  }
  kueren: GymRoutine[]
  /** Bei einer schon gespeicherten Zeile: der Name ihrer Fassung. */
  fassungName: string | null
  onKuer: (routineId: string) => void
  onFeld: (feld: keyof DurchgangsEingabe, wert: any) => void
  onWeg: () => void
}) {
  const e = zeile.eingabe

  return (
    <div className="turn-durchgang">
      <div className="turn-durchgang-kopf">
        <span className="turn-durchgang-nr">{nummer}.</span>
        {zeile.versionId ? (
          // Eine gespeicherte Zeile behaelt ihre Fassung. Die Kuer hier noch
          // umzustellen hiesse, die Geschichte umzuschreiben.
          <span className="turn-durchgang-kuer">
            {fassungName ?? 'Kür'}
            <span className="muted small"> · Fassung bleibt</span>
          </span>
        ) : (
          <select className="input turn-durchgang-wahl" value={zeile.routineId ?? ''}
            onChange={(ev) => onKuer(ev.target.value)}>
            {kueren.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onWeg}
          aria-label={`Durchgang ${nummer} entfernen`}>entfernen</button>
      </div>

      <div className="turn-durchgang-felder">
        <button type="button"
          className={`turn-durchgang-schalter${e.completed ? ' aktiv' : ''}`}
          onClick={() => onFeld('completed', !e.completed)}>
          {e.completed ? 'komplett' : 'abgebrochen'}
        </button>

        <Zaehlfeld label="Stürze" wert={e.falls}
          onAendern={(n) => onFeld('falls', n)} />
        <Zaehlfeld label="Unterbrechungen" wert={e.interruptions}
          onAendern={(n) => onFeld('interruptions', n)} />

        <button type="button"
          className={`turn-durchgang-schalter${e.withHelp ? ' aktiv' : ''}`}
          onClick={() => onFeld('withHelp', !e.withHelp)}>
          {e.withHelp ? 'mit Hilfe' : 'ohne Hilfe'}
        </button>
      </div>

      <div className="turn-durchgang-qualitaet">
        <span className="turn-durchgang-label">Eindruck</span>
        {(Object.keys(QUALITAET_LABEL) as (keyof typeof QUALITAET_LABEL)[]).map((q) => (
          <button key={q} type="button"
            className={`btn btn-sm${e.quality === q ? ' btn-primary' : ''}`}
            onClick={() => onFeld('quality', e.quality === q ? null : q)}>
            {QUALITAET_LABEL[q]}
          </button>
        ))}
      </div>

      <input className="input turn-durchgang-notiz" value={e.note ?? ''}
        onChange={(ev) => onFeld('note', ev.target.value)}
        placeholder="Notiz, freiwillig – z. B. Abgang zu kurz" />
    </div>
  )
}

/**
 * Ein kleines Zählfeld mit Plus und Minus.
 *
 * Bewusst keine Tastatureingabe: Stürze und Unterbrechungen sind einstellige
 * Zahlen, und ein Zahlenfeld öffnete am Handy die Tastatur über den halben
 * Bildschirm.
 */
function Zaehlfeld({ label, wert, onAendern }: {
  label: string
  wert: number
  onAendern: (n: number) => void
}) {
  return (
    <div className="turn-zaehlfeld">
      <span className="turn-durchgang-label">{label}</span>
      <div className="turn-zaehlfeld-knoepfe">
        <button type="button" className="btn btn-sm" onClick={() => onAendern(Math.max(0, wert - 1))}
          aria-label={`${label} weniger`}>−</button>
        <span className="turn-zaehlfeld-wert">{wert}</span>
        <button type="button" className="btn btn-sm" onClick={() => onAendern(wert + 1)}
          aria-label={`${label} mehr`}>+</button>
      </div>
    </div>
  )
}
