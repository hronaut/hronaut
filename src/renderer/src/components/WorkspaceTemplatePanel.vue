<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'
import { BROWSER_TAB_GROUP_COLORS } from '../../../shared/tab-groups.js'
import { nextWorkspaceTemplateName, parseWorkspaceTemplate, previewWorkspaceTemplate, type WorkspaceTemplate } from '../../../shared/workspace-template.js'
import type { BrowserState, HronautApi } from '../../../shared/types.js'

const props = defineProps<{
  state: BrowserState
  browser: Pick<HronautApi, 'openWorkspaceTemplateFile' | 'saveWorkspaceTemplateFile' | 'importWorkspaceTemplate' | 'closeWorkspace'>
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
}>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t } = useI18n({ useScope: 'global' })
const mode = ref<'import' | 'export'>('import')
const draft = ref<WorkspaceTemplate | null>(null)
const reviewed = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref('')
const retained = ref<string[]>([])
const completed = ref(false)
const sourceId = ref('')
const sources = computed(() => [...props.state.mcpTabGroups, ...props.state.savedTabGroups])
const selectedSource = computed(() => sources.value.find(group => group.id === sourceId.value))
const sourcePages = computed(() => {
  const archived = props.state.savedTabGroups.find(group => group.id === sourceId.value)
  const tabs = archived?.tabs ?? props.state.tabs.filter(tab => tab.mcpGroupId === sourceId.value)
  return [...new Set(tabs.map(tab => tab.url))].filter(url => /^https?:\/\//.test(url)).slice(0, 20)
})
function addSource(): void {
  if (busy.value || !draft.value || !selectedSource.value || draft.value.workspaces.length >= 20) return
  draft.value.workspaces.push({ name: nextWorkspaceTemplateName(draft.value.workspaces), color: selectedSource.value.color, startPages: [] })
}
let disposed = false
onBeforeUnmount(() => { disposed = true })
const serialized = computed(() => draft.value ? JSON.stringify(draft.value) : '')
watch(serialized, () => { reviewed.value = false; completed.value = false }, { flush: 'sync' })
const validation = computed(() => {
  if (!draft.value) return { error: '', collisions: [] as string[] }
  try {
    const preview = previewWorkspaceTemplate(serialized.value, [...props.state.mcpTabGroups, ...props.state.savedTabGroups].map(group => group.name))
    return { error: '', collisions: mode.value === 'import' ? preview.collisions : [] }
  } catch (cause) { return { error: String(cause instanceof Error ? cause.message : cause), collisions: [] as string[] } }
})
const canCommit = computed(() => draft.value && reviewed.value && !busy.value && !completed.value && !retained.value.length && !validation.value.error && !validation.value.collisions.length)
async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true; emit('busy', true); error.value = ''; message.value = ''
  try { await action() } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { if (!disposed) { busy.value = false; emit('busy', false) } }
}
async function openFile(): Promise<void> {
  await run(async () => {
    const text = await props.browser.openWorkspaceTemplateFile()
    if (disposed || text === null) return
    reviewed.value = false
    draft.value = parseWorkspaceTemplate(text); mode.value = 'import'; retained.value = []; completed.value = false
  })
}
function newExport(): void {
  if (busy.value || retained.value.length) return
  reviewed.value = false
  const platform = window.hronautShell?.windowChrome.platform
  draft.value = { format: 'hronaut-workspace-template', version: 1, sourcePlatform: platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux', workspaces: [{ name: 'Workspace 1', color: 'blue', startPages: [] }] }
  mode.value = 'export'; error.value = ''; message.value = ''; completed.value = false
}
async function commit(): Promise<void> {
  if (!canCommit.value) return
  const text = serialized.value
  await run(async () => {
    if (mode.value === 'export') {
      const saved = await props.browser.saveWorkspaceTemplateFile(text)
      if (!disposed && saved) { message.value = t('workspaceTemplates.exported'); completed.value = true }
      return
    }
    const result = await props.browser.importWorkspaceTemplate(text)
    try { await props.syncState(result.state) } catch { /* Import outcome remains authoritative. */ }
    if (disposed) return
    retained.value = result.status === 'partial' ? result.workspaceIds : []
    completed.value = result.status === 'completed'
    reviewed.value = false
    message.value = t(`workspaceTemplates.${result.status === 'completed' ? 'imported' : result.status === 'partial' ? 'partial' : 'rolledBack'}`)
  })
}
async function cleanup(): Promise<void> {
  await run(async () => {
    const failed: string[] = []
    for (const id of retained.value) {
      try {
        const state = await props.browser.closeWorkspace(id)
        try { await props.syncState(state) } catch { /* Deletion already succeeded. */ }
      } catch { failed.push(id) }
    }
    if (!disposed) { retained.value = failed; message.value = t(failed.length ? 'workspaceTemplates.partial' : 'workspaceTemplates.cleaned') }
  })
}
</script>

<template>
  <section class="template-panel" :aria-busy="busy" data-testid="workspace-template-panel">
    <p>{{ t('workspaceTemplates.scope') }}</p>
    <p>{{ t('workspaceTemplates.privacy') }}</p>
    <div class="template-actions">
      <UiButton type="button" :disabled="busy || retained.length > 0" @click="openFile">{{ t('workspaceTemplates.openFile') }}</UiButton>
      <UiButton type="button" :disabled="busy || retained.length > 0" @click="newExport">{{ t('workspaceTemplates.newExport') }}</UiButton>
    </div>
    <template v-if="draft">
      <div v-if="mode === 'export' && !completed" class="template-source">
        <label>{{ t('workspaceTemplates.sourceWorkspace') }}<select v-model="sourceId" :disabled="busy"><option value="">—</option><option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option></select></label>
        <UiButton type="button" :disabled="busy || !selectedSource || draft.workspaces.length >= 20" @click="addSource">{{ t('workspaceTemplates.addSource') }}</UiButton>
        <template v-if="selectedSource">
          <p>{{ t('workspaceTemplates.chooseDetails') }}</p>
          <UiButton type="button" :disabled="busy" @click="draft.workspaces[draft.workspaces.length - 1]!.name = selectedSource.name">{{ t('workspaceTemplates.includeName') }}</UiButton>
          <label v-for="url in sourcePages" :key="url"><input v-model="draft.workspaces[draft.workspaces.length - 1]!.startPages" type="checkbox" :value="url" :disabled="busy" />{{ url }}</label>
        </template>
      </div>
      <p>{{ t('workspaceTemplates.source', { platform: draft.sourcePlatform }) }}</p>
      <fieldset v-for="(entry, index) in draft.workspaces" :key="index" :disabled="busy || completed || retained.length > 0">
        <legend>{{ t('workspaceTemplates.entry', { number: index + 1 }) }}</legend>
        <UiButton type="button" :disabled="draft.workspaces.length <= 1" @click="draft.workspaces.splice(index, 1)">{{ t('workspaceTemplates.remove', { number: index + 1 }) }}</UiButton>
        <label>{{ t('workspaceEditor.name') }}<input v-model="entry.name" maxlength="80" autocomplete="off" /></label>
        <label>{{ t('workspaceEditor.color') }}<select v-model="entry.color"><option v-for="color in BROWSER_TAB_GROUP_COLORS" :key="color" :value="color">{{ color }}</option></select></label>
        <label>{{ t('workspaceTemplates.pages') }}<textarea :value="entry.startPages.join('\n')" rows="3" spellcheck="false" @input="reviewed = false" @change="entry.startPages = ($event.target as HTMLTextAreaElement).value.split('\n').filter(line => line.trim()).map(line => line.trim())" /></label>
      </fieldset>
      <UiButton v-if="mode === 'export'" type="button" :disabled="busy || completed || draft.workspaces.length >= 20" @click="draft.workspaces.push({ name: nextWorkspaceTemplateName(draft.workspaces), color: 'blue', startPages: [] })">{{ t('workspaceTemplates.add') }}</UiButton>
      <p v-if="validation.error" role="alert">{{ validation.error }}</p>
      <p v-if="validation.collisions.length && !completed" role="alert">{{ t('workspaceTemplates.collisions', { names: validation.collisions.join(', ') }) }}</p>
      <p v-if="mode === 'import'">{{ t('workspaceTemplates.importEffect') }}</p>
      <label class="template-review"><input v-model="reviewed" type="checkbox" :disabled="busy || completed || retained.length > 0" />{{ t('workspaceTemplates.review') }}</label>
      <UiButton variant="primary" type="button" :disabled="!canCommit" @click="commit">{{ t(mode === 'import' ? 'workspaceTemplates.import' : 'workspaceTemplates.saveFile') }}</UiButton>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <template v-if="retained.length">
      <ul><li v-for="id in retained" :key="id">{{ state.mcpTabGroups.find(group => group.id === id)?.name ?? id }}</li></ul>
      <UiButton type="button" :disabled="busy" @click="cleanup">{{ t('workspaceTemplates.cleanup') }}</UiButton>
    </template>
  </section>
</template>

<style scoped>
.template-panel { display: grid; gap: 12px; padding: 18px; overflow: auto; }
.template-panel p { margin: 0; line-height: 1.5; }
.template-actions { display: flex; flex-wrap: wrap; gap: 8px; }
fieldset { display: grid; gap: 10px; min-width: 0; border: 1px solid var(--border-color, #8886); border-radius: 8px; padding: 12px; }
label { display: grid; gap: 6px; }
input:not([type=checkbox]), textarea, select { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: transparent; border: 1px solid var(--border-color, #8886); border-radius: 5px; padding: 8px; }
.template-review { display: flex; align-items: start; gap: 8px; }
textarea { resize: vertical; }
</style>
