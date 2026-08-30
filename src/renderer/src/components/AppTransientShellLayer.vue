<script setup lang="ts">
import { ref } from 'vue'
import type { CommandPaletteCommandId } from '../../../shared/command-palette.js'
import type {
  BrowserState,
  BrowserBookmark,
  BrowserTabState,
  CredentialSummary,
  HronautApi,
  McpTabActivity,
  PanelDock
} from '../../../shared/types.js'
import type { AppBrowserCollectionsFeatureController } from '../composables/useAppBrowserCollectionsFeatureController.js'
import AppBrowserCollectionsLayer from './AppBrowserCollectionsLayer.vue'
import CommandPalette from './CommandPalette.vue'
import CredentialPicker from './CredentialPicker.vue'
import FindInPageBar from './FindInPageBar.vue'
import TabSearchPanel from './TabSearchPanel.vue'
import WorkspaceEditor from './WorkspaceEditor.vue'
import ZoomBar from './ZoomBar.vue'

type ZoomAction = 'in' | 'out' | 'reset'

defineProps<{
  state: BrowserState
  activeTab?: BrowserTabState
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
  reportZoomError: (error: unknown) => void
}>()

const emit = defineEmits<{ newTab: [] }>()
const tabSearchOpen = defineModel<boolean>('tabSearchOpen', { required: true })
const findOpen = defineModel<boolean>('findOpen', { required: true })
const zoomOpen = defineModel<boolean>('zoomOpen', { required: true })
const workspaceEditorOpen = defineModel<boolean>('workspaceEditorOpen', { required: true })
const credentialPickerOpen = defineModel<boolean>('credentialPickerOpen', { required: true })
const commandPaletteOpen = defineModel<boolean>('commandPaletteOpen', { required: true })
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
  openExisting: (groupId: string) => Promise<void>
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

async function openTabSearch(): Promise<void> {
  await tabSearchPanel.value?.openPanel()
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

async function openCommandPalette(): Promise<void> {
  await commandPalette.value?.openPanel()
}

function closeCommandPalette(): void {
  commandPalette.value?.close()
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
    v-model:open="commandPaletteOpen"
    :website-available="websiteAvailable"
    :format-number="formatNumber"
    :run-command="runCommand"
    :report-command-error="reportCommandError"
  />
</template>
