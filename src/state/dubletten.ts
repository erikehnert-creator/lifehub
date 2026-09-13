/**
 * Doppelte Konten und Kategorien: sammeln, anzeigen, zusammenführen.
 *
 * Die Entscheidung, welche Zeile bleibt, steht in core/dubletten.ts und ist
 * dort ohne Datenbank prüfbar. Hier wird sie ausgeführt.
 *
 * Die Reihenfolge beim Ausführen ist nicht beliebig: Erst wird alles umgehängt,
 * DANN wird die Dublette in den Papierkorb gelegt. Andersherum gäbe es einen
 * Moment, in dem Buchungen auf ein gelöschtes Konto zeigen – und wenn dabei
 * etwas schiefginge, stünde man mit verwaisten Buchungen da.
 *
 * Gelöscht wird ohnehin nur weich (`deleted_at`), wie überall in LifeHub. Wer
 * sich vertan hat, findet die Zeile im Papierkorb wieder.
 */
import { list } from '../db/repo'
import {
  ersetzeKontoImTemplate, planeZusammenfuehrung,
  type DublettenZeile, type Verweis, type Zusammenfuehrung,
} from '../core/dubletten'
import type { Mutations } from './store'

export interface DublettenBefund {
  konten: Zusammenfuehrung[]
  kategorien: Zusammenfuehrung[]
}

/* ------------------------------------------------------------- Einsammeln */

/**
 * Jede Stelle, an der eine Kontokennung steht.
 *
 * Die Liste ist der heikle Teil: Wird hier eine Tabelle vergessen, zeigt sie
 * nach dem Zusammenführen auf ein Konto im Papierkorb. Deshalb steht daneben,
 * woher sie kommt – wer eine neue Spalte mit `account_id` anlegt, muss sie
 * hier ergänzen (`tests/dubletten.test.ts` erinnert daran).
 */
function kontoVerweise(): Verweis[] {
  const out: Verweis[] = []
  const nimm = (tabelle: string, feld: string) => {
    for (const r of list(tabelle as any, { includeDeleted: true }) as any[]) {
      const ziel = r[feld]
      if (ziel) out.push({ tabelle, feld, zeile: r.id, ziel })
    }
  }
  nimm('transactions', 'account_id')
  nimm('transactions', 'to_account_id')
  nimm('account_checks', 'account_id')
  nimm('goals', 'target_account_id')

  // Die wiederkehrenden Zahlungen tragen die Kontokennung im JSON.
  for (const r of list('recurring_rules', { includeDeleted: true }) as any[]) {
    let tpl: any
    try { tpl = JSON.parse(r.template_json || '{}') } catch { continue }
    for (const feld of ['account_id', 'to_account_id']) {
      if (tpl?.[feld]) out.push({ tabelle: 'recurring_rules', feld, zeile: r.id, ziel: tpl[feld] })
    }
  }
  return out
}

function kategorieVerweise(): Verweis[] {
  const out: Verweis[] = []
  const nimm = (tabelle: string, feld: string) => {
    for (const r of list(tabelle as any, { includeDeleted: true }) as any[]) {
      const ziel = r[feld]
      if (ziel) out.push({ tabelle, feld, zeile: r.id, ziel })
    }
  }
  nimm('transactions', 'category_id')
  nimm('budgets', 'category_id')
  nimm('categories', 'parent_id')

  for (const r of list('recurring_rules', { includeDeleted: true }) as any[]) {
    let tpl: any
    try { tpl = JSON.parse(r.template_json || '{}') } catch { continue }
    if (tpl?.category_id) {
      out.push({ tabelle: 'recurring_rules', feld: 'category_id', zeile: r.id, ziel: tpl.category_id })
    }
  }
  return out
}

/** Was gerade doppelt dasteht – ohne irgendetwas zu ändern. */
export function findeDubletten(): DublettenBefund {
  const konten: DublettenZeile[] = (list('accounts') as any[]).map((a) => ({
    id: a.id, name: a.name, art: a.type, created_at: a.created_at,
    deleted_at: a.deleted_at, opening_balance_cents: a.opening_balance_cents,
  }))
  const kategorien: DublettenZeile[] = (list('categories') as any[]).map((c) => ({
    id: c.id, name: c.name, art: c.kind, created_at: c.created_at, deleted_at: c.deleted_at,
  }))

  return {
    konten: planeZusammenfuehrung(konten, kontoVerweise()),
    kategorien: planeZusammenfuehrung(kategorien, kategorieVerweise()),
  }
}

/* -------------------------------------------------------------- Ausführen */

export interface ZusammenfuehrungsErgebnis {
  gruppen: number
  umgehaengt: number
  entfernt: number
}

/**
 * Den Plan anwenden: umhängen, dann die Dublette in den Papierkorb.
 *
 * `removeQuiet`, weil sonst für jede aufgelöste Zeile eine eigene Meldung samt
 * Rückgängig-Knopf erschiene – bei acht Dubletten acht Stück. Die eine
 * zusammenfassende Meldung kommt vom Aufrufer.
 */
export function fuehreZusammen(
  plaene: Zusammenfuehrung[], m: Mutations,
): ZusammenfuehrungsErgebnis {
  return m.batch(() => zusammenfuehren(plaene, m))
}

/**
 * Innerhalb eines Stapels: Umhängen und Aufräumen als eine Änderung.
 *
 * Getrennt von `fuehreZusammen`, damit die Reihenfolge sichtbar bleibt – und
 * damit klar ist, dass hier nichts einzeln nachgeladen wird. Bei acht Dubletten
 * mit hunderten Buchungen wären das sonst hunderte vollständige Neuladungen.
 */
function zusammenfuehren(
  plaene: Zusammenfuehrung[], m: Mutations,
): ZusammenfuehrungsErgebnis {
  let umgehaengt = 0
  let entfernt = 0

  for (const plan of plaene) {
    const nach = plan.behalten.id

    for (const v of plan.umzuege) {
      if (v.tabelle === 'recurring_rules' && (v.feld === 'account_id' || v.feld === 'to_account_id')) {
        // Im JSON, nicht in einer Spalte – deshalb lesen, ersetzen, schreiben.
        const r = (list('recurring_rules', {
          includeDeleted: true, where: 'id = ?', params: [v.zeile],
        }) as any[])[0]
        if (!r) continue
        const neu = ersetzeKontoImTemplate(r.template_json, v.ziel, nach)
        if (neu !== r.template_json) { m.patch('recurring_rules', v.zeile, { template_json: neu }); umgehaengt++ }
        continue
      }
      if (v.tabelle === 'recurring_rules' && v.feld === 'category_id') {
        const r = (list('recurring_rules', {
          includeDeleted: true, where: 'id = ?', params: [v.zeile],
        }) as any[])[0]
        if (!r) continue
        let tpl: any
        try { tpl = JSON.parse(r.template_json || '{}') } catch { continue }
        if (tpl?.category_id !== v.ziel) continue
        tpl.category_id = nach
        m.patch('recurring_rules', v.zeile, { template_json: JSON.stringify(tpl) })
        umgehaengt++
        continue
      }
      m.patch(v.tabelle as any, v.zeile, { [v.feld]: nach })
      umgehaengt++
    }

    // Erst jetzt, wo nichts mehr daran hängt.
    const tabelle = tabelleVon(plan)
    for (const z of plan.aufloesen) {
      m.removeQuiet(tabelle, z.id)
      entfernt++
    }
  }

  return { gruppen: plaene.length, umgehaengt, entfernt }
}

/**
 * Konto oder Kategorie?
 *
 * Am Anfangsbestand zu raten wäre unsicher – ein Konto darf durchaus bei 0
 * anfangen. Stattdessen wird nachgesehen, wo die Zeile tatsächlich liegt.
 */
function tabelleVon(plan: Zusammenfuehrung): 'accounts' | 'categories' {
  const alsKonto = list('accounts', {
    includeDeleted: true, where: 'id = ?', params: [plan.behalten.id],
  }) as any[]
  return alsKonto.length ? 'accounts' : 'categories'
}
