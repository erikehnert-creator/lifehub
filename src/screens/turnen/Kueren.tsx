/**
 * TURNEN · KÜREN – die Übungen, geordnet.
 *
 * Eine Kür ist eine geordnete Folge vorhandener Elemente an einem Gerät.
 * Mehrere je Gerät sind der Normalfall: eine Wettkampffassung, eine
 * Trainingsvariante, eine sichere Variante für den schlechten Tag.
 *
 * ---------------------------------------------------------------------------
 * Warum die Reihenfolge über Knöpfe geht und nicht über Ziehen
 *
 * Ziehen und Fallenlassen wäre der schönere Weg – und im vorhandenen Stack der
 * unzuverlässigste. Das eingebaute HTML-Ziehen (`draggable`) kennt auf
 * Berührungsbildschirmen keine Ereignisse; am Handy passiert schlicht nichts.
 * Ein eigener Nachbau über Zeigerereignisse müsste Scrollen, langes Drücken
 * und den Bildschirmrand selbst behandeln, und er müsste es in einem Dialog
 * tun, der ohnehin scrollt. Das ist genau die fragile Abhängigkeit, die hier
 * nichts zu suchen hat.
 *
 * Deshalb: zwei grosse Knöpfe je Zeile, 44 px hoch – das Mass, das Apple und
 * Google als kleinste sichere Trefferfläche nennen. Keine winzigen Pfeile.
 *
 * ---------------------------------------------------------------------------
 * Was hier NICHT gerechnet wird
 *
 * Die Schwierigkeitssumme ist die Summe der eingetragenen Elementwerte und
 * heisst auch so. Sie ist kein D-Wert und keine D-Note: Anschlussboni,
 * Elementgruppenanforderungen, die Zehn-Elemente-Regel, das Streichergebnis
 * und der Abgangsbonus fliessen nicht ein (TURNEN_ARCHITEKTUR.md, 4.2).
 */
import React, { useMemo, useState } from 'react'
import { Card, Field, Modal, Empty, Confirm, StatusPill } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { todayString, diffDays, nowIso } from '../../core/dates'
import { GERAETE, geraetName, type GeraetKey } from '../../core/turnen/geraete'
import { statusDef } from '../../core/turnen/status'
import { bloeckeMitTag, elementBild, type ElementBild } from '../../core/turnen/elemente'
import {
  kuerElemente, verschiebe, schwierigkeit, schwierigkeitText,
  problemstellen, problemZusammenfassung, kuerBild, sortiereKueren,
  wettkampfKuerJeGeraet, zuLoeschendeZeitpunkte,
  planeKuerElemente, planIstLeer,
  type KuerWunsch, type KuerBild, type Problemstelle,
} from '../../core/turnen/kueren'
import type { GymElement, GymRoutine } from '../../core/types'

/* ------------------------------------------------------------ Bausteine */

function StatusZeichen({ status }: { status: string }) {
  const def = statusDef(status)
  if (def.ton === 'neutral') return <span className="pill">{def.label}</span>
  const ampel = def.ton === 'gut' ? 'green' : def.ton === 'warnung' ? 'amber' : 'red'
  return <StatusPill status={ampel}>{def.label}</StatusPill>
}

/** Schwierigkeit eines Elements, so kurz wie möglich: „D 0,4“, „D“, „0,4“. */
function schwierigkeitKurz(e: GymElement | null): string {
  if (!e) return ''
  const b = e.difficulty_letter?.trim().toUpperCase() || ''
  const w = typeof e.difficulty_value === 'number' && Number.isFinite(e.difficulty_value)
    ? e.difficulty_value.toFixed(1).replace('.', ',')
    : ''
  return [b, w].filter(Boolean).join(' ')
}

/**
 * Die Elementbilder, die eine Kürseite braucht – in einem Durchgang.
 *
 * `elementBild` filtert die Blöcke selbst nach Element. Sie alle je Element
 * erneut zu durchlaufen wäre bei 60 Elementen und 2.000 Versuchszeilen
 * 120.000 Vergleiche für eine Seite, die nur Hinweise anzeigt. Einmal nach
 * Element gruppieren macht daraus einen Durchgang.
 */
function useElementBilder(): Map<string, ElementBild> {
  const data = useData()
  const heute = todayString()
  return useMemo(() => {
    const bloecke = bloeckeMitTag(data.gymAttempts, data.workoutSessions)
    const jeElement = new Map<string, typeof bloecke>()
    for (const b of bloecke) {
      const liste = jeElement.get(b.block.element_id)
      if (liste) liste.push(b)
      else jeElement.set(b.block.element_id, [b])
    }
    const out = new Map<string, ElementBild>()
    for (const e of data.gymElements) {
      if (e.deleted_at) continue
      out.set(e.id, elementBild(e, jeElement.get(e.id) ?? [], heute, diffDays))
    }
    return out
  }, [data.gymAttempts, data.workoutSessions, data.gymElements, heute])
}

/* ============================================================== Übersicht */

export function KuerenView({ onZuElementen }: { onZuElementen: () => void }) {
  const data = useData()
  const [geraet, setGeraet] = useState<GeraetKey | 'alle'>('alle')
  const [zeigeArchiv, setZeigeArchiv] = useState(false)
  const [offen, setOffen] = useState<GymRoutine | 'neu' | null>(null)
  const bilder = useElementBilder()

  const wettkampf = useMemo(
    () => wettkampfKuerJeGeraet(data.gymRoutines),
    [data.gymRoutines],
  )

  const kuerBilder = useMemo(() => {
    const kueren = data.gymRoutines.filter(
      (k) => !k.deleted_at && (zeigeArchiv || k.is_active))
    return kueren
      .filter((k) => geraet === 'alle' || k.apparatus === geraet)
      .map((k) => kuerBild(k, data.gymRoutineElements, data.gymElements, bilder, wettkampf))
      .sort(sortiereKueren)
  }, [data.gymRoutines, data.gymRoutineElements, data.gymElements, bilder, wettkampf, geraet, zeigeArchiv])

  const archiviert = data.gymRoutines.filter((k) => !k.deleted_at && !k.is_active).length

  // Nach Geraet gruppieren, in Wettkampfreihenfolge. Die Sortierung innerhalb
  // einer Gruppe steht schon (sortiereKueren).
  const gruppen = useMemo(() => {
    const out: { key: string; name: string; bilder: KuerBild[] }[] = []
    for (const g of GERAETE) {
      const meine = kuerBilder.filter((b) => b.kuer.apparatus === g.key)
      if (meine.length) out.push({ key: g.key, name: g.name, bilder: meine })
    }
    // Kueren an einem Geraet, das die Konstante nicht kennt, gehen nicht
    // verloren - sie stehen am Ende unter ihrem rohen Schluessel.
    const bekannt = new Set(GERAETE.map((g) => g.key))
    for (const b of kuerBilder) {
      if (bekannt.has(b.kuer.apparatus as GeraetKey)) continue
      let gruppe = out.find((x) => x.key === b.kuer.apparatus)
      if (!gruppe) {
        gruppe = { key: b.kuer.apparatus, name: geraetName(b.kuer.apparatus), bilder: [] }
        out.push(gruppe)
      }
      gruppe.bilder.push(b)
    }
    return out
  }, [kuerBilder])

  return (
    <>
      <Card className="mb16">
        <div className="chips">
          <button className={`chip sm${geraet === 'alle' ? ' active' : ''}`}
            onClick={() => setGeraet('alle')}>Alle</button>
          {GERAETE.map((g) => (
            <button key={g.key} className={`chip sm${geraet === g.key ? ' active' : ''}`}
              onClick={() => setGeraet(g.key)}>{g.name}</button>
          ))}
        </div>
        <div className="row mt12">
          <button className="btn btn-primary" onClick={() => setOffen('neu')}>+ Kür</button>
          <span style={{ flex: 1 }} />
          {archiviert > 0 && (
            <button className={`chip sm${zeigeArchiv ? ' active' : ''}`}
              onClick={() => setZeigeArchiv(!zeigeArchiv)}>
              Archiv ({archiviert})
            </button>
          )}
        </div>
      </Card>

      {gruppen.length === 0 ? (
        <Empty kompakt title="Noch keine Kür"
          hint="Eine Kür ist eine geordnete Folge deiner Elemente an einem Gerät."
          action={<button className="btn btn-primary btn-sm" onClick={() => setOffen('neu')}>+ Erste Kür</button>} />
      ) : (
        gruppen.map((g) => (
          <Card key={g.key} className="pad0 mb16" title={g.name}>
            <div className="list">
              {g.bilder.map((b) => (
                <KuerZeile key={b.kuer.id} bild={b} onOpen={() => setOffen(b.kuer)} />
              ))}
            </div>
          </Card>
        ))
      )}

      {offen && (
        <KuerEditor kuer={offen === 'neu' ? null : offen}
          vorgabeGeraet={geraet === 'alle' ? 'boden' : geraet}
          onZuElementen={onZuElementen}
          onClose={() => setOffen(null)} />
      )}
    </>
  )
}

function KuerZeile({ bild, onOpen }: { bild: KuerBild; onOpen: () => void }) {
  const k = bild.kuer
  const s = bild.schwierigkeit
  return (
    <button className="list-row" onClick={onOpen}>
      <span className="list-main">
        <span className="list-title">
          {k.name}
          {!k.is_active && <span className="pill" style={{ marginLeft: 6 }}>archiviert</span>}
        </span>
        <span className="list-sub">
          {bild.eintraege.length === 1 ? '1 Element' : `${bild.eintraege.length} Elemente`}
          {' · Summe '}{schwierigkeitText(s)}
          {bild.hinweise.length > 0 && (
            <span className="pill warn" style={{ marginLeft: 6 }}>{bild.hinweise[0]}</span>
          )}
        </span>
      </span>
      {bild.istWettkampf && <StatusPill status="green">Wettkampfkür</StatusPill>}
    </button>
  )
}

/* ================================================================ Editor */

function KuerEditor({ kuer, vorgabeGeraet, onZuElementen, onClose }: {
  kuer: GymRoutine | null
  vorgabeGeraet: GeraetKey
  onZuElementen: () => void
  onClose: () => void
}) {
  const data = useData()
  const m = useMutations()
  const bilder = useElementBilder()

  const [name, setName] = useState(kuer?.name ?? '')
  const [apparatus, setApparatus] = useState<GeraetKey>((kuer?.apparatus as GeraetKey) ?? vorgabeGeraet)
  const [notiz, setNotiz] = useState(kuer?.note ?? '')
  const [aktiv, setAktiv] = useState(kuer ? !!kuer.is_active : true)
  const [loeschen, setLoeschen] = useState(false)
  const [waehlen, setWaehlen] = useState(false)

  const warWettkampf = useMemo(
    () => !!kuer && wettkampfKuerJeGeraet(data.gymRoutines).get(kuer.apparatus)?.id === kuer.id,
    [kuer, data.gymRoutines],
  )
  const [wettkampf, setWettkampf] = useState(warWettkampf)

  /** Die Reihenfolge liegt im Arbeitsspeicher und wird einmal geschrieben. */
  const [liste, setListe] = useState<KuerWunsch[]>(() =>
    kuer
      ? kuerElemente(kuer.id, data.gymRoutineElements, data.gymElements)
        .map((e) => ({ id: e.eintrag.id, elementId: e.eintrag.element_id, note: e.eintrag.note }))
      : [])

  const elementVon = useMemo(() => {
    const map = new Map<string, GymElement>()
    for (const e of data.gymElements) map.set(e.id, e)
    return map
  }, [data.gymElements])

  // Die Anzeige rechnet auf der Liste im Arbeitsspeicher, nicht auf der
  // Datenbank: Sonst spränge die Summe erst nach dem Speichern um.
  const eintraege = useMemo(() => liste.map((w, i) => ({
    eintrag: { id: w.id ?? `neu-${i}`, routine_id: kuer?.id ?? '', element_id: w.elementId, position: i, note: w.note ?? null } as any,
    element: elementVon.get(w.elementId) ?? null,
    platz: i + 1,
  })), [liste, elementVon, kuer])

  const summe = useMemo(() => schwierigkeit(eintraege), [eintraege])
  const stellen = useMemo(() => problemstellen(eintraege, bilder), [eintraege, bilder])
  const hinweise = useMemo(() => problemZusammenfassung(stellen), [stellen])
  const stelleJePlatz = useMemo(() => {
    const map = new Map<number, Problemstelle>()
    for (const s of stellen) map.set(s.platz, s)
    return map
  }, [stellen])

  const fremdeGeraete = eintraege.filter(
    (e) => e.element && e.element.apparatus !== apparatus).length

  const speichern = () => {
    if (!name.trim()) return
    m.batch(() => {
      const werte = {
        apparatus, name: name.trim(),
        note: notiz.trim() || null,
        is_active: aktiv ? 1 : 0,
      }

      // Der Zeitpunkt wird NUR angefasst, wenn sich die Markierung wirklich
      // geaendert hat. Ihn bei jedem Speichern neu zu setzen hiesse, die
      // Wettkampfkuer jedes Mal neu zu erklaeren - und damit eine auf einem
      // anderen Geraet getroffene, spaetere Entscheidung zu ueberschreiben.
      const zeitpunkt = wettkampf && !warWettkampf ? { competition_since: nowIso() } : {}

      const id = kuer
        ? (m.patch('gym_routines', kuer.id, { ...werte, ...zeitpunkt }), kuer.id)
        : m.create('gym_routines', { ...werte, competition_since: wettkampf ? nowIso() : null })

      // Wettkampfkuer aufheben: Alle Zeitpunkte des Geraets fallen weg. Nur
      // den eigenen zu loeschen liesse die naechstaeltere Kuer nachruecken.
      if (!wettkampf && warWettkampf) {
        for (const anderes of zuLoeschendeZeitpunkte(data.gymRoutines, apparatus)) {
          m.patch('gym_routines', anderes, { competition_since: null })
        }
      }

      const plan = planeKuerElemente(id, liste, data.gymRoutineElements)
      if (!planIstLeer(plan)) {
        for (const a of plan.anlegen) m.create('gym_routine_elements', a.values)
        for (const a of plan.aendern) m.patch('gym_routine_elements', a.id, a.patch)
        for (const weg of plan.entfernen) m.removeQuiet('gym_routine_elements', weg)
      }
    })
    m.toast(kuer ? 'Kür gespeichert' : 'Kür angelegt')
    onClose()
  }

  const entferne = (i: number) => setListe(liste.filter((_, j) => j !== i))
  const schiebe = (i: number, richtung: -1 | 1) => setListe(verschiebe(liste, i, richtung))

  const geraetElemente = data.gymElements.filter(
    (e) => !e.deleted_at && e.is_active && e.apparatus === apparatus)

  return (
    <>
      <Modal open wide title={kuer ? 'Kür bearbeiten' : 'Neue Kür'} onClose={onClose}
        footer={<>
          {kuer && <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={speichern} disabled={!name.trim()}>Speichern</button>
        </>}>

        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Wettkampfkür 2026" autoFocus />
        </Field>

        <Field label="Gerät">
          <div className="turn-geraete">
            {GERAETE.map((g) => (
              <button key={g.key} type="button"
                className={`turn-geraet${apparatus === g.key ? ' aktiv' : ''}`}
                onClick={() => setApparatus(g.key)}>
                <span className="turn-geraet-kurz">{g.kurz}</span>
                <span className="turn-geraet-name">{g.name}</span>
              </button>
            ))}
          </div>
        </Field>

        {fremdeGeraete > 0 && (
          <div className="hint-box small">
            {fremdeGeraete === 1
              ? 'Ein Element dieser Kür gehört zu einem anderen Gerät.'
              : `${fremdeGeraete} Elemente dieser Kür gehören zu einem anderen Gerät.`}
            {' '}Sie bleiben stehen – entfernt wird nichts von selbst.
          </div>
        )}

        <div className="row">
          <label className="row small">
            <input type="checkbox" checked={wettkampf}
              onChange={(e) => setWettkampf(e.target.checked)} /> Aktive Wettkampfkür
          </label>
          <label className="row small">
            <input type="checkbox" checked={aktiv}
              onChange={(e) => setAktiv(e.target.checked)} /> Aktiv
          </label>
        </div>
        {wettkampf && !warWettkampf && (
          <div className="muted small mb12">
            Eine bisher als Wettkampfkür markierte Kür an {geraetName(apparatus)} gilt
            danach als Variante. Es gibt je Gerät nur eine.
          </div>
        )}

        {/* ------------------------------------------------ Elementfolge */}
        <div className="kuer-kopf">
          <span className="kuer-kopf-titel">
            {eintraege.length === 1 ? '1 Element' : `${eintraege.length} Elemente`}
          </span>
          <span className="kuer-kopf-wert" title="Summe der eingetragenen Elementwerte – kein D-Wert">
            Schwierigkeitssumme der Elemente: {schwierigkeitText(summe)}
          </span>
        </div>

        {summe.buchstaben.length > 0 && (
          <div className="chips mb12">
            {summe.buchstaben.map((b) => (
              <span key={b.buchstabe} className="chip sm">{b.buchstabe} × {b.anzahl}</span>
            ))}
          </div>
        )}

        {hinweise.length > 0 && (
          <div className="hint-box small">
            {hinweise.join(' · ')}
            <div className="muted mt8">
              Nur eine Beobachtung aus deinen Trainingsdaten – kein Vorschlag, was zu tun ist.
            </div>
          </div>
        )}

        {eintraege.length === 0 ? (
          <Empty kompakt title="Noch kein Element in dieser Kür"
            hint="Füge die Elemente in der Reihenfolge hinzu, in der du sie turnst." />
        ) : (
          <div className="kuer-liste">
            {eintraege.map((e, i) => {
              const stelle = stelleJePlatz.get(e.platz)
              const wert = schwierigkeitKurz(e.element)
              return (
                <div key={e.eintrag.id} className={`kuer-zeile${e.element ? '' : ' fehlt'}`}>
                  <span className="kuer-platz">{e.platz}</span>
                  <span className="kuer-mitte">
                    <span className="kuer-name">
                      {/* Der Name steht in einer eigenen Hülle, damit sich
                          Name und Schwierigkeit getrennt auslesen lassen –
                          sonst liest jede Prüfung „DoppelsaltoD 0,4". */}
                      <span className="kuer-name-text">
                        {e.element ? e.element.name : 'Gelöschtes Element'}
                      </span>
                      {wert && <span className="turn-wert">{wert}</span>}
                    </span>
                    <span className="kuer-meta">
                      {e.element?.element_group ? `Gruppe ${e.element.element_group} · ` : ''}
                      {e.element?.is_dismount ? 'Abgang · ' : ''}
                      {e.element ? statusDef(e.element.status).label : 'nicht mehr im Katalog'}
                      {stelle && stelle.art === 'langeHer' && ` · ${stelle.text}`}
                    </span>
                  </span>
                  <span className="kuer-knoepfe">
                    <button type="button" className="kuer-knopf" aria-label="nach oben"
                      disabled={i === 0} onClick={() => schiebe(i, -1)}>↑</button>
                    <button type="button" className="kuer-knopf" aria-label="nach unten"
                      disabled={i === eintraege.length - 1} onClick={() => schiebe(i, 1)}>↓</button>
                    <button type="button" className="kuer-knopf weg" aria-label="entfernen"
                      onClick={() => entferne(i)}>✕</button>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="row mt12">
          <button className="btn btn-primary" onClick={() => setWaehlen(true)}>+ Element</button>
          {geraetElemente.length === 0 && (
            <span className="muted small">
              An {geraetName(apparatus)} ist noch kein Element angelegt.
            </span>
          )}
        </div>

        <Field label="Notiz">
          <textarea className="textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)}
            placeholder="z. B. Abgang noch offen, Anschluss nach dem Rondat übt sich schwer" />
        </Field>
      </Modal>

      {waehlen && (
        <ElementWaehler apparatus={apparatus} bilder={bilder}
          onWaehlen={(id) => setListe((l) => [...l, { id: null, elementId: id }])}
          onZuElementen={() => { setWaehlen(false); onClose(); onZuElementen() }}
          onClose={() => setWaehlen(false)} />
      )}

      <Confirm open={loeschen} title="Kür löschen?"
        message="Sie wandert in den Papierkorb. Die Elemente selbst bleiben unberührt – gelöscht wird nur die Zusammenstellung. Zum Aufheben genügt „Aktiv“ abzuschalten."
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => {
          m.batch(() => {
            for (const v of data.gymRoutineElements) {
              if (!v.deleted_at && v.routine_id === kuer!.id) m.removeQuiet('gym_routine_elements', v.id)
            }
            m.remove('gym_routines', kuer!.id, 'Kür gelöscht')
          })
          setLoeschen(false)
          onClose()
        }} />
    </>
  )
}

/* ====================================================== Element wählen */

/**
 * Elemente des Geräts zur Auswahl – mit Suche, Status und Schwierigkeit.
 *
 * Nur Elemente DIESES Geräts: Eine Bodenkür mit einer Reckstange darin wäre
 * ein Tippfehler, den niemand bemerkt. Wer ein Element eines anderen Geräts
 * braucht, stellt das Gerät der Kür um.
 *
 * Fehlt ein Element noch ganz, führt ein Knopf in den Elementkatalog. Ein
 * zweites Anlegeformular hier wäre dasselbe Formular ein zweites Mal – und
 * damit die Stelle, an der die beiden Fassungen auseinanderlaufen.
 */
function ElementWaehler({ apparatus, bilder, onWaehlen, onZuElementen, onClose }: {
  apparatus: GeraetKey
  bilder: Map<string, ElementBild>
  onWaehlen: (id: string) => void
  onZuElementen: () => void
  onClose: () => void
}) {
  const data = useData()
  const [suche, setSuche] = useState('')
  // Der Waehler bleibt nach einer Aufnahme offen: Fuenf Elemente
  // hintereinander aufzunehmen soll fuenf Beruehrungen kosten und nicht
  // fuenfzehn. Der Zaehler im Fuss sagt, was dabei herausgekommen ist.
  const [aufgenommen, setAufgenommen] = useState(0)

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase()
    return data.gymElements
      .filter((e) => !e.deleted_at && e.is_active && e.apparatus === apparatus)
      .filter((e) => !q || e.name.toLowerCase().includes(q)
        || (e.difficulty_letter ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data.gymElements, apparatus, suche])

  return (
    <Modal open title={`Element hinzufügen · ${geraetName(apparatus)}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onZuElementen}>Zum Elementkatalog</button>
        <span style={{ flex: 1 }} />
        {aufgenommen > 0 && (
          <span className="muted small">
            {aufgenommen === 1 ? '1 Element aufgenommen' : `${aufgenommen} Elemente aufgenommen`}
          </span>
        )}
        <button className="btn btn-primary" onClick={onClose}>Fertig</button>
      </>}>

      <Field>
        <input className="input" value={suche} onChange={(e) => setSuche(e.target.value)}
          placeholder="Suchen…" autoFocus />
      </Field>

      {treffer.length === 0 ? (
        <Empty kompakt
          title={suche.trim() ? 'Kein Element passt zur Suche' : `Noch kein Element an ${geraetName(apparatus)}`}
          hint="Elemente werden im Katalog angelegt – dort stehen Schwierigkeit, Gruppe und Status."
          action={<button className="btn btn-primary btn-sm" onClick={onZuElementen}>Zum Elementkatalog</button>} />
      ) : (
        <div className="list">
          {treffer.map((e) => {
            const bild = bilder.get(e.id)
            const wert = schwierigkeitKurz(e)
            return (
              <button key={e.id} className="list-row"
                onClick={() => { onWaehlen(e.id); setAufgenommen((n) => n + 1) }}>
                <span className="list-main">
                  <span className="list-title">
                    {e.name}
                    {wert && <span className="turn-wert">{wert}</span>}
                  </span>
                  <span className="list-sub">
                    {e.element_group ? `Gruppe ${e.element_group} · ` : ''}
                    {e.is_dismount ? 'Abgang · ' : ''}
                    {bild?.tageHer === null || bild?.tageHer === undefined
                      ? 'nie trainiert'
                      : bild.tageHer === 0 ? 'heute trainiert' : `vor ${bild.tageHer} Tagen`}
                  </span>
                </span>
                <StatusZeichen status={e.status} />
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
