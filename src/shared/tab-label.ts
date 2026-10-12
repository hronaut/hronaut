export const MAX_TAB_LABEL_CODE_POINTS = 100
export const MAX_TAB_LABEL_INPUT_LENGTH = 1_024

/** Labels are user-authored task metadata, never document titles or authority. */
export function normalizeTabLabel(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_TAB_LABEL_INPUT_LENGTH) {
    throw new TypeError('Tab label input is too long or invalid.')
  }
  if (/[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069]/u.test(value)) {
    throw new TypeError('Tab labels cannot contain control characters.')
  }
  const label = value.trim().normalize('NFC')
  if ([...label].length > MAX_TAB_LABEL_CODE_POINTS) {
    throw new TypeError('Tab labels cannot exceed 100 characters.')
  }
  return label || undefined
}

export function restoreTabLabel(value: unknown): string | undefined {
  try { return normalizeTabLabel(value) } catch { return undefined }
}
