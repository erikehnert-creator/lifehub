/**
 * EINSTELLUNGEN – der Rahmen und die kleinen Gruppen.
 *
 * Die Datei war mit über 1.800 Zeilen die größte der App und enthielt neben
 * dem Rahmen auch die beiden umfangreichsten Bereiche. Ausgelagert – nach
 * Verantwortlichkeit, nicht nach Zeilenzahl:
 *
 *   settings/sync.tsx    Anmeldung, Erstverbindung, Konflikte, Dubletten
 *   settings/daten.tsx   Export, Ordnerablage, Wiederherstellen, Papierkorb,
 *                        Datenbestand, Beispieldaten, Import
 *
 * Hier bleiben: die Gruppen und ihre Navigation, Allgemein, Darstellung,
 * Automatisierung, Erweitert, Sicherheit, KI-Zugriff, Kategorien,
 * Trackingwerte und FatSecret.
 */
import { hashPin, verifyPin, randomSalt, markUnlocked } from '../core/lock'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Modal, Field, Chips, Confirm, Collapsible } from '../ui/components'
import { useData, useMutations } from '../state/store'
import { exportSummaryJson, download, timestampSuffix, EXPORT_SCHEMA_VERSION } from '../io/exporters'
import { KATEGORIE_FARBEN } from '../db/seed'
import { useFatSecret } from '../state/ernaehrung'
import { SYNCED_TABLES } from '../db/schema'
import { formatDay, formatDuration } from '../core/dates'
import { wakingMinutesFor } from '../core/planner'
import { AccountsTab } from './Finance'
import { PUBLIC_APP_URL } from '../sync/config'
import { Icon, type IconName } from '../ui/icons'
import { DataTab, TrashTab, ImportTab, DatenbestandKarte, BeispieldatenKarte, DatenLoeschenKarte } from './settings/daten'
import { SyncTab } from './settings/sync'

const STATES: [string, string][] = [
  ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'],
  ['TH', 'Thüringen'],
]

/**
 * Die Gruppen der Einstellungen.
 *
 * Vorher elf gleichrangige Reiter – „Papierkorb" neben „Allgemein", „KI-Zugriff"
 * neben „Konten" –, von denen am Handy drei zu sehen waren. Jetzt neun Gruppen
 * nach dem, was man sucht, nicht nach dem, wie die App gebaut ist. Alles
 * Technische sammelt sich unter „Erweitert".
 */
const GRUPPEN: { key: string; label: string; icon: IconName; hinweis: string }[] = [
  { key: 'allgemein', label: 'Allgemein', icon: 'einstellungen', hinweis: 'Name, Bundesland, Tagesrhythmus, Standardkonto' },
  { key: 'sync', label: 'Konto & Synchronisation', icon: 'sync', hinweis: 'Anmeldung und Abgleich zwischen Geräten' },
  { key: 'quellen', label: 'Datenquellen', icon: 'quelle', hinweis: 'FatSecret, Import aus Dateien' },
  { key: 'naehrwerte', label: 'Ernährung', icon: 'ernaehrung', hinweis: 'Welche Nährwerte erfasst werden' },
  { key: 'darstellung', label: 'Darstellung', icon: 'darstellung', hinweis: 'Hell, dunkel, Startseite' },
  { key: 'automatik', label: 'Automatisierung', icon: 'automatik', hinweis: 'Was LifeHub von selbst erledigt' },
  { key: 'daten', label: 'Daten & Backup', icon: 'archiv', hinweis: 'Export, Sicherung, Papierkorb' },
  { key: 'sicherheit', label: 'Sicherheit', icon: 'schloss', hinweis: 'PIN-Sperre, KI-Zugriff' },
  { key: 'erweitert', label: 'Erweitert', icon: 'regler', hinweis: 'Trackingwerte, Datenbestand, Beispieldaten' },
]

/**
 * Frühere Adressen, die weiter funktionieren müssen.
 *
 * `ernaehrung` ist die wichtigste: Dorthin leitet FatSecret nach der Freigabe
 * zurück (core/fatsecret.ts, oauthRueckweg). Die übrigen sind Lesezeichen und
 * Verweise aus älteren Fassungen.
 */
const ALTE_ADRESSEN: Record<string, string> = {
  '': 'allgemein', ernaehrung: 'quellen', import: 'quellen', papierkorb: 'daten',
  ki: 'sicherheit', tracking: 'erweitert',
}

function useIstHandy(): boolean {
  const abfrage = '(max-width: 820px)'
  const [handy, setHandy] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(abfrage).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(abfrage)
    if (!mq) return
    const h = () => setHandy(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return handy
}

export function SettingsScreen({ sub, navigate }: { sub: string; navigate: (r: string) => void }) {
  const handy = useIstHandy()
  // Konten und Kategorien sind eigene Seiten ohne Gruppe – sie gehören zu
  // Finanzen und werden von „Allgemein" aus verlinkt.
  const eigeneSeite = sub === 'konten' || sub === 'kategorien'
  const gruppe = eigeneSeite ? 'allgemein' : (ALTE_ADRESSEN[sub] ?? sub)
  const aktuell = GRUPPEN.find((g) => g.key === gruppe) ?? GRUPPEN[0]
  const titel = eigeneSeite ? (sub === 'konten' ? 'Konten' : 'Kategorien') : aktuell.label
  const geh = (key: string) => navigate(`#/einstellungen/${key}`)

  // Am Handy ist der Einstieg eine Liste der Gruppen, keine Unterseite.
  if (handy && sub === '') {
    return (
      <div className="page">
        <div className="page-head"><div className="page-title">Einstellungen</div></div>
        <div className="card pad0">
          <div className="list">
            {GRUPPEN.map((g) => (
              <button key={g.key} className="list-row" onClick={() => geh(g.key)}>
                <span className="einstellung-ico"><Icon name={g.icon} /></span>
                <span className="list-main">
                  <span className="list-title">{g.label}</span>
                  <span className="list-sub">{g.hinweis}</span>
                </span>
                <span className="muted"><Icon name="pfeil-rechts" size={16} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const inhalt = (
    <>
      {sub === 'konten' && <AccountsSettings />}
      {sub === 'kategorien' && <CategoriesTab />}
      {!eigeneSeite && gruppe === 'allgemein' && <GeneralTab navigate={navigate} />}
      {gruppe === 'sync' && <SyncTab />}
      {gruppe === 'quellen' && <div className="stapel"><ErnaehrungTab /><ImportTab /></div>}
      {gruppe === 'naehrwerte' && <MetricsSettings nurGruppe="nutrition" />}
      {gruppe === 'darstellung' && <DarstellungTab navigate={navigate} />}
      {gruppe === 'automatik' && <AutomatikTab />}
      {gruppe === 'daten' && <div className="stapel"><DataTab /><TrashTab /></div>}
      {gruppe === 'sicherheit' && <div className="stapel"><SecurityTab /><AiTab /></div>}
      {gruppe === 'erweitert' && <ErweitertTab />}
    </>
  )

  if (handy) {
    return (
      <div className="page">
        <button className="btn btn-ghost btn-sm zurueck-knopf" onClick={() => navigate('#/einstellungen')}>
          <Icon name="zurueck" size={16} /> Einstellungen
        </button>
        <div className="page-head"><div className="page-title">{titel}</div></div>
        {inhalt}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head"><div className="page-title">Einstellungen</div></div>
      <div className="einstellungen-raster">
        <nav className="einstellungen-nav" aria-label="Einstellungen">
          {GRUPPEN.map((g) => (
            <button key={g.key} className={`nav-item${g.key === gruppe ? ' active' : ''}`} onClick={() => geh(g.key)}>
              <span className="ico"><Icon name={g.icon} size={17} /></span>{g.label}
            </button>
          ))}
        </nav>
        <div className="einstellungen-inhalt">
          <h2 className="einstellungen-titel">{titel}</h2>
          {inhalt}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Allgemein */

function GeneralTab({ navigate }: { navigate: (r: string) => void }) {
  const data = useData()
  const m = useMutations()
  const s = data.settings

  return (
    <div className="stapel">
      <Card title="Persönlich">
        <div className="formular">
          <Field label="Name" hint="Wird in der Begrüßung verwendet.">
            <input className="input" value={s.user_name} onChange={(e) => m.setSetting('user_name', e.target.value)} placeholder="dein Vorname" />
          </Field>
          <Field label="Bundesland" hint="Bestimmt die gesetzlichen Feiertage im Kalender.">
            <select className="select" value={s.state} onChange={(e) => m.setSetting('state', e.target.value)}>
              {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Tagesrhythmus">
        <Field label="Geplanter Schlaf pro Nacht"
          hint={`Daraus ergibt sich, wie viel ein Tag hergibt: ${formatDuration(wakingMinutesFor(s.sleep_hours ?? 8))} verplanbar.`}>
          <div className="chips">
            {[6, 7, 7.5, 8, 8.5, 9].map((v) => (
              <button key={v} className={`chip sm ${(s.sleep_hours ?? 8) === v ? 'active' : ''}`}
                onClick={() => m.setSetting('sleep_hours', v)}>{String(v).replace('.', ',')} h</button>
            ))}
            <input className="input" style={{ maxWidth: 80 }} inputMode="decimal" aria-label="Eigener Wert in Stunden"
              value={String(s.sleep_hours ?? 8).replace('.', ',')}
              onChange={(e) => {
                const v = Number(e.target.value.replace(',', '.'))
                if (Number.isFinite(v) && v >= 0 && v <= 14) m.setSetting('sleep_hours', v)
              }} />
          </div>
        </Field>
      </Card>

      <Card title="Finanzen">
        <div className="formular">
          <Field label="Standardkonto" hint="Wird in der Schnelleingabe vorausgewählt.">
            <select className="select" value={s.default_account_id ?? ''} onChange={(e) => m.setSetting('default_account_id', e.target.value || null)}>
              <option value="">kein Standard</option>
              {data.accounts.filter((a) => !a.deleted_at).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div className="row">
            <button className="btn btn-sm" onClick={() => navigate('#/finanzen/konten')}>Konten verwalten</button>
            <button className="btn btn-sm" onClick={() => navigate('#/einstellungen/kategorien')}>Kategorien verwalten</button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function DarstellungTab({ navigate }: { navigate: (r: string) => void }) {
  const data = useData()
  const m = useMutations()
  return (
    <div className="stapel">
      <Card title="Erscheinungsbild">
        <Chips options={[
          { value: 'system', label: 'Automatisch' },
          { value: 'light', label: 'Hell' },
          { value: 'dark', label: 'Dunkel' },
        ]} value={data.settings.theme} onChange={(v) => m.setSetting('theme', v as any)} />
      </Card>
      <Card title="Startseite" sub="Welche Blöcke auf „Heute“ stehen und in welcher Reihenfolge.">
        <button className="btn btn-sm" onClick={() => navigate('#/heute')}>Auf „Heute" über „Anpassen" ändern</button>
      </Card>
    </div>
  )
}

function AutomatikTab() {
  const data = useData()
  const m = useMutations()
  const s = data.settings
  const schalter: { key: 'auto_book_recurring' | 'carry_over_tasks' | 'auto_plan_templates'; titel: string; text: string }[] = [
    { key: 'auto_book_recurring', titel: 'Fällige wiederkehrende Zahlungen buchen',
      text: 'Miete, Handyvertrag, Abos. Schon gebuchte Zahlungen bleiben unverändert.' },
    { key: 'carry_over_tasks', titel: 'Offene Aufgaben von gestern mitnehmen',
      text: 'Was liegengeblieben ist, steht am nächsten Morgen wieder im Plan. Feste Termine bleiben an ihrem Tag.' },
    { key: 'auto_plan_templates', titel: 'Aufgaben aus Vorlagen einplanen',
      text: 'Vier Wochen im Voraus, ohne Doppel.' },
  ]
  return (
    <div className="stapel">
      <Card title="Von allein erledigen" sub="Läuft, wenn du die App öffnest. Was dabei passiert ist, steht auf „Heute“.">
        <div className="list">
          {schalter.map((x) => (
            <label key={x.key} className="schalter-zeile">
              <input type="checkbox" checked={s[x.key] !== false} onChange={(e) => m.setSetting(x.key, e.target.checked)} />
              <span className="schalter-text">
                <span className="schalter-titel">{x.titel}</span>
                <span className="small muted">{x.text}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
      <Card title="Finanztag" sub="Wie oft du deine Finanzen durchgehen möchtest.">
        <Chips options={[{ value: 'weekly', label: 'wöchentlich' }, { value: 'monthly', label: 'monatlich' }]}
          value={s.finance_day_interval} onChange={(v) => m.setSetting('finance_day_interval', v as any)} />
      </Card>
    </div>
  )
}

/** Alles, was man selten braucht – und dann genau wissen will. */
function ErweitertTab() {
  return (
    <div className="stapel">
      <MetricsSettings />
      <div className="grid grid-2">
        <DatenbestandKarte />
        <BeispieldatenKarte />
      </div>
      <Card title="Über LifeHub">
        <div className="small muted">
          Deine Daten liegen als SQLite-Datenbank auf diesem Gerät. Exportformat-Version {EXPORT_SCHEMA_VERSION},
          {' '}{SYNCED_TABLES.length} synchronisierte Tabellen.
        </div>
      </Card>
      <DatenLoeschenKarte />
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

function MetricsSettings({ nurGruppe }: { nurGruppe?: string } = {}) {
  const data = useData()
  const m = useMutations()
  const [editing, setEditing] = useState<any | 'new' | null>(null)

  const metrics = data.metrics.filter((x) => !x.deleted_at)
  const grouped = METRIC_GROUPS.filter((g) => !nurGruppe || g.value === nurGruppe)
    .map((g) => ({ ...g, items: metrics.filter((x) => x.group_key === g.value) }))
    .filter((g) => g.items.length > 0)

  return (
    <>
      <Card className="mb16" title={nurGruppe ? 'Welche Nährwerte erfasst werden' : 'Trackingwerte'}
        sub="Ausschalten löscht nichts – erfasste Werte bleiben und tauchen beim Einschalten wieder auf. Zielbereiche stellst du unter Tracking › Zielbereiche ein."
        action={<button className="btn btn-sm" onClick={() => setEditing('new')}>+ Eigener Wert</button>}>
        {null}
      </Card>

      <div className={nurGruppe ? 'stapel' : 'grid grid-2'}>
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

/* -------------------------------------------------------------- Ernährung */

/**
 * FatSecret verbinden und abgleichen.
 *
 * Die Seite muss zwei Dinge ehrlich beantworten, sonst sucht man den Fehler
 * an der falschen Stelle: ob die Verbindung steht, und was LifeHub überhaupt
 * holen kann. Beides steht deshalb im Klartext hier, nicht in einer Datei,
 * die niemand liest.
 */
function ErnaehrungTab() {
  const data = useData()
  const m = useMutations()
  const fs = useFatSecret()
  const [ergebnis, setErgebnis] = useState<string | null>(null)

  // Der Rückweg von FatSecret landet auf genau dieser Seite und hängt seine
  // Antwort an den Hash an.
  const rueckmeldung = useMemo(() => {
    const q = window.location.hash.split('?')[1] ?? ''
    const p = new URLSearchParams(q)
    return { zustand: p.get('fatsecret'), grund: p.get('grund') }
  }, [])

  useEffect(() => { void fs.statusLaden() }, [])

  // Kommt man frisch von der Freigabe zurück, ist das erste, was man sehen
  // will, der eigene gestrige Tag – nicht ein leerer Bildschirm mit einem
  // weiteren Knopf darauf.
  useEffect(() => {
    if (rueckmeldung.zustand !== 'ok') return
    void fs.abgleichen().then((r) => setErgebnis(r.meldung))
  }, [rueckmeldung.zustand])

  const verbunden = !!fs.status?.connected
  const importierteTage = useMemo(() => {
    const tage = new Set(data.foodEntries.filter((f) => !f.deleted_at).map((f) => f.day))
    return tage.size
  }, [data.foodEntries])

  const abgleich = async (tage: number) => {
    const r = await fs.abgleichen(tage)
    setErgebnis(r.meldung)
    if (r.ok) m.toast(r.meldung)
  }

  return (
    <div className="grid grid-2">
      <Card title="FatSecret" sub="Ernährungstagebuch automatisch übernehmen">
        {rueckmeldung.zustand === 'fehler' && (
          <div className="hint-box crit mb12 small">
            Die Freigabe hat nicht geklappt{rueckmeldung.grund ? `: ${rueckmeldung.grund}` : '.'}
          </div>
        )}

        <div className="row mb12">
          <span className={`pill ${verbunden ? 'good' : ''}`}>{verbunden ? 'Verbunden' : 'Nicht verbunden'}</span>
          <span className="small muted">{importierteTage.toLocaleString('de-DE')} {importierteTage === 1 ? 'Tag' : 'Tage'} importiert</span>
        </div>

        {verbunden && (
          <div className="small muted mb12">
            {fs.laeuft
              ? 'Wird geholt …'
              : fs.importStand.zuletzt
                ? `Zuletzt abgeglichen: ${new Date(fs.importStand.zuletzt).toLocaleString('de-DE')}`
                : 'Der erste Abgleich läuft gleich von selbst.'}
            <div className="mt8">
              {fs.importStand.fertig
                ? `Historie vollständig geholt${fs.importStand.aeltesterTag
                  ? ` – ältester Tag: ${formatDay(fs.importStand.aeltesterTag)}`
                  : ''}.`
                : fs.importStand.geprueftBis
                  ? `Ältere Tage werden im Hintergrund nachgeholt – zurück bis ${fs.importStand.geprueftBis}.`
                  : 'Deine bisherigen Tage werden gleich im Hintergrund nachgeholt.'}
            </div>
          </div>
        )}

        {fs.fehler && <div className="hint-box crit mb12 small">{fs.fehler}</div>}
        {ergebnis && <div className="hint-box mb12 small">{ergebnis}</div>}

        <div className="row">
          {verbunden ? (
            <>
              <button className="btn btn-primary" disabled={fs.laeuft} onClick={() => void abgleich(7)}>
                {fs.laeuft ? 'Wird geholt …' : 'Jetzt abgleichen (7 Tage)'}
              </button>
              <button className="btn" disabled={fs.laeuft} onClick={() => void abgleich(30)}>Letzte 30 Tage</button>
              {fs.importStand.fertig && (
                <button className="btn" disabled={fs.laeuft} onClick={() => fs.historieErneut()}>
                  Historie erneut abgleichen
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn btn-danger" disabled={fs.laeuft} onClick={() => void fs.trennen()}>Trennen</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => void fs.verbinden()}>
                {fs.rueckweg.ueberWeb ? 'Mit FatSecret verbinden (öffnet die Webfassung)' : 'Mit FatSecret verbinden'}
              </button>
              {fs.rueckweg.ueberWeb && (
                <button className="btn" disabled={fs.laeuft} onClick={() => void fs.statusLaden()}>
                  Verbindung prüfen
                </button>
              )}
            </>
          )}
        </div>

        {fs.rueckweg.ueberWeb && !verbunden && (
          <div className="hint-box small mt12">
            <strong>Diese Fassung läuft als Datei auf deinem PC.</strong> FatSecret kann nach der
            Freigabe nicht auf eine Datei zurückleiten, sondern nur auf eine Internetadresse.
            Deshalb öffnet sich für die einmalige Freigabe kurz die Webfassung von LifeHub
            (<code>{PUBLIC_APP_URL}</code>) in einem neuen Fenster.
            <div className="mt8">
              Melde dich dort mit <strong>demselben LifeHub-Konto</strong> an wie hier, erteile die
              Freigabe bei FatSecret, und komm dann hierher zurück: Das Zugangstoken liegt danach
              auf dem Server bei deinem Konto – nicht im Browser –, deshalb erkennt auch diese
              Fassung die Verbindung. Einmal auf <em>Verbindung prüfen</em> genügt.
            </div>
          </div>
        )}

      </Card>

      <Card title="So funktioniert FatSecret in LifeHub">
      <Collapsible label="Was übernommen wird">
        <div className="small">
          Aus jedem abgeglichenen Tag übernimmt LifeHub die einzelnen Lebensmittel – mit
          Mahlzeit, Portion und Nährwerten – und rechnet daraus die Tageswerte für
          <strong> Kalorien, Protein, Kohlenhydrate, Fett und Ballaststoffe</strong> (Zucker
          ebenfalls, sofern die Angabe vorliegt).
          <div className="mt8">
            Die Tageswerte landen bei den gewohnten Trackingwerten. Zielbereiche, Verlauf und
            Auswertungen funktionieren dadurch unverändert weiter – es gibt kein zweites
            Ernährungssystem daneben.
          </div>
          <div className="mt8">
            Ein Abgleich holt immer die letzten Tage mit, nicht nur heute: Nachträge und
            Korrekturen in FatSecret kommen so noch an. Mehrfaches Abgleichen legt nichts
            doppelt an.
          </div>
        </div>
      </Collapsible>
      <Collapsible label="Grenzen der Schnittstelle">
        <div className="small">
          <strong>Nur lesen.</strong> LifeHub kann Einträge holen, aber keine nach FatSecret
          zurückschreiben. Erfasst wird weiterhin dort.
          <div className="mt8">
            <strong>Kein Anstoß von außen.</strong> FatSecret meldet sich nicht, wenn sich
            etwas ändert. Abgeglichen wird deshalb, wenn du diese Seite öffnest oder den Knopf
            drückst – nicht in dem Moment, in dem du in FatSecret etwas einträgst.
          </div>
          <div className="mt8">
            <strong>Keine Wasseraufnahme.</strong> Das Tagebuch liefert Nährwerte, keine
            Getränkemenge. Wasser trägst du wie bisher selbst ein.
          </div>
          <div className="mt8">
            <strong>FatSecret hat Vorrang.</strong> Für einen Tag, den FatSecret liefert, gilt
            dessen Zahl. Ein für denselben Tag von Hand eingetragener Kalorienwert wird in den
            Papierkorb verschoben, damit nicht beide Werte zusammengezählt werden – die Meldung
            nach dem Abgleich sagt, wenn das passiert ist.
          </div>
          <div className="mt8">
            <strong>Kein Passwort in LifeHub.</strong> Die Freigabe erteilst du bei FatSecret selbst;
            der Zugriff läuft über den eigenen Server, auf diesem Gerät liegt kein Zugangstoken.
          </div>
        </div>
      </Collapsible>
      </Card>
    </div>
  )
}
