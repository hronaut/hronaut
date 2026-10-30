import type { BrowserHistoryChanges, BrowserHistoryEntry } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The pages the person visited, for the History panel and Home. */
export const HISTORY_IPC = {
  /** Shell → main: every visited page. */
  list: 'visit-history:list' as InvokeChannel<[], BrowserHistoryEntry[]>,
  /** Shell → main: removes one page from the history, answering with the history after. */
  remove: 'visit-history:remove' as InvokeChannel<[id: string], BrowserHistoryEntry[]>,
  /** Shell → main: clears the history, answering with the history after. */
  clear: 'visit-history:clear' as InvokeChannel<[], BrowserHistoryEntry[]>,
  /** Main → shells: the whole history, after a change the shell asked for or on load. */
  changed: 'visit-history:changed' as EventChannel<[entries: BrowserHistoryEntry[]]>,
  /** Main → shells: pages visited or retitled, sent together a few times a second while pages load. */
  updated: 'visit-history:updated' as EventChannel<[changes: BrowserHistoryChanges]>
} as const
