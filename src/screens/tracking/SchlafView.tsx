/**
 * TRACKING · SCHLAF – die Nächte ausführlich.
 *
 * „Heute" zeigt eine Zeile: wie lange, von wann bis wann. Hier steht der Rest,
 * weil er hier auch hingehört – der Verlauf, die Phasen, die Wachzeit.
 *
 * Bewusst ohne Wertung: Es gibt in Apple Health keine „Schlafqualität", und
 * Sleep Cycle behält seine Prozentzahl für sich. Was hier steht, ist gemessene
 * Zeit. Ob eine Nacht gut war, entscheidet der Zielbereich von `sleep_h`
 * (Tracking → Zielbereiche), nicht diese Seite.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Empty, Field, Modal, Chips } from '../../ui/components'
import { Icon } from '../../ui/icons'
import { BarChart, Meter, ChartFrame } from '../../charts'
import { useData, useMutations } from '../../state/store'
import { todayString, formatDay, formatDuration, uhrzeitAusIso, addDays } from '../../core/dates'
import type { SleepSession } from '../../core/types'

/** Die Phasen in fester Reihenfolge – tief unten, REM oben, wie im Schlafbild. */
const PHASEN: { feld: keyof SleepSession; name: string; farbe: string }[] = [
  { feld: 'deep_min', name: 'Tiefschlaf', farbe: 'var(--tag-nacht)' },
  { feld: 'core_min', name: 'Leichtschlaf', farbe: 'var(--tag-spaet)' },
  { feld: 'rem_min', name: 'REM', farbe: 'var(--tag-frueh)' },
  { feld: 'awake_min', name: 'Wach', farbe: 'var(--tag-frei)' },
]

export function SchlafView() {
  const data = useData()
  const [tage, setTage] = useState(14)
  const [offen, setOffen] = useState<SleepSession | null>(null)

  const heute = todayString()
  const naechte = useMemo(
    () => data.sleepSessions.filter((n) => !n.deleted_at).sort((a, b) => (a.day < b.day ? 1 : -1)),
    [data.sleepSessions],
  )
  const letzte = naechte[0] ?? null

  const reihe = useMemo(() => {
    const vonTag = addDays(heute, -(tage - 1))
    const jeTag = new Map(naechte.map((n) => [n.day, n]))
    const out: { label: string; values: number[]; day: string }[] = []
    for (let i = 0; i < tage; i++) {
      const d = addDays(vonTag, i)
      const n = jeTag.get(d)
      out.push({ label: formatDay(d, 'short'), day: d, values: [n ? n.duration_min / 60 : 0] })
    }
    return out
  }, [naechte, tage, heute])

  const gemessen = reihe.filter((r) => r.values[0] > 0)
  const schnitt = gemessen.length
    ? gemessen.reduce((s, r) => s + r.values[0], 0) / gemessen.length
    : null

  if (naechte.length === 0) {
    return (
      <Empty icon="😴" title="Noch keine Nacht erfasst"
        hint="Der Schlaf kommt über den iOS-Kurzbefehl aus Apple Health. Wie das eingerichtet wird, steht in den Einstellungen unter „Schlafimport“." />
    )
  }

  return (
    <>
      <div className="grid grid-3 keep2 mb16">
        <Card>
          <Stat label={letzte && letzte.day === heute ? 'Letzte Nacht' : `Zuletzt · ${formatDay(letzte!.day, 'short')}`}
            value={letzte ? formatDuration(letzte.duration_min) : '–'}
            sub={letzte
              ? <span className="muted small">{uhrzeitAusIso(letzte.start_at)}–{uhrzeitAusIso(letzte.end_at)}</span>
              : undefined} />
        </Card>
        <Card>
          <Stat small label={`Schnitt (${gemessen.length} Nächte)`}
            value={schnitt === null ? '–' : formatDuration(Math.round(schnitt * 60))} />
        </Card>
        <Card>
          <Stat small label="Nächte erfasst" value={String(naechte.length)} />
        </Card>
      </div>

      <Card className="mb16" title="Verlauf" sub="Schlafdauer je Nacht"
        action={<Chips size="sm" value={tage} onChange={setTage} options={[
          { value: 7, label: '7 Tage' }, { value: 14, label: '14 Tage' }, { value: 30, label: '30 Tage' },
        ]} />}>
        <ChartFrame title="Schlafdauer je Nacht" sub={`Die letzten ${tage} Tage`}>
          {({ height }) => (
            <BarChart data={reihe} seriesNames={['Stunden']} height={height}
              axisLabel="Stunden"
              formatValue={(v) => (v > 0 ? formatDuration(Math.round(v * 60)) : 'nicht erfasst')}
              formatAxis={(v) => `${Math.round(v)} h`} />
          )}
        </ChartFrame>
        {gemessen.length < tage && (
          <div className="small muted mt8">
            {tage - gemessen.length} von {tage} Nächten ohne Messung – dort steht kein Wert, keine Null.
          </div>
        )}
      </Card>

      <Card title="Die einzelnen Nächte" className="pad0">
        <div className="list">
          {naechte.slice(0, 40).map((n) => (
            <button className="list-row" key={n.id} onClick={() => setOffen(n)}>
              <span className="avatar" style={{ background: 'var(--tag-nacht)' }}>
                <Icon name="schlaf" size={15} />
              </span>
              <span className="list-main">
                <span className="list-title">{formatDay(n.day)}</span>
                <span className="list-sub">
                  {uhrzeitAusIso(n.start_at)}–{uhrzeitAusIso(n.end_at)}
                  {n.awake_min ? ` · ${formatDuration(n.awake_min)} wach` : ''}
                  {n.source ? ` · ${n.source}` : ''}
                  {n.note ? ` · ${n.note}` : ''}
                </span>
              </span>
              <span className="list-amount">{formatDuration(n.duration_min)}</span>
            </button>
          ))}
        </div>
        {naechte.length > 40 && (
          <div className="small muted" style={{ padding: '10px 16px' }}>
            Es werden die 40 neuesten gezeigt.
          </div>
        )}
      </Card>

      {offen && <NachtDetail nacht={offen} onClose={() => setOffen(null)} />}
    </>
  )
}

/**
 * Eine Nacht von innen.
 *
 * Die Phasen stehen nur da, wenn die Quelle sie geliefert hat. Sleep Cycle
 * und ältere Geräte kennen sie nicht – dort steht dann ein Satz, der das
 * sagt, statt vier Balken auf null.
 */
function NachtDetail({ nacht, onClose }: { nacht: SleepSession; onClose: () => void }) {
  const m = useMutations()
  const [notiz, setNotiz] = useState(nacht.note ?? '')
  const hatPhasen = nacht.core_min !== null || nacht.deep_min !== null || nacht.rem_min !== null

  const speichern = () => {
    if ((notiz.trim() || null) !== (nacht.note ?? null)) {
      m.patch('sleep_sessions', nacht.id, { note: notiz.trim() || null }, 'Notiz gespeichert')
    }
    onClose()
  }

  return (
    <Modal open title={`Nacht auf ${formatDay(nacht.day)}`} onClose={onClose}
      footer={<>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={speichern}>Speichern</button>
      </>}>
      <div className="grid grid-3 keep2">
        <Stat small label="Geschlafen" value={formatDuration(nacht.duration_min)} />
        <Stat small label="Von" value={uhrzeitAusIso(nacht.start_at)} />
        <Stat small label="Bis" value={uhrzeitAusIso(nacht.end_at)} />
      </div>

      {hatPhasen ? (
        <Card title="Phasen" sub="Anteil an der Nacht">
          {PHASEN.map((ph) => {
            const wert = nacht[ph.feld] as number | null
            if (wert === null || wert === undefined) return null
            const gesamt = nacht.duration_min + (nacht.awake_min ?? 0)
            const anteil = gesamt > 0 ? (wert / gesamt) * 100 : 0
            return (
              <div className="progress-row" key={String(ph.feld)}>
                <div className="progress-head">
                  <span className="dot" style={{ background: ph.farbe }} />
                  <span className="name">{ph.name}</span>
                  <span className="val">{formatDuration(wert)} · {Math.round(anteil)} %</span>
                </div>
                <Meter percent={anteil} farbe={ph.farbe} />
              </div>
            )
          })}
        </Card>
      ) : (
        <div className="hint-box small">
          Diese Quelle liefert keine Schlafphasen. Core, Tiefschlaf und REM misst
          nur eine Apple Watch oder ein vergleichbares Gerät – Sleep Cycle allein
          nennt nur, wann geschlafen wurde.
          {nacht.in_bed_min !== null && <> Im Bett: <strong>{formatDuration(nacht.in_bed_min)}</strong>.</>}
        </div>
      )}

      {nacht.in_bed_min !== null && hatPhasen && (
        <div className="kennzeilen">
          <div className="kennzeile">
            <span className="kennzeile-name">Im Bett</span>
            <span className="kennzeile-wert">{formatDuration(nacht.in_bed_min)}</span>
          </div>
        </div>
      )}

      <Field label="Notiz" hint="Bleibt beim nächsten Import erhalten.">
        <textarea className="textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)}
          placeholder="z. B. spät gegessen, unruhig" />
      </Field>

      <div className="small muted">
        Quelle: {nacht.source ?? 'unbekannt'}
      </div>
    </Modal>
  )
}
