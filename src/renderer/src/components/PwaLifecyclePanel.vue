<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'
import type { BrowserTabState } from '../../../shared/types'
import type { PwaLifecycleAction, PwaLifecycleReport } from '../../../shared/pwa-lifecycle'

const props = defineProps<{ tab?: BrowserTabState }>()
const { t } = useI18n({ useScope: 'global' })
const report = ref<PwaLifecycleReport | null>(null)
const error = ref('')
const busy = ref(false)
let request = 0
let disposed = false
async function manage(action: PwaLifecycleAction): Promise<void> {
  const tabId = props.tab?.id
  if (!tabId) return
  const current = ++request
  busy.value = true
  error.value = ''
  try {
    const result = await window.hronaut.pwaLifecycle({ tabId, action })
    if (!disposed && current === request && props.tab?.id === tabId) report.value = result
  } catch (cause) {
    if (!disposed && current === request) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { if (!disposed && current === request) busy.value = false }
}
watch(() => props.tab?.id, () => { report.value = null; void manage('get') }, { immediate: true })
watch(() => props.tab?.pwaLifecycleActive, () => { void manage('get') })
const timer = setInterval(() => { if (props.tab?.pwaLifecycleActive && !busy.value) void manage('get') }, 1000)
onBeforeUnmount(() => { disposed = true; request++; clearInterval(timer) })
</script>

<template>
  <section class="pwa-lifecycle" :aria-label="t('pwaLifecycle.title')">
    <strong>{{ t('pwaLifecycle.title') }}</strong>
    <p>{{ t('pwaLifecycle.note') }}</p>
    <div class="pwa-lifecycle-actions">
      <UiButton size="small" :disabled="busy || tab?.pwaLifecycleActive" @click="manage('start')">{{ t('pwaLifecycle.start') }}</UiButton>
      <UiButton size="small" :disabled="!tab?.pwaLifecycleActive" @click="manage('stop')">{{ t('pwaLifecycle.stop') }}</UiButton>
      <UiButton size="small" :disabled="busy" @click="manage('get')">{{ t('pwaLifecycle.refresh') }}</UiButton>
      <UiButton size="small" :disabled="busy || !report" @click="manage('clear')">{{ t('pwaLifecycle.clear') }}</UiButton>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <p role="status">{{ report.active ? t('pwaLifecycle.active') : t('pwaLifecycle.stopped') }} · {{ report.events.length }}<template v-if="report.reason"> · {{ report.reason }}</template></p>
      <ol class="pwa-lifecycle-events">
        <li v-for="(event, index) in report.events" :key="index">
          <time>{{ new Date(event.observedAt).toLocaleTimeString() }}</time> · {{ event.kind }}
          <span v-if="event.worker"> · {{ event.worker.id }} {{ event.worker.state }}</span>
          <code>{{ event.scope ?? event.controller?.scriptUrl }}</code>
          <small v-if="event.waiting">{{ t('pwaLifecycle.waiting') }} {{ event.waiting.id }}</small>
        </li>
      </ol>
      <details><summary>{{ t('pwaLifecycle.coverage') }}</summary><ul><li v-for="caveat in report.caveats" :key="caveat">{{ caveat }}</li></ul></details>
    </template>
  </section>
</template>

<style scoped>
.pwa-lifecycle { padding: 12px; font-size: 12px; line-height: 1.5; border-bottom: 1px solid var(--border-soft); }
.pwa-lifecycle p { margin: 8px 0; }
.pwa-lifecycle-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.pwa-lifecycle-events { max-height: 260px; overflow: auto; padding-left: 24px; }
.pwa-lifecycle-events li { padding: 5px 0; }
.pwa-lifecycle-events code { display: block; overflow-wrap: anywhere; }
</style>
