/**
 * EINSTELLUNGEN – Darstellung, Daten, Export, Import, Backup, Sicherheit,
 * Papierkorb, Synchronisation und KI-Zugriff.
 */
import { hashPin, verifyPin, randomSalt, markUnlocked } from '../core/lock'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Stat, Modal, Field, Chips, Tabs, Empty, Confirm, Collapsible } from '../ui/components'
import { useApp, useData, useMutations } from '../state/store'
import {
  exportFullJson, exportSummaryJson, exportTransactionsCsv, exportMetricsCsv,
  exportTasksCsv, exportSqlite, download, timestampSuffix, EXPORT_SCHEMA_VERSION,
} from '../io/exporters'
import {
  parseDelimited, guessMetricMapping, guessTransactionMapping,
  previewMetricImport, previewTransactionImport, runMetricImport, runTransactionImport,
  undoImport, importFullJson, type ImportPreview,
} from '../io/importer'
import { seedDemoData, KATEGORIE_FARBEN } from '../db/seed'
import {
  folderBackupSupported, folderState, chooseFolder, forgetFolder,
  reconfirmPermission, writeBackup, lastBackupAt, type FolderState,
} from '../io/folderBackup'
import { wipeDatabase, replaceDatabaseFile, all, saveNow, getDb } from '../db/sqlite'
import { SYNCED_TABLES } from '../db/schema'
import { formatDay, todayString, formatDuration } from '../core/dates'
import { formatMoney } from '../core/money'
import { wakingMinutesFor } from '../core/planner'
import { AccountsTab } from './Finance'
import { syncStatusText, runSync, pullFresh, pushAll, KONFLIKT_ENTSCHIEDEN } from '../sync/engine'
import {
  signIn, signOut, currentSession, syncRolle, clearSyncRolle, meldeSyncAenderung,
  type Session, type SyncRolle,
} from '../sync/auth'

const STATES: [string, string][] = [
  ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'],
  ['TH', 'Thüringen'],
]

export function SettingsScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  const tabs = [
    { key: '', label: 'Allgemein' },
    { key: 'konten', label: 'Konten' },
    { key: 'kategorien', label: 'Kategorien' },
    { key: 'tracking', label: 'Trackingwerte' },
    { key: 'daten', label: 'Daten & Backup' },
    { key: 'sicherheit', label: 'Sicherheit' },
    { key: 'import', label: 'Import' },
    { key: 'papierkorb', label: 'Papierkorb' },
    { key: 'sync', label: 'Synchronisation' },
    { key: 'ki', label: 'KI-Zugriff' },
  ]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Einstellungen</div>
          <div className="page-sub">Alles, was die App an dich anpasst</div>
        </div>
      </div>
      <Tabs tabs={tabs} active={sub} onChange={(k) => navigate(`#/einstellungen${k ? '/' + k : ''}`)} />
      {sub === '' && <GeneralTab />}
      {sub === 'konten' && <AccountsSettings />}
      {sub === 'kategorien' && <CategoriesTab />}
      {sub === 'tracking' && <MetricsSettings />}
      {sub === 'daten' && <DataTab />}
      {sub === 'sicherheit' && <SecurityTab />}
      {sub === 'import' && <ImportTab />}
      {sub === 'papierkorb' && <TrashTab />}
      {sub === 'sync' && <SyncTab />}
      {sub === 'ki' && <AiTab />}
    </div>
  )
}

/* -------------------------------------------------------------- Allgemein */

function GeneralTab() {
  const data = useData()
  const m = useMutations()
  const s = data.settings

  return (
    <div className="grid grid-2">
      <Card title="Darstellung">
        <Field label="Erscheinungsbild">
          <Chips options={[
            { value: 'system', label: 'Automatisch' },
            { value: 'light', label: 'Hell' },
            { value: 'dark', label: 'Dunkel' },
          ]} value={s.theme} onChange={(v) => m.setSetting('theme', v as any)} />
        </Field>
        <Field label="Name" hint="Wird in der Begrüßung verwendet.">
          <input className="input" value={s.user_name} onChange={(e) => m.setSetting('user_name', e.target.value)} placeholder="dein Vorname" />
        </Field>
      </Card>

      <Card title="Tagesrhythmus">
        <Field label="Geplanter Schlaf pro Nacht"
          hint="Daraus ergibt sich, wie viel Zeit ein Tag überhaupt hergibt – 24 Stunden minus Schlaf. Feste Uhrzeiten musst du nicht mehr pflegen.">
          <div className="row">
            <input className="input" style={{ maxWidth: 90 }} inputMode="decimal"
              value={String(s.sleep_hours ?? 8).replace('.', ',')}
              onChange={(e) => {
                const v = Number(e.target.value.replace(',', '.'))
                if (Number.isFinite(v) && v >= 0 && v <= 14) m.setSetting('sleep_hours', v)
              }} />
            <span className="muted">Stunden</span>
            <span className="small muted">→ {formatDuration(wakingMinutesFor(s.sleep_hours ?? 8))} verplanbar pro Tag</span>
          </div>
          <div className="chips mt8">
            {[6, 7, 7.5, 8, 8.5, 9].map((v) => (
              <button key={v} className={`chip sm ${(s.sleep_hours ?? 8) === v ? 'active' : ''}`}
                onClick={() => m.setSetting('sleep_hours', v)}>{String(v).replace('.', ',')} h</button>
            ))}
          </div>
        </Field>
        <Field label="Bundesland" hint="Bestimmt die gesetzlichen Feiertage im Kalender.">
          <select className="select" value={s.state} onChange={(e) => m.setSetting('state', e.target.value)}>
            {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Field>
      </Card>

      <Card title="Finanzen">
        <Field label="Standardkonto" hint="Wird in der Schnelleingabe vorausgewählt.">
          <select className="select" value={s.default_account_id ?? ''} onChange={(e) => m.setSetting('default_account_id', e.target.value || null)}>
            <option value="">kein Standard</option>
            {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Finanztag" hint="Wie oft du deine Finanzen durchgehen möchtest.">
          <Chips options={[{ value: 'weekly', label: 'wöchentlich' }, { value: 'monthly', label: 'monatlich' }]}
            value={s.finance_day_interval} onChange={(v) => m.setSetting('finance_day_interval', v as any)} />
        </Field>
      </Card>

      {/* Was die App beim Öffnen von allein macht – abschaltbar, weil manche
          Leute lieber selbst auf den Knopf drücken. */}
      <Card title="Von allein erledigen" sub="Läuft einmal am Tag, wenn du die App öffnest.">
        <label className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
          <input type="checkbox" style={{ marginTop: 4 }}
            checked={s.auto_book_recurring !== false}
            onChange={(e) => m.setSetting('auto_book_recurring', e.target.checked)} />
          <span>
            <strong>Fällige wiederkehrende Zahlungen buchen</strong>
            <span className="small muted" style={{ display: 'block' }}>
              Miete, Handyvertrag, Abos. Der Betrag der Regel gilt ab jetzt – schon gebuchte
              Zahlungen bleiben unverändert.
            </span>
          </span>
        </label>
        <label className="row mt12" style={{ alignItems: 'flex-start', gap: 9 }}>
          <input type="checkbox" style={{ marginTop: 4 }}
            checked={s.carry_over_tasks !== false}
            onChange={(e) => m.setSetting('carry_over_tasks', e.target.checked)} />
          <span>
            <strong>Offene Aufgaben von gestern mitnehmen</strong>
            <span className="small muted" style={{ display: 'block' }}>
              Was liegengeblieben ist, steht am nächsten Morgen wieder im Plan.
              Aufgaben, die du als festen Termin markiert hast, bleiben an ihrem Tag.
            </span>
          </span>
        </label>
      </Card>

      <Card title="Über LifeHub">
        <div className="small muted">
          <p>Deine Daten liegen als echte SQLite-Datenbank auf diesem Gerät. Nichts wird ohne dein Zutun übertragen.</p>
          <p>Exportformat-Version: {EXPORT_SCHEMA_VERSION} · Tabellen: {SYNCED_TABLES.length}</p>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------- Kategorien */

function CategoriesTab() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<any | 'new' | null>(null)

  const groups: [string, any[]][] = [
    ['Ausgaben', data.categories.filter((c) => !c.deleted_at && c.kind === 'expense')],
    ['Einnahmen', data.categories.filter((c) => !c.deleted_at && c.kind === 'income')],
  ]

  return (
    <>
      <div className="page-actions mb16">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Kategorie</button>
      </div>
      <div className="grid grid-2">
        {groups.map(([label, list]) => (
          <Card key={label} title={label} sub={`${list.length} Kategorien`} className="pad0">
            <div className="list">
              {list.map((c) => {
                const used = data.transactions.filter((t) => !t.deleted_at && t.category_id === c.id).length
                return (
                  <button className="list-row" key={c.id} onClick={() => setEditing(c)}>
                    <span className="avatar" style={{ background: c.color ?? 'var(--surface-3)' }}>{c.icon ?? '•'}</span>
                    <span className="list-main">
                      <span className="list-title">{c.name}</span>
                      <span className="list-sub">{used} Buchungen{c.is_archived ? ' · archiviert' : ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
      {editing && <CategoryEditor category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function CategoryEditor({ category, onClose }: { category: any | null; onClose: () => void }) {
  const m = useMutations()
  const data = useData()
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState(category?.kind ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? '📦')
  const [color, setColor] = useState(category?.color ?? 'var(--cat-1)')
  const [archived, setArchived] = useState(!!category?.is_archived)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <Modal open title={category ? 'Kategorie bearbeiten' : 'Neue Kategorie'} onClose={onClose}
      footer={<>
        {category && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" disabled={!name.trim()}
          onClick={() => {
            const payload = { name: name.trim(), kind, icon, color, is_archived: archived ? 1 : 0, parent_id: null, sort_order: category?.sort_order ?? 500 }
            if (category) m.patch('categories', category.id, payload, 'Kategorie geändert')
            else m.create('categories', { ...payload, is_system: 0, exclude_from_stats: 0 }, 'Kategorie angelegt')
            onClose()
          }}>Speichern</button>
      </>}>
      <div className="grid grid-2 keep2">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Symbol"><input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={2} /></Field>
      </div>
      <Field label="Art">
        <Chips options={[{ value: 'expense', label: 'Ausgabe' }, { value: 'income', label: 'Einnahme' }]} value={kind} onChange={(v) => setKind(v as any)} />
      </Field>
      {/* 24 Farben, die sich deutlich unterscheiden – so bleibt eine Kategorie
          im Diagramm an ihrer Farbe erkennbar, ohne in die Legende zu schauen. */}
      <Field label="Farbe" hint="Diese Farbe hat die Kategorie überall: in Listen, im Kreis- und im Balkendiagramm.">
        <div className="farbwahl">
          {Array.from({ length: KATEGORIE_FARBEN }, (_, k) => k + 1).map((i) => (
            <button key={i} type="button" aria-label={`Farbe ${i}`}
              onClick={() => setColor(`var(--cat-${i})`)}
              className={color === `var(--cat-${i})` ? 'gewaehlt' : ''}
              style={{ background: `var(--cat-${i})` }} />
          ))}
        </div>
      </Field>
      <label className="row small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archiviert (nicht mehr auswählbar)</label>
      <Confirm open={confirmDelete} title="Kategorie löschen?"
        message={'Zugeordnete Buchungen bleiben erhalten und gelten dann als „nicht kategorisiert".'} danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('categories', category.id, 'Kategorie gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
  )
}

/* ---------------------------------------------------------- Daten/Backup */

function DataTab() {
  const data = useData()
  const m = useMutations()
  const { toasts } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace')
  const [pendingRestore, setPendingRestore] = useState<{ json: string; info: any } | null>(null)

  const counts = useMemo(() => {
    const out: { table: string; n: number }[] = []
    for (const t of SYNCED_TABLES) {
      const r = all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL`)
      out.push({ table: t, n: Number(r[0]?.n ?? 0) })
    }
    return out.filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  }, [data])

  const totalRows = counts.reduce((s, c) => s + c.n, 0)

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
          <div className="mt16">
            <Collapsible label="Alle Daten löschen">
              <div className="hint-box mb8">
                Setzt die Anwendung auf den Auslieferungszustand zurück. Lade vorher einen Vollexport herunter.
              </div>
              <button className="btn btn-danger" onClick={() => setConfirmWipe(true)}>Datenbank zurücksetzen</button>
            </Collapsible>
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Datenbestand" sub={`${totalRows.toLocaleString('de-DE')} Datensätze insgesamt`}>
          <div className="scroll-x">
            <table className="data">
              <thead><tr><th>Tabelle</th><th className="num">Datensätze</th></tr></thead>
              <tbody>
                {counts.map((c) => <tr key={c.table}><td>{c.table}</td><td className="num">{c.n.toLocaleString('de-DE')}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Beispieldaten" sub="Zum Ausprobieren – erzeugt 6 Monate realistische Buchungen, Tracking- und Trainingsdaten.">
          <div className="hint-box mb16">
            Nützlich, um die Auswertungen zu sehen, bevor du eigene Daten erfasst. Alles Erzeugte lässt sich
            über den Papierkorb oder das Zurücksetzen wieder entfernen.
          </div>
          <button className="btn" disabled={!!busy} onClick={() => {
            setBusy('demo')
            setTimeout(() => {
              const n = seedDemoData()
              m.reload()
              m.toast(`${n} Beispieldatensätze angelegt`)
              setBusy('')
            }, 30)
          }}>{busy === 'demo' ? 'Erzeuge…' : 'Beispieldaten erzeugen'}</button>
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

      <Confirm open={confirmWipe} title="Wirklich alle Daten löschen?"
        message="Alle Konten, Buchungen, Aufgaben und Trackingwerte werden entfernt. Das lässt sich nur über einen Export rückgängig machen."
        confirmLabel="Endgültig löschen" danger
        onCancel={() => setConfirmWipe(false)}
        onConfirm={async () => { await wipeDatabase(); location.reload() }} />
    </>
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

function ImportTab() {
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

function TrashTab() {
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

/* ---------------------------------------------------------- Synchronisation */

function SyncTab() {
  const data = useData()
  const m = useMutations()
  const { online } = useApp()
  const [status, setStatus] = useState(syncStatusText())
  const [running, setRunning] = useState(false)
  const [session, setSession] = useState<Session | null>(() => currentSession())
  const [rolle, setRolle] = useState<SyncRolle | null>(() => syncRolle())

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [confirmFresh, setConfirmFresh] = useState(false)
  const [confirmPush, setConfirmPush] = useState(false)

  const url = data.settings.sync_url
  const key = data.settings.sync_key
  const configured = !!url && !!key

  const pending = all<{ n: number }>('SELECT COUNT(*) AS n FROM change_log')[0]?.n ?? 0
  const conflicts = all<{ n: number }>('SELECT COUNT(*) AS n FROM conflicts WHERE resolved_at IS NULL')[0]?.n ?? 0

  const doSync = async (was: 'normal' | 'holen' | 'senden' = 'normal') => {
    setRunning(true)
    const res = was === 'holen' ? await pullFresh(url, key)
      : was === 'senden' ? await pushAll(url, key)
      : await runSync(url, key)
    setStatus(res.message)
    setRolle(syncRolle())
    meldeSyncAenderung()
    m.reload()
    setRunning(false)
  }

  const doSignIn = async () => {
    setAuthError(null)
    if (!configured) { setAuthError('Trage zuerst Projekt-URL und öffentlichen Schlüssel ein.'); return }
    setAuthBusy(true)
    try {
      setSession(await signIn(url, key, email.trim(), password))
      setPassword('')
      meldeSyncAenderung()
      setStatus(syncRolle()
        ? 'Angemeldet. Jetzt kannst du synchronisieren.'
        : 'Angemeldet. Entscheide unten noch, welche Rolle dieses Gerät hat.')
    } catch (e: any) {
      setAuthError(e?.message ?? 'Anmeldung fehlgeschlagen.')
    } finally {
      setAuthBusy(false)
    }
  }

  return (
    <>
      <div className="grid grid-3 keep2 mb16">
        <Card><Stat label="Verbindung" value={online ? 'online' : 'offline'} /></Card>
        <Card><Stat label="Wartende Änderungen" value={String(pending)} /></Card>
        <Card><Stat label="Offene Konflikte" value={String(conflicts)} /></Card>
      </div>

      <Card className="mb16" title="Wie die Synchronisation funktioniert">
        <div className="hint-box">
          <p style={{ marginTop: 0 }}>
            Die App ist <strong>local first</strong>: Jede Änderung wird sofort auf dem Gerät gespeichert und in ein
            Änderungsjournal geschrieben. Ist ein Server hinterlegt und Internet vorhanden, wird das Journal
            übertragen und Änderungen des anderen Geräts werden geholt. Ohne Internet arbeitest du normal
            weiter – der Abgleich passiert, sobald du wieder online bist.
          </p>
          <p>
            Konflikte werden feldweise zusammengeführt. Bei Betrag, Konto und Datum einer Buchung
            geschieht das <strong>nie automatisch</strong> – solche Fälle landen in der Konfliktliste.
          </p>
          <p style={{ marginBottom: 0 }}>
            Auf dem Server liegen deine Daten hinter deiner eigenen Anmeldung. Ohne sie gibt der Server
            nichts heraus – der öffentliche Schlüssel allein reicht nicht.
          </p>
        </div>
      </Card>

      <Card className="mb16" title="Server" sub="Supabase-Projekt. Beide Angaben findest du dort unter Project Settings → API.">
        <Field label="Projekt-URL">
          <input className="input" placeholder="https://xxxxxxxx.supabase.co" value={url}
            onChange={(e) => m.setSetting('sync_url', e.target.value.trim())} />
        </Field>
        <Field label="Öffentlicher Schlüssel (anon public)" hint="Dieser Schlüssel ist nicht geheim – er benennt nur das Projekt.">
          <input className="input" value={key}
            onChange={(e) => m.setSetting('sync_key', e.target.value.trim())} />
        </Field>
      </Card>

      <Card className="mb16" title="Anmeldung" sub="Einmal pro Gerät. Die Anmeldung bleibt auf diesem Gerät gespeichert.">
        {session ? (
          <>
            <div className="row">
              <span className="pill good">✓ angemeldet als {session.email || 'unbekannt'}</span>
              <button className="btn btn-ghost" onClick={() => {
                signOut(); setSession(null); meldeSyncAenderung(); setStatus('Abgemeldet.')
              }}>
                Abmelden
              </button>
            </div>
            <div className="hint-box small mt12">
              Die Zugangsdaten liegen nur auf diesem Gerät und werden bewusst <strong>nicht</strong> mitsynchronisiert.
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-2 keep2">
              <Field label="E-Mail">
                <input className="input" type="email" autoComplete="username" value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Passwort">
                <input className="input" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doSignIn() }} />
              </Field>
            </div>
            {authError && <div className="small" style={{ color: 'var(--critical)' }}>{authError}</div>}
            <button className="btn btn-primary mt12" disabled={authBusy || !email || !password}
              onClick={() => { void doSignIn() }}>
              {authBusy ? 'Melde an…' : 'Anmelden'}
            </button>
          </>
        )}
      </Card>

      {conflicts > 0 && <ConflictList onDone={() => m.reload()} />}

      {session && !rolle ? (
        <Card title="Erstverbindung: Welche Rolle hat dieses Gerät?"
          sub="Einmalig zu entscheiden. Vorher überträgt LifeHub von sich aus nichts.">
          <div className="hint-box mb16">
            Ein frisch gestartetes LifeHub legt Beispielkonten an. Würde es die einfach mit
            hochladen, stünden auf allen Geräten hinterher zwei Sätze Konten. Deshalb sag hier
            einmal, woher die richtigen Daten kommen.
          </div>

          <div className="grid grid-2">
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>Hier liegen meine Daten</h3>
              <p className="small muted">
                Für das Gerät, auf dem deine echten Konten und Buchungen stehen – üblicherweise
                der PC. Der Serverbestand wird durch diesen ersetzt.
              </p>
              <button className="btn btn-primary" disabled={!configured || running}
                onClick={() => setConfirmPush(true)}>
                Diesen Bestand auf den Server laden
              </button>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>Dieses Gerät ist neu</h3>
              <p className="small muted">
                Für jedes weitere Gerät – üblicherweise das Handy. Der örtliche Bestand wird
                gelöscht und durch den Serverstand ersetzt.
              </p>
              <button className="btn btn-primary" disabled={!configured || running}
                onClick={() => setConfirmFresh(true)}>
                Dieses Gerät vom Server befüllen
              </button>
            </div>
          </div>
          {running && <div className="small muted mt12">Läuft… bei der ersten Übertragung dauert das ein paar Sekunden.</div>}
          {status && <div className="small mt8">{status}</div>}
        </Card>
      ) : (
        <Card title="Abgleich">
          <div className="row">
            <button className="btn btn-primary" disabled={!configured || !session || running}
              onClick={() => { void doSync('normal') }}>
              {running ? 'Synchronisiere…' : 'Jetzt synchronisieren'}
            </button>
            <span className="small muted">{status}</span>
          </div>
          <div className="hint-box mt12 small">
            Von Hand nötig ist das eigentlich nie: LifeHub gleicht beim Öffnen ab, sobald du die
            App wieder in den Vordergrund holst, kurz nach jeder Änderung und ansonsten alle paar
            Minuten. Der Knopf ist nur da, wenn du nicht warten willst.
            {rolle && (
              <> Dieses Gerät ist beim ersten Mal als
                <strong>{rolle === 'quelle' ? ' Quelle' : ' Kopie'}</strong> verbunden worden.</>
            )}
          </div>

          <Collapsible label="Erstverbindung zurücksetzen">
            <div className="hint-box small">
              Nur nötig, wenn du die Geräte neu ordnen willst – etwa weil der Server geleert wurde.
              Danach fragt LifeHub auf diesem Gerät wieder nach der Rolle.
            </div>
            <button className="btn mt8" onClick={() => {
              clearSyncRolle(); setRolle(null); meldeSyncAenderung(); setStatus('Erstverbindung zurückgesetzt.')
            }}>
              Zurücksetzen
            </button>
          </Collapsible>
        </Card>
      )}

      <Confirm open={confirmFresh} title="Lokalen Bestand ersetzen?"
        message="Alle Daten auf diesem Gerät werden gelöscht und durch den Stand vom Server ersetzt. Anmeldung und PIN bleiben erhalten."
        confirmLabel="Vom Server befüllen" danger
        onCancel={() => setConfirmFresh(false)}
        onConfirm={() => { setConfirmFresh(false); void doSync('holen') }} />

      <Confirm open={confirmPush} title="Server mit diesem Bestand füllen?"
        message="Alles von diesem Gerät wird auf den Server geladen. Was dort schon liegt und hier ebenfalls vorkommt, wird überschrieben. Wähle das nur auf dem Gerät mit deinen echten Daten."
        confirmLabel="Auf den Server laden"
        onCancel={() => setConfirmPush(false)}
        onConfirm={() => { setConfirmPush(false); void doSync('senden') }} />
    </>
  )
}

/**
 * Konflikte auflösen.
 *
 * Ein Konflikt entsteht nur dort, wo beide Geräte dasselbe kritische Feld
 * geändert haben – Betrag, Konto oder Datum einer Buchung. Vorläufig gilt der
 * Serverstand; hier entscheidest du endgültig.
 */
const KONFLIKT_TABELLE: Record<string, string> = {
  transactions: 'Buchung', accounts: 'Konto', tasks: 'Aufgabe', goals: 'Ziel',
  metric_entries: 'Trackingwert', workout_sessions: 'Training', calendar_events: 'Termin',
  budgets: 'Budget', recurring_rules: 'Wiederkehrende Zahlung', notes: 'Notiz',
}
const KONFLIKT_FELD: Record<string, string> = {
  amount_cents: 'Betrag', account_id: 'Konto', to_account_id: 'Zielkonto',
  booked_on: 'Datum', type: 'Art', opening_balance_cents: 'Anfangsbestand',
}

function ConflictList({ onDone }: { onDone: () => void }) {
  const m = useMutations()
  const [offen, setOffen] = useState(() =>
    all<any>('SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC LIMIT 50'))

  const beschreibe = (json: string) => {
    try {
      const r = JSON.parse(json)
      const teile: string[] = []
      if (r.amount_cents != null) teile.push(formatMoney(r.amount_cents))
      if (r.booked_on) teile.push(formatDay(r.booked_on))
      if (r.merchant) teile.push(String(r.merchant))
      if (r.title) teile.push(String(r.title))
      if (r.name) teile.push(String(r.name))
      if (!teile.length) teile.push(`Fassung ${r.version ?? '?'}`)
      return teile.join(' · ')
    } catch { return 'unlesbar' }
  }

  const felderVon = (strategy: string) =>
    String(strategy ?? '').replace(/^Felder:\s*/, '')
      .split(',').map((f) => KONFLIKT_FELD[f.trim()] ?? f.trim())
      .filter(Boolean).join(', ')

  const loese = (k: any, nimm: 'lokal' | 'server') => {
    if (nimm === 'lokal') {
      const lokal = JSON.parse(k.local_json)
      const felder = Object.fromEntries(
        Object.entries(lokal).filter(([c]) => !c.startsWith('_') && c !== 'id' && c !== 'server_rev'))
      m.patch(k.table_name, k.row_id, felder, 'Deine Fassung übernommen')
    }
    getDb().run(
      'UPDATE conflicts SET resolved_at = ?, resolved_by = ? WHERE id = ?',
      [new Date().toISOString(), nimm, k.id] as any,
    )
    // Bei "meine Fassung" bleibt die Zeile als bewusst entschieden markiert,
    // damit der nächste Abgleich sie nicht wieder auf den Serverstand zieht.
    getDb().run(
      `UPDATE ${k.table_name} SET _conflict = ?, _dirty = 1 WHERE id = ?`,
      [nimm === 'lokal' ? KONFLIKT_ENTSCHIEDEN : 0, k.row_id] as any,
    )
    void saveNow()
    setOffen((list) => list.filter((x) => x.id !== k.id))
    onDone()
  }

  if (!offen.length) return null

  return (
    <Card className="mb16" title={`${offen.length} Konflikt${offen.length === 1 ? '' : 'e'} entscheiden`}
      sub="Beide Geräte haben dasselbe Feld geändert. Solange nichts entschieden ist, gilt der Serverstand.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {offen.map((k) => (
          <div key={k.id} style={{
            border: '1px solid var(--border)', borderRadius: 10, padding: 12,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div>
              <strong>{KONFLIKT_TABELLE[k.table_name] ?? k.table_name}</strong>
              {felderVon(k.strategy) && <span className="muted"> · {felderVon(k.strategy)}</span>}
            </div>
            <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div><span className="muted">Dieses Gerät:</span> {beschreibe(k.local_json)}</div>
              <div><span className="muted">Server:</span> {beschreibe(k.remote_json)}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => loese(k, 'lokal')}>
                Meine Fassung
              </button>
              <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => loese(k, 'server')}>
                Serverstand
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------- KI-Zugriff */

function AiTab() {
  const data = useData()
  const m = useMutations()

  return (
    <>
      <Card className="mb16" title="KI-Zugriff auf deine Daten"
        sub="Die App funktioniert vollständig ohne KI. Der Zugriff ist ein Zusatz, kein Bestandteil einer Funktion.">
        <div className="hint-box">
          <p style={{ marginTop: 0 }}>
            Der einfachste und sicherste Weg: Lade die <strong>Auswertungs-Datei</strong> herunter
            (Einstellungen → Daten → „Auswertung (JSON)") und gib sie einer KI deiner Wahl.
            Sie enthält vorberechnete Kennzahlen – Monatssummen, Sparquote, Budgetstände, Zielfortschritt,
            Trackingreihen – statt Rohdaten, damit die Auswertung nicht die Fachlogik nachbauen muss.
          </p>
          <p style={{ marginBottom: 0 }}>
            Deine Daten verlassen dabei nur dann dein Gerät, wenn du die Datei selbst weitergibst.
          </p>
        </div>
        <button className="btn btn-primary mt16" onClick={() => {
          download(`lifehub-auswertung-${timestampSuffix()}.json`, exportSummaryJson(data), 'application/json')
          m.toast('Auswertungsdatei erstellt')
        }}>Auswertungsdatei herunterladen</button>
      </Card>

      <Card title="Beispielfragen, die diese Datei beantwortet">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)' }}>
          <li>Wie viel habe ich diesen Monat für Tanken ausgegeben?</li>
          <li>Wie hoch war meine Sparquote in den letzten sechs Monaten?</li>
          <li>Welche Aufgaben habe ich heute noch offen?</li>
          <li>Wie viel habe ich durchschnittlich geschlafen?</li>
          <li>Wie viele Trainingseinheiten hatte ich diesen Monat?</li>
          <li>Wie entwickelt sich mein Gewicht?</li>
          <li>Wie viel Geld kann ich diesen Monat voraussichtlich sparen?</li>
        </ul>
      </Card>
    </>
  )
}

/* ---------------------------------------------------------------- Konten */

function AccountsSettings() {
  return (
    <>
      <Card className="mb16" title="Konten verwalten"
        sub="Hier legst du Konten an, änderst sie oder nimmst sie außer Betrieb. Gelöschte Konten liegen im Papierkorb; ihre Buchungen bleiben erhalten.">
        <div className="hint-box">
          Die Schalter je Konto steuern die Auswertungen: <strong>Zählt als Sparen</strong> geht in die Sparquote ein,
          <strong> zählt zum verfügbaren Geld</strong> bestimmt, was auf der Startseite als verfügbar erscheint.
        </div>
      </Card>
      <AccountsTab />
    </>
  )
}

/* --------------------------------------------------------- Trackingwerte */

const METRIC_GROUPS: { value: string; label: string }[] = [
  { value: 'nutrition', label: 'Ernährung' },
  { value: 'body', label: 'Körper' },
  { value: 'sleep', label: 'Schlaf' },
  { value: 'activity', label: 'Aktivität' },
  { value: 'wellbeing', label: 'Befinden' },
]

function MetricsSettings() {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<any | 'new' | null>(null)

  const metrics = data.metrics.filter((x) => !x.deleted_at)
  const grouped = METRIC_GROUPS.map((g) => ({ ...g, items: metrics.filter((x) => x.group_key === g.value) }))
    .filter((g) => g.items.length > 0)

  return (
    <>
      <Card className="mb16" title="Was möchtest du tracken?"
        sub="Nur eingeschaltete Werte erscheinen im Tageseintrag. Eigene Werte kannst du jederzeit hinzufügen."
        action={<button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>+ Eigener Wert</button>}>
        <div className="hint-box">
          Ausschalten löscht nichts – bereits erfasste Werte bleiben erhalten und tauchen wieder auf,
          sobald du den Wert erneut einschaltest.
        </div>
      </Card>

      <div className="grid grid-2">
        {grouped.map((g) => (
          <Card key={g.value} title={g.label} sub={`${g.items.filter((x) => x.is_enabled).length} von ${g.items.length} aktiv`}>
            {g.items.map((metric) => (
              <div className="progress-row" key={metric.id}>
                <div className="progress-head">
                  <span className="dot" style={{ background: metric.color ?? 'var(--surface-3)' }} />
                  <span style={{ flex: 1 }}>{metric.name} <span className="muted small">{metric.unit}</span></span>
                  <label className="row small" style={{ gap: 5 }}>
                    <input type="checkbox" checked={!!metric.is_enabled}
                      onChange={(e) => m.patch('metrics', metric.id, {
                        is_enabled: e.target.checked ? 1 : 0,
                        show_in_daily_form: e.target.checked ? 1 : 0,
                      })} />
                    aktiv
                  </label>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(metric)}>…</button>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>

      {editing && <MetricEditor metric={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function MetricEditor({ metric, onClose }: { metric: any | null; onClose: () => void }) {
  const data = useData()
  const m = useMutations()
  const [name, setName] = useState(metric?.name ?? '')
  const [group, setGroup] = useState(metric?.group_key ?? 'nutrition')
  const [unit, setUnit] = useState(metric?.unit ?? '')
  const [valueType, setValueType] = useState(metric?.value_type ?? 'number')
  const [decimals, setDecimals] = useState(metric?.decimals ?? 0)
  const [aggregation, setAggregation] = useState(metric?.aggregation ?? 'sum')
  const [enabled, setEnabled] = useState(metric ? !!metric.is_enabled : true)
  const [showZone, setShowZone] = useState(metric ? !!metric.show_zone : false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const usedCount = metric ? data.metricEntries.filter((e) => !e.deleted_at && e.metric_id === metric.id).length : 0

  const save = () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(), group_key: group, unit, value_type: valueType,
      decimals, aggregation, is_enabled: enabled ? 1 : 0, show_in_daily_form: enabled ? 1 : 0,
      show_zone: showZone ? 1 : 0,
      direction: 'range',
      scale_min: valueType === 'scale' ? 1 : null,
      scale_max: valueType === 'scale' ? 10 : null,
    }
    if (metric) m.patch('metrics', metric.id, payload, 'Wert geändert')
    else m.create('metrics', {
      ...payload, key: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      scale_labels_json: null, is_builtin: 0, color: 'var(--series-4)', sort_order: 500,
    }, 'Wert angelegt')
    onClose()
  }

  return (
    <Modal open title={metric ? 'Trackingwert' : 'Eigener Trackingwert'} onClose={onClose}
      footer={<>
        {metric && !metric.is_builtin && <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Speichern</button>
      </>}>
      <div className="grid grid-2 keep2">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="z. B. Ballaststoffe" /></Field>
        <Field label="Einheit"><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="g, kcal, l …" /></Field>
      </div>
      <Field label="Bereich">
        <Chips options={METRIC_GROUPS.map((g) => ({ value: g.value, label: g.label }))} value={group} onChange={(v) => setGroup(v as any)} />
      </Field>
      <Field label="Art des Werts">
        <Chips options={[
          { value: 'integer', label: 'ganze Zahl' },
          { value: 'number', label: 'Kommazahl' },
          { value: 'scale', label: 'Skala 1–10' },
        ]} value={valueType} onChange={(v) => { setValueType(v as any); setDecimals(v === 'number' ? 1 : 0) }} />
      </Field>
      <Field label="Zusammenfassung über den Tag" hint="Kalorien summiert man, Gewicht nimmt man als letzten Wert.">
        <Chips options={[
          { value: 'sum', label: 'summieren' },
          { value: 'last', label: 'letzter Wert' },
          { value: 'avg', label: 'Mittelwert' },
        ]} value={aggregation} onChange={(v) => setAggregation(v as any)} />
      </Field>
      <label className="row small"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Im Tageseintrag anzeigen</label>
      <label className="row small">
        <input type="checkbox" checked={showZone} onChange={(e) => setShowZone(e.target.checked)} />
        Ampel für den Zielbereich anzeigen
      </label>
      <div className="hint-box small">
        Bei Werten wie Energie, Stimmung oder Schlaf ist eine Ampel oft mehr Störung als Hilfe –
        dort ist sie standardmäßig aus. Der Zielbereich bleibt trotzdem gespeichert und wird in den
        Auswertungen genutzt.
      </div>
      {metric && (
        <div className="hint-box small">
          {usedCount} erfasste Werte. Den Zielbereich stellst du unter <em>Tracking → Zielbereiche</em> ein.
          {metric.is_builtin ? ' Eingebaute Werte lassen sich ausschalten, aber nicht löschen.' : ''}
        </div>
      )}
      <Confirm open={confirmDelete} title="Wert löschen?"
        message={`${usedCount} erfasste Einträge wandern mit in den Papierkorb.`} danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { m.remove('metrics', metric.id, 'Wert gelöscht'); setConfirmDelete(false); onClose() }} />
    </Modal>
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

/* -------------------------------------------------------------- Sicherheit */

function SecurityTab() {
  const data = useData()
  const m = useMutations()
  const s = data.settings
  const hasPin = !!s.pin_hash

  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const savePin = async () => {
    setErr(null); setMsg(null)
    if (pin1.length < 4) { setErr('Die PIN muss mindestens 4 Ziffern haben.'); return }
    if (pin1 !== pin2) { setErr('Die beiden Eingaben stimmen nicht überein.'); return }
    if (hasPin && !(await verifyPin(current, s.pin_salt, s.pin_hash))) {
      setErr('Die bisherige PIN stimmt nicht.'); return
    }
    setBusy(true)
    const salt = randomSalt()
    const hash = await hashPin(pin1, salt)
    m.setSetting('pin_salt', salt)
    m.setSetting('pin_hash', hash)
    markUnlocked()
    setBusy(false)
    setPin1(''); setPin2(''); setCurrent('')
    setMsg('PIN gespeichert. Beim nächsten Öffnen fragt LifeHub danach.')
  }

  const removePin = async () => {
    setErr(null); setMsg(null)
    if (!(await verifyPin(current, s.pin_salt, s.pin_hash))) { setErr('Die PIN stimmt nicht.'); return }
    m.setSetting('pin_hash', '')
    m.setSetting('pin_salt', '')
    setCurrent('')
    setMsg('Der Sperrbildschirm ist ausgeschaltet.')
  }

  return (
    <div className="grid grid-2">
      <Card title="Sperrbildschirm" sub="Schutz gegen neugierige Blicke">
        <div className="hint-box small mb16">
          Deine Daten liegen ausschließlich auf deinem Gerät – weder auf einem Server noch bei mir.
          Die PIN sorgt dafür, dass niemand, der dein Handy oder deinen Rechner in die Hand nimmt,
          einfach hineinschauen kann. Sie wird nicht gespeichert, nur eine daraus berechnete Prüfsumme.
          <br /><br />
          <strong>Ehrlich dazu:</strong> Die Datenbank selbst ist nicht verschlüsselt. Gegen jemanden mit
          vollem Zugriff auf dein angemeldetes Benutzerkonto hilft sie nicht – dafür ist ein eigenes
          Windows-Konto mit Passwort der richtige Weg.
        </div>

        {hasPin && (
          <Field label="Bisherige PIN">
            <input className="input" type="password" inputMode="numeric" value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
        )}
        <div className="grid grid-2 keep2">
          <Field label={hasPin ? 'Neue PIN' : 'PIN'}>
            <input className="input" type="password" inputMode="numeric" value={pin1} maxLength={12}
              onChange={(e) => setPin1(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
          <Field label="Wiederholen">
            <input className="input" type="password" inputMode="numeric" value={pin2} maxLength={12}
              onChange={(e) => setPin2(e.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
        </div>
        {err && <div className="small" style={{ color: 'var(--critical)' }}>{err}</div>}
        {msg && <div className="small" style={{ color: 'var(--good)' }}>{msg}</div>}
        <div className="row mt12">
          <button className="btn btn-primary" disabled={busy} onClick={() => { void savePin() }}>
            {hasPin ? 'PIN ändern' : 'PIN einrichten'}
          </button>
          {hasPin && (
            <button className="btn btn-danger" onClick={() => { void removePin() }}>Sperre entfernen</button>
          )}
        </div>
        {hasPin && (
          <div className="hint-box small mt16">
            Wenn du die PIN vergisst, kommst du in diesem Browser nicht mehr an die Daten heran –
            wohl aber an dein Backup. Lege deshalb unter <strong>Daten &amp; Backup</strong> einen Ordner
            in OneDrive fest; von dort kannst du jederzeit wiederherstellen.
          </div>
        )}
      </Card>

      <Card title="Automatisch sperren" sub="Nach einer Weile ohne Bedienung">
        <Field label="Sperren nach">
          <select className="select" value={s.lock_after_minutes}
            onChange={(e) => m.setSetting('lock_after_minutes', Number(e.target.value))}>
            <option value={0}>Nicht automatisch sperren</option>
            <option value={5}>5 Minuten</option>
            <option value={15}>15 Minuten</option>
            <option value={30}>30 Minuten</option>
            <option value={60}>1 Stunde</option>
          </select>
        </Field>
        <div className="hint-box small">
          Unabhängig davon fragt LifeHub bei jedem neuen Tab bzw. Neustart nach der PIN,
          sobald eine eingerichtet ist.
        </div>
      </Card>
    </div>
  )
}
