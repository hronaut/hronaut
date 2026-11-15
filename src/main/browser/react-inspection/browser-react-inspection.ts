import type { WebContents } from 'electron'
import { getTab } from '../browser-core.js'
import type { Browser } from '../browser.js'
import { mainWorldContextId } from '../debugger-evaluation/debugger-evaluation.js'
import { ReactInspectionController } from './react-inspection.js'

/**
 * Inspects React components in the browser's tabs through Hronaut's own DevTools session, with the permission each
 * tab's workspace granted, while neither DevTools nor a code coverage or CPU profile recording owns the page's debugger.
 */
export function createReactInspectionController(browser: Browser): ReactInspectionController {
  return new ReactInspectionController({
    resolve: tabId => {
      const tab = getTab(browser, tabId)
      const workspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
      return {
        identity: tab, page: tab.webContents, workspaceId: tab.mcpGroupId, workspaceIdentity: workspace,
        permissionGeneration: workspace ? browser.inspectionPermissions.get(workspace) ?? 0 : 0,
        navigationGeneration: tab.navigationGeneration, observationGeneration: tab.observationGeneration
      }
    },
    run: (id, operation) => browser.debuggerQueue.run(id, operation),
    requireDebuggerOwner: tabId => {
      const tab = getTab(browser, tabId)
      if (browser.devToolsOpening.has(tab.webContents.id) || tab.webContents.isDevToolsOpened()
        || tab.codeCoverage?.recording || tab.cpuProfile?.recording) throw new Error('React inspection debugger unavailable')
    },
    requireDebuggerCleanupOwner: (tabId, page) => {
      const tab = getTab(browser, tabId)
      if (tab.webContents !== page || browser.devToolsOpening.has(page.id) || page.isDevToolsOpened()) {
        throw new Error('React inspection debugger cleanup unavailable')
      }
    },
    mainWorldContextId: page => mainWorldContextId(browser, page)
  })
}

/** What React inspection starts with in a page as it loads: only a tab's own page can have it enabled. */
export function reactInspectionBootstrap(browser: Browser, contents: WebContents) {
  const tab = browser.tabs.get(browser.webContentsToTab.get(contents.id) ?? '')
  return tab?.webContents === contents ? browser.reactInspectionController.bootstrap(tab.id) : { enabled: false }
}
