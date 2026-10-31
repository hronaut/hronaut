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
 * Whether the tab can go Back and Forward, read without its history's pages: the state is built many times a second
 * while pages load, and reading every tab's whole history took a good part of it. The sleeping page is none to go to.
 */
export function navigationButtons(tab: BrowserTab): { canGoBack: boolean; canGoForward: boolean } {
  const history = tab.sleepNavigationHistory
  if (history) return { canGoBack: history.index > 0, canGoForward: history.index < history.entries.length - 1 }
  if (tab.webContents.isDestroyed()) return { canGoBack: false, canGoForward: false }
  try {
    const navigation = tab.webContents.navigationHistory
    const shown = navigation.getActiveIndex()
    const length = navigation.length()
    const pageTo = (step: number): boolean => {
      for (let index = shown + step; index >= 0 && index < length; index += step) {
        if (navigation.getEntryAtIndex(index)?.url !== SLEEPING_PAGE_URL) return true
      }
      return false
    }
    // Chromium goes Back or Forward only past pages the person moved on from, so a page that opened the next by script
    // without the person's activation is none to go to: with only such pages behind, Back does nothing, as in Chrome.
    if (shown < 0) return { canGoBack: false, canGoForward: false }
    return { canGoBack: navigation.canGoBack() && pageTo(-1), canGoForward: navigation.canGoForward() && pageTo(1) }
  } catch {
    // Electron can destroy the page between the calls.
    return { canGoBack: false, canGoForward: false }
  }
}
