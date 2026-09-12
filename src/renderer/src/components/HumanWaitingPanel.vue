<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HronautApi } from '../../../shared/types.js'
import type { HumanWaitingRecord } from '../../../shared/human-waiting.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  workspaceId: string
  disabled?: boolean
  browser: Pick<HronautApi, 'listHumanWaiting' | 'changeHumanWaiting'>
}>()
const { t, locale } = useI18n({ useScope: 'global' })
const records = ref<HumanWaitingRecord[]>([])
const reviewed = ref<Record<string, boolean>>({})
const busy = ref(false)
const error = ref(false)
let generation = 0
const active = (record: HumanWaitingRecord) => record.state === 'WAITING_FOR_HUMAN' || record.state === 'ACKNOWLEDGED'
const deadline = (value: number): string => {
  try { return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(value) } catch { return t('humanWaiting.unavailable') }
}

async function refresh(): Promise<void> {
  if (busy.value || props.disabled) return
  const current = ++generation
  busy.value = true; error.value = false
  try {
    const next = await props.browser.listHumanWaiting(props.workspaceId)
    if (current === generation) { records.value = next; reviewed.value = {} }
  } catch {
    if (current === generation) { error.value = true; records.value = []; reviewed.value = {} }
  } finally { if (current === generation) busy.value = false }
}

async function change(record: HumanWaitingRecord, action: 'acknowledge' | 'cancel' | 'reject' | 'resolve'): Promise<void> {
  if (busy.value || props.disabled || !active(record) || (action === 'resolve' && !reviewed.value[record.id])) return
  const workspaceId = props.workspaceId
  const current = ++generation
  busy.value = true; error.value = false
  try {
    const next = await props.browser.changeHumanWaiting(workspaceId, record.id, record.revision, action)
    if (current === generation) {
      records.value = records.value.map(candidate => candidate.id === next.id ? next : candidate)
      reviewed.value = {}
    }
  } catch {
    if (current === generation) { error.value = true; reviewed.value = {} }
  } finally { if (current === generation) busy.value = false }
}

watch(() => [props.workspaceId, props.disabled] as const, () => {
  generation += 1; records.value = []; reviewed.value = {}; busy.value = false
  void refresh()
}, { immediate: true })
onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <section class="human-waiting" :aria-label="t('humanWaiting.title')" :aria-busy="busy">
    <h3>{{ t('humanWaiting.title') }}</h3>
    <p>{{ t('humanWaiting.help') }}</p>
    <UiButton appearance="standard" type="button" :disabled="busy || disabled" @click="refresh">{{ t('humanWaiting.refresh') }}</UiButton>
    <p v-if="error" role="alert">{{ t('humanWaiting.error') }}</p>
    <p v-else-if="!busy && !records.length">{{ t('humanWaiting.empty') }}</p>
    <div class="waiting-records">
      <article v-for="record in records" :key="record.id" class="waiting-record">
        <h4>{{ t(`humanWaiting.decisions.${record.decision}`) }}</h4>
        <p>{{ t(`humanWaiting.states.${record.state}`) }}</p>
        <div v-if="record.review" class="waiting-artifact">
          <p><strong>{{ t('humanWaiting.review.heading') }}</strong> · {{ t(`humanWaiting.review.statuses.${record.review.status}`) }}</p>
          <p v-if="record.review.representation === 'visible-browser-only'">{{ t('humanWaiting.review.visibleOnly') }}</p>
          <p v-else-if="record.review.description">{{ record.review.description }}</p>
          <p v-if="record.review.expectedPostcondition"><strong>{{ t('humanWaiting.review.expected') }}:</strong> {{ record.review.expectedPostcondition }}</p>
          <dl>
            <dt>{{ t('humanWaiting.review.tool') }}</dt><dd>{{ record.review.toolName }}</dd>
            <dt>{{ t('humanWaiting.review.actionClass') }}</dt><dd>{{ record.review.actionClass }}</dd>
            <dt>{{ t('humanWaiting.review.reversibility') }}</dt><dd>{{ t(`humanWaiting.review.reversibilities.${record.review.reversibility}`) }}</dd>
            <dt>{{ t('humanWaiting.review.workspace') }}</dt><dd>{{ record.review.workspaceName }}</dd>
            <dt>{{ t('humanWaiting.review.profile') }}</dt><dd>{{ record.review.profileName }}</dd>
            <template v-if="record.review.origin"><dt>{{ t('humanWaiting.review.origin') }}</dt><dd>{{ record.review.origin }}</dd></template>
            <template v-if="record.review.tabId"><dt>{{ t('humanWaiting.review.tab') }}</dt><dd>{{ record.review.tabId }}</dd></template>
            <template v-if="record.review.navigationGeneration !== undefined"><dt>{{ t('humanWaiting.review.navigation') }}</dt><dd>{{ record.review.navigationGeneration }}</dd></template>
            <template v-if="record.review.humanInputGeneration !== undefined"><dt>{{ t('humanWaiting.review.humanInput') }}</dt><dd>{{ record.review.humanInputGeneration }}</dd></template>
            <dt>{{ t('humanWaiting.review.artifact') }}</dt><dd>{{ record.review.artifactHash }}</dd>
          </dl>
          <ol class="waiting-receipts" :aria-label="t('humanWaiting.review.timeline')">
            <li v-for="(receipt, index) in record.review.receipts" :key="`${receipt.status}-${index}`">
              {{ t(`humanWaiting.review.statuses.${receipt.status}`) }} · {{ deadline(receipt.at) }}
            </li>
          </ol>
        </div>
        <dl>
          <dt>{{ t('humanWaiting.owner') }}</dt><dd>{{ record.owner }}</dd>
          <dt>{{ t('humanWaiting.fallback') }}</dt><dd>{{ record.fallbackOwner }}</dd>
          <dt>{{ t('humanWaiting.deadline') }}</dt><dd>{{ deadline(record.deadlineAt) }}</dd>
          <dt>{{ t('humanWaiting.notification') }}</dt><dd>{{ t(`humanWaiting.notifications.${record.notificationStatus}`) }} · {{ t('humanWaiting.attempts') }}: {{ record.notificationAttempts }}</dd>
          <dt>{{ t('humanWaiting.handle') }}</dt><dd>{{ record.id }}</dd>
        </dl>
        <p v-if="record.priorOutcome === 'OUTCOME_UNKNOWN'">{{ t('humanWaiting.unknown') }}</p>
        <template v-if="active(record)">
          <label class="waiting-review"><input v-model="reviewed[record.id]" type="checkbox" :disabled="busy || disabled">{{ t(record.review ? 'humanWaiting.reviewedExact' : 'humanWaiting.reviewed') }}</label>
          <div class="waiting-actions">
            <UiButton appearance="standard" type="button" :disabled="busy || disabled || record.state === 'ACKNOWLEDGED'" @click="change(record, 'acknowledge')">{{ t('humanWaiting.acknowledge') }}</UiButton>
            <UiButton appearance="standard" type="button" :disabled="busy || disabled || !reviewed[record.id]" @click="change(record, 'resolve')">{{ t(record.review ? 'humanWaiting.approve' : 'humanWaiting.resolve') }}</UiButton>
            <UiButton v-if="record.review" appearance="standard" type="button" :disabled="busy || disabled" @click="change(record, 'reject')">{{ t('humanWaiting.reject') }}</UiButton>
            <UiButton appearance="standard" type="button" :disabled="busy || disabled" @click="change(record, 'cancel')">{{ t('humanWaiting.cancel') }}</UiButton>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
.human-waiting { display: grid; gap: 0.65rem; margin-top: 18px; padding: 14px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 0.75rem; }
.human-waiting h3, .human-waiting h4, .human-waiting p { margin: 0; }
.waiting-records { display: grid; gap: 12px; max-height: 380px; overflow: auto; }
.waiting-record { display: grid; gap: 0.6rem; padding: 10px; border: 1px solid var(--border-soft); border-radius: 0.5rem; }
.waiting-artifact { display: grid; gap: 0.55rem; padding: 10px; background: var(--surface-raised, var(--surface)); border: 1px solid var(--border-soft); border-radius: 0.5rem; }
.waiting-record dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.7rem; margin: 0; }
.waiting-record dd { margin: 0; overflow-wrap: anywhere; }
.waiting-receipts { margin: 0; padding-inline-start: 1.4rem; }
.waiting-review { display: flex; align-items: flex-start; gap: 0.6rem; }
.waiting-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
</style>
