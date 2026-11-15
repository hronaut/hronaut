<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { BrowserNetworkPriority, BrowserNetworkPriorityObservation } from '../../../../shared/types'

defineProps<{ priority?: BrowserNetworkPriorityObservation }>()
const { t } = useI18n({ useScope: 'global' })
function label(value: BrowserNetworkPriority | null | undefined): string {
  return value ? t(`networkPriority.${value}`) : t('networkPriority.unavailable')
}
</script>

<template>
  <section class="network-priority" :aria-label="t('networkPriority.heading')">
    <strong>{{ t('networkPriority.heading') }}</strong>
    <dl>
      <div><dt>{{ t('networkPriority.initial') }}</dt><dd>{{ label(priority?.initial) }}</dd></div>
      <div><dt>{{ t('networkPriority.latest') }}</dt><dd>{{ label(priority?.latestObserved) }}</dd></div>
    </dl>
    <p>{{ t('networkPriority.note') }}</p>
  </section>
</template>

<style scoped>
.network-priority { margin-block: 12px; font-size: var(--type-small-size); }
.network-priority dl { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-block: 8px; }
.network-priority dl > div { display: flex; gap: 8px; }
.network-priority dd { margin: 0; font-weight: var(--weight-strong); }
.network-priority p { margin: 0; color: var(--text-muted); }
</style>
