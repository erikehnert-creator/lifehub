/**
 * TURNEN · ANALYSE – wo ich im Feld stand, und wo der Ansatzpunkt liegt.
 *
 * ---------------------------------------------------------------------------
 * Eine niedrigere Note ist kein schwächeres Gerät
 *
 * Am Sprung reichten 11,000 für den ersten Platz, am Boden reichten 11,566 für
 * den vierten. Deshalb steht auf jeder Kachel der **Platz im Feld** gross und
 * die Rohnote daneben – nicht umgekehrt. Wo die höchste Rohnote nicht das
 * relativ stärkste Gerät ist, sagt die Seite das ausdrücklich.
 *
 * ---------------------------------------------------------------------------
 * Was hier nicht steht
 *
 * Keine Punktprognose, kein Leistungsindex, keine Ursachenbehauptung. Die
 * interne Vergleichszahl (`position()`) erscheint nirgends; angezeigt werden
 * Platz und Feldgrösse, weil nur die beiden zusammen etwas bedeuten. Bei jedem
 * Platz steht die Feldgrösse dabei – „1. von 2" ist eine andere Auskunft als
 * „1. von 20".
 *
 * ---------------------------------------------------------------------------
 * Trainingsfokus
 *
 * Unter der Leistungsanalyse steht, was daraus für das Training folgt
 * (`core/turnen/trainingsfokus.ts`). Zwei Ebenen, getrennt gehalten: Die
 * Gerätepriorität kommt aus dem Wettkampf, die inhaltliche Lage aus Kür und
 * Training. Elemente werden als **Kandidaten** benannt, nie als Punktgewinn,
 * und ein auffälliges Element ist eine Beobachtung aus dem Training – keine
 * Ursache der Wettkampfnote.
 *
 * Die Rechnung liegt vollständig in `core/turnen/analyse.ts`,
 * `core/turnen/vergleich.ts` und `core/turnen/trainingsfokus.ts`. Hier wird nur
 * angezeigt.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty, Collapsible, Segment } from '../../ui/components'
import { LineChart, ChartFrame } from '../../charts'
import { useData } from '../../state/store'
import { formatDay, diffDays, todayString } from '../../core/dates'
import { GERAETE, geraetName } from '../../core/turnen/geraete'
import { formatNote, MINDESTPUNKTE_LINIE } from '../../core/turnen/wettkampf'
import { statusLabel } from '../../core/turnen/status'
import { schwierigkeitText, schwierigkeitAus } from '../../core/turnen/kueren'
import {
  FOKUS_LABEL, analyseBild, richtung,
  type Fokus, type GeraetAnalyse, type Messwert, type VerlaufsPunkt,
} from '../../core/turnen/analyse'
import {
  EMPFEHLUNG_LABEL, KEIN_KANDIDAT_TEXT, KUER_AM_STUECK_TEXT, LAGE_LABEL,
  PRIORITAET_LABEL, STABILITAET_LABEL, trainingsfokus,
  type ElementLage, type GeraetFokus, type Prioritaet,
} from '../../core/turnen/trainingsfokus'

/** Ein Platz mit seiner Feldgrösse – nie das eine ohne das andere. */
function platzText(m: Messwert): string | null {
  if (m.rang === null || m.anzahl === null) return null
  const geteilt = (m.gleich ?? 1) > 1 ? ' geteilt' : ''
  return `${m.rang}.${geteilt} von ${m.anzahl}`
}

/** Ein Abstand mit Vorzeichen: „+0,566", „−0,733", „0". */
function abstandText(n: number | null): string {
  if (n === null) return '—'
  if (n === 0) return '0'
  return (n > 0 ? '+' : '−') + formatNote(Math.abs(n))
}

/**
 * Die Fokusmarke.
 *
 * Grün nur für „Stärke halten" – das ist die einzige Aussage, die eine
 * Bewertung trägt. Ein Ansatzpunkt ist kein Fehler und bekommt deshalb keine
 * Warnfarbe; er steht neutral da.
 */
function FokusPill({ fokus }: { fokus: Fokus }) {
  if (fokus === 'zu_wenig_daten') {
    return <span className="pill">kein Vergleichsfeld</span>
  }
  const gut = fokus === 'halten'
  return (
    <span className={gut ? 'pill good' : 'pill'}>
      {gut ? FOKUS_LABEL[fokus] : `Fokus: ${FOKUS_LABEL[fokus]}`}
    </span>
  )
}

export function AnalyseView({ onZuWettkaempfen }: { onZuWettkaempfen: () => void }) {
  const data = useData()

  // EIN Durchgang ueber die Daten, gemerkt. Ohne das wertete jedes Zeichnen
  // alle Wettkaempfe neu aus (CLAUDE.md: nur die betroffene Tabelle laden,
  // und nicht bei jedem Render rechnen).
  const bild = useMemo(
    () => analyseBild(data.gymCompetitions, data.gymResults, data.gymBenchmarks),
    [data.gymCompetitions, data.gymResults, data.gymBenchmarks],
  )

  if (!bild.aktuell) {
    return (
      <Empty title="Noch kein Wettkampfergebnis"
        hint="Die Analyse braucht mindestens einen Wettkampf mit eingetragenen Noten. Am meisten sagt sie, wenn das Protokoll als PDF importiert wurde – dann kennt LifeHub auch das Teilnehmerfeld."
        action={<button className="btn btn-primary" onClick={onZuWettkaempfen}>Zu den Wettkämpfen</button>} />
    )
  }

  const a = bild.aktuell

  return (
    <>
      <Card title="Aktueller Stand"
        sub={`${a.wettkampf.name} · ${formatDay(a.wettkampf.day)}`}>

        <div className="an-kopf">
          {a.klasse && <span className="pill">{a.klasse}</span>}
          {a.feldgroesse !== null && (
            <span className="pill">{a.feldgroesse} Turner im Feld</span>
          )}
          {a.mehrkampf && platzText(a.mehrkampf) && (
            <span className="pill">Mehrkampf {platzText(a.mehrkampf)}</span>
          )}
        </div>

        {!a.hatVergleich && (
          <div className="hint-box small">
            Zu diesem Wettkampf liegt <strong>kein Vergleichsfeld</strong> vor – er
            wurde von Hand erfasst. Die eigenen Werte stehen unten; Geräteplätze,
            Median und Bestwert erfindet LifeHub nicht. Wird das Protokoll als PDF
            importiert, kommen sie dazu.
          </div>
        )}

        {a.rohnoteTaeuscht && (
          <div className="hint-box small">
            <strong>Die höchste Note ist nicht das stärkste Gerät.</strong>{' '}
            Deine höchste Endnote stand {a.hoechsteRohnote.map(geraetName).join(' und ')} – im
            Feld am besten stand{a.staerkste.length > 1 ? 'en' : ''}{' '}
            {a.staerkste.map(geraetName).join(' und ')}. Eine Note sagt erst
            etwas, wenn daneben steht, was die anderen an demselben Gerät
            geturnt haben.
          </div>
        )}

        <div className="wk-liste">
          {a.geraete.map((g) => <GeraetKarte key={g.apparatus} g={g} />)}
        </div>
      </Card>

      {a.hatVergleich && <StaerkenCard analyse={a} />}
      {a.hatVergleich && a.hebel.length > 0 && <HebelCard hebel={a.hebel} />}

      <VerlaufCard verlauf={bild.verlauf} wettkaempfe={bild.wettkaempfe.length} />

      <TrainingsfokusCard />
    </>
  )
}

/* ========================================================= Gerätekachel */

function GeraetKarte({ g }: { g: GeraetAnalyse }) {
  const platz = platzText(g.final)
  return (
    <div className="wk-karte">
      <div className="wk-karte-kopf">
        <span className="wk-geraet">{g.name}</span>
        {platz && <span className="pill good">{platz}</span>}
        <span style={{ flex: 1 }} />
        <FokusPill fokus={g.fokus} />
      </div>

      <div className="wk-noten">
        <span className="wk-note">
          <span className="wk-note-name">D</span>
          <span className="wk-note-wert">{formatNote(g.d.wert)}</span>
          {platzText(g.d) && <span className="an-platz">{platzText(g.d)}</span>}
        </span>
        <span className="wk-note">
          <span className="wk-note-name">E</span>
          <span className="wk-note-wert">{formatNote(g.e.wert)}</span>
          {platzText(g.e) && <span className="an-platz">{platzText(g.e)}</span>}
        </span>
        <span className="wk-note stark">
          <span className="wk-note-name">Endnote</span>
          <span className="wk-note-wert">{formatNote(g.final.wert)}</span>
          {platzText(g.final) && <span className="an-platz">{platzText(g.final)}</span>}
        </span>
      </div>

      {g.hatVergleich && (
        <div className="an-abstand">
          zum Feldmedian <strong>{abstandText(g.final.abstandMedian)}</strong>
          {' · '}zum Besten <strong>{abstandText(g.final.abstandBest)}</strong>
        </div>
      )}

      {g.hatVergleich && (
        <Collapsible label="Zahlen und Begründung">
          <div className="an-tabelle">
            <div className="an-zeile an-kopfzeile">
              <span />
              <span>dein Wert</span>
              <span>Median</span>
              <span>Bestwert</span>
              <span>Platz</span>
            </div>
            <MesswertZeile name="D-Wert" m={g.d} />
            <MesswertZeile name="E-Wert" m={g.e} />
            <MesswertZeile name="Endnote" m={g.final} />
          </div>
          <div className="an-begruendung">{g.begruendung}</div>
          {g.feldgroesse !== null && (
            <div className="muted small mt8">
              Verglichen wurde gegen {g.feldgroesse} Turner derselben Klasse
              desselben Wettkampfs. Was eine höhere Schwierigkeit an Endnote
              bringt, hängt an der Ausführung, die dann noch möglich ist – das
              sagt diese Rechnung nicht.
            </div>
          )}
        </Collapsible>
      )}
    </div>
  )
}

function MesswertZeile({ name, m }: { name: string; m: Messwert }) {
  return (
    <div className="an-zeile">
      <span className="an-zeile-name">{name}</span>
      <span>{formatNote(m.wert)}</span>
      <span>{formatNote(m.median)}</span>
      <span>{formatNote(m.best)}</span>
      <span>{platzText(m) ?? '—'}</span>
    </div>
  )
}

/* ============================================================== Stärken */

function StaerkenCard({ analyse }: { analyse: NonNullable<ReturnType<typeof analyseBild>['aktuell']> }) {
  const stark = analyse.geraete.filter((g) => g.fokus === 'halten')
  return (
    <Card title="Stärken" sub="Geräte, an denen im Feld nichts hinterherhängt">
      {stark.length === 0 ? (
        <div className="muted small">
          An keinem Gerät lagen Schwierigkeit und Ausführung beide über der Mitte
          des Feldes. Das ist eine Beobachtung zu diesem einen Wettkampf, keine
          Bewertung deines Turnens.
        </div>
      ) : (
        <div className="kennzeilen">
          {stark.map((g) => (
            <div key={g.apparatus} className="kennzeile">
              <span className="kennzeile-name">{g.name}</span>
              <span className="kennzeile-wert">
                {platzText(g.final) ?? '—'}
                <span className="muted small">
                  {' · '}D {platzText(g.d) ?? '—'} · E {platzText(g.e) ?? '—'}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* =============================================================== Hebel */

function HebelCard({ hebel }: { hebel: GeraetAnalyse[] }) {
  return (
    <Card title="Grösste Hebel" sub="Wo im Feld am meisten fehlt – das schwächste zuerst">
      <div className="an-hebel">
        {hebel.map((g) => (
          <div key={g.apparatus} className="an-hebel-zeile">
            <div className="an-hebel-kopf">
              <span className="wk-geraet">{g.name}</span>
              <FokusPill fokus={g.fokus} />
            </div>
            <div className="an-hebel-text">{g.begruendung}</div>
          </div>
        ))}
      </div>
      <div className="muted small mt8">
        Eine Einordnung aus Plätzen im Feld, keine Trainingsvorgabe. Was daraus
        folgt, entscheidest du – und dein Trainer.
      </div>
    </Card>
  )
}

/* ============================================================= Verlauf */

function VerlaufCard({ verlauf, wettkaempfe }: {
  verlauf: Map<string, VerlaufsPunkt[]>
  wettkaempfe: number
}) {
  const [art, setArt] = useState<'final' | 'd' | 'e'>('final')

  // Ein Verlauf braucht mehr als einen Wettkampf. Bei einem waere die Karte
  // eine Linie durch einen Punkt - also nichts.
  if (wettkaempfe < 2) {
    return (
      <Card title="Verlauf">
        <div className="muted small">
          Für einen Verlauf reicht ein Wettkampf nicht. Ab dem zweiten stehen hier
          D-Wert, E-Wert und Endnote je Gerät – und, wo ein Protokoll importiert
          wurde, der Platz im jeweiligen Feld.
        </div>
      </Card>
    )
  }

  const LABEL: Record<typeof art, string> = {
    final: 'Endnote', d: 'D-Wert', e: 'E-Wert',
  }

  return (
    <Card title="Verlauf" sub={`${wettkaempfe} Wettkämpfe mit Ergebnis`}
      action={
        <Segment options={[
          { value: 'final', label: 'Endnote' },
          { value: 'd', label: 'D' },
          { value: 'e', label: 'E' },
        ]} value={art} onChange={setArt} />
      }>

      {GERAETE.filter((g) => verlauf.has(g.key)).map((g) => {
        const punkte = verlauf.get(g.key) as VerlaufsPunkt[]
        const werte = punkte.map((p) => p[art])
        const da = punkte.filter((p) => p[art] !== null)
        const r = richtung(werte)

        return (
          <div key={g.key} className="mb12">
            <div className="wk-verlauf-kopf">
              <span className="wk-geraet">{g.name}</span>
              <span className="muted small">
                {da.length === 1 ? '1 Start' : `${da.length} Starts`}
                {r === 'hoeher' && ' · die Werte lagen durchgehend höher'}
                {r === 'niedriger' && ' · die Werte lagen durchgehend niedriger'}
              </span>
            </div>

            {da.length < MINDESTPUNKTE_LINIE ? (
              <div className="an-punkte">
                {da.map((p) => (
                  <span key={p.competitionId} className="an-punkt">
                    <span className="muted small">{formatDay(p.day)}</span>
                    <strong>{formatNote(p[art])}</strong>
                    {p.rang !== null && p.anzahl !== null && (
                      <span className="an-platz">{p.rang}. von {p.anzahl}</span>
                    )}
                  </span>
                ))}
                <div className="muted small mt8">
                  Für eine Linie sind das zu wenige Werte – hier stehen sie einzeln.
                </div>
              </div>
            ) : (
              <>
                <ChartFrame title={`${g.name} · ${LABEL[art]}`}>
                  {({ height }) => (
                    <LineChart height={height}
                      series={[{
                        name: LABEL[art],
                        points: da.map((p) => ({
                          label: formatDay(p.day), value: p[art] as number,
                        })),
                      }]}
                      formatValue={(n) => formatNote(n)}
                      formatAxis={(n) => formatNote(n)} />
                  )}
                </ChartFrame>
                <div className="an-punkte">
                  {da.map((p) => (
                    <span key={p.competitionId} className="an-punkt">
                      <span className="muted small">{formatDay(p.day)}</span>
                      {p.rang !== null && p.anzahl !== null ? (
                        <span className="an-platz">{p.rang}. von {p.anzahl}</span>
                      ) : (
                        <span className="an-platz">kein Feld</span>
                      )}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}

      <div className="muted small mt8">
        Plätze werden <strong>nicht</strong> gemittelt: „2. von 3" und „2. von 20"
        sind nicht dasselbe. Deshalb steht bei jedem Platz die Feldgrösse. Wo eine
        Richtung genannt ist, beschreibt sie die Werte – über ihre Ursache sagt sie
        nichts.
      </div>
    </Card>
  )
}

/* ====================================================== Trainingsfokus */

/**
 * Die Prioritätsmarke.
 *
 * Nur „halten" ist grün. „Hoch" bekommt **keine** Warnfarbe: Es ist kein Fehler,
 * an einem Gerät zu arbeiten, und eine rote Kachel an drei von sechs Geräten
 * wäre eine Mängelliste statt einer Reihenfolge.
 */
function PrioPill({ p }: { p: Prioritaet }) {
  return (
    <span className={p === 'halten' ? 'pill good' : 'pill'}>
      Priorität: {PRIORITAET_LABEL[p]}
    </span>
  )
}

/** Wann zuletzt – und wenn nie, dann das. */
function zuletztText(l: ElementLage): string {
  if (l.tageHer === null) return 'nie trainiert'
  if (l.tageHer === 0) return 'heute trainiert'
  if (l.tageHer === 1) return 'gestern trainiert'
  return `vor ${l.tageHer} Tagen`
}

/** Die Zählerstände eines Elements im Beobachtungsfenster. */
function zaehlerText(l: ElementLage): string {
  const f = l.fenster
  if (!f.versuche) return 'keine Versuche im Fenster'
  const teile = [`${f.clean} gelungen`]
  if (f.shaky) teile.push(`${f.shaky} wacklig`)
  if (f.failed) teile.push(`${f.failed} gestürzt`)
  if (f.mitHilfe) teile.push(`${f.mitHilfe}× mit Hilfe`)
  return `${teile.join(' · ')} (${f.versuche} Versuche)`
}

function TrainingsfokusCard() {
  const data = useData()
  const heute = todayString()

  // EIN Durchgang, gemerkt - wie bei der Leistungsanalyse. Gespeichert wird
  // nichts davon: Der Fokus aendert sich mit jedem Zaehler.
  const bild = useMemo(() => {
    const analyse = analyseBild(data.gymCompetitions, data.gymResults, data.gymBenchmarks)
    return trainingsfokus({
      analyse: analyse.aktuell,
      verlauf: analyse.verlauf,
      elemente: data.gymElements,
      versuche: data.gymAttempts,
      einheiten: data.workoutSessions,
      kueren: data.gymRoutines,
      kuerVerknuepfungen: data.gymRoutineElements,
      heute,
      tagDifferenz: diffDays,
    })
  }, [
    data.gymCompetitions, data.gymResults, data.gymBenchmarks,
    data.gymElements, data.gymAttempts, data.workoutSessions,
    data.gymRoutines, data.gymRoutineElements, heute,
  ])

  const mitAussage = bild.geraete.filter((g) => g.prioritaet !== 'zu_wenig_daten')

  return (
    <Card title="Trainingsfokus"
      sub="Was Aufmerksamkeit verdient – und welche erfassten Elemente dafür in Frage kommen">

      <div className="hint-box small">{KUER_AM_STUECK_TEXT}</div>

      {mitAussage.length === 0 ? (
        <div className="muted small">
          Für eine Priorität fehlen die Vergleichswerte. Importiere ein
          Wettkampfprotokoll – dann steht hier je Gerät, wo der Ansatzpunkt liegt.
        </div>
      ) : (
        <div className="wk-liste">
          {mitAussage.map((g) => <FokusKarte key={g.apparatus} g={g} />)}
        </div>
      )}

      <div className="muted small mt8">
        Die Reihenfolge kommt aus Wettkampffokus, relativer Position und
        Trainingslage – es gibt <strong>keine</strong> Gesamtnote. Ein auffälliges
        Element ist eine Beobachtung aus dem Training und keine Ursache deiner
        Wettkampfnote: Welcher Abzug auf welches Element ging, steht in keinem
        Protokoll.
      </div>
    </Card>
  )
}

function FokusKarte({ g }: { g: GeraetFokus }) {
  const schwierigkeit = useMemo(
    () => schwierigkeitAus(g.kuerElemente.map((x) => x.element)),
    [g.kuerElemente],
  )

  return (
    <div className="wk-karte">
      <div className="wk-karte-kopf">
        <span className="wk-geraet">{g.name}</span>
        <span style={{ flex: 1 }} />
        <PrioPill p={g.prioritaet} />
      </div>

      <div className="tf-zeilen">
        <div className="tf-zeile">
          <span className="tf-name">Wettkampf</span>
          <span className="tf-wert">{FOKUS_LABEL[g.wettkampfFokus]}</span>
        </div>
        <div className="tf-zeile">
          <span className="tf-name">Training</span>
          <span className="tf-wert">{LAGE_LABEL[g.lage]}</span>
        </div>
        <div className="tf-zeile">
          <span className="tf-name">Empfehlung</span>
          <span className="tf-wert stark">{EMPFEHLUNG_LABEL[g.empfehlung]}</span>
        </div>
      </div>

      {g.kandidaten.length > 0 && (
        <div className="tf-hinweis">
          {g.kandidaten.length === 1
            ? '1 mögliches Element als Kandidat'
            : `${g.kandidaten.length} mögliche Elemente als Kandidaten`}
        </div>
      )}

      <Collapsible label="Einzelheiten">
        <div className="tf-begruendung">
          {g.begruendung.map((satz, i) => <p key={i}>{satz}</p>)}
          {g.verlaufshinweis && <p className="muted">{g.verlaufshinweis}</p>}
        </div>

        <div className="tf-block">
          <div className="tf-block-kopf">
            Aktuelle Kür
            {g.kuer && <span className="muted small"> · {g.kuer.name}</span>}
          </div>
          {!g.kuer ? (
            <div className="muted small">
              Keine Wettkampfkür hinterlegt. Ohne sie gibt es keine Elementebene –
              markiere eine Kür als Wettkampfkür, dann steht hier mehr.
            </div>
          ) : g.kuerElemente.length === 0 ? (
            <div className="muted small">In dieser Kür steht noch kein Element.</div>
          ) : (
            <>
              <div className="muted small mb8">{schwierigkeitText(schwierigkeit)}</div>
              {g.kuerElemente.map((l) => (
                <div key={l.element.id} className="tf-element">
                  <div className="tf-element-kopf">
                    <span className="tf-platz">{l.platz}.</span>
                    <span className="tf-element-name">{l.element.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className={l.stabilitaet === 'stabil' ? 'pill good' : 'pill'}>
                      {STABILITAET_LABEL[l.stabilitaet]}
                    </span>
                  </div>
                  <div className="tf-element-zeile">
                    Status: {statusLabel(l.element.status)} · {zuletztText(l)}
                  </div>
                  <div className="tf-element-zeile">{zaehlerText(l)}</div>
                </div>
              ))}
              {g.geloeschtePlaetze.length > 0 && (
                <div className="tf-element-zeile">
                  {g.geloeschtePlaetze.length === 1
                    ? `Platz ${g.geloeschtePlaetze[0]}: Element gelöscht`
                    : `Plätze ${g.geloeschtePlaetze.join(', ')}: Elemente gelöscht`}
                </div>
              )}
            </>
          )}
        </div>

        {g.auffaellige.length > 0 && (
          <div className="tf-block">
            <div className="tf-block-kopf">Auffällige Elemente</div>
            {g.auffaellige.map((l) => (
              <div key={l.element.id} className="tf-element">
                <div className="tf-element-kopf">
                  <span className="tf-element-name">{l.element.name}</span>
                  <span style={{ flex: 1 }} />
                  <span className="pill">{STABILITAET_LABEL[l.stabilitaet]}</span>
                </div>
                <div className="tf-element-zeile">{zaehlerText(l)}</div>
                <div className="tf-element-zeile">
                  {l.auffaellig.map((a) => a.text).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="tf-block">
          <div className="tf-block-kopf">Kandidaten</div>
          {g.kandidaten.length === 0 ? (
            <div className="muted small">
              {g.keineKandidaten ? KEIN_KANDIDAT_TEXT[g.keineKandidaten] : ''}
            </div>
          ) : (
            <>
              {g.kandidaten.map((l) => (
                <div key={l.element.id} className="tf-element">
                  <div className="tf-element-kopf">
                    <span className="tf-element-name">{l.element.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className="pill good">{STABILITAET_LABEL[l.stabilitaet]}</span>
                  </div>
                  <div className="tf-element-zeile">
                    Schwierigkeit {formatNote(l.element.difficulty_value)}
                    {l.element.difficulty_letter ? ` (${l.element.difficulty_letter})` : ''}
                    {' · '}Status: {statusLabel(l.element.status)} · {zuletztText(l)}
                  </div>
                  <div className="tf-element-zeile">{zaehlerText(l)}</div>
                  <div className="tf-element-grund">
                    Steht nicht in der Kür, hat einen höheren Schwierigkeitswert als
                    das niedrigste Element darin und gelingt im Training zuverlässig.
                  </div>
                </div>
              ))}
              <div className="muted small mt8">
                <strong>Als Kandidat prüfen, nicht als Punktgewinn.</strong> Ob ein
                Element angerechnet wird, hängt an Elementgruppen,
                Anrechnungsgrenzen und der Wertungsvorschrift – nichts davon steht
                in LifeHub. Was ein Einbau an D-Wert brächte, sagt LifeHub deshalb
                nicht.
              </div>
            </>
          )}
        </div>
      </Collapsible>
    </div>
  )
}
