import React, { useEffect, useRef, useState } from 'react'
import { registerInput } from '../core/money'
import { parseDuration, durationToInput, formatDuration, liveDurationPreview } from '../core/dates'

export function Card({ title, sub, action, children, className = '' }: {
  title?: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode
  children: React.ReactNode; className?: string
}) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {action && <div className="card-action">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Stat({ label, value, delta, deltaKind = 'neutral', small, sub }: {
  label: string; value: React.ReactNode; delta?: React.ReactNode
  deltaKind?: 'up' | 'down' | 'neutral'; small?: boolean; sub?: React.ReactNode
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${small ? ' sm' : ''}`}>{value}</span>
      {delta && <span className={`stat-delta ${deltaKind}`}>{delta}</span>}
      {sub && <span className="small muted">{sub}</span>}
    </div>
  )
}

const MODAL_STACK: object[] = []

export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: React.ReactNode; onClose: () => void
  children: React.ReactNode; footer?: React.ReactNode; wide?: boolean
}) {
  // Escape schließt immer nur das oberste Fenster. Ohne diesen Stapel würde ein
  // Dialog im Dialog (z. B. Belegvorschau über dem Buchungseditor) beide
  // gleichzeitig schließen.
  useEffect(() => {
    if (!open) return
    const token = {}
    MODAL_STACK.push(token)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (MODAL_STACK[MODAL_STACK.length - 1] !== token) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = MODAL_STACK.indexOf(token)
      if (i >= 0) MODAL_STACK.splice(i, 1)
      if (MODAL_STACK.length === 0) document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ marginLeft: 'auto' }} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

export function Chips<T extends string | number>({ options, value, onChange, size }: {
  options: { value: T; label: React.ReactNode }[]
  value: T | null
  onChange: (v: T) => void
  size?: 'sm'
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={String(o.value)} type="button"
          className={`chip${size === 'sm' ? ' sm' : ''}${value === o.value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { key: string; label: React.ReactNode }[]
  active: string
  onChange: (k: string) => void
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} className={`tab-btn${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  )
}

export function Empty({ icon = '📭', title, hint, action }: {
  icon?: string; title: string; hint?: string; action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action && <div className="mt12">{action}</div>}
    </div>
  )
}

export function Confirm({ open, title, message, confirmLabel = 'Löschen', danger, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string
  danger?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} footer={
      <>
        <button className="btn" onClick={onCancel}>Abbrechen</button>
        <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </>
    }>
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  )
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch { return initial }
  })
  const set = (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)) } catch { /* ignore */ } }
  return [v, set]
}

export function ZonePill({ status, children }: { status: 'optimal' | 'tolerated' | 'outside' | 'unknown'; children?: React.ReactNode }) {
  if (status === 'unknown') return <span className="pill">–</span>
  const cls = status === 'optimal' ? 'good' : status === 'tolerated' ? 'warn' : 'crit'
  const icon = status === 'optimal' ? '✓' : status === 'tolerated' ? '!' : '✕'
  return <span className={`pill ${cls}`}>{icon} {children ?? (status === 'optimal' ? 'optimal' : status === 'tolerated' ? 'Toleranz' : 'außerhalb')}</span>
}

export function StatusPill({ status, children }: { status: 'green' | 'amber' | 'red'; children: React.ReactNode }) {
  const cls = status === 'green' ? 'good' : status === 'amber' ? 'warn' : 'crit'
  const icon = status === 'green' ? '✓' : status === 'amber' ? '!' : '✕'
  return <span className={`pill ${cls}`}>{icon} {children}</span>
}

export function Collapsible({ label, children, defaultOpen = false }: {
  label: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} style={{ paddingLeft: 0 }}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <div className="mt8">{children}</div>}
    </div>
  )
}

export function AutoFocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 40); return () => clearTimeout(t) }, [])
  return <input ref={ref} {...props} />
}

/**
 * Dauer-Eingabe in einem einzigen Feld.
 *
 * Zwei Kästchen für Stunden und Minuten sind auf dem Handy unnötig fummelig.
 * Hier tippt man einfach `115` und bekommt 1:15 – `45` bleiben 45 Minuten,
 * `1:15`, `1h30` und `1,5 h` gehen genauso. Was daraus geworden ist, steht
 * direkt daneben, damit man sich nicht auf gut Glück verlassen muss.
 */
export function DurationInput({ minutes, onChange, allowEmpty = true }: {
  minutes: number | null
  onChange: (m: number | null) => void
  allowEmpty?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)

  // Beim Tippen mit dem Ziffernblock (der Normalfall auf dem Handy) steht das
  // Ergebnis direkt im Feld selbst – aus „200" wird beim Tippen sofort „2:00",
  // ganz ohne eine Zahl daneben. Nur bei Kurzschreibweisen mit Buchstaben oder
  // Komma (z. B. „1h30", „1,5 h") bleibt stehen, was eingetippt wurde, bis man
  // das Feld verlässt – die ließen sich sonst beim Tippen nicht zu Ende
  // schreiben, weil jeder Tastendruck das Feld sofort umformatiert hätte.
  // Die Live-Vorschau nutzt bewusst liveDurationPreview (rein strukturell,
  // siehe dort) statt parseDuration/durationToInput – sonst verfälscht das
  // Umformatieren beim Weitertippen die eigentlich eingetippten Ziffern.
  const nurZiffern = draft?.replace(/:/g, '') ?? ''
  const istZiffernEingabe = draft === null || /^\d*$/.test(nurZiffern)
  const liveFormatiert = istZiffernEingabe && draft !== null
    ? liveDurationPreview(nurZiffern)
    : ''
  const text = draft === null
    ? durationToInput(minutes)
    : istZiffernEingabe
      ? (liveFormatiert || draft)
      : draft
  const erkannt = draft === null ? minutes : parseDuration(draft)

  const commit = () => {
    if (draft === null) return
    const m = parseDuration(draft)
    setDraft(null)
    if (m === null) { onChange(allowEmpty ? null : 0); return }
    onChange(m)
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <input className="input" style={{ maxWidth: 110 }} inputMode="numeric" placeholder="z. B. 2:00"
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }} />
      {!istZiffernEingabe && (
        <span className="muted small" style={{ minWidth: 90 }}>
          {erkannt ? `= ${formatDuration(erkannt)}` : 'Std:Min oder Minuten'}
        </span>
      )}
      {minutes !== null && minutes > 0 && (
        <button className="btn btn-sm btn-ghost" type="button"
          onClick={() => { setDraft(null); onChange(null) }}>zurücksetzen</button>
      )}
    </div>
  )
}

/**
 * Betragsfeld mit Cent-Automatik, wie an der Kasse: die Ziffern wandern von
 * rechts herein. `2000` wird also zu 20,00 € – kein Komma tippen, kein
 * Verrutschen. Wer trotzdem `20,00` eintippt, bekommt dasselbe Ergebnis.
 */
export function MoneyInput({ value, onChange, autoFocus, placeholder = '0,00', style, allowNegative }: {
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  placeholder?: string
  style?: React.CSSProperties
  allowNegative?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  // Der Cursor gehört bei dieser Eingabeart immer ans Ende – sonst landen
  // neue Ziffern mitten im Betrag.
  useEffect(() => {
    const el = ref.current
    if (!el || document.activeElement !== el) return
    const n = el.value.length
    try { el.setSelectionRange(n, n) } catch { /* ältere Browser */ }
  })
  return (
    <div className="row" style={{ gap: 6 }}>
      <input ref={ref} className="input" inputMode="numeric" autoFocus={autoFocus}
        placeholder={placeholder} value={value} style={style}
        onChange={(e) => {
          const roh = allowNegative ? e.target.value : e.target.value.replace(/-/g, '')
          onChange(registerInput(roh))
        }} />
      <span className="muted">€</span>
    </div>
  )
}

