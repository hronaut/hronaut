import { VIDEO_INSPECTION_LIMITS as LIMITS } from '../../../shared/video-inspection.js'

let canvas: OffscreenCanvas | undefined
let context: OffscreenCanvasRenderingContext2D | undefined
let expected = 0
let drawn = 0
const api = {
  begin(count: number): void {
    if (!Number.isInteger(count) || count < 1 || count > LIMITS.frames || canvas) throw new Error('Invalid inspection frame count')
    expected = count
    canvas = new OffscreenCanvas(Math.min(count, LIMITS.columns) * LIMITS.tileWidth, Math.ceil(count / LIMITS.columns) * (LIMITS.tileHeight + LIMITS.labelHeight))
    if (canvas.width > LIMITS.outputWidth || canvas.height > LIMITS.outputHeight) throw new Error('Inspection pixel limit exceeded')
    context = canvas.getContext('2d', { alpha: false }) ?? undefined
    if (!context) throw new Error('Inspection canvas is unavailable')
    context.fillStyle = '#111111'
    context.fillRect(0, 0, canvas.width, canvas.height)
  },
  async frame(base64: string, index: number, sequence: number, timeMs: number, width: number, height: number): Promise<void> {
    if (!context || !canvas || index !== drawn || drawn >= expected || base64.length > Math.ceil(LIMITS.frameBytes / 3) * 4) throw new Error('Invalid inspection frame')
    const data = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
    try {
      if (bitmap.width !== width || bitmap.height !== height || !width || !height || width > LIMITS.width || height > LIMITS.height) throw new Error('Decoded inspection dimensions differ from the JPEG header')
      const x = (index % LIMITS.columns) * LIMITS.tileWidth, y = Math.floor(index / LIMITS.columns) * (LIMITS.tileHeight + LIMITS.labelHeight)
      const scale = Math.min(1, LIMITS.tileWidth / width, LIMITS.tileHeight / height)
      const drawWidth = Math.floor(width * scale), drawHeight = Math.floor(height * scale)
      context.drawImage(bitmap, x + Math.floor((LIMITS.tileWidth - drawWidth) / 2), y + Math.floor((LIMITS.tileHeight - drawHeight) / 2), drawWidth, drawHeight)
      context.fillStyle = '#ffffff'
      context.font = '16px monospace'
      context.fillText(`${index + 1} | #${sequence} | ${timeMs} ms`, x + 6, y + LIMITS.tileHeight + 18)
      drawn += 1
    } finally { bitmap.close() }
  },
  async finish(): Promise<string> {
    if (!canvas || drawn !== expected) throw new Error('Incomplete inspection sheet')
    try {
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      // This bounds returned bytes, not native encoder allocation. Check before arrayBuffer/base64/IPC.
      if (!blob.size || blob.size > LIMITS.pngBytes) throw new Error('Video inspection PNG exceeds 4 MiB; request fewer frames')
      const data = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.subarray(index, index + 8192))
      return btoa(binary)
    } finally { canvas.width = 1; canvas.height = 1; canvas = undefined; context = undefined }
  }
}
Object.assign(window, { hronautVideoInspection: api })
