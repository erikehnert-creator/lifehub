/**
 * HEUTE – die Morgenansicht.
 * Führt alle Bereiche für den heutigen Tag zusammen: Arbeit, Termine,
 * Aufgaben, Finanzen, Ernährung, Schlaf, Training, Ziele, Hinweise.
 *
 * Welche Karten zu sehen sind und in welcher Reihenfolge, legt jeder für
 * sich über "Anpassen" fest (siehe ui/pageLayout.tsx) – die Liste unten
 * (CARD_DEFS) ist nur die Werkseinstellung, kein Zwang.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Empty, StatusPill, ZonePill } from '../ui/components'
import { usePageLayout, LayoutEditToggle, LayoutEditPanel } from '../ui/pageLayout'
import type { LayoutCardDef } from '../core/layout'
import { Meter, Sparkline, LineChart } from '../charts'
import { useData, useMutations } from '../state/store'
import {
  accountBalances, availableMoney, netWorth, monthTotals, budgetProgress,
  expectedIncomeRest, savingsRateView, forecastMonth,
} from '../core/finance'
import { formatMoney } from '../core/money'
import { todayString, formatDay, monthOf, monthEnd, weekdayLong, addDays, formatDuration, holidaysForState, relativeDay } from '../core/dates'
import { tasksForDay, computeCapacity, isOverdue, toggleTaskPatch, progressPatch } from '../core/planner'
import { generateFinanceDayChecklist, financeChecklistRoute } from '../core/financeDay'
import { dayValue, targetFor, evaluateZone, dailySeries, formatMetricValue } from '../core/metrics'
import { generateInsights, STATISTICAL_DISCLAIMER } from '../core/insights'
import { goalProgress } from '../core/goals'
import { currentValueForGoal } from './goalHelpers'
import { nextOccurrence } from '../core/recurrence'

/** Werkseinstellung der Heute-Seite. Erik will hier vor allem: Aufgaben,
 * Termine mit Uhrzeit, und einen kurzen Finanzblick – der Rest ist weiterhin
 * da, steht aber nicht mehr im Weg, wenn er ihn nicht braucht. */
const CARD_DEFS: LayoutCardDef[] = [
  { id: 'aufgaben', title: 'Aufgaben heute' },
  { id: 'termine', title: 'Termine heute' },
  { id: 'finanzen_kurz', title: 'Finanzen: Kurzüberblick' },
  // Die ausführliche Tagesleiste ist weiterhin da, aber nicht mehr erzwungen –
  // wer nur Aufgaben und Termine sehen will, blendet sie einfach aus.
  { id: 'dein_tag', title: 'Dein Tag', defaultVisible: false },
  { id: 'hinweise', title: 'Hinweise' },
  { id: 'budgets', title: 'Budgets' },
  { id: 'kommende_zahlungen', title: 'Kommende Zahlungen' },
  { id: 'finanzen_konten', title: 'Finanzen: Kontostände' },
  { id: 'ernaehrung', title: 'Ernährung heute' },
  { id: 'schlaf_gewicht', title: 'Schlaf & Gewicht' },
  { id: 'training', title: 'Training' },
  { id: 'ziele', title: 'Ziele' },
  { id: 'finanztag_checkliste', title: 'Finanzen: was steht an' },
]

export function TodayScreen({ navigate, openQuickAdd }: { navigate: (r: string) => void; openQuickAdd: (kind?: any) => void }) {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const month = monthOf(today)

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const totals = useMemo(() => monthTotals(data.transactions, month), [data.transactions, month])
  const budgets = useMemo(() => budgetProgress(data.budgets, data.transactions, data.categories, month, today), [data.budgets, data.transactions, data.categories, month, today])

  const assignment = data.dayAssignments.find((a) => !a.deleted_at && a.day === today) ?? null
  const dayType = assignment ? data.dayTypes.find((t) => t.id === assignment.day_type_id) ?? null : null
  const capacity = useMemo(
    () => computeCapacity(today, assignment, dayType, data.timeBlocks, data.tasks, data.events, data.settings.sleep_hours ?? 8),
    [today, assignment, dayType, data.timeBlocks, data.tasks, data.events, data.settings],
  )

  // Das Gehalt kommt erst am Monatsende – ohne die erwarteten Einnahmen stünde
  // hier Anfang des Monats eine Sparquote von „unter −100 %".
  const offeneEinnahmen = useMemo(
    () => expectedIncomeRest(data.transactions, data.recurring, month, today),
    [data.transactions, data.recurring, month, today],
  )
  const quote = useMemo(
    () => savingsRateView(totals, offeneEinnahmen.cents, true, offeneEinnahmen.quelle, offeneEinnahmen.regel),
    [totals, offeneEinnahmen],
  )
  // Dieselbe gemischte Prognose wie auf Finanzen/Übersicht – ein Blick auf
  // beide Seiten soll dieselbe Zahl zeigen, nicht zwei verschiedene Rechnungen.
  const forecast = useMemo(
    () => forecastMonth(data.transactions, month, today, offeneEinnahmen.cents),
    [data.transactions, month, today, offeneEinnahmen],
  )

  const todayTasks = useMemo(() => tasksForDay(data.tasks, today), [data.tasks, today])
  const openTasks = todayTasks.filter((t) => t.status !== 'done')
  const todayEvents = useMemo(() => data.events.filter((e) => !e.deleted_at && e.day === today), [data.events, today])
  const todayEventsSorted = useMemo(
    () => [...todayEvents].sort((a, b) => (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99')),
    [todayEvents],
  )

  // Was der Finanztag anmerken würde – hier nur zum Draufschauen, nicht als
  // eigene Aufgabe. Dieselbe Berechnung wie auf Finanzen/Finanztag, damit
  // beide Stellen dieselbe Liste zeigen.
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

  const nutritionMetrics = data.metrics.filter((x) => x.group_key === 'nutrition' && x.is_enabled)
  const sleepMetric = data.metrics.find((x) => x.key === 'sleep_h')
  const weightMetric = data.metrics.find((x) => x.key === 'weight_kg')

  const todaySession = data.workoutSessions.find((s) => !s.deleted_at && s.day === today)
  const planToday = usePlannedWorkout(today)

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

  const layout = usePageLayout('heute', CARD_DEFS)

  /** Rendert eine Karte anhand ihrer ID – oder null, wenn es gerade nichts zu zeigen gibt. */
  function renderCard(id: string): React.ReactNode {
    switch (id) {
      case 'aufgaben':
        return (
          <Card key={id} title="Aufgaben heute" sub={`${openTasks.length} offen von ${todayTasks.length}`}
            action={<button className="btn btn-sm" onClick={() => openQuickAdd('task')}>+</button>}>
            {todayTasks.length === 0 ? (
              <Empty icon="✅" title="Nichts für heute geplant" hint="Genieß den freien Kopf – oder hol dir etwas aus der Inbox." />
            ) : (
              <div className="list">
                {todayTasks.slice(0, 8).map((t) => (
                  <div key={t.id} className={`list-row${t.status === 'done' ? ' task-done' : ''}`}>
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
                        onClick={() => m.patch('tasks', t.id, toggleTaskPatch(t))}>✓</button>
                    )}
                    <div className="list-main">
                      <div className="list-title">{t.title}</div>
                      <div className="list-sub">
                        {t.duration_minutes ? formatDuration(t.duration_minutes) : 'ohne Dauer'}
                        {t.priority === 3 && ' · hohe Priorität'}
                        {isOverdue(t, today) && ' · überfällig'}
                      </div>
                    </div>
                    {t.scheduled_time && <span className="small muted mono">{t.scheduled_time}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )

      case 'termine':
        return (
          <Card key={id} title="Termine heute" sub={todayEvents.length ? `${todayEvents.length} heute` : undefined}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/plan/kalender')}>Kalender →</button>}>
            {todayEvents.length === 0 ? (
              <Empty icon="🗓️" title="Keine Termine heute" />
            ) : (
              <div className="list">
                {todayEventsSorted.map((e) => (
                  <div key={e.id} className="list-row">
                    <div className="list-main">
                      <div className="list-title">{e.title}</div>
                      {e.location && <div className="list-sub">{e.location}</div>}
                    </div>
                    <span className="small muted mono">
                      {e.all_day ? 'ganztägig' : e.start_time ? `${e.start_time}${e.end_time ? '–' + e.end_time : ''}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )

      case 'finanzen_kurz':
        return (
          <Card key={id} title="Finanzen: Kurzüberblick" sub={monthLabel(month)}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen')}>Alle →</button>}>
            <div className="grid grid-2 keep2" style={{ gap: 10 }}>
              <Stat small label="Verfügbar" value={formatMoney(availableMoney(data.accounts, balances), { compact: true })} />
              <Stat small label={`Ausgaben ${monthLabel(month)}`} value={formatMoney(totals.expense, { compact: true })} />
              <Stat small label="Monatsprognose" value={formatMoney(forecast.projectedSavings, { compact: true })}
                sub="bleiben voraussichtlich übrig" />
              <Stat small label={quote.expected ? 'Sparquote · erwartet' : 'Sparquote'}
                value={quote.defined ? quote.text.replace(' erwartet', '') : '–'}
                delta={`${quote.savings >= 0 ? '↑' : '↓'} ${formatMoney(Math.abs(quote.savings), { compact: true })}`}
                deltaKind={quote.savings >= 0 ? 'up' : 'down'} />
            </div>
          </Card>
        )

      case 'dein_tag':
        return (
          <Card key={id} title="Dein Tag"
            sub={dayType ? `${dayType.name}${dayType.default_start ? ` · ${assignment?.start_override ?? dayType.default_start}–${assignment?.end_override ?? dayType.default_end}` : ''}` : 'Kein Tagestyp gesetzt'}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/plan')}>Planer →</button>}>
            <DayTimeline capacity={capacity} events={todayEvents} tasks={openTasks} dayType={dayType} assignment={assignment} />
          </Card>
        )

      case 'hinweise':
        if (insights.length === 0) return null
        return (
          <Card key={id} title="Hinweise" sub="Aus deinen eigenen Daten berechnet">
            {insights.slice(0, 4).map((ins, i) => <InsightRow key={i} insight={ins} />)}
          </Card>
        )

      case 'budgets':
        if (budgets.length === 0) return null
        return (
          <Card key={id} title="Budgets" sub={monthLabel(month)}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen/budgets')}>→</button>}>
            {budgets.slice(0, 4).map((b) => (
              <div key={b.budget.id} className="progress-row">
                <div className="progress-head">
                  <span className="name">{b.categoryName}</span>
                  <StatusPill status={b.status}>{Math.round(b.usedPercent)} %</StatusPill>
                  <span className="val">{formatMoney(b.spent, { compact: true })} / {formatMoney(b.limit, { compact: true })}</span>
                </div>
                <Meter percent={b.usedPercent} status={b.status === 'red' ? 'critical' : b.status === 'amber' ? 'warning' : 'good'}
                  markerPercent={b.paceExpectedPercent} />
              </div>
            ))}
          </Card>
        )

      case 'kommende_zahlungen':
        if (upcomingPayments.length === 0) return null
        return (
          <Card key={id} title="Kommende Zahlungen" sub="Nächste 14 Tage">
            <div className="list">
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
          <Card key={id} title="Finanzen: Kontostände"
            sub={`Verfügbar ${formatMoney(availableMoney(data.accounts, balances), { compact: true })} · Vermögen ${formatMoney(netWorth(data.accounts, balances), { compact: true })}`}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen')}>Alle →</button>}>
            <div className="list">
              {data.accounts.filter((a) => a.is_active).map((a) => (
                <div key={a.id} className="list-row">
                  <span className="avatar">{a.icon ?? '💳'}</span>
                  <div className="list-main">
                    <div className="list-title">{a.name}</div>
                    <div className="list-sub">{accountTypeLabel(a.type)}</div>
                  </div>
                  <span className="list-amount">{formatMoney(balances.get(a.id) ?? 0)}</span>
                </div>
              ))}
            </div>
          </Card>
        )

      case 'ernaehrung':
        if (nutritionMetrics.length === 0) return null
        return (
          <Card key={id} title="Ernährung heute" action={<button className="btn btn-sm" onClick={() => navigate('#/tracking')}>Eintragen</button>}>
            <div className="grid grid-2 keep2" style={{ gap: 10 }}>
              {nutritionMetrics.slice(0, 4).map((metric) => {
                const v = dayValue(data.metricEntries, metric, today)
                const target = targetFor(data.metricTargets, metric.id, today)
                const zone = evaluateZone(v, target)
                return (
                  <div key={metric.id}>
                    <div className="small muted">{metric.name}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 19, fontWeight: 700 }}>
                        {v === null ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: metric.decimals })}
                      </span>
                      <span className="small muted">{metric.unit}</span>
                    </div>
                    {target?.target_value != null && (
                      <>
                        <Meter percent={v === null ? 0 : (v / (target.target_value || 1)) * 100}
                          status={zone.status === 'optimal' ? 'good' : zone.status === 'tolerated' ? 'warning' : 'critical'} />
                        <div className="small muted mt8">Ziel {target.target_value}{target.tolerance_plus ? ` ±${target.tolerance_plus}` : ''} {metric.unit}</div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )

      case 'schlaf_gewicht':
        if (!sleepMetric && !weightMetric) return null
        return (
          <div key={id} className="grid grid-2 keep2">
            {sleepMetric && <MetricMiniCard metricKey="sleep_h" title="Schlaf letzte Nacht" />}
            {weightMetric && <MetricMiniCard metricKey="weight_kg" title="Gewicht" />}
          </div>
        )

      case 'training':
        return (
          <Card key={id} title="Training" action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/tracking/training')}>→</button>}>
            {todaySession ? (
              <div>
                <div style={{ fontWeight: 600 }}>{todaySession.title}</div>
                <div className="small muted">{todaySession.status === 'completed' ? '✓ abgeschlossen' : todaySession.status === 'rest' ? '😴 Ruhetag' : 'geplant'}</div>
              </div>
            ) : planToday ? (
              <div>
                <div style={{ fontWeight: 600 }}>{planToday.title}</div>
                <div className="small muted">aus deinem Plan · {planToday.focus}</div>
                <button className="btn btn-sm mt8" onClick={() => {
                  m.create('workout_sessions', {
                    day: today, plan_day_id: planToday.id, title: planToday.title, type: planToday.focus,
                    started_at: null, ended_at: null, duration_minutes: null,
                    status: 'planned', perceived_effort: null, note: null,
                  }, 'Trainingseinheit angelegt')
                }}>Einheit starten</button>
              </div>
            ) : (
              <div className="small muted">Heute kein Training im Plan.</div>
            )}
          </Card>
        )

      case 'ziele':
        if (activeGoals.length === 0) return null
        return (
          <Card key={id} title="Ziele" action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/ziele')}>→</button>}>
            {activeGoals.slice(0, 3).map((g) => {
              const cur = currentValueForGoal(g, data, balances)
              const p = goalProgress(g, cur, today)
              return (
                <div key={g.id} className="progress-row">
                  <div className="progress-head">
                    <span className="name">{g.icon} {g.name}</span>
                    <span className="val">{Math.round(p.percent)} %</span>
                  </div>
                  <Meter percent={p.percent} status={p.pace === 'behind' ? 'warning' : 'good'} />
                </div>
              )
            })}
          </Card>
        )

      case 'finanztag_checkliste':
        if (financeChecklist.length === 0) return null
        return (
          <Card key={id} title="Finanzen: was steht an"
            sub="Automatisch erkannt aus deinen Finanzdaten – keine eigenen Aufgaben"
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen/finanztag')}>Finanztag →</button>}>
            <div className="list">
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
            {dayType && <> · <strong style={{ color: dayType.color ?? undefined }}>{dayType.name}</strong></>}
            {todayHoliday && <> · 🎉 {todayHoliday.name}</>}
          </p>
        </div>
        <div className="page-actions">
          <LayoutEditToggle editMode={layout.editMode} onToggle={() => layout.setEditMode(!layout.editMode)} />
          <button className="btn btn-primary" onClick={() => openQuickAdd()}>+ Erfassen</button>
        </div>
      </div>

      {layout.editMode && (
        <LayoutEditPanel cards={layout.allCards}
          onToggleVisible={layout.toggleVisible} onMoveUp={layout.moveUp} onMoveDown={layout.moveDown}
          onReset={layout.resetLayout} />
      )}

      <div className="grid grid-2">
        {layout.visibleCards.map((c) => renderCard(c.id))}
      </div>
    </div>
  )
}

export function InsightRow({ insight }: { insight: any }) {
  const [open, setOpen] = useState(false)
  const cls = insight.severity === 'warning' ? 'crit' : insight.severity === 'attention' ? 'warn' : ''
  return (
    <div className={`hint-box ${cls === 'crit' ? 'crit' : cls === 'warn' ? 'warn' : ''} mb8`}>
      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{insight.title}</div>
      <div>{insight.body}</div>
      {insight.isStatistical && <div className="small muted mt8">{STATISTICAL_DISCLAIMER}</div>}
      <button className="btn btn-ghost btn-sm mt8" style={{ paddingLeft: 0 }} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Wie kommt das zustande?
      </button>
      {open && (
        <pre style={{ fontSize: 11.5, overflowX: 'auto', background: 'var(--surface)', padding: 10, borderRadius: 8, marginTop: 6 }}>
          {JSON.stringify(insight.evidence, null, 2)}
        </pre>
      )}
    </div>
  )
}

function MetricMiniCard({ metricKey, title }: { metricKey: string; title: string }) {
  const data = useData()
  const today = todayString()
  const metric = data.metrics.find((x) => x.key === metricKey)
  if (!metric) return null
  const v = dayValue(data.metricEntries, metric, today)
  const series = dailySeries(data.metricEntries, metric, addDays(today, -20), today)
  const target = targetFor(data.metricTargets, metric.id, today)
  const zone = evaluateZone(v, target)
  return (
    <Card title={title}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 700 }}>
          {v === null ? '–' : metric.key === 'sleep_h' ? formatMetricValue(metric, v) : v.toLocaleString('de-DE', { maximumFractionDigits: metric.decimals })}
        </span>
        {metric.key !== 'sleep_h' && <span className="small muted">{metric.unit}</span>}
      </div>
      <Sparkline values={series.map((s) => s.value)} color={metric.color ?? 'var(--series-1)'} />
      {target && <div className="mt8"><ZonePill status={zone.status} /></div>}
    </Card>
  )
}

function DayTimeline({ capacity, events, tasks, dayType, assignment }: any) {
  const blocks: { start: string; end: string; label: string; color: string }[] = []
  if (dayType && (dayType.kind === 'work' || dayType.kind === 'school')) {
    const s = assignment?.start_override ?? dayType.default_start
    const e = assignment?.end_override ?? dayType.default_end
    if (s && e) blocks.push({ start: s, end: e, label: dayType.name, color: dayType.color ?? 'var(--series-1)' })
  }
  for (const ev of events) {
    if (ev.start_time && ev.end_time) blocks.push({ start: ev.start_time, end: ev.end_time, label: ev.title, color: 'var(--series-3)' })
  }
  blocks.sort((a, b) => (a.start < b.start ? -1 : 1))

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
        <Stat small label="Verplant" value={formatDuration(capacity.plannedMinutes)} />
        <Stat small label="Aufgaben" value={formatDuration(capacity.taskMinutes)} />
        <Stat small label="Frei" value={formatDuration(capacity.freeMinutes)} />
      </div>
      <div className="meter" style={{ height: 12 }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: `${(capacity.plannedMinutes / capacity.wakingMinutes) * 100}%`, background: 'var(--series-1)' }} />
          <div style={{ width: `${(capacity.taskMinutes / capacity.wakingMinutes) * 100}%`, background: 'var(--series-3)', marginLeft: 2 }} />
        </div>
      </div>
      <div className="legend">
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-1)' }} />Termine & Arbeit</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-3)' }} />Aufgaben</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--surface-2)' }} />frei</span>
      </div>
      {blocks.length > 0 && (
        <div className="list mt12">
          {blocks.map((b, i) => (
            <div key={i} className="list-row">
              <span className="dot" style={{ background: b.color }} />
              <div className="list-main">
                <div className="list-title">{b.label}</div>
              </div>
              <span className="small muted mono">{b.start}–{b.end}</span>
            </div>
          ))}
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
