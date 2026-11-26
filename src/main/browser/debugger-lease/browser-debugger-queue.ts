import type { Browser } from '../browser.js'
import { appendConsoleMessage } from '../console-messages/console-messages.js'
import { BrowserDebuggerQueue, DEBUGGER_OPERATION_BUDGET_MS, type DebuggerQueueBudgets, STALLED_PAGE_BUDGET_MS } from '../debugger-queue.js'
import { checkPageResponds } from '../tab-events/renderer-health-events.js'

/** The browser's queue of debugger operations, which resets a page's debugger connection when one stalls there. */
export function createDebuggerQueue(browser: Browser): BrowserDebuggerQueue {
  return new BrowserDebuggerQueue({ stalled: (contentsId, budgetMs) => resetStalledDebugger(browser, contentsId, budgetMs) }, debuggerQueueBudgets())
}

/** Integration tests shorten the budget, so a page stuck in a script stalls in seconds rather than a minute. */
function debuggerQueueBudgets(): DebuggerQueueBudgets {
  const override = Number(process.env.HRONAUT_TEST_DEBUGGER_BUDGET_MS)
  const operationMs = process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1' && Number.isSafeInteger(override) && override > 0
    ? override
    : DEBUGGER_OPERATION_BUDGET_MS
  return { operationMs, stalledPageMs: Math.min(operationMs, STALLED_PAGE_BUDGET_MS) }
}

/**
 * Resets a page's debugger connection after an operation held it past its budget. Detaching fails every command the
 * page has not answered, so the stalled operation unwinds and the page's queue moves on; the next operation attaches
 * again. The detach handler marks what the connection carried (emulation, request conditions, the main world's
 * contexts) unknown, and dialog monitoring attaches again and applies the input barrier first, which the browser
 * process answers for a page stuck in a script too. The page's console notes the reset for agents reading it, and
 * the page is asked to show it still answers: one stuck in a script shows that it is not responding, which a reload
 * replaces.
 */
export function resetStalledDebugger(browser: Browser, contentsId: number, budgetMs: number): void {
  if (browser.destroyed) return
  const tabId = browser.webContentsToTab.get(contentsId)
  const tab = tabId === undefined ? undefined : browser.tabs.get(tabId)
  const webContents = tab?.webContents
  if (!tab || !webContents || webContents.id !== contentsId || webContents.isDestroyed()) return
  appendConsoleMessage(tab, {
    timestamp: new Date().toISOString(),
    level: 'warning',
    message: `Hronaut reset its debugger connection to this page: a debugger command was not answered within ${Math.ceil(budgetMs / 1000)} s.`,
    lineNumber: 0,
    sourceId: tab.url,
    kind: 'lifecycle'
  }, 'lifecycle')
  if (webContents.debugger.isAttached()) webContents.debugger.detach()
  checkPageResponds(webContents)
}
