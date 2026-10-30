import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { showContextMenu } from './page-context-menu.js'

/**
 * Replaces the page's own context menu with Hronaut's on every right-click;
 * while the person's input to the tab is locked, no menu opens.
 */
export function attachPageContextMenuEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    if (browser.isHumanInteractionLocked(tab)) return
    showContextMenu(browser, tab, params)
  })
}
