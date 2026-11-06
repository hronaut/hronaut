import { SHELL_IPC } from '../../shared/ipc/shell.js'
import { SHELL_TOOLTIP_IPC } from '../../shared/ipc/shell-tooltip.js'
import type { HronautAppApi, HronautShellApi, HronautShellRequestsApi } from '../../shared/types.js'
import { isShellTabField } from '../../shared/tab-field.js'
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
  setTabFieldFocused: (field) => send(SHELL_IPC.tabFieldFocused, field),
  setHistoryShown: (shown) => send(SHELL_IPC.historyShown, shown),
  onTabFieldFocusReturned: (listener) => subscribe(SHELL_IPC.tabFieldFocusReturned, (tabId: unknown, field: unknown) => {
    if (typeof tabId === 'string' && isShellTabField(field)) listener(tabId, field)
  }),
  onKeyboardGivenBack: (listener) => subscribe(SHELL_IPC.keyboardGivenBack, () => listener()),
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

/** window.hronaut's requests from main's menus, shortcuts and Home for the shell to carry out. */
export const shellRequestsApi: HronautShellRequestsApi = {
  onShortcutRequested: (listener) => subscribe(SHELL_IPC.shortcutRequested, (action, hold?) => {
    if (typeof hold !== 'number') {
      listener(action)
      return
    }
    // Main holds back the keys typed meanwhile, so that they go where the shortcut puts the keyboard. It is told as soon
    // as the shell is free again when the shortcut has given a text field the keyboard or selected its text by then, as
    // focusing the address does; else once the shortcut is carried out, as one that waits for main first, which may
    // give the keyboard to another field on the way, such as the field a tab had when it is shown again.
    let told = false
    const tell = (): void => {
      if (told) return
      told = true
      send(SHELL_IPC.shortcutRan, hold)
    }
    const before = textFieldWithKeyboard()
    setTimeout(() => {
      const now = textFieldWithKeyboard()
      if (now && (now.field !== before?.field || now.start !== before.start || now.end !== before.end)) tell()
    }, 0)
    let carriedOut: unknown
    try {
      carriedOut = listener(action)
    } finally {
      void Promise.resolve(carriedOut).catch(() => undefined).finally(tell)
    }
  }),
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

/** The text field of the shell's page that has the keyboard, with its selection, if one has it. */
function textFieldWithKeyboard(): { field: Element; start: number | null; end: number | null } | undefined {
  const field = document.activeElement
  if ((field instanceof HTMLInputElement && field.selectionStart !== null) || field instanceof HTMLTextAreaElement) {
    return { field, start: field.selectionStart, end: field.selectionEnd }
  }
  return field instanceof HTMLElement && field.isContentEditable ? { field, start: null, end: null } : undefined
}
