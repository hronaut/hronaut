import type { BrowserState } from '../types.js'
import type { InvokeChannel } from './channel.js'

/** The address bar's stop for an agent's logpoints in a tab. */
export const LOGPOINTS_IPC = {
  /** Shell → main: removes the tab's logpoints; it works whatever the agent's state, including while paused. */
  stop: 'browser:stop-logpoints' as InvokeChannel<[tabId: string], BrowserState>
} as const
