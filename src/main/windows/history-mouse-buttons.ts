import type { BrowserWindow } from 'electron'
import type { Browser } from '../browser/browser.js'

interface HistoryMouseButtonsHost {
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  runNativeBrowserAction(action: string, callback: () => unknown): void
  tabs(): Pick<Browser, 'historyGesture'> | null
}

/**
 * The mouse's back and forward side buttons go back and forward in the shown tab, wherever the pointer is in the
 * window, as in Chrome, by the rules of the person's own input on that tab. Windows and Linux report them to the window
 * as app commands, which an agent's input never makes: its clicks go to the page. macOS reports none.
 */
export function attachHistoryMouseButtons(window: Pick<BrowserWindow, 'on'>, host: HistoryMouseButtonsHost): void {
  window.on('app-command', (_event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return
    const direction = command === 'browser-backward' ? 'back' : 'forward'
    // Linux reports the button as it goes down, before the press reaches the page under the pointer, which in split
    // view makes that pane the shown tab. Going once the press is through goes back in the pane the person pressed.
    setImmediate(() => host.runNativeBrowserAction(`go ${direction}`, () => host.tabs()?.historyGesture(direction)))
  })
}
