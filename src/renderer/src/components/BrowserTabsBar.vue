<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
import IconLock from '~icons/material-symbols/lock-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconVerticalSplit from '~icons/material-symbols/vertical-split-rounded'
import IconVolumeOff from '~icons/material-symbols/volume-off-rounded'
import IconVolumeUp from '~icons/material-symbols/volume-up-rounded'
import type { BrowserState, BrowserTabGroupColor, BrowserTabState, McpTabActivity } from '../../../shared/types.js'
import { BROWSER_TAB_GROUP_COLOR_HEX, defaultTabGroupColor } from '../../../shared/tab-groups.js'

const props = defineProps<{
  state: BrowserState
  hydrated: boolean
  orientation: 'horizontal' | 'vertical'
  railPinned: boolean
  railRevealed?: boolean
  mcpActivityByTab: Record<string, McpTabActivity>
  formatNumber: (value: number) => string
  tabTooltip: (tab: BrowserTabState) => string
  describeEmulation: (tab: BrowserTabState) => string
}>()

const emit = defineEmits<{
  openHome: []
  showWorkspaceContextMenu: [groupId: string]
  newTab: [groupId: string]
  createWorkspace: []
  selectTab: [tabId: string]
  showTabContextMenu: [tabId: string]
  reorderTab: [details: { tabId: string; targetTabId: string; placement: 'before' | 'after' }]
  toggleTabMuted: [tab: BrowserTabState]
  closeTab: [tabId: string]
  dragStart: []
  toggleRailPinned: []
  railRevealChange: [revealed: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })
const homeTab = computed(() => props.state.tabs.find((tab) => tab.url.startsWith('hronaut://home')))
const regularTabs = computed(() => props.state.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')))
const collapsedTabGroupIds = ref(new Set<string>(loadCollapsedTabGroupIds()))
const focusedTabId = ref<string | null>(null)
const draggedTabId = ref<string | null>(null)
const tabDropTargetId = ref<string | null>(null)
const tabDropPlacement = ref<'before' | 'after' | null>(null)
const tabsStrip = ref<HTMLElement | null>(null)
const hasTabOverflow = ref(false)
const canScrollTabsBack = ref(false)
const canScrollTabsForward = ref(false)
let tabsStripResizeObserver: ResizeObserver | undefined
const vertical = computed(() => props.orientation === 'vertical')
const railHovered = ref(false)
const railFocusWithin = ref(false)
const railExpanded = computed(() => props.railPinned || props.railRevealed || railHovered.value || railFocusWithin.value)

function reportRailReveal(): void {
  emit('railRevealChange', vertical.value && (railHovered.value || railFocusWithin.value))
}

function setRailHovered(hovered: boolean): void {
  railHovered.value = hovered
  reportRailReveal()
}

function setRailFocusWithin(focused: boolean): void {
  railFocusWithin.value = focused
  reportRailReveal()
}

function handleRailFocusOut(event: FocusEvent): void {
  const navigation = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && navigation.contains(event.relatedTarget)) return
  setRailFocusWithin(false)
}

function updateTabOverflow(): void {
  const strip = tabsStrip.value
  if (!strip) return
  const contentExtent = vertical.value ? strip.scrollHeight : strip.scrollWidth
  const viewportExtent = vertical.value ? strip.clientHeight : strip.clientWidth
  // Vertical controls reserve space outside the scrolling viewport. Compare
  // content against the full shell so those controls cannot keep themselves
  // alive after tabs shrink enough to fit without them.
  const overflowCapacity = vertical.value
    ? strip.parentElement?.clientHeight ?? viewportExtent
    : viewportExtent
  const overflowing = contentExtent - overflowCapacity > 1
  const maximumScroll = Math.max(0, contentExtent - viewportExtent)
  hasTabOverflow.value = overflowing
  if (!overflowing) {
    canScrollTabsBack.value = false
    canScrollTabsForward.value = false
    return
  }
  const position = vertical.value ? strip.scrollTop : strip.scrollLeft
  canScrollTabsBack.value = position > 1
  canScrollTabsForward.value = position < maximumScroll - 1
}

function scrollTabs(direction: -1 | 1): void {
  const strip = tabsStrip.value
  if (!strip) return
  const distance = direction * Math.max(180, (vertical.value ? strip.clientHeight : strip.clientWidth) * 0.72)
  strip.scrollBy(vertical.value ? { top: distance, behavior: 'smooth' } : { left: distance, behavior: 'smooth' })
}

function scrollTabsWithWheel(event: WheelEvent): void {
  const strip = tabsStrip.value
  if (!strip || !hasTabOverflow.value || event.ctrlKey || (!vertical.value && Math.abs(event.deltaX) >= Math.abs(event.deltaY))) return
  event.preventDefault()
  if (vertical.value) strip.scrollTop += event.deltaY || event.deltaX
  else strip.scrollLeft += event.deltaY
  updateTabOverflow()
}

function revealActiveTab(behavior: ScrollBehavior = 'smooth'): void {
  const activeTab = tabsStrip.value?.querySelector<HTMLElement>('[data-active-tab="true"]')
  if (typeof activeTab?.scrollIntoView === 'function') {
    activeTab.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' })
  }
}

function activeTabIntersectsVisibleStrip(): boolean {
  const strip = tabsStrip.value
  const activeTab = strip?.querySelector<HTMLElement>('[data-active-tab="true"]')
  if (!strip || !activeTab) return false
  const stripBounds = strip.getBoundingClientRect()
  const tabBounds = activeTab.getBoundingClientRect()
  return vertical.value
    ? tabBounds.bottom >= stripBounds.top - 1 && tabBounds.top <= stripBounds.bottom + 1
    : tabBounds.right >= stripBounds.left - 1 && tabBounds.left <= stripBounds.right + 1
}

function handleTabStripResize(): void {
  updateTabOverflow()
  revealActiveTab()
}

function tabGroupStyle(tab: BrowserTabState): Record<string, string> | undefined {
  if (!tab.mcpGroupId) return undefined
  const color = props.state.mcpTabGroups.find((group) => group.id === tab.mcpGroupId)?.color ?? defaultTabGroupColor(tab.mcpGroupId)
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[color] }
}

function tabGroupColorStyle(color: BrowserTabGroupColor): Record<string, string> {
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[color] }
}

function loadCollapsedTabGroupIds(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? '[]')
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function tabGroupTabs(groupId: string): BrowserTabState[] {
  return regularTabs.value.filter((tab) => tab.mcpGroupId === groupId)
}

function tabGroupTabCount(groupId: string): number {
  return tabGroupTabs(groupId).length
}

function tabGroupContainsActiveTab(groupId: string): boolean {
  return tabGroupTabs(groupId).some((tab) => tab.active)
}

function isTabGroupCollapsed(groupId: string): boolean {
  return collapsedTabGroupIds.value.has(groupId)
}

const visibleTabs = computed(() => props.state.mcpTabGroups.flatMap((group) => (
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
    if (typeof control?.scrollIntoView === 'function') {
      control.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
}

function handleTabKeyDown(event: KeyboardEvent, tab: BrowserTabState): void {
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

function handleTabAuxClick(event: MouseEvent, tab: BrowserTabState): void {
  if (event.button !== 1) return
  event.preventDefault()
  if (props.state.allHumanInteractionLocked) return
  emit('closeTab', tab.id)
}

function persistCollapsedTabGroups(): void {
  window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify([...collapsedTabGroupIds.value]))
}

function toggleTabGroup(groupId: string): void {
  const next = new Set(collapsedTabGroupIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedTabGroupIds.value = next
  persistCollapsedTabGroups()
}

function expandTabGroup(groupId: string): void {
  if (!collapsedTabGroupIds.value.has(groupId)) return
  const next = new Set(collapsedTabGroupIds.value)
  next.delete(groupId)
  collapsedTabGroupIds.value = next
  persistCollapsedTabGroups()
}

function expandTabGroupForTab(tab: BrowserTabState): void {
  if (tab.mcpGroupId) expandTabGroup(tab.mcpGroupId)
}

function clearTabDrag(): void {
  draggedTabId.value = null
  tabDropTargetId.value = null
  tabDropPlacement.value = null
}

function canDropTab(target: BrowserTabState): boolean {
  const dragged = regularTabs.value.find((tab) => tab.id === draggedTabId.value)
  return Boolean(
    dragged
    && dragged.id !== target.id
    && dragged.pinned === target.pinned
    && dragged.mcpGroupId === target.mcpGroupId
  )
}

function beginTabDrag(event: DragEvent, tab: BrowserTabState): void {
  draggedTabId.value = tab.id
  tabDropTargetId.value = null
  tabDropPlacement.value = null
  emit('dragStart')
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tab.id)
  }
}

function updateTabDrop(event: DragEvent, tab: BrowserTabState): void {
  if (!canDropTab(tab)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tabDropTargetId.value = tab.id
  tabDropPlacement.value = vertical.value
    ? event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    : event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
}

function finishTabDrop(event: DragEvent, tab: BrowserTabState): void {
  if (!canDropTab(tab) || !draggedTabId.value || !tabDropPlacement.value) {
    clearTabDrag()
    return
  }
  event.preventDefault()
  const details = {
    tabId: draggedTabId.value,
    targetTabId: tab.id,
    placement: tabDropPlacement.value
  }
  clearTabDrag()
  emit('reorderTab', details)
}

watch(
  [() => props.hydrated, () => props.state.mcpTabGroups.map((group) => group.id).join(',')],
  ([hydrated]) => {
    if (!hydrated) return
    const validGroupIds = new Set(props.state.mcpTabGroups.map((group) => group.id))
    const next = new Set([...collapsedTabGroupIds.value].filter((groupId) => validGroupIds.has(groupId)))
    if (next.size === collapsedTabGroupIds.value.size) return
    collapsedTabGroupIds.value = next
    persistCollapsedTabGroups()
  },
  { immediate: true }
)

watch(
  [
    () => props.state.tabs.map((tab) => `${tab.id}:${tab.title}:${tab.pinned}:${tab.mcpGroupId ?? ''}`).join('|'),
    () => props.state.mcpTabGroups.map((group) => `${group.id}:${group.name}:${group.isDefault}`).join('|'),
    () => [...collapsedTabGroupIds.value].sort().join('|')
  ],
  async () => {
    const revealAfterLayout = activeTabIntersectsVisibleStrip()
    await nextTick()
    updateTabOverflow()
    if (revealAfterLayout) revealActiveTab()
  }
)

watch(
  () => props.orientation,
  async () => {
    await nextTick()
    updateTabOverflow()
    revealActiveTab('auto')
  }
)

watch(
  () => props.state.activeTabId,
  async (activeTabId) => {
    const tab = visibleTabs.value.find((candidate) => candidate.id === activeTabId)
    if (tab) focusedTabId.value = tab.id
    await nextTick()
    revealActiveTab()
  }
)

onMounted(async () => {
  await nextTick()
  const active = visibleTabs.value.find((tab) => tab.id === props.state.activeTabId)
  if (active) focusedTabId.value = active.id
  revealActiveTab()
  updateTabOverflow()
  if (typeof ResizeObserver !== 'undefined' && tabsStrip.value) {
    tabsStripResizeObserver = new ResizeObserver(handleTabStripResize)
    tabsStripResizeObserver.observe(tabsStrip.value)
  }
})

onBeforeUnmount(() => {
  tabsStripResizeObserver?.disconnect()
  emit('railRevealChange', false)
})

watch(vertical, (isVertical) => {
  if (isVertical) return
  railHovered.value = false
  railFocusWithin.value = false
  emit('railRevealChange', false)
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
      || !wasHydrated
      || (activeTabId === previousActiveTabId && activeTabGroupId === previousActiveTabGroupId)
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
</script>

<template>
  <nav
    class="browser-tabs-bar"
    :class="[orientation, { 'rail-collapsed': vertical && !railExpanded }]"
    :data-shell-tab-rail="vertical ? '' : undefined"
    :aria-label="t('shell.tabs.navigation')"
    @mouseenter="setRailHovered(true)"
    @mouseleave="setRailHovered(false)"
    @focusin="setRailFocusWithin(true)"
    @focusout="handleRailFocusOut"
  >
  <button
    class="app-home-button"
    :class="{ active: homeTab?.active }"
    type="button"
    :title="t('shell.home.open')"
    :aria-label="t('shell.home.open')"
    :aria-current="homeTab?.active ? 'page' : undefined"
    @click="emit('openHome')"
  >
    <span v-if="homeTab?.loading" class="spinner" :aria-label="t('shell.loading')" />
    <IconDashboard v-else aria-hidden="true" />
    <span>{{ t('shell.home.label') }}</span>
  </button>
  <span class="topbar-divider" aria-hidden="true" />
  <div class="tabs-strip-shell" :class="{ 'has-tab-overflow': hasTabOverflow }">
    <button
      v-if="hasTabOverflow"
      class="tabs-scroll-button previous"
      type="button"
      :disabled="!canScrollTabsBack"
      :title="t('shell.tabs.scrollBack')"
      :aria-label="t('shell.tabs.scrollBack')"
      @click="scrollTabs(-1)"
    ><IconKeyboardArrowUp v-if="vertical" aria-hidden="true" /><IconKeyboardArrowLeft v-else aria-hidden="true" /></button>
    <div
      ref="tabsStrip"
      class="tabs-strip"
      role="group"
      :aria-label="t('shell.tabs.list')"
      @scroll="updateTabOverflow"
      @wheel="scrollTabsWithWheel"
    >
    <div
      v-for="workspace in state.mcpTabGroups"
      :key="workspace.id"
      class="workspace-tab-section"
      role="group"
      :aria-label="workspace.name"
    >
      <button
        class="tab-group-label"
        :class="{ active: tabGroupContainsActiveTab(workspace.id) }"
        :style="tabGroupColorStyle(workspace.color)"
        :title="t(isTabGroupCollapsed(workspace.id) ? 'runtime.tabs.expand' : 'runtime.tabs.collapse', { name: workspace.name, id: workspace.id })"
        :aria-label="t(isTabGroupCollapsed(workspace.id) ? 'runtime.tabs.expandAria' : 'runtime.tabs.collapseAria', { name: workspace.name, count: formatNumber(tabGroupTabCount(workspace.id)) }, tabGroupTabCount(workspace.id))"
        :aria-expanded="!isTabGroupCollapsed(workspace.id)"
        type="button"
        @click="toggleTabGroup(workspace.id)"
        @contextmenu.prevent="emit('showWorkspaceContextMenu', workspace.id)"
      >
        <IconKeyboardArrowRight v-if="isTabGroupCollapsed(workspace.id)" aria-hidden="true" />
        <IconKeyboardArrowDown v-else aria-hidden="true" />
        <IconKeep
          v-if="workspace.isDefault"
          class="tab-group-default-badge"
          :aria-label="t('shell.tabs.defaultWorkspace')"
        />
        <span>{{ workspace.name }}</span>
        <span class="tab-group-count" aria-hidden="true">{{ tabGroupTabCount(workspace.id) }}</span>
      </button>
      <button
        class="new-tab workspace-new-tab"
        type="button"
        :style="tabGroupColorStyle(workspace.color)"
        :title="t('runtime.tabs.newTab', { name: workspace.name })"
        :aria-label="t('runtime.tabs.newTab', { name: workspace.name })"
        @click="emit('newTab', workspace.id)"
      ><IconAdd aria-hidden="true" /></button>
      <div class="workspace-tab-list" role="tablist" :aria-label="workspace.name">
        <button
          v-for="tab in isTabGroupCollapsed(workspace.id) ? [] : tabGroupTabs(workspace.id)"
          :key="tab.id"
          class="tab"
          :class="{
            active: tab.active,
            pinned: tab.pinned,
            sleeping: tab.sleeping,
            grouped: Boolean(tab.mcpGroupId),
            dragging: draggedTabId === tab.id,
            'drop-before': tabDropTargetId === tab.id && tabDropPlacement === 'before',
            'drop-after': tabDropTargetId === tab.id && tabDropPlacement === 'after',
            locked: state.allHumanInteractionLocked || tab.humanInteractionLocked,
            'split-visible': state.splitView?.firstTabId === tab.id || state.splitView?.secondTabId === tab.id,
            'mcp-active': Boolean(mcpActivityByTab[tab.id])
          }"
          :style="tabGroupStyle(tab)"
          :title="mcpActivityByTab[tab.id] ? `AI command: ${mcpActivityByTab[tab.id].toolName}` : tabTooltip(tab)"
          :data-mcp-command="mcpActivityByTab[tab.id]?.toolName"
          :aria-label="tabTooltip(tab)"
          type="button"
          role="tab"
          :tabindex="tabKeyboardIndex(tab)"
          :data-tab-id="tab.id"
          draggable="true"
          :aria-selected="tab.active"
          :data-active-tab="tab.active ? 'true' : undefined"
          @focus="focusedTabId = tab.id"
          @keydown="handleTabKeyDown($event, tab)"
          @click="emit('selectTab', tab.id)"
          @auxclick="handleTabAuxClick($event, tab)"
          @contextmenu.prevent="emit('showTabContextMenu', tab.id)"
          @dragstart="beginTabDrag($event, tab)"
          @dragover="updateTabDrop($event, tab)"
          @drop="finishTabDrop($event, tab)"
          @dragend="clearTabDrag"
        >
          <span v-if="tab.active" class="tab-active-indicator" aria-hidden="true" />
          <span v-if="tab.loading" class="spinner" :aria-label="t('shell.loading')" />
          <IconError v-else-if="tab.pageProblem" class="favicon-fallback tab-problem-icon" :aria-label="t('shell.tabs.pageAttention')" />
          <img v-else-if="tab.faviconDataUrl" class="favicon-image" :src="tab.faviconDataUrl" alt="" draggable="false" />
          <span v-else-if="tab.url === 'about:blank'" class="favicon-fallback" aria-hidden="true">✦</span>
          <IconLanguage v-else class="favicon-fallback" aria-hidden="true" />
          <span class="tab-title">{{ tab.title || t('tabSearch.newTabTitle') }}</span>
          <IconBedtime v-if="tab.sleeping" class="tab-sleep-mark" :aria-label="t('shell.tabs.sleeping')" />
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
          <IconRoute v-if="tab.networkRouteCount" class="tab-network-route-mark" :aria-label="t('runtime.tabs.routes', { count: formatNumber(tab.networkRouteCount) }, tab.networkRouteCount)" />
          <IconLock v-if="state.allHumanInteractionLocked || tab.humanInteractionLocked" class="tab-lock-mark" :aria-label="t('shell.tabs.inputLocked')" />
          <span
            v-if="tab.audible || tab.muted"
            class="tab-audio"
            :class="{ muted: tab.muted }"
            role="button"
            :title="t(tab.muted ? 'runtime.tabs.unmute' : 'runtime.tabs.mute', { title: tab.title || t('runtime.tabs.unnamed') })"
            :aria-label="t(tab.muted ? 'runtime.tabs.unmute' : 'runtime.tabs.mute', { title: tab.title || t('runtime.tabs.unnamed') })"
            :aria-pressed="tab.muted"
            @click.stop="emit('toggleTabMuted', tab)"
          >
            <IconVolumeOff v-if="tab.muted" aria-hidden="true" />
            <IconVolumeUp v-else aria-hidden="true" />
          </span>
          <span
            class="tab-close"
            role="button"
            :title="state.allHumanInteractionLocked ? t('runtime.locks.unlockToClose') : t('runtime.locks.closeShortcut')"
            :aria-label="state.allHumanInteractionLocked ? t('runtime.locks.closeUnavailable') : t('tabSearch.closeTab')"
            aria-keyshortcuts="Control+W Meta+W"
            :aria-disabled="state.allHumanInteractionLocked"
            data-lock-protected-tab-close
            @click.stop="emit('closeTab', tab.id)"
          ><IconClose aria-hidden="true" /></span>
        </button>
      </div>
    </div>
    <span class="workspace-action-divider" aria-hidden="true" />
    <button
      class="new-workspace"
      type="button"
      :title="t('shell.tabs.createWorkspaceTitle')"
      :aria-label="t('shell.tabs.createWorkspace')"
      @click="emit('createWorkspace')"
    >
      <IconAddBox aria-hidden="true" />
      <span>{{ t('shell.tabs.workspace') }}</span>
    </button>
    </div>
    <button
      v-if="hasTabOverflow"
      class="tabs-scroll-button next"
      type="button"
      :disabled="!canScrollTabsForward"
      :title="t('shell.tabs.scrollForward')"
      :aria-label="t('shell.tabs.scrollForward')"
      @click="scrollTabs(1)"
    ><IconKeyboardArrowDown v-if="vertical" aria-hidden="true" /><IconKeyboardArrowRight v-else aria-hidden="true" /></button>
  </div>
  <button
    v-if="vertical"
    class="tab-rail-pin"
    type="button"
    :title="t(railPinned ? 'shell.tabs.collapseRail' : 'shell.tabs.keepRailExpanded')"
    :aria-label="t(railPinned ? 'shell.tabs.collapseRail' : 'shell.tabs.keepRailExpanded')"
    :aria-pressed="railPinned"
    @click="emit('toggleRailPinned')"
  >
    <IconKeep v-if="railPinned" aria-hidden="true" />
    <IconKeepOff v-else aria-hidden="true" />
    <span>{{ t(railPinned ? 'shell.tabs.collapseRail' : 'shell.tabs.keepRailExpanded') }}</span>
  </button>
  </nav>
</template>
