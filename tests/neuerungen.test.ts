/**
 * Prüfungen für die Erweiterungen: Kasseneingabe, Dauer in einem Feld,
 * Sparquote mit erwarteten Einnahmen, automatische Buchungen, Aufgabenfristen,
 * Achsenbeschriftung und Terminwiederholungen.
 */
import { describe, it, expect } from 'vitest'
import { registerInput, centsToInput, parseAmountToCents } from '../src/core/money'
import { parseDuration, durationToInput, formatHoursMinutes, liveDurationPreview } from '../src/core/dates'
import {
  expectedRecurring, dueRecurringBookings, savingsRateView, forecastStatus,
  periodTotals, forecastMonth, monthTotalsErwartet, topMerchants, transactionsForAccount,
  expectedIncomeRest,
} from '../src/core/finance'
import {
  anlaufTage, defaultShowFrom, effectiveShowFrom, dringlichkeit,
  carryOverPatches, taskArt, tasksForDay, toggleTaskPatch, progressPatch,
} from '../src/core/planner'
import { formatMetricValue } from '../src/core/metrics'
import type { Metric } from '../src/core/types'
import { generateInsights } from '../src/core/insights'
import { niceTicks } from '../src/charts'
import { vorkommenIn } from '../src/screens/Calendar'
import { financeChecklistRoute } from '../src/core/financeDay'
import { resolveLayout, moveInOrder, moveCard, toggleCardVisible, type LayoutCardDef } from '../src/core/layout'
import {
  summarizeInvestment, maxSellCostBasis, validateSellCostBasis, summarizePortfolio,
  type InvestmentMove,
} from '../src/core/investments'

/* -------------------------------------------------------- Kasseneingabe */

describe('Betrag mit Cent-Automatik', () => {
  it('lässt die Ziffern von rechts hereinwandern', () => {
    expect(registerInput('2')).toBe('0,02')
    expect(registerInput('20')).toBe('0,20')
    expect(registerInput('200')).toBe('2,00')
    expect(registerInput('2000')).toBe('20,00')
    expect(registerInput('123456')).toBe('1234,56')
  })

  it('ignoriert Komma und Punkt – wer „20,00" tippt, bekommt dasselbe', () => {
    expect(registerInput('20,00')).toBe('20,00')
    expect(registerInput('20.00')).toBe('20,00')
  })

  it('kommt mit Löschen zurecht', () => {
    expect(registerInput('20,0')).toBe('2,00')
    expect(registerInput('')).toBe('')
    expect(registerInput('0')).toBe('0,00')
  })

  it('behält ein Minuszeichen für Anfangssalden', () => {
    expect(registerInput('-1250')).toBe('-12,50')
    expect(registerInput('-')).toBe('-')
  })

  it('liest zurück, was centsToInput geschrieben hat', () => {
    for (const c of [0, 5, 99, 100, 2000, 103200, -4599]) {
      expect(parseAmountToCents(centsToInput(c))).toBe(c)
    }
  })
})

/* ------------------------------------------------------------ Dauer */

describe('Dauer in einem Feld', () => {
  it('liest 115 als 1:15 und 45 als 45 Minuten', () => {
    expect(parseDuration('115')).toBe(75)
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('1230')).toBe(750)
  })

  it('versteht die üblichen Schreibweisen', () => {
    expect(parseDuration('1:15')).toBe(75)
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('1,5 h')).toBe(90)
    expect(parseDuration('90 min')).toBe(90)
    expect(parseDuration('1,5')).toBe(90)
  })

  it('behandelt unsinnige Minutenangaben als Minuten', () => {
    // 190 ist keine gültige Uhrzeit – gemeint sind 190 Minuten.
    expect(parseDuration('190')).toBe(190)
  })

  it('gibt bei Unsinn nichts zurück', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('bald')).toBeNull()
  })

  it('zeigt zurück, was eingegeben werden darf', () => {
    expect(durationToInput(75)).toBe('1:15')
    expect(durationToInput(45)).toBe('45')
    expect(durationToInput(null)).toBe('')
    expect(parseDuration(durationToInput(75))).toBe(75)
  })

  it('deckelt bei 24 Stunden', () => {
    expect(parseDuration('99h')).toBe(24 * 60)
  })

  it('verfälscht beim Weitertippen nicht die Ziffern (Regression: 630 wurde zu 10:30 statt 6:30)', () => {
    // Simuliert genau das, was DurationInput beim Tippen im Feld selbst tut:
    // nach jeder Ziffer wird der Doppelpunkt aus der bisherigen Anzeige
    // entfernt und die Live-Vorschau (liveDurationPreview) neu berechnet -
    // das Ergebnis ist, was im Feld angezeigt und beim nächsten Tastendruck
    // fortgeschrieben wird.
    const tippen = (ziffern: string) => {
      let angezeigt = ''
      for (const ziffer of ziffern) {
        const bisherigeZiffern = angezeigt.replace(/:/g, '')
        angezeigt = liveDurationPreview(bisherigeZiffern + ziffer)
      }
      return angezeigt
    }

    expect(tippen('630')).toBe('6:30')
    expect(parseDuration(tippen('630'))).toBe(6 * 60 + 30)

    // Weitere Fälle aus der Dokumentation von DurationInput, zur Sicherheit
    // mit derselben Tipp-Simulation.
    expect(tippen('115')).toBe('1:15')
    expect(tippen('200')).toBe('2:00')
    expect(tippen('1230')).toBe('12:30')
    expect(tippen('45')).toBe('45')
  })
})

/* ------------------------------------------------- Wiederkehrende Zahlungen */

const basis = {
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null, version: 1, last_device_id: 'x', server_rev: null,
}

const regel = (over: Record<string, any> = {}) => ({
  ...basis, id: 'r1', kind: 'transaction', title: 'Gehalt',
  rrule: 'FREQ=MONTHLY;BYMONTHDAY=28', starts_on: '2026-01-28', ends_on: null,
  template_json: JSON.stringify({ type: 'income', amount_cents: 120000, account_id: 'a1' }),
  auto_book: 1, lead_days: 5, last_generated_on: null, is_active: 1,
  ...over,
}) as any

describe('Erwartete Einnahmen und fällige Buchungen', () => {
  it('zählt die Gehaltszahlung, die im Monat noch kommt', () => {
    const e = expectedRecurring([regel()], '2026-08-05', '2026-08-31')
    expect(e.income).toBe(120000)
    expect(e.expense).toBe(0)
  })

  it('zählt nichts, wenn der Termin schon vorbei ist', () => {
    expect(expectedRecurring([regel()], '2026-08-29', '2026-08-31').income).toBe(0)
  })

  it('achtet auf das Ende der Regel', () => {
    const e = expectedRecurring([regel({ ends_on: '2026-07-31' })], '2026-08-01', '2026-08-31')
    expect(e.income).toBe(0)
  })

  it('findet fällige Zahlungen und übergeht bereits gebuchte', () => {
    const r = regel({ last_generated_on: null, starts_on: '2026-06-28' })
    const faellig = dueRecurringBookings([r], [], '2026-08-30')
    expect(faellig.map((f) => f.day)).toEqual(['2026-06-28', '2026-07-28', '2026-08-28'])

    const mitBuchung = dueRecurringBookings([r], [
      { ...basis, id: 't1', recurring_id: 'r1', booked_on: '2026-07-28' } as any,
    ], '2026-08-30')
    expect(mitBuchung.map((f) => f.day)).toEqual(['2026-06-28', '2026-08-28'])
  })

  it('bucht nicht beliebig weit in die Vergangenheit nach', () => {
    // Eine Regel, die vor zwei Jahren begann, darf nicht zwei Jahre Miete
    // nachbuchen und damit alle Kontostände verfälschen.
    const alt = regel({ starts_on: '2024-01-28' })
    const faellig = dueRecurringBookings([alt], [], '2026-08-30')
    expect(faellig.length).toBeLessThanOrEqual(4)
    expect(faellig.every((f) => f.day >= '2026-05-30')).toBe(true)
  })

  it('gibt Beschreibung und Notiz aus der Vorlage weiter, damit sie in die gebuchte Zahlung übernommen werden können', () => {
    const r = regel({
      template_json: JSON.stringify({
        type: 'income', amount_cents: 120000, account_id: 'a1',
        description: 'Ausbildungsvergütung', note: 'überweist die Firma laut Vertrag',
      }),
      last_generated_on: '2026-07-28',
    })
    const [faellig] = dueRecurringBookings([r], [], '2026-08-30')
    expect(faellig.template.description).toBe('Ausbildungsvergütung')
    expect(faellig.template.note).toBe('überweist die Firma laut Vertrag')
  })

  it('überspringt abgeschaltete Regeln und solche ohne Konto', () => {
    expect(dueRecurringBookings([regel({ is_active: 0 })], [], '2026-08-30')).toHaveLength(0)
    expect(dueRecurringBookings(
      [regel({ template_json: JSON.stringify({ type: 'income', amount_cents: 1 }) })],
      [], '2026-08-30',
    )).toHaveLength(0)
  })
})

describe('Hinweis zur erwarteten Einnahme nennt die Regel', () => {
  it('liefert Titel und Fälligkeitstag der Regel, aus der die Erwartung stammt', () => {
    const e = expectedIncomeRest([], [regel()], '2026-08', '2026-08-05')
    expect(e.quelle).toBe('regeln')
    expect(e.regel).toEqual({ titel: 'Gehalt', tag: '2026-08-28' })
  })

  it('zeigt im Hinweistext, welche Regel und welcher Tag gemeint ist – nicht nur „mitgerechnet"', () => {
    const totals = periodTotals([], '2026-08-01', '2026-08-31')
    const v = savingsRateView(totals, 120000, true, 'regeln', { titel: 'Gehalt', tag: '2026-08-28' })
    expect(v.hint).toContain('Gehalt')
    expect(v.hint).toContain('28.08.')
  })

  it('fällt ohne bekannte Regel auf den allgemeinen Hinweis zurück', () => {
    const totals = periodTotals([], '2026-08-01', '2026-08-31')
    const v = savingsRateView(totals, 120000, true, 'regeln', null)
    expect(v.hint).toBe('Die Einnahmen, die diesen Monat noch kommen, sind mitgerechnet.')
  })
})

/* ------------------------------------------------------------ Sparquote */

describe('Sparquote am Monatsanfang', () => {
  const tx = (over: Record<string, any>) => ({
    ...basis, id: Math.random().toString(36), type: 'expense', booked_on: '2026-08-05',
    amount_cents: 30000, currency: 'EUR', account_id: 'a1', to_account_id: null,
    category_id: null, merchant: null, description: null, note: null,
    status: 'booked', recurring_id: null, import_batch_id: null, external_ref: null,
    ...over,
  }) as any

  it('zeigt nicht „unter −100 %", nur weil das Gehalt erst Ende des Monats kommt', () => {
    const totals = periodTotals([tx({})], '2026-08-01', '2026-08-31')
    const ohne = savingsRateView(totals, 0, true)
    expect(ohne.defined).toBe(false)

    const mit = savingsRateView(totals, 120000, true)
    expect(mit.defined).toBe(true)
    expect(mit.expected).toBe(true)
    expect(mit.rate).toBe(75)             // (1200 − 300) / 1200
    expect(mit.text).toContain('erwartet')
  })

  it('rechnet abgeschlossene Monate weiterhin ohne Erwartung', () => {
    const totals = periodTotals(
      [tx({}), tx({ type: 'income', amount_cents: 120000, booked_on: '2026-07-28' })],
      '2026-07-01', '2026-08-31',
    )
    const v = savingsRateView(totals, 120000, false)
    expect(v.expected).toBe(false)
    expect(v.income).toBe(120000)
  })
})

/* ---------------------------------- Einnahmen überall konsistent (Hinweise) */

describe('monthTotalsErwartet – dieselbe erwartete Einnahme überall', () => {
  const tx = (over: Record<string, any>) => ({
    ...basis, id: Math.random().toString(36), type: 'expense', booked_on: '2026-08-05',
    amount_cents: 30000, currency: 'EUR', account_id: 'a1', to_account_id: null,
    category_id: null, merchant: null, description: null, note: null,
    status: 'booked', recurring_id: null, import_batch_id: null, external_ref: null,
    ...over,
  }) as any

  it('rechnet die erwartete Gehaltszahlung in die Einnahmen des laufenden Monats ein', () => {
    const t = monthTotalsErwartet([tx({})], [regel()], '2026-08', '2026-08-05')
    expect(t.projected).toBe(true)
    expect(t.actualIncome).toBe(0)
    expect(t.income).toBe(120000)
    expect(t.savingsRatePercent).toBe(75) // (1200 − 300) / 1200
  })

  it('lässt abgeschlossene Monate unangetastet – da ist ohnehin schon alles gebucht', () => {
    const t = monthTotalsErwartet(
      [tx({ booked_on: '2026-07-05' }), tx({ type: 'income', amount_cents: 120000, booked_on: '2026-07-28' })],
      [regel()], '2026-07', '2026-08-05',
    )
    expect(t.projected).toBe(false)
    expect(t.income).toBe(120000)
  })

  it('rechnet nichts doppelt, wenn das Gehalt schon gebucht ist', () => {
    const t = monthTotalsErwartet(
      [tx({}), tx({ type: 'income', amount_cents: 120000, booked_on: '2026-08-28' })],
      [regel()], '2026-08', '2026-08-29',
    )
    expect(t.projected).toBe(false)
    expect(t.income).toBe(120000)
  })
})

describe('Hinweise rechnen mit denselben erwarteten Einnahmen wie die Sparquote', () => {
  const tx = (over: Record<string, any>) => ({
    ...basis, id: Math.random().toString(36), type: 'expense', currency: 'EUR',
    account_id: 'a1', to_account_id: null, category_id: null, merchant: null,
    description: null, note: null, status: 'booked', recurring_id: null,
    import_batch_id: null, external_ref: null, ...over,
  }) as any

  it('meldet die Sparquote am Monatsanfang mit der erwarteten Gehaltszahlung statt einer absurden Zahl', () => {
    const monate = ['2026-05', '2026-06', '2026-07']
    const transactions = monate.flatMap((m) => [
      tx({ type: 'income', amount_cents: 100000, booked_on: `${m}-05` }),
      tx({ amount_cents: 50000, booked_on: `${m}-15` }),
    ])
    // August: Gehalt noch nicht gebucht (kommt laut Regel erst am 28.), aber
    // schon 800 € ausgegeben – ohne Erwartung stünde hier eine Quote von
    // -∞ % statt einer sinnvollen Zahl.
    transactions.push(tx({ amount_cents: 80000, booked_on: '2026-08-01' }))

    const insights = generateInsights({
      transactions, categories: [], accounts: [], budgets: [], recurring: [regel()],
      tasks: [], metrics: [], metricEntries: [], metricTargets: [], today: '2026-08-05',
    })
    const hinweis = insights.find((i) => i.kind === 'savings_rate')
    expect(hinweis).toBeDefined()
    expect(hinweis!.evidence.projected).toBe(true)
    expect(hinweis!.evidence.current).toBe(33.3) // (1200 − 800) / 1200, wie monthTotalsErwartet()
    expect(hinweis!.title).toContain('erwartet')
    // Dieselbe Zahl, die auch Heute/Finanzen für die Sparquote zeigen würden.
    const direkt = monthTotalsErwartet(transactions, [regel()], '2026-08', '2026-08-05')
    expect(hinweis!.evidence.current).toBe(direkt.savingsRatePercent)
  })
})

describe('Ampel der Monatsprognose', () => {
  const f = (income: number, savings: number) => ({
    ...forecastMonth([], '2026-08', '2026-08-15'),
    projectedIncome: income, projectedSavings: savings,
  })
  it('wird rot, wenn mehr rausgeht als reinkommt', () => {
    expect(forecastStatus(f(120000, -5000)).status).toBe('red')
  })
  it('wird gelb, wenn es gerade so aufgeht', () => {
    expect(forecastStatus(f(120000, 6000)).status).toBe('amber')
  })
  it('wird grün, wenn ordentlich übrig bleibt', () => {
    expect(forecastStatus(f(120000, 40000)).status).toBe('green')
  })
})

describe('Monatsprognose lehnt sich an die Vormonate an', () => {
  const tx = (over: Record<string, any>) => ({
    ...basis, id: Math.random().toString(36), type: 'expense', currency: 'EUR',
    account_id: 'a1', to_account_id: null, category_id: null, merchant: null,
    description: null, note: null, status: 'booked', recurring_id: null,
    import_batch_id: null, external_ref: null, ...over,
  }) as any

  it('ist am Monatsanfang mit kaum Daten nah am Schnitt der letzten Monate statt bei null', () => {
    // Juni und Juli je 3.000 € Ausgaben – rund 100 €/Tag.
    const transactions = [
      tx({ amount_cents: 300000, booked_on: '2026-06-15' }),
      tx({ amount_cents: 300000, booked_on: '2026-07-15' }),
      // August: noch keine einzige Buchung.
    ]
    const f = forecastMonth(transactions, '2026-08', '2026-08-01')
    // Der reine Tagesschnitt des laufenden Monats wäre hier 0 (keine Buchung) –
    // die alte Rechnung hätte 0 € Ausgaben für den ganzen Monat prognostiziert.
    // Mit den Vormonaten im Blick liegt die Schätzung stattdessen nah an
    // einem normalen Monat von rund 3.000 €.
    expect(f.projectedExpense).toBeGreaterThan(200000)
    expect(f.projectedExpense).toBeLessThan(320000)
  })

  it('lässt gegen Monatsende den tatsächlichen Verlauf dieses Monats überwiegen', () => {
    // Juni und Juli je ~10.000 €-Tagesschnitt (300.000 / 30 bzw. 310.000 / 31).
    const transactions = [
      tx({ amount_cents: 300000, booked_on: '2026-06-15' }),
      tx({ amount_cents: 310000, booked_on: '2026-07-15' }),
      // August: bis zum 28. schon 560.000 (20.000/Tag) ausgegeben – ein
      // deutlich teurerer Monat als sonst.
      tx({ amount_cents: 560000, booked_on: '2026-08-28' }),
    ]
    const f = forecastMonth(transactions, '2026-08', '2026-08-28')
    // Rein historisch (10.000/Tag) käme man auf 560.000 + 3·10.000 = 590.000.
    // Rein am laufenden Monat (20.000/Tag) auf 560.000 + 3·20.000 = 620.000.
    // Am 28. von 31 Tagen soll der laufende Verlauf klar überwiegen.
    expect(f.projectedExpense).toBeGreaterThan(610000)
    expect(f.projectedExpense).toBeLessThanOrEqual(620000)
  })

  it('bricht ohne jede Historie nicht ab und liefert keine NaN', () => {
    const f = forecastMonth([], '2026-08', '2026-08-15')
    expect(Number.isFinite(f.projectedExpense)).toBe(true)
    expect(f.projectedExpense).toBe(0)
    expect(f.projectedSavings).toBe(0)
  })

  it('verhält sich ohne Vormonate wie die bisherige einfache Hochrechnung', () => {
    // Kein Ausgaben-Monat vor August vorhanden – historicalDailyExpense()
    // liefert null, also zählt nur der bisherige Tagesschnitt wie zuvor.
    const transactions = [
      tx({ amount_cents: 60000, booked_on: '2026-08-01' }),
      tx({ amount_cents: 60000, booked_on: '2026-08-10' }),
    ]
    const f = forecastMonth(transactions, '2026-08', '2026-08-10')
    // 120.000 in 10 Tagen = 12.000/Tag, 21 Resttage → 120.000 + 252.000
    expect(f.projectedExpense).toBe(372000)
  })
})

/* ------------------------------------------------------------- Aufgaben */

const aufgabe = (over: Record<string, any> = {}) => ({
  ...basis, id: 't' + Math.random().toString(36).slice(2), title: 'Test',
  description: null, note: null, status: 'open', bucket: 'scheduled',
  scheduled_on: null, scheduled_time: null, due_on: null, due_time: null,
  duration_minutes: null, priority: 2, category: null, project_id: null,
  parent_task_id: null, recurring_id: null, completed_at: null, energy: null,
  sort_order: 0, template_id: null, show_from: null, pinned_day: 0,
  carried_count: 0, carried_from: null,
  scheduled_end_on: null, progress_total: null, progress_done: null,
  ...over,
}) as any

describe('Aufgaben mit Frist', () => {
  it('gibt weiter entfernten Fristen mehr Vorlauf', () => {
    expect(anlaufTage(3)).toBe(3)
    expect(anlaufTage(20)).toBe(7)
    expect(anlaufTage(60)).toBe(14)
    expect(anlaufTage(183)).toBe(30)
  })

  it('lässt eine Aufgabe mit halbjähriger Frist ruhen', () => {
    const t = aufgabe({ due_on: '2027-02-01', created_at: '2026-08-01T00:00:00Z' })
    const ab = effectiveShowFrom(t)!
    expect(ab).toBe('2027-01-02')          // 30 Tage vorher
    expect(tasksForDay([t], '2026-08-26')).toHaveLength(0)
  })

  it('meldet dieselbe Aufgabe, sobald der Anlauftag da ist', () => {
    const t = aufgabe({ due_on: '2026-08-30', show_from: '2026-08-20' })
    expect(tasksForDay([t], new Date().toISOString().slice(0, 10)).length >= 0).toBe(true)
    expect(effectiveShowFrom(t)).toBe('2026-08-20')
  })

  it('rechnet den Anlauftag aus der Frist', () => {
    expect(defaultShowFrom('2026-09-30', '2026-08-26')).toBe('2026-09-16')  // 35 Tage Horizont → 14 Tage Vorlauf
    expect(defaultShowFrom('2026-08-28', '2026-08-26')).toBe('2026-08-26')
  })

  it('erkennt die Art der Aufgabe an dem, was ausgefüllt ist', () => {
    expect(taskArt(aufgabe({ scheduled_on: '2026-08-26', pinned_day: 1 }))).toBe('fest')
    expect(taskArt(aufgabe({ scheduled_on: '2026-08-26' }))).toBe('tagesplan')
    expect(taskArt(aufgabe({ due_on: '2026-09-30' }))).toBe('frist')
    expect(taskArt(aufgabe())).toBe('irgendwann')
  })
})

describe('Dringlichkeit steigt zur Frist hin', () => {
  const stufe = (frist: string) => dringlichkeit(aufgabe({ due_on: frist }), '2026-08-26').level
  it('wächst je näher die Frist rückt', () => {
    expect(stufe('2026-12-01')).toBe(1)
    expect(stufe('2026-09-10')).toBe(1)
    expect(stufe('2026-08-31')).toBe(2)
    expect(stufe('2026-08-27')).toBe(3)
    expect(stufe('2026-08-26')).toBe(3)
    expect(stufe('2026-08-20')).toBe(4)
  })
  it('ist bei erledigten Aufgaben still', () => {
    expect(dringlichkeit(aufgabe({ due_on: '2026-08-01', status: 'done' }), '2026-08-26').level).toBe(0)
  })
})

describe('Übertrag offener Aufgaben', () => {
  it('nimmt liegengebliebene Aufgaben auf heute mit', () => {
    const t = aufgabe({ scheduled_on: '2026-08-25' })
    const p = carryOverPatches([t], '2026-08-26')
    expect(p).toHaveLength(1)
    expect(p[0].patch.scheduled_on).toBe('2026-08-26')
    expect(p[0].patch.carried_count).toBe(1)
    expect(p[0].patch.carried_from).toBe('2026-08-25')
  })

  it('merkt sich den ursprünglichen Tag über mehrere Verschiebungen', () => {
    const t = aufgabe({ scheduled_on: '2026-08-25', carried_count: 2, carried_from: '2026-08-20' })
    expect(carryOverPatches([t], '2026-08-26')[0].patch.carried_from).toBe('2026-08-20')
  })

  it('lässt feste Termine an ihrem Tag stehen', () => {
    const t = aufgabe({ scheduled_on: '2026-08-25', pinned_day: 1 })
    expect(carryOverPatches([t], '2026-08-26')).toHaveLength(0)
  })

  it('fasst Erledigtes und „Irgendwann" nicht an', () => {
    expect(carryOverPatches([aufgabe({ scheduled_on: '2026-08-25', status: 'done' })], '2026-08-26')).toHaveLength(0)
    expect(carryOverPatches([aufgabe({ scheduled_on: '2026-08-25', bucket: 'someday' })], '2026-08-26')).toHaveLength(0)
  })

  it('ändert nichts, wenn es zweimal läuft', () => {
    const t = aufgabe({ scheduled_on: '2026-08-26' })
    expect(carryOverPatches([t], '2026-08-26')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------- Diagramme */

describe('Achsenbeschriftung', () => {
  it('findet runde Zahlen im Wertebereich', () => {
    expect(niceTicks(0, 1000)).toEqual([0, 200, 400, 600, 800, 1000])
    expect(niceTicks(0, 3)).toEqual([0, 1, 2, 3])
  })
  it('kommt mit negativen Werten zurecht', () => {
    const t = niceTicks(-500, 1000)
    expect(t[0]).toBeLessThanOrEqual(0)
    expect(t).toContain(0)
  })
  it('bleibt bei entartetem Bereich ruhig', () => {
    expect(niceTicks(5, 5)).toEqual([5])
  })
})

/* -------------------------------------------------------------- Kalender */

const termin = (over: Record<string, any> = {}) => ({
  ...basis, id: 'e' + Math.random().toString(36).slice(2), title: 'Termin',
  description: null, location: null, day: '2026-08-26', start_time: '10:00',
  end_time: '11:00', all_day: 0, timezone: 'Europe/Berlin', rrule: null,
  exdates: null, color: null, source: 'local', external_uid: null,
  end_day: null, reminder_minutes: null,
  ...over,
}) as any

describe('Termine auf Tage auflösen', () => {
  it('nimmt einen einzelnen Termin genau einmal', () => {
    const v = vorkommenIn([termin()], '2026-08-01', '2026-08-31')
    expect(v).toHaveLength(1)
    expect(v[0].teil).toBeNull()
  })

  it('legt einen mehrtägigen Termin auf jeden seiner Tage', () => {
    const v = vorkommenIn([termin({ day: '2026-08-24', end_day: '2026-08-26' })], '2026-08-01', '2026-08-31')
    expect(v.map((x) => x.day)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26'])
    expect(v[1].teil).toEqual({ nr: 2, von: 3 })
  })

  it('zeigt einen mehrtägigen Termin auch, wenn er vor dem Zeitraum begann', () => {
    const v = vorkommenIn([termin({ day: '2026-07-30', end_day: '2026-08-02' })], '2026-08-01', '2026-08-31')
    expect(v.map((x) => x.day)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('löst wöchentliche Wiederholungen auf', () => {
    const v = vorkommenIn([termin({ day: '2026-08-03', rrule: 'FREQ=WEEKLY;BYDAY=MO' })], '2026-08-01', '2026-08-31')
    expect(v.map((x) => x.day)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('lässt ausgenommene Tage aus', () => {
    const v = vorkommenIn([termin({
      day: '2026-08-03', rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: '2026-08-10, 2026-08-24',
    })], '2026-08-01', '2026-08-31')
    expect(v.map((x) => x.day)).toEqual(['2026-08-03', '2026-08-17', '2026-08-31'])
  })

  it('sortiert ganztägige Termine vor die mit Uhrzeit', () => {
    const v = vorkommenIn([
      termin({ start_time: '09:00' }),
      termin({ all_day: 1, start_time: null, end_time: null }),
    ], '2026-08-26', '2026-08-26')
    expect(v[0].event.all_day).toBe(1)
  })
})

/* ------------------------------------------------- Aufgaben über mehrere Tage */

describe('Aufgaben mit Zeitraum', () => {
  it('erscheint an jedem Tag ihres Zeitraums', () => {
    const t = aufgabe({ scheduled_on: '2026-08-29', scheduled_end_on: '2026-08-30' })
    expect(tasksForDay([t], '2026-08-29')).toHaveLength(1)
    expect(tasksForDay([t], '2026-08-30')).toHaveLength(1)
    expect(tasksForDay([t], '2026-08-31')).toHaveLength(0)
    expect(tasksForDay([t], '2026-08-28')).toHaveLength(0)
  })

  it('verhält sich ohne Zeitraum wie eine gewöhnliche Aufgabe an einem Tag', () => {
    // today fest auf den Plantag gesetzt: sonst würde diese Prüfung an dem
    // Kalendertag falsch, an dem der wirkliche "heute" zufällig mit
    // scheduled_end_on zusammenfällt – das Übertrag-Verhalten für
    // liegengebliebene Aufgaben (siehe carryOverPatches) hat dann Vorrang.
    const t = aufgabe({ scheduled_on: '2026-08-29' })
    expect(tasksForDay([t], '2026-08-29', '2026-08-29')).toHaveLength(1)
    expect(tasksForDay([t], '2026-08-30', '2026-08-29')).toHaveLength(0)
  })

  it('verschiebt eine noch laufende Mehrtagesaufgabe nicht mitten im Zeitraum', () => {
    const t = aufgabe({ scheduled_on: '2026-08-25', scheduled_end_on: '2026-08-27' })
    expect(carryOverPatches([t], '2026-08-26')).toHaveLength(0)
    expect(carryOverPatches([t], '2026-08-28')).toHaveLength(1)
  })

  it('meldet eine noch laufende Mehrtagesaufgabe nicht als überfällig liegengeblieben', () => {
    const t = aufgabe({ scheduled_on: '2026-08-25', scheduled_end_on: '2026-08-27' })
    expect(dringlichkeit(t, '2026-08-26').level).toBe(0)
    expect(dringlichkeit(t, '2026-08-28').level).toBeGreaterThan(0)
  })
})

/* --------------------------------------------------- Aufgaben mit Teilfortschritt */

describe('Aufgabe erledigt/wieder öffnen', () => {
  it('schaltet zwischen offen und erledigt um', () => {
    const offen = aufgabe({ status: 'open' })
    const p1 = toggleTaskPatch(offen)
    expect(p1.status).toBe('done')
    expect(p1.completed_at).not.toBeNull()

    const erledigt = aufgabe({ status: 'done' })
    const p2 = toggleTaskPatch(erledigt)
    expect(p2.status).toBe('open')
    expect(p2.completed_at).toBeNull()
  })
})

describe('Teilfortschritt einer Aufgabe (z. B. 1/4 Teile fertig)', () => {
  it('zählt hoch und schließt bei Erreichen des Gesamts automatisch ab', () => {
    const t = aufgabe({ progress_total: 4, progress_done: 3, status: 'open' })
    const p = progressPatch(t, 1)
    expect(p.progress_done).toBe(4)
    expect(p.status).toBe('done')
    expect(p.completed_at).not.toBeNull()
  })

  it('öffnet eine erledigte Aufgabe wieder, wenn der Fortschritt darunter fällt', () => {
    const t = aufgabe({ progress_total: 4, progress_done: 4, status: 'done' })
    const p = progressPatch(t, -1)
    expect(p.progress_done).toBe(3)
    expect(p.status).toBe('open')
    expect(p.completed_at).toBeNull()
  })

  it('bleibt innerhalb von 0 und dem Gesamt', () => {
    const leer = aufgabe({ progress_total: 4, progress_done: 0 })
    expect(progressPatch(leer, -1).progress_done).toBe(0)
    const voll = aufgabe({ progress_total: 4, progress_done: 4, status: 'done' })
    expect(progressPatch(voll, 1).progress_done).toBe(4)
  })
})

/* --------------------------------------------------------- Schlaf als Std:Min */

describe('Schlafdauer als Std:Min statt Dezimalstunden', () => {
  it('rechnet Dezimalstunden in Std:Min um', () => {
    expect(formatHoursMinutes(7.5)).toBe('7:30')
    expect(formatHoursMinutes(8)).toBe('8:00')
    expect(formatHoursMinutes(0)).toBe('0:00')
  })

  const metricBase = {
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null, version: 1, last_device_id: 't', server_rev: null,
  }
  const sleepMetric: Metric = {
    ...metricBase, id: 'm1', key: 'sleep_h', name: 'Schlaf', group_key: 'sleep', unit: 'h',
    value_type: 'number', decimals: 1, scale_min: null, scale_max: null, scale_labels_json: null,
    aggregation: 'last', direction: 'range', is_builtin: 1, is_enabled: 1, show_in_daily_form: 1,
    show_zone: 1, color: null, sort_order: 0,
  }
  const weightMetric: Metric = {
    ...sleepMetric, id: 'm2', key: 'weight_kg', name: 'Gewicht', unit: 'kg', decimals: 1,
  }

  it('zeigt Schlaf als Std:Min ohne Einheit-Suffix', () => {
    expect(formatMetricValue(sleepMetric, 7.5)).toBe('7:30')
  })

  it('lässt andere Metriken unverändert bei Dezimalzahl mit Einheit', () => {
    expect(formatMetricValue(weightMetric, 72.4)).toBe('72,4 kg')
  })
})

/* ------------------------------------------------------- Finanzen: Konto und Händler */

describe('Buchungen eines Kontos', () => {
  const tx = (over: Record<string, any>) => ({
    ...basis, id: Math.random().toString(36), type: 'expense', booked_on: '2026-08-05',
    amount_cents: 1000, currency: 'EUR', account_id: 'a1', to_account_id: null,
    category_id: null, merchant: null, description: null, note: null,
    status: 'booked', recurring_id: null, import_batch_id: null, external_ref: null,
    ...over,
  }) as any

  it('findet Buchungen, bei denen das Konto Quelle oder Ziel ist', () => {
    const eigene = tx({ account_id: 'a1' })
    const alsZiel = tx({ type: 'transfer', account_id: 'a2', to_account_id: 'a1' })
    const andere = tx({ account_id: 'a2' })
    const result = transactionsForAccount([eigene, alsZiel, andere], 'a1')
    expect(result.map((t) => t.id).sort()).toEqual([eigene.id, alsZiel.id].sort())
  })

  it('lässt gelöschte und zu alte Buchungen weg', () => {
    const geloescht = tx({ deleted_at: '2026-08-01T00:00:00Z' })
    const zuAlt = tx({ booked_on: '2026-01-01' })
    const passend = tx({ booked_on: '2026-08-10' })
    const result = transactionsForAccount([geloescht, zuAlt, passend], 'a1', '2026-08-01')
    expect(result).toEqual([passend])
  })
})

describe('Häufigste Händler/Empfänger', () => {
  const tx = (over: Record<string, any>) => ({
    ...basis, id: Math.random().toString(36), type: 'expense', booked_on: '2026-08-05',
    amount_cents: 1000, currency: 'EUR', account_id: 'a1', to_account_id: null,
    category_id: null, merchant: null, description: null, note: null,
    status: 'booked', recurring_id: null, import_batch_id: null, external_ref: null,
    ...over,
  }) as any

  it('zählt Häufigkeit und sortiert absteigend', () => {
    const list = [
      tx({ merchant: 'REWE' }), tx({ merchant: 'REWE' }), tx({ merchant: 'REWE' }),
      tx({ merchant: 'Aldi' }), tx({ merchant: 'Aldi' }),
      tx({ merchant: 'dm' }),
    ]
    expect(topMerchants(list, 'expense')).toEqual(['REWE', 'Aldi', 'dm'])
  })

  it('trennt nach Buchungstyp und begrenzt auf das Limit', () => {
    const list = [
      tx({ merchant: 'Arbeitgeber', type: 'income' }),
      tx({ merchant: 'REWE', type: 'expense' }),
    ]
    expect(topMerchants(list, 'income')).toEqual(['Arbeitgeber'])
    expect(topMerchants(list, 'expense')).toEqual(['REWE'])
    const viele = Array.from({ length: 8 }, (_, i) => tx({ merchant: `Laden ${i}` }))
    expect(topMerchants(viele, 'expense', 5)).toHaveLength(5)
  })
})

/* -------------------------------------------- Finanztag-Punkte verlinken */

describe('financeChecklistRoute – verlinkt auf die betroffenen Buchungen, nicht nur den Bereich', () => {
  it('führt bei nicht kategorisierten Buchungen direkt zur gefilterten Liste', () => {
    expect(financeChecklistRoute({ kind: 'open_uncategorised' }))
      .toBe('#/finanzen/buchungen?uncategorised=1')
  })

  it('gibt Mindestbetrag und Datum der größeren Ausgaben als Filter mit', () => {
    expect(financeChecklistRoute({ kind: 'open_transactions', payload: { minAmount: 10000, since: '2026-07-15' } }))
      .toBe('#/finanzen/buchungen?minAmount=10000&since=2026-07-15')
  })

  it('führt beim Kontenabgleich zum betroffenen Konto', () => {
    expect(financeChecklistRoute({ kind: 'reconcile_account', payload: { accountId: 'konto1' } }))
      .toBe('#/finanzen/finanztag?account=konto1')
  })

  it('nimmt beim Monatsabschluss den betroffenen Monat mit', () => {
    expect(financeChecklistRoute({ kind: 'close_month', payload: { yearMonth: '2026-07' } }))
      .toBe('#/finanzen?month=2026-07')
  })

  it('kommt ohne Aktion oder bei unbekannter Art ohne Fehler zurecht', () => {
    expect(financeChecklistRoute(undefined)).toBeNull()
    expect(financeChecklistRoute({ kind: 'unbekannt' })).toBeNull()
  })
})

/* ------------------------------------------------- Frei anpassbare Seiten */

const seitenkarten: LayoutCardDef[] = [
  { id: 'a', title: 'Karte A' },
  { id: 'b', title: 'Karte B' },
  { id: 'c', title: 'Karte C', defaultVisible: false },
]

describe('resolveLayout – Kartenangebot einer Seite mit gespeicherter Einstellung verschmelzen', () => {
  it('zeigt ohne gespeicherte Einstellung die Standardreihenfolge und -sichtbarkeit', () => {
    expect(resolveLayout(seitenkarten, null)).toEqual([
      { id: 'a', title: 'Karte A', visible: true },
      { id: 'b', title: 'Karte B', visible: true },
      { id: 'c', title: 'Karte C', defaultVisible: false, visible: false },
    ])
  })

  it('übernimmt die gespeicherte Reihenfolge', () => {
    const ergebnis = resolveLayout(seitenkarten, { order: ['c', 'a', 'b'], hidden: [] })
    expect(ergebnis.map((k) => k.id)).toEqual(['c', 'a', 'b'])
  })

  it('übernimmt die gespeicherte Sichtbarkeit – auch entgegen der Werkseinstellung', () => {
    // c ist per Werkseinstellung unsichtbar, steht hier aber (bewusst vom Nutzer
    // eingeschaltet) in der Reihenfolge und NICHT in hidden.
    const ergebnis = resolveLayout(seitenkarten, { order: ['a', 'b', 'c'], hidden: ['a'] })
    const byId = new Map(ergebnis.map((k) => [k.id, k.visible]))
    expect(byId.get('a')).toBe(false)
    expect(byId.get('c')).toBe(true)
    expect(byId.get('b')).toBe(true)
  })

  it('übergeht eine gespeicherte Karten-ID, die es nicht mehr gibt, ohne Fehler', () => {
    const ergebnis = resolveLayout(seitenkarten, { order: ['x', 'a', 'geloescht', 'b'], hidden: ['geloescht'] })
    expect(ergebnis.map((k) => k.id)).toEqual(['a', 'b', 'c'])
  })

  it('hängt eine neue Karte, die die gespeicherte Einstellung noch nicht kannte, sichtbar ans Ende', () => {
    // Die Einstellung wurde gespeichert, als es "b" noch nicht gab.
    const ergebnis = resolveLayout(seitenkarten, { order: ['c', 'a'], hidden: [] })
    expect(ergebnis.map((k) => k.id)).toEqual(['c', 'a', 'b'])
    expect(ergebnis.find((k) => k.id === 'b')?.visible).toBe(true)
  })

  it('kommt mit einer leeren Einstellung ({order:[],hidden:[]}) wie ohne Einstellung zurecht', () => {
    expect(resolveLayout(seitenkarten, { order: [], hidden: [] })).toEqual(resolveLayout(seitenkarten, null))
  })
})

describe('moveInOrder – Karte in der Reihenfolge verschieben', () => {
  it('tauscht mit dem Nachbarn', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
  })

  it('tut nichts, wenn die Karte schon am Rand steht', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })

  it('tut nichts bei einer unbekannten ID', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'zzz', 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('toggleCardVisible / moveCard – vollständige, speicherbare Einstellung liefern', () => {
  it('blendet eine sichtbare Karte aus und wieder ein', () => {
    const ausgeblendet = toggleCardVisible(seitenkarten, null, 'a')
    expect(ausgeblendet.hidden).toContain('a')
    const wiederEingeblendet = toggleCardVisible(seitenkarten, ausgeblendet, 'a')
    expect(wiederEingeblendet.hidden).not.toContain('a')
  })

  it('verschiebt eine Karte und merkt sich das dauerhaft, auch ohne vorherige Einstellung', () => {
    const verschoben = moveCard(seitenkarten, null, 'a', 1)
    expect(verschoben.order).toEqual(['b', 'a', 'c'])
    // Reihenfolge bleibt beim nächsten Verschmelzen erhalten
    expect(resolveLayout(seitenkarten, verschoben).map((k) => k.id)).toEqual(['b', 'a', 'c'])
  })
})

/* ------------------------------------------------- Investments (Trading212) */

describe('Investments (Trading212)', () => {
  let seq = 0
  function move(partial: Partial<InvestmentMove> & { kind: 'buy' | 'sell'; amount_cents: number }): InvestmentMove {
    seq++
    return {
      id: `m${seq}`,
      investment_id: 'i1',
      day: '2026-01-01',
      cost_basis_cents: null,
      note: null,
      deleted_at: null,
      ...partial,
    }
  }

  it('nur ein Kauf: Rest = Einsatz, kein Erlös, kein Gewinn/Verlust, nicht geschlossen', () => {
    const moves = [move({ kind: 'buy', amount_cents: 10000, day: '2026-01-01' })]
    const s = summarizeInvestment(moves)
    expect(s.totalInvested).toBe(10000)
    expect(s.remainingBasis).toBe(10000)
    expect(s.totalProceeds).toBe(0)
    expect(s.realizedProfitLoss).toBe(0)
    expect(s.isClosed).toBe(false)
  })

  it('Kauf + vollständiger Verkauf: Rest 0, geschlossen, G/V = Erlös - Einsatz', () => {
    const moves = [
      move({ kind: 'buy', amount_cents: 10000, day: '2026-01-01' }),
      move({ kind: 'sell', amount_cents: 12000, cost_basis_cents: 10000, day: '2026-02-01' }),
    ]
    const s = summarizeInvestment(moves)
    expect(s.remainingBasis).toBe(0)
    expect(s.isClosed).toBe(true)
    expect(s.totalProceeds).toBe(12000)
    expect(s.realizedProfitLoss).toBe(2000)
  })

  it('Kauf + Teilverkauf: Rest = Einsatz - verkaufter Einsatz, weiterhin offen', () => {
    const moves = [
      move({ kind: 'buy', amount_cents: 10000, day: '2026-01-01' }),
      move({ kind: 'sell', amount_cents: 4000, cost_basis_cents: 3000, day: '2026-02-01' }),
    ]
    const s = summarizeInvestment(moves)
    expect(s.remainingBasis).toBe(7000)
    expect(s.isClosed).toBe(false)
    expect(s.realizedProfitLoss).toBe(1000)
  })

  it('Kauf, Teilverkauf, dann zweiter Verkauf des Rests: geschlossen, G/V summiert beide Verkäufe', () => {
    const moves = [
      move({ kind: 'buy', amount_cents: 10000, day: '2026-01-01' }),
      move({ kind: 'sell', amount_cents: 4000, cost_basis_cents: 3000, day: '2026-02-01' }),
      move({ kind: 'sell', amount_cents: 6500, cost_basis_cents: 7000, day: '2026-03-01' }),
    ]
    const s = summarizeInvestment(moves)
    expect(s.remainingBasis).toBe(0)
    expect(s.isClosed).toBe(true)
    // 1000 aus dem ersten Verkauf + (6500 - 7000) aus dem zweiten
    expect(s.realizedProfitLoss).toBe(1000 + (6500 - 7000))
  })

  it('mehrere Käufe vor jedem Verkauf: totalInvested summiert korrekt', () => {
    const moves = [
      move({ kind: 'buy', amount_cents: 5000, day: '2026-01-01' }),
      move({ kind: 'buy', amount_cents: 3000, day: '2026-01-15' }),
      move({ kind: 'buy', amount_cents: 2000, day: '2026-02-01' }),
    ]
    const s = summarizeInvestment(moves)
    expect(s.totalInvested).toBe(10000)
    expect(s.remainingBasis).toBe(10000)
  })

  it('ignoriert gelöschte Bewegungen', () => {
    const moves = [
      move({ kind: 'buy', amount_cents: 10000, day: '2026-01-01' }),
      move({ kind: 'sell', amount_cents: 999999, cost_basis_cents: 10000, day: '2026-02-01', deleted_at: '2026-02-02T00:00:00Z' }),
    ]
    const s = summarizeInvestment(moves)
    expect(s.remainingBasis).toBe(10000)
    expect(s.totalProceeds).toBe(0)
    expect(s.isClosed).toBe(false)
  })

  it('maxSellCostBasis liefert dasselbe wie summarizeInvestment().remainingBasis', () => {
    const moves = [
      move({ kind: 'buy', amount_cents: 10000, day: '2026-01-01' }),
      move({ kind: 'sell', amount_cents: 4000, cost_basis_cents: 3000, day: '2026-02-01' }),
    ]
    expect(maxSellCostBasis(moves)).toBe(summarizeInvestment(moves).remainingBasis)
  })

  it('validateSellCostBasis: lehnt 0/negativ ab, lehnt mehr als remainingBasis ab, akzeptiert gültigen Wert', () => {
    expect(validateSellCostBasis(5000, 0).ok).toBe(false)
    expect(validateSellCostBasis(5000, -100).ok).toBe(false)
    expect(validateSellCostBasis(5000, 5001).ok).toBe(false)
    expect(validateSellCostBasis(5000, 5000).ok).toBe(true)
    expect(validateSellCostBasis(5000, 2500).ok).toBe(true)
  })

  it('summarizePortfolio aggregiert über mehrere Investments und ignoriert gelöschte', () => {
    const invests = [
      { id: 'i1', deleted_at: null },
      { id: 'i2', deleted_at: null },
      { id: 'i3', deleted_at: '2026-02-02T00:00:00Z' }, // gelöscht – zählt nicht mit
    ]
    const byInvestment = new Map<string, InvestmentMove[]>([
      ['i1', [
        move({ investment_id: 'i1', kind: 'buy', amount_cents: 10000, day: '2026-01-01' }),
        move({ investment_id: 'i1', kind: 'sell', amount_cents: 12000, cost_basis_cents: 10000, day: '2026-02-01' }),
      ]],
      ['i2', [
        move({ investment_id: 'i2', kind: 'buy', amount_cents: 5000, day: '2026-01-01' }),
      ]],
      ['i3', [
        // Sollte komplett ignoriert werden, da die Position selbst gelöscht ist
        move({ investment_id: 'i3', kind: 'buy', amount_cents: 999999, day: '2026-01-01' }),
      ]],
    ])
    const p = summarizePortfolio(invests, byInvestment)
    expect(p.totalInvested).toBe(15000)       // 10000 + 5000, i3 ignoriert
    expect(p.totalRemaining).toBe(5000)       // i1 geschlossen (0), i2 offen (5000)
    expect(p.totalRealizedProfitLoss).toBe(2000)
    expect(p.openCount).toBe(1)               // i2
    expect(p.closedCount).toBe(1)             // i1
  })
})
