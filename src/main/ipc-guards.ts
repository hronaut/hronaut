import { app, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { WorkspaceStartupReads } from './workspace-startup-reads.js'
import type { MainWindowRefs } from './windows/main-window.js'
import type { PanelWindowRefs } from './windows/panel-window.js'
import { isHronautHomeUrl } from '../shared/home-url.js'
import { LocalizedError } from './localized-error.js'
import { isLoopbackHost } from '../shared/mcp-network.js'

/** The trusted shell document: the development server on a loopback host, or the packaged renderer file. */
export function trustedShellUrl(): string {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
      throw new Error('ELECTRON_RENDERER_URL must use HTTP on a loopback host')
    }
    return url.href
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/** Whether a frame's address is the expected trusted page, with or without a fragment. */
export function trustedUrlMatches(actual: string | undefined, expected: string): boolean {
  return Boolean(actual && (actual === expected || actual.startsWith(`${expected}#`)))
}

interface IpcGuardsHost {
  /** Registers invoke handlers; the browser IPC helper wraps each one in the readiness check. */
  ipcMain: Pick<IpcMain, 'handle'>
  /** Why saved workspaces could not start, if they could not; every check then rejects with it. */
  workspaceStartupFailure(): Error | undefined
  /** The saved workspaces' initialization while it runs; reads wait for it and changes are refused meanwhile. */
  tabsInitializationPromise(): Promise<void> | null
  /** The tab runtime; null until the window opens and after shutdown. */
  tabs(): BrowserTabsManager | null
  /** The tab runtime whose saved workspaces finished initializing; a replaced runtime no longer matches it. */
  initializedTabs(): BrowserTabsManager | null
  /** The main window, whose shell document the main and trusted checks admit; read on every check. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** The detached panel window and the document it loaded, which the panel and trusted checks admit. */
  panelWindowRefs: Pick<PanelWindowRefs, 'window' | 'url'>
  /** Holds workspace reads that arrive while saved workspaces initialize, until they can run or must fail. */
  workspaceStartupReads: Pick<WorkspaceStartupReads, 'run'>
}

/**
 * The checks every trusted IPC handler runs: which shell document sent the message, the main window's or the detached
 * panel window's, and whether saved workspaces are ready for browser changes. Readiness is separate from sender
 * trust; each register*Ipc module calls the checks it needs inside its own handlers.
 */
export function createIpcGuards(host: IpcGuardsHost): {
  assertTrustedShellSender(event: IpcMainInvokeEvent | IpcMainEvent): void
  isShellWindowSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean
  isMainShellSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean
  assertMainShellSender(event: IpcMainInvokeEvent | IpcMainEvent): void
  assertPanelShellSender(event: IpcMainInvokeEvent | IpcMainEvent): void
  isHronautPageSender(event: IpcMainInvokeEvent): boolean
  assertWorkspaceInitialized(): void
  assertInitializedMainShellSender(event: IpcMainInvokeEvent): void
  assertInitializedTrustedShellSender(event: IpcMainInvokeEvent): void
  runWorkspaceRead<T>(event: IpcMainInvokeEvent, assertSender: (event: IpcMainInvokeEvent) => void, read: () => T): Promise<T>
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
} {
  /**
   * Whether a message came from the shell of the main window or of the detached panel, whether or not saved workspaces
   * started; for answers that must still arrive when they did not, such as to a dialog shown while they initialized.
   */
  function isShellWindowSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
    const actual = event.senderFrame?.url
    const fromMain = Boolean(host.mainWindowRefs.window && event.sender === host.mainWindowRefs.window.webContents && trustedUrlMatches(actual, trustedShellUrl()))
    const fromPanel = Boolean(host.panelWindowRefs.window
      && host.panelWindowRefs.url
      && event.sender === host.panelWindowRefs.window.webContents
      && trustedUrlMatches(actual, host.panelWindowRefs.url))
    return fromMain || fromPanel
  }

  function assertTrustedShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    if (!isShellWindowSender(event)) throw new Error('Rejected IPC from an untrusted renderer')
  }

  /** Whether a message came from the main window's shell document, whether or not saved workspaces started. */
  function isMainShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
    const actual = event.senderFrame?.url
    return Boolean(host.mainWindowRefs.window && event.sender === host.mainWindowRefs.window.webContents && trustedUrlMatches(actual, trustedShellUrl()))
  }

  function assertMainShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    if (!isMainShellSender(event)) throw new Error('Rejected IPC from a non-primary renderer')
  }

  function assertPanelShellSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    const actual = event.senderFrame?.url
    if (!host.panelWindowRefs.window || !host.panelWindowRefs.url || event.sender !== host.panelWindowRefs.window.webContents || !trustedUrlMatches(actual, host.panelWindowRefs.url)) {
      throw new Error('Rejected IPC from a non-panel renderer')
    }
  }

  /** Whether a message came from one of Hronaut's own pages: the shell of either window, or Home. Never throws. */
  function isHronautPageSender(event: Electron.IpcMainInvokeEvent): boolean {
    try {
      return isShellWindowSender(event) || isHronautHomeUrl(event.senderFrame?.url)
    } catch {
      return false
    }
  }

  // Readiness is separate from sender trust. Never admit browser mutations into
  // the partially initialized model, including while metadata IO is pending.
  function assertWorkspaceInitialized(): void {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    if (host.tabsInitializationPromise()) throw new LocalizedError('appErrors.startup.initializing')
    if (!host.tabs() || host.initializedTabs() !== host.tabs()) throw new LocalizedError('appErrors.startup.unavailable')
  }

  function assertInitializedMainShellSender(event: Electron.IpcMainInvokeEvent): void {
    assertMainShellSender(event)
    assertWorkspaceInitialized()
  }

  function assertInitializedTrustedShellSender(event: Electron.IpcMainInvokeEvent): void {
    assertTrustedShellSender(event)
    assertWorkspaceInitialized()
  }

  function runWorkspaceRead<T>(event: Electron.IpcMainInvokeEvent, assertSender: (event: Electron.IpcMainInvokeEvent) => void, read: () => T): Promise<T> {
    const manager = host.tabs()
    return host.workspaceStartupReads.run(event, host.tabsInitializationPromise(), () => assertSender(event), () => {
      assertWorkspaceInitialized()
      if (host.tabs() !== manager) throw new LocalizedError('appErrors.startup.readUnavailable')
    }, read)
  }

  function handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void {
    host.ipcMain.handle(channel, (event, ...args) => {
      if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
      if (!['browser:get-state', 'browser:get-tab-overview-previews', 'browser:get-tab-overview-page-preview', 'split-divider:get', 'emulation-frame:get', 'page-card:get'].includes(channel)) assertWorkspaceInitialized()
      return listener(event, ...args)
    })
  }

  return {
    assertTrustedShellSender,
    isShellWindowSender,
    isMainShellSender,
    assertMainShellSender,
    assertPanelShellSender,
    isHronautPageSender,
    assertWorkspaceInitialized,
    assertInitializedMainShellSender,
    assertInitializedTrustedShellSender,
    runWorkspaceRead,
    handleBrowserIpc
  }
}
