<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { incidentKinds, type IncidentDraft, type IncidentKind, type IncidentPreview } from '../../../shared/incident-package'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'

const props = defineProps<{ tabId: string }>()
const { t } = useI18n({ useScope: 'global' })
const selected = ref<IncidentKind[]>([])
const minutes = ref(10)
const included = ref<IncidentKind[]>([])
const omitField = ref('')
const find = ref('')
const replacement = ref('[REDACTED]')
const draft = ref<IncidentDraft | null>(null)
const preview = ref<IncidentPreview | null>(null)
const reviewed = ref(false)
const busy = ref(false)
const error = ref('')
const saved = ref(false)
let generation = 0
watch([included, omitField, find, replacement], () => { generation += 1; busy.value = false; preview.value = null; reviewed.value = false; saved.value = false }, { deep: true })
watch([selected, minutes], () => { reset() }, { deep: true })
function reset(): void {
  generation += 1
  draft.value = null; preview.value = null; reviewed.value = false; saved.value = false; busy.value = false
  void window.hronaut.discardIncident().catch(() => undefined)
}
async function run(action: (current: () => boolean) => Promise<void>): Promise<void> {
  if (busy.value) return
  const expected = ++generation
  busy.value = true; error.value = ''; saved.value = false
  try { await action(() => expected === generation) }
  catch (cause) { if (expected === generation) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (expected === generation) busy.value = false }
}
async function capture(): Promise<void> {
  await run(async current => {
    draft.value = null; preview.value = null; reviewed.value = false
    const result = await window.hronaut.captureIncident({ tabId: props.tabId, minutes: minutes.value, kinds: [...selected.value] })
    if (!current()) return
    draft.value = result; included.value = result.artifacts.map(a => a.kind); preview.value = null; reviewed.value = false
  })
}
async function preparePreview(): Promise<void> {
  const id = draft.value?.draftId
  if (!id) return
  await run(async current => {
    preview.value = null; reviewed.value = false
    const result = await window.hronaut.reviewIncident({ draftId: id, include: [...included.value], omitFields: omitField.value ? [omitField.value] : [], replacements: find.value ? [{ find: find.value, replacement: replacement.value }] : [] })
    if (!current()) return
    preview.value = result; reviewed.value = false
  })
}
async function save(): Promise<void> {
  if (!reviewed.value || !draft.value || !preview.value) return
  const input = { draftId: draft.value.draftId, previewId: preview.value.previewId, reviewed: true as const }
  await run(async current => {
    try {
      const result = await window.hronaut.saveIncident(input)
      if (current()) saved.value = result.saved
    } catch (cause) {
      if (current()) { preview.value = null; reviewed.value = false }
      throw cause
    }
  })
}
onBeforeUnmount(reset)
</script>

<template>
  <details class="incident-review">
    <summary>{{ t('incident.title') }}</summary>
    <p>{{ t('incident.privacy') }}</p>
    <fieldset :disabled="busy">
      <legend>{{ t('incident.select') }}</legend>
      <label v-for="kind in incidentKinds" :key="kind"><input v-model="selected" type="checkbox" :value="kind">{{ t(`incident.${kind}`) }}</label>
      <label>{{ t('incident.minutes') }}<UiInput v-model.number="minutes" type="number" min="1" max="60" step="1" /></label>
      <UiButton type="button" :disabled="!selected.length" @click="capture">{{ t('incident.capture') }}</UiButton>
    </fieldset>
    <template v-if="draft">
      <p>{{ t('incident.expires') }} {{ draft.expiresAt }}</p>
      <fieldset :disabled="busy">
        <legend>{{ t('incident.include') }}</legend>
        <label v-for="artifact in draft.artifacts" :key="artifact.kind"><input v-model="included" type="checkbox" :value="artifact.kind">{{ t(`incident.${artifact.kind}`) }} — {{ t(`incident.${artifact.status}`) }} <span v-if="artifact.truncated">{{ t('incident.truncated') }}</span></label>
        <label>{{ t('incident.omitField') }}<UiInput v-model="omitField" maxlength="256" autocomplete="off" /></label>
        <p>{{ t('incident.omitFieldHint') }}</p>
        <label>{{ t('incident.find') }}<UiInput v-model="find" maxlength="256" autocomplete="off" /></label>
        <label>{{ t('incident.replacement') }}<UiInput v-model="replacement" maxlength="256" autocomplete="off" /></label>
        <UiButton type="button" :disabled="!included.length" @click="preparePreview">{{ t('incident.preview') }}</UiButton>
      </fieldset>
    </template>
    <template v-if="preview">
      <iframe :title="t('incident.preview')" sandbox="" :srcdoc="preview.html" class="incident-preview" />
      <p class="incident-hash">{{ t('incident.hash', { hash: preview.sha256 }) }}</p>
      <label><input v-model="reviewed" type="checkbox" :disabled="busy">{{ t('incident.reviewed') }}</label>
      <UiButton type="button" :disabled="busy || !reviewed" @click="save">{{ t('incident.save') }}</UiButton>
    </template>
    <UiButton v-if="draft || busy" type="button" @click="reset">{{ t('incident.discard') }}</UiButton>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">{{ t('incident.working') }}</p>
    <p v-if="saved" role="status">{{ t('incident.saved') }}</p>
  </details>
</template>

<style scoped>
.incident-review { margin: 12px; padding: 12px; border: 1px solid var(--border-soft); border-radius: 8px; }
.incident-review fieldset { display: grid; gap: 8px; margin-block: 12px; border: 1px solid var(--border-soft); border-radius: 8px; }
.incident-review label { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.incident-review input { min-width: 0; max-width: 100%; }
.incident-preview { width: 100%; min-height: 280px; background: white; }
.incident-hash { overflow-wrap: anywhere; }
</style>
