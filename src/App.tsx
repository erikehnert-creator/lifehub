/**
 * App-Gerüst: Navigation, Routing (Hash-basiert), Schnelleingabe, Meldungen.
 * Desktop: Seitenleiste. Smartphone: fünf Tabs unten plus Schnelleingabe.
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { StoreProvider, useApp, useData } from './state/store'
import { useAutomatik } from './state/automatik'
import { TodayScreen } from './screens/Today'
import { FinanceScreen } from './screens/Finance'
import { PlannerScreen } from './screens/Planner'
import { TrackingScreen } from './screens/Tracking'
import { GoalsScreen } from './screens/Goals'
import { AnalysisScreen } from './screens/Analysis'
import { SettingsScreen } from './screens/Settings'
import { SearchScreen } from './screens/Search'
import { ShoppingScreen } from './screens/Shopping'
import { QuickAdd } from './screens/QuickAdd'
import { todayString, formatDay } from './core/dates'
import { runSync } from './sync/engine'
import { getStorageMode, saveNow } from './db/sqlite'
import { writeBackup, folderBackupSupported } from './io/folderBackup'
import { exportFullJson, download, timestampSuffix } from './io/exporters'
import { verifyPin, markUnlocked, isUnlockedInSession, clearUnlocked } from './core/lock'
import { isSignedIn, syncRolle, currentSession } from './sync/auth'
import { pendingChangeCount, hasRemoteChanges } from './sync/engine'

interface Route { area: string; sub: string }

/** Wie lange der letzte Abgleich her ist – damit sichtbar ist, dass es von selbst läuft. */
function abgeglichenText(zeitpunkt: number | null): string {
  if (!zeitpunkt) return 'noch nicht abgeglichen'
  const min = Math.floor((Date.now() - zeitpunkt) / 60000)
  if (min < 1) return 'gerade abgeglichen'
  if (min === 1) return 'abgeglichen vor 1 Minute'
  if (min < 60) return `abgeglichen vor ${min} Minuten`
  const std = Math.floor(min / 60)
  return std === 1 ? 'abgeglichen vor 1 Stunde' : `abgeglichen vor ${std} Stunden`
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [area = 'heute', sub = ''] = raw.split('/')
  return { area: area || 'heute', sub }
}

const NAV = [
  { area: 'heute', route: '#/heute', icon: '🏠', label: 'Heute' },
  { area: 'finanzen', route: '#/finanzen', icon: '💰', label: 'Finanzen' },
  { area: 'plan', route: '#/plan', icon: '📅', label: 'Plan' },
  { area: 'tracking', route: '#/tracking', icon: '📊', label: 'Tracking' },
]

const NAV_MORE = [
  { area: 'kalender', route: '#/plan/kalender', icon: '🗓️', label: 'Kalender' },
  { area: 'einkauf', route: '#/einkauf', icon: '🛒', label: 'Einkauf' },
  { area: 'ziele', route: '#/ziele', icon: '🎯', label: 'Ziele' },
  { area: 'analysen', route: '#/analysen', icon: '📈', label: 'Analysen' },
  { area: 'suche', route: '#/suche', icon: '🔍', label: 'Suche' },
  { area: 'einstellungen', route: '#/einstellungen', icon: '⚙️', label: 'Einstellungen' },
]

const SUBNAV: Record<string, { route: string; label: string }[]> = {
  finanzen: [
    { route: '#/finanzen', label: 'Übersicht' },
    { route: '#/finanzen/buchungen', label: 'Buchungen' },
    { route: '#/finanzen/konten', label: 'Konten' },
    { route: '#/finanzen/budgets', label: 'Budgets' },
    { route: '#/finanzen/wiederkehrend', label: 'Wiederkehrend' },
    { route: '#/finanzen/finanztag', label: 'Finanztag' },
  ],
  plan: [
    { route: '#/plan', label: 'Heute' },
    { route: '#/plan/kalender', label: 'Kalender' },
    { route: '#/plan/woche', label: 'Woche' },
    { route: '#/plan/inbox', label: 'Inbox' },
    { route: '#/plan/alle', label: 'Alle Aufgaben' },
    { route: '#/plan/arbeit', label: 'Arbeitsplan' },
  ],
  tracking: [
    { route: '#/tracking', label: 'Tag' },
    { route: '#/tracking/verlauf', label: 'Verlauf' },
    { route: '#/tracking/training', label: 'Training' },
    { route: '#/tracking/koerper', label: 'Körper' },
    { route: '#/tracking/ziele', label: 'Zielbereiche' },
  ],
}

function Shell() {
  const { ready, error, data, saveState, online, toasts, dismissToast, mutations } = useApp()
  const [route, setRoute] = useState<Route>(parseHash)
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickKind, setQuickKind] = useState<any>(undefined)
  const [moreOpen, setMoreOpen] = useState(false)

  // Fällige Zahlungen buchen und liegengebliebene Aufgaben mitnehmen.
  useAutomatik()

  // Gescrollt wird nicht das Fenster, sondern dieser Bereich – deshalb braucht
  // er einen Griff, an dem „nach ganz oben" anfassen kann.
  const inhalt = useRef<HTMLDivElement>(null)
  const nachObenScrollen = useCallback((sanft: boolean) => {
    inhalt.current?.scrollTo({ top: 0, behavior: sanft ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash()); setMoreOpen(false)
      inhalt.current?.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('hashchange', onHash)
    if (!window.location.hash) window.location.hash = '#/heute'
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((r: string) => {
    if (window.location.hash === r) setRoute(parseHash())
    else window.location.hash = r
    setMoreOpen(false)
  }, [])

  const openQuickAdd = useCallback((kind?: any) => { setQuickKind(kind); setQuickOpen(true) }, [])

  // Tastenkürzel: n = neue Erfassung, / = Suche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && /input|textarea|select/i.test(el.tagName)) return
      if (e.key === 'n') { e.preventDefault(); openQuickAdd() }
      if (e.key === '/') { e.preventDefault(); navigate('#/suche') }
      if (e.key === 'Escape') setQuickOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, openQuickAdd])

  // Beim Verlassen der App sofort auf die Festplatte schreiben.
  //
  // Sonst greift nur die kurze Verzögerung, mit der Änderungen gesammelt
  // gespeichert werden – wer auf dem Handy etwas einträgt und die App im selben
  // Moment wegwischt, könnte den letzten Eintrag verlieren. Auf dem Handy ist
  // das der Normalfall, dort gibt es kein "Fenster schließen".
  useEffect(() => {
    if (!ready) return
    const sichern = () => { void saveNow() }
    const beiWechsel = () => { if (document.hidden) sichern() }
    window.addEventListener('pagehide', sichern)
    document.addEventListener('visibilitychange', beiWechsel)
    return () => {
      window.removeEventListener('pagehide', sichern)
      document.removeEventListener('visibilitychange', beiWechsel)
    }
  }, [ready])

  // Automatische Ablage in den gewählten Ordner: beim Verlassen und alle 15 Minuten
  useEffect(() => {
    if (!ready || !folderBackupSupported()) return
    const save = () => { void writeBackup(true) }
    const id = setInterval(save, 15 * 60 * 1000)
    const onHide = () => { if (document.hidden) save() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
    }
  }, [ready])

  // Automatischer Abgleich. Läuft erst, wenn dieses Gerät bei der Erstverbindung
  // eine Rolle bekommen hat – vorher würde ein neues Gerät seinen leeren
  // Anfangsbestand hochladen und alles doppelt erscheinen lassen.
  const [syncEpoche, setSyncEpoche] = useState(0)
  useEffect(() => {
    const bump = () => setSyncEpoche((n) => n + 1)
    window.addEventListener('lifehub:sync-geaendert', bump)
    return () => window.removeEventListener('lifehub:sync-geaendert', bump)
  }, [])

  const [lastSync, setLastSync] = useState<number | null>(null)
  // Ein Abgleich, der im Hintergrund fehlschlägt (falsches Projekt, abgelaufene
  // Anmeldung, fehlendes Schema …), lief bisher komplett lautlos durch: tick()
  // warf das Ergebnis einfach weg. Von außen sah das nicht anders aus als "es
  // gibt gerade nichts zu übertragen" – identisch zu echtem Erfolg. Jetzt wird
  // der Fehler festgehalten und einmalig gemeldet.
  const [syncFehler, setSyncFehler] = useState<string | null>(null)
  const letzterFehlerRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ready || !data.settings.sync_url || !data.settings.sync_key) return
    if (!isSignedIn() || !syncRolle()) return

    let cancelled = false
    let busy = false
    let debounce = 0

    const tick = async () => {
      if (cancelled || busy || !navigator.onLine) return
      busy = true
      try {
        const res = await runSync(data.settings.sync_url, data.settings.sync_key)
        if (!cancelled) {
          if (res.ok) {
            setLastSync(Date.now())
            setSyncFehler(null)
            letzterFehlerRef.current = null
          } else {
            setSyncFehler(res.message)
            // Nur bei einer NEUEN Fehlermeldung eine Meldung zeigen – sonst
            // klingelt es alle paar Sekunden mit derselben Ursache.
            if (letzterFehlerRef.current !== res.message) {
              letzterFehlerRef.current = res.message
              mutations.toast(`Sync fehlgeschlagen: ${res.message}`)
            }
          }
          mutations.reload()
        }
      } finally {
        busy = false
      }
    }

    // Kurz nach einer Änderung: nicht sofort, damit mehrere Eingaben hintereinander
    // in einer Übertragung landen – aber schnell genug, dass das andere Gerät es
    // gleich sieht.
    //
    // Wichtig: Läuft der Zeitgeber schon, wird er NICHT neu gestartet. Genau das
    // war einmal der Fehler – die Prüfung alle paar Sekunden setzte die Wartezeit
    // immer wieder zurück, solange noch etwas offen war. Der Zeitgeber lief damit
    // nie ab und es wurde nur beim Öffnen der App übertragen.
    const beiAenderung = () => {
      if (debounce) return
      if (pendingChangeCount() === 0) return
      debounce = window.setTimeout(() => { debounce = 0; void tick() }, 6000)
    }
    const beiSichtbar = () => { if (!document.hidden) void tick() }

    // Alle halbe Minute eine einzige kleine Nachfrage: Gibt es überhaupt etwas
    // Neues? Nur dann wird wirklich abgeglichen. So merkt das Gerät eine
    // Eingabe vom anderen Gerät binnen einer halben Minute, ohne dauernd
    // vierzig Tabellen abzufragen.
    const nachfragen = async () => {
      if (cancelled || busy || document.hidden) return
      if (await hasRemoteChanges(data.settings.sync_url, data.settings.sync_key)) void tick()
    }

    void tick()
    const takt = setInterval(tick, 10 * 60 * 1000)
    const horchen = setInterval(() => { void nachfragen() }, 30 * 1000)
    const wache = setInterval(beiAenderung, 3000)
    window.addEventListener('online', tick)
    window.addEventListener('focus', beiSichtbar)
    document.addEventListener('visibilitychange', beiSichtbar)
    return () => {
      cancelled = true
      window.clearTimeout(debounce)
      clearInterval(takt); clearInterval(horchen); clearInterval(wache)
      window.removeEventListener('online', tick)
      window.removeEventListener('focus', beiSichtbar)
      document.removeEventListener('visibilitychange', beiSichtbar)
    }
  }, [ready, data.settings.sync_url, data.settings.sync_key, syncEpoche])

  const storageMode = ready ? getStorageMode() : 'idb'
  const syncKonfiguriert = !!data.settings.sync_url && !!data.settings.sync_key
  const syncAktiv = syncKonfiguriert && isSignedIn() && !!syncRolle()
  // Ohne diesen Hinweis sah ein Gerät, auf dem Server-Zugang eingetragen, aber
  // Anmeldung oder Rolle noch nicht abgeschlossen ist, GENAUSO aus wie eines,
  // das ganz bewusst rein lokal läuft – "gespeichert" stand in beiden Fällen
  // da. Genau das führte dazu, dass ein Gerät still vor sich hin lief, ohne
  // je etwas zu übertragen, ohne dass es auffiel.
  const syncFehltNoch = syncKonfiguriert && !syncAktiv
    ? (!isSignedIn() ? 'nicht angemeldet' : 'Rolle noch nicht gewählt')
    : null

  // Sperrbildschirm: einmal pro Tab entsperren, danach optional nach Untätigkeit.
  const [unlocked, setUnlocked] = useState(() => isUnlockedInSession())
  const lockAfter = data.settings.lock_after_minutes
  useEffect(() => {
    if (!data.settings.pin_hash || !unlocked || !lockAfter) return
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { clearUnlocked(); setUnlocked(false) }, lockAfter * 60_000)
    }
    const events = ['pointerdown', 'keydown', 'visibilitychange']
    events.forEach((e) => window.addEventListener(e, arm))
    arm()
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, arm)) }
  }, [data.settings.pin_hash, unlocked, lockAfter])

  const inboxCount = data.tasks.filter((t) => !t.deleted_at && t.bucket === 'inbox' && t.status === 'open').length
  const todayOpen = data.tasks.filter((t) => !t.deleted_at && t.status === 'open' && t.scheduled_on === todayString()).length

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="mark" style={{ width: 42, height: 42, borderRadius: 14, margin: '0 auto 14px' }} />
          <div className="muted small">LifeHub wird geladen…</div>
        </div>
      </div>
    )
  }

  // Auch prüfen, ob dieser Tab schon entsperrt ist: Wird die PIN gerade erst in den
  // Einstellungen gesetzt, ist der Sitzungsmerker gesetzt, der React-Zustand aber noch nicht –
  // sonst würde sich die App direkt nach dem Einrichten selbst aussperren.
  if (data.settings.pin_hash && !unlocked && !isUnlockedInSession()) {
    return <LockScreen settings={data.settings} onUnlock={() => { markUnlocked(); setUnlocked(true) }} />
  }

  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <div className="card" style={{ maxWidth: 480 }}>
          <h2>Die Datenbank konnte nicht geöffnet werden</h2>
          <p className="small muted">{error}</p>
          <p className="small">Deine Daten sind nicht verloren. Lade die Seite neu; wenn das nicht hilft, öffne die App
            in einem anderen Browserfenster oder stelle ein Backup wieder her.</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Neu laden</button>
        </div>
      </div>
    )
  }

  const currentScreen = () => {
    switch (route.area) {
      case 'heute': return <TodayScreen navigate={navigate} openQuickAdd={openQuickAdd} />
      case 'finanzen': return <FinanceScreen sub={route.sub} navigate={navigate} openQuickAdd={openQuickAdd} />
      case 'plan': return <PlannerScreen sub={route.sub} navigate={navigate} openQuickAdd={openQuickAdd} />
      case 'tracking': return <TrackingScreen sub={route.sub} navigate={navigate} />
      case 'einkauf': return <ShoppingScreen />
      case 'ziele': return <GoalsScreen />
      case 'analysen': return <AnalysisScreen sub={route.sub} navigate={navigate} />
      case 'suche': return <SearchScreen navigate={navigate} />
      case 'einstellungen': return <SettingsScreen sub={route.sub} navigate={navigate} />
      default: return <TodayScreen navigate={navigate} openQuickAdd={openQuickAdd} />
    }
  }

  const subnav = SUBNAV[route.area]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="mark" /> LifeHub</div>
        <nav className="nav">
          {NAV.map((n) => (
            <React.Fragment key={n.area}>
              <button className={`nav-item ${route.area === n.area ? 'active' : ''}`} onClick={() => navigate(n.route)}>
                <span className="ico">{n.icon}</span> {n.label}
                {n.area === 'plan' && todayOpen > 0 && <span className="count">{todayOpen}</span>}
              </button>
              {route.area === n.area && subnav && (
                <div style={{ marginLeft: 26, marginBottom: 6 }}>
                  {subnav.map((s) => (
                    <button key={s.route}
                      className={`nav-item ${window.location.hash === s.route || (route.sub === '' && s.route === n.route) ? 'active' : ''}`}
                      style={{ fontSize: 13, padding: '5px 10px' }}
                      onClick={() => navigate(s.route)}>
                      {s.label}
                      {s.label === 'Inbox' && inboxCount > 0 && <span className="count">{inboxCount}</span>}
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
          <div className="nav-title">Mehr</div>
          {NAV_MORE.map((n) => (
            <button key={n.area} className={`nav-item ${route.area === n.area ? 'active' : ''}`} onClick={() => navigate(n.route)}>
              <span className="ico">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', padding: '10px 16px' }} className="small muted">
          <div className="row" style={{ gap: 7 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: !online ? 'var(--text-muted)' : saveState === 'saving' ? 'var(--warning)' : 'var(--good)',
            }} />
            {!online ? 'offline' : saveState === 'saving' ? 'speichert…' : 'gespeichert'}
          </div>
          {syncAktiv && (
            <div className="row" style={{ gap: 7, marginTop: 4 }} title={currentSession()?.email ? `angemeldet als ${currentSession()?.email}` : undefined}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: syncFehler ? 'var(--critical)' : 'var(--series-1)' }} />
              {abgeglichenText(lastSync)}
              {currentSession()?.email && <span style={{ opacity: .7 }}>· {currentSession()?.email}</span>}
            </div>
          )}
          {syncAktiv && syncFehler && (
            <div className="row" style={{ gap: 7, marginTop: 4, color: 'var(--critical)' }} title={syncFehler}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--critical)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{syncFehler}</span>
            </div>
          )}
          {syncAktiv && data.settings.sync_url && (
            <div className="row" style={{ gap: 7, marginTop: 4, opacity: .55 }} title="Projekt-URL, mit der dieses Gerät synchronisiert – auf beiden Geräten muss hier dasselbe stehen">
              <span style={{ width: 8, height: 8 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {String(data.settings.sync_url).replace(/^https?:\/\//, '')}
              </span>
            </div>
          )}
          {syncFehltNoch && (
            <button className="row" style={{ gap: 7, marginTop: 4, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--warning)' }}
              onClick={() => navigate('#/einstellungen/sync')}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)' }} />
              Sync eingerichtet, aber inaktiv – {syncFehltNoch}
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {/* Ein Tipp auf die Kopfzeile springt an den Listenanfang – so wie man
            es vom iPhone kennt, wo man auf die Statuszeile tippt. */}
        <header className="topbar" onClick={() => nachObenScrollen(true)}
          title="Tippen springt nach ganz oben">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mark" style={{ width: 22, height: 22, borderRadius: 7 }} />
            <strong style={{ letterSpacing: '-.02em' }}>
              {NAV.concat(NAV_MORE).find((n) => n.area === route.area)?.label ?? 'LifeHub'}
            </strong>
          </div>
          <span style={{ flex: 1 }} />
          <span className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: !online ? 'var(--text-muted)' : saveState === 'saving' ? 'var(--warning)' : 'var(--good)',
            }} />
            {formatDay(todayString(), 'medium')}
          </span>
        </header>

        <div className="content" ref={inhalt}>
          {storageMode === 'memory' && (
            <div style={{
              margin: '14px 22px 0', padding: '11px 14px', borderRadius: 'var(--r-sm)',
              background: 'rgba(208,59,59,.10)', border: '1px solid var(--critical)', fontSize: 13.5,
            }}>
              <strong>Achtung: Dieser Browser speichert hier nichts dauerhaft.</strong>{' '}
              Deine Eingaben gehen beim Schließen verloren. Lade die Datei über einen Webserver
              (oder nutze die Windows-App), oder sichere deine Daten regelmäßig per Export.
              <button className="btn btn-sm" style={{ marginLeft: 10 }}
                onClick={() => download(`lifehub-sicherung-${timestampSuffix()}.json`, exportFullJson(), 'application/json')}>
                Jetzt sichern
              </button>
            </div>
          )}
          {currentScreen()}
        </div>
      </main>

      <button className="fab" onClick={() => openQuickAdd()} aria-label="Neu erfassen">＋</button>

      <nav className="mobile-nav">
        {NAV.map((n) => (
          <button key={n.area} className={route.area === n.area ? 'active' : ''} onClick={() => navigate(n.route)}>
            <span className="ico">{n.icon}</span>{n.label}
          </button>
        ))}
        <button className={NAV_MORE.some((n) => n.area === route.area) ? 'active' : ''} onClick={() => setMoreOpen(true)}>
          <span className="ico">⋯</span>Mehr
        </button>
      </nav>

      {moreOpen && (
        <div className="overlay" onClick={() => setMoreOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">Mehr</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setMoreOpen(false)}>Schließen</button></div>
            <div className="modal-body">
              {NAV_MORE.map((n) => (
                <button key={n.area} className="btn btn-lg" style={{ justifyContent: 'flex-start' }} onClick={() => navigate(n.route)}>
                  <span style={{ fontSize: 19 }}>{n.icon}</span> {n.label}
                </button>
              ))}
              {subnav && (
                <>
                  <div className="field-label mt8">Bereich</div>
                  <div className="chips">
                    {subnav.map((s) => (
                      <button key={s.route} className="chip" onClick={() => navigate(s.route)}>{s.label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <QuickAdd open={quickOpen} onClose={() => setQuickOpen(false)} initialKind={quickKind} />

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
            {t.undo && <button onClick={() => { t.undo!(); dismissToast(t.id) }}>Rückgängig</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Sperrbildschirm */

function LockScreen({ settings, onUnlock }: {
  settings: { pin_hash: string; pin_salt: string }
  onUnlock: () => void
}) {
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)
  const [checking, setChecking] = useState(false)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (checking || pin.length < 4) return
    setChecking(true)
    const ok = await verifyPin(pin, settings.pin_salt, settings.pin_hash)
    setChecking(false)
    if (ok) onUnlock()
    else { setWrong(true); setPin('') }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
      <form className="card" style={{ maxWidth: 340, width: '100%', textAlign: 'center' }} onSubmit={submit}>
        <div className="mark" style={{ width: 42, height: 42, borderRadius: 14, margin: '0 auto 14px' }} />
        <h2 style={{ marginBottom: 4 }}>LifeHub ist gesperrt</h2>
        <p className="small muted" style={{ marginBottom: 16 }}>Gib deine PIN ein, um weiterzuarbeiten.</p>
        <input className="input" type="password" inputMode="numeric" autoFocus autoComplete="off"
          style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
          value={pin} maxLength={12}
          onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, '')); setWrong(false) }} />
        {wrong && <div className="small mt8" style={{ color: 'var(--critical)' }}>Falsche PIN.</div>}
        <button className="btn btn-primary mt16" style={{ width: '100%' }} type="submit"
          disabled={checking || pin.length < 4}>
          {checking ? 'Wird geprüft …' : 'Entsperren'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
