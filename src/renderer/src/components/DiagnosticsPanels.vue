<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconAccountTree from '~icons/material-symbols/account-tree-rounded'
import IconBugReport from '~icons/material-symbols/bug-report-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCode from '~icons/material-symbols/code-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDifference from '~icons/material-symbols/difference-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconMemory from '~icons/material-symbols/memory-rounded'
import IconMonitoring from '~icons/material-symbols/monitoring-rounded'
import IconPlay from '~icons/material-symbols/play-arrow-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconScreenshotRegion from '~icons/material-symbols/screenshot-region-rounded'
import IconShieldLock from '~icons/material-symbols/shield-lock-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import {
  formatBytes as formatLocalizedBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime
} from '../../../shared/format'
import type {
  BrowserAccessibilityImpact,
  BrowserDebugReport,
  BrowserDomChangeEntry,
  BrowserPageMetadataReport,
  BrowserPerformanceComparisonMetric,
  BrowserPerformanceComparisonMetricName,
  BrowserPerformanceMetric,
  BrowserPerformanceMetricName,
  BrowserPerformanceScriptContributor,
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../shared/types'
import type { DiagnosticsController } from '../composables/useDiagnosticsController'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  controller: DiagnosticsController
  openSupport: (url: string) => Promise<void>
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  accessibilityAuditState,
  accessibilityAudit,
  accessibilityAuditError,
  accessibilityPanelOpen,
  qualityAuditState,
  qualityAuditReport,
  qualityAuditError,
  qualityAuditPanelOpen,
  qualityAuditCopied,
  performanceState,
  performanceReport,
  performanceError,
  performancePanelOpen,
  designOverviewPanelOpen,
  designOverviewReport,
  designOverviewState,
  designOverviewError,
  pageMetadataPanelOpen,
  pageMetadataReport,
  pageMetadataState,
  pageMetadataError,
  securityPanelOpen,
  securityReport,
  securityReportState,
  securityReportError,
  coveragePanelOpen,
  coverageResult,
  coverageState,
  coverageError,
  coverageMode,
  cpuProfilePanelOpen,
  cpuProfileResult,
  cpuProfileState,
  cpuProfileError,
  memoryState,
  memoryReport,
  memoryError,
  memoryPanelOpen,
  debugReportState,
  debugReport,
  debugReportError,
  debugReportPanelOpen,
  debugReportCopied,
  reproPanelOpen,
  reproRecording,
  reproState,
  reproError,
  reproCopied,
  reproPlaywrightCopied,
  domChangesPanelOpen,
  domChangesReport,
  domChangesState,
  domChangesError,
  domChangesCopied,
  visualComparePanelOpen,
  visualCompareReport,
  visualCompareState,
  visualCompareError,
  visualCompareCopied,
  inspectorIssuesOpen,
  inspectorIssuesState,
  inspectorIssuesReport,
  inspectorIssuesError,
  inspectorIssuesCopied,
  runPerformanceReport,
  runDesignOverview,
  runPageMetadata,
  runSecurityReport,
  manageCodeCoverage,
  manageCpuProfile,
  runMemoryReport,
  clearMemoryBaseline,
  manageMemoryAllocation,
  runDebugReport,
  copyDebugReport,
  manageRepro,
  startReproRecording,
  stopReproRecording,
  clearReproRecording,
  copyReproRecording,
  copyReproPlaywright,
  manageDomChanges,
  copyDomChanges,
  manageVisualCompare,
  copyVisualDiff,
  refreshInspectorIssues,
  clearInspectorIssues,
  copyInspectorIssues,
  runAccessibilityAudit,
  runQualityAudit,
  copyQualityAudit
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localPercent(value: number, maximumFractionDigits = 1): string {
  return formatPercent(props.locale, value / 100, { maximumFractionDigits })
}

function localDuration(value: number): string {
  return formatDuration(props.locale, value)
}

function formatBytes(value: number): string {
  return formatLocalizedBytes(props.locale, value)
}

function localTime(value: Date | number | string): string {
  return formatTime(props.locale, value)
}

function accessibilityImpactCount(impact: BrowserAccessibilityImpact): number {
  return accessibilityAudit.value?.violations.filter((violation) => violation.impact === impact).length ?? 0
}

function performanceMetric(name: BrowserPerformanceMetricName): BrowserPerformanceMetric | null {
  return performanceReport.value?.metrics[name] ?? null
}

function formatPerformanceMetric(metric: BrowserPerformanceMetric | null): string {
  if (!metric) return t('runtime.network.notObserved')
  return metric.unit === 'score'
    ? formatNumber(props.locale, metric.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : localDuration(metric.value)
}

function performanceComparisonMetric(name: BrowserPerformanceComparisonMetricName): BrowserPerformanceComparisonMetric | null {
  return performanceReport.value?.comparison?.metrics.find((metric) => metric.name === name) ?? null
}

function formatPerformanceDelta(metric: BrowserPerformanceComparisonMetric | null): string {
  if (!metric || metric.delta === null) return ''
  const absolute = Math.abs(metric.delta)
  const value = metric.unit === 'bytes'
    ? formatBytes(absolute)
    : metric.unit === 'score'
      ? formatNumber(props.locale, absolute, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      : localDuration(absolute)
  const sign = metric.delta > 0 ? '+' : metric.delta < 0 ? '−' : '±'
  return t('runtimeDetails.performance.delta', { value: `${sign}${value}` })
}

function performanceBaselineTime(): string {
  const measuredAt = performanceReport.value?.baseline?.measuredAt
  if (!measuredAt) return ''
  const date = new Date(measuredAt)
  return Number.isNaN(date.valueOf()) ? measuredAt : formatDateTime(props.locale, date, { timeStyle: 'short' })
}

function performanceContributorTitle(contributor: BrowserPerformanceScriptContributor): string {
  return contributor.sourceFunctionName || contributor.invoker || t('runtimeDetails.performance.anonymous')
}

function performanceContributorSource(contributor: BrowserPerformanceScriptContributor): string {
  if (!contributor.sourceUrl) return contributor.invokerType || t('runtimeDetails.performance.unavailable')
  try {
    const url = new URL(contributor.sourceUrl)
    const source = `${url.host}${url.pathname}`
    return contributor.sourceCharPosition === undefined
      ? source
      : t('runtimeDetails.performance.character', { source, position: localNumber(contributor.sourceCharPosition) })
  } catch {
    return contributor.sourceUrl
  }
}

const pageMetadataIssueKeys = {
  'missing-title': 'missingTitle',
  'multiple-titles': 'multipleTitles',
  'missing-description': 'missingDescription',
  'multiple-descriptions': 'multipleDescriptions',
  'missing-canonical': 'missingCanonical',
  'multiple-canonicals': 'multipleCanonicals',
  'missing-language': 'missingLanguage',
  'missing-viewport': 'missingViewport',
  'robots-noindex': 'robotsNoindex',
  'missing-h1': 'missingH1',
  'multiple-h1': 'multipleH1',
  'incomplete-open-graph': 'incompleteOpenGraph',
  'missing-og-image-alt': 'missingOgImageAlt',
  'missing-twitter-card': 'missingTwitterCard',
  'invalid-json-ld': 'invalidJsonLd'
} as const

function pageMetadataIssueLabel(issue: BrowserPageMetadataReport['issues'][number]): string {
  const key = pageMetadataIssueKeys[issue.code as keyof typeof pageMetadataIssueKeys]
  return key ? t(`pageMetadata.issues.${key}.label`) : issue.code.replaceAll('-', ' ')
}

function pageMetadataIssueMessage(issue: BrowserPageMetadataReport['issues'][number]): string {
  const key = pageMetadataIssueKeys[issue.code as keyof typeof pageMetadataIssueKeys]
  if (!key) return issue.message
  if (key === 'incompleteOpenGraph') {
    const field = issue.message.match(/missing ([^.]+)\./)?.[1] ?? 'metadata'
    return t('pageMetadata.issues.incompleteOpenGraph.message', { field })
  }
  if (key === 'invalidJsonLd') {
    const count = pageMetadataReport.value?.structuredData.invalidBlockCount ?? 0
    return t('pageMetadata.issues.invalidJsonLd.message', { count }, count)
  }
  return t(`pageMetadata.issues.${key}.message`)
}

function formatSignedBytes(bytes: number): string {
  if (!bytes) return '0 B'
  return `${bytes > 0 ? '+' : '−'}${formatBytes(Math.abs(bytes))}`
}

function formatSignedCount(value: number): string {
  if (!value) return localNumber(0)
  return `${value > 0 ? '+' : '−'}${localNumber(Math.abs(value))}`
}

function memoryDeltaClass(value: number | undefined): string {
  if (!value) return 'neutral'
  return value > 0 ? 'growth' : 'reduction'
}

function debugTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(props.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  }).format(date)
}

function formatSecurityDate(value: string): string {
  const date = new Date(value)
  if (!value || Number.isNaN(date.valueOf())) return t('securityReport.unavailable')
  return formatDateTime(props.locale, date, { dateStyle: 'medium', timeStyle: 'short' })
}

function debugRequestStatus(request: BrowserDebugReport['network'][number]): string {
  if (request.error) return request.error
  if (request.status !== undefined) return String(request.status)
  return request.completedAt ? t('runtime.network.complete') : t('runtime.network.pending')
}

function formatReproElapsed(elapsedMs: number): string {
  return `+${localDuration(elapsedMs)}`
}

function domChangeDescription(entry: BrowserDomChangeEntry): string {
  if (entry.kind === 'attributes') {
    const attribute = entry.attributeName ?? t('runtime.storage.attribute')
    return entry.occurrences > 1
      ? t('domChanges.change.attributeRepeated', { attribute, count: localNumber(entry.occurrences) })
      : t('domChanges.change.attribute', { attribute })
  }
  if (entry.kind === 'text') {
    return entry.occurrences > 1
      ? t('domChanges.change.textRepeated', { count: localNumber(entry.occurrences) })
      : t('domChanges.change.text')
  }
  const parts: string[] = []
  if (entry.addedNodes) parts.push(t('domChanges.change.added', { count: localNumber(entry.addedNodes) }))
  if (entry.removedNodes) parts.push(t('domChanges.change.removed', { count: localNumber(entry.removedNodes) }))
  return parts.length ? parts.join(' · ') : t('domChanges.change.child')
}
</script>

<template>
    <section
      v-if="qualityAuditPanelOpen"
      class="accessibility-panel quality-audit-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="quality-audit-panel-title"
      :aria-busy="qualityAuditState === 'running'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('qualityAudit.kicker') }}</span>
          <h2 id="quality-audit-panel-title">{{ t('qualityAudit.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('qualityAudit.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('qualityAudit.close')" @click="qualityAuditPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="qualityAuditState === 'running'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('qualityAudit.checking') }}</strong>
        <span>{{ t('qualityAudit.privacy') }}</span>
      </div>
      <div v-else-if="qualityAuditState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('qualityAudit.failed') }}</strong>
        <span>{{ qualityAuditError }}</span>
        <button type="button" @click="runQualityAudit">{{ t('common.tryAgain') }}</button>
      </div>
      <template v-else-if="qualityAuditReport">
        <div class="quality-audit-summary" :class="qualityAuditReport.status">
          <IconCheck v-if="qualityAuditReport.status === 'pass'" aria-hidden="true" />
          <IconWarning v-else-if="qualityAuditReport.status === 'warning'" aria-hidden="true" />
          <IconError v-else aria-hidden="true" />
          <span>
            <strong>{{ qualityAuditReport.status === 'pass' ? t('qualityAudit.clear') : qualityAuditReport.status === 'warning' ? t('qualityAudit.review') : t('qualityAudit.attention') }}</strong>
            <small>{{ qualityAuditReport.totals.errors }} {{ t('qualityAudit.errors') }} · {{ qualityAuditReport.totals.warnings }} {{ t('qualityAudit.warnings') }} · {{ qualityAuditReport.totals.info }} {{ t('qualityAudit.information') }}</small>
          </span>
        </div>
        <div class="quality-audit-content">
          <section class="quality-audit-categories" :aria-label="t('qualityAudit.categories')">
            <article v-for="category in qualityAuditReport.categories" :key="category.id" :class="category.status">
              <header>
                <strong>{{ category.label }}</strong>
                <span>{{ category.status.replace('-', ' ') }}</span>
              </header>
              <p>{{ category.summary }}</p>
              <ul>
                <li v-for="item in category.evidence" :key="item">{{ item }}</li>
              </ul>
            </article>
          </section>
          <section v-if="qualityAuditReport.findings.length" class="quality-audit-findings" aria-labelledby="quality-audit-findings-title">
            <h3 id="quality-audit-findings-title">{{ t('qualityAudit.findings') }}</h3>
            <article v-for="(finding, index) in qualityAuditReport.findings" :key="`${finding.category}-${finding.code}-${index}`" :class="finding.severity">
              <header><span>{{ finding.severity }}</span><strong>{{ finding.code }}</strong><small>{{ finding.category }}</small></header>
              <p>{{ finding.message }}</p>
            </article>
            <p v-if="qualityAuditReport.truncated" class="quality-audit-truncated">{{ t('qualityAudit.truncated') }}</p>
          </section>
          <details class="quality-audit-caveats">
            <summary>{{ t('qualityAudit.limitations') }}</summary>
            <ul><li v-for="caveat in qualityAuditReport.caveats" :key="caveat">{{ caveat }}</li></ul>
          </details>
        </div>
        <footer>
          <span>{{ t('qualityAudit.categoryCount', { count: localNumber(qualityAuditReport.categories.length), time: localTime(qualityAuditReport.auditedAt) }) }}</span>
          <div>
            <button type="button" @click="copyQualityAudit"><IconCheck v-if="qualityAuditCopied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" /> {{ qualityAuditCopied ? t('qualityAudit.copied') : t('qualityAudit.copy') }}</button>
            <button type="button" @click="runQualityAudit"><IconRefresh aria-hidden="true" /> {{ t('qualityAudit.runAgain') }}</button>
          </div>
        </footer>
      </template>
    </section>
    <section
      v-if="accessibilityPanelOpen"
      class="accessibility-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="accessibility-panel-title"
      :aria-busy="accessibilityAuditState === 'running'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('accessibilityAudit.kicker') }}</span>
          <h2 id="accessibility-panel-title">{{ t('accessibilityAudit.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('accessibilityAudit.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('accessibilityAudit.close')" @click="accessibilityPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="accessibilityAuditState === 'running'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('accessibilityAudit.checking') }}</strong>
        <span>{{ t('accessibilityAudit.privacy') }}</span>
      </div>
      <div v-else-if="accessibilityAuditState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('accessibilityAudit.failed') }}</strong>
        <span>{{ accessibilityAuditError }}</span>
        <button type="button" @click="runAccessibilityAudit">{{ t('common.tryAgain') }}</button>
      </div>
      <template v-else-if="accessibilityAudit">
        <div class="accessibility-audit-summary">
          <article>
            <strong>{{ accessibilityAudit.violationCount }}</strong>
            <span>{{ accessibilityAudit.violationCount === 1 ? t('accessibilityAudit.violation') : t('accessibilityAudit.violations') }}</span>
          </article>
          <article class="critical">
            <strong>{{ accessibilityImpactCount('critical') }}</strong>
            <span>{{ t('accessibilityAudit.critical') }}</span>
          </article>
          <article class="serious">
            <strong>{{ accessibilityImpactCount('serious') }}</strong>
            <span>{{ t('accessibilityAudit.serious') }}</span>
          </article>
          <article>
            <strong>{{ accessibilityAudit.needsReviewCount }}</strong>
            <span>{{ t('accessibilityAudit.review') }}</span>
          </article>
        </div>
        <div v-if="!accessibilityAudit.violationCount" class="accessibility-audit-empty">
          <IconCheck aria-hidden="true" />
          <strong>{{ t('accessibilityAudit.clear') }}</strong>
          <span>{{ t('accessibilityAudit.manual') }}</span>
        </div>
        <div v-else class="accessibility-violations">
          <article v-for="violation in accessibilityAudit.violations" :key="violation.id" class="accessibility-violation">
            <header>
              <span class="accessibility-impact" :class="violation.impact">{{ violation.impact }}</span>
              <strong>{{ violation.help }}</strong>
              <small>{{ violation.id }} · {{ violation.nodeCount }} {{ violation.nodeCount === 1 ? t('accessibilityAudit.element') : t('accessibilityAudit.elements') }}</small>
            </header>
            <p>{{ violation.description }}</p>
            <ul>
              <li v-for="(node, nodeIndex) in violation.nodes" :key="`${violation.id}-${nodeIndex}`">
                <code>{{ node.targets.join(' → ') }}</code>
                <span>{{ node.failureSummary }}</span>
              </li>
            </ul>
            <button v-if="violation.helpUrl" type="button" @click="openSupport(violation.helpUrl)">{{ t('accessibilityAudit.guidance') }}</button>
          </article>
        </div>
        <footer>
          <span>{{ accessibilityAudit.engine.name }} {{ accessibilityAudit.engine.version }} · {{ accessibilityAudit.standard }}</span>
          <button type="button" @click="runAccessibilityAudit"><IconRefresh aria-hidden="true" /> {{ t('accessibilityAudit.runAgain') }}</button>
        </footer>
      </template>
    </section>
    <section
      v-if="performancePanelOpen"
      class="accessibility-panel performance-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="performance-panel-title"
      :aria-busy="performanceState === 'running'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('performance.kicker') }}</span>
          <h2 id="performance-panel-title">{{ t('performance.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('performance.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('performance.close')" @click="performancePanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="performanceState === 'running'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('performance.collecting') }}</strong>
        <span>{{ t('performance.privacy') }}</span>
      </div>
      <div v-else-if="performanceState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('performance.failed') }}</strong>
        <span>{{ performanceError }}</span>
        <button type="button" @click="runPerformanceReport()">{{ t('common.tryAgain') }}</button>
      </div>
      <template v-else-if="performanceReport">
        <div v-if="performanceReport.baseline" class="performance-baseline-status" :class="{ warning: performanceReport.comparison && (!performanceReport.comparison.sameUrl || !performanceReport.comparison.sameEnvironment) }">
          <IconWarning v-if="performanceReport.comparison && (!performanceReport.comparison.sameUrl || !performanceReport.comparison.sameEnvironment)" aria-hidden="true" />
          <IconDifference v-else aria-hidden="true" />
          <span>
            <strong>{{ t(performanceReport.comparison ? 'performance.comparedAt' : 'performance.savedAt', { time: performanceBaselineTime() }) }}</strong>
            <small v-if="performanceReport.comparison && !performanceReport.comparison.sameUrl">{{ t('performance.urlChanged') }}</small>
            <small v-else-if="performanceReport.comparison && !performanceReport.comparison.sameEnvironment">{{ t('performance.conditionsChanged') }}</small>
            <small v-else-if="performanceReport.comparison">{{ t('performance.sameConditions') }}</small>
            <small v-else>{{ t('performance.measureAfter') }}</small>
          </span>
        </div>
        <div class="performance-vitals">
          <article
            v-for="name in (['LCP', 'INP', 'CLS'] as BrowserPerformanceMetricName[])"
            :key="name"
            :class="performanceMetric(name)?.rating || 'unavailable'"
          >
            <header>
              <strong>{{ name }}</strong>
              <span>{{ performanceMetric(name)?.rating?.replace('-', ' ') || t('performance.notObserved') }}</span>
            </header>
            <output>{{ formatPerformanceMetric(performanceMetric(name)) }}</output>
            <small v-if="name === 'LCP'">{{ t('performance.goodLcp') }}</small>
            <small v-else-if="name === 'INP'">{{ t('performance.goodInp') }}</small>
            <small v-else>{{ t('performance.goodCls') }}</small>
            <small
              v-if="performanceComparisonMetric(name)?.direction !== 'unavailable' && performanceComparisonMetric(name)"
              class="performance-delta"
              :class="performanceComparisonMetric(name)?.direction"
            >{{ formatPerformanceDelta(performanceComparisonMetric(name)) }}</small>
          </article>
        </div>
        <div class="performance-details">
          <section>
            <h3>{{ t('performance.loading') }}</h3>
            <dl>
              <div><dt>{{ t('performance.ttfb') }}</dt><dd>{{ formatPerformanceMetric(performanceMetric('TTFB')) }}<small v-if="performanceComparisonMetric('TTFB')?.direction !== 'unavailable'" class="performance-inline-delta" :class="performanceComparisonMetric('TTFB')?.direction">{{ formatPerformanceDelta(performanceComparisonMetric('TTFB')) }}</small></dd></div>
              <div><dt>{{ t('performance.fcp') }}</dt><dd>{{ formatPerformanceMetric(performanceMetric('FCP')) }}<small v-if="performanceComparisonMetric('FCP')?.direction !== 'unavailable'" class="performance-inline-delta" :class="performanceComparisonMetric('FCP')?.direction">{{ formatPerformanceDelta(performanceComparisonMetric('FCP')) }}</small></dd></div>
              <div><dt>{{ t('performance.domLoaded') }}</dt><dd>{{ performanceReport.navigation?.domContentLoadedMs == null ? t('performance.unavailable') : localDuration(performanceReport.navigation.domContentLoadedMs) }}</dd></div>
              <div><dt>{{ t('performance.loadEvent') }}</dt><dd>{{ performanceReport.navigation?.loadMs == null ? t('performance.unavailable') : localDuration(performanceReport.navigation.loadMs) }}<small v-if="performanceComparisonMetric('LOAD')?.direction !== 'unavailable'" class="performance-inline-delta" :class="performanceComparisonMetric('LOAD')?.direction">{{ formatPerformanceDelta(performanceComparisonMetric('LOAD')) }}</small></dd></div>
            </dl>
          </section>
          <section>
            <h3>{{ t('performance.pageWork') }}</h3>
            <dl>
              <div><dt>{{ t('performance.resources') }}</dt><dd>{{ localNumber(performanceReport.resources.count) }}</dd></div>
              <div><dt>{{ t('performance.transferred') }}</dt><dd>{{ formatBytes(performanceReport.resources.transferBytes ?? 0) }}<small v-if="performanceComparisonMetric('TRANSFER')?.direction !== 'unavailable'" class="performance-inline-delta" :class="performanceComparisonMetric('TRANSFER')?.direction">{{ formatPerformanceDelta(performanceComparisonMetric('TRANSFER')) }}</small></dd></div>
              <div><dt>{{ t('performance.longTasks') }}</dt><dd>{{ performanceReport.longTasks.supported ? localNumber(performanceReport.longTasks.count) : t('performance.unsupported') }}</dd></div>
              <div><dt>{{ t('performance.blocking') }}</dt><dd>{{ performanceReport.longTasks.supported ? localDuration(performanceReport.longTasks.blockingTimeMs ?? 0) : t('performance.unavailable') }}<small v-if="performanceComparisonMetric('LONG_TASK_BLOCKING')?.direction !== 'unavailable'" class="performance-inline-delta" :class="performanceComparisonMetric('LONG_TASK_BLOCKING')?.direction">{{ formatPerformanceDelta(performanceComparisonMetric('LONG_TASK_BLOCKING')) }}</small></dd></div>
            </dl>
          </section>
          <section>
            <h3>{{ t('performance.responsiveness') }}</h3>
            <dl>
              <div><dt>{{ t('performance.longFrames') }}</dt><dd>{{ performanceReport.longAnimationFrames.supported ? localNumber(performanceReport.longAnimationFrames.count) : t('performance.unsupported') }}</dd></div>
              <div><dt>{{ t('performance.blockingDuration') }}</dt><dd>{{ performanceReport.longAnimationFrames.supported ? localDuration(performanceReport.longAnimationFrames.blockingDurationMs ?? 0) : t('performance.unavailable') }}<small v-if="performanceComparisonMetric('LOAF_BLOCKING')?.direction !== 'unavailable'" class="performance-inline-delta" :class="performanceComparisonMetric('LOAF_BLOCKING')?.direction">{{ formatPerformanceDelta(performanceComparisonMetric('LOAF_BLOCKING')) }}</small></dd></div>
              <div><dt>{{ t('performance.longestFrame') }}</dt><dd>{{ performanceReport.longAnimationFrames.supported ? localDuration(performanceReport.longAnimationFrames.longestDurationMs ?? 0) : t('performance.unavailable') }}</dd></div>
              <div><dt>{{ t('performance.styleLayout') }}</dt><dd>{{ performanceReport.longAnimationFrames.supported ? localDuration(performanceReport.longAnimationFrames.styleAndLayoutDurationMs ?? 0) : t('performance.unavailable') }}</dd></div>
            </dl>
            <div v-if="performanceReport.longAnimationFrames.contributors.length" class="performance-contributors">
              <h4>{{ t('performance.contributors') }}</h4>
              <ol>
                <li v-for="(contributor, index) in performanceReport.longAnimationFrames.contributors" :key="`${performanceContributorSource(contributor)}-${index}`">
                  <span><strong>{{ performanceContributorTitle(contributor) }}</strong><small>{{ performanceContributorSource(contributor) }} · {{ localNumber(contributor.count) }} {{ contributor.count === 1 ? t('performance.frame') : t('performance.frames') }}</small></span>
                  <output>{{ localDuration(contributor.totalDurationMs) }}<small v-if="contributor.forcedStyleAndLayoutDurationMs">{{ localNumber(Math.round(contributor.forcedStyleAndLayoutDurationMs)) }} {{ t('performance.forcedLayout') }}</small></output>
                </li>
              </ol>
              <p v-if="performanceReport.longAnimationFrames.truncated" class="performance-attribution-note">{{ t('performance.contributorsLimit') }}</p>
            </div>
            <p v-else-if="performanceReport.longAnimationFrames.supported && performanceReport.longAnimationFrames.count" class="performance-hint"><IconInfo aria-hidden="true" /> {{ t('performance.unattributed') }}</p>
          </section>
          <section v-if="performanceReport.layoutShifts.supported">
            <h3>{{ t('performance.shifts') }}</h3>
            <dl>
              <div><dt>{{ t('performance.unexpected') }}</dt><dd>{{ localNumber(performanceReport.layoutShifts.count) }}</dd></div>
              <div><dt>{{ t('performance.scoreSum') }}</dt><dd>{{ formatNumber(locale, performanceReport.layoutShifts.scoreSum ?? 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) }}</dd></div>
              <div><dt>{{ t('performance.recentInput') }}</dt><dd>{{ localNumber(performanceReport.layoutShifts.recentInputCount) }} {{ t('performance.excluded') }}</dd></div>
            </dl>
            <div v-if="performanceReport.layoutShifts.entries.length" class="performance-contributors performance-layout-shifts">
              <h4>{{ t('performance.largestShifts') }}</h4>
              <ol>
                <li v-for="(entry, index) in performanceReport.layoutShifts.entries" :key="`${entry.startTimeMs}-${index}`">
                  <span><strong>{{ entry.sources[0] || t('performance.affectedUnavailable') }}</strong><small>{{ localNumber(Math.round(entry.startTimeMs)) }} {{ t('performance.afterNavigation') }}<span v-if="entry.sources.length > 1"> · {{ localNumber(entry.sources.length) }} {{ t('performance.affectedElements') }}</span></small></span>
                  <output>{{ entry.value.toFixed(3) }}</output>
                </li>
              </ol>
              <p v-if="performanceReport.layoutShifts.truncated" class="performance-attribution-note">{{ t('performance.shiftsLimit') }}</p>
            </div>
            <p v-else class="performance-hint"><IconCheck aria-hidden="true" /> {{ t('performance.noShifts') }}</p>
          </section>
          <section v-if="performanceReport.userTimings.count">
            <h3>{{ t('performance.userTiming') }}</h3>
            <div class="performance-contributors performance-user-timings">
              <ol>
                <li v-for="(entry, index) in performanceReport.userTimings.entries" :key="`${entry.type}-${entry.startTimeMs}-${index}`">
                  <span><strong>{{ entry.name }}</strong><small>{{ entry.type }} · {{ localNumber(Math.round(entry.startTimeMs)) }} {{ t('performance.afterNavigation') }}</small></span>
                  <output>{{ entry.type === 'measure' ? localDuration(entry.durationMs) : t('performance.mark') }}</output>
                </li>
              </ol>
              <p v-if="performanceReport.userTimings.truncated" class="performance-attribution-note">{{ t('performance.timingLimit', { shown: localNumber(performanceReport.userTimings.entries.length), total: localNumber(performanceReport.userTimings.count) }) }}</p>
            </div>
          </section>
          <p v-if="!performanceMetric('INP')" class="performance-hint"><IconInfo aria-hidden="true" /> {{ t('performance.inpHelp') }}</p>
          <details>
            <summary>{{ t('performance.interpretation') }}</summary>
            <ul>
              <li v-for="caveat in performanceReport.caveats" :key="caveat">{{ caveat }}</li>
            </ul>
          </details>
        </div>
        <footer>
          <span>{{ performanceReport.engine.name }} {{ performanceReport.engine.version }} {{ t('performance.localSample') }}</span>
          <div>
            <button v-if="performanceReport.baseline" type="button" @click="runPerformanceReport('clear-baseline')">{{ t('performance.clearBaseline') }}</button>
            <button type="button" @click="runPerformanceReport('set-baseline')"><IconDifference aria-hidden="true" /> {{ performanceReport.baseline ? t('performance.replaceBaseline') : t('performance.saveBaseline') }}</button>
            <button type="button" @click="runPerformanceReport('measure')"><IconRefresh aria-hidden="true" /> {{ t('performance.measureAgain') }}</button>
          </div>
        </footer>
      </template>
    </section>
    <section
      v-if="designOverviewPanelOpen"
      class="accessibility-panel design-overview-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="design-overview-panel-title"
      :aria-busy="designOverviewState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('designOverview.kicker') }}</span>
          <h2 id="design-overview-panel-title">{{ t('designOverview.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('designOverview.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('designOverview.close')" @click="designOverviewPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="designOverviewState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('designOverview.loading') }}</strong>
        <span>{{ t('designOverview.privacy') }}</span>
      </div>
      <div v-else-if="designOverviewState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('designOverview.failed') }}</strong>
        <span>{{ designOverviewError }}</span>
        <button type="button" @click="runDesignOverview">{{ t('designOverview.tryAgain') }}</button>
      </div>
      <template v-else-if="designOverviewReport">
        <div class="design-overview-summary">
          <article><span>{{ t('designOverview.visibleElements') }}</span><strong>{{ localNumber(designOverviewReport.summary.visibleElements) }}</strong></article>
          <article><span>{{ t('designOverview.colors') }}</span><strong>{{ localNumber(designOverviewReport.summary.textColorCount + designOverviewReport.summary.backgroundColorCount + designOverviewReport.summary.borderColorCount) }}</strong></article>
          <article><span>{{ t('designOverview.fontCombinations') }}</span><strong>{{ localNumber(designOverviewReport.summary.fontCombinationCount) }}</strong></article>
          <article :class="{ warning: designOverviewReport.summary.contrastIssueCount }"><span>{{ t('designOverview.contrastIssues') }}</span><strong>{{ localNumber(designOverviewReport.summary.contrastIssueCount) }}</strong></article>
        </div>
        <div class="design-overview-details">
          <section>
            <h3>{{ t('designOverview.computedColors') }}</h3>
            <div class="design-color-groups">
              <div v-for="kind in (['text', 'background', 'border'] as const)" :key="kind">
                <h4>{{ t(`designOverview.colorKinds.${kind}`) }}</h4>
                <ul v-if="designOverviewReport.colors[kind].length" class="design-color-list">
                  <li v-for="color in designOverviewReport.colors[kind]" :key="`${kind}-${color.value}`">
                    <span class="design-color-swatch" :style="{ backgroundColor: color.value }" aria-hidden="true"></span>
                    <code>{{ color.value }}</code>
                    <small>{{ localNumber(color.count) }}×</small>
                  </li>
                </ul>
                <p v-else>{{ t('designOverview.noVisibleColors', { kind: t(`designOverview.colorKinds.${kind}`) }) }}</p>
              </div>
            </div>
          </section>
          <section>
            <h3>{{ t('designOverview.typography') }}</h3>
            <div v-if="designOverviewReport.fonts.length" class="design-font-list" role="list">
              <article v-for="font in designOverviewReport.fonts" :key="`${font.family}-${font.sizePx}-${font.weight}-${font.lineHeight}`" role="listitem">
                <strong>{{ font.family || t('designOverview.browserDefault') }}</strong>
                <span>{{ t('designOverview.fontDetails', { size: font.sizePx == null ? t('designOverview.unknownSize') : `${localNumber(font.sizePx)}px`, weight: font.weight || 'normal', line: font.lineHeight || 'normal' }) }}</span>
                <small>{{ t('designOverview.elementCount', { count: localNumber(font.count) }, font.count) }}</small>
              </article>
            </div>
            <p v-else>{{ t('designOverview.noFonts') }}</p>
          </section>
          <section>
            <h3>{{ t('designOverview.contrastHeading') }}</h3>
            <div v-if="designOverviewReport.contrastIssues.length" class="design-contrast-list" role="list">
              <article v-for="issue in designOverviewReport.contrastIssues" :key="`${issue.selector}-${issue.ratio}`" role="listitem">
                <header><code>{{ issue.selector }}</code><strong>{{ localNumber(issue.ratio) }}:1</strong></header>
                <span>{{ t('designOverview.contrastColors', { foreground: issue.foreground, background: issue.background, ratio: localNumber(issue.requiredRatio) }) }}</span>
                <small>{{ t('designOverview.contrastFont', { size: issue.fontSizePx == null ? t('designOverview.unknownSize') : `${localNumber(issue.fontSizePx)}px`, weight: issue.fontWeight }) }}<template v-if="issue.largeText"> {{ t('designOverview.largeText') }}</template></small>
              </article>
            </div>
            <p v-else>{{ t('designOverview.noContrast') }}</p>
          </section>
          <section v-if="designOverviewReport.mediaQueries.length">
            <h3>{{ t('designOverview.mediaQueries') }}</h3>
            <ul class="design-media-list">
              <li v-for="media in designOverviewReport.mediaQueries" :key="media.query"><code>{{ media.query }}</code><small>{{ localNumber(media.count) }}×</small></li>
            </ul>
          </section>
          <details>
            <summary>{{ t('designOverview.scope') }}</summary>
            <ul>
              <li>{{ t('designOverview.caveats.bounded') }}</li>
              <li>{{ t('designOverview.caveats.crossOrigin') }}</li>
              <li>{{ t('designOverview.caveats.contrast') }}</li>
              <li>{{ t('designOverview.caveats.excluded') }}</li>
            </ul>
          </details>
        </div>
        <footer>
          <span>{{ t('designOverview.sampled', { count: localNumber(designOverviewReport.summary.elementsScanned) }, designOverviewReport.summary.elementsScanned) }} · {{ debugTimestamp(designOverviewReport.capturedAt) }}</span>
          <button type="button" @click="runDesignOverview"><IconRefresh aria-hidden="true" /> {{ t('designOverview.captureAgain') }}</button>
        </footer>
      </template>
    </section>
    <section
      v-if="pageMetadataPanelOpen"
      class="accessibility-panel page-metadata-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="page-metadata-panel-title"
      :aria-busy="pageMetadataState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('pageMetadata.kicker') }}</span>
          <h2 id="page-metadata-panel-title">{{ t('pageMetadata.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('pageMetadata.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('pageMetadata.close')" @click="pageMetadataPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="pageMetadataState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('pageMetadata.loading') }}</strong>
        <span>{{ t('pageMetadata.privacy') }}</span>
      </div>
      <div v-else-if="pageMetadataState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('pageMetadata.failed') }}</strong>
        <span>{{ pageMetadataError }}</span>
        <button type="button" @click="runPageMetadata">{{ t('pageMetadata.tryAgain') }}</button>
      </div>
      <template v-else-if="pageMetadataReport">
        <div class="page-metadata-summary">
          <article><span>{{ t('pageMetadata.actionableFindings') }}</span><strong>{{ localNumber(pageMetadataReport.issues.filter((issue) => issue.severity !== 'info').length) }}</strong></article>
          <article><span>{{ t('pageMetadata.h1Headings') }}</span><strong>{{ localNumber(pageMetadataReport.document.headingCounts.h1) }}</strong></article>
          <article><span>{{ t('pageMetadata.openGraphFields') }}</span><strong>{{ localNumber(pageMetadataReport.openGraph.propertyCount) }}</strong></article>
          <article :class="{ warning: pageMetadataReport.structuredData.invalidBlockCount }"><span>{{ t('pageMetadata.structuredTypes') }}</span><strong>{{ localNumber(pageMetadataReport.structuredData.types.length) }}</strong></article>
        </div>
        <div class="page-metadata-details">
          <section v-if="pageMetadataReport.issues.length">
            <h3>{{ t('pageMetadata.findings') }}</h3>
            <div class="page-metadata-issues" role="list">
              <article v-for="issue in pageMetadataReport.issues" :key="`${issue.code}-${issue.message}`" :class="issue.severity" role="listitem">
                <IconError v-if="issue.severity === 'error'" aria-hidden="true" />
                <IconWarning v-else-if="issue.severity === 'warning'" aria-hidden="true" />
                <IconInfo v-else aria-hidden="true" />
                <div><strong>{{ pageMetadataIssueLabel(issue) }}</strong><span>{{ pageMetadataIssueMessage(issue) }}</span></div>
              </article>
            </div>
          </section>
          <section>
            <h3>{{ t('pageMetadata.searchInputs') }}</h3>
            <article class="search-preview" :aria-label="t('pageMetadata.preview')">
              <small>{{ pageMetadataReport.document.canonicalUrls[0] || pageMetadataReport.url }}</small>
              <strong>{{ pageMetadataReport.title || t('pageMetadata.untitled') }}</strong>
              <p>{{ pageMetadataReport.document.description || t('pageMetadata.noDescription') }}</p>
            </article>
            <dl class="page-metadata-grid">
              <div class="wide"><dt>{{ t('pageMetadata.canonical') }}</dt><dd>{{ pageMetadataReport.document.canonicalUrls[0] || t('pageMetadata.notDeclared') }}</dd></div>
              <div><dt>{{ t('pageMetadata.language') }}</dt><dd>{{ pageMetadataReport.document.language || t('pageMetadata.notDeclared') }}</dd></div>
              <div><dt>{{ t('pageMetadata.charset') }}</dt><dd>{{ pageMetadataReport.document.charset || t('pageMetadata.unavailable') }}</dd></div>
              <div><dt>{{ t('pageMetadata.robots') }}</dt><dd>{{ pageMetadataReport.document.robots || t('pageMetadata.defaultIndexing') }}</dd></div>
              <div><dt>{{ t('pageMetadata.viewport') }}</dt><dd>{{ pageMetadataReport.document.viewport || t('pageMetadata.notDeclared') }}</dd></div>
              <div><dt>{{ t('pageMetadata.themeColor') }}</dt><dd>{{ pageMetadataReport.document.themeColor || t('pageMetadata.notDeclared') }}</dd></div>
              <div><dt>{{ t('pageMetadata.manifest') }}</dt><dd>{{ pageMetadataReport.document.manifestUrl || t('pageMetadata.notLinked') }}</dd></div>
              <div class="wide"><dt>{{ t('pageMetadata.headingCounts') }}</dt><dd>{{ t('pageMetadata.headingCountsValue', { h1: localNumber(pageMetadataReport.document.headingCounts.h1), h2: localNumber(pageMetadataReport.document.headingCounts.h2), h3: localNumber(pageMetadataReport.document.headingCounts.h3), h4to6: localNumber(pageMetadataReport.document.headingCounts.h4 + pageMetadataReport.document.headingCounts.h5 + pageMetadataReport.document.headingCounts.h6) }) }}</dd></div>
            </dl>
          </section>
          <section>
            <h3>{{ t('pageMetadata.socialCards') }}</h3>
            <div class="social-metadata-cards">
              <article>
                <header><strong>{{ t('pageMetadata.openGraph') }}</strong><small>{{ t('pageMetadata.propertyCount', { count: localNumber(pageMetadataReport.openGraph.propertyCount) }, pageMetadataReport.openGraph.propertyCount) }}</small></header>
                <dl>
                  <div><dt>{{ t('pageMetadata.title') }}</dt><dd>{{ pageMetadataReport.openGraph.title || t('pageMetadata.notDeclared') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.type') }}</dt><dd>{{ pageMetadataReport.openGraph.type || t('pageMetadata.notDeclared') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.url') }}</dt><dd>{{ pageMetadataReport.openGraph.url || t('pageMetadata.notDeclared') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.description') }}</dt><dd>{{ pageMetadataReport.openGraph.description || t('pageMetadata.notDeclared') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.image') }}</dt><dd>{{ pageMetadataReport.openGraph.images[0]?.url || t('pageMetadata.notDeclared') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.imageAlt') }}</dt><dd>{{ pageMetadataReport.openGraph.images[0]?.alt || t('pageMetadata.notDeclared') }}</dd></div>
                </dl>
              </article>
              <article>
                <header><strong>{{ t('pageMetadata.twitterCard') }}</strong><small>{{ t('pageMetadata.propertyCount', { count: localNumber(pageMetadataReport.twitter.propertyCount) }, pageMetadataReport.twitter.propertyCount) }}</small></header>
                <dl>
                  <div><dt>{{ t('pageMetadata.card') }}</dt><dd>{{ pageMetadataReport.twitter.card || t('pageMetadata.notDeclared') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.title') }}</dt><dd>{{ pageMetadataReport.twitter.title || t('pageMetadata.fallbackTitle') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.description') }}</dt><dd>{{ pageMetadataReport.twitter.description || t('pageMetadata.fallbackDescription') }}</dd></div>
                  <div><dt>{{ t('pageMetadata.image') }}</dt><dd>{{ pageMetadataReport.twitter.images[0]?.url || t('pageMetadata.notDeclared') }}</dd></div>
                </dl>
              </article>
            </div>
          </section>
          <section>
            <h3>{{ t('pageMetadata.structuredData') }}</h3>
            <div v-if="pageMetadataReport.structuredData.types.length" class="metadata-type-list" :aria-label="t('pageMetadata.structuredTypes')">
              <span v-for="type in pageMetadataReport.structuredData.types" :key="type">{{ type }}</span>
            </div>
            <p v-else>{{ t('pageMetadata.noStructuredTypes') }}</p>
            <div v-if="pageMetadataReport.structuredData.blocks.some((block) => !block.valid)" class="metadata-json-errors">
              <div v-for="block in pageMetadataReport.structuredData.blocks.filter((item) => !item.valid)" :key="block.index"><strong>{{ t('pageMetadata.block', { number: localNumber(block.index + 1) }) }}</strong><span>{{ t('pageMetadata.issues.invalidJsonLd.label') }}</span></div>
            </div>
          </section>
          <section v-if="pageMetadataReport.alternateLinks.length || pageMetadataReport.icons.length">
            <h3>{{ t('pageMetadata.linkedMetadata') }}</h3>
            <details v-if="pageMetadataReport.alternateLinks.length">
              <summary>{{ t('pageMetadata.alternateCount', { count: localNumber(pageMetadataReport.alternateLinks.length) }, pageMetadataReport.alternateLinks.length) }}</summary>
              <ul><li v-for="alternate in pageMetadataReport.alternateLinks" :key="`${alternate.language}-${alternate.url}`"><strong>{{ alternate.language }}</strong><code>{{ alternate.url }}</code></li></ul>
            </details>
            <details v-if="pageMetadataReport.icons.length">
              <summary>{{ t('pageMetadata.iconCount', { count: localNumber(pageMetadataReport.icons.length) }, pageMetadataReport.icons.length) }}</summary>
              <ul><li v-for="icon in pageMetadataReport.icons" :key="`${icon.rel}-${icon.url}`"><strong>{{ icon.sizes || icon.type || icon.rel }}</strong><code>{{ icon.url }}</code></li></ul>
            </details>
          </section>
          <details>
            <summary>{{ t('pageMetadata.scope') }}</summary>
            <ul>
              <li>{{ t('pageMetadata.caveats.rendered') }}</li>
              <li>{{ t('pageMetadata.caveats.outcomes') }}</li>
              <li>{{ t('pageMetadata.caveats.allowlist') }}</li>
            </ul>
          </details>
        </div>
        <footer>
          <span>{{ t('pageMetadata.renderedDom') }} · {{ debugTimestamp(pageMetadataReport.capturedAt) }}</span>
          <button type="button" @click="runPageMetadata"><IconRefresh aria-hidden="true" /> {{ t('pageMetadata.inspectAgain') }}</button>
        </footer>
      </template>
    </section>
    <section
      v-if="securityPanelOpen"
      class="accessibility-panel security-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="security-panel-title"
      :aria-busy="securityReportState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('securityReport.kicker') }}</span>
          <h2 id="security-panel-title">{{ t('securityReport.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('securityReport.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('securityReport.close')" @click="securityPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="securityReportState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('securityReport.loading') }}</strong>
        <span>{{ t('securityReport.privacy') }}</span>
      </div>
      <div v-else-if="securityReportState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('securityReport.failed') }}</strong>
        <span>{{ securityReportError }}</span>
        <button type="button" @click="runSecurityReport">{{ t('securityReport.tryAgain') }}</button>
      </div>
      <template v-else-if="securityReport">
        <div class="security-overview" :class="securityReport.state">
          <IconShieldLock aria-hidden="true" />
          <div>
            <strong v-if="securityReport.state === 'secure'">{{ t('securityReport.secure') }}</strong>
            <strong v-else-if="securityReport.state === 'insecure' || securityReport.state === 'insecure-broken'">{{ t('securityReport.insecure') }}</strong>
            <strong v-else>{{ t('securityReport.state', { state: securityReport.state }) }}</strong>
            <span>{{ securityReport.origin || securityReport.url }}</span>
          </div>
          <span class="security-state">{{ securityReport.state }}</span>
        </div>
        <div class="security-details">
          <section>
            <h3>{{ t('securityReport.connection') }}</h3>
            <dl>
              <div><dt>{{ t('securityReport.encryptedTransport') }}</dt><dd>{{ securityReport.secureTransport ? t('securityReport.yes') : t('securityReport.no') }}</dd></div>
              <div><dt>{{ t('securityReport.protocol') }}</dt><dd>{{ securityReport.connection?.protocol || t('securityReport.unavailable') }}</dd></div>
              <div><dt>{{ t('securityReport.cipher') }}</dt><dd>{{ securityReport.connection?.cipher || t('securityReport.unavailable') }}</dd></div>
              <div><dt>{{ t('securityReport.keyExchange') }}</dt><dd>{{ securityReport.connection?.keyExchangeGroup || securityReport.connection?.keyExchange || t('securityReport.unavailable') }}</dd></div>
              <div><dt>{{ t('securityReport.certificateTransparency') }}</dt><dd>{{ securityReport.connection?.certificateTransparencyCompliance || t('securityReport.unavailable') }}</dd></div>
              <div><dt>{{ t('securityReport.encryptedClientHello') }}</dt><dd>{{ securityReport.connection?.encryptedClientHello == null ? t('securityReport.unavailable') : securityReport.connection.encryptedClientHello ? t('securityReport.yes') : t('securityReport.no') }}</dd></div>
            </dl>
          </section>
          <section v-if="securityReport.certificate">
            <h3>{{ t('securityReport.certificate') }}</h3>
            <dl>
              <div class="wide"><dt>{{ t('securityReport.subject') }}</dt><dd>{{ securityReport.certificate.subjectName || t('securityReport.unavailable') }}</dd></div>
              <div class="wide"><dt>{{ t('securityReport.issuer') }}</dt><dd>{{ securityReport.certificate.issuer || t('securityReport.unavailable') }}</dd></div>
              <div><dt>{{ t('securityReport.validFrom') }}</dt><dd>{{ formatSecurityDate(securityReport.certificate.validFrom) }}</dd></div>
              <div><dt>{{ t('securityReport.validUntil') }}</dt><dd>{{ formatSecurityDate(securityReport.certificate.validTo) }}</dd></div>
              <div><dt>{{ t('securityReport.validity') }}</dt><dd :class="{ warning: !securityReport.certificate.valid }">{{ securityReport.certificate.expired ? t('securityReport.expired') : securityReport.certificate.notYetValid ? t('securityReport.notYetValid') : securityReport.certificate.valid ? t('securityReport.currentlyValid') : t('securityReport.unavailable') }}</dd></div>
              <div><dt>{{ t('securityReport.expiresIn') }}</dt><dd>{{ securityReport.certificate.validTo ? t('securityReport.dayCount', { count: localNumber(securityReport.certificate.daysUntilExpiry) }, securityReport.certificate.daysUntilExpiry) : t('securityReport.unavailable') }}</dd></div>
            </dl>
            <details v-if="securityReport.certificate.sanCount">
              <summary>{{ t('securityReport.certificateNames', { count: localNumber(securityReport.certificate.sanCount) }, securityReport.certificate.sanCount) }}</summary>
              <ul><li v-for="name in securityReport.certificate.sanList" :key="name">{{ name }}</li></ul>
              <small v-if="securityReport.certificate.sanCount > securityReport.certificate.sanList.length">{{ t('securityReport.onlyFirstNames', { count: localNumber(securityReport.certificate.sanList.length) }) }}</small>
            </details>
          </section>
          <section v-else class="security-no-certificate">
            <IconInfo aria-hidden="true" />
            <div><strong>{{ t('securityReport.noCertificate') }}</strong><span>{{ t('securityReport.noCertificateDescription') }}</span></div>
          </section>
          <details class="security-caveats">
            <summary>{{ t('securityReport.caveatsHeading') }}</summary>
            <ul>
              <li>{{ t('securityReport.caveats.trust') }}</li>
              <li>{{ t('securityReport.caveats.browserIssues') }}</li>
              <li>{{ t('securityReport.caveats.unavailable') }}</li>
            </ul>
          </details>
        </div>
        <footer>
          <span>{{ t('securityReport.mainChecked', { time: debugTimestamp(securityReport.checkedAt) }) }}</span>
          <button type="button" @click="runSecurityReport"><IconRefresh aria-hidden="true" /> {{ t('securityReport.inspectAgain') }}</button>
        </footer>
      </template>
    </section>
    <section
      v-if="coveragePanelOpen"
      class="accessibility-panel coverage-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="coverage-panel-title"
      :aria-busy="coverageState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('coverage.kicker') }}</span>
          <h2 id="coverage-panel-title">{{ t('coverage.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('coverage.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('coverage.close')" @click="coveragePanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="coverageState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('coverage.loading') }}</strong>
        <span>{{ t('coverage.privacy') }}</span>
      </div>
      <div v-else-if="coverageState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('coverage.failed') }}</strong>
        <span>{{ coverageError }}</span>
        <button type="button" @click="manageCodeCoverage('get')">{{ t('coverage.tryAgain') }}</button>
      </div>
      <div v-else-if="coverageResult?.status === 'recording'" class="coverage-recording" role="status">
        <IconRecord aria-hidden="true" />
        <strong>{{ t('coverage.recording') }}</strong>
        <span>{{ t('coverage.recordingDescription') }}</span>
        <small>{{ t('coverage.recordingMeta', { mode: coverageResult.recording?.mode ?? '', time: debugTimestamp(coverageResult.recording?.startedAt || '') }) }}</small>
        <button class="primary" type="button" @click="manageCodeCoverage('stop')"><IconStop aria-hidden="true" /> {{ t('coverage.stop') }}</button>
      </div>
      <template v-else-if="coverageResult?.report">
        <div class="coverage-summary">
          <article>
            <span>{{ t('coverage.used') }}</span>
            <strong>{{ localPercent(coverageResult.report.usedPercent) }}</strong>
            <small>{{ formatBytes(coverageResult.report.usedBytes) }}</small>
          </article>
          <article>
            <span>{{ t('coverage.unused') }}</span>
            <strong>{{ formatBytes(coverageResult.report.unusedBytes) }}</strong>
            <small>{{ t('coverage.ofTotal', { total: formatBytes(coverageResult.report.totalBytes) }) }}</small>
          </article>
          <article>
            <span>{{ t('coverage.resources') }}</span>
            <strong>{{ localNumber(coverageResult.report.resources.length) }}</strong>
            <small>{{ t('coverage.resourceCounts', { javascript: localNumber(coverageResult.report.javascript.resourceCount), css: localNumber(coverageResult.report.css.resourceCount) }) }}</small>
          </article>
        </div>
        <div class="coverage-resource-list" role="list" :aria-label="t('coverage.resourcesAria')">
          <article v-for="resource in coverageResult.report.resources" :key="`${resource.type}:${resource.url}`" role="listitem">
            <div>
              <span class="coverage-type">{{ resource.type === 'javascript' ? 'JS' : 'CSS' }}</span>
              <strong :title="resource.url">{{ resource.url }}</strong>
              <small>{{ t('coverage.unusedOf', { unused: formatBytes(resource.unusedBytes), total: formatBytes(resource.totalBytes) }) }}</small>
            </div>
            <output>{{ localPercent(resource.usedPercent) }}</output>
            <div class="coverage-bar" aria-hidden="true"><span :style="{ width: `${resource.usedPercent}%` }" /></div>
          </article>
          <div v-if="!coverageResult.report.resources.length" class="network-monitor-empty compact">
            <IconCode aria-hidden="true" />
            <strong>{{ t('coverage.noResources') }}</strong>
            <span>{{ t('coverage.noResourcesDescription') }}</span>
          </div>
        </div>
        <details class="coverage-caveats">
          <summary>{{ t('coverage.interpretation') }}</summary>
          <ul>
            <li>{{ t('coverage.caveats.observed') }}</li>
            <li>{{ t('coverage.caveats.precision') }}</li>
            <li>{{ t('coverage.caveats.evidence') }}</li>
          </ul>
        </details>
        <footer>
          <span>{{ t('coverage.mode', { mode: coverageResult.report.mode }) }}<span v-if="coverageResult.report.truncated"> {{ t('coverage.bounded') }}</span></span>
          <div>
            <button type="button" @click="manageCodeCoverage('clear')"><IconDelete aria-hidden="true" /> {{ t('coverage.clear') }}</button>
            <button class="primary" type="button" @click="manageCodeCoverage('start', true)"><IconRefresh aria-hidden="true" /> {{ t('coverage.recordAgain') }}</button>
          </div>
        </footer>
      </template>
      <div v-else class="coverage-empty">
        <IconCode aria-hidden="true" />
        <strong>{{ t('coverage.emptyHeading') }}</strong>
        <span>{{ t('coverage.emptyDescription') }}</span>
        <label>
          <span>{{ t('coverage.precision') }}</span>
          <select v-model="coverageMode">
            <option value="function">{{ t('coverage.functionMode') }}</option>
            <option value="block">{{ t('coverage.blockMode') }}</option>
          </select>
        </label>
        <div>
          <button type="button" @click="manageCodeCoverage('start', false)"><IconPlay aria-hidden="true" /> {{ t('coverage.startNow') }}</button>
          <button class="primary" type="button" @click="manageCodeCoverage('start', true)"><IconRefresh aria-hidden="true" /> {{ t('coverage.startReload') }}</button>
        </div>
      </div>
    </section>
    <section
      v-if="cpuProfilePanelOpen"
      class="accessibility-panel coverage-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="cpu-profile-panel-title"
      :aria-busy="cpuProfileState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('cpuProfile.kicker') }}</span>
          <h2 id="cpu-profile-panel-title">{{ t('cpuProfile.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('cpuProfile.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('cpuProfile.close')" @click="cpuProfilePanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="cpuProfileState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('cpuProfile.loading') }}</strong>
        <span>{{ t('cpuProfile.privacy') }}</span>
      </div>
      <div v-else-if="cpuProfileState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('cpuProfile.failed') }}</strong>
        <span>{{ cpuProfileError }}</span>
        <button type="button" @click="manageCpuProfile('get')">{{ t('cpuProfile.tryAgain') }}</button>
      </div>
      <div v-else-if="cpuProfileResult?.status === 'recording'" class="coverage-recording" role="status">
        <IconRecord aria-hidden="true" />
        <strong>{{ t('cpuProfile.recording') }}</strong>
        <span>{{ t('cpuProfile.recordingDescription') }}</span>
        <small>{{ t('cpuProfile.started', { time: debugTimestamp(cpuProfileResult.recording?.startedAt || '') }) }}</small>
        <button class="primary" type="button" @click="manageCpuProfile('stop')"><IconStop aria-hidden="true" /> {{ t('cpuProfile.stop') }}</button>
      </div>
      <template v-else-if="cpuProfileResult?.report">
        <div class="coverage-summary">
          <article>
            <span>{{ t('cpuProfile.profileTime') }}</span>
            <strong>{{ localDuration(cpuProfileResult.report.durationMs) }}</strong>
            <small>{{ t('cpuProfile.sampleCount', { count: localNumber(cpuProfileResult.report.sampleCount) }, cpuProfileResult.report.sampleCount) }}</small>
          </article>
          <article>
            <span>{{ t('cpuProfile.sampledTime') }}</span>
            <strong>{{ localDuration(cpuProfileResult.report.sampledTimeMs) }}</strong>
            <small>{{ t('cpuProfile.selfTime') }}</small>
          </article>
          <article>
            <span>{{ t('cpuProfile.hotFunctions') }}</span>
            <strong>{{ localNumber(cpuProfileResult.report.hotspots.length) }}</strong>
            <small v-if="cpuProfileResult.report.truncated">{{ t('cpuProfile.bounded') }}</small>
            <small v-else>{{ t('cpuProfile.ranked') }}</small>
          </article>
        </div>
        <div class="coverage-resource-list" role="list" :aria-label="t('cpuProfile.hotspotsAria')">
          <article v-for="hotspot in cpuProfileResult.report.hotspots" :key="`${hotspot.functionName}:${hotspot.url}:${hotspot.lineNumber}:${hotspot.columnNumber}`" role="listitem">
            <div>
              <span class="coverage-type">JS</span>
              <strong>{{ hotspot.functionName || t('cpuProfile.anonymous') }}</strong>
              <small v-if="hotspot.url" :title="hotspot.url">{{ hotspot.url }}<template v-if="hotspot.lineNumber">:{{ hotspot.lineNumber }}</template></small>
              <small v-else>{{ t('cpuProfile.anonymous') }}</small>
              <small>{{ t('cpuProfile.hotspotDetails', {
                duration: localDuration(hotspot.selfTimeMs),
                samples: t('cpuProfile.sampleCount', { count: localNumber(hotspot.samples) }, hotspot.samples),
              }) }}</small>
            </div>
            <output>{{ localPercent(hotspot.selfPercent) }}</output>
            <div class="coverage-bar" aria-hidden="true"><span :style="{ width: `${hotspot.selfPercent}%` }" /></div>
          </article>
          <div v-if="!cpuProfileResult.report.hotspots.length" class="network-monitor-empty compact">
            <IconMonitoring aria-hidden="true" />
            <strong>{{ t('cpuProfile.noHotspot') }}</strong>
            <span>{{ t('cpuProfile.noHotspotDescription') }}</span>
          </div>
        </div>
        <details class="coverage-caveats">
          <summary>{{ t('cpuProfile.interpretation') }}</summary>
          <ul>
            <li>{{ t('cpuProfile.caveats.sampled') }}</li>
            <li>{{ t('cpuProfile.caveats.repeat') }}</li>
            <li>{{ t('cpuProfile.caveats.excluded') }}</li>
          </ul>
        </details>
        <footer>
          <span>{{ t('cpuProfile.startedOn', { url: cpuProfileResult.report.startedUrl }) }}<span v-if="cpuProfileResult.report.currentUrl !== cpuProfileResult.report.startedUrl"> {{ t('cpuProfile.pageChanged') }}</span></span>
          <div>
            <button type="button" @click="manageCpuProfile('clear')"><IconDelete aria-hidden="true" /> {{ t('cpuProfile.clear') }}</button>
            <button class="primary" type="button" @click="manageCpuProfile('start')"><IconRecord aria-hidden="true" /> {{ t('cpuProfile.recordAgain') }}</button>
          </div>
        </footer>
      </template>
      <div v-else class="coverage-empty">
        <IconMonitoring aria-hidden="true" />
        <strong>{{ t('cpuProfile.emptyHeading') }}</strong>
        <span>{{ t('cpuProfile.emptyDescription') }}</span>
        <div>
          <button class="primary" type="button" @click="manageCpuProfile('start')"><IconRecord aria-hidden="true" /> {{ t('cpuProfile.start') }}</button>
        </div>
      </div>
    </section>
    <section
      v-if="memoryPanelOpen"
      class="accessibility-panel memory-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="memory-panel-title"
      :aria-busy="memoryState === 'running'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('memory.kicker') }}</span>
          <h2 id="memory-panel-title">{{ t('memory.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('memory.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('memory.close')" @click="memoryPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="memoryState === 'running'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('memory.loading') }}</strong>
        <span>{{ t('memory.privacy') }}</span>
      </div>
      <div v-else-if="memoryState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('memory.failed') }}</strong>
        <span>{{ memoryError }}</span>
        <button type="button" @click="runMemoryReport()">{{ t('memory.tryAgain') }}</button>
      </div>
      <template v-else-if="memoryReport?.current">
        <div class="memory-summary">
          <article>
            <span>{{ t('memory.heapUsed') }}</span>
            <strong>{{ formatBytes(memoryReport.current.jsHeapUsedBytes) }}</strong>
            <small v-if="memoryReport.delta" :class="memoryDeltaClass(memoryReport.delta.jsHeapUsedBytes)">{{ t('memory.fromBaseline', { value: formatSignedBytes(memoryReport.delta.jsHeapUsedBytes) }) }}</small>
            <small v-else>{{ t('memory.noBaselineYet') }}</small>
          </article>
          <article>
            <span>{{ t('memory.domNodes') }}</span>
            <strong>{{ localNumber(memoryReport.current.nodes) }}</strong>
            <small v-if="memoryReport.delta" :class="memoryDeltaClass(memoryReport.delta.nodes)">{{ t('memory.fromBaseline', { value: formatSignedCount(memoryReport.delta.nodes) }) }}</small>
            <small v-else>{{ t('memory.noBaselineYet') }}</small>
          </article>
          <article>
            <span>{{ t('memory.eventListeners') }}</span>
            <strong>{{ localNumber(memoryReport.current.eventListeners) }}</strong>
            <small v-if="memoryReport.delta" :class="memoryDeltaClass(memoryReport.delta.eventListeners)">{{ t('memory.fromBaseline', { value: formatSignedCount(memoryReport.delta.eventListeners) }) }}</small>
            <small v-else>{{ t('memory.noBaselineYet') }}</small>
          </article>
          <article>
            <span>{{ t('memory.documents') }}</span>
            <strong>{{ localNumber(memoryReport.current.documents) }}</strong>
            <small v-if="memoryReport.delta" :class="memoryDeltaClass(memoryReport.delta.documents)">{{ t('memory.fromBaseline', { value: formatSignedCount(memoryReport.delta.documents) }) }}</small>
            <small v-else>{{ t('memory.noBaselineYet') }}</small>
          </article>
        </div>
        <div class="memory-details">
          <dl>
            <div><dt>{{ t('memory.heapCapacity') }}</dt><dd>{{ formatBytes(memoryReport.current.jsHeapTotalBytes) }}</dd></div>
            <div><dt>{{ t('memory.embedderHeap') }}</dt><dd>{{ formatBytes(memoryReport.current.embedderHeapUsedBytes) }}</dd></div>
            <div><dt>{{ t('memory.backingStorage') }}</dt><dd>{{ formatBytes(memoryReport.current.backingStorageBytes) }}</dd></div>
            <div><dt>{{ t('memory.layoutObjects') }}</dt><dd>{{ localNumber(memoryReport.current.layoutObjects) }}</dd></div>
            <div><dt>{{ t('memory.frames') }}</dt><dd>{{ localNumber(memoryReport.current.frames) }}</dd></div>
            <div><dt>{{ t('memory.sample') }}</dt><dd>{{ memoryReport.forcedGarbageCollection ? t('memory.afterForcedGc') : t('memory.currentState') }}</dd></div>
          </dl>
          <p class="memory-hint"><IconInfo aria-hidden="true" /> {{ t('memory.leakHint') }}</p>
          <section class="memory-allocation-section" aria-labelledby="memory-allocation-title">
            <div class="memory-allocation-heading">
              <div>
                <span class="eyebrow">{{ t('memory.allocation.kicker') }}</span>
                <h3 id="memory-allocation-title">{{ t('memory.allocation.heading') }}</h3>
              </div>
              <button
                v-if="memoryReport.allocationProfile"
                type="button"
                @click="manageMemoryAllocation('clear')"
              ><IconDelete aria-hidden="true" /> {{ t('memory.allocation.clear') }}</button>
            </div>
            <div v-if="memoryReport.allocationStatus === 'recording'" class="coverage-recording memory-allocation-recording" role="status">
              <IconRecord aria-hidden="true" />
              <strong>{{ t('memory.allocation.recording') }}</strong>
              <span>{{ t('memory.allocation.recordingDescription') }}</span>
              <small>{{ t('memory.allocation.started', { time: debugTimestamp(memoryReport.allocationRecording?.startedAt || '') }) }}</small>
              <button class="primary" type="button" @click="manageMemoryAllocation('stop')"><IconStop aria-hidden="true" /> {{ t('memory.allocation.stop') }}</button>
            </div>
            <template v-else-if="memoryReport.allocationProfile">
              <div class="coverage-summary memory-allocation-summary">
                <article>
                  <span>{{ t('memory.allocation.sampledBytes') }}</span>
                  <strong>{{ formatBytes(memoryReport.allocationProfile.sampledBytes) }}</strong>
                  <small>{{ t('memory.allocation.sampleCount', { count: localNumber(memoryReport.allocationProfile.sampleCount) }, memoryReport.allocationProfile.sampleCount) }}</small>
                </article>
                <article>
                  <span>{{ t('memory.allocation.hotFunctions') }}</span>
                  <strong>{{ localNumber(memoryReport.allocationProfile.hotspots.length) }}</strong>
                  <small v-if="memoryReport.allocationProfile.truncated">{{ t('memory.allocation.bounded') }}</small>
                  <small v-else>{{ t('memory.allocation.ranked') }}</small>
                </article>
                <article>
                  <span>{{ t('memory.allocation.topLocation') }}</span>
                  <strong>{{ localPercent(memoryReport.allocationProfile.hotspots[0]?.selfPercent ?? 0) }}</strong>
                  <small>{{ t('memory.allocation.ofSampledBytes') }}</small>
                </article>
              </div>
              <div class="coverage-resource-list memory-allocation-list" role="list" :aria-label="t('memory.allocation.hotspotsAria')">
                <article v-for="hotspot in memoryReport.allocationProfile.hotspots" :key="`${hotspot.functionName}:${hotspot.url}:${hotspot.lineNumber}:${hotspot.columnNumber}`" role="listitem">
                  <div>
                    <span class="coverage-type">JS</span>
                    <strong>{{ hotspot.functionName || t('memory.allocation.anonymous') }}</strong>
                    <small v-if="hotspot.url" :title="hotspot.url">{{ hotspot.url }}<template v-if="hotspot.lineNumber">:{{ hotspot.lineNumber }}</template></small>
                    <small v-else>{{ t('memory.allocation.anonymous') }}</small>
                    <small>{{ t('memory.allocation.hotspotDetails', {
                      bytes: formatBytes(hotspot.selfBytes),
                      samples: t('memory.allocation.sampleCount', { count: localNumber(hotspot.samples) }, hotspot.samples),
                    }) }}</small>
                  </div>
                  <output>{{ localPercent(hotspot.selfPercent) }}</output>
                  <div class="coverage-bar" aria-hidden="true"><span :style="{ width: `${hotspot.selfPercent}%` }" /></div>
                </article>
                <div v-if="!memoryReport.allocationProfile.hotspots.length" class="network-monitor-empty compact">
                  <IconMemory aria-hidden="true" />
                  <strong>{{ t('memory.allocation.noHotspot') }}</strong>
                  <span>{{ t('memory.allocation.noHotspotDescription') }}</span>
                </div>
              </div>
              <details class="coverage-caveats">
                <summary>{{ t('memory.allocation.interpretation') }}</summary>
                <ul>
                  <li>{{ t('memory.allocation.caveats.sampled') }}</li>
                  <li>{{ t('memory.allocation.caveats.retained') }}</li>
                  <li>{{ t('memory.allocation.caveats.evidence') }}</li>
                </ul>
              </details>
              <div class="memory-allocation-actions">
                <button class="primary" type="button" @click="manageMemoryAllocation('start')"><IconRecord aria-hidden="true" /> {{ t('memory.allocation.recordAgain') }}</button>
              </div>
            </template>
            <div v-else class="memory-allocation-empty">
              <IconMemory aria-hidden="true" />
              <div>
                <strong>{{ t('memory.allocation.emptyHeading') }}</strong>
                <span>{{ t('memory.allocation.emptyDescription') }}</span>
              </div>
              <button class="primary" type="button" @click="manageMemoryAllocation('start')"><IconRecord aria-hidden="true" /> {{ t('memory.allocation.start') }}</button>
            </div>
          </section>
        </div>
      </template>
      <div v-else class="accessibility-audit-empty">
        <IconMemory aria-hidden="true" />
        <strong>{{ t('memory.baselineCleared') }}</strong>
        <span>{{ t('memory.baselineClearedDescription') }}</span>
      </div>
      <footer>
        <span>{{ memoryReport?.baseline ? t('memory.baselineActive') : t('memory.noBaseline') }}</span>
        <div class="memory-actions">
          <button v-if="memoryReport?.baseline" type="button" @click="clearMemoryBaseline"><IconDelete aria-hidden="true" /> {{ t('memory.clear') }}</button>
          <button type="button" @click="runMemoryReport('set-baseline', true)"><IconKeep aria-hidden="true" /> {{ t('memory.setBaseline') }}</button>
          <button type="button" @click="runMemoryReport('measure', true)"><IconRefresh aria-hidden="true" /> {{ t('memory.gcMeasure') }}</button>
        </div>
      </footer>
    </section>
    <section
      v-if="inspectorIssuesOpen"
      class="accessibility-panel inspector-issues-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="inspector-issues-title"
      :aria-busy="inspectorIssuesState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('issues.kicker') }}</span>
          <h2 id="inspector-issues-title">{{ t('issues.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panelDocks.issues')" />
          <button class="panel-close" type="button" :aria-label="t('issues.close')" @click="inspectorIssuesOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="inspectorIssuesState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('issues.loading') }}</strong>
        <span>{{ t('issues.privacy') }}</span>
      </div>
      <div v-else-if="inspectorIssuesState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('issues.failed') }}</strong>
        <span>{{ inspectorIssuesError }}</span>
        <button type="button" @click="refreshInspectorIssues()">{{ t('issues.tryAgain') }}</button>
      </div>
      <template v-else-if="inspectorIssuesReport">
        <div class="inspector-issues-summary">
          <article class="error"><strong>{{ localNumber(inspectorIssuesReport.errorCount) }}</strong><span>{{ t('issues.pageErrors') }}</span></article>
          <article class="warning"><strong>{{ localNumber(inspectorIssuesReport.warningCount) }}</strong><span>{{ t('issues.warnings') }}</span></article>
          <article><strong>{{ localNumber(inspectorIssuesReport.infoCount) }}</strong><span>{{ t('issues.improvements') }}</span></article>
        </div>
        <div v-if="!inspectorIssuesReport.issues.length" class="accessibility-audit-empty inspector-issues-empty">
          <IconCheck aria-hidden="true" />
          <strong>{{ t('issues.empty') }}</strong>
          <span>{{ t('issues.emptyDescription') }}</span>
        </div>
        <div v-else class="inspector-issues-list">
          <article v-for="issue in inspectorIssuesReport.issues" :key="issue.id" class="inspector-issue" :class="issue.severity">
            <header>
              <span class="inspector-issue-icon" aria-hidden="true"><IconError v-if="issue.severity === 'error'" /><IconWarning v-else-if="issue.severity === 'warning'" /><IconInfo v-else /></span>
              <span><strong>{{ issue.title }}</strong><small>{{ issue.code }}</small></span>
            </header>
            <ul v-if="issue.reasons.length" class="inspector-issue-reasons">
              <li v-for="reason in issue.reasons" :key="reason"><code>{{ reason }}</code></li>
            </ul>
            <div v-if="issue.affectedUrls.length" class="inspector-issue-urls">
              <span>{{ t('issues.affected') }}</span>
              <code v-for="url in issue.affectedUrls" :key="url">{{ url }}</code>
            </div>
            <small v-if="issue.source" class="inspector-issue-source">{{ issue.source.url }}<template v-if="issue.source.lineNumber">:{{ issue.source.lineNumber }}<template v-if="issue.source.columnNumber">:{{ issue.source.columnNumber }}</template></template></small>
          </article>
          <p v-if="inspectorIssuesReport.truncated" class="inspector-issues-truncated"><IconInfo aria-hidden="true" /> {{ t('issues.truncated') }}</p>
          <details class="debug-report-caveats">
            <summary>{{ t('issues.sharing') }}</summary>
            <ul>
              <li>{{ t('issues.caveats.scope') }}</li>
              <li>{{ t('issues.caveats.privacy') }}</li>
              <li>{{ inspectorIssuesReport.devToolsOpen ? t('issues.caveats.devtools') : t('issues.caveats.reload') }}</li>
            </ul>
          </details>
        </div>
        <footer>
          <span>{{ t('issues.count', { count: localNumber(inspectorIssuesReport.issueCount) }, inspectorIssuesReport.issueCount) }} {{ t('issues.review') }}</span>
          <div class="debug-report-actions">
            <button type="button" @click="clearInspectorIssues"><IconDelete aria-hidden="true" /> {{ t('issues.clear') }}</button>
            <button type="button" @click="refreshInspectorIssues()"><IconRefresh aria-hidden="true" /> {{ t('issues.refresh') }}</button>
            <button type="button" class="primary" :disabled="!inspectorIssuesReport.issueCount" @click="copyInspectorIssues">
              <IconCheck v-if="inspectorIssuesCopied" aria-hidden="true" />
              <IconDownload v-else aria-hidden="true" />
              {{ inspectorIssuesCopied ? t('issues.copied') : t('issues.copy') }}
            </button>
          </div>
        </footer>
      </template>
    </section>
    <section
      v-if="debugReportPanelOpen"
      class="accessibility-panel debug-report-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="debug-report-panel-title"
      :aria-busy="debugReportState === 'running'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('debugReport.kicker') }}</span>
          <h2 id="debug-report-panel-title">{{ t('debugReport.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('debugReport.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('debugReport.close')" @click="debugReportPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="debugReportState === 'running'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('debugReport.loading') }}</strong>
        <span>{{ t('debugReport.privacy') }}</span>
      </div>
      <div v-else-if="debugReportState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('debugReport.failed') }}</strong>
        <span>{{ debugReportError }}</span>
        <button type="button" @click="runDebugReport">{{ t('debugReport.tryAgain') }}</button>
      </div>
      <template v-else-if="debugReport">
        <div class="debug-report-summary">
          <article class="error"><strong>{{ localNumber(debugReport.summary.consoleErrors) }}</strong><span>{{ t('debugReport.consoleErrors') }}</span></article>
          <article class="warning"><strong>{{ localNumber(debugReport.summary.consoleWarnings) }}</strong><span>{{ t('debugReport.warnings') }}</span></article>
          <article class="error"><strong>{{ localNumber(debugReport.summary.failedRequests) }}</strong><span>{{ t('debugReport.failedRequests') }}</span></article>
          <article><strong>{{ localNumber(debugReport.summary.networkRequests) }}</strong><span>{{ t('debugReport.requestsSeen') }}</span></article>
        </div>
        <div v-if="!debugReport.console.length && !debugReport.network.length" class="accessibility-audit-empty debug-report-empty">
          <IconCheck aria-hidden="true" />
          <strong>{{ t('debugReport.empty') }}</strong>
          <span>{{ t('debugReport.emptyDescription') }}</span>
        </div>
        <div v-else class="debug-report-evidence">
          <section v-if="debugReport.console.length" aria-labelledby="debug-report-console-title">
            <h3 id="debug-report-console-title">{{ t('debugReport.recentConsole') }} <span>{{ localNumber(debugReport.console.length) }}</span></h3>
            <article v-for="(message, index) in debugReport.console" :key="`${message.timestamp}-${index}`" class="debug-console-entry" :class="message.level">
              <header>
                <span>{{ message.level }}</span>
                <time :datetime="message.timestamp">{{ debugTimestamp(message.timestamp) }}</time>
              </header>
              <code>{{ message.message }}</code>
              <small v-if="message.sourceId">{{ message.sourceId }}<template v-if="message.lineNumber">:{{ message.lineNumber }}</template></small>
            </article>
          </section>
          <section v-if="debugReport.network.length" aria-labelledby="debug-report-network-title">
            <h3 id="debug-report-network-title">{{ t('debugReport.failedRequestsHeading') }} <span>{{ localNumber(debugReport.network.length) }}</span></h3>
            <article v-for="request in debugReport.network" :key="request.id" class="debug-network-entry">
              <header>
                <span class="method">{{ request.method }}</span>
                <strong>{{ debugRequestStatus(request) }}</strong>
                <time :datetime="request.startedAt">{{ debugTimestamp(request.startedAt) }}</time>
              </header>
              <code>{{ request.url }}</code>
              <small>{{ request.resourceType }}<template v-if="request.durationMs !== undefined"> · {{ localDuration(request.durationMs) }}</template><template v-if="request.responseSizeBytes !== undefined"> · {{ formatBytes(request.responseSizeBytes) }}</template></small>
            </article>
          </section>
          <details class="debug-report-caveats">
            <summary>{{ t('debugReport.sharing') }}</summary>
            <ul><li>{{ t('debugReport.caveats.network') }}</li><li>{{ t('debugReport.caveats.console') }}</li><li>{{ t('debugReport.caveats.repeats') }}</li><li>{{ t('debugReport.caveats.failures') }}</li></ul>
          </details>
        </div>
        <footer>
          <div class="debug-report-footer-context">
            <span>{{ t('debugReport.generated', { time: debugTimestamp(debugReport.generatedAt) }) }}</span>
            <label class="preserve-logs-toggle" :title="t('debugReport.preserveTitle')">
              <input type="checkbox" :checked="activeTab?.preserveDiagnosticLogs" :disabled="preservationBusy" @change="updatePreservation" />
              {{ t('debugReport.preserve') }}
            </label>
          </div>
          <div class="debug-report-actions">
            <button type="button" @click="runDebugReport"><IconRefresh aria-hidden="true" /> {{ t('debugReport.refresh') }}</button>
            <button type="button" class="primary" @click="copyDebugReport">
              <IconCheck v-if="debugReportCopied" aria-hidden="true" />
              <IconBugReport v-else aria-hidden="true" />
              {{ debugReportCopied ? t('debugReport.copied') : t('debugReport.copy') }}
            </button>
          </div>
        </footer>
      </template>
    </section>
    <section
      v-if="reproPanelOpen"
      class="accessibility-panel debug-report-panel repro-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="repro-panel-title"
      :aria-busy="reproState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('repro.kicker') }}</span>
          <h2 id="repro-panel-title">{{ t('repro.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('repro.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('repro.close')" @click="reproPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="reproState === 'loading' && !reproRecording" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('repro.loading') }}</strong>
      </div>
      <div v-else-if="reproState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('repro.failed') }}</strong>
        <span>{{ reproError }}</span>
        <button type="button" @click="manageRepro('get')">{{ t('repro.tryAgain') }}</button>
      </div>
      <template v-else-if="reproRecording">
        <div class="repro-safety" :class="{ recording: reproRecording.active }">
          <IconRecord aria-hidden="true" />
          <div>
            <strong>{{ reproRecording.active ? t('repro.recording') : reproRecording.stepCount ? t('repro.stopped') : t('repro.ready') }}</strong>
            <span>{{ t('repro.privacy') }}</span>
          </div>
        </div>
        <div v-if="!reproRecording.steps.length" class="accessibility-audit-empty debug-report-empty">
          <IconRecord aria-hidden="true" />
          <strong>{{ t('repro.showIssue') }}</strong>
          <span>{{ t('repro.emptyDescription') }}</span>
          <button class="primary" type="button" :disabled="reproState === 'loading'" @click="startReproRecording"><IconRecord aria-hidden="true" /> {{ t('repro.start') }}</button>
        </div>
        <div v-else class="repro-timeline" :aria-label="t('repro.timelineAria')">
          <article v-for="step in reproRecording.steps" :key="step.index" class="repro-step" :class="step.kind">
            <span class="repro-step-index">{{ step.index }}</span>
            <div>
              <header><strong>{{ step.kind }}</strong><time>{{ formatReproElapsed(step.elapsedMs) }}</time></header>
              <p>{{ step.description }}</p>
              <code v-if="step.target">{{ step.target.selector }}</code>
              <small v-else-if="step.url">{{ step.url }}</small>
            </div>
          </article>
          <p v-if="reproRecording.truncated" class="inspector-issues-truncated"><IconInfo aria-hidden="true" /> {{ t('repro.truncated') }}</p>
          <details class="debug-report-caveats">
            <summary>{{ t('repro.privacyScope') }}</summary>
            <ul><li>{{ t('repro.caveats.values') }}</li><li>{{ t('repro.caveats.selectors') }}</li><li>{{ t('repro.caveats.scope') }}</li><li>{{ t('repro.caveats.bounded') }}</li></ul>
          </details>
        </div>
        <footer>
          <span>{{ t('repro.stepCount', { count: localNumber(reproRecording.stepCount) }, reproRecording.stepCount) }} {{ t('repro.review') }}</span>
          <div class="debug-report-actions">
            <button type="button" :disabled="reproState === 'loading' || !reproRecording.stepCount" @click="clearReproRecording"><IconDelete aria-hidden="true" /> {{ t('repro.clear') }}</button>
            <button v-if="reproRecording.active" class="primary" type="button" :disabled="reproState === 'loading'" @click="stopReproRecording"><IconStop aria-hidden="true" /> {{ t('repro.stop') }}</button>
            <button v-else-if="reproRecording.stepCount" type="button" :disabled="reproState === 'loading'" @click="startReproRecording"><IconRecord aria-hidden="true" /> {{ t('repro.recordAgain') }}</button>
            <button v-if="reproRecording.stepCount && !reproRecording.active" type="button" @click="copyReproRecording">
              <IconCheck v-if="reproCopied" aria-hidden="true" />
              <IconBugReport v-else aria-hidden="true" />
              {{ reproCopied ? t('repro.copied') : t('repro.copyTimeline') }}
            </button>
            <button v-if="reproRecording.stepCount && !reproRecording.active" class="primary" type="button" @click="copyReproPlaywright">
              <IconCheck v-if="reproPlaywrightCopied" aria-hidden="true" />
              <IconCode v-else aria-hidden="true" />
              {{ reproPlaywrightCopied ? t('repro.copiedPlaywright') : t('repro.copyPlaywright') }}
            </button>
          </div>
        </footer>
      </template>
    </section>
    <section
      v-if="domChangesPanelOpen"
      class="accessibility-panel debug-report-panel repro-panel dom-changes-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="dom-changes-panel-title"
      :aria-busy="domChangesState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('domChanges.kicker') }}</span>
          <h2 id="dom-changes-panel-title">{{ t('domChanges.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('domChanges.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('domChanges.close')" @click="domChangesPanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="domChangesState === 'loading' && !domChangesReport" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('domChanges.loading') }}</strong>
      </div>
      <div v-else-if="domChangesState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('domChanges.failed') }}</strong>
        <span>{{ domChangesError }}</span>
        <button type="button" @click="manageDomChanges('get')">{{ t('domChanges.tryAgain') }}</button>
      </div>
      <template v-else-if="domChangesReport">
        <div class="repro-safety" :class="{ recording: domChangesReport.active }">
          <IconAccountTree aria-hidden="true" />
          <div>
            <strong>{{ domChangesReport.active ? t('domChanges.recording') : domChangesReport.startedAt ? t('domChanges.stopped') : t('domChanges.ready') }}</strong>
            <span>{{ t('domChanges.privacy') }}</span>
          </div>
        </div>
        <div v-if="!domChangesReport.startedAt" class="accessibility-audit-empty debug-report-empty">
          <IconAccountTree aria-hidden="true" />
          <strong>{{ t('domChanges.reveal') }}</strong>
          <span>{{ t('domChanges.emptyDescription') }}</span>
          <button class="primary" type="button" :disabled="domChangesState === 'loading'" @click="manageDomChanges('start')"><IconRecord aria-hidden="true" /> {{ t('domChanges.start') }}</button>
        </div>
        <div v-else-if="!domChangesReport.entries.length" class="accessibility-audit-empty debug-report-empty">
          <IconAccountTree aria-hidden="true" />
          <strong>{{ domChangesReport.active ? t('domChanges.waiting') : t('domChanges.noChanges') }}</strong>
          <span>{{ domChangesReport.active ? t('domChanges.waitingDescription') : t('domChanges.retryDescription') }}</span>
        </div>
        <div v-else class="repro-timeline" :aria-label="t('domChanges.timelineAria')">
          <article v-for="entry in domChangesReport.entries" :key="entry.index" class="repro-step" :class="entry.kind">
            <span class="repro-step-index">{{ entry.index }}</span>
            <div>
              <header><strong>{{ entry.kind }}</strong><time>{{ formatReproElapsed(entry.elapsedMs) }}</time></header>
              <p>{{ domChangeDescription(entry) }}</p>
              <code>{{ entry.target }}</code>
              <small v-if="entry.addedTags?.length">{{ t('domChanges.addedTags', { tags: entry.addedTags.join(', ') }) }}</small>
              <small v-if="entry.removedTags?.length">{{ t('domChanges.removedTags', { tags: entry.removedTags.join(', ') }) }}</small>
            </div>
          </article>
          <p v-if="domChangesReport.truncated" class="inspector-issues-truncated"><IconInfo aria-hidden="true" /> {{ t('domChanges.truncated', { count: localNumber(domChangesReport.droppedChanges) }) }}</p>
          <details class="debug-report-caveats">
            <summary>{{ t('domChanges.privacyScope') }}</summary>
            <ul><li>{{ t('domChanges.caveats.structural') }}</li><li>{{ t('domChanges.caveats.values') }}</li><li>{{ t('domChanges.caveats.frames') }}</li><li>{{ t('domChanges.caveats.navigation') }}</li></ul>
          </details>
        </div>
        <footer>
          <span>{{ t('domChanges.mutations', { count: localNumber(domChangesReport.changeCount) }, domChangesReport.changeCount) }} · {{ t('domChanges.entries', { count: localNumber(domChangesReport.entries.length) }, domChangesReport.entries.length) }}</span>
          <div class="debug-report-actions">
            <button type="button" :disabled="domChangesState === 'loading' || !domChangesReport.startedAt" @click="manageDomChanges('clear')"><IconDelete aria-hidden="true" /> {{ t('domChanges.clear') }}</button>
            <button v-if="domChangesReport.active" class="primary" type="button" :disabled="domChangesState === 'loading'" @click="manageDomChanges('stop')"><IconStop aria-hidden="true" /> {{ t('domChanges.stop') }}</button>
            <button v-else-if="domChangesReport.startedAt" type="button" :disabled="domChangesState === 'loading'" @click="manageDomChanges('start')"><IconRecord aria-hidden="true" /> {{ t('domChanges.recordAgain') }}</button>
            <button v-if="domChangesReport.entries.length && !domChangesReport.active" class="primary" type="button" @click="copyDomChanges">
              <IconCheck v-if="domChangesCopied" aria-hidden="true" />
              <IconAccountTree v-else aria-hidden="true" />
              {{ domChangesCopied ? t('domChanges.copied') : t('domChanges.copy') }}
            </button>
          </div>
        </footer>
      </template>
    </section>
    <section
      v-if="visualComparePanelOpen"
      class="accessibility-panel debug-report-panel visual-compare-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="visual-compare-panel-title"
      :aria-busy="visualCompareState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('visualCompare.kicker') }}</span>
          <h2 id="visual-compare-panel-title">{{ t('visualCompare.heading') }}</h2>
        </div>
        <div class="panel-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('visualCompare.heading') })" />
          <button class="panel-close" type="button" :aria-label="t('visualCompare.close')" @click="visualComparePanelOpen = false"><IconClose aria-hidden="true" /></button>
        </div>
      </header>
      <div v-if="visualCompareState === 'loading'" class="accessibility-audit-loading" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('visualCompare.loading') }}</strong>
      </div>
      <div v-else-if="visualCompareState === 'error'" class="accessibility-audit-error" role="alert">
        <IconError aria-hidden="true" />
        <strong>{{ t('visualCompare.failed') }}</strong>
        <span>{{ visualCompareError }}</span>
        <button type="button" @click="manageVisualCompare('get')">{{ t('visualCompare.returnBaseline') }}</button>
      </div>
      <template v-else-if="visualCompareReport">
        <div v-if="visualCompareReport.status === 'empty'" class="accessibility-audit-empty debug-report-empty">
          <IconDifference aria-hidden="true" />
          <strong>{{ t('visualCompare.empty') }}</strong>
          <span>{{ t('visualCompare.emptyDescription') }}</span>
          <button class="primary" type="button" @click="manageVisualCompare('set-baseline')"><IconScreenshotRegion aria-hidden="true" /> {{ t('visualCompare.setBaseline') }}</button>
        </div>
        <div v-else class="visual-compare-content">
          <div class="visual-compare-summary" :class="{ identical: visualCompareReport.identical, changed: visualCompareReport.status === 'compared' && !visualCompareReport.identical }">
            <IconCheck v-if="visualCompareReport.status === 'compared' && visualCompareReport.identical" aria-hidden="true" />
            <IconDifference v-else aria-hidden="true" />
            <div>
              <strong v-if="visualCompareReport.status === 'baseline'">{{ t('visualCompare.baselineReady') }}</strong>
              <strong v-else-if="visualCompareReport.identical">{{ t('visualCompare.identical') }}</strong>
              <strong v-else>{{ t('visualCompare.changed', { percent: localPercent(visualCompareReport.changedPercent ?? 0, 2) }) }}</strong>
              <span v-if="visualCompareReport.baseline">{{ visualCompareReport.baseline.width }}×{{ visualCompareReport.baseline.height }} · {{ debugTimestamp(visualCompareReport.baseline.capturedAt) }}</span>
            </div>
          </div>
          <img
            v-if="visualCompareReport.status === 'compared' && visualCompareReport.diffPngDataUrl"
            class="visual-compare-image"
            :src="visualCompareReport.diffPngDataUrl"
            :alt="t('visualCompare.diffAlt')"
          />
          <dl v-if="visualCompareReport.status === 'compared'" class="visual-compare-metrics">
            <div><dt>{{ t('visualCompare.changedPixels') }}</dt><dd>{{ visualCompareReport.changedPixels === undefined ? '—' : localNumber(visualCompareReport.changedPixels) }}</dd></div>
            <div><dt>{{ t('visualCompare.totalPixels') }}</dt><dd>{{ visualCompareReport.totalPixels === undefined ? '—' : localNumber(visualCompareReport.totalPixels) }}</dd></div>
            <div><dt>{{ t('visualCompare.threshold') }}</dt><dd>{{ localNumber(visualCompareReport.threshold) }} / 255</dd></div>
            <div><dt>{{ t('visualCompare.changedArea') }}</dt><dd>{{ visualCompareReport.diffBounds ? `${localNumber(visualCompareReport.diffBounds.x)}, ${localNumber(visualCompareReport.diffBounds.y)} · ${localNumber(visualCompareReport.diffBounds.width)}×${localNumber(visualCompareReport.diffBounds.height)}` : t('visualCompare.none') }}</dd></div>
          </dl>
          <details class="debug-report-caveats">
            <summary>{{ t('visualCompare.accuracy') }}</summary>
            <ul>
              <li>{{ t('visualCompare.caveats.viewport') }}</li>
              <li>{{ t('visualCompare.caveats.threshold', { threshold: localNumber(visualCompareReport.threshold) }) }}</li>
              <li>{{ t('visualCompare.caveats.environment') }}</li>
              <li>{{ t('visualCompare.caveats.memory') }}</li>
              <li v-if="visualCompareReport.baseline && visualCompareReport.current && visualCompareReport.baseline.url !== visualCompareReport.current.url">{{ t('visualCompare.caveats.navigation') }}</li>
            </ul>
          </details>
        </div>
        <footer v-if="visualCompareReport.status !== 'empty'">
          <span>{{ t('visualCompare.storage') }}</span>
          <div class="debug-report-actions">
            <button type="button" @click="manageVisualCompare('clear')"><IconDelete aria-hidden="true" /> {{ t('visualCompare.clear') }}</button>
            <button type="button" @click="manageVisualCompare('set-baseline')"><IconScreenshotRegion aria-hidden="true" /> {{ t('visualCompare.newBaseline') }}</button>
            <button class="primary" type="button" @click="manageVisualCompare('compare')"><IconDifference aria-hidden="true" /> {{ t('visualCompare.compare') }}</button>
            <button v-if="visualCompareReport.status === 'compared'" type="button" @click="copyVisualDiff">
              <IconCheck v-if="visualCompareCopied" aria-hidden="true" />
              <IconDifference v-else aria-hidden="true" />
              {{ visualCompareCopied ? t('visualCompare.copied') : t('visualCompare.copy') }}
            </button>
          </div>
        </footer>
      </template>
    </section>
</template>
