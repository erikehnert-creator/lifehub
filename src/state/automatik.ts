/**
 * Was die App beim Öffnen von selbst erledigt.
 *
 * Zwei Dinge, die man sonst jeden Tag von Hand machen müsste:
 *
 *  1. Fällige wiederkehrende Zahlungen buchen. Miete, Handyvertrag, Abos –
 *     sie stehen fest, also müssen sie nicht jedes Mal bestätigt werden.
 *  2. Offene Aufgaben von gestern auf heute mitnehmen. Was liegengeblieben
 *     ist, gehört in den heutigen Plan, nicht in die Vergangenheit.
 *
 * Beides läuft einmal pro Tag und so, dass ein zweiter Durchlauf nichts
 * kaputt macht: gebucht wird nur, was noch nicht gebucht ist. Das ist wichtig,
 * weil PC und Handy dieselbe Automatik ausführen.
 */
import { useEffect, useRef } from 'react'
import { useApp } from './store'
import { dueRecurringBookings } from '../core/finance'
import { carryOverPatches } from '../core/planner'
import { formatMoney } from '../core/money'
import { todayString } from '../core/dates'

const GELAUFEN = 'lifehub.automatik.gelaufen'

/** Wartezeit, damit der erste Abgleich mit dem Server durch ist. */
const VORLAUF_MS = 8000

export function useAutomatik() {
  const app = useApp()
  // Beim Ausführen zählt der Stand von dann, nicht der von vor acht Sekunden –
  // in der Zwischenzeit kann der Abgleich schon Buchungen mitgebracht haben.
  const jetzt = useRef(app)
  jetzt.current = app

  useEffect(() => {
    if (!app.ready) return
    const heute = todayString()
    let zuletzt: string | null = null
    try { zuletzt = localStorage.getItem(GELAUFEN) } catch { /* nicht verfügbar */ }
    if (zuletzt === heute) return

    const timer = window.setTimeout(() => {
      const { data, mutations } = jetzt.current
      const meldungen: string[] = []

      if (data.settings.auto_book_recurring !== false) {
        const faellig = dueRecurringBookings(data.recurring, data.transactions, heute)
          .filter((d) => d.rule.auto_book !== 0)
        let summe = 0
        for (const d of faellig) {
          mutations.create('transactions', {
            type: d.template.type ?? 'expense', booked_on: d.day, value_on: null,
            amount_cents: d.template.amount_cents ?? 0, currency: 'EUR',
            account_id: d.template.account_id, to_account_id: d.template.to_account_id ?? null,
            category_id: d.template.category_id ?? null,
            merchant: d.rule.title, description: null,
            note: 'Automatisch aus einer wiederkehrenden Zahlung gebucht',
            status: 'booked', recurring_id: d.rule.id,
          })
          mutations.patch('recurring_rules', d.rule.id, { last_generated_on: d.day })
          summe += d.template.amount_cents ?? 0
        }
        if (faellig.length === 1) {
          meldungen.push(`${faellig[0].rule.title} gebucht (${formatMoney(summe)})`)
        } else if (faellig.length > 1) {
          meldungen.push(`${faellig.length} fällige Zahlungen gebucht`)
        }
      }

      if (data.settings.carry_over_tasks !== false) {
        const uebertrag = carryOverPatches(data.tasks, heute)
        for (const u of uebertrag) mutations.patch('tasks', u.id, u.patch)
        if (uebertrag.length === 1) meldungen.push('1 offene Aufgabe von gestern übernommen')
        else if (uebertrag.length > 1) meldungen.push(`${uebertrag.length} offene Aufgaben übernommen`)
      }

      try { localStorage.setItem(GELAUFEN, heute) } catch { /* nicht verfügbar */ }
      if (meldungen.length) mutations.toast(meldungen.join(' · '))
    }, VORLAUF_MS)

    return () => window.clearTimeout(timer)
  }, [app.ready])
}
