import type {
  BrowserStorageUsageBreakdown,
  BrowserStorageUsageReport,
  BrowserStorageUsageSource
} from './types.js'

const MAX_STORAGE_USAGE_TYPES = 32
const MAX_STORAGE_TYPE_CHARS = 80

export interface RawBrowserStorageUsage {
  usage?: unknown
  quota?: unknown
  overrideActive?: unknown
  usageBreakdown?: unknown
}

function boundedBytes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function storageType(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().slice(0, MAX_STORAGE_TYPE_CHARS)
  return normalized || null
}

export function normalizeStorageUsageBreakdown(value: unknown): BrowserStorageUsageBreakdown[] {
  if (!Array.isArray(value)) return []
  const merged = new Map<string, number>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    const type = storageType(candidate.storageType)
    if (!type) continue
    merged.set(type, (merged.get(type) ?? 0) + boundedBytes(candidate.usage))
  }
  return [...merged.entries()]
    .map(([type, usage]) => ({ storageType: type, usage }))
    .filter((item) => item.usage > 0)
    .sort((left, right) => right.usage - left.usage || left.storageType.localeCompare(right.storageType))
    .slice(0, MAX_STORAGE_USAGE_TYPES)
}

export function storageManagerUsageBreakdown(value: unknown): BrowserStorageUsageBreakdown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return normalizeStorageUsageBreakdown(Object.entries(value as Record<string, unknown>).map(([storageType, usage]) => ({
    storageType,
    usage
  })))
}

export function buildBrowserStorageUsageReport(input: {
  tabId: string
  url: string
  origin: string
  source: BrowserStorageUsageSource
  raw: RawBrowserStorageUsage
  fallbackReason?: string
}): BrowserStorageUsageReport {
  const usage = boundedBytes(input.raw.usage)
  const quota = boundedBytes(input.raw.quota)
  const breakdown = normalizeStorageUsageBreakdown(input.raw.usageBreakdown)
  return {
    tabId: input.tabId,
    url: input.url,
    origin: input.origin,
    capturedAt: new Date().toISOString(),
    source: input.source,
    usage,
    quota,
    available: Math.max(0, quota - usage),
    usagePercent: quota > 0 ? Math.min(100, (usage / quota) * 100) : 0,
    overrideActive: input.raw.overrideActive === true,
    breakdown,
    breakdownAvailable: breakdown.length > 0,
    caveats: [
      'Usage and quota are point-in-time browser estimates and may change as Chromium evicts or writes data.',
      'Quota is the origin budget Chromium currently reports, not the device free-space total.',
      'The report covers this top-level HTTP(S) origin only; third-party and partitioned storage can have separate accounting.',
      'Only aggregate byte counts and browser-defined storage categories are returned. Keys, values, filenames, and response bodies are never included.',
      'The inspector is read-only. Use browser_site_data only when the task explicitly requires clearing origin data.',
      ...(input.fallbackReason ? [`Chromium's detailed quota breakdown was unavailable, so this report uses StorageManager.estimate(): ${input.fallbackReason}`] : [])
    ]
  }
}
