import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { AppQuitState } from './app-lifecycle.js'
import type { FollowSuspensionState } from './overlays/agent-card-overlay.js'
import type { Browser } from './browser/browser.js'
import type { ToastOverlay } from './overlays/toast-overlay.js'
import type { SidebarOverlay } from './overlays/sidebar-overlay.js'
import { scaleShellMetric } from '../shared/interface-scale.js'
import { parseScrimColor, type ScrimColor } from '../shared/title-bar.js'
import { setContentInsets, setToolbarHeight } from './browser/window-layout/content-area.js'
import { setFollowAgentActivitySuspended, setBrowserContentOccluded } from './browser/trusted-chrome-occlusion/trusted-chrome-occlusion.js'
import { SHELL_IPC } from '../shared/ipc/shell.js'
import { TABS_IPC } from '../shared/ipc/tabs.js'

interface ShellIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent | IpcMainEvent): void
  /** Whether a message came from the main window's shell document, not a detached panel window. */
  isMainShellSender(event: IpcMainEvent): boolean
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  /** Why saved workspaces could not start, if they could not; read on every check. */
  workspaceStartupFailure(): Error | undefined
  /** Writes text to the system clipboard after earlier clipboard writes, verifying it arrived. */
  copyTextToClipboard(text: string): Promise<void>
  showWindow(): void
  /** Whether the app is quitting; the shell's Quit sets it, so closing the window quits instead of hiding it in the tray. */
  quit: AppQuitState
  /** Electron's `app.quit`. */
  quitApp(): void
  /** Electron's `BrowserWindow.fromWebContents`. */
  windowFromWebContents(webContents: WebContents): Pick<BrowserWindow, 'isFocused'> | null
  tabs(): Browser | null
  toastOverlay(): Pick<ToastOverlay, 'relayout'>
  /** The tab rail opened over the page, which a dialog over the page closes. */
  sidebarOverlay(): Pick<SidebarOverlay, 'occlusionChanged'>
  /** The backdrop of the dialog open in the main window, laid over the native window controls, or null. */
  setWindowControlsScrim(scrim: ScrimColor | null): void
  /** Restyles the native window controls for the current theme and scrim. */
  applyMainWindowTitleBarOverlay(): void
  /** What suspends following agent activity: the shell's request, which this IPC sets, and an open agent card. */
  followSuspension: FollowSuspensionState
}

/**
 * The shell's window, layout and clipboard requests. Dependencies stay lazy because handlers are
 * registered before the window loads.
 */
export function registerShellIpc(ipcMain: Pick<IpcMain, 'handle' | 'on'>, host: ShellIpcHost): void {
  host.handleBrowserIpc(SHELL_IPC.copyText, async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'string') throw new TypeError('Clipboard text must be a string')
    await host.copyTextToClipboard(value)
  })
  host.handleBrowserIpc(SHELL_IPC.show, (event) => { host.assertTrustedSender(event); host.showWindow() })
  host.handleBrowserIpc(SHELL_IPC.quit, (event) => {
    host.assertTrustedSender(event)
    host.quit.quitting = true
    host.quitApp()
  })
  ipcMain.handle(SHELL_IPC.isWindowFocused, (event) => {
    host.assertTrustedSender(event)
    return host.windowFromWebContents(event.sender)?.isFocused() ?? false
  })
  ipcMain.on(SHELL_IPC.toolbarHeight, (event, height: number) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    const browser = host.tabs()
    if (browser) setToolbarHeight(browser, scaleShellMetric(height, event.sender.getZoomFactor()))
    host.toastOverlay().relayout()
  })
  ipcMain.on(SHELL_IPC.contentInsets, (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid browser content insets')
    const { top, right, bottom, left } = value as Record<string, unknown>
    if (![top, right, bottom, left].every((inset) => typeof inset === 'number' && Number.isFinite(inset))) {
      throw new TypeError('Invalid browser content insets')
    }
    const browser = host.tabs()
    if (browser) {
      setContentInsets(browser, {
        top: scaleShellMetric(top as number, event.sender.getZoomFactor()),
        right: scaleShellMetric(right as number, event.sender.getZoomFactor()),
        bottom: scaleShellMetric(bottom as number, event.sender.getZoomFactor()),
        left: scaleShellMetric(left as number, event.sender.getZoomFactor())
      })
    }
    host.toastOverlay().relayout()
  })
  ipcMain.on(SHELL_IPC.contentOccluded, (event, occluded: unknown, request: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (typeof occluded !== 'boolean') throw new TypeError('Invalid browser content occlusion state')
    // The report that the pages left the screen names this request, so the shell can tell it from one for an earlier request.
    if (typeof request !== 'number' || !Number.isSafeInteger(request) || request < 0) throw new TypeError('Invalid browser content occlusion request')
    const tabs = host.tabs()
    if (tabs) setBrowserContentOccluded(tabs, occluded, request)
    // Without the tab runtime no page is on screen, and the shell waits for this report before a question takes answers.
    else if (occluded && !event.sender.isDestroyed()) event.sender.send(SHELL_IPC.occlusionPagesHidden, request)
    host.sidebarOverlay().occlusionChanged(occluded)
  })
  ipcMain.on(SHELL_IPC.occlusionSnapshotPresented, (event, id: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (!Number.isSafeInteger(id) || (id as number) < 1) throw new TypeError('Invalid occlusion snapshot')
    host.tabs()?.occlusionSnapshot.present(id as number)
  })
  // Detached panel windows draw the same states, but only the main window's shell paces them.
  ipcMain.on(TABS_IPC.stateDrawn, (event) => {
    if (!host.isMainShellSender(event)) return
    host.tabs()?.statePublication.drawn()
  })
  ipcMain.on(SHELL_IPC.windowControlsScrim, (event, color: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    const scrim = color === null ? null : parseScrimColor(color)
    if (color !== null && !scrim) throw new TypeError('Invalid window controls scrim')
    host.setWindowControlsScrim(scrim)
    host.applyMainWindowTitleBarOverlay()
  })
  ipcMain.on(SHELL_IPC.followAgentActivitySuspended, (event, suspended: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (typeof suspended !== 'boolean') throw new TypeError('Invalid follow-agent activity suspension state')
    host.followSuspension.shellSuspended = suspended
    const browser = host.tabs()
    if (browser) setFollowAgentActivitySuspended(browser, host.followSuspension.shellSuspended || host.followSuspension.agentCardOpen)
  })
}
