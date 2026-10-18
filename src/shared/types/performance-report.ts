import type { BrowserAnimationPlaybackRate, BrowserDataSaverEmulation, BrowserNetworkEmulation } from './emulation.js'

export type BrowserPerformanceMetricName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
export type BrowserPerformanceRating = 'good' | 'needs-improvement' | 'poor'
export type BrowserPerformanceAction = 'measure' | 'set-baseline' | 'clear-baseline'
export type BrowserPerformanceComparisonDirection = 'improved' | 'regressed' | 'unchanged' | 'unavailable'
export type BrowserPerformanceComparisonMetricName =
  | BrowserPerformanceMetricName
  | 'LOAD'
  | 'TRANSFER'
  | 'LONG_TASK_BLOCKING'
  | 'LOAF_BLOCKING'

export interface BrowserPerformanceLcpAttribution {
  status: 'complete' | 'incomplete' | 'unsupported'
  reason?: 'missing-candidate' | 'missing-navigation' | 'missing-resource' | 'restricted-timing' | 'inconsistent-timing' | 'unsupported-navigation'
  resourceTiming: 'observed' | 'missing' | 'restricted' | 'not-applicable'
  candidateTimeMs: number | null
  timeToFirstByteMs: number | null
  resourceLoadDelayMs: number | null
  resourceLoadDurationMs: number | null
  elementRenderDelayMs: number | null
  target?: string
  resourceUrl?: string
}

export interface BrowserPerformanceMetric {
  name: BrowserPerformanceMetricName
  value: number
  unit: 'ms' | 'score'
  rating: BrowserPerformanceRating
  navigationType: string
  targets: string[]
  lcpAttribution?: BrowserPerformanceLcpAttribution
}

export interface BrowserPerformanceLongAnimationFrame {
  startTimeMs: number
  durationMs: number
  blockingDurationMs: number
  renderDurationMs: number
  styleAndLayoutDurationMs: number
  firstUIEventDelayMs: number | null
  scriptCount: number
}

export interface BrowserPerformanceScriptContributor {
  sourceUrl?: string
  sourceFunctionName?: string
  sourceCharPosition?: number
  invoker?: string
  invokerType?: string
  count: number
  totalDurationMs: number
  forcedStyleAndLayoutDurationMs: number
}

export interface BrowserPerformanceUserTiming {
  type: 'mark' | 'measure'
  name: string
  startTimeMs: number
  durationMs: number
}

export interface BrowserPerformanceLayoutShift {
  startTimeMs: number
  value: number
  sources: string[]
}

export interface BrowserPerformanceEnvironment {
  network: BrowserNetworkEmulation
  cacheDisabled: boolean
  bypassServiceWorker: boolean
  dataSaver: BrowserDataSaverEmulation
  cpuThrottlingRate: number
  animationPlaybackRate: BrowserAnimationPlaybackRate
  viewport: {
    width: number
    height: number
    deviceScaleFactor: number
    mobile: boolean
    touch: boolean
  }
  zoomPercent: number
  zoomIsolated?: boolean
  defaultFontSize?: number
  userAgentOverridden: boolean
  localeOverridden: boolean
  timezoneOverridden: boolean
  extraHttpHeaders: boolean
}

export interface BrowserPerformanceBaselineSummary {
  measuredAt: string
  url: string
  environment: BrowserPerformanceEnvironment
}

export interface BrowserPerformanceComparisonMetric {
  name: BrowserPerformanceComparisonMetricName
  label: string
  unit: 'ms' | 'score' | 'bytes'
  baselineValue: number | null
  currentValue: number | null
  delta: number | null
  direction: BrowserPerformanceComparisonDirection
}

export interface BrowserPerformanceComparison {
  sameUrl: boolean
  sameEnvironment: boolean
  metrics: BrowserPerformanceComparisonMetric[]
}

export interface BrowserPerformanceSoftNavigations {
  status: 'unsupported' | 'awaiting-navigation' | 'observed' | 'incomplete'
  collectionStartTimeMs: number
  historyComplete: false
  maxNavigations: 2
  truncated: boolean
  navigations: Array<{
    navigationId: string
    navigationType: 'soft-navigation'
    url: string
    startTimeMs: number
    coverage: 'observed' | 'incomplete'
    metrics: Record<'LCP' | 'INP' | 'CLS', Pick<BrowserPerformanceMetric, 'name' | 'value' | 'unit' | 'rating'> | null>
  }>
}

export interface BrowserPerformanceReport {
  tabId: string
  url: string
  title: string
  measuredAt: string
  observedAt: string
  scope: 'current-visit'
  softNavigations?: BrowserPerformanceSoftNavigations
  engine: { name: 'web-vitals'; version: string }
  metrics: Record<BrowserPerformanceMetricName, BrowserPerformanceMetric | null>
  navigation: {
    type: string
    responseStartMs: number | null
    domContentLoadedMs: number | null
    loadMs: number | null
    transferBytes: number | null
    encodedBodyBytes: number | null
    decodedBodyBytes: number | null
  } | null
  resources: {
    count: number
    transferBytes: number | null
    encodedBodyBytes: number | null
    decodedBodyBytes: number | null
    byType: Array<{ type: string; count: number; transferBytes: number | null }>
  }
  longTasks: {
    supported: boolean
    count: number
    totalDurationMs: number | null
    blockingTimeMs: number | null
    longestDurationMs: number | null
  }
  longAnimationFrames: {
    supported: boolean
    count: number
    totalDurationMs: number | null
    blockingDurationMs: number | null
    longestDurationMs: number | null
    renderDurationMs: number | null
    styleAndLayoutDurationMs: number | null
    frames: BrowserPerformanceLongAnimationFrame[]
    contributors: BrowserPerformanceScriptContributor[]
    truncated: boolean
  }
  userTimings: {
    count: number
    entries: BrowserPerformanceUserTiming[]
    truncated: boolean
  }
  layoutShifts: {
    supported: boolean
    count: number
    scoreSum: number | null
    recentInputCount: number
    entries: BrowserPerformanceLayoutShift[]
    truncated: boolean
  }
  caveats: string[]
  action?: BrowserPerformanceAction
  baseline?: BrowserPerformanceBaselineSummary
  comparison?: BrowserPerformanceComparison
  baselineCleared?: boolean
}

export interface BrowserPerformanceOptions {
  tabId?: string
  settleMs?: number
  action?: BrowserPerformanceAction
}
