import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PanelWindowRefs } from './windows/panel-window.js'
import { DETACHABLE_PANEL_IDS, PANEL_DOCKS, type DetachablePanelId, type PanelDock } from '../shared/types.js'

interface PanelWindowIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Admits only the detached panel window's shell document. */
  assertPanelShellSender(event: IpcMainInvokeEvent): void
  /** Opens the panel in its own window, or shows it in the one already open. */
  openPanelWindow(panel: DetachablePanelId): Promise<void>
  /** Closes the panel window, or keeps one that is still being opened from opening. */
  closePanelWindow(): void
  /**
   * The detached window, the panel it shows and whether it is closing to dock its panel again, so the shell is not
   * told it simply closed; index.ts creates the record, and the panel window's own module opens and resets it.
   */
  panelWindowRefs: Pick<PanelWindowRefs, 'window' | 'panel' | 'redocking'>
  detachedPanelTitle(panel: DetachablePanelId): string
  mainWindow(): Pick<BrowserWindow, 'isDestroyed' | 'webContents'> | null
  sendToPanelWindow(channel: string, ...args: unknown[]): void
}

function isDetachablePanelId(value: unknown): value is DetachablePanelId {
  return typeof value === 'string' && (DETACHABLE_PANEL_IDS as readonly string[]).includes(value)
}

function isPanelDock(value: unknown): value is PanelDock {
  return typeof value === 'string' && (PANEL_DOCKS as readonly string[]).includes(value)
}

/**
 * The detached panel window: open it, close it, switch its panel and dock the panel again. Dependencies stay
 * lazy because handlers are registered before the window loads.
 */
export function registerPanelWindowIpc(ipcMain: Pick<IpcMain, 'handle'>, host: PanelWindowIpcHost): void {
  ipcMain.handle('panel-window:open', async (event, panel: unknown) => {
    host.assertMainShellSender(event)
    if (!isDetachablePanelId(panel)) throw new TypeError('Invalid detachable panel')
    await host.openPanelWindow(panel)
  })
  ipcMain.handle('panel-window:close', (event) => {
    host.assertTrustedSender(event)
    host.closePanelWindow()
  })
  ipcMain.handle('panel-window:set-active', (event, panel: unknown) => {
    host.assertPanelShellSender(event)
    if (!isDetachablePanelId(panel)) throw new TypeError('Invalid detachable panel')
    host.panelWindowRefs.panel = panel
    host.panelWindowRefs.window?.setTitle(host.detachedPanelTitle(panel))
    if (host.mainWindow() && !host.mainWindow()!.isDestroyed() && !host.mainWindow()!.webContents.isDestroyed()) {
      host.mainWindow()!.webContents.send('panel-window:active-panel', panel)
    }
  })
  // Bookmark all tabs with Bookmarks in its own window: the name is asked for there, once it shows Bookmarks. Main
  // sends the request after the window has loaded and been told to show Bookmarks, on the same channel as a tab's menu.
  ipcMain.handle('panel-window:bookmark-all-tabs', async (event, workspaceId: unknown) => {
    host.assertMainShellSender(event)
    if (workspaceId !== null && typeof workspaceId !== 'string') throw new TypeError('Invalid workspace')
    await host.openPanelWindow('bookmarks')
    host.sendToPanelWindow('browser:bookmark-all-tabs-requested', workspaceId)
  })
  ipcMain.handle('panel-window:redock', (event, panel: unknown, dock: unknown) => {
    host.assertPanelShellSender(event)
    if (!isDetachablePanelId(panel) || !isPanelDock(dock) || dock === 'window') throw new TypeError('Invalid panel redock request')
    host.panelWindowRefs.redocking = true
    if (host.mainWindow() && !host.mainWindow()!.isDestroyed() && !host.mainWindow()!.webContents.isDestroyed()) {
      host.mainWindow()!.webContents.send('panel-window:redock-requested', { panel, dock })
    }
    host.panelWindowRefs.window?.close()
  })
}
