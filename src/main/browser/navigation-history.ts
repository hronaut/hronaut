import type { NavigationEntry } from 'electron'
import type { BrowserTab } from './browser-tab.js'
import { SLEEPING_PAGE_URL } from './tab-sleep/sleeping-page.js'

export interface NavigationHistorySource {
  isDestroyed(): boolean
  navigationHistory?: {
    getAllEntries(): NavigationEntry[]
    getActiveIndex(): number
  }
}

export interface NavigationHistorySnapshot {
  entries: NavigationEntry[]
  index: number
}

export function safeNavigationHistorySnapshot(
  webContents: NavigationHistorySource | null | undefined
): NavigationHistorySnapshot {
  if (!webContents || webContents.isDestroyed() || !webContents.navigationHistory) {
    return { entries: [], index: -1 }
  }
  try {
    return {
      entries: webContents.navigationHistory.getAllEntries(),
      index: webContents.navigationHistory.getActiveIndex()
    }
  } catch {
    // Electron can destroy a WebContents between isDestroyed() and the
    // navigationHistory calls during renderer failure or tab teardown.
    return { entries: [], index: -1 }
  }
}

/**
 * Each tab's Back and Forward, with where its history stood when they were read: the place shown, the number of pages
 * and the tab's navigations and documents. A page Electron reads comes with its saved state, so reading them again for
 * each tab in each state built took a good part of main's time under agents.
 */
const navigationButtonsRead = new WeakMap<BrowserTab, { at: string; buttons: { canGoBack: boolean; canGoForward: boolean } }>()

/**
 * Whether the tab can go Back and Forward, read from the pages next to the one shown until one is not the sleeping
 * page, which is none to go to: the state is built many times a second while pages load. A history that has not moved
 * since is not read again; a page added, removed or gone to, in the same document too, moves it.
 */
export function navigationButtons(tab: BrowserTab): { canGoBack: boolean; canGoForward: boolean } {
  const history = tab.sleepNavigationHistory
  if (history) return { canGoBack: history.index > 0, canGoForward: history.index < history.entries.length - 1 }
  if (tab.webContents.isDestroyed()) return { canGoBack: false, canGoForward: false }
  try {
    const navigation = tab.webContents.navigationHistory
    const shown = navigation.getActiveIndex()
    const length = navigation.length()
    const at = `${shown}:${length}:${tab.navigationGeneration}:${tab.documentGeneration}`
    const read = navigationButtonsRead.get(tab)
    if (read?.at === at) return read.buttons
    const pageTo = (step: number): boolean => {
      for (let index = shown + step; index >= 0 && index < length; index += step) {
        if (navigation.getEntryAtIndex(index)?.url !== SLEEPING_PAGE_URL) return true
      }
      return false
    }
    const buttons = shown < 0 ? { canGoBack: false, canGoForward: false } : { canGoBack: pageTo(-1), canGoForward: pageTo(1) }
    navigationButtonsRead.set(tab, { at, buttons })
    return buttons
  } catch {
    // Electron can destroy the page between the calls.
    return { canGoBack: false, canGoForward: false }
  }
}
