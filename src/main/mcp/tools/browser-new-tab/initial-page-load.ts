import { PAGE_LOAD_WAIT_MS } from '../../../browser/page-waits/page-load-limit.js'
import type { BrowserTabsManager } from '../../../browser/tabs-manager.js'
import { LocalizedError } from '../../../localized-error.js'

/** What the result says when the first page was still loading as the call answered. */
export const STILL_LOADING_NEXT_ACTION = 'The tab was created but its page was still loading. Wait with browser_wait before acting on it; do not repeat creation.'

/**
 * Waits until the page a new tab opened at an address stops loading, for as long as browser_navigate waits and as
 * Chrome DevTools MCP's new_page does, so the agent's next call does not act on the document that first load is about
 * to replace. The tab exists whatever happens, so a load that fails, a tab that closes and a renderer lost while
 * waiting all answer with the creation as it stands. Resolves false only when the page was still loading as the wait ended, at its time
 * limit or because the call was cancelled.
 */
export async function initialPageLoaded(
  manager: Pick<BrowserTabsManager, 'waitForPage'>,
  tabId: string,
  signal: AbortSignal | undefined,
  timeoutMs = PAGE_LOAD_WAIT_MS
): Promise<boolean> {
  if (signal?.aborted) return false
  let stopOnAbort: (() => void) | undefined
  const aborted = new Promise<false>((resolve) => {
    stopOnAbort = () => resolve(false)
    signal?.addEventListener('abort', stopOnAbort, { once: true })
  })
  try {
    return await Promise.race([
      manager.waitForPage(tabId, timeoutMs).then(
        () => true,
        (error: unknown) => !(error instanceof LocalizedError && error.key === 'appErrors.page.loadTimedOut')
      ),
      aborted
    ])
  } finally {
    signal?.removeEventListener('abort', stopOnAbort!)
  }
}
