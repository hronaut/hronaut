import { dialog, type WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * Asks the person **Leave site?** when a page that asks before it is left, as an editor with unsaved changes does,
 * is left by a link click, a form submission or the page's own script, as Chrome does. Electron answers the page's
 * question with this listener alone, synchronously, so the question is the system's own message box. Without it
 * Electron keeps the page and silently cancels the navigation. Hronaut's own navigations and closes add their own
 * listener and answer the question themselves, and a navigation an agent's input starts keeps the page without
 * asking, so the agent learns the page stayed and the person is not asked about work they did not start.
 */
export function attachLeaveSiteQuestion(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('will-prevent-unload', (event) => {
    if (webContents.listenerCount('will-prevent-unload') > 1) return
    if (browser.destroyed || findTab(browser, tab.id) !== tab) return
    if (browser.agentInputWebContents.has(webContents.id)) return
    const response = dialog.showMessageBoxSync(browser.window, {
      type: 'warning',
      title: browser.text('native.dialog.leavePageTitle'),
      message: browser.text('native.dialog.leavePageMessage'),
      detail: browser.text('native.dialog.leavePageDetail'),
      buttons: [browser.text('native.dialog.keepEditing'), browser.text('native.dialog.leavePage')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (response === 1) event.preventDefault()
  })
}
