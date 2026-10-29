<script setup lang="ts">
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { shortcutKey } from '../../../shared/shortcut-key.js'
import UiButton from "../ui/UiButton.vue"
import BrowserTabRow from './BrowserTabRow.vue'
import { friendlyUiError } from '../composables/useAppToastController.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconAddBox from '~icons/material-symbols/add-box-rounded'
import IconDashboard from '~icons/material-symbols/space-dashboard-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowLeft from '~icons/material-symbols/keyboard-arrow-left-rounded'
import IconKeyboardArrowRight from '~icons/material-symbols/keyboard-arrow-right-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconKeepOff from '~icons/material-symbols/keep-off-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconVisibility from '~icons/material-symbols/visibility-rounded'
import IconStacks from '~icons/material-symbols/stacks-rounded'
import type { BrowserState, BrowserTabGroupColor, BrowserTabGroupState, BrowserTabState, DroppedLinkTarget, McpTabActivity, UserAttentionRequest } from '../../../shared/types.js'
import { AGENT_AVATAR_VISIBLE_LIMIT, agentAvatarColorHex, type AgentPresence, type HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { BROWSER_TAB_GROUP_COLOR_HEX, defaultTabGroupColor } from '../../../shared/tab-groups.js'
import { foldRailWorkspaces, pinnedWorkspacesFirst } from '../../../shared/workspace-rail.js'
import { keyedPinnedWorkspaces } from '../../../shared/workspace-shortcuts.js'
import { attentionReasonText } from '../composables/agent-attention-reason.js'
import { useWorkspaceGroupAgents } from '../composables/useWorkspaceGroupAgents.js'
import { useCollapsedTabGroups } from '../composables/useCollapsedTabGroups.js'
import { useTabDragReorder } from '../composables/useTabDragReorder.js'
import { useTabLinkDrop } from '../composables/useTabLinkDrop.js'
import { useTabSelection } from '../composables/useTabSelection.js'
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
  /**
   * The folded workspaces, when another rail owns them, as the shell's own rail does for the copy main draws over the
   * page; folding one then asks with toggleTabGroup. Without it the rail folds them itself.
   */
  collapsedTabGroupIds?: readonly string[]
  /** The desktop platform, which names the workspace keys; the shell's own when left out. */
  platform?: 'darwin' | 'win32' | 'linux'
  /** Stops a tab's worker capture; the shell's own command when left out. */
  stopTabWorkerCapture?: (tabId: string) => Promise<unknown>
  /**
   * Where the tab list starts scrolled, in CSS pixels, as for the copy main draws over the page, which starts where the
   * shell's own list is; without it the list scrolls its active tab into view.
   */
  initialScrollTop?: number
  /** Links dropped on a tab or a workspace's New tab button open there; the copy main draws over the page leaves it out. */
  linkDrops?: boolean
  /** Ctrl, Cmd or Shift with a click selects several tabs of a workspace; the copy main draws over the page leaves it out. */
  tabSelection?: boolean
}>()

const emit = defineEmits<{
  openHome: []
  showWorkspaceContextMenu: [groupId: string]
  newTab: [groupId?: string]
  createWorkspace: []
  selectTab: [tabId: string]
  /** The tab's menu, with the selected tabs it acts on when the tab is one of several selected. */
  showTabContextMenu: [tabId: string, selectedTabIds?: string[]]
  /** A tab moved by drag, with every tab it moves in tabIds when it moves the selected tabs. */
  reorderTab: [details: { tabId: string; targetTabId: string; placement: 'before' | 'after'; tabIds?: string[] }]
  /** A link, or other text, dropped on a tab or a workspace's New tab button. */
  dropLink: [details: { text: string; target: DroppedLinkTarget }]
  toggleTabMuted: [tab: BrowserTabState]
  closeTab: [tabId: string]
  dragStart: []
  toggleRailPinned: []
  /** Open the workspace switcher, which finds a workspace by its name, agents or sites. */
  switchWorkspace: []
  /** Stop following agents and stay on the tab in view. */
  stayHere: []
  /** Fold or unfold a workspace whose folds another rail owns. */
  toggleTabGroup: [groupId: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const homeTab = computed(() => props.state.tabs.find((tab) => isHronautHomeUrl(tab.url)))
const regularTabs = computed(() => props.state.tabs.filter((tab) => !isHronautHomeUrl(tab.url)))
const ownTabGroups = useCollapsedTabGroups()
const collapsedTabGroupIds = computed(() => props.collapsedTabGroupIds ? new Set(props.collapsedTabGroupIds) : ownTabGroups.collapsedTabGroupIds.value)
const isTabGroupCollapsed = (groupId: string): boolean => collapsedTabGroupIds.value.has(groupId)
function toggleTabGroup(groupId: string): void {
  if (props.collapsedTabGroupIds) emit('toggleTabGroup', groupId)
  else ownTabGroups.toggleTabGroup(groupId)
}
// The rail that owns the folds opens a workspace and forgets a closed one; this copy only shows them.
function expandTabGroup(groupId: string): void {
  if (!props.collapsedTabGroupIds) ownTabGroups.expandTabGroup(groupId)
}
function forgetMissingTabGroups(groupIds: readonly string[]): void {
  if (!props.collapsedTabGroupIds) ownTabGroups.forgetMissingTabGroups(groupIds)
}
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
const { draggedTabId, draggedTabIds, tabDropTargetId, tabDropPlacement, clearTabDrag, beginTabDrag, updateTabDrop, finishTabDrop } = useTabDragReorder({
  tabs: regularTabs,
  vertical,
  selectionWith: (tabId) => selectionWith(tabId),
  onDragStart: () => emit('dragStart'),
  onReorder: (details) => emit('reorderTab', details)
})
const {
  linkDropTabId, linkDropPlacement, linkDropWorkspaceId, enterStrip, overStrip, leaveStrip, endStripDrag, overTab, dropOnTab, overNewTab, dropOnNewTab
} = useTabLinkDrop({
  vertical,
  accepts: () => props.linkDrops === true,
  draggingTab: () => draggedTabId.value !== null,
  onDrop: (details) => emit('dropLink', details)
})

// A tab of the bar moves when dragged over another; a link opens on or beside the tab it is dropped on. Entering a tab
// counts as moving over it.
function handleTabDragover(event: DragEvent, tab: BrowserTabState): void {
  if (!overTab(event, tab)) updateTabDrop(event, tab)
}

function handleTabDrop(event: DragEvent, tab: BrowserTabState): void {
  if (!dropOnTab(event, tab)) finishTabDrop(event, tab)
}

function tabDropMarker(tab: BrowserTabState): 'onto' | 'before' | 'after' | undefined {
  if (tabDropTargetId.value === tab.id) return tabDropPlacement.value ?? undefined
  return linkDropTabId.value === tab.id ? linkDropPlacement.value ?? undefined : undefined
}

function tabGroupColor(tab: BrowserTabState): string | undefined {
  if (!tab.mcpGroupId) return undefined
  const color = props.state.mcpTabGroups.find((group) => group.id === tab.mcpGroupId)?.color ?? defaultTabGroupColor(tab.mcpGroupId)
  return BROWSER_TAB_GROUP_COLOR_HEX[color]
}

function tabSplitOrientation(tab: BrowserTabState): 'horizontal' | 'vertical' | undefined {
  const split = props.state.splitView
  if (!split || (split.firstTabId !== tab.id && split.secondTabId !== tab.id)) return undefined
  return split.orientation === 'horizontal' ? 'horizontal' : 'vertical'
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

// Why the agent needs you, as the tab and workspace tooltips say it.
const attentionLine = computed(() => props.userAttention
  ? t('shell.tabs.agentAttentionReason', { reason: attentionReasonText(t, props.userAttention.reason, props.userAttention.humanWaitingDecisionId !== undefined) })
  : '')

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
  const modifier = (props.platform ?? window.hronautShell?.windowChrome.platform) === 'darwin' ? 'Control' : 'Alt'
  return new Map(keyedPinnedWorkspaces(props.state.mcpTabGroups).map((group, index) => [group.id, `${modifier}+${index + 1}`]))
})

function tabGroupLabelDescription(workspace: BrowserTabGroupState): string | undefined {
  const reason = workspaceNeedsYou(workspace.id) ? attentionLine.value : ''
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
const { selectedTabIds, selectsOnClick, selectionWith } = useTabSelection({
  enabled: () => props.tabSelection === true,
  tabs: visibleTabs,
  activeTabId: () => props.state.activeTabId,
  platform: () => props.platform ?? window.hronautShell?.windowChrome.platform,
  activate: activateTab
})
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

// Ctrl, Cmd or Shift with a click selects tabs; a plain click shows the tab.
function clickTab(tabId: string, event: MouseEvent): void {
  const tab = visibleTabs.value.find((candidate) => candidate.id === tabId)
  if (tab && selectsOnClick(event, tab)) return
  activateTab(tabId)
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
    shortcutKey(event) === 'm'
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
  // With Alt, Ctrl or Cmd these keys are the browser's, such as Alt+Home for Home and Alt+Left for Back.
  if (event.altKey || event.ctrlKey || event.metaKey) return
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

function noteFocusedTab(tabId: string): void {
  focusedTabId.value = tabId
}

// The rows' events go on as the tab bar's own through these, the same function for every row and every draw, so a
// row whose tab did not change is not drawn again for a new handler.
const showTabContextMenu = (tabId: string): void => {
  const selected = selectionWith(tabId)
  emit('showTabContextMenu', tabId, selected.length ? selected : undefined)
}
const toggleTabMuted = (tab: BrowserTabState): void => emit('toggleTabMuted', tab)
const closeTab = (tabId: string): void => emit('closeTab', tabId)

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

// Measuring the strip lays out the whole shell, so it waits for what can move or resize what the strip holds. A title
// cannot: a tab's size does not follow its title, which loading pages change many times a second.
watch(
  [
    // A tab's worker capture adds its Stop button beside the tab.
    () => props.state.tabs.map((tab) => `${tab.id}:${tab.label ?? ''}:${tab.pinned}:${tab.mcpGroupId ?? ''}:${tab.pwaLifecycleActive === true}`).join('|'),
    // A workspace that needs you widens its header with a dot.
    () => props.state.mcpTabGroups.map((group) => `${group.id}:${group.name}:${group.description}:${workspaceNeedsYou(group.id)}`).join('|'),
    () => [...collapsedTabGroupIds.value].sort().join('|'),
    // Workspaces fold in and out of a long rail as the active tab or a request moves, and the row comes and goes.
    () => `${railWorkspaces.value.map((group) => group.id).join('|')}:${allWorkspacesRow.value}`,
    // The rail adds a Following row under the workspace an agent is followed in.
    () => followedWorkspaceId.value
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
  if (props.initialScrollTop === undefined || !tabsStrip.value) revealActiveTab()
  updateTabOverflow()
  observeStrip()
  if (props.initialScrollTop !== undefined && tabsStrip.value) {
    tabsStrip.value.scrollTop = props.initialScrollTop
    // A later layout pass keeps the active tab in view only if it is in view at that position.
    handleTabStripScroll()
  }
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

/** How far the tab list is scrolled, in CSS pixels. */
function tabListScrollTop(): number {
  return tabsStrip.value?.scrollTop ?? 0
}

function scrollTabListTo(top: number): void {
  if (tabsStrip.value) tabsStrip.value.scrollTop = top
}

/** Why stopping a tab's worker capture failed, shown on that tab's Stop button until a stop works or the capture ends. */
const workerCaptureErrors = ref(new Map<string, string>())
const capturingTabIds = (): string[] => props.state.tabs.filter((tab) => tab.pwaLifecycleActive).map((tab) => tab.id)
watch(capturingTabIds, (capturing) => {
  for (const tabId of workerCaptureErrors.value.keys()) if (!capturing.includes(tabId)) workerCaptureErrors.value.delete(tabId)
})
async function stopWorkerCapture(tabId: string): Promise<void> {
  workerCaptureErrors.value.delete(tabId)
  try { await (props.stopTabWorkerCapture ? props.stopTabWorkerCapture(tabId) : window.hronaut.pwaLifecycle({ tabId, action: 'stop' })) }
  catch (error) {
    if (capturingTabIds().includes(tabId)) workerCaptureErrors.value.set(tabId, friendlyUiError(error, ''))
  }
}

defineExpose({ expandTabGroup, expandTabGroupForTab, toggleTabGroup, collapsedTabGroupIds, tabListScrollTop, scrollTabListTo, stopWorkerCapture })
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
      @dragenter="enterStrip"
      @dragover="overStrip"
      @dragleave="leaveStrip"
      @drop="endStripDrag"
      @dragend="endStripDrag"
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
        :aria-multiselectable="tabSelection ? 'true' : undefined"
      >
        <BrowserTabRow
          v-for="tab in isTabGroupCollapsed(workspace.id) ? [] : tabGroupTabs(workspace.id)"
          :key="tab.id"
          :tab="tab"
          :active="tab.active && !settingsActive"
          :selected="selectedTabIds.includes(tab.id)"
          :dragging="draggedTabIds.includes(tab.id)"
          :drop-placement="tabDropMarker(tab)"
          :all-human-interaction-locked="state.allHumanInteractionLocked"
          :all-tabs-muted="state.allTabsMuted === true"
          :split-orientation="tabSplitOrientation(tab)"
          :agent-command="mcpActivityByTab[tab.id]?.toolName"
          :attention="userAttention?.tabId === tab.id ? attentionLine : undefined"
          :keyboard-index="tabKeyboardIndex(tab)"
          :group-color="tabGroupColor(tab)"
          :worker-capture-error="workerCaptureErrors.get(tab.id)"
          :label="tabTooltip(tab)"
          :emulation-description="tab.emulation ? describeEmulation(tab) : undefined"
          :format-number="formatNumber"
          @select="clickTab"
          @focused="noteFocusedTab"
          @tab-keydown="handleTabKeyDown"
          @tab-auxclick="handleTabAuxClick"
          @context-menu="showTabContextMenu"
          @tab-dragstart="beginTabDrag"
          @tab-dragenter="handleTabDragover"
          @tab-dragover="handleTabDragover"
          @tab-drop="handleTabDrop"
          @tab-dragend="clearTabDrag"
          @toggle-muted="toggleTabMuted"
          @close="closeTab"
          @stop-worker-capture="stopWorkerCapture"
        />
      </div>
      <UiButton appearance="application"
        class="new-tab workspace-new-tab"
        :class="{ 'link-drop-target': linkDropWorkspaceId === workspace.id }"
        type="button"
        :style="tabGroupColorStyle(workspace.color)"
        v-tooltip="t('runtime.tabs.newTab', { name: workspace.name })"
        :aria-label="t('runtime.tabs.newTab', { name: workspace.name })"
        @click="emit('newTab', workspace.id)"
        @dragenter="overNewTab($event, workspace.id)"
        @dragover="overNewTab($event, workspace.id)"
        @drop="dropOnNewTab($event, workspace.id)"
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
      :class="{ 'link-drop-target': linkDropWorkspaceId === '' }"
      type="button"
      v-tooltip="t('tabSearch.newTabTitle')"
      :aria-label="t('tabSearch.newTabTitle')"
      @click="emit('newTab')"
      @dragenter="overNewTab($event)"
      @dragover="overNewTab($event)"
      @drop="dropOnNewTab($event)"
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

