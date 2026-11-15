import type { WebContents } from 'electron'
import { SHELL_IPC } from '../../../shared/ipc/shell.js'
import { sendTo } from '../../typed-ipc.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'

// Stops each pane's keyboard guard, so a pane opened beside again keeps a single one.
const keyboardGuards = new WeakMap<WebContents, () => void>()

/** Where the keyboard is as a loading pane shows: the active pane's page, or Hronaut's own controls, such as a field. */
export type PaneKeyboard = 'page' | 'shell'

/**
 * A page still loading its first document, such as a link just opened beside the page or a tab of a split view put
 * aside that wakes to show again, takes the keyboard when its view first shows, though the person is on the other
 * pane. Until that document arrives, the keyboard goes back where it last went: where it is now, then the active
 * pane's page or Hronaut's own controls as the person or Hronaut gives either of them the keyboard. That stops once the
 * person or an agent made the loading pane active, or the split changed.
 */
export function keepKeyboardFromLoadingPane(browser: Browser, active: BrowserTab, loading: BrowserTab, keyboardNow: PaneKeyboard = 'page'): void {
  const contents = loading.webContents
  keyboardGuards.get(contents)?.()
  // A new tab's load may not have started yet, so only a page that already shows a document is left alone.
  if (contents.getURL() !== '' && !contents.isLoadingMainFrame()) return
  const shell = browser.window.webContents
  let keyboard = keyboardNow
  const generation = browser.splitViewGeneration
  const superseded = (): boolean => browser.splitViewGeneration !== generation || browser.activeTabId !== active.id
    || findTab(browser, active.id) !== active || active.webContents.isDestroyed() || contents.isDestroyed()
  // A guard the split left behind stops as the keyboard next moves, not only once its pane is done loading.
  const keyboardTo = (where: PaneKeyboard) => (): void => {
    if (superseded()) stop()
    else keyboard = where
  }
  const toPage = keyboardTo('page')
  const toShell = keyboardTo('shell')
  // Chromium can ignore a focus change made from the focus event itself, so it is given back on the next turn.
  const giveBack = (): void => {
    setImmediate(() => {
      if (superseded()) {
        stop()
        return
      }
      if (!contents.isFocused()) return
      if (keyboard === 'page') focusTabOrTrustedChrome(browser, active)
      else if (!browser.window.isDestroyed() && browser.window.isFocused() && !shell.isDestroyed()) {
        // Told first, as when a tab's field gets the keyboard back, so the address field opens no suggestions.
        sendTo(shell, SHELL_IPC.keyboardGivenBack)
        shell.focus()
      }
    })
  }
  const stop = (): void => {
    if (keyboardGuards.get(contents) === stop) keyboardGuards.delete(contents)
    contents.off('focus', giveBack)
    contents.off('did-navigate', stop)
    contents.off('did-fail-load', stop)
    contents.off('did-stop-loading', stop)
    contents.off('destroyed', stop)
    active.webContents.off('focus', toPage)
    shell.off('focus', toShell)
  }
  keyboardGuards.set(contents, stop)
  contents.on('focus', giveBack)
  contents.on('did-navigate', stop)
  contents.on('did-fail-load', stop)
  contents.on('did-stop-loading', stop)
  contents.on('destroyed', stop)
  active.webContents.on('focus', toPage)
  shell.on('focus', toShell)
}
