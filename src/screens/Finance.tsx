/**
 * FINANZEN – der Rahmen: Reiter und Adressen.
 *
 * Die Reiter liegen je in einer eigenen Datei unter `finance/`. Sie teilen
 * sich nichts als die Adresse, an der sie hängen: Jeder Reiter holt seine
 * Daten selbst aus dem Speicher und rechnet mit `core/finance.ts`. Deshalb
 * ist das hier bewusst nur eine Weiche und keine gemeinsame Zwischenschicht –
 * eine solche Schicht hätte alle sieben Reiter aneinandergebunden.
 */
import React from 'react'
import { Tabs } from '../ui/components'
import { Overview } from './finance/Overview'
import { TransactionsTab } from './finance/Transactions'
import { AccountsTab } from './finance/Accounts'
import { BudgetsTab } from './finance/Budgets'
import { RecurringTab } from './finance/Recurring'
import { FinanceDayTab } from './finance/FinanceDay'
import { InvestmentsTab } from './finance/Investments'


export function FinanceScreen({ sub, params, navigate, openQuickAdd }: {
  sub: string; params?: Record<string, string>; navigate: (r: string) => void; openQuickAdd: (kind?: any) => void
}) {
  const tabs = [
    { key: '', label: 'Übersicht' },
    { key: 'buchungen', label: 'Buchungen' },
    { key: 'konten', label: 'Konten' },
    { key: 'budgets', label: 'Budgets' },
    { key: 'wiederkehrend', label: 'Wiederkehrend' },
    { key: 'finanztag', label: 'Finanztag' },
    { key: 'investments', label: 'Investments' },
  ]
  const p = params ?? {}
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Finanzen</div>
        </div>
        <div className="page-actions nur-schreibtisch">
          <button className="btn btn-primary" onClick={() => openQuickAdd('transaction')}>+ Buchung</button>
        </div>
      </div>
      <Tabs tabs={tabs} active={sub} onChange={(k) => navigate(`#/finanzen${k ? '/' + k : ''}`)} />
      {sub === '' && <Overview navigate={navigate} params={p} />}
      {sub === 'buchungen' && <TransactionsTab openQuickAdd={openQuickAdd} params={p} />}
      {sub === 'konten' && <AccountsTab />}
      {sub === 'budgets' && <BudgetsTab />}
      {sub === 'wiederkehrend' && <RecurringTab />}
      {sub === 'finanztag' && <FinanceDayTab navigate={navigate} params={p} />}
      {sub === 'investments' && <InvestmentsTab />}
    </div>
  )
}
