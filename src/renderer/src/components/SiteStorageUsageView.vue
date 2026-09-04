<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconPieChart from '~icons/material-symbols/pie-chart-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import { formatBytes } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import type { BrowserStorageUsageReport } from '../../../shared/types'

const props = defineProps<{
  state: 'idle' | 'loading' | 'ready' | 'error'
  report: BrowserStorageUsageReport | null
  error: string
  copied: boolean
  locale: SupportedLocale
}>()

const emit = defineEmits<{ copy: [] }>()
const { t } = useI18n({ useScope: 'global' })

function bytes(value: number): string {
  return formatBytes(props.locale, value)
}

function usagePercent(percent: number): string {
  if (percent <= 0) return '0%'
  if (percent < 0.01) return '<0.01%'
  return `${percent.toFixed(2).replace(/\.00$/, '')}%`
}

function usageTypeLabel(storageType: string): string {
  const labels: Record<string, string> = {
    cache_storage: t('runtime.storage.cacheStorage'), caches: t('runtime.storage.cacheStorage'),
    indexeddb: t('runtime.storage.indexedDb'), indexedDB: t('runtime.storage.indexedDb'),
    local_storage: t('runtime.storage.local'), service_workers: t('runtime.storage.serviceWorkers'),
    serviceWorkerRegistrations: t('runtime.storage.serviceWorkers'), shared_storage: t('runtime.storage.shared'),
    storage_buckets: t('runtime.storage.buckets'), file_systems: t('runtime.storage.files'),
    websql: t('runtime.storage.webSql'), shader_cache: t('runtime.storage.shader')
  }
  return labels[storageType] ?? storageType.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function usageShare(value: number): number {
  const total = props.report?.usage ?? 0
  return total > 0 ? Math.min(100, (value / total) * 100) : 0
}
</script>

<template>
  <section class="storage-usage-view" :aria-busy="state === 'loading'">
    <div v-if="state === 'loading' && !report" class="site-storage-empty">
      <IconProgress class="state-spinner" aria-hidden="true" /><strong>{{ t('siteStorage.measuring') }}</strong>
    </div>
    <div v-else-if="state === 'error'" class="storage-changes-error" role="alert">
      <IconError aria-hidden="true" /><strong>{{ t('siteStorage.overviewAttention') }}</strong><span>{{ error }}</span>
    </div>
    <template v-else-if="report">
      <div class="storage-usage-summary">
        <article><span>{{ t('siteStorage.used') }}</span><strong>{{ bytes(report.usage) }}</strong></article>
        <article><span>{{ t('siteStorage.available') }}</span><strong>{{ bytes(report.available) }}</strong></article>
        <article><span>{{ t('siteStorage.quota') }}</span><strong>{{ bytes(report.quota) }}</strong></article>
      </div>
      <div class="storage-usage-meter" :aria-label="t('siteStorage.quotaUsed', { percent: usagePercent(report.usagePercent) })">
        <div><span :style="{ width: `${report.usage > 0 ? Math.max(0.5, report.usagePercent) : 0}%` }"></span></div>
        <strong>{{ t('siteStorage.usedPercent', { percent: usagePercent(report.usagePercent) }) }}</strong>
      </div>
      <div class="storage-usage-toolbar">
        <span :class="{ fallback: report.source === 'storage-manager' }">{{ report.source === 'chromium-quota' ? t('siteStorage.chromiumQuota') : t('siteStorage.storageEstimate') }}</span>
        <span v-if="report.overrideActive" class="storage-usage-override">{{ t('siteStorage.override') }}</span>
        <UiButton native type="button" @click="emit('copy')"><IconCheck v-if="copied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" /> {{ copied ? t('siteStorage.copied') : t('siteStorage.copyReport') }}</UiButton>
      </div>
      <div v-if="report.breakdown.length" class="storage-usage-breakdown">
        <article v-for="item in report.breakdown" :key="item.storageType">
          <header><strong>{{ usageTypeLabel(item.storageType) }}</strong><span>{{ bytes(item.usage) }}</span></header>
          <div><span :style="{ width: `${usageShare(item.usage)}%` }"></span></div>
        </article>
      </div>
      <div v-else class="site-storage-empty compact"><IconPieChart aria-hidden="true" /><strong>{{ t('siteStorage.noBreakdown') }}</strong><span>{{ t('siteStorage.noBreakdownDescription') }}</span></div>
      <details class="storage-changes-caveats storage-usage-caveats"><summary>{{ t('siteStorage.scopePrivacy') }}</summary><ul><li v-for="caveat in report.caveats" :key="caveat">{{ caveat }}</li></ul></details>
      <footer class="storage-usage-footer"><span>{{ report.origin }}</span><span>{{ t('siteStorage.aggregate') }}</span></footer>
    </template>
  </section>
</template>
