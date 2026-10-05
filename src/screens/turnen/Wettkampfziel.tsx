/**
 * TURNEN · NÄCHSTER WETTKAMPF – der Termin und was die Daten dazu sagen.
 *
 * ---------------------------------------------------------------------------
 * Ein Block, kein Reiter
 *
 * Die Frage „wann ist der nächste Wettkampf, und wie steht meine Kür dafür?"
 * gehört dorthin, wo auch „was turne ich heute?" steht – auf die Turnübersicht,
 * oberhalb von **Nächstes Training**. Ein siebter Reiter wäre einer, der
 * zwischen zwei Saisons nichts zu sagen hat, und die Wettkampfliste selbst
 * bleibt im Reiter **Wettkämpfe**: Dort wird eingetragen, hier wird
 * vorbereitet.
 *
 * Die Karte steht dort auch, solange noch **kein Element** erfasst ist: Ein
 * Termin ist eine eigenständige Auskunft, und ihn hinter dem
 * Element-Onboarding zu verstecken hiesse, ihn unerreichbar zu machen. Sie
 * zeigt dann Name, Datum und Abstand und sagt, dass Turndaten fehlen – und
 * ausdrücklich keine leeren Gerätekarten.
 *
 * ---------------------------------------------------------------------------
 * Was hier NICHT steht
 *
 * Keine Prozentzahl, kein Score, keine Ampel über die Wettkampfbereitschaft.
 * Kein „24 Tage reichen" und kein „du bist spät dran" – der Countdown ist
 * kalendarisch und sonst nichts. Keine Aussage, dass ein Gerät wegen eines
 * Elements schwach wäre: Trainingsbeobachtung und Wettkampfwert stehen
 * nebeneinander, nie als Ursache und Folge.
 *
 * Die Kategorie je Gerät (`STAND_LABEL`) ist eine Zusammenfassung vorhandener
 * Zustände, keine Bewertung. „Keine offenen Punkte" heisst: Die erfassten
 * Trainingsdaten zeigen keine der definierten Baustellen – nicht, dass der
 * Wettkampf gelingt. Der Vorbehalt steht in `STAND_ERKLAERUNG` und erscheint
 * in der Detailansicht mit.
 *
 * ---------------------------------------------------------------------------
 * Nichts davon wird gespeichert
 *
 * Countdown und Gerätestand sind gerechnet (`wettkampfvorbereitung`). Es gibt
 * keine Tabelle dafür und keine Migration: Ein kommender Wettkampf ist eine
 * gewöhnliche `gym_competitions`-Zeile mit einem Datum in der Zukunft und noch
 * ohne `gym_results`. Ändert Erik morgen seine Kür, rechnet dieser Block mit
 * dem neuen Stand – die historischen Wettkämpfe behalten ihre eingefrorenen
 * Fassungen unberührt.
 *
 * Gerechnet wird in `core/turnen/wettkampfvorbereitung.ts`, angestossen in
 * `bild.ts` gemeinsam mit Phase 3A/3B. Hier wird nur angezeigt.
 */
import React, { useState } from 'react'
import { Card, Empty, Modal } from '../../ui/components'
import { formatDay, weekdayShort } from '../../core/dates'
import { formatNote } from '../../core/turnen/wettkampf'
import { platzImFeld } from '../../core/turnen/analyse'
import { schwierigkeitText } from '../../core/turnen/kueren'
import { STABILITAET_LABEL, LAGE_LABEL } from '../../core/turnen/trainingsfokus'
import { DURCHGANG_LAGE_LABEL, FENSTER_WOCHEN } from '../../core/turnen/kuerdurchgaenge'
import {
  HERKUNFT_TEXT, STAND_ERKLAERUNG, STAND_LABEL, vorTagen,
  type GeraetVorbereitung, type WettkampfZiel,
} from '../../core/turnen/wettkampfvorbereitung'
import {
  LEITLINIE_LABEL, PHASE_LABEL,
  type GeraetLeitlinie, type VorbereitungsBild,
} from '../../core/turnen/vorbereitungsstrategie'

/** Welche Pille ein Gerätestand bekommt – Farbe sagt nur „fällt auf". */
const STAND_PILL: Record<GeraetVorbereitung['stand'], string> = {
  kuer_fehlt: 'pill warn',
  elemente_auffaellig: 'pill warn',
  kuer_am_stueck_auffaellig: 'pill warn',
  daten_fehlen: 'pill',
  stabile_basis: 'pill good',
}

export function WettkampfZielKarte({ ziel, vorbereitung, ohneTurndaten, onZuWettkaempfen }: {
  ziel: WettkampfZiel
  /**
   * Die Vorbereitungsphase aus Phase 3D.
   *
   * Nur Anzeige: Welche Inhalte dadurch anders priorisiert werden, steht im
   * Block „Nächstes Training". Hier steht, in welcher Phase man ist und was
   * LifeHub deshalb tut.
   */
  vorbereitung: VorbereitungsBild
  /**
   * Es gibt noch kein Element und kein erfasstes Training.
   *
   * Dann ist „keine aktive Wettkampfkür hinterlegt" die Folge und nicht die
   * Ursache – gesagt wird deshalb, was wirklich fehlt. Geändert wird nur
   * dieser eine Satz; Gerätekarten entstehen daraus keine.
   */
  ohneTurndaten?: boolean
  onZuWettkaempfen: () => void
}) {
  const [detail, setDetail] = useState(false)

  /* Kein kommender Wettkampf: eine klare Aussage und ein Weg dorthin. Phase
     3A und 3B laufen daneben unveraendert weiter - das Trainingssystem haengt
     an keinem Wettkampf (21.4). */
  if (!ziel.naechster) {
    return (
      <Card className="mb16" title="Nächster Wettkampf">
        <Empty kompakt title="Noch kein kommender Wettkampf eingetragen."
          hint="Der Trainingsvorschlag darunter gilt unabhängig davon."
          action={
            <button className="btn btn-sm btn-primary" onClick={onZuWettkaempfen}>
              Wettkampf hinzufügen
            </button>
          } />
        <OffeneErgebnisse ziel={ziel} onZuWettkaempfen={onZuWettkaempfen} />
      </Card>
    )
  }

  const w = ziel.naechster

  return (
    <>
      <Card className="mb16" title="Nächster Wettkampf"
        action={ziel.geraete.length > 0
          ? <button className="btn btn-sm btn-ghost" onClick={() => setDetail(true)}>Details</button>
          : undefined}>

        <div className="wz-kopf">
          <div className="wz-name">{w.name}</div>
          <div className="wz-termin">
            {weekdayShort(w.day)}., {formatDay(w.day, 'long')}
            {' · '}<strong>{ziel.countdown}</strong>
          </div>
          {w.location && <div className="wz-ort">{w.location}</div>}
        </div>

        {/* Die Vorbereitungsphase aus Phase 3D. Eine benannte Kategorie und
            ein Satz dazu - keine Prozentzahl, keine Leistungsaussage. */}
        {vorbereitung.phase !== 'keine' && (
          <div className="wz-phase">
            <span className="wz-phase-kopf">Vorbereitungsphase</span>
            <span className={`pill wz-phase-${vorbereitung.phase}`}>
              {PHASE_LABEL[vorbereitung.phase]}
            </span>
            {vorbereitung.leitsatz && (
              <div className="wz-phase-satz">{vorbereitung.leitsatz}</div>
            )}
          </div>
        )}

        {ziel.geraete.length === 0 ? (
          <div className="muted small mt8">
            {ohneTurndaten
              ? 'Noch keine Elemente oder Wettkampfküren hinterlegt – zum Termin '
                + 'selbst steht damit noch kein Trainingsstand da.'
              : HERKUNFT_TEXT[ziel.herkunft]}
          </div>
        ) : (
          <>
            <div className="wz-geraete">
              {ziel.geraete.map((g) => <GeraetZeile key={g.apparatus} g={g} />)}
            </div>
            {ziel.herkunft === 'wettkampfkueren' && (
              <div className="wz-herkunft">{HERKUNFT_TEXT[ziel.herkunft]}</div>
            )}
          </>
        )}

        {/* Weitere Termine nur als Liste. Zwischen zwei Saisonhoehepunkten
            wird NICHT optimiert - daraus eine Periodisierung zu bauen waere
            erfunden (21.8). */}
        {ziel.weitere.length > 0 && (
          <div className="wz-weitere">
            <span className="wz-weitere-kopf">Danach</span>
            {ziel.weitere.map((x) => (
              <div className="wz-weitere-zeile" key={x.id}>
                <span>{formatDay(x.day)}</span>
                <span>{x.name}</span>
              </div>
            ))}
          </div>
        )}

        <OffeneErgebnisse ziel={ziel} onZuWettkaempfen={onZuWettkaempfen} />
      </Card>

      {detail && (
        <ZielDetail ziel={ziel} vorbereitung={vorbereitung}
          onClose={() => setDetail(false)} />
      )}
    </>
  )
}

/**
 * Vergangene Termine ohne erfasstes Ergebnis.
 *
 * Nur eine Feststellung über die Datenlage – **keine Annahme über eine
 * Teilnahme** (21.9). Deshalb steht hier auch kein „nachtragen" als Pflicht,
 * sondern ein Weg in den vorhandenen Wettkampfreiter, wo es den Editor und den
 * Protokollimport schon gibt.
 */
function OffeneErgebnisse({ ziel, onZuWettkaempfen }: {
  ziel: WettkampfZiel
  onZuWettkaempfen: () => void
}) {
  if (ziel.ohneErgebnis.length === 0) return null
  const erste = ziel.ohneErgebnis[0]

  return (
    <div className="hint-box small mt8">
      {ziel.ohneErgebnis.length === 1
        ? `${erste.name} am ${formatDay(erste.day)} ist vorbei – ein Ergebnis ist noch nicht erfasst.`
        : `${ziel.ohneErgebnis.length} vergangene Wettkampftermine haben noch kein erfasstes Ergebnis.`}
      <div className="row mt8">
        <button className="btn btn-sm" onClick={onZuWettkaempfen}>
          Ergebnis eintragen oder Protokoll importieren
        </button>
      </div>
    </div>
  )
}

/**
 * Ein Gerät in der Übersicht – vier Angaben, keine Kachel.
 *
 * Sechs grosse Karten wären bei 390 px drei Bildschirmhöhen. Die Zeile trägt
 * Name, Kategorie und die beiden getrennten Dimensionen; alles Weitere steht
 * in der Detailansicht.
 */
function GeraetZeile({ g }: { g: GeraetVorbereitung }) {
  return (
    <div className="wz-geraet">
      <div className="wz-geraet-kopf">
        <span className="wz-geraet-name">{g.name}</span>
        <span className={STAND_PILL[g.stand]}>{STAND_LABEL[g.stand]}</span>
      </div>
      <div className="wz-geraet-zeilen">
        {g.kuerName
          ? <span>Kür: {g.kuerName}</span>
          : <span>keine Wettkampfkür</span>}
        {g.kuerName && (
          <>
            <span>Elemente: {LAGE_LABEL[g.elementLage]}</span>
            <span>
              Kür am Stück: {g.neueFassung
                ? 'aktuelle Fassung noch nicht erfasst'
                : DURCHGANG_LAGE_LABEL[g.durchgangsLage]}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/* ========================================================== Detail */

/**
 * Die Detailansicht – je Gerät alles, was dasteht, und nichts dazu.
 *
 * Fehlende Werte erscheinen als „–" oder als Satz, nie als 0. Die
 * Schwierigkeitssumme heisst ausdrücklich nicht D-Wert: Elementgruppen,
 * Anrechnungsgrenzen und Verbindungen stehen in LifeHub nicht, und ohne sie
 * ist die Summe der Elementwerte kein D-Wert.
 */
function ZielDetail({ ziel, vorbereitung, onClose }: {
  ziel: WettkampfZiel
  vorbereitung: VorbereitungsBild
  onClose: () => void
}) {
  const w = ziel.naechster!
  const leitlinieVon = new Map(vorbereitung.geraete.map((g) => [g.apparatus, g.leitlinie]))

  return (
    <Modal open wide title={w.name} onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Schliessen</button></>}>

      <div className="kennzeilen mb16">
        <div className="kennzeile">
          <span className="kennzeile-name">Termin</span>
          <span className="kennzeile-wert">
            {weekdayShort(w.day)}., {formatDay(w.day, 'long')} · {ziel.countdown}
          </span>
        </div>
        {w.location && (
          <div className="kennzeile">
            <span className="kennzeile-name">Ort</span>
            <span className="kennzeile-wert">{w.location}</span>
          </div>
        )}
        {w.class_name && (
          <div className="kennzeile">
            <span className="kennzeile-name">Klasse</span>
            <span className="kennzeile-wert">{w.class_name}</span>
          </div>
        )}
        <div className="kennzeile">
          <span className="kennzeile-name">Geräte</span>
          <span className="kennzeile-wert">{HERKUNFT_TEXT[ziel.herkunft]}</span>
        </div>
        {vorbereitung.phase !== 'keine' && (
          <div className="kennzeile">
            <span className="kennzeile-name">Vorbereitung</span>
            <span className="kennzeile-wert">{PHASE_LABEL[vorbereitung.phase]}</span>
          </div>
        )}
      </div>

      {ziel.geraete.map((g) => (
        <GeraetDetail key={g.apparatus} g={g}
          leitlinie={leitlinieVon.get(g.apparatus) ?? null} />
      ))}

      <div className="muted small mt16">
        Alle Angaben sind Beobachtungen aus den erfassten Daten. LifeHub
        bewertet daraus keine Wettkampfbereitschaft und sagt nicht, ob die Zeit
        bis zum Wettkampf ausreicht.
      </div>
    </Modal>
  )
}

function GeraetDetail({ g, leitlinie }: {
  g: GeraetVorbereitung
  /** Die Leitlinie aus Phase 3D, oder `null` ohne kommenden Wettkampf. */
  leitlinie: GeraetLeitlinie | null
}) {
  const d = g.durchgaenge
  const l = g.letzterStart

  return (
    <div className="wz-detail">
      <div className="wz-detail-kopf">
        <span className="wz-detail-name">{g.name}</span>
        <span className={STAND_PILL[g.stand]}>{STAND_LABEL[g.stand]}</span>
      </div>
      <div className="wz-detail-erklaerung">{STAND_ERKLAERUNG[g.stand]}</div>
      {/* Die Zeitphase ist global, die Leitlinie bleibt geraetespezifisch -
          ein naher Wettkampf heisst nicht, dass alle Geraete gleich stehen. */}
      {leitlinie && (
        <div className="wz-detail-leitlinie">
          Für die Vorbereitung: {LEITLINIE_LABEL[leitlinie]}.
        </div>
      )}

      {/* ------------------------------------------- Aktuelle Wettkampfkür */}
      <div className="wz-abschnitt">
        <span className="wz-abschnitt-kopf">Aktuelle Wettkampfkür</span>
        {!g.kuerName ? (
          <div className="muted small">Keine Kür an diesem Gerät als Wettkampfkür gesetzt.</div>
        ) : (
          <div className="kennzeilen">
            <div className="kennzeile">
              <span className="kennzeile-name">Kür</span>
              <span className="kennzeile-wert">{g.kuerName}</span>
            </div>
            <div className="kennzeile">
              <span className="kennzeile-name">Elemente</span>
              <span className="kennzeile-wert">{g.elemente}</span>
            </div>
            <div className="kennzeile">
              {/* Kein D-Wert - die Wertungsregeln stehen nicht in LifeHub. */}
              <span className="kennzeile-name">Schwierigkeitssumme</span>
              <span className="kennzeile-wert">
                {g.schwierigkeit ? schwierigkeitText(g.schwierigkeit) : '–'}
              </span>
            </div>
            {g.geloeschtePlaetze.length > 0 && (
              <div className="kennzeile">
                <span className="kennzeile-name">Gelöschte Plätze</span>
                <span className="kennzeile-wert">{g.geloeschtePlaetze.length}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------- Elementstand */}
      {g.kuerName && (
        <div className="wz-abschnitt">
          <span className="wz-abschnitt-kopf">Elementstand</span>
          <div className="kennzeilen">
            <div className="kennzeile">
              <span className="kennzeile-name">Lage</span>
              <span className="kennzeile-wert">{LAGE_LABEL[g.elementLage]}</span>
            </div>
            <div className="kennzeile">
              <span className="kennzeile-name">Auffällig</span>
              <span className="kennzeile-wert">{g.auffaellige.length}</span>
            </div>
          </div>
          {g.auffaellige.length > 0 && (
            <div className="list kompakt">
              {g.auffaellige.map((a) => (
                <div className="list-row" key={a.element.id}>
                  <span className="list-main">
                    <span className="list-title">{a.element.name}</span>
                    <span className="list-sub">
                      {a.auffaellig.map((x) => x.text).join(' · ')}
                    </span>
                  </span>
                  <span className="list-amount">{STABILITAET_LABEL[a.stabilitaet]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------- Kürdurchgänge */}
      {g.kuerName && (
        <div className="wz-abschnitt">
          <span className="wz-abschnitt-kopf">
            Kürdurchgänge · die letzten {FENSTER_WOCHEN} Wochen
          </span>
          {g.neueFassung || !d || d.durchgaenge === 0 ? (
            <div className="muted small">
              {g.neueFassung
                ? 'Die aktuelle Kürfassung ist noch nicht erfasst. Durchgänge '
                  + 'früherer Fassungen zählen dafür nicht.'
                : 'Noch kein Kürdurchgang der aktuellen Fassung erfasst.'}
            </div>
          ) : (
            <div className="kennzeilen">
              <div className="kennzeile">
                <span className="kennzeile-name">Durchgänge</span>
                <span className="kennzeile-wert">{d.durchgaenge}</span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">komplett</span>
                <span className="kennzeile-wert">{d.komplett}</span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">sturzfrei</span>
                <span className="kennzeile-wert">{d.sturzfrei}</span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">ohne Unterbrechung</span>
                <span className="kennzeile-wert">{d.unterbrechungsfrei}</span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">Letzte komplette Kür</span>
                <span className="kennzeile-wert">
                  {d.tageHerKomplett === null ? '–' : vorTagen(d.tageHerKomplett)}
                </span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">Kürstabilität</span>
                <span className="kennzeile-wert">
                  {DURCHGANG_LAGE_LABEL[g.durchgangsLage]}
                </span>
              </div>
            </div>
          )}
          {g.fruehere && g.fruehere.durchgaenge > 0 && !g.neueFassung && (
            <div className="muted small mt8">
              Dazu {g.fruehere.durchgaenge} Durchgänge früherer Fassungen – sie
              zählen nicht zur aktuellen Kür.
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------- Letzter Wettkampf */}
      <div className="wz-abschnitt">
        <span className="wz-abschnitt-kopf">Letzter Wettkampf</span>
        {!l ? (
          <div className="muted small">
            An diesem Gerät liegt noch kein ausgewertetes Wettkampfergebnis vor.
          </div>
        ) : (
          <>
            <div className="kennzeilen">
              <div className="kennzeile">
                <span className="kennzeile-name">Wettkampf</span>
                <span className="kennzeile-wert">{l.name} · {formatDay(l.day)}</span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">D-Wert</span>
                <span className="kennzeile-wert">
                  {formatNote(l.d.wert)}
                  {platzImFeld(l.d) ? ` · ${platzImFeld(l.d)}` : ''}
                </span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">E-Wert</span>
                <span className="kennzeile-wert">
                  {formatNote(l.e.wert)}
                  {platzImFeld(l.e) ? ` · ${platzImFeld(l.e)}` : ''}
                </span>
              </div>
              <div className="kennzeile">
                <span className="kennzeile-name">Endnote</span>
                <span className="kennzeile-wert">
                  {formatNote(l.final.wert)}
                  {platzImFeld(l.final) ? ` · ${platzImFeld(l.final)}` : ''}
                </span>
              </div>
            </div>
            {/* Getrennt von allem oben. Dass im Training Elemente auffallen,
                ist KEINE Erklaerung fuer diese Zahl (21.10). */}
            {l.ausfuehrungUnten !== null && (
              <div className="muted small mt8">
                Die Ausführung lag dort relativ{' '}
                {l.ausfuehrungUnten ? 'unter' : 'auf oder über'} der Feldmitte
                {l.feldgroesse !== null ? ` (${l.feldgroesse} im Feld)` : ''}.
                Das ist eine Beobachtung zum Wettkampf, kein Zusammenhang mit
                einem einzelnen Element.
              </div>
            )}
            {g.kuerGeaendert === true && (
              <div className="muted small mt8">
                Die Kür wurde seit diesem Wettkampf geändert – die damals
                geturnte Fassung bleibt unverändert erhalten.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
