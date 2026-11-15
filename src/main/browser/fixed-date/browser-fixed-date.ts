import { getTab } from '../browser-core.js'
import type { Browser } from '../browser.js'
import type { FixedDateAction, FixedDateResult } from '../../../shared/fixed-date.js'
import { FixedDateController, type FixedDateAuthority } from './fixed-date.js'

/** The fixed Date agents stage in the browser's tabs, for the page each tab shows and the workspace it belongs to. */
export function createFixedDateController(browser: Browser): FixedDateController {
  return new FixedDateController({
    resolve: tabId => {
      const tab = getTab(browser, tabId)
      return {
        identity: tab, page: tab.webContents, url: tab.webContents.getURL(), workspaceId: tab.mcpGroupId,
        workspaceIdentity: tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
      }
    },
    tabIdOf: page => browser.webContentsToTab.get(page.id)
  })
}

/** Reads or resets the fixed date of the tab's page, or stages one at the given instant. */
export function fixedDate(browser: Browser, tabId: string, action: FixedDateAction, epochMs: number | undefined, authority: FixedDateAuthority): FixedDateResult {
  if (action === 'status') return browser.fixedDateController.status(tabId)
  if (action === 'reset') return browser.fixedDateController.reset(tabId)
  if (epochMs === undefined) throw new Error('Give the instant to stage as at or epochMs')
  return browser.fixedDateController.stage(tabId, epochMs, authority)
}
