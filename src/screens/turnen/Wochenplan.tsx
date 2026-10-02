/**
 * TURNEN · KOMMENDE EINHEITEN – die Inhalte auf die Trainingstage verteilen.
 *
 * ---------------------------------------------------------------------------
 * Woher die Trainingstage kommen
 *
 * Aus `workout_sessions` mit `status = 'planned'` und `discipline = 'turnen'` –
 * **derselben Tabelle**, in der auch die absolvierten Einheiten stehen. Es gibt
 * damit keinen zweiten Kalender, keine Wochentagsliste im Quelltext und kein
 * eigenes Terminmodell: Ein hier angelegter Turntermin erscheint von selbst in
 * `Tracking` unter „Geplant" und in der Heute-Karte.
 *
 * Dass es dafür eine kleine Anlegemöglichkeit braucht, hat einen Grund: In
 * LifeHub markiert **nichts** zuverlässig, dass ein Termin ein Turntraining ist.
 * `workout_plan_days` kennt keine Disziplin, Tagesarten unterscheiden Arbeit von
 * frei, und Kalendereinträge und Aufgaben sind freier Text. Ein Titel zu raten
 * wäre schlechter als zu fragen.
 *
 * ---------------------------------------------------------------------------
 * Tagesart und freie Zeit sind Kontext
 *
 * Beides kommt aus dem vorhandenen `computeCapacity()` und wird nur
 * **angezeigt**. Die Verteilung hängt nicht daran – wer keinen Arbeitsplan
 * pflegt, bekommt denselben Vorschlag. Und es wird nirgends behauptet, eine
 * Schicht mache ein Gerät ungeeignet; dazu stehen in LifeHub keine Daten.
 *
 * ---------------------------------------------------------------------------
 * Geplant ist nicht durchgeführt
 *
 * Ein Termin wird erst absolviert, wenn im Reiter **Training** etwas erfasst
 * wird – dann setzt der vorhandene Erfassungsweg `status` auf `completed`. Ein
 * vergangener Termin ohne Erfassung bleibt offen und steht als überfällig da.
 *
 * Die Verteilung selbst wird **nicht gespeichert**: Nach dem ersten absolvierten
 * Training ändert sich der Trainingsfokus, und der Rest der Woche muss sich
 * ändern dürfen.
 */
import React, { useMemo, useState } from 'react'
import { Confirm, Field, Modal } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import {
  addDays, diffDays, formatDay, formatDuration, todayString, weekdayLong,
} from '../../core/dates'
import { computeCapacity } from '../../core/planner'
import { geplanteTurntermine } from '../../core/turnen/einheiten'
import {
  INHALT_ART_LABEL, ROLLE_LABEL, UMFANG_LABEL,
  type PlanungsBild,
} from '../../core/turnen/trainingsplanung'
import {
  KAPAZITAET_LABEL, OFFEN_TEXT, WOCHEN_SCHWELLEN, einheitenLabel,
  wocheMitAuswahl, wochenplanung,
  type EinheitGeraet, type GeplanteEinheit, type OffenerPosten, type TerminEingang,
} from '../../core/turnen/wochenplanung'

export function WochenAnsicht({ plan, onZuTraining }: {
  plan: PlanungsBild
  onZuTraining: () => void
}) {
  const data = useData()
  const m = useMutations()
  const heute = todayString()

  const [verschoben, setVerschoben] = useState<Record<string, string>>({})
  const [ohne, setOhne] = useState<string[]>([])
  const [neu, setNeu] = useState(false)
  const [loeschen, setLoeschen] = useState<string | null>(null)

  /**
   * Die geplanten Turneinheiten.
   *
   * Nur `status: 'planned'`: Eine absolvierte Einheit ist kein Termin mehr,
   * und eine ausgefallene soll die Planung nicht belegen.
   */
  const termine: TerminEingang[] = useMemo(() => {
    const sitzungen = geplanteTurntermine(data.workoutSessions)
    return sitzungen.map((s) => {
      // Tagesart und freie Zeit ueber die vorhandene Tagesrechnung - nicht
      // ueber eine zweite Kapazitaetslogik im Turnen-Modul.
      const zuordnung = data.dayAssignments.find((a) => !a.deleted_at && a.day === s.day) ?? null
      const tagesart = zuordnung
        ? data.dayTypes.find((t) => t.id === zuordnung.day_type_id) ?? null
        : null
      const kapazitaet = computeCapacity(
        s.day, zuordnung, tagesart, data.timeBlocks, data.tasks, data.events,
        data.settings.sleep_hours ?? 8)
      return {
        sessionId: s.id,
        day: s.day,
        titel: s.title || null,
        dauerMinuten: s.duration_minutes ?? null,
        tagesart: tagesart?.name ?? null,
        freieMinuten: kapazitaet.freeMinutes,
      }
    })
  }, [
    data.workoutSessions, data.dayAssignments, data.dayTypes,
    data.timeBlocks, data.tasks, data.events, data.settings,
  ])

  const bild = useMemo(
    () => wochenplanung({ plan, termine, heute, tagDifferenz: diffDays }),
    [plan, termine, heute],
  )

  const woche = useMemo(
    () => wocheMitAuswahl(bild, { verschoben, ohne }),
    [bild, verschoben, ohne],
  )

  const geaendert = Object.keys(verschoben).length > 0 || ohne.length > 0
  const zurueck = () => {
    setVerschoben({})
    setOhne([])
  }

  const verschiebe = (apparatus: string, sessionId: string) =>
    setVerschoben({ ...verschoben, [apparatus]: sessionId })

  return (
    <>
      <div className="row mb8">
        <span className="muted small">
          {woche.keineTermine
            ? `Zeitraum: die kommenden ${woche.horizontTage} Tage`
            : `${einheitenLabel(woche.einheiten.length)} · die kommenden ${woche.horizontTage} Tage`}
        </span>
        <span style={{ flex: 1 }} />
        {geaendert && (
          <button className="btn btn-sm btn-ghost" onClick={zurueck}>zurücksetzen</button>
        )}
        <button className="btn btn-sm" onClick={() => setNeu(true)}>+ Turntermin</button>
      </div>

      {woche.ueberfaellig.length > 0 && (
        <div className="hint-box small mb8">
          {woche.ueberfaellig.length === 1
            ? `Der Turntermin am ${formatDay(woche.ueberfaellig[0].day)} ist vorbei, ohne dass ein Training erfasst wurde.`
            : `${woche.ueberfaellig.length} vergangene Turntermine sind offen – dort wurde kein Training erfasst.`}
          {' '}Geplant ist nicht durchgeführt.
        </div>
      )}

      {woche.keineTermine ? (
        <div className="muted small">
          Für die nächsten {woche.horizontTage} Tage ist noch kein Turntraining
          geplant. Der Vorschlag für die nächste Einheit steht unter
          {' '}<strong>Nächste Einheit</strong> – er gilt, sobald du turnst.
        </div>
      ) : (
        <div className="wp-liste">
          {woche.einheiten.map((u) => (
            <WochenEinheit key={u.sessionId} u={u}
              andere={woche.einheiten.filter((x) => x.sessionId !== u.sessionId)}
              onWeg={(apparatus) => setOhne([...ohne, apparatus])}
              onVerschieben={verschiebe}
              onTerminWeg={() => setLoeschen(u.sessionId)} />
          ))}
        </div>
      )}

      {woche.offen.length > 0 && (
        <OffenerBereich posten={woche.offen} einheiten={woche.einheiten}
          onVerschieben={verschiebe} />
      )}

      <div className="row mt8">
        <button className="btn btn-sm btn-primary" onClick={onZuTraining}>
          Training erfassen
        </button>
      </div>

      {neu && <TerminAnlegen heute={heute} onClose={() => setNeu(false)} />}

      <Confirm open={!!loeschen} title="Turntermin löschen?"
        message="Der geplante Termin wandert in den Papierkorb. Erfasste Trainings sind davon nicht betroffen."
        danger onCancel={() => setLoeschen(null)}
        onConfirm={() => {
          // Nur geplante Termine - eine absolvierte Einheit wird hier nie
          // angefasst. Sie taucht in dieser Liste auch nicht auf.
          m.remove('workout_sessions', loeschen!, 'Turntermin gelöscht')
          setLoeschen(null)
        }} />
    </>
  )
}

/* ==================================================== Eine Einheit */

/**
 * Ein Trainingstag mit seinen Geräten.
 *
 * Die Kopfzeile nennt Wochentag, Datum und – falls hinterlegt – Tagesart und
 * Dauer. Beides ist Auskunft, keine Bedingung: Ohne Tagesart steht dort nichts,
 * und die Verteilung ist dieselbe.
 */
function WochenEinheit({ u, andere, onWeg, onVerschieben, onTerminWeg }: {
  u: GeplanteEinheit
  andere: GeplanteEinheit[]
  onWeg: (apparatus: string) => void
  onVerschieben: (apparatus: string, sessionId: string) => void
  onTerminWeg: () => void
}) {
  const [offen, setOffen] = useState(false)
  const kapazitaet = KAPAZITAET_LABEL[u.kapazitaet]

  return (
    <div className="wp-einheit">
      <div className="wp-kopf">
        <span className="wp-tag">{weekdayLong(u.day)}</span>
        <span className="wp-datum">{formatDay(u.day, 'short')}</span>
        <span className="wp-relativ">{u.label}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onTerminWeg}
          aria-label={`Turntermin am ${formatDay(u.day)} löschen`}>Termin löschen</button>
      </div>

      {(u.tagesart || kapazitaet || u.freieMinuten !== null) && (
        <div className="wp-kontext">
          {u.tagesart && <span>{u.tagesart}</span>}
          {kapazitaet && <span>{kapazitaet}</span>}
          {u.freieMinuten !== null && u.freieMinuten > 0 && (
            <span>{formatDuration(u.freieMinuten)} frei</span>
          )}
        </div>
      )}

      {u.geraete.length === 0 ? (
        <div className="muted small">
          Für diesen Tag ist nichts zugeordnet – die Inhalte reichen nicht für
          alle Einheiten.
        </div>
      ) : (
        <div className="wp-geraete">
          {u.geraete.map((g) => (
            <WochenGeraet key={`${g.apparatus}-${g.wiederholung ? 'w' : 'e'}`} g={g}
              andere={andere} offen={offen}
              onWeg={() => onWeg(g.apparatus)}
              onVerschieben={(sid) => onVerschieben(g.apparatus, sid)} />
          ))}
        </div>
      )}

      {u.geraete.length > 0 && (
        <button type="button" className="btn btn-sm btn-ghost wp-warum"
          onClick={() => setOffen(!offen)} aria-expanded={offen}>
          {offen ? '▴ Begründungen zu' : '▾ Warum diese Geräte?'}
        </button>
      )}
    </div>
  )
}

function WochenGeraet({ g, andere, offen, onWeg, onVerschieben }: {
  g: EinheitGeraet
  andere: GeplanteEinheit[]
  offen: boolean
  onWeg: () => void
  onVerschieben: (sessionId: string) => void
}) {
  return (
    <div className="wp-geraet">
      <div className="wp-geraet-kopf">
        <span className="wp-name">{g.name}</span>
        <span className={`np-rolle np-rolle-${g.rolle}`}>{ROLLE_LABEL[g.rolle]}</span>
        {g.wiederholung && <span className="wp-wdh">zweiter Durchgangstermin</span>}
        <span style={{ flex: 1 }} />
        {andere.length > 0 && (
          <select className="input wp-wahl" value=""
            aria-label={`${g.name} auf einen anderen Tag`}
            onChange={(e) => e.target.value && onVerschieben(e.target.value)}>
            <option value="">verschieben …</option>
            {andere.map((u) => (
              <option key={u.sessionId} value={u.sessionId}>
                {weekdayLong(u.day)}, {formatDay(u.day, 'short')}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onWeg}
          aria-label={`${g.name} entfernen`}>×</button>
      </div>

      <div className="wp-inhalte">
        {g.inhalte.map((i) => (
          <div className="wp-inhalt" key={i.key}>
            <span className={`np-art np-art-${i.art}`}>{INHALT_ART_LABEL[i.art]}</span>
            <span className="np-inhalt-text">{i.text}</span>
            <span className="np-umfang">{UMFANG_LABEL[i.umfang]}</span>
          </div>
        ))}
      </div>

      {offen && g.warum.length > 0 && (
        <div className="wp-begruendung">
          {g.warum.map((s, i) => <p key={i}>{s}</p>)}
        </div>
      )}
    </div>
  )
}

/* ==================================================== Noch offen */

/**
 * Was nirgends unterkam.
 *
 * Es wird ausdrücklich genannt, statt still zu verschwinden: Ein Vorschlag, der
 * Inhalte wegfallen lässt, ohne es zu sagen, ist schlechter als einer, der die
 * Lücke zeigt.
 */
function OffenerBereich({ posten, einheiten, onVerschieben }: {
  posten: OffenerPosten[]
  einheiten: GeplanteEinheit[]
  onVerschieben: (apparatus: string, sessionId: string) => void
}) {
  return (
    <div className="wp-offen">
      <div className="wp-offen-kopf">Noch offen</div>
      <div className="muted small mb8">{OFFEN_TEXT[posten[0].grund]}</div>
      {posten.map((o) => (
        <div className="wp-offen-zeile" key={o.apparatus}>
          <span className="wp-name">{o.name}</span>
          <span className={`np-rolle np-rolle-${o.rolle}`}>{ROLLE_LABEL[o.rolle]}</span>
          <span className="muted small">
            {o.inhalte.length === 1 ? '1 Inhalt' : `${o.inhalte.length} Inhalte`}
          </span>
          <span style={{ flex: 1 }} />
          {einheiten.length > 0 && (
            <select className="input wp-wahl" value=""
              aria-label={`${o.name} einplanen`}
              onChange={(e) => e.target.value && onVerschieben(o.apparatus, e.target.value)}>
              <option value="">einplanen …</option>
              {einheiten.map((u) => (
                <option key={u.sessionId} value={u.sessionId}>
                  {weekdayLong(u.day)}, {formatDay(u.day, 'short')}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  )
}

/* ==================================================== Termin anlegen */

/**
 * Einen Turntermin anlegen.
 *
 * Schreibt eine gewöhnliche `workout_sessions`-Zeile mit `status: 'planned'`
 * und `discipline: 'turnen'` – dieselbe Struktur, die `Tracking` und `Heute`
 * schon benutzen. Kein eigenes Terminmodell.
 *
 * Die Dauer ist freiwillig. Steht eine da, gilt die Einheit als kurz, normal
 * oder lang; fehlt sie, wird über die Kapazität nichts behauptet.
 */
function TerminAnlegen({ heute, onClose }: { heute: string; onClose: () => void }) {
  const m = useMutations()
  const [tag, setTag] = useState(addDays(heute, 1))
  const [dauer, setDauer] = useState<string>('')

  const speichern = () => {
    const minuten = Number.parseInt(dauer, 10)
    m.create('workout_sessions', {
      day: tag,
      plan_day_id: null,
      title: 'Turnen',
      type: null,
      started_at: null,
      ended_at: null,
      duration_minutes: Number.isFinite(minuten) && minuten > 0 ? minuten : null,
      status: 'planned',
      perceived_effort: null,
      note: null,
      discipline: 'turnen',
    }, 'Turntermin geplant')
    onClose()
  }

  return (
    <Modal open title="Turntermin planen" onClose={onClose}
      footer={<>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={speichern} disabled={!tag}>Planen</button>
      </>}>
      <Field label="Tag">
        <input className="input" type="date" value={tag} min={heute}
          onChange={(e) => setTag(e.target.value)} />
      </Field>
      <Field label="Dauer" hint="freiwillig – nur für „kurz, normal, lang“">
        <input className="input" type="number" min="0" step="15" value={dauer}
          onChange={(e) => setDauer(e.target.value)} placeholder="z. B. 90" />
      </Field>
      <div className="hint-box small">
        Der Termin liegt in denselben Trainingseinheiten wie deine erfassten
        Trainings – er erscheint deshalb auch unter <strong>Tracking</strong> und
        auf <strong>Heute</strong>. Absolviert ist er erst, wenn du im Reiter
        Training etwas dazu erfasst hast.
      </div>
      <div className="muted small mt8">
        Zeitraum der Planung: die kommenden {WOCHEN_SCHWELLEN.horizontTage} Tage.
      </div>
    </Modal>
  )
}
