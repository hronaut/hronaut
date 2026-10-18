import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AgentCardOverlay, AgentCardSurface } from '../agent-card-overlay.js'
import type { ShellOverlayView } from '../shell-overlay-view.js'
import type { ShellTooltipSurface } from '../shell-tooltip-overlay.js'
import type { ToastOverlay, ToastOverlaySurface } from '../toast-overlay.js'

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
}

/**
 * The trusted documents of the agent card, toast and tooltip overlay views, and the surfaces their controllers draw
 * through once a view has loaded. `__dirname` is the bundled main entry's directory, as for the other main modules.
 */
export function createOverlaySurfaces(host: OverlaySurfacesHost): {
  trustedAgentCardUrl(): string
  ensureAgentCardSurface(): Promise<AgentCardSurface>
  trustedToastOverlayUrl(): string
  ensureToastOverlaySurface(): Promise<ToastOverlaySurface>
  trustedTooltipOverlayUrl(): string
  ensureTooltipSurface(): Promise<ShellTooltipSurface>
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

  return {
    trustedAgentCardUrl,
    ensureAgentCardSurface,
    trustedToastOverlayUrl,
    ensureToastOverlaySurface,
    trustedTooltipOverlayUrl,
    ensureTooltipSurface
  }
}
