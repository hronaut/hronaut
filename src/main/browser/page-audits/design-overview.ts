import { designOverviewPageScript } from '../../../shared/design-overview.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { BrowserDesignOverviewReport } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'

const DESIGN_OVERVIEW_WORLD_ID = ISOLATED_WORLDS.designOverview

/** A design overview of the tab's page, such as its colors, type and style sheets, read in its isolated world. */
export async function designOverview(browser: Browser, tabId?: string): Promise<BrowserDesignOverviewReport> {
  const tab = getTab(browser, tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before capturing a design overview')
  const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
    DESIGN_OVERVIEW_WORLD_ID,
    [{ code: designOverviewPageScript() }],
    false
  ) as Omit<BrowserDesignOverviewReport, 'tabId'>
  return { ...result, tabId: tab.id, url: redactNetworkUrl(result.url) }
}
