import { redactDiagnosticText } from './debug-report.js'
import type { BrowserRenderedFonts } from './types.js'

export const RENDERED_FONT_LIMITS = { records: 20, name: 128 } as const

export function unavailableRenderedFonts(reason: NonNullable<BrowserRenderedFonts['reason']>): BrowserRenderedFonts {
  return { status: 'unavailable', reason, scope: 'selected-leaf-element', capturedAt: new Date().toISOString(), fonts: [], truncated: false }
}

export function normalizeRenderedFonts(raw: unknown): BrowserRenderedFonts {
  const input = raw && typeof raw === 'object' ? (raw as { fonts?: unknown }).fonts : undefined
  if (!Array.isArray(input)) throw new Error('Invalid rendered-font protocol response')
  let truncated = input.length > RENDERED_FONT_LIMITS.records
  const name = (value: unknown): string | null => {
    // Omit rather than misidentify overlong names. Font metadata is untrusted;
    // retain no paths, URLs, controls or hidden direction changes.
    if (typeof value !== 'string' || !value || value.length > RENDERED_FONT_LIMITS.name
      || /[\\/:\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
      truncated = true
      return null
    }
    const safe = redactDiagnosticText(value)
    if (safe !== value) { truncated = true; return null }
    return value
  }
  const fonts: BrowserRenderedFonts['fonts'] = []
  for (const item of input.slice(0, RENDERED_FONT_LIMITS.records)) {
    if (!item || typeof item !== 'object' || typeof item.isCustomFont !== 'boolean'
      || !Number.isSafeInteger(item.glyphCount) || item.glyphCount < 0) { truncated = true; continue }
    fonts.push({ familyName: name(item.familyName), postScriptName: name(item.postScriptName), isCustomFont: item.isCustomFont, glyphCount: item.glyphCount })
  }
  return { status: input.length ? 'observed' : 'empty', scope: 'selected-leaf-element', capturedAt: new Date().toISOString(), fonts, truncated }
}
