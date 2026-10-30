import { browserState, publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import type { BrowserState } from '../../../shared/types.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { VirtualPasskeyController } from './virtual-passkey.js'
import { getTab } from '../browser-core.js'
import type { VirtualPasskeyAction, VirtualPasskeyReport } from '../../../shared/virtual-passkey.js'
import type { VirtualPasskeyAuthority, VirtualPasskeyOptions } from './virtual-passkey.js'

/** Virtual passkey authenticators in the browser's tabs, through Hronaut's own DevTools session on each page. */
export function createVirtualPasskeys(browser: Browser): VirtualPasskeyController<BrowserTab> {
  return new VirtualPasskeyController<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    isDevToolsOpening: tab => browser.devToolsOpening.has(tab.webContents.id),
    withDebugger: (tab, operation) => withDebugger(browser, tab.webContents, operation),
    changed: () => publishChange(browser, false)
  })
}

/** Starts, configures, reads or stops a tab's virtual passkey authenticator. */
export function virtualPasskey(browser: Browser, tabId: string, action: VirtualPasskeyAction, options: VirtualPasskeyOptions, authority: VirtualPasskeyAuthority): Promise<VirtualPasskeyReport> {
  return browser.virtualPasskeys.manage(getTab(browser, tabId), action, options, authority)
}

/** The trusted address-bar stop. It works whatever the agent's state, including while paused. */
export function stopVirtualPasskey(browser: Browser, tabId: string): BrowserState {
  browser.virtualPasskeys.stop(getTab(browser, tabId), 'person-stopped')
  return browserState(browser)
}
