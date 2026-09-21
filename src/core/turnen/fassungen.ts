/**
 * Eingefrorene Kürfassungen – wie eine Übung von damals erhalten bleibt.
 *
 * ---------------------------------------------------------------------------
 * Wozu das gut ist
 *
 * Ein Wettkampfergebnis muss historisch stabil bleiben. Turnt Erik im Oktober
 * eine Reckkür und ändert sie im Dezember, muss der Oktober-Wettkampf
 * weiterhin zeigen, *was damals geturnt wurde*.
 *
 * Ein Verweis auf `gym_routines` leistet das nicht – die Kür dahinter ist
 * veränderlich. Nach der Dezemberänderung zeigte der Oktober-Wettkampf die
 * Dezemberfassung, ohne Fehler und ohne Meldung. Dasselbe gilt für die
 * Elemente: Ein umbenanntes, archiviertes oder gelöschtes `gym_element` würde
 * die Anzeige eines Jahre alten Wettkampfs verändern.
 *
 * Deshalb wird beim Auswählen einer Kür für ein Ergebnis ihr *Zustand in
 * diesem Moment* als eigene, unveränderliche Zeilenfolge festgehalten.
 *
 * ---------------------------------------------------------------------------
 * Das ist keine zweite Quelle für den aktuellen Zustand
 *
 * LifeHub hält sich sonst streng daran, nichts zu speichern, was sich
 * ableiten lässt („zuletzt trainiert", „Geräte einer Einheit", die aktive
 * Wettkampfkür). Eine Fassung verstösst nicht dagegen, weil sie einen
 * **anderen Gegenstand** beschreibt: nicht, wie die Kür *ist*, sondern wie
 * sie an einem Tag *war*. Das lässt sich aus dem Heute grundsätzlich nicht
 * ableiten. Der aktuelle Zustand bleibt allein in `gym_routines` und
 * `gym_routine_elements`; hier wird nie hineingeschrieben, wenn sich die
 * lebende Kür ändert.
 *
 * ---------------------------------------------------------------------------
 * Warum die ID aus dem Inhalt kommt
 *
 * `fassungsId()` rechnet über Kür, Gerät, Name und die ganze Elementfolge.
 * Daraus folgt alles, was diese Tabelle im Alltag braucht:
 *
 *   - Zweimal dieselbe unveränderte Kür einfrieren trifft DIESELBE Zeile.
 *     Zwei Wettkämpfe mit derselben Fassung teilen sie sich.
 *   - Zwei Geräte, die offline dieselbe Kür einfrieren, erzeugen dieselbe
 *     ID. Der Server führt sie über den Primärschlüssel zusammen – es kann
 *     gar nicht erst zwei geben.
 *   - Eine Fassung ändert sich nie. Ändert sich der Inhalt, ist es eine
 *     andere Fassung mit einer anderen ID; die alte bleibt unberührt stehen,
 *     und genau darauf zeigen die alten Ergebnisse.
 *
 * Reine Logik ohne Datenbank und ohne React.
 */
import { stableId } from '../ids'
import type {
  GymElement, GymRoutine, GymRoutineElement,
  GymRoutineVersion, GymRoutineVersionElement,
} from '../types'
import { kuerElemente } from './kueren'

/* ====================================================== Einfrieren */

/**
 * Ein Platz, wie er eingefroren wird.
 *
 * Genau die Felder, die die historische Anzeige braucht. Was fehlt, fehlt
 * mit Absicht – siehe `EINGEFROREN` unten.
 */
export interface FassungsPlatz {
  position: number
  /** Herkunftsangabe. Darf `null` sein und wird nie aufgelöst. */
  element_id: string | null
  name: string
  difficulty_letter: string | null
  difficulty_value: number | null
  element_group: number | null
  is_dismount: number
}

/**
 * Was eingefroren wird – und was nicht.
 *
 * Steht als Liste da, weil die Begründung sonst nur im Schema steht und beim
 * nächsten Feld niemand mehr nachsieht.
 *
 * | Feld | eingefroren | warum |
 * |---|---|---|
 * | `name` | ja | Umbenennen darf die Historie nicht umschreiben |
 * | `difficulty_letter`/`_value` | ja | die Schwierigkeit von damals; die Summe muss reproduzierbar bleiben |
 * | `element_group` | ja | gehört zur Zusammensetzung der Übung |
 * | `is_dismount` | ja | der Abgang zählt gesondert und prägt die Übung |
 * | `position` | ja | die Reihenfolge IST die Kür |
 * | `element_id` | nur als Herkunft | zeigt womöglich auf eine gelöschte Zeile |
 * | `status` | **nein** | der Sicherheitsstand beschreibt den Turner heute. Gespeichert würde ausserdem der Stand im Moment des Einfrierens, nicht der am Wettkampftag – eine Zahl, die richtig aussieht und es nicht ist |
 * | `video_url`, `note` | **nein** | Trainingshilfen, kein Bestandteil der Übung |
 * | Notiz am Kürplatz | **nein** | Arbeitsnotiz. Sie mitzufrieren hiesse, dass eine korrigierte Rechtschreibung eine neue Fassung erzeugt |
 * | `hold_element` | **nein** | für die Anzeige der Übung ohne Bedeutung |
 */
export const EINGEFROREN = [
  'position', 'element_id', 'name',
  'difficulty_letter', 'difficulty_value', 'element_group', 'is_dismount',
] as const

/** Der einzufrierende Inhalt einer Kür – normalisiert, ohne Zeitpunkt. */
export interface FassungsInhalt {
  routine_id: string
  apparatus: string
  name: string
  plaetze: FassungsPlatz[]
}

/**
 * Den aktuellen Zustand einer Kür in die Form bringen, die eingefroren wird.
 *
 * Ein Platz, dessen Element gelöscht wurde, behält seinen Platz und heisst
 * „Gelöschtes Element" – genau wie in der lebenden Anzeige. Ihn zu
 * überspringen würde die Kür beim Einfrieren stillschweigend kürzen.
 *
 * `position` wird hier neu von 0 an vergeben. In der lebenden
 * `gym_routine_elements` ist sie nur ein Sortierwert und darf Lücken und
 * Dubletten haben; in einer Fassung ist sie lückenlos, und genau darauf baut
 * die abgeleitete ID der Platzzeilen.
 */
export function fassungsInhalt(
  kuer: GymRoutine,
  verknuepfungen: GymRoutineElement[],
  elemente: GymElement[],
): FassungsInhalt {
  const plaetze = kuerElemente(kuer.id, verknuepfungen, elemente).map((e, i): FassungsPlatz => ({
    position: i,
    element_id: e.element?.id ?? e.eintrag.element_id ?? null,
    name: e.element?.name ?? 'Gelöschtes Element',
    difficulty_letter: e.element?.difficulty_letter ?? null,
    difficulty_value: typeof e.element?.difficulty_value === 'number'
      && Number.isFinite(e.element.difficulty_value)
      ? e.element.difficulty_value : null,
    element_group: e.element?.element_group ?? null,
    is_dismount: e.element?.is_dismount ? 1 : 0,
  }))
  return { routine_id: kuer.id, apparatus: kuer.apparatus, name: kuer.name, plaetze }
}

/**
 * Der Fingerabdruck eines Platzes – die Zeichenkette, aus der die ID entsteht.
 *
 * Bewusst ausgeschrieben und nicht über `JSON.stringify`: Die Reihenfolge der
 * Schlüssel in einem Objektliteral ist zwar festgelegt, aber niemand sieht
 * einer `stringify`-Zeile an, dass eine spätere Feldergänzung alle
 * vorhandenen IDs ändert. Hier steht es Feld für Feld da.
 */
function abdruck(p: FassungsPlatz): string {
  return [
    p.position,
    p.element_id ?? '',
    p.name,
    p.difficulty_letter ?? '',
    p.difficulty_value ?? '',
    p.element_group ?? '',
    p.is_dismount,
  ].join('|')
}

/**
 * Die ID einer Fassung – aus ihrem Inhalt.
 *
 * **Wer diese Rechnung ändert, ändert die Identität aller künftigen
 * Fassungen.** Vorhandene Zeilen bleiben stehen und bleiben richtig; sie
 * werden nur nicht mehr wiedergefunden, und dieselbe Kür würde ein zweites
 * Mal eingefroren. Die alten Ergebnisse zeigen weiterhin auf ihre alte
 * Fassung, verlieren also nichts.
 */
export function fassungsId(inhalt: FassungsInhalt): string {
  return stableId(
    'gym_routine_versions',
    inhalt.routine_id, inhalt.apparatus, inhalt.name,
    inhalt.plaetze.map(abdruck).join('/'),
  )
}

/** Die ID einer Platzzeile – Fassung plus Platz. */
export function fassungsPlatzId(versionId: string, position: number): string {
  return stableId('gym_routine_version_elements', versionId, position)
}

export interface FassungsPlan {
  /** Die ID, auf die das Ergebnis zeigen soll – ob neu oder schon da. */
  id: string
  /** Die Fassungszeile, falls sie noch angelegt werden muss. */
  version: { id: string; values: Record<string, any> } | null
  /** Die Platzzeilen, falls die Fassung neu ist. */
  plaetze: { id: string; values: Record<string, any> }[]
}

/**
 * Was zu tun ist, um den Zustand einer Kür festzuhalten.
 *
 * Gibt es die Fassung schon (gleicher Inhalt), wird **nichts** geschrieben –
 * nur ihre ID zurückgegeben. Das ist der Normalfall bei zwei Wettkämpfen mit
 * derselben Kür und beim zweiten Speichern desselben Ergebnisses.
 *
 * `jetzt` wird übergeben statt gelesen, damit sich der Zeitpunkt in den
 * Prüfungen festlegen lässt.
 */
export function planeFassung(
  inhalt: FassungsInhalt,
  vorhanden: GymRoutineVersion[],
  jetzt: string,
): FassungsPlan {
  const id = fassungsId(inhalt)
  // Eine geloeschte Fassung zaehlt als vorhanden: `insert()` weckt sie beim
  // Anlegen wieder auf (db/repo.ts), und ein zweites Anlegen waere derselbe
  // Primaerschluessel. Hier trotzdem neu zu schreiben hiesse, jedem Speichern
  // eine Aenderung ueber den Abgleich mitzugeben, fuer die sich nichts
  // geaendert hat.
  if (vorhanden.some((v) => v.id === id)) return { id, version: null, plaetze: [] }

  return {
    id,
    version: {
      id,
      values: {
        routine_id: inhalt.routine_id,
        apparatus: inhalt.apparatus,
        name: inhalt.name,
        frozen_at: jetzt,
      },
    },
    plaetze: inhalt.plaetze.map((p) => ({
      id: fassungsPlatzId(id, p.position),
      values: { version_id: id, ...p },
    })),
  }
}

/* ======================================================== Auslesen */

/**
 * Die Plätze einer Fassung, in ihrer Reihenfolge.
 *
 * Anders als bei der lebenden Kür braucht es hier keinen Gleichstandbruch:
 * `position` ist beim Einfrieren lückenlos von 0 an vergeben worden. Sollte
 * durch einen Abgleichfehler doch einmal ein Gleichstand entstehen,
 * entscheidet die ID – damit jedes Gerät dasselbe zeigt.
 */
export function fassungsPlaetze(
  versionId: string,
  alle: GymRoutineVersionElement[],
): GymRoutineVersionElement[] {
  return alle
    .filter((p) => !p.deleted_at && p.version_id === versionId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
}

/**
 * Die Beschriftung einer Fassung: „Fassung vom 21.09.2026".
 *
 * `frozen_at` ist der Zeitpunkt, zu dem dieser Zustand zum ersten Mal
 * festgehalten wurde – nicht der Tag des Wettkampfs und nicht der Tag, an dem
 * die Kür zuletzt geändert wurde. Letzteres wäre die schönere Angabe, aber
 * LifeHub führt sie nirgends verlässlich: Die `updated_at` der Kürplätze
 * ändert sich auch durch einen Abgleich.
 */
export function fassungsLabel(
  version: GymRoutineVersion | null,
  formatTag: (tag: string) => string,
): string {
  if (!version) return 'keine Kür hinterlegt'
  const tag = String(version.frozen_at).slice(0, 10)
  return `${version.name} · Fassung vom ${formatTag(tag)}`
}

/**
 * Weicht die lebende Kür inzwischen von dieser Fassung ab?
 *
 * Für den Hinweis im Wettkampf („die Kür wurde seitdem geändert"). Beides
 * nebeneinanderzustellen ist beschreibend; was daraus folgt, entscheidet
 * Erik.
 */
export function fassungIstAktuell(
  version: GymRoutineVersion,
  kuer: GymRoutine | null,
  verknuepfungen: GymRoutineElement[],
  elemente: GymElement[],
): boolean {
  if (!kuer || kuer.deleted_at) return false
  return fassungsId(fassungsInhalt(kuer, verknuepfungen, elemente)) === version.id
}
