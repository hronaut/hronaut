import { join } from 'node:path'
import type { WebPreferences } from 'electron'
import { MAX_BROWSER_TABS } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { assertWorkspaceCanOpenTab } from '../workspace-operations/workspace-operations.js'

/** Refuses a new tab past the tab limit, in an unknown workspace, or in a workspace that cannot take one now. */
export function assertCanCreateTab(browser: Browser, mcpGroupId: string | undefined, allowBusyWorkspace: boolean): void {
  if (browser.tabs.size >= MAX_BROWSER_TABS) throw new LocalizedError('appErrors.tabs.limit', { max: MAX_BROWSER_TABS })
  if (mcpGroupId && !browser.mcpTabGroups.has(mcpGroupId)) {
    throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${mcpGroupId}` })
  }
  if (mcpGroupId && !allowBusyWorkspace) assertWorkspaceCanOpenTab(browser, mcpGroupId)
}

/**
 * The web preferences of every website tab: Hronaut's page script in an isolated world, a sandboxed renderer without
 * Node, and the web's own security. A page a tab opens for a window gets them too. As in Chrome, a website's second
 * alert or confirm box onward offers to stop its boxes, so a page that shows them one after another cannot hold the
 * window, which each box blocks until it is answered.
 */
export function pageWebPreferences(browser: Browser): WebPreferences {
  return {
    preload: join(__dirname, '../preload/page.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    safeDialogs: true,
    safeDialogsMessage: browser.text('native.dialog.preventMoreDialogs')
  }
}
