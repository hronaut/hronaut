import { cleanup, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PwaLifecyclePanel from '../../src/renderer/src/components/PwaLifecyclePanel.vue'
import SiteStorageChangesView from '../../src/renderer/src/components/SiteStorageChangesView.vue'
import SiteStoragePwaView from '../../src/renderer/src/components/SiteStoragePwaView.vue'
import SiteStorageUsageView from '../../src/renderer/src/components/SiteStorageUsageView.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { pwaLifecycleMessages } from '../../src/shared/locales/pwa-lifecycle.js'
import { reportCaveatMessages } from '../../src/shared/locales/report-caveats.js'
import { PWA_CACHE_NOT_FOUND_PREFIX, PWA_INSPECTION_CAVEATS, PWA_INSTALLABILITY_UNAVAILABLE_PREFIX } from '../../src/shared/pwa.js'
import { PWA_LIFECYCLE_CAVEATS, type PwaLifecycleReport } from '../../src/shared/pwa-lifecycle.js'
import { STORAGE_CHANGES_CAVEATS } from '../../src/shared/storage-changes.js'
import { STORAGE_USAGE_CAVEATS, STORAGE_USAGE_FALLBACK_CAVEAT_PREFIX } from '../../src/shared/storage-usage.js'
import type { BrowserPwaReport, BrowserStorageChangesReport, BrowserStorageUsageReport, BrowserTabState, SupportedLocale } from '../../src/shared/types.js'

// Site storage's usage, changes and offline views and the service-worker history listed their reports' English caveats
// in every language, two of them told the person reading the panel to "Use browser_site_data" or "Request includeValues",
// and a missing cache was named in English.

const original = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => {
  cleanup()
  if (original) Object.defineProperty(window, 'hronaut', original)
  else Reflect.deleteProperty(window, 'hronaut')
})

function listed(container: Element, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((item) => item.textContent?.trim() ?? '')
}

function usageView(locale: SupportedLocale, caveats: string[]): string[] {
  const report: BrowserStorageUsageReport = {
    tabId: 'tab-1', url: 'https://example.test/', origin: 'https://example.test', capturedAt: '2026-10-21T02:00:00.000Z',
    source: 'storage-manager', usage: 1024, quota: 4096, available: 3072, usagePercent: 25, overrideActive: false,
    breakdown: [], breakdownAvailable: false, caveats
  }
  const view = render(SiteStorageUsageView, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { state: 'ready', report, error: '', copied: false, locale }
  })
  return listed(view.container, '.storage-usage-caveats li')
}

function changesView(locale: SupportedLocale, caveats: string[]): string[] {
  const report: BrowserStorageChangesReport = {
    tabId: 'tab-1', url: 'https://example.test/', origin: 'https://example.test', action: 'compare', status: 'compared',
    baselineAt: '2026-10-21T02:00:00.000Z', comparedAt: '2026-10-21T02:01:00.000Z',
    changeCount: 0, counts: { added: 0, updated: 0, removed: 0 }, changes: [], valuesIncluded: false, caveats
  }
  const view = render(SiteStorageChangesView, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { state: 'ready', report, error: '', copied: false, locale }
  })
  return listed(view.container, '.storage-changes-caveats li')
}

function pwaReport(caveats: string[], cache: Partial<BrowserPwaReport> = {}): BrowserPwaReport {
  return {
    tabId: 'tab-1', url: 'https://example.test/', origin: 'https://example.test', capturedAt: '2026-10-21T02:00:00.000Z',
    supported: true, controlled: false, registrations: [], manifestInspectionAvailable: true,
    installabilityInspectionAvailable: false, caches: [], cacheInspectionAvailable: true, caveats, ...cache
  }
}

function pwaView(locale: SupportedLocale, report: BrowserPwaReport) {
  return render(SiteStoragePwaView, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { state: 'ready', report, error: '', copied: false, offset: 0, locale, cache: '', query: '' }
  })
}

async function lifecycleView(locale: SupportedLocale, caveats: string[]): Promise<string[]> {
  const report: PwaLifecycleReport = {
    tabId: 'tab-1', captureId: 'capture-1', origin: 'https://example.test', active: false, reason: 'stopped', startedAt: 1, stoppedAt: 2,
    events: [], truncated: false, missingHistory: true, interrupted: false, lastDrainedAt: 1, coverage: 'observed-only', caveats
  }
  Object.defineProperty(window, 'hronaut', { configurable: true, value: { pwaLifecycle: vi.fn(async () => report) } })
  const view = render(PwaLifecyclePanel, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { tab: { id: 'tab-1', pwaLifecycleActive: false } as BrowserTabState }
  })
  await screen.findByText(pwaLifecycleMessages[locale].coverage)
  return listed(view.container, 'details li')
}

const german = reportCaveatMessages['de-DE']

describe('storage and service-worker caveats in the interface language', () => {
  it('lists the storage usage caveats in German, keeping Chromium’s fallback reason as it wrote it', () => {
    const recorded = [...Object.values(STORAGE_USAGE_CAVEATS), `${STORAGE_USAGE_FALLBACK_CAVEAT_PREFIX}Quota database closed.`, 'A future caveat.']
    expect(usageView('de-DE', recorded)).toEqual([
      ...Object.keys(STORAGE_USAGE_CAVEATS).map((key) => german.storageUsage[key as keyof typeof STORAGE_USAGE_CAVEATS]),
      german.storageUsage.fallback.replace('{reason}', 'Quota database closed.'),
      'A future caveat.'
    ])
  })

  it('words the storage usage caveats for the person reading the panel in English', () => {
    const shown = usageView('en-US', [...Object.values(STORAGE_USAGE_CAVEATS), 'constructor'])
    expect(shown).toContain('This inspector only reads storage usage and never changes or clears data.')
    expect(shown.join(' ')).not.toMatch(/browser_site_data|the task/)
    expect(shown.at(-1)).toBe('constructor')
  })

  it('lists the storage comparison caveats in German and words them for the person in English', () => {
    const recorded = [STORAGE_CHANGES_CAVEATS.baseline, STORAGE_CHANGES_CAVEATS.scope, STORAGE_CHANGES_CAVEATS.valuesOmitted, STORAGE_CHANGES_CAVEATS.snapshot, 'A future caveat.']
    expect(changesView('de-DE', recorded)).toEqual([
      german.storageChanges.baseline, german.storageChanges.scope, german.storageChanges.valuesOmitted, german.storageChanges.snapshot, 'A future caveat.'
    ])
    cleanup()
    const english = changesView('en-US', recorded)
    expect(english[2]).toBe('Values are left out.')
    expect(english.join(' ')).not.toMatch(/includeValues|Request /)
  })

  it('lists the offline app caveats in German, keeping the redacted installability reason', () => {
    const recorded = [...Object.values(PWA_INSPECTION_CAVEATS), `${PWA_INSTALLABILITY_UNAVAILABLE_PREFIX}Target closed.`, 'A future caveat.', 'toString']
    const view = pwaView('de-DE', pwaReport(recorded))
    expect(listed(view.container, '.pwa-caveats li')).toEqual([
      ...Object.keys(PWA_INSPECTION_CAVEATS).map((key) => german.pwa[key as keyof typeof PWA_INSPECTION_CAVEATS]),
      german.pwa.installabilityUnavailable.replace('{reason}', 'Target closed.'),
      'A future caveat.',
      'toString'
    ])
    cleanup()
    const english = listed(pwaView('en-US', pwaReport(recorded)).container, '.pwa-caveats li')
    expect(english).toContain('This inspector never unregisters workers or clears caches.')
    expect(english.join(' ')).not.toMatch(/browser_site_data|includeHeaders|the task/)
  })

  it('names a missing cache in the interface language and keeps other cache errors as reported', () => {
    const missing = pwaReport([], { cacheInspectionError: `${PWA_CACHE_NOT_FOUND_PREFIX}app-shell-v2` })
    expect(pwaView('de-DE', missing).getByRole('status')).toHaveTextContent(/^Cache nicht gefunden: app-shell-v2$/)
    cleanup()
    expect(pwaView('en-US', missing).getByRole('status')).toHaveTextContent(/^Cache not found: app-shell-v2$/)
    cleanup()
    const other = pwaReport([], { cacheInspectionError: 'Cache Storage request failed.' })
    expect(pwaView('de-DE', other).getByRole('status')).toHaveTextContent(/^Cache Storage request failed\.$/)
  })

  it('lists the service-worker history caveats in German and keeps an unknown one as recorded', async () => {
    const recorded = [...Object.values(PWA_LIFECYCLE_CAVEATS), 'A future caveat.']
    expect(await lifecycleView('de-DE', recorded)).toEqual([
      ...Object.keys(PWA_LIFECYCLE_CAVEATS).map((key) => pwaLifecycleMessages['de-DE'].caveats[key as keyof typeof PWA_LIFECYCLE_CAVEATS]),
      'A future caveat.'
    ])
  })

  it('has a message for every caveat in every locale', () => {
    for (const locale of Object.keys(reportCaveatMessages) as SupportedLocale[]) {
      expect(Object.keys(reportCaveatMessages[locale].storageUsage)).toEqual([...Object.keys(STORAGE_USAGE_CAVEATS), 'fallback'])
      expect(Object.keys(reportCaveatMessages[locale].storageChanges)).toEqual(Object.keys(STORAGE_CHANGES_CAVEATS))
      expect(Object.keys(reportCaveatMessages[locale].pwa)).toEqual([...Object.keys(PWA_INSPECTION_CAVEATS), 'installabilityUnavailable'])
      expect(Object.keys(pwaLifecycleMessages[locale].caveats)).toEqual(Object.keys(PWA_LIFECYCLE_CAVEATS))
    }
  })

  it('keeps the English caveats MCP results return, word for word and in order', () => {
    // Agents read these through browser_storage_usage, browser_storage_changes, browser_pwa and browser_pwa_lifecycle.
    expect(Object.values(STORAGE_USAGE_CAVEATS)).toEqual([
      'Usage and quota are point-in-time browser estimates and may change as Chromium evicts or writes data.',
      'Quota is the origin budget Chromium currently reports, not the device free-space total.',
      'The report covers this top-level HTTP(S) origin only; third-party and partitioned storage can have separate accounting.',
      'Only aggregate byte counts and browser-defined storage categories are returned. Keys, values, filenames, and response bodies are never included.',
      'The inspector is read-only. Use browser_site_data only when the task explicitly requires clearing origin data.'
    ])
    expect(STORAGE_USAGE_FALLBACK_CAVEAT_PREFIX).toBe("Chromium's detailed quota breakdown was unavailable, so this report uses StorageManager.estimate(): ")
    expect(Object.values(STORAGE_CHANGES_CAVEATS)).toEqual([
      'The baseline stays only in memory and is discarded when cleared, when the tab changes origin or closes, or when Hronaut exits.',
      'Local storage and cookies are shared by origin inside this workspace and isolated from other workspaces; session storage belongs only to this tab.',
      'Bounded non-HttpOnly values are included. HttpOnly cookie values always remain protected.',
      'Values are omitted. Request includeValues only when the changed values are necessary and safe to return.',
      'The snapshot covers the first 200 sorted entries per storage kind. Storage may also change in the background between the baseline and comparison.'
    ])
    expect(Object.values(PWA_INSPECTION_CAVEATS)).toEqual([
      'The report covers this top-level origin only; third-party frame workers and caches are not included.',
      'Registrations and cached entries are point-in-time snapshots. Refresh after the website changes its offline state.',
      'Manifest source is parsed into bounded diagnostic fields; the raw manifest source is never returned.',
      'Installability error identifiers come from Chromium and may change between Chromium versions.',
      'The inspector is read-only and never returns cached response bodies.',
      'Bounded request and response headers are included; recognized secret-bearing headers are redacted.',
      'Header values are omitted. Request includeHeaders only when they are necessary and safe to return.',
      'Opaque response sizes may include browser quota padding and are not measured by this report.',
      'Use browser_site_data only when the task explicitly requires unregistering workers or clearing origin caches.'
    ])
    expect(PWA_INSTALLABILITY_UNAVAILABLE_PREFIX).toBe('Installability diagnostics were unavailable: ')
    expect(PWA_CACHE_NOT_FOUND_PREFIX).toBe('Cache Storage cache not found: ')
    expect(Object.values(PWA_LIFECYCLE_CAVEATS)).toEqual([
      'Observed callback times are not historical lifecycle timestamps. Capture always has incomplete history.',
      'Registration discovery polls once per second; early transitions and short-lived registrations may be missed.',
      'Registrations belong to this top-level origin and workspace, not exclusively to this tab.',
      'Worker identities are local to this capture and distinguish versions at the same script URL.',
      'Navigation, reload, closure, debugger loss or authority loss interrupts capture. Stopping or interruption can omit undrained events.',
      'At most 100 events, 20 registrations, 100 workers and two minutes; five captures retained in memory, oldest stopped first.',
      'URLs exceeding 2048 characters are omitted rather than partially exposing a credential-bearing URL.',
      'Only metadata is observed. No worker updates, messages, activation, cache clearing, permission changes or worker execution requests.',
      'Sleeping or frozen tabs are not awakened. Sleep or freeze interrupts capture instead of keeping the page active.',
      'Reads return the last drained snapshot. No complete-history or universal worker-lifetime guarantee is made.'
    ])
  })
})
