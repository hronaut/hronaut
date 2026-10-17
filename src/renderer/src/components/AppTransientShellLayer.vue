<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, toRef } from 'vue'
import type { HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { useI18n } from 'vue-i18n'
import type { CommandPaletteCommandId } from '../../../shared/command-palette.js'
import type {
  BrowserState,
  BrowserBookmark,
  BrowserTabState,
  CredentialSummary,
  HronautApi,
  McpTabActivity,
  PanelDock,
  UserAttentionRequest
} from '../../../shared/types.js'
import type { AppBrowserCollectionsFeatureController } from '../composables/useAppBrowserCollectionsFeatureController.js'
import type { CommandPaletteView } from '../composables/useCommandPaletteShellController.js'
import type { AgentStepHistoryTarget } from '../composables/useAgentStepHistory.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import { useCommandPaletteSearch } from '../composables/useCommandPaletteSearch.js'
import type { SettingsSection } from '../composables/useSettingsDialogController.js'
import AgentStepsDialog from './AgentStepsDialog.vue'
import AppBrowserCollectionsLayer from './AppBrowserCollectionsLayer.vue'
import CommandPalette from './CommandPalette.vue'
import CredentialPicker from './CredentialPicker.vue'
import FindInPageBar from './FindInPageBar.vue'
import TabSearchPanel from './TabSearchPanel.vue'
import WorkspaceEditor from './WorkspaceEditor.vue'
import WorkspaceSwitcher from './WorkspaceSwitcher.vue'
import ZoomBar from './ZoomBar.vue'

type ZoomAction = 'in' | 'out' | 'reset'

const props = defineProps<{
  state: BrowserState
  activeTab?: BrowserTabState
  userAttention?: UserAttentionRequest | null
  mcpActivityByTab: Record<string, McpTabActivity>
  credentials: CredentialSummary[]
  collectionsController: AppBrowserCollectionsFeatureController
  activeUrl: string | null
  activeTitle: string
  currentBookmark?: BrowserBookmark
  activeOrigin: string | null
  helpDialogOpen: boolean
  settingsOpen: boolean
  websiteAvailable: boolean
  browser: HronautApi
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  selectTab: (tabId: string) => Promise<unknown>
  expandTabGroup: (tab: BrowserTabState) => void
  describeEmulation: (tab: BrowserTabState) => string
  formatNumber: (value: number) => string
  formatBytes: (value: number) => string
  formatDateTime: (value: Date | number | string) => string
  formatTime: (value: Date | number | string) => string
  formatPercent: (value: number) => string
  formatError: (cause: unknown, fallback: string) => string
  showError: (title: string, message: string) => void
  fillCredential: (credential: CredentialSummary) => unknown
  runCommand: (commandId: CommandPaletteCommandId) => unknown
  reportCommandError: (error: unknown, commandId: CommandPaletteCommandId) => void
  /** Opens Settings on a section, for the palette's settings results. */
  openSettingsSection: (section: SettingsSection) => unknown
  reportZoomError: (error: unknown) => void
  /** The agent and workspace whose steps "All steps" shows. */
  agentStepsTarget?: AgentStepHistoryTarget | null
}>()

const emit = defineEmits<{ newTab: []; searchTabs: []; createWorkspace: [] }>()
const tabSearchOpen = defineModel<boolean>('tabSearchOpen', { required: true })
const findOpen = defineModel<boolean>('findOpen', { required: true })
const zoomOpen = defineModel<boolean>('zoomOpen', { required: true })
const workspaceEditorOpen = defineModel<boolean>('workspaceEditorOpen', { required: true })
const credentialPickerOpen = defineModel<boolean>('credentialPickerOpen', { required: true })
const commandPaletteOpen = defineModel<boolean>('commandPaletteOpen', { required: true })
const commandPaletteView = defineModel<CommandPaletteView>('commandPaletteView', { default: 'commands' })
const agentStepsOpen = defineModel<boolean>('agentStepsOpen', { default: false })
// The palette shows one list at a time: commands, or the workspace switcher. Each list opens the palette on
// itself and only closes it while it is the one shown, so a late close from the other list changes nothing.
function paletteList(view: CommandPaletteView) {
  return computed({
    get: () => commandPaletteOpen.value && commandPaletteView.value === view,
    set: (open: boolean) => {
      if (open) {
        commandPaletteView.value = view
        commandPaletteOpen.value = true
      } else if (commandPaletteView.value === view) {
        commandPaletteOpen.value = false
      }
    }
  })
}
const commandsOpen = paletteList('commands')
const { t } = useI18n({ useScope: 'global' })
const presenceApi = (window as { hronautAgentPresence?: HronautAgentPresenceApi }).hronautAgentPresence
const paletteSearchPresence = presenceApi ? useAgentPresence(presenceApi) : undefined
const paletteSearch = useCommandPaletteSearch({
  state: toRef(props, 'state'),
  history: props.collectionsController.visitHistory,
  userAttention: toRef(props, 'userAttention'),
  ...(paletteSearchPresence ? { presence: paletteSearchPresence.snapshot } : {}),
  browser: props.browser,
  syncState: props.syncState,
  selectTab: props.selectTab,
  expandTabGroup: props.expandTabGroup,
  translate: (key, parameters, plural) => plural === undefined ? t(key, parameters ?? {}) : t(key, parameters ?? {}, plural),
  formatNumber: props.formatNumber,
  formatError: props.formatError,
  showError: props.showError,
  openHistoryEntry: props.collectionsController.openHistoryEntry,
  openSettingsSection: props.openSettingsSection
})
const workspaceSwitcherOpen = paletteList('workspaces')
const dock = defineModel<PanelDock>('dock', { required: true })

interface TabSearchSurface {
  openPanel: () => Promise<void>
  close: () => void
}

interface FindSurface {
  openForTab: (tab: BrowserTabState) => Promise<void>
  close: () => Promise<void>
}

interface ZoomSurface {
  openForTab: (tab: BrowserTabState) => Promise<void> | void
  close: () => void
  setZoom: (action: ZoomAction) => Promise<void>
}

interface WorkspaceEditorSurface {
  openImport: (workspaceId: string) => void
  openTemplates: () => void
  openTransfer: (sourceWorkspaceId?: string) => Promise<void>
  openExisting: (groupId: string) => Promise<void>
  openDecisions: (groupId: string) => Promise<void>
  openNew: () => Promise<void>
  close: () => void
}

interface PickerSurface {
  openPanel: () => Promise<void>
  close: () => void
}

const tabSearchPanel = ref<TabSearchSurface | null>(null)
const findBar = ref<FindSurface | null>(null)
const zoomBar = ref<ZoomSurface | null>(null)
const workspaceEditor = ref<WorkspaceEditorSurface | null>(null)
const credentialPicker = ref<PickerSurface | null>(null)
const commandPalette = ref<PickerSurface | null>(null)
const workspaceSwitcher = ref<PickerSurface | null>(null)

let unsubscribeHomeEditor: (() => void) | undefined
onMounted(() => {
  unsubscribeHomeEditor = props.browser.onHomeWorkspaceEditorRequested?.(request => {
    const editor = workspaceEditor.value
    if (!editor) return
    const operation = request.view === 'create' ? editor.openNew()
      : request.view === 'templates' ? editor.openTemplates()
      : request.view === 'import' ? editor.openImport(request.workspaceId)
      : request.view === 'edit' ? editor.openExisting(request.workspaceId)
      : editor.openTransfer(request.workspaceId)
    void Promise.resolve(operation).catch(error => props.showError('Workspaces', String(error)))
  })
})
onBeforeUnmount(() => {
  unsubscribeHomeEditor?.()
  paletteSearchPresence?.dispose()
})

// A step's tab may sit in a folded workspace; its group opens around it, as from the switcher.
async function showStepTab(tabId: string): Promise<unknown> {
  const tab = props.state.tabs.find((candidate) => candidate.id === tabId)
  if (tab) props.expandTabGroup(tab)
  return props.selectTab(tabId)
}

async function openTabSearch(): Promise<void> {
  await tabSearchPanel.value?.openPanel()
}

async function openWorkspaceTransfer(sourceWorkspaceId?: string): Promise<void> {
  closeTabSearch()
  await workspaceEditor.value?.openTransfer(sourceWorkspaceId)
}

function closeTabSearch(): void {
  tabSearchPanel.value?.close()
}

async function openFindForTab(tab: BrowserTabState): Promise<void> {
  await findBar.value?.openForTab(tab)
}

async function closeFind(): Promise<void> {
  await findBar.value?.close()
}

async function openZoomForTab(tab: BrowserTabState): Promise<void> {
  await zoomBar.value?.openForTab(tab)
}

function closeZoom(): void {
  zoomBar.value?.close()
}

async function setZoom(action: ZoomAction): Promise<void> {
  await zoomBar.value?.setZoom(action)
}

async function openWorkspace(groupId: string): Promise<void> {
  await workspaceEditor.value?.openExisting(groupId)
}

async function openWorkspaceDecisions(groupId: string): Promise<void> {
  await workspaceEditor.value?.openDecisions(groupId)
}

async function openNewWorkspace(): Promise<void> {
  await workspaceEditor.value?.openNew()
}

function closeWorkspace(): void {
  workspaceEditor.value?.close()
}

async function openCredentialPicker(): Promise<void> {
  await credentialPicker.value?.openPanel()
}

function closeCredentialPicker(): void {
  credentialPicker.value?.close()
}

async function openCommandPalette(view: CommandPaletteView = 'commands'): Promise<void> {
  commandPaletteView.value = view
  await (view === 'workspaces' ? workspaceSwitcher : commandPalette).value?.openPanel()
}

function closeCommandPalette(): void {
  ;(commandPaletteView.value === 'workspaces' ? workspaceSwitcher : commandPalette).value?.close()
}

defineExpose({
  openTabSearch,
  closeTabSearch,
  openFindForTab,
  closeFind,
  openZoomForTab,
  closeZoom,
  setZoom,
  openWorkspace,
  openWorkspaceDecisions,
  openWorkspaceTransfer,
  openNewWorkspace,
  closeWorkspace,
  openCredentialPicker,
  closeCredentialPicker,
  openCommandPalette,
  closeCommandPalette
})
</script>

<template>
  <TabSearchPanel
    ref="tabSearchPanel"
    v-model:open="tabSearchOpen"
    :state="state"
    :mcp-activity-by-tab="mcpActivityByTab"
    :sync-state="syncState"
    :select-tab="selectTab"
    :expand-tab-group="expandTabGroup"
    :describe-emulation="describeEmulation"
    :format-number="formatNumber"
    :format-time="formatTime"
    :format-error="formatError"
    :show-error="showError"
    @new-tab="emit('newTab')"
    @transfer-workspace-data="openWorkspaceTransfer"
  />
  <FindInPageBar ref="findBar" v-model:open="findOpen" :active-tab="activeTab" :browser="browser" />
  <ZoomBar
    ref="zoomBar"
    v-model:open="zoomOpen"
    :active-tab="activeTab"
    :browser="browser"
    :accept-state="syncState"
    :format-percent="formatPercent"
    @error="reportZoomError"
  />
  <AppBrowserCollectionsLayer
    v-model:dock="dock"
    :controller="collectionsController"
    :active-url="activeUrl"
    :active-title="activeTitle"
    :current-bookmark="currentBookmark"
    :format-bytes="formatBytes"
    :format-percent="formatPercent"
    :format-date-time="formatDateTime"
    :format-number="formatNumber"
  />
  <WorkspaceEditor
    ref="workspaceEditor"
    v-model:open="workspaceEditorOpen"
    :state="state"
    :sync-state="syncState"
    :format-number="formatNumber"
    :can-present="!commandPaletteOpen && !credentialPickerOpen && !helpDialogOpen && !settingsOpen"
  />
  <CredentialPicker
    ref="credentialPicker"
    v-model:open="credentialPickerOpen"
    :credentials="credentials"
    :origin="activeOrigin"
    :fill-credential="fillCredential"
  />
  <CommandPalette
    ref="commandPalette"
    v-model:open="commandsOpen"
    :website-available="websiteAvailable"
    :active-tab="activeTab"
    :agent-control-locked="state.agentControlLocked === true"
    :format-number="formatNumber"
    :run-command="runCommand"
    :report-command-error="reportCommandError"
    :search="paletteSearch.search"
    :open-result="paletteSearch.open"
  />
  <WorkspaceSwitcher
    ref="workspaceSwitcher"
    v-model:open="workspaceSwitcherOpen"
    :state="state"
    :user-attention="userAttention"
    :browser="browser"
    :sync-state="syncState"
    :select-tab="selectTab"
    :expand-tab-group="expandTabGroup"
    :format-number="formatNumber"
    :format-error="formatError"
    :show-error="showError"
    @search-tabs="emit('searchTabs')"
    @create-workspace="emit('createWorkspace')"
  />
  <AgentStepsDialog
    v-model:open="agentStepsOpen"
    :target="agentStepsTarget ?? null"
    :state="state"
    :select-tab="showStepTab"
    :format-time="formatTime"
    :format-number="formatNumber"
    :format-error="formatError"
    :show-error="showError"
  />
</template>
