/**
 * GLOBALE SUCHE – findet Buchungen, Aufgaben, Termine, Notizen und Ziele
 * in einem Durchgang.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty, Chips } from '../ui/components'
import { useData } from '../state/store'
import { formatMoney } from '../core/money'
import { formatDay, relativeDay } from '../core/dates'

type Hit = {
  kind: string
  icon: string
  title: string
  sub: string
  amount?: string
  route: string
  day: string
}

export function SearchScreen({ navigate }: { navigate: (r: string) => void }) {
  const data = useData()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'finance' | 'tasks' | 'events' | 'notes'>('all')

  const catById = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories])
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts])

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: Hit[] = []

    if (scope === 'all' || scope === 'finance') {
      for (const t of data.transactions) {
        if (t.deleted_at) continue
        const cat = t.category_id ? catById.get(t.category_id) : null
        const hay = [t.merchant, t.description, t.note, cat?.name, accById.get(t.account_id)?.name]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) continue
        out.push({
          kind: 'Buchung', icon: cat?.icon ?? (t.type === 'income' ? '💰' : '💸'),
          title: t.merchant || t.description || cat?.name || 'Buchung',
          sub: `${formatDay(t.booked_on)} · ${accById.get(t.account_id)?.name ?? ''}${cat ? ` · ${cat.name}` : ''}`,
          amount: `${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${formatMoney(t.amount_cents).replace('-', '')}`,
          route: '#/finanzen/buchungen', day: t.booked_on,
        })
      }
    }
    if (scope === 'all' || scope === 'tasks') {
      for (const t of data.tasks) {
        if (t.deleted_at) continue
        const hay = `${t.title} ${t.description ?? ''} ${t.note ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
        out.push({
          kind: 'Aufgabe', icon: t.status === 'done' ? '✅' : '⬜',
          title: t.title,
          sub: t.scheduled_on ? relativeDay(t.scheduled_on) : t.bucket === 'inbox' ? 'Inbox' : 'ohne Datum',
          route: '#/plan/alle', day: t.scheduled_on ?? t.created_at.slice(0, 10),
        })
      }
    }
    if (scope === 'all' || scope === 'events') {
      for (const e of data.events) {
        if (e.deleted_at) continue
        const hay = `${e.title} ${e.description ?? ''} ${e.location ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
        out.push({
          kind: 'Termin', icon: '📅', title: e.title,
          sub: `${formatDay(e.day)}${e.start_time ? ` · ${e.start_time}` : ''}${e.location ? ` · ${e.location}` : ''}`,
          route: '#/plan/monat', day: e.day,
        })
      }
    }
    if (scope === 'all' || scope === 'notes') {
      for (const n of data.notes as any[]) {
        if (n.deleted_at) continue
        const hay = `${n.title ?? ''} ${n.body}`.toLowerCase()
        if (!hay.includes(q)) continue
        out.push({
          kind: 'Notiz', icon: '📝', title: n.title || n.body.slice(0, 50),
          sub: n.day ? formatDay(n.day) : '', route: '#/heute', day: n.day ?? n.created_at.slice(0, 10),
        })
      }
      for (const g of data.goals) {
        if (g.deleted_at) continue
        if (!`${g.name} ${g.description ?? ''}`.toLowerCase().includes(q)) continue
        out.push({ kind: 'Ziel', icon: g.icon ?? '🎯', title: g.name, sub: g.description ?? '', route: '#/ziele', day: g.start_on })
      }
    }

    return out.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 200)
  }, [query, scope, data, catById, accById])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Suche</div>
          <div className="page-sub">Über alle Bereiche gleichzeitig</div>
        </div>
      </div>

      <Card className="mb16">
        <input className="input" autoFocus placeholder={'Suchbegriff, z. B. „Tanken“ …'}
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips mt12">
          {[
            { value: 'all', label: 'Alles' },
            { value: 'finance', label: 'Finanzen' },
            { value: 'tasks', label: 'Aufgaben' },
            { value: 'events', label: 'Termine' },
            { value: 'notes', label: 'Notizen & Ziele' },
          ].map((s) => (
            <button key={s.value} className={`chip sm ${scope === s.value ? 'active' : ''}`} onClick={() => setScope(s.value as any)}>{s.label}</button>
          ))}
        </div>
      </Card>

      {query.trim().length < 2 ? (
        <Empty icon="🔍" title="Suchbegriff eingeben" hint="Mindestens zwei Zeichen." />
      ) : hits.length === 0 ? (
        <Empty icon="🤷" title="Nichts gefunden" hint={`Kein Treffer für „${query}“.`} />
      ) : (
        <Card title={`${hits.length} Treffer`} className="pad0">
          <div className="list">
            {hits.map((h, i) => (
              <button className="list-row" key={i} onClick={() => navigate(h.route)}>
                <span className="avatar">{h.icon}</span>
                <span className="list-main">
                  <span className="list-title">{h.title}</span>
                  <span className="list-sub">{h.kind}{h.sub ? ` · ${h.sub}` : ''}</span>
                </span>
                {h.amount && <span className="list-amount">{h.amount}</span>}
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
