export const MAX_TAB_TITLE_CHARS = 512

function normalizedTitle(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function normalizeTabTitle(value: string, fallback = 'New tab'): string {
  const title = normalizedTitle(value) || normalizedTitle(fallback) || 'New tab'
  return title.slice(0, MAX_TAB_TITLE_CHARS)
}
