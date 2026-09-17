/**
 * „Womit hängt meine Haut zusammen – und wie viel später?"
 *
 * Die bisherige Auswertung vergleicht denselben Tag mit sich selbst. Für Haut
 * ist das die falsche Frage: Was am Montag gegessen wurde, sieht man
 * frühestens am Dienstag. Hier wird deshalb mit Versatz gerechnet – und zwar
 * mit mehreren nebeneinander, siehe core/zusammenhaenge.ts.
 *
 * Die Gestaltung hat eine Aufgabe, die über „hübsch" hinausgeht: Sie muss
 * verhindern, dass aus einer Zahl eine Regel wird. Deshalb steht bei jedem
 * Befund die Datenmenge, deshalb sind alle geprüften Verzögerungen nebeneinander
 * zu sehen, und deshalb steht ein einzelner Ausschlag ohne Nachbarn erkennbar
 * allein da.
 */
import { useMemo, useState } from 'react'
import { Card, Empty, Collapsible, Segment } from '../ui/components'
import { useData } from '../state/store'
import { dailySeries } from '../core/metrics'
import { addDays, todayString } from '../core/dates'
import { formatNumber } from '../core/money'
import { NAEHRWERT_KEYS } from '../core/naehrwerte'
import {
  MINDESTTAGE, VERZOEGERUNGEN, formuliere, staerke, untersuche,
  type Befund, type Richtung,
} from '../core/zusammenhaenge'
import type { Metric } from '../core/types'

/**
 * Was als Ursache und was als Wirkung untersucht wird.
 *
 * Die Richtung ist nicht beliebig: Ernährung und Schlaf gehen dem Befinden
 * voraus, nicht umgekehrt. Die Rechnung selbst wüsste das nicht – sie fände
 * denselben Zusammenhang auch rückwärts. Was zeitlich vorn steht, ist eine
 * inhaltliche Entscheidung und gehört deshalb hierher.
 */
const URSACHEN = [...NAEHRWERT_KEYS, 'water_l', 'sleep_h']
const WIRKUNGEN = ['skin', 'pimples', 'energy', 'mood']

export function ZeitversetzteZusammenhaenge() {
  const data = useData()
  const heute = todayString()
  const [tage, setTage] = useState(180)
  // Kennzahlen (r, Irrtumswahrscheinlichkeit) sind Fachsprache und stehen
  // deshalb hinter einem Schalter - die Aussage steht immer vorn.
  const [kennzahlen, setKennzahlen] = useState(false)
  const von = addDays(heute, -(tage - 1))

  const metriken = useMemo(
    () => new Map(data.metrics.filter((m) => !m.deleted_at && m.is_enabled).map((m) => [m.key, m])),
    [data.metrics],
  )

  const { belastbare, geprueft, alle } = useMemo(() => {
    // Die Reihen einmal bilden, nicht je Paar erneut: 18 Ursachen mal vier
    // Wirkungen wären sonst 144 Durchläufe über dieselben Daten.
    const reihen = new Map<string, ReturnType<typeof dailySeries>>()
    const reiheVon = (m: Metric) => {
      let r = reihen.get(m.key)
      if (!r) { r = dailySeries(data.metricEntries, m, von, heute); reihen.set(m.key, r) }
      return r
    }

    const alle: Befund[] = []
    let geprueft = 0
    for (const uKey of URSACHEN) {
      const u = metriken.get(uKey)
      if (!u) continue
      for (const wKey of WIRKUNGEN) {
        const w = metriken.get(wKey)
        if (!w) continue
        geprueft++
        alle.push(...untersuche(uKey, wKey, reiheVon(u), reiheVon(w), addDays))
      }
    }
    const belastbare = alle.filter((b) => b.belastbar)
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    return { belastbare, geprueft, alle }
  }, [metriken, data.metricEntries, von, heute])

  /** Wie viele Tage überhaupt zusammenpassen – für die ehrliche Leermeldung. */
  const besteDatenbasis = useMemo(
    () => alle.reduce((max, b) => Math.max(max, b.n), 0),
    [alle],
  )

  const name = (key: string) => metriken.get(key)?.name ?? key
  const richtung = (key: string) => (metriken.get(key)?.direction ?? 'neutral') as Richtung

  return (
    <Card className="mb16" title="Zeitversetzte Zusammenhänge"
      sub="Wirkt sich aus, was ein paar Tage vorher war?">
      <div className="row mb16">
        <Segment label="Zeitraum" value={String(tage)} onChange={(v) => setTage(Number(v))}
          options={[{ value: '90', label: '90 Tage' }, { value: '180', label: '180 Tage' }, { value: '365', label: '365 Tage' }]} />
        <span style={{ flex: 1 }} />
        <button className={`chip sm ${kennzahlen ? 'active' : ''}`} onClick={() => setKennzahlen(!kennzahlen)}>
          Kennzahlen
        </button>
      </div>

      {belastbare.length === 0 ? (
        <Empty kompakt title="Nichts, was sich belastbar nennen ließe."
          hint={besteDatenbasis < MINDESTTAGE
            ? `Der längste Vergleich kommt auf ${besteDatenbasis} gemeinsame Tage. `
              + `Unter ${MINDESTTAGE} ist jede Zahl mit Zufall vereinbar – deshalb steht hier nichts.`
            : `${geprueft} Wertepaare mit je ${VERZOEGERUNGEN.length} Verzögerungen geprüft. `
              + 'Kein Zusammenhang war stark genug, um sich vom Zufall zu unterscheiden. '
              + 'Das ist ein Ergebnis, kein Fehler.'} />
      ) : (
        <>
          {belastbare.map((b, i) => (
            <BefundZeile key={i} befund={b} alle={alle} kennzahlen={kennzahlen}
              nameUrsache={name(b.ursache)} nameWirkung={name(b.wirkung)}
              richtung={richtung(b.wirkung)} />
          ))}
          <div className="mt12">
            <GeprueftAberNichts alle={alle} name={name} />
          </div>
          <div className="mt12"><Collapsible label="Wie geprüft wird">
          <div className="hint-box small">
            Geprüft wurden {geprueft} Wertepaare mit je {VERZOEGERUNGEN.length} Verzögerungen.
            Wer so oft hinsieht, findet irgendwo einen Ausschlag – deshalb ist die
            Irrtumswahrscheinlichkeit bereits dafür hochgerechnet, und nur was danach
            noch übrig bleibt, steht hier. Ein Zusammenhang bleibt trotzdem eine
            Beobachtung: Er sagt nicht, dass das eine das andere verursacht.
          </div>
          </Collapsible></div>
        </>
      )}
    </Card>
  )
}

/**
 * Ein Befund – mit dem Verlauf über alle Verzögerungen darunter.
 *
 * Der Verlauf ist der eigentliche Schutz vor Fehlschlüssen: Gehört der
 * Ausschlag zu einem Muster (2 und 3 Tage beide auffällig), ist das etwas
 * anderes, als wenn er allein dasteht.
 */
function BefundZeile({ befund, alle, nameUrsache, nameWirkung, richtung, kennzahlen }: {
  befund: Befund
  alle: Befund[]
  nameUrsache: string
  nameWirkung: string
  richtung: Richtung
  kennzahlen: boolean
}) {
  const verlauf = alle.filter((b) => b.ursache === befund.ursache && b.wirkung === befund.wirkung)

  return (
    <div className="befund">
      <div className="befund-satz">
        {formuliere(befund, nameUrsache, nameWirkung, richtung)}
      </div>
      {/* Die Irrtumswahrscheinlichkeit bleibt immer sichtbar: Ein Befund ohne
          seine Unsicherheit ist eine Behauptung. Nur der Fachwert r steht
          hinter dem Schalter „Kennzahlen". */}
      <div className="befund-zahlen small muted">
        {staerke(befund.r)} · Irrtumswahrscheinlichkeit {befund.p < 0.001 ? '< 0,1' : formatNumber(befund.p * 100, 1)} %
        {kennzahlen && <> · r = {formatNumber(befund.r, 2)}</>}
      </div>
      <div className="befund-verlauf">
        {verlauf.map((v) => (
          <div key={v.verzoegerung} className={`befund-lag ${v.belastbar ? 'stark' : ''}`}
            title={`${v.verzoegerung} Tage: r = ${formatNumber(v.r, 2)}, ${v.n} Tage Datenbasis`}>
            <div className="befund-lag-balken">
              <span style={{ height: `${Math.min(100, Math.abs(v.r) * 100)}%` }} />
            </div>
            <div className="befund-lag-tag">{v.verzoegerung}</div>
          </div>
        ))}
        <div className="small muted" style={{ alignSelf: 'flex-end', marginLeft: 8 }}>
          Tage Versatz
        </div>
      </div>
    </div>
  )
}

/**
 * Alles, was geprüft, aber nicht belastbar war – auf Wunsch.
 *
 * Gehört nicht nach vorn, aber es gehört auch nicht verschwiegen: Wer wissen
 * will, ob „Zucker ↔ Haut" überhaupt angesehen wurde, soll nachsehen können,
 * statt zu vermuten.
 */
function GeprueftAberNichts({ alle, name }: {
  alle: Befund[]
  name: (key: string) => string
}) {
  const knapp = alle
    .filter((b) => !b.belastbar && b.n >= MINDESTTAGE)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, 12)
  if (!knapp.length) return null

  return (
    <Collapsible label={`Geprüft, aber nicht belastbar (${knapp.length})`}>
      <div className="naehrwert-liste">
        {knapp.map((b, i) => (
          <div key={i} className="naehrwert-zeile">
            <span className="naehrwert-name">
              {name(b.ursache)} → {name(b.wirkung)} ({b.verzoegerung} T.)
            </span>
            <span className="naehrwert-wert">r = {formatNumber(b.r, 2)}</span>
          </div>
        ))}
      </div>
    </Collapsible>
  )
}
