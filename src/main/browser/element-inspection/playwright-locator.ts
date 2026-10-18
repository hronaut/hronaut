import { normalizeBrowserGeneratedLocator, type BrowserGeneratedLocator } from '../../../shared/playwright-locator.js'
import type { BrowserElementInspectionOptions } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { playwrightLocatorScript } from '../page-scripts.js'
import { isHronautHomeUrl } from '../url.js'
import type { ElementInspectionAccess, ElementInspectionTab } from './element-inspection-access.js'

const ELEMENT_INSPECTION_WORLD_ID = ISOLATED_WORLDS.elementInspection

/**
 * A Playwright locator for the element the ref or selector names on the tab's
 * website, worked out in the element inspection world. Hronaut Home has none.
 */
export async function generatePlaywrightLocator<Tab extends ElementInspectionTab>(access: ElementInspectionAccess<Tab>, options: BrowserElementInspectionOptions): Promise<BrowserGeneratedLocator> {
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before generating a locator')
  access.validateTarget(options)
  const raw = await tab.webContents.executeJavaScriptInIsolatedWorld(
    ELEMENT_INSPECTION_WORLD_ID,
    [{ code: playwrightLocatorScript(options) }],
    false
  )
  return normalizeBrowserGeneratedLocator(tab.id, raw as Record<string, unknown>)
}
