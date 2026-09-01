import { describe, it, expect } from 'vitest'
import { mergeRows } from '../src/sync/engine'
import { resolvedSyncUrl, resolvedSyncKey, DEFAULT_SYNC_URL, DEFAULT_SYNC_KEY } from '../src/sync/config'

const row = (over: Record<string, any> = {}) => ({
  id: 'x1', created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z',
  deleted_at: null, version: 1, last_device_id: 'a', server_rev: 5, ...over,
})

describe('Konfliktauflösung', () => {
  it('übernimmt disjunkte Feldänderungen von beiden Seiten', () => {
    const local = row({ title: 'Auto waschen', note: 'lokale Notiz', updated_at: '2026-08-02T12:00:00Z' })
    const remote = row({ title: 'Auto waschen', priority: 3, updated_at: '2026-08-02T11:00:00Z' })
    const { merged, conflicted } = mergeRows('tasks', local, remote)
    expect(merged.note).toBe('lokale Notiz')
    expect(merged.priority).toBe(3)
    expect(conflicted).toHaveLength(0)
  })

  it('lässt bei gleichem Feld die jüngere Änderung gewinnen', () => {
    const local = row({ title: 'neu lokal', updated_at: '2026-08-02T12:00:00Z' })
    const remote = row({ title: 'alt entfernt', updated_at: '2026-08-02T09:00:00Z' })
    expect(mergeRows('tasks', local, remote).merged.title).toBe('neu lokal')
  })

  it('lässt „erledigt" gegen „offen" gewinnen', () => {
    const local = row({ status: 'done', updated_at: '2026-08-02T09:00:00Z' })
    const remote = row({ status: 'open', updated_at: '2026-08-02T12:00:00Z' })
    expect(mergeRows('tasks', local, remote).merged.status).toBe('done')
  })

  it('führt Beträge NIE automatisch zusammen', () => {
    const local = row({ amount_cents: 4500, updated_at: '2026-08-02T12:00:00Z' })
    const remote = row({ amount_cents: 5400, updated_at: '2026-08-02T09:00:00Z' })
    const { merged, conflicted } = mergeRows('transactions', local, remote)
    expect(merged.amount_cents).toBe(5400)       // Serverstand bleibt vorläufig stehen
    expect(conflicted).toContain('amount_cents') // und der Fall wird sichtbar gemacht
  })

  it('markiert auch Konto und Datum einer Buchung als kritisch', () => {
    const local = row({ account_id: 'a', booked_on: '2026-08-01', updated_at: '2026-08-02T12:00:00Z' })
    const remote = row({ account_id: 'b', booked_on: '2026-08-02', updated_at: '2026-08-02T09:00:00Z' })
    const { conflicted } = mergeRows('transactions', local, remote)
    expect(conflicted).toEqual(expect.arrayContaining(['account_id', 'booked_on']))
  })

  it('wirft längere Texte nicht stillschweigend weg', () => {
    const longA = 'A'.repeat(60)
    const longB = 'B'.repeat(60)
    const { merged, conflicted } = mergeRows('notes', row({ body: longA }), row({ body: longB }))
    expect(merged.body).toContain(longA)
    expect(merged.body).toContain(longB)
    expect(conflicted).toContain('body')
  })

  it('erhöht die Version über beide Seiten hinweg', () => {
    const { merged } = mergeRows('tasks', row({ version: 3 }), row({ version: 7 }))
    expect(merged.version).toBe(8)
  })
})

describe('Konflikt bewusst entschieden', () => {
  it('behält bei kritischen Feldern die eigene Fassung, wenn entschieden wurde', () => {
    const local = {
      id: 'x', amount_cents: 2222, booked_on: '2026-08-17', merchant: 'A',
      updated_at: '2026-08-24T10:00:00Z', version: 3, _conflict: 2, _dirty: 1,
    }
    const remote = {
      id: 'x', amount_cents: 1111, booked_on: '2026-08-17', merchant: 'A',
      updated_at: '2026-08-24T10:05:00Z', version: 4, server_rev: 9,
    }
    const { merged, conflicted } = mergeRows('transactions', local, remote)
    expect(merged.amount_cents).toBe(2222)
    expect(conflicted).toHaveLength(0)
  })

  it('meldet ohne Entscheidung weiterhin einen Konflikt und behält den Serverstand', () => {
    const local = {
      id: 'x', amount_cents: 2222, booked_on: '2026-08-17',
      updated_at: '2026-08-24T10:00:00Z', version: 3, _conflict: 0, _dirty: 1,
    }
    const remote = {
      id: 'x', amount_cents: 1111, booked_on: '2026-08-17',
      updated_at: '2026-08-24T10:05:00Z', version: 4, server_rev: 9,
    }
    const { merged, conflicted } = mergeRows('transactions', local, remote)
    expect(merged.amount_cents).toBe(1111)
    expect(conflicted).toContain('amount_cents')
  })
})

describe('Voreingestellte Server-Verbindung', () => {
  it('bevorzugt eine von Hand eingetragene URL/Schlüssel gegenüber der Werkseinstellung', () => {
    expect(resolvedSyncUrl('https://eigenes-projekt.supabase.co')).toBe('https://eigenes-projekt.supabase.co')
    expect(resolvedSyncKey('eigener-schluessel')).toBe('eigener-schluessel')
  })

  it('fällt bei leerem Feld auf die eingebaute Werkseinstellung zurück', () => {
    expect(resolvedSyncUrl('')).toBe(DEFAULT_SYNC_URL)
    expect(resolvedSyncKey('')).toBe(DEFAULT_SYNC_KEY)
  })
})
