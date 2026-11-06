import type { BrowserHistoryChanges, BrowserHistoryEntry } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The pages the person visited, as the shell shows them. */
export const HISTORY_IPC = {
  /** Shell → main: every visited page. */
  list: 'visit-history:list' as InvokeChannel<[], BrowserHistoryEntry[]>,
  /** Shell → main: removes one page from the history, answering with the history after. */
  remove: 'visit-history:remove' as InvokeChannel<[id: string], BrowserHistoryEntry[]>,
  /** Shell → main: clears the history, answering with the history after. */
  clear: 'visit-history:clear' as InvokeChannel<[], BrowserHistoryEntry[]>,
  /** Main → shells: the whole history, after any change but visits and new titles, and when a window loads. */
  changed: 'visit-history:changed' as EventChannel<[entries: BrowserHistoryEntry[]]>,
  /** Main → shells: pages visited or retitled, and pages the history let go, sent together a few times a second. */
  updated: 'visit-history:updated' as EventChannel<[changes: BrowserHistoryChanges]>,
  /** Shell → main: the icons of the websites in the history and bookmarks, by origin. */
  siteIcons: 'visit-history:site-icons' as InvokeChannel<[], Record<string, string>>,
  /** Main → shells: websites' icons that changed, by origin, or null for those let go, sent together a few times a second. */
  siteIconsChanged: 'visit-history:site-icons-changed' as EventChannel<[icons: Record<string, string | null>]>
} as const
