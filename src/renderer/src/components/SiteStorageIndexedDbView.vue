<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded'
import IconArrowForward from '~icons/material-symbols/arrow-forward-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconDatabase from '~icons/material-symbols/database-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import { formatBytes, formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import type { BrowserIndexedDbReport } from '../../../shared/types'

const props = defineProps<{
  state: 'idle' | 'loading' | 'ready' | 'error'
  report: BrowserIndexedDbReport | null
  error: string
  copied: boolean
  entries: BrowserIndexedDbReport['entries']
  offset: number
  locale: SupportedLocale
}>()

const emit = defineEmits<{
  databaseChange: []
  storeChange: []
  copy: []
  move: [direction: -1 | 1]
}>()

const database = defineModel<string>('database', { required: true })
const store = defineModel<string>('store', { required: true })
const search = defineModel<string>('search', { required: true })
const { t } = useI18n({ useScope: 'global' })

function bytes(value: number): string { return formatBytes(props.locale, value) }
function localNumber(value: number): string { return formatNumber(props.locale, value) }
</script>

<template>
  <section class="indexeddb-view" :aria-busy="state === 'loading'">
    <div v-if="state === 'loading' && !report" class="site-storage-empty">
      <IconProgress class="state-spinner" aria-hidden="true" /><strong>{{ t('siteStorage.indexed.reading') }}</strong>
    </div>
    <div v-else-if="state === 'error'" class="storage-changes-error" role="alert">
      <IconError aria-hidden="true" /><strong>{{ t('siteStorage.indexed.attention') }}</strong><span>{{ error }}</span>
    </div>
    <div v-else-if="!report?.databases.length" class="site-storage-empty indexeddb-empty">
      <IconDatabase aria-hidden="true" /><strong>{{ t('siteStorage.indexed.empty') }}</strong><span>{{ t('siteStorage.indexed.emptyDescription') }}</span>
    </div>
    <template v-else-if="report">
      <div class="indexeddb-selectors">
        <label><span>{{ t('siteStorage.indexed.database') }}</span><select v-model="database" :aria-label="t('siteStorage.indexed.databaseAria')" @change="emit('databaseChange')"><option v-for="item in report.databases" :key="item.name" :value="item.name">{{ item.name }} · v{{ item.version }}</option></select></label>
        <label><span>{{ t('siteStorage.indexed.objectStore') }}</span><select v-model="store" :aria-label="t('siteStorage.indexed.objectStoreAria')" :disabled="!report.selectedDatabase?.objectStores?.length" @change="emit('storeChange')"><option v-for="item in report.selectedDatabase?.objectStores ?? []" :key="item.name" :value="item.name">{{ item.name }} · {{ t('siteStorage.indexed.records', { count: localNumber(item.entryCount) }, item.entryCount) }}</option></select></label>
      </div>
      <div v-if="store" class="indexeddb-tools">
        <label class="site-storage-search"><IconSearch aria-hidden="true" /><input v-model="search" type="search" :aria-label="t('siteStorage.indexed.filter')" :placeholder="t('siteStorage.indexed.filterPlaceholder')" autocomplete="off" /></label>
        <UiButton native type="button" :disabled="!report.entries.length" @click="emit('copy')"><IconCheck v-if="copied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" /> {{ copied ? t('siteStorage.copied') : t('siteStorage.indexed.copyLoaded') }}</UiButton>
      </div>
      <div v-if="store" class="indexeddb-schema">
        <span>{{ t('siteStorage.indexed.keyPath') }} <code>{{ JSON.stringify(report.selectedDatabase?.objectStores?.find((item) => item.name === store)?.keyPath ?? null) }}</code></span>
        <span>{{ report.selectedDatabase?.objectStores?.find((item) => item.name === store)?.autoIncrement ? t('siteStorage.indexed.autoIncrement') : t('siteStorage.indexed.manualKeys') }}</span>
        <span>{{ t('siteStorage.indexed.indexes', { count: localNumber(report.selectedDatabase?.objectStores?.find((item) => item.name === store)?.indexes.length ?? 0) }) }}</span>
      </div>
      <div v-if="!store" class="site-storage-empty compact"><IconDatabase aria-hidden="true" /><strong>{{ t('siteStorage.indexed.noStores') }}</strong></div>
      <div v-else-if="!report.entries.length" class="site-storage-empty compact"><IconDatabase aria-hidden="true" /><strong>{{ t('siteStorage.indexed.noRecords') }}</strong></div>
      <div v-else-if="!entries.length" class="site-storage-empty compact"><IconSearch aria-hidden="true" /><strong>{{ t('siteStorage.indexed.noMatches') }}</strong></div>
      <div v-else class="indexeddb-records">
        <article v-for="(entry, index) in entries" :key="`${entry.primaryKey}-${index}`" class="indexeddb-record">
          <header><strong>{{ entry.key }}</strong><span>{{ entry.valueType }}</span></header>
          <code>{{ entry.valuePreview ?? t('siteStorage.indexed.omitted') }}</code>
          <small>{{ t('siteStorage.indexed.primaryKey', { key: entry.primaryKey }) }}<template v-if="entry.valuePreviewBytes !== undefined"> {{ t('siteStorage.indexed.preview', { size: bytes(entry.valuePreviewBytes) }) }}</template><template v-if="entry.valueTruncated"> {{ t('siteStorage.indexed.truncated') }}</template></small>
        </article>
      </div>
      <details class="storage-changes-caveats indexeddb-caveats">
        <summary>{{ t('siteStorage.indexed.schema') }}</summary>
        <div v-for="item in report.selectedDatabase?.objectStores ?? []" :key="item.name" class="indexeddb-store-schema"><strong>{{ item.name }}</strong><span v-if="item.indexes.length">{{ item.indexes.map((index) => `${index.name}${index.unique ? ` ${t('siteStorage.indexed.unique')}` : ''}`).join(', ') }}</span><span v-else>{{ t('siteStorage.indexed.noIndexes') }}</span></div>
        <ul><li v-for="caveat in report.caveats" :key="caveat">{{ caveat }}</li></ul>
      </details>
      <footer class="indexeddb-footer">
        <span>{{ t('siteStorage.indexed.range', { start: localNumber(offset + (report.entries.length ? 1 : 0)), end: localNumber(offset + report.entries.length) }) }}</span>
        <div><UiButton native type="button" :disabled="offset === 0 || state === 'loading'" @click="emit('move', -1)"><IconArrowBack aria-hidden="true" /> {{ t('siteStorage.indexed.previous') }}</UiButton><UiButton native type="button" :disabled="!report.hasMore || state === 'loading'" @click="emit('move', 1)">{{ t('siteStorage.indexed.next') }} <IconArrowForward aria-hidden="true" /></UiButton></div>
      </footer>
    </template>
  </section>
</template>
