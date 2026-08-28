/**
 * Zugangsschutz per PIN.
 *
 * Was der Schutz leistet: Wer dein Gerät in die Hand nimmt und LifeHub öffnet,
 * sieht ohne PIN nichts. Was er nicht leistet: Die Datenbank selbst ist nicht
 * verschlüsselt. Wer technisch versiert ist und vollen Zugriff auf dein
 * angemeldetes Benutzerkonto hat, käme an die Rohdaten. Für den Alltag – Handy
 * kurz liegen lassen, jemand schaut über die Schulter – reicht das; für einen
 * gemeinsam genutzten Rechner ist ein eigenes Windows-Benutzerkonto der
 * bessere Schutz.
 *
 * Die PIN selbst wird nie gespeichert, nur ihr Hash mit zufälligem Salz.
 */

const ITERATIONS = 150_000

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomSalt(): string {
  const b = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b)
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256)
  return toHex(b.buffer)
}

/** Rückfallverfahren, falls der Browser keine Web-Crypto anbietet (z. B. sehr alte Umgebung). */
function weakHash(pin: string, salt: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1b873593
  const s = salt + '|' + pin
  for (let round = 0; round < 20000; round++) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i) + round
      h1 = Math.imul(h1 ^ c, 0x01000193)
      h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)
    }
  }
  return 'weak:' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!subtle) return weakHash(pin, salt)
  try {
    const enc = new TextEncoder()
    const key = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
      key, 256,
    )
    return 'pbkdf2:' + toHex(bits)
  } catch {
    return weakHash(pin, salt)
  }
}

export async function verifyPin(pin: string, salt: string, expected: string): Promise<boolean> {
  if (!expected) return true
  if (expected.startsWith('weak:')) return weakHash(pin, salt) === expected
  return (await hashPin(pin, salt)) === expected
}

/* --------------------------------------------------- Sitzungszustand */

const SESSION_KEY = 'lifehub.unlocked'

/** Nach dem Entsperren bleibt die App im selben Tab offen, bis er geschlossen wird. */
export function markUnlocked() {
  try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* privater Modus */ }
}
export function isUnlockedInSession(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === '1' } catch { return false }
}
export function clearUnlocked() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* egal */ }
}
