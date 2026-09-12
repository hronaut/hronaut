<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconFolder from '~icons/material-symbols/folder-open-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconArchive from '~icons/material-symbols/archive-outline-rounded'
import type { BrowserState, HronautApi } from '../../../shared/types.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import UiButton from '../ui/UiButton.vue'
import UiTabs from '../ui/UiTabs.vue'

const props = defineProps<{
  state: BrowserState
  browser: Pick<HronautApi, 'selectTab' | 'newTab' | 'saveAndCloseTabGroup' | 'restoreSavedTabGroup' | 'deleteSavedTabGroup'>
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
}>()
const emit = defineEmits<{
  create: []
  edit: [id: string]
  templates: []
  transfer: [id: string]
  close: []
  busy: [busy: boolean]
}>()
const { t } = useI18n({ useScope: 'global' })
const query = ref('')
const view = ref('open')
const pending = ref<string | null>(null)
const error = ref('')
const notice = ref('')
const archivedId = ref<string | null>(null)
let disposed = false
onBeforeUnmount(() => { disposed = true })
const workspaces = computed(() => [
  ...props.state.mcpTabGroups.map(group => ({ ...group, archived: false, timestamp: group.lastUsedAt,
    tabs: props.state.tabs.filter(tab => tab.mcpGroupId === group.id) })),
  ...props.state.savedTabGroups.map(group => ({ ...group, archived: true, timestamp: group.savedAt,
    tabCount: group.tabs.length, activeTabId: null }))
].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.name.localeCompare(b.name)))
const visible = computed(() => workspaces.value.filter(group => group.archived === (view.value === 'archived'))
  .filter(group => `${group.name} ${group.tabs.map(tab => `${tab.title} ${tab.url}`).join(' ')}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const currentId = computed(() => props.state.tabs.find(tab => tab.id === props.state.activeTabId)?.mcpGroupId)
const canUndo = computed(() => props.state.savedTabGroups.some(group => group.id === archivedId.value))
const items = computed(() => [
  { id: 'open', label: `${t('workspaceLibrary.open')} (${props.state.mcpTabGroups.length})` },
  { id: 'archived', label: `${t('workspaceLibrary.archived')} (${props.state.savedTabGroups.length})` }
])

type Workspace = (typeof workspaces.value)[number]
async function act(group: Workspace, action: 'open' | 'archive' | 'restore' | 'delete'): Promise<void> {
  if (pending.value || (props.state.allHumanInteractionLocked && (action === 'archive' || action === 'delete'))) return
  if (action === 'delete' && !window.confirm(t('workspaceLibrary.deleteConfirm', { name: group.name }))) return
  pending.value = group.id
  error.value = ''
  notice.value = ''
  emit('busy', true)
  try {
    if (action === 'archive') await props.syncState(props.browser.saveAndCloseTabGroup(group.id))
    else if (action === 'delete') await props.syncState(props.browser.deleteSavedTabGroup(group.id))
    else if (group.archived) await props.syncState(props.browser.restoreSavedTabGroup(group.id))
    else {
      const tabId = group.activeTabId ?? props.state.tabs.find(tab => tab.mcpGroupId === group.id)?.id
      await props.syncState(tabId ? props.browser.selectTab(tabId) : props.browser.newTab({ mcpGroupId: group.id, active: true }))
    }
    if (disposed) return
    if (action === 'open') emit('close')
    else if (action === 'archive') {
      archivedId.value = group.id
      notice.value = t('workspaceLibrary.archiveNotice', { name: group.name })
    } else {
      archivedId.value = null
      notice.value = t(action === 'restore' ? 'workspaceLibrary.restoreNotice' : 'workspaceLibrary.deleteNotice', { name: group.name })
    }
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : t('workspaceLibrary.actionError')
  } finally {
    if (!disposed) { pending.value = null; emit('busy', false) }
  }
}
async function undoArchive(): Promise<void> {
  const group = workspaces.value.find(group => group.id === archivedId.value && group.archived)
  if (group) await act(group, 'restore')
}
</script>

<template>
  <div class="workspace-library">
    <div class="workspace-library-intro">
      <div><h3>{{ t('workspaceLibrary.heading') }}</h3><p>{{ t('workspaceLibrary.description') }}</p></div>
      <UiButton variant="primary" :disabled="Boolean(pending)" @click="emit('create')"><IconAdd aria-hidden="true" />{{ t('workspaceEditor.create') }}</UiButton>
    </div>
    <div class="workspace-library-tools">
      <label class="workspace-library-search"><IconSearch aria-hidden="true" /><input v-model="query" type="search" :aria-label="t('workspaceLibrary.search')" :placeholder="t('workspaceLibrary.search')" autofocus /></label>
      <UiButton variant="ghost" :disabled="Boolean(pending)" @click="emit('templates')">{{ t('workspaceTemplates.title') }}</UiButton>
    </div>
    <div v-if="notice" class="workspace-library-notice" role="status"><span>{{ notice }}</span><UiButton v-if="canUndo" size="small" :disabled="Boolean(pending)" @click="undoArchive">{{ t('workspaceLibrary.undo') }}</UiButton></div>
    <p v-if="error" class="workspace-editor-error" role="alert">{{ error }}</p>
    <UiTabs v-model="view" :items="items" :label="t('workspaceLibrary.views')">
      <p class="workspace-library-hint">{{ t(view === 'archived' ? 'workspaceLibrary.archiveHelp' : 'workspaceLibrary.openHelp') }}</p>
      <div v-if="visible.length" class="workspace-library-grid">
        <article v-for="group in visible" :key="group.id" class="workspace-card" :class="{ current: group.id === currentId }" :style="{ '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[group.color] }" :aria-label="group.name" :aria-busy="pending === group.id">
          <header><span class="workspace-card-icon"><IconProgress v-if="pending === group.id" class="state-spinner" aria-hidden="true" /><IconArchive v-else-if="group.archived" aria-hidden="true" /><IconFolder v-else aria-hidden="true" /></span><div><h4 :title="group.name">{{ group.name }}</h4><span>{{ t('settings.privacy.workspaceTabs', { count: group.tabCount }) }} · {{ t('settings.privacy.workspaceSites', { count: group.storageOriginCount ?? 0 }) }}</span></div><span v-if="group.id === currentId" class="workspace-card-current">{{ t('workspaceLibrary.current') }}</span></header>
          <div class="workspace-card-badges"><span>{{ t(group.agentAccess === false ? 'workspaceLibrary.personal' : 'workspaceLibrary.agentAccess') }}</span><span v-if="group.navigationPolicy.mode === 'restricted'">{{ t('workspaceLibrary.restricted') }}</span></div>
          <p class="workspace-card-preview">{{ group.tabs.slice(0, 2).map(tab => tab.title || tab.url).join(' · ') || t('workspaceLibrary.noTabs') }}</p>
          <footer>
            <UiButton variant="primary" size="small" :disabled="Boolean(pending)" @click="act(group, 'open')">{{ t(group.archived ? 'workspaceLibrary.restore' : 'workspaceLibrary.openWorkspace') }}</UiButton>
            <UiButton v-if="!group.archived" size="small" :disabled="Boolean(pending)" @click="emit('edit', group.id)">{{ t('settings.privacy.manageWorkspace') }}</UiButton>
            <UiButton v-else size="small" :disabled="Boolean(pending)" @click="emit('transfer', group.id)">{{ t('settings.privacy.transferData') }}</UiButton>
            <UiButton class="workspace-card-secondary" size="small" variant="ghost" :disabled="Boolean(pending) || state.allHumanInteractionLocked" @click="act(group, group.archived ? 'delete' : 'archive')">{{ t(group.archived ? 'workspaceLibrary.delete' : 'workspaceLibrary.archive') }}</UiButton>
          </footer>
        </article>
      </div>
      <div v-else class="workspace-library-empty"><IconFolder aria-hidden="true" /><h3>{{ t(query.trim() ? 'workspaceLibrary.noMatches' : view === 'archived' ? 'workspaceLibrary.noArchived' : 'workspaceLibrary.empty') }}</h3><p>{{ t(query.trim() ? 'workspaceLibrary.searchHelp' : view === 'archived' ? 'workspaceLibrary.archiveHelp' : 'workspaceLibrary.emptyHelp') }}</p><UiButton v-if="query.trim()" @click="query = ''">{{ t('workspaceLibrary.clearSearch') }}</UiButton><UiButton v-else-if="view === 'open'" variant="primary" :disabled="Boolean(pending)" @click="emit('create')">{{ t('workspaceEditor.create') }}</UiButton></div>
    </UiTabs>
  </div>
</template>
