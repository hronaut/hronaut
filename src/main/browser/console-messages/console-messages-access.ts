import type { BrowserConsoleMessage } from '../../../shared/types.js'

/** The capture paths that can report a console message; one message can arrive through several. */
export type BrowserConsoleCaptureSource = 'electron' | 'runtime-console' | 'runtime' | 'log' | 'preload' | 'lifecycle'

/** A captured console message, with the runtime's formatted presentation when it has one. */
export interface ConsoleCapture extends BrowserConsoleMessage {
  presentation?: string
}

/** A retained console message, with the capture paths that reported it and its observation generation. */
export interface BrowserConsoleMessageRecord extends ConsoleCapture {
  captureSources: Set<BrowserConsoleCaptureSource>
  observationGeneration: number
}

/**
 * The tab fields console messages read and write. The retained and pending
 * messages belong to the tab, so the tab manager's navigation, observation
 * and close handling stay authoritative for clearing them.
 */
export interface ConsoleMessagesTab {
  observationGeneration: number
  consoleMessages: BrowserConsoleMessageRecord[]
  pendingRuntimeConsoleMessages: ConsoleCapture[]
}

/** What reading console messages needs from the tab manager, which keeps the tabs private. */
export interface ConsoleMessagesAccess {
  getTab(tabId?: string): ConsoleMessagesTab
}
