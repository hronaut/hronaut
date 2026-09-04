<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDifference from '~icons/material-symbols/difference-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { formatBytes, formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import type { BrowserStorageChange, BrowserStorageChangesAction, BrowserStorageChangesReport, BrowserStorageKind } from '../../../shared/types'

const props = defineProps<{
  state: 'idle' | 'loading' | 'ready' | 'error'
  report: BrowserStorageChangesReport | null
  error: string
  copied: boolean
  locale: SupportedLocale
}>()

const emit = defineEmits<{
  manage: [action: BrowserStorageChangesAction]
  inspect: [change: BrowserStorageChange]
  copy: []
}>()
const { t } = useI18n({ useScope: 'global' })

function bytes(value: number): string { return formatBytes(props.locale, value) }
function localNumber(value: number): string { return formatNumber(props.locale, value) }
function timestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(props.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }).format(date)
}
function kindLabel(kind: BrowserStorageKind): string {
  if (kind === 'local-storage') return t('runtime.storage.local')
  if (kind === 'session-storage') return t('runtime.storage.session')
  return t('runtime.storage.cookie')
}
</script>

<template>
  <section class="storage-changes-view" :aria-busy="state === 'loading'">
    <div v-if="state === 'loading' && !report" class="site-storage-empty"><IconProgress class="state-spinner" aria-hidden="true" /><strong>{{ t('siteStorage.trackedChanges.reading') }}</strong></div>
    <div v-else-if="state === 'error'" class="storage-changes-error" role="alert"><IconError aria-hidden="true" /><strong>{{ t('siteStorage.trackedChanges.attention') }}</strong><span>{{ error }}</span></div>
    <template v-else-if="report">
      <div v-if="report.status === 'empty'" class="site-storage-empty storage-changes-empty">
        <IconDifference aria-hidden="true" /><strong>{{ t('siteStorage.trackedChanges.empty') }}</strong><span>{{ t('siteStorage.trackedChanges.emptyDescription') }}</span>
        <UiButton native class="primary" type="button" @click="emit('manage', 'baseline')"><IconDifference aria-hidden="true" /> {{ t('siteStorage.trackedChanges.setBaseline') }}</UiButton>
      </div>
      <template v-else>
        <div class="storage-changes-summary" :class="{ changed: report.status === 'compared' && report.changeCount, identical: report.status === 'compared' && !report.changeCount }">
          <IconDifference v-if="report.status === 'baseline'" aria-hidden="true" /><IconCheck v-else-if="!report.changeCount" aria-hidden="true" /><IconWarning v-else aria-hidden="true" />
          <div><strong v-if="report.status === 'baseline'">{{ t('siteStorage.trackedChanges.baselineReady') }}</strong><strong v-else-if="!report.changeCount">{{ t('siteStorage.trackedChanges.noChanges') }}</strong><strong v-else>{{ t('siteStorage.trackedChanges.changeCount', { count: localNumber(report.changeCount) }, report.changeCount) }}</strong><span>{{ report.status === 'baseline' ? t('siteStorage.trackedChanges.useThenCompare') : t('siteStorage.trackedChanges.counts', { added: localNumber(report.counts.added), updated: localNumber(report.counts.updated), removed: localNumber(report.counts.removed) }) }}</span></div>
        </div>
        <div v-if="report.status === 'compared' && report.changes.length" class="storage-changes-list">
          <UiButton native v-for="(change, index) in report.changes" :key="`${change.kind}-${change.key}-${change.domain ?? ''}-${change.path ?? ''}-${index}`" type="button" class="storage-change" :class="change.type" @click="emit('inspect', change)">
            <span class="storage-change-type">{{ change.type }}</span><span class="storage-change-copy"><strong>{{ change.key }}</strong><small>{{ kindLabel(change.kind) }}<template v-if="change.domain"> · {{ change.domain }}{{ change.path }}</template><template v-if="change.protected"> {{ t('siteStorage.trackedChanges.httpOnly') }}</template><template v-if="change.attributesChanged"> {{ t('siteStorage.trackedChanges.attributesChanged') }}</template></small></span><span class="storage-change-bytes">{{ change.beforeValueBytes === undefined ? '—' : bytes(change.beforeValueBytes) }} → {{ change.afterValueBytes === undefined ? '—' : bytes(change.afterValueBytes) }}</span>
          </UiButton>
        </div>
        <p v-if="report.truncated" class="storage-changes-note"><IconInfo aria-hidden="true" /> {{ t('siteStorage.trackedChanges.truncated') }}</p>
        <details class="storage-changes-caveats"><summary>{{ t('siteStorage.scopePrivacy') }}</summary><ul><li v-for="caveat in report.caveats" :key="caveat">{{ caveat }}</li></ul></details>
        <footer class="storage-changes-footer">
          <span>{{ t('siteStorage.trackedChanges.baseline', { time: report.baselineAt ? timestamp(report.baselineAt) : t('siteStorage.trackedChanges.notSet') }) }}</span>
          <div><UiButton native type="button" @click="emit('manage', 'clear')"><IconDelete aria-hidden="true" /> {{ t('siteStorage.trackedChanges.clear') }}</UiButton><UiButton native type="button" @click="emit('manage', 'baseline')"><IconRefresh aria-hidden="true" /> {{ t('siteStorage.trackedChanges.newBaseline') }}</UiButton><UiButton native v-if="report.status === 'compared'" type="button" @click="emit('copy')"><IconCheck v-if="copied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" /> {{ copied ? t('siteStorage.copied') : t('siteStorage.trackedChanges.copy') }}</UiButton><UiButton native class="primary" type="button" :disabled="state === 'loading'" @click="emit('manage', 'compare')"><IconDifference aria-hidden="true" /> {{ t('siteStorage.trackedChanges.compare') }}</UiButton></div>
        </footer>
      </template>
    </template>
  </section>
</template>
