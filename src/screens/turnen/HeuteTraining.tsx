/**
 * TURNEN · HEUTE – was heute konkret ansteht, und der Tageskontext dazu.
 *
 * ---------------------------------------------------------------------------
 * Eine Karte, nicht zwei
 *
 * Steht heute Training an, ist **dieser** Block der primäre: Er nennt den
 * heutigen Termin mit den Inhalten, die Phase 3B ihm zugeordnet hat, und führt
 * direkt in die vorhandene Erfassung. „Nächstes Training" (Phase 3A) wird dann
 * nicht zusätzlich angezeigt – es wäre derselbe Plan ein zweites Mal
 * untereinander. Der Umschalter auf **Kommende Einheiten** bleibt hier
 * erreichbar, damit Phase 3B nicht hinter dem heutigen Tag verschwindet.
 *
 * An Tagen ohne Turntraining bleibt es umgekehrt: Dort steht die schlanke
 * Heute-Zeile (Tageskontext und der nächste Termin), und der Vorschlag kommt
 * wie bisher aus „Nächstes Training" – zwei verschiedene Auskünfte, keine
 * Doppelung.
 *
 * ---------------------------------------------------------------------------
 * Erfasst wird mit dem vorhandenen Weg
 *
 * Der Knopf öffnet **genau die geplante Session** im Turnen-Trainingseditor
 * (`#/turnen/training?einheit=<id>`). Dort wird dieselbe Zeile auf
 * `completed` gesetzt; es entsteht kein zweiter Termin und keine zweite
 * Erfassungsoberfläche.
 *
 * ---------------------------------------------------------------------------
 * Schlaf steht daneben, nicht darüber
 *
 * Die Nacht auf heute ist Kontext. Sie entfernt kein Gerät und bewertet
 * nichts – keine Ampel, keine Kategorie, kein „zu wenig". Fehlt sie, fehlt
 * sie, und das Training bleibt vollständig nutzbar.
 */
import React, { useState } from 'react'
import { Card, Segment } from '../../ui/components'
import { formatDay, formatDuration, uhrzeitAusIso } from '../../core/dates'
import { INHALT_ART_LABEL, ROLLE_LABEL, UMFANG_LABEL } from '../../core/turnen/trainingsplanung'
import type { EinheitGeraet, WochenBild } from '../../core/turnen/wochenplanung'
import {
  PHASE_LABEL, phaseKurztext, type VorbereitungsBild,
} from '../../core/turnen/vorbereitungsstrategie'
import type { WettkampfZiel } from '../../core/turnen/wettkampfvorbereitung'
import {
  STATUS_TEXT, ZURUECK_GRUND, erfasstText, geraeteHeuteLabel, kapazitaetText,
  tagMitAuswahl, type TagesAuswahl, type TagesEinheit, type TagesTrainingBild,
} from '../../core/turnen/tagestraining'

type Ansicht = 'heute' | 'woche'

const ANSICHTEN: { value: Ansicht; label: string }[] = [
  { value: 'heute', label: 'Heute' },
  { value: 'woche', label: 'Kommende Einheiten' },
]

export function HeuteTraining({
  tag, woche, ziel, vorbereitung, kompakt, wochenAnsicht, onZuTraining,
}: {
  tag: TagesTrainingBild
  woche: WochenBild
  ziel: WettkampfZiel
  vorbereitung: VorbereitungsBild
  /**
   * Schlanke Fassung ohne Umschalter.
   *
   * An Tagen ohne Turntraining steht „Nächstes Training" darunter und trägt
   * den Umschalter – hier wäre er ein zweiter für dieselbe Ansicht.
   */
  kompakt?: boolean
  /** Die Wochenansicht, falls dieser Block sie tragen soll. */
  wochenAnsicht?: React.ReactNode
  /** Öffnet die Erfassung – mit Session-ID genau diese geplante Einheit. */
  onZuTraining: (sessionId?: string) => void
}) {
  const [ansicht, setAnsicht] = useState<Ansicht>('heute')
  const [auswahl, setAuswahl] = useState<TagesAuswahl>({})

  const gewaehlt = tagMitAuswahl(tag, auswahl)
  const geaendert = !!(auswahl.ohne?.length || auswahl.zusatz?.length
    || auswahl.ohneInhalte?.length)

  if (!kompakt && ansicht === 'woche' && wochenAnsicht) {
    return (
      <Card className="mb16" title="Heute"
        sub="Die Inhalte auf die geplanten Trainingstage verteilt"
        action={<Segment options={ANSICHTEN} value={ansicht} onChange={setAnsicht} />}>
        {wochenAnsicht}
      </Card>
    )
  }

  return (
    <Card className="mb16" title="Heute"
      sub={formatDay(tag.tag, 'long')}
      action={!kompakt && wochenAnsicht
        ? <Segment options={ANSICHTEN} value={ansicht} onChange={setAnsicht} />
        : undefined}>

      <div className="ht-status">{STATUS_TEXT[tag.status]}</div>

      <TagesKontextZeile tag={tag} vorbereitung={vorbereitung} />

      {/* Wettkampftag: KEIN erfundener Trainingsplan. Steht trotzdem ein
          eigener Turntermin von Erik, wird er genannt und nicht gelöscht -
          die Entscheidung bleibt bei ihm (23.8). */}
      {tag.status === 'wettkampftag' && (
        <div className="ht-wettkampf">
          {ziel.naechster && (
            <div className="ht-wettkampf-name">
              {ziel.naechster.name}
              {ziel.naechster.location ? ` · ${ziel.naechster.location}` : ''}
            </div>
          )}
          <div className="muted small">
            Für diesen Tag schlägt LifeHub kein Training vor. Der Wettkampfstand
            steht in der Karte darüber.
          </div>
          {gewaehlt.einheiten.length > 0 && (
            <div className="hint-box small mt8">
              {gewaehlt.einheiten.length === 1
                ? 'Für heute ist zusätzlich ein eigener Turntermin eingetragen.'
                : `Für heute sind zusätzlich ${gewaehlt.einheiten.length} eigene Turntermine eingetragen.`}
              {' '}Er bleibt stehen – was damit passiert, entscheidest du.
              <div className="row mt8">
                <button className="btn btn-sm" onClick={() => onZuTraining(gewaehlt.einheiten[0].sessionId)}>
                  Termin öffnen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tag.status === 'geplant' && (
        <>
          {geaendert && (
            <div className="row mb8">
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm btn-ghost" onClick={() => setAuswahl({})}>
                zurücksetzen
              </button>
            </div>
          )}
          {gewaehlt.einheiten.map((u) => (
            <HeutigeEinheit key={u.sessionId} u={u}
              mehrere={gewaehlt.einheiten.length > 1}
              onWeg={(apparatus) => setAuswahl((a) => ({
                ...a,
                ohne: [...(a.ohne ?? []), apparatus],
                zusatz: (a.zusatz ?? []).filter((k) => k !== apparatus),
              }))}
              onDazu={(apparatus) => setAuswahl((a) => ({
                ...a,
                zusatz: [...(a.zusatz ?? []), apparatus],
                ohne: (a.ohne ?? []).filter((k) => k !== apparatus),
              }))}
              onInhaltWeg={(key) => setAuswahl((a) => ({
                ...a, ohneInhalte: [...(a.ohneInhalte ?? []), key],
              }))}
              onErfassen={() => onZuTraining(u.sessionId)} />
          ))}
        </>
      )}

      {tag.erfasst.length > 0 && (
        <div className="ht-erfasst">
          {tag.erfasst.map((u) => (
            <div className="ht-erfasst-zeile" key={u.sessionId}>
              <span className="ht-erfasst-titel">{u.titel || 'Turnen'}</span>
              <span className="muted small">
                {erfasstText(u) || 'ohne erfasste Inhalte'}
                {u.dauerMinuten ? ` · ${formatDuration(u.dauerMinuten)}` : ''}
              </span>
              <button className="btn btn-sm btn-ghost"
                onClick={() => onZuTraining(u.sessionId)}>öffnen</button>
            </div>
          ))}
        </div>
      )}

      {tag.ausgefallen.length > 0 && (
        <div className="muted small mt8">
          {tag.ausgefallen.length === 1
            ? 'Ein Turntermin ist für heute als ausgefallen vermerkt.'
            : `${tag.ausgefallen.length} Turntermine sind für heute als ausgefallen vermerkt.`}
        </div>
      )}

      {tag.status !== 'geplant' && tag.naechsteEinheit && (
        <div className="ht-naechste">
          Nächste Turneinheit: <strong>{tag.naechsteEinheit.label}</strong>
          {' · '}{formatDay(tag.naechsteEinheit.day)}
        </div>
      )}

      {tag.status === 'kein_training' && !tag.naechsteEinheit && (
        <div className="muted small mt8">
          Es ist auch kein weiterer Turntermin geplant. Ein Training lässt sich
          jederzeit frei erfassen.
        </div>
      )}

      {tag.status !== 'geplant' && (
        <div className="row mt8">
          <button className="btn btn-sm btn-primary" onClick={() => onZuTraining()}>
            Training frei erfassen
          </button>
        </div>
      )}
    </Card>
  )
}

/**
 * Tagesart, Kapazität, Schlaf, Energie – in einer Zeile.
 *
 * Alles **vorhandene** Angaben, jede für sich. Keine davon wird verrechnet,
 * und keine verändert den Plan. Was fehlt, fehlt und steht nicht als Lücke da.
 */
function TagesKontextZeile({ tag, vorbereitung }: {
  tag: TagesTrainingBild
  vorbereitung: VorbereitungsBild
}) {
  const k = tag.kontext
  const kapazitaet = kapazitaetText(k.kapazitaet)
  const phase = phaseKurztext(vorbereitung)

  return (
    <div className="ht-kontext">
      {k.tagesart && <span className="ht-kontext-teil">{k.tagesart}</span>}
      {kapazitaet && <span className="ht-kontext-teil">{kapazitaet}</span>}
      {/* Nur die Dauer und die Uhrzeiten - keine Bewertung, keine Ampel.
          Der Zielbereich der Metrik `sleep_h` bleibt hier bewusst aussen
          vor (23.6). */}
      {k.nacht ? (
        <span className="ht-kontext-teil">
          Schlaf letzte Nacht · {formatDuration(k.nacht.dauerMinuten)}
          <span className="muted"> ({uhrzeitAusIso(k.nacht.von)}–{uhrzeitAusIso(k.nacht.bis)})</span>
        </span>
      ) : (
        <span className="ht-kontext-teil muted">
          Für die letzte Nacht liegen keine Schlafdaten vor.
        </span>
      )}
      {k.energie !== null && (
        <span className="ht-kontext-teil">Energie · {k.energie}/10</span>
      )}
      {phase && (
        <span className={`pill wz-phase-${vorbereitung.phase}`}>
          {PHASE_LABEL[vorbereitung.phase]}
        </span>
      )}
    </div>
  )
}

/**
 * Eine heute offene Einheit.
 *
 * Die Geräte stehen in der Reihenfolge, die Phase 3B ihnen gegeben hat – und
 * damit in der von Phase 3A. Hier wird nichts umsortiert und nichts neu
 * bewertet; was der Nutzer abwählt, lebt nur in dieser Ansicht.
 */
function HeutigeEinheit({ u, mehrere, onWeg, onDazu, onInhaltWeg, onErfassen }: {
  u: TagesEinheit
  mehrere: boolean
  onWeg: (apparatus: string) => void
  onDazu: (apparatus: string) => void
  onInhaltWeg: (key: string) => void
  onErfassen: () => void
}) {
  return (
    <div className="ht-einheit">
      {mehrere && (
        <div className="ht-einheit-kopf">{u.titel || 'Turntraining'}</div>
      )}
      <div className="ht-zahl">{geraeteHeuteLabel(u.geraete.length)}</div>

      {u.geraete.length === 0 ? (
        <div className="muted small">
          Für heute ist nichts eingeplant – ein Training lässt sich trotzdem
          erfassen.
        </div>
      ) : (
        <div className="ht-geraete">
          {u.geraete.map((g) => (
            <HeutigesGeraet key={g.apparatus} g={g}
              onWeg={() => onWeg(g.apparatus)} onInhaltWeg={onInhaltWeg} />
          ))}
        </div>
      )}

      {/* Nichts verschwindet stillschweigend: Was heute nicht hineinpasst,
          steht hier mit seinem Grund und lässt sich zurückholen (23.5). */}
      {u.zurueckgestellt.length > 0 && (
        <div className="ht-zurueck">
          <span className="ht-zurueck-kopf">Heute zurückgestellt</span>
          {u.zurueckgestellt.map((g) => (
            <div className="ht-zurueck-zeile" key={g.apparatus}>
              <span className="ht-name">{g.name}</span>
              <span className={`np-rolle np-rolle-${g.rolle}`}>{ROLLE_LABEL[g.rolle]}</span>
              <span className="muted small">{ZURUECK_GRUND}</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => onDazu(g.apparatus)}>+ heute mitnehmen</button>
            </div>
          ))}
        </div>
      )}

      <div className="row mt8">
        <button className="btn btn-sm btn-primary" onClick={onErfassen}>
          Training erfassen
        </button>
      </div>
    </div>
  )
}

function HeutigesGeraet({ g, onWeg, onInhaltWeg }: {
  g: EinheitGeraet
  onWeg: () => void
  onInhaltWeg: (key: string) => void
}) {
  return (
    <div className="ht-geraet">
      <div className="ht-geraet-kopf">
        <span className="ht-name">{g.name}</span>
        <span className={`np-rolle np-rolle-${g.rolle}`}>{ROLLE_LABEL[g.rolle]}</span>
        {g.wiederholung && <span className="wp-wdh">zweiter Termin</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onWeg}
          aria-label={`${g.name} für heute abwählen`}>abwählen</button>
      </div>
      {g.inhalte.length === 0 ? (
        <div className="muted small">Alle Inhalte entfernt – das Gerät bleibt stehen.</div>
      ) : (
        <div className="ht-inhalte">
          {g.inhalte.map((i) => (
            <div className="ht-inhalt" key={i.key}>
              <span className={`np-art np-art-${i.art}`}>{INHALT_ART_LABEL[i.art]}</span>
              <span className="ht-inhalt-text">{i.text}</span>
              {/* Der Umfang - und ausdruecklich keine Minuten (23.7). */}
              <span className="np-umfang">{UMFANG_LABEL[i.umfang]}</span>
              <button type="button" className="btn btn-sm btn-ghost np-weg"
                onClick={() => onInhaltWeg(i.key)}
                aria-label={`„${i.text}" entfernen`}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
