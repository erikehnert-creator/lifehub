/**
 * Verwaiste Tageswerte wieder einhängen – das Ausführen.
 *
 * Die Entscheidung, welche Zeile wohin gehört, steht in core/reparatur.ts und
 * ist dort ohne Datenbank prüfbar. Hier wird nur gelesen und geschrieben.
 *
 * Warum überhaupt Code und keine Migration: Eine SQL-Migration kann nur, was
 * SQL kann. Um einen verwaisten Tageswert seiner Metrik zuzuordnen, muss die
 * abgeleitete Zeilen-ID nachgerechnet werden (core/ids.ts, stableId) – und die
 * entsteht in JavaScript. Deshalb läuft das beim Start, so wie
 * `ensureBuiltinMetrics` auch.
 */
import { all } from './sqlite'
import { list, update } from './repo'
import {
  LEERER_PLAN, planeReparatur, planIstLeer, type ReparaturPlan, type VerwaisterTageswert,
} from '../core/reparatur'

export type { ReparaturPlan } from '../core/reparatur'

/**
 * Nachsehen, ob etwas verwaist ist – ohne etwas zu ändern.
 *
 * Der Normalfall ist eine einzige Abfrage, die nichts findet: Der Verbund über
 * `ix_me_metric_day` ist billig, und ohne Treffer wird gar nichts weiter getan.
 */
export function findeVerwaisteTageswerte(): ReparaturPlan {
  const verwaist = all<VerwaisterTageswert>(
    `SELECT e.id, e.day, e.metric_id
       FROM metric_entries e
       LEFT JOIN metrics m ON m.id = e.metric_id
      WHERE m.id IS NULL AND e.deleted_at IS NULL`,
  )
  if (!verwaist.length) return LEERER_PLAN

  return planeReparatur(
    verwaist,
    list<{ id: string; key: string; name: string }>('metrics'),
    list<{ id: string; metric_id: string; period: string | null }>('metric_targets'),
  )
}

/**
 * Den Plan anwenden.
 *
 * Über `update()` und nicht per direktem SQL: So werden die Zeilen als „noch
 * zu senden" markiert und die Berichtigung erreicht auch das andere Gerät.
 * Sonst stünde der Wert hier wieder da und dort weiterhin nicht.
 */
export function repariereVerwaisteTageswerte(
  batch: <T>(fn: () => T) => T = (fn) => fn(),
): ReparaturPlan {
  const plan = findeVerwaisteTageswerte()
  if (planIstLeer(plan)) return plan
  batch(() => {
    for (const t of plan.tageswerte) update('metric_entries', t.id, { metric_id: t.metric_id })
    for (const z of plan.zielbereiche) update('metric_targets', z.id, { metric_id: z.metric_id })
  })
  return plan
}
