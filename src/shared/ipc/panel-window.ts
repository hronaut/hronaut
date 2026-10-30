import type { DetachablePanelId, PanelDock, PanelRedockRequest } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The detached panel window, which shows one panel, such as Bookmarks, in a window of its own. */
export const PANEL_WINDOW_IPC = {
  /** Main window → main: opens the panel in its own window, or shows it in the one open. */
  open: 'panel-window:open' as InvokeChannel<[panel: DetachablePanelId], void>,
  /** Shell → main: closes the panel window. */
  close: 'panel-window:close' as InvokeChannel<[], void>,
  /** Panel window → main: the panel window now shows this panel. */
  setActive: 'panel-window:set-active' as InvokeChannel<[panel: DetachablePanelId], void>,
  /** Panel window → main: docks the panel in the main window again, on this side, and closes the panel window. */
  redock: 'panel-window:redock' as InvokeChannel<[panel: DetachablePanelId, dock: Exclude<PanelDock, 'window'>], void>,
  /** Main window → main: opens Bookmarks in its own window to bookmark the workspace's tabs, null for those in none. */
  bookmarkAllTabs: 'panel-window:bookmark-all-tabs' as InvokeChannel<[workspaceId: string | null], void>,
  /** Main → panel window: the panel to show. */
  showPanel: 'panel-window:show-panel' as EventChannel<[panel: DetachablePanelId]>,
  /** Main → main window: the panel window switched to this panel. */
  activePanel: 'panel-window:active-panel' as EventChannel<[panel: DetachablePanelId]>,
  /** Main → main window: dock this panel again, on this side; the panel window closes. */
  redockRequested: 'panel-window:redock-requested' as EventChannel<[request: PanelRedockRequest]>,
  /** Main → main window: the panel window closed. */
  closed: 'panel-window:closed' as EventChannel<[]>
} as const
