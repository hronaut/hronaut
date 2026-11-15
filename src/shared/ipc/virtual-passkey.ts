import type { BrowserState } from '../types.js'
import type { InvokeChannel } from './channel.js'

/** The address bar's stop for an agent's virtual passkey in a tab. */
export const VIRTUAL_PASSKEY_IPC = {
  /** Shell → main: removes the tab's virtual passkey; it works whatever the agent's state, including while paused. */
  stop: 'browser:stop-virtual-passkey' as InvokeChannel<[tabId: string], BrowserState>
} as const
