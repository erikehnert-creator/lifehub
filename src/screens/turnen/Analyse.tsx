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
 * Die Rechnung liegt vollständig in `core/turnen/analyse.ts` und
 * `core/turnen/vergleich.ts`. Hier wird nur angezeigt.
 */
import React, { useMemo, useState } from 'react'
import { Card, Empty, Collapsible, Segment } from '../../ui/components'
import { LineChart, ChartFrame } from '../../charts'
import { useData } from '../../state/store'
import { formatDay } from '../../core/dates'
import { GERAETE, geraetName } from '../../core/turnen/geraete'
import { formatNote, MINDESTPUNKTE_LINIE } from '../../core/turnen/wettkampf'
import {
  FOKUS_LABEL, analyseBild, richtung,
  type Fokus, type GeraetAnalyse, type Messwert, type VerlaufsPunkt,
} from '../../core/turnen/analyse'

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
