import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { Browser } from './browser/browser.js'
import { sanitizeConsoleMessages } from '../shared/debug-report.js'
import type {
  BrowserElementInspectionOptions,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkSearchOptions,
  BrowserPageCaptureOptions
} from '../shared/types.js'
import { captureElementScreenshot, pickElement, cancelElementPicker } from './browser/element-picker/element-picker.js'
import { captureScreenshotArea, cancelScreenshotArea } from './browser/screenshot-area/screenshot-area.js'
import { consoleMessages } from './browser/console-messages/console-messages.js'
import { networkHar, networkRequestDetails, networkRequests, networkSearch, replayNetworkRequest, saveNetworkHar } from './browser/network-inspection/network-inspection.js'
import { inspectPwa } from './browser/pwa-inspection/pwa-inspection.js'
import { manageStorage } from './browser/site-storage/manage-storage.js'
import { storageChanges } from './browser/site-storage/storage-changes.js'
import { inspectIndexedDb, inspectStorageUsage } from './browser/site-storage/storage-inspection.js'
import { elementInspection } from './browser/element-inspection/element-inspection.js'
import { snapshotDetails } from './browser/page-snapshots/page-snapshots.js'
import { screenshot } from './browser/screenshots/screenshots.js'
import { pwaLifecycle } from './browser/pwa-inspection/browser-pwa-lifecycle.js'
import { PAGE_INSPECTION_IPC } from '../shared/ipc/page-inspection.js'

interface PageInspectionIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Browser | null
  /** Writes text to the system clipboard after earlier clipboard writes, verifying it arrived. */
  copyTextToClipboard(text: string): Promise<void>
  /** Writes a PNG image to the system clipboard after earlier clipboard writes; resolves to its size. */
  copyPngToClipboard(data: Buffer): Promise<{ width: number; height: number }>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerPageInspectionIpc(host: PageInspectionIpcHost): void {
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.manageStorage, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'object' || value === null) throw new TypeError('Invalid site storage request')
    const { tabId, kind, action, key, value: storageValue, includeValues, cookieDomain, cookiePath } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (kind !== 'local-storage' && kind !== 'session-storage' && kind !== 'cookies')
      || (action !== undefined && action !== 'list' && action !== 'get' && action !== 'set' && action !== 'delete' && action !== 'clear')
      || (key !== undefined && typeof key !== 'string')
      || (storageValue !== undefined && typeof storageValue !== 'string')
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
      || (cookieDomain !== undefined && typeof cookieDomain !== 'string')
      || (cookiePath !== undefined && typeof cookiePath !== 'string')
    ) throw new TypeError('Invalid site storage request')
    return manageStorage(host.tabs()!, { tabId, kind, action, key, value: storageValue, includeValues, cookieDomain, cookiePath })
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.storageUsage, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid storage usage request')
    return inspectStorageUsage(host.tabs()!, tabId as string | undefined)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.storageChanges, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid storage changes request')
    const { tabId, action, includeValues } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && action !== 'get' && action !== 'baseline' && action !== 'compare' && action !== 'clear')
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
    ) throw new TypeError('Invalid storage changes request')
    return storageChanges(host.tabs()!, action, tabId as string | undefined, includeValues === true)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.indexedDb, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid IndexedDB request')
    const { tabId, database, objectStore, offset, limit, includeValues } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (database !== undefined && typeof database !== 'string')
      || (objectStore !== undefined && typeof objectStore !== 'string')
      || (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset)))
      || (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit)))
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
    ) throw new TypeError('Invalid IndexedDB request')
    return inspectIndexedDb(host.tabs()!, {
      tabId: tabId as string | undefined,
      database: database as string | undefined,
      objectStore: objectStore as string | undefined,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
      includeValues: includeValues === true
    })
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.pwaLifecycle, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid lifecycle request')
    const { tabId, captureId, action } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (captureId !== undefined && typeof captureId !== 'string')
      || !['start', 'get', 'stop', 'clear'].includes(String(action))) throw new TypeError('Invalid lifecycle request')
    return pwaLifecycle(host.tabs()!, { tabId: tabId as string | undefined, captureId: captureId as string | undefined,
      action: action as 'start' | 'get' | 'stop' | 'clear' })
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.pwa, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid offline app request')
    const { tabId, cacheName, query, offset, limit, includeHeaders } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (cacheName !== undefined && typeof cacheName !== 'string')
      || (query !== undefined && typeof query !== 'string')
      || (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset)))
      || (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit)))
      || (includeHeaders !== undefined && typeof includeHeaders !== 'boolean')
    ) throw new TypeError('Invalid offline app request')
    return inspectPwa(host.tabs()!, {
      tabId: tabId as string | undefined,
      cacheName: cacheName as string | undefined,
      query: query as string | undefined,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
      includeHeaders: includeHeaders === true
    })
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.copySnapshot, async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid snapshot tab ID')
    const maxChars = 30_000
    const snapshot = await snapshotDetails(host.tabs()!, tabId, maxChars)
    await host.copyTextToClipboard(snapshot.text)
    return { copied: true, characters: snapshot.returnedChars, truncated: snapshot.truncated }
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.pickElement, async (event, tabId) => {
    host.assertTrustedSender(event)
    const result = await pickElement(host.tabs()!, tabId)
    if (result.canceled || !result.content) return { canceled: true, copied: false }
    await host.copyTextToClipboard(result.content)
    return { canceled: false, copied: true }
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.captureElement, async (event, tabId) => {
    host.assertTrustedSender(event)
    const screenshot = await captureElementScreenshot(host.tabs()!, tabId)
    if (screenshot.canceled || !screenshot.data) return { canceled: true, copied: false }
    const size = await host.copyPngToClipboard(screenshot.data)
    return { canceled: false, copied: true, width: size.width, height: size.height }
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.capturePage, async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid page capture options')
    const { tabId, fullPage } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (fullPage !== undefined && typeof fullPage !== 'boolean')
    ) {
      throw new TypeError('Invalid page capture options')
    }
    const options: BrowserPageCaptureOptions = {
      ...(tabId !== undefined ? { tabId } : {}),
      ...(fullPage !== undefined ? { fullPage } : {})
    }
    const captured = await screenshot(host.tabs()!, options)
    const size = await host.copyPngToClipboard(captured.data)
    return { copied: true, width: size.width, height: size.height }
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.inspectElement, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid element inspection options')
    const { tabId, ref, selector } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (ref !== undefined && typeof ref !== 'string')
      || (selector !== undefined && typeof selector !== 'string')
    ) {
      throw new TypeError('Invalid element inspection options')
    }
    return elementInspection(host.tabs()!, value as BrowserElementInspectionOptions)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.cancelElementPicker, (event, tabId) => {
    host.assertTrustedSender(event)
    return cancelElementPicker(host.tabs()!, tabId)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.consoleMessages, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid console options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid console options')
    }
    return sanitizeConsoleMessages(consoleMessages(host.tabs()!, tabId as string | undefined, clear === true))
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.networkRequests, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid network options')
    }
    return networkRequests(host.tabs()!, tabId as string | undefined, clear === true)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.networkRequestDetails, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network request options')
    const { tabId, requestId, maxChars } = value as Record<string, unknown>
    if (
      typeof tabId !== 'string'
      || typeof requestId !== 'string'
      || !requestId
      || (maxChars !== undefined && typeof maxChars !== 'number')
    ) {
      throw new TypeError('Invalid network request options')
    }
    return networkRequestDetails(host.tabs()!, tabId, requestId, maxChars as number | undefined)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.replayNetworkRequest, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network replay options')
    const { tabId, requestId, confirmSideEffects } = value as Record<string, unknown>
    if (
      typeof tabId !== 'string'
      || typeof requestId !== 'string'
      || !requestId
      || (confirmSideEffects !== undefined && typeof confirmSideEffects !== 'boolean')
    ) {
      throw new TypeError('Invalid network replay options')
    }
    return replayNetworkRequest(host.tabs()!, tabId, requestId, confirmSideEffects === true)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.searchNetwork, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network search options')
    const { tabId, query, caseSensitive, maxResults, maxRequests, maxBodyChars } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || typeof query !== 'string'
      || (caseSensitive !== undefined && typeof caseSensitive !== 'boolean')
      || (maxResults !== undefined && typeof maxResults !== 'number')
      || (maxRequests !== undefined && typeof maxRequests !== 'number')
      || (maxBodyChars !== undefined && typeof maxBodyChars !== 'number')
    ) {
      throw new TypeError('Invalid network search options')
    }
    return networkSearch(host.tabs()!, value as BrowserNetworkSearchOptions)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.networkHar, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network HAR options')
    const { tabId, query, resourceType, errorsOnly, includeBodies, maxRequests, maxBodyChars } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (query !== undefined && typeof query !== 'string')
      || (resourceType !== undefined && typeof resourceType !== 'string')
      || (errorsOnly !== undefined && typeof errorsOnly !== 'boolean')
      || (includeBodies !== undefined && typeof includeBodies !== 'boolean')
      || (maxRequests !== undefined && typeof maxRequests !== 'number')
      || (maxBodyChars !== undefined && typeof maxBodyChars !== 'number')
    ) {
      throw new TypeError('Invalid network HAR options')
    }
    return networkHar(host.tabs()!, value as BrowserNetworkHarOptions)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.saveNetworkHar, (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network HAR save options')
    const { tabId, query, resourceType, errorsOnly, includeBodies, maxRequests, maxBodyChars, filename } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (query !== undefined && typeof query !== 'string')
      || (resourceType !== undefined && typeof resourceType !== 'string')
      || (errorsOnly !== undefined && typeof errorsOnly !== 'boolean')
      || (includeBodies !== undefined && typeof includeBodies !== 'boolean')
      || (maxRequests !== undefined && typeof maxRequests !== 'number')
      || (maxBodyChars !== undefined && typeof maxBodyChars !== 'number')
      || (filename !== undefined && typeof filename !== 'string')
    ) {
      throw new TypeError('Invalid network HAR save options')
    }
    return saveNetworkHar(host.tabs()!, value as BrowserNetworkHarSaveOptions)
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.captureArea, async (event, tabId) => {
    host.assertTrustedSender(event)
    const screenshot = await captureScreenshotArea(host.tabs()!, tabId)
    if (screenshot.canceled || !screenshot.data) return { canceled: true, copied: false }
    const size = await host.copyPngToClipboard(screenshot.data)
    return { canceled: false, copied: true, width: size.width, height: size.height }
  })
  host.handleBrowserIpc(PAGE_INSPECTION_IPC.cancelAreaCapture, (event, tabId) => {
    host.assertTrustedSender(event)
    return cancelScreenshotArea(host.tabs()!, tabId)
  })
}
