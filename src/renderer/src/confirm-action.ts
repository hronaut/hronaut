import type { Confirmation } from '../../shared/confirmation.js'

/** Whether a question waits for its answer. */
let asking = false

/**
 * Asks before a change that cannot be undone. Main asks in Hronaut's own dialog over the window, with Cancel focused,
 * labeled in the interface language: Electron's `window.confirm` presses OK on Enter and labels it in English, so a
 * key still held from the button that asked could confirm the change. The page keeps running while it waits, so a
 * caller checks again afterwards that what it asked about is still there. Without the shell bridge, as in component
 * tests, it falls back to `window.confirm`.
 */
export async function confirmAction(question: Confirmation): Promise<boolean> {
  const shell = (window as Partial<Pick<Window, 'hronautShell'>>).hronautShell
  // eslint-disable-next-line no-restricted-properties -- only without the shell bridge, as in component tests
  if (!shell?.confirm) return window.confirm(question.detail ? `${question.message}\n\n${question.detail}` : question.message)
  // A second click before the dialog appears asks nothing more: one question at a time, and the repeat is a no.
  if (asking) return false
  asking = true
  try {
    return await shell.confirm(question)
  } catch {
    // A question that could not be asked answers as Cancel does.
    return false
  } finally {
    asking = false
  }
}
