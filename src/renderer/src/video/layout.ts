import type { VideoAnnotation } from '../../../shared/video.js'

export const VIDEO_FONT = 'Arial, Helvetica, sans-serif'
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high))

/** Use glyph metrics, not the canvas top baseline's platform-dependent font leading. */
export function videoTextBaseline(context: CanvasRenderingContext2D, top: number, lineHeight: number, fontSize: number, sample = 'Ag'): number {
  const metrics = context.measureText(sample)
  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : fontSize * 0.75
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 0.2
  return top + (lineHeight - ascent - descent) / 2 + ascent
}

/** Preserve words and explicit newlines; only split a single word that cannot fit. */
export function wrapVideoText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) { line = candidate; continue }
      if (line) { lines.push(line); line = '' }
      for (const character of word) {
        if (line && measure(line + character) > maxWidth) { lines.push(line); line = '' }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}

function fitLines(lines: string[], count: number, width: number, measure: (value: string) => number): string[] {
  if (lines.length <= count) return lines
  const visible = lines.slice(0, count)
  let last = visible.at(-1) ?? ''
  while (last && measure(`${last}…`) > width) last = [...last].slice(0, -1).join('')
  visible[visible.length - 1] = `${last.trimEnd()}…`
  return visible
}

export function layoutVideoText(context: CanvasRenderingContext2D, a: VideoAnnotation, width: number, height: number) {
  const scale = Math.min(width / 1280, height / 720)
  const margin = Math.max(4, 28 * scale)
  const padding = Math.max(8, 18 * scale)
  const callout = a.kind === 'callout'
  const preset = a.preset ?? 'caption'
  const size = a.size === 'small' ? 0.82 : a.size === 'large' ? 1.25 : 1
  const fontSize = Math.max(12, (preset === 'title' ? 38 : preset === 'label' ? 21 : 26) * scale * size)
  const fontWeight = preset === 'title' ? 700 : 500
  const lineHeight = fontSize * 1.35
  const maxWidth = Math.min(width - margin * 2, width * (a.width ?? (callout ? 0.3 : preset === 'label' ? 0.34 : preset === 'title' ? 0.7 : 0.56)))
  const contentWidth = Math.max(1, maxWidth - padding * 2)
  const measure = (text: string): number => context.measureText(text).width
  const badgeSize = a.step === undefined ? 0 : Math.max(22, 32 * scale)
  const titleFontSize = Math.max(11, 17 * scale * size)
  context.font = `700 ${titleFontSize}px ${VIDEO_FONT}`
  const titleWidth = Math.max(1, contentWidth - (badgeSize ? badgeSize + padding * 0.6 : 0))
  const titleLines = a.title ? fitLines(wrapVideoText(a.title, titleWidth, measure), 2, titleWidth, measure) : []
  const headerHeight = Math.max(badgeSize, titleLines.length * titleFontSize * 1.3)
  const headerGap = headerHeight ? padding * 0.7 : 0
  context.font = `${fontWeight} ${fontSize}px ${VIDEO_FONT}`
  const maxLines = Math.max(1, Math.min(8, Math.floor((height - margin * 2 - padding * 2 - headerHeight - headerGap) / lineHeight)))
  const lines = fitLines(wrapVideoText(a.text ?? '', contentWidth, measure), maxLines, contentWidth, measure)
  const boxWidth = callout || headerHeight ? maxWidth : Math.min(maxWidth, Math.max(...lines.map(measure), 0) + padding * 2)
  const boxHeight = padding * 2 + headerHeight + headerGap + lines.length * lineHeight
  let x = (a.x ?? 0.06) * width, y = (a.y ?? 0.08) * height
  let placement = a.placement ?? (a.x !== undefined && a.y !== undefined ? 'custom' : 'auto')
  if (placement === 'auto') {
    if (callout) {
      x = (a.endX ?? 0.5) >= 0.5 ? margin : width - margin - boxWidth
      y = (a.endY ?? 0.5) * height - boxHeight / 2
    } else placement = 'bottom-center'
  }
  if (placement !== 'custom' && placement !== 'auto') {
    x = placement.endsWith('left') ? margin : placement.endsWith('right') ? width - margin - boxWidth : (width - boxWidth) / 2
    y = placement.startsWith('top') ? margin : placement.startsWith('center') ? (height - boxHeight) / 2 : height - margin - boxHeight
  }
  return {
    x: clamp(x, margin, width - margin - boxWidth), y: clamp(y, margin, height - margin - boxHeight),
    width: boxWidth, height: boxHeight, padding, fontSize, fontWeight, lineHeight,
    lines, titleLines, titleFontSize, headerHeight, headerGap, badgeSize, scale
  }
}
