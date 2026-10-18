<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconBugReport from '~icons/material-symbols/bug-report-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import {
  formatBytes as formatLocalizedBytes,
  formatDuration,
  formatNumber
} from '../../../shared/format'
import type {
  BrowserDebugReport,
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../shared/types'
import type { DiagnosticsController } from '../composables/useDiagnosticsController'
import PanelDockPicker from './PanelDockPicker.vue'
import IncidentPackageReview from './IncidentPackageReview.vue'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  controller: DiagnosticsController
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  debugReportState,
  debugReport,
  debugReportError,
  debugReportPanelOpen,
  debugReportCopied,
  runDebugReport,
  copyDebugReport
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localDuration(value: number): string {
  return formatDuration(props.locale, value)
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

function debugRequestStatus(request: BrowserDebugReport['network'][number]): string {
  if (request.error) return request.error
  if (request.status !== undefined) return String(request.status)
  return request.completedAt ? t('runtime.network.complete') : t('runtime.network.pending')
}
</script>

<template>
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('debugReport.close')" @click="debugReportPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <IncidentPackageReview v-if="activeTab" :key="`${activeTab.id}:${activeTab.navigationGeneration}:${activeTab.observationGeneration ?? 0}`" :tab-id="activeTab.id" />
    <div v-if="debugReportState === 'running'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('debugReport.loading') }}</strong>
      <span>{{ t('debugReport.privacy') }}</span>
    </div>
    <div v-else-if="debugReportState === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" />
      <strong>{{ t('debugReport.failed') }}</strong>
      <span>{{ debugReportError }}</span>
      <UiButton appearance="application" type="button" @click="runDebugReport">{{ t('debugReport.tryAgain') }}</UiButton>
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
          <label class="preserve-logs-toggle" v-tooltip="t('debugReport.preserveTitle')">
            <input type="checkbox" :checked="activeTab?.preserveDiagnosticLogs" :disabled="preservationBusy" @change="updatePreservation" />
            {{ t('debugReport.preserve') }}
          </label>
        </div>
        <div class="debug-report-actions">
          <UiButton appearance="application" type="button" @click="runDebugReport"><IconRefresh aria-hidden="true" /> {{ t('debugReport.refresh') }}</UiButton>
          <UiButton appearance="application" variant="primary" type="button" class="primary" @click="copyDebugReport">
            <IconCheck v-if="debugReportCopied" aria-hidden="true" />
            <IconBugReport v-else aria-hidden="true" />
            {{ debugReportCopied ? t('debugReport.copied') : t('debugReport.copy') }}
          </UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
