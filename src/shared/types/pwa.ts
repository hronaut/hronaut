export interface BrowserServiceWorkerState {
  scriptUrl: string
  state: string
}

export interface BrowserServiceWorkerRegistration {
  scope: string
  updateViaCache: string
  installing?: BrowserServiceWorkerState
  waiting?: BrowserServiceWorkerState
  active?: BrowserServiceWorkerState
  navigationPreload?: { supported: boolean }
}

export interface BrowserPwaCache {
  name: string
}

export interface BrowserPwaCacheEntry {
  requestUrl: string
  requestMethod: string
  requestHeaders?: Record<string, string | string[]>
  responseStatus: number
  responseStatusText: string
  responseType: string
  responseTime?: string
  responseHeaders?: Record<string, string | string[]>
}

export interface BrowserPwaManifestIcon {
  url: string
  sizes?: string
  type?: string
  purpose?: string
}

export interface BrowserPwaManifestShortcut {
  name: string
  url: string
}

export interface BrowserPwaManifestError {
  message: string
  critical: boolean
  line?: number
  column?: number
}

export interface BrowserPwaInstallabilityError {
  errorId: string
  arguments: Array<{ name: string; value: string }>
}

export interface BrowserPwaManifest {
  url: string
  id?: string
  name?: string
  shortName?: string
  description?: string
  startUrl?: string
  scope?: string
  display?: string
  orientation?: string
  themeColor?: string
  backgroundColor?: string
  lang?: string
  dir?: string
  icons: BrowserPwaManifestIcon[]
  shortcuts: BrowserPwaManifestShortcut[]
  parseErrors: BrowserPwaManifestError[]
  installabilityErrors: BrowserPwaInstallabilityError[]
  truncated?: boolean
}

export interface BrowserPwaOptions {
  tabId?: string
  cacheName?: string
  query?: string
  offset?: number
  limit?: number
  includeHeaders?: boolean
}

export interface BrowserPwaReport {
  tabId: string
  url: string
  origin: string
  capturedAt: string
  supported: boolean
  controlled: boolean
  controller?: BrowserServiceWorkerState
  registrations: BrowserServiceWorkerRegistration[]
  registrationsTruncated?: boolean
  manifest?: BrowserPwaManifest
  manifestInspectionAvailable: boolean
  manifestInspectionError?: string
  installabilityInspectionAvailable: boolean
  caches: BrowserPwaCache[]
  cachesTruncated?: boolean
  cacheInspectionAvailable: boolean
  cacheInspectionError?: string
  selectedCache?: {
    name: string
    entries: BrowserPwaCacheEntry[]
    offset: number
    limit: number
    totalEntries: number
    hasMore: boolean
    query: string
    headersIncluded: boolean
  }
  caveats: string[]
}
