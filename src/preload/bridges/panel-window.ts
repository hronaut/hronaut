import { PANEL_WINDOW_IPC } from '../../shared/ipc/panel-window.js'
import type { HronautPanelWindowApi } from '../../shared/types.js'
import { createPanelRequestBuffer } from '../panel-requests.js'
import { invoke, subscribe } from './ipc.js'

// The panel a new panel window is to show can arrive before the shell listens, so the latest one waits for it.
const panelRequests = createPanelRequestBuffer()
subscribe(PANEL_WINDOW_IPC.showPanel, (panel) => panelRequests.receive(panel))

/** window.hronautPanelWindow: the detached panel window, from the main window's shell and from its own. */
export const panelWindowApi: HronautPanelWindowApi = {
  open: (panel) => invoke(PANEL_WINDOW_IPC.open, panel),
  close: () => invoke(PANEL_WINDOW_IPC.close),
  setActive: (panel) => invoke(PANEL_WINDOW_IPC.setActive, panel),
  redock: (panel, dock) => invoke(PANEL_WINDOW_IPC.redock, panel, dock),
  bookmarkAllTabs: (workspaceId) => invoke(PANEL_WINDOW_IPC.bookmarkAllTabs, workspaceId),
  onPanelRequested: panelRequests.subscribe,
  onActivePanelChanged: (listener) => subscribe(PANEL_WINDOW_IPC.activePanel, (panel) => listener(panel)),
  onRedockRequested: (listener) => subscribe(PANEL_WINDOW_IPC.redockRequested, (request) => listener(request)),
  onClosed: (listener) => subscribe(PANEL_WINDOW_IPC.closed, () => listener())
}
