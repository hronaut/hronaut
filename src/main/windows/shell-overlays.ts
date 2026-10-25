import { screen, webContents as allWebContents, type WebContentsView } from 'electron'
import { join } from 'node:path'
import { ShellOverlayView } from '../shell-overlay-view.js'
import { AgentCardOverlay, type AgentCardSurface, type FollowSuspensionState } from '../agent-card-overlay.js'
import { ToastOverlay, type ToastOverlaySurface } from '../toast-overlay.js'
import { ShellTooltipOverlay, type ShellTooltipSurface } from '../shell-tooltip-overlay.js'
import { SidebarOverlay, type SidebarOverlaySurface } from '../sidebar-overlay.js'
import { StatusBubbleOverlay, type StatusBubblePane, type StatusBubbleSurface } from '../status-bubble-overlay.js'
import type { ResolvedThemeName } from '../../shared/theme.js'
import type { TabRuntimeState } from '../tab-runtime-startup.js'
import type { AddressSuggestionOverlay } from './address-suggestion-overlay.js'
import type { MainWindowRefs } from './main-window.js'
import type { AgentCardEvent } from '../../shared/agent-card.js'
import type { ToastOverlayEvent } from '../../shared/toast-overlay.js'
import type { SidebarOverlayEvent } from '../../shared/sidebar-overlay.js'

interface ShellOverlaysHost {
  /** Whether a frame's address is the expected trusted page, with or without a fragment; each view admits only its own. */
  trustedUrlMatches(actual: string | undefined, expected: string): boolean
  /** The main window, whose content view holds the overlay views; read on every use because it opens after startup. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** The address suggestions overlay, which stays above a toast and never gets focus back from one. */
  addressSuggestionOverlay: Pick<AddressSuggestionOverlay, 'currentView' | 'owns'>
  /** What suspends Follow; the agent card sets whether it is open, and the shell IPC sets the shell's request. */
  followSuspension: FollowSuspensionState
  /** The tab runtime, which lays out the toast and follows agent activity; read when an overlay needs it. */
  tabRuntime: Pick<TabRuntimeState, 'tabs' | 'initializedTabs' | 'startupFailure'>
  /** The trusted documents of the overlay views and the surfaces drawn through them, from windows/overlay-surfaces.ts. */
  trustedAgentCardUrl(): string
  ensureAgentCardSurface(): Promise<AgentCardSurface>
  trustedToastOverlayUrl(): string
  ensureToastOverlaySurface(): Promise<ToastOverlaySurface>
  trustedTooltipOverlayUrl(): string
  ensureTooltipSurface(): Promise<ShellTooltipSurface>
  trustedSidebarOverlayUrl(): string
  ensureSidebarOverlaySurface(): Promise<SidebarOverlaySurface>
  trustedStatusBubbleUrl(): string
  ensureStatusBubbleSurface(): Promise<StatusBubbleSurface>
  /** The theme the shell shows now. */
  theme(): ResolvedThemeName
}

/**
 * The shell's overlays above the page views: the tooltip, the agent card, the toast, the tab rail opened over the
 * page and the status bubble at a page's corner, each a controller and the view it draws through. The views load their documents on first use, and the surfaces come from the host
 * because they are built from these views. `__dirname` is the bundled main entry's directory, as for the other main
 * modules.
 */
export function createShellOverlays(host: ShellOverlaysHost): {
  tooltipView: ShellOverlayView
  agentCardView: ShellOverlayView
  agentCards: AgentCardOverlay
  toastOverlayView: ShellOverlayView
  toastOverlay: ToastOverlay
  shellTooltips: ShellTooltipOverlay
  sidebarOverlayView: ShellOverlayView
  sidebarOverlay: SidebarOverlay
  statusBubbleView: ShellOverlayView
  statusBubble: StatusBubbleOverlay
} {
  const tooltipView = new ShellOverlayView({
    name: 'tooltip',
    preload: join(__dirname, '../preload/tooltipOverlay.cjs'),
    url: () => host.trustedTooltipOverlayUrl(),
    window: () => host.mainWindowRefs.window,
    urlMatches: (actual, expected) => host.trustedUrlMatches(actual, expected),
    onLost: () => shellTooltips.surfaceLost()
  })
  const agentCardView = new ShellOverlayView({
    name: 'agent card',
    preload: join(__dirname, '../preload/agentCard.cjs'),
    url: () => host.trustedAgentCardUrl(),
    window: () => host.mainWindowRefs.window,
    urlMatches: (actual, expected) => host.trustedUrlMatches(actual, expected),
    onLost: () => agentCards.surfaceLost()
  })
  const agentCards = new AgentCardOverlay({
    surface: () => host.ensureAgentCardSurface(),
    windowSize: () => {
      if (!host.mainWindowRefs.window || host.mainWindowRefs.window.isDestroyed() || !host.mainWindowRefs.window.isVisible() || host.mainWindowRefs.window.isMinimized()) return null
      const [width = 0, height = 0] = host.mainWindowRefs.window.getContentSize()
      return { width, height }
    },
    emit: (event: AgentCardEvent) => {
      if (host.mainWindowRefs.window && !host.mainWindowRefs.window.webContents.isDestroyed()) host.mainWindowRefs.window.webContents.send('agent-card:event', event)
    },
    focusShell: () => {
      if (host.mainWindowRefs.window && !host.mainWindowRefs.window.isDestroyed() && !host.mainWindowRefs.window.webContents.isDestroyed()) host.mainWindowRefs.window.webContents.focus()
    },
    openChanged: (open) => {
      host.followSuspension.agentCardOpen = open
      // Follow would switch tabs under the open card.
      host.tabRuntime.tabs?.setFollowAgentActivitySuspended(host.followSuspension.shellSuspended || host.followSuspension.agentCardOpen)
    },
    focusOwner: () => allWebContents.getFocusedWebContents()?.id ?? null
  })
  const toastOverlayView = new ShellOverlayView({
    name: 'toast',
    preload: join(__dirname, '../preload/toastOverlay.cjs'),
    url: () => host.trustedToastOverlayUrl(),
    window: () => host.mainWindowRefs.window,
    urlMatches: (actual, expected) => host.trustedUrlMatches(actual, expected),
    onLost: () => toastOverlay.surfaceLost(),
    // A toast is about something the person did; the agent card, a tooltip or address suggestions they open go above it.
    keepAbove: () => [agentCardView.currentView(), tooltipView.currentView(), host.addressSuggestionOverlay.currentView()].filter((view) => !!view)
  })
  const toastOverlay = new ToastOverlay({
    surface: () => host.ensureToastOverlaySurface(),
    layout: () => {
      if (host.tabRuntime.startupFailure || !host.mainWindowRefs.window || host.mainWindowRefs.window.isDestroyed() || host.mainWindowRefs.window.webContents.isDestroyed()) return null
      // No page area until the saved workspaces are up, or after they failed to come up; the shell shows its own copy.
      if (!host.tabRuntime.tabs || host.tabRuntime.initializedTabs !== host.tabRuntime.tabs) return null
      const area = host.tabRuntime.tabs.pageArea()
      return area ? { area, zoom: host.mainWindowRefs.window.webContents.getZoomFactor() } : null
    },
    emit: (event: ToastOverlayEvent) => {
      if (host.mainWindowRefs.window && !host.mainWindowRefs.window.isDestroyed() && !host.mainWindowRefs.window.webContents.isDestroyed()) host.mainWindowRefs.window.webContents.send('toast-overlay:event', event)
    },
    focusOwner: () => {
      const focused = allWebContents.getFocusedWebContents()
      return focused && !toastOverlayView.owns(focused) ? focused : null
    },
    restoreFocus: (owner) => {
      // Focus moves to the view while the click lands; moving it back in the same task does not stick.
      setImmediate(() => {
        const window = host.mainWindowRefs.window
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
        const focused = allWebContents.getFocusedWebContents()
        // Only while the view still has it: the toast's action may have moved focus on purpose meanwhile.
        if (!focused || !toastOverlayView.owns(focused)) return
        const previous = owner as Electron.WebContents | null
        const overlay = !!previous && (toastOverlayView.owns(previous) || agentCardView.owns(previous) || tooltipView.owns(previous)
          || sidebarOverlayView.owns(previous) || host.addressSuggestionOverlay.owns(previous))
        // Back to a page only while it still shows; from an overlay that has since closed, or a page that went, the shell.
        const page = previous && !previous.isDestroyed() && !overlay && window.contentView.children.some((child) => (
          child.getVisible() && 'webContents' in child && (child as WebContentsView).webContents === previous
        )) ? previous : null
        ;(page ?? window.webContents).focus()
      })
    }
  })
  const shellTooltips = new ShellTooltipOverlay({
    surface: () => host.ensureTooltipSurface(),
    windowSize: () => {
      if (!host.mainWindowRefs.window || host.mainWindowRefs.window.isDestroyed() || !host.mainWindowRefs.window.isVisible() || host.mainWindowRefs.window.isMinimized()) return null
      const [width = 0, height = 0] = host.mainWindowRefs.window.getContentSize()
      return { width, height }
    }
  })

  const sidebarOverlayView = new ShellOverlayView({
    name: 'sidebar',
    preload: join(__dirname, '../preload/sidebarOverlay.cjs'),
    url: () => host.trustedSidebarOverlayUrl(),
    window: () => host.mainWindowRefs.window,
    urlMatches: (actual, expected) => host.trustedUrlMatches(actual, expected),
    onLost: () => sidebarOverlay.surfaceLost(),
    // The rail opens over the page; a toast, the agent card, a tooltip and address suggestions open over the rail.
    keepAbove: () => [
      toastOverlayView.currentView(),
      agentCardView.currentView(),
      tooltipView.currentView(),
      host.addressSuggestionOverlay.currentView()
    ].filter((view) => !!view)
  })
  const sidebarOverlay = new SidebarOverlay({
    surface: () => host.ensureSidebarOverlaySurface(),
    layout: () => {
      const window = host.mainWindowRefs.window
      if (host.tabRuntime.startupFailure || !window || window.isDestroyed() || window.webContents.isDestroyed()) return null
      if (!window.isVisible() || window.isMinimized()) return null
      const tabs = host.tabRuntime.tabs
      // Nothing of the shell's is drawn over a page in full screen, nor before the saved workspaces are up.
      if (!tabs || host.tabRuntime.initializedTabs !== tabs || tabs.showsPageFullscreen()) return null
      const [width = 0, height = 0] = window.getContentSize()
      return { content: { width, height }, zoom: window.webContents.getZoomFactor() }
    },
    emit: (event: SidebarOverlayEvent) => {
      const window = host.mainWindowRefs.window
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('sidebar-overlay:event', event)
    },
    cursor: () => {
      const window = host.mainWindowRefs.window
      if (!window || window.isDestroyed()) return null
      const point = screen.getCursorScreenPoint()
      const content = window.getContentBounds()
      return { x: point.x - content.x, y: point.y - content.y }
    },
    showMenu: (menu, closed) => {
      const tabs = host.tabRuntime.tabs
      if (!tabs) return false
      if (menu.kind === 'tab') tabs.showTabContextMenu(menu.tabId, closed)
      else tabs.showWorkspaceContextMenu(menu.workspaceId, closed)
      return true
    },
    focusShell: () => {
      // Focus moves to the view while a click there lands; moving it in the same task does not stick.
      setImmediate(() => {
        const window = host.mainWindowRefs.window
        // Focusing a view also brings its window forward; a window in the background or minimized keeps its place.
        if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !window.isFocused() || window.isMinimized()) return
        window.webContents.focus()
      })
    },
    focusOwner: () => {
      const focused = allWebContents.getFocusedWebContents()
      return focused && !sidebarOverlayView.owns(focused) ? focused : null
    },
    restoreFocus: (owner) => {
      setImmediate(() => {
        const window = host.mainWindowRefs.window
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
        // Nothing has focus in a window in the background or minimized either; focusing a view would bring it forward.
        if (!window.isFocused() || window.isMinimized()) return
        const focused = allWebContents.getFocusedWebContents()
        // Only while the view taken down or nothing has it: what the person did meanwhile may have moved it on purpose.
        if (focused && !sidebarOverlayView.owns(focused)) return
        const previous = owner as Electron.WebContents | null
        const overlay = !!previous && (sidebarOverlayView.owns(previous) || toastOverlayView.owns(previous) || agentCardView.owns(previous)
          || tooltipView.owns(previous) || host.addressSuggestionOverlay.owns(previous))
        // Back to a page only while it still shows; from an overlay, or a page that went, the shell.
        const page = previous && !previous.isDestroyed() && !overlay && window.contentView.children.some((child) => (
          child.getVisible() && 'webContents' in child && (child as WebContentsView).webContents === previous
        )) ? previous : null
        ;(page ?? window.webContents).focus()
      })
    }
  })

  const statusBubbleView = new ShellOverlayView({
    name: 'status bubble',
    preload: join(__dirname, '../preload/statusBubble.cjs'),
    url: () => host.trustedStatusBubbleUrl(),
    window: () => host.mainWindowRefs.window,
    urlMatches: (actual, expected) => host.trustedUrlMatches(actual, expected),
    onLost: () => statusBubble.surfaceLost(),
    // The bubble belongs to the page under it; everything the shell draws over the pages goes above it.
    keepAbove: () => [
      sidebarOverlayView.currentView(),
      toastOverlayView.currentView(),
      agentCardView.currentView(),
      tooltipView.currentView(),
      host.addressSuggestionOverlay.currentView()
    ].filter((view) => !!view)
  })
  const statusBubble = new StatusBubbleOverlay({
    surface: () => host.ensureStatusBubbleSurface(),
    pane: (tabId) => {
      const window = host.mainWindowRefs.window
      const tabs = host.tabRuntime.tabs
      if (host.tabRuntime.startupFailure || !window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return null
      // Nothing of the shell's is drawn over a page in full screen, nor before the saved workspaces are up.
      if (!tabs || host.tabRuntime.initializedTabs !== tabs || tabs.showsPageFullscreen()) return null
      return tabs.statusBubblePane(tabId) satisfies StatusBubblePane | null
    },
    zoom: () => {
      const window = host.mainWindowRefs.window
      return window && !window.isDestroyed() && !window.webContents.isDestroyed() ? window.webContents.getZoomFactor() : 1
    },
    theme: () => host.theme(),
    focusOwner: () => {
      const focused = allWebContents.getFocusedWebContents()
      return focused && !statusBubbleView.owns(focused) ? focused : null
    },
    restoreFocus: (owner) => {
      // Focus moves to the view while the click lands; moving it back in the same task does not stick.
      setImmediate(() => {
        const window = host.mainWindowRefs.window
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
        // Focusing a view would bring a window in the background or minimized forward.
        if (!window.isFocused() || window.isMinimized()) return
        const focused = allWebContents.getFocusedWebContents()
        if (!focused || !statusBubbleView.owns(focused)) return
        const previous = owner as Electron.WebContents | null
        const overlay = !!previous && (sidebarOverlayView.owns(previous) || toastOverlayView.owns(previous) || agentCardView.owns(previous)
          || tooltipView.owns(previous) || host.addressSuggestionOverlay.owns(previous))
        // Back to a page only while it still shows; from an overlay, or a page that went, the shell.
        const page = previous && !previous.isDestroyed() && !overlay && window.contentView.children.some((child) => (
          child.getVisible() && 'webContents' in child && (child as WebContentsView).webContents === previous
        )) ? previous : null
        ;(page ?? window.webContents).focus()
      })
    }
  })

  return {
    tooltipView,
    agentCardView,
    agentCards,
    toastOverlayView,
    toastOverlay,
    shellTooltips,
    sidebarOverlayView,
    sidebarOverlay,
    statusBubbleView,
    statusBubble
  }
}
