/**
 * Die Ernährung eines Tages.
 *
 * ---------------------------------------------------------------------------
 * Warum eigene Datei
 *
 * Tracking.tsx trägt Tageswerte, Verlauf, Training, Körper und Zielbereiche.
 * Die Ernährung ist davon der Teil, der seit FatSecret am meisten gewachsen
 * ist – sechzehn Nährwerte, die einzelnen Lebensmittel, der Zustand der
 * Anbindung. Sie hier zu führen hält beide Seiten übersichtlich, und der
 * Aufruf in Tracking.tsx bleibt eine Zeile.
 *
 * ---------------------------------------------------------------------------
 * Die Ordnung der Seite
 *
 * Nicht alles ist gleich wichtig, also sieht auch nicht alles gleich aus:
 *
 *   1. Die sechs Werte des Tages   groß, auf einen Blick, mit Zielbereich
 *   2. Was gegessen wurde          nach Mahlzeiten, als Begründung dazu
 *   3. Alles Weitere               eingeklappt – verfügbar, aber nicht im Weg
 *
 * Seit FatSecret die Zahlen von selbst liefert, ist die Seite zum Ablesen da
 * und nicht mehr zum Ausfüllen. Die Eingabefelder gibt es weiterhin, sie
 * stehen nur nicht mehr vorn: Wasser direkt (das trägt niemand in FatSecret
 * ein), der Rest hinter „Von Hand eintragen" für Tage ohne FatSecret.
 */
import { useMemo, useState } from 'react'
import { Card, Collapsible, Empty } from '../ui/components'
import { MetricInput } from '../ui/metricInput'
import { useData, useMutations } from '../state/store'
import { dayValue, evaluateZone, targetFor, type Zone } from '../core/metrics'
import { todayString } from '../core/dates'
import { darfBewerten, fortschrittProzent } from '../core/tagesfortschritt'
import { Icon, BEREICH_FARBE } from '../ui/icons'
import { formatNumber } from '../core/money'
import { NAEHRWERTE, WICHTIGE_NAEHRWERTE } from '../core/naehrwerte'
import type { Metric } from '../core/types'

/** Die Reihenfolge der Mahlzeiten – wie der Tag verläuft, nicht alphabetisch. */
export const MAHLZEITEN = [
  { key: 'breakfast', label: 'Frühstück', icon: '🌅' },
  { key: 'lunch', label: 'Mittag', icon: '🍽️' },
  { key: 'dinner', label: 'Abendessen', icon: '🌙' },
  { key: 'other', label: 'Snacks', icon: '🍎' },
] as const

/**
 * Die Werte, die oben stehen.
 *
 * Die fünf aus FatSecret plus Wasser. Wasser ist kein Nährwert im Sinne der
 * Schnittstelle – FatSecret liefert keine Trinkmenge –, gehört für Erik aber
 * genau hierher.
 */
const OBEN = [...WICHTIGE_NAEHRWERTE, 'water_l']

/* ------------------------------------------------------------- Bausteine */

/** Wie viel Prozent des Zielbereichs erreicht sind – für den Balken. */
function anteil(wert: number | null, zone: Zone): number {
  if (wert === null) return 0
  const ziel = zone.target ?? zone.greenMax ?? zone.greenMin
  if (!ziel) return 0
  return Math.max(0, Math.min(1, wert / ziel))
}

const ZONENFARBE: Record<string, string> = {
  optimal: 'var(--good)',
  tolerated: 'var(--warning)',
  outside: 'var(--critical)',
  unknown: 'var(--border-strong)',
}

/**
 * Welche Farbe der Balken einer Tageskachel trägt.
 *
 * Tagsüber die Bereichsfarbe: 400 kcal um neun Uhr sind Fortschritt, kein
 * Fehler. Erst wenn der Tag bewertbar ist (core/tagesfortschritt), kommt die
 * Statusfarbe des Zielbereichs.
 */
function balkenFarbe(metric: Metric, day: string, zone: Zone, heute: string, stunde: number): string {
  if (!darfBewerten(metric.aggregation, day, heute, stunde)) return 'var(--bereich-tracking)'
  return ZONENFARBE[zone.status]
}

/**
 * Ein Tageswert als Kachel: Zahl groß, Ziel klein, Balken in der Zonenfarbe.
 *
 * Bewusst ohne Eingabefeld. Ein Feld sieht aus wie Arbeit; hier steht aber in
 * aller Regel schon etwas drin, und zwar von FatSecret. Wer doch etwas ändern
 * will, klappt unten „Von Hand eintragen" auf.
 */
function Wertkachel({ metric, day }: { metric: Metric; day: string }) {
  const data = useData()
  const heute = todayString()
  const stunde = new Date().getHours()
  const wert = dayValue(data.metricEntries, metric, day)
  const target = targetFor(data.metricTargets, metric.id, day)
  const zone = evaluateZone(wert, target)
  const bewertet = darfBewerten(metric.aggregation, day, heute, stunde)
  const prozent = fortschrittProzent(wert, target?.target_value)

  return (
    <div className="wert-kachel">
      <div className="wert-kachel-name">{metric.name}</div>
      <div className="wert-kachel-zahl">
        {wert === null ? <span className="muted">–</span> : formatNumber(wert, metric.decimals)}
        <span className="wert-kachel-einheit">{metric.unit}</span>
      </div>
      <div className="meter" title={bewertet ? zone.label : 'Fortschritt zum Tagesziel'}>
        <span className="meter-fill" style={{
          width: `${(bewertet ? anteil(wert, zone) : Math.min(1, (prozent ?? 0) / 100)) * 100}%`,
          background: balkenFarbe(metric, day, zone, heute, stunde),
        }} />
      </div>
      <div className="wert-kachel-ziel">
        {target?.target_value
          ? (prozent !== null
            ? `${prozent} % von ${formatNumber(target.target_value, metric.decimals)} ${metric.unit}`
            : `Ziel ${formatNumber(target.target_value, metric.decimals)} ${metric.unit}`)
          : ' '}
      </div>
    </div>
  )
}

/**
 * Wasser: die einzige Zahl, die Erik hier noch selbst einträgt.
 *
 * Deshalb als einzige mit Knöpfen. Ein Glas sind 0,25 l, eine Flasche 0,5 l –
 * damit ist ein Tag mit drei Litern sechs bis zwölf Tipper statt einer
 * Rechenaufgabe im Kopf.
 */
function Wasserkachel({ metric, day }: { metric: Metric; day: string }) {
  const data = useData()
  const m = useMutations()
  const wert = dayValue(data.metricEntries, metric, day)
  const target = targetFor(data.metricTargets, metric.id, day)
  const zone = evaluateZone(wert, target)

  const eintrag = data.metricEntries.find(
    (e) => !e.deleted_at && e.metric_id === metric.id && e.day === day,
  )

  const dazu = (menge: number) => {
    const neu = Math.round(((wert ?? 0) + menge) * 100) / 100
    if (neu <= 0) {
      if (eintrag) m.remove('metric_entries', eintrag.id, 'Wasser zurückgesetzt')
      return
    }
    if (eintrag) m.patch('metric_entries', eintrag.id, { value_num: neu })
    else m.create('metric_entries', { metric_id: metric.id, day, value_num: neu, source: 'manual' })
  }

  return (
    <div className="wert-kachel">
      <div className="wert-kachel-name">{metric.name}</div>
      <div className="wert-kachel-zahl">
        {wert === null ? <span className="muted">–</span> : formatNumber(wert, metric.decimals)}
        <span className="wert-kachel-einheit">{metric.unit}</span>
      </div>
      <div className="meter" title={zone.label}>
        <span className="meter-fill"
          style={{ width: `${anteil(wert, zone) * 100}%`, background: ZONENFARBE[zone.status] }} />
      </div>
      {/*
        Kurze Beschriftungen, weil die Kachel auf dem Handy rund 150 px breit
        ist: „+ Glas" und „+ Flasche" brachen dort in zwei Zeilen um und
        machten die ganze Kachelreihe höher. „¼ l" und „½ l" sagen dasselbe
        und passen nebeneinander.
      */}
      {/* nowrap: Sobald „−" daneben stand, brach „+¼ l" in „+¼" und „l" um. */}
      <div className="wasser-knoepfe">
        <button className="btn btn-sm" title="Ein Glas (0,25 l)" onClick={() => dazu(0.25)}>+¼ l</button>
        <button className="btn btn-sm" title="Eine Flasche (0,5 l)" onClick={() => dazu(0.5)}>+½ l</button>
        {wert !== null && (
          <button className="btn btn-sm btn-ghost" title="Ein Glas zurücknehmen"
            onClick={() => dazu(-0.25)} aria-label="Ein Glas zurücknehmen">−</button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Die Seite */

/**
 * Die sechs Tageswerte als Kachelreihe.
 *
 * Steht bewusst an zwei Stellen: hier auf der Ernährungsseite und auf der
 * Startseite. Vorher war es zweimal derselbe Gedanke in zwei verschiedenen
 * Fassungen – einmal mit `Meter`, einmal mit `.meter`, einmal über
 * `toLocaleString`, einmal über `formatNumber`. Dasselbe soll auch gleich
 * aussehen, sonst wirkt eine App wie mehrere nebeneinander.
 */
export function TageswertKacheln({ day }: { day: string }) {
  const data = useData()
  const oben = useMemo(() => {
    const nachKey = new Map(
      data.metrics.filter((x) => !x.deleted_at && x.is_enabled).map((x) => [x.key, x]),
    )
    return OBEN.map((k) => nachKey.get(k)).filter((x): x is Metric => !!x)
  }, [data.metrics])

  return (
    <div className="wert-kacheln">
      {oben.map((metric) => (
        metric.key === 'water_l'
          ? <Wasserkachel key={metric.id} metric={metric} day={day} />
          : <Wertkachel key={metric.id} metric={metric} day={day} />
      ))}
    </div>
  )
}

export function ErnaehrungsTag({ day }: { day: string }) {
  const data = useData()

  const { oben, weitere } = useMemo(() => {
    const nachKey = new Map(
      data.metrics.filter((x) => !x.deleted_at && x.is_enabled).map((x) => [x.key, x]),
    )
    return {
      oben: OBEN.map((k) => nachKey.get(k)).filter((x): x is Metric => !!x),
      weitere: NAEHRWERTE
        .filter((n) => !(WICHTIGE_NAEHRWERTE as readonly string[]).includes(n.key))
        .map((n) => nachKey.get(n.key))
        .filter((x): x is Metric => !!x),
    }
  }, [data.metrics])

  const eintraege = useMemo(
    () => data.foodEntries.filter((f) => !f.deleted_at && f.day === day),
    [data.foodEntries, day],
  )

  return (
    <>
      <Card className="mb16" title="Ernährung" icon="ernaehrung" farbe={BEREICH_FARBE.tracking}
        sub={<FatSecretZeile anzahl={eintraege.length} />}>
        <TageswertKacheln day={day} />

        {weitere.length > 0 && (
          <div className="mt8">
            <Collapsible label={`Weitere Nährwerte (${weitere.length})`}>
              <WeitereNaehrwerte metriken={weitere} day={day} />
            </Collapsible>
          </div>
        )}

        {/*
          Von Hand eintragen bleibt möglich, steht aber nicht mehr vorn.
          Gebraucht wird es an Tagen ohne FatSecret, für eine Korrektur, die
          dort nicht hingehört, und für eine genaue Trinkmenge, die sich nicht
          in Viertellitern ausdrücken lässt.
        */}
        <div className="mt8">
          <Collapsible label="Von Hand eintragen">
            {oben.map((metric) => <MetricInput key={metric.id} metric={metric} day={day} />)}
          </Collapsible>
        </div>
      </Card>

      <Mahlzeiten day={day} eintraege={eintraege} />
    </>
  )
}

/**
 * Woher die Zahlen kommen – eine Zeile, kein Abschnitt.
 *
 * Vorher stand hier „1 Einträge aus FatSecret" (falsche Mehrzahl) und sonst
 * nichts: Wann zuletzt abgeglichen wurde, war auf der Seite nicht zu sehen.
 * Gelesen wird der mitsynchronisierte Importstand, es wird nichts abgefragt.
 */
function FatSecretZeile({ anzahl }: { anzahl: number }) {
  const data = useData()
  const stand = data.settings.fatsecret_import ?? null
  const zuletzt = stand?.zuletzt ? new Date(stand.zuletzt) : null
  const uhr = zuletzt
    ? `${String(zuletzt.getHours()).padStart(2, '0')}:${String(zuletzt.getMinutes()).padStart(2, '0')}`
    : null
  const teile = [
    anzahl === 0 ? null : anzahl === 1 ? '1 Eintrag' : `${anzahl} Einträge`,
    uhr ? `FatSecret · abgeglichen ${uhr}` : null,
  ].filter(Boolean)
  if (!teile.length) return null
  return <>{teile.join(' · ')}</>
}

/**
 * Die elf übrigen Nährwerte – als Tabelle, nicht als elf weitere Karten.
 *
 * Sie sind zum Nachsehen da, nicht zum täglichen Verfolgen. Eine kompakte
 * Liste beantwortet „wie viel Eisen hatte ich gestern" genauso gut wie elf
 * Kacheln und nimmt ein Zehntel des Platzes.
 */
function WeitereNaehrwerte({ metriken, day }: { metriken: Metric[]; day: string }) {
  const data = useData()
  return (
    <div className="naehrwert-liste">
      {metriken.map((metric) => {
        const wert = dayValue(data.metricEntries, metric, day)
        return (
          <div key={metric.id} className="naehrwert-zeile">
            <span className="naehrwert-name">{metric.name}</span>
            <span className="naehrwert-wert">
              {wert === null ? <span className="muted">–</span> : formatNumber(wert, metric.decimals)}
              <span className="muted"> {metric.unit}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Was gegessen wurde, nach Mahlzeiten – die Begründung hinter den Zahlen. */
function Mahlzeiten({ day, eintraege }: { day: string; eintraege: any[] }) {
  const [alleWerte, setAlleWerte] = useState(false)

  if (eintraege.length === 0) {
    return (
      <Card className="mb16" title="Gegessen" icon="ernaehrung" farbe={BEREICH_FARBE.tracking}>
        <Empty kompakt title="Für diesen Tag liegt nichts vor."
          hint="Sobald FatSecret den Tag hat, stehen die Lebensmittel hier." />
      </Card>
    )
  }

  const kcalGesamt = eintraege.reduce((a, b) => a + (b.calories ?? 0), 0)

  return (
    <Card className="mb16" title="Gegessen" icon="ernaehrung" farbe={BEREICH_FARBE.tracking}
      sub={`${eintraege.length === 1 ? '1 Eintrag' : `${eintraege.length} Einträge`} · ${Math.round(kcalGesamt)} kcal`}
      action={
        <button className="btn btn-sm btn-ghost" onClick={() => setAlleWerte((v) => !v)}>
          {alleWerte ? 'weniger' : 'mehr Details'}
        </button>
      }>
      {MAHLZEITEN.map((mz) => {
        const liste = eintraege.filter((e) => e.meal === mz.key)
        if (!liste.length) return null
        const kcal = liste.reduce((a, b) => a + (b.calories ?? 0), 0)
        return (
          <div key={mz.key} className="mb12">
            <div className="row small" style={{ fontWeight: 650, marginBottom: 4 }}>
              <span>{mz.label}</span>
              <span style={{ flex: 1 }} />
              <span className="muted">{Math.round(kcal)} kcal</span>
            </div>
            <div className="list">
              {liste.map((e) => (
                <div key={e.id} className="list-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <span className="list-main">
                    <span className="list-title">{e.name}</span>
                    <span className="list-sub">{beschreibung(e, alleWerte)}</span>
                  </span>
                  <span className="list-amount">
                    {e.calories !== null ? `${Math.round(e.calories)} kcal` : '–'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </Card>
  )
}

/**
 * Die Zeile unter einem Lebensmittel.
 *
 * Normal die Portion und die drei Makros – mehr braucht man beim Überfliegen
 * nicht. „mehr Details" zeigt alles, was FatSecret zu diesem Eintrag hergibt,
 * und lässt weg, wozu nichts vorliegt (statt überall „0" zu behaupten).
 */
function beschreibung(e: any, alle: boolean): string {
  const kurz = ['protein_g', 'carbs_g', 'fat_g', 'fiber_g']
  const liste = alle ? NAEHRWERTE.filter((n) => n.key !== 'calories') : NAEHRWERTE.filter((n) => kurz.includes(n.key))
  const teile = liste
    .filter((n) => e[n.key] !== null && e[n.key] !== undefined)
    .map((n) => `${kurzname(n.name)} ${formatNumber(e[n.key], n.einheit === 'g' ? 1 : 0)} ${n.einheit}`)
  return [e.serving_description, ...teile].filter(Boolean).join(' · ')
}

/** Kurzformen, damit die Zeile auf ein Handy passt. */
const KURZ: Record<string, string> = {
  Protein: 'E', Kohlenhydrate: 'KH', Fett: 'F', Ballaststoffe: 'Ballast.',
  'Gesättigte Fettsäuren': 'ges. F', 'Mehrfach ungesättigte Fettsäuren': 'mehrf. F',
  'Einfach ungesättigte Fettsäuren': 'einf. F',
}
function kurzname(name: string): string {
  return KURZ[name] ?? name
}
