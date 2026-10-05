/**
 * TURNEN · NÄCHSTES TRAINING – der Vorschlag, bevor man in die Halle geht.
 *
 * ---------------------------------------------------------------------------
 * Ein Block, kein Reiter
 *
 * Die Frage „was turne ich heute?" stellt sich beim Aufschlagen der
 * Turnübersicht, nicht nach zwei Klicks. Ein siebter Reiter wäre ausserdem
 * einer, der nach dem Training nichts mehr zu sagen hat.
 *
 * ---------------------------------------------------------------------------
 * Nichts davon wird gespeichert
 *
 * Der Vorschlag wird bei jeder Datenänderung neu gerechnet (`trainingsplanung`,
 * gemessen weit unter einer Millisekunde). Nach dem nächsten erfassten Training
 * steht hier von selbst etwas anderes – eine gespeicherte Empfehlung wäre ab
 * dann falsch, ohne dass es auffällt.
 *
 * Was der Nutzer am Vorschlag ändert – Gerät abwählen, Reihenfolge umstellen,
 * Inhalt entfernen, Gerät dazunehmen – lebt in den Zuständen dieser Komponente
 * und geht durch `planMitAuswahl()`. Diese Funktion ist rein, damit dieselben
 * Fälle in `turnen-trainingsplanung.test.ts` nachgerechnet werden können,
 * statt sie durch die Oberfläche klicken zu müssen.
 *
 * ---------------------------------------------------------------------------
 * Erfasst wird mit dem vorhandenen Weg
 *
 * Der Knopf führt in den Reiter **Training**. Dort entstehen Elementversuche
 * als `gym_attempts` und Kürdurchgänge als `gym_routine_runs`, genau wie
 * bisher. Es gibt keine zweite Trainingserfassung und keinen „Plan
 * erledigt"-Zustand: Der Plan ist eine Ansicht, kein Datensatz.
 *
 * ---------------------------------------------------------------------------
 * Zwei Ansichten, ein Vorschlag
 *
 * **Nächste Einheit** ist Phase 3A: was sich lohnt, wenn ich jetzt turne.
 * **Kommende Einheiten** ist Phase 3B (`Wochenplan.tsx`): dieselben Inhalte,
 * verteilt auf die Trainingstage, die es wirklich gibt.
 *
 * Der Umschalter steht **immer** da, auch wenn noch kein Termin geplant ist:
 * Der erste Turntermin wird in der Wochenansicht angelegt, und ein Umschalter,
 * der erst nach dem ersten Termin erscheint, liesse sich nie erreichen. Die
 * leere Wochenansicht sagt dann, dass nichts geplant ist – und bietet den
 * Knopf dafür an.
 *
 * Gerechnet wird der Phase-3A-Plan **einmal** und an beide Ansichten
 * weitergegeben; zwei Rechnungen wären zwei Zustände, die auseinanderlaufen
 * können. Seit Phase 3C steht diese Rechnung in `bild.ts` und wird von der
 * Übersicht hereingegeben – dieselben Zwischenergebnisse tragen auch den
 * Wettkampfblock, und dreimal dasselbe auszurechnen wären drei Zustände.
 *
 * ---------------------------------------------------------------------------
 * Der Wettkampfkontext ändert den Vorschlag NICHT
 *
 * Seit Phase 3C steht an einem Gerät, wenn ein Wettkampf bevorsteht, der
 * Abstand dazu und wie die Kür aktuell steht (`wettkampfHinweis`). Das ist
 * **Beschriftung** – Priorität, Reihenfolge, Inhalte und Umfang kommen
 * unverändert aus `trainingsplanung()`. Es gibt keine Periodisierung nach
 * Tagen bis zum Wettkampf: Kein „unter 14 Tagen keine neuen Elemente", keine
 * Entlastungswoche, kein Peaking. Dafür fehlt in LifeHub die Grundlage.
 */
import React, { useMemo, useState } from 'react'
import { Card, Segment } from '../../ui/components'
import {
  INHALT_ART_LABEL, KEIN_PLAN_TEXT, REIHENFOLGE_TEXT, ROLLE_LABEL, UMFANG_LABEL,
  geraeteLabel, nachwaehlbar, planMitAuswahl,
  type GeraetPlan, type PlanungsBild,
} from '../../core/turnen/trainingsplanung'
import {
  wettkampfHinweis, type WettkampfZiel,
} from '../../core/turnen/wettkampfvorbereitung'
import {
  PHASE_LABEL, phaseKurztext, zurueckgestelltHinweis,
  type VorbereitungsAnpassung, type VorbereitungsBild,
} from '../../core/turnen/vorbereitungsstrategie'
import { WochenAnsicht } from './Wochenplan'

type Ansicht = 'einheit' | 'woche'

const ANSICHTEN: { value: Ansicht; label: string }[] = [
  { value: 'einheit', label: 'Nächste Einheit' },
  { value: 'woche', label: 'Kommende Einheiten' },
]

export function NaechstesTraining({
  bild, ziel, vorbereitung, anpassungen, onZuTraining,
}: {
  /** Der Plan **nach** Phase 3D. Ohne Wettkampf derselbe wie vorher. */
  bild: PlanungsBild
  ziel: WettkampfZiel
  vorbereitung: VorbereitungsBild
  /** Was Phase 3D am Vorschlag geändert hat. Leer = nichts geändert. */
  anpassungen: Map<string, VorbereitungsAnpassung>
  onZuTraining: () => void
}) {
  const [ohne, setOhne] = useState<string[]>([])
  const [zusatz, setZusatz] = useState<string[]>([])
  const [reihenfolge, setReihenfolge] = useState<string[]>([])
  const [ohneInhalte, setOhneInhalte] = useState<string[]>([])
  const [ansicht, setAnsicht] = useState<Ansicht>('einheit')

  const plan = useMemo(
    () => planMitAuswahl(bild, { ohne, zusatz, reihenfolge, ohneInhalte }),
    [bild, ohne, zusatz, reihenfolge, ohneInhalte],
  )
  const frei = useMemo(
    () => nachwaehlbar(bild, { ohne, zusatz, reihenfolge, ohneInhalte }),
    [bild, ohne, zusatz, reihenfolge, ohneInhalte],
  )
  const geaendert = ohne.length > 0 || zusatz.length > 0
    || reihenfolge.length > 0 || ohneInhalte.length > 0

  const zurueck = () => {
    setOhne([])
    setZusatz([])
    setReihenfolge([])
    setOhneInhalte([])
  }

  /** Ein Gerät um einen Platz verschieben – die Reihenfolge IST die Liste. */
  const schiebe = (apparatus: string, richtung: -1 | 1) => {
    const jetzt = plan.map((g) => g.apparatus)
    const i = jetzt.indexOf(apparatus)
    const j = i + richtung
    if (i < 0 || j < 0 || j >= jetzt.length) return
    const neu = [...jetzt]
    const merk = neu[i]
    neu[i] = neu[j]
    neu[j] = merk
    setReihenfolge(neu)
  }

  /* Wettkampftag: KEIN erfundener Trainingsplan.
     Kein Aufwaermprogramm, keine Saetze, keine minutengenaue Vorbereitung -
     das waere eigener Scope und steht in LifeHub nirgends. Nur die
     Feststellung und der vorhandene Erfassungsweg; die Wochenansicht bleibt
     erreichbar, denn die naechsten Tage sind davon unberuehrt. */
  if (vorbereitung.phase === 'wettkampftag' && ansicht === 'einheit') {
    return (
      <Card className="mb16" title="Nächstes Training"
        sub={vorbereitung.wettkampf?.name ?? undefined}
        action={<Segment options={ANSICHTEN} value={ansicht} onChange={setAnsicht} />}>
        <div className="np-wettkampftag">Heute ist Wettkampf.</div>
        <div className="muted small mt8">
          Für diesen Tag schlägt LifeHub kein Training vor. Der Wettkampfstand
          steht in der Karte darüber.
        </div>
        <div className="row mt8">
          <button className="btn btn-sm btn-primary" onClick={onZuTraining}>
            Training frei erfassen
          </button>
        </div>
      </Card>
    )
  }

  if (bild.grund) {
    return (
      <Card className="mb16" title="Nächstes Training">
        <div className="muted small">{KEIN_PLAN_TEXT[bild.grund]}</div>
        <div className="row mt8">
          <button className="btn btn-sm btn-primary" onClick={onZuTraining}>
            Training frei erfassen
          </button>
        </div>
      </Card>
    )
  }

  if (ansicht === 'woche') {
    return (
      <Card className="mb16" title="Nächstes Training"
        sub="Die Inhalte auf die geplanten Trainingstage verteilt"
        action={<Segment options={ANSICHTEN} value={ansicht} onChange={setAnsicht} />}>
        <WochenAnsicht plan={bild} ziel={ziel} vorbereitung={vorbereitung}
          onZuTraining={onZuTraining} />
      </Card>
    )
  }

  return (
    <Card className="mb16" title="Nächstes Training"
      sub={`${geraeteLabel(plan.length)} – ein Vorschlag, keine Verpflichtung`}
      action={<Segment options={ANSICHTEN} value={ansicht} onChange={setAnsicht} />}>

      {geaendert && (
        <div className="row mb8">
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={zurueck}>zurücksetzen</button>
        </div>
      )}

      {/* Die Vorbereitungsphase aus 3D. Steht nur da, wenn ein Wettkampf
          eingetragen ist - ohne einen sieht der Block aus wie vor 3D. */}
      {phaseKurztext(vorbereitung) && (
        <div className="np-phase">
          <span className={`pill wz-phase-${vorbereitung.phase}`}>
            {PHASE_LABEL[vorbereitung.phase]}
          </span>
          <span className="np-phase-text">
            {vorbereitung.countdown ? `Wettkampf ${vorbereitung.countdown}` : ''}
          </span>
        </div>
      )}

      {!bild.hatWettkampf && (
        <div className="hint-box small mb8">
          Ohne Wettkampfprotokoll gibt es keine Gerätepriorität – der Vorschlag
          kommt hier allein aus dem Training.
        </div>
      )}

      {plan.length === 0 ? (
        <div className="muted small">
          Alle Geräte abgewählt.{' '}
          <button className="btn btn-sm btn-ghost" onClick={zurueck}>zurücksetzen</button>
        </div>
      ) : (
        <div className="np-liste">
          {plan.map((g, i) => (
            <NaechstesGeraet key={g.apparatus} g={g} nummer={i + 1}
              erste={i === 0} letzte={i === plan.length - 1}
              wettkampf={wettkampfHinweis(ziel, g.apparatus)}
              zurueckgestellt={zurueckgestelltHinweis(anpassungen, g.apparatus)}
              anpassung={anpassungen.get(g.apparatus) ?? null}
              onWeg={() => setOhne([...ohne, g.apparatus])}
              onHoch={() => schiebe(g.apparatus, -1)}
              onRunter={() => schiebe(g.apparatus, 1)}
              onInhaltWeg={(key) => setOhneInhalte([...ohneInhalte, key])} />
          ))}
        </div>
      )}

      {frei.length > 0 && (
        <div className="np-nachwahl">
          <span className="np-nachwahl-kopf">Noch dazunehmen</span>
          {frei.map((g) => (
            <button key={g.apparatus} type="button" className="btn btn-sm"
              onClick={() => {
                setOhne(ohne.filter((k) => k !== g.apparatus))
                setZusatz([...zusatz, g.apparatus])
              }}>
              + {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="row mt8">
        <button className="btn btn-sm btn-primary" onClick={onZuTraining}>
          Training erfassen
        </button>
      </div>
    </Card>
  )
}

/**
 * Ein Gerät im Vorschlag.
 *
 * Die Kopfzeile trägt die Rolle, darunter stehen die Tätigkeiten, jede mit
 * ihrer Art und ihrem Umfang. **Keine Minuten** – der Umfang sagt, wie viel
 * Raum etwas bekommen soll, und behauptet keine Zeitverteilung.
 *
 * Die Begründungen sind **eingeklappt**: Ausgeschrieben wären es je Gerät fünf
 * bis acht Sätze, und aus dem Block würde eine Textwand. Sie fehlen aber
 * nicht – ein Tipp, und jede Zeile sagt, woraus sie entstanden ist.
 */
function NaechstesGeraet({
  g, nummer, erste, letzte, wettkampf, zurueckgestellt, anpassung,
  onWeg, onHoch, onRunter, onInhaltWeg,
}: {
  g: GeraetPlan
  nummer: number
  erste: boolean
  letzte: boolean
  /** Phase-3C-Kontext, oder leer. Ändert am Vorschlag nichts. */
  wettkampf: string[]
  /** Satz über zurückgestellte Entwicklungsarbeit (3D), oder `null`. */
  zurueckgestellt: string | null
  /** Was Phase 3D hier geändert hat, oder `null`. */
  anpassung: VorbereitungsAnpassung | null
  onWeg: () => void
  onHoch: () => void
  onRunter: () => void
  onInhaltWeg: (key: string) => void
}) {
  const [offen, setOffen] = useState(false)

  return (
    <div className="np-geraet">
      <div className="np-kopf">
        <span className="np-nr">{nummer}.</span>
        <span className="np-name">{g.name}</span>
        {g.rolle && (
          <span className={`np-rolle np-rolle-${g.rolle}`}>{ROLLE_LABEL[g.rolle]}</span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onHoch}
          disabled={erste} aria-label={`${g.name} nach oben`}>↑</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRunter}
          disabled={letzte} aria-label={`${g.name} nach unten`}>↓</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onWeg}
          aria-label={`${g.name} abwählen`}>abwählen</button>
      </div>

      <div className="np-reihenfolge">{REIHENFOLGE_TEXT[g.reihenfolgeArt]}</div>

      {/* Nur Kontext. Was unten steht, ist deshalb nicht anders geworden. */}
      {wettkampf.length > 0 && (
        <div className="np-wettkampf">{wettkampf.join(' · ')}</div>
      )}

      {g.inhalte.length === 0 ? (
        <div className="muted small">Alle Inhalte entfernt – das Gerät bleibt stehen.</div>
      ) : (
        <div className="np-inhalte">
          {g.inhalte.map((i) => (
            <div className="np-inhalt" key={i.key}>
              <div className="np-inhalt-kopf">
                <span className={`np-art np-art-${i.art}`}>{INHALT_ART_LABEL[i.art]}</span>
                <span className="np-inhalt-text">{i.text}</span>
                <span className="np-umfang">{UMFANG_LABEL[i.umfang]}</span>
                <button type="button" className="btn btn-sm btn-ghost np-weg"
                  onClick={() => onInhaltWeg(i.key)}
                  aria-label={`„${i.text}" entfernen`}>×</button>
              </div>
              {offen && i.warum.length > 0 && (
                <div className="np-inhalt-grund">{i.warum.join(' ')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Zurueckgestellt, nicht verworfen: Nach dem Wettkampf steht der
          Kandidat von selbst wieder im Vorschlag. */}
      {zurueckgestellt && (
        <div className="np-zurueckgestellt">{zurueckgestellt}</div>
      )}

      {g.hinweise.map((h) => <div className="np-hinweis" key={h}>{h}</div>)}

      <button type="button" className="btn btn-sm btn-ghost np-warum"
        onClick={() => setOffen(!offen)} aria-expanded={offen}>
        {offen ? '▴ Begründung zu' : '▾ Warum dieses Gerät?'}
      </button>
      {offen && (
        <div className="np-begruendung">
          {g.warum.map((s, i) => <p key={i}>{s}</p>)}
          {/* Keine Blackbox: Was haette ohne Wettkampfkontext dagestanden,
              und was hat Phase 3D daran geaendert? */}
          {anpassung && (
            <>
              {anpassung.ohneWettkampf.map((t) => <p key={t}>{t}</p>)}
              {anpassung.durchVorbereitung.map((t) => <p key={t}><em>{t}</em></p>)}
            </>
          )}
        </div>
      )}
    </div>
  )
}
