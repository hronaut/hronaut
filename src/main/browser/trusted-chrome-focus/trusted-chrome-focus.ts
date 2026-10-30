import { webContents as electronWebContents, type WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * A page waiting to take focus once trusted chrome closes, and how to stop waiting; no page while every page is kept from
 * the keyboard until then.
 */
export interface PendingTrustedChromeFocus {
  tab?: BrowserTab
  cancel: () => void
}

/**
 * Trusted chrome keeps the page under it while its exit plays, so a page
 * focused then would take keys typed into the shell. The page takes focus
 * when trusted chrome closes instead, unless the human clicks or presses a
 * key in the shell first. The repeats of a key still held from closing it,
 * such as Enter on a dialog's button, are not a new key.
 */
function focusTabAfterTrustedChrome(browser: Browser, tab: BrowserTab): void {
  const pending = browser.focusAfterTrustedChrome
  if (pending && !pending.tab) return
  cancelFocusAfterTrustedChrome(browser)
  const shell = browser.window.webContents
  const onInput = (_event: Electron.Event, input: Electron.InputEvent): void => {
    const newKey = (input.type === 'rawKeyDown' || input.type === 'keyDown')
      && !input.modifiers?.some((modifier) => modifier.toLowerCase() === 'isautorepeat')
    if (input.type === 'mouseDown' || newKey) cancelFocusAfterTrustedChrome(browser)
  }
  shell.on('input-event', onInput)
  browser.focusAfterTrustedChrome = {
    tab,
    cancel: () => {
      if (!shell.isDestroyed()) shell.removeListener('input-event', onInput)
    }
  }
}

/**
 * Keeps every page from the keyboard until trusted chrome closes, even one that was to take it then or asks for it
 * meanwhile, such as the tab selected after another closes; a page receiving agent input still takes it. Nothing waits
 * to take the keyboard once trusted chrome is gone.
 */
export function withholdFocusAfterTrustedChrome(browser: Browser): void {
  if (!browser.browserContentOccluded) return
  cancelFocusAfterTrustedChrome(browser)
  browser.focusAfterTrustedChrome = { cancel: () => undefined }
}

/** Stops waiting to focus a page after trusted chrome, returning the tab that waited. */
export function cancelFocusAfterTrustedChrome(browser: Browser): BrowserTab | undefined {
  const pending = browser.focusAfterTrustedChrome
  browser.focusAfterTrustedChrome = undefined
  pending?.cancel()
  return pending?.tab
}

/**
 * Gives keyboard focus to the tab's page in the focused window, or to the
 * shell while the person's input to the page is locked. While trusted chrome
 * covers the pages, the page takes focus once it closes. A page receiving
 * agent input takes focus regardless.
 */
export function focusTabOrTrustedChrome(browser: Browser, tab: BrowserTab): void {
  // Tab creation, replacement and renderer recovery also run in the
  // background. Only transfer keyboard focus inside an already active shell.
  if (browser.window.isDestroyed() || !browser.window.isFocused()) return
  if (browser.isHumanInteractionLocked(tab) && !browser.agentInputWebContents.has(tab.webContents.id)) {
    browser.window.webContents.focus()
    return
  }
  if (browser.browserContentOccluded && !browser.agentInputWebContents.has(tab.webContents.id)) {
    focusTabAfterTrustedChrome(browser, tab)
    return
  }
  tab.webContents.focus()
}

/**
 * Gives the keyboard back to a page that asked one of Hronaut's questions, such as Home before deleting a workspace,
 * once the question's dialog over it has closed, as a system dialog does. A click or key in the shell meanwhile keeps
 * the focus where it went. The person answered, so pages kept from the keyboard after a sign-in that closed while they
 * typed in it may take it again.
 */
export function focusPageAfterQuestion(browser: Browser, page: WebContents): void {
  if (browser.focusAfterTrustedChrome && !browser.focusAfterTrustedChrome.tab) cancelFocusAfterTrustedChrome(browser)
  const tabId = browser.webContentsToTab.get(page.id)
  const tab = tabId ? browser.tabs.get(tabId) : undefined
  if (!tab || (tab.id !== browser.activeTabId && !browser.splitViewContains(tab.id))) return
  focusTabOrTrustedChrome(browser, tab)
}

/**
 * The page that has the keyboard now, or that takes it once trusted chrome closes if it is still in view; null while
 * the person is elsewhere.
 */
export function keyboardPage(browser: Browser): WebContents | null {
  const waiting = browser.focusAfterTrustedChrome?.tab?.webContents
  if (waiting && !waiting.isDestroyed()) return waiting
  const focused = electronWebContents.getFocusedWebContents()
  return focused && browser.webContentsToTab.has(focused.id) ? focused : null
}

/**
 * Gives the keyboard to the page in view, or the active pane of a split view, as F6 does from Chrome's toolbar, when
 * this window's shell asks; a panel in its own window has no page beside it. Under a lock on the person's input the
 * shell keeps it, and under trusted chrome the page takes it once that closes.
 */
export function focusActivePage(browser: Browser, shell: WebContents): void {
  if (shell !== browser.window.webContents) return
  const tab = browser.activeTabId ? browser.tabs.get(browser.activeTabId) : undefined
  if (tab && !tab.webContents.isDestroyed()) focusTabOrTrustedChrome(browser, tab)
}
