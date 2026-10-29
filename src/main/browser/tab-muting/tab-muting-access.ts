import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/**
 * The tab fields muting reads and writes: its address, its page, its own
 * saved mute preference, whether it is muted now, and whether that is for its
 * website, as Mute Site keeps it.
 */
export interface TabMutingTab {
  url: string
  webContents: WebContents
  tabMuted: boolean
  muted: boolean
  mutedBySite: boolean
}

/**
 * What muting tabs needs from the tab manager, which keeps the tabs, the
 * global mute preference and state publication private. The global mute
 * preference stays a manager field because restoring, saving and creating
 * tabs read it too; it is read again at every use.
 */
export interface TabMutingAccess<Tab extends TabMutingTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** Whether every tab is muted. */
  allTabsMuted(): boolean
  setAllTabsMutedPreference(muted: boolean): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
