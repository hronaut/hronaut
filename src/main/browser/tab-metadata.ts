export const MAX_TAB_TITLE_CHARS = 512

function normalizedTitle(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function boundedTitle(value: string): string {
  const bounded = value.slice(0, MAX_TAB_TITLE_CHARS)
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1)
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    ? bounded.slice(0, -1)
    : bounded
}

export function normalizeTabTitle(value: string, fallback = 'New tab'): string {
  const title = normalizedTitle(value) || normalizedTitle(fallback) || 'New tab'
  return boundedTitle(title)
}
