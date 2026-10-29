import { redactDiagnosticText } from '../../../shared/debug-report.js'
import { INDEXEDDB_CAVEATS, indexedDbPageScript, normalizeBrowserIndexedDbOptions } from '../../../shared/indexeddb.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import { buildBrowserStorageUsageReport, storageManagerUsageBreakdown } from '../../../shared/storage-usage.js'
import type { BrowserIndexedDbOptions, BrowserIndexedDbReport, BrowserStorageUsageReport } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { storageInspectionGuard, type StorageInspectionHooks } from '../storage-inspection-operation.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'

const INDEXED_DB_WORLD_ID = ISOLATED_WORLDS.indexedDb
const STORAGE_USAGE_WORLD_ID = ISOLATED_WORLDS.storageUsage

/** Rejects once the tab, its workspace, its inspection permission or its observation context changes, and retains that check for publication. */
function storageInspectionContextGuard(browser: Browser, tab: BrowserTab, hooks?: StorageInspectionHooks): () => void {
  const contents = tab.webContents
  const context = browser.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? browser.inspectionPermissions.get(workspace) ?? 0 : 0
  const assertCurrent = storageInspectionGuard(() => {
    hooks?.validate()
    const currentWorkspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.webContents !== contents || contents.isDestroyed()
      || currentWorkspace !== workspace
      || (currentWorkspace ? browser.inspectionPermissions.get(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(tab))) {
      throw new Error('Storage inspection context changed')
    }
  })
  hooks?.retainPublication(assertCurrent)
  return assertCurrent
}

/** A bounded, read-only IndexedDB report for the tab's top-level origin. */
export async function inspectIndexedDb(browser: Browser, options: BrowserIndexedDbOptions = {}, hooks?: StorageInspectionHooks): Promise<BrowserIndexedDbReport> {
  const tab = getTab(browser, options.tabId)
  const pageUrl = new URL(tab.url)
  if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
    throw new Error('IndexedDB inspection is available only for HTTP and HTTPS tabs.')
  }
  const normalized = normalizeBrowserIndexedDbOptions(options)
  const requireCurrentPage = storageInspectionContextGuard(browser, tab, hooks)
  requireCurrentPage()
  hooks?.readStarted()
  const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
    INDEXED_DB_WORLD_ID,
    [{ code: indexedDbPageScript(normalized) }],
    false
  ) as Omit<BrowserIndexedDbReport, 'tabId' | 'url' | 'origin' | 'caveats'>
  requireCurrentPage()
  return {
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    origin: pageUrl.origin,
    ...result,
    caveats: [
      INDEXEDDB_CAVEATS.origin,
      INDEXEDDB_CAVEATS.snapshot,
      INDEXEDDB_CAVEATS.names,
      INDEXEDDB_CAVEATS.longNames,
      normalized.includeValues ? INDEXEDDB_CAVEATS.valuesIncluded : INDEXEDDB_CAVEATS.valuesOmitted,
      INDEXEDDB_CAVEATS.readOnly
    ]
  }
}

/** The origin's storage usage and quota from Chromium, or from the page's StorageManager estimate when the quota command fails. */
export async function inspectStorageUsage(browser: Browser, tabId?: string, hooks?: StorageInspectionHooks): Promise<BrowserStorageUsageReport> {
  const tab = getTab(browser, tabId)
  const pageUrl = new URL(tab.url)
  if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
    throw new Error('Storage usage inspection is available only for HTTP and HTTPS tabs.')
  }

  const requireCurrentPage = storageInspectionContextGuard(browser, tab, hooks)
  requireCurrentPage()
  try {
    const raw = await withDebugger(browser, tab.webContents, () => {
      requireCurrentPage()
      hooks?.readStarted()
      return tab.webContents.debugger.sendCommand('Storage.getUsageAndQuota', { origin: pageUrl.origin }) as Promise<{
        usage?: number
        quota?: number
        overrideActive?: boolean
        usageBreakdown?: Array<{ storageType?: string; usage?: number }>
      }>
    }, requireCurrentPage)
    requireCurrentPage()
    return buildBrowserStorageUsageReport({
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      origin: pageUrl.origin,
      source: 'chromium-quota',
      raw
    })
  } catch (error) {
    requireCurrentPage()
    hooks?.readStarted()
    const estimate = await tab.webContents.executeJavaScriptInIsolatedWorld(
      STORAGE_USAGE_WORLD_ID,
      [{ code: `(() => navigator.storage?.estimate?.().then((value) => ({
          usage: value.usage,
          quota: value.quota,
          usageDetails: value.usageDetails
        })).catch(() => null) ?? Promise.resolve(null))()` }],
      false
    ).catch(() => null) as { usage?: number; quota?: number; usageDetails?: Record<string, number> } | null
    requireCurrentPage()
    if (!estimate) throw error
    const reason = redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 500)
    return buildBrowserStorageUsageReport({
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      origin: pageUrl.origin,
      source: 'storage-manager',
      raw: {
        usage: estimate.usage,
        quota: estimate.quota,
        usageBreakdown: storageManagerUsageBreakdown(estimate.usageDetails)
      },
      fallbackReason: reason
    })
  }
}
