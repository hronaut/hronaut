<script setup lang="ts">
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { applicationHasFocus } from '../composables/useModalDialogFocus.js'
import type {
  BrowserState,
  BrowserTabState,
  HronautApi,
  UserAttentionRequest,
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
import type { FullPageView } from '../composables/useFullPageView.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import { sidebarOverlayModel } from '../composables/sidebar-overlay-model.js'
import { useSidebarOverlay } from '../composables/useSidebarOverlay.js'
import type { SidebarOverlayIntent } from '../../../shared/sidebar-overlay.js'
import IconFullscreenExit from '~icons/material-symbols/fullscreen-exit-rounded'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'
import AgentLiveStrip from './AgentLiveStrip.vue'
import AgentPresenceAvatars from './AgentPresenceAvatars.vue'
import AgentTakeOverPrompt, { type AgentTakeOverBadge } from './AgentTakeOverPrompt.vue'
import AppTopbarActions from './AppTopbarActions.vue'
import BrowserAddressBar from './BrowserAddressBar.vue'
import BrowserNavigationControls from './BrowserNavigationControls.vue'
import BrowserPageActions from './BrowserPageActions.vue'
import BrowserTabsBar from './BrowserTabsBar.vue'
import PanelResizeHandle from './PanelResizeHandle.vue'
import ShellTitleBarSurface from './ShellTitleBarSurface.vue'

export interface AppBrowserChromeLayerActions {
  openHome: () => unknown
  newTabInWorkspace: (groupId?: string) => unknown
  openNewWorkspaceEditor: () => unknown
  /** Opens a workspace's settings, where its waiting decisions are reviewed. */
  reviewDecisions: (groupId: string) => unknown
  /** Opens an agent's "All steps" in a workspace. */
  showAgentSteps?: (clientKey: string, workspaceId: string) => unknown
  toggleCommandPalette: () => unknown
  toggleWorkspaceSwitcher: () => unknown
  toggleTabSearch: () => unknown
  openFind: () => unknown
  toggleZoom: () => unknown
  togglePageTools: () => unknown
  /** Opens License settings, from the top bar's reminder once agent access has ended. */
  openLicenseSettings: () => unknown
  prepareSplitViewMenu: () => void
  handleSplitViewError: (error: unknown, fallback: string) => void
}

const { t } = useI18n({ useScope: 'global' })

const props = defineProps<{
  state: BrowserState
  userAttention?: UserAttentionRequest | null
  /** The palette is open on its workspace list. */
  workspaceSwitcherOpen?: boolean
  /** Hides this chrome so a website fills the window, and shows it again at the window's edge. */
  fullPage: FullPageView
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
  toggleTabGroup?: (groupId: string) => void
  collapsedTabGroupIds?: ReadonlySet<string>
  tabListScrollTop?: () => number
  scrollTabListTo?: (top: number) => void
  stopWorkerCapture?: (tabId: string) => Promise<void>
}

const browserTabsBar = ref<BrowserTabsBarHandle | null>(null)
const {
  overlayEnabled: customTitleBar,
  setVerticalTabRailRevealed,
  tabOrientation,
  compactVerticalTabRail,
  verticalTabRailCollapsed,
  verticalTabRailCollapsing,
  verticalTabRailPinned,
  tabRailResize,
  verticalTabRailRevealed,
  revealVerticalTabRail,
  concealVerticalTabRail,
  handleVerticalTabRailFocusOut,
  toggleVerticalTabRailPinned,
  panelDock,
  keepsSeparatePanelOpen
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
  licenseAskController,
  showUpdateStatusPill,
  settings,
  toggleFollowAgentActivity,
  setFollowAgentActivity: setFollowAgentActivitySetting,
  setShowAgentCursor: setShowAgentCursorSetting,
  setPinAgentLiveStatus: setPinAgentLiveStatusSetting
} = props.settingsController
const { state: updateState } = updateSettingsController
const websiteTabs = computed(() => props.state.tabs.filter((tab) => !isHronautHomeUrl(tab.url)))
const allTabsMuted = computed(() => props.state.allTabsMuted === true)
const { open: settingsOpen, toggle: toggleSettings } = settingsDialogController
watch(settingsDialogController.tabOpen, async (present, _previous, onCleanup) => {
  if (present) return
  let current = true
  onCleanup(() => { current = false })
  await nextTick()
  if (!await applicationHasFocus() || !current) return
  document.querySelector<HTMLElement>('[data-active-tab="true"], .app-home-button.active')?.focus({ preventScroll: true })
})
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
async function listHistory(direction: 'back' | 'forward', anchor: { x: number; y: number }): Promise<boolean> {
  const tab = activeTab.value
  let shown = false
  if (tab) await props.runAction(async () => { shown = await props.browser.showHistoryMenu({ tabId: tab.id, direction, anchor }) })
  return shown
}
function openNavigationInNewTab(target: 'back' | 'forward' | 'reload', active: boolean): Promise<void> | undefined {
  const tab = activeTab.value
  return tab ? props.syncState(props.browser.openNavigationInNewTab({ tabId: tab.id, target, active })) : undefined
}
function clearActiveCssStatePreview(): Promise<void> | undefined {
  const tab = activeTab.value
  return tab?.cssStatePreview ? props.syncState(props.browser.clearCssStatePreview(tab.id)) : undefined
}
function stopActiveVirtualPasskey(): Promise<void> | undefined {
  const tab = activeTab.value
  return tab?.virtualPasskey ? props.syncState(props.browser.stopVirtualPasskey(tab.id)) : undefined
}
function stopActiveLogpoints(): Promise<void> | undefined {
  const tab = activeTab.value
  return tab?.logpoints ? props.syncState(props.browser.stopLogpoints(tab.id)) : undefined
}
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
  isTogglePending,
  reorderTab,
  selectBrowserTab,
  showWorkspaceContextMenu,
  closeTab,
  toggleTabMuted,
  toggleTabAgentPaused,
  setTabAgentPaused,
  togglePageLifecycle,
  toggleAllTabsMuted,
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
  settingsDialogController.close()
  tabSearchOpen.value = false
  void props.runAction(() => selectBrowserTab(tabId))
}

const agentPresenceAvatars = ref<{ openCard: (options?: { reopen?: boolean }) => boolean; focus: () => boolean; cardOpen: boolean } | null>(null)
const activeWorkspaceName = computed(() => {
  const workspaceId = activeTab.value?.mcpGroupId
  return workspaceId ? props.state.mcpTabGroups.find((group) => group.id === workspaceId)?.name : undefined
})

function setAgentPaused(tabId: string, paused: boolean): void {
  void props.runAction(() => setTabAgentPaused(tabId, paused))
}

// Taking over pauses agents on the tab first, so none of their steps lands after you start, and tells
// them you have control until you hand the tab back.
// Whatever you chose meanwhile wins: another take over, another tab, tab search or Settings.
let takeOverGeneration = 0
function takeOverTab(tabId: string): void {
  const generation = ++takeOverGeneration
  const before = { tabId: activeTab.value?.id, tabSearch: tabSearchOpen.value, settings: settingsOpen.value }
  void props.runAction(async () => {
    const paused = await setTabAgentPaused(tabId, true, { takeOver: true })
    if (!paused || generation !== takeOverGeneration || activeTab.value?.id !== before.tabId
      || (tabSearchOpen.value && !before.tabSearch) || (settingsOpen.value && !before.settings)) return
    settingsDialogController.close()
    tabSearchOpen.value = false
    await selectBrowserTab(tabId)
  })
}

function setFollowAgentActivity(follow: boolean): void {
  void props.runAction(() => setFollowAgentActivitySetting(follow))
}

function setShowAgentCursor(show: boolean): void {
  void props.runAction(() => setShowAgentCursorSetting(show))
}

function setPinAgentLiveStatus(pin: boolean): void {
  void props.runAction(() => setPinAgentLiveStatusSetting(pin))
}

// Main answers only the request still open with this id; an answer from an older card changes nothing.
function answerAttention(id: string, answer: 'resolved' | 'dismissed'): void {
  void props.runAction(() => props.browser.answerUserAttention(id, answer))
}

/** Opens an agent card for the workspace in view; false when it has no agents. */
function openAgentCard(): boolean {
  return agentPresenceAvatars.value?.openCard() ?? false
}

const agentTakeOver = ref<{ takeOver: () => boolean; offerText: string; badge?: AgentTakeOverBadge } | null>(null)

/** Takes over from the agent working on the page you just touched; false when none is offered. */
function takeOverFromAgent(): boolean {
  return agentTakeOver.value?.takeOver() ?? false
}

// The strip's Answer shows the card even when it was open, since pressing Answer closes it.
function answerInAgentCard(): void {
  agentPresenceAvatars.value?.openCard({ reopen: true })
}

// Unpinning removes the strip with its focused chevron; focus moves to the agent's avatar, or the
// address field, unless you have put it somewhere else meanwhile.
function unpinLiveStrip(): void {
  void props.runAction(async () => {
    await setPinAgentLiveStatusSetting(false)
    await nextTick()
    if (document.activeElement && document.activeElement !== document.body) return
    if (!agentPresenceAvatars.value?.focus()) document.querySelector<HTMLElement>('.toolbar .address-form input')?.focus({ preventScroll: true })
  })
}

const { active: fullPageActive, concealed: fullPageConcealed } = props.fullPage
// An agent card sits under its avatar, so the chrome stays in view while one is open. The avatars own that
// state: a toolbar that leaves and comes back starts with no card.
props.fullPage.holdWhile(() => agentPresenceAvatars.value?.cardOpen === true)
const chrome = ref<HTMLElement | null>(null)
// The view can start while you work in the chrome, as from the address field; it stays in view until you leave.
watch(fullPageActive, (active) => {
  if (active && chrome.value) props.fullPage.sync(chrome.value)
})
// The band names the page, or offers to take over from the agent working on it once you touch it; resting on
// the band shows the toolbar with the button.
const fullPageTitle = computed(() => agentTakeOver.value?.offerText
  || activeTab.value?.label || (activeTab.value ? tabTitleForDisplay(activeTab.value, t('tabSearch.newTabTitle')) : ''))

// The exit button leaves with the view, whether it is pressed or the view ends by shortcut, menu or palette
// while it has focus; focus moves to the active tab, or the address field, rather than out of the window.
watch(props.fullPage.enabled, (enabled) => {
  if (enabled || !document.activeElement?.closest('.full-page-exit-button')) return
  void nextTick(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    const target = document.querySelector<HTMLElement>('[data-active-tab="true"]')
      ?? document.querySelector<HTMLElement>('.toolbar .address-form input')
    target?.focus()
  })
})

function startTabDrag(): void {
  tabSearchOpen.value = false
}

// With the rail collapsed when not in use, the pointer opens it over the page in main's own view; this rail stays
// folded, so the page keeps its place. The view draws what this rail would show and hands back what the person does,
// which runs here as a click in this rail would. Without main's channel the rail opens beside the page as before.
const topbar = ref<HTMLElement | null>(null)
const sidebarOverlayApi = window.hronautSidebarOverlay
if (sidebarOverlayApi) {
  const shell = props.shellController
  watch(fullPageActive, (active) => shell.setVerticalTabRailOverlayAvailable(!active), { immediate: true })
  const root = document.documentElement
  const readAppearance = (): { theme: string | undefined; tint: string } => ({ theme: root.dataset.theme, tint: root.style.getPropertyValue('--workspace-tint') })
  const appearance = ref(readAppearance())
  const appearanceObserver = new MutationObserver(() => { appearance.value = readAppearance() })
  appearanceObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] })
  const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
  const updateViewport = (): void => { viewport.value = { width: window.innerWidth, height: window.innerHeight } }
  window.addEventListener('resize', updateViewport)
  const presence = window.hronautAgentPresence ? useAgentPresence(window.hronautAgentPresence) : undefined
  onBeforeUnmount(() => {
    appearanceObserver.disconnect()
    window.removeEventListener('resize', updateViewport)
    presence?.dispose()
  })
  const { state: mcpState, endpoint: mcpEndpoint, pauseBusy: mcpPauseBusy } = mcpStatusController
  useSidebarOverlay({
    api: sidebarOverlayApi,
    overlaid: shell.verticalTabRailOverlaid,
    model: () => sidebarOverlayModel({
      theme: appearance.value.theme,
      locale: props.locale,
      platform: window.hronautShell?.windowChrome.platform ?? 'linux',
      width: shell.expandedTabRailWidth.value,
      // The rail starts below a title bar the shell draws over it.
      top: topbar.value ? Number.parseFloat(getComputedStyle(topbar.value).paddingTop) || 0 : 0,
      viewport: viewport.value,
      tint: appearance.value.tint,
      state: props.state,
      settingsActive: settingsOpen.value,
      workspaceSwitcherOpen: props.workspaceSwitcherOpen === true,
      userAttention: props.userAttention,
      collapsedWorkspaceIds: browserTabsBar.value?.collapsedTabGroupIds ?? [],
      agents: presence?.snapshot.value.workspaces ?? {},
      scrollTop: browserTabsBar.value?.tabListScrollTop?.() ?? 0,
      mcpActivityByTab: mcpActivityByTab.value,
      tabTooltip,
      describeEmulation: describeTabEmulation,
      footer: {
        commandPaletteOpen: commandPaletteOpen.value && !props.workspaceSwitcherOpen,
        tabSearchOpen: tabSearchOpen.value,
        downloadsOpen: downloadsOpen.value,
        historyOpen: historyOpen.value,
        settingsOpen: settingsOpen.value,
        downloads: downloads.value,
        activeDownloads: activeDownloads.value,
        downloadButtonLabel: downloadButtonLabel.value,
        hasWebsiteTabs: websiteTabs.value.length > 0,
        allTabsMuted: allTabsMuted.value,
        allInteractionLocked: props.state.allHumanInteractionLocked,
        allInteractionLockLabel: allInteractionLockLabel.value,
        interactionPending: isTogglePending('interaction'),
        audioPending: isTogglePending('audio'),
        followAgentActivity: settings.value.followAgentActivity,
        showUpdateStatus: showUpdateStatusPill.value,
        updateState: updateState.value,
        licenseReminderShown: licenseAskController.reminderShown.value,
        mcpEndpoint: mcpEndpoint.value,
        mcpState: mcpState.value,
        mcpPauseBusy: mcpPauseBusy.value
      }
    }),
    delegate: shell.delegateVerticalTabRail,
    pointer: shell.setVerticalTabRailOverlayPointer,
    refused: shell.refuseVerticalTabRailOverlay,
    hidden: () => setVerticalTabRailRevealed(false),
    intent: runSidebarOverlayIntent
  })
}

/** What the person did in the rail over the page, run as the same click in this rail. */
function runSidebarOverlayIntent(intent: SidebarOverlayIntent): void {
  switch (intent.kind) {
    case 'open-home': void props.runAction(props.actions.openHome); return
    case 'select-tab': selectTab(intent.tabId); return
    case 'close-tab': void props.runAction(() => closeTab(intent.tabId)); return
    case 'toggle-tab-muted': {
      const tab = props.state.tabs.find((candidate) => candidate.id === intent.tabId)
      if (tab) void props.runAction(() => toggleTabMuted(tab))
      return
    }
    case 'stop-worker-capture': void browserTabsBar.value?.stopWorkerCapture?.(intent.tabId); return
    case 'reorder-tab': {
      const { tabId, targetTabId, placement } = intent
      void props.runAction(() => reorderTab({ tabId, targetTabId, placement }))
      return
    }
    case 'new-tab': void props.runAction(() => props.actions.newTabInWorkspace(intent.workspaceId)); return
    case 'toggle-workspace': browserTabsBar.value?.toggleTabGroup?.(intent.workspaceId); return
    case 'create-workspace': void props.runAction(props.actions.openNewWorkspaceEditor); return
    case 'switch-workspace': void props.runAction(props.actions.toggleWorkspaceSwitcher); return
    case 'stay-here': setFollowAgentActivity(false); return
    case 'toggle-rail-pinned': toggleVerticalTabRailPinned(); return
    case 'drag-start': startTabDrag(); return
    case 'scroll': browserTabsBar.value?.scrollTabListTo?.(intent.top); return
    case 'dismiss': setVerticalTabRailRevealed(false); return
    case 'tab-context-menu':
    case 'workspace-context-menu':
      // Main opens these menus itself, so the rail stays open while one is.
      return
    case 'footer': runSidebarOverlayFooterAction(intent.action)
  }
}

function runSidebarOverlayFooterAction(action: Extract<SidebarOverlayIntent, { kind: 'footer' }>['action']): void {
  switch (action) {
    case 'command-palette': void props.runAction(props.actions.toggleCommandPalette); return
    case 'tab-search': void props.runAction(props.actions.toggleTabSearch); return
    case 'downloads': void props.runAction(toggleDownloads); return
    case 'history': void props.runAction(toggleVisitHistory); return
    case 'all-tabs-muted': void props.runAction(toggleAllTabsMuted); return
    case 'all-interaction': void props.runAction(toggleAllHumanInteraction); return
    case 'follow-agent-activity': void props.runAction(toggleFollowAgentActivity); return
    case 'update-settings': void props.runAction(openUpdateSettings); return
    case 'license-settings': void props.runAction(props.actions.openLicenseSettings); return
    case 'settings': void props.runAction(toggleSettings); return
    case 'mcp-pause': void props.runAction(() => mcpStatusController.togglePaused()); return
    case 'mcp-summary':
      // The summary opens from this rail's pill, so this rail opens beside the page for it.
      props.shellController.refuseVerticalTabRailOverlay()
      void nextTick(() => { mcpStatusController.summaryOpen.value = true })
  }
}

defineExpose({ expandTabGroup, expandTabGroupForTab, openAgentCard, takeOverFromAgent })
</script>

<template>
  <!-- The chrome the full-page view hides. This wrapper has no box of its own, so the bars keep their layout,
       while the pointer anywhere on them, or focus inside them, still counts as on the chrome. -->
  <div
    ref="chrome"
    class="browser-chrome"
    @mouseover="fullPage.reveal"
    @mouseleave="fullPage.conceal"
    @focusin="fullPage.reveal"
    @focusout="fullPage.focusOut"
  >
    <!-- The window's top edge, and with the rail its left edge, stand in for the hidden bars. -->
    <div v-if="fullPageConcealed" class="full-page-edge" data-testid="full-page-edge" aria-hidden="true">
      <span class="full-page-edge-title">{{ fullPageTitle }}</span>
    </div>
    <div v-if="fullPageConcealed && tabOrientation === 'vertical'" class="full-page-side-edge" aria-hidden="true" />
    <ShellTitleBarSurface
      v-if="customTitleBar && tabOrientation === 'vertical'"
      kind="rail"
      :draggable="customTitleBar"
    />
    <ShellTitleBarSurface
      v-if="customTitleBar && (activeIsHome || settingsOpen) && tabOrientation === 'vertical'"
      :kind="settingsOpen ? 'settings' : 'home'"
      :draggable="customTitleBar"
    />
    <div
      ref="topbar"
      class="topbar"
      :class="{
        'rail-collapsing': verticalTabRailCollapsing,
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
        :settings-active="settingsOpen"
        :user-attention="userAttention"
        :workspace-switcher-open="workspaceSwitcherOpen"
        :hydrated="hydrated"
        :orientation="tabOrientation"
        :rail-pinned="verticalTabRailPinned"
        :rail-revealed="verticalTabRailRevealed || verticalTabRailCollapsing"
        :inert="verticalTabRailCollapsing"
        :force-rail-collapsed="tabOrientation === 'vertical' && verticalTabRailCollapsed"
        :mcp-activity-by-tab="mcpActivityByTab"
        :format-number="formatNumber"
        :tab-tooltip="tabTooltip"
        :describe-emulation="describeTabEmulation"
        @open-home="runAction(actions.openHome)"
        @stay-here="setFollowAgentActivity(false)"
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
        @switch-workspace="runAction(actions.toggleWorkspaceSwitcher)"
      />
      <AppTopbarActions
        :inert="verticalTabRailCollapsing"
        :command-palette-open="commandPaletteOpen && !workspaceSwitcherOpen"
        :tab-search-open="tabSearchOpen"
        :downloads-open="downloadsOpen"
        :history-open="historyOpen"
        :settings-open="settingsOpen"
        :downloads="downloads"
        :active-downloads="activeDownloads"
        :download-button-label="downloadButtonLabel"
        :has-website-tabs="websiteTabs.length > 0"
        :all-tabs-muted="allTabsMuted"
        :all-interaction-locked="state.allHumanInteractionLocked"
        :all-interaction-lock-label="allInteractionLockLabel"
        :interaction-pending="isTogglePending('interaction')"
        :audio-pending="isTogglePending('audio')"
        :follow-agent-activity="settings.followAgentActivity"
        :show-update-status="showUpdateStatusPill"
        :license-reminder-shown="licenseAskController.reminderShown.value"
        :update-state="updateState"
        :mcp-status-controller="mcpStatusController"
        @toggle-command-palette="runAction(actions.toggleCommandPalette)"
        @toggle-tab-search="runAction(actions.toggleTabSearch)"
        @toggle-downloads="runAction(toggleDownloads)"
        @toggle-history="runAction(toggleVisitHistory)"
        @toggle-all-tabs-muted="runAction(toggleAllTabsMuted)"
        @toggle-all-interaction="runAction(toggleAllHumanInteraction)"
        @toggle-follow-agent-activity="runAction(toggleFollowAgentActivity)"
        @open-update-settings="runAction(openUpdateSettings)"
        @open-license-settings="runAction(actions.openLicenseSettings)"
        @toggle-settings="runAction(toggleSettings)"
      />
      <PanelResizeHandle
        v-if="tabOrientation === 'vertical' && !verticalTabRailCollapsed && !verticalTabRailCollapsing"
        class="tab-rail-resize-handle"
        dock="left"
        :active="tabRailResize.resizing.value"
        :minimum="tabRailResize.minimum.value"
        :maximum="tabRailResize.maximum.value"
        :value="tabRailResize.width.value"
        :label="t('shell.tabs.resizeRail')"
        :title="t('shell.tabs.resizeRailHelp')"
        @pointerdown="tabRailResize.startResize"
        @keydown="tabRailResize.resizeWithKeyboard"
        @reset="tabRailResize.resetSize"
      />
    </div>
    <div
      v-if="!activeIsHome && !settingsOpen"
      class="toolbar"
      :data-titlebar-drag-surface="customTitleBar && tabOrientation === 'vertical' ? '' : undefined"
    >
      <BrowserNavigationControls
        :active-tab="activeTab"
        :zoom-open="zoomOpen"
        :bookmarks-open="bookmarksOpen"
        :current-bookmark="Boolean(currentBookmark)"
        :format-percent="formatPercent"
        :list-history="listHistory"
        @back="runAction(() => syncState(browser.back()))"
        @forward="runAction(() => syncState(browser.forward()))"
        @reload="runAction(() => syncState(browser.reload()))"
        @reload-ignoring-cache="runAction(() => syncState(browser.reloadIgnoringCache()))"
        @open-in-new-tab="(target, active) => runAction(() => openNavigationInNewTab(target, active))"
        @stop="runAction(() => syncState(browser.stop()))"
        @find="runAction(actions.openFind)"
        @toggle-zoom="runAction(actions.toggleZoom)"
        @toggle-bookmarks="runAction(toggleBookmarks)"
      >
        <BrowserAddressBar
          v-model:site-controls-open="siteControlsOpen"
          v-model:panel-dock="panelDock"
          :active-tab="activeTab"
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
            clearActiveCssStatePreview,
            stopActiveVirtualPasskey,
            stopActiveLogpoints,
            openRequestConditions,
            setSitePermission: setSitePermissionDecision,
            resetSitePermission: removeSitePermission,
            openSitePermissionSettings,
            openSitePrivacySettings
          }"
          :keeps-separate-panel-open="keepsSeparatePanelOpen"
        />
        <AgentPresenceAvatars
          ref="agentPresenceAvatars"
          :workspace-id="activeTab?.mcpGroupId"
          :workspace-name="activeWorkspaceName"
          :active-tab-id="activeTab?.id"
          :attention-reason="userAttention?.reason"
          :attention-id="userAttention?.id"
          :attention-decision="userAttention?.humanWaitingDecisionId !== undefined"
          :attention-decision-id="userAttention?.humanWaitingDecisionId"
          :attention-workspace-id="userAttention?.workspaceId"
          :browser="browser"
          :tabs="state.tabs"
          :follow="settings.followAgentActivity"
          :show-cursor="settings.showAgentCursor"
          :pin-live-status="settings.pinAgentLiveStatus"
          :all-steps="actions.showAgentSteps !== undefined"
          :agent-control-locked="state.agentControlLocked === true"
          :take-over-badge="agentTakeOver?.badge"
          @select="selectTab"
          @set-paused="setAgentPaused"
          @take-over="takeOverTab"
          @set-follow="setFollowAgentActivity"
          @set-show-cursor="setShowAgentCursor"
          @set-pin-live-status="setPinAgentLiveStatus"
          @answer-attention="answerAttention"
          @review-decision="actions.reviewDecisions"
          @show-steps="(clientKey, workspaceId) => actions.showAgentSteps?.(clientKey, workspaceId)"
        />
        <template #leading>
          <AgentTakeOverPrompt
            ref="agentTakeOver"
            :workspace-id="activeTab?.mcpGroupId"
            :active-tab-id="activeTab?.id"
            :tabs="state.tabs"
            :agent-control-locked="state.agentControlLocked === true"
            @take-over="takeOverTab"
            @hand-back="setAgentPaused($event, false)"
          />
        </template>
        <template #commands>
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
            :interaction-pending="isTogglePending('interaction')"
            :audio-pending="isTogglePending('audio')"
            :agent-pending="isTogglePending(`agents:${activeTab?.id}`)"
            :lifecycle-pending="isTogglePending(`lifecycle:${activeTab?.id}`)"
            :area-capture-state="areaCaptureState"
            :area-capture-label="areaCaptureLabel"
            :element-picker-state="elementPickerState"
            :element-picker-title="elementPickerTitle"
            :element-picker-label="elementPickerLabel"
            :page-tools-open="pageToolsOpen"
            @toggle-tab-interaction="runAction(toggleTabHumanInteraction)"
            @toggle-page-lifecycle="runAction(() => togglePageLifecycle($event))"
            @toggle-tab-agent-paused="runAction(() => toggleTabAgentPaused($event))"
            @toggle-tab-muted="runAction(() => toggleTabMuted($event))"
            @toggle-area-capture="runAction(toggleAreaCapture)"
            @toggle-element-picker="runAction(() => toggleElementPicker('context'))"
            @toggle-page-tools="actions.togglePageTools"
            @split-error="actions.handleSplitViewError"
          />
          <UiButton
            v-if="fullPageActive"
            appearance="application"
            class="icon-button full-page-exit-button"
            type="button"
            v-tooltip="t('shell.fullPage.exit')"
            :aria-label="t('shell.fullPage.exit')"
            aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
            @click="fullPage.toggle()"
          ><IconFullscreenExit aria-hidden="true" /></UiButton>
        </template>
      </BrowserNavigationControls>
    </div>
    <!-- Pinned, it holds its place on every page of a workspace, so pages do not move as agents come and go. -->
    <AgentLiveStrip
      v-if="settings.pinAgentLiveStatus && !activeIsHome && !settingsOpen && activeTab?.mcpGroupId"
      :workspace-id="activeTab.mcpGroupId"
      :attention-reason="userAttention?.reason"
      :attention-id="userAttention?.id"
      :attention-decision="userAttention?.humanWaitingDecisionId !== undefined"
      :attention-workspace-id="userAttention?.workspaceId"
      :attention-tab-id="userAttention?.tabId"
      :tabs="state.tabs"
      :agent-control-locked="state.agentControlLocked === true"
      @set-paused="setAgentPaused"
      @take-over="takeOverTab"
      @hand-back="answerAttention($event, 'resolved')"
      @open-card="answerInAgentCard"
      @unpin="unpinLiveStrip"
    />
  </div>
</template>
