import {
  buildPerformanceComparison,
  normalizePerformanceOptions,
  PERFORMANCE_COMPARISON_CAVEATS,
  performanceAuditPageScript,
  sanitizePerformanceReport
} from '../../../shared/performance-audit.js'
import type { BrowserPerformanceOptions, BrowserPerformanceReport } from '../../../shared/types.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { isHronautHomeUrl } from '../url.js'
import type { PageAuditsAccess, PageAuditsTab } from './page-audits-access.js'

const PERFORMANCE_AUDIT_WORLD_ID = ISOLATED_WORLDS.performanceAudit

/**
 * Measures the tab's page with web-vitals in its isolated world, and sets,
 * clears or compares with the tab's performance baseline. It throws when the
 * page navigated, the baseline changed or the emulated environment changed
 * while the measurement was pending.
 */
export async function performanceReport<Tab extends PageAuditsTab>(access: PageAuditsAccess<Tab>, options: BrowserPerformanceOptions = {}): Promise<BrowserPerformanceReport> {
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before measuring performance')
  const navigationGeneration = tab.navigationGeneration
  const normalized = normalizePerformanceOptions(options)
  const environment = access.performanceEnvironment(tab)
  const environmentFingerprint = access.performanceEnvironmentFingerprint(tab)
  const baselineGeneration = normalized.action === 'measure'
    ? undefined
    : ++tab.performanceBaselineGeneration
  const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
    PERFORMANCE_AUDIT_WORLD_ID,
    [{ code: performanceAuditPageScript(access.webVitalsSource(), normalized, access.webVitalsVersion(), tab.performanceDocumentRouted === true) }],
    false
  ) as Omit<BrowserPerformanceReport, 'tabId'>
  const current = access.findTab(tab.id)
  if (
    !current
    || current !== tab
    || current.webContents.isDestroyed()
    || current.navigationGeneration !== navigationGeneration
  ) {
    throw new Error('The page changed during the performance measurement. Run a fresh measurement.')
  }
  if (
    baselineGeneration !== undefined
    && tab.performanceBaselineGeneration !== baselineGeneration
  ) {
    throw new Error('Performance baseline changed while the measurement was pending. Run the requested action again.')
  }
  const report = sanitizePerformanceReport({ tabId: tab.id, ...result })
  if (access.performanceEnvironmentFingerprint(tab) !== environmentFingerprint) {
    throw new Error('The browser environment changed during the performance measurement. Run a fresh measurement.')
  }
  if (normalized.action === 'clear-baseline') {
    const baselineCleared = Boolean(tab.performanceBaseline)
    tab.performanceBaseline = undefined
    return { ...report, action: normalized.action, baselineCleared }
  }
  if (normalized.action === 'set-baseline') {
    tab.performanceBaseline = { report, environment, environmentFingerprint }
    return {
      ...report,
      action: normalized.action,
      baseline: { measuredAt: report.measuredAt, url: report.url, environment }
    }
  }
  if (!tab.performanceBaseline) return { ...report, action: normalized.action }
  const comparison = buildPerformanceComparison(
    tab.performanceBaseline.report,
    report,
    tab.performanceBaseline.environment,
    environment,
    tab.performanceBaseline.environmentFingerprint === environmentFingerprint
  )
  const caveats = [...report.caveats]
  if (!comparison.comparison.sameUrl) {
    caveats.push(PERFORMANCE_COMPARISON_CAVEATS.baselineUrl)
  }
  if (!comparison.comparison.sameEnvironment) {
    caveats.push(PERFORMANCE_COMPARISON_CAVEATS.environment)
  }
  caveats.push(PERFORMANCE_COMPARISON_CAVEATS.deltas)
  return { ...report, action: normalized.action, ...comparison, caveats }
}
