/**
 * UUIDv7 – zeitsortierte IDs, auf dem Client erzeugt.
 * Zeitsortiert = gute Index-Lokalität, im Gegensatz zu UUIDv4.
 * Aufbau: 48 Bit Unix-Millisekunden | 4 Bit Version | 12 Bit Zufall
 *         | 2 Bit Variante | 62 Bit Zufall
 */
let lastMs = 0
let counter = 0

export function uuidv7(now: number = Date.now()): string {
  // Monotonie auch bei mehreren IDs in derselben Millisekunde sicherstellen
  if (now === lastMs) counter += 1
  else {
    lastMs = now
    counter = 0
  }
  const ms = now
  const bytes = new Uint8Array(16)
  bytes[0] = (ms / 2 ** 40) & 0xff
  bytes[1] = (ms / 2 ** 32) & 0xff
  bytes[2] = (ms / 2 ** 24) & 0xff
  bytes[3] = (ms / 2 ** 16) & 0xff
  bytes[4] = (ms / 2 ** 8) & 0xff
  bytes[5] = ms & 0xff

  const rand = new Uint8Array(10)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(rand)
  } else {
    for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 256)
  }
  bytes.set(rand, 6)

  // Zähler in die ersten Zufallsbits mischen (Eindeutigkeit pro Millisekunde)
  bytes[6] = (bytes[6] & 0x0f) | ((counter & 0x0f) << 4)
  bytes[6] = (bytes[6] & 0x0f) | 0x70 // Version 7
  bytes[7] = counter & 0xff
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Kurze, gut lesbare ID für Geräte, Import-Batches usw. */
export function shortId(len = 8): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

/* ------------------------------------------------------- Wiederholbare IDs
 *
 * Das Gegenstück zu uuidv7: eine ID, die sich aus ihrem Inhalt ergibt statt
 * aus Zufall und Uhrzeit. Zweimal dieselben Bestandteile ergeben zweimal
 * dieselbe ID.
 *
 * Das ist der Kern der Doppelt-Vermeidung über mehrere Geräte hinweg. Wenn
 * PC und Handy beide unabhängig voneinander die Aufgabe "Training am
 * 2026-09-21 aus Vorlage X" erzeugen, bekommen beide dieselbe ID. Der Server
 * legt Zeilen per Primärschlüssel an bzw. aktualisiert sie (merge-duplicates,
 * siehe sync/engine.ts) – aus zwei Erzeugungen wird dort also genau eine
 * Zeile, und beim nächsten Abgleich haben beide Geräte dieselbe.
 *
 * Ohne das müsste man sich darauf verlassen, dass vor dem Erzeugen jedes Mal
 * erfolgreich synchronisiert wurde. Genau das ist unterwegs, im Flugmodus
 * oder bei zwei gleichzeitig geöffneten Geräten aber nicht gegeben.
 */

/** Ein 32-Bit-FNV-1a-Durchlauf mit wählbarem Startwert. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    // FNV-Primzahl 16777619, in 32 Bit multipliziert
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Eine aus ihrem Inhalt abgeleitete, UUID-förmige ID.
 *
 * `namespace` trennt die Anwendungsfälle voneinander, damit dieselben
 * Bestandteile in zwei verschiedenen Zusammenhängen nicht dieselbe ID
 * ergeben. Die Versionsstelle ist 8 (anwendungsdefinierte UUID nach RFC 9562)
 * – damit ist auf den ersten Blick erkennbar, dass die ID nicht zufällig ist.
 */
export function stableId(namespace: string, ...parts: (string | number)[]): string {
  const input = [namespace, ...parts.map((p) => String(p))].join('\u0000')
  // Vier Durchläufe mit verschiedenen Startwerten und leicht verändertem
  // Text ergeben 128 Bit, die weit genug auseinanderliegen.
  const words = [
    fnv1a(input, 0x811c9dc5),
    fnv1a(`${input}\u00011`, 0x9e3779b9),
    fnv1a(`${input}\u00012`, 0x85ebca6b),
    fnv1a(`${input}\u00013`, 0xc2b2ae35),
  ]
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('')
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x80 // Version 8: anwendungsdefiniert
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Variante RFC 4122
  const out = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`
}
