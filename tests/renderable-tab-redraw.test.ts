import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  /** The capture windows withRenderableTab opens, which a test only needs to accept a page and close. */
  class CaptureWindow {
    destroyed = false
    readonly children: unknown[] = []
    readonly contentView = {
      children: this.children,
      addChildView: (view: unknown) => { if (!this.children.includes(view)) this.children.push(view) },
      removeChildView: (view: unknown) => { if (this.children.includes(view)) this.children.splice(this.children.indexOf(view), 1) }
    }
    isDestroyed(): boolean { return this.destroyed }
    showInactive(): void {}
    destroy(): void { this.destroyed = true }
  }
  return { CaptureWindow }
})
vi.mock('electron', () => ({ BrowserWindow: electron.CaptureWindow }))

import { LocalizedError } from '../src/main/localized-error.js'
import { withRenderableTab } from '../src/main/browser/renderable-tab/renderable-tab.js'
import type { RenderableTab, RenderableTabAccess } from '../src/main/browser/renderable-tab/renderable-tab-access.js'

const REDRAW = ['Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 }, fromSurface: true }]

/**
 * A tab shown in a minimized window, so a capture presents its page in a capture window of its own. Its page sends no
 * frame and its captures wait until it draws, which only the redraw command makes it do, unless a test says otherwise.
 */
function minimizedTab(options: { presentsFrame?: boolean; redraw?: () => Promise<unknown>; withDebugger?: RenderableTabAccess<RenderableTab>['withDebugger'] } = {}) {
  let draw!: () => void
  const drawn = new Promise<void>((resolve) => { draw = resolve })
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    isCrashed: () => false,
    beginFrameSubscription: vi.fn((_onlyDirty: boolean, callback: () => void) => { if (options.presentsFrame) queueMicrotask(callback) }),
    endFrameSubscription: vi.fn(),
    invalidate: vi.fn(),
    capturePage: vi.fn(async () => { await drawn; return { isEmpty: () => false } }),
    debugger: {
      sendCommand: vi.fn(options.redraw ?? (async () => { draw(); return { data: 'iVBORw0KGgo=' } }))
    }
  }
  let visible = true
  const view = {
    getBounds: () => ({ x: 280, y: 60, width: 1150, height: 830 }),
    setBounds: vi.fn(),
    getVisible: () => visible,
    setVisible: vi.fn((value: boolean) => { visible = value })
  }
  const tab = { id: 'tab', view, webContents } as unknown as RenderableTab
  const windowChildren: unknown[] = [view]
  const shellWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => true,
    contentView: {
      children: windowChildren,
      addChildView: (child: unknown) => { if (!windowChildren.includes(child)) windowChildren.push(child) },
      removeChildView: (child: unknown) => { if (windowChildren.includes(child)) windowChildren.splice(windowChildren.indexOf(child), 1) }
    }
  }
  const access: RenderableTabAccess<RenderableTab> = {
    isDestroyed: () => false,
    window: () => shellWindow as never,
    findTab: (tabId) => tabId === tab.id ? tab : undefined,
    renderQueues: () => new Map(),
    offscreenCaptureTabIds: () => new Set(),
    activeTabId: () => tab.id,
    splitViewContains: () => false,
    layout: vi.fn(),
    tabViewBounds: () => view.getBounds(),
    contentAreaBounds: () => view.getBounds(),
    reconcileTabPresentation: vi.fn(),
    withDebugger: vi.fn(options.withDebugger ?? (async (_webContents, operation) => await operation()))
  }
  return { access, tab, webContents }
}

describe('presenting a hidden tab for a capture', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('makes a page that sends no frame in its capture window draw again, and captures it then', async () => {
    const { access, tab, webContents } = minimizedTab()
    let captured: unknown
    void withRenderableTab(access, tab, async () => await webContents.capturePage()).then((image) => { captured = image })

    await vi.advanceTimersByTimeAsync(1_000)
    // Soon after launch such a page stayed unpresented, and the capture waited 15 seconds and failed.
    expect(access.withDebugger).toHaveBeenCalledWith(webContents, expect.any(Function))
    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith(...REDRAW)
    expect(captured).toMatchObject({ isEmpty: expect.any(Function) })
  })

  it('never asks a page that sends a frame to draw again', async () => {
    const { access, tab, webContents } = minimizedTab({ presentsFrame: true })
    const operation = vi.fn(async () => 'captured')

    await expect(withRenderableTab(access, tab, operation)).resolves.toBe('captured')
    expect(access.withDebugger).not.toHaveBeenCalled()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('keeps waiting for a frame when the page refuses to draw again, as while its Developer Tools are open', async () => {
    const { access, tab, webContents } = minimizedTab({
      withDebugger: async () => { throw new Error('Close Developer Tools for this tab before using this MCP action') }
    })
    const operation = vi.fn(async () => 'captured')
    const settled = withRenderableTab(access, tab, operation).catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(14_999)
    expect(operation).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const error = await settled
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as LocalizedError).key).toBe('appErrors.pageTools.renderTimedOut')
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('gives the debugger back when the page does not answer the redraw', async () => {
    let leased = false
    const { access, tab } = minimizedTab({
      redraw: () => new Promise(() => undefined),
      withDebugger: async (_webContents, operation) => {
        leased = true
        try {
          return await operation()
        } finally {
          leased = false
        }
      }
    })
    const settled = withRenderableTab(access, tab, async () => 'captured').catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(leased).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    // Other debugger work on the page waits behind the redraw, so a page that never answers must not hold it.
    expect(leased).toBe(false)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(await settled).toBeInstanceOf(LocalizedError)
  })
})
