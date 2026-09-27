<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserState, HronautApi } from '../../../shared/types.js'
import type { BrowserImportPreview, BrowserImportProfile, BrowserImportResponse, BrowserImportResult } from '../../../shared/browser-import.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{ workspaceId: string; state: BrowserState; browser: HronautApi; syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void> }>()
const emit = defineEmits<{ busy: [boolean]; close: [] }>()
const { t } = useI18n()
const profiles = ref<BrowserImportProfile[]>([])
const profileId = ref('')
const preview = ref<BrowserImportPreview | null>(null)
const result = ref<BrowserImportResult | null>(null)
const selected = ref<string[]>([])
const filter = ref('')
const busy = ref(false)
const writing = ref(false)
const error = ref('')
let generation = 0
const workspace = computed(() => props.state.mcpTabGroups.find(g => g.id === props.workspaceId) ?? props.state.savedTabGroups.find(g => g.id === props.workspaceId))
const archived = computed(() => props.state.savedTabGroups.some(g => g.id === props.workspaceId))
const sites = computed(() => preview.value?.sites.filter(s => s.domain.includes(filter.value.trim().toLowerCase())) ?? [])
function unwrap<T>(response: BrowserImportResponse<T>): T {
  if (!response.ok) throw new Error(t(`browserImport.errors.${response.error}`))
  return response.value
}
function setBusy(value: boolean): void { busy.value = value; emit('busy', value) }
async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  error.value = ''; setBusy(true)
  const current = generation
  try { await action() } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : t('browserImport.error') }
  finally { if (current === generation) setBusy(false) }
}
async function start(): Promise<void> {
  const current = ++generation
  preview.value = null; result.value = null; selected.value = []; filter.value = ''; profileId.value = ''; profiles.value = []
  await run(async () => {
    const next = unwrap(await props.browser.browserImport.list(props.workspaceId))
    if (current !== generation) return
    profiles.value = next; profileId.value = next[0]?.id ?? ''
  })
}
async function read(): Promise<void> {
  const current = generation
  const source = profileId.value
  await run(async () => {
    const next = unwrap(await props.browser.browserImport.preview(props.workspaceId, source))
    if (current !== generation || profileId.value !== source) return
    preview.value = next; selected.value = []
  })
}
function selectAll(): void { selected.value = [...new Set([...selected.value, ...sites.value.map(s => s.domain)])] }
async function archive(): Promise<void> {
  await run(async () => { await props.syncState(props.browser.saveAndCloseTabGroup(props.workspaceId)) })
}
async function commit(): Promise<void> {
  if (!preview.value || !selected.value.length || !archived.value) return
  const id = preview.value.id; const domains = [...selected.value]
  writing.value = true
  await run(async () => {
    result.value = unwrap(await props.browser.browserImport.commit(id, domains))
    preview.value = null
    await props.syncState(props.browser.getState())
  })
  writing.value = false
}
async function restore(): Promise<void> {
  await run(async () => { await props.syncState(props.browser.restoreSavedTabGroup(props.workspaceId)) })
}
function cancel(): void {
  if (writing.value) return
  generation++; setBusy(false)
  void props.browser.browserImport.cancel().catch(() => {})
  emit('close')
}
onMounted(() => { void start() })
onBeforeUnmount(() => { generation++; void props.browser.browserImport.cancel().catch(() => {}); emit('busy', false) })
</script>

<template>
  <section class="browser-import-panel" data-testid="browser-import-panel" :aria-busy="busy">
    <h3>{{ t('browserImport.title', { name: workspace?.name ?? '' }) }}</h3>
    <p>{{ t('browserImport.description') }}</p>
    <p class="workspace-transfer-help">{{ t('browserImport.agents') }}</p>
    <template v-if="result">
      <output role="status">{{ t('browserImport.result', { ...result }) }}</output>
      <p>{{ t('browserImport.paused') }}</p>
      <p v-if="result.recoveryRequired" role="alert">{{ t('browserImport.recovery') }}</p>
      <UiButton v-if="archived && !result.recoveryRequired" :disabled="busy" @click="restore">{{ t('browserImport.restore') }}</UiButton>
    </template>
    <template v-else-if="preview">
      <h4>{{ t('browserImport.choose') }}</h4>
      <p>{{ profiles.find(p => p.id === profileId)?.browser }} · {{ profiles.find(p => p.id === profileId)?.name }}</p>
      <label for="browser-import-filter">{{ t('browserImport.filter') }}</label>
      <input id="browser-import-filter" v-model="filter" type="search" :disabled="busy" />
      <div class="browser-import-actions">
        <UiButton :disabled="busy" @click="selectAll">{{ t(filter.trim() ? 'browserImport.matching' : 'browserImport.all') }}</UiButton>
        <UiButton :disabled="busy" @click="selected = []">{{ t('browserImport.clear') }}</UiButton>
      </div>
      <div class="browser-import-sites">
        <label v-for="site in sites" :key="site.domain">
          <input v-model="selected" type="checkbox" :value="site.domain" :disabled="busy" />
          <span>{{ site.domain }} <small v-if="site.includesSubdomains">{{ t('browserImport.subdomains') }}</small></span>
          <span>{{ site.count }}</span>
        </label>
      </div>
      <p role="status">{{ t('browserImport.selected', { selected: selected.length, total: preview.sites.length }) }}</p>
      <p v-if="preview.skipped">{{ t('browserImport.skipped', { count: preview.skipped }) }}</p>
      <p v-if="!preview.sites.length">{{ t('browserImport.empty') }}</p>
      <template v-if="!archived">
        <p>{{ t('browserImport.archiveHelp') }}</p>
        <UiButton :disabled="busy || state.allHumanInteractionLocked" @click="archive">{{ t('browserImport.archive') }}</UiButton>
      </template>
      <div class="browser-import-actions">
        <UiButton :disabled="busy" @click="start">{{ t('browserImport.back') }}</UiButton>
        <UiButton variant="primary" :disabled="busy || !selected.length || !archived || !workspace" @click="commit">{{ t('browserImport.commit', { name: workspace?.name ?? '' }) }}</UiButton>
      </div>
    </template>
    <template v-else>
      <label for="browser-import-profile">{{ t('browserImport.from') }}</label>
      <select id="browser-import-profile" v-model="profileId" :disabled="busy">
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.browser }} · {{ profile.name }}</option>
      </select>
      <p v-if="!busy && !profiles.length">{{ t('browserImport.empty') }}</p>
      <UiButton :disabled="busy || !profileId" @click="read">{{ t('browserImport.continue') }}</UiButton>
    </template>
    <p v-if="busy" role="status">{{ t('browserImport.working') }}</p>
    <p v-if="error" class="workspace-editor-error" role="alert">{{ error }}</p>
    <UiButton :disabled="writing" @click="cancel">{{ t(result ? 'common.close' : 'browserImport.cancel') }}</UiButton>
  </section>
</template>

<style scoped>
.browser-import-panel { display: grid; gap: 12px; min-height: 0; overflow: auto; padding: 18px; }
.browser-import-panel :is(h3, h4, p) { margin: 0; line-height: 1.5; }
.browser-import-panel h3 { font-size: 16px; font-weight: 650; }
.browser-import-panel :is(select, input[type=search]) { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; }
.browser-import-panel :is(select, input[type=search]):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.browser-import-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.browser-import-sites { max-height: 260px; overflow: auto; display: grid; gap: 4px; }
.browser-import-sites label { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; background: var(--surface); }
.browser-import-sites input { accent-color: var(--accent); }
.browser-import-sites label span:nth-child(2) { flex: 1; overflow-wrap: anywhere; }
.browser-import-sites small { display: block; opacity: 0.7; }
</style>
