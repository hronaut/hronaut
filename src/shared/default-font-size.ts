/**
 * Bounds for a tab's browser default (standard) font size in CSS px. 16 is the browser default,
 * so it is never recorded; a tab without a recorded size uses it.
 */
export const DEFAULT_FONT_SIZE_LIMITS = { min: 9, max: 72, browserDefault: 16 } as const

export function isDefaultFontSize(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= DEFAULT_FONT_SIZE_LIMITS.min
    && value <= DEFAULT_FONT_SIZE_LIMITS.max
}

/** Returns a recordable non-default size, or undefined for the browser default or an invalid value. */
export function normalizeDefaultFontSize(value: unknown): number | undefined {
  return isDefaultFontSize(value) && value !== DEFAULT_FONT_SIZE_LIMITS.browserDefault ? value : undefined
}
