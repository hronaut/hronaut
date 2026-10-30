import type { PwaLifecycleOptions, PwaLifecycleReport } from '../pwa-lifecycle.js'
import type {
  BrowserAreaCaptureResult,
  BrowserConsoleMessage,
  BrowserElementCaptureResult,
  BrowserElementInspection,
  BrowserElementInspectionOptions,
  BrowserElementSelection,
  BrowserIndexedDbOptions,
  BrowserIndexedDbReport,
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkReplayResult,
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkSearchOptions,
  BrowserNetworkSearchResult,
  BrowserPageCaptureOptions,
  BrowserPageCaptureResult,
  BrowserPwaOptions,
  BrowserPwaReport,
  BrowserSnapshotCopyResult,
  BrowserStorageChangesOptions,
  BrowserStorageChangesReport,
  BrowserStorageOptions,
  BrowserStorageResult,
  BrowserStorageUsageReport
} from '../types.js'
import type { InvokeChannel } from './channel.js'

/** What the shell's panels read from a tab's page: its storage, elements, pictures, console and network. A tab named by no id is the active one. */
export const PAGE_INSPECTION_IPC = {
  /** Shell → main: lists, reads or changes the page's local storage, session storage or cookies. */
  manageStorage: 'browser:manage-storage' as InvokeChannel<[options: BrowserStorageOptions], BrowserStorageResult>,
  /** Shell → main: how much the page's origin stores. */
  storageUsage: 'browser:storage-usage' as InvokeChannel<[tabId?: string], BrowserStorageUsageReport>,
  /** Shell → main: records, compares or clears a baseline of the storage of the page's origin. */
  storageChanges: 'browser:storage-changes' as InvokeChannel<[options: BrowserStorageChangesOptions], BrowserStorageChangesReport>,
  /** Shell → main: the page's IndexedDB databases, or a page of an object store's records. */
  indexedDb: 'browser:indexeddb' as InvokeChannel<[options: BrowserIndexedDbOptions], BrowserIndexedDbReport>,
  /** Shell → main: starts, reads, stops or clears a capture of the page's app lifecycle events. */
  pwaLifecycle: 'browser:pwa-lifecycle' as InvokeChannel<[options: PwaLifecycleOptions], PwaLifecycleReport | null>,
  /** Shell → main: the page's offline app: its manifest, service workers and caches. */
  pwa: 'browser:pwa' as InvokeChannel<[options: BrowserPwaOptions], BrowserPwaReport>,
  /** Shell → main: copies the page's snapshot text, up to 30,000 characters. */
  copySnapshot: 'browser:copy-snapshot' as InvokeChannel<[tabId?: string], BrowserSnapshotCopyResult>,
  /** Shell → main: lets the person pick an element in the page and copies its inspection, written for an agent. */
  pickElement: 'browser:pick-element' as InvokeChannel<[tabId?: string], BrowserElementSelection>,
  /** Shell → main: lets the person pick an element in the page and copies its picture. */
  captureElement: 'browser:capture-element' as InvokeChannel<[tabId?: string], BrowserElementCaptureResult>,
  /** Shell → main: copies a picture of the page in view, or of the whole page. */
  capturePage: 'browser:capture-page' as InvokeChannel<[options: BrowserPageCaptureOptions], BrowserPageCaptureResult>,
  /** Shell → main: an element's inspection, found by its snapshot reference or selector. */
  inspectElement: 'browser:element-inspection' as InvokeChannel<[options: BrowserElementInspectionOptions], BrowserElementInspection>,
  /** Shell → main: ends picking an element; true when its overlay was removed. */
  cancelElementPicker: 'browser:cancel-element-picker' as InvokeChannel<[tabId?: string], boolean>,
  /** Shell → main: lets the person select an area of the page and copies its picture. */
  captureArea: 'browser:capture-area' as InvokeChannel<[tabId?: string], BrowserAreaCaptureResult>,
  /** Shell → main: ends selecting an area; true when its overlay was removed. */
  cancelAreaCapture: 'browser:cancel-area-capture' as InvokeChannel<[tabId?: string], boolean>,
  /** Shell → main: the page's console messages, cleared after reading when asked. */
  consoleMessages: 'browser:console' as InvokeChannel<[options: { tabId: string | undefined; clear: boolean }], BrowserConsoleMessage[]>,
  /** Shell → main: the page's network requests, cleared after reading when asked. */
  networkRequests: 'browser:network' as InvokeChannel<[options: { tabId: string | undefined; clear: boolean }], BrowserNetworkRequest[]>,
  /** Shell → main: one request's headers and bodies, the bodies up to maxChars characters. */
  networkRequestDetails: 'browser:network-request' as InvokeChannel<[options: { tabId: string; requestId: string; maxChars: number | undefined }], BrowserNetworkRequestDetails>,
  /** Shell → main: sends a captured request again from the tab; one whose method may change something only when confirmed. */
  replayNetworkRequest: 'browser:network-replay' as InvokeChannel<[options: { tabId: string; requestId: string; confirmSideEffects: boolean }], BrowserNetworkReplayResult>,
  /** Shell → main: finds text in the page's requests. */
  searchNetwork: 'browser:network-search' as InvokeChannel<[options: BrowserNetworkSearchOptions], BrowserNetworkSearchResult>,
  /** Shell → main: the page's requests as a HAR. */
  networkHar: 'browser:network-har' as InvokeChannel<[options: BrowserNetworkHarOptions], BrowserNetworkHar>,
  /** Shell → main: saves the page's requests as a HAR file in the downloads folder. */
  saveNetworkHar: 'browser:save-network-har' as InvokeChannel<[options: BrowserNetworkHarSaveOptions], BrowserNetworkHarExport>
} as const
