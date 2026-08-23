import type { BrowserPwaOptions } from './types.js'
import type { BrowserPwaManifest } from './types.js'
import { redactDiagnosticText } from './debug-report.js'
import { redactNetworkUrl } from './network-details.js'

export const PWA_INSPECTION_LIMITS = {
  maxCaches: 100,
  maxEntries: 100,
  maxOffset: 10_000,
  maxNameChars: 512,
  maxQueryChars: 512,
  maxRegistrations: 50,
  maxHeaders: 50,
  maxHeaderNameChars: 256,
  maxHeaderValueChars: 1_024,
  maxHeaderCharsTotal: 16 * 1_024,
  maxUrlChars: 4_096,
  maxManifestSourceBytes: 1024 * 1024,
  maxManifestTextChars: 2_048,
  maxManifestErrors: 50,
  maxManifestErrorArguments: 20,
  maxManifestIcons: 50,
  maxManifestShortcuts: 20
} as const

export interface NormalizedBrowserPwaOptions {
  cacheName?: string
  query: string
  offset: number
  limit: number
  includeHeaders: boolean
}

export function normalizeBrowserPwaOptions(options: BrowserPwaOptions = {}): NormalizedBrowserPwaOptions {
  const cacheName = options.cacheName === undefined ? undefined : String(options.cacheName)
  const query = String(options.query ?? '')
  if (cacheName !== undefined && (!cacheName || cacheName.length > PWA_INSPECTION_LIMITS.maxNameChars)) {
    throw new TypeError(`cacheName must contain 1-${PWA_INSPECTION_LIMITS.maxNameChars} characters`)
  }
  if (query.length > PWA_INSPECTION_LIMITS.maxQueryChars) {
    throw new TypeError(`query must contain at most ${PWA_INSPECTION_LIMITS.maxQueryChars} characters`)
  }
  const offset = Math.min(Math.max(Math.floor(Number(options.offset ?? 0) || 0), 0), PWA_INSPECTION_LIMITS.maxOffset)
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), PWA_INSPECTION_LIMITS.maxEntries)
  return { cacheName, query, offset, limit, includeHeaders: options.includeHeaders === true }
}

export function pwaRegistrationsPageScript(): string {
  return `(async () => {
    const maxRegistrations = ${PWA_INSPECTION_LIMITS.maxRegistrations};
    const maxNameChars = ${PWA_INSPECTION_LIMITS.maxNameChars};
    if (!('serviceWorker' in navigator)) return { controlled: false, registrations: [], supported: false };
    const worker = (value) => value ? {
      scriptUrl: String(value.scriptURL || '').slice(0, 4096),
      state: String(value.state || 'parsed')
    } : undefined;
    const registrations = (await navigator.serviceWorker.getRegistrations())
      .slice(0, maxRegistrations)
      .map((registration) => ({
        scope: String(registration.scope || '').slice(0, 4096),
        updateViaCache: String(registration.updateViaCache || 'imports'),
        installing: worker(registration.installing),
        waiting: worker(registration.waiting),
        active: worker(registration.active),
        navigationPreload: registration.navigationPreload ? { supported: true } : undefined
      }));
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      controller: worker(navigator.serviceWorker.controller),
      registrations,
      supported: true,
      truncated: registrations.length >= maxRegistrations,
      maxNameChars
    };
  })()`
}

export interface CdpAppManifestResult {
  url?: string
  data?: string
  errors?: Array<{ message?: string; critical?: number; line?: number; column?: number }>
  manifest?: Record<string, unknown>
}

export interface CdpInstallabilityError {
  errorId?: string
  errorArguments?: Array<{ name?: string; value?: string }>
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown, maxChars: number = PWA_INSPECTION_LIMITS.maxManifestTextChars): string | undefined {
  if (typeof value !== 'string') return undefined
  const bounded = redactDiagnosticText(value).trim().slice(0, maxChars)
  return bounded || undefined
}

function urlValue(value: unknown, baseUrl: string): string | undefined {
  const text = stringValue(value, PWA_INSPECTION_LIMITS.maxUrlChars)
  if (!text) return undefined
  try {
    return redactNetworkUrl(new URL(text, baseUrl).href).slice(0, PWA_INSPECTION_LIMITS.maxUrlChars)
  } catch {
    return redactNetworkUrl(text).slice(0, PWA_INSPECTION_LIMITS.maxUrlChars)
  }
}

function sourceManifest(result: CdpAppManifestResult): { value?: Record<string, unknown>; truncated: boolean } {
  if (typeof result.data === 'string' && result.data.trim()) {
    if (Buffer.byteLength(result.data, 'utf8') > PWA_INSPECTION_LIMITS.maxManifestSourceBytes) return { truncated: true }
    try {
      return { value: objectValue(JSON.parse(result.data)), truncated: false }
    } catch {
      // The protocol's processed manifest remains useful when the raw source is malformed.
    }
  }
  return { value: objectValue(result.manifest), truncated: false }
}

export function sanitizePwaManifest(
  result: CdpAppManifestResult,
  installabilityErrors: CdpInstallabilityError[] = []
): BrowserPwaManifest | undefined {
  const manifestUrl = urlValue(result.url, result.url || 'http://invalid.local/')
  const source = sourceManifest(result)
  const value = source.value
  if (!manifestUrl && !value && !(result.errors?.length) && !installabilityErrors.length) return undefined
  const baseUrl = manifestUrl || 'http://invalid.local/'
  const field = (camelCase: string, snakeCase = camelCase) => value?.[camelCase] ?? value?.[snakeCase]
  const icons = Array.isArray(value?.icons) ? value.icons : []
  const shortcuts = Array.isArray(value?.shortcuts) ? value.shortcuts : []
  const parseErrors = (result.errors ?? []).slice(0, PWA_INSPECTION_LIMITS.maxManifestErrors).map((error) => ({
    message: stringValue(error.message) ?? 'Unknown manifest error',
    critical: Number(error.critical ?? 0) !== 0,
    ...(Number.isFinite(error.line) ? { line: Math.max(0, Math.floor(error.line!)) } : {}),
    ...(Number.isFinite(error.column) ? { column: Math.max(0, Math.floor(error.column!)) } : {})
  }))
  return {
    url: manifestUrl ?? '',
    id: urlValue(field('id'), baseUrl),
    name: stringValue(field('name')),
    shortName: stringValue(field('shortName', 'short_name')),
    description: stringValue(field('description')),
    startUrl: urlValue(field('startUrl', 'start_url'), baseUrl),
    scope: urlValue(field('scope'), baseUrl),
    display: stringValue(field('display'), 128),
    orientation: stringValue(field('orientation'), 128),
    themeColor: stringValue(field('themeColor', 'theme_color'), 128),
    backgroundColor: stringValue(field('backgroundColor', 'background_color'), 128),
    lang: stringValue(field('lang'), 64),
    dir: stringValue(field('dir'), 32),
    icons: icons.slice(0, PWA_INSPECTION_LIMITS.maxManifestIcons).flatMap((item) => {
      const icon = objectValue(item)
      const url = urlValue(icon?.url ?? icon?.src, baseUrl)
      if (!url) return []
      return [{
        url,
        sizes: stringValue(icon?.sizes, 256),
        type: stringValue(icon?.type, 256),
        purpose: stringValue(icon?.purpose, 256)
      }]
    }),
    shortcuts: shortcuts.slice(0, PWA_INSPECTION_LIMITS.maxManifestShortcuts).flatMap((item) => {
      const shortcut = objectValue(item)
      const name = stringValue(shortcut?.name, 512)
      const url = urlValue(shortcut?.url, baseUrl)
      return name && url ? [{ name, url }] : []
    }),
    parseErrors,
    installabilityErrors: installabilityErrors.slice(0, PWA_INSPECTION_LIMITS.maxManifestErrors).map((error) => ({
      errorId: stringValue(error.errorId, 512) ?? 'unknown-installability-error',
      arguments: (error.errorArguments ?? []).slice(0, PWA_INSPECTION_LIMITS.maxManifestErrorArguments).map((argument) => ({
        name: stringValue(argument.name, 256) ?? 'argument',
        value: stringValue(argument.value, 512) ?? ''
      }))
    })),
    truncated: source.truncated
      || icons.length > PWA_INSPECTION_LIMITS.maxManifestIcons
      || shortcuts.length > PWA_INSPECTION_LIMITS.maxManifestShortcuts
      || (result.errors?.length ?? 0) > PWA_INSPECTION_LIMITS.maxManifestErrors
      || installabilityErrors.length > PWA_INSPECTION_LIMITS.maxManifestErrors
      || undefined
  }
}
