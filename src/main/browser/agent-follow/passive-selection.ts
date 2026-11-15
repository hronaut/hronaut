import { webContents as electronWebContents } from 'electron'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { restingPartner } from '../split-view/resting-split-views.js'

/**
 * Shows the tab an agent works in without activating the window or giving
 * the page keyboard input: a focused window keeps focus in trusted chrome,
 * and a window that was not focused is blurred again if attaching the page
 * focused it. Returns false when the tab was already in view, which leaves
 * the view as it was.
 */
export function selectTabPassively(browser: Browser, tabId: string): boolean {
  // A tab already in view, the active tab or the other pane of the split
  // view, stays as it is: selecting the other pane would make it the active
  // pane and move keyboard focus out of the person's page.
  if (browser.activeTabId === tabId || browser.splitViewContains(tabId)) return false
  const windowWasFocused = browser.window.isFocused()
  const target = getTab(browser, tabId)
  // A tab of a split view put aside shows with the tab paired with it, whose page attaching can focus as well.
  const partner = restingPartner(browser, target)
  const shownPages = partner ? [target.webContents, partner.webContents] : [target.webContents]
  const pageFocused = (): boolean => {
    const focusedId = electronWebContents.getFocusedWebContents()?.id
    return shownPages.some((contents) => !contents.isDestroyed() && contents.id === focusedId)
  }
  let focusGuardActive = windowWasFocused
  let focusGuardTimer: NodeJS.Timeout | undefined
  const releaseFocusGuard = (): void => {
    if (!focusGuardActive) return
    focusGuardActive = false
    if (focusGuardTimer) clearTimeout(focusGuardTimer)
    for (const contents of shownPages) contents.removeListener('focus', redirectWebsiteFocus)
  }
  const redirectWebsiteFocus = (): void => {
    releaseFocusGuard()
    // Chromium ignores a re-entrant focus transfer from the WebContents
    // focus callback on some Linux compositors. Restore trusted chrome on
    // the next main-process turn, after the native attachment settles.
    setImmediate(() => {
      if (browser.window.isDestroyed() || !browser.window.isFocused() || !pageFocused()) return
      browser.window.webContents.focus()
    })
  }
  if (focusGuardActive) {
    for (const contents of shownPages) contents.on('focus', redirectWebsiteFocus)
    focusGuardTimer = setTimeout(releaseFocusGuard, 1_000)
    focusGuardTimer.unref()
  }

  // A focused page cannot retain keyboard focus once its view is detached.
  // Move focus into trusted chrome before attaching the agent's page so
  // Electron cannot implicitly hand the page keyboard input during the swap.
  if (windowWasFocused) browser.window.webContents.focus()
  try {
    browser.selectTab(tabId, { focus: false })
  } catch (error) {
    releaseFocusGuard()
    throw error
  }
  if (browser.window.isDestroyed()) return true

  // Attaching a WebContentsView can focus it even when selectTab deliberately
  // omits an explicit focus call. Following agent activity is visual-only: it
  // must not activate Hronaut or redirect keyboard input into the agent's page.
  if (!windowWasFocused) {
    if (browser.window.isFocused()) browser.window.blur()
    return true
  }
  if (!browser.window.isFocused()) return true

  if (pageFocused()) redirectWebsiteFocus()
  return true
}
