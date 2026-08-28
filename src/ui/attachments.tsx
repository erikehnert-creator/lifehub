/**
 * Belege (Kassenbons, Rechnungen) an einer beliebigen Zeile.
 *
 * Wird an Buchungen und wiederkehrenden Zahlungen eingebunden, funktioniert
 * aber für jeden Datensatz: `entityType` + `entityId` genügen.
 */
import React, { useMemo, useRef, useState } from 'react'
import { useData, useMutations } from '../state/store'
import { Modal, Confirm } from './components'
import { prepareFile, formatBytes, downloadDataUrl } from '../io/files'

export interface AttachmentRow {
  id: string
  entity_type: string
  entity_id: string
  filename: string
  mime_type: string
  size_bytes: number
  data_url: string | null
  taken_at: string | null
  deleted_at: string | null
}

export function useAttachments(entityType: string, entityId: string | null): AttachmentRow[] {
  const data = useData()
  return useMemo(
    () => (data.attachments as AttachmentRow[]).filter(
      (a) => !a.deleted_at && a.entity_type === entityType && a.entity_id === entityId,
    ),
    [data.attachments, entityType, entityId],
  )
}

function icon(mime: string): string {
  if (mime === 'application/pdf') return '📄'
  if (mime.startsWith('image/')) return '🧾'
  return '📎'
}

export function AttachmentList({ entityType, entityId, compact }: {
  entityType: string
  entityId: string
  compact?: boolean
}) {
  const m = useMutations()
  const rows = useAttachments(entityType, entityId)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<AttachmentRow | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true); setError(null)
    try {
      for (const file of Array.from(files)) {
        const prepared = await prepareFile(file)
        if (rows.some((r) => r.filename === prepared.filename && r.size_bytes === prepared.size_bytes)) continue
        m.create('attachments', {
          entity_type: entityType,
          entity_id: entityId,
          filename: prepared.filename,
          mime_type: prepared.mime_type,
          size_bytes: prepared.size_bytes,
          sha256: prepared.sha256,
          data_url: prepared.data_url,
          width: prepared.width,
          height: prepared.height,
          upload_state: 'local',
          taken_at: new Date(file.lastModified || Date.now()).toISOString(),
        }, 'Beleg hinzugefügt')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Die Datei konnte nicht gelesen werden.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  const total = rows.reduce((s, r) => s + (r.size_bytes || 0), 0)

  return (
    <div className="field">
      {!compact && <label className="field-label">Belege</label>}
      {rows.length > 0 && (
        <div className="list" style={{ marginBottom: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="list-row">
              <button className="btn btn-ghost btn-sm" onClick={() => setView(r)} style={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left' }}>
                <span style={{ marginRight: 6 }}>{icon(r.mime_type)}</span>
                <span className="list-title">{r.filename}</span>
              </button>
              <span className="list-sub" style={{ flex: '0 0 auto', marginRight: 8 }}>{formatBytes(r.size_bytes)}</span>
              <button className="btn btn-ghost btn-sm" title="Entfernen" onClick={() => setConfirmId(r.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Wird gelesen …' : '📎 Datei wählen'}
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => cameraRef.current?.click()}>📷 Foto aufnehmen</button>
        {rows.length > 0 && <span className="field-hint" style={{ alignSelf: 'center' }}>{rows.length} · {formatBytes(total)}</span>}
      </div>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
        onChange={(e) => { void add(e.target.files) }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { void add(e.target.files) }} />
      {error && <span className="field-hint" style={{ color: 'var(--critical)' }}>{error}</span>}
      {!compact && rows.length === 0 && !error && (
        <span className="field-hint">Rechnung als PDF oder Kassenzettel als Foto. Fotos werden automatisch verkleinert.</span>
      )}

      {view && (
        <Modal open wide title={view.filename} onClose={() => setView(null)}
          footer={<>
            <button className="btn" onClick={() => downloadDataUrl(view.data_url ?? '', view.filename)}>Herunterladen</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={() => setView(null)}>Schließen</button>
          </>}>
          {view.mime_type.startsWith('image/') ? (
            <img src={view.data_url ?? ''} alt={view.filename}
              style={{ width: '100%', height: 'auto', borderRadius: 10, background: 'var(--surface-2)' }} />
          ) : (
            <object data={view.data_url ?? ''} type="application/pdf" style={{ width: '100%', height: '70vh', borderRadius: 10 }}>
              <p className="field-hint">
                Die Vorschau ist in diesem Browser nicht möglich. Über „Herunterladen“ lässt sich die Datei öffnen.
              </p>
            </object>
          )}
        </Modal>
      )}
      <Confirm open={confirmId !== null} title="Beleg entfernen?"
        message="Der Beleg wandert in den Papierkorb und kann dort wiederhergestellt werden."
        danger onCancel={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) m.remove('attachments', confirmId, 'Beleg entfernt'); setConfirmId(null) }} />
    </div>
  )
}

/** Kleines Symbol für Listen: zeigt an, dass eine Zeile Belege hat. */
export function AttachmentBadge({ entityType, entityId }: { entityType: string; entityId: string }) {
  const rows = useAttachments(entityType, entityId)
  if (rows.length === 0) return null
  return <span title={`${rows.length} Beleg(e)`} style={{ marginLeft: 6, opacity: 0.75 }}>📎</span>
}
