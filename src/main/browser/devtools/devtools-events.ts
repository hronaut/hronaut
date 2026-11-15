import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { ensureDialogMonitoring } from '../website-dialogs/website-dialogs.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * Follows the page's Developer Tools: opening them ends any CSS state preview
 * and publishes the state; closing them publishes the state and monitors the
 * page's website dialogs again.
 */
export function attachDevToolsEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('devtools-opened', () => {
    void browser.cssStatePreview.clear(tab, 'devtools-opened').catch(() => undefined)
    publishChange(browser, false)
  })
  webContents.on('devtools-closed', () => {
    publishChange(browser, false)
    void ensureDialogMonitoring(browser, tab)
  })
}
