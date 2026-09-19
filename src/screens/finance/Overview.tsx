/**
 * FINANZEN · ÜBERSICHT – „Reicht es diesen Monat?" zuerst, Verlauf danach.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty, Collapsible, Segment } from '../../ui/components'
import { Icon, BEREICH_FARBE } from '../../ui/icons'
import { usePageLayout, LayoutEditToggle, LayoutEditPanel } from '../../ui/pageLayout'
import type { LayoutCardDef } from '../../core/layout'
import { BarChart, LineChart, DonutChart, Meter, RankBars, seriesColor, ChartFrame } from '../../charts'
import { useData } from '../../state/store'
import {
  accountBalances, netWorth, availableMoney, savingsBalance, monthTotals,
  totalsByCategory, totalsByAccount, budgetProgress, forecastMonth,
  monthlySeries, netWorthSeries, ohneLeerenAnfang,
  expectedIncomeRest, savingsRateView, forecastStatus,
} from '../../core/finance'
import { formatMoney, formatMoneyAxis, toEuro } from '../../core/money'
import {
  todayString, monthOf, formatMonth, monthLabelShort, lastMonths,
  addMonthsToYearMonth, monthStart, monthEnd,
} from '../../core/dates'

/**
 * Die Finanzübersicht beantwortet zuerst „Reicht es diesen Monat?" und erst
 * danach „Wie hat es sich entwickelt?".
 *
 * Vorher stand die Monatsprognose als fünfte Karte hinter drei Diagrammen – am
 * Handy nach rund 2.000 px. Die drei Verlaufsdiagramme sind jetzt eine Karte mit
 * Umschalter. Seitenkennung `finanzen_uebersicht2`, weil die alten Karten
 * anders geschnitten waren; `UEBERSICHT_UMZUG` holt eine gespeicherte Auswahl
 * der alten Seite nach.
 */
export const OVERVIEW_CARD_DEFS: LayoutCardDef[] = [
  { id: 'monat', title: 'Dieser Monat' },
  { id: 'budgets', title: 'Budgets' },
  { id: 'chart_kategorie', title: 'Ausgaben nach Kategorie' },
  { id: 'verlauf', title: 'Verlauf' },
  { id: 'vermoegen', title: 'Vermögen' },
  { id: 'ausgaben_konto', title: 'Ausgaben nach Konto', defaultVisible: false },
]

/**
 * Die alte Übersicht kannte acht anders geschnittene Karten. Wer dort etwas
 * ausgeblendet oder umsortiert hatte, soll das nicht verlieren, nur weil die
 * Karten neu zugeschnitten wurden.
 */
/**
 * Die Segmente des Ausgabenrings.
 *
 * Vorher wurden schlicht die grössten acht Kategorien gezeichnet und der Rest
 * weggelassen. Der Ring war damit voll, die Mitte nannte aber die GESAMTEN
 * Ausgaben – und die Prozentangaben in der Legende rechneten gegen die Summe
 * der acht statt gegen den Monat. Bei zwanzig Kategorien stand dort für
 * „Lebensmittel" ein zu hoher Anteil.
 *
 * Jetzt wandert alles darunter in ein Segment „Sonstige": Der Ring summiert
 * sich wieder auf das, was in seiner Mitte steht. Nebenbei konkurrieren
 * weniger Farben miteinander – acht Segmente lassen sich auseinanderhalten,
 * zwanzig nicht.
 */
export function ringSegmente(
  kategorien: { name: string; amount: number; color?: string | null }[],
  maxEinzeln: number,
): { label: string; value: number; color?: string }[] {
  const gross = kategorien.slice(0, maxEinzeln)
    .map((c, i) => ({ label: c.name, value: c.amount, color: c.color ?? seriesColor(i) }))
  const restBetrag = kategorien.slice(maxEinzeln).reduce((s, c) => s + c.amount, 0)
  if (restBetrag <= 0) return gross
  const anzahl = kategorien.length - maxEinzeln
  return [...gross, {
    label: anzahl === 1 ? kategorien[maxEinzeln].name : `Sonstige (${anzahl})`,
    value: restBetrag,
    // Bewusst unbunt: „Sonstige" ist keine Kategorie, sondern ihr Rest, und
    // soll keiner echten Kategorie die Farbe streitig machen.
    color: 'var(--text-muted)',
  }]
}

export const UEBERSICHT_UMZUG = {
  von: 'finanzen_uebersicht',
  karten: {
    kennzahlen: 'vermoegen',
    prognose: 'monat',
    chart_ein_aus: 'verlauf',
    chart_sparen: 'verlauf',
    chart_vermoegen: 'verlauf',
    chart_kategorie: 'chart_kategorie',
    ausgaben_konto: 'ausgaben_konto',
    budgets: 'budgets',
  },
}

export function Overview({ navigate, params }: { navigate: (r: string) => void; params: Record<string, string> }) {
  const data = useData()
  const today = todayString()
  // Ein Finanztag-Punkt wie „Monatsabschluss Juli durchführen" soll direkt den
  // betroffenen Monat zeigen, nicht immer nur den laufenden.
  const [month, setMonth] = useState(() => (
    params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthOf(today)
  ))
  const [verlauf, setVerlauf] = useState<'einaus' | 'sparen' | 'vermoegen'>('einaus')

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const totals = useMemo(() => monthTotals(data.transactions, month), [data.transactions, month])
  const prev = useMemo(() => monthTotals(data.transactions, addMonthsToYearMonth(month, -1)), [data.transactions, month])
  const months = useMemo(() => lastMonths(month, 12), [month])
  const series = useMemo(
    () => ohneLeerenAnfang(monthlySeries(data.transactions, months), (s) => s.income === 0 && s.expense === 0),
    [data.transactions, months],
  )
  // Der Vermögensverlauf beginnt dort, wo die Buchungen beginnen – vorher
  // stünde nur der Anfangsbestand als flache Linie.
  const worth = useMemo(() => {
    const ab = series[0]?.month
    return netWorthSeries(data.accounts, data.transactions, months).filter((w) => !ab || w.month >= ab)
  }, [data.accounts, data.transactions, months, series])
  const byCat = useMemo(
    () => totalsByCategory(data.transactions, data.categories, monthStart(month), monthEnd(month)),
    [data.transactions, data.categories, month],
  )
  const byAcc = useMemo(
    () => totalsByAccount(data.transactions, data.accounts, monthStart(month), monthEnd(month)),
    [data.transactions, data.accounts, month],
  )
  const isCurrentMonth = month === monthOf(today)

  // Im laufenden Monat zählen die Einnahmen mit, die laut deinen Regeln noch
  // kommen – sonst stünde am Monatsanfang eine Sparquote von „unter −100 %".
  const offeneEinnahmen = useMemo(
    () => (isCurrentMonth
      ? expectedIncomeRest(data.transactions, data.recurring, month, today)
      : { cents: 0, quelle: 'keine' as const }),
    [data.transactions, data.recurring, month, today, isCurrentMonth],
  )

  // Prognose und Sparquote müssen dieselbe Geschichte erzählen – beide
  // rechnen deshalb mit denselben erwarteten Einnahmen.
  const forecast = useMemo(
    () => forecastMonth(data.transactions, month, today, offeneEinnahmen.cents),
    [data.transactions, month, today, offeneEinnahmen],
  )
  const budgets = useMemo(
    () => [...budgetProgress(data.budgets, data.transactions, data.categories, month, today)]
      .sort((a, b) => b.usedPercent - a.usedPercent),
    [data.budgets, data.transactions, data.categories, month, today],
  )

  const nw = netWorth(data.accounts, balances)
  const avail = availableMoney(data.accounts, balances)
  const saved = savingsBalance(data.accounts, balances)

  const quote = useMemo(
    () => savingsRateView(totals, offeneEinnahmen.cents, isCurrentMonth, offeneEinnahmen.quelle, offeneEinnahmen.regel),
    [totals, offeneEinnahmen, isCurrentMonth],
  )
  const ampel = useMemo(() => forecastStatus(forecast), [forecast])

  const money = (c: number) => formatMoney(c, { compact: true })
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100))
  const expenseChange = pct(totals.expense, prev.expense)

  const layout = usePageLayout('finanzen_uebersicht2', OVERVIEW_CARD_DEFS, UEBERSICHT_UMZUG)
  const farbe = BEREICH_FARBE.finanzen

  function renderCard(id: string): React.ReactNode {
    switch (id) {
      case 'monat':
        return (
          <Card key={id} className="karte-breit" title={isCurrentMonth ? 'Dieser Monat' : formatMonth(month)} icon="finanzen" farbe={farbe}
            sub={isCurrentMonth ? `Tag ${forecast.elapsedDays} von ${forecast.totalDays}` : undefined}>
            <div className="kennzahlen-reihe vier">
              <div className="kennzahl">
                <span className="kennzahl-name">{isCurrentMonth ? 'Bleibt voraussichtlich' : 'Übrig geblieben'}</span>
                <span className="kennzahl-wert gross">{money(isCurrentMonth ? forecast.projectedSavings : quote.savings)}</span>
                {isCurrentMonth && (
                  <span className={`kennzahl-zusatz ${ampel.status === 'red' ? 'crit' : ampel.status === 'amber' ? 'warn' : ''}`}>
                    {ampel.label}
                  </span>
                )}
              </div>
              <div className="kennzahl">
                <span className="kennzahl-name">Verfügbar</span>
                <span className="kennzahl-wert">{money(avail)}</span>
                <span className="kennzahl-zusatz">ohne Sparkonten</span>
              </div>
              <div className="kennzahl">
                <span className="kennzahl-name">Ausgegeben</span>
                <span className="kennzahl-wert">{money(totals.expense)}</span>
                {expenseChange !== null && (
                  <span className="kennzahl-zusatz">
                    {expenseChange > 0 ? `${expenseChange} % mehr` : `${-expenseChange} % weniger`} als {formatMonth(addMonthsToYearMonth(month, -1), true)}
                  </span>
                )}
              </div>
              <div className="kennzahl">
                <span className="kennzahl-name">{quote.expected ? 'Sparquote · erwartet' : 'Sparquote'}</span>
                <span className="kennzahl-wert">{quote.text.replace(' erwartet', '')}</span>
                <span className="kennzahl-zusatz">{money(quote.savings)}</span>
              </div>
            </div>
            {isCurrentMonth && (
              <div className="mt12">
                <Meter percent={Math.min(100, (forecast.elapsedDays / forecast.totalDays) * 100)} status="neutral" />
                <div className="mt8">
                  <Collapsible label="So wird gerechnet">
                    <div className="small muted">
                      {ampel.sentence} Bisher {formatMoney(forecast.actualExpense)} ausgegeben
                      {forecast.plannedExpense > 0 && <>, {formatMoney(forecast.plannedExpense)} fest eingeplant</>}.
                      Die Hochrechnung setzt den bisherigen Tagesschnitt fort und ergibt
                      {' '}{formatMoney(forecast.projectedExpense)} Ausgaben bei {formatMoney(forecast.projectedIncome)} Einnahmen
                      {forecast.expectedIncome > 0 && <> (davon {formatMoney(forecast.expectedIncome)}, die noch kommen)</>}.
                      Eine Schätzung, keine Zusage.
                    </div>
                  </Collapsible>
                </div>
              </div>
            )}
          </Card>
        )

      case 'budgets':
        if (budgets.length === 0) return null
        return (
          <Card key={id} title="Budgets" icon="finanzen" farbe={farbe}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen/budgets')}>Alle <Icon name="pfeil-rechts" size={14} /></button>}>
            {budgets.slice(0, 5).map((b) => (
              <div className="progress-row" key={b.budget.id}>
                <div className="progress-head">
                  <span>{b.categoryName}</span>
                  <span className={`budget-prozent ${b.status}`}>{Math.round(b.usedPercent)} %</span>
                  <span className="val">{formatMoney(b.spent)} / {formatMoney(b.limit)}</span>
                </div>
                <Meter percent={b.usedPercent} status={b.status === 'green' ? 'neutral' : b.status === 'amber' ? 'warning' : 'critical'} markerPercent={b.paceExpectedPercent} />
              </div>
            ))}
          </Card>
        )

      case 'chart_kategorie':
        return (
          <Card key={id} title="Ausgaben nach Kategorie" icon="finanzen" farbe={farbe}
            sub={byCat.length ? `${formatMonth(month, true)} · ${formatMoney(totals.expense)}` : undefined}>
            {byCat.length ? (
              <ChartFrame title={`Ausgaben nach Kategorie · ${formatMonth(month)}`}
                sub={`${formatMoney(totals.expense)} gesamt`}>
                {({ gross }) => (
                  <DonutChart
                    slices={ringSegmente(byCat, gross ? 12 : 7)}
                    size={gross ? 240 : 150}
                    thickness={gross ? 30 : 20}
                    centerLabel="Ausgaben"
                    centerValue={formatMoney(totals.expense, { compact: true })}
                    maxLegend={gross ? 13 : 8}
                    formatValue={(v) => formatMoney(v)}
                  />
                )}
              </ChartFrame>
            ) : <Empty kompakt title="Keine Ausgaben in diesem Monat." />}
          </Card>
        )

      case 'verlauf':
        return (
          <Card key={id} title="Verlauf" icon="analysen" farbe={farbe}
            action={<Segment label="Verlauf" value={verlauf} onChange={setVerlauf} options={[
              { value: 'einaus', label: 'Ein/Aus' }, { value: 'sparen', label: 'Sparen' }, { value: 'vermoegen', label: 'Vermögen' },
            ]} />}>
            {verlauf === 'einaus' && (
              <ChartFrame title="Einnahmen und Ausgaben" sub="je Monat">
                {({ height }) => (
                  <BarChart
                    data={series.map((s) => ({ label: monthLabelShort(s.month), values: [s.income, s.expense] }))}
                    seriesNames={['Einnahmen', 'Ausgaben']}
                    height={height} formatValue={(v) => formatMoney(v)} formatAxis={formatMoneyAxis} />
                )}
              </ChartFrame>
            )}
            {verlauf === 'sparen' && (
              <ChartFrame title="Sparbetrag je Monat" sub="Einnahmen minus Ausgaben">
                {({ height }) => (
                  <BarChart
                    data={series.map((s) => ({ label: monthLabelShort(s.month), values: [s.savings] }))}
                    seriesNames={['Sparbetrag']}
                    height={height} formatValue={(v) => formatMoney(v)} formatAxis={formatMoneyAxis} />
                )}
              </ChartFrame>
            )}
            {verlauf === 'vermoegen' && (
              <ChartFrame title="Vermögensentwicklung" sub="Stand am Monatsende">
                {({ height }) => (
                  <LineChart
                    series={[{ name: 'Vermögen', points: worth.map((w) => ({ label: monthLabelShort(w.month), value: toEuro(w.value) })) }]}
                    formatValue={(v) => formatMoney(Math.round(v * 100))}
                    formatAxis={(v) => formatMoneyAxis(Math.round(v * 100))}
                    height={height} />
                )}
              </ChartFrame>
            )}
          </Card>
        )

      case 'vermoegen':
        return (
          <Card key={id} title="Vermögen" icon="finanzen" farbe={farbe}
            action={<button className="btn btn-sm btn-ghost" onClick={() => navigate('#/finanzen/konten')}>Konten <Icon name="pfeil-rechts" size={14} /></button>}>
            <div className="kennzeilen">
              <div className="kennzeile"><span className="kennzeile-name">Gesamt</span><span className="kennzeile-wert">{money(nw)}</span></div>
              <div className="kennzeile"><span className="kennzeile-name">Verfügbar</span><span className="kennzeile-wert">{money(avail)}</span></div>
              <div className="kennzeile"><span className="kennzeile-name">Rücklagen</span><span className="kennzeile-wert">{money(saved)}</span></div>
            </div>
          </Card>
        )

      case 'ausgaben_konto':
        return (
          <Card key={id} title="Ausgaben nach Konto" sub={formatMonth(month, true)} icon="finanzen" farbe={farbe}>
            {byAcc.length
              ? <RankBars items={byAcc.map((a) => ({
                  label: a.name, value: a.amount,
                  color: data.accounts.find((x) => x.id === a.accountId)?.color ?? undefined,
                }))} formatValue={(v) => formatMoney(v)} />
              : <Empty kompakt title="Keine Ausgaben." />}
          </Card>
        )

      default:
        return null
    }
  }

  const karten = layout.visibleCards.map((c) => ({ id: c.id, knoten: renderCard(c.id) })).filter((k) => k.knoten)
  const breit = karten.filter((k) => k.id === 'monat')
  const rest = karten.filter((k) => k.id !== 'monat')

  return (
    <div className="stapel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setMonth(addMonthsToYearMonth(month, -1))} aria-label="Vormonat">
            <Icon name="zurueck" size={16} />
          </button>
          <strong style={{ minWidth: 120, textAlign: 'center' }}>{formatMonth(month)}</strong>
          <button className="btn btn-sm" disabled={month >= monthOf(today)} onClick={() => setMonth(addMonthsToYearMonth(month, 1))} aria-label="Folgemonat">
            <Icon name="pfeil-rechts" size={16} />
          </button>
          {!isCurrentMonth && <button className="btn btn-sm btn-ghost" onClick={() => setMonth(monthOf(today))}>Aktueller Monat</button>}
        </div>
        <LayoutEditToggle editMode={layout.editMode} onToggle={() => layout.setEditMode(!layout.editMode)} />
      </div>

      {layout.editMode && (
        <LayoutEditPanel cards={layout.allCards}
          onToggleVisible={layout.toggleVisible} onMoveUp={layout.moveUp} onMoveDown={layout.moveDown}
          onReset={layout.resetLayout} />
      )}

      {breit.map((k) => <React.Fragment key={k.id}>{k.knoten}</React.Fragment>)}
      <div className="karten-spalten">
        {rest.map((k) => <React.Fragment key={k.id}>{k.knoten}</React.Fragment>)}
      </div>
    </div>
  )
}
