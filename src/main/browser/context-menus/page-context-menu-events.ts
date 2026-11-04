import type { ContextMenuParams, Rectangle, WebContents } from 'electron'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { showContextMenu } from './page-context-menu.js'

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
 * its items act on stays in view.
 */
export function attachPageContextMenuEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    if (browser.isHumanInteractionLocked(tab)) return
    showContextMenu(browser, tab, params, {
      at: pageMenuPoint(tab.view.getBounds(), params),
      whileOpen: () => browser.mcpActivityFollower.pageMenuOpened()
    })
  })
}
