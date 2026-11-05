import type { Browser } from '../browser.js'
import { buildBrowserState } from './browser-state.js'
import { StatePublication, shownTabIds } from './state-publication.js'
import { TABS_IPC } from '../../../shared/ipc/tabs.js'
import { HOME_IPC } from '../../../shared/ipc/home.js'
import { isHronautHomeUrl } from '../url.js'
import { sendTo } from '../../typed-ipc.js'

/** Sends the browser state to the window's shell, and to whoever else follows it, while the window is there to show it. */
export function createStatePublication(browser: Browser): StatePublication {
  return new StatePublication({
    canPublish: () => !browser.destroyed && !browser.window.isDestroyed() && !browser.restoringLayout,
    read: () => buildBrowserState(browser),
    shownLoadingPages: () => shownTabIds(browser.activeTabId, browser.splitView).flatMap((id) => {
      const tab = browser.tabs.get(id)
      return tab?.loading === true ? [`${id}:${tab.navigationGeneration}`] : []
    }),
    send: (state) => {
      if (!browser.window.webContents.isDestroyed()) sendTo(browser.window.webContents, TABS_IPC.stateChanged, state)
      browser.options.onStateChanged?.(state)
      // A Home showing its Tabs view reads them again; the notice carries nothing.
      for (const tab of browser.tabs.values()) {
        if (isHronautHomeUrl(tab.url) && !tab.webContents.isDestroyed()) sendTo(tab.webContents, HOME_IPC.tabsChanged)
      }
    }
  })
}
