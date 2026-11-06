import type { BrowserWindow } from 'electron'
import type { Browser } from '../browser/browser.js'
import { historyGesture } from '../browser/history-gesture/history-gesture.js'
import { isHronautHomeUrl } from '../../shared/home-url.js'
import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'

interface HistoryMouseButtonsHost {
  /** Runs a browser action from native UI and reports its failure to the shell; skipped until saved workspaces are up. */
  runNativeBrowserAction(action: string, callback: () => unknown): void
  /** Runs one of Chrome's shortcuts for the shown tab, as its key from a page does. */
  runShortcut(action: BrowserShortcutAction): void
  tabs(): Browser | null
}

/** The keyboard's browser keys that Windows reports as app commands, and Chrome's command for each. */
const BROWSER_KEY_SHORTCUTS: Readonly<Record<string, BrowserShortcutAction>> = {
  'browser-refresh': 'reload',
  'browser-home': 'open-home',
  'browser-search': 'focus-address'
}

/**
 * The mouse's back and forward side buttons go back and forward in the shown tab, wherever the pointer is in the
 * window, as in Chrome, by the rules of the person's own input on that tab. Windows and Linux report them to the window
 * as app commands, which an agent's input never makes: its clicks go to the page. macOS reports none.
 *
 * Windows reports a keyboard's Refresh, Stop, Home and Search keys as app commands too, which Chrome runs as Reload,
 * Stop, Home and the address bar.
 */
export function attachHistoryMouseButtons(window: Pick<BrowserWindow, 'on'>, host: HistoryMouseButtonsHost): void {
  window.on('app-command', (_event, command) => {
    const shortcut = BROWSER_KEY_SHORTCUTS[command]
    if (shortcut) {
      host.runShortcut(shortcut)
      return
    }
    if (command === 'browser-stop') {
      host.runNativeBrowserAction('stop loading the page', () => stopShownTab(host.tabs()))
      return
    }
    if (command !== 'browser-backward' && command !== 'browser-forward') return
    const direction = command === 'browser-backward' ? 'back' : 'forward'
    // Linux reports the button as it goes down, before the press reaches the page under the pointer, which in split
    // view makes that pane the shown tab. Going once the press is through goes back in the pane the person pressed.
    setImmediate(() => host.runNativeBrowserAction(`go ${direction}`, () => {
      const browser = host.tabs()
      return browser ? historyGesture(browser, direction) : undefined
    }))
  })
}

/** Stop stops the shown tab while it loads, as Chrome's Stop button does; Home, which Hronaut loads by itself, is left alone. */
function stopShownTab(browser: Browser | null): void {
  const tab = browser?.activeTabId ? browser.tabs.get(browser.activeTabId) : undefined
  const webContents = tab?.webContents
  if (!webContents || webContents.isDestroyed() || !webContents.isLoading() || isHronautHomeUrl(webContents.getURL())) return
  webContents.stop()
}
