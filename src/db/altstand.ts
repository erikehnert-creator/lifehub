/**
 * Migration 10 gab es zweimal.
 *
 * Am 16.09.2026 entstand im aufgegebenen Ordner `Dokumente/Projekte/LifeHub-Projekt`
 * eine eigene Migration 10 „vollstaendige_naehrwerte" – mit derselben Nummer und
 * demselben Namen wie die gültige, aber mit anderen Spalten. Eine Datenbank, die
 * einmal mit der dort gebauten LifeHub.html geöffnet wurde, hat die Nummer 10 als
 * erledigt vermerkt und trägt die falschen Spalten:
 *
 *   dort                     hier (und auf dem Server)
 *   polyunsaturated_fat_g    poly_fat_g
 *   monounsaturated_fat_g    mono_fat_g
 *   vitamin_a_mcg            vitamin_a_ug
 *   trans_fat_g, added_sugars_g, vitamin_d_mcg   – gibt es nicht
 *
 * Beides bricht still: Der Import schreibt in Spalten, die fehlen, und der
 * Abgleich sendet per `SELECT *` Spalten, die der Server ablehnt – für die
 * ganze Tabelle food_entries, bei jedem Versuch.
 *
 * Die Migrationsliste kann das nicht heilen, denn Nummer 10 gilt ja als
 * angewandt. Deshalb läuft diese Prüfung vor der Migrationsschleife. Der
 * Normalfall kostet eine PRAGMA-Abfrage und ändert nichts.
 *
 * Verloren geht dabei nichts, was irgendwo anders stünde: Die drei Werte ohne
 * Gegenstück hat der Server nie angenommen, und FatSecret liefert beim
 * nächsten Abgleich ohnehin alles erneut.
 */
import type { Database } from 'sql.js'

/** Spalte im alten Ordner → gleichbedeutende gültige Spalte (null = keine). */
export const FREMDE_SPALTEN: Record<string, string | null> = {
  polyunsaturated_fat_g: 'poly_fat_g',
  monounsaturated_fat_g: 'mono_fat_g',
  vitamin_a_mcg: 'vitamin_a_ug',
  trans_fat_g: null,
  added_sugars_g: null,
  vitamin_d_mcg: null,
}

/** Die Spalten, die die gültige Migration 10 anlegt. */
const GUELTIGE_SPALTEN = [
  'cholesterol_mg', 'potassium_mg', 'poly_fat_g', 'mono_fat_g',
  'vitamin_a_ug', 'vitamin_c_mg', 'calcium_mg', 'iron_mg',
]

function spaltenVon(database: Database, tabelle: string): Set<string> {
  const res = database.exec(`PRAGMA table_info(${tabelle})`)
  return new Set(res.length ? res[0].values.map((r) => String(r[1])) : [])
}

/**
 * Bringt eine Datenbank mit der fremden Migration 10 auf den gültigen Stand.
 * Gibt zurück, ob etwas zu tun war.
 */
export function fremdeMigration10Angleichen(database: Database): boolean {
  const vorhanden = spaltenVon(database, 'food_entries')
  const fremde = Object.keys(FREMDE_SPALTEN).filter((s) => vorhanden.has(s))
  if (!fremde.length) return false

  database.run('BEGIN')
  try {
    for (const s of GUELTIGE_SPALTEN) {
      if (!vorhanden.has(s)) database.run(`ALTER TABLE food_entries ADD COLUMN ${s} REAL`)
    }
    const uebernehmen = fremde.filter((s) => FREMDE_SPALTEN[s])
    if (uebernehmen.length) {
      // Nur leere Zielwerte füllen, und die Zeile als „noch zu senden" markieren:
      // Der Server hat diese Werte nie bekommen, weil jeder Versuch scheiterte.
      database.run(
        `UPDATE food_entries SET
           ${uebernehmen.map((s) => `${FREMDE_SPALTEN[s]} = COALESCE(${FREMDE_SPALTEN[s]}, ${s})`).join(', ')},
           _dirty = 1
         WHERE ${uebernehmen.map((s) => `${s} IS NOT NULL`).join(' OR ')}`,
      )
    }
    for (const s of fremde) database.run(`ALTER TABLE food_entries DROP COLUMN ${s}`)
    database.run('COMMIT')
  } catch (err) {
    database.run('ROLLBACK')
    throw new Error(`Angleichen der Naehrwert-Spalten fehlgeschlagen: ${String(err)}`)
  }
  return true
}
