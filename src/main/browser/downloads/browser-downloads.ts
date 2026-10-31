import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import { downloadFolderWritable } from '../../download-folder.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { closeTabLeftEmptyByDownload } from '../download-tab-close/download-tab-close.js'
import { installSessionHooks } from '../session-hooks/session-hooks.js'
import { workspaceObservationGeneration } from '../workspace-continuity/workspace-continuity.js'
import { workspaceSession } from '../workspace-data/workspace-data.js'
import { workspaceNavigationAllowed } from '../workspace-navigation/workspace-navigation.js'
import { assertWorkspaceIdle } from '../workspace-operations/workspace-operations.js'
import { BrowserDownloadsController } from './downloads-controller.js'
import { checkSaveDialogFolder, rememberSaveDialogFolder, saveDialogFolder } from './save-dialog-folder.js'
import { DOWNLOADS_IPC } from '../../../shared/ipc/downloads.js'
import { sendTo } from '../../typed-ipc.js'

/**
 * The browser's downloads: where they are saved, which tab and workspace each came from, the workspace session a
 * retry uses, and the Downloads panel they are shown in.
 */
export function createDownloadsController(browser: Browser): BrowserDownloadsController {
  // Known by the first save dialog, which may come as soon as a page opens.
  void checkSaveDialogFolder(browser)
  return new BrowserDownloadsController({
    getSettings: () => {
      const folder = browser.options.downloadDirectory
      const asked = browser.options.askWhereToSaveDownloads
      // As in Chrome, a download folder Hronaut cannot write to, such as on a drive that became read-only, asks where to
      // save the download instead of failing it, starting where the last save dialog saved or else in the home folder.
      const unwritable = !asked && !downloadFolderWritable(folder)
      const dialogFolder = asked || unwritable ? saveDialogFolder(browser) : folder
      return {
        // The folder a download is saved in, or its save dialog starts in, as in Chrome, when Hronaut asks where to save.
        downloadDirectory: unwritable && dialogFolder === folder ? homedir() : dialogFolder,
        askWhereToSaveDownloads: asked || unwritable,
        saveDialogTitle: browser.text('native.dialog.saveDownload')
      }
    },
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
    downloadReady: (webContentsId, savedFromDialog) => {
      if (savedFromDialog) rememberSaveDialogFolder(browser, savedFromDialog)
      closeTabLeftEmptyByDownload(browser, webContentsId)
    },
    isAvailable: () => !browser.destroyed && !browser.window.isDestroyed(),
    publish: (downloads) => {
      if (browser.destroyed || browser.window.isDestroyed() || browser.window.webContents.isDestroyed()) return
      sendTo(browser.window.webContents, DOWNLOADS_IPC.changed, downloads)
      browser.options.onDownloadsChanged?.(downloads)
    }
  })
}

/**
 * Saves a file Hronaut made, such as a QR code's image, as a download from the tab's workspace under the given name,
 * as Chrome saves its QR code through its downloads.
 */
export function downloadGeneratedFile(browser: Browser, tabId: string, dataUrl: string, filename: string): void {
  const tab = getTab(browser, tabId)
  if (tab.webContents.isDestroyed()) throw new LocalizedError('native.errors.tabUnavailable', undefined, { message: `Tab not found: ${tabId}` })
  browser.downloadController.expectGeneratedFile(tab.webContents.id, dataUrl, filename)
  tab.webContents.downloadURL(dataUrl)
}

/** Where downloads go, and whether Hronaut asks where to save each one. */
export function setDownloadPreferences(browser: Browser, downloadDirectory: string, askWhereToSaveDownloads: boolean): void {
  if (!isAbsolute(downloadDirectory)) throw new TypeError('Download directory must be absolute')
  browser.options.downloadDirectory = downloadDirectory
  browser.options.askWhereToSaveDownloads = askWhereToSaveDownloads
}
