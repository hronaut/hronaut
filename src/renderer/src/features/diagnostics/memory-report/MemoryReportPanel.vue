<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconMemory from '~icons/material-symbols/memory-rounded'
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
import PanelDockPicker from '../../panels/PanelDockPicker.vue'
import { vTooltip } from '../../../ui/tooltip.js'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
  keepsSeparatePanelOpen: () => boolean
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  memoryState,
  memoryReport,
  memoryError,
  memoryPanelOpen,
  runMemoryReport,
  clearMemoryBaseline,
  manageMemoryAllocation
} = props.controller

// Docked back from its window after the page changed, the panel has nothing to show: the main window cleared its report
// for the new page while it was away. It runs again for the page shown now, as its window did. The panel window itself
// is closing then.
watch(dock, (next, previous) => {
  if (memoryPanelOpen.value && previous === 'window' && next !== 'window' && !props.keepsSeparatePanelOpen() && memoryState.value === 'idle' && !memoryReport.value) void runMemoryReport()
})

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localPercent(value: number, maximumFractionDigits = 1): string {
  return formatPercent(props.locale, value / 100, { maximumFractionDigits })
}

function formatBytes(value: number): string {
  return formatLocalizedBytes(props.locale, value)
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
</script>

<template>
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('memory.close')" @click="memoryPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="runMemoryReport()">{{ t('memory.tryAgain') }}</UiButton>
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
            <UiButton appearance="application"
              v-if="memoryReport.allocationProfile"
              type="button"
              @click="manageMemoryAllocation('clear')"
            ><IconDelete aria-hidden="true" /> {{ t('memory.allocation.clear') }}</UiButton>
          </div>
          <div v-if="memoryReport.allocationStatus === 'recording'" class="coverage-recording memory-allocation-recording" role="status">
            <IconRecord aria-hidden="true" />
            <strong>{{ t('memory.allocation.recording') }}</strong>
            <span>{{ t('memory.allocation.recordingDescription') }}</span>
            <small>{{ t('memory.allocation.started', { time: debugTimestamp(memoryReport.allocationRecording?.startedAt || '') }) }}</small>
            <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageMemoryAllocation('stop')"><IconStop aria-hidden="true" /> {{ t('memory.allocation.stop') }}</UiButton>
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
                  <small v-if="hotspot.url" v-tooltip="hotspot.url">{{ hotspot.url }}<template v-if="hotspot.lineNumber">:{{ hotspot.lineNumber }}</template></small>
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
              <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageMemoryAllocation('start')"><IconRecord aria-hidden="true" /> {{ t('memory.allocation.recordAgain') }}</UiButton>
            </div>
          </template>
          <div v-else class="memory-allocation-empty">
            <IconMemory aria-hidden="true" />
            <div>
              <strong>{{ t('memory.allocation.emptyHeading') }}</strong>
              <span>{{ t('memory.allocation.emptyDescription') }}</span>
            </div>
            <UiButton appearance="application" variant="primary" class="primary" type="button" @click="manageMemoryAllocation('start')"><IconRecord aria-hidden="true" /> {{ t('memory.allocation.start') }}</UiButton>
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
        <UiButton appearance="application" v-if="memoryReport?.baseline" type="button" @click="clearMemoryBaseline"><IconDelete aria-hidden="true" /> {{ t('memory.clear') }}</UiButton>
        <UiButton appearance="application" type="button" @click="runMemoryReport('set-baseline', true)"><IconKeep aria-hidden="true" /> {{ t('memory.setBaseline') }}</UiButton>
        <UiButton appearance="application" type="button" @click="runMemoryReport('measure', true)"><IconRefresh aria-hidden="true" /> {{ t('memory.gcMeasure') }}</UiButton>
      </div>
    </footer>
  </section>
</template>
