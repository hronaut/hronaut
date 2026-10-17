<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDifference from '~icons/material-symbols/difference-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconScreenshotRegion from '~icons/material-symbols/screenshot-region-rounded'
import { formatNumber, formatPercent } from '../../../shared/format'
import type { PanelDock, SupportedLocale } from '../../../shared/types'
import type { DiagnosticsController } from '../composables/useDiagnosticsController'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  visualComparePanelOpen,
  visualCompareReport,
  visualCompareState,
  visualCompareError,
  visualCompareCopied,
  manageVisualCompare,
  copyVisualDiff
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localPercent(value: number, maximumFractionDigits = 1): string {
  return formatPercent(props.locale, value / 100, { maximumFractionDigits })
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
</script>

<template>
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('visualCompare.close')" @click="visualComparePanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="manageVisualCompare('get')">{{ t('visualCompare.returnBaseline') }}</UiButton>
    </div>
    <template v-else-if="visualCompareReport">
      <div v-if="visualCompareReport.status === 'empty'" class="accessibility-audit-empty debug-report-empty">
        <IconDifference aria-hidden="true" />
        <strong>{{ t('visualCompare.empty') }}</strong>
        <span>{{ t('visualCompare.emptyDescription') }}</span>
        <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageVisualCompare('set-baseline')"><IconScreenshotRegion aria-hidden="true" /> {{ t('visualCompare.setBaseline') }}</UiButton>
      </div>
      <div v-else class="visual-compare-content">
        <div class="visual-compare-summary" :class="{ identical: visualCompareReport.identical, changed: visualCompareReport.status === 'compared' && !visualCompareReport.identical }">
          <IconCheck v-if="visualCompareReport.status === 'compared' && visualCompareReport.identical" aria-hidden="true" />
          <IconDifference v-else aria-hidden="true" />
          <div>
            <strong v-if="visualCompareReport.status === 'baseline'">{{ t('visualCompare.baselineReady') }}</strong>
            <strong v-else-if="visualCompareReport.identical">{{ t('visualCompare.identical') }}</strong>
            <strong v-else>{{ t('visualCompare.changed', { percent: localPercent(visualCompareReport.changedPercent ?? 0, 2) }) }}</strong>
            <span v-if="visualCompareReport.scope?.kind === 'region'">{{ t('visualCompare.region', visualCompareReport.scope.clip) }}</span>
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
            <li v-if="visualCompareReport.scope?.kind === 'region'">{{ t('visualCompare.regionPrivacy') }}</li>
            <li v-else>{{ t('visualCompare.caveats.viewport') }}</li>
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
          <UiButton appearance="application" type="button" @click="manageVisualCompare('clear')"><IconDelete aria-hidden="true" /> {{ t('visualCompare.clear') }}</UiButton>
          <UiButton appearance="application" type="button" @click="manageVisualCompare('set-baseline')"><IconScreenshotRegion aria-hidden="true" /> {{ t(visualCompareReport.scope?.kind === 'region' ? 'visualCompare.newViewportBaseline' : 'visualCompare.newBaseline') }}</UiButton>
          <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageVisualCompare('compare')"><IconDifference aria-hidden="true" /> {{ t('visualCompare.compare') }}</UiButton>
          <UiButton appearance="application" v-if="visualCompareReport.status === 'compared'" type="button" @click="copyVisualDiff">
            <IconCheck v-if="visualCompareCopied" aria-hidden="true" />
            <IconDifference v-else aria-hidden="true" />
            {{ visualCompareCopied ? t('visualCompare.copied') : t('visualCompare.copy') }}
          </UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
