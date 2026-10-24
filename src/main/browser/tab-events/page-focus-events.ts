import { webContents as electronWebContents, type WebContents } from 'electron'
import type { PageFocusEventsAccess, PageFocusEventsTab } from './page-focus-events-access.js'

/**
 * Follows focus moving into the page. While trusted chrome covers the pages,
 * the page gives keyboard focus back to the window on the next turn unless
 * an agent's input put it there. Otherwise the tab becomes recently active
 * and wakes if it sleeps, and an agent focusing the other split pane makes
 * that pane the active tab.
 */
export function attachPageFocusEvents<Tab extends PageFocusEventsTab>(access: PageFocusEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.on('focus', () => {
    if (access.restoringLayout()) return
    if (access.browserContentOccluded() && !access.agentInputWebContents().has(webContents.id)) {
      // A page kept on screen for its snapshot must not take keyboard focus from trusted chrome.
      // Chromium can ignore a re-entrant transfer from this callback, so restore on the next turn.
      setImmediate(() => {
        if (
          access.browserContentOccluded()
          && !access.window().isDestroyed()
          && access.window().isFocused()
          && !webContents.isDestroyed()
          && electronWebContents.getFocusedWebContents()?.id === webContents.id
        ) {
          // Such as when the person comes back to the window they left in this page: a question over it gives it back.
          access.coveredPageTookKeyboard(webContents)
          access.window().webContents.focus()
        }
      })
      return
    }
    tab.lastActiveAt = Date.now()
    if (tab.sleeping) void access.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake focused tab:', error))
    // A WebContentsView can receive a delayed programmatic focus while its
    // sibling is being restored. Human split-pane activation is handled by
    // the native mouse event below; explicit agent focus remains intentional.
    if (!access.agentInputWebContents().has(webContents.id) || !access.splitViewContains(tab.id) || access.activeTabId() === tab.id) return
    access.writeActiveTabId(tab.id)
    access.markTabActiveInGroup(tab)
    access.changed()
  })
}
