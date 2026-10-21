import type { BrowserState } from '../../../shared/types.js'
import type { BrowserNetworkRecordingState } from '../network-recording.js'
import type { TakeOverMark } from '../take-over.js'

/**
 * The tab fields agent pausing reads and writes: the tab's own pause, the
 * person's take over and hand back, and the generations a hand back note
 * compares. A pause change also advances the native input environment
 * generation and ends the tab's network priority observations, which the
 * network recording helper keeps in the recording state.
 */
export interface AgentPauseTab extends BrowserNetworkRecordingState {
  id: string
  url: string
  navigationGeneration: number
  humanInteractionGeneration: number
  nativeInputEnvironmentGeneration: number
  tabAgentPaused: boolean
  takeOver?: TakeOverMark
  handedBack?: { at: number; note: string; noteWithoutUrlDetail?: string }
}

/**
 * What agent pausing needs from the tab manager, which keeps the tabs, the
 * global pause, whether tabs may be resumed during it and which tabs were,
 * the live region recorder, the CSS state preview and state publication
 * private. The global pause fields stay manager fields because the published
 * browser state reads them; they are written back through the write members.
 */
export interface AgentPauseAccess<Tab extends AgentPauseTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  tabs(): IterableIterator<Tab>
  allAgentsPaused(): boolean
  writeAllAgentsPaused(paused: boolean): void
  agentPauseOverridesAllowed(): boolean
  writeAgentPauseOverridesAllowed(allowed: boolean): void
  globallyResumedAgentTabIds(): Set<string>
  releaseLiveRegion(tab: Tab): void
  clearCssStatePreview(tab: Tab, reason: 'agent-paused'): Promise<void>
  /** Ends the tab's virtual passkey, which an agent's lost authority must not keep. */
  stopVirtualPasskey(tab: Tab, reason: 'authority-changed'): void
  /** Ends the tab's logpoints, whose values a person using the tab may reveal. */
  stopLogpoints(tab: Tab, reason: 'authority-changed'): void
  changed(persist?: boolean): void
  getState(): BrowserState
}
