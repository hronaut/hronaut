<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { themeColorScheme } from '../../../shared/theme.js'
import type {
  HronautSidebarOverlayViewApi,
  SidebarOverlayFooterAction,
  SidebarOverlayIntent,
  SidebarOverlayModel,
  SidebarOverlayState,
  SidebarOverlayTab
} from '../../../shared/sidebar-overlay.js'
import type {
  BrowserDownloadState,
  BrowserEmulationState,
  BrowserPageProblem,
  BrowserState,
  BrowserTabState,
  McpTabActivity,
  UserAttentionRequest
} from '../../../shared/types.js'
import { installShellTooltips } from '../composables/shell-tooltips.js'
import type { McpStatusControlsController } from '../features/mcp/useMcpStatusController.js'
import { createShellViewportMedia } from '../shell-viewport-media.js'
import AppTopbarActions from './AppTopbarActions.vue'
import BrowserTabsBar from '../features/tabs/BrowserTabsBar.vue'

const props = defineProps<{ api: HronautSidebarOverlayViewApi }>()

const { locale } = useI18n({ useScope: 'global' })
const state = shallowRef<SidebarOverlayState | null>(null)
const model = computed((): SidebarOverlayModel | null => state.value?.model ?? null)

function send(intent: SidebarOverlayIntent): void {
  props.api.intent(intent)
}

function footer(action: SidebarOverlayFooterAction): void {
  send({ kind: 'footer', action })
}

// The rail reads only these fields of a tab. A page problem, an emulation and unconfirmed network conditions show as
// marks; their details stay in the shell, and the view needs only to know that they are there.
const PRESENT = Object.freeze({})

function tabState(tab: SidebarOverlayTab): BrowserTabState {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    ...(tab.label !== undefined ? { label: tab.label } : {}),
    loading: tab.loading,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: tab.active,
    pinned: tab.pinned,
    sleeping: tab.sleeping,
    ...(tab.pageLifecycleState !== undefined ? { pageLifecycleState: tab.pageLifecycleState } : {}),
    humanInteractionLocked: tab.humanInteractionLocked,
    ...(tab.humanInteractionInputLocked !== undefined ? { humanInteractionInputLocked: tab.humanInteractionInputLocked } : {}),
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    ...(tab.faviconDataUrl !== undefined ? { faviconDataUrl: tab.faviconDataUrl } : {}),
    audible: tab.audible,
    muted: tab.muted,
    devToolsOpen: false,
    ...(tab.emulation ? { emulation: PRESENT as BrowserEmulationState } : {}),
    ...(tab.networkRouteCount !== undefined ? { networkRouteCount: tab.networkRouteCount } : {}),
    ...(tab.networkConditionUnconfirmed ? { networkConditionState: { application: 'unknown' as const, retainedRules: [] } } : {}),
    ...(tab.videoRecording ? { videoRecording: 'recording' as const } : {}),
    pwaLifecycleActive: tab.pwaLifecycleActive,
    ...(tab.pageProblem ? { pageProblem: PRESENT as BrowserPageProblem } : {}),
    ...(tab.mcpGroupId !== undefined ? { mcpGroupId: tab.mcpGroupId } : {})
  }
}

const railTabs = computed(() => new Map((model.value?.rail.tabs ?? []).map((tab) => [tab.id, tab])))

const browserState = computed((): BrowserState => {
  const rail = model.value?.rail
  return {
    tabs: rail?.tabs.map(tabState) ?? [],
    closedTabs: [],
    activeTabId: rail?.activeTabId ?? null,
    ...(rail?.splitView ? { splitView: { ...rail.splitView, ratio: 0.5 } } : {}),
    allTabsMuted: rail?.allTabsMuted ?? false,
    allHumanInteractionLocked: rail?.allHumanInteractionLocked ?? false,
    mcpUrl: '',
    profilePath: '',
    mcpTabGroups: (rail?.workspaces ?? []).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      color: workspace.color,
      ...(workspace.pinnedAt !== undefined ? { pinnedAt: workspace.pinnedAt } : {}),
      ...(workspace.hiddenFromSidebar !== undefined ? { hiddenFromSidebar: workspace.hiddenFromSidebar } : {}),
      createdAt: '',
      lastUsedAt: '',
      tabCount: 0,
      activeTabId: null,
      storageOriginCount: 0,
      navigationPolicy: { mode: 'unrestricted', rules: [] }
    })),
    savedTabGroups: [],
    ...(rail?.agentFollow ? { agentFollow: rail.agentFollow } : {})
  }
})

const userAttention = computed((): UserAttentionRequest | null => {
  const attention = model.value?.rail.attention
  if (!attention) return null
  return {
    id: 'sidebar-overlay',
    requestedAt: '',
    reason: attention.reason,
    ...(attention.tabId !== undefined ? { tabId: attention.tabId } : {}),
    ...(attention.workspaceId !== undefined ? { workspaceId: attention.workspaceId } : {}),
    ...(attention.decision ? { humanWaitingDecisionId: 'sidebar-overlay' } : {})
  }
})

const mcpActivityByTab = computed((): Record<string, McpTabActivity> => Object.fromEntries(
  [...railTabs.value.values()].filter((tab) => tab.agentCommand).map((tab) => [tab.id, {
    activityId: tab.id,
    tabId: tab.id,
    toolName: tab.agentCommand!,
    phase: 'started' as const,
    occurredAt: 0
  }])
))

// Each workspace header shows its agents as the shell's rail shows them.
let presence: AgentPresenceSnapshot = { revision: 0, workspaces: {} }
const presenceListeners = new Set<(snapshot: AgentPresenceSnapshot) => void>()
const presenceApi: HronautAgentPresenceApi = {
  get: () => Promise.resolve(presence),
  onChanged: (listener) => {
    presenceListeners.add(listener)
    return () => presenceListeners.delete(listener)
  }
}

function publishPresence(next: SidebarOverlayModel): void {
  const workspaces: Record<string, AgentPresence[]> = {}
  for (const [workspaceId, agents] of Object.entries(next.rail.agents)) {
    workspaces[workspaceId] = agents.map((agent) => ({ ...agent, step: 'working', recentSteps: [] }))
  }
  presence = { revision: presence.revision + 1, workspaces }
  for (const listener of presenceListeners) listener(presence)
}

const numberFormat = computed(() => new Intl.NumberFormat(model.value?.locale ?? 'en-US'))
const formatNumber = (value: number): string => numberFormat.value.format(value)

function stopWorkerCapture(tabId: string): Promise<void> {
  send({ kind: 'stop-worker-capture', tabId })
  return Promise.resolve()
}

const tabTooltip = (tab: BrowserTabState): string => railTabs.value.get(tab.id)?.tooltip ?? tab.title
const describeEmulation = (tab: BrowserTabState): string => railTabs.value.get(tab.id)?.emulationDescription ?? ''

// The download button shows a count, a spinner while one runs and a done mark; the downloads stay in the shell.
const downloads = computed((): BrowserDownloadState[] => Array.from({ length: model.value?.footer.downloadCount ?? 0 }, (_, index) => ({
  state: index === 0 && model.value?.footer.lastDownloadDone ? 'completed' : 'interrupted'
}) as BrowserDownloadState))
const activeDownloads = computed((): BrowserDownloadState[] => Array.from({ length: model.value?.footer.activeDownloadCount ?? 0 }, () => ({
  state: 'progressing'
}) as BrowserDownloadState))

const mcpState = computed(() => model.value?.footer.mcp.state ?? { status: 'starting' as const, paused: false })
const mcpPauseBusy = computed(() => model.value?.footer.mcp.pauseBusy ?? false)
// The pill and pause button run in the shell; its summary opens there, from the shell's own rail.
const mcpController: McpStatusControlsController = {
  endpoint: computed(() => model.value?.footer.mcp.endpoint ?? ''),
  state: mcpState,
  copied: ref(false),
  refreshFailed: ref(false),
  pauseBusy: mcpPauseBusy,
  portBusy: ref(false),
  portFailed: ref(null),
  canTogglePaused: computed(() => !mcpPauseBusy.value && (mcpState.value.status === 'ready' || mcpState.value.status === 'paused')),
  summaryOpen: computed({
    get: () => false,
    set: (open: boolean) => { if (open) footer('mcp-summary') }
  }),
  refresh: () => Promise.resolve(),
  copyEndpoint: () => Promise.resolve(false),
  togglePaused: () => {
    footer('mcp-pause')
    return Promise.resolve(true)
  },
  moveToSuggestedPort: () => Promise.resolve(null)
}

const updateState = computed(() => model.value?.footer.update ?? { status: 'idle' as const, currentVersion: '' })

const bindViewportMedia = createShellViewportMedia()

// Where the pointer is, and whether a press or a drag holds the rail open; main hears each change.
let hovered = false
let pressed = false
let dragging = false
let reported = ''

function reportPointer(): void {
  const pointer = { hovered, held: pressed || dragging }
  const key = `${state.value?.session ?? 0}:${pointer.hovered}:${pointer.held}`
  if (key === reported) return
  reported = key
  props.api.pointer(pointer)
}

function resetPointer(): void {
  hovered = pressed = dragging = false
  reported = ''
}

function onPointerOver(): void {
  if (hovered) return
  hovered = true
  reportPointer()
}

function onPointerOut(event: PointerEvent): void {
  // Only leaving the view counts, not moving between its controls.
  if (event.relatedTarget) return
  hovered = false
  reportPointer()
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary) return
  pressed = true
  reportPointer()
}

function onPointerUp(event: PointerEvent): void {
  if (!event.isPrimary) return
  pressed = false
  reportPointer()
}

function onDragStart(): void {
  dragging = true
  reportPointer()
  send({ kind: 'drag-start' })
}

function onDragEnd(): void {
  dragging = false
  pressed = false
  reportPointer()
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !event.defaultPrevented) send({ kind: 'dismiss' })
}

// A scroll the person makes moves the shell's own rail with it, so the rail opens there next time.
let shellScrollTop = 0
let scrollFrame: number | undefined
function onScroll(event: Event): void {
  const strip = event.target
  if (!(strip instanceof HTMLElement) || !strip.classList.contains('tabs-strip') || scrollFrame !== undefined) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = undefined
    if (Math.abs(strip.scrollTop - shellScrollTop) < 1) return
    shellScrollTop = strip.scrollTop
    send({ kind: 'scroll', top: shellScrollTop })
  })
}

function applyDocument(next: SidebarOverlayModel): void {
  const root = document.documentElement
  root.dataset.theme = next.theme
  root.style.colorScheme = themeColorScheme(next.theme)
  root.lang = next.locale
  locale.value = next.locale
  if (next.tint) root.style.setProperty('--workspace-tint', next.tint)
  else root.style.removeProperty('--workspace-tint')
  root.style.setProperty('--sidebar-overlay-top', `${next.top}px`)
  root.style.setProperty('--sidebar-overlay-shell-width', `${next.viewport.width}px`)
  root.style.setProperty('--sidebar-overlay-shell-height', `${next.viewport.height}px`)
  bindViewportMedia(next.viewport)
}

async function receive(next: SidebarOverlayState): Promise<void> {
  const opening = next.session !== state.value?.session
  const root = document.documentElement
  if (opening) {
    resetPointer()
    // The first drawing of an opening shows the workspace's wash at once; a later change crossfades as in the shell.
    root.classList.add('sidebar-overlay-settling')
  }
  applyDocument(next.model)
  state.value = next
  publishPresence(next.model)
  // The rail mounts afresh for each opening, its tab list scrolled where the shell's is, once it has laid itself out.
  if (opening) shellScrollTop = next.model.rail.scrollTop
  await nextTick()
  await nextTick()
  if (state.value !== next) return
  // Reading the box lays the view out while it is still hidden; a hidden view may never produce a frame.
  document.body.getBoundingClientRect()
  // The first opening waits for the rail's font, so it never shows in a fallback face.
  if (document.fonts.status === 'loading') await document.fonts.ready
  if (state.value !== next) return
  props.api.rendered({ revision: next.revision })
  if (opening) window.setTimeout(() => { if (state.value?.session === next.session) root.classList.remove('sidebar-overlay-settling') }, 0)
}

let stopState: (() => void) | undefined
let stopTooltips: (() => void) | undefined

function onVisibilityChange(): void {
  // A hidden view is no longer under the pointer; the next opening starts afresh.
  if (document.visibilityState === 'hidden') resetPointer()
}

onMounted(() => {
  stopState = props.api.onState((next) => { void receive(next) })
  stopTooltips = installShellTooltips({ showTooltip: (request) => props.api.showTooltip(request), hideTooltip: (id) => props.api.hideTooltip(id) }).dispose
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointermove', onPointerOver, true)
  document.addEventListener('pointerout', onPointerOut, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerUp, true)
  document.addEventListener('dragstart', onDragStart, true)
  document.addEventListener('dragend', onDragEnd, true)
  document.addEventListener('drop', onDragEnd, true)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('scroll', onScroll, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stopState?.()
  stopTooltips?.()
  if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
  document.removeEventListener('pointerover', onPointerOver, true)
  document.removeEventListener('pointermove', onPointerOver, true)
  document.removeEventListener('pointerout', onPointerOut, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('pointerup', onPointerUp, true)
  document.removeEventListener('pointercancel', onPointerUp, true)
  document.removeEventListener('dragstart', onDragStart, true)
  document.removeEventListener('dragend', onDragEnd, true)
  document.removeEventListener('drop', onDragEnd, true)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('scroll', onScroll, true)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <!-- The same structure as the shell's rail, so its stylesheet draws it the same way. -->
  <header
    v-if="model && state"
    class="shell vertical-tabs-shell sidebar-overlay-shell"
    :style="{ '--tab-rail-width': `${model.width}px`, '--tab-rail-expanded-width': `${model.width}px` }"
  >
    <div class="browser-chrome">
      <div class="topbar">
        <BrowserTabsBar
          :key="state.session"
          :state="browserState"
          :settings-active="model.rail.settingsActive"
          :user-attention="userAttention"
          :workspace-switcher-open="model.rail.workspaceSwitcherOpen"
          :hydrated="true"
          orientation="vertical"
          :rail-pinned="false"
          :rail-revealed="true"
          :force-rail-collapsed="false"
          :mcp-activity-by-tab="mcpActivityByTab"
          :presence-api="presenceApi"
          :format-number="formatNumber"
          :tab-tooltip="tabTooltip"
          :describe-emulation="describeEmulation"
          :collapsed-tab-group-ids="model.rail.collapsedWorkspaceIds"
          :platform="model.platform"
          :stop-tab-worker-capture="stopWorkerCapture"
          :initial-scroll-top="model.rail.scrollTop"
          @open-home="send({ kind: 'open-home' })"
          @stay-here="send({ kind: 'stay-here' })"
          @show-workspace-context-menu="send({ kind: 'workspace-context-menu', workspaceId: $event })"
          @new-tab="send($event === undefined ? { kind: 'new-tab' } : { kind: 'new-tab', workspaceId: $event })"
          @create-workspace="send({ kind: 'create-workspace' })"
          @select-tab="send({ kind: 'select-tab', tabId: $event })"
          @show-tab-context-menu="send({ kind: 'tab-context-menu', tabId: $event })"
          @reorder-tab="send({ kind: 'reorder-tab', ...$event })"
          @toggle-tab-muted="send({ kind: 'toggle-tab-muted', tabId: $event.id })"
          @close-tab="send({ kind: 'close-tab', tabId: $event })"
          @toggle-rail-pinned="send({ kind: 'toggle-rail-pinned' })"
          @switch-workspace="send({ kind: 'switch-workspace' })"
          @toggle-tab-group="send({ kind: 'toggle-workspace', workspaceId: $event })"
        />
        <AppTopbarActions
          :command-palette-open="model.footer.commandPaletteOpen"
          :tab-search-open="model.footer.tabSearchOpen"
          :downloads-open="model.footer.downloadsOpen"
          :history-open="model.footer.historyOpen"
          :settings-open="model.footer.settingsOpen"
          :downloads="downloads"
          :active-downloads="activeDownloads"
          :download-button-label="model.footer.downloadButtonLabel"
          :has-website-tabs="model.footer.hasWebsiteTabs"
          :all-tabs-muted="model.footer.allTabsMuted"
          :all-interaction-locked="model.footer.allInteractionLocked"
          :all-interaction-lock-label="model.footer.allInteractionLockLabel"
          :interaction-pending="model.footer.interactionPending"
          :audio-pending="model.footer.audioPending"
          :follow-agent-activity="model.footer.followAgentActivity"
          :show-update-status="model.footer.update !== undefined"
          :license-reminder-shown="model.footer.licenseReminderShown"
          :update-state="updateState"
          :mcp-status-controller="mcpController"
          @toggle-command-palette="footer('command-palette')"
          @toggle-tab-search="footer('tab-search')"
          @toggle-downloads="footer('downloads')"
          @toggle-history="footer('history')"
          @toggle-all-tabs-muted="footer('all-tabs-muted')"
          @toggle-all-interaction="footer('all-interaction')"
          @toggle-follow-agent-activity="footer('follow-agent-activity')"
          @open-update-settings="footer('update-settings')"
          @open-license-settings="footer('license-settings')"
          @toggle-settings="footer('settings')"
        />
      </div>
    </div>
  </header>
</template>
