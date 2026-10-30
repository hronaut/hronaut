import { SHELL_IPC } from '../../shared/ipc/shell.js'
import { SHELL_TOOLTIP_IPC } from '../../shared/ipc/shell-tooltip.js'
import type { HronautAppApi, HronautShellApi, HronautShellRequestsApi } from '../../shared/types.js'
import { createPanelRequestBuffer } from '../panel-requests.js'
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

/** window.hronaut's app itself: its window, Quit and the clipboard. */
export const appApi: HronautAppApi = {
  show: () => invoke(SHELL_IPC.show),
  quit: () => invoke(SHELL_IPC.quit),
  copyText: (text) => invoke(SHELL_IPC.copyText, text)
}

// Main asks a panel window it has just opened for Bookmark all tabs' name once the window has loaded, which can be
// before its shell mounts and listens.
const bookmarkAllTabsRequests = createPanelRequestBuffer<string | null>()
subscribe(SHELL_IPC.bookmarkAllTabsRequested, (workspaceId: unknown) => {
  bookmarkAllTabsRequests.receive(typeof workspaceId === 'string' ? workspaceId : null)
})

/** window.hronaut's requests from main's menus and shortcuts for the shell to carry out. */
export const shellRequestsApi: HronautShellRequestsApi = {
  onShortcutRequested: (listener) => subscribe(SHELL_IPC.shortcutRequested, (action) => listener(action)),
  onHomeWorkspaceEditorRequested: (listener) => subscribe(SHELL_IPC.homeWorkspaceEditorRequested, (request) => listener(request)),
  onTabGroupEditRequested: (listener) => subscribe(SHELL_IPC.tabGroupEditRequested, (groupId) => listener(groupId)),
  onNewTabRequested: (listener) => subscribe(SHELL_IPC.newTabRequested, (workspaceId: unknown) => {
    listener(typeof workspaceId === 'string' ? workspaceId : undefined)
  }),
  onVisitHistoryRequested: (listener) => subscribe(SHELL_IPC.visitHistoryRequested, () => listener()),
  onBookmarkAllTabsRequested: bookmarkAllTabsRequests.subscribe,
  onAddressPasteAndGo: (listener) => subscribe(SHELL_IPC.addressPasteAndGo, (text: unknown) => {
    if (typeof text === 'string') listener(text)
  })
}
