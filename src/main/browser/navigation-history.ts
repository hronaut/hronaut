import type { NavigationEntry } from 'electron'

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
