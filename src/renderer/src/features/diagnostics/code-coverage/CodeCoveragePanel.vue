<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCode from '~icons/material-symbols/code-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconPlay from '~icons/material-symbols/play-arrow-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import {
  formatBytes as formatLocalizedBytes,
  formatNumber,
  formatPercent
} from '../../../../../shared/format'
import type { PanelDock, SupportedLocale } from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'
import { vTooltip } from '../../../ui/tooltip.js'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  coveragePanelOpen,
  coverageResult,
  coverageState,
  coverageError,
  coverageMode,
  manageCodeCoverage
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localPercent(value: number, maximumFractionDigits = 1): string {
  return formatPercent(props.locale, value / 100, { maximumFractionDigits })
}

function formatBytes(value: number): string {
  return formatLocalizedBytes(props.locale, value)
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('coverage.close')" @click="coveragePanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="manageCodeCoverage('get')">{{ t('coverage.tryAgain') }}</UiButton>
    </div>
    <div v-else-if="coverageResult?.status === 'recording'" class="coverage-recording" role="status">
      <IconRecord aria-hidden="true" />
      <strong>{{ t('coverage.recording') }}</strong>
      <span>{{ t('coverage.recordingDescription') }}</span>
      <small>{{ t('coverage.recordingMeta', { mode: coverageResult.recording?.mode ?? '', time: debugTimestamp(coverageResult.recording?.startedAt || '') }) }}</small>
      <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageCodeCoverage('stop')"><IconStop aria-hidden="true" /> {{ t('coverage.stop') }}</UiButton>
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
            <strong v-tooltip="resource.url">{{ resource.url }}</strong>
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
          <UiButton appearance="application" type="button" @click="manageCodeCoverage('clear')"><IconDelete aria-hidden="true" /> {{ t('coverage.clear') }}</UiButton>
          <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageCodeCoverage('start', true)"><IconRefresh aria-hidden="true" /> {{ t('coverage.recordAgain') }}</UiButton>
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
        <UiButton appearance="application" type="button" @click="manageCodeCoverage('start', false)"><IconPlay aria-hidden="true" /> {{ t('coverage.startNow') }}</UiButton>
        <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageCodeCoverage('start', true)"><IconRefresh aria-hidden="true" /> {{ t('coverage.startReload') }}</UiButton>
      </div>
    </div>
  </section>
</template>
