import { truncateText } from '../../shared/text-boundaries.js'
import { UNTITLED_TAB_TITLE } from '../../shared/tab-title.js'

export const MAX_TAB_TITLE_CHARS = 512

function normalizedTitle(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function normalizeTabTitle(value: string, fallback = UNTITLED_TAB_TITLE): string {
  const title = normalizedTitle(value) || normalizedTitle(fallback) || UNTITLED_TAB_TITLE
  return truncateText(title, MAX_TAB_TITLE_CHARS)
}
