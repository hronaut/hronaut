import type { BrowserWindow } from 'electron'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'

interface HistoryMouseButtonsHost {
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  runNativeBrowserAction(action: string, callback: () => unknown): void
  tabs(): Pick<BrowserTabsManager, 'back' | 'forward'> | null
}

/**
 * The mouse's back and forward side buttons go back and forward in the shown tab, wherever the pointer is in the
 * window, as in Chrome. Windows and Linux report them to the window as app commands, which an agent's input never
 * makes: its clicks go to the page. macOS reports none.
 */
export function attachHistoryMouseButtons(window: Pick<BrowserWindow, 'on'>, host: HistoryMouseButtonsHost): void {
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward') host.runNativeBrowserAction('go back', () => host.tabs()?.back())
    else if (command === 'browser-forward') host.runNativeBrowserAction('go forward', () => host.tabs()?.forward())
  })
}
