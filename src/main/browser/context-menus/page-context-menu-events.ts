import { clipboard, type ContextMenuParams, type Rectangle, type WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { showContextMenu, type PageMenuClipboard } from './page-context-menu.js'

/** How long a text field's menu waits to learn what the clipboard holds before it opens without knowing. */
const CLIPBOARD_WAIT_MS = 500

/** What the clipboard holds, by the types it offers, as Chrome reads it for a field's menu; one it cannot read, nothing. */
async function clipboardHoldings(): Promise<PageMenuClipboard> {
  try {
    const items = await clipboard.read()
    return { holdsAnything: items.some((item) => item.types.length > 0), holdsText: items.some((item) => item.types.includes('text/plain')) }
  } catch {
    return { holdsAnything: false, holdsText: false }
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
 * person's input to the tab is locked, no menu opens. Following an agent waits while the menu is open, so the page
 * its items act on stays in view. As in Chrome, a field that takes a paste first learns what the clipboard holds, for
 * its Paste items, briefly; a newer right-click takes over from one still waiting, and a menu whose tab was locked or
 * closed meanwhile does not open.
 */
export function attachPageContextMenuEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  let latestRequest = 0
  webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const request = ++latestRequest
    if (browser.isHumanInteractionLocked(tab)) return
    const at = pageMenuPoint(tab.view.getBounds(), params)
    const show = (held?: PageMenuClipboard): void => {
      if (request !== latestRequest || webContents.isDestroyed() || browser.isHumanInteractionLocked(tab)) return
      showContextMenu(browser, tab, params, { at, whileOpen: () => browser.mcpActivityFollower.pageMenuOpened() }, held)
    }
    if (!params.isEditable || !params.editFlags.canPaste) {
      show()
      return
    }
    let settled = false
    const showOnce = (held?: PageMenuClipboard): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      show(held)
    }
    const timer = setTimeout(() => showOnce(), CLIPBOARD_WAIT_MS)
    void clipboardHoldings().then(showOnce)
  })
}
