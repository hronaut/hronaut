export const MAX_WORKSPACE_DESCRIPTION_LENGTH = 1_000
/** MCP results keep this English; the template editor names it in the interface language. */
export const WORKSPACE_DESCRIPTION_ERRORS = {
  descriptionTooLong: `Workspace description cannot exceed ${MAX_WORKSPACE_DESCRIPTION_LENGTH} characters.`,
  descriptionControlCharacters: 'Workspace description contains unsupported control characters.'
} as const

export function normalizeWorkspaceDescription(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim().normalize('NFC')
  if (normalized.length > MAX_WORKSPACE_DESCRIPTION_LENGTH) {
    throw new TypeError(WORKSPACE_DESCRIPTION_ERRORS.descriptionTooLong)
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new TypeError(WORKSPACE_DESCRIPTION_ERRORS.descriptionControlCharacters)
  }
  return normalized
}
