<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconAccountTree from '~icons/material-symbols/account-tree-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import { formatDuration, formatNumber } from '../../../../../shared/format'
import type {
  BrowserDomChangeEntry,
  PanelDock,
  SupportedLocale
} from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  domChangesPanelOpen,
  domChangesReport,
  domChangesState,
  domChangesError,
  domChangesCopied,
  manageDomChanges,
  copyDomChanges
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localDuration(value: number): string {
  return formatDuration(props.locale, value)
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
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('domChanges.close')" @click="domChangesPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
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
      <UiButton appearance="application" type="button" @click="manageDomChanges('get')">{{ t('domChanges.tryAgain') }}</UiButton>
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
        <UiButton appearance="application" variant="primary" class="primary" type="button" :disabled="domChangesState === 'loading'" @click="manageDomChanges('start')"><IconRecord aria-hidden="true" /> {{ t('domChanges.start') }}</UiButton>
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
          <UiButton appearance="application" type="button" :disabled="domChangesState === 'loading' || !domChangesReport.startedAt" @click="manageDomChanges('clear')"><IconDelete aria-hidden="true" /> {{ t('domChanges.clear') }}</UiButton>
          <UiButton appearance="application" variant="primary" v-if="domChangesReport.active" class="primary" type="button" :disabled="domChangesState === 'loading'" @click="manageDomChanges('stop')"><IconStop aria-hidden="true" /> {{ t('domChanges.stop') }}</UiButton>
          <UiButton appearance="application" v-else-if="domChangesReport.startedAt" type="button" :disabled="domChangesState === 'loading'" @click="manageDomChanges('start')"><IconRecord aria-hidden="true" /> {{ t('domChanges.recordAgain') }}</UiButton>
          <UiButton appearance="application" variant="primary" v-if="domChangesReport.entries.length && !domChangesReport.active" class="primary" type="button" @click="copyDomChanges">
            <IconCheck v-if="domChangesCopied" aria-hidden="true" />
            <IconAccountTree v-else aria-hidden="true" />
            {{ domChangesCopied ? t('domChanges.copied') : t('domChanges.copy') }}
          </UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
