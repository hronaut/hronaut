/** A tab as it was when, and as it is after, the person had it instead of its agent. */
export interface TakeOverMark {
  /** Epoch milliseconds. */
  at: number
  url: string
  navigationGeneration: number
  humanInteractionGeneration: number
}

const URL_LIMIT = 200

function shownUrl(url: string): string {
  return url.length > URL_LIMIT ? `${url.slice(0, URL_LIMIT - 1)}…` : url
}

function shownDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * A plain note for the agent of what changed while the person had the tab. It names the tab's address,
 * which the agent can read anyway, and whether the person clicked or typed, never what they typed or read.
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
