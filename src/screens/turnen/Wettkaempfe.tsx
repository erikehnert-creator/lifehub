/**
 * TURNEN · WETTKÄMPFE – was geturnt wurde, und womit.
 *
 * ---------------------------------------------------------------------------
 * Die Übung von damals bleibt die Übung von damals
 *
 * Wählt Erik beim Erfassen eine Kür aus, wird ihr Zustand in genau diesem
 * Moment als eigene, unveränderliche Fassung festgehalten
 * (`core/turnen/fassungen.ts`). Das Ergebnis zeigt danach auf die Fassung und
 * nie auf die lebende Kür. Ändert er die Kür im Dezember, bleibt der
 * Oktober-Wettkampf Zeichen für Zeichen derselbe – auch dann, wenn Elemente
 * umbenannt, archiviert oder gelöscht werden.
 *
 * ---------------------------------------------------------------------------
 * Es wird nichts gerechnet
 *
 * D-Wert, E-Wert, Neutralabzüge und Endnote werden abgeschrieben, wie sie auf
 * dem Protokoll stehen. LifeHub behauptet nirgends, dass D + E − Abzug die
 * Endnote ergibt; die Gegenüberstellung unter den Feldern ist ein Hinweis
 * ohne Urteil und hält niemanden vom Speichern ab. Fehlende Noten bleiben
 * leer und erscheinen als „—", nie als 0.
 */
import React, { useMemo, useState } from 'react'
import { Card, Field, Modal, Empty, Confirm, Collapsible, StatusPill } from '../../ui/components'
import { LineChart, ChartFrame } from '../../charts'
import { useData, useMutations } from '../../state/store'
import { todayString, formatDay, nowIso } from '../../core/dates'
import { GERAETE, geraetName, type GeraetKey } from '../../core/turnen/geraete'
import { schwierigkeitAus, schwierigkeitText } from '../../core/turnen/kueren'
import {
  fassungsInhalt, planeFassung, fassungsPlaetze, fassungIstAktuell,
} from '../../core/turnen/fassungen'
import {
  formatNote, leereEingabe, eingabeAus, eingabeIstLeer,
  planeErgebnisse, planIstLeer, plausibilitaet,
  wettkampfBild, verlauf, geraetBilanzen, naechsterUndLetzter,
  NOTEN_ARTEN, MINDESTPUNKTE_LINIE,
  type ErgebnisEingabe, type NotenArt,
} from '../../core/turnen/wettkampf'
import type { GymCompetition, GymResult, GymRoutineVersion } from '../../core/types'

/* ============================================================ Übersicht */

export function WettkaempfeView({ onZuKueren }: { onZuKueren: () => void }) {
  const data = useData()
  const heute = todayString()
  const [offen, setOffen] = useState<GymCompetition | null>(null)
  const [neu, setNeu] = useState(false)

  const wettkaempfe = useMemo(
    () => data.gymCompetitions
      .filter((w) => !w.deleted_at)
      .sort((a, b) => (a.day > b.day ? -1 : a.day < b.day ? 1 : a.name.localeCompare(b.name))),
    [data.gymCompetitions],
  )

  const { naechster, letzter } = useMemo(
    () => naechsterUndLetzter(data.gymCompetitions, heute),
    [data.gymCompetitions, heute],
  )

  const bilder = useMemo(
    () => wettkaempfe.map((w) => wettkampfBild(w, data.gymResults)),
    [wettkaempfe, data.gymResults],
  )

  return (
    <>
      <Card className="mb16">
        <div className="row">
          <button className="btn btn-primary" onClick={() => setNeu(true)}>+ Wettkampf</button>
        </div>
        {(naechster || letzter) && (
          <div className="kennzeilen mt12">
            {naechster && (
              <div className="kennzeile">
                <span className="kennzeile-name">Nächster</span>
                <span className="kennzeile-wert">
                  {naechster.name} · {formatDay(naechster.day)}
                </span>
              </div>
            )}
            {letzter && (
              <div className="kennzeile">
                <span className="kennzeile-name">Zuletzt</span>
                <span className="kennzeile-wert">
                  {letzter.name} · {formatDay(letzter.day)}
                </span>
              </div>
            )}
          </div>
        )}
      </Card>

      {bilder.length === 0 ? (
        <Empty kompakt title="Noch kein Wettkampf"
          hint="Trage die Werte ein, wie sie auf dem Protokoll stehen – gerechnet wird nichts."
          action={<button className="btn btn-primary btn-sm" onClick={() => setNeu(true)}>+ Erster Wettkampf</button>} />
      ) : (
        <Card className="pad0 mb16" title={`${bilder.length} Wettkämpfe`}>
          <div className="list">
            {bilder.map((b) => (
              <button key={b.wettkampf.id} className="list-row" onClick={() => setOffen(b.wettkampf)}>
                <span className="list-main">
                  <span className="list-title">{b.wettkampf.name}</span>
                  <span className="list-sub">
                    {formatDay(b.wettkampf.day)}
                    {b.wettkampf.location ? ` · ${b.wettkampf.location}` : ''}
                    {' · '}
                    {b.ergebnisse.length === 1 ? '1 Gerät' : `${b.ergebnisse.length} Geräte`}
                    {b.wettkampf.score_allround !== null && b.wettkampf.score_allround !== undefined
                      && ` · Mehrkampf ${formatNote(b.wettkampf.score_allround)}`}
                  </span>
                </span>
                {b.wettkampf.day >= heute
                  ? <span className="pill">geplant</span>
                  : b.wettkampf.rank_allround
                    ? <span className="pill">Platz {b.wettkampf.rank_allround}</span>
                    : null}
              </button>
            ))}
          </div>
        </Card>
      )}

      <AuswertungBlock />

      {offen && (
        <WettkampfDetail wettkampf={offen} onZuKueren={onZuKueren}
          onClose={() => setOffen(null)} />
      )}
      {neu && (
        <WettkampfEditor wettkampf={null} onZuKueren={onZuKueren} onClose={() => setNeu(false)} />
      )}
    </>
  )
}

/* =============================================================== Detail */

function WettkampfDetail({ wettkampf, onZuKueren, onClose }: {
  wettkampf: GymCompetition
  onZuKueren: () => void
  onClose: () => void
}) {
  const data = useData()
  const m = useMutations()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [loeschen, setLoeschen] = useState(false)
  const [fassung, setFassung] = useState<GymRoutineVersion | null>(null)

  const bild = useMemo(
    () => wettkampfBild(wettkampf, data.gymResults),
    [wettkampf, data.gymResults],
  )

  const versionVon = useMemo(() => {
    const map = new Map<string, GymRoutineVersion>()
    for (const v of data.gymRoutineVersions) map.set(v.id, v)
    return map
  }, [data.gymRoutineVersions])

  if (bearbeiten) {
    return (
      <WettkampfEditor wettkampf={wettkampf}
        onZuKueren={() => { setBearbeiten(false); onClose(); onZuKueren() }}
        onClose={() => setBearbeiten(false)} />
    )
  }

  return (
    <>
      <Modal open wide title={wettkampf.name} onClose={onClose}
        footer={<>
          <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
          <button className="btn btn-primary" onClick={() => setBearbeiten(true)}>Bearbeiten</button>
        </>}>

        <div className="kennzeilen mb12">
          <div className="kennzeile">
            <span className="kennzeile-name">Datum</span>
            <span className="kennzeile-wert">{formatDay(wettkampf.day, 'long')}</span>
          </div>
          {wettkampf.location && (
            <div className="kennzeile">
              <span className="kennzeile-name">Ort</span>
              <span className="kennzeile-wert">{wettkampf.location}</span>
            </div>
          )}
          {wettkampf.class_name && (
            <div className="kennzeile">
              <span className="kennzeile-name">Klasse</span>
              <span className="kennzeile-wert">{wettkampf.class_name}</span>
            </div>
          )}
          {(wettkampf.score_allround !== null && wettkampf.score_allround !== undefined) && (
            <div className="kennzeile">
              <span className="kennzeile-name">Mehrkampf</span>
              <span className="kennzeile-wert">
                {formatNote(wettkampf.score_allround)}
                {wettkampf.rank_allround ? ` · Platz ${wettkampf.rank_allround}` : ''}
              </span>
            </div>
          )}
          {(wettkampf.score_allround === null || wettkampf.score_allround === undefined)
            && !!wettkampf.rank_allround && (
            <div className="kennzeile">
              <span className="kennzeile-name">Mehrkampf</span>
              <span className="kennzeile-wert">Platz {wettkampf.rank_allround}</span>
            </div>
          )}
        </div>

        {wettkampf.note && <div className="hint-box small mb12">{wettkampf.note}</div>}

        {bild.ergebnisse.length === 0 ? (
          <Empty kompakt title="Noch kein Ergebnis eingetragen"
            hint="Über Bearbeiten kommen die Geräte dazu, an denen du gestartet bist." />
        ) : (
          <div className="wk-liste">
            {bild.ergebnisse.map((r) => (
              <ErgebnisKarte key={r.id} ergebnis={r} bild={bild}
                version={r.routine_version_id ? versionVon.get(r.routine_version_id) ?? null : null}
                onFassung={setFassung} />
            ))}
          </div>
        )}

        {wettkampf.protocol_url && (
          <div className="mt12">
            <a className="btn btn-sm" href={wettkampf.protocol_url} target="_blank" rel="noreferrer">
              Protokoll öffnen
            </a>
            <div className="muted small mt8">
              Ein Verweis, keine Datei – Anhänge werden in LifeHub als Base64 mitsynchronisiert
              und sind für Protokolle ungeeignet.
            </div>
          </div>
        )}
      </Modal>

      {fassung && <FassungAnsicht version={fassung} onClose={() => setFassung(null)} />}

      <Confirm open={loeschen} title="Wettkampf löschen?"
        message="Der Wettkampf und seine Geräteergebnisse wandern in den Papierkorb. Die festgehaltenen Kürfassungen bleiben erhalten – sie gehören zur Geschichte und nicht zu diesem einen Eintrag."
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => {
          m.batch(() => {
            for (const r of data.gymResults) {
              if (!r.deleted_at && r.competition_id === wettkampf.id) {
                m.removeQuiet('gym_results', r.id)
              }
            }
            m.remove('gym_competitions', wettkampf.id, 'Wettkampf gelöscht')
          })
          setLoeschen(false)
          onClose()
        }} />
    </>
  )
}

/**
 * Ein Geräteergebnis als kompakte Karte.
 *
 * Die Marken „beste"/„niedrigste Note" erscheinen erst ab drei Geräten mit
 * Endnote (`MINDEST_GERAETE_FUER_MARKE`). Bei zweien wäre das keine Auskunft,
 * sondern eine Umschreibung von „zwei Zahlen".
 *
 * Verglichen wird ausdrücklich nur INNERHALB dieses Wettkampfs. Eine Boden-
 * und eine Pauschenpferdnote zu einer Gesamtkennzahl zu verrechnen hiesse,
 * eine Wertung zu erfinden – das passiert hier nirgends.
 */
function ErgebnisKarte({ ergebnis, bild, version, onFassung }: {
  ergebnis: GymResult
  bild: ReturnType<typeof wettkampfBild>
  version: GymRoutineVersion | null
  onFassung: (v: GymRoutineVersion) => void
}) {
  const f = ergebnis.final_score
  const hatNote = typeof f === 'number' && Number.isFinite(f)
  const beste = hatNote && bild.beste !== null && f === bild.beste
  const schwach = hatNote && bild.schwaechste !== null && f === bild.schwaechste

  return (
    <div className="wk-karte">
      <div className="wk-karte-kopf">
        <span className="wk-geraet">{geraetName(ergebnis.apparatus)}</span>
        {beste && !schwach && <span className="pill good">beste Note</span>}
        {schwach && !beste && <span className="pill warn">niedrigste Note</span>}
        <span style={{ flex: 1 }} />
        {!!ergebnis.rank_apparatus && <span className="pill">Platz {ergebnis.rank_apparatus}</span>}
      </div>

      <div className="wk-noten">
        <span className="wk-note"><span className="wk-note-name">D</span>
          <span className="wk-note-wert">{formatNote(ergebnis.d_score)}</span></span>
        <span className="wk-note"><span className="wk-note-name">E</span>
          <span className="wk-note-wert">{formatNote(ergebnis.e_score)}</span></span>
        {ergebnis.penalty !== null && ergebnis.penalty !== undefined && (
          <span className="wk-note"><span className="wk-note-name">Abzug</span>
            <span className="wk-note-wert">{formatNote(ergebnis.penalty)}</span></span>
        )}
        <span className="wk-note stark"><span className="wk-note-name">Endnote</span>
          <span className="wk-note-wert">{formatNote(ergebnis.final_score)}</span></span>
      </div>

      <div className="wk-karte-fuss">
        {version ? (
          <button className="btn btn-sm" onClick={() => onFassung(version)}>
            {version.name} · Fassung vom {formatDay(String(version.frozen_at).slice(0, 10))}
          </button>
        ) : (
          <span className="muted small">keine Kür hinterlegt</span>
        )}
      </div>

      {ergebnis.note && <div className="wk-karte-notiz">{ergebnis.note}</div>}
    </div>
  )
}

/* ================================================== Historische Fassung */

/**
 * Die Übung, wie sie damals geturnt wurde.
 *
 * Alles hier kommt aus `gym_routine_version_elements` – einer Kopie, die beim
 * Einfrieren entstanden ist. Der heutige Elementkatalog wird nicht befragt:
 * Genau das ist der Punkt.
 */
function FassungAnsicht({ version, onClose }: {
  version: GymRoutineVersion
  onClose: () => void
}) {
  const data = useData()
  const plaetze = useMemo(
    () => fassungsPlaetze(version.id, data.gymRoutineVersionElements),
    [version.id, data.gymRoutineVersionElements],
  )
  const summe = useMemo(() => schwierigkeitAus(plaetze), [plaetze])

  const aktuell = useMemo(() => {
    const kuer = data.gymRoutines.find((k) => k.id === version.routine_id) ?? null
    return fassungIstAktuell(version, kuer, data.gymRoutineElements, data.gymElements)
  }, [version, data.gymRoutines, data.gymRoutineElements, data.gymElements])

  return (
    <Modal open title={version.name} onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Schließen</button></>}>

      <div className="kennzeilen mb12">
        <div className="kennzeile">
          <span className="kennzeile-name">Gerät</span>
          <span className="kennzeile-wert">{geraetName(version.apparatus)}</span>
        </div>
        <div className="kennzeile">
          <span className="kennzeile-name">Fassung vom</span>
          <span className="kennzeile-wert">{formatDay(String(version.frozen_at).slice(0, 10))}</span>
        </div>
        <div className="kennzeile">
          <span className="kennzeile-name">Schwierigkeitssumme der Elemente</span>
          <span className="kennzeile-wert">{schwierigkeitText(summe)}</span>
        </div>
      </div>

      {!aktuell && (
        <div className="hint-box small">
          Die Kür wurde seitdem geändert oder gelöscht. Was hier steht, ist der
          festgehaltene Stand von damals und ändert sich nicht mehr.
        </div>
      )}

      {plaetze.length === 0 ? (
        <Empty kompakt title="Diese Fassung hat keine Elemente" />
      ) : (
        <div className="kuer-liste">
          {plaetze.map((p, i) => (
            <div key={p.id} className="kuer-zeile">
              <span className="kuer-platz">{i + 1}</span>
              <span className="kuer-mitte">
                <span className="kuer-name">
                  <span className="kuer-name-text">{p.name}</span>
                  {(p.difficulty_letter || p.difficulty_value !== null) && (
                    <span className="turn-wert">
                      {[p.difficulty_letter ?? '',
                        p.difficulty_value !== null && p.difficulty_value !== undefined
                          ? formatNote(p.difficulty_value) : ''].filter(Boolean).join(' ')}
                    </span>
                  )}
                </span>
                <span className="kuer-meta">
                  {p.element_group ? `Gruppe ${p.element_group}` : 'ohne Gruppe'}
                  {p.is_dismount ? ' · Abgang' : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/* =============================================================== Editor */

function WettkampfEditor({ wettkampf, onZuKueren, onClose }: {
  wettkampf: GymCompetition | null
  onZuKueren: () => void
  onClose: () => void
}) {
  const data = useData()
  const m = useMutations()

  const [name, setName] = useState(wettkampf?.name ?? '')
  const [tag, setTag] = useState(wettkampf?.day ?? todayString())
  const [ort, setOrt] = useState(wettkampf?.location ?? '')
  const [klasse, setKlasse] = useState(wettkampf?.class_name ?? '')
  const [mkNote, setMkNote] = useState(
    wettkampf?.score_allround !== null && wettkampf?.score_allround !== undefined
      ? formatNote(wettkampf.score_allround) : '')
  const [mkPlatz, setMkPlatz] = useState(
    wettkampf?.rank_allround ? String(wettkampf.rank_allround) : '')
  const [protokoll, setProtokoll] = useState(wettkampf?.protocol_url ?? '')
  const [notiz, setNotiz] = useState(wettkampf?.note ?? '')
  const [loeschen, setLoeschen] = useState(false)
  const [kuerFuer, setKuerFuer] = useState<string | null>(null)

  const vorhandene = useMemo(
    () => data.gymResults.filter((r) => !r.deleted_at && wettkampf && r.competition_id === wettkampf.id),
    [data.gymResults, wettkampf],
  )

  const [eingaben, setEingaben] = useState<ErgebnisEingabe[]>(() =>
    vorhandene
      .slice()
      .sort((a, b) => GERAETE.findIndex((g) => g.key === a.apparatus)
        - GERAETE.findIndex((g) => g.key === b.apparatus))
      .map(eingabeAus))

  const aktiveGeraete = new Set(eingaben.map((e) => e.apparatus))

  const setzeFeld = (apparatus: string, feld: keyof ErgebnisEingabe, wert: any) =>
    setEingaben((liste) => liste.map((e) => (e.apparatus === apparatus ? { ...e, [feld]: wert } : e)))

  const umschalten = (key: GeraetKey) => {
    setEingaben((liste) => {
      const da = liste.find((e) => e.apparatus === key)
      if (da) {
        // Ein Geraet mit eingetragenen Werten verschwindet nicht auf einen
        // Fehlgriff hin - erst leeren, dann abwaehlen.
        if (!eingabeIstLeer(da)) return liste
        return liste.filter((e) => e.apparatus !== key)
      }
      return [...liste, leereEingabe(key)].sort(
        (a, b) => GERAETE.findIndex((g) => g.key === a.apparatus)
          - GERAETE.findIndex((g) => g.key === b.apparatus))
    })
  }

  const versionVon = useMemo(() => {
    const map = new Map<string, GymRoutineVersion>()
    for (const v of data.gymRoutineVersions) map.set(v.id, v)
    return map
  }, [data.gymRoutineVersions])

  const speichern = () => {
    if (!name.trim()) return
    m.batch(() => {
      const werte = {
        day: tag,
        name: name.trim(),
        location: ort.trim() || null,
        class_name: klasse.trim() || null,
        score_allround: mkNote.trim() ? Number(mkNote.replace(',', '.')) : null,
        rank_allround: mkPlatz.trim() ? Math.round(Number(mkPlatz.replace(',', '.'))) : null,
        protocol_url: protokoll.trim() || null,
        note: notiz.trim() || null,
      }
      // Number('') waere 0 - deshalb oben der Umweg ueber trim(). Bleibt
      // trotzdem etwas Unlesbares stehen, lieber leer als eine erfundene Zahl.
      if (!Number.isFinite(werte.score_allround as number)) werte.score_allround = null
      if (!Number.isFinite(werte.rank_allround as number)) werte.rank_allround = null

      const id = wettkampf
        ? (m.patch('gym_competitions', wettkampf.id, werte), wettkampf.id)
        : m.create('gym_competitions', werte)

      // Ausgewaehlte Kueren einfrieren, BEVOR die Ergebnisse geschrieben
      // werden: Das Ergebnis zeigt auf die Fassung, nicht umgekehrt.
      const jetzt = nowIso()
      const fertig: ErgebnisEingabe[] = eingaben.map((e) => {
        if (!e.routineId) return e
        const kuer = data.gymRoutines.find((k) => k.id === e.routineId)
        if (!kuer) return e
        const plan = planeFassung(
          fassungsInhalt(kuer, data.gymRoutineElements, data.gymElements),
          data.gymRoutineVersions, jetzt)
        if (plan.version) {
          m.create('gym_routine_versions', { id: plan.version.id, ...plan.version.values })
          for (const p of plan.plaetze) {
            m.create('gym_routine_version_elements', { id: p.id, ...p.values })
          }
        }
        return { ...e, versionId: plan.id, routineId: null }
      })

      const plan = planeErgebnisse(id, fertig, data.gymResults)
      if (!planIstLeer(plan)) {
        for (const a of plan.anlegen) m.create('gym_results', { id: a.id, ...a.values })
        for (const a of plan.aendern) m.patch('gym_results', a.id, a.patch)
        for (const weg of plan.entfernen) m.removeQuiet('gym_results', weg)
      }
    })
    m.toast(wettkampf ? 'Wettkampf gespeichert' : 'Wettkampf angelegt')
    onClose()
  }

  return (
    <>
      <Modal open wide title={wettkampf ? 'Wettkampf bearbeiten' : 'Neuer Wettkampf'} onClose={onClose}
        footer={<>
          {wettkampf && <button className="btn btn-danger" onClick={() => setLoeschen(true)}>Löschen</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={speichern} disabled={!name.trim()}>Speichern</button>
        </>}>

        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Bezirksmeisterschaft" autoFocus />
        </Field>

        <div className="grid grid-2 keep2">
          <Field label="Datum">
            <input className="input" type="date" value={tag} onChange={(e) => setTag(e.target.value)} />
          </Field>
          <Field label="Ort">
            <input className="input" value={ort} onChange={(e) => setOrt(e.target.value)}
              placeholder="optional" />
          </Field>
        </div>

        <div className="grid grid-3">
          <Field label="Klasse">
            <input className="input" value={klasse} onChange={(e) => setKlasse(e.target.value)}
              placeholder="optional" />
          </Field>
          <Field label="Mehrkampfnote" hint="abschreiben, nicht rechnen">
            <input className="input" inputMode="decimal" value={mkNote}
              onChange={(e) => setMkNote(e.target.value)} placeholder="—" />
          </Field>
          <Field label="Mehrkampfplatz">
            <input className="input" inputMode="numeric" value={mkPlatz}
              onChange={(e) => setMkPlatz(e.target.value)} placeholder="—" />
          </Field>
        </div>

        {/* ------------------------------------------------- Geräte wählen */}
        <Field label="Geräte" hint="Nur die, an denen du gestartet bist.">
          <div className="turn-geraete">
            {GERAETE.map((g) => (
              <button key={g.key} type="button"
                className={`turn-geraet${aktiveGeraete.has(g.key) ? ' aktiv' : ''}`}
                onClick={() => umschalten(g.key)}>
                <span className="turn-geraet-kurz">{g.kurz}</span>
                <span className="turn-geraet-name">{g.name}</span>
              </button>
            ))}
          </div>
        </Field>

        {eingaben.length === 0 ? (
          <Empty kompakt title="Noch kein Gerät gewählt"
            hint="Tippe oben die Geräte an, an denen du gestartet bist." />
        ) : (
          <div className="wk-liste">
            {eingaben.map((e) => (
              <ErgebnisFelder key={e.apparatus} eingabe={e}
                version={e.versionId ? versionVon.get(e.versionId) ?? null : null}
                onFeld={(feld, wert) => setzeFeld(e.apparatus, feld, wert)}
                onKuer={() => setKuerFuer(e.apparatus)} />
            ))}
          </div>
        )}

        <Field label="Protokoll" hint="Nur ein Verweis – Dateien werden nicht synchronisiert.">
          <input className="input" value={protokoll} onChange={(e) => setProtokoll(e.target.value)}
            placeholder="https://…" />
        </Field>

        <Field label="Notiz">
          <textarea className="textarea" value={notiz} onChange={(e) => setNotiz(e.target.value)}
            placeholder="z. B. Sturz am Reck, Halle sehr kalt" />
        </Field>
      </Modal>

      {kuerFuer && (
        <KuerWaehler apparatus={kuerFuer}
          onWaehlen={(routineId) => {
            setzeFeld(kuerFuer, 'routineId', routineId)
            setKuerFuer(null)
          }}
          onEntfernen={() => {
            setzeFeld(kuerFuer, 'routineId', null)
            setzeFeld(kuerFuer, 'versionId', null)
            setKuerFuer(null)
          }}
          onZuKueren={() => { setKuerFuer(null); onClose(); onZuKueren() }}
          onClose={() => setKuerFuer(null)} />
      )}

      <Confirm open={loeschen} title="Wettkampf löschen?"
        message="Der Wettkampf und seine Geräteergebnisse wandern in den Papierkorb. Die festgehaltenen Kürfassungen bleiben erhalten."
        danger onCancel={() => setLoeschen(false)}
        onConfirm={() => {
          m.batch(() => {
            for (const r of vorhandene) m.removeQuiet('gym_results', r.id)
            m.remove('gym_competitions', wettkampf!.id, 'Wettkampf gelöscht')
          })
          setLoeschen(false)
          onClose()
        }} />
    </>
  )
}

/** Die Notenfelder eines Geräts. */
function ErgebnisFelder({ eingabe, version, onFeld, onKuer }: {
  eingabe: ErgebnisEingabe
  version: GymRoutineVersion | null
  onFeld: (feld: keyof ErgebnisEingabe, wert: any) => void
  onKuer: () => void
}) {
  const data = useData()
  const hinweis = plausibilitaet(eingabe)
  const gewaehlt = eingabe.routineId
    ? data.gymRoutines.find((k) => k.id === eingabe.routineId) ?? null
    : null

  return (
    <div className="wk-karte">
      <div className="wk-karte-kopf">
        <span className="wk-geraet">{geraetName(eingabe.apparatus)}</span>
      </div>

      <div className="wk-felder">
        <Field label="D-Wert">
          <input className="input" inputMode="decimal" value={eingabe.d}
            onChange={(e) => onFeld('d', e.target.value)} placeholder="—" />
        </Field>
        <Field label="E-Wert">
          <input className="input" inputMode="decimal" value={eingabe.e}
            onChange={(e) => onFeld('e', e.target.value)} placeholder="—" />
        </Field>
        <Field label="Endnote">
          <input className="input" inputMode="decimal" value={eingabe.final}
            onChange={(e) => onFeld('final', e.target.value)} placeholder="—" />
        </Field>
        <Field label="Abzug">
          <input className="input" inputMode="decimal" value={eingabe.penalty}
            onChange={(e) => onFeld('penalty', e.target.value)} placeholder="—" />
        </Field>
        <Field label="Platz">
          <input className="input" inputMode="numeric" value={eingabe.rank}
            onChange={(e) => onFeld('rank', e.target.value)} placeholder="—" />
        </Field>
      </div>

      {hinweis && <div className="hint-box small">{hinweis}</div>}

      <div className="wk-karte-fuss">
        <button className="btn btn-sm" onClick={onKuer}>
          {gewaehlt
            ? `${gewaehlt.name} – wird festgehalten`
            : version
              ? `${version.name} · Fassung vom ${formatDay(String(version.frozen_at).slice(0, 10))}`
              : 'Kür auswählen'}
        </button>
      </div>

      <Field label="Notiz">
        <input className="input" value={eingabe.note}
          onChange={(e) => onFeld('note', e.target.value)} placeholder="optional" />
      </Field>
    </div>
  )
}

/**
 * Eine Kür für ein Gerät auswählen.
 *
 * Die Auswahl hält den Zustand der Kür in diesem Moment fest. Wird dieselbe
 * unveränderte Kür später noch einmal gewählt, entsteht keine zweite Fassung –
 * die ID kommt aus dem Inhalt.
 */
function KuerWaehler({ apparatus, onWaehlen, onEntfernen, onZuKueren, onClose }: {
  apparatus: string
  onWaehlen: (routineId: string) => void
  onEntfernen: () => void
  onZuKueren: () => void
  onClose: () => void
}) {
  const data = useData()
  const kueren = useMemo(
    () => data.gymRoutines
      .filter((k) => !k.deleted_at && k.is_active && k.apparatus === apparatus)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [data.gymRoutines, apparatus],
  )

  return (
    <Modal open title={`Kür wählen · ${geraetName(apparatus)}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onEntfernen}>Keine Kür</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Abbrechen</button>
      </>}>

      <div className="hint-box small">
        Die gewählte Kür wird in ihrem jetzigen Zustand festgehalten. Änderst du
        sie später, bleibt dieser Wettkampf unverändert.
      </div>

      {kueren.length === 0 ? (
        <Empty kompakt title={`Noch keine Kür an ${geraetName(apparatus)}`}
          hint="Ein Ergebnis lässt sich auch ohne Kür speichern."
          action={<button className="btn btn-primary btn-sm" onClick={onZuKueren}>Zu den Küren</button>} />
      ) : (
        <div className="list">
          {kueren.map((k) => {
            const plaetze = data.gymRoutineElements.filter(
              (v) => !v.deleted_at && v.routine_id === k.id).length
            return (
              <button key={k.id} className="list-row" onClick={() => onWaehlen(k.id)}>
                <span className="list-main">
                  <span className="list-title">{k.name}</span>
                  <span className="list-sub">
                    {plaetze === 1 ? '1 Element' : `${plaetze} Elemente`}
                  </span>
                </span>
                {k.competition_since && <StatusPill status="green">Wettkampfkür</StatusPill>}
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

/* =========================================================== Auswertung */

/**
 * Was sich aus den Wettkämpfen sagen lässt – und was nicht.
 *
 * Ausdrücklich **keine** Korrelation zwischen Training und Wettkampfleistung.
 * Ein Turner hat fünf bis zehn Wettkämpfe im Jahr; `core/zusammenhaenge.ts`
 * verlangt mindestens zwanzig gemeinsame Datenpunkte, und sie wären nicht
 * einmal vergleichbar (andere Übung, andere Kampfrichter, andere Liga). Eine
 * Zahl daraus sähe überzeugend aus und wäre keine
 * (TURNEN_ARCHITEKTUR.md, 6.2).
 *
 * Auch keine Rangfolge zwischen den Geräten: Eine Boden- und eine
 * Pauschenpferdnote sind nicht dieselbe Währung.
 */
function AuswertungBlock() {
  const data = useData()
  const [art, setArt] = useState<NotenArt>('final_score')

  const bilanzen = useMemo(
    () => geraetBilanzen(data.gymCompetitions, data.gymResults),
    [data.gymCompetitions, data.gymResults],
  )

  const reihen = useMemo(() => GERAETE
    .map((g) => ({ g, punkte: verlauf(g.key, art, data.gymCompetitions, data.gymResults) }))
    .filter((r) => r.punkte.length > 0),
    [art, data.gymCompetitions, data.gymResults])

  if (bilanzen.size === 0) return null

  const artLabel = NOTEN_ARTEN.find((a) => a.key === art)?.label ?? ''

  return (
    <Card title="Auswertung" className="mb16">
      <Collapsible label={`Verlauf je Gerät · ${artLabel}`}>
        <div className="chips mb12">
          {NOTEN_ARTEN.map((a) => (
            <button key={a.key} className={`chip sm${art === a.key ? ' active' : ''}`}
              onClick={() => setArt(a.key)}>{a.label}</button>
          ))}
        </div>

        {reihen.map(({ g, punkte }) => (
          <div key={g.key} className="mb16">
            <div className="wk-verlauf-kopf">
              <span className="wk-geraet">{g.name}</span>
              <span className="muted small">
                {punkte.length === 1 ? '1 Wert' : `${punkte.length} Werte`}
              </span>
            </div>
            {punkte.length < MINDESTPUNKTE_LINIE ? (
              // Zwei Punkte ergeben immer eine Gerade, und eine Gerade sieht
              // nach Entwicklung aus, wo nur zwei Zahlen sind.
              <div className="kennzeilen">
                {punkte.map((p, i) => (
                  <div key={i} className="kennzeile">
                    <span className="kennzeile-name">{formatDay(p.day)} · {p.name}</span>
                    <span className="kennzeile-wert">{formatNote(p.wert)}</span>
                  </div>
                ))}
                <div className="muted small mt8">
                  Für einen Verlauf sind das zu wenige Werte – hier stehen sie einzeln.
                </div>
              </div>
            ) : (
              <ChartFrame title={`${g.name} · ${artLabel}`}>
                {({ height }) => (
                  <LineChart height={height}
                    series={[{
                      name: artLabel,
                      points: punkte.map((p) => ({ label: formatDay(p.day), value: p.wert })),
                    }]}
                    formatValue={(n) => formatNote(n)}
                    formatAxis={(n) => formatNote(n)} />
                )}
              </ChartFrame>
            )}
          </div>
        ))}
      </Collapsible>

      <Collapsible label="Bestwerte und Starts je Gerät">
        <div className="kennzeilen">
          {[...bilanzen.values()].map((b) => (
            <div key={b.apparatus} className="kennzeile">
              <span className="kennzeile-name">
                {geraetName(b.apparatus)}
                <span className="muted small"> · {b.starts === 1 ? '1 Start' : `${b.starts} Starts`}</span>
              </span>
              <span className="kennzeile-wert">
                {b.bestEndnote
                  ? `best. ${formatNote(b.bestEndnote.wert)}`
                  : 'keine Endnote'}
                {b.letzter && ` · zuletzt ${formatNote(b.letzter.wert)}`}
              </span>
            </div>
          ))}
        </div>
        <div className="muted small mt8">
          Beschreibend, ohne Wertung zwischen den Geräten – eine Boden- und eine
          Pauschenpferdnote sind nicht dieselbe Währung.
        </div>
      </Collapsible>
    </Card>
  )
}
