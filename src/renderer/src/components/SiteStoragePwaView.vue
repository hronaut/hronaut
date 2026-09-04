<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded'
import IconArrowForward from '~icons/material-symbols/arrow-forward-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconDashboard from '~icons/material-symbols/space-dashboard-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconOffline from '~icons/material-symbols/offline-bolt-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import type { BrowserPwaReport } from '../../../shared/types'

const props = defineProps<{
  state: 'idle' | 'loading' | 'ready' | 'error'
  report: BrowserPwaReport | null
  error: string
  copied: boolean
  offset: number
  locale: SupportedLocale
}>()

const emit = defineEmits<{
  copy: []
  cacheChange: []
  filter: []
  move: [direction: -1 | 1]
}>()

const cache = defineModel<string>('cache', { required: true })
const query = defineModel<string>('query', { required: true })
const { t } = useI18n({ useScope: 'global' })

function localNumber(value: number): string { return formatNumber(props.locale, value) }
function timestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(props.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }).format(date)
}
</script>

<template>
  <section class="pwa-view" :aria-busy="state === 'loading'">
    <div v-if="state === 'loading' && !report" class="site-storage-empty"><IconProgress class="state-spinner" aria-hidden="true" /><strong>{{ t('siteStorage.pwa.reading') }}</strong></div>
    <div v-else-if="state === 'error'" class="storage-changes-error" role="alert"><IconError aria-hidden="true" /><strong>{{ t('siteStorage.pwa.attention') }}</strong><span>{{ error }}</span></div>
    <template v-else-if="report">
      <div class="pwa-summary">
        <IconOffline aria-hidden="true" />
        <div><strong>{{ report.controlled ? t('siteStorage.pwa.controlled') : t('siteStorage.pwa.uncontrolled') }}</strong><span>{{ t('siteStorage.pwa.registrations', { count: localNumber(report.registrations.length) }, report.registrations.length) }} · {{ t('siteStorage.pwa.caches', { count: localNumber(report.caches.length) }, report.caches.length) }}</span></div>
        <UiButton appearance="application" type="button" @click="emit('copy')"><IconCheck v-if="copied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" /> {{ copied ? t('siteStorage.copied') : t('siteStorage.copyReport') }}</UiButton>
      </div>
      <div v-if="report.manifestInspectionError" class="pwa-cache-warning" role="status"><IconWarning aria-hidden="true" /><span>{{ t('siteStorage.pwa.manifestUnavailable', { error: report.manifestInspectionError }) }}</span></div>
      <article v-if="report.manifest" class="pwa-manifest">
        <header><div><IconDashboard aria-hidden="true" /><span><strong>{{ report.manifest.name ?? report.manifest.shortName ?? t('siteStorage.pwa.manifest') }}</strong><small>{{ report.manifest.url || t('siteStorage.pwa.embedded') }}</small></span></div><span>{{ report.manifest.display ?? 'browser' }}</span></header>
        <dl>
          <div v-if="report.manifest.startUrl"><dt>{{ t('siteStorage.pwa.startUrl') }}</dt><dd>{{ report.manifest.startUrl }}</dd></div>
          <div v-if="report.manifest.scope"><dt>{{ t('siteStorage.pwa.scope') }}</dt><dd>{{ report.manifest.scope }}</dd></div>
          <div><dt>{{ t('siteStorage.pwa.assets') }}</dt><dd>{{ t('siteStorage.pwa.icons', { count: localNumber(report.manifest.icons.length) }) }} · {{ t('siteStorage.pwa.shortcuts', { count: localNumber(report.manifest.shortcuts.length) }) }}</dd></div>
        </dl>
        <div v-if="report.manifest.parseErrors.length || report.manifest.installabilityErrors.length" class="pwa-manifest-errors">
          <strong>{{ t('siteStorage.pwa.findings') }}</strong>
          <ul><li v-for="(item, index) in report.manifest.parseErrors" :key="`manifest-${index}`">{{ item.message }}<template v-if="item.line !== undefined"> {{ t('siteStorage.pwa.line', { line: localNumber(item.line) }) }}</template></li><li v-for="item in report.manifest.installabilityErrors" :key="item.errorId">{{ item.errorId }}<template v-if="item.arguments.length"> · {{ item.arguments.map((argument) => `${argument.name}: ${argument.value}`).join(', ') }}</template></li></ul>
        </div>
        <small v-else-if="report.installabilityInspectionAvailable">{{ t('siteStorage.pwa.noInstallErrors') }}</small><small v-else>{{ t('siteStorage.pwa.installUnavailable') }}</small>
      </article>
      <div v-else-if="report.manifestInspectionAvailable" class="site-storage-empty compact"><IconDashboard aria-hidden="true" /><strong>{{ t('siteStorage.pwa.noManifest') }}</strong></div>
      <div v-if="report.registrations.length" class="pwa-registrations">
        <article v-for="registration in report.registrations" :key="registration.scope"><strong>{{ registration.scope }}</strong><code>{{ registration.active?.scriptUrl ?? registration.waiting?.scriptUrl ?? registration.installing?.scriptUrl ?? t('siteStorage.pwa.noWorkerScript') }}</code><small>{{ registration.active?.state ?? registration.waiting?.state ?? registration.installing?.state ?? t('siteStorage.pwa.inactive') }} · {{ t('siteStorage.pwa.updateViaCache', { value: registration.updateViaCache }) }}</small></article>
      </div>
      <div v-else class="site-storage-empty compact"><IconOffline aria-hidden="true" /><strong>{{ t('siteStorage.pwa.noRegistrations') }}</strong></div>
      <div v-if="report.cacheInspectionError" class="pwa-cache-warning" role="status"><IconWarning aria-hidden="true" /><span>{{ report.cacheInspectionAvailable ? report.cacheInspectionError : t('siteStorage.pwa.cacheUnavailable', { error: report.cacheInspectionError }) }}</span></div>
      <template v-else-if="report.caches.length">
        <div class="pwa-cache-tools">
          <label><span>{{ t('siteStorage.pwa.cache') }}</span><select v-model="cache" :aria-label="t('siteStorage.pwa.cacheAria')" @change="emit('cacheChange')"><option v-for="item in report.caches" :key="item.name" :value="item.name">{{ item.name }}</option></select></label>
          <form @submit.prevent="emit('filter')"><label class="site-storage-search"><IconSearch aria-hidden="true" /><input v-model="query" type="search" :aria-label="t('siteStorage.pwa.filter')" :placeholder="t('siteStorage.pwa.filterPlaceholder')" autocomplete="off" /></label><UiButton appearance="application" type="submit">{{ t('siteStorage.pwa.apply') }}</UiButton></form>
        </div>
        <div v-if="report.selectedCache && !report.selectedCache.entries.length" class="site-storage-empty compact"><IconOffline aria-hidden="true" /><strong>{{ t('siteStorage.pwa.noMatching') }}</strong></div>
        <div v-else-if="report.selectedCache" class="pwa-cache-entries"><article v-for="entry in report.selectedCache.entries" :key="`${entry.requestMethod}-${entry.requestUrl}`"><header><strong>{{ entry.requestMethod }}</strong><span>{{ entry.responseStatus }} {{ entry.responseStatusText }}</span></header><code>{{ entry.requestUrl }}</code><small>{{ entry.responseType }}<template v-if="entry.responseTime"> · {{ timestamp(entry.responseTime) }}</template></small></article></div>
      </template>
      <div v-else-if="report.cacheInspectionAvailable" class="site-storage-empty compact"><IconOffline aria-hidden="true" /><strong>{{ t('siteStorage.pwa.noCaches') }}</strong></div>
      <details class="storage-changes-caveats pwa-caveats"><summary>{{ t('siteStorage.scopePrivacy') }}</summary><ul><li v-for="caveat in report.caveats" :key="caveat">{{ caveat }}</li></ul></details>
      <footer v-if="report.selectedCache" class="indexeddb-footer"><span>{{ t('siteStorage.pwa.matching', { count: localNumber(report.selectedCache.totalEntries) }, report.selectedCache.totalEntries) }}</span><div><UiButton appearance="application" type="button" :disabled="offset === 0 || state === 'loading'" @click="emit('move', -1)"><IconArrowBack aria-hidden="true" /> {{ t('siteStorage.indexed.previous') }}</UiButton><UiButton appearance="application" type="button" :disabled="!report.selectedCache.hasMore || state === 'loading'" @click="emit('move', 1)">{{ t('siteStorage.indexed.next') }} <IconArrowForward aria-hidden="true" /></UiButton></div></footer>
    </template>
  </section>
</template>
