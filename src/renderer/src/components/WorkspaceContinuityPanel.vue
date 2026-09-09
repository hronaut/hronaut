<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HronautApi } from '../../../shared/types.js'
import type { WorkspaceContinuityReport } from '../../../shared/workspace-continuity.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  workspaceId: string
  disabled?: boolean
  browser: Pick<HronautApi, 'reviewWorkspaceContinuity' | 'checkpointWorkspaceContinuity' | 'reconcileWorkspaceContinuity'>
}>()
const { t } = useI18n({ useScope: 'global' })
const report = ref<WorkspaceContinuityReport | null>(null)
const busy = ref(false)
const error = ref(false)
const acknowledged = ref(false)
const marker = ref('')
let generation = 0
const needsAcknowledgement = computed(() => report.value?.priorOutcome === 'OUTCOME_UNKNOWN')
const canReconcile = computed(() => !!report.value?.reviewId && report.value.suspended && (!needsAcknowledgement.value || acknowledged.value))
async function run(action: 'review' | 'checkpoint' | 'reconcile'): Promise<void> {
  if (busy.value || props.disabled) return
  const id = props.workspaceId
  const reviewId = report.value?.reviewId
  if (action === 'reconcile' && (!canReconcile.value || !reviewId)) return
  const current = ++generation
  busy.value = true; error.value = false
  try {
    const next = action === 'checkpoint'
      ? await props.browser.checkpointWorkspaceContinuity(id, marker.value.trim() || undefined)
      : action === 'reconcile'
        ? await props.browser.reconcileWorkspaceContinuity(id, reviewId!, acknowledged.value)
        : await props.browser.reviewWorkspaceContinuity(id)
    if (current !== generation) return
    report.value = next
    acknowledged.value = false
  } catch {
    if (current !== generation) return
    report.value = null; error.value = true; acknowledged.value = false
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(() => props.workspaceId, () => {
  generation += 1; busy.value = false; report.value = null; marker.value = ''; acknowledged.value = false
  void run('review')
}, { immediate: true })
onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <section class="workspace-continuity" :aria-label="t('workspaceContinuity.title')" :aria-busy="busy">
    <h3>{{ t('workspaceContinuity.title') }}</h3>
    <p>{{ t('workspaceContinuity.help') }}</p>
    <p v-if="busy" role="status">{{ t('workspaceContinuity.loading') }}</p>
    <p v-else-if="error" role="alert">{{ t('workspaceContinuity.error') }}</p>
    <template v-if="report">
      <strong role="status">{{ t(!report.checkpointId ? 'workspaceContinuity.unavailable' : report.suspended ? 'workspaceContinuity.suspended' : 'workspaceContinuity.ready') }}</strong>
      <ul v-if="report.reasons.length">
        <li v-for="reason in report.reasons" :key="reason">{{ t(`workspaceContinuity.reasons.${reason}`) }}</li>
      </ul>
      <label v-if="needsAcknowledgement && report.suspended" class="continuity-ack">
        <input v-model="acknowledged" type="checkbox" :disabled="busy || disabled" />
        <span>{{ t('workspaceContinuity.ack') }}</span>
      </label>
    </template>
    <label>{{ t('workspaceContinuity.marker') }}<input v-model="marker" type="text" maxlength="256" autocomplete="off" spellcheck="false" :disabled="busy || disabled" /></label>
    <small>{{ t('workspaceContinuity.markerHelp') }}</small>
    <div class="continuity-actions">
      <UiButton appearance="standard" type="button" :disabled="busy || disabled" @click="run('review')">{{ t('workspaceContinuity.refresh') }}</UiButton>
      <UiButton appearance="standard" type="button" :disabled="busy || disabled || !!(report?.checkpointId && report.suspended)" @click="run('checkpoint')">{{ t('workspaceContinuity.checkpoint') }}</UiButton>
      <UiButton appearance="standard" type="button" variant="primary" :disabled="busy || disabled || !canReconcile" @click="run('reconcile')">{{ t('workspaceContinuity.reconcile') }}</UiButton>
    </div>
  </section>
</template>

<style scoped>
.workspace-continuity { display: grid; gap: 0.65rem; margin-top: 18px; padding: 14px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 0.75rem; }
h3, p, ul { margin: 0; }
h3 { font-size: 14px; font-weight: 750; }
p, small { color: var(--muted); }
[role="alert"] { color: var(--danger, #b42318); }
p, small, li { line-height: 1.5; }
label { display: grid; gap: 0.4rem; }
.continuity-ack { display: flex; align-items: flex-start; gap: 0.6rem; }
.continuity-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
input[type="text"] { width: 100%; box-sizing: border-box; padding: 10px 11px; font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
input[type="text"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
