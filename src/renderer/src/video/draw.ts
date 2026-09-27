import type { VideoAnnotation } from '../../../shared/video.js'

export function drawVideoAnnotations(context: CanvasRenderingContext2D, annotations: VideoAnnotation[], sourceMs: number, width: number, height: number): void {
  for (const a of annotations) {
    if (sourceMs < a.startMs || sourceMs >= a.endMs) continue
    const x = a.x * width, y = a.y * height
    const endX = (a.endX ?? a.x) * width, endY = (a.endY ?? a.y) * height
    context.save()
    context.strokeStyle = a.color
    context.fillStyle = a.color
    context.lineWidth = Math.max(3, width / 320)
    context.lineCap = 'round'
    if (a.kind === 'text') {
      const fontSize = Math.max(18, Math.round(width / 42))
      context.font = `600 ${fontSize}px system-ui, sans-serif`
      context.textBaseline = 'top'
      // Wrap long captions within the viewport, preserving explicit line breaks.
      const maxWidth = width - 24
      const lines: string[] = []
      for (const paragraph of (a.text ?? '').split('\n')) {
        let line = ''
        for (const character of paragraph) {
          if (context.measureText(line + character).width > maxWidth - 20 && line) { lines.push(line); line = '' }
          line += character
        }
        lines.push(line)
      }
      const visible = lines.slice(0, 8)
      const boxWidth = Math.min(maxWidth, Math.max(...visible.map(line => context.measureText(line).width)) + 20)
      const boxHeight = visible.length * fontSize * 1.3 + 16
      const left = Math.max(0, Math.min(x, width - boxWidth)), top = Math.max(0, Math.min(y, height - boxHeight))
      context.fillStyle = '#111827ee'
      context.fillRect(left, top, boxWidth, boxHeight)
      context.fillStyle = a.color
      visible.forEach((line, index) => context.fillText(line, left + 10, top + 8 + index * fontSize * 1.3))
    } else if (a.kind === 'highlight') {
      context.globalAlpha = 0.2
      context.fillRect(Math.min(x, endX), Math.min(y, endY), Math.abs(endX - x), Math.abs(endY - y))
      context.globalAlpha = 1
      context.strokeRect(Math.min(x, endX), Math.min(y, endY), Math.abs(endX - x), Math.abs(endY - y))
    } else if (a.kind === 'click') {
      const radius = Math.max(12, width / 55)
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke()
      context.globalAlpha = 0.3
      context.beginPath(); context.arc(x, y, radius * 0.6, 0, Math.PI * 2); context.fill()
    } else {
      const angle = Math.atan2(endY - y, endX - x), size = Math.max(12, width / 65)
      context.beginPath(); context.moveTo(x, y); context.lineTo(endX, endY); context.stroke()
      context.beginPath(); context.moveTo(endX, endY)
      context.lineTo(endX - size * Math.cos(angle - Math.PI / 6), endY - size * Math.sin(angle - Math.PI / 6))
      context.lineTo(endX - size * Math.cos(angle + Math.PI / 6), endY - size * Math.sin(angle + Math.PI / 6))
      context.closePath(); context.fill()
    }
    context.restore()
  }
}
