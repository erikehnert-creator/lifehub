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
