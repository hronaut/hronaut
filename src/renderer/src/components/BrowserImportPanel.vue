<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserState, HronautApi } from '../../../shared/types.js'
import type { BrowserImportErrorCode, BrowserImportPreview, BrowserImportProfile, BrowserImportResponse, BrowserImportResult } from '../../../shared/browser-import.js'
import UiButton from '../ui/UiButton.vue'
import { friendlyUiError } from '../composables/useAppToastController.js'

/** How to fix a browser key error: install the missing tool with one of these commands, or unlock the keyring or wallet. */
type KeyFix = { kind: 'install'; tool: string; commands: readonly { system: string; command: string }[] } | { kind: 'unlock' }
// Package names and commands read the same in every language, so they live here and not in the locales.
const KEY_FIXES: Partial<Record<BrowserImportErrorCode, KeyFix>> = {
  secretToolMissing: { kind: 'install', tool: 'secret-tool', commands: [
    { system: 'Ubuntu, Debian', command: 'sudo apt install libsecret-tools' },
    { system: 'Fedora', command: 'sudo dnf install libsecret' },
    { system: 'Arch', command: 'sudo pacman -S libsecret' }
  ] },
  kwalletQueryMissing: { kind: 'install', tool: 'kwallet-query', commands: [
    { system: 'Ubuntu 25.04+, Debian 13+', command: 'sudo apt install kwallet6' },
    { system: 'Ubuntu 24.04, Debian 12', command: 'sudo apt install libkf5wallet-bin' },
    { system: 'Fedora', command: 'sudo dnf install kf6-kwallet' },
    { system: 'Arch', command: 'sudo pacman -S kwallet' }
  ] },
  keyUnavailable: { kind: 'unlock' }
}
/** A refusal from the main process that keeps its code, so the panel can say how to fix it. */
class BrowserImportFailure extends Error {
  constructor(readonly code: BrowserImportErrorCode, message: string) { super(message) }
}

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
const previewConsumed = ref(false)
const error = ref('')
const errorCode = ref<BrowserImportErrorCode>()
const copied = ref('')
const copyFailed = ref(false)
let generation = 0
let copyRequest = 0
const workspace = computed(() => props.state.mcpTabGroups.find(g => g.id === props.workspaceId) ?? props.state.savedTabGroups.find(g => g.id === props.workspaceId))
const archived = computed(() => props.state.savedTabGroups.some(g => g.id === props.workspaceId))
const sites = computed(() => preview.value?.sites.filter(s => s.domain.includes(filter.value.trim().toLowerCase())) ?? [])
const keyFix = computed(() => errorCode.value && KEY_FIXES[errorCode.value])
function unwrap<T>(response: BrowserImportResponse<T>): T {
  if (!response.ok) throw new BrowserImportFailure(response.error, t(`browserImport.errors.${response.error}`))
  return response.value
}
function setBusy(value: boolean): void { busy.value = value; emit('busy', value) }
async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  error.value = ''; errorCode.value = undefined; copied.value = ''; copyFailed.value = false; copyRequest++; setBusy(true)
  const current = generation
  try { await action() } catch (cause) {
    if (current !== generation) return
    error.value = friendlyUiError(cause, t('browserImport.error'))
    errorCode.value = cause instanceof BrowserImportFailure ? cause.code : undefined
  }
  finally { if (current === generation) setBusy(false) }
}
/**
 * The ID a new list gives the chosen profile, or none when it can't be told apart: Firefox profiles in different
 * folders can read the same, so only a single match is surely the chosen one.
 */
function chosenAgain(chosen: BrowserImportProfile | undefined, listed: BrowserImportProfile[]): string {
  const matches = listed.filter(p => p.browser === chosen?.browser && p.name === chosen?.name)
  return matches.length === 1 ? matches[0].id : ''
}
async function start(): Promise<void> {
  const current = ++generation
  // Back lists the profiles again under new IDs, so the chosen one is found again by browser and name, and Continue
  // reads the profile the person picked. When it can't be found, nothing is chosen for them.
  const chosen = profiles.value.find(p => p.id === profileId.value)
  preview.value = null; previewConsumed.value = false; result.value = null; selected.value = []; filter.value = ''; profileId.value = ''; profiles.value = []
  await run(async () => {
    const next = unwrap(await props.browser.browserImport.list(props.workspaceId))
    if (current !== generation) return
    profiles.value = next; profileId.value = chosen ? chosenAgain(chosen, next) : next[0]?.id ?? ''
  })
}
async function read(): Promise<void> {
  const current = generation
  let source = profileId.value
  await run(async () => {
    let response = await props.browser.browserImport.preview(props.workspaceId, source)
    // Hronaut forgets the listed profiles five minutes after listing them, or when the workspace changes, so Continue
    // then lists them again and goes on with the same profile, which the new list names by a new ID.
    if (!response.ok && response.error === 'expired') {
      // A preview that ends after Cancel or closing the panel answers expired too, and must not list them again.
      if (current !== generation || profileId.value !== source) return
      const chosen = profiles.value.find(p => p.id === source)
      const listed = unwrap(await props.browser.browserImport.list(props.workspaceId))
      if (current !== generation || profileId.value !== source) return
      profiles.value = listed; profileId.value = chosenAgain(chosen, listed)
      if (!profileId.value) throw new Error(t('browserImport.errors.expired'))
      source = profileId.value
      response = await props.browser.browserImport.preview(props.workspaceId, source)
    }
    const next = unwrap(response)
    if (current !== generation || profileId.value !== source) return
    preview.value = next; previewConsumed.value = false; selected.value = []
  })
}
async function copyCommand(command: string): Promise<void> {
  const request = ++copyRequest
  copied.value = ''; copyFailed.value = false
  try {
    await props.browser.copyText(command)
    if (request === copyRequest) copied.value = command
  } catch { if (request === copyRequest) copyFailed.value = true }
}
function selectAll(): void { selected.value = [...new Set([...selected.value, ...sites.value.map(s => s.domain)])] }
async function commit(): Promise<void> {
  if (busy.value || previewConsumed.value || !preview.value || !selected.value.length) return
  const id = preview.value.id; const domains = [...selected.value]
  writing.value = true
  await run(async () => {
    // Treat dispatched previews as consumed, including ambiguous transport failures.
    // Keep Back available, but require a fresh preview before another write.
    previewConsumed.value = true
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
    <div class="browser-import-body">
      <h3>{{ t('browserImport.title', { name: workspace?.name ?? '' }) }}</h3>
      <p v-if="!preview && !result">{{ t('browserImport.description') }}</p>
      <p class="workspace-transfer-help">{{ t('browserImport.agents') }}</p>
      <template v-if="result">
        <output role="status">{{ t('browserImport.result', { ...result }) }}</output>
        <p>{{ t('browserImport.paused') }}</p>
        <p v-if="!archived">{{ t('browserImport.liveHelp') }}</p>
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
        <p v-if="!archived" class="workspace-transfer-help">{{ t('browserImport.liveHelp') }}</p>
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
      <section v-if="error && keyFix" class="browser-import-fix" aria-labelledby="browser-import-fix-title" data-testid="browser-import-fix">
        <h4 id="browser-import-fix-title">{{ t('browserImport.fix.title') }}</h4>
        <ol>
          <li v-if="keyFix.kind === 'unlock'">{{ t('browserImport.fix.unlock') }}</li>
          <li v-else>
            {{ t('browserImport.fix.install', { tool: keyFix.tool }) }}
            <ul class="browser-import-commands">
              <li v-for="(row, index) in keyFix.commands" :key="row.command">
                <span>{{ row.system }}</span>
                <code :id="`browser-import-command-${index}`">{{ row.command }}</code>
                <UiButton size="small" :aria-describedby="`browser-import-command-${index}`" @click="copyCommand(row.command)">{{ t(copied === row.command ? 'browserImport.fix.copied' : 'browserImport.fix.copy') }}</UiButton>
              </li>
            </ul>
          </li>
          <li>{{ t('browserImport.fix.retry', { button: t('browserImport.continue') }) }}</li>
        </ol>
        <p v-if="copyFailed" role="alert">{{ t('browserImport.fix.copyFailed') }}</p>
      </section>
    </div>
    <div class="browser-import-footer">
      <div v-if="preview" class="browser-import-actions">
        <UiButton :disabled="busy" @click="start">{{ t('browserImport.back') }}</UiButton>
        <UiButton variant="primary" :disabled="busy || previewConsumed || !selected.length || !workspace" @click="commit">{{ t('browserImport.commit', { name: workspace?.name ?? '' }) }}</UiButton>
      </div>
      <UiButton :disabled="writing" @click="cancel">{{ t(result ? 'common.close' : 'browserImport.cancel') }}</UiButton>
    </div>
  </section>
</template>

<style scoped>
.browser-import-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.browser-import-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: auto; padding: 18px; }
.browser-import-body > * { flex-shrink: 0; }
.browser-import-footer { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-top: 1px solid var(--border-soft); }
.browser-import-panel :is(h3, h4, p) { margin: 0; line-height: 1.5; }
.browser-import-panel h3 { font-size: var(--type-title-size); font-weight: var(--weight-strong); }
.browser-import-panel :is(select, input[type=search]) { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px; border: 1px solid var(--border); border-radius: var(--corner-2); background-color: var(--surface); color: var(--text); font: inherit; }
.browser-import-panel select { padding-right: 28px; }
.browser-import-panel :is(select, input[type=search]):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.browser-import-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.browser-import-sites { height: clamp(240px, 35vh, 360px); overflow: auto; display: grid; align-content: start; gap: 4px; }
.browser-import-sites label { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--corner-1); background: var(--surface); }
.browser-import-sites label span:nth-child(2) { flex: 1; overflow-wrap: anywhere; }
.browser-import-sites small { display: block; opacity: 0.7; }
.browser-import-fix { display: grid; gap: 8px; }
.browser-import-fix ol { display: grid; gap: 8px; margin: 0; padding-left: 20px; line-height: 1.5; }
.browser-import-commands { display: grid; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.browser-import-commands li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 8px; padding: 8px; border-radius: var(--corner-1); background: var(--surface); }
.browser-import-commands span { grid-column: 1 / -1; color: var(--text-muted); font-size: var(--type-small-size); }
.browser-import-commands code { font-family: var(--font-code); overflow-wrap: anywhere; user-select: text; }
</style>
