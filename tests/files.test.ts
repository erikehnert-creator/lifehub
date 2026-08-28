import { describe, it, expect } from 'vitest'
import { quickHash, formatBytes } from '../src/io/files'

describe('Belege', () => {
  it('formatiert Größen lesbar', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('erkennt gleiche Dateien am Hash und unterscheidet verschiedene', () => {
    const a = 'data:image/jpeg;base64,AAAA'
    const b = 'data:image/jpeg;base64,AAAB'
    expect(quickHash(a)).toBe(quickHash(a))
    expect(quickHash(a)).not.toBe(quickHash(b))
    expect(quickHash(a)).toMatch(/^[0-9a-f]+$/)
  })
})
