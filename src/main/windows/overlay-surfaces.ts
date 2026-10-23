import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AgentCardOverlay, AgentCardSurface } from '../agent-card-overlay.js'
import type { ShellOverlayView } from '../shell-overlay-view.js'
import type { ShellTooltipSurface } from '../shell-tooltip-overlay.js'
import type { ToastOverlay, ToastOverlaySurface } from '../toast-overlay.js'
import { SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET, type SidebarOverlay, type SidebarOverlaySurface } from '../sidebar-overlay.js'
import { attachSidebarOverlayKeyboard, type SidebarOverlayKeyboardHost } from '../sidebar-overlay-keyboard.js'
import type { ShellTooltipOverlay } from '../shell-tooltip-overlay.js'

interface OverlaySurfacesHost {
  /** The trusted shell document; the overlay documents are its siblings. */
  trustedShellUrl(): string
  /** The transparent view that draws the agent card above the page views. */
  agentCardView: Pick<ShellOverlayView, 'ensure' | 'present' | 'withdraw'>
  agentCards: Pick<AgentCardOverlay, 'blurred'>
  /** The transparent view that draws toasts at the bottom of the page area. */
  toastOverlayView: Pick<ShellOverlayView, 'ensure' | 'present' | 'withdraw'>
  toastOverlay: Pick<ToastOverlay, 'pointerActivity' | 'viewFocused'>
  /** The transparent view that draws the shell's tooltips above the page views. */
  tooltipView: Pick<ShellOverlayView, 'ensure' | 'present' | 'withdraw'>
  /** The view that draws the open tab rail over the page, and the tooltips its controls show. */
  sidebarOverlayView: Pick<ShellOverlayView, 'ensure' | 'present' | 'withdraw'>
  sidebarOverlay: Pick<SidebarOverlay, 'pointerActivity'>
  /** The keys pressed in that view, which work as in the shell. */
  sidebarOverlayKeyboard: SidebarOverlayKeyboardHost
  shellTooltips: Pick<ShellTooltipOverlay, 'shownId' | 'hide'>
}

/**
 * The trusted documents of the agent card, toast, tooltip and open rail overlay views, and the surfaces their
 * controllers draw through once a view has loaded. `__dirname` is the bundled main entry's directory, as for the other main modules.
 */
export function createOverlaySurfaces(host: OverlaySurfacesHost): {
  trustedAgentCardUrl(): string
  ensureAgentCardSurface(): Promise<AgentCardSurface>
  trustedToastOverlayUrl(): string
  ensureToastOverlaySurface(): Promise<ToastOverlaySurface>
  trustedTooltipOverlayUrl(): string
  ensureTooltipSurface(): Promise<ShellTooltipSurface>
  trustedSidebarOverlayUrl(): string
  ensureSidebarOverlaySurface(): Promise<SidebarOverlaySurface>
} {
  function trustedAgentCardUrl(): string {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      return new URL('agent-card.html', host.trustedShellUrl()).href
    }
    return pathToFileURL(join(__dirname, '../renderer/agent-card.html')).href
  }

  /** One transparent view, created on the first agent card, draws the card above the page views. */
  const agentCardBlurWatched = new WeakSet<Electron.WebContents>()

  async function ensureAgentCardSurface(): Promise<AgentCardSurface> {
    const { view, webContents } = await host.agentCardView.ensure()
    if (!agentCardBlurWatched.has(webContents)) {
      agentCardBlurWatched.add(webContents)
      webContents.on('blur', () => host.agentCards.blurred())
    }
    return {
      send: (state) => { if (!webContents.isDestroyed()) webContents.send('agent-card-view:state', state) },
      setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
      setBounds: (bounds) => view.setBounds(bounds),
      present: () => host.agentCardView.present(),
      withdraw: () => host.agentCardView.withdraw(),
      focus: () => { if (!webContents.isDestroyed()) webContents.focus() },
      isFocused: () => !webContents.isDestroyed() && webContents.isFocused(),
      isDestroyed: () => webContents.isDestroyed()
    }
  }

  function trustedToastOverlayUrl(): string {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      return new URL('toast-overlay.html', host.trustedShellUrl()).href
    }
    return pathToFileURL(join(__dirname, '../renderer/toast-overlay.html')).href
  }

  /** One transparent view, created on the first toast, draws it at the bottom of the page area. */
  const toastOverlayWatched = new WeakSet<Electron.WebContents>()

  async function ensureToastOverlaySurface(): Promise<ToastOverlaySurface> {
    const { view, webContents } = await host.toastOverlayView.ensure()
    if (!toastOverlayWatched.has(webContents)) {
      toastOverlayWatched.add(webContents)
      // A click in the toast leaves keyboard focus where it was, in the page or the shell.
      webContents.on('before-mouse-event', () => host.toastOverlay.pointerActivity())
      webContents.on('focus', () => host.toastOverlay.viewFocused())
    }
    return {
      send: (state) => { if (!webContents.isDestroyed()) webContents.send('toast-overlay-view:state', state) },
      setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
      setBounds: (bounds) => view.setBounds(bounds),
      present: () => host.toastOverlayView.present(),
      withdraw: () => host.toastOverlayView.withdraw(),
      isDestroyed: () => webContents.isDestroyed()
    }
  }

  function trustedTooltipOverlayUrl(): string {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      return new URL('tooltip-overlay.html', host.trustedShellUrl()).href
    }
    return pathToFileURL(join(__dirname, '../renderer/tooltip-overlay.html')).href
  }

  /**
   * One transparent view, created on the first tooltip, draws the shell's tooltips above the page
   * views. It is in the window only while a tooltip shows.
   */
  async function ensureTooltipSurface(): Promise<ShellTooltipSurface> {
    const { view, webContents } = await host.tooltipView.ensure()
    return {
      send: (state) => { if (!webContents.isDestroyed()) webContents.send('tooltip-overlay:state', state) },
      setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
      setBounds: (bounds) => view.setBounds(bounds),
      present: () => host.tooltipView.present(),
      withdraw: () => host.tooltipView.withdraw(),
      isDestroyed: () => webContents.isDestroyed()
    }
  }

  function trustedSidebarOverlayUrl(): string {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      return new URL('sidebar-overlay.html', host.trustedShellUrl()).href
    }
    return pathToFileURL(join(__dirname, '../renderer/sidebar-overlay.html')).href
  }

  /** One view, created the first time the rail opens over the page, draws the open rail there. */
  const sidebarOverlayWatched = new WeakSet<Electron.WebContents>()

  async function ensureSidebarOverlaySurface(): Promise<SidebarOverlaySurface> {
    const { view, webContents } = await host.sidebarOverlayView.ensure()
    if (!sidebarOverlayWatched.has(webContents)) {
      sidebarOverlayWatched.add(webContents)
      // Who has keyboard focus before a click in the rail takes it gets it back when the rail goes.
      webContents.on('before-mouse-event', () => host.sidebarOverlay.pointerActivity())
      attachSidebarOverlayKeyboard(webContents, host.sidebarOverlayKeyboard)
    }
    return {
      send: (state) => { if (!webContents.isDestroyed()) webContents.send('sidebar-overlay-view:state', state) },
      setZoomFactor: (zoom) => { if (!webContents.isDestroyed()) webContents.setZoomFactor(zoom) },
      setBounds: (bounds) => view.setBounds(bounds),
      present: () => host.sidebarOverlayView.present(),
      withdraw: () => {
        host.sidebarOverlayView.withdraw()
        // A tooltip of the rail's controls goes with the rail.
        const tooltip = host.shellTooltips.shownId
        if (tooltip !== undefined && tooltip > SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET) host.shellTooltips.hide(tooltip)
      },
      isFocused: () => !webContents.isDestroyed() && webContents.isFocused(),
      isDestroyed: () => webContents.isDestroyed()
    }
  }

  return {
    trustedAgentCardUrl,
    ensureAgentCardSurface,
    trustedToastOverlayUrl,
    ensureToastOverlaySurface,
    trustedTooltipOverlayUrl,
    ensureTooltipSurface,
    trustedSidebarOverlayUrl,
    ensureSidebarOverlaySurface
  }
}
