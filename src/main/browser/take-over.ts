import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { redactNetworkUrl } from '../../shared/network-details.js'

/** Keys that ask something of an agent's person; when an agent sends one itself, the page keeps it. */
const PERSON_ONLY_SHORTCUTS: ReadonlySet<BrowserShortcutAction> = new Set(['agent-card', 'take-over'])

/**
 * The browser shortcut a key pressed in a page runs, or null when the page keeps the key: the shortcut is not
 * available there now, or an agent sent a key that only a person uses, such as Ctrl/Cmd+Shift+O for a web
 * app's own command, which would otherwise take the page over from that agent.
 */
export function pageShortcut(
  requested: BrowserShortcutAction | null,
  input: { available: boolean; expectedAgentInput: boolean }
): BrowserShortcutAction | null {
  if (!requested || !input.available) return null
  return input.expectedAgentInput && PERSON_ONLY_SHORTCUTS.has(requested) ? null : requested
}

/** A tab as it was when, and as it is after, the person had it instead of its agent. */
export interface TakeOverMark {
  /** Epoch milliseconds. */
  at: number
  url: string
  navigationGeneration: number
  humanInteractionGeneration: number
}

const URL_LIMIT = 200

/** Without sign-in details, secret-looking query values or the fragment, and cut short. */
function shownUrl(url: string): string {
  const shown = redactNetworkUrl(url)
  return shown.length > URL_LIMIT ? `${shown.slice(0, URL_LIMIT - 1)}…` : shown
}

function shownDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * A plain note for the agent of what changed while the person had the tab. It names the tab's addresses, redacted
 * as in network details, and whether the person clicked or typed, never what they typed or read.
 */
export function handBackNote(start: TakeOverMark, end: TakeOverMark): string {
  const parts = [`The person had this tab for ${shownDuration(end.at - start.at)} and handed it back.`]
  if (end.url !== start.url) parts.push(`The page moved from ${shownUrl(start.url)} to ${shownUrl(end.url)}.`)
  else if (end.navigationGeneration !== start.navigationGeneration) parts.push('The page reloaded or navigated and is at the same address again.')
  else parts.push('The page stayed at the same address.')
  parts.push(end.humanInteractionGeneration !== start.humanInteractionGeneration
    ? 'They clicked or typed in the page.'
    : 'They did not click or type in the page.')
  parts.push('Read the page again before you continue.')
  return parts.join(' ')
}
