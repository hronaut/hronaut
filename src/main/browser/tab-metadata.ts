import { truncateText } from '../../shared/text-boundaries.js'

export const MAX_TAB_TITLE_CHARS = 512

function normalizedTitle(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function normalizeTabTitle(value: string, fallback = 'New tab'): string {
  const title = normalizedTitle(value) || normalizedTitle(fallback) || 'New tab'
  return truncateText(title, MAX_TAB_TITLE_CHARS)
}
