import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import type {
  HronautSidebarOverlayApi,
  SidebarOverlayFooterAction,
  SidebarOverlayIntent,
  SidebarOverlayPlatform,
  SidebarOverlayPointer
} from '../../../shared/sidebar-overlay.js'
import type { BrowserTabState } from '../../../shared/types.js'
import { sidebarOverlayModel, type SidebarOverlayModelInputs } from './sidebar-overlay-model.js'
import { useAgentPresence } from './useAgentPresence.js'
import { useSidebarOverlay } from './useSidebarOverlay.js'

/** What a click in the shell's own rail does, which a click in the rail opened over the page asks for. */
export interface SidebarOverlayCommands {
  /** Runs an action as the chrome runs a click, which reports a failure. */
  runAction: (action: () => unknown) => Promise<boolean>
  tabs: () => readonly BrowserTabState[]
  openHome: () => unknown
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => unknown
  toggleTabMuted: (tab: BrowserTabState) => unknown
  stopWorkerCapture: (tabId: string) => unknown
  reorderTab: (request: { tabId: string; targetTabId: string; placement: 'before' | 'after' }) => unknown
  newTabInWorkspace: (workspaceId?: string) => unknown
  toggleWorkspace: (workspaceId: string) => void
  openNewWorkspaceEditor: () => unknown
  toggleWorkspaceSwitcher: () => unknown
  stayHere: () => void
  toggleRailPinned: () => void
  startTabDrag: () => void
  scrollTabList: (top: number) => void
  /** Folds the rail. */
  closeRail: () => void
  /** The footer's buttons, but the agent service summary, which opens from the shell's own rail. */
  footer: Record<Exclude<SidebarOverlayFooterAction, 'mcp-summary'>, () => unknown>
  openMcpSummary: () => void
  /** Opens the rail beside the page for this opening, rather than over it. */
  refuseOverlay: () => void
}

/** What the person did in the rail over the page, run as the same click in the shell's own rail. */
export function runSidebarOverlayIntent(intent: SidebarOverlayIntent, commands: SidebarOverlayCommands): void {
  const run = (action: () => unknown): void => { void commands.runAction(action) }
  switch (intent.kind) {
    case 'open-home': run(commands.openHome); return
    case 'select-tab': commands.selectTab(intent.tabId); return
    case 'close-tab': run(() => commands.closeTab(intent.tabId)); return
    case 'toggle-tab-muted': {
      const tab = commands.tabs().find((candidate) => candidate.id === intent.tabId)
      if (tab) run(() => commands.toggleTabMuted(tab))
      return
    }
    case 'stop-worker-capture': void commands.stopWorkerCapture(intent.tabId); return
    case 'reorder-tab': {
      const { tabId, targetTabId, placement } = intent
      run(() => commands.reorderTab({ tabId, targetTabId, placement }))
      return
    }
    case 'new-tab': run(() => commands.newTabInWorkspace(intent.workspaceId)); return
    case 'toggle-workspace': commands.toggleWorkspace(intent.workspaceId); return
    case 'create-workspace': run(commands.openNewWorkspaceEditor); return
    case 'switch-workspace': run(commands.toggleWorkspaceSwitcher); return
    case 'stay-here': commands.stayHere(); return
    case 'toggle-rail-pinned': commands.toggleRailPinned(); return
    case 'drag-start': commands.startTabDrag(); return
    case 'scroll': commands.scrollTabList(intent.top); return
    case 'dismiss': commands.closeRail(); return
    case 'tab-context-menu':
    case 'workspace-context-menu':
      // Main opens these menus itself, so the rail stays open while one is.
      return
    case 'footer':
      if (intent.action !== 'mcp-summary') {
        run(commands.footer[intent.action])
        return
      }
      // The summary opens from the shell's own rail's pill, so that rail opens beside the page for it.
      commands.refuseOverlay()
      void nextTick(commands.openMcpSummary)
  }
}

export interface ChromeSidebarOverlayOptions {
  /** Main's channel for the open rail over the page; without it the rail opens beside the page. */
  api: HronautSidebarOverlayApi | undefined
  agentPresenceApi: HronautAgentPresenceApi | undefined
  platform: SidebarOverlayPlatform
  shell: {
    verticalTabRailOverlaid: Readonly<Ref<boolean>>
    expandedTabRailWidth: Readonly<Ref<number>>
    setVerticalTabRailOverlayAvailable: (available: boolean) => void
    delegateVerticalTabRail: (active: boolean) => void
    setVerticalTabRailOverlayPointer: (pointer: SidebarOverlayPointer) => void
    refuseVerticalTabRailOverlay: () => void
  }
  /** The chrome hides for the full-page view, and the rail cannot open over the page meanwhile. */
  fullPageActive: Readonly<Ref<boolean>>
  /** The shell's rail, whose top padding leaves room for a title bar the shell draws over it. */
  topbar: Readonly<Ref<HTMLElement | null>>
  /** What the rail shows apart from the window's appearance; read again whenever what it reads changes. */
  rail: () => Omit<SidebarOverlayModelInputs, 'theme' | 'tint' | 'platform' | 'width' | 'top' | 'viewport' | 'agents'>
  commands: SidebarOverlayCommands
}

/**
 * With the rail collapsed when not in use, the pointer opens it over the page in main's own view; the shell's rail
 * stays folded, so the page keeps its place. The view draws what the shell's rail would show, in the window's theme,
 * workspace color, size and title bar, and hands back what the person does, which runs as a click in the shell's rail.
 * Without main's channel the rail opens beside the page as before.
 */
export function useChromeSidebarOverlay(options: ChromeSidebarOverlayOptions): void {
  const { api, shell } = options
  if (!api) return
  watch(options.fullPageActive, (active) => shell.setVerticalTabRailOverlayAvailable(!active), { immediate: true })

  const root = document.documentElement
  const readAppearance = (): { theme: string | undefined; tint: string } => ({ theme: root.dataset.theme, tint: root.style.getPropertyValue('--workspace-tint') })
  const appearance = ref(readAppearance())
  const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
  // The rail starts below a title bar the shell draws over it, whose height follows the window controls and the scale.
  const top = ref(0)
  function readTop(): void {
    const topbar = options.topbar.value
    top.value = topbar ? Number.parseFloat(getComputedStyle(topbar).paddingTop) || 0 : 0
  }
  const appearanceObserver = new MutationObserver(() => {
    appearance.value = readAppearance()
    readTop()
  })
  appearanceObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] })
  function updateViewport(): void {
    viewport.value = { width: window.innerWidth, height: window.innerHeight }
    readTop()
  }
  window.addEventListener('resize', updateViewport)
  // A padding that grows shrinks the rail's content box, which the observer hears.
  let topObserver: ResizeObserver | undefined
  const stopTopbar = watch(options.topbar, (topbar) => {
    topObserver?.disconnect()
    topObserver = undefined
    readTop()
    if (topbar && typeof ResizeObserver !== 'undefined') {
      topObserver = new ResizeObserver(readTop)
      topObserver.observe(topbar)
    }
  }, { immediate: true, flush: 'post' })
  const presence = options.agentPresenceApi ? useAgentPresence(options.agentPresenceApi) : undefined
  onScopeDispose(() => {
    appearanceObserver.disconnect()
    window.removeEventListener('resize', updateViewport)
    stopTopbar()
    topObserver?.disconnect()
    presence?.dispose()
  })

  useSidebarOverlay({
    api,
    overlaid: shell.verticalTabRailOverlaid,
    model: () => sidebarOverlayModel({
      ...options.rail(),
      theme: appearance.value.theme,
      tint: appearance.value.tint,
      platform: options.platform,
      width: shell.expandedTabRailWidth.value,
      top: top.value,
      viewport: viewport.value,
      agents: presence?.snapshot.value.workspaces ?? {}
    }),
    delegate: shell.delegateVerticalTabRail,
    pointer: shell.setVerticalTabRailOverlayPointer,
    refused: shell.refuseVerticalTabRailOverlay,
    hidden: () => options.commands.closeRail(),
    intent: (intent) => runSidebarOverlayIntent(intent, options.commands)
  })
}
