import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'

// Stops each pane's keyboard guard, so a pane opened beside again keeps a single one.
const keyboardGuards = new WeakMap<WebContents, () => void>()

/**
 * A page still loading its first document, such as a link just opened beside the page or a tab of a split view put
 * aside that wakes to show again, takes the keyboard when its view first shows, though the person is on the other
 * pane. Until that document arrives, the keyboard goes back to the active pane, or where giveKeyboard puts it, unless
 * the person or an agent made the loading pane active meanwhile or the split changed.
 */
export function keepKeyboardFromLoadingPane(
  browser: Browser,
  active: BrowserTab,
  loading: BrowserTab,
  giveKeyboard: () => void = () => focusTabOrTrustedChrome(browser, active)
): void {
  const contents = loading.webContents
  keyboardGuards.get(contents)?.()
  // A new tab's load may not have started yet, so only a page that already shows a document is left alone.
  if (contents.getURL() !== '' && !contents.isLoadingMainFrame()) return
  const generation = browser.splitViewGeneration
  const superseded = (): boolean => browser.splitViewGeneration !== generation || browser.activeTabId !== active.id
    || findTab(browser, active.id) !== active || active.webContents.isDestroyed() || contents.isDestroyed()
  // Chromium can ignore a focus change made from the focus event itself, so it is given back on the next turn.
  const giveBack = (): void => {
    setImmediate(() => {
      if (superseded()) {
        stop()
        return
      }
      if (contents.isFocused()) giveKeyboard()
    })
  }
  const stop = (): void => {
    if (keyboardGuards.get(contents) === stop) keyboardGuards.delete(contents)
    contents.off('focus', giveBack)
    contents.off('did-navigate', stop)
    contents.off('did-fail-load', stop)
    contents.off('did-stop-loading', stop)
    contents.off('destroyed', stop)
  }
  keyboardGuards.set(contents, stop)
  contents.on('focus', giveBack)
  contents.on('did-navigate', stop)
  contents.on('did-fail-load', stop)
  contents.on('did-stop-loading', stop)
  contents.on('destroyed', stop)
}
