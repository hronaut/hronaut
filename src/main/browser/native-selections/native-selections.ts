import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * Ends the screenshot area selection and the element picker in progress on
 * the tab's page, as canceled, as the tab closes, its page navigates or is
 * destroyed, or its renderer goes away. When either was in progress and the
 * person's input is locked, the page's human input guard is applied again
 * without waiting for it.
 */
export function cancelNativeSelectionSessions(browser: Browser, tab: BrowserTab): void {
  const webContentsId = tab.webContents.id
  const screenshotSession = browser.screenshotAreaSessions.get(webContentsId)
  if (screenshotSession) {
    screenshotSession.canceled = true
    screenshotSession.resolve({ canceled: true })
    browser.screenshotAreaSessions.delete(webContentsId)
  }
  const elementPickerSession = browser.elementPickerSessions.get(webContentsId)
  if (elementPickerSession) {
    elementPickerSession.canceled = true
    elementPickerSession.resolve({ canceled: true })
    browser.elementPickerSessions.delete(webContentsId)
  }
  if ((screenshotSession || elementPickerSession) && browser.isHumanInteractionLocked(tab)) {
    void browser.syncHumanInteractionInputGuard(tab).catch(() => undefined)
  }
}
