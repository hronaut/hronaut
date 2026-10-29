import { webContents as electronWebContents, type WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * Follows focus moving into the page. While trusted chrome covers the pages,
 * the page gives keyboard focus back to the window on the next turn unless
 * an agent's input put it there, and is reported so that a question over it
 * can give it back once answered. Otherwise the tab becomes recently active
 * and wakes if it sleeps, and an agent focusing the other split pane makes
 * that pane the active tab.
 */
export function attachPageFocusEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('focus', () => {
    if (browser.restoringLayout) return
    if (browser.browserContentOccluded && !browser.agentInputWebContents.has(webContents.id)) {
      // A page kept on screen for its snapshot must not take keyboard focus from trusted chrome.
      // Chromium can ignore a re-entrant transfer from this callback, so restore on the next turn.
      setImmediate(() => {
        if (
          browser.browserContentOccluded
          && !browser.window.isDestroyed()
          && browser.window.isFocused()
          && !webContents.isDestroyed()
          && electronWebContents.getFocusedWebContents()?.id === webContents.id
        ) {
          // Such as when the person comes back to the window they left in this page: a question over it gives it back.
          browser.options.onCoveredPageKeyboard?.(webContents)
          browser.window.webContents.focus()
        }
      })
      return
    }
    tab.lastActiveAt = Date.now()
    if (tab.sleeping) void browser.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake focused tab:', error))
    // A WebContentsView can receive a delayed programmatic focus while its
    // sibling is being restored. Human split-pane activation is handled by
    // the native mouse event below; explicit agent focus remains intentional.
    if (!browser.agentInputWebContents.has(webContents.id) || !browser.splitViewContains(tab.id) || browser.activeTabId === tab.id) return
    browser.writeActiveTabId(tab.id)
    browser.markTabActiveInGroup(tab)
    publishChange(browser)
  })
}
