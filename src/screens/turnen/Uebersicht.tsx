/**
 * TURNEN · ÜBERSICHT – was ansteht, und was liegenbleibt.
 *
 * ---------------------------------------------------------------------------
 * Seit Phase 3A steht hier ein Vorschlag
 *
 * Bis dahin war dieser Bildschirm ausdrücklich beschreibend: „Pauschenpferd
 * seit 18 Tagen nicht" ist eine Beobachtung, „trainiere Pauschenpferd" wäre
 * eine Empfehlung. Die gibt es jetzt – aber nur so weit, wie die Daten tragen:
 * **Nächstes Training** (`core/turnen/trainingsplanung.ts`) ordnet den
 * Trainingsfokus aus Phase 2D in die Form um, in der man vor der Halle danach
 * fragt, und begründet jede Zeile mit vorhandenen Zahlen.
 *
 * Warum hier und nicht in einem eigenen Reiter: Die Frage „was turne ich
 * heute?" stellt sich beim Aufschlagen, nicht nach zwei Klicks. Ein siebter
 * Reiter für einen Block wäre ausserdem ein Reiter, der nach dem Training
 * nichts mehr zu sagen hat.
 *
 * Kein Kalender, keine Schichtplanung, keine erzeugten Termine – das bleibt
 * Phase 5 (TURNEN_ARCHITEKTUR.md).
 *
 * ---------------------------------------------------------------------------
 * Seit Phase 3C steht der Wettkampf darüber
 *
 * **Nächster Wettkampf** (`Wettkampfziel.tsx`) nennt den Termin, den Abstand
 * in Kalendertagen und je Gerät den Stand der aktuellen Wettkampfkür. Er steht
 * oberhalb des Trainingsvorschlags, weil er der Rahmen ist, in dem man ihn
 * liest – aber der Vorschlag hängt nicht daran: Ohne eingetragenen Wettkampf
 * bleibt alles darunter unverändert.
 *
 * Und umgekehrt: Der Termin hängt nicht am Elementkatalog. Steht ein Wettkampf
 * an, während noch kein Element erfasst ist, erscheint die Karte **über** dem
 * Einstieg statt hinter ihm. Erfunden wird dabei nichts – kein Element, keine
 * Kür, keine Gerätekarte; die Karte sagt, dass Turndaten fehlen.
 *
 * Eine Bildschirmhöhe, nicht mehr: Vorschlag, Gerätekacheln, was zu lange her
 * ist, was unsicher steht. Alles Weitere steht in den anderen Reitern.
 */
import React, { useMemo } from 'react'
import { Card, Stat, Empty } from '../../ui/components'
import { BarChart, ChartFrame } from '../../charts'
import { useData } from '../../state/store'
import { todayString, formatDay, formatDuration, diffDays, addDays } from '../../core/dates'
import { GERAETE, geraetName } from '../../core/turnen/geraete'
import { BRAUCHT_ARBEIT, statusDef } from '../../core/turnen/status'
import {
  bloeckeMitTag, elementBild, geraetBilder, langeNichtTrainiert,
} from '../../core/turnen/elemente'
import { versucheGesamt } from '../../core/turnen/versuche'
import { absolvierteTurneinheiten } from '../../core/turnen/einheiten'
import { NaechstesTraining } from './NaechstesTraining'
import { WettkampfZielKarte } from './Wettkampfziel'
import { useTurnenBild } from './bild'

export function UebersichtView({ onZuElementen, onZuTraining, onZuWettkaempfen }: {
  onZuElementen: () => void
  onZuTraining: () => void
  onZuWettkaempfen: () => void
}) {
  const data = useData()
  const heute = todayString()

  /**
   * Phase 3A, 3B und 3C rechnen auf denselben Zwischenergebnissen – deshalb
   * **ein** Aufruf hier und nicht einer je Block (siehe `bild.ts`).
   */
  const { plan, ziel } = useTurnenBild()

  /**
   * Die absolvierten Einheiten – ausdrücklich ohne die geplanten und ohne die,
   * die noch bevorstehen.
   *
   * Seit Phase 3B kann eine Turneinheit als Termin in der Zukunft stehen.
   * Sie in „Letzte Einheit" oder „Einheiten gesamt" mitzuzählen hiesse, ein
   * Training zu behaupten, das nicht stattgefunden hat – und „Letzte Einheit"
   * stünde in der Zukunft. Was zählt, entscheidet
   * `core/turnen/einheiten.ts`, damit hier und anderswo dasselbe gilt.
   */
  const einheiten = useMemo(
    () => absolvierteTurneinheiten(data.workoutSessions, heute),
    [data.workoutSessions, heute],
  )
  const letzte = einheiten[0] ?? null

  const bloecke = useMemo(
    () => bloeckeMitTag(data.gymAttempts, data.workoutSessions),
    [data.gymAttempts, data.workoutSessions],
  )

  const aktiveElemente = useMemo(
    () => data.gymElements.filter((e) => !e.deleted_at && e.is_active),
    [data.gymElements],
  )

  const bilder = useMemo(
    () => aktiveElemente.map((e) => elementBild(e, bloecke, heute, diffDays)),
    [aktiveElemente, bloecke, heute],
  )

  const geraete = useMemo(
    () => geraetBilder(data.gymElements, bloecke, heute, diffDays, BRAUCHT_ARBEIT),
    [data.gymElements, bloecke, heute],
  )

  const liegengeblieben = useMemo(() => langeNichtTrainiert(bilder, 5), [bilder])

  const brauchtArbeit = useMemo(
    () => bilder
      .filter((b) => BRAUCHT_ARBEIT.includes(b.element.status as any))
      .sort((a, b) => (b.tageHer ?? 9999) - (a.tageHer ?? 9999))
      .slice(0, 6),
    [bilder],
  )

  /** Versuche je Gerät in den letzten acht Wochen – die Häufigkeit auf einen Blick. */
  const haeufigkeit = useMemo(() => {
    const ab = addDays(heute, -55)
    const jeGeraet = new Map<string, number>()
    const geraetVon = new Map(data.gymElements.map((e) => [e.id, e.apparatus]))
    for (const { block, day } of bloecke) {
      if (day < ab) continue
      const g = geraetVon.get(block.element_id)
      if (!g) continue
      jeGeraet.set(g, (jeGeraet.get(g) ?? 0) + versucheGesamt(block))
    }
    return GERAETE.map((g) => ({ label: g.kurz, values: [jeGeraet.get(g.key) ?? 0] }))
  }, [bloecke, data.gymElements, heute])

  const hatDaten = einheiten.length > 0 || aktiveElemente.length > 0

  /**
   * Noch kein Element, kein Training – aber vielleicht schon ein Termin.
   *
   * Der Einstieg bleibt, wie er war. **Darüber** steht der kommende Wettkampf,
   * falls einer eingetragen ist: Ein Termin ist eine eigenständige Auskunft und
   * hängt nicht daran, ob der Elementkatalog schon gepflegt ist. Ihn hinter dem
   * Element-Onboarding zu verstecken hiesse, die Information unerreichbar zu
   * machen, obwohl sie dasteht.
   *
   * Erfunden wird dabei **nichts**: keine Elemente, keine Kür, keine
   * Gerätekarten. Die Karte zeigt Name, Datum und Abstand – und sagt, dass
   * Turndaten fehlen.
   */
  if (!hatDaten) {
    return (
      <>
        {ziel.naechster && (
          <WettkampfZielKarte ziel={ziel} ohneTurndaten
            onZuWettkaempfen={onZuWettkaempfen} />
        )}
        <Empty title="Turnen ist eingerichtet, aber noch leer"
          hint="Lege zuerst ein paar Elemente an – danach dauert das Erfassen eines Trainings unter einer Minute."
          action={<button className="btn btn-primary" onClick={onZuElementen}>Elemente anlegen</button>} />
      </>
    )
  }

  return (
    <>
      <div className="grid grid-3 keep2 mb16">
        <Card>
          <Stat label="Letzte Einheit"
            value={letzte ? formatDay(letzte.day, 'short') : '–'}
            sub={letzte
              ? <span className="muted small">
                  {diffDays(letzte.day, heute) === 0 ? 'heute' : `vor ${diffDays(letzte.day, heute)} Tagen`}
                  {letzte.duration_minutes ? ` · ${formatDuration(letzte.duration_minutes)}` : ''}
                </span>
              : undefined} />
        </Card>
        <Card><Stat small label="Einheiten gesamt" value={String(einheiten.length)} /></Card>
        <Card><Stat small label="Elemente" value={String(aktiveElemente.length)} /></Card>
      </div>

      {/* Der Wettkampf steht ueber dem Trainingsvorschlag: Er ist der
          Rahmen, in dem die naechste Einheit gelesen wird. Der Vorschlag
          selbst haengt NICHT daran - ohne Wettkampf bleibt er unveraendert. */}
      <WettkampfZielKarte ziel={ziel} onZuWettkaempfen={onZuWettkaempfen} />

      <NaechstesTraining bild={plan} ziel={ziel} onZuTraining={onZuTraining} />

      {/* Die Geräte sind die Achse von allem – deshalb stehen sie oben und
          nicht als eigener Reiter (siehe TURNEN_ARCHITEKTUR.md, 7.2). */}
      <Card className="mb16" title="Geräte" sub="Tage seit dem letzten Training">
        <div className="turn-kacheln">
          {GERAETE.map((g) => {
            const b = geraete.get(g.key)
            return (
              <button className="turn-kachel" key={g.key} onClick={onZuElementen}>
                <div className="turn-kachel-name">{g.name}</div>
                <div className="turn-kachel-zahl">
                  {b?.tageHer === null || b?.tageHer === undefined
                    ? '–'
                    : b.tageHer === 0 ? 'heute' : `${b.tageHer} T`}
                </div>
                <div className="turn-kachel-zusatz">
                  {b?.elemente ?? 0} Elemente
                  {b?.brauchtArbeit ? ` · ${b.brauchtArbeit} offen` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      <div className="karten-spalten">
        <Card title="Lange nicht trainiert" sub="Nie Geturntes zuerst">
          {liegengeblieben.length === 0 ? (
            <Empty kompakt title="Keine Elemente angelegt." />
          ) : (
            <div className="list kompakt">
              {liegengeblieben.map((b) => (
                <div className="list-row" key={b.element.id}>
                  <span className="list-main">
                    <span className="list-title">{b.element.name}</span>
                    <span className="list-sub">{geraetName(b.element.apparatus)}</span>
                  </span>
                  <span className="list-amount">
                    {b.tageHer === null ? 'nie' : `${b.tageHer} T`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Braucht noch Arbeit" sub="Neu, im Aufbau oder unsicher">
          {brauchtArbeit.length === 0 ? (
            <Empty kompakt title="Nichts offen." />
          ) : (
            <div className="list kompakt">
              {brauchtArbeit.map((b) => (
                <div className="list-row" key={b.element.id}>
                  <span className="list-main">
                    <span className="list-title">{b.element.name}</span>
                    <span className="list-sub">
                      {geraetName(b.element.apparatus)} · {statusDef(b.element.status).label}
                      {b.fenster.quote !== null && ` · ${Math.round(b.fenster.quote * 100)} %`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt16" title="Versuche je Gerät" sub="Die letzten acht Wochen">
        <ChartFrame title="Versuche je Gerät" sub="Die letzten acht Wochen">
          {({ height }) => (
            <BarChart data={haeufigkeit} seriesNames={['Versuche']} height={height}
              formatValue={(v) => `${Math.round(v)} Versuche`}
              formatAxis={(v) => String(Math.round(v))} />
          )}
        </ChartFrame>
        <div className="row mt8">
          <button className="btn btn-sm btn-primary" onClick={onZuTraining}>Training erfassen</button>
        </div>
      </Card>
    </>
  )
}
