import { SHELL_IPC } from '../../shared/ipc/shell.js'
import { SHELL_TOOLTIP_IPC } from '../../shared/ipc/shell-tooltip.js'
import type { HronautShellApi } from '../../shared/types.js'
import { invoke, send, subscribe } from './ipc.js'

const desktopPlatform = process.platform === 'darwin' || process.platform === 'win32'
  ? process.platform
  : 'linux'

/** window.hronautShell: the shell's own window, its layout over the pages, and what main tells it. */
export const shellApi: HronautShellApi = {
  windowChrome: {
    platform: desktopPlatform,
    mode: process.argv.includes('--hronaut-window-chrome=overlay') ? 'overlay' : 'system',
    mainWindow: process.argv.includes('--hronaut-window-kind=main')
  },
  isWindowFocused: () => invoke(SHELL_IPC.isWindowFocused),
  confirm: async (question) => await invoke(SHELL_IPC.confirm, question) === true,
  setToolbarHeight: (height) => send(SHELL_IPC.toolbarHeight, height),
  setContentInsets: (insets) => send(SHELL_IPC.contentInsets, insets),
  setBrowserContentOccluded: (occluded, request) => send(SHELL_IPC.contentOccluded, occluded, request),
  onOcclusionSnapshot: (listener) => subscribe(SHELL_IPC.occlusionSnapshot, (snapshot) => listener(snapshot)),
  presentOcclusionSnapshot: (id) => send(SHELL_IPC.occlusionSnapshotPresented, id),
  setWindowControlsScrim: (color) => send(SHELL_IPC.windowControlsScrim, color),
  onOcclusionPagesHidden: (listener) => subscribe(SHELL_IPC.occlusionPagesHidden, (request: unknown) => {
    if (typeof request === 'number') listener(request)
  }),
  showTooltip: (request) => send(SHELL_TOOLTIP_IPC.show, request),
  hideTooltip: (id) => send(SHELL_TOOLTIP_IPC.hide, id),
  setFollowAgentActivitySuspended: (suspended) => send(SHELL_IPC.followAgentActivitySuspended, suspended),
  onHelpRequested: (listener) => subscribe(SHELL_IPC.helpRequested, (action) => listener(action)),
  onClipboardFailed: (listener) => subscribe(SHELL_IPC.clipboardFailed, (message) => listener(message)),
  onActionFailed: (listener) => subscribe(SHELL_IPC.actionFailed, (failure) => listener(failure))
}
