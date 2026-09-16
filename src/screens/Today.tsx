/**
 * HEUTE – die Morgenansicht.
 *
 * Die Seite beantwortet eine Frage: Was steht heute an? In dieser Reihenfolge:
 *
 *   Termine          als eigenes Band ganz oben (ein verpasster Termin ist der
 *                    teuerste Fehler dieser Seite)
 *   Aufgaben         was heute zu erledigen ist
 *   Tag              Schicht, freie Zeit, Feiertag
 *   Training         was heute geplant ist, sonst wann zuletzt
 *   Ernährung        Fortschritt zum Tagesziel, dazu Schlaf und Gewicht
 *   Geld             eine Zeile: verfügbar, Monatsende, nächste Zahlung
 *   Hinweise         höchstens zwei
 *
 * Finanzen hatten hier früher fünf eigene Karten und damit die halbe Seite.
 * Die ausführlichen Karten gibt es weiterhin – über „Anpassen" zuschaltbar –,
 * aber die Werkseinstellung zeigt Geld nur noch als Zusammenfassung.
 *
 * Die Seitenkennung für gespeicherte Anpassungen ist `heute2`: Die alte
 * Kartenauswahl bezog sich auf eine andere Seite und würde die neue Ordnung
 * sonst sofort wieder mit den früheren Karten füllen.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty } from '../ui/components'
import { usePageLayout, LayoutEditToggle, LayoutEditPanel } from '../ui/pageLayout'
import type { LayoutCardDef } from '../core/layout'
import { Meter } from '../charts'
import { useData, useMutations } from '../state/store'
import {
  accountBalances, availableMoney, netWorth, budgetProgress, expectedIncomeRest, forecastMonth, forecastStatus,
} from '../core/finance'
import { formatMoney, formatNumber } from '../core/money'
import { todayString, formatDay, monthOf, weekdayLong, addDays, formatDuration, holidaysForState, relativeDay } from '../core/dates'
import { tasksForDay, computeCapacity, isOverdue, toggleTaskPatch, progressPatch } from '../core/planner'
import { generateFinanceDayChecklist, financeChecklistRoute } from '../core/financeDay'
import { dayValue, targetFor, evaluateZone, dailySeries, formatMetricValue } from '../core/metrics'
import { darfBewerten, fortschrittProzent } from '../core/tagesfortschritt'
import { generateInsights, STATISTICAL_DISCLAIMER } from '../core/insights'
import { goalProgress } from '../core/goals'
import { currentValueForGoal } from './goalHelpers'
import { nextOccurrence } from '../core/recurrence'
import { TaskEditor } from './Planner'
import { TerminEditor } from './Calendar'
import { TaskDetail, TerminDetail } from '../ui/detailSheet'
import { Icon, BEREICH_FARBE } from '../ui/icons'
import { useAutomatikMeldungen, automatikMeldungVerwerfen } from '../state/meldungen'
import type { CalendarEvent, Metric, Task } from '../core/types'

const CARD_DEFS: LayoutCardDef[] = [
  { id: 'aufgaben', title: 'Aufgaben heute' },
  { id: 'tag', title: 'Dein Tag' },
  { id: 'training', title: 'Training' },
  { id: 'gesundheit', title: 'Ernährung & Gesundheit' },
  { id: 'geld', title: 'Geld' },
  { id: 'hinweise', title: 'Hinweise' },
  // Ausführlich – zuschaltbar, aber nicht in der Werkseinstellung.
  { id: 'budgets', title: 'Budgets', defaultVisible: false },
  { id: 'kommende_zahlungen', title: 'Kommende Zahlungen', defaultVisible: false },
  { id: 'finanzen_konten', title: 'Kontostände', defaultVisible: false },
  { id: 'finanztag_checkliste', title: 'Finanzen: was steht an', defaultVisible: false },
  { id: 'ziele', title: 'Ziele', defaultVisible: false },
]

export function TodayScreen({ navigate, openQuickAdd }: { navigate: (r: string) => void; openQuickAdd: (kind?: any) => void }) {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const month = monthOf(today)
  const meldungen = useAutomatikMeldungen()

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const budgets = useMemo(() => budgetProgress(data.budgets, data.transactions, data.categories, month, today), [data.budgets, data.transactions, data.categories, month, today])

  const assignment = data.dayAssignments.find((a) => !a.deleted_at && a.day === today) ?? null
  const dayType = assignment ? data.dayTypes.find((t) => t.id === assignment.day_type_id) ?? null : null
  const capacity = useMemo(
    () => computeCapacity(today, assignment, dayType, data.timeBlocks, data.tasks, data.events, data.settings.sleep_hours ?? 8),
    [today, assignment, dayType, data.timeBlocks, data.tasks, data.events, data.settings],
  )

  // Dieselbe gemischte Prognose wie auf Finanzen/Übersicht – ein Blick auf
  // beide Seiten soll dieselbe Zahl zeigen, nicht zwei verschiedene Rechnungen.
  const offeneEinnahmen = useMemo(
    () => expectedIncomeRest(data.transactions, data.recurring, month, today),
    [data.transactions, data.recurring, month, today],
  )
  const forecast = useMemo(
    () => forecastMonth(data.transactions, month, today, offeneEinnahmen.cents),
    [data.transactions, month, today, offeneEinnahmen],
  )
  const ampel = useMemo(() => forecastStatus(forecast), [forecast])

  const todayTasks = useMemo(() => tasksForDay(data.tasks, today), [data.tasks, today])
  const openTasks = todayTasks.filter((t) => t.status !== 'done')
  const todayEvents = useMemo(() => data.events.filter((e) => !e.deleted_at && e.day === today), [data.events, today])
  const todayEventsSorted = useMemo(
    () => [...todayEvents].sort((a, b) => (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99')),
    [todayEvents],
  )

  const financeChecklist = useMemo(() => generateFinanceDayChecklist({
    accounts: data.accounts.filter((a) => !a.deleted_at && a.is_active),
    transactions: data.transactions, budgets: data.budgets, categories: data.categories,
    goals: data.goals, recurring: data.recurring, today,
    lastRunOn: data.financeDayRuns.find((r: any) => !r.deleted_at)?.ran_on ?? null,
  }), [data, today])

  const holidays = useMemo(() => holidaysForState(Number(today.slice(0, 4)), data.settings.state ?? 'SN'), [today, data.settings.state])
  const todayHoliday = holidays.find((h) => h.day === today)

  const insights = useMemo(() => generateInsights({
    transactions: data.transactions, categories: data.categories, accounts: data.accounts,
    budgets: data.budgets, recurring: data.recurring, tasks: data.tasks, metrics: data.metrics,
    metricEntries: data.metricEntries, metricTargets: data.metricTargets, today,
  }), [data, today])

  const todaySession = data.workoutSessions.find((s) => !s.deleted_at && s.day === today)
  const planToday = usePlannedWorkout(today)
  const letzteEinheit = useMemo(() => data.workoutSessions
    .filter((s) => !s.deleted_at && s.day < today && s.status === 'completed')
    .sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null, [data.workoutSessions, today])

  const upcomingPayments = useMemo(() => {
    const out: { title: string; day: string; amount: number | null }[] = []
    for (const r of data.recurring) {
      if (r.deleted_at || !r.is_active || r.kind !== 'transaction') continue
      const next = nextOccurrence(r.rrule, r.starts_on, today)
      if (!next) continue
      const days = (new Date(next).getTime() - new Date(today).getTime()) / 86400000
      if (days > 14) continue
      let amount: number | null = null
      try { amount = JSON.parse(r.template_json).amount_cents ?? null } catch { /* ignore */ }
      out.push({ title: r.title, day: next, amount })
    }
    return out.sort((a, b) => (a.day < b.day ? -1 : 1)).slice(0, 4)
  }, [data.recurring, today])

  const activeGoals = data.goals.filter((g) => !g.deleted_at && g.status === 'active')
  const layout = usePageLayout('heute2', CARD_DEFS)

  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const detailTaskAktuell = detailTask ? data.tasks.find((t) => t.id === detailTask.id) ?? detailTask : null
  const detailEventAktuell = detailEvent ? data.events.find((e) => e.id === detailEvent.id) ?? detailEvent : null

  const mehr = (route: string, text = 'Öffnen') => (
    <button className="btn btn-sm btn-ghost" onClick={() => navigate(route)}>{text} <Icon name="pfeil-rechts" size={14} /></button>
  )

  function renderCard(id: string): React.ReactNode {
    switch (id) {
      case 'aufgaben':
        return (
          <Card key={id} title="Aufgaben" icon="plan" farbe={BEREICH_FARBE.plan}
            sub={todayTasks.length ? `${openTasks.length} von ${todayTasks.length} offen` : undefined}
            action={<button className="btn btn-sm btn-ghost" onClick={() => openQuickAdd('task')} aria-label="Aufgabe hinzufügen"><Icon name="plus" size={16} /></button>}>
            {todayTasks.length === 0 ? (
              <Empty kompakt title="Für heute ist nichts geplant." />
            ) : (
              <div className="list kompakt">
                {todayTasks.slice(0, 6).map((t) => (
                  <div key={t.id} className={`list-row${t.status === 'done' ? ' done' : ''}`}>
                    {t.progress_total && t.progress_total > 1 ? (
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn btn-sm btn-ghost" type="button" disabled={(t.progress_done ?? 0) <= 0}
                          onClick={() => m.patch('tasks', t.id, progressPatch(t, -1))} aria-label="Ein Teil weniger fertig">−</button>
                        <span className="mono small" style={{ minWidth: 34, textAlign: 'center' }}>{t.progress_done ?? 0}/{t.progress_total}</span>
                        <button className="btn btn-sm btn-ghost" type="button" disabled={(t.progress_done ?? 0) >= t.progress_total}
                          onClick={() => m.patch('tasks', t.id, progressPatch(t, 1))} aria-label="Ein Teil mehr fertig">+</button>
                      </div>
                    ) : (
                      <button className={`checkbox${t.status === 'done' ? ' checked' : ''}`}
                        onClick={() => m.patch('tasks', t.id, toggleTaskPatch(t))} aria-label="Erledigt">✓</button>
                    )}
                    <button className="list-main" style={{ textAlign: 'left' }} onClick={() => setDetailTask(t)} title="Aufgabe öffnen">
                      <div className="list-title">{t.title}</div>
                      <div className="list-sub">
                        {[
                          t.scheduled_time,
                          t.duration_minutes ? formatDuration(t.duration_minutes) : null,
                          t.priority === 3 ? 'wichtig' : null,
                          isOverdue(t, today) ? 'überfällig' : null,
                        ].filter(Boolean).join(' · ') || 'ohne Dauer'}
                      </div>
                    </button>
                  </div>
                ))}
                {todayTasks.length > 6 && (
                  <button className="list-row small muted" onClick={() => navigate('#/plan')}>+ {todayTasks.length - 6} weitere im Plan</button>
                )}
              </div>
            )}
          </Card>
        )

      case 'tag': {
        const schicht = dayType
          ? `${dayType.name}${dayType.default_start ? ` · ${assignment?.start_override ?? dayType.default_start}–${assignment?.end_override ?? dayType.default_end}` : ''}`
          : null
        return (
          <Card key={id} title="Dein Tag" icon="kalender" farbe={BEREICH_FARBE.plan} action={mehr('#/plan/kalender', 'Kalender')}>
            <div className="kennzeilen">
              <div className="kennzeile"><span className="kennzeile-name">Schicht</span><span className="kennzeile-wert">{schicht ?? 'nicht eingetragen'}</span></div>
              <div className="kennzeile"><span className="kennzeile-name">Termine</span>
                <span className="kennzeile-wert">{todayEvents.length === 0 ? 'keine' : `${todayEvents.length} (oben)`}</span></div>
              <div className="kennzeile"><span className="kennzeile-name">Freie Zeit</span><span className="kennzeile-wert">{formatDuration(capacity.freeMinutes)}</span></div>
              {todayHoliday && <div className="kennzeile"><span className="kennzeile-name">Feiertag</span><span className="kennzeile-wert">{todayHoliday.name}</span></div>}
            </div>
          </Card>
        )
      }

      case 'training':
        return (
          <Card key={id} title="Training" icon="training" farbe={BEREICH_FARBE.tracking} action={mehr('#/tracking/training')}>
            {todaySession ? (
              <div className="row">
                <div className="list-main">
                  <div className="list-title">{todaySession.title}</div>
                  <div className="list-sub">{todaySession.status === 'completed' ? 'erledigt' : todaySession.status === 'rest' ? 'Ruhetag' : 'geplant'}
                    {todaySession.duration_minutes ? ` · ${formatDuration(todaySession.duration_minutes)}` : ''}</div>
                </div>
              </div>
            ) : planToday ? (
              <div className="row">
                <div className="list-main">
                  <div className="list-title">{planToday.title}</div>
                  <div className="list-sub">aus deinem Plan{planToday.focus ? ` · ${planToday.focus}` : ''}</div>
                </div>
                <button className="btn btn-sm" onClick={() => {
                  m.create('workout_sessions', {
                    day: today, plan_day_id: planToday.id, title: planToday.title, type: planToday.focus,
                    started_at: null, ended_at: null, duration_minutes: null,
                    status: 'planned', perceived_effort: null, note: null,
                  }, 'Trainingseinheit angelegt')
                }}>Starten</button>
              </div>
            ) : (
              <Empty kompakt title="Heute kein Training geplant."
                hint={letzteEinheit ? `Zuletzt ${relativeDay(letzteEinheit.day, today)}: ${letzteEinheit.title}` : undefined} />
            )}
          </Card>
        )

      case 'gesundheit':
        return (
          <Card key={id} title="Ernährung & Gesundheit" icon="ernaehrung" farbe={BEREICH_FARBE.tracking} action={mehr('#/tracking')}>
            <KompakteTageswerte day={today} />
            <SchlafUndGewicht day={today} />
          </Card>
        )

      case 'geld': {
        const naechste = upcomingPayments[0]
        return (
          <Card key={id} title="Geld" icon="finanzen" farbe={BEREICH_FARBE.finanzen} action={mehr('#/finanzen', 'Finanzen')}>
            <div className="kennzahlen-reihe">
              <div className="kennzahl">
                <span className="kennzahl-name">Verfügbar</span>
                <span className="kennzahl-wert">{formatMoney(availableMoney(data.accounts, balances), { compact: true })}</span>
              </div>
              <div className="kennzahl">
                <span className="kennzahl-name">Monatsende</span>
                <span className="kennzahl-wert">{formatMoney(forecast.projectedSavings, { compact: true })}</span>
                {ampel.status !== 'green' && (
                  <span className={`kennzahl-zusatz ${ampel.status === 'red' ? 'crit' : 'warn'}`}>{ampel.label}</span>
                )}
              </div>
              <div className="kennzahl">
                <span className="kennzahl-name">Nächste Zahlung</span>
                {naechste ? (
                  <>
                    <span className="kennzahl-wert klein">{naechste.amount !== null ? formatMoney(naechste.amount, { compact: true }) : naechste.title}</span>
                    <span className="kennzahl-zusatz">{naechste.title} · {formatDay(naechste.day, 'short')}</span>
                  </>
                ) : <span className="kennzahl-wert klein muted">keine in 14 Tagen</span>}
              </div>
            </div>
            {budgets.filter((b) => b.status === 'red').slice(0, 2).map((b) => (
              <div key={b.budget.id} className="warnzeile">
                Budget {b.categoryName}: {Math.round(b.usedPercent)} % aufgebraucht
              </div>
            ))}
          </Card>
        )
      }

      case 'hinweise':
        if (insights.length === 0) return null
        return (
          <Card key={id} title="Hinweise" icon="hinweis">
            <div className="stapel eng">
              {insights.slice(0, 2).map((ins, i) => <InsightRow key={i} insight={ins} />)}
            </div>
          </Card>
        )

      case 'budgets':
        if (budgets.length === 0) return null
        return (
          <Card key={id} title="Budgets" icon="finanzen" farbe={BEREICH_FARBE.finanzen} action={mehr('#/finanzen/budgets')}>
            {budgets.slice(0, 4).map((b) => (
              <div key={b.budget.id} className="progress-row">
                <div className="progress-head">
                  <span className="name">{b.categoryName}</span>
                  <span className="val">{formatMoney(b.spent, { compact: true })} / {formatMoney(b.limit, { compact: true })}</span>
                </div>
                <Meter percent={b.usedPercent} status={b.status === 'red' ? 'critical' : b.status === 'amber' ? 'warning' : 'neutral'}
                  markerPercent={b.paceExpectedPercent} />
              </div>
            ))}
          </Card>
        )

      case 'kommende_zahlungen':
        if (upcomingPayments.length === 0) return null
        return (
          <Card key={id} title="Kommende Zahlungen" sub="Nächste 14 Tage" icon="finanzen" farbe={BEREICH_FARBE.finanzen}>
            <div className="list kompakt">
              {upcomingPayments.map((p, i) => (
                <div key={i} className="list-row">
                  <div className="list-main">
                    <div className="list-title">{p.title}</div>
                    <div className="list-sub">{relativeDay(p.day, today)} · {formatDay(p.day, 'short')}</div>
                  </div>
                  {p.amount !== null && <span className="list-amount">{formatMoney(p.amount)}</span>}
                </div>
              ))}
            </div>
          </Card>
        )

      case 'finanzen_konten':
        return (
          <Card key={id} title="Kontostände" icon="finanzen" farbe={BEREICH_FARBE.finanzen}
            sub={`Vermögen ${formatMoney(netWorth(data.accounts, balances), { compact: true })}`} action={mehr('#/finanzen/konten')}>
            <div className="list kompakt">
              {data.accounts.filter((a) => a.is_active && !a.deleted_at).map((a) => (
                <div key={a.id} className="list-row">
                  <div className="list-main"><div className="list-title">{a.name}</div></div>
                  <span className="list-amount">{formatMoney(balances.get(a.id) ?? 0)}</span>
                </div>
              ))}
            </div>
          </Card>
        )

      case 'finanztag_checkliste':
        if (financeChecklist.length === 0) return null
        return (
          <Card key={id} title="Finanzen: was steht an" icon="finanzen" farbe={BEREICH_FARBE.finanzen} action={mehr('#/finanzen/finanztag', 'Finanztag')}>
            <div className="list kompakt">
              {financeChecklist.slice(0, 4).map((i) => {
                const route = financeChecklistRoute(i.action)
                return (
                  <div key={i.key} className="list-row">
                    <div className="list-main">
                      <div className="list-title">{i.title}</div>
                      <div className="list-sub">{i.detail}</div>
                    </div>
                    {route && <button className="btn btn-sm" onClick={() => navigate(route)}>Öffnen</button>}
                  </div>
                )
              })}
            </div>
          </Card>
        )

      case 'ziele':
        if (activeGoals.length === 0) return null
        return (
          <Card key={id} title="Ziele" icon="ziele" farbe={BEREICH_FARBE.ziele} action={mehr('#/ziele')}>
            {activeGoals.slice(0, 3).map((g) => {
              const cur = currentValueForGoal(g, data, balances)
              const p = goalProgress(g, cur, today)
              return (
                <div key={g.id} className="progress-row">
                  <div className="progress-head">
                    <span className="name">{g.name}</span>
                    <span className="val">{Math.round(p.percent)} %</span>
                  </div>
                  <Meter percent={p.percent} farbe="var(--bereich-ziele)" />
                </div>
              )
            })}
          </Card>
        )

      default:
        return null
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting()}</h1>
          <p className="page-sub">
            {weekdayLong(today)}, {formatDay(today)}
            {dayType && <> · {dayType.name}</>}
            {todayHoliday && <> · {todayHoliday.name}</>}
          </p>
        </div>
        <div className="page-actions">
          <LayoutEditToggle editMode={layout.editMode} onToggle={() => layout.setEditMode(!layout.editMode)} />
        </div>
      </div>

      {layout.editMode && (
        <LayoutEditPanel cards={layout.allCards}
          onToggleVisible={layout.toggleVisible} onMoveUp={layout.moveUp} onMoveDown={layout.moveDown}
          onReset={layout.resetLayout} />
      )}

      {/* Was die Automatik von selbst erledigt hat – hier, nicht als Toast auf
          irgendeiner Seite (siehe state/meldungen.ts). */}
      {meldungen.length > 0 && (
        <div className="automatik-meldungen" aria-label="Automatisch erledigt">
          {meldungen.map((mm) => (
            <div key={mm.id} className="automatik-meldung">
              <span className="muted"><Icon name="automatik" size={14} /></span>
              <span className="automatik-text">{mm.text}</span>
              <span className="small muted">{mm.zeit}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => automatikMeldungVerwerfen(mm.id)} aria-label="Meldung ausblenden">
                <Icon name="schliessen" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Termine stehen bewusst VOR den Karten und außerhalb der frei
          sortierbaren Blöcke: So sind sie auf dem Handy ohne Scrollen da –
          egal, wie die Karten sonst angeordnet sind. */}
      <TermineBanner events={todayEventsSorted} onOpen={setDetailEvent}
        onCalendar={() => navigate('#/plan/kalender')} />

      <div className="heute-raster">
        {layout.visibleCards.map((c) => renderCard(c.id))}
      </div>

      {detailTaskAktuell && !editingTask && (
        <TaskDetail task={detailTaskAktuell} today={today}
          onClose={() => setDetailTask(null)}
          onToggle={() => m.patch('tasks', detailTaskAktuell.id, toggleTaskPatch(detailTaskAktuell))}
          onEdit={() => setEditingTask(detailTaskAktuell)} />
      )}
      {detailEventAktuell && !editingEvent && (
        <TerminDetail event={detailEventAktuell} today={today}
          onClose={() => setDetailEvent(null)}
          onEdit={() => setEditingEvent(detailEventAktuell)} />
      )}
      {editingTask && (
        <TaskEditor task={editingTask} onClose={() => { setEditingTask(null); setDetailTask(null) }} />
      )}
      {editingEvent && (
        <TerminEditor event={editingEvent} onClose={() => { setEditingEvent(null); setDetailEvent(null) }} />
      )}
    </div>
  )
}

/**
 * Die Termine des Tages, unübersehbar – aber nicht laut.
 *
 * Bewusst kein `Card`: Eine Karte unter vielen wird überlesen. Die Uhrzeit ist
 * das größte Element der Zeile, weil beim Blick aufs Handy „wann" die Frage
 * ist, nicht „was".
 */
function TermineBanner({ events, onOpen, onCalendar }: {
  events: CalendarEvent[]
  onOpen: (e: CalendarEvent) => void
  onCalendar: () => void
}) {
  if (events.length === 0) return null
  return (
    <section className="termin-band mb16" aria-label="Termine heute">
      <div className="termin-band-kopf">
        <span className="termin-band-titel">
          <Icon name="kalender" size={16} /> {events.length === 1 ? 'Termin heute' : `${events.length} Termine heute`}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={onCalendar}>Kalender <Icon name="pfeil-rechts" size={14} /></button>
      </div>
      <div className="termin-band-liste">
        {events.map((e) => (
          <button key={e.id} className="termin-zeile" onClick={() => onOpen(e)} title={`${e.title} öffnen`}>
            {(e.all_day || e.start_time) && (
              <span className="termin-zeit">
                {e.all_day ? 'ganztägig' : e.start_time}
                {!e.all_day && e.end_time && <span className="termin-zeit-ende">bis {e.end_time}</span>}
              </span>
            )}
            <span className="termin-text">
              <span className="termin-titel">{e.title}</span>
              {(e.location || e.description) && (
                <span className="termin-ort">{[e.location, e.description].filter(Boolean).join(' · ')}</span>
              )}
            </span>
            <span className="termin-pfeil" aria-hidden="true"><Icon name="pfeil-rechts" size={16} /></span>
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * Ein Hinweis: Aussage vorn, Herleitung und Vorbehalt dahinter.
 *
 * Der Satz „statistische Beobachtung … keine medizinische Aussage" stand
 * früher sichtbar unter jedem statistischen Hinweis – auf Heute bis zu viermal
 * untereinander. Er gehört zur Herleitung, nicht zur Aussage.
 */
export function InsightRow({ insight }: { insight: any }) {
  const [open, setOpen] = useState(false)
  const ton = insight.severity === 'warning' ? ' crit' : insight.severity === 'attention' ? ' warn' : ''
  return (
    <div className={`hinweis-zeile${ton}`}>
      <div className="hinweis-titel">{insight.title}</div>
      <div className="small">{insight.body}</div>
      <button className="btn btn-ghost btn-sm hinweis-mehr" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} Wie kommt das zustande?
      </button>
      {open && (
        <div className="hinweis-herleitung small muted">
          {insight.isStatistical && <p>{STATISTICAL_DISCLAIMER}</p>}
          <dl>
            {Object.entries(insight.evidence ?? {}).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

/**
 * Die sechs Tageswerte in einer Zeile – als Fortschritt, nicht als Urteil.
 *
 * Tagsüber zeigt der Balken den Anteil am Tagesziel in der Bereichsfarbe.
 * Statusfarben kommen erst, wenn der Tag bewertbar ist (core/tagesfortschritt).
 */
const KOMPAKT_WERTE = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'water_l']
const KURZNAME: Record<string, string> = {
  calories: 'Kalorien', protein_g: 'Protein', carbs_g: 'Kohlenhydr.', fat_g: 'Fett', fiber_g: 'Ballaststoffe', water_l: 'Wasser',
}

export function KompakteTageswerte({ day }: { day: string }) {
  const data = useData()
  const heute = todayString()
  const stunde = new Date().getHours()
  const werte = useMemo(() => {
    const nachKey = new Map(data.metrics.filter((x) => !x.deleted_at && x.is_enabled).map((x) => [x.key, x]))
    return KOMPAKT_WERTE.map((k) => nachKey.get(k)).filter((x): x is Metric => !!x)
  }, [data.metrics])

  if (werte.length === 0) return <Empty kompakt title="Keine Ernährungswerte eingeschaltet." />

  return (
    <div className="mini-werte">
      {werte.map((metric) => {
        const wert = dayValue(data.metricEntries, metric, day)
        const ziel = targetFor(data.metricTargets, metric.id, day)
        const anteil = fortschrittProzent(wert, ziel?.target_value)
        const bewerten = darfBewerten(metric.aggregation, day, heute, stunde)
        const zone = evaluateZone(wert, ziel)
        const farbe = !bewerten || zone.status === 'unknown' ? 'var(--bereich-tracking)'
          : zone.status === 'optimal' ? 'var(--good)' : zone.status === 'tolerated' ? 'var(--warning)' : 'var(--critical)'
        return (
          <div key={metric.id} className="mini-wert">
            <span className="mini-wert-name">{KURZNAME[metric.key] ?? metric.name}</span>
            <span className="mini-wert-zahl">
              {wert === null ? '–' : formatNumber(wert, metric.decimals)}
              <span className="mini-wert-einheit">{metric.unit}</span>
            </span>
            <Meter percent={anteil ?? 0} farbe={farbe} />
            <span className="mini-wert-ziel">{anteil !== null ? `${anteil} % vom Ziel` : ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

function SchlafUndGewicht({ day }: { day: string }) {
  const data = useData()
  const schlaf = data.metrics.find((x) => x.key === 'sleep_h' && !x.deleted_at)
  const gewicht = data.metrics.find((x) => x.key === 'weight_kg' && !x.deleted_at)
  const schlafWert = schlaf ? dayValue(data.metricEntries, schlaf, day) : null
  // Gewogen wird nicht jeden Tag – dann zählt der letzte Wert der vergangenen zwei Wochen.
  const gewichtWert = useMemo(() => {
    if (!gewicht) return null
    const reihe = dailySeries(data.metricEntries, gewicht, addDays(day, -14), day)
    for (let i = reihe.length - 1; i >= 0; i--) if (reihe[i].value !== null) return reihe[i].value
    return null
  }, [data.metricEntries, gewicht, day])
  if (!schlaf && !gewicht) return null
  return (
    <div className="kennzeilen mt12">
      {schlaf && (
        <div className="kennzeile">
          <span className="kennzeile-name"><Icon name="schlaf" size={14} /> Schlaf</span>
          <span className="kennzeile-wert">{schlafWert === null ? 'nicht eingetragen' : formatMetricValue(schlaf, schlafWert)}</span>
        </div>
      )}
      {gewicht && (
        <div className="kennzeile">
          <span className="kennzeile-name"><Icon name="gewicht" size={14} /> Gewicht</span>
          <span className="kennzeile-wert">{gewichtWert === null ? '–' : `${formatNumber(gewichtWert, gewicht.decimals)} ${gewicht.unit}`}</span>
        </div>
      )}
    </div>
  )
}

export function usePlannedWorkout(day: string) {
  const data = useData()
  return useMemo(() => {
    const plan = data.workoutPlans.find((p) => !p.deleted_at && p.is_active)
    if (!plan) return null
    const anchor = new Date(plan.anchor_date)
    const target = new Date(day)
    const weeksSince = Math.floor((target.getTime() - anchor.getTime()) / (7 * 86400000))
    const weekIndex = ((weeksSince % plan.cycle_weeks) + plan.cycle_weeks) % plan.cycle_weeks
    const weekday = ((target.getDay() + 6) % 7) + 1
    const candidates = data.workoutPlanDays.filter(
      (d) => !d.deleted_at && d.plan_id === plan.id && d.week_index === weekIndex && d.weekday === weekday,
    )
    for (const c of candidates) {
      if (c.frequency === 'biweekly' && weeksSince % 2 !== 0) continue
      return c
    }
    return null
  }, [data.workoutPlans, data.workoutPlanDays, day])
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Gute Nacht'
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Hallo'
  return 'Guten Abend'
}

export function monthLabel(ym: string): string {
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  const [, m] = ym.split('-').map(Number)
  return months[m - 1]
}

export function accountTypeLabel(t: string): string {
  const map: Record<string, string> = {
    checking: 'Girokonto', savings: 'Sparkonto', money_market: 'Tagesgeld',
    credit_card: 'Kreditkarte', depot: 'Depot', cash: 'Bargeld', loan: 'Kredit', custom: 'Sonstiges',
  }
  return map[t] ?? t
}
