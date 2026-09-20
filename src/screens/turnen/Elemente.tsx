/**
 * TURNEN · ELEMENTE – der Katalog.
 *
 * Anlegen, bearbeiten, archivieren, nach Gerät und Status filtern.
 *
 * Der Status gehört dem Turner. LifeHub rechnet aus den Versuchen einen
 * Vorschlag aus (core/turnen/sicherheit.ts) und zeigt ihn – aber nur, wenn er
 * vom gesetzten Status abweicht, und übernehmen muss man ihn selbst. Ein
 * automatisch überschriebener Status wäre eine Behauptung über etwas, das der
 * Turner besser weiss als jede Trefferquote.
 */
import React, { useMemo, useState } from 'react'
import { Card, Field, Modal, Chips, Empty, Confirm, StatusPill } from '../../ui/components'
import { useData, useMutations } from '../../state/store'
import { formatDay, todayString, diffDays } from '../../core/dates'
import { GERAETE, geraetName, type GeraetKey } from '../../core/turnen/geraete'
import { ELEMENT_STATUS, statusDef, type ElementStatus } from '../../core/turnen/status'
import { bloeckeMitTag, elementBild, type ElementBild } from '../../core/turnen/elemente'
import { vorschlagAbweichend } from '../../core/turnen/sicherheit'
import type { GymElement } from '../../core/types'

/**
 * Statusfarbe als vorhandenes Bauteil.
 *
 * `StatusPill` kennt nur die drei Ampeltoene. Fuer den neutralen Ton (Status
 * "neu") ist das schlichte `.pill` richtig - eine Ampel waere dort eine
 * Wertung, wo noch gar nichts bewertet wurde.
 */
function StatusZeichen({ status }: { status: string }) {
  const def = statusDef(status)
  if (def.ton === 'neutral') return <span className="pill">{def.label}</span>
  const ampel = def.ton === 'gut' ? 'green' : def.ton === 'warnung' ? 'amber' : 'red'
  return <StatusPill status={ampel}>{def.label}</StatusPill>
}

export function ElementeView({ geraetFilter }: { geraetFilter?: GeraetKey | null }) {
  const data = useData()
  const [geraet, setGeraet] = useState<GeraetKey | 'alle'>(geraetFilter ?? 'alle')
  const [zeigeArchiv, setZeigeArchiv] = useState(false)
  const [offen, setOffen] = useState<GymElement | 'neu' | null>(null)
  const heute = todayString()

  const bloecke = useMemo(
    () => bloeckeMitTag(data.gymAttempts, data.workoutSessions),
    [data.gymAttempts, data.workoutSessions],
  )

  const bilder = useMemo(() => {
    const roh = data.gymElements.filter((e) => !e.deleted_at && (zeigeArchiv || e.is_active))
    return roh
      .filter((e) => geraet === 'alle' || e.apparatus === geraet)
      .map((e) => elementBild(e, bloecke, heute, diffDays))
      .sort((a, b) => {
        const g = GERAETE.findIndex((x) => x.key === a.element.apparatus)
          - GERAETE.findIndex((x) => x.key === b.element.apparatus)
        return g !== 0 ? g : a.element.name.localeCompare(b.element.name)
      })
  }, [data.gymElements, bloecke, geraet, zeigeArchiv, heute])

  const archiviert = data.gymElements.filter((e) => !e.deleted_at && !e.is_active).length

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
          <button className="btn btn-primary" onClick={() => setOffen('neu')}>+ Element</button>
          <span style={{ flex: 1 }} />
          {archiviert > 0 && (
            <button className={`chip sm${zeigeArchiv ? ' active' : ''}`} onClick={() => setZeigeArchiv(!zeigeArchiv)}>
              Archiv ({archiviert})
            </button>
          )}
        </div>
      </Card>

      {bilder.length === 0 ? (
        <Empty title="Noch keine Elemente"
          hint="Lege die Elemente an, die du turnst – erst dann kann LifeHub sagen, was zu lange her ist."
          action={<button className="btn btn-primary" onClick={() => setOffen('neu')}>+ Erstes Element</button>} />
      ) : (
        <Card className="pad0" title={`${bilder.length} Elemente`}>
          <div className="list">
            {bilder.map((b) => <ElementZeile key={b.element.id} bild={b} onOpen={() => setOffen(b.element)} />)}
          </div>
        </Card>
      )}

      {offen && (
        <ElementEditor element={offen === 'neu' ? null : offen}
          vorgabeGeraet={geraet === 'alle' ? 'boden' : geraet}
          onClose={() => setOffen(null)} />
      )}
    </>
  )
}

function ElementZeile({ bild, onOpen }: { bild: ElementBild; onOpen: () => void }) {
  const e = bild.element
  const zeigeVorschlag = vorschlagAbweichend(e.status, bild.vorschlag)
  return (
    <button className="list-row" onClick={onOpen}>
      <span className="list-main">
        <span className="list-title">
          {e.name}
          {!e.is_active && <span className="pill" style={{ marginLeft: 6 }}>archiviert</span>}
        </span>
        <span className="list-sub">
          {geraetName(e.apparatus)}
          {e.difficulty_letter ? ` · ${e.difficulty_letter}` : ''}
          {e.is_dismount ? ' · Abgang' : ''}
          {' · '}
          {bild.tageHer === null
            ? 'nie trainiert'
            : bild.tageHer === 0 ? 'heute trainiert' : `vor ${bild.tageHer} Tagen`}
          {bild.fenster.quote !== null && ` · ${Math.round(bild.fenster.quote * 100)} % gelungen`}
          {zeigeVorschlag && (
            <span className="pill warn" style={{ marginLeft: 6 }}>
              Vorschlag: {statusDef(bild.vorschlag.status!).label}
            </span>
          )}
        </span>
      </span>
      <StatusZeichen status={e.status} />
    </button>
  )
}

/* ------------------------------------------------------------- Editor */

function ElementEditor({ element, vorgabeGeraet, onClose }: {
  element: GymElement | null
  vorgabeGeraet: GeraetKey
  onClose: () => void
}) {
  const data = useData()
  const m = useMutations()
  const heute = todayString()

  const [name, setName] = useState(element?.name ?? '')
  const [apparatus, setApparatus] = useState<GeraetKey>((element?.apparatus as GeraetKey) ?? vorgabeGeraet)
  const [buchstabe, setBuchstabe] = useState(element?.difficulty_letter ?? '')
  const [wert, setWert] = useState(element?.difficulty_value?.toString() ?? '')
  const [gruppe, setGruppe] = useState(element?.element_group?.toString() ?? '')
  const [abgang, setAbgang] = useState(!!element?.is_dismount)
  const [halte, setHalte] = useState(!!element?.hold_element)
  const [status, setStatus] = useState<ElementStatus>((element?.status as ElementStatus) ?? 'neu')
  const [video, setVideo] = useState(element?.video_url ?? '')
  const [notiz, setNotiz] = useState(element?.note ?? '')
  const [aktiv, setAktiv] = useState(element ? !!element.is_active : true)
  const [loeschen, setLoeschen] = useState(false)

  const bild = useMemo(() => {
    if (!element) return null
    const bloecke = bloeckeMitTag(data.gymAttempts, data.workoutSessions)
    return elementBild(element, bloecke, heute, diffDays)
  }, [element, data.gymAttempts, data.workoutSessions, heute])

  const speichern = () => {
    if (!name.trim()) return
    // element_group ist INTEGER: PostgreSQL weist eine Kommazahl mit 22P02 ab
    // und damit die ganze Tabelle (siehe CLAUDE.md).
    const gruppeZahl = gruppe.trim() ? Math.round(Number(gruppe)) : null
    const wertZahl = wert.trim() ? Number(wert.replace(',', '.')) : null
    const werte = {
      apparatus, name: name.trim(),
      difficulty_letter: buchstabe.trim().toUpperCase() || null,
      difficulty_value: Number.isFinite(wertZahl as number) ? wertZahl : null,
      element_group: Number.isFinite(gruppeZahl as number) ? gruppeZahl : null,
      is_dismount: abgang ? 1 : 0,
      hold_element: halte ? 1 : 0,
      status,
      video_url: video.trim() || null,
      note: notiz.trim() || null,
      is_active: aktiv ? 1 : 0,
      sort_order: element?.sort_order ?? data.gymElements.length,
    }
    if (element) m.patch('gym_elements', element.id, werte, 'Element geändert')
    else m.create('gym_elements', werte, 'Element angelegt')
    onClose()
  }

  return (
    <Modal open title={element ? 'Element bearbeiten' : 'Neues Element'} onClose={onClose}
      footer={<>
        {element && <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn btn-primary" onClick={speichern} disabled={!name.trim()}>Speichern</button>
      </>}>

      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Tsukahara gestreckt" autoFocus />
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

      <div className="grid grid-3 keep2">
        <Field label="Schwierigkeit" hint="A…I">
          <input className="input" value={buchstabe} maxLength={2}
            onChange={(e) => setBuchstabe(e.target.value)} placeholder="C" />
        </Field>
        <Field label="Wert" hint="z. B. 0,3">
          <input className="input" inputMode="decimal" value={wert}
            onChange={(e) => setWert(e.target.value)} placeholder="0,3" />
        </Field>
        <Field label="Elementgruppe" hint="I…V">
          <input className="input" inputMode="numeric" value={gruppe}
            onChange={(e) => setGruppe(e.target.value)} placeholder="2" />
        </Field>
      </div>

      <Field label="Status" hint={statusDef(status).beschreibung}>
        <Chips value={status} onChange={(v) => setStatus(v as ElementStatus)}
          options={ELEMENT_STATUS.map((s) => ({ value: s.key, label: s.label }))} />
      </Field>

      {bild && vorschlagAbweichend(status, bild.vorschlag) && (
        <div className="hint-box small">
          <strong>Vorschlag: {statusDef(bild.vorschlag.status!).label}.</strong>{' '}
          {bild.vorschlag.grund}{' '}
          <button className="btn btn-sm" onClick={() => setStatus(bild.vorschlag.status!)}>
            Übernehmen
          </button>
          <div className="muted mt8">
            Ein Vorschlag aus den Trainingszahlen – dein Status bleibt, bis du ihn änderst.
          </div>
        </div>
      )}

      {bild && (
        <div className="kennzeilen">
          <div className="kennzeile">
            <span className="kennzeile-name">Zuletzt trainiert</span>
            <span className="kennzeile-wert">
              {bild.zuletzt ? `${formatDay(bild.zuletzt)} (vor ${bild.tageHer} Tagen)` : 'nie'}
            </span>
          </div>
          <div className="kennzeile">
            <span className="kennzeile-name">Einheiten</span>
            <span className="kennzeile-wert">{bild.einheiten}</span>
          </div>
          <div className="kennzeile">
            <span className="kennzeile-name">Versuche gesamt</span>
            <span className="kennzeile-wert">{bild.versucheGesamt}</span>
          </div>
        </div>
      )}

      <div className="row">
        <label className="row small">
          <input type="checkbox" checked={abgang} onChange={(e) => setAbgang(e.target.checked)} /> Abgang
        </label>
        <label className="row small">
          <input type="checkbox" checked={halte} onChange={(e) => setHalte(e.target.checked)} /> Haltekraftteil
        </label>
        <label className="row small">
          <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} /> Aktiv
        </label>
      </div>

      <Field label="Video" hint="Nur ein Verweis – Videodateien werden nicht synchronisiert.">
        <input className="input" value={video} onChange={(e) => setVideo(e.target.value)}
          placeholder="https://…" />
      </Field>

      <Field label="Notiz">
        <textarea className="textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)}
          placeholder="z. B. Absprung zu flach" />
      </Field>

      <Confirm open={loeschen} title="Element löschen?"
        message="Es wandert in den Papierkorb. Die festgehaltenen Versuche bleiben erhalten, zählen aber nicht mehr zu diesem Element. Zum Ausblenden genügt „Aktiv“ abzuschalten."
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => { m.remove('gym_elements', element!.id, 'Element gelöscht'); setLoeschen(false); onClose() }} />
    </Modal>
  )
}
