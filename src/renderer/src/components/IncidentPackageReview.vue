<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { incidentKinds, incidentOmissionLimit, incidentReplacementLimit, incidentPathOmissionLimit, incidentLiteralPathSchema, type IncidentDraft, type IncidentKind, type IncidentPreview } from '../../../shared/incident-package'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'

const props = defineProps<{ tabId: string }>()
const { t } = useI18n({ useScope: 'global' })
const selected = ref<IncidentKind[]>([])
const minutes = ref(10)
const included = ref<IncidentKind[]>([])
const omissionRows = ref([{ id: 0, value: '' }])
let nextOmissionId = 1
const omissionList = ref<HTMLElement | null>(null)
const omittedFields = computed(() => [...new Set(omissionRows.value.map(row => row.value).filter(value => value !== ''))])
const pathRows = ref<Array<{ id: number; artifact: IncidentKind; value: string }>>([])
let nextPathId = 0
const pathList = ref<HTMLElement | null>(null)
let invalidation: Promise<void> = Promise.resolve()
const replacementRows = ref([{ id: 0, find: '', replacement: '[REDACTED]' }])
let nextReplacementId = 1
const replacementList = ref<HTMLElement | null>(null)
const replacements = computed(() => replacementRows.value.filter(row => row.find !== '').map(({ find, replacement }) => ({ find, replacement })))
const draft = ref<IncidentDraft | null>(null)
const preview = ref<IncidentPreview | null>(null)
const reviewed = ref(false)
const busy = ref(false)
const error = ref('')
const saved = ref(false)
let generation = 0
watch([included, omissionRows, pathRows, replacementRows], () => {
  generation += 1; busy.value = false; preview.value = null; reviewed.value = false; saved.value = false
  if (draft.value) {
    invalidation = window.hronaut.invalidateIncidentPreview(draft.value.draftId)
    void invalidation.catch(() => undefined)
  }
}, { deep: true, flush: 'sync' })
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
async function focusOmission(id: number): Promise<void> {
  await nextTick()
  if (draft.value && !busy.value) omissionList.value?.querySelector<HTMLInputElement>(`[data-omission-id="${id}"] input`)?.focus()
}
function addOmission(): void {
  if (busy.value || omissionRows.value.length >= incidentOmissionLimit) return
  const id = nextOmissionId++
  omissionRows.value.push({ id, value: '' })
  void focusOmission(id)
}
function removeOmission(id: number): void {
  if (busy.value || omissionRows.value.length <= 1) return
  const index = omissionRows.value.findIndex(row => row.id === id)
  if (index < 0) return
  omissionRows.value.splice(index, 1)
  void focusOmission(omissionRows.value[Math.min(index, omissionRows.value.length - 1)].id)
}
async function focusPath(id: number): Promise<void> {
  await nextTick()
  if (draft.value && !busy.value) pathList.value?.querySelector<HTMLInputElement>(`[data-path-id="${id}"] input`)?.focus()
}
function addPath(): void {
  if (busy.value || pathRows.value.length >= incidentPathOmissionLimit || !included.value.length) return
  const id = nextPathId++
  pathRows.value.push({ id, artifact: included.value[0], value: '' })
  void focusPath(id)
}
function removePath(id: number): void {
  const index = pathRows.value.findIndex(row => row.id === id)
  if (busy.value || index < 0) return
  pathRows.value.splice(index, 1)
  const next = pathRows.value[Math.min(index, pathRows.value.length - 1)]
  if (next) void focusPath(next.id)
}
async function focusReplacement(id: number): Promise<void> {
  await nextTick()
  if (draft.value && !busy.value) replacementList.value?.querySelector<HTMLInputElement>(`[data-replacement-id="${id}"] input`)?.focus()
}
function addReplacement(): void {
  if (busy.value || replacementRows.value.length >= incidentReplacementLimit) return
  const id = nextReplacementId++
  replacementRows.value.push({ id, find: '', replacement: '[REDACTED]' })
  void focusReplacement(id)
}
function removeReplacement(id: number): void {
  if (busy.value || replacementRows.value.length <= 1) return
  const index = replacementRows.value.findIndex(row => row.id === id)
  if (index < 0) return
  replacementRows.value.splice(index, 1)
  void focusReplacement(replacementRows.value[Math.min(index, replacementRows.value.length - 1)].id)
}
async function preparePreview(): Promise<void> {
  const id = draft.value?.draftId
  if (!id) return
  await run(async current => {
    preview.value = null; reviewed.value = false
    await invalidation
    if (!current()) return
    const omitPaths = pathRows.value.filter(row => row.value.trim() !== '').map((row, index) => {
      try {
        return { artifact: row.artifact, path: incidentLiteralPathSchema.parse(JSON.parse(row.value)) }
      } catch { throw new Error(t('incident.invalidPath', { index: index + 1 })) }
    })
    const result = await window.hronaut.reviewIncident({ draftId: id, include: [...included.value], omitFields: omittedFields.value, ...(omitPaths.length ? { omitPaths } : {}), replacements: replacements.value })
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
        <div ref="omissionList" class="incident-omissions">
          <div v-for="(row, index) in omissionRows" :key="row.id" :data-omission-id="row.id" class="incident-omission-row" role="group" :aria-label="t('incident.omissionRow', { index: index + 1 })">
            <label>{{ t('incident.omitField') }}<UiInput v-model="row.value" maxlength="256" autocomplete="off" /></label>
            <UiButton v-if="omissionRows.length > 1" type="button" @click="removeOmission(row.id)">{{ t('incident.removeOmission', { index: index + 1 }) }}</UiButton>
          </div>
          <UiButton type="button" :disabled="omissionRows.length >= incidentOmissionLimit" @click="addOmission">{{ t('incident.addOmission') }}</UiButton>
          <p>{{ t('incident.omissionLimit', { count: incidentOmissionLimit }) }}</p>
        </div>
        <p>{{ t('incident.omitFieldHint') }}</p>
        <div ref="pathList" class="incident-paths">
          <div v-for="(row, index) in pathRows" :key="row.id" :data-path-id="row.id" class="incident-path-row" role="group" :aria-label="t('incident.pathRow', { index: index + 1 })">
            <label>{{ t('incident.pathArtifact') }}<select v-model="row.artifact">
              <option v-for="kind in included" :key="kind" :value="kind">{{ t(`incident.${kind}`) }}</option>
            </select></label>
            <label>{{ t('incident.pathValue') }}<UiInput v-model="row.value" maxlength="4096" autocomplete="off" /></label>
            <UiButton type="button" @click="removePath(row.id)">{{ t('incident.removePath', { index: index + 1 }) }}</UiButton>
          </div>
          <UiButton type="button" :disabled="!included.length || pathRows.length >= incidentPathOmissionLimit" @click="addPath">{{ t('incident.addPath') }}</UiButton>
          <p>{{ t('incident.pathHint') }}</p>
        </div>
        <div ref="replacementList" class="incident-replacements">
          <div v-for="(row, index) in replacementRows" :key="row.id" :data-replacement-id="row.id" class="incident-replacement-row" role="group" :aria-label="t('incident.replacementRow', { index: index + 1 })">
            <label>{{ t('incident.find') }}<UiInput v-model="row.find" maxlength="256" autocomplete="off" /></label>
            <label>{{ t('incident.replacement') }}<UiInput v-model="row.replacement" maxlength="256" autocomplete="off" /></label>
            <UiButton v-if="replacementRows.length > 1" type="button" @click="removeReplacement(row.id)">{{ t('incident.removeReplacement', { index: index + 1 }) }}</UiButton>
          </div>
          <UiButton type="button" :disabled="replacementRows.length >= incidentReplacementLimit" @click="addReplacement">{{ t('incident.addReplacement') }}</UiButton>
          <p>{{ t('incident.replacementLimit', { count: incidentReplacementLimit }) }}</p>
        </div>
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
.incident-review { min-height: 0; overflow: auto; overscroll-behavior: contain; margin: 12px; padding: 12px; border: 1px solid var(--border-soft); border-radius: 8px; }
.incident-review fieldset { display: grid; gap: 8px; margin-block: 12px; border: 1px solid var(--border-soft); border-radius: 8px; }
.incident-review label { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.incident-review input { min-width: 0; max-width: 100%; }
.incident-omissions { display: grid; gap: 8px; }
.incident-omission-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.incident-replacements, .incident-replacement-row, .incident-paths, .incident-path-row { display: grid; gap: 8px; }
.incident-replacement-row { padding: 8px; border: 1px solid var(--border-soft); border-radius: 8px; }
.incident-preview { width: 100%; min-height: 280px; background: white; }
.incident-hash { overflow-wrap: anywhere; }
</style>
