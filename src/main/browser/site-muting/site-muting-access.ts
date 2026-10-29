import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import type { SitePermissionStore } from '../../site-data/site-permission-store.js'

/**
 * The tab fields muting a website reads and writes: its address and workspace, its page, its own saved mute
 * preference, whether it is muted now, whether that is for its website, and whether its website was muted when that
 * setting was last applied to it.
 */
export interface SiteMutingTab {
  url: string
  mcpGroupId?: string
  webContents: Pick<WebContents, 'isDestroyed' | 'setAudioMuted'>
  tabMuted: boolean
  muted: boolean
  mutedBySite: boolean
  siteMuteApplied: boolean
}

/** The part of the site permission store that keeps the websites muted in each workspace. */
export type SiteSoundStore = Pick<SitePermissionStore, 'decisionFor' | 'set' | 'remove'>

/**
 * What muting websites needs from the tab manager, which keeps the tabs, the global mute preference and state
 * publication private, and from the site permission store it was given.
 */
export interface SiteMutingAccess<Tab extends SiteMutingTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** Whether every tab is muted. */
  allTabsMuted(): boolean
  /** The site permission store, or null before it loaded or without one. */
  store(): SiteSoundStore | null
  /** Tells the shell windows the site permissions changed. */
  sitePermissionsChanged(): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
