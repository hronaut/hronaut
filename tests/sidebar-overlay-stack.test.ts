import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

class FakeWebContents extends EventEmitter {
  destroyed = false
  loadURL = vi.fn(async (_url: string) => undefined)
  setWindowOpenHandler = vi.fn()
  isDestroyed = () => this.destroyed
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('destroyed')
  })
}

class FakeView {
  readonly webContents = new FakeWebContents()
  visible = true
  constructor(readonly options: { webPreferences: { preload: string } }) {}
  setBackgroundColor(): void {}
  setVisible(visible: boolean): void { this.visible = visible }
}

const focus = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('electron', () => ({
  WebContentsView: FakeView,
  screen: { getCursorScreenPoint: () => ({ x: 130, y: 500 }) },
  webContents: { getFocusedWebContents: () => focus.current }
}))

const { createShellOverlays } = await import('../src/main/windows/shell-overlays.js')

function setup() {
  const children: unknown[] = []
  const sent: Array<[string, unknown]> = []
  const window = {
    minimized: false,
    focused: true,
    isDestroyed: () => false,
    isFocused() { return this.focused },
    isVisible: () => true,
    isMinimized() { return this.minimized },
    getContentSize: () => [1200, 800],
    getContentBounds: () => ({ x: 100, y: 100, width: 1200, height: 800 }),
    webContents: { isDestroyed: () => false, getZoomFactor: () => 1, send: (channel: string, event: unknown) => sent.push([channel, event]), focus: vi.fn() },
    contentView: {
      children,
      // Like Electron: a view already there moves to the top, whatever index it is given.
      addChildView: vi.fn((view: unknown, at?: number) => {
        const index = children.indexOf(view)
        if (index >= 0) children.splice(index, 1)
        if (index < 0 && at !== undefined) children.splice(at, 0, view)
        else children.push(view)
      }),
      removeChildView: vi.fn((view: unknown) => { children.splice(children.indexOf(view), 1) })
    }
  }
  const fullscreen = { page: false }
  const tabs = { showsPageFullscreen: () => fullscreen.page, showTabContextMenu: vi.fn(), showWorkspaceContextMenu: vi.fn(), pageArea: () => null }
  const surface = { focused: false, send: vi.fn(), setZoomFactor: vi.fn(), setBounds: vi.fn(), present: vi.fn(), withdraw: vi.fn(), isFocused() { return this.focused }, isDestroyed: () => false }
  const overlays = createShellOverlays({
    trustedUrlMatches: (actual, expected) => actual === expected,
    mainWindowRefs: { window: window as never },
    addressSuggestionOverlay: { currentView: () => undefined, owns: () => false },
    followSuspension: { shellSuspended: false, agentCardOpen: false } as never,
    tabRuntime: { tabs: tabs as never, initializedTabs: tabs as never, startupFailure: undefined },
    trustedAgentCardUrl: () => 'file:///app/agent-card.html',
    ensureAgentCardSurface: async () => surface as never,
    trustedToastOverlayUrl: () => 'file:///app/toast-overlay.html',
    ensureToastOverlaySurface: async () => surface as never,
    trustedTooltipOverlayUrl: () => 'file:///app/tooltip-overlay.html',
    ensureTooltipSurface: async () => surface as never,
    trustedSidebarOverlayUrl: () => 'file:///app/sidebar-overlay.html',
    ensureSidebarOverlaySurface: async () => surface
  })
  return { overlays, window, children, sent, fullscreen, tabs, surface }
}

describe('the open rail over the page', () => {
  it('loads its own sandboxed view and stays above the pages, under a toast, the agent card and a tooltip', async () => {
    const { overlays, children } = setup()
    const [{ view: sidebar }, { view: toast }, { view: card }, { view: tooltip }] = await Promise.all([
      overlays.sidebarOverlayView.ensure(),
      overlays.toastOverlayView.ensure(),
      overlays.agentCardView.ensure(),
      overlays.tooltipView.ensure()
    ])
    expect((sidebar as unknown as FakeView).options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    expect((sidebar as unknown as FakeView).options.webPreferences.preload).toMatch(/sidebarOverlay\.cjs$/)
    children.push('page')
    overlays.toastOverlayView.present()
    overlays.agentCardView.present()
    overlays.tooltipView.present()
    overlays.sidebarOverlayView.present()
    expect(children).toEqual(['page', sidebar, toast, card, tooltip])
    // A tab selected in the rail attaches its page on top; main restacks the rail first, then the toast and the card.
    children.push('new page')
    overlays.sidebarOverlayView.present()
    overlays.toastOverlayView.present()
    overlays.agentCardView.present()
    expect(children.indexOf(sidebar)).toBeGreaterThan(children.indexOf('new page'))
    expect(children.indexOf(toast)).toBeGreaterThan(children.indexOf(sidebar))
    expect(children.indexOf(card)).toBeGreaterThan(children.indexOf(sidebar))
  })

  it('is not drawn over a page in full screen nor in a minimized window, and reads the pointer in window coordinates', async () => {
    const { overlays, window, sent, fullscreen, surface } = setup()
    const model = { width: 280, top: 48 }
    fullscreen.page = true
    overlays.sidebarOverlay.show({ id: 1, model: model as never })
    expect(sent).toEqual([['sidebar-overlay:event', { id: 1, kind: 'unavailable' }]])
    fullscreen.page = false
    window.minimized = true
    overlays.sidebarOverlay.show({ id: 2, model: model as never })
    expect(sent.at(-1)).toEqual(['sidebar-overlay:event', { id: 2, kind: 'unavailable' }])
    window.minimized = false
    overlays.sidebarOverlay.show({ id: 3, model: model as never })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const [state] = surface.send.mock.calls.at(-1) as [{ revision: number }]
    overlays.sidebarOverlay.rendered({ revision: state.revision })
    expect(surface.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 48, width: 280, height: 752 })
    // The pointer at screen (130, 500) is at (30, 400) in a window whose content starts at (100, 100): over the rail.
    expect(sent.slice(-2)).toEqual([
      ['sidebar-overlay:event', { id: 3, kind: 'shown' }],
      ['sidebar-overlay:event', { id: 3, kind: 'pointer', hovered: true, held: false }]
    ])
    // A page entering full screen meanwhile takes it down.
    fullscreen.page = true
    overlays.sidebarOverlay.relayout()
    expect(sent.at(-1)).toEqual(['sidebar-overlay:event', { id: 3, kind: 'hidden', reason: 'window' }])
  })

  it('gives keyboard focus a click in the rail took back to the page that had it, or to the shell once that page went', async () => {
    const { overlays, window, children, surface } = setup()
    const page = { focus: vi.fn(), isDestroyed: () => false }
    children.push({ getVisible: () => true, webContents: page })
    const open = async (id: number) => {
      overlays.sidebarOverlay.show({ id, model: { width: 280, top: 48 } as never })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const [state] = surface.send.mock.calls.at(-1) as [{ revision: number }]
      overlays.sidebarOverlay.rendered({ revision: state.revision })
    }
    const settled = () => new Promise((resolve) => setImmediate(resolve))
    try {
      focus.current = page
      await open(1)
      // The click lands in the view, which keeps the focus, as after one of its menus; then the pointer leaves.
      focus.current = null
      surface.focused = true
      overlays.sidebarOverlay.hide(1)
      await settled()
      expect(page.focus).toHaveBeenCalledOnce()
      expect(window.webContents.focus).not.toHaveBeenCalled()
      // The page is no longer in the window: the shell gets it.
      surface.focused = false
      focus.current = page
      await open(2)
      children.splice(children.findIndex((child) => (child as { webContents?: unknown }).webContents === page), 1)
      focus.current = null
      surface.focused = true
      overlays.sidebarOverlay.hide(2)
      await settled()
      expect(window.webContents.focus).toHaveBeenCalledOnce()
      // Something else took it meanwhile, on purpose: it stays there.
      surface.focused = false
      await open(3)
      surface.focused = true
      overlays.sidebarOverlay.hide(3)
      focus.current = { isDestroyed: () => false }
      await settled()
      expect(window.webContents.focus).toHaveBeenCalledOnce()
      expect(page.focus).toHaveBeenCalledOnce()
    } finally {
      focus.current = null
    }
  })

  // Focusing a view brings its window forward, so a rail taken down after the person switched away or minimized the
  // window brought Hronaut back in front.
  it('leaves the keyboard alone in a window in the background or minimized', async () => {
    const { overlays, window, children, surface } = setup()
    const page = { focus: vi.fn(), isDestroyed: () => false }
    children.push({ getVisible: () => true, webContents: page })
    const settled = () => new Promise((resolve) => setImmediate(resolve))
    try {
      focus.current = page
      for (const [id, away] of [[1, 'background'], [2, 'minimized']] as const) {
        overlays.sidebarOverlay.show({ id, model: { width: 280, top: 48 } as never })
        await new Promise((resolve) => setTimeout(resolve, 0))
        const [state] = surface.send.mock.calls.at(-1) as [{ revision: number }]
        overlays.sidebarOverlay.rendered({ revision: state.revision })
        surface.focused = true
        focus.current = null
        if (away === 'background') window.focused = false
        else window.minimized = true
        overlays.sidebarOverlay.hide(id)
        await settled()
        window.focused = true
        window.minimized = false
        surface.focused = false
        focus.current = page
      }
      expect(page.focus).not.toHaveBeenCalled()
      expect(window.webContents.focus).not.toHaveBeenCalled()
    } finally {
      focus.current = null
    }
  })
})
