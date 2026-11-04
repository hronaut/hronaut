import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

// The workspaces the shell's tab strip folds, as it last said. The strip keeps them; main only needs them to hand the
// view past their tabs, as Chrome's view never goes to a tab of a collapsed group.
const foldedByBrowser = new WeakMap<Browser, ReadonlySet<string>>()

/** Takes the workspaces the tab strip folds now, in place of the ones it said before. */
export function setFoldedWorkspaces(browser: Browser, workspaceIds: readonly string[]): void {
  foldedByBrowser.set(browser, new Set(workspaceIds))
}

/** Whether the tab is in a workspace the tab strip folds. */
export function isInFoldedWorkspace(browser: Browser, tab: BrowserTab): boolean {
  return tab.mcpGroupId !== undefined && (foldedByBrowser.get(browser)?.has(tab.mcpGroupId) ?? false)
}
