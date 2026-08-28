/**
 * EINKAUFSZETTEL
 *
 * Gebaut für die eine Situation, in der er wirklich gebraucht wird: eine Hand
 * am Einkaufswagen, die andere am Handy. Deshalb große Zeilen zum Abhaken,
 * kein Bestätigen, kein Nachfragen – und ein Vorrat an Artikeln, die man
 * ohnehin jede Woche kauft, damit man sie nicht jedes Mal neu tippt.
 */
import React, { useMemo, useRef, useState } from 'react'
import { Card, Empty, Modal, Field, Confirm, MoneyInput } from '../ui/components'
import { useData, useMutations } from '../state/store'
import { formatMoney, parseAmountToCents, centsToInput } from '../core/money'
import type { ShoppingItem } from '../core/types'
import { TransactionForm } from './QuickAdd'

/** Grobe Sortierung, damit man im Laden nicht zweimal durch dieselbe Gasse läuft. */
const GASSEN = [
  { key: 'obst', label: 'Obst & Gemüse', icon: '🥦' },
  { key: 'kuehl', label: 'Kühlregal', icon: '🥛' },
  { key: 'fleisch', label: 'Fleisch & Fisch', icon: '🍗' },
  { key: 'trocken', label: 'Trocken & Konserven', icon: '🥫' },
  { key: 'backwaren', label: 'Backwaren', icon: '🥖' },
  { key: 'getraenke', label: 'Getränke', icon: '🧃' },
  { key: 'haushalt', label: 'Haushalt & Drogerie', icon: '🧻' },
  { key: 'sonst', label: 'Sonstiges', icon: '🛒' },
]
const gasseVon = (key: string | null) => GASSEN.find((g) => g.key === key) ?? GASSEN[GASSEN.length - 1]

export function ShoppingScreen() {
  const data = useData()
  const m = useMutations()
  const [entwurf, setEntwurf] = useState('')
  const [bearbeiten, setBearbeiten] = useState<ShoppingItem | null>(null)
  const [vorratOffen, setVorratOffen] = useState(false)
  const [aufraeumen, setAufraeumen] = useState(false)
  const [buchungOffen, setBuchungOffen] = useState(false)
  const feld = useRef<HTMLInputElement>(null)

  const alle = data.shopping.filter((i) => !i.deleted_at)
  const zettel = alle.filter((i) => !i.is_template)
  const offen = zettel.filter((i) => !i.is_checked)
  const erledigt = zettel.filter((i) => i.is_checked)
  const vorrat = alle.filter((i) => i.is_template)
    .sort((a, b) => b.times_used - a.times_used || a.name.localeCompare(b.name))

  const summe = offen.reduce((s, i) => s + (i.estimated_cents ?? 0), 0)

  /**
   * Eingabe in einem Rutsch: „2 Milch", „500 g Hackfleisch", „Milch, Brot, Eier".
   * Wer nur „Milch" tippt, bekommt genau das – die Menge ist freiwillig.
   */
  const hinzufuegen = (text: string) => {
    const teile = text.split(',').map((t) => t.trim()).filter(Boolean)
    for (const teil of teile) {
      const treffer = teil.match(/^(\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|x|stk\.?|packung(?:en)?)?)\s+(.+)$/i)
      const menge = treffer ? treffer[1].trim() : null
      const name = treffer ? treffer[2].trim() : teil
      const vorlage = vorrat.find((v) => v.name.toLowerCase() === name.toLowerCase())
      m.create('shopping_items', {
        name, quantity: menge, aisle: vorlage?.aisle ?? null, note: null,
        is_checked: 0, checked_at: null, is_template: 0, times_used: 0,
        estimated_cents: vorlage?.estimated_cents ?? null,
        sort_order: offen.length,
      })
      if (vorlage) m.patch('shopping_items', vorlage.id, { times_used: vorlage.times_used + 1 })
    }
    setEntwurf('')
    feld.current?.focus()
  }

  const abhaken = (i: ShoppingItem) => {
    m.patch('shopping_items', i.id, {
      is_checked: i.is_checked ? 0 : 1,
      checked_at: i.is_checked ? null : new Date().toISOString(),
    })
  }

  const nachGassen = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>()
    for (const i of offen) {
      const key = gasseVon(i.aisle).key
      map.set(key, [...(map.get(key) ?? []), i])
    }
    return GASSEN.filter((g) => map.has(g.key)).map((g) => ({ gasse: g, items: map.get(g.key)! }))
  }, [offen])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Einkaufszettel</div>
          <div className="page-sub">
            {offen.length === 0 ? 'Alles abgehakt' : `${offen.length} ${offen.length === 1 ? 'Artikel' : 'Artikel'} offen`}
            {summe > 0 && ` · geschätzt ${formatMoney(summe)}`}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setVorratOffen(true)}>Häufig gekauft</button>
          {erledigt.length > 0 && (
            <>
              <button className="btn" onClick={() => setBuchungOffen(true)}>Buchung erstellen</button>
              <button className="btn btn-ghost" onClick={() => setAufraeumen(true)}>Abgehaktes wegräumen</button>
            </>
          )}
        </div>
      </div>

      <Card className="mb16">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (entwurf.trim()) hinzufuegen(entwurf) }}>
          <input ref={feld} className="input" style={{ flex: 1, minWidth: 180 }}
            placeholder="Milch, 500 g Hackfleisch, Zahnpasta …"
            value={entwurf} onChange={(e) => setEntwurf(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!entwurf.trim()}>Auf den Zettel</button>
        </form>
        {vorrat.length > 0 && (
          <div className="chips mt12">
            {vorrat.slice(0, 10).map((v) => (
              <button key={v.id} type="button" className="chip" onClick={() => hinzufuegen(v.name)}>
                + {v.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      {offen.length === 0 && erledigt.length === 0 ? (
        <Empty icon="🛒" title="Der Zettel ist leer"
          hint="Schreib oben rein, was fehlt. Was du oft kaufst, kannst du als Vorlage speichern – dann genügt später ein Tippen." />
      ) : (
        <>
          {nachGassen.map(({ gasse, items }) => (
            <Card key={gasse.key} className="pad0 mb16">
              <div className="einkauf-gasse">{gasse.icon} {gasse.label}</div>
              <div className="list">
                {items.map((i) => (
                  <div key={i.id} className="list-row einkauf-zeile">
                    <button className="checkbox" onClick={() => abhaken(i)} aria-label="Abhaken">✓</button>
                    <button className="list-main" style={{ textAlign: 'left' }} onClick={() => setBearbeiten(i)}>
                      <span className="list-title">{i.name}</span>
                      {(i.quantity || i.note) && (
                        <span className="list-sub">{[i.quantity, i.note].filter(Boolean).join(' · ')}</span>
                      )}
                    </button>
                    {i.estimated_cents ? <span className="small muted mono">{formatMoney(i.estimated_cents)}</span> : null}
                  </div>
                ))}
              </div>
            </Card>
          ))}

          {erledigt.length > 0 && (
            <Card title={`Im Wagen (${erledigt.length})`} className="pad0">
              <div className="list">
                {erledigt.map((i) => (
                  <div key={i.id} className="list-row einkauf-zeile erledigt">
                    <button className="checkbox checked" onClick={() => abhaken(i)} aria-label="Zurücklegen">✓</button>
                    <span className="list-main">
                      <span className="list-title">{i.name}</span>
                      {i.quantity && <span className="list-sub">{i.quantity}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {bearbeiten && <ArtikelEditor artikel={bearbeiten} onClose={() => setBearbeiten(null)} />}
      {vorratOffen && <VorratsListe onClose={() => setVorratOffen(false)} onNehmen={hinzufuegen} />}

      {buchungOffen && (
        <Modal open title="Buchung aus Einkauf" onClose={() => setBuchungOffen(false)}>
          <TransactionForm defaultType="expense"
            defaultAccountId={data.settings.default_account_id ?? data.accounts[0]?.id}
            defaultNote={erledigt.map((i) => i.quantity ? `${i.quantity} ${i.name}` : i.name).join('\n')}
            defaultAmountCents={erledigt.reduce((s, i) => s + (i.estimated_cents ?? 0), 0) || undefined}
            onDone={() => {
              setBuchungOffen(false)
              for (const i of erledigt) m.remove('shopping_items', i.id)
              m.toast(`${erledigt.length} Artikel gebucht und weggeräumt`)
            }} />
        </Modal>
      )}

      <Confirm open={aufraeumen} title="Abgehaktes wegräumen?"
        message={`${erledigt.length} abgehakte Artikel verschwinden vom Zettel. Artikel, die du als Vorlage gespeichert hast, bleiben erhalten.`}
        confirmLabel="Wegräumen"
        onCancel={() => setAufraeumen(false)}
        onConfirm={() => {
          for (const i of erledigt) m.remove('shopping_items', i.id)
          setAufraeumen(false)
          m.toast(`${erledigt.length} Artikel weggeräumt`)
        }} />
    </div>
  )
}

function ArtikelEditor({ artikel, onClose }: { artikel: ShoppingItem; onClose: () => void }) {
  const m = useMutations()
  const [name, setName] = useState(artikel.name)
  const [menge, setMenge] = useState(artikel.quantity ?? '')
  const [gasse, setGasse] = useState(artikel.aisle ?? 'sonst')
  const [notiz, setNotiz] = useState(artikel.note ?? '')
  const [preis, setPreis] = useState(centsToInput(artikel.estimated_cents))
  const [loeschen, setLoeschen] = useState(false)

  const speichern = () => {
    if (!name.trim()) return
    m.patch('shopping_items', artikel.id, {
      name: name.trim(), quantity: menge.trim() || null, aisle: gasse,
      note: notiz.trim() || null, estimated_cents: parseAmountToCents(preis),
    }, 'Artikel geändert')
    onClose()
  }

  const alsVorlage = () => {
    m.create('shopping_items', {
      name: name.trim(), quantity: null, aisle: gasse, note: null,
      is_checked: 0, checked_at: null, is_template: 1, times_used: 1,
      estimated_cents: parseAmountToCents(preis), sort_order: 0,
    }, `„${name.trim()}" als Vorlage gespeichert`)
    onClose()
  }

  return (
    <Modal open title="Artikel" onClose={onClose} footer={<>
      <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn btn-primary" onClick={speichern} disabled={!name.trim()}>Speichern</button>
    </>}>
      <Field label="Artikel">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="grid grid-2 keep2">
        <Field label="Menge" hint="freiwillig">
          <input className="input" value={menge} onChange={(e) => setMenge(e.target.value)} placeholder="500 g" />
        </Field>
        <Field label="Wo im Laden">
          <select className="select" value={gasse} onChange={(e) => setGasse(e.target.value)}>
            {GASSEN.map((g) => <option key={g.key} value={g.key}>{g.icon} {g.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Ungefährer Preis" hint="nur für die Schätzung oben – kein Muss">
        <MoneyInput value={preis} onChange={setPreis} />
      </Field>
      <Field label="Notiz">
        <input className="input" value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Marke, Sorte …" />
      </Field>
      {!artikel.is_template && (
        <button className="btn" onClick={alsVorlage}>Als häufig gekauft merken</button>
      )}
      <Confirm open={loeschen} title="Artikel löschen?" message={`„${artikel.name}" verschwindet vom Zettel.`}
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => { m.remove('shopping_items', artikel.id, 'Artikel gelöscht'); setLoeschen(false); onClose() }} />
    </Modal>
  )
}

function VorratsListe({ onClose, onNehmen }: { onClose: () => void; onNehmen: (name: string) => void }) {
  const data = useData()
  const m = useMutations()
  const [neu, setNeu] = useState('')
  const vorrat = data.shopping.filter((i) => !i.deleted_at && i.is_template)
    .sort((a, b) => b.times_used - a.times_used || a.name.localeCompare(b.name))

  return (
    <Modal open title="Häufig gekauft" onClose={onClose} footer={
      <button className="btn btn-primary" onClick={onClose}>Fertig</button>
    }>
      <p className="small muted" style={{ margin: 0 }}>
        Was hier steht, landet mit einem Tippen auf dem Zettel – Zahnpasta, Haferflocken,
        die Sachen eben, die sowieso jede Woche dabei sind.
      </p>
      <form className="row" onSubmit={(e) => {
        e.preventDefault()
        if (!neu.trim()) return
        m.create('shopping_items', {
          name: neu.trim(), quantity: null, aisle: null, note: null,
          is_checked: 0, checked_at: null, is_template: 1, times_used: 0,
          estimated_cents: null, sort_order: 0,
        })
        setNeu('')
      }}>
        <input className="input" style={{ flex: 1 }} value={neu} onChange={(e) => setNeu(e.target.value)}
          placeholder="Neue Vorlage …" />
        <button className="btn" type="submit" disabled={!neu.trim()}>Merken</button>
      </form>
      {vorrat.length === 0 ? (
        <Empty icon="⭐" title="Noch keine Vorlagen" hint="Trag oben ein, was du regelmäßig kaufst." />
      ) : (
        <div className="list">
          {vorrat.map((v) => (
            <div key={v.id} className="list-row">
              <span className="list-main">
                <span className="list-title">{v.name}</span>
                <span className="list-sub">{v.times_used > 0 ? `${v.times_used}× genommen` : 'noch nie genommen'}</span>
              </span>
              <button className="btn btn-sm" onClick={() => onNehmen(v.name)}>Auf den Zettel</button>
              <button className="btn btn-sm btn-ghost" onClick={() => m.remove('shopping_items', v.id, 'Vorlage entfernt')}>✕</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
