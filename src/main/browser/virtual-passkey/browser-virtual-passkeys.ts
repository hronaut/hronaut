import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { VirtualPasskeyController } from './virtual-passkey.js'

/** Virtual passkey authenticators in the browser's tabs, through Hronaut's own DevTools session on each page. */
export function createVirtualPasskeys(browser: Browser): VirtualPasskeyController<BrowserTab> {
  return new VirtualPasskeyController<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    isDevToolsOpening: tab => browser.devToolsOpening.has(tab.webContents.id),
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation),
    changed: () => publishChange(browser, false)
  })
}
