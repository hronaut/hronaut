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
  const delta = Math.round((currentValue - baselineValue) * 1_000) / 1_000
  const tolerance = Math.max(definition.tolerance, Math.abs(baselineValue) * 0.01)
  const direction = Math.abs(delta) <= tolerance
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
  webVitalsVersion: string
): string {
  const config = JSON.stringify({
    ...options,
    version: webVitalsVersion,
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
  })
  return `(() => {
    const config = ${config};
    const boundedText = (value, max) => String(value ?? '')
      .replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g, '')
      .slice(0, max);
    const finite = (value) => Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : null;
    const selectorFor = (value) => {
      if (!(value instanceof Element)) return '';
      try {
        if (value.id) return boundedText('#' + CSS.escape(value.id), config.maxTargetChars);
        const parts = [];
        let node = value;
        while (node && node !== document.documentElement && parts.length < 4) {
          let part = node.localName || 'element';
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((sibling) => sibling.localName === node.localName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(part);
          node = parent;
        }
        return boundedText(parts.join(' > '), config.maxTargetChars);
      } catch {
        return boundedText(value.localName || '', config.maxTargetChars);
      }
    };
    const metricTargets = (metric) => {
      const targets = [];
      for (const entry of metric.entries || []) {
        const candidates = [entry.element, entry.target, ...(entry.sources || []).map((source) => source.node)];
        for (const candidate of candidates) {
          const selector = selectorFor(candidate);
          if (selector && !targets.includes(selector)) targets.push(selector);
          if (targets.length >= config.maxTargets) return targets;
        }
      }
      return targets;
    };
    const sourceUrl = (value) => {
      try {
        const url = new URL(String(value || ''), location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return boundedText(url.href, config.maxSourceUrlChars);
      } catch { return ''; }
    };
    const longAnimationFrame = (entry) => {
      const endTime = (finite(entry.startTime) || 0) + (finite(entry.duration) || 0);
      const renderStart = finite(entry.renderStart) || 0;
      const styleAndLayoutStart = finite(entry.styleAndLayoutStart) || 0;
      const firstUIEventTimestamp = finite(entry.firstUIEventTimestamp) || 0;
      return {
        startTimeMs: finite(entry.startTime) || 0,
        durationMs: finite(entry.duration) || 0,
        blockingDurationMs: finite(entry.blockingDuration) || 0,
        renderDurationMs: renderStart > 0 ? finite(endTime - renderStart) || 0 : 0,
        styleAndLayoutDurationMs: styleAndLayoutStart > 0 ? finite(endTime - styleAndLayoutStart) || 0 : 0,
        firstUIEventDelayMs: firstUIEventTimestamp > 0 ? finite((finite(entry.startTime) || 0) - firstUIEventTimestamp) : null,
        scripts: Array.from(entry.scripts || []).map((script) => ({
          sourceUrl: sourceUrl(script.sourceURL),
          sourceFunctionName: boundedText(script.sourceFunctionName, config.maxAttributionChars),
          sourceCharPosition: Number.isFinite(script.sourceCharPosition) && script.sourceCharPosition >= 0
            ? Math.floor(script.sourceCharPosition)
            : undefined,
          invoker: boundedText(script.invoker, config.maxAttributionChars),
          invokerType: boundedText(script.invokerType, 80),
          durationMs: finite(script.duration) || 0,
          forcedStyleAndLayoutDurationMs: finite(script.forcedStyleAndLayoutDuration) || 0
        }))
      };
    };
    if (!globalThis.__hronautPerformanceCollector) {
      ${webVitalsSource}
      const metrics = { LCP: null, INP: null, CLS: null, FCP: null, TTFB: null };
      const updateMetric = (metric) => {
        const name = metric && metric.name;
        if (!(name in metrics)) return;
        metrics[name] = {
          name,
          value: finite(metric.value),
          unit: name === 'CLS' ? 'score' : 'ms',
          rating: ['good', 'needs-improvement', 'poor'].includes(metric.rating) ? metric.rating : 'needs-improvement',
          navigationType: boundedText(metric.navigationType || 'navigate', 80),
          targets: metricTargets(metric)
        };
      };
      const observe = (callback) => {
        try { callback(updateMetric, { reportAllChanges: true }); } catch { /* Unsupported metric. */ }
      };
      observe(globalThis.webVitals.onLCP);
      observe(globalThis.webVitals.onINP);
      observe(globalThis.webVitals.onCLS);
      observe(globalThis.webVitals.onFCP);
      observe(globalThis.webVitals.onTTFB);
      const longTasks = [];
      let longTaskSupported = false;
      try {
        if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
          longTaskSupported = true;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTasks.push({ startTime: entry.startTime, duration: entry.duration });
              if (longTasks.length > 500) longTasks.splice(0, longTasks.length - 500);
            }
          });
          observer.observe({ type: 'longtask', buffered: true });
        }
      } catch { longTaskSupported = false; }
      const longAnimationFrames = [];
      let longAnimationFrameSupported = false;
      let longAnimationFramesTruncated = false;
      try {
        if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame')) {
          longAnimationFrameSupported = true;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longAnimationFrames.push(longAnimationFrame(entry));
              if (longAnimationFrames.length > config.maxLongAnimationFrames) {
                longAnimationFrames.splice(0, longAnimationFrames.length - config.maxLongAnimationFrames);
                longAnimationFramesTruncated = true;
              }
            }
          });
          observer.observe({ type: 'long-animation-frame', buffered: true });
        }
      } catch { longAnimationFrameSupported = false; }
      const layoutShifts = [];
      let layoutShiftSupported = false;
      let layoutShiftCount = 0;
      let layoutShiftScoreSum = 0;
      let layoutShiftRecentInputCount = 0;
      let layoutShiftsTruncated = false;
      try {
        if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift')) {
          layoutShiftSupported = true;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.hadRecentInput) {
                layoutShiftRecentInputCount += 1;
                continue;
              }
              const value = finite(entry.value) || 0;
              layoutShiftCount += 1;
              layoutShiftScoreSum += value;
              layoutShifts.push({
                startTimeMs: finite(entry.startTime) || 0,
                value,
                sources: Array.from(entry.sources || [])
                  .map((source) => selectorFor(source.node))
                  .filter(Boolean)
                  .slice(0, config.maxLayoutShiftSources)
              });
              if (layoutShifts.length > config.maxLayoutShifts) {
                layoutShifts.sort((left, right) => right.value - left.value || left.startTimeMs - right.startTimeMs);
                layoutShifts.splice(config.maxLayoutShifts);
                layoutShiftsTruncated = true;
              }
            }
          });
          observer.observe({ type: 'layout-shift', buffered: true });
        }
      } catch { layoutShiftSupported = false; }
      globalThis.__hronautPerformanceCollector = {
        metrics,
        longTasks,
        longTaskSupported,
        longAnimationFrames,
        longAnimationFrameSupported,
        get longAnimationFramesTruncated() { return longAnimationFramesTruncated; },
        layoutShifts,
        layoutShiftSupported,
        get layoutShiftCount() { return layoutShiftCount; },
        get layoutShiftScoreSum() { return layoutShiftScoreSum; },
        get layoutShiftRecentInputCount() { return layoutShiftRecentInputCount; },
        get layoutShiftsTruncated() { return layoutShiftsTruncated; },
        observedAt: new Date().toISOString()
      };
    }
    return new Promise((resolve) => setTimeout(() => {
      const collector = globalThis.__hronautPerformanceCollector;
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const byType = new Map();
      let transferBytes = 0;
      let encodedBodyBytes = 0;
      let decodedBodyBytes = 0;
      for (const entry of resources) {
        const type = boundedText(entry.initiatorType || 'other', 40) || 'other';
        const group = byType.get(type) || { type, count: 0, transferBytes: 0 };
        group.count += 1;
        group.transferBytes += finite(entry.transferSize) || 0;
        byType.set(type, group);
        transferBytes += finite(entry.transferSize) || 0;
        encodedBodyBytes += finite(entry.encodedBodySize) || 0;
        decodedBodyBytes += finite(entry.decodedBodySize) || 0;
      }
      const longTaskDurations = collector.longTasks.map((entry) => finite(entry.duration) || 0);
      const longFrames = collector.longAnimationFrames || [];
      const layoutShifts = collector.layoutShifts || [];
      const userMarks = performance.getEntriesByType('mark');
      const userMeasures = performance.getEntriesByType('measure');
      const allUserTimingCount = userMarks.length + userMeasures.length;
      const allUserTimings = [
        ...userMarks.slice(-config.maxUserTimings).map((entry) => ({
          type: 'mark',
          name: boundedText(entry.name, config.maxUserTimingNameChars) || '(unnamed)',
          startTimeMs: finite(entry.startTime) || 0,
          durationMs: 0
        })),
        ...userMeasures.slice(-config.maxUserTimings).map((entry) => ({
          type: 'measure',
          name: boundedText(entry.name, config.maxUserTimingNameChars) || '(unnamed)',
          startTimeMs: finite(entry.startTime) || 0,
          durationMs: finite(entry.duration) || 0
        }))
      ].sort((left, right) => left.startTimeMs - right.startTimeMs);
      const contributorMap = new Map();
      for (const frame of longFrames) {
        for (const script of frame.scripts || []) {
          const key = JSON.stringify([
            script.sourceUrl || '',
            script.sourceFunctionName || '',
            script.sourceCharPosition ?? null,
            script.invoker || '',
            script.invokerType || ''
          ]);
          const contributor = contributorMap.get(key) || {
            ...(script.sourceUrl ? { sourceUrl: script.sourceUrl } : {}),
            ...(script.sourceFunctionName ? { sourceFunctionName: script.sourceFunctionName } : {}),
            ...(script.sourceCharPosition !== undefined ? { sourceCharPosition: script.sourceCharPosition } : {}),
            ...(script.invoker ? { invoker: script.invoker } : {}),
            ...(script.invokerType ? { invokerType: script.invokerType } : {}),
            count: 0,
            totalDurationMs: 0,
            forcedStyleAndLayoutDurationMs: 0
          };
          contributor.count += 1;
          contributor.totalDurationMs += script.durationMs;
          contributor.forcedStyleAndLayoutDurationMs += script.forcedStyleAndLayoutDurationMs;
          contributorMap.set(key, contributor);
        }
      }
      const longFrameDurations = longFrames.map((entry) => entry.durationMs);
      resolve({
        url: boundedText(location.href, 4096),
        title: boundedText(document.title, 500),
        measuredAt: new Date().toISOString(),
        observedAt: collector.observedAt,
        scope: 'current-visit',
        engine: { name: 'web-vitals', version: config.version },
        metrics: collector.metrics,
        navigation: navigation ? {
          type: boundedText(navigation.type || 'navigate', 40),
          responseStartMs: finite(navigation.responseStart),
          domContentLoadedMs: finite(navigation.domContentLoadedEventEnd),
          loadMs: finite(navigation.loadEventEnd),
          transferBytes: finite(navigation.transferSize),
          encodedBodyBytes: finite(navigation.encodedBodySize),
          decodedBodyBytes: finite(navigation.decodedBodySize)
        } : null,
        resources: {
          count: resources.length,
          transferBytes: finite(transferBytes),
          encodedBodyBytes: finite(encodedBodyBytes),
          decodedBodyBytes: finite(decodedBodyBytes),
          byType: Array.from(byType.values())
            .sort((left, right) => right.transferBytes - left.transferBytes || right.count - left.count)
            .slice(0, 20)
            .map((group) => ({ ...group, transferBytes: finite(group.transferBytes) }))
        },
        longTasks: {
          supported: collector.longTaskSupported,
          count: longTaskDurations.length,
          totalDurationMs: finite(longTaskDurations.reduce((total, duration) => total + duration, 0)),
          blockingTimeMs: finite(longTaskDurations.reduce((total, duration) => total + Math.max(0, duration - 50), 0)),
          longestDurationMs: finite(longTaskDurations.length ? Math.max(...longTaskDurations) : 0)
        },
        longAnimationFrames: {
          supported: collector.longAnimationFrameSupported,
          count: longFrames.length,
          totalDurationMs: finite(longFrameDurations.reduce((total, duration) => total + duration, 0)),
          blockingDurationMs: finite(longFrames.reduce((total, entry) => total + entry.blockingDurationMs, 0)),
          longestDurationMs: finite(longFrameDurations.length ? Math.max(...longFrameDurations) : 0),
          renderDurationMs: finite(longFrames.reduce((total, entry) => total + entry.renderDurationMs, 0)),
          styleAndLayoutDurationMs: finite(longFrames.reduce((total, entry) => total + entry.styleAndLayoutDurationMs, 0)),
          frames: [...longFrames]
            .sort((left, right) => right.blockingDurationMs - left.blockingDurationMs || right.durationMs - left.durationMs)
            .slice(0, config.maxReportedLongAnimationFrames)
            .map((entry) => ({
              startTimeMs: entry.startTimeMs,
              durationMs: entry.durationMs,
              blockingDurationMs: entry.blockingDurationMs,
              renderDurationMs: entry.renderDurationMs,
              styleAndLayoutDurationMs: entry.styleAndLayoutDurationMs,
              firstUIEventDelayMs: entry.firstUIEventDelayMs,
              scriptCount: entry.scripts.length
            })),
          contributors: Array.from(contributorMap.values())
            .sort((left, right) => right.totalDurationMs - left.totalDurationMs || right.count - left.count)
            .slice(0, config.maxScriptContributors)
            .map((entry) => ({
              ...entry,
              totalDurationMs: finite(entry.totalDurationMs) || 0,
              forcedStyleAndLayoutDurationMs: finite(entry.forcedStyleAndLayoutDurationMs) || 0
            })),
          truncated: collector.longAnimationFramesTruncated || longFrames.length > config.maxReportedLongAnimationFrames
        },
        userTimings: {
          count: allUserTimingCount,
          entries: allUserTimings.slice(-config.maxUserTimings),
          truncated: allUserTimingCount > config.maxUserTimings
        },
        layoutShifts: {
          supported: collector.layoutShiftSupported,
          count: collector.layoutShiftCount || 0,
          scoreSum: collector.layoutShiftSupported ? finite(collector.layoutShiftScoreSum || 0) : null,
          recentInputCount: collector.layoutShiftRecentInputCount || 0,
          entries: [...layoutShifts]
            .sort((left, right) => right.value - left.value || left.startTimeMs - right.startTimeMs)
            .slice(0, config.maxReportedLayoutShifts),
          truncated: collector.layoutShiftsTruncated || layoutShifts.length > config.maxReportedLayoutShifts
        },
        caveats: [
          'This is one local current-visit sample, not field data or a 75th-percentile CrUX result.',
          'INP is unavailable until the page receives a qualifying interaction; some metrics are unavailable for background or short-lived visits.',
          'Long animation frame attribution identifies script entry points rather than necessarily the slowest internal function.',
          'Cross-origin frames, workers, service workers, and isolated-world code may contribute work without script attribution.',
          'User Timing names are page-authored and sanitized; arbitrary detail objects, stack traces, and source code are omitted.',
          'Layout-shift evidence excludes entries with recent discrete input. Its score sum is diagnostic and may differ from CLS session-window scoring.'
        ]
      });
    }, config.settleMs));
  })()`
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
    url: redactNetworkUrl(report.url).slice(0, 4_096),
    title: safePerformanceText(report.title, 500) ?? '',
    metrics: Object.fromEntries(Object.entries(report.metrics).map(([name, metric]) => [
      name,
      metric
        ? {
            ...metric,
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
