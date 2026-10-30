import { getTab } from '../browser-core.js'
import type { Browser } from '../browser.js'
import { FixedDateController } from './fixed-date.js'

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
