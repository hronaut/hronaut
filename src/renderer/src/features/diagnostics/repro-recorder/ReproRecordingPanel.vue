<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconBugReport from '~icons/material-symbols/bug-report-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCode from '~icons/material-symbols/code-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import { formatNumber } from '../../../../../shared/format'
import type { PanelDock, SupportedLocale } from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'
import ReproTimeline from './ReproTimeline.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  reproPanelOpen,
  reproRecording,
  reproState,
  reproError,
  reproCopied,
  reproPlaywrightCopied,
  manageRepro,
  startReproRecording,
  stopReproRecording,
  clearReproRecording,
  copyReproRecording,
  copyReproPlaywright
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}
</script>

<template>
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('repro.close')" @click="reproPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="manageRepro('get')">{{ t('repro.tryAgain') }}</UiButton>
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
        <UiButton appearance="application" variant="primary" class="primary" type="button" :disabled="reproState === 'loading'" @click="startReproRecording"><IconRecord aria-hidden="true" /> {{ t('repro.start') }}</UiButton>
      </div>
      <div v-else class="repro-timeline" :aria-label="t('repro.timelineAria')">
        <ReproTimeline :recording="reproRecording" :locale="locale" :busy="reproState === 'loading'" @checkpoint="manageRepro('checkpoint', $event)" />
        <p v-if="reproRecording.truncated" class="inspector-issues-truncated"><IconInfo aria-hidden="true" /> {{ t('repro.truncated') }}</p>
        <details class="debug-report-caveats">
          <summary>{{ t('repro.privacyScope') }}</summary>
          <ul><li>{{ t('repro.caveats.values') }}</li><li>{{ t('repro.caveats.selectors') }}</li><li>{{ t('repro.caveats.scope') }}</li><li>{{ t('repro.caveats.bounded') }}</li></ul>
        </details>
      </div>
      <footer>
        <span>{{ t('repro.stepCount', { count: localNumber(reproRecording.stepCount) }, reproRecording.stepCount) }} {{ t('repro.review') }}</span>
        <div class="debug-report-actions">
          <UiButton appearance="application" type="button" :disabled="reproState === 'loading' || !reproRecording.stepCount" @click="clearReproRecording"><IconDelete aria-hidden="true" /> {{ t('repro.clear') }}</UiButton>
          <UiButton appearance="application" variant="primary" v-if="reproRecording.active" class="primary" type="button" :disabled="reproState === 'loading'" @click="stopReproRecording"><IconStop aria-hidden="true" /> {{ t('repro.stop') }}</UiButton>
          <UiButton appearance="application" v-else-if="reproRecording.stepCount" type="button" :disabled="reproState === 'loading'" @click="startReproRecording"><IconRecord aria-hidden="true" /> {{ t('repro.recordAgain') }}</UiButton>
          <UiButton appearance="application" v-if="reproRecording.stepCount && !reproRecording.active" type="button" @click="copyReproRecording">
            <IconCheck v-if="reproCopied" aria-hidden="true" />
            <IconBugReport v-else aria-hidden="true" />
            {{ reproCopied ? t('repro.copied') : t('repro.copyTimeline') }}
          </UiButton>
          <UiButton appearance="application" variant="primary" v-if="reproRecording.stepCount && !reproRecording.active" class="primary" type="button" @click="copyReproPlaywright">
            <IconCheck v-if="reproPlaywrightCopied" aria-hidden="true" />
            <IconCode v-else aria-hidden="true" />
            {{ reproPlaywrightCopied ? t('repro.copiedPlaywright') : t('repro.copyPlaywright') }}
          </UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
