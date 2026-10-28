import type { MemorySaverTimeoutMinutes } from '../../../shared/memory-saver.js'
import type { BrowserState } from '../../../shared/types.js'
import type { MemorySaverSweepQueue } from '../../memory-saver-sweep.js'

/** The tab fields Memory Saver reads: its id, whether it sleeps and when it was last active. */
export interface MemorySaverTab {
  id: string
  sleeping: boolean
  lastActiveAt: number
}

/**
 * What Memory Saver's settings and sleep sweep need from the tab manager,
 * which keeps the tabs, the Memory Saver settings, their generation and the
 * sweep queue private, and puts tabs to sleep and wakes them. The settings
 * stay manager fields because the constructor reads them from its options;
 * they are read again at every use, so a sweep sees a newer setting.
 */
export interface MemorySaverAccess<Tab extends MemorySaverTab> {
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Whether the tab manager was destroyed. */
  isDestroyed(): boolean
  /** Whether Memory Saver puts inactive tabs to sleep. */
  memorySaverEnabled(): boolean
  setMemorySaverEnabled(enabled: boolean): void
  /** How long a tab stays inactive before Memory Saver puts it to sleep. */
  memorySaverTimeoutMinutes(): MemorySaverTimeoutMinutes
  setMemorySaverTimeoutMinutes(timeoutMinutes: MemorySaverTimeoutMinutes): void
  /** Counts setting changes, so a sweep started before one stops. */
  memorySaverSettingsGeneration(): number
  setMemorySaverSettingsGeneration(generation: number): void
  /** The queue that runs one sweep at a time. */
  memorySaverSweeps(): MemorySaverSweepQueue
  /** Puts the tab to sleep unless something keeps it awake; returns whether it went to sleep. */
  putTabToSleep(tab: Tab, reportBlocked: boolean, isCurrent?: () => boolean): Promise<boolean>
  /** The browser state. */
  getState(): BrowserState
}
