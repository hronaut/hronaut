import type { VideoAnnotation } from '../../../shared/video.js'
import { layoutVideoText, videoTextBaseline, VIDEO_FONT } from './layout.js'

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high))
const ease = (value: number): number => 1 - (1 - clamp(value, 0, 1)) ** 3

function badgeInk(color: string): string {
  const channels = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 > 0.179 ? '#111827' : '#ffffff'
}

export function videoAnnotationOpacity(a: VideoAnnotation, time: number): number {
  if (time < a.startMs || time >= a.endMs) return 0
  if (a.animation === 'none') return 1
  const fadeMs = Math.min(180, (a.endMs - a.startMs) / 3)
  return ease((time - a.startMs) / fadeMs) * ease((a.endMs - time) / fadeMs)
}

function region(a: VideoAnnotation, width: number, height: number) {
  const x = (a.x ?? 0) * width, y = (a.y ?? 0) * height
  const endX = (a.endX ?? 0) * width, endY = (a.endY ?? 0) * height
  return { x: Math.min(x, endX), y: Math.min(y, endY), width: Math.abs(endX - x), height: Math.abs(endY - y) }
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath()
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2))
}

function arrow(context: CanvasRenderingContext2D, x: number, y: number, endX: number, endY: number, color: string, scale: number, curvature: number, progress = 1): void {
  const dx = endX - x, dy = endY - y
  if (Math.hypot(dx, dy) < 1 || progress <= 0) return
  const controlX = clamp((x + endX) / 2 - dy * curvature, 0, context.canvas.width)
  const controlY = clamp((y + endY) / 2 + dx * curvature, 0, context.canvas.height)
  const t = progress
  const tipX = (1 - t) ** 2 * x + 2 * (1 - t) * t * controlX + t ** 2 * endX
  const tipY = (1 - t) ** 2 * y + 2 * (1 - t) * t * controlY + t ** 2 * endY
  const partialX = x + (controlX - x) * t, partialY = y + (controlY - y) * t
  // Scale the entire pointer down while a short arrow (or its entrance) grows.
  const length = Math.hypot(tipX - x, tipY - y)
  const thickness = Math.min(Math.max(2.5, 5 * scale), length * 0.16)
  const head = Math.min(Math.max(10, 20 * scale), length * 0.38)
  const angle = Math.atan2(tipY - partialY, tipX - partialX)
  context.lineCap = 'round'; context.lineJoin = 'round'
  context.beginPath(); context.moveTo(x, y); context.quadraticCurveTo(partialX, partialY, tipX, tipY)
  context.moveTo(tipX - head * Math.cos(angle - 0.55), tipY - head * Math.sin(angle - 0.55))
  context.lineTo(tipX, tipY)
  context.lineTo(tipX - head * Math.cos(angle + 0.55), tipY - head * Math.sin(angle + 0.55))
  // Outline the shaft and open head together, including their rounded joins.
  context.strokeStyle = `${badgeInk(color)}99`; context.lineWidth = thickness * 1.65; context.stroke()
  context.strokeStyle = color; context.lineWidth = thickness; context.stroke()
}

function textCard(context: CanvasRenderingContext2D, a: VideoAnnotation, width: number, height: number): void {
  const box = layoutVideoText(context, a, width, height)
  const { x, y, padding, scale } = box
  const light = a.theme === 'light'
  const foreground = a.textColor ?? (light ? '#172033' : '#f8fafc')
  if (a.kind === 'callout') {
    const endX = (a.endX ?? 0.5) * width, endY = (a.endY ?? 0.5) * height
    const startX = endX < x ? x : endX > x + box.width ? x + box.width : clamp(endX, x + padding, x + box.width - padding)
    const startY = endX < x || endX > x + box.width ? clamp(endY, y + padding, y + box.height - padding) : endY < y ? y : y + box.height
    arrow(context, startX, startY, endX, endY, a.color, scale, a.curvature ?? 0.12)
  }
  context.shadowColor = '#02061755'; context.shadowBlur = 22 * scale; context.shadowOffsetY = 6 * scale
  rounded(context, x, y, box.width, box.height, Math.max(6, 16 * scale))
  context.fillStyle = light ? '#fffffff5' : '#111827f5'; context.fill()
  context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0
  context.strokeStyle = light ? '#0f172a18' : '#ffffff24'; context.lineWidth = Math.max(1, scale); context.stroke()
  // A restrained accent replaces bright body text and keeps contrast consistent on any page.
  rounded(context, x + 1, y + padding, Math.max(2, 3 * scale), box.height - padding * 2, 2 * scale)
  context.fillStyle = a.color; context.fill()
  context.textBaseline = 'alphabetic'; context.textAlign = 'left'
  if (box.badgeSize) {
    rounded(context, x + padding, y + padding, box.badgeSize, box.badgeSize, 9 * scale)
    context.fillStyle = a.color; context.fill()
    const badgeFontSize = Math.max(12, 16 * scale)
    context.fillStyle = badgeInk(a.color); context.font = `700 ${badgeFontSize}px ${VIDEO_FONT}`
    context.textAlign = 'center'
    context.fillText(String(a.step), x + padding + box.badgeSize / 2, videoTextBaseline(context, y + padding, box.badgeSize, badgeFontSize, String(a.step)))
    context.textAlign = 'left'
  }
  context.font = `700 ${box.titleFontSize}px ${VIDEO_FONT}`
  context.fillStyle = light ? '#526078' : '#c3cddd'
  const titleLineHeight = box.titleFontSize * 1.3
  const titleTop = y + padding + (box.headerHeight - box.titleLines.length * titleLineHeight) / 2
  box.titleLines.forEach((line, index) => context.fillText(line, x + padding + (box.badgeSize ? box.badgeSize + padding * 0.6 : 0), videoTextBaseline(context, titleTop + index * titleLineHeight, titleLineHeight, box.titleFontSize, box.titleLines.join(''))))
  context.font = `${box.fontWeight} ${box.fontSize}px ${VIDEO_FONT}`
  context.fillStyle = foreground
  context.textAlign = a.align ?? (a.kind === 'callout' ? 'left' : a.preset === 'title' ? 'center' : 'left')
  const textX = context.textAlign === 'center' ? x + box.width / 2 : context.textAlign === 'right' ? x + box.width - padding : x + padding
  box.lines.forEach((line, index) => context.fillText(line, textX, videoTextBaseline(context, y + padding + box.headerHeight + box.headerGap + index * box.lineHeight, box.lineHeight, box.fontSize)))
}

export function drawVideoAnnotations(context: CanvasRenderingContext2D, annotations: VideoAnnotation[], sourceMs: number, width: number, height: number): void {
  if (width < 48 || height < 48) return
  const active = annotations.filter(a => sourceMs >= a.startMs && sourceMs < a.endMs)
  const scale = Math.min(width / 1280, height / 720)
  const spotlights = active.filter(a => a.kind === 'spotlight')
  if (spotlights.length) {
    context.save()
    // Intersect the outside clips so overlapping spotlights retain a clear union of holes.
    for (const a of spotlights) {
      const box = region(a, width, height)
      context.beginPath(); context.rect(0, 0, width, height)
      context.roundRect(box.x, box.y, box.width, box.height, Math.min(12 * scale, box.width / 2, box.height / 2))
      context.clip('evenodd')
    }
    context.globalAlpha = Math.max(...spotlights.map(a => videoAnnotationOpacity(a, sourceMs))) * 0.58
    context.fillStyle = '#080d1c'; context.fillRect(0, 0, width, height)
    context.restore()
  }
  // Draw cards last, so a later spotlight/highlight never obscures their text.
  const ordered = [...active.filter(a => a.kind !== 'text' && a.kind !== 'callout'), ...active.filter(a => a.kind === 'text' || a.kind === 'callout')]
  for (const a of ordered) {
    const opacity = videoAnnotationOpacity(a, sourceMs)
    if (!opacity) continue
    context.save(); context.globalAlpha = opacity
    const x = (a.x ?? 0) * width, y = (a.y ?? 0) * height
    if (a.kind === 'text' || a.kind === 'callout') textCard(context, a, width, height)
    else if (a.kind === 'arrow') {
      const progress = a.animation === 'draw' ? ease((sourceMs - a.startMs) / Math.min(400, (a.endMs - a.startMs) / 2)) : 1
      arrow(context, x, y, (a.endX ?? 0) * width, (a.endY ?? 0) * height, a.color, scale, a.curvature ?? 0.15, progress)
    } else if (a.kind === 'highlight' || a.kind === 'spotlight') {
      const box = region(a, width, height)
      rounded(context, box.x, box.y, box.width, box.height, 12 * scale)
      if (a.kind === 'highlight') { context.globalAlpha = opacity * 0.12; context.fillStyle = a.color; context.fill(); context.globalAlpha = opacity }
      context.strokeStyle = '#ffffffcc'; context.lineWidth = Math.max(4, 6 * scale); context.stroke()
      context.strokeStyle = a.color; context.lineWidth = Math.max(2, 3 * scale); context.stroke()
    } else if (a.kind === 'click') {
      const radius = Math.max(10, 20 * scale)
      const pulse = a.animation === 'draw' ? clamp((sourceMs - a.startMs) / 650, 0, 1) : 0
      context.beginPath(); context.arc(x, y, radius * (1 + pulse * 0.7), 0, Math.PI * 2)
      context.globalAlpha = opacity * (1 - pulse) * 0.7; context.strokeStyle = a.color; context.lineWidth = Math.max(2, 3 * scale); context.stroke()
      context.globalAlpha = opacity * (1 - pulse) * 0.18; context.fillStyle = a.color; context.fill()
      context.globalAlpha = opacity; context.beginPath(); context.arc(x, y, radius * 0.3, 0, Math.PI * 2)
      context.fill(); context.strokeStyle = '#ffffff'; context.lineWidth = Math.max(1.5, 2 * scale); context.stroke()
    }
    context.restore()
  }
}
