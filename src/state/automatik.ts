/**
 * Was die App von selbst erledigt – ohne dass jemand einen Knopf sucht.
 *
 * Vier Dinge, die man sonst von Hand machen müsste:
 *
 *  1. Fällige wiederkehrende Zahlungen buchen. Miete, Handyvertrag, Abos –
 *     sie stehen fest, also müssen sie nicht jedes Mal bestätigt werden.
 *  2. Aufgaben aus Vorlagen einplanen, vier Wochen im Voraus.
 *  3. Geänderte Vorlagen nachziehen und gelöschte aufräumen – aber nur bei
 *     dem, was noch bevorsteht (siehe core/automation.ts).
 *  4. Offene Aufgaben von gestern auf heute mitnehmen.
 *
 * ---------------------------------------------------------------------------
 * Warum das hier laufend und nicht einmal am Tag läuft
 *
 * Früher gab es eine Sperre im localStorage: einmal pro Tag, dann nie wieder.
 * Für das reine Erzeugen reicht das – für das Nachziehen nicht. Ändert man am
 * Handy die Trainingszeit von 18:00 auf 17:30, dann müsste der PC bis morgen
 * warten, bis er davon etwas merkt. Genau das soll nicht passieren.
 *
 * Deshalb läuft der Abgleich nach jeder Datenänderung erneut, kurz verzögert.
 * Das ist bezahlbar, weil er nichts tut, solange nichts zu tun ist: Er
 * vergleicht Soll und Ist und kommt im Normalfall mit einer leeren Liste
 * zurück. Nur der Tagesübertrag bleibt an den Kalendertag gebunden – er ist
 * datumsgetrieben, nicht datengetrieben.
 *
 * ---------------------------------------------------------------------------
 * Warum daraus keine Endlosschleife wird
 *
 * Der Abgleich schreibt Daten, und geschriebene Daten lösen den Abgleich
 * erneut aus. Das ist gewollt und endet von selbst, weil der zweite Durchlauf
 * nichts mehr findet. Damit ein Denkfehler daraus trotzdem keine Schleife
 * machen kann (ein Feld, das sich nie „gleich genug" anfühlt), merkt sich der
 * Lauf, was er zuletzt getan hat: Dieselbe Änderungsliste zweimal
 * hintereinander wird nicht ausgeführt, sondern gemeldet.
 */
import { useEffect, useRef } from 'react'
import { useApp } from './store'
import { carryOverPatches } from '../core/planner'
import { duePayments, reconcileTemplateTasks, VORPLANUNG_TAGE } from '../core/automation'
import { formatMoney } from '../core/money'
import { todayString } from '../core/dates'
import { list } from '../db/repo'

const UEBERTRAG_GELAUFEN = 'lifehub.automatik.gelaufen'

/** Wartezeit beim Start, damit der erste Abgleich mit dem Server durch ist. */
const VORLAUF_MS = 8000

/** Wartezeit nach einer Datenänderung – bündelt schnelles Tippen zu einem Lauf. */
const NACHLAUF_MS = 1500

export function useAutomatik() {
  const app = useApp()
  // Beim Ausführen zählt der Stand von dann, nicht der von vor acht Sekunden –
  // in der Zwischenzeit kann der Abgleich schon Buchungen mitgebracht haben.
  const jetzt = useRef(app)
  jetzt.current = app

  const ersterLauf = useRef(true)
  const letzteAenderungen = useRef('')

  const { data } = app

  useEffect(() => {
    if (!app.ready) return
    const verzoegerung = ersterLauf.current ? VORLAUF_MS : NACHLAUF_MS

    const timer = window.setTimeout(() => {
      ersterLauf.current = false
      const heute = todayString()
      const meldungen: string[] = []
      const { data: stand, mutations } = jetzt.current

      /* ------------------------------------------------ Fällige Zahlungen */
      if (stand.settings.auto_book_recurring !== false) {
        // Kein Bestätigen: Jede fällige, aktive Regel bucht von selbst. Wer
        // eine Zahlung mit schwankendem Betrag hat, korrigiert die entstandene
        // Buchung danach – sie verhält sich wie jede andere auch.
        const faellig = duePayments({
          rules: stand.recurring,
          transactions: stand.transactions,
          today: heute,
          exists: (id) => mutations.exists('transactions', id),
        })
        let summe = 0
        // Gebündelt: Sonst zahlt jede einzelne Buchung ihr eigenes Nachladen
        // des gesamten Bestands (siehe mutations.batch in state/store.tsx).
        if (faellig.length) {
          mutations.batch(() => {
            for (const b of faellig) {
              mutations.create('transactions', b.values)
              // Bereits gebuchte Zahlungen bleiben, wie sie sind – hier wird
              // nur vermerkt, bis wann die Regel abgearbeitet ist.
              mutations.patch('recurring_rules', b.ruleId, { last_generated_on: b.day })
              summe += b.betragCents
            }
            return ['transactions', 'recurring_rules']
          })
        }
        if (faellig.length === 1) meldungen.push(`${faellig[0].titel} gebucht (${formatMoney(summe)})`)
        else if (faellig.length > 1) meldungen.push(`${faellig.length} fällige Zahlungen gebucht`)
      }

      /* ------------------------------------------------ Aufgaben aus Vorlagen */
      if (stand.settings.auto_plan_templates !== false) {
        // Gelöschte Zeilen gehören ausdrücklich dazu: Eine gelöschte Vorlage
        // muss ihre zukünftigen Aufgaben mitnehmen, und eine von Hand
        // entfernte Aufgabe darf nicht wieder auferstehen.
        const plan = reconcileTemplateTasks({
          templates: list('task_templates', { includeDeleted: true }) as any,
          assignments: stand.dayAssignments
            .filter((a) => !a.deleted_at)
            .map((a) => ({ day: a.day, day_type_id: a.day_type_id })),
          tasks: list('tasks', { includeDeleted: true }) as any,
          today: heute,
          horizonDays: VORPLANUNG_TAGE,
          exists: (id) => mutations.exists('tasks', id),
        })

        // Schutzschalter gegen eine Schleife: Genau dieselbe Liste zweimal
        // hintereinander bedeutet, dass das Schreiben nichts bewirkt hat.
        const signatur = JSON.stringify(plan)
        const etwasZuTun = plan.anlegen.length + plan.aendern.length + plan.entfernen.length > 0
        if (etwasZuTun && signatur === letzteAenderungen.current) {
          console.warn('[Automatik] Dieselbe Änderung zweimal hintereinander – abgebrochen.', plan)
        } else {
          letzteAenderungen.current = signatur
          // Der erste Lauf legt vier Wochen im Voraus an – ohne Bündelung wäre
          // das ein vollständiges Nachladen je Aufgabe.
          if (etwasZuTun) {
            mutations.batch(() => {
              for (const a of plan.anlegen) mutations.create('tasks', a.values)
              for (const a of plan.aendern) mutations.patch('tasks', a.id, a.patch)
              // Leise, mit einer zusammenfassenden Meldung danach: Räumt die
              // Automatik zwölf Aufgaben einer gelöschten Vorlage ab, will
              // niemand zwölf einzelne Hinweise dazu wegtippen.
              for (const e of plan.entfernen) mutations.removeQuiet('tasks', e.id)
              return ['tasks']
            })
          }

          if (plan.anlegen.length === 1) meldungen.push('1 Aufgabe aus einer Vorlage eingeplant')
          else if (plan.anlegen.length > 1) meldungen.push(`${plan.anlegen.length} Aufgaben aus Vorlagen eingeplant`)
          if (plan.aendern.length === 1) meldungen.push('1 Aufgabe an die geänderte Vorlage angepasst')
          else if (plan.aendern.length > 1) meldungen.push(`${plan.aendern.length} Aufgaben an geänderte Vorlagen angepasst`)
          if (plan.entfernen.length === 1) meldungen.push('1 nicht mehr geplante Aufgabe entfernt')
          else if (plan.entfernen.length > 1) meldungen.push(`${plan.entfernen.length} nicht mehr geplante Aufgaben entfernt`)
        }
      }

      /* ---------------------------------------------------- Tagesübertrag */
      // Einmal pro Kalendertag und Gerät: Was gestern offen blieb, gehört in
      // den heutigen Plan. Datumsgetrieben, deshalb hier die Tagessperre.
      let uebertragGelaufen: string | null = null
      try { uebertragGelaufen = localStorage.getItem(UEBERTRAG_GELAUFEN) } catch { /* nicht verfügbar */ }
      if (uebertragGelaufen !== heute && stand.settings.carry_over_tasks !== false) {
        const uebertrag = carryOverPatches(stand.tasks, heute)
        if (uebertrag.length) {
          mutations.batch(() => {
            for (const u of uebertrag) mutations.patch('tasks', u.id, u.patch)
            return ['tasks']
          })
        }
        if (uebertrag.length === 1) meldungen.push('1 offene Aufgabe von gestern übernommen')
        else if (uebertrag.length > 1) meldungen.push(`${uebertrag.length} offene Aufgaben übernommen`)
        try { localStorage.setItem(UEBERTRAG_GELAUFEN, heute) } catch { /* nicht verfügbar */ }
      }

      if (meldungen.length) mutations.toast(meldungen.join(' · '))
    }, verzoegerung)

    return () => window.clearTimeout(timer)
    // Absichtlich an den Datenbeständen hängend, die den Abgleich beeinflussen:
    // Eine Vorlage, die auf dem anderen Gerät geändert wurde, kommt über den
    // Abgleich herein und soll hier sofort nachgezogen werden.
  }, [
    app.ready, app.today,
    data.taskTemplates, data.tasks, data.recurring, data.transactions,
    data.dayAssignments, data.settings,
  ])
}
