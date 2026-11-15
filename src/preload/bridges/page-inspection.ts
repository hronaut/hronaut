import { PAGE_INSPECTION_IPC } from '../../shared/ipc/page-inspection.js'
import type { HronautConsoleNetworkApi, HronautPageCaptureApi, HronautPageStorageApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's view of a tab's site storage, IndexedDB and offline app. */
export const pageStorageApi: HronautPageStorageApi = {
  manageStorage: (options) => invoke(PAGE_INSPECTION_IPC.manageStorage, options),
  inspectStorageUsage: (tabId) => invoke(PAGE_INSPECTION_IPC.storageUsage, tabId),
  inspectIndexedDb: (options = {}) => invoke(PAGE_INSPECTION_IPC.indexedDb, options),
  pwaLifecycle: (options) => invoke(PAGE_INSPECTION_IPC.pwaLifecycle, options),
  inspectPwa: (options = {}) => invoke(PAGE_INSPECTION_IPC.pwa, options),
  storageChanges: (options = {}) => invoke(PAGE_INSPECTION_IPC.storageChanges, options)
}

/** window.hronaut's copies of a tab's page snapshot, elements and pictures, and its element inspection. */
export const pageCaptureApi: HronautPageCaptureApi = {
  copySnapshot: (tabId) => invoke(PAGE_INSPECTION_IPC.copySnapshot, tabId),
  pickElement: (tabId) => invoke(PAGE_INSPECTION_IPC.pickElement, tabId),
  captureElement: (tabId) => invoke(PAGE_INSPECTION_IPC.captureElement, tabId),
  capturePage: (options = {}) => invoke(PAGE_INSPECTION_IPC.capturePage, options),
  inspectElement: (options) => invoke(PAGE_INSPECTION_IPC.inspectElement, options),
  cancelElementPicker: (tabId) => invoke(PAGE_INSPECTION_IPC.cancelElementPicker, tabId),
  captureArea: (tabId) => invoke(PAGE_INSPECTION_IPC.captureArea, tabId),
  cancelAreaCapture: (tabId) => invoke(PAGE_INSPECTION_IPC.cancelAreaCapture, tabId)
}

/** window.hronaut's view of a tab's console messages and network requests. */
export const consoleNetworkApi: HronautConsoleNetworkApi = {
  listConsoleMessages: (tabId, clear = false) => invoke(PAGE_INSPECTION_IPC.consoleMessages, { tabId, clear }),
  listNetworkRequests: (tabId, clear = false) => invoke(PAGE_INSPECTION_IPC.networkRequests, { tabId, clear }),
  getNetworkRequestDetails: (tabId, requestId, maxChars) => invoke(PAGE_INSPECTION_IPC.networkRequestDetails, { tabId, requestId, maxChars }),
  replayNetworkRequest: (tabId, requestId, confirmSideEffects = false) =>
    invoke(PAGE_INSPECTION_IPC.replayNetworkRequest, { tabId, requestId, confirmSideEffects }),
  searchNetwork: (options) => invoke(PAGE_INSPECTION_IPC.searchNetwork, options),
  createNetworkHar: (options = {}) => invoke(PAGE_INSPECTION_IPC.networkHar, options),
  saveNetworkHar: (options = {}) => invoke(PAGE_INSPECTION_IPC.saveNetworkHar, options)
}
