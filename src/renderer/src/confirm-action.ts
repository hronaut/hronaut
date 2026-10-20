/**
 * Asks before a change that cannot be undone. Main shows the question natively with Cancel as the button Enter
 * presses, labeled in the interface language: Electron's `window.confirm` presses OK on Enter and labels it in
 * English, so a key still held from the button that asked could confirm the change. Without the shell bridge, as in
 * component tests, it falls back to `window.confirm`.
 */
export function confirmAction(message: string): boolean {
  const shell = (window as Partial<Pick<Window, 'hronautShell'>>).hronautShell
  return shell?.confirm ? shell.confirm(message) : window.confirm(message)
}
