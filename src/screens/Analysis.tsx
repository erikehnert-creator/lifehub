/**
 * ANALYSEN – Entwicklungen über Tag, Woche, Monat, Jahr; Jahresübersicht;
 * Zusammenhänge; automatische Hinweise.
 *
 * Grundsatz: Ein statistischer Zusammenhang ist keine Ursache. Die Oberfläche
 * sagt das ausdrücklich, statt es dem Zufall zu überlassen.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Tabs, Segment, Empty, Collapsible, StatusPill } from '../ui/components'
import { LineChart, BarChart, YearHeatmap, RankBars, seriesColor } from '../charts'
import { useData } from '../state/store'
import {
  monthTotals, monthTotalsErwartet, monthlySeries, netWorthSeries, totalsByCategory, accountBalances, formatSavingsRate,
  expectedIncomeRest, forecastMonth, forecastStatus, ohneLeerenAnfang,
} from '../core/finance'
import { dailySeries, correlation, correlationLabel, aggregate, groupSeries, formatMetricValue } from '../core/metrics'
import { generateInsights, STATISTICAL_DISCLAIMER } from '../core/insights'
import { ZeitversetzteZusammenhaenge } from './Zusammenhaenge'
import { formatMoney, formatNumber, toEuro } from '../core/money'
import {
  todayString, monthOf, lastMonths, monthLabelShort, formatMonth, addDays,
  monthStart, monthEnd, formatDay, daysInRange,
} from '../core/dates'

export function AnalysisScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  // Der Reiter "Hinweise" zeigte dieselben Karten wie Heute. Die Adresse bleibt
  // gültig und führt auf den Überblick.
  const reiter = sub === 'hinweise' ? '' : sub
  const tabs = [
    { key: '', label: 'Überblick' },
    { key: 'jahr', label: 'Jahresübersicht' },
    { key: 'zusammenhaenge', label: 'Zusammenhänge' },
  ]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Analysen</div>
        </div>
      </div>
      <Tabs tabs={tabs} active={reiter} onChange={(k) => navigate(`#/analysen${k ? '/' + k : ''}`)} />
      {reiter === '' && <OverviewTab />}
      {reiter === 'jahr' && <YearTab />}
      {reiter === 'zusammenhaenge' && <CorrelationTab />}
    </div>
  )
}

/* ------------------------------------------------------------- Überblick */

function OverviewTab() {
  const data = useData()
  const today = todayString()
  const [months, setMonths] = useState(12)
  const list = useMemo(() => lastMonths(monthOf(today), months), [today, months])

  const finance = useMemo(() => monthlySeries(data.transactions, list), [data.transactions, list])
  const worth = useMemo(() => netWorthSeries(data.accounts, data.transactions, list), [data.accounts, data.transactions, list])
  // Erwartete, noch nicht gebuchte Einnahmen (z. B. Gehalt vor dem Zahltag) sind
  // mitgerechnet – sonst widerspricht diese Kachel der Sparquote auf Heute/Finanzen.
  const cur = useMemo(() => monthTotalsErwartet(data.transactions, data.recurring, monthOf(today), today), [data.transactions, data.recurring, today])

  // Statt des schlichten „Sparbetrag bisher" (der Mitte des Monats zu optimistisch
  // wirkt, weil er dem bisherigen Ausgeben die volle Monatseinnahme gegenüberstellt)
  // zeigt die Kachel die Monatsprognose – dieselbe Hochrechnung wie auf Finanzen/Heute.
  const offeneEinnahmen = useMemo(
    () => expectedIncomeRest(data.transactions, data.recurring, monthOf(today), today),
    [data.transactions, data.recurring, today],
  )
  const forecast = useMemo(
    () => forecastMonth(data.transactions, monthOf(today), today, offeneEinnahmen.cents),
    [data.transactions, today, offeneEinnahmen],
  )
  const ampel = useMemo(() => forecastStatus(forecast), [forecast])

  const metricCards = data.metrics.filter((m) => !m.deleted_at && m.is_enabled).slice(0, 6)
  const from = addDays(today, -(months * 30))

  const tasksDone = useMemo(() => {
    const out: { label: string; values: number[] }[] = []
    for (const mth of list) {
      const n = data.tasks.filter((t) => !t.deleted_at && t.completed_at && monthOf(t.completed_at.slice(0, 10)) === mth).length
      out.push({ label: monthLabelShort(mth), values: [n] })
    }
    return out
  }, [data.tasks, list])

  const training = useMemo(() => {
    const out: { label: string; values: number[] }[] = []
    for (const mth of list) {
      const n = data.workoutSessions.filter((s) => !s.deleted_at && s.status === 'completed' && monthOf(s.day) === mth).length
      out.push({ label: monthLabelShort(mth), values: [n] })
    }
    return out
  }, [data.workoutSessions, list])

  // Kennzahlen über den gewählten Zeitraum und über alle Bereiche. Vorher
  // standen hier vier Finanzkacheln des laufenden Monats - dieselben Zahlen wie
  // auf Finanzen und Heute, nur an dritter Stelle.
  const summe = (reihe: { values: number[] }[]) => reihe.reduce((s, r) => s + (r.values[0] ?? 0), 0)
  const ausgabenSumme = finance.reduce((s, f) => s + f.expense, 0)
  const sparSumme = finance.reduce((s, f) => s + f.savings, 0)
  const aufgabenSumme = summe(tasksDone)
  const trainingSumme = summe(training)
  const finanzReihe = ohneLeerenAnfang(finance, (f) => f.income === 0 && f.expense === 0)
  const vermoegenReihe = worth.filter((w) => !finanzReihe.length || w.month >= finanzReihe[0].month)

  return (
    <>
      <div className="row mb16">
        <Segment label="Zeitraum" value={String(months)} onChange={(v) => setMonths(Number(v))}
          options={[{ value: '6', label: '6 Monate' }, { value: '12', label: '12 Monate' }, { value: '24', label: '24 Monate' }]} />
      </div>

      <Card className="mb16" title={`Im Zeitraum · ${months} Monate`} icon="analysen">
        <div className="kennzahlen-reihe vier">
          <div className="kennzahl">
            <span className="kennzahl-name">Ausgegeben</span>
            <span className="kennzahl-wert">{formatMoney(ausgabenSumme, { compact: true })}</span>
          </div>
          <div className="kennzahl">
            <span className="kennzahl-name">Gespart</span>
            <span className="kennzahl-wert">{formatMoney(sparSumme, { compact: true })}</span>
          </div>
          <div className="kennzahl">
            <span className="kennzahl-name">Aufgaben erledigt</span>
            <span className="kennzahl-wert">{aufgabenSumme.toLocaleString('de-DE')}</span>
          </div>
          <div className="kennzahl">
            <span className="kennzahl-name">Trainingseinheiten</span>
            <span className="kennzahl-wert">{trainingSumme.toLocaleString('de-DE')}</span>
          </div>
        </div>
      </Card>

      <div className="karten-spalten">
        <Card title="Finanzen" sub="Einnahmen und Ausgaben je Monat" icon="finanzen">
          <BarChart data={finanzReihe.map((f) => ({ label: monthLabelShort(f.month), values: [f.income, f.expense] }))}
            seriesNames={['Einnahmen', 'Ausgaben']} formatValue={(v) => formatMoney(v, { compact: true })} />
        </Card>
        <Card title="Vermögen" sub="Monatsende" icon="finanzen">
          <LineChart series={[{ name: 'Vermögen', points: vermoegenReihe.map((w) => ({ label: monthLabelShort(w.month), value: toEuro(w.value) })) }]}
            formatValue={(v) => formatMoney(Math.round(v * 100), { compact: true })} />
        </Card>

        {/* Ein Diagramm ohne einen einzigen Wert zeigt nichts und nimmt trotzdem
            eine halbe Seite - es erscheint erst, wenn es etwas zu zeigen gibt. */}
        {aufgabenSumme > 0 && (
          <Card title="Erledigte Aufgaben" sub="pro Monat" icon="aufgaben">
            <BarChart data={tasksDone} seriesNames={['Aufgaben']} formatValue={(v) => String(Math.round(v))} />
          </Card>
        )}
        {trainingSumme > 0 && (
          <Card title="Trainingseinheiten" sub="pro Monat" icon="training">
            <BarChart data={training} seriesNames={['Einheiten']} formatValue={(v) => String(Math.round(v))} />
          </Card>
        )}
        {metricCards.map((metric) => {
          const points = dailySeries(data.metricEntries, metric, from, today)
          const monthly = groupSeries(points, 'month', metric.aggregation === 'sum' ? 'avg' : metric.aggregation)
          if (monthly.length < 2) return null
          return (
            <Card key={metric.id} title={metric.name} sub={`Monatsmittel · ${metric.unit}`} icon="tracking">
              <LineChart series={[{ name: metric.name, points: monthly.map((p) => ({ label: monthLabelShort(p.label), value: p.value })) }]}
                formatValue={(v) => formatMetricValue(metric, v)} showArea={false} />
            </Card>
          )
        })}
      </div>
    </>
  )
}

/* -------------------------------------------------------- Jahresübersicht */

function YearTab() {
  const data = useData()
  const today = todayString()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [layer, setLayer] = useState<'work' | 'training' | 'tracking' | 'spending'>('work')

  const dayTypeById = useMemo(() => new Map(data.dayTypes.map((t) => [t.id, t])), [data.dayTypes])

  const values = useMemo(() => {
    const map = new Map<string, number>()
    if (layer === 'work') {
      for (const a of data.dayAssignments) {
        if (a.deleted_at || a.day.slice(0, 4) !== String(year)) continue
        const t = dayTypeById.get(a.day_type_id)
        if (!t) continue
        const code = ['work', 'school', 'vacation', 'off', 'sick'].indexOf(t.kind)
        map.set(a.day, code + 1)
      }
    } else if (layer === 'training') {
      for (const s of data.workoutSessions) {
        if (s.deleted_at || s.status !== 'completed' || s.day.slice(0, 4) !== String(year)) continue
        map.set(s.day, (map.get(s.day) ?? 0) + 1)
      }
    } else if (layer === 'tracking') {
      for (const e of data.metricEntries) {
        if (e.deleted_at || e.day.slice(0, 4) !== String(year) || e.value_num === null) continue
        map.set(e.day, (map.get(e.day) ?? 0) + 1)
      }
    } else {
      for (const t of data.transactions) {
        if (t.deleted_at || t.type !== 'expense' || t.booked_on.slice(0, 4) !== String(year)) continue
        map.set(t.booked_on, (map.get(t.booked_on) ?? 0) + t.amount_cents)
      }
    }
    return map
  }, [data, year, layer, dayTypeById])

  const colorFor = (v: number | undefined): string => {
    if (v === undefined) return 'var(--surface-2)'
    if (layer === 'work') {
      return ['var(--series-1)', 'var(--series-4)', 'var(--series-3)', 'var(--series-6)', 'var(--series-5)'][v - 1] ?? 'var(--surface-3)'
    }
    if (layer === 'spending') {
      const scale = [1000, 3000, 6000, 12000]
      const step = scale.findIndex((s) => v <= s)
      return ['var(--seq-200)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)'][step === -1 ? 4 : step]
    }
    const step = Math.min(4, Math.max(0, v - 1))
    return ['var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-700)'][step]
  }

  const legend = layer === 'work'
    ? [
        { label: 'Arbeit', color: 'var(--series-1)' },
        { label: 'Schule', color: 'var(--series-4)' },
        { label: 'Urlaub', color: 'var(--series-3)' },
        { label: 'Frei', color: 'var(--series-6)' },
        { label: 'Krank', color: 'var(--series-5)' },
      ]
    : [
        { label: 'wenig', color: 'var(--seq-200)' },
        { label: 'mittel', color: 'var(--seq-400)' },
        { label: 'viel', color: 'var(--seq-700)' },
      ]

  const yearMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const finance = useMemo(() => monthlySeries(data.transactions, yearMonths), [data.transactions, yearMonths])
  const yearTotals = finance.reduce((acc, f) => ({
    income: acc.income + f.income, expense: acc.expense + f.expense, savings: acc.savings + f.savings,
  }), { income: 0, expense: 0, savings: 0 })

  const workdays = data.dayAssignments.filter((a) => !a.deleted_at && a.day.slice(0, 4) === String(year))
  const countKind = (kind: string) => workdays.filter((a) => dayTypeById.get(a.day_type_id)?.kind === kind).length

  return (
    <>
      <div className="row mb16">
        <button className="btn btn-sm" onClick={() => setYear(year - 1)}>←</button>
        <strong style={{ minWidth: 60, textAlign: 'center' }}>{year}</strong>
        <button className="btn btn-sm" onClick={() => setYear(year + 1)}>→</button>
        <span style={{ flex: 1 }} />
        <div className="chips">
          {[
            { key: 'work', label: 'Arbeit & Urlaub' },
            { key: 'training', label: 'Training' },
            { key: 'tracking', label: 'Tracking' },
            { key: 'spending', label: 'Ausgaben' },
          ].map((l) => (
            <button key={l.key} className={`chip sm ${layer === l.key ? 'active' : ''}`} onClick={() => setLayer(l.key as any)}>{l.label}</button>
          ))}
        </div>
      </div>

      <Card className="mb16" title={`Jahr ${year}`} sub="Jede Zelle ist ein Tag">
        <div className="scroll-x">
          <YearHeatmap year={year} values={values} colorFor={colorFor} legend={legend} />
        </div>
      </Card>

      <div className="grid grid-4 keep2 mb16">
        <Card><Stat label="Einnahmen" value={formatMoney(yearTotals.income, { compact: true })} /></Card>
        <Card><Stat label="Ausgaben" value={formatMoney(yearTotals.expense, { compact: true })} /></Card>
        <Card><Stat label="Sparbetrag" value={formatMoney(yearTotals.savings, { compact: true })} /></Card>
        <Card><Stat label="Sparquote" value={`${yearTotals.income ? Math.round((yearTotals.savings / yearTotals.income) * 1000) / 10 : 0} %`} /></Card>
      </div>

      <div className="grid grid-4 keep2 mb16">
        <Card><Stat label="Arbeitstage" value={String(countKind('work'))} /></Card>
        <Card><Stat label="Berufsschule" value={String(countKind('school'))} /></Card>
        <Card><Stat label="Urlaubstage" value={String(countKind('vacation'))} /></Card>
        <Card><Stat label="Trainingstage" value={String(data.workoutSessions.filter((s) => !s.deleted_at && s.status === 'completed' && s.day.slice(0, 4) === String(year)).length)} /></Card>
      </div>

      <Card title="Monatsverlauf" sub={`Einnahmen und Ausgaben ${year}`}>
        <BarChart data={finance.map((f) => ({ label: monthLabelShort(f.month), values: [f.income, f.expense] }))}
          seriesNames={['Einnahmen', 'Ausgaben']} formatValue={(v) => formatMoney(v, { compact: true })} />
      </Card>
    </>
  )
}

/* ------------------------------------------------------- Zusammenhänge */

function CorrelationTab() {
  const data = useData()
  const today = todayString()
  const [days, setDays] = useState(90)
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')

  const metrics = data.metrics.filter((m) => !m.deleted_at && m.is_enabled)
  const from = addDays(today, -(days - 1))

  const metricA = metrics.find((m) => m.id === aId) ?? metrics[0]
  const metricB = metrics.find((m) => m.id === bId) ?? metrics[1]

  const result = useMemo(() => {
    if (!metricA || !metricB || metricA.id === metricB.id) return null
    const sa = dailySeries(data.metricEntries, metricA, from, today)
    const sb = dailySeries(data.metricEntries, metricB, from, today)
    return { ...correlation(sa, sb), sa, sb }
  }, [metricA, metricB, data.metricEntries, from, today])

  // Vorberechnete, häufig interessante Paare
  const pairs = useMemo(() => {
    const wanted: [string, string][] = [
      ['sleep_h', 'energy'], ['sleep_h', 'skin'], ['steps', 'sleep_h'],
      ['calories', 'weight_kg'], ['protein_g', 'weight_kg'], ['water_l', 'energy'],
    ]
    const out: { a: string; b: string; r: number; n: number }[] = []
    for (const [ka, kb] of wanted) {
      const ma = metrics.find((m) => m.key === ka)
      const mb = metrics.find((m) => m.key === kb)
      if (!ma || !mb) continue
      const res = correlation(
        dailySeries(data.metricEntries, ma, from, today),
        dailySeries(data.metricEntries, mb, from, today),
      )
      if (res.r === null) continue
      out.push({ a: ma.name, b: mb.name, r: res.r, n: res.n })
    }
    return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
  }, [metrics, data.metricEntries, from, today])

  return (
    <>
      <div className="mb16">
      <Collapsible label="Was ein Zusammenhang aussagt – und was nicht">
        <div className="hint-box">
          {STATISTICAL_DISCLAIMER}{' '}
          Ein Zusammenhang bedeutet nur, dass zwei Werte sich gemeinsam verändert haben.
          Er sagt nichts darüber, ob einer den anderen verursacht – dafür kann es viele andere Gründe geben.
        </div>
      </Collapsible>
      </div>

      {/*
        Die zeitversetzte Auswertung beantwortet die Frage, die Erik tatsächlich
        hat („liegt es am Zucker?"). Der Vergleich zweier Werte darunter ist das
        Werkzeug zum Selbernachsehen – und war vorher ein zweiter Abschnitt mit
        eigener Zeitraumwahl gleich daneben.
      */}
      <ZeitversetzteZusammenhaenge />

      <Collapsible label="Zwei Werte selbst vergleichen">
      <div className="row mb16 mt8">
        <Segment label="Zeitraum" value={String(days)} onChange={(v) => setDays(Number(v))}
          options={[{ value: '30', label: '30 Tage' }, { value: '90', label: '90 Tage' },
            { value: '180', label: '180 Tage' }, { value: '365', label: '365 Tage' }]} />
      </div>

      {pairs.length > 0 && (
        <Card className="mb16" title="Auffällige Zusammenhänge in deinen Daten">
          <RankBars items={pairs.map((p) => ({ label: `${p.a} ↔ ${p.b} (${p.n} Tage)`, value: Math.abs(p.r) * 100 }))}
            formatValue={(v) => `${Math.round(v)} %`} />
          <div className="legend">
            {pairs.map((p, i) => (
              <span className="legend-item" key={i}>
                <span className="legend-swatch" style={{ background: seriesColor(i) }} />
                {p.a} ↔ {p.b}: {correlationLabel(p.r)} (r = {formatNumber(p.r, 2)})
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card title="Zwei Werte vergleichen">
        <div className="row mb16">
          <select className="select" style={{ maxWidth: 220 }} value={metricA?.id ?? ''} onChange={(e) => setAId(e.target.value)}>
            {metrics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span>↔</span>
          <select className="select" style={{ maxWidth: 220 }} value={metricB?.id ?? ''} onChange={(e) => setBId(e.target.value)}>
            {metrics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {!result || result.r === null ? (
          <Empty icon="📉" title="Zu wenig gemeinsame Tage"
            hint="Für eine Aussage braucht es mindestens fünf Tage, an denen beide Werte erfasst wurden." />
        ) : (
          <>
            <div className="grid grid-3 keep2 mb16">
              <Stat small label="Zusammenhang" value={correlationLabel(result.r)} />
              <Stat small label="Korrelationskoeffizient" value={formatNumber(result.r, 2)} />
              <Stat small label="Gemeinsame Tage" value={String(result.n)} />
            </div>
            <LineChart
              series={[
                { name: metricA.name, points: result.sa.map((p, i) => ({ label: i % 10 === 0 ? formatDay(p.day, 'short') : '', value: normalise(p.value, result.sa.map((x) => x.value)) })) },
                { name: metricB.name, points: result.sb.map((p, i) => ({ label: i % 10 === 0 ? formatDay(p.day, 'short') : '', value: normalise(p.value, result.sb.map((x) => x.value)) })) },
              ]}
              formatValue={(v) => `${Math.round(v)} %`}
              showArea={false}
            />
            <div className="hint-box mt12">
              Beide Reihen sind auf 0–100 % ihres eigenen Wertebereichs normiert, damit der Verlauf vergleichbar ist –
              die absoluten Zahlen unterscheiden sich stark. Bewusst kein zweiter Achsenmaßstab: der würde jeden
              gewünschten Zusammenhang erzeugen.
            </div>
          </>
        )}
      </Card>
      </Collapsible>
    </>
  )
}

function normalise(v: number | null, all: (number | null)[]): number | null {
  if (v === null) return null
  const nums = all.filter((x): x is number => x !== null)
  if (!nums.length) return null
  const min = Math.min(...nums), max = Math.max(...nums)
  if (max === min) return 50
  return ((v - min) / (max - min)) * 100
}

/* ---------------------------------------------------------------- Hinweise */

function InsightsTab() {
  const data = useData()
  const today = todayString()
  const insights = useMemo(() => generateInsights({
    transactions: data.transactions, categories: data.categories, accounts: data.accounts,
    budgets: data.budgets, recurring: data.recurring, tasks: data.tasks, metrics: data.metrics,
    metricEntries: data.metricEntries, metricTargets: data.metricTargets, today,
  }), [data, today])

  if (!insights.length) {
    return <Empty icon="💡" title="Keine Auffälligkeiten"
      hint="Sobald genug Daten vorliegen, erscheinen hier Hinweise – jeder mit nachvollziehbarem Rechenweg." />
  }

  return (
    <div className="grid grid-2">
      {insights.map((i, idx) => (
        <Card key={idx} title={i.title}
          sub={<span className={`pill ${i.severity === 'warning' ? 'crit' : i.severity === 'attention' ? 'warn' : ''}`}>
            {i.severity === 'warning' ? 'wichtig' : i.severity === 'attention' ? 'beachten' : 'Info'}
          </span>}>
          <div>{i.body}</div>
          {i.isStatistical && <div className="hint-box mt12">{STATISTICAL_DISCLAIMER}</div>}
          <div className="mt12">
            <Collapsible label="Wie kommt das zustande?">
              <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-2)' }}>
                {JSON.stringify(i.evidence, null, 2)}
              </pre>
            </Collapsible>
          </div>
        </Card>
      ))}
    </div>
  )
}
