import { redactDiagnosticText } from '../../../shared/debug-report.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import { sanitizeCacheStorageCacheName } from '../../../shared/network-response-source.js'
import {
  normalizeBrowserPwaOptions,
  PWA_CACHE_NOT_FOUND_PREFIX,
  PWA_INSPECTION_CAVEATS,
  PWA_INSPECTION_LIMITS,
  PWA_INSTALLABILITY_UNAVAILABLE_PREFIX,
  pwaRegistrationsPageScript,
  sanitizePwaManifest,
  sanitizePwaHeaders,
  type CdpAppManifestResult,
  type CdpInstallabilityError
} from '../../../shared/pwa.js'
import type { BrowserPwaOptions, BrowserPwaReport } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'

const PWA_INSPECTOR_WORLD_ID = ISOLATED_WORLDS.pwaInspector

/** A bounded, read-only report of the tab's service workers, web app manifest, installability and Cache Storage for its top-level origin. */
export async function inspectPwa(browser: Browser, options: BrowserPwaOptions = {}): Promise<BrowserPwaReport> {
  const tab = getTab(browser, options.tabId)
  const pageUrl = new URL(tab.url)
  if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
    throw new Error('Offline app inspection is available only for HTTP and HTTPS tabs.')
  }
  const requireCurrentPage = inspectionPageGuard(browser, tab, 'offline app inspection')
  const normalized = normalizeBrowserPwaOptions(options)
  const rawRegistrations = await tab.webContents.executeJavaScriptInIsolatedWorld(
    PWA_INSPECTOR_WORLD_ID,
    [{ code: pwaRegistrationsPageScript() }],
    false
  ) as {
    supported: boolean
    controlled: boolean
    controller?: { scriptUrl: string; state: string }
    registrations: Array<{
      scope: string
      updateViaCache: string
      installing?: { scriptUrl: string; state: string }
      waiting?: { scriptUrl: string; state: string }
      active?: { scriptUrl: string; state: string }
      navigationPreload?: { supported: boolean }
    }>
    truncated?: boolean
  }
  requireCurrentPage()
  const worker = (value: { scriptUrl: string; state: string } | undefined) => value ? {
    scriptUrl: redactNetworkUrl(value.scriptUrl).slice(0, 4_096),
    state: redactDiagnosticText(value.state).slice(0, 64)
  } : undefined
  const registrations = rawRegistrations.registrations.map((registration) => ({
    scope: redactNetworkUrl(registration.scope).slice(0, 4_096),
    updateViaCache: redactDiagnosticText(registration.updateViaCache).slice(0, 32),
    installing: worker(registration.installing),
    waiting: worker(registration.waiting),
    active: worker(registration.active),
    navigationPreload: registration.navigationPreload
  }))

  const report: BrowserPwaReport = {
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    origin: pageUrl.origin,
    capturedAt: new Date().toISOString(),
    supported: rawRegistrations.supported,
    controlled: rawRegistrations.controlled,
    controller: worker(rawRegistrations.controller),
    registrations,
    registrationsTruncated: rawRegistrations.truncated || undefined,
    manifestInspectionAvailable: true,
    installabilityInspectionAvailable: true,
    caches: [],
    cacheInspectionAvailable: true,
    caveats: [
      PWA_INSPECTION_CAVEATS.origin,
      PWA_INSPECTION_CAVEATS.snapshot,
      PWA_INSPECTION_CAVEATS.manifest,
      PWA_INSPECTION_CAVEATS.installabilityIds,
      PWA_INSPECTION_CAVEATS.readOnly,
      normalized.includeHeaders ? PWA_INSPECTION_CAVEATS.headersIncluded : PWA_INSPECTION_CAVEATS.headersOmitted,
      PWA_INSPECTION_CAVEATS.opaqueSizes,
      PWA_INSPECTION_CAVEATS.clearing
    ]
  }

  try {
    await withDebugger(browser, tab.webContents, async () => {
      requireCurrentPage()
      try {
        const manifestResult = await tab.webContents.debugger.sendCommand('Page.getAppManifest') as CdpAppManifestResult
        requireCurrentPage()
        let installabilityErrors: CdpInstallabilityError[] = []
        try {
          const installabilityResult = await tab.webContents.debugger.sendCommand('Page.getInstallabilityErrors') as {
            installabilityErrors?: CdpInstallabilityError[]
          }
          installabilityErrors = installabilityResult.installabilityErrors ?? []
        } catch (error) {
          report.installabilityInspectionAvailable = false
          if (!browser.isUnavailableCdpMethod(error)) {
            report.caveats.push(`${PWA_INSTALLABILITY_UNAVAILABLE_PREFIX}${redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 500)}`)
          }
        }
        requireCurrentPage()
        report.manifest = sanitizePwaManifest(manifestResult, installabilityErrors)
      } catch (error) {
        report.manifestInspectionAvailable = false
        report.installabilityInspectionAvailable = false
        report.manifestInspectionError = redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
      }
      requireCurrentPage()
      const cacheNames = await tab.webContents.debugger.sendCommand('CacheStorage.requestCacheNames', {
        securityOrigin: pageUrl.origin
      }) as {
        caches?: Array<{ cacheId: string; cacheName: string }>
      }
      requireCurrentPage()
      const usableCaches = (cacheNames.caches ?? [])
        .filter((cache) => cache.cacheName.length <= PWA_INSPECTION_LIMITS.maxNameChars)
        .sort((left, right) => left.cacheName.localeCompare(right.cacheName))
      report.caches = usableCaches.slice(0, PWA_INSPECTION_LIMITS.maxCaches).map((cache) => ({
        name: sanitizeCacheStorageCacheName(cache.cacheName) ?? '(unnamed cache)'
      }))
      report.cachesTruncated = (cacheNames.caches?.length ?? 0) > report.caches.length || undefined
      if (!normalized.cacheName) return
      const selected = usableCaches.find((cache) => cache.cacheName === normalized.cacheName)
        ?? usableCaches.find((cache) => sanitizeCacheStorageCacheName(cache.cacheName) === normalized.cacheName)
      if (!selected) {
        report.cacheInspectionError = `${PWA_CACHE_NOT_FOUND_PREFIX}${redactDiagnosticText(normalized.cacheName)}`
        return
      }
      const entriesResult = await tab.webContents.debugger.sendCommand('CacheStorage.requestEntries', {
        cacheId: selected.cacheId,
        skipCount: normalized.offset,
        pageSize: normalized.limit,
        pathFilter: normalized.query
      }) as {
        cacheDataEntries?: Array<{
          requestURL: string
          requestMethod: string
          requestHeaders?: Array<{ name: string; value: string }>
          responseStatus: number
          responseStatusText: string
          responseType: string
          responseTime?: number
          responseHeaders?: Array<{ name: string; value: string }>
        }>
        returnCount?: number
      }
      requireCurrentPage()
      const entries = (entriesResult.cacheDataEntries ?? []).map((entry) => ({
        requestUrl: redactNetworkUrl(entry.requestURL).slice(0, PWA_INSPECTION_LIMITS.maxUrlChars),
        requestMethod: redactDiagnosticText(entry.requestMethod).slice(0, 32),
        ...(normalized.includeHeaders ? { requestHeaders: sanitizePwaHeaders(entry.requestHeaders) } : {}),
        responseStatus: entry.responseStatus,
        responseStatusText: redactDiagnosticText(entry.responseStatusText).slice(0, 256),
        responseType: redactDiagnosticText(entry.responseType).slice(0, 64),
        ...(entry.responseTime !== undefined && Number.isFinite(entry.responseTime)
          ? { responseTime: new Date(entry.responseTime * 1_000).toISOString() }
          : {}),
        ...(normalized.includeHeaders ? { responseHeaders: sanitizePwaHeaders(entry.responseHeaders) } : {})
      }))
      const totalEntries = Math.max(0, Math.floor(entriesResult.returnCount ?? entries.length))
      report.selectedCache = {
        name: sanitizeCacheStorageCacheName(selected.cacheName) ?? '(unnamed cache)',
        entries,
        offset: normalized.offset,
        limit: normalized.limit,
        totalEntries,
        hasMore: normalized.offset + entries.length < totalEntries,
        query: normalized.query,
        headersIncluded: normalized.includeHeaders
      }
    })
  } catch (error) {
    report.manifestInspectionAvailable = false
    report.installabilityInspectionAvailable = false
    report.manifestInspectionError ??= redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
    report.cacheInspectionAvailable = false
    report.cacheInspectionError = redactDiagnosticText(error instanceof Error ? error.message : String(error)).slice(0, 1_000)
  }
  requireCurrentPage()
  return report
}

/** A check that throws once the tab closed, changed page contents or navigated after this call, naming the inspection it interrupted. */
function inspectionPageGuard(browser: Browser, tab: BrowserTab, inspection: string): () => void {
  const navigationGeneration = tab.navigationGeneration
  const contents = tab.webContents
  return () => {
    if (findTab(browser, tab.id) !== tab
      || tab.webContents !== contents
      || contents.isDestroyed()
      || tab.navigationGeneration !== navigationGeneration) {
      throw new Error(`The page changed during ${inspection}. Run a fresh inspection.`)
    }
  }
}
