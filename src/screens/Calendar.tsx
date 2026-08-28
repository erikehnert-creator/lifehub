/**
 * KALENDER
 *
 * Aufgebaut wie der Kalender, den Erik vom iPhone kennt: oben der Zeitraum mit
 * Pfeilen und „Heute", darunter die Umschaltung zwischen Tag, Woche, Monat und
 * Liste. Im Monat markiert ein Punkt jeden Tag mit Terminen, und darunter steht
 * der ausgewählte Tag im Klartext – so wie in der Apple-App.
 *
 * Fachlich kommt eines dazu, was Apple nicht hat: Der Kalender zeigt auch die
 * Tagesart (Frühschicht, Berufsschule, Urlaub) und die Aufgaben des Tages,
 * weil beides zum selben „was ist heute los" gehört.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Modal, Field, Chips, Empty, Confirm, Tabs } from '../ui/components'
import { useData, useMutations } from '../state/store'
import {
  todayString, formatDay, formatMonth, monthOf, monthStart, monthEnd,
  startOfWeek, endOfWeek, daysInRange, addDays, addMonthsToYearMonth,
  weekdayShort, weekdayLong, timeToMinutes, minutesToTime, diffDays, holidaysForState,
} from '../core/dates'
import { occurrences, buildRRule, describeRRule } from '../core/recurrence'
import { dringlichkeit } from '../core/planner'
import type { CalendarEvent } from '../core/types'
import type { DayString } from '../core/dates'

/** Terminfarben – dieselbe Idee wie bei Apple: wenige, klar benannte Farben. */
export const TERMIN_FARBEN = [
  { value: 'var(--series-1)', label: 'Blau' },
  { value: 'var(--series-3)', label: 'Grün' },
  { value: 'var(--series-2)', label: 'Orange' },
  { value: 'var(--series-8)', label: 'Rot' },
  { value: 'var(--series-7)', label: 'Violett' },
  { value: 'var(--series-4)', label: 'Gelb' },
  { value: 'var(--series-5)', label: 'Rosa' },
  { value: 'var(--series-6)', label: 'Tannengrün' },
]

const STUNDE_PX = 46

export interface Vorkommen {
  event: CalendarEvent
  day: DayString
  /** Bei mehrtägigen Terminen: der wievielte Tag und wie viele insgesamt. */
  teil: { nr: number; von: number } | null
}

/**
 * Alle Termine eines Zeitraums – Wiederholungen und mehrtägige Termine
 * bereits auf einzelne Tage aufgelöst. Alles andere in dieser Datei rechnet
 * mit dem Ergebnis und muss sich um Wiederholungsregeln nicht kümmern.
 */
export function vorkommenIn(events: CalendarEvent[], von: DayString, bis: DayString): Vorkommen[] {
  const out: Vorkommen[] = []
  for (const e of events) {
    if (e.deleted_at) continue
    const laenge = e.end_day && e.end_day > e.day ? diffDays(e.day, e.end_day) + 1 : 1
    // Ein mehrtägiger Termin kann schon vor `von` begonnen haben.
    const suchVon = addDays(von, -(laenge - 1))
    const ausnahmen = (e.exdates ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    const starts = e.rrule
      ? occurrences(e.rrule, e.day, suchVon, bis, ausnahmen)
      : (e.day >= suchVon && e.day <= bis ? [e.day] : [])
    for (const start of starts) {
      for (let i = 0; i < laenge; i++) {
        const tag = addDays(start, i)
        if (tag < von || tag > bis) continue
        out.push({ event: e, day: tag, teil: laenge > 1 ? { nr: i + 1, von: laenge } : null })
      }
    }
  }
  return out.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    const ag = a.event.all_day ? 0 : 1
    const bg = b.event.all_day ? 0 : 1
    if (ag !== bg) return ag - bg
    return (a.event.start_time ?? '') < (b.event.start_time ?? '') ? -1 : 1
  })
}

/* ------------------------------------------------------------------ Bildschirm */

export function CalendarView({ openQuickAdd }: { openQuickAdd?: (kind?: any) => void }) {
  const data = useData()
  const heute = todayString()
  const [ansicht, setAnsicht] = useState<'monat' | 'woche' | 'tag' | 'liste'>('monat')
  const [anker, setAnker] = useState<DayString>(heute)
  const [auswahl, setAuswahl] = useState<DayString>(heute)
  const [bearbeiten, setBearbeiten] = useState<CalendarEvent | 'neu' | null>(null)
  const [neuerTag, setNeuerTag] = useState<DayString>(heute)

  const feiertage = useMemo(
    () => holidaysForState(Number(anker.slice(0, 4)), data.settings.state ?? 'SN'),
    [anker, data.settings.state],
  )

  // Der Zeitraum, den die aktuelle Ansicht braucht – großzügig, damit
  // mehrtägige Termine an den Rändern nicht abgeschnitten werden.
  const [von, bis] = useMemo((): [DayString, DayString] => {
    if (ansicht === 'monat') return [startOfWeek(monthStart(monthOf(anker))), endOfWeek(monthEnd(monthOf(anker)))]
    if (ansicht === 'woche') return [startOfWeek(anker), endOfWeek(anker)]
    if (ansicht === 'tag') return [anker, anker]
    return [heute, addDays(heute, 120)]
  }, [ansicht, anker, heute])

  const alle = useMemo(() => vorkommenIn(data.events, von, bis), [data.events, von, bis])
  const proTag = useMemo(() => {
    const map = new Map<DayString, Vorkommen[]>()
    for (const v of alle) map.set(v.day, [...(map.get(v.day) ?? []), v])
    return map
  }, [alle])

  const springen = (richtung: -1 | 1) => {
    if (ansicht === 'monat') setAnker(monthStart(addMonthsToYearMonth(monthOf(anker), richtung)))
    else if (ansicht === 'woche') setAnker(addDays(anker, richtung * 7))
    else setAnker(addDays(anker, richtung))
  }

  const titel = ansicht === 'monat' ? formatMonth(monthOf(anker))
    : ansicht === 'woche' ? `${formatDay(startOfWeek(anker), 'short')} – ${formatDay(endOfWeek(anker), 'short')}`
    : ansicht === 'tag' ? formatDay(anker, 'long')
    : 'Kommende Termine'

  const neu = (tag: DayString) => { setNeuerTag(tag); setBearbeiten('neu') }

  return (
    <>
      <div className="kal-kopf">
        {ansicht !== 'liste' && (
          <>
            <button className="btn btn-sm" onClick={() => springen(-1)} aria-label="Zurück">‹</button>
            <strong className="kal-titel">{titel}</strong>
            <button className="btn btn-sm" onClick={() => springen(1)} aria-label="Weiter">›</button>
          </>
        )}
        {ansicht === 'liste' && <strong className="kal-titel">{titel}</strong>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost"
          onClick={() => { setAnker(heute); setAuswahl(heute) }}>Heute</button>
        <button className="btn btn-sm btn-primary" onClick={() => neu(auswahl)}>+ Termin</button>
      </div>

      <Tabs active={ansicht} onChange={(k) => setAnsicht(k as any)}
        tabs={[
          { key: 'tag', label: 'Tag' },
          { key: 'woche', label: 'Woche' },
          { key: 'monat', label: 'Monat' },
          { key: 'liste', label: 'Liste' },
        ]} />

      {ansicht === 'monat' && (
        <MonatsRaster
          anker={anker} auswahl={auswahl} proTag={proTag} feiertage={feiertage}
          onWaehlen={(d) => { setAuswahl(d); }}
          onSpringen={(d) => { setAnker(d); setAuswahl(d) }} />
      )}
      {ansicht === 'monat' && (
        <TagesListe tag={auswahl} vorkommen={proTag.get(auswahl) ?? []}
          onOeffnen={(e) => setBearbeiten(e)} onNeu={() => neu(auswahl)} />
      )}
      {ansicht === 'woche' && (
        <WochenRaster anker={anker} proTag={proTag} feiertage={feiertage}
          onOeffnen={(e) => setBearbeiten(e)}
          onLeerTippen={(tag) => neu(tag)}
          onTagWaehlen={(d) => { setAnker(d); setAuswahl(d); setAnsicht('tag') }} />
      )}
      {ansicht === 'tag' && (
        <>
          <TagesRaster tag={anker} vorkommen={proTag.get(anker) ?? []}
            onOeffnen={(e) => setBearbeiten(e)} onLeerTippen={() => neu(anker)} />
          <TagesListe tag={anker} vorkommen={proTag.get(anker) ?? []}
            onOeffnen={(e) => setBearbeiten(e)} onNeu={() => neu(anker)} nurZusatz />
        </>
      )}
      {ansicht === 'liste' && (
        <TerminListe vorkommen={alle} onOeffnen={(e) => setBearbeiten(e)} />
      )}

      {bearbeiten && (
        <TerminEditor
          event={bearbeiten === 'neu' ? null : bearbeiten}
          defaultDay={neuerTag}
          onClose={() => setBearbeiten(null)} />
      )}
    </>
  )
}

/* -------------------------------------------------------------- Monatsraster */

function MonatsRaster({ anker, auswahl, proTag, feiertage, onWaehlen, onSpringen }: {
  anker: DayString
  auswahl: DayString
  proTag: Map<DayString, Vorkommen[]>
  feiertage: { day: string; name: string }[]
  onWaehlen: (d: DayString) => void
  onSpringen: (d: DayString) => void
}) {
  const data = useData()
  const heute = todayString()
  const monat = monthOf(anker)
  const tage = daysInRange(startOfWeek(monthStart(monat)), endOfWeek(monthEnd(monat)))
  const feiertagAm = new Map(feiertage.map((f) => [f.day, f.name]))

  return (
    <Card className="pad0 mb16">
      <div className="kal-raster">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
          <div key={d} className="kal-wochentag">{d}</div>
        ))}
        {tage.map((d) => {
          const imMonat = monthOf(d) === monat
          const istHeute = d === heute
          const gewaehlt = d === auswahl
          const zuordnung = data.dayAssignments.find((a) => !a.deleted_at && a.day === d)
          const tagesart = zuordnung ? data.dayTypes.find((t) => t.id === zuordnung.day_type_id) : null
          const termine = proTag.get(d) ?? []
          const aufgaben = data.tasks.filter((t) => !t.deleted_at && t.scheduled_on === d && t.status !== 'done')
          const feiertag = feiertagAm.get(d)
          return (
            <button key={d}
              className={`kal-tag${imMonat ? '' : ' fremd'}${gewaehlt ? ' gewaehlt' : ''}`}
              onClick={() => onWaehlen(d)}
              onDoubleClick={() => onSpringen(d)}
              title={feiertag ?? formatDay(d, 'long')}>
              <span className={`kal-zahl${istHeute ? ' heute' : ''}`}>{Number(d.slice(8, 10))}</span>
              {tagesart && (
                <span className="kal-tagesart" style={{ background: tagesart.color ?? 'var(--surface-3)' }}>
                  {tagesart.short_code}
                </span>
              )}
              {feiertag && <span className="kal-feiertag">{feiertag}</span>}
              <span className="kal-punkte">
                {termine.slice(0, 4).map((v, i) => (
                  <span key={i} className="kal-punkt" style={{ background: v.event.color ?? 'var(--series-1)' }} />
                ))}
                {aufgaben.length > 0 && <span className="kal-punkt aufgabe" />}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------- Tagesliste (unten) */

function TagesListe({ tag, vorkommen, onOeffnen, onNeu, nurZusatz }: {
  tag: DayString
  vorkommen: Vorkommen[]
  onOeffnen: (e: CalendarEvent) => void
  onNeu: () => void
  /** Nur Tagesart und Aufgaben zeigen – die Termine stehen schon im Raster. */
  nurZusatz?: boolean
}) {
  const data = useData()
  const m = useMutations()
  const zuordnung = data.dayAssignments.find((a) => !a.deleted_at && a.day === tag)
  const tagesart = zuordnung ? data.dayTypes.find((t) => t.id === zuordnung.day_type_id) : null
  const aufgaben = data.tasks.filter((t) => !t.deleted_at && t.scheduled_on === tag && t.status !== 'done')

  return (
    <Card title={formatDay(tag, 'long')}
      sub={tagesart ? tagesart.name : undefined}
      action={<button className="btn btn-sm" onClick={onNeu}>+ Termin</button>}>
      {!nurZusatz && (
        vorkommen.length === 0 ? (
          <Empty icon="🗓️" title="Keine Termine an diesem Tag"
            hint={'Tippe oben auf „+ Termin", um etwas einzutragen.'} />
        ) : (
          <div className="list">
            {vorkommen.map((v, i) => (
              <button className="list-row" key={`${v.event.id}-${i}`} onClick={() => onOeffnen(v.event)}>
                <span className="kal-balken" style={{ background: v.event.color ?? 'var(--series-1)' }} />
                <span className="list-main">
                  <span className="list-title">{v.event.title}</span>
                  <span className="list-sub">
                    {zeitText(v)}
                    {v.event.location ? ` · ${v.event.location}` : ''}
                    {v.event.rrule ? ` · ${describeRRule(v.event.rrule)}` : ''}
                  </span>
                </span>
                <span className="muted">›</span>
              </button>
            ))}
          </div>
        )
      )}
      {aufgaben.length > 0 && (
        <>
          <div className="field-label mt12">Aufgaben an diesem Tag</div>
          <div className="list">
            {aufgaben.map((t) => {
              const d = dringlichkeit(t)
              return (
                <div key={t.id} className={`list-row aufgabe dringlich-${d.status}`}>
                  <button className="checkbox" aria-label="Erledigt"
                    onClick={() => m.patch('tasks', t.id, {
                      status: 'done', completed_at: new Date().toISOString(),
                    }, 'Erledigt')}>✓</button>
                  <span className="list-main">
                    <span className="list-title">{t.title}</span>
                    {t.scheduled_time && <span className="list-sub mono">{t.scheduled_time}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}

function zeitText(v: Vorkommen): string {
  const e = v.event
  const teil = v.teil ? ` (Tag ${v.teil.nr} von ${v.teil.von})` : ''
  if (e.all_day) return 'ganztägig' + teil
  if (e.start_time && e.end_time) return `${e.start_time} – ${e.end_time}${teil}`
  if (e.start_time) return `ab ${e.start_time}${teil}`
  return 'ohne Uhrzeit' + teil
}

/* --------------------------------------------------------------- Stundengitter */

/**
 * Termine, die sich zeitlich überschneiden, nebeneinander legen.
 * Ohne das würden zwei Termine um dieselbe Uhrzeit übereinanderliegen und
 * einer wäre unsichtbar.
 */
function spalten(vorkommen: Vorkommen[]): { v: Vorkommen; spalte: number; von: number }[] {
  const mitZeit = vorkommen.filter((v) => !v.event.all_day && v.event.start_time)
  const bereich = (v: Vorkommen) => {
    const s = timeToMinutes(v.event.start_time!)
    const e = v.event.end_time ? timeToMinutes(v.event.end_time) : s + 60
    return [s, Math.max(e, s + 20)] as const
  }
  const sortiert = [...mitZeit].sort((a, b) => bereich(a)[0] - bereich(b)[0])
  const out: { v: Vorkommen; spalte: number; von: number }[] = []
  let gruppe: typeof sortiert = []
  let gruppenEnde = -1

  const gruppeAbschliessen = () => {
    if (!gruppe.length) return
    const enden: number[] = []
    const zuweisung: number[] = []
    for (const g of gruppe) {
      const [s] = bereich(g)
      let sp = enden.findIndex((e) => e <= s)
      if (sp === -1) { sp = enden.length; enden.push(0) }
      enden[sp] = bereich(g)[1]
      zuweisung.push(sp)
    }
    const breite = enden.length
    gruppe.forEach((g, i) => out.push({ v: g, spalte: zuweisung[i], von: breite }))
    gruppe = []
    gruppenEnde = -1
  }

  for (const v of sortiert) {
    const [s, e] = bereich(v)
    if (gruppe.length && s >= gruppenEnde) gruppeAbschliessen()
    gruppe.push(v)
    gruppenEnde = Math.max(gruppenEnde, e)
  }
  gruppeAbschliessen()
  return out
}

function Stundengitter({ tage, proTag, onOeffnen, onLeerTippen }: {
  tage: DayString[]
  proTag: Map<DayString, Vorkommen[]>
  onOeffnen: (e: CalendarEvent) => void
  onLeerTippen: (tag: DayString) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const heute = todayString()
  const jetzt = new Date()
  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes()

  // Beim Öffnen dorthin scrollen, wo der Tag stattfindet – nicht auf 0 Uhr.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.scrollTop = Math.max(0, (7 * STUNDE_PX) - 20)
  }, [tage[0]])

  return (
    <div className="kal-gitter" ref={box}>
      <div className="kal-stunden">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="kal-stunde" style={{ height: STUNDE_PX }}>
            <span>{String(h).padStart(2, '0')}:00</span>
          </div>
        ))}
      </div>
      {tage.map((tag) => {
        const gelegt = spalten(proTag.get(tag) ?? [])
        return (
          <div key={tag} className="kal-spalte" onClick={(e) => {
            if (e.target === e.currentTarget) onLeerTippen(tag)
          }} style={{ height: 24 * STUNDE_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="kal-linie" style={{ top: h * STUNDE_PX }} />
            ))}
            {tag === heute && (
              <div className="kal-jetzt" style={{ top: (jetztMin / 60) * STUNDE_PX }}>
                <span />
              </div>
            )}
            {gelegt.map(({ v, spalte, von }, i) => {
              const s = timeToMinutes(v.event.start_time!)
              const e = v.event.end_time ? timeToMinutes(v.event.end_time) : s + 60
              const hoehe = Math.max(20, ((Math.max(e, s + 20) - s) / 60) * STUNDE_PX)
              return (
                <button key={`${v.event.id}-${i}`} className="kal-block"
                  onClick={() => onOeffnen(v.event)}
                  style={{
                    top: (s / 60) * STUNDE_PX, height: hoehe,
                    left: `calc(${(spalte / von) * 100}% + 2px)`,
                    width: `calc(${100 / von}% - 4px)`,
                    background: v.event.color ?? 'var(--series-1)',
                  }}>
                  <span className="kal-block-titel">{v.event.title}</span>
                  {hoehe > 34 && <span className="kal-block-zeit">{v.event.start_time}</span>}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function GanztagsLeiste({ tage, proTag, onOeffnen }: {
  tage: DayString[]
  proTag: Map<DayString, Vorkommen[]>
  onOeffnen: (e: CalendarEvent) => void
}) {
  const hatWelche = tage.some((t) => (proTag.get(t) ?? []).some((v) => v.event.all_day))
  if (!hatWelche) return null
  return (
    <div className="kal-ganztag">
      <div className="kal-ganztag-label">ganztägig</div>
      {tage.map((tag) => (
        <div key={tag} className="kal-ganztag-spalte">
          {(proTag.get(tag) ?? []).filter((v) => v.event.all_day).map((v, i) => (
            <button key={i} className="kal-ganztag-block" onClick={() => onOeffnen(v.event)}
              style={{ background: v.event.color ?? 'var(--series-3)' }}>
              {v.event.title}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function WochenRaster({ anker, proTag, feiertage, onOeffnen, onLeerTippen, onTagWaehlen }: {
  anker: DayString
  proTag: Map<DayString, Vorkommen[]>
  feiertage: { day: string; name: string }[]
  onOeffnen: (e: CalendarEvent) => void
  onLeerTippen: (tag: DayString) => void
  onTagWaehlen: (tag: DayString) => void
}) {
  const heute = todayString()
  const tage = daysInRange(startOfWeek(anker), endOfWeek(anker))
  const feiertagAm = new Map(feiertage.map((f) => [f.day, f.name]))
  return (
    <Card className="pad0">
      <div className="kal-woche-kopf">
        <div className="kal-ganztag-label" />
        {tage.map((d) => (
          <button key={d} className={`kal-woche-tag${d === heute ? ' heute' : ''}`} onClick={() => onTagWaehlen(d)}>
            <span className="klein">{weekdayShort(d)}</span>
            <span className="zahl">{Number(d.slice(8, 10))}</span>
            {feiertagAm.get(d) && <span className="kal-punkt" style={{ background: 'var(--good)' }} />}
          </button>
        ))}
      </div>
      <GanztagsLeiste tage={tage} proTag={proTag} onOeffnen={onOeffnen} />
      <Stundengitter tage={tage} proTag={proTag} onOeffnen={onOeffnen} onLeerTippen={onLeerTippen} />
    </Card>
  )
}

function TagesRaster({ tag, vorkommen, onOeffnen, onLeerTippen }: {
  tag: DayString
  vorkommen: Vorkommen[]
  onOeffnen: (e: CalendarEvent) => void
  onLeerTippen: () => void
}) {
  const proTag = new Map([[tag, vorkommen]])
  return (
    <Card className="pad0 mb16">
      <GanztagsLeiste tage={[tag]} proTag={proTag} onOeffnen={onOeffnen} />
      <Stundengitter tage={[tag]} proTag={proTag} onOeffnen={onOeffnen} onLeerTippen={onLeerTippen} />
    </Card>
  )
}

/* ------------------------------------------------------------------- Liste */

function TerminListe({ vorkommen, onOeffnen }: {
  vorkommen: Vorkommen[]
  onOeffnen: (e: CalendarEvent) => void
}) {
  const gruppen = useMemo(() => {
    const map = new Map<DayString, Vorkommen[]>()
    for (const v of vorkommen) map.set(v.day, [...(map.get(v.day) ?? []), v])
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [vorkommen])

  if (gruppen.length === 0) {
    return <Empty icon="🗓️" title="Keine Termine in den nächsten vier Monaten"
      hint="Was du einträgst, erscheint hier automatisch." />
  }
  return (
    <>
      {gruppen.map(([tag, liste]) => (
        <Card key={tag} className="pad0 mb16" title={formatDay(tag, 'long')}
          sub={tag === todayString() ? 'Heute' : undefined}>
          <div className="list">
            {liste.map((v, i) => (
              <button className="list-row" key={`${v.event.id}-${i}`} onClick={() => onOeffnen(v.event)}>
                <span className="kal-balken" style={{ background: v.event.color ?? 'var(--series-1)' }} />
                <span className="list-main">
                  <span className="list-title">{v.event.title}</span>
                  <span className="list-sub">
                    {zeitText(v)}{v.event.location ? ` · ${v.event.location}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      ))}
    </>
  )
}

/* ------------------------------------------------------------ Termin-Editor */

const WIEDERHOLUNGEN = [
  { value: 'nie', label: 'Nie' },
  { value: 'taeglich', label: 'Täglich' },
  { value: 'woechentlich', label: 'Wöchentlich' },
  { value: 'zweiwoechentlich', label: 'Alle 2 Wochen' },
  { value: 'monatlich', label: 'Monatlich' },
  { value: 'jaehrlich', label: 'Jährlich' },
]

const ERINNERUNGEN = [
  { value: -1, label: 'Keine' },
  { value: 0, label: 'Zur Startzeit' },
  { value: 10, label: '10 Minuten vorher' },
  { value: 30, label: '30 Minuten vorher' },
  { value: 60, label: '1 Stunde vorher' },
  { value: 1440, label: '1 Tag vorher' },
]

function rruleAus(art: string, tag: DayString, bis: string): string | null {
  if (art === 'nie') return null
  const until = bis || undefined
  const wochentag = ((new Date(tag).getDay() + 6) % 7) + 1
  if (art === 'taeglich') return buildRRule({ freq: 'DAILY', until })
  if (art === 'woechentlich') return buildRRule({ freq: 'WEEKLY', byDay: [wochentag], until })
  if (art === 'zweiwoechentlich') return buildRRule({ freq: 'WEEKLY', interval: 2, byDay: [wochentag], until })
  if (art === 'monatlich') return buildRRule({ freq: 'MONTHLY', byMonthDay: [Number(tag.slice(8, 10))], until })
  if (art === 'jaehrlich') return buildRRule({ freq: 'YEARLY', until })
  return null
}

function artAus(rrule: string | null): string {
  if (!rrule) return 'nie'
  const r = rrule.toUpperCase()
  if (r.includes('FREQ=DAILY')) return 'taeglich'
  if (r.includes('FREQ=WEEKLY')) return r.includes('INTERVAL=2') ? 'zweiwoechentlich' : 'woechentlich'
  if (r.includes('FREQ=MONTHLY')) return 'monatlich'
  if (r.includes('FREQ=YEARLY')) return 'jaehrlich'
  return 'nie'
}

export function TerminEditor({ event, defaultDay, onClose }: {
  event: CalendarEvent | null
  defaultDay?: DayString
  onClose: () => void
}) {
  const m = useMutations()
  const [titel, setTitel] = useState(event?.title ?? '')
  const [ort, setOrt] = useState(event?.location ?? '')
  const [ganztags, setGanztags] = useState(!!event?.all_day)
  const [tag, setTag] = useState(event?.day ?? defaultDay ?? todayString())
  const [endTag, setEndTag] = useState(event?.end_day ?? '')
  const [start, setStart] = useState(event?.start_time ?? naechsteVolleStunde())
  const [ende, setEnde] = useState(event?.end_time ?? plusStunde(event?.start_time ?? naechsteVolleStunde()))
  const [farbe, setFarbe] = useState(event?.color ?? TERMIN_FARBEN[0].value)
  const [wiederholung, setWiederholung] = useState(artAus(event?.rrule ?? null))
  const [wdhBis, setWdhBis] = useState(() => {
    const treffer = event?.rrule?.match(/UNTIL=(\d{4})(\d{2})(\d{2})/)
    return treffer ? `${treffer[1]}-${treffer[2]}-${treffer[3]}` : ''
  })
  const [erinnerung, setErinnerung] = useState(event?.reminder_minutes ?? -1)
  const [notiz, setNotiz] = useState(event?.description ?? '')
  const [loeschen, setLoeschen] = useState(false)

  // Wer die Startzeit nach hinten schiebt, meint fast nie, dass der Termin
  // dadurch kürzer wird – das Ende wandert deshalb mit.
  const startAendern = (neu: string) => {
    if (start && ende && neu) {
      const dauer = timeToMinutes(ende) - timeToMinutes(start)
      if (dauer > 0) setEnde(minutesToTime(Math.min(24 * 60, timeToMinutes(neu) + dauer)))
    }
    setStart(neu)
  }

  const speichern = () => {
    if (!titel.trim()) return
    const nutzung = {
      title: titel.trim(), description: notiz || null, location: ort || null,
      day: tag,
      end_day: endTag && endTag > tag ? endTag : null,
      start_time: ganztags ? null : (start || null),
      end_time: ganztags ? null : (ende || null),
      all_day: ganztags ? 1 : 0,
      timezone: 'Europe/Berlin',
      rrule: rruleAus(wiederholung, tag, wdhBis),
      exdates: event?.exdates ?? null,
      color: farbe, source: 'local', external_uid: event?.external_uid ?? null,
      reminder_minutes: erinnerung >= 0 ? erinnerung : null,
    }
    if (event) m.patch('calendar_events', event.id, nutzung, 'Termin geändert')
    else m.create('calendar_events', nutzung, 'Termin erstellt')
    onClose()
  }

  const dauerText = !ganztags && start && ende && timeToMinutes(ende) > timeToMinutes(start)
    ? `${Math.floor((timeToMinutes(ende) - timeToMinutes(start)) / 60)} Std. ${(timeToMinutes(ende) - timeToMinutes(start)) % 60} Min.`
    : null

  return (
    <Modal open title={event ? 'Termin bearbeiten' : 'Neuer Termin'} onClose={onClose}
      footer={<>
        {event && <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={speichern} disabled={!titel.trim()}>Speichern</button>
      </>}>
      <Field label="Titel">
        <input className="input" value={titel} onChange={(e) => setTitel(e.target.value)}
          placeholder="z. B. Zahnarzt" autoFocus />
      </Field>
      <Field label="Ort">
        <input className="input" value={ort} onChange={(e) => setOrt(e.target.value)} placeholder="freiwillig" />
      </Field>

      <label className="row">
        <input type="checkbox" checked={ganztags} onChange={(e) => setGanztags(e.target.checked)} />
        Ganztägig
      </label>

      <div className="grid grid-2 keep2">
        <Field label="Beginnt am">
          <input className="input" type="date" value={tag} onChange={(e) => setTag(e.target.value)} />
        </Field>
        {!ganztags && (
          <Field label="Uhrzeit">
            <input className="input" type="time" value={start} onChange={(e) => startAendern(e.target.value)} />
          </Field>
        )}
      </div>

      <div className="grid grid-2 keep2">
        <Field label="Endet am" hint="leer lassen für einen eintägigen Termin">
          <input className="input" type="date" value={endTag} min={tag} onChange={(e) => setEndTag(e.target.value)} />
        </Field>
        {!ganztags && (
          <Field label="Bis" hint={dauerText ?? undefined}>
            <input className="input" type="time" value={ende} onChange={(e) => setEnde(e.target.value)} />
          </Field>
        )}
      </div>

      <Field label="Wiederholen">
        <Chips size="sm" value={wiederholung} onChange={(v) => setWiederholung(v as string)}
          options={WIEDERHOLUNGEN} />
        {wiederholung !== 'nie' && (
          <div className="mt8">
            <span className="field-label">Endet am (leer = ohne Ende)</span>
            <input className="input" type="date" value={wdhBis} min={tag}
              onChange={(e) => setWdhBis(e.target.value)} />
          </div>
        )}
      </Field>

      <Field label="Erinnerung"
        hint="Erscheint als Hinweis, solange LifeHub geöffnet ist – ein echter Handy-Alarm ist es nicht.">
        <select className="select" value={erinnerung} onChange={(e) => setErinnerung(Number(e.target.value))}>
          {ERINNERUNGEN.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>

      <Field label="Farbe">
        <div className="chips">
          {TERMIN_FARBEN.map((f) => (
            <button key={f.value} type="button" aria-label={f.label} title={f.label}
              onClick={() => setFarbe(f.value)}
              style={{
                width: 28, height: 28, borderRadius: 9, background: f.value,
                outline: farbe === f.value ? '2px solid var(--text)' : 'none', outlineOffset: 2,
              }} />
          ))}
        </div>
      </Field>

      <Field label="Notizen">
        <textarea className="textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)} />
      </Field>

      {event && (
        <Confirm open={loeschen} title="Termin löschen?"
          message={event.rrule
            ? 'Die ganze Terminserie wandert in den Papierkorb.'
            : 'Der Termin wandert in den Papierkorb.'}
          danger onCancel={() => setLoeschen(false)}
          onConfirm={() => { m.remove('calendar_events', event.id, 'Termin gelöscht'); setLoeschen(false); onClose() }} />
      )}
    </Modal>
  )
}

function naechsteVolleStunde(): string {
  const d = new Date()
  return `${String((d.getHours() + 1) % 24).padStart(2, '0')}:00`
}
function plusStunde(t: string): string {
  if (!t) return ''
  return minutesToTime(Math.min(24 * 60, timeToMinutes(t) + 60))
}
