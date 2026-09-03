<script setup lang="ts">
import { ref } from 'vue'
import type {
  BrowserState,
  BrowserTabState,
  HronautApi,
  SupportedLocale
} from '../../../shared/types.js'
import type { AddressBarController } from '../composables/useAddressBarController.js'
import type { AppActiveTabFeatureController } from '../composables/useAppActiveTabFeatureController.js'
import type { AppBrowserCollectionsFeatureController } from '../composables/useAppBrowserCollectionsFeatureController.js'
import type { AppEmulationFeatureController } from '../composables/useAppEmulationFeatureController.js'
import type { AppPageToolsFeatureController } from '../composables/useAppPageToolsFeatureController.js'
import type { AppPanelFeatureController } from '../composables/useAppPanelFeatureController.js'
import type { AppSettingsFeatureController } from '../composables/useAppSettingsFeatureController.js'
import type { AppShellPresentationFeatureController } from '../composables/useAppShellPresentationFeatureController.js'
import type { AppSiteManagementFeatureController } from '../composables/useAppSiteManagementFeatureController.js'
import type { AppTabRuntimeFeatureController } from '../composables/useAppTabRuntimeFeatureController.js'
import type { BrowserTabActionsController } from '../composables/useBrowserTabActionsController.js'
import type { SiteDataSummaryController } from '../composables/useSiteDataSummaryController.js'
import AppTopbarActions from './AppTopbarActions.vue'
import BrowserAddressBar from './BrowserAddressBar.vue'
import BrowserNavigationControls from './BrowserNavigationControls.vue'
import BrowserPageActions from './BrowserPageActions.vue'
import BrowserTabsBar from './BrowserTabsBar.vue'
import ShellTitleBarSurface from './ShellTitleBarSurface.vue'

export interface AppBrowserChromeLayerActions {
  openHome: () => unknown
  newTabInWorkspace: (groupId: string) => unknown
  openNewWorkspaceEditor: () => unknown
  toggleCommandPalette: () => unknown
  toggleTabSearch: () => unknown
  openFind: () => unknown
  toggleZoom: () => unknown
  togglePageTools: () => unknown
  prepareSplitViewMenu: () => void
  handleSplitViewError: (error: unknown, fallback: string) => void
}

const props = defineProps<{
  state: BrowserState
  hydrated: boolean
  locale: SupportedLocale
  browser: HronautApi
  shellController: AppShellPresentationFeatureController
  runtimeController: AppTabRuntimeFeatureController
  activeTabController: AppActiveTabFeatureController
  settingsController: AppSettingsFeatureController
  collectionsController: AppBrowserCollectionsFeatureController
  emulationController: AppEmulationFeatureController
  pageToolsController: AppPageToolsFeatureController
  panelController: AppPanelFeatureController
  siteController: AppSiteManagementFeatureController
  tabActionsController: BrowserTabActionsController
  addressController: AddressBarController
  siteDataController: SiteDataSummaryController
  formatNumber: (value: number) => string
  formatPercent: (value: number) => string
  runAction: (action: () => unknown) => Promise<boolean>
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  actions: AppBrowserChromeLayerActions
}>()

const commandPaletteOpen = defineModel<boolean>('commandPaletteOpen', { required: true })
const tabSearchOpen = defineModel<boolean>('tabSearchOpen', { required: true })
const zoomOpen = defineModel<boolean>('zoomOpen', { required: true })
const siteControlsOpen = defineModel<boolean>('siteControlsOpen', { required: true })
const splitMenuOpen = defineModel<boolean>('splitMenuOpen', { required: true })
const pageToolsOpen = defineModel<boolean>('pageToolsOpen', { required: true })
interface BrowserTabsBarHandle {
  expandTabGroup: (groupId: string) => void
  expandTabGroupForTab: (tab: BrowserTabState) => void
}

const browserTabsBar = ref<BrowserTabsBarHandle | null>(null)
const {
  overlayEnabled: customTitleBar,
  tabOrientation,
  compactVerticalTabRail,
  verticalTabRailCollapsed,
  verticalTabRailPinned,
  verticalTabRailRevealed,
  revealVerticalTabRail,
  concealVerticalTabRail,
  handleVerticalTabRailFocusOut,
  toggleVerticalTabRailPinned,
  panelDock
} = props.shellController
const { activeTab, mcpActivityByTab } = props.runtimeController
const {
  activeTabPresentationController,
  activeIsHome,
  activeDownloads,
  currentBookmark,
  downloadButtonLabel,
  effectiveHumanInteractionLocked,
  tabHumanInteractionLocked,
  tabInteractionLockLabel,
  allInteractionLockLabel,
  tabTooltip,
  describeTabEmulation
} = props.activeTabController
const {
  settingsDialogController,
  updateSettingsController,
  mcpStatusController,
  sitePermissionsController,
  showUpdateStatusPill,
  settings,
  toggleFollowAgentActivity
} = props.settingsController
const { state: updateState } = updateSettingsController
const { open: settingsOpen, toggle: toggleSettings } = settingsDialogController
const {
  downloads,
  downloadsOpen,
  bookmarksOpen,
  historyOpen,
  toggleDownloads,
  toggleBookmarks,
  toggleVisitHistory
} = props.collectionsController
const { emulationController, resetActiveTabEmulation } = props.emulationController
const {
  pageToolsPresentationController,
  areaCaptureState,
  areaCaptureLabel,
  elementPickerState,
  elementPickerTitle,
  elementPickerLabel,
  toggleAreaCapture,
  toggleElementPicker
} = props.pageToolsController
const { openRequestConditions } = props.panelController
const {
  toggleSiteControls,
  openSitePermissionSettings,
  openSitePrivacySettings,
  openUpdateSettings
} = props.siteController
const {
  reorderTab,
  selectBrowserTab,
  showWorkspaceContextMenu,
  closeTab,
  toggleTabMuted,
  toggleTabHumanInteraction,
  toggleAllHumanInteraction
} = props.tabActionsController
const {
  setDecision: setSitePermissionDecision,
  remove: removeSitePermission
} = sitePermissionsController

function expandTabGroup(groupId: string): void {
  browserTabsBar.value?.expandTabGroup(groupId)
}

function expandTabGroupForTab(tab: BrowserTabState): void {
  browserTabsBar.value?.expandTabGroupForTab(tab)
}

function selectTab(tabId: string): void {
  tabSearchOpen.value = false
  void props.runAction(() => selectBrowserTab(tabId))
}

function startTabDrag(): void {
  tabSearchOpen.value = false
}

defineExpose({ expandTabGroup, expandTabGroupForTab })
</script>

<template>
  <ShellTitleBarSurface
    v-if="customTitleBar && tabOrientation === 'vertical'"
    kind="rail"
    :draggable="customTitleBar"
  />
  <ShellTitleBarSurface
    v-if="customTitleBar && activeIsHome && tabOrientation === 'vertical'"
    kind="home"
    :draggable="customTitleBar"
  />
  <div
    class="topbar"
    :class="{
      'rail-collapsed': tabOrientation === 'vertical' && verticalTabRailCollapsed,
      'compact-vertical-tab-rail': compactVerticalTabRail
    }"
    :data-titlebar-drag-surface="customTitleBar && tabOrientation === 'horizontal' ? '' : undefined"
    @mouseenter="revealVerticalTabRail"
    @mouseleave="concealVerticalTabRail"
    @focusin="revealVerticalTabRail"
    @focusout="handleVerticalTabRailFocusOut"
  >
    <BrowserTabsBar
      ref="browserTabsBar"
      :state="state"
      :hydrated="hydrated"
      :orientation="tabOrientation"
      :rail-pinned="verticalTabRailPinned"
      :rail-revealed="verticalTabRailRevealed"
      :force-rail-collapsed="compactVerticalTabRail && verticalTabRailCollapsed"
      :mcp-activity-by-tab="mcpActivityByTab"
      :format-number="formatNumber"
      :tab-tooltip="tabTooltip"
      :describe-emulation="describeTabEmulation"
      @open-home="runAction(actions.openHome)"
      @show-workspace-context-menu="runAction(() => showWorkspaceContextMenu($event))"
      @new-tab="runAction(() => actions.newTabInWorkspace($event))"
      @create-workspace="runAction(actions.openNewWorkspaceEditor)"
      @select-tab="selectTab"
      @show-tab-context-menu="runAction(() => browser.showTabContextMenu($event))"
      @reorder-tab="runAction(() => reorderTab($event))"
      @toggle-tab-muted="runAction(() => toggleTabMuted($event))"
      @close-tab="runAction(() => closeTab($event))"
      @drag-start="startTabDrag"
      @toggle-rail-pinned="toggleVerticalTabRailPinned"
    />
    <AppTopbarActions
      :command-palette-open="commandPaletteOpen"
      :tab-search-open="tabSearchOpen"
      :downloads-open="downloadsOpen"
      :history-open="historyOpen"
      :settings-open="settingsOpen"
      :downloads="downloads"
      :active-downloads="activeDownloads"
      :download-button-label="downloadButtonLabel"
      :all-interaction-locked="state.allHumanInteractionLocked"
      :all-interaction-lock-label="allInteractionLockLabel"
      :follow-agent-activity="settings.followAgentActivity"
      :show-update-status="showUpdateStatusPill"
      :update-state="updateState"
      :mcp-status-controller="mcpStatusController"
      @toggle-command-palette="runAction(actions.toggleCommandPalette)"
      @toggle-tab-search="runAction(actions.toggleTabSearch)"
      @toggle-downloads="runAction(toggleDownloads)"
      @toggle-history="runAction(toggleVisitHistory)"
      @toggle-all-interaction="runAction(toggleAllHumanInteraction)"
      @toggle-follow-agent-activity="runAction(toggleFollowAgentActivity)"
      @open-update-settings="runAction(openUpdateSettings)"
      @toggle-settings="runAction(toggleSettings)"
    />
  </div>
  <div
    v-if="!activeIsHome"
    class="toolbar"
    :data-titlebar-drag-surface="customTitleBar && tabOrientation === 'vertical' ? '' : undefined"
  >
    <BrowserNavigationControls
      :active-tab="activeTab"
      :zoom-open="zoomOpen"
      :bookmarks-open="bookmarksOpen"
      :current-bookmark="Boolean(currentBookmark)"
      :format-percent="formatPercent"
      @back="runAction(() => syncState(browser.back()))"
      @forward="runAction(() => syncState(browser.forward()))"
      @reload="runAction(() => syncState(browser.reload()))"
      @stop="runAction(() => syncState(browser.stop()))"
      @find="runAction(actions.openFind)"
      @toggle-zoom="runAction(actions.toggleZoom)"
      @toggle-bookmarks="runAction(toggleBookmarks)"
    >
      <BrowserAddressBar
        v-model:site-controls-open="siteControlsOpen"
        v-model:panel-dock="panelDock"
        :address-controller="addressController"
        :active-tab-presentation="activeTabPresentationController"
        :emulation-controller="emulationController"
        :page-tools-presentation="pageToolsPresentationController"
        :site-data-controller="siteDataController"
        :site-permissions-controller="sitePermissionsController"
        :locale="locale"
        :format-number="formatNumber"
        :run-action="runAction"
        :actions="{
          toggleSiteControls,
          resetActiveTabEmulation,
          openRequestConditions,
          setSitePermission: setSitePermissionDecision,
          resetSitePermission: removeSitePermission,
          openSitePermissionSettings,
          openSitePrivacySettings
        }"
      />
    </BrowserNavigationControls>
    <BrowserPageActions
      v-model:split-menu-open="splitMenuOpen"
      :state="state"
      :active-tab="activeTab"
      :browser="browser"
      :accept-state="syncState"
      :close-other-menus="actions.prepareSplitViewMenu"
      :effective-human-interaction-locked="effectiveHumanInteractionLocked"
      :tab-human-interaction-locked="tabHumanInteractionLocked"
      :tab-interaction-lock-label="tabInteractionLockLabel"
      :area-capture-state="areaCaptureState"
      :area-capture-label="areaCaptureLabel"
      :element-picker-state="elementPickerState"
      :element-picker-title="elementPickerTitle"
      :element-picker-label="elementPickerLabel"
      :page-tools-open="pageToolsOpen"
      @toggle-tab-interaction="runAction(toggleTabHumanInteraction)"
      @toggle-area-capture="runAction(toggleAreaCapture)"
      @toggle-element-picker="runAction(() => toggleElementPicker('context'))"
      @toggle-page-tools="actions.togglePageTools"
      @split-error="actions.handleSplitViewError"
    />
  </div>
</template>
