<script setup lang="ts">
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import IconStopCircle from '~icons/material-symbols/stop-circle-rounded'
import UiButton from "../ui/UiButton.vue"
import { friendlyUiError } from '../composables/useAppToastController.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconAddBox from '~icons/material-symbols/add-box-rounded'
import IconBedtime from '~icons/material-symbols/bedtime-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDashboard from '~icons/material-symbols/space-dashboard-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconHorizontalSplit from '~icons/material-symbols/horizontal-split-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowLeft from '~icons/material-symbols/keyboard-arrow-left-rounded'
import IconKeyboardArrowRight from '~icons/material-symbols/keyboard-arrow-right-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconKeepOff from '~icons/material-symbols/keep-off-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconLock from '~icons/material-symbols/lock-rounded'
import IconPauseCircle from '~icons/material-symbols/pause-circle-rounded'
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded'
import IconVisibility from '~icons/material-symbols/visibility-rounded'
import IconHelp from '~icons/material-symbols/help-outline-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconStacks from '~icons/material-symbols/stacks-rounded'
import IconVerticalSplit from '~icons/material-symbols/vertical-split-rounded'
import IconVolumeOff from '~icons/material-symbols/volume-off-rounded'
import IconVolumeUp from '~icons/material-symbols/volume-up-rounded'
import type { BrowserState, BrowserTabGroupColor, BrowserTabGroupState, BrowserTabState, McpTabActivity, UserAttentionRequest } from '../../../shared/types.js'
import { AGENT_AVATAR_VISIBLE_LIMIT, agentAvatarColorHex, type AgentPresence, type HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { BROWSER_TAB_GROUP_COLOR_HEX, defaultTabGroupColor } from '../../../shared/tab-groups.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { foldRailWorkspaces, pinnedWorkspacesFirst } from '../../../shared/workspace-rail.js'
import { keyedPinnedWorkspaces } from '../../../shared/workspace-shortcuts.js'
import { useWorkspaceGroupAgents } from '../composables/useWorkspaceGroupAgents.js'
import { useCollapsedTabGroups } from '../composables/useCollapsedTabGroups.js'
import { useTabDragReorder } from '../composables/useTabDragReorder.js'
import { useTabStripScroll } from '../composables/useTabStripScroll.js'
import { vTooltip } from '../ui/tooltip.js'
import { ignoreHeldEnter } from '../held-enter.js'

const props = defineProps<{
  state: BrowserState
  settingsActive?: boolean
  userAttention?: UserAttentionRequest | null
  /** The workspace switcher is open. */
  workspaceSwitcherOpen?: boolean
  hydrated: boolean
  orientation: 'horizontal' | 'vertical'
  railPinned: boolean
  railRevealed?: boolean
  forceRailCollapsed?: boolean
  mcpActivityByTab: Record<string, McpTabActivity>
  /** The agents in each workspace; the shell's own presence channel when left out. */
  presenceApi?: HronautAgentPresenceApi
  formatNumber: (value: number) => string
  tabTooltip: (tab: BrowserTabState) => string
  describeEmulation: (tab: BrowserTabState) => string
}>()

const emit = defineEmits<{
  openHome: []
  showWorkspaceContextMenu: [groupId: string]
  newTab: [groupId?: string]
  createWorkspace: []
  selectTab: [tabId: string]
  showTabContextMenu: [tabId: string]
  reorderTab: [details: { tabId: string; targetTabId: string; placement: 'before' | 'after' }]
  toggleTabMuted: [tab: BrowserTabState]
  closeTab: [tabId: string]
  dragStart: []
  toggleRailPinned: []
  /** Open the workspace switcher, which finds a workspace by its name, agents or sites. */
  switchWorkspace: []
  /** Stop following agents and stay on the tab in view. */
  stayHere: []
}>()

const { t } = useI18n({ useScope: 'global' })
const homeTab = computed(() => props.state.tabs.find((tab) => isHronautHomeUrl(tab.url)))
const regularTabs = computed(() => props.state.tabs.filter((tab) => !isHronautHomeUrl(tab.url)))
const { collapsedTabGroupIds, isTabGroupCollapsed, toggleTabGroup, expandTabGroup, forgetMissingTabGroups } = useCollapsedTabGroups()
const focusedTabId = ref<string | null>(null)
const vertical = computed(() => props.orientation === 'vertical')
// The shell owns reveal timing and focus/pointer coordination. This component
// only renders that state, so it cannot expand ahead of a pending click.
const railExpanded = computed(() => (
  !props.forceRailCollapsed && (props.railPinned || props.railRevealed)
))

const {
  tabsStrip,
  hasTabOverflow,
  canScrollTabsBack,
  canScrollTabsForward,
  updateTabOverflow,
  scrollTabs,
  scrollTabsWithWheel,
  revealTab,
  revealActiveTab,
  activeTabIntersectsVisibleStrip,
  revealAfterLayout,
  handleTabStripScroll,
  markActiveTabVisible,
  observeStrip,
  stopObservingStrip
} = useTabStripScroll({ vertical, focusedTabId })
const { draggedTabId, tabDropTargetId, tabDropPlacement, clearTabDrag, beginTabDrag, updateTabDrop, finishTabDrop } = useTabDragReorder({
  tabs: regularTabs,
  vertical,
  onDragStart: () => emit('dragStart'),
  onReorder: (details) => emit('reorderTab', details)
})

function tabGroupStyle(tab: BrowserTabState): Record<string, string> | undefined {
  if (!tab.mcpGroupId) return undefined
  const color = props.state.mcpTabGroups.find((group) => group.id === tab.mcpGroupId)?.color ?? defaultTabGroupColor(tab.mcpGroupId)
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[color] }
}

function tabGroupColorStyle(color: BrowserTabGroupColor): Record<string, string> {
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[color] }
}

function tabGroupTabs(groupId: string): BrowserTabState[] {
  return regularTabs.value.filter((tab) => tab.mcpGroupId === groupId)
}

function tabGroupTabCount(groupId: string): number {
  return tabGroupTabs(groupId).length
}

// The workspace whose page is in view: none while Home or Settings is showing, as for the tabs themselves.
const activeWorkspaceId = computed(() => (
  props.settingsActive ? undefined : props.state.tabs.find((tab) => tab.active)?.mcpGroupId
))

// The workspace following brought into view, while its tab is still the one shown.
const followedWorkspaceId = computed(() => {
  const follow = props.state.agentFollow
  if (!follow || props.settingsActive || props.orientation !== 'vertical') return undefined
  return props.state.tabs.find((tab) => tab.id === follow.tabId && tab.active)?.mcpGroupId
})

// A client whose name cleans to nothing is named as in its avatar.
const followingLabel = computed(() => (
  props.state.agentFollow ? t('shell.tabs.followingAgent', { name: props.state.agentFollow.agentName || t('shell.agents.unnamed') }) : ''
))

// A request names its tab when it has one; that tab's workspace is the one
// waiting, even when the person has folded it or moved to another workspace.
function workspaceNeedsYou(groupId: string): boolean {
  const request = props.userAttention
  if (!request) return false
  if (request.tabId) return props.state.tabs.some((tab) => tab.id === request.tabId && tab.mcpGroupId === groupId)
  return request.workspaceId === groupId
}

function tabGroupLabelName(workspace: BrowserTabGroupState): string {
  const count = tabGroupTabCount(workspace.id)
  const name = t(isTabGroupCollapsed(workspace.id) ? 'runtime.tabs.expandAria' : 'runtime.tabs.collapseAria', { name: workspace.name, count: props.formatNumber(count) }, count)
  return workspaceNeedsYou(workspace.id) ? `${name}, ${t('shell.tabs.needsYou')}` : name
}

const AGENT_STATE_KEYS: Record<AgentPresence['state'], string> = { idle: 'idle', working: 'working', 'needs-you': 'needsYou' }

function tabGroupAgentsDescription(workspaceId: string): string {
  const agents = groupAgents.agents(workspaceId)
  if (!agents.length) return ''
  const names = agents.slice(0, AGENT_AVATAR_VISIBLE_LIMIT).map((agent) => t('shell.tabs.groupAgent', {
    name: agent.name || t('shell.agents.unnamed'),
    state: t(`shell.agentCard.states.${AGENT_STATE_KEYS[agent.state]}`)
  }))
  // The rest are counted, as the avatars do.
  if (agents.length > AGENT_AVATAR_VISIBLE_LIMIT) names.push(`+${props.formatNumber(agents.length - AGENT_AVATAR_VISIBLE_LIMIT)}`)
  return t('shell.tabs.groupAgents', { agents: names.join(', ') })
}

// The first nine pinned workspaces in the rail have a key each: Alt with their number, Control on macOS.
const pinnedWorkspaceKeys = computed(() => {
  const modifier = window.hronautShell?.windowChrome.platform === 'darwin' ? 'Control' : 'Alt'
  return new Map(keyedPinnedWorkspaces(props.state.mcpTabGroups).map((group, index) => [group.id, `${modifier}+${index + 1}`]))
})

function tabGroupLabelDescription(workspace: BrowserTabGroupState): string | undefined {
  const reason = workspaceNeedsYou(workspace.id) && props.userAttention ? `${t('shell.tabs.agentAttention')}: ${props.userAttention.reason}` : ''
  const key = pinnedWorkspaceKeys.value.get(workspace.id)
  const pinned = workspace.pinnedAt ? (key ? t('shell.tabs.pinnedWorkspaceKey', { key }) : t('shell.tabs.pinnedWorkspace')) : ''
  return [reason, pinned, tabGroupAgentsDescription(workspace.id), workspace.description].filter(Boolean).join('\n\n') || undefined
}

// Pinned workspaces stay on top, in the order the person pinned them.
const sidebarWorkspaces = computed(() => pinnedWorkspacesFirst(props.state.mcpTabGroups.filter(group => !vertical.value || !group.hiddenFromSidebar)))
// The workspace of the last active website tab, which Home, having none of its own, leaves in place.
const lastActiveWorkspaceId = ref<string | undefined>()
watch(() => props.state.tabs.find((tab) => tab.active)?.mcpGroupId, (groupId) => {
  if (groupId) lastActiveWorkspaceId.value = groupId
}, { immediate: true })

// A long rail folds workspaces past the first ten into its "All N workspaces" row. The workspace you were last
// working in stays listed, under Home or Settings too, and so does one that needs you.
const railFold = computed(() => {
  if (!vertical.value) return { listed: sidebarWorkspaces.value, folded: [] }
  const keep = new Set(sidebarWorkspaces.value.filter((group) => group.pinnedAt !== undefined || group.id === lastActiveWorkspaceId.value || workspaceNeedsYou(group.id)).map((group) => group.id))
  return foldRailWorkspaces(sidebarWorkspaces.value, keep)
})
const railWorkspaces = computed(() => railFold.value.listed)
// A workspace hidden from the rail can still need you; the row then appears with an amber dot.
const unlistedWorkspaceNeedsYou = computed(() => vertical.value && props.state.mcpTabGroups.some((group) => (
  !railWorkspaces.value.includes(group) && workspaceNeedsYou(group.id)
)))
const allWorkspacesRow = computed(() => vertical.value && (railFold.value.folded.length > 0 || unlistedWorkspaceNeedsYou.value))
const allWorkspacesLabel = computed(() => {
  const count = props.state.mcpTabGroups.length
  return t('shell.tabs.allWorkspaces', { count: props.formatNumber(count) }, count)
})
const visibleTabs = computed(() => railWorkspaces.value.flatMap((group) => (
  isTabGroupCollapsed(group.id) ? [] : tabGroupTabs(group.id)
)))
const keyboardTabId = computed(() => {
  const visibleIds = new Set(visibleTabs.value.map((tab) => tab.id))
  if (focusedTabId.value && visibleIds.has(focusedTabId.value)) return focusedTabId.value
  if (props.state.activeTabId && visibleIds.has(props.state.activeTabId)) return props.state.activeTabId
  return visibleTabs.value[0]?.id ?? null
})

function tabKeyboardIndex(tab: BrowserTabState): 0 | -1 {
  return keyboardTabId.value === tab.id ? 0 : -1
}

function tabControl(tabId: string): HTMLElement | undefined {
  return [...(tabsStrip.value?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])]
    .find((element) => element.dataset.tabId === tabId)
}

function focusTab(tabId: string): void {
  focusedTabId.value = tabId
  void nextTick(() => {
    const control = tabControl(tabId)
    control?.focus({ preventScroll: true })
    if (control) revealTab(control)
  })
}

function activateTab(tabId: string): void {
  emit('selectTab', tabId)
  void nextTick(() => {
    const control = tabControl(tabId)
    if (control && document.activeElement === control) revealTab(control, 'auto')
  })
}

function handleTabKeyDown(event: KeyboardEvent, tab: BrowserTabState): void {
  // With a modifier, Delete is another shortcut, such as Ctrl or Cmd with Shift and Delete for Workspaces & data.
  if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    // A closed tab hands the focus to the next tab, so a held Delete would close one tab after another.
    if (!event.repeat) emit('closeTab', tab.id)
    return
  }
  if (
    event.key.toLocaleLowerCase() === 'm'
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && (tab.audible || tab.muted)
  ) {
    event.preventDefault()
    // A held M would mute and unmute the tab on every repeat.
    if (!event.repeat) emit('toggleTabMuted', tab)
    return
  }
  const tabs = visibleTabs.value
  const currentIndex = tabs.findIndex((candidate) => candidate.id === tab.id)
  const previousKey = vertical.value ? 'ArrowUp' : 'ArrowLeft'
  const nextKey = vertical.value ? 'ArrowDown' : 'ArrowRight'
  if (currentIndex < 0 || ![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const targetIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === previousKey ? -1 : 1) + tabs.length) % tabs.length
  const target = tabs[targetIndex]
  if (target) focusTab(target.id)
}

function tabKeyboardShortcuts(tab: BrowserTabState): string | undefined {
  const shortcuts: string[] = ['Delete']
  if (tab.audible || tab.muted) shortcuts.push('M')
  return shortcuts.length ? shortcuts.join(' ') : undefined
}

function handleTabAuxClick(event: MouseEvent, tab: BrowserTabState): void {
  if (event.button !== 1) return
  event.preventDefault()
  emit('closeTab', tab.id)
}

// Closing the focused tab, as with Delete, takes its control out of the strip, and moving it, as with Move left or Pin,
// moves its control; either way Chromium leaves the focus on the page body. A closed tab hands the focus to the tab
// after it, or the one before it when it was the last, as the tabs pattern asks, and a tab still in the strip keeps it.
// A tab that is only hidden, as in a folded workspace, hands it to no other workspace's tab. Not when the focus has
// moved on meanwhile, or the window no longer has it, as when the page that replaces a closed active tab took it.
watch(() => visibleTabs.value.map((tab) => tab.id), async (ids, previousIds) => {
  const focused = document.activeElement
  const tabId = focused instanceof HTMLElement && tabsStrip.value?.contains(focused) ? focused.dataset.tabId : undefined
  if (!tabId) return
  const remaining = new Set(ids)
  const index = previousIds.indexOf(tabId)
  const closed = !props.state.tabs.some((tab) => tab.id === tabId)
  const target = remaining.has(tabId) ? tabId : !closed || index < 0 ? undefined
    : previousIds.slice(index + 1).find((id) => remaining.has(id)) ?? previousIds.slice(0, index).reverse().find((id) => remaining.has(id))
  await nextTick()
  if (!target || document.activeElement !== document.body || !document.hasFocus()) return
  focusTab(target)
}, { flush: 'pre' })

// In the rail, a group shows its agents in its header and opens by itself when an agent starts working there or it
// starts waiting for you. The top strip has room for neither; the toolbar shows the agents of the workspace in view.
const groupAgents = useWorkspaceGroupAgents({
  api: props.presenceApi ?? window.hronautAgentPresence,
  workspaceIds: () => props.state.mcpTabGroups.map((group) => group.id),
  needsYou: workspaceNeedsYou,
  open: (groupId) => { if (vertical.value) expandTabGroup(groupId) }
})

function expandTabGroupForTab(tab: BrowserTabState): void {
  if (tab.mcpGroupId) expandTabGroup(tab.mcpGroupId)
}

watch(
  [() => props.hydrated, () => props.state.mcpTabGroups.map((group) => group.id).join(',')],
  ([hydrated]) => {
    if (!hydrated) return
    forgetMissingTabGroups(props.state.mcpTabGroups.map((group) => group.id))
  },
  { immediate: true }
)

watch(
  [
    () => props.state.tabs.map((tab) => `${tab.id}:${tab.label ?? ''}:${tab.title}:${tab.pinned}:${tab.mcpGroupId ?? ''}`).join('|'),
    () => props.state.mcpTabGroups.map((group) => `${group.id}:${group.name}:${group.description}`).join('|'),
    () => [...collapsedTabGroupIds.value].sort().join('|'),
    // Workspaces fold in and out of a long rail as the active tab or a request moves, and the row comes and goes.
    () => `${railWorkspaces.value.map((group) => group.id).join('|')}:${allWorkspacesRow.value}`
  ],
  async () => {
    const activeWasVisible = activeTabIntersectsVisibleStrip()
    await nextTick()
    updateTabOverflow()
    revealAfterLayout(activeWasVisible)
  }
)

watch(
  () => props.orientation,
  async () => {
    await nextTick()
    updateTabOverflow()
    revealAfterLayout()
  }
)

watch(
  () => props.state.activeTabId,
  async (activeTabId) => {
    markActiveTabVisible()
    const tab = visibleTabs.value.find((candidate) => candidate.id === activeTabId)
    if (tab) focusedTabId.value = tab.id
    await nextTick()
    revealActiveTab()
  }
)

onMounted(async () => {
  await nextTick()
  if (props.hydrated && props.state.activeTabId) {
    const activeTab = props.state.tabs.find((tab) => tab.id === props.state.activeTabId)
    if (activeTab) expandTabGroupForTab(activeTab)
  }
  const active = visibleTabs.value.find((tab) => tab.id === props.state.activeTabId)
  if (active) focusedTabId.value = active.id
  revealActiveTab()
  updateTabOverflow()
  observeStrip()
})

onBeforeUnmount(() => {
  groupAgents.dispose()
  stopObservingStrip()
})

watch(
  [
    () => props.hydrated,
    () => props.state.activeTabId,
    () => props.state.tabs.find((tab) => tab.id === props.state.activeTabId)?.mcpGroupId
  ],
  async ([hydrated, activeTabId, activeTabGroupId], [wasHydrated, previousActiveTabId, previousActiveTabGroupId]) => {
    if (
      !hydrated
      || (wasHydrated && activeTabId === previousActiveTabId && activeTabGroupId === previousActiveTabGroupId)
    ) return
    const tab = props.state.tabs.find((candidate) => candidate.id === activeTabId)
    if (!tab) return
    expandTabGroupForTab(tab)
    focusedTabId.value = tab.id
    await nextTick()
    revealActiveTab()
  }
)

defineExpose({ expandTabGroup, expandTabGroupForTab })
/** Why stopping a tab's worker capture failed, shown on that tab's Stop button until a stop works or the capture ends. */
const workerCaptureErrors = ref(new Map<string, string>())
const capturingTabIds = (): string[] => props.state.tabs.filter((tab) => tab.pwaLifecycleActive).map((tab) => tab.id)
watch(capturingTabIds, (capturing) => {
  for (const tabId of workerCaptureErrors.value.keys()) if (!capturing.includes(tabId)) workerCaptureErrors.value.delete(tabId)
})
async function stopWorkerCapture(tabId: string): Promise<void> {
  workerCaptureErrors.value.delete(tabId)
  try { await window.hronaut.pwaLifecycle({ tabId, action: 'stop' }) }
  catch (error) {
    if (capturingTabIds().includes(tabId)) workerCaptureErrors.value.set(tabId, friendlyUiError(error, ''))
  }
}
</script>

<template>
  <nav
    class="browser-tabs-bar"
    :class="[orientation, { 'rail-collapsed': vertical && !railExpanded }]"
    :data-shell-tab-rail="vertical ? '' : undefined"
    :data-tooltip-placement="vertical ? 'right' : undefined"
    :aria-label="t('shell.tabs.navigation')"
  >
  <div class="tab-rail-header">
  <UiButton appearance="application"
    class="app-home-button"
    :class="{ active: homeTab?.active && !settingsActive }"
    type="button"
    v-tooltip="t('shell.home.open')"
    :aria-label="t('shell.home.open')"
    :aria-current="homeTab?.active && !settingsActive ? 'page' : undefined"
    @click="emit('openHome')"
  >
    <span v-if="homeTab?.loading" class="spinner" :aria-label="t('shell.loading')" />
    <IconDashboard v-else aria-hidden="true" />
    <span class="app-home-label">{{ t('shell.home.label') }}</span>
  </UiButton>
  <UiButton appearance="application"
    v-if="vertical"
    class="tab-rail-pin"
    type="button"
    v-tooltip="t(railPinned ? 'shell.tabs.collapseRail' : 'shell.tabs.keepRailExpanded')"
    :aria-label="t(railPinned ? 'shell.tabs.collapseRail' : 'shell.tabs.keepRailExpanded')"
    :aria-pressed="railPinned"
    @click="emit('toggleRailPinned')"
  >
    <IconKeep v-if="railPinned" aria-hidden="true" />
    <IconKeepOff v-else aria-hidden="true" />
  </UiButton>
  </div>
  <span class="topbar-divider" aria-hidden="true" />
  <div v-if="vertical" class="workspace-rail-header">
    <span class="workspace-rail-title">{{ t('shell.tabs.workspacesHeading') }}</span>
    <UiButton appearance="application"
      class="workspace-rail-find"
      type="button"
      v-tooltip="t('shell.tabs.switchWorkspaceTitle')"
      :aria-label="t('shell.tabs.switchWorkspace')"
      aria-keyshortcuts="Control+K Meta+K"
      aria-haspopup="dialog"
      :aria-expanded="workspaceSwitcherOpen === true"
      @keydown="ignoreHeldEnter"
      @click="emit('switchWorkspace')"
    ><IconSearch aria-hidden="true" /></UiButton>
    <UiButton appearance="application"
      class="new-workspace"
      type="button"
      v-tooltip="t('shell.tabs.createWorkspaceTitle')"
      :aria-label="t('shell.tabs.createWorkspace')"
      @click="emit('createWorkspace')"
    ><IconAdd aria-hidden="true" /></UiButton>
  </div>
  <div class="tabs-strip-shell" :class="{ 'has-tab-overflow': hasTabOverflow }">
    <UiButton appearance="application"
      v-if="hasTabOverflow"
      class="tabs-scroll-button previous"
      type="button"
      :disabled="!canScrollTabsBack"
      v-tooltip="t('shell.tabs.scrollBack')"
      :aria-label="t('shell.tabs.scrollBack')"
      @click="scrollTabs(-1)"
    ><IconKeyboardArrowUp v-if="vertical" aria-hidden="true" /><IconKeyboardArrowLeft v-else aria-hidden="true" /></UiButton>
    <div
      ref="tabsStrip"
      class="tabs-strip"
      role="group"
      :aria-label="t('shell.tabs.list')"
      @scroll="handleTabStripScroll"
      @wheel="scrollTabsWithWheel"
    >
    <div
      v-for="workspace in railWorkspaces"
      :key="workspace.id"
      class="workspace-tab-section"
      :class="{ active: activeWorkspaceId === workspace.id, collapsed: isTabGroupCollapsed(workspace.id), empty: tabGroupTabCount(workspace.id) === 0, 'needs-you': workspaceNeedsYou(workspace.id) }"
      :style="tabGroupColorStyle(workspace.color)"
      role="group"
      :aria-label="workspace.name"
    >
      <UiButton appearance="application"
        class="tab-group-label"
        :class="{ active: activeWorkspaceId === workspace.id }"
        :style="tabGroupColorStyle(workspace.color)"
        v-tooltip="[t(isTabGroupCollapsed(workspace.id) ? 'runtime.tabs.expand' : 'runtime.tabs.collapse', { name: workspace.name, id: workspace.id }), tabGroupLabelDescription(workspace)].filter(Boolean).join('\n\n')"
        :aria-label="tabGroupLabelName(workspace)"
        :aria-description="tabGroupLabelDescription(workspace)"
        :aria-expanded="!isTabGroupCollapsed(workspace.id)"
        type="button"
        @click="toggleTabGroup(workspace.id)"
        @contextmenu.prevent="emit('showWorkspaceContextMenu', workspace.id)"
      >
        <IconKeyboardArrowRight v-if="isTabGroupCollapsed(workspace.id)" aria-hidden="true" />
        <IconKeyboardArrowDown v-else aria-hidden="true" />
        <!-- The space keeps the visible name and count apart for label-in-name checks; inline-flex does not render it. -->
        <span class="tab-group-name">{{ workspace.name }}</span> <IconKeep v-if="workspace.pinnedAt" class="tab-group-pinned" aria-hidden="true" data-testid="workspace-pinned" /> <span v-if="workspaceNeedsYou(workspace.id)" class="tab-group-needs-you">{{ t('shell.tabs.needsYou') }}</span>
        <!-- The agents' names are in the header's description; the initials are drawn, not text, so the name matches the label. -->
        <span v-if="groupAgents.agents(workspace.id).length" class="tab-group-agents" aria-hidden="true" data-testid="workspace-agents">
          <span
            v-for="agent in groupAgents.agents(workspace.id).slice(0, AGENT_AVATAR_VISIBLE_LIMIT)"
            :key="agent.clientKey"
            class="tab-group-agent"
            :data-state="agent.state"
            :data-initial="agent.initial || '•'"
            :style="{ '--agent-color': agentAvatarColorHex(agent.colorIndex) }"
          />
          <span v-if="groupAgents.agents(workspace.id).length > AGENT_AVATAR_VISIBLE_LIMIT" class="tab-group-agent more" :data-initial="`+${formatNumber(groupAgents.agents(workspace.id).length - AGENT_AVATAR_VISIBLE_LIMIT)}`" />
        </span> <span class="tab-group-count" aria-hidden="true">{{ tabGroupTabCount(workspace.id) }}</span>
      </UiButton>
      <!-- Beside the header, not in it: the header is a button. -->
      <div v-if="followedWorkspaceId === workspace.id && state.agentFollow" class="tab-group-following" data-testid="workspace-following">
        <IconVisibility class="tab-group-following-icon" aria-hidden="true" />
        <!-- The tooltip shows a long name in full; screen readers already read the whole text. -->
        <span class="tab-group-following-name" :data-tooltip="followingLabel">{{ followingLabel }}</span>
        <UiButton appearance="application"
          class="tab-group-stay"
          type="button"
          v-tooltip="t('shell.tabs.stayHereDescription')"
          :aria-description="t('shell.tabs.stayHereDescription')"
          @click="emit('stayHere')"
        >{{ t('shell.tabs.stayHere') }}</UiButton>
      </div>
      <div
        class="workspace-tab-list"
        role="tablist"
        :aria-label="workspace.name"
        :aria-orientation="orientation"
      >
        <template v-for="tab in isTabGroupCollapsed(workspace.id) ? [] : tabGroupTabs(workspace.id)" :key="tab.id">
        <UiButton appearance="application"
          class="tab"
          :class="{
            active: tab.active && !settingsActive,
            pinned: tab.pinned,
            sleeping: tab.sleeping,
            frozen: tab.pageLifecycleState === 'frozen',
            grouped: Boolean(tab.mcpGroupId),
            dragging: draggedTabId === tab.id,
            'drop-before': tabDropTargetId === tab.id && tabDropPlacement === 'before',
            'drop-after': tabDropTargetId === tab.id && tabDropPlacement === 'after',
            locked: tab.humanInteractionInputLocked ?? (state.allHumanInteractionLocked || tab.humanInteractionLocked),
            'split-visible': state.splitView?.firstTabId === tab.id || state.splitView?.secondTabId === tab.id,
            'mcp-active': Boolean(mcpActivityByTab[tab.id]),
            'needs-attention': userAttention?.tabId === tab.id
          }"
          :style="tabGroupStyle(tab)"
          v-tooltip="userAttention?.tabId === tab.id ? `${tabTooltip(tab)}\n\n${t('shell.tabs.agentAttention')}: ${userAttention.reason}` : mcpActivityByTab[tab.id] ? `${tabTooltip(tab)}\n\n${t('tabSearch.meta.agent')}` : tabTooltip(tab)"
          :data-mcp-command="mcpActivityByTab[tab.id]?.toolName"
          :aria-label="tabTooltip(tab)"
          :aria-description="userAttention?.tabId === tab.id ? `${t('shell.tabs.agentAttention')}: ${userAttention.reason}` : mcpActivityByTab[tab.id] ? t('tabSearch.meta.agent') : undefined"
          type="button"
          role="tab"
          :tabindex="tabKeyboardIndex(tab)"
          :aria-keyshortcuts="tabKeyboardShortcuts(tab)"
          :data-tab-id="tab.id"
          draggable="true"
          :aria-selected="tab.active && !settingsActive"
          :data-active-tab="tab.active && !settingsActive ? 'true' : undefined"
          @focus="focusedTabId = tab.id"
          @keydown="handleTabKeyDown($event, tab)"
          @click="activateTab(tab.id)"
          @auxclick="handleTabAuxClick($event, tab)"
          @contextmenu.prevent="emit('showTabContextMenu', tab.id)"
          @dragstart="beginTabDrag($event, tab)"
          @dragover="updateTabDrop($event, tab)"
          @drop="finishTabDrop($event, tab)"
          @dragend="clearTabDrag"
        >
          <span v-if="tab.active && !settingsActive" class="tab-active-indicator" aria-hidden="true" />
          <span v-if="userAttention?.tabId === tab.id" class="tab-attention-badge" aria-hidden="true"><IconPriorityHigh /></span>
          <span v-if="tab.loading" class="spinner" :aria-label="t('shell.loading')" />
          <IconError v-else-if="tab.pageProblem" class="favicon-fallback tab-problem-icon" :aria-label="t('shell.tabs.pageAttention')" />
          <img v-else-if="tab.faviconDataUrl" class="favicon-image" :src="tab.faviconDataUrl" alt="" draggable="false" />
          <span v-else-if="tab.url === 'about:blank'" class="favicon-fallback" aria-hidden="true">✦</span>
          <IconLanguage v-else class="favicon-fallback" aria-hidden="true" />
          <IconRecord v-if="tab.videoRecording === 'recording'" style="color: #e5484d" :aria-label="t('video.status.recording')" />
          <IconRecord v-if="tab.pwaLifecycleActive" :aria-label="t('pwaLifecycle.active')" />
          <span class="tab-title">{{ tab.label || tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) }}</span>
          <IconBedtime v-if="tab.sleeping" class="tab-sleep-mark" :aria-label="t('shell.tabs.sleeping')" />
          <IconPauseCircle v-else-if="tab.pageLifecycleState === 'frozen'" class="tab-freeze-mark" :aria-label="t('shell.tabs.frozen')" />
          <IconHelp v-else-if="tab.pageLifecycleState === 'unknown'" class="tab-freeze-mark unknown" :aria-label="t('shell.tabs.freezeUnknown')" />
          <IconHorizontalSplit
            v-if="state.splitView?.orientation === 'horizontal' && (state.splitView.firstTabId === tab.id || state.splitView.secondTabId === tab.id)"
            class="tab-split-mark"
            :aria-label="t('shell.tabs.stackedVisible')"
          />
          <IconVerticalSplit
            v-else-if="state.splitView && (state.splitView.firstTabId === tab.id || state.splitView.secondTabId === tab.id)"
            class="tab-split-mark"
            :aria-label="t('shell.tabs.sideVisible')"
          />
          <IconSpeed v-if="tab.emulation" class="tab-emulation-mark" :aria-label="t('runtime.emulation.reset', { description: describeEmulation(tab) })" />
          <IconRoute v-if="tab.networkRouteCount || (tab.networkConditionState && tab.networkConditionState.application !== 'confirmed')" class="tab-network-route-mark" :aria-label="tab.networkConditionState && tab.networkConditionState.application !== 'confirmed' ? t('network.conditions.unconfirmed') : t('runtime.tabs.routes', { count: formatNumber(tab.networkRouteCount ?? 0) }, tab.networkRouteCount ?? 0)" />
          <!-- The browser-wide lock and mute already show as pressed buttons, so a tab draws its own lock, and a muted tab
               its speaker while it plays sound, instead of repeating them on every row. Its name still says both. -->
          <IconLock v-if="!state.allHumanInteractionLocked && (tab.humanInteractionInputLocked ?? tab.humanInteractionLocked)" class="tab-lock-mark" :aria-label="t('shell.tabs.inputLocked')" />
          <span
            v-if="tab.audible || (tab.muted && !state.allTabsMuted)"
            class="tab-audio"
            :class="{ muted: tab.muted }"
            v-tooltip="t(tab.muted ? 'runtime.tabs.unmute' : 'runtime.tabs.mute', { title: tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) })"
            aria-hidden="true"
            @click.stop="emit('toggleTabMuted', tab)"
          >
            <IconVolumeOff v-if="tab.muted" aria-hidden="true" />
            <IconVolumeUp v-else aria-hidden="true" />
          </span>
          <span
            class="tab-close"
            v-tooltip="t('runtime.locks.closeShortcut')"
            aria-hidden="true"
            @click.stop="emit('closeTab', tab.id)"
          ><IconClose aria-hidden="true" /></span>
        </UiButton>
        <UiButton v-if="tab.pwaLifecycleActive" variant="ghost" size="small" class="tab-pwa-stop" :data-testid="`worker-capture-stop-${tab.id}`" :aria-label="t('pwaLifecycle.stop')" v-tooltip="workerCaptureErrors.get(tab.id) || t('pwaLifecycle.stop')" @click="stopWorkerCapture(tab.id)"><IconStopCircle aria-hidden="true" /></UiButton>
        </template>
      </div>
      <UiButton appearance="application"
        class="new-tab workspace-new-tab"
        type="button"
        :style="tabGroupColorStyle(workspace.color)"
        v-tooltip="t('runtime.tabs.newTab', { name: workspace.name })"
        :aria-label="t('runtime.tabs.newTab', { name: workspace.name })"
        @click="emit('newTab', workspace.id)"
      ><IconAdd aria-hidden="true" /><span class="workspace-new-tab-label">{{ t('tabSearch.newTabTitle') }}</span></UiButton>
    </div>
    <UiButton appearance="application"
      v-if="allWorkspacesRow"
      class="all-workspaces"
      :class="{ 'needs-you': unlistedWorkspaceNeedsYou }"
      type="button"
      v-tooltip="[t('shell.tabs.allWorkspacesTitle'), unlistedWorkspaceNeedsYou ? t('shell.tabs.unlistedWorkspaceNeedsYou') : ''].filter(Boolean).join('\n\n')"
      :aria-label="allWorkspacesLabel"
      :aria-description="unlistedWorkspaceNeedsYou ? t('shell.tabs.unlistedWorkspaceNeedsYou') : undefined"
      aria-keyshortcuts="Control+K Meta+K"
      aria-haspopup="dialog"
      :aria-expanded="workspaceSwitcherOpen === true"
      data-testid="all-workspaces"
      @keydown="ignoreHeldEnter"
      @click="emit('switchWorkspace')"
    ><IconStacks aria-hidden="true" /><span class="all-workspaces-label">{{ allWorkspacesLabel }}</span><span v-if="unlistedWorkspaceNeedsYou" class="all-workspaces-needs-you" aria-hidden="true" /></UiButton>
    <UiButton v-if="!state.mcpTabGroups.length" appearance="application"
      class="new-tab"
      type="button"
      v-tooltip="t('tabSearch.newTabTitle')"
      :aria-label="t('tabSearch.newTabTitle')"
      @click="emit('newTab')"
    ><IconAdd aria-hidden="true" /></UiButton>
    <!-- A folded rail keeps Create workspace at the end of its list, as before; once open, the Workspaces header has it.
         Focus opens the rail, so this copy is left out of the tab order rather than lost from under focus. -->
    <span v-if="!vertical || !railExpanded" class="workspace-action-divider" aria-hidden="true" />
    <UiButton appearance="application"
      v-if="!vertical || !railExpanded"
      class="new-workspace"
      type="button"
      :tabindex="vertical ? -1 : undefined"
      v-tooltip="t('shell.tabs.createWorkspaceTitle')"
      :aria-label="t('shell.tabs.createWorkspace')"
      @click="emit('createWorkspace')"
    >
      <IconAddBox aria-hidden="true" />
      <span>{{ t('shell.tabs.workspace') }}</span>
    </UiButton>
    </div>
    <UiButton appearance="application"
      v-if="hasTabOverflow"
      class="tabs-scroll-button next"
      type="button"
      :disabled="!canScrollTabsForward"
      v-tooltip="t('shell.tabs.scrollForward')"
      :aria-label="t('shell.tabs.scrollForward')"
      @click="scrollTabs(1)"
    ><IconKeyboardArrowDown v-if="vertical" aria-hidden="true" /><IconKeyboardArrowRight v-else aria-hidden="true" /></UiButton>
  </div>
  </nav>
</template>

<style scoped>
.tab-pwa-stop { flex-shrink: 0; width: 28px; }
</style>
