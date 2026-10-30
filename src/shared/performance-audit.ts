import { sanitizeSoftNavigations } from './performance-soft-navigation.js'
import { softNavigationsInPage } from './performance-soft-navigation.page.js'
import { performanceAuditInPage, type PerformanceAuditPageConfig } from './performance-audit.page.js'
import { pageScript } from './page-script.js'
import { sanitizeLcpAttribution } from './performance-lcp.js'
import { lcpAttributionInPage } from './performance-lcp.page.js'
import { redactDiagnosticText } from './debug-report.js'
import { redactNetworkUrl } from './network-details.js'
import type {
  BrowserPerformanceAction,
  BrowserPerformanceBaselineSummary,
  BrowserPerformanceComparison,
  BrowserPerformanceComparisonMetric,
  BrowserPerformanceEnvironment,
  BrowserPerformanceOptions,
  BrowserPerformanceReport
} from './types.js'

export const PERFORMANCE_AUDIT_LIMITS = {
  maxSettleMs: 2_000,
  maxTargetsPerMetric: 5,
  maxTargetChars: 500,
  maxLongAnimationFrames: 200,
  maxReportedLongAnimationFrames: 10,
  maxScriptContributors: 10,
  maxAttributionChars: 300,
  maxSourceUrlChars: 2_048,
  maxUserTimings: 50,
  maxUserTimingNameChars: 200,
  maxLayoutShifts: 200,
  maxReportedLayoutShifts: 20,
  maxLayoutShiftSources: 5
} as const

export interface NormalizedPerformanceOptions {
  settleMs: number
  action: BrowserPerformanceAction
}

/** What every performance report says about its own evidence. The panel names these in the interface language. */
export const PERFORMANCE_REPORT_CAVEATS = {
  lcpPhases: 'LCP phases are browser-timing observations, not causal proof. Missing or restricted evidence is explicit; restoration and soft-navigation phase attribution are unsupported.',
  localSample: 'This is one local current-visit sample, not field data or a 75th-percentile CrUX result.',
  inpUnavailable: 'INP is unavailable until the page receives a qualifying interaction; some metrics are unavailable for background or short-lived visits.',
  longAnimationFrames: 'Long animation frame attribution identifies script entry points rather than necessarily the slowest internal function.',
  crossOrigin: 'Cross-origin frames, workers, service workers, and isolated-world code may contribute work without script attribution.',
  userTimings: 'User Timing names are page-authored and sanitized; arbitrary detail objects, stack traces, and source code are omitted.',
  layoutShifts: 'Layout-shift evidence excludes entries with recent discrete input. Its score sum is diagnostic and may differ from CLS session-window scoring.'
} as const

/** What a measurement compared with a baseline adds. */
export const PERFORMANCE_COMPARISON_CAVEATS = {
  baselineUrl: 'The baseline URL differs from this measurement; compare only if the navigation change was intentional.',
  environment: 'The browser environment differs from the baseline; viewport, throttling, cache, headers, or locale changes can affect the delta.',
  deltas: 'Before-and-after deltas compare two local samples and may include normal run-to-run variation; repeat important measurements under matching conditions.'
} as const

export function normalizePerformanceOptions(
  options: BrowserPerformanceOptions = {}
): NormalizedPerformanceOptions {
  const settleMs = options.settleMs ?? 800
  if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > PERFORMANCE_AUDIT_LIMITS.maxSettleMs) {
    throw new Error(`settleMs must be an integer from 0 to ${PERFORMANCE_AUDIT_LIMITS.maxSettleMs}`)
  }
  const action = options.action ?? 'measure'
  if (!['measure', 'set-baseline', 'clear-baseline'].includes(action)) {
    throw new Error('action must be measure, set-baseline, or clear-baseline')
  }
  return { settleMs, action }
}

const PERFORMANCE_COMPARISON_FIELDS = [
  { name: 'LCP', label: 'Largest contentful paint', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.metrics.LCP?.value ?? null },
  { name: 'INP', label: 'Interaction to next paint', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.metrics.INP?.value ?? null },
  { name: 'CLS', label: 'Cumulative layout shift', unit: 'score', tolerance: 0.001, value: (report: BrowserPerformanceReport) => report.metrics.CLS?.value ?? null },
  { name: 'FCP', label: 'First contentful paint', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.metrics.FCP?.value ?? null },
  { name: 'TTFB', label: 'Time to first byte', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.metrics.TTFB?.value ?? null },
  { name: 'LOAD', label: 'Load event', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.navigation?.loadMs ?? null },
  { name: 'TRANSFER', label: 'Transferred resources', unit: 'bytes', tolerance: 1_024, value: (report: BrowserPerformanceReport) => report.resources.transferBytes },
  { name: 'LONG_TASK_BLOCKING', label: 'Long-task blocking time', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.longTasks.blockingTimeMs },
  { name: 'LOAF_BLOCKING', label: 'Long-animation-frame blocking', unit: 'ms', tolerance: 1, value: (report: BrowserPerformanceReport) => report.longAnimationFrames.blockingDurationMs }
] as const

function comparisonMetric(
  definition: typeof PERFORMANCE_COMPARISON_FIELDS[number],
  baseline: BrowserPerformanceReport,
  current: BrowserPerformanceReport
): BrowserPerformanceComparisonMetric {
  const baselineValue = definition.value(baseline)
  const currentValue = definition.value(current)
  const metric = { name: definition.name, label: definition.label, unit: definition.unit }
  if (baselineValue === null || currentValue === null) {
    return { ...metric, baselineValue, currentValue, delta: null, direction: 'unavailable' }
  }
  const difference = currentValue - baselineValue
  const delta = definition.unit === 'score' ? difference : Math.round(difference * 1_000) / 1_000
  const tolerance = Math.max(definition.tolerance, Math.abs(baselineValue) * 0.01)
  const roundingNoise = Number.EPSILON * Math.max(1, Math.abs(baselineValue), Math.abs(currentValue))
  const direction = Math.abs(delta) <= tolerance + roundingNoise
    ? 'unchanged'
    : delta < 0 ? 'improved' : 'regressed'
  return { ...metric, baselineValue, currentValue, delta, direction }
}

export function buildPerformanceComparison(
  baseline: BrowserPerformanceReport,
  current: BrowserPerformanceReport,
  baselineEnvironment: BrowserPerformanceEnvironment,
  currentEnvironment: BrowserPerformanceEnvironment,
  sameEnvironment = JSON.stringify(baselineEnvironment) === JSON.stringify(currentEnvironment)
): { baseline: BrowserPerformanceBaselineSummary; comparison: BrowserPerformanceComparison } {
  return {
    baseline: {
      measuredAt: baseline.measuredAt,
      url: baseline.url,
      environment: baselineEnvironment
    },
    comparison: {
      sameUrl: baseline.url === current.url,
      sameEnvironment,
      metrics: PERFORMANCE_COMPARISON_FIELDS.map((definition) => comparisonMetric(definition, baseline, current))
    }
  }
}

export function performanceAuditPageScript(
  webVitalsSource: string,
  options: NormalizedPerformanceOptions,
  webVitalsVersion: string,
  documentRouted = false
): string {
  const config: PerformanceAuditPageConfig = {
    ...options,
    version: webVitalsVersion,
    documentRouted,
    maxTargets: PERFORMANCE_AUDIT_LIMITS.maxTargetsPerMetric,
    maxTargetChars: PERFORMANCE_AUDIT_LIMITS.maxTargetChars,
    maxLongAnimationFrames: PERFORMANCE_AUDIT_LIMITS.maxLongAnimationFrames,
    maxReportedLongAnimationFrames: PERFORMANCE_AUDIT_LIMITS.maxReportedLongAnimationFrames,
    maxScriptContributors: PERFORMANCE_AUDIT_LIMITS.maxScriptContributors,
    maxAttributionChars: PERFORMANCE_AUDIT_LIMITS.maxAttributionChars,
    maxSourceUrlChars: PERFORMANCE_AUDIT_LIMITS.maxSourceUrlChars,
    maxUserTimings: PERFORMANCE_AUDIT_LIMITS.maxUserTimings,
    maxUserTimingNameChars: PERFORMANCE_AUDIT_LIMITS.maxUserTimingNameChars,
    maxLayoutShifts: PERFORMANCE_AUDIT_LIMITS.maxLayoutShifts,
    maxReportedLayoutShifts: PERFORMANCE_AUDIT_LIMITS.maxReportedLayoutShifts,
    maxLayoutShiftSources: PERFORMANCE_AUDIT_LIMITS.maxLayoutShiftSources
  }
  // web-vitals is a library's own source, so it stays text. It loads once, with the collector it feeds, and the
  // measurement's result is the page function's.
  return `if (!globalThis.__hronautPerformanceCollector) (() => {\n${webVitalsSource}\n})();\n`
    + pageScript(performanceAuditInPage, config, lcpAttributionInPage, softNavigationsInPage, Object.values(PERFORMANCE_REPORT_CAVEATS))
}

function safePerformanceText(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value
    ? redactDiagnosticText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    : ''
  return normalized ? normalized.slice(0, maxChars) : undefined
}

export function sanitizePerformanceReport(report: BrowserPerformanceReport): BrowserPerformanceReport {
  return {
    ...report,
    ...(report.softNavigations ? { softNavigations: sanitizeSoftNavigations(report.softNavigations) } : {}),
    url: redactNetworkUrl(report.url).slice(0, 4_096),
    title: safePerformanceText(report.title, 500) ?? '',
    metrics: Object.fromEntries(Object.entries(report.metrics).map(([name, metric]) => [
      name,
      metric
        ? {
            ...metric,
            ...(metric.lcpAttribution ? { lcpAttribution: sanitizeLcpAttribution(metric.lcpAttribution) } : {}),
            navigationType: safePerformanceText(metric.navigationType, 80) ?? 'navigate',
            targets: metric.targets.map((target) => safePerformanceText(target, PERFORMANCE_AUDIT_LIMITS.maxTargetChars))
              .filter((target): target is string => Boolean(target))
          }
        : null
    ])) as BrowserPerformanceReport['metrics'],
    longAnimationFrames: {
      ...report.longAnimationFrames,
      contributors: report.longAnimationFrames.contributors.map((contributor) => {
        const sourceUrl = contributor.sourceUrl
          ? redactNetworkUrl(contributor.sourceUrl).slice(0, PERFORMANCE_AUDIT_LIMITS.maxSourceUrlChars)
          : undefined
        const sourceFunctionName = safePerformanceText(
          contributor.sourceFunctionName,
          PERFORMANCE_AUDIT_LIMITS.maxAttributionChars
        )
        const invoker = safePerformanceText(contributor.invoker, PERFORMANCE_AUDIT_LIMITS.maxAttributionChars)
        const invokerType = safePerformanceText(contributor.invokerType, 80)
        return {
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(sourceFunctionName ? { sourceFunctionName } : {}),
          ...(contributor.sourceCharPosition !== undefined ? { sourceCharPosition: contributor.sourceCharPosition } : {}),
          ...(invoker ? { invoker } : {}),
          ...(invokerType ? { invokerType } : {}),
          count: contributor.count,
          totalDurationMs: contributor.totalDurationMs,
          forcedStyleAndLayoutDurationMs: contributor.forcedStyleAndLayoutDurationMs
        }
      })
    },
    userTimings: {
      ...report.userTimings,
      entries: report.userTimings.entries.map((entry) => ({
        ...entry,
        name: safePerformanceText(entry.name, PERFORMANCE_AUDIT_LIMITS.maxUserTimingNameChars) ?? '(unnamed)'
      }))
    },
    layoutShifts: {
      ...report.layoutShifts,
      entries: report.layoutShifts.entries.map((entry) => ({
        ...entry,
        sources: entry.sources.map((source) => safePerformanceText(source, PERFORMANCE_AUDIT_LIMITS.maxTargetChars))
          .filter((source): source is string => Boolean(source))
      }))
    }
  }
}
