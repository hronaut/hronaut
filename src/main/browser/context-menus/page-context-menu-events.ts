import { clipboard, type ContextMenuParams, type Rectangle, type WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { showContextMenu } from './page-context-menu.js'

/** How long a text field's menu waits to learn whether the clipboard holds text before it opens without knowing. */
const CLIPBOARD_WAIT_MS = 500

/**
 * Whether the clipboard holds text, by the types it offers, as Chrome reads it for a field's Paste as plain text; it
 * reads no contents. A clipboard that cannot say leaves it to the field.
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
 * person's input to the tab is locked, no menu opens. Following an agent waits while the menu is open, so the page
 * its items act on stays in view. As in Chrome, a field that takes a paste first learns whether the clipboard holds
 * text, for its Paste as plain text, briefly; a newer right-click takes over from one still waiting, and none opens
 * once its tab was locked, closed or left view, or its frame's page was replaced, meanwhile.
 */
export function attachPageContextMenuEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  let latestRequest = 0
  webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const request = ++latestRequest
    if (browser.isHumanInteractionLocked(tab)) return
    const show = (holdsText?: boolean): void => {
      if (request !== latestRequest || webContents.isDestroyed() || findTab(browser, tab.id) !== tab || browser.isHumanInteractionLocked(tab)) return
      // An agent's tool or a tray click can bring another tab into view, or the frame can load another page, meanwhile.
      const inView = browser.activeTabId === tab.id || browser.splitViewContains(tab.id)
      if (!inView || (params.frame && (params.frame.isDestroyed() || params.frame.detached))) return
      const at = pageMenuPoint(tab.view.getBounds(), params)
      showContextMenu(browser, tab, params, { at, whileOpen: () => browser.mcpActivityFollower.pageMenuOpened() }, holdsText)
    }
    if (!params.isEditable || !params.editFlags.canPaste) {
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
