/**
 * Runs in the postcondition's isolated world: whether the page shows the expected account and state text, as one of a
 * few fixed answers, so neither text nor any page value crosses back. `marker` is continuityMarkerInPage.
 */
export function postconditionInPage(
  origin: string,
  accountSelector: string,
  expectedAccount: string,
  stateSelector: string,
  expectedText: string,
  marker: (selector: string) => string | null
): 'matches' | 'not-yet-visible' | 'context-changed' | 'unavailable' {
  try {
    if (location.origin !== origin) return 'context-changed'
    const account = marker(accountSelector)
    if (account === null) return 'unavailable'
    if (account !== expectedAccount) return 'context-changed'
    if (document.querySelectorAll(stateSelector).length === 0) return 'not-yet-visible'
    const state = marker(stateSelector)
    if (state === null) return 'unavailable'
    return state === expectedText ? 'matches' : 'not-yet-visible'
  } catch { return 'unavailable' }
}
