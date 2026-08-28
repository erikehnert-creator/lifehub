/**
 * Dateien für Belege (Kassenbons, Rechnungen).
 *
 * Belege werden als Data-URL direkt in der Datenbank gespeichert. Das hält die
 * App bei einer einzigen Datei: Wer die Datenbank sichert, sichert die Belege
 * mit. Damit die Datei nicht ausufert, werden Fotos vor dem Speichern
 * verkleinert; PDFs bleiben unverändert.
 */

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

export interface PreparedFile {
  filename: string
  mime_type: string
  size_bytes: number
  data_url: string
  width: number | null
  height: number | null
  sha256: string
}

/** Einfacher, schneller Hash (FNV-1a, hex). Dient nur der Dublettenerkennung. */
export function quickHash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h1) + hex(h2) + hex(s.length)
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    r.readAsDataURL(file)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'))
    img.src = url
  })
}

/**
 * Verkleinert ein Foto auf höchstens `maxEdge` Pixel Kantenlänge und
 * komprimiert es als JPEG. Ein Handyfoto mit 4 MB landet so typischerweise
 * bei 200–400 kB – gut lesbar, aber platzsparend.
 */
export async function shrinkImage(dataUrl: string, maxEdge = 1600, quality = 0.72): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  if (scale === 1 && dataUrl.length < 600_000) return { dataUrl, width: w, height: h }
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { dataUrl, width: img.width, height: img.height }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h }
}

/** Bereitet eine ausgewählte Datei zum Speichern vor. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  const isImage = file.type.startsWith('image/')
  if (!isImage && file.type !== 'application/pdf') {
    throw new Error('Nur Bilder (JPG, PNG, HEIC) und PDF-Dateien werden unterstützt.')
  }
  const raw = await readAsDataUrl(file)
  let dataUrl = raw
  let width: number | null = null
  let height: number | null = null
  let mime = file.type || 'application/octet-stream'
  if (isImage) {
    try {
      const shrunk = await shrinkImage(raw)
      dataUrl = shrunk.dataUrl
      width = shrunk.width; height = shrunk.height
      if (dataUrl !== raw) mime = 'image/jpeg'
    } catch { /* Falls der Browser das Format nicht zeichnen kann: Original behalten. */ }
  }
  const size = Math.round((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 0.75)
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Die Datei ist mit ${formatBytes(size)} zu groß. Erlaubt sind ${formatBytes(MAX_ATTACHMENT_BYTES)}.`)
  }
  return {
    filename: file.name || (isImage ? 'Beleg.jpg' : 'Beleg.pdf'),
    mime_type: mime,
    size_bytes: size,
    data_url: dataUrl,
    width, height,
    sha256: quickHash(dataUrl),
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Öffnet eine Data-URL in einem neuen Fenster bzw. lädt sie herunter. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
