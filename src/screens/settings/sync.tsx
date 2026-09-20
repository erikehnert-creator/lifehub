/**
 * EINSTELLUNGEN · Konto & Synchronisation
 *
 * Zustand, Anmeldung, Erstverbindung, Konflikte und das Zusammenfuehren
 * doppelt angelegter Zeilen. Ausgelagert aus Settings.tsx: Das ist der
 * Bereich mit der meisten eigenen Logik und den meisten Zustaenden.
 */
import React, { useMemo, useState } from 'react'
import { Card, Modal, Field, Chips, Empty, Confirm, Collapsible } from '../../ui/components'
import { useApp, useData, useMutations } from '../../state/store'
import { all, getDb, saveNow } from '../../db/sqlite'
import { formatMoney } from '../../core/money'
import { formatDay } from '../../core/dates'
import { findeDubletten, fuehreZusammen } from '../../state/dubletten'
import { syncStatusText, runSync, pullFresh, pushAll, KONFLIKT_ENTSCHIEDEN } from '../../sync/engine'
import {
  signIn, signOut, currentSession, syncRolle, clearSyncRolle, meldeSyncAenderung,
  type Session, type SyncRolle,
} from '../../sync/auth'
import { resolvedSyncUrl, resolvedSyncKey, hasBuiltinSyncDefaults } from '../../sync/config'
import { SchlafImportKarte } from './schlafimport'

/* ---------------------------------------------------------- Synchronisation */

/**
 * Doppelte Konten, Kategorien und Tagesarten zusammenführen.
 *
 * Steht hier und nicht bei den Konten, weil die Ursache hier liegt: Ein zweites
 * Gerät hat seinen Beispielbestand auf einen Server geladen, auf dem schon
 * etwas lag. Die Karte zeigt sich nur, wenn es tatsächlich etwas zu tun gibt –
 * sonst wäre sie ein Knopf, der bei Langeweile gedrückt wird.
 */
export function DublettenKarte() {
  const m = useMutations()
  const data = useData()
  const [zeigeAlles, setZeigeAlles] = useState(false)

  // Neu berechnet, sobald sich Konten oder Kategorien ändern.
  const befund = useMemo(
    () => findeDubletten(),
    [data.accounts, data.categories, data.transactions, data.dayTypes],
  )
  const alle = [...befund.konten, ...befund.kategorien, ...befund.tagesarten]
  if (!alle.length) return null

  const umzuege = alle.reduce((n, p) => n + p.umzuege.length, 0)
  const sichtbar = zeigeAlles ? alle : alle.slice(0, 6)

  const zusammenfuehren = () => {
    const r = fuehreZusammen(alle, m)
    // Als Hinweis der App, nicht als Text in dieser Karte: Sobald nichts mehr
    // doppelt ist, verschwindet die Karte - und mit ihr saehe man die
    // Rueckmeldung nie. Der Knopf haette dann einfach "nichts getan".
    m.toast(
      `${r.entfernt} Dublette${r.entfernt === 1 ? '' : 'n'} aufgelöst`
      + (r.umgehaengt > 0
        ? `, ${r.umgehaengt} ${r.umgehaengt === 1 ? 'Eintrag' : 'Einträge'} umgehängt`
        : '')
      + '. Die aufgelösten Zeilen liegen im Papierkorb.',
    )
  }

  return (
    <Card className="mb16" title="Doppelte Einträge"
      sub={`${alle.length} Paar${alle.length === 1 ? '' : 'e'} gefunden`}>
      <div className="hint-box crit small mb12">
        Gleiche Namen, verschiedene Kennungen – das entsteht, wenn ein zweites Gerät
        seinen Beispielbestand auf einen Server lädt, auf dem schon Daten liegen.
      </div>

      {befund.tagesarten.length > 0 && (
        <div className="hint-box crit small mb12">
          <strong>Doppelte Tagesarten wirken sich still aus.</strong> Eine Aufgabenvorlage,
          die „nur bei Frühschicht" gilt, vergleicht die Kennung genau. Hängt sie am einen
          Zwilling und dein Arbeitsplan am anderen, entstehen daraus <strong>gar keine
          Aufgaben mehr</strong> – ohne Fehlermeldung. Nach dem Zusammenführen greifen die
          Vorlagen wieder.
        </div>
      )}

      <div className="small mb12">
        LifeHub hängt alles um, was daran hängt ({umzuege} {umzuege === 1 ? 'Eintrag' : 'Einträge'}),
        und legt erst danach die Dublette in den Papierkorb. <strong>Es geht nichts
        verloren</strong> – auch dann nicht, wenn die Buchungen ausgerechnet am neueren
        Konto hängen.
      </div>

      <div className="list mb12">
        {sichtbar.map((p) => (
          <div className="list-row" key={p.behalten.id}>
            <div>
              <div><strong>{p.behalten.name}</strong></div>
              <div className="small muted">
                bleibt ({p.grund}) · {p.aufloesen.length} Dublette
                {p.aufloesen.length === 1 ? '' : 'n'}
                {p.umzuege.length > 0 && ` · ${p.umzuege.length} Eintrag${p.umzuege.length === 1 ? '' : 'e'} ziehen um`}
              </div>
            </div>
          </div>
        ))}
      </div>
      {alle.length > sichtbar.length && (
        <button className="btn btn-ghost small mb12" onClick={() => setZeigeAlles(true)}>
          Alle {alle.length} anzeigen
        </button>
      )}

      <div className="row">
        <button className="btn btn-primary" onClick={zusammenfuehren}>Zusammenführen</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>
          Danach einmal synchronisieren, damit auch die anderen Geräte aufräumen.
        </span>
      </div>
    </Card>
  )
}

export function SyncTab() {
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

  // Eine von Hand eingetragene Server-Verbindung geht vor, sonst greift die
  // eingebaute Werkseinstellung (src/sync/config.ts) – dann muss hier nie
  // wieder eine Projekt-URL eingetippt werden, nur noch E-Mail und Passwort.
  const url = resolvedSyncUrl(data.settings.sync_url)
  const key = resolvedSyncKey(data.settings.sync_key)
  const configured = !!url && !!key
  const nutztWerkseinstellung = !data.settings.sync_url && !data.settings.sync_key && hasBuiltinSyncDefaults()

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

  // Der Zustand, den man wirklich wissen will. Vorher stand hier „Verbindung:
  // online", sobald der Browser Netz hatte – auch ohne Anmeldung, also genau
  // dann, wenn gar nichts synchronisiert wurde.
  const zustand = syncZustand({ configured, angemeldet: !!session, rolle: !!rolle, online })

  return (
    <>
      <Card className="mb16" title="Status">
        <div className="row">
          <span className={`pill ${zustand.ton}`}>{zustand.text}</span>
          <span className="small muted">{zustand.detail}</span>
        </div>
        {(pending > 0 || conflicts > 0) && (
          <div className="small muted mt8">
            {pending > 0 && `${pending.toLocaleString('de-DE')} Änderungen warten auf Übertragung`}
            {pending > 0 && conflicts > 0 && ' · '}
            {conflicts > 0 && <span style={{ color: 'var(--warn-text)' }}>{conflicts} offene Konflikte</span>}
          </div>
        )}
      </Card>

      <DublettenKarte />

      <SchlafImportKarte />

      <div className="mb16">
      <Collapsible label="Wie funktioniert die Synchronisation?">
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
      </Collapsible>
      </div>

      {nutztWerkseinstellung ? (
        <Card className="mb16" title="Server">
          <div className="row" style={{ gap: 7 }}>
            <span className="pill good">✓ voreingestellter Server</span>
            <span className="small muted">Auf diesem Gerät reicht die Anmeldung unten – Projekt-URL und Schlüssel sind schon hinterlegt.</span>
          </div>
          <Collapsible label="Andere Server-Verbindung nutzen" >
            <Field label="Projekt-URL">
              <input className="input" placeholder="https://xxxxxxxx.supabase.co" value={data.settings.sync_url}
                onChange={(e) => m.setSetting('sync_url', e.target.value.trim())} />
            </Field>
            <Field label="Öffentlicher Schlüssel (anon public)" hint="Dieser Schlüssel ist nicht geheim – er benennt nur das Projekt.">
              <input className="input" value={data.settings.sync_key}
                onChange={(e) => m.setSetting('sync_key', e.target.value.trim())} />
            </Field>
            <div className="small muted mt8">Beide Felder leer lassen, um wieder den voreingestellten Server zu nutzen.</div>
          </Collapsible>
        </Card>
      ) : (
        <Card className="mb16" title="Server" sub="Supabase-Projekt. Beide Angaben findest du dort unter Project Settings → API.">
          <Field label="Projekt-URL">
            <input className="input" placeholder="https://xxxxxxxx.supabase.co" value={data.settings.sync_url}
              onChange={(e) => m.setSetting('sync_url', e.target.value.trim())} />
          </Field>
          <Field label="Öffentlicher Schlüssel (anon public)" hint="Dieser Schlüssel ist nicht geheim – er benennt nur das Projekt.">
            <input className="input" value={data.settings.sync_key}
              onChange={(e) => m.setSetting('sync_key', e.target.value.trim())} />
          </Field>
        </Card>
      )}

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
 * Was die Synchronisation gerade tut – in einem Wort und einem Satz.
 *
 * `online` allein sagt nur, ob der Browser Netz hat. Ob abgeglichen wird,
 * hängt zusätzlich an Serverangaben, Anmeldung und der einmaligen Rollenwahl.
 */
export function syncZustand({ configured, angemeldet, rolle, online }: {
  configured: boolean; angemeldet: boolean; rolle: boolean; online: boolean
}): { text: string; detail: string; ton: '' | 'good' | 'warn' } {
  if (!configured) return { text: 'Nur auf diesem Gerät', detail: 'Kein Server eingetragen – es wird nichts übertragen.', ton: '' }
  if (!angemeldet) return { text: 'Nicht angemeldet', detail: 'Unten anmelden, dann gleicht LifeHub von selbst ab.', ton: 'warn' }
  if (!rolle) return { text: 'Erstverbindung offen', detail: 'Einmal festlegen, woher die richtigen Daten kommen.', ton: 'warn' }
  if (!online) return { text: 'Offline', detail: 'Änderungen werden übertragen, sobald wieder Netz da ist.', ton: 'warn' }
  return { text: 'Verbunden', detail: 'Gleicht beim Öffnen und kurz nach jeder Änderung ab.', ton: 'good' }
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

