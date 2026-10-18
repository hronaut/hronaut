import { dialog, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron'
import type { MainWindowRefs } from './main-window.js'
import type { PanelWindowRefs } from './panel-window.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { BrowserActionFailure } from '../../shared/types.js'

interface ShellWindowsHost {
  /** The main window; index.ts creates the record, and every helper reads the window when it runs. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** The detached panel window, shown and told alongside the main window while it is open. */
  panelWindowRefs: Pick<PanelWindowRefs, 'window'>
  /** Why saved workspaces could not start, if they could not; the main window then stays hidden. */
  workspaceStartupFailure(): Error | undefined
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Reaching the shell windows from the main process: showing the main window and the detached panel window, sending
 * either or both of them a message while their documents are alive, asking a question on the main window, and telling
 * the main window's shell that a browser action failed.
 */
export function createShellWindows(host: ShellWindowsHost): {
  reportBrowserActionFailure(action: string, error: unknown): void
  showWindow(): void
  showWindowInactive(): void
  sendToShellWindows(channel: string, ...args: unknown[]): void
  sendToMainWindow(channel: string, ...args: unknown[]): void
  sendToPanelWindow(channel: string, ...args: unknown[]): void
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
} {
  function reportBrowserActionFailure(action: string, error: unknown): void {
    const rawMessage = error instanceof Error ? error.message : ''
    const failure: BrowserActionFailure = {
      action,
      message: /^Tab not found:/i.test(rawMessage)
        ? host.text('native.errors.tabUnavailable')
        : rawMessage || host.text('native.errors.actionFailed')
    }
    if (host.mainWindowRefs.window && !host.mainWindowRefs.window.isDestroyed() && !host.mainWindowRefs.window.webContents.isDestroyed()) {
      host.mainWindowRefs.window.webContents.send('browser:action-failed', failure)
    }
  }

  /** Shows and focuses the main window, and shows the panel window if it is hidden; not after saved workspaces failed. */
  function showWindow(): void {
    if (host.workspaceStartupFailure()) return
    if (!host.mainWindowRefs.window) return
    if (host.mainWindowRefs.window.isMinimized()) host.mainWindowRefs.window.restore()
    host.mainWindowRefs.window.show()
    host.mainWindowRefs.window.focus()
    if (host.panelWindowRefs.window && !host.panelWindowRefs.window.isDestroyed() && !host.panelWindowRefs.window.isVisible()) host.panelWindowRefs.window.show()
  }

  /** Shows both windows without focusing them, for agents' requests. */
  function showWindowInactive(): void {
    if (!host.mainWindowRefs.window) return
    // showInactive can raise an already visible window above another app.
    // Agent requests ensure visibility without changing the current stacking.
    if (!host.mainWindowRefs.window.isVisible() || host.mainWindowRefs.window.isMinimized()) host.mainWindowRefs.window.showInactive()
    if (host.panelWindowRefs.window && !host.panelWindowRefs.window.isDestroyed() && !host.panelWindowRefs.window.isVisible()) host.panelWindowRefs.window.showInactive()
  }

  function sendToShellWindows(channel: string, ...args: unknown[]): void {
    for (const window of [host.mainWindowRefs.window, host.panelWindowRefs.window]) {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, ...args)
      }
    }
  }

  function sendToMainWindow(channel: string, ...args: unknown[]): void {
    if (host.mainWindowRefs.window && !host.mainWindowRefs.window.isDestroyed() && !host.mainWindowRefs.window.webContents.isDestroyed()) {
      host.mainWindowRefs.window.webContents.send(channel, ...args)
    }
  }

  function sendToPanelWindow(channel: string, ...args: unknown[]): void {
    if (host.panelWindowRefs.window && !host.panelWindowRefs.window.isDestroyed() && !host.panelWindowRefs.window.webContents.isDestroyed()) {
      host.panelWindowRefs.window.webContents.send(channel, ...args)
    }
  }

  /** Asks on the main window, or on its own while there is none. */
  function showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
    return host.mainWindowRefs.window ? dialog.showMessageBox(host.mainWindowRefs.window, options) : dialog.showMessageBox(options)
  }

  return {
    reportBrowserActionFailure,
    showWindow,
    showWindowInactive,
    sendToShellWindows,
    sendToMainWindow,
    sendToPanelWindow,
    showMessageBox
  }
}
