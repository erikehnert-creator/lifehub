/**
 * EINSTELLUNGEN · Daten & Backup
 *
 * Export in offene Formate, automatische Ablage in einem Ordner,
 * Wiederherstellen, Papierkorb, Datenbestand, Beispieldaten und Import.
 * Ausgelagert aus Settings.tsx, weil das eine eigene Verantwortung ist:
 * Daten hinein- und hinausbekommen.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Empty, Confirm, Collapsible } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import {
  exportFullJson, exportSummaryJson, exportTransactionsCsv, exportMetricsCsv,
  exportTasksCsv, exportSqlite, download, timestampSuffix,
} from '../../io/exporters'
import {
  parseDelimited, guessMetricMapping, guessTransactionMapping,
  previewMetricImport, previewTransactionImport, runMetricImport, runTransactionImport,
  undoImport, importFullJson, type ImportPreview,
} from '../../io/importer'
import { seedDemoData } from '../../db/seed'
import {
  folderBackupSupported, folderState, chooseFolder, forgetFolder,
  reconfirmPermission, writeBackup, lastBackupAt, type FolderState,
} from '../../io/folderBackup'
import { wipeDatabase, all, saveNow } from '../../db/sqlite'
import { SYNCED_TABLES } from '../../db/schema'
import { formatDay } from '../../core/dates'

/* ---------------------------------------------------------- Daten/Backup */

export function DataTab() {
  const data = useData()
  const m = useMutations()
  const fileRef = useRef<HTMLInputElement>(null)
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace')
  const [pendingRestore, setPendingRestore] = useState<{ json: string; info: any } | null>(null)

  const doExport = (kind: string) => {
    const stamp = timestampSuffix()
    switch (kind) {
      case 'json': download(`lifehub-export-${stamp}.json`, exportFullJson(), 'application/json'); break
      case 'summary': download(`lifehub-auswertung-${stamp}.json`, exportSummaryJson(data), 'application/json'); break
      case 'csv-tx': download(`lifehub-buchungen-${stamp}.csv`, exportTransactionsCsv(data), 'text/csv'); break
      case 'csv-metrics': download(`lifehub-tracking-${stamp}.csv`, exportMetricsCsv(data), 'text/csv'); break
      case 'csv-tasks': download(`lifehub-aufgaben-${stamp}.csv`, exportTasksCsv(data), 'text/csv'); break
      case 'sqlite': download(`lifehub-${stamp}.db`, exportSqlite(), 'application/x-sqlite3'); break
    }
    m.toast('Datei erstellt')
  }

  const onRestoreFile = async (file: File) => {
    const text = await file.text()
    try {
      const parsed = JSON.parse(text)
      const info = {
        version: parsed.schema_version, exportedAt: parsed.exported_at,
        tables: Object.keys(parsed.tables ?? {}).length,
        rows: Object.values(parsed.tables ?? {}).reduce((s: number, v: any) => s + (Array.isArray(v) ? v.length : 0), 0),
      }
      setPendingRestore({ json: text, info })
    } catch {
      m.toast('Die Datei ist kein gültiger LifeHub-Export')
    }
  }

  return (
    <>
      <div className="grid grid-2 mb16">
        <Card title="Export" sub="Deine Daten gehören dir – vollständig, jederzeit, in offenen Formaten.">
          <div className="list">
            <ExportRow title="Vollexport (JSON)" sub="Alle Tabellen und Felder. Aus dieser Datei lässt sich alles wiederherstellen."
              onClick={() => doExport('json')} />
            <ExportRow title="Auswertung (JSON)" sub="Vorberechnete Kennzahlen – das Format für KI-Auswertungen."
              onClick={() => doExport('summary')} />
            <ExportRow title="Buchungen (CSV)" sub="Für Excel und andere Programme, Semikolon-getrennt."
              onClick={() => doExport('csv-tx')} />
            <ExportRow title="Tracking (CSV)" sub="Eine Zeile pro Tag, eine Spalte pro Wert."
              onClick={() => doExport('csv-metrics')} />
            <ExportRow title="Aufgaben (CSV)" sub="Alle Aufgaben mit Status und Dauer."
              onClick={() => doExport('csv-tasks')} />
            <ExportRow title="Datenbankdatei (SQLite)" sub="Die technische Kopie – mit jedem SQLite-Werkzeug lesbar."
              onClick={() => doExport('sqlite')} />
          </div>
        </Card>

        <FolderBackupCard />

        <Card title="Wiederherstellen" sub="Synchronisation ist kein Backup: sie repliziert auch das Löschen.">
          <div className="hint-box mb16">
            Empfehlung: einmal pro Woche einen Vollexport herunterladen und in einem Ordner ablegen, der
            selbst gesichert wird. Das schützt dich auch vor eigenen Fehlern.
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onRestoreFile(f); e.target.value = '' }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Export-Datei auswählen…</button>
        </Card>
      </div>

      {pendingRestore && (
        <Modal open title="Wiederherstellen" onClose={() => setPendingRestore(null)}
          footer={<>
            <button className="btn" onClick={() => setPendingRestore(null)}>Abbrechen</button>
            <button className="btn btn-primary" onClick={() => {
              const res = importFullJson(pendingRestore.json, restoreMode)
              void saveNow()
              m.reload()
              m.toast(`${res.rows} Datensätze aus ${res.tables} Tabellen wiederhergestellt`)
              setPendingRestore(null)
            }}>Wiederherstellen</button>
          </>}>
          <div className="hint-box">
            <div><strong>Vorschau</strong></div>
            <div>Formatversion: {pendingRestore.info.version}</div>
            <div>Erstellt am: {pendingRestore.info.exportedAt?.slice(0, 19).replace('T', ' ')}</div>
            <div>Tabellen: {pendingRestore.info.tables}</div>
            <div>Datensätze: {pendingRestore.info.rows}</div>
          </div>
          <Field label="Modus">
            <Chips options={[
              { value: 'replace', label: 'Ersetzen' },
              { value: 'merge', label: 'Zusammenführen' },
            ]} value={restoreMode} onChange={(v) => setRestoreMode(v as any)} />
          </Field>
          <div className="hint-box">
            <strong>Ersetzen</strong> löscht den aktuellen Bestand und stellt exakt die Datei her.<br />
            <strong>Zusammenführen</strong> ergänzt nur Datensätze, die es hier noch nicht gibt.
          </div>
        </Modal>
      )}

    </>
  )
}

export function DatenbestandKarte() {
  const data = useData()
  const counts = useMemo(() => {
    const out: { table: string; n: number }[] = []
    for (const t of SYNCED_TABLES) {
      const r = all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL`)
      out.push({ table: t, n: Number(r[0]?.n ?? 0) })
    }
    return out.filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  }, [data])
  const totalRows = counts.reduce((s, c) => s + c.n, 0)
  return (
    <Card title="Datenbestand" sub={`${totalRows.toLocaleString('de-DE')} Datensätze insgesamt`}>
      <Collapsible label="Je Tabelle anzeigen">
        <div className="scroll-x">
          <table className="data">
            <thead><tr><th>Tabelle</th><th className="num">Datensätze</th></tr></thead>
            <tbody>
              {counts.map((c) => <tr key={c.table}><td>{c.table}</td><td className="num">{c.n.toLocaleString('de-DE')}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Collapsible>
    </Card>
  )
}

export function BeispieldatenKarte() {
  const m = useMutations()
  const [busy, setBusy] = useState(false)
  return (
    <Card title="Beispieldaten" sub="Sechs Monate erfundene Buchungen, Tracking- und Trainingsdaten – zum Ausprobieren.">
      <button className="btn" disabled={busy} onClick={() => {
        setBusy(true)
        setTimeout(() => {
          const n = seedDemoData()
          m.reload()
          m.toast(`${n} Beispieldatensätze angelegt`)
          setBusy(false)
        }, 30)
      }}>{busy ? 'Erzeuge…' : 'Beispieldaten erzeugen'}</button>
    </Card>
  )
}

export function DatenLoeschenKarte() {
  const [confirmWipe, setConfirmWipe] = useState(false)
  return (
    <Card title="Alle Daten löschen" sub="Setzt LifeHub auf den Auslieferungszustand zurück. Vorher einen Vollexport herunterladen.">
      <button className="btn btn-danger" onClick={() => setConfirmWipe(true)}>Datenbank zurücksetzen</button>
      <Confirm open={confirmWipe} title="Wirklich alle Daten löschen?"
        message="Alle Konten, Buchungen, Aufgaben und Trackingwerte werden entfernt. Das lässt sich nur über einen Export rückgängig machen."
        confirmLabel="Endgültig löschen" danger
        onCancel={() => setConfirmWipe(false)}
        onConfirm={async () => { await wipeDatabase(); location.reload() }} />
    </Card>
  )
}

function ExportRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button className="list-row" onClick={onClick} style={{ paddingLeft: 0, paddingRight: 0 }}>
      <span className="list-main">
        <span className="list-title">{title}</span>
        <span className="list-sub">{sub}</span>
      </span>
      <span className="btn btn-sm">Herunterladen</span>
    </button>
  )
}

/* ------------------------------------------------------------------ Import */

export function ImportTab() {
  const data = useData()
  const m = useMutations()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'metrics' | 'transactions'>('metrics')
  const [raw, setRaw] = useState<{ columns: string[]; rows: string[][]; filename: string } | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  const metrics = data.metrics.filter((x) => !x.deleted_at)
  const existing = data.metricEntries.map((e) => ({ metric_id: e.metric_id, day: e.day }))

  const buildPreview = (map: Record<string, string>, r = raw) => {
    if (!r) return
    const p = mode === 'metrics'
      ? previewMetricImport(r.columns, r.rows, map, metrics.map((x) => ({ id: x.id, key: x.key, name: x.name })), existing)
      : previewTransactionImport(r.columns, r.rows, map,
          data.accounts.filter((a) => !a.deleted_at).map((a) => ({ id: a.id, name: a.name })),
          data.categories.filter((c) => !c.deleted_at).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
          data.settings.default_account_id ?? data.accounts[0]?.id ?? '')
    setPreview(p)
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    const parsed = parseDelimited(text)
    const map = mode === 'metrics'
      ? guessMetricMapping(parsed.columns, metrics.map((x) => x.key))
      : guessTransactionMapping(parsed.columns)
    setRaw({ ...parsed, filename: file.name })
    setMapping(map)
    buildPreview(map, { ...parsed, filename: file.name })
  }

  const targets = mode === 'metrics'
    ? [{ value: '__ignore', label: 'ignorieren' }, { value: '__day', label: 'Datum' }, { value: '__note', label: 'Notiz' },
       ...metrics.map((x) => ({ value: x.key, label: `${x.name} (${x.unit})` }))]
    : [{ value: '__ignore', label: 'ignorieren' }, { value: 'booked_on', label: 'Datum' }, { value: 'amount', label: 'Betrag' },
       { value: 'category', label: 'Kategorie' }, { value: 'merchant', label: 'Händler' },
       { value: 'description', label: 'Beschreibung' }, { value: 'account', label: 'Konto' }, { value: 'note', label: 'Notiz' }]

  const errors = preview?.issues.filter((i) => i.level === 'error') ?? []
  const warnings = preview?.issues.filter((i) => i.level === 'warning') ?? []

  return (
    <>
      <Card className="mb16" title="Daten importieren"
        sub="Nichts wird blind übernommen: erst Zuordnung prüfen, dann Vorschau lesen, dann importieren.">
        <Field label="Was möchtest du importieren?">
          <Chips options={[
            { value: 'metrics', label: 'Tracking-Werte (z. B. deine Excel-Tabelle)' },
            { value: 'transactions', label: 'Buchungen / Kontoauszug' },
          ]} value={mode} onChange={(v) => { setMode(v as any); setRaw(null); setPreview(null) }} />
        </Field>
        <div className="hint-box mt12">
          Unterstützt werden CSV- und TSV-Dateien. Aus Excel: <em>Datei → Speichern unter → CSV (Trennzeichen-getrennt)</em>.
          Erkannt werden deutsche und englische Zahlen- und Datumsformate sowie Zeitangaben wie <code>7:30</code>.
        </div>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
        <div className="mt16">
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Datei auswählen…</button>
        </div>
      </Card>

      {raw && (
        <Card className="mb16" title="Spalten zuordnen" sub={`${raw.filename} · ${raw.rows.length} Zeilen`}>
          <div className="grid grid-2">
            {raw.columns.map((col) => (
              <Field key={col} label={col}>
                <select className="select" value={mapping[col] ?? '__ignore'}
                  onChange={(e) => { const next = { ...mapping, [col]: e.target.value }; setMapping(next); buildPreview(next) }}>
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            ))}
          </div>
        </Card>
      )}

      {preview && (
        <Card title="Vorschau" sub="Prüfe die Zahlen, bevor etwas geschrieben wird.">
          <div className="grid grid-3 keep2 mb16">
            <Stat small label="Wird importiert" value={String(preview.willImport)} />
            <Stat small label="Wird übersprungen" value={String(preview.willSkip)} />
            <Stat small label="Warnungen" value={String(warnings.length)} />
          </div>

          {errors.length > 0 && (
            <div className="hint-box mb16" style={{ borderColor: 'var(--critical)' }}>
              <strong>{errors.length} Fehler</strong>
              <ul style={{ margin: '6px 0 0 18px' }}>
                {errors.slice(0, 8).map((e, i) => <li key={i}>Zeile {e.row}: {e.message}{e.raw ? ` („${e.raw}")` : ''}</li>)}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <Collapsible label={`${warnings.length} Warnungen anzeigen`}>
              <ul style={{ margin: '6px 0 0 18px' }} className="small">
                {warnings.slice(0, 40).map((w, i) => <li key={i}>Zeile {w.row}: {w.message}{w.raw ? ` („${w.raw}")` : ''}</li>)}
              </ul>
            </Collapsible>
          )}

          <button className="btn btn-primary mt16" disabled={preview.willImport === 0}
            onClick={() => {
              const res = mode === 'metrics'
                ? runMetricImport(preview, raw?.filename ?? 'import.csv')
                : runTransactionImport(preview, raw?.filename ?? 'import.csv')
              m.reload()
              m.toast(`${res.count} Datensätze importiert`)
              setPreview(null); setRaw(null)
            }}>
            {preview.willImport} Datensätze importieren
          </button>
        </Card>
      )}

      {data.importBatches.filter((b: any) => !b.deleted_at).length > 0 && (
        <Card title="Bisherige Importe" sub="Jeder Import lässt sich vollständig zurücknehmen." className="pad0">
          <div className="list">
            {data.importBatches.filter((b: any) => !b.deleted_at).map((b: any) => (
              <div className="list-row" key={b.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="list-main">
                  <span className="list-title">{b.filename ?? b.source}</span>
                  <span className="list-sub">
                    {b.imported_at?.slice(0, 10)} · {b.row_count} Datensätze
                    {b.undone_at ? ' · zurückgenommen' : ''}
                  </span>
                </span>
                {!b.undone_at && (
                  <button className="btn btn-sm btn-danger" onClick={() => {
                    const n = undoImport(b.id)
                    m.reload()
                    m.toast(`${n} Datensätze zurückgenommen`)
                  }}>Rückgängig</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

/* -------------------------------------------------------------- Papierkorb */

export function TrashTab() {
  const data = useData()
  const m = useMutations()

  const deleted = useMemo(() => {
    const out: { table: string; label: string; rows: any[] }[] = []
    const labels: Record<string, string> = {
      transactions: 'Buchungen', tasks: 'Aufgaben', accounts: 'Konten',
      categories: 'Kategorien', budgets: 'Budgets', goals: 'Ziele',
      calendar_events: 'Termine', metric_entries: 'Trackingwerte',
      workout_sessions: 'Trainingseinheiten', body_measurements: 'Körpermessungen',
      day_assignments: 'Tageszuordnungen', recurring_rules: 'Wiederkehrende Zahlungen',
      notes: 'Notizen', day_types: 'Tagesarten',
    }
    for (const [table, label] of Object.entries(labels)) {
      const rows = all(`SELECT * FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50`)
      if (rows.length) out.push({ table, label, rows })
    }
    return out
  }, [data])

  const describe = (table: string, r: any): string => {
    if (table === 'transactions') return `${r.booked_on} · ${(r.amount_cents / 100).toFixed(2)} € · ${r.merchant ?? r.description ?? ''}`
    if (table === 'metric_entries') return `${r.day} · ${r.value_num}`
    if (table === 'day_assignments') return r.day
    return r.title ?? r.name ?? r.id
  }

  if (!deleted.length) {
    return <Empty icon="🗑️" title="Papierkorb ist leer" hint="Gelöschte Einträge landen hier und lassen sich wiederherstellen." />
  }

  return (
    <>
      <Card className="mb16" title="Papierkorb" sub="Nichts wird sofort endgültig gelöscht – so bleibt jeder Fehlgriff korrigierbar.">
        <div className="small muted">{deleted.reduce((s, d) => s + d.rows.length, 0)} gelöschte Einträge</div>
      </Card>
      {deleted.map((group) => (
        <Card key={group.table} title={group.label} className="pad0 mb16">
          <div className="list">
            {group.rows.map((r: any) => (
              <div className="list-row" key={r.id}>
                <span className="list-main">
                  <span className="list-title">{describe(group.table, r)}</span>
                  <span className="list-sub">gelöscht am {formatDay(String(r.deleted_at).slice(0, 10))}</span>
                </span>
                <button className="btn btn-sm" onClick={() => m.restoreRow(group.table as any, r.id, 'Wiederhergestellt')}>Wiederherstellen</button>
                <button className="btn btn-sm btn-danger" onClick={() => { m.purge(group.table as any, r.id); m.toast('Endgültig gelöscht') }}>Endgültig</button>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </>
  )
}


/* ------------------------------------------------- Automatische Ablage */

function FolderBackupCard() {
  const m = useMutations()
  const [state, setState] = useState<FolderState>('none')
  const [folder, setFolder] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(lastBackupAt())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    const s = await folderState()
    setState(s.state)
    setFolder(s.name)
    setLast(lastBackupAt())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (withCopy = true) => {
    setBusy(true)
    const res = await writeBackup(withCopy)
    setMsg(res.ok ? `Gesichert um ${new Date(res.at!).toLocaleTimeString('de-DE')}` : res.message)
    setBusy(false)
    void refresh()
  }

  return (
    <Card title="Automatische Ablage in einem Ordner"
      sub="Deine Daten zusätzlich als echte Dateien auf der Festplatte – nicht nur im Browserspeicher.">
      {state === 'unsupported' ? (
        <div className="hint-box">
          Dieser Browser kann nicht in Ordner schreiben. In <strong>Chrome</strong> oder <strong>Edge</strong> steht
          die Funktion zur Verfügung. Hier bleibt der Export über die Schaltflächen links.
        </div>
      ) : (
        <>
          <div className="hint-box mb16">
            Wähle einen Ordner – zum Beispiel einen in <strong>OneDrive</strong>. LifeHub legt dort
            <code> lifehub.db</code> und <code> lifehub.json</code> ab und aktualisiert sie automatisch.
            OneDrive sichert den Ordner dann von selbst weiter, und deine Daten liegen als Dateien vor,
            die du auch ohne LifeHub öffnen kannst.
          </div>

          <div className="row">
            {state === 'none' && (
              <button className="btn btn-primary" onClick={async () => {
                try {
                  const name = await chooseFolder()
                  if (name) { m.toast(`Ordner „${name}" verbunden`); void run() }
                } catch { /* Auswahl abgebrochen */ }
              }}>Ordner auswählen…</button>
            )}
            {state === 'needs_permission' && (
              <button className="btn btn-primary" onClick={async () => {
                const ok = await reconfirmPermission()
                if (ok) { m.toast('Ordner wieder verbunden'); void run() }
                void refresh()
              }}>Zugriff auf „{folder}" bestätigen</button>
            )}
            {state === 'granted' && (
              <>
                <span className="pill good">✓ {folder}</span>
                <button className="btn" disabled={busy} onClick={() => run()}>{busy ? 'Sichere…' : 'Jetzt sichern'}</button>
                <button className="btn btn-ghost" onClick={async () => {
                  await forgetFolder(); void refresh(); m.toast('Ordner getrennt')
                }}>Trennen</button>
              </>
            )}
          </div>

          {(last || msg) && (
            <div className="small muted mt12">
              {msg ?? (last ? `Zuletzt gesichert: ${new Date(last).toLocaleString('de-DE')}` : '')}
            </div>
          )}

          {state === 'granted' && (
            <div className="hint-box mt12 small">
              Gesichert wird beim Schließen der App und wenn du oben auf „Jetzt sichern" tippst.
              Zusätzlich landet einmal pro Tag eine datierte Kopie in <code>Sicherungen/</code> – die letzten 30 bleiben erhalten.
            </div>
          )}
        </>
      )}
    </Card>
  )
}

