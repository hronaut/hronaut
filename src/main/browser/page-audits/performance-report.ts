import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
import type { Browser } from '../browser.js'
import { performanceEnvironment, tabPerformanceEnvironmentFingerprint } from '../emulation/performance-environment.js'
import { findTab, getTab } from '../browser-core.js'

const PERFORMANCE_AUDIT_WORLD_ID = ISOLATED_WORLDS.performanceAudit
const require = createRequire(import.meta.url)
const webVitalsPath = require.resolve('web-vitals/attribution')
/** The web-vitals page script the measurement runs, read once when this module loads. */
const webVitalsSource = readFileSync(webVitalsPath, 'utf8')
/** The web-vitals version, which each report names. */
const webVitalsVersion = (JSON.parse(
  readFileSync(join(dirname(webVitalsPath), '..', 'package.json'), 'utf8')
) as { version: string }).version

/**
 * Measures the tab's page with web-vitals in its isolated world, and sets,
 * clears or compares with the tab's performance baseline. It throws when the
 * page navigated, the baseline changed or the emulated environment changed
 * while the measurement was pending.
 */
export async function performanceReport(browser: Browser, options: BrowserPerformanceOptions = {}): Promise<BrowserPerformanceReport> {
  const tab = getTab(browser, options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before measuring performance')
  const navigationGeneration = tab.navigationGeneration
  const normalized = normalizePerformanceOptions(options)
  const environment = performanceEnvironment(browser, tab)
  const environmentFingerprint = tabPerformanceEnvironmentFingerprint(browser, tab)
  const baselineGeneration = normalized.action === 'measure'
    ? undefined
    : ++tab.performanceBaselineGeneration
  const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
    PERFORMANCE_AUDIT_WORLD_ID,
    [{ code: performanceAuditPageScript(webVitalsSource, normalized, webVitalsVersion, tab.performanceDocumentRouted === true) }],
    false
  ) as Omit<BrowserPerformanceReport, 'tabId'>
  const current = findTab(browser, tab.id)
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
  if (tabPerformanceEnvironmentFingerprint(browser, tab) !== environmentFingerprint) {
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
