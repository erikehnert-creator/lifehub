/**
 * FINANZEN · FINANZTAG – Konten mit der Realität abgleichen.
 */
import React, { useMemo, useState } from 'react'
import { Card, Stat, Field, Empty, MoneyInput } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { accountBalances } from '../../core/finance'
import { formatMoney, parseAmountToCents } from '../../core/money'
import { todayString, formatDay } from '../../core/dates'
import { generateFinanceDayChecklist, financeChecklistRoute } from '../../core/financeDay'

/* -------------------------------------------------------------- Finanztag */

export function FinanceDayTab({ navigate, params }: { navigate: (r: string) => void; params: Record<string, string> }) {
  const data = useData()
  const m = useMutations()
  const today = todayString()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [actual, setActual] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  // Von einem Finanztag-Punkt „Kontostand X abgleichen" oder „Bargeld zählen"
  // kommt man mit dem betroffenen Konto in der Query an – die Zeile wird
  // hervorgehoben, damit man sie unter allen Konten nicht erst suchen muss.
  const highlightAccountId = params.account || null

  const balances = useMemo(() => accountBalances(data.accounts, data.transactions), [data.accounts, data.transactions])
  const accounts = data.accounts.filter((a) => !a.deleted_at && a.is_active)
  const lastRun = data.financeDayRuns.find((r: any) => !r.deleted_at) ?? null
  const lastCheckOf = (id: string) =>
    data.accountChecks.find((c: any) => !c.deleted_at && c.account_id === id) ?? null

  const diffs = accounts.map((a) => {
    const expected = balances.get(a.id) ?? 0
    const raw = actual[a.id]
    const actualCents = raw === undefined || raw.trim() === '' ? null : parseAmountToCents(raw)
    return { account: a, expected, actualCents, diff: actualCents === null ? null : actualCents - expected }
  })
  const filled = diffs.filter((d) => d.actualCents !== null)
  const withDiff = filled.filter((d) => d.diff !== 0)

  const items = useMemo(() => generateFinanceDayChecklist({
    accounts, transactions: data.transactions, budgets: data.budgets,
    categories: data.categories, goals: data.goals, recurring: data.recurring,
    today, lastRunOn: lastRun?.ran_on ?? null,
  }).filter((i) => !i.key.startsWith('stale_') && !i.key.startsWith('cash_')),
  [accounts, data, today, lastRun])

  const openItems = items.filter((i) => !done.has(i.key))

  /**
   * Den Abgleich speichern.
   *
   * Als EIN Stapel: je Konto bis zu zwei Zeilen plus der Protokolleintrag –
   * einzeln geschrieben wären das bei acht Konten siebzehn vollständige
   * Neuladungen des Datenbildes. Die Zustandsänderungen der Oberfläche und die
   * Meldung stehen bewusst DANACH, außerhalb des Stapels.
   */
  const saveReconciliation = () => {
    const corrections = m.batch(() => schreibeAbgleich())
    setActual({}); setNote(''); setDone(new Set())
    m.toast(corrections ? `Abgeglichen · ${corrections} Korrekturbuchungen` : 'Abgeglichen · alles stimmte')
  }

  const schreibeAbgleich = (): number => {
    let corrections = 0
    for (const d of filled) {
      let correctionId: string | null = null
      if (d.diff !== 0 && d.diff !== null) {
        correctionId = m.create('transactions', {
          type: d.diff > 0 ? 'income' : 'expense', booked_on: today,
          amount_cents: Math.abs(d.diff), currency: 'EUR',
          account_id: d.account.id, to_account_id: null, category_id: null,
          merchant: null, description: 'Korrektur Kontenabgleich', note: note || null,
          status: 'booked',
        })
        corrections++
      }
      m.create('account_checks', {
        account_id: d.account.id, day: today,
        expected_cents: d.expected, actual_cents: d.actualCents!,
        correction_id: correctionId, note: note || null,
      })
    }
    m.create('finance_day_runs', {
      ran_on: today,
      checklist_json: JSON.stringify({
        accounts: filled.map((d) => ({ name: d.account.name, expected: d.expected, actual: d.actualCents, diff: d.diff })),
        checklist: items.map((i) => ({ key: i.key, title: i.title, done: done.has(i.key) })),
      }),
      completed_at: new Date().toISOString(), note: note || null,
    })
    return corrections
  }

  return (
    <>
      <Card className="mb16" title="Finanztag"
        sub="Der feste Termin, an dem du alle Konten mit der Realität abgleichst – damit die App denselben Stand hat wie deine Bank.">
        <div className="hint-box">
          <p style={{ marginTop: 0 }}>
            <strong>So läuft er ab:</strong> Du öffnest deine Banking-App und trägst unten für jedes Konto
            den tatsächlichen Stand ein. LifeHub zeigt sofort die Differenz zum errechneten Wert und legt
            beim Speichern für jede Abweichung eine Korrekturbuchung an. Danach stimmen beide Seiten wieder.
          </p>
          <p style={{ marginBottom: 0 }}>
            Bargeld läuft genauso mit: einmal zählen, Zahl eintragen, fertig. Darunter steht, was sonst
            noch ansteht – und zwar nur das, was gerade wirklich offen ist.
          </p>
        </div>
        <div className="row mt16">
          <Stat small label="Letzter Finanztag" value={lastRun ? formatDay(lastRun.ran_on) : 'noch keiner'} />
          <Stat small label="Konten abzugleichen" value={`${filled.length} / ${accounts.length}`} />
          <Stat small label="Offene Punkte" value={String(openItems.length)} />
        </div>
      </Card>

      <Card className="mb16" title="Kontenabgleich" sub={`Stand vom ${formatDay(today)}`}>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>Konto</th>
                <th className="num">Laut LifeHub</th>
                <th className="num">Tatsächlich</th>
                <th className="num">Differenz</th>
                <th>Zuletzt geprüft</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => {
                const check = lastCheckOf(d.account.id)
                const highlighted = d.account.id === highlightAccountId
                return (
                  <tr key={d.account.id}
                    ref={(el) => { if (highlighted) el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}
                    style={highlighted ? { background: 'rgba(250,178,25,.18)', outline: '1.5px solid var(--warning)' } : undefined}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 13, background: d.account.color ?? undefined }}>{d.account.icon ?? '🏦'}</span>
                        {d.account.name}
                      </span>
                    </td>
                    <td className="num">{formatMoney(d.expected)}</td>
                    <td className="num">
                      <MoneyInput value={actual[d.account.id] ?? ''} placeholder="eintragen" allowNegative
                        style={{ width: 118, textAlign: 'right' }}
                        onChange={(v) => setActual({ ...actual, [d.account.id]: v })} />
                    </td>
                    <td className="num">
                      {d.diff === null ? <span className="muted">–</span>
                        : d.diff === 0 ? <span className="pill good">stimmt</span>
                        : <strong style={{ color: d.diff > 0 ? 'var(--good-text)' : 'var(--critical)' }}>
                            {formatMoney(d.diff, { sign: true })}
                          </strong>}
                    </td>
                    <td className="small muted">{check ? formatDay(check.day) : 'nie'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt16">
          <Field label="Notiz zum Abgleich" hint="optional – etwa woher eine Differenz kam">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        {withDiff.length > 0 && (
          <div className="hint-box mt12">
            Beim Speichern werden <strong>{withDiff.length} Korrekturbuchungen</strong> angelegt:
            {' '}{withDiff.map((d) => `${d.account.name} ${formatMoney(d.diff!, { sign: true })}`).join(' · ')}
          </div>
        )}

        <button className="btn btn-primary mt16" disabled={!filled.length} onClick={saveReconciliation}>
          {filled.length ? `Abgleich speichern (${filled.length} Konten)` : 'Trage die tatsächlichen Stände ein'}
        </button>
      </Card>

      <Card title="Was sonst noch ansteht" sub="Nur Punkte, die gerade wirklich offen sind." className="pad0">
        {items.length === 0 ? (
          <div style={{ padding: 16 }}><Empty icon="✅" title="Nichts zu tun" hint="Deine Finanzen sind aktuell." /></div>
        ) : (
          <div className="list">
            {items.map((i) => {
              const isDone = done.has(i.key)
              return (
                <div className={`list-row ${isDone ? 'done' : ''}`} key={i.key}>
                  <button className={`checkbox ${isDone ? 'checked' : ''}`}
                    onClick={() => setDone((sset) => { const n = new Set(sset); n.has(i.key) ? n.delete(i.key) : n.add(i.key); return n })}>✓</button>
                  <span className="list-main">
                    <span className="list-title">{i.title}</span>
                    <span className="list-sub">{i.detail}</span>
                    <span className="list-sub" style={{ fontStyle: 'italic' }}>Warum: {i.reason}</span>
                  </span>
                  {financeChecklistRoute(i.action) && (
                    <button className="btn btn-sm" onClick={() => navigate(financeChecklistRoute(i.action)!)}>Öffnen</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}
