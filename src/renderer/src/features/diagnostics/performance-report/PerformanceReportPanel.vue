<script setup lang="ts">
import { computed, watch } from 'vue'
import UiButton from "../../../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDifference from '~icons/material-symbols/difference-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import {
  formatBytes as formatLocalizedBytes,
  formatDateTime,
  formatDuration,
  formatNumber
} from '../../../../../shared/format'
import { PERFORMANCE_COMPARISON_CAVEATS, PERFORMANCE_REPORT_CAVEATS } from '../../../../../shared/performance-audit'
import type {
  BrowserPerformanceComparisonMetric,
  BrowserPerformanceComparisonMetricName,
  BrowserPerformanceMetric,
  BrowserPerformanceMetricName,
  BrowserPerformanceScriptContributor,
  PanelDock,
  SupportedLocale
} from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
  keepsSeparatePanelOpen: () => boolean
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  performanceState,
  performanceReport,
  performanceError,
  performancePanelOpen,
  runPerformanceReport
} = props.controller

// Docked back from its window after the page changed, the panel has nothing to show: the main window cleared its report
// for the new page while it was away. It runs again for the page shown now, as its window did. The panel window itself
// is closing then.
watch(dock, (next, previous) => {
  if (performancePanelOpen.value && previous === 'window' && next !== 'window' && !props.keepsSeparatePanelOpen() && performanceState.value === 'idle' && !performanceReport.value) void runPerformanceReport()
})

// The report states its caveats in English for agents and copies; one Hronaut does not know shows as recorded.
const CAVEAT_KEYS = new Map(Object.entries({ ...PERFORMANCE_REPORT_CAVEATS, ...PERFORMANCE_COMPARISON_CAVEATS }).map(([key, value]) => [value as string, key]))
function caveatText(caveat: string): string {
  const key = CAVEAT_KEYS.get(caveat)
  return key ? t(`reportCaveats.performance.${key}`) : caveat
}

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localDuration(value: number): string {
  return formatDuration(props.locale, value)
}

function formatBytes(value: number): string {
  return formatLocalizedBytes(props.locale, value)
}

const lcpAttribution = computed(() => performanceReport.value?.metrics.LCP?.lcpAttribution)

function performanceMetric(name: BrowserPerformanceMetricName): BrowserPerformanceMetric | null {
  return performanceReport.value?.metrics[name] ?? null
}

function formatPerformanceMetric(metric: Pick<BrowserPerformanceMetric, 'value' | 'unit'> | null): string {
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

// Chromium's long-animation-frame script invoker types; another value shows as Chromium names it.
const SCRIPT_INVOKER_TYPES = new Set(['user-callback', 'event-listener', 'resolve-promise', 'reject-promise', 'classic-script', 'module-script'])

function performanceInvokerLabel(invokerType: string): string {
  return SCRIPT_INVOKER_TYPES.has(invokerType) ? t(`performance.invokers.${invokerType}`) : invokerType
}

function performanceContributorTitle(contributor: BrowserPerformanceScriptContributor): string {
  return contributor.sourceFunctionName || contributor.invoker || t('runtimeDetails.performance.anonymous')
}

function performanceContributorSource(contributor: BrowserPerformanceScriptContributor): string {
  if (!contributor.sourceUrl) return contributor.invokerType ? performanceInvokerLabel(contributor.invokerType) : t('runtimeDetails.performance.unavailable')
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
</script>

<template>
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('performance.close')" @click="performancePanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="runPerformanceReport()">{{ t('common.tryAgain') }}</UiButton>
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
            <span>{{ performanceMetric(name) ? t(`performance.ratings.${performanceMetric(name)?.rating}`) : t('performance.notObserved') }}</span>
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
        <section v-if="performanceReport.softNavigations" data-testid="soft-navigation-vitals">
          <h3>{{ t('softNavigation.heading') }}</h3>
          <p class="performance-attribution-note">{{ t(`softNavigation.${performanceReport.softNavigations.status}`) }}</p>
          <template v-if="performanceReport.softNavigations.status !== 'unsupported'">
            <p class="performance-attribution-note">{{ t('softNavigation.started', { time: localDuration(performanceReport.softNavigations.collectionStartTimeMs) }) }}</p>
            <article v-for="route in performanceReport.softNavigations.navigations" :key="route.navigationId">
              <p class="performance-lcp-source">{{ t('softNavigation.identity', { url: route.url, id: route.navigationId, time: localDuration(route.startTimeMs) }) }}</p>
              <p v-if="route.coverage === 'incomplete'" class="performance-attribution-note">{{ t('softNavigation.incomplete') }}</p>
              <dl>
                <div v-for="name in (['LCP', 'INP', 'CLS'] as const)" :key="name">
                  <dt>{{ name }}</dt><dd>{{ formatPerformanceMetric(route.metrics[name]) }}</dd>
                </div>
              </dl>
            </article>
            <p class="performance-attribution-note">{{ t('softNavigation.note') }}</p>
          </template>
        </section>
        <section v-if="lcpAttribution" data-testid="lcp-attribution">
          <h3>{{ t('lcpAttribution.heading') }}</h3>
          <p class="performance-attribution-note">{{ t(`lcpAttribution.${lcpAttribution.status}`) }}</p>
          <p v-if="lcpAttribution.reason" class="performance-attribution-note">{{ t(`lcpAttribution.${lcpAttribution.reason}`) }}</p>
          <dl>
            <div><dt>{{ t('lcpAttribution.ttfb') }}</dt><dd>{{ lcpAttribution.timeToFirstByteMs == null ? t('performance.unavailable') : localDuration(lcpAttribution.timeToFirstByteMs) }}</dd></div>
            <div><dt>{{ t('lcpAttribution.discovery') }}</dt><dd>{{ lcpAttribution.resourceLoadDelayMs == null ? t('performance.unavailable') : localDuration(lcpAttribution.resourceLoadDelayMs) }}</dd></div>
            <div><dt>{{ t('lcpAttribution.transfer') }}</dt><dd>{{ lcpAttribution.resourceLoadDurationMs == null ? t('performance.unavailable') : localDuration(lcpAttribution.resourceLoadDurationMs) }}</dd></div>
            <div><dt>{{ t('lcpAttribution.render') }}</dt><dd>{{ lcpAttribution.elementRenderDelayMs == null ? t('performance.unavailable') : localDuration(lcpAttribution.elementRenderDelayMs) }}</dd></div>
          </dl>
          <p v-if="lcpAttribution.resourceTiming === 'not-applicable'" class="performance-attribution-note">{{ t('lcpAttribution.text') }}</p>
          <p v-if="lcpAttribution.target" class="performance-lcp-source"><code>{{ lcpAttribution.target }}</code></p>
          <p v-if="lcpAttribution.resourceUrl" class="performance-lcp-source">{{ lcpAttribution.resourceUrl }}</p>
          <p class="performance-attribution-note">{{ t('lcpAttribution.note') }}</p>
        </section>
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
                <span><strong>{{ performanceContributorTitle(contributor) }}</strong><small>{{ performanceContributorSource(contributor) }} · {{ localNumber(contributor.count) }} {{ t('performance.frames', contributor.count) }}</small></span>
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
                <span><strong>{{ entry.sources[0] || t('performance.affectedUnavailable') }}</strong><small>{{ localNumber(Math.round(entry.startTimeMs)) }} {{ t('performance.afterNavigation') }}<span v-if="entry.sources.length > 1"> · {{ localNumber(entry.sources.length) }} {{ t('performance.affectedElements', entry.sources.length) }}</span></small></span>
                <output>{{ formatNumber(locale, entry.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) }}</output>
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
                <span><strong>{{ entry.name }}</strong><small>{{ entry.type === 'measure' ? t('performance.measure') : t('performance.mark') }} · {{ localNumber(Math.round(entry.startTimeMs)) }} {{ t('performance.afterNavigation') }}</small></span>
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
            <li v-for="caveat in performanceReport.caveats" :key="caveat">{{ caveatText(caveat) }}</li>
          </ul>
        </details>
      </div>
      <footer>
        <span>{{ performanceReport.engine.name }} {{ performanceReport.engine.version }} {{ t('performance.localSample') }}</span>
        <div>
          <UiButton appearance="application" v-if="performanceReport.baseline" type="button" @click="runPerformanceReport('clear-baseline')">{{ t('performance.clearBaseline') }}</UiButton>
          <UiButton appearance="application" type="button" @click="runPerformanceReport('set-baseline')"><IconDifference aria-hidden="true" /> {{ performanceReport.baseline ? t('performance.replaceBaseline') : t('performance.saveBaseline') }}</UiButton>
          <UiButton appearance="application" type="button" @click="runPerformanceReport('measure')"><IconRefresh aria-hidden="true" /> {{ t('performance.measureAgain') }}</UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
