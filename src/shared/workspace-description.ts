export const MAX_WORKSPACE_DESCRIPTION_LENGTH = 1_000

export function normalizeWorkspaceDescription(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim().normalize('NFC')
  if (normalized.length > MAX_WORKSPACE_DESCRIPTION_LENGTH) {
    throw new TypeError(`Workspace description cannot exceed ${MAX_WORKSPACE_DESCRIPTION_LENGTH} characters.`)
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new TypeError('Workspace description contains unsupported control characters.')
  }
  return normalized
}
