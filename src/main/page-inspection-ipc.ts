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

type PageInspectionIpcTabs = Pick<Browser,
  | 'manageStorage' | 'inspectStorageUsage' | 'storageChanges' | 'inspectIndexedDb' | 'pwaLifecycle' | 'inspectPwa'
  | 'snapshotDetails' | 'pickElement' | 'captureElementScreenshot' | 'screenshot' | 'elementInspection'
  | 'cancelElementPicker' | 'consoleMessages' | 'networkRequests' | 'networkRequestDetails' | 'replayNetworkRequest'
  | 'networkSearch' | 'networkHar' | 'saveNetworkHar' | 'captureScreenshotArea' | 'cancelScreenshotArea'>

interface PageInspectionIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): PageInspectionIpcTabs | null
  /** Writes text to the system clipboard after earlier clipboard writes, verifying it arrived. */
  copyTextToClipboard(text: string): Promise<void>
  /** Writes a PNG image to the system clipboard after earlier clipboard writes; resolves to its size. */
  copyPngToClipboard(data: Buffer): Promise<{ width: number; height: number }>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerPageInspectionIpc(host: PageInspectionIpcHost): void {
  host.handleBrowserIpc('browser:manage-storage', (event, value: unknown) => {
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
    return host.tabs()!.manageStorage({ tabId, kind, action, key, value: storageValue, includeValues, cookieDomain, cookiePath })
  })
  host.handleBrowserIpc('browser:storage-usage', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid storage usage request')
    return host.tabs()!.inspectStorageUsage(tabId as string | undefined)
  })
  host.handleBrowserIpc('browser:storage-changes', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid storage changes request')
    const { tabId, action, includeValues } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && action !== 'get' && action !== 'baseline' && action !== 'compare' && action !== 'clear')
      || (includeValues !== undefined && typeof includeValues !== 'boolean')
    ) throw new TypeError('Invalid storage changes request')
    return host.tabs()!.storageChanges(action, tabId as string | undefined, includeValues === true)
  })
  host.handleBrowserIpc('browser:indexeddb', (event, value: unknown) => {
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
    return host.tabs()!.inspectIndexedDb({
      tabId: tabId as string | undefined,
      database: database as string | undefined,
      objectStore: objectStore as string | undefined,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
      includeValues: includeValues === true
    })
  })
  host.handleBrowserIpc('browser:pwa-lifecycle', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid lifecycle request')
    const { tabId, captureId, action } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (captureId !== undefined && typeof captureId !== 'string')
      || !['start', 'get', 'stop', 'clear'].includes(String(action))) throw new TypeError('Invalid lifecycle request')
    return host.tabs()!.pwaLifecycle({ tabId: tabId as string | undefined, captureId: captureId as string | undefined,
      action: action as 'start' | 'get' | 'stop' | 'clear' })
  })
  host.handleBrowserIpc('browser:pwa', (event, value: unknown) => {
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
    return host.tabs()!.inspectPwa({
      tabId: tabId as string | undefined,
      cacheName: cacheName as string | undefined,
      query: query as string | undefined,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
      includeHeaders: includeHeaders === true
    })
  })
  host.handleBrowserIpc('browser:copy-snapshot', async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid snapshot tab ID')
    const maxChars = 30_000
    const snapshot = await host.tabs()!.snapshotDetails(tabId, maxChars)
    await host.copyTextToClipboard(snapshot.text)
    return { copied: true, characters: snapshot.returnedChars, truncated: snapshot.truncated }
  })
  host.handleBrowserIpc('browser:pick-element', async (event, tabId) => {
    host.assertTrustedSender(event)
    const result = await host.tabs()!.pickElement(tabId)
    if (result.canceled || !result.content) return { canceled: true, copied: false }
    await host.copyTextToClipboard(result.content)
    return { canceled: false, copied: true }
  })
  host.handleBrowserIpc('browser:capture-element', async (event, tabId) => {
    host.assertTrustedSender(event)
    const screenshot = await host.tabs()!.captureElementScreenshot(tabId)
    if (screenshot.canceled || !screenshot.data) return { canceled: true, copied: false }
    const size = await host.copyPngToClipboard(screenshot.data)
    return { canceled: false, copied: true, width: size.width, height: size.height }
  })
  host.handleBrowserIpc('browser:capture-page', async (event, value: unknown) => {
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
    const screenshot = await host.tabs()!.screenshot(options)
    const size = await host.copyPngToClipboard(screenshot.data)
    return { copied: true, width: size.width, height: size.height }
  })
  host.handleBrowserIpc('browser:element-inspection', (event, value: unknown) => {
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
    return host.tabs()!.elementInspection(value as BrowserElementInspectionOptions)
  })
  host.handleBrowserIpc('browser:cancel-element-picker', (event, tabId) => {
    host.assertTrustedSender(event)
    return host.tabs()!.cancelElementPicker(tabId)
  })
  host.handleBrowserIpc('browser:console', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid console options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid console options')
    }
    return sanitizeConsoleMessages(host.tabs()!.consoleMessages(tabId as string | undefined, clear === true))
  })
  host.handleBrowserIpc('browser:network', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid network options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid network options')
    }
    return host.tabs()!.networkRequests(tabId as string | undefined, clear === true)
  })
  host.handleBrowserIpc('browser:network-request', (event, value: unknown) => {
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
    return host.tabs()!.networkRequestDetails(tabId, requestId, maxChars as number | undefined)
  })
  host.handleBrowserIpc('browser:network-replay', (event, value: unknown) => {
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
    return host.tabs()!.replayNetworkRequest(tabId, requestId, confirmSideEffects === true)
  })
  host.handleBrowserIpc('browser:network-search', (event, value: unknown) => {
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
    return host.tabs()!.networkSearch(value as BrowserNetworkSearchOptions)
  })
  host.handleBrowserIpc('browser:network-har', (event, value: unknown) => {
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
    return host.tabs()!.networkHar(value as BrowserNetworkHarOptions)
  })
  host.handleBrowserIpc('browser:save-network-har', (event, value: unknown) => {
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
    return host.tabs()!.saveNetworkHar(value as BrowserNetworkHarSaveOptions)
  })
  host.handleBrowserIpc('browser:capture-area', async (event, tabId) => {
    host.assertTrustedSender(event)
    const screenshot = await host.tabs()!.captureScreenshotArea(tabId)
    if (screenshot.canceled || !screenshot.data) return { canceled: true, copied: false }
    const size = await host.copyPngToClipboard(screenshot.data)
    return { canceled: false, copied: true, width: size.width, height: size.height }
  })
  host.handleBrowserIpc('browser:cancel-area-capture', (event, tabId) => {
    host.assertTrustedSender(event)
    return host.tabs()!.cancelScreenshotArea(tabId)
  })
}
