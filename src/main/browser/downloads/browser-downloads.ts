import type { Browser } from '../browser.js'
import { closeTabLeftEmptyByDownload } from '../download-tab-close/download-tab-close.js'
import { installSessionHooks } from '../session-hooks/session-hooks.js'
import { workspaceObservationGeneration } from '../workspace-continuity/workspace-continuity.js'
import { workspaceSession } from '../workspace-data/workspace-data.js'
import { workspaceNavigationAllowed } from '../workspace-navigation/workspace-navigation.js'
import { assertWorkspaceIdle } from '../workspace-operations/workspace-operations.js'
import { BrowserDownloadsController } from './downloads-controller.js'

/**
 * The browser's downloads: where they are saved, which tab and workspace each came from, the workspace session a
 * retry uses, and the Downloads panel they are shown in.
 */
export function createDownloadsController(browser: Browser): BrowserDownloadsController {
  return new BrowserDownloadsController({
    getSettings: () => ({
      downloadDirectory: browser.options.downloadDirectory,
      askWhereToSaveDownloads: browser.options.askWhereToSaveDownloads,
      saveDialogTitle: browser.text('native.dialog.saveDownload')
    }),
    getSource: (webContentsId, downloadUrl) => {
      const tabId = webContentsId === undefined ? undefined : browser.webContentsToTab.get(webContentsId)
      const tab = tabId ? browser.tabs.get(tabId) : undefined
      const sourceRequest = tab ? [...tab.networkRequests].reverse().find(request => request.url === downloadUrl) : undefined
      return {
        tabId,
        workspaceId: tab?.mcpGroupId,
        observationGeneration: sourceRequest?.observationGeneration ?? tab?.observationGeneration ?? 0
      }
    },
    workspaceObservationGeneration: (workspaceId) => workspaceObservationGeneration(browser, workspaceId),
    isWorkspaceOpen: (workspaceId) => browser.mcpTabGroups.has(workspaceId) && !browser.workspacesBeingDeleted.has(workspaceId),
    retrySession: (workspaceId) => {
      if (!browser.mcpTabGroups.has(workspaceId) || browser.workspacesBeingDeleted.has(workspaceId)) return undefined
      // Not while its data is being cleared, copied or moved, which a new download would race; the error says which.
      assertWorkspaceIdle(browser, workspaceId)
      const browserSession = workspaceSession(browser, workspaceId)
      // A workspace whose pages are all asleep may not have hooked its session yet, so its downloads are tracked first.
      installSessionHooks(browser, browserSession)
      return browserSession
    },
    allowsAddress: (workspaceId, url, source) => browser.mcpTabGroups.has(workspaceId) && workspaceNavigationAllowed(browser, workspaceId, url, source),
    downloadReady: (webContentsId) => closeTabLeftEmptyByDownload(browser, webContentsId),
    isAvailable: () => !browser.destroyed && !browser.window.isDestroyed(),
    publish: (downloads) => {
      if (browser.destroyed || browser.window.isDestroyed() || browser.window.webContents.isDestroyed()) return
      browser.window.webContents.send('browser:downloads-changed', downloads)
      browser.options.onDownloadsChanged?.(downloads)
    }
  })
}
