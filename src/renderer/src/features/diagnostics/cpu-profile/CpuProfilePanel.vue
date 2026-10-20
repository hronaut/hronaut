<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconMonitoring from '~icons/material-symbols/monitoring-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import {
  formatDuration,
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
  keepsSeparatePanelOpen: () => boolean
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  cpuProfilePanelOpen,
  cpuProfileResult,
  cpuProfileState,
  cpuProfileError,
  manageCpuProfile
} = props.controller

// Docked back from its window, the panel was open all along, so it reads the tab's profile again instead of showing what it
// had before it left. The panel window itself is closing then, and a request still running answers for itself.
watch(dock, (next, previous) => {
  if (cpuProfilePanelOpen.value && previous === 'window' && next !== 'window' && !props.keepsSeparatePanelOpen() && cpuProfileState.value !== 'loading') void manageCpuProfile('get')
})

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localPercent(value: number, maximumFractionDigits = 1): string {
  return formatPercent(props.locale, value / 100, { maximumFractionDigits })
}

function localDuration(value: number): string {
  return formatDuration(props.locale, value)
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('cpuProfile.close')" @click="cpuProfilePanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="manageCpuProfile('get')">{{ t('cpuProfile.tryAgain') }}</UiButton>
    </div>
    <div v-else-if="cpuProfileResult?.status === 'recording'" class="coverage-recording" role="status">
      <IconRecord aria-hidden="true" />
      <strong>{{ t('cpuProfile.recording') }}</strong>
      <span>{{ t('cpuProfile.recordingDescription') }}</span>
      <small>{{ t('cpuProfile.started', { time: debugTimestamp(cpuProfileResult.recording?.startedAt || '') }) }}</small>
      <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageCpuProfile('stop')"><IconStop aria-hidden="true" /> {{ t('cpuProfile.stop') }}</UiButton>
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
            <small v-if="hotspot.url" v-tooltip="hotspot.url">{{ hotspot.url }}<template v-if="hotspot.lineNumber">:{{ hotspot.lineNumber }}</template></small>
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
        <span>{{ t('cpuProfile.startedOn', { url: cpuProfileResult.report.startedUrl }) }}<span v-if="cpuProfileResult.report.currentUrl !== cpuProfileResult.report.startedUrl">{{ ' ' + t('cpuProfile.pageChanged') }}</span></span>
        <div>
          <UiButton appearance="application" type="button" @click="manageCpuProfile('clear')"><IconDelete aria-hidden="true" /> {{ t('cpuProfile.clear') }}</UiButton>
          <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageCpuProfile('start')"><IconRecord aria-hidden="true" /> {{ t('cpuProfile.recordAgain') }}</UiButton>
        </div>
      </footer>
    </template>
    <div v-else class="coverage-empty">
      <IconMonitoring aria-hidden="true" />
      <strong>{{ t('cpuProfile.emptyHeading') }}</strong>
      <span>{{ t('cpuProfile.emptyDescription') }}</span>
      <div>
        <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageCpuProfile('start')"><IconRecord aria-hidden="true" /> {{ t('cpuProfile.start') }}</UiButton>
      </div>
    </div>
  </section>
</template>
