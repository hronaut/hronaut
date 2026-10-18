import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { AppQuitState } from './app-lifecycle.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { ToastOverlay } from './toast-overlay.js'
import { scaleShellMetric } from '../shared/interface-scale.js'
import { parseScrimColor, type ScrimColor } from '../shared/title-bar.js'

type ShellIpcTabs = Pick<BrowserTabsManager,
  | 'setToolbarHeight' | 'setContentInsets' | 'setBrowserContentOccluded' | 'presentOcclusionSnapshot'
  | 'setFollowAgentActivitySuspended'>

interface ShellIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent | IpcMainEvent): void
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
  tabs(): ShellIpcTabs | null
  toastOverlay(): Pick<ToastOverlay, 'relayout'>
  /** The backdrop of the dialog open in the main window, laid over the native window controls, or null. */
  setWindowControlsScrim(scrim: ScrimColor | null): void
  /** Restyles the native window controls for the current theme and scrim. */
  applyMainWindowTitleBarOverlay(): void
  /** Whether the shell asked to stop following agent activity; an open agent card suspends it too. */
  shellFollowAgentActivitySuspended(): boolean
  setShellFollowAgentActivitySuspended(value: boolean): void
  agentCardOpen(): boolean
}

/**
 * The shell's window, layout and clipboard requests. Dependencies stay lazy because handlers are
 * registered before the window loads.
 */
export function registerShellIpc(ipcMain: Pick<IpcMain, 'handle' | 'on'>, host: ShellIpcHost): void {
  host.handleBrowserIpc('browser:copy-text', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'string') throw new TypeError('Clipboard text must be a string')
    await host.copyTextToClipboard(value)
  })
  host.handleBrowserIpc('browser:show', (event) => { host.assertTrustedSender(event); host.showWindow() })
  host.handleBrowserIpc('browser:quit', (event) => {
    host.assertTrustedSender(event)
    host.quit.quitting = true
    host.quitApp()
  })
  ipcMain.handle('shell:is-window-focused', (event) => {
    host.assertTrustedSender(event)
    return host.windowFromWebContents(event.sender)?.isFocused() ?? false
  })
  ipcMain.on('browser:toolbar-height', (event, height: number) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    host.tabs()?.setToolbarHeight(scaleShellMetric(height, event.sender.getZoomFactor()))
    host.toastOverlay().relayout()
  })
  ipcMain.on('browser:content-insets', (event, value: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid browser content insets')
    const { top, right, bottom, left } = value as Record<string, unknown>
    if (![top, right, bottom, left].every((inset) => typeof inset === 'number' && Number.isFinite(inset))) {
      throw new TypeError('Invalid browser content insets')
    }
    host.tabs()?.setContentInsets({
      top: scaleShellMetric(top as number, event.sender.getZoomFactor()),
      right: scaleShellMetric(right as number, event.sender.getZoomFactor()),
      bottom: scaleShellMetric(bottom as number, event.sender.getZoomFactor()),
      left: scaleShellMetric(left as number, event.sender.getZoomFactor())
    })
    host.toastOverlay().relayout()
  })
  ipcMain.on('browser:content-occluded', (event, occluded: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (typeof occluded !== 'boolean') throw new TypeError('Invalid browser content occlusion state')
    host.tabs()?.setBrowserContentOccluded(occluded)
  })
  ipcMain.on('browser:occlusion-snapshot-presented', (event, id: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (!Number.isSafeInteger(id) || (id as number) < 1) throw new TypeError('Invalid occlusion snapshot')
    host.tabs()?.presentOcclusionSnapshot(id as number)
  })
  ipcMain.on('shell:window-controls-scrim', (event, color: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    const scrim = color === null ? null : parseScrimColor(color)
    if (color !== null && !scrim) throw new TypeError('Invalid window controls scrim')
    host.setWindowControlsScrim(scrim)
    host.applyMainWindowTitleBarOverlay()
  })
  ipcMain.on('browser:follow-agent-activity-suspended', (event, suspended: unknown) => {
    if (host.workspaceStartupFailure()) return
    host.assertMainShellSender(event)
    if (typeof suspended !== 'boolean') throw new TypeError('Invalid follow-agent activity suspension state')
    host.setShellFollowAgentActivitySuspended(suspended)
    host.tabs()?.setFollowAgentActivitySuspended(host.shellFollowAgentActivitySuspended() || host.agentCardOpen())
  })
}
