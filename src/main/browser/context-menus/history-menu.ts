import { Menu, type MenuItemConstructorOptions } from 'electron'
import { safeNavigationHistorySnapshot } from '../navigation-history.js'
import type { Browser } from '../browser.js'
import { goToHistoryEntry } from '../page-navigation/page-navigation.js'
import { findTab } from '../browser-core.js'

/** As many pages as Chrome lists under Back or Forward. */
export const HISTORY_MENU_PAGES = 12
/** Longer titles end in an ellipsis, so a long title does not make the list as wide as the screen. */
const HISTORY_MENU_LABEL_LENGTH = 70
/** The start of a title or address the label is made from, so a page's megabytes-long address costs nothing to show. */
const HISTORY_MENU_LABEL_SOURCE_LENGTH = 1_000

/**
 * Shows the pages Back or Forward goes through, nearest first, as Chrome does when its arrow is right-clicked or held,
 * with Show Full History last. Picking a page goes straight to it. A tab that sleeps or is waking shows no list, as its
 * page's history is not the tab's own then; nor does a tab with nothing that way. The anchor is where the list opens,
 * in the window's CSS pixels; without one it opens at the pointer. It returns whether it showed the list.
 */
export function showHistoryMenu(browser: Browser, tabId: string,
  direction: 'back' | 'forward', anchor?: { x: number; y: number }): boolean {
  const tab = findTab(browser, tabId)
  if (!tab || tab.sleeping || tab.wakePromise) return false
  const { entries, index: activeIndex } = safeNavigationHistorySnapshot(tab.webContents)
  if (activeIndex < 0) return false
  const step = direction === 'back' ? -1 : 1
  const pages: Array<{ index: number; url: string; title: string }> = []
  for (let index = activeIndex + step; index >= 0 && index < entries.length && pages.length < HISTORY_MENU_PAGES; index += step) {
    const entry = entries[index]
    if (entry) pages.push({ index, url: entry.url, title: entry.title })
  }
  if (pages.length === 0) return false
  const runAction = (action: string, callback: () => unknown): void => {
    try {
      callback()
    } catch (error) {
      console.error(`[browser] Could not ${action} from the history list:`, error)
      browser.options.onActionFailed?.(action, error)
    }
  }
  const template: MenuItemConstructorOptions[] = [
    ...pages.map((page): MenuItemConstructorOptions => ({
      id: `history-entry-${page.index}`,
      label: historyMenuLabel(page.title.trim() || page.url),
      click: () => runAction('go to a page in the tab history', () => (
        goToHistoryEntry(browser, tab.id, { index: page.index, url: page.url, activeIndex })
      ))
    })),
    { type: 'separator' },
    {
      id: 'show-full-history',
      label: browser.text('native.context.showFullHistory'),
      click: () => runAction('show the full history', () => browser.window.webContents.send('browser:visit-history-requested'))
    }
  ]
  const window = browser.window
  const zoom = window.webContents.getZoomFactor()
  Menu.buildFromTemplate(template).popup({
    window,
    ...(anchor ? { x: Math.round(anchor.x * zoom), y: Math.round(anchor.y * zoom) } : {})
  })
  return true
}

/** A page's title or address as a menu item shows it: shortened, and with its ampersands shown rather than taken as access keys. */
export function historyMenuLabel(text: string): string {
  const bounded = text.length > HISTORY_MENU_LABEL_SOURCE_LENGTH
  const characters = Array.from((bounded ? text.slice(0, HISTORY_MENU_LABEL_SOURCE_LENGTH) : text).replace(/\s+/g, ' '))
  // The bound can split a character in two, so its last one goes too.
  if (bounded) characters.pop()
  const shortened = bounded || characters.length > HISTORY_MENU_LABEL_LENGTH
    ? `${characters.slice(0, HISTORY_MENU_LABEL_LENGTH - 1).join('').trimEnd()}…`
    : characters.join('')
  return shortened.replaceAll('&', '&&')
}
