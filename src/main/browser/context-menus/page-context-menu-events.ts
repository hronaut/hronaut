import { clipboard, type ContextMenuParams, type Rectangle, type WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { inputLockChanging } from '../interaction-lock/input-lock-state.js'
import { shownPageFullscreenTab } from '../window-layout/content-area.js'
import { showContextMenu } from './page-context-menu.js'

/** How long a text field's menu waits to learn whether the clipboard holds text before it opens without knowing. */
const CLIPBOARD_WAIT_MS = 500

/**
 * Whether the clipboard holds text, by the types it offers, as Chrome reads it for a field's Paste as plain text. To
 * answer, Electron also reads a bookmark on Windows and the formats a website wrote under its own names; nothing it
 * reads reaches Hronaut's code. A clipboard that cannot say leaves it to the field.
 */
async function clipboardHoldsText(): Promise<boolean | undefined> {
  try {
    return await clipboard.has('text/plain')
  } catch {
    return undefined
  }
}

/**
 * Where the page's menu opens in the window, as in Chrome: at the point the page reports, in the page's view. That is
 * the pointer or the touch for a right-click or a long press, and the focused element or the selection for the Menu
 * key or Shift+F10, wherever the pointer is. A point the keyboard asked for stays inside the view, as a selection
 * scrolled out of it would put the menu elsewhere; a mouse's stays where the button was let go, even over the toolbar.
 */
export function pageMenuPoint(view: Rectangle, params: Pick<ContextMenuParams, 'x' | 'y' | 'menuSourceType'>): { x: number, y: number } {
  const inside = (value: number, size: number): number => params.menuSourceType === 'mouse' ? value : Math.min(Math.max(value, 0), size - 1)
  return { x: view.x + Math.round(inside(params.x, view.width)), y: view.y + Math.round(inside(params.y, view.height)) }
}

/**
 * Replaces the page's own context menu with Hronaut's on every right-click, Menu key or Shift+F10; while the
 * person's input to the tab is locked or a change of that lock waits for the page, or trusted chrome covers the page,
 * no menu opens. Following an agent waits
 * while the menu is open, so the page its items act on stays in view. As in Chrome, a field that takes a paste first
 * learns whether the clipboard holds text, for its Paste as plain text, briefly; a newer right-click takes over from
 * one still waiting, and none opens once its tab was locked, closed or left view, or its frame was replaced or
 * removed, meanwhile. On macOS it does not ask: Electron's answer there also reads the
 * pasteboard's link and the find pasteboard, which macOS can ask the person to allow, so Paste and Match Style follows
 * the field, and a misspelled word's menu, which has none, does not ask.
 */
export function attachPageContextMenuEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  let latestRequest = 0
  // The lock reads unlocked as soon as an unlock is asked for, while an agent's right-click or Shift+F10 on the page,
  // which needs it locked, may still be under way and opens the page's own menu; Hronaut's opens once it applies.
  const locked = (): boolean => browser.isHumanInteractionLocked(tab) || inputLockChanging(browser, tab)
  webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const request = ++latestRequest
    if (locked()) return
    // Electron reads the frame again on each read, and gives none once it is gone, as after a navigation to another
    // site or an iframe's removal; a navigation that keeps it keeps the menu, as in Chrome.
    const frame = params.frame
    const show = (holdsText?: boolean): void => {
      if (request !== latestRequest || webContents.isDestroyed() || findTab(browser, tab.id) !== tab || locked()) return
      // An agent's tool or a tray click can bring another tab into view, or the other pane's page fill the window, and
      // trusted chrome, such as an agent's approval, can cover the page, meanwhile; no menu opens over trusted chrome.
      const fullscreenTab = shownPageFullscreenTab(browser)
      const inView = fullscreenTab ? fullscreenTab === tab : browser.activeTabId === tab.id || browser.splitViewContains(tab.id)
      if (!inView || browser.browserContentOccluded) return
      if (frame && (frame.isDestroyed() || frame.detached || params.frame !== frame)) return
      const at = pageMenuPoint(tab.view.getBounds(), params)
      showContextMenu(browser, tab, params, { at, whileOpen: () => browser.mcpActivityFollower.pageMenuOpened() }, holdsText)
    }
    if (!params.isEditable || !params.editFlags.canPaste || params.misspelledWord || process.platform === 'darwin') {
      show()
      return
    }
    let settled = false
    const showOnce = (holdsText?: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      show(holdsText)
    }
    const timer = setTimeout(() => showOnce(), CLIPBOARD_WAIT_MS)
    void clipboardHoldsText().then(showOnce)
  })
}
