/**
 * Datenschutz am Protokollimport – nachgerechnet statt zugesichert.
 *
 * Ein Wettkampfprotokoll nennt Namen, Jahrgänge und Vereine von Dutzenden
 * Teilnehmern, überwiegend Minderjährigen. Für den Import verlässt es Eriks
 * Gerät. Was dabei gilt, steht in Kommentaren – und Kommentare halten nichts
 * auf. Diese Prüfungen tun es.
 *
 * Geprüft wird am Quelltext, nicht zur Laufzeit: Die Edge Function lässt sich
 * aus `npm test` nicht starten (sie braucht Deno), aber sie lässt sich lesen.
 * Für den Weg durch die Oberfläche gibt es `turnen-import-e2e.mjs`.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ORDNER = path.join(__dirname, '..', 'supabase', 'functions', 'wettkampf-import')
const index = fs.readFileSync(path.join(ORDNER, 'index.ts'), 'utf8')
const parser = fs.readFileSync(path.join(ORDNER, 'protokoll.ts'), 'utf8')

/** Zeilen ohne Kommentare – sonst schlägt jede Erklärung als Fund an. */
const code = (text: string) => text
  .split(/\r?\n/)
  .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
  .join('\n')

describe('Die Importfunktion kennt keine Geheimnisse', () => {
  it('liest keinen Dienstschlüssel', () => {
    // Der Schlafimport braucht ihn, weil er schreibt. Dieser hier schreibt
    // nicht - und was man nicht liest, kann man nicht verlieren.
    expect(index).not.toMatch(/SERVICE_ROLE|SERVICE_KEY/)
  })

  it('liest überhaupt keine Umgebungsvariablen', () => {
    expect(code(index)).not.toMatch(/Deno\.env/)
  })

  it('trägt keinen Schlüssel und kein Token im Quelltext', () => {
    // Ein versehentlich eingefuegter Schluessel faellt sonst erst auf, wenn
    // das Repository schon oeffentlich ist. Es ist oeffentlich.
    expect(code(index)).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/)      // JWT
    expect(code(index)).not.toMatch(/sb[ph]_[A-Za-z0-9]{20,}/)    // Supabase-Schluessel
  })
})

describe('Die PDF wird nicht abgelegt', () => {
  it('schreibt keine Datei', () => {
    expect(code(index)).not.toMatch(/writeFile|writeTextFile|Deno\.create|Deno\.open/)
  })

  it('spricht keinen Dateispeicher an', () => {
    expect(code(index)).not.toMatch(/storage|bucket/i)
  })

  it('hält die Bytes nur für die Anfrage', () => {
    // Die Variable lebt im Rumpf der Anfrage. Ein Modulzustand waere ein
    // Zwischenspeicher, der die Anfrage ueberlebt.
    expect(code(index)).not.toMatch(/^(const|let|var)\s+(bytes|pdfCache|zwischenspeicher)/m)
  })
})

describe('Die Protokolle enthalten nur technische Angaben', () => {
  const logZeilen = index.split(/\r?\n/).filter((z) => /console\.(log|error|warn|info)/.test(z))

  it('protokolliert überhaupt etwas – sonst prüft der Rest nichts', () => {
    expect(logZeilen.length).toBeGreaterThan(0)
  })

  it('nennt keine Personenangaben', () => {
    for (const z of logZeilen) {
      // `(e as Error)?.name` ist der Name des Fehlertyps, nicht der eines
      // Menschen. Er wird bewusst protokolliert – ohne ihn stünde bei einer
      // kaputten PDF gar nichts da.
      //
      // Der Platzhalter darf keines der gesuchten Wörter enthalten. „Fehler-
      // klasse" wäre naheliegend gewesen und hätte an „klasse" selbst
      // angeschlagen – die Prüfung hätte sich an ihrem eigenen Ersatz gestossen.
      const ohneFehlername = z.replace(/\(e as Error\)\?\.name/g, '‹Fehlertyp›')
      expect(ohneFehlername, `Diese Zeile protokolliert Personendaten:\n  ${z.trim()}`)
        .not.toMatch(/\.name\b|\bverein|jahrgang|teilnehmer\s*\[|\.wert\b|klasse/i)
    }
  })

  it('nennt keine Noten und keinen Dateiinhalt', () => {
    for (const z of logZeilen) {
      expect(z, `Diese Zeile protokolliert Inhalte:\n  ${z.trim()}`)
        .not.toMatch(/d_score|e_score|final|gesamt|\bbytes\b|datei\.name|body/i)
    }
  })

  it('zählt nur – Seiten, Teilnehmer, Dauer, Fehlercode', () => {
    const zusammen = logZeilen.join('\n')
    expect(zusammen).toMatch(/seiten|Teilnehmer|ms|code/i)
  })
})

describe('Die Funktion schreibt nichts in die Datenbank', () => {
  it('spricht PostgREST gar nicht an', () => {
    expect(code(index)).not.toMatch(/rest\/v1/)
  })

  it('benutzt keinen Supabase-Client', () => {
    expect(code(index)).not.toMatch(/createClient|supabase-js/)
  })

  it('gibt Vorschläge zurück und sonst nichts', () => {
    // Der einzige Rueckgabeweg ist die Antwort auf die Anfrage.
    expect(index).toMatch(/ok: true/)
    expect(index).toMatch(/parseProtokoll/)
  })
})

describe('Der Leser bleibt rein', () => {
  it('ruft weder Netz noch Datei noch Laufzeit an', () => {
    // Genau deshalb laesst er sich aus den Tests laden und gegen ein echtes
    // Protokoll nachrechnen.
    expect(code(parser)).not.toMatch(/Deno\.|fetch\(|localStorage|require\(|import\(/)
  })

  it('hat überhaupt keine Importe', () => {
    expect(code(parser)).not.toMatch(/^import\s/m)
  })
})

describe('Was vor dem Deuten geprüft wird', () => {
  it('begrenzt die Dateigrösse', () => {
    expect(index).toMatch(/HOECHSTGROESSE/)
    expect(index).toMatch(/zu_gross/)
  })

  it('prüft die PDF-Signatur', () => {
    expect(index).toMatch(/siehtWiePdfAus/)
    // %PDF-
    expect(index).toMatch(/0x25.*0x50.*0x44/s)
  })

  it('begrenzt die Seitenzahl', () => {
    expect(index).toMatch(/HOECHSTSEITEN/)
    expect(index).toMatch(/zu_viele_seiten/)
  })
})

/* ==================================================== Vergleichswerte */

/**
 * Was von fremden Teilnehmern dauerhaft gespeichert wird – nämlich nichts.
 *
 * Der Konkurrenzvergleich braucht die anderen Turner, um einen Platz zu
 * rechnen. Danach dürfen sie nicht übrig bleiben. Dass das so ist, hängt hier
 * nicht an einer Absicht, sondern am Typ: `VergleichsTeilnehmer` hat kein Feld
 * für Name, Jahrgang oder Verein, und `gym_benchmarks` hat keine Spalte dafür.
 */
describe('Über fremde Teilnehmer bleibt nichts gespeichert', () => {
  const vergleichTs = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'core', 'turnen', 'vergleich.ts'), 'utf8')
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'db', 'schema.ts'), 'utf8')
  const serverSql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0001_init.sql'), 'utf8')

  /** Die Spalten der Vergleichstabelle, aus dem Schema gelesen. */
  const spalten = (text: string): string[] => {
    const treffer = text.match(/CREATE TABLE (?:IF NOT EXISTS )?gym_benchmarks \(([^;]*?)\)\s*;/s)
    expect(treffer, 'gym_benchmarks im Schema').toBeTruthy()
    return (treffer as RegExpMatchArray)[1]
      .split(',')
      .map((z) => z.trim().split(/\s+/)[0])
      .filter((n) => /^[a-z_]+$/.test(n))
  }

  const VERBOTEN = [
    'name', 'first_name', 'last_name', 'surname', 'vorname', 'nachname',
    'birth_year', 'year_of_birth', 'jahrgang', 'club', 'verein', 'team',
    'participant', 'teilnehmer', 'gymnast',
  ]

  it('hat in der Tabelle keine Spalte für Name, Jahrgang oder Verein', () => {
    for (const quelle of [schema, serverSql]) {
      for (const spalte of spalten(quelle)) {
        for (const wort of VERBOTEN) {
          expect(spalte.includes(wort),
            `Spalte „${spalte}" enthält „${wort}"`).toBe(false)
        }
      }
    }
  })

  /**
   * Die Basisfelder heraus.
   *
   * In `schema.ts` steht die Basis als Einsetzung – die Basisspalten sind dort
   * nicht ausgeschrieben, in `0001_init.sql` schon. Verglichen werden deshalb
   * die eigenen Spalten; die Basisfelder prüft `schema-parity.test.ts`, und
   * zwar am wirklich aufgebauten Schema statt am Text.
   */
  const BASIS = [
    'id', 'user_id', 'created_at', 'updated_at', 'deleted_at', 'version',
    'last_device_id', 'server_rev', '_dirty', '_conflict',
  ]
  const eigeneSpalten = (text: string) => spalten(text).filter((s) => !BASIS.includes(s))

  it('führt lokal und auf dem Server dieselben eigenen Spalten', () => {
    expect(eigeneSpalten(schema).sort()).toEqual(eigeneSpalten(serverSql).sort())
  })

  it('kennt der Vergleichstyp kein Personenfeld', () => {
    const typ = vergleichTs.match(
      /export interface VergleichsTeilnehmer \{([\s\S]*?)\n\}/)
    expect(typ, 'VergleichsTeilnehmer').toBeTruthy()
    const rumpf = (typ as RegExpMatchArray)[1]
    // Kommentare heraus - dort steht erklaerend, was NICHT mitgeht.
    const felder = rumpf.split(/\r?\n/).filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n')
    for (const wort of ['name', 'verein', 'jahrgang', 'club']) {
      expect(felder.toLowerCase().includes(wort), `Feld ${wort}`).toBe(false)
    }
  })

  it('speichert die Vergleichswerte nur als Kennzahl über das Feld', () => {
    // Genau diese Spalten und keine weiteren: Groesse, Platz, Gleichstand,
    // Anzahl, Median, Bestwert - je Messgroesse.
    expect(eigeneSpalten(schema).sort()).toEqual([
      'cohort_label', 'cohort_size', 'competition_id', 'computed_at',
      'd_best', 'd_count', 'd_median', 'd_rank', 'd_tie_count',
      'e_best', 'e_count', 'e_median', 'e_rank', 'e_tie_count',
      'final_best', 'final_count', 'final_median', 'final_rank', 'final_tie_count',
      'scope', 'source',
    ])
  })

  it('reicht die Vergleichsrechnung nie ganze Protokollteilnehmer durch', () => {
    // `vergleich.ts` kennt die Protokolltypen NICHT - dort gibt es kein
    // Objekt, das einen Namen tragen koennte. Eingekocht wird eine Ebene
    // darueber, in `protokollImport.ts` (ausProtokoll).
    expect(code(vergleichTs)).not.toMatch(/wettkampf-import/)
    expect(code(vergleichTs)).not.toMatch(/protokollImport/)
    // Nur diese beiden Importe, und keiner davon bringt Personendaten mit.
    const importe = code(vergleichTs).match(/^import .*$/gm) ?? []
    expect(importe).toEqual([
      "import { stableId } from '../ids'",
      "import { GERAETE, istGeraet } from './geraete'",
    ])
  })
})
