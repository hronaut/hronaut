import type { BrowserEnvironmentSettings, BrowserState, BrowserViewportEmulation } from '../types.js'
import type { InvokeChannel } from './channel.js'

/** A tab's device and environment emulation, and the address bar's reset of an agent's CSS state preview. */
export const EMULATION_IPC = {
  /** Shell → main: emulates this viewport in the tab, or none for null. */
  setViewport: 'browser:set-tab-viewport' as InvokeChannel<[tabId: string, viewport: BrowserViewportEmulation | null], BrowserState>,
  /** Shell → main: emulates this environment in the tab. */
  setEnvironment: 'browser:set-tab-environment' as InvokeChannel<[tabId: string, environment: BrowserEnvironmentSettings], BrowserState>,
  /** Shell → main: ends all of the tab's emulation. */
  reset: 'browser:reset-tab-emulation' as InvokeChannel<[tabId: string], BrowserState>,
  /** Shell → main: applies the tab's emulation again, as after Hronaut could not confirm it was applied. */
  recover: 'browser:recover-tab-emulation' as InvokeChannel<[tabId: string], BrowserState>,
  /** Shell → main: the address bar's reset of an agent's CSS state preview; it works whatever the agent's state. */
  clearCssStatePreview: 'browser:clear-css-state-preview' as InvokeChannel<[tabId: string], BrowserState>
} as const
