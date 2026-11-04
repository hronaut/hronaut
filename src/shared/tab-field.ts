/**
 * A field of the shown tab's own in the shell: the address field or Find's. One that had the keyboard when the person
 * left the tab takes it back when the tab is shown again, as Chrome gives a tab its focused view back.
 */
export type ShellTabField = 'address' | 'find'

export function isShellTabField(value: unknown): value is ShellTabField {
  return value === 'address' || value === 'find'
}
