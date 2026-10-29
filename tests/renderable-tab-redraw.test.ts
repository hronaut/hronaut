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
// The page's debugger lease, as the tab in use answers it.
const lease = vi.hoisted(() => ({ withDebugger: undefined as unknown as Lease }))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: (_browser: unknown, page: unknown, operation: () => Promise<unknown>) => lease.withDebugger(page, operation)
}))

import { LocalizedError } from '../src/main/localized-error.js'
import { withRenderableTab } from '../src/main/browser/renderable-tab/renderable-tab.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

type Lease = (page: unknown, operation: () => Promise<unknown>) => Promise<unknown>

const REDRAW = ['Page.captureScreenshot', { format: 'jpeg', quality: 10, fromSurface: true }] as const

/**
 * A tab shown in a minimized window, so a capture presents its page in a capture window of its own. Its page sends no
 * frame, and its capture probes never return unless a test makes one return a picture, after empty ones, while asking
 * it to draw again succeeds.
 */
function minimizedTab(options: {
  presentsFrame?: boolean
  probeReturnsOnCall?: number
  redraw?: () => Promise<unknown>
  withDebugger?: Lease
} = {}) {
  let probes = 0
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    isCrashed: () => false,
    beginFrameSubscription: vi.fn((_onlyDirty: boolean, callback: () => void) => { if (options.presentsFrame) queueMicrotask(callback) }),
    endFrameSubscription: vi.fn(),
    invalidate: vi.fn(),
    capturePage: vi.fn(() => {
      probes += 1
      if (options.probeReturnsOnCall === undefined) return new Promise(() => undefined)
      const empty = probes < options.probeReturnsOnCall
      return Promise.resolve({ isEmpty: () => empty })
    }),
    debugger: {
      sendCommand: vi.fn(options.redraw ?? (async () => ({ data: '/9j/' })))
    }
  }
  let visible = true
  const view = {
    getBounds: () => ({ x: 280, y: 60, width: 1150, height: 830 }),
    setBounds: vi.fn(),
    getVisible: () => visible,
    setVisible: vi.fn((value: boolean) => { visible = value })
  }
  const tab = { id: 'tab', view, webContents } as unknown as BrowserTab
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
  const renderQueues = new Map<number, Promise<void>>()
  const offscreenCaptureTabIds = new Set<string>()
  const withDebugger = vi.fn<Lease>(options.withDebugger ?? (async (_webContents, operation) => await operation()))
  lease.withDebugger = withDebugger
  const browser = {
    destroyed: false,
    window: shellWindow,
    tabs: new Map([[tab.id, tab]]),
    renderQueues,
    offscreenCaptureTabIds,
    activeTabId: tab.id,
    splitViewContains: () => false,
    layout: vi.fn(),
    tabViewBounds: () => view.getBounds(),
    reconcileTabPresentation: vi.fn()
  } as unknown as Browser
  return { browser, tab, webContents, withDebugger }
}

describe('presenting a hidden tab for a capture', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('makes a page that sends no frame in its capture window draw again, and runs the capture once it has', async () => {
    const { browser, tab, webContents, withDebugger } = minimizedTab()
    const operation = vi.fn(async () => 'captured')
    const result = withRenderableTab(browser, tab, operation)

    await vi.advanceTimersByTimeAsync(999)
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    // Soon after launch such a page stayed unpresented, and the capture waited 15 seconds and failed.
    expect(withDebugger).toHaveBeenCalledWith(webContents, expect.any(Function))
    expect(webContents.debugger.sendCommand).toHaveBeenCalledExactlyOnceWith(...REDRAW)
    expect(operation).toHaveBeenCalledOnce()
    await expect(result).resolves.toBe('captured')
  })

  it('never asks a page that sends a frame to draw again', async () => {
    const { browser, tab, webContents, withDebugger } = minimizedTab({ presentsFrame: true })

    await expect(withRenderableTab(browser, tab, async () => 'captured')).resolves.toBe('captured')
    expect(withDebugger).not.toHaveBeenCalled()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('leaves a page that refuses to draw again, as while its Developer Tools are open, to the capture probes', async () => {
    const { browser, tab, webContents } = minimizedTab({
      probeReturnsOnCall: 2,
      withDebugger: async () => { throw new Error('Close Developer Tools for this tab before using this MCP action') }
    })
    const operation = vi.fn(async () => 'captured')
    const result = withRenderableTab(browser, tab, operation)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(operation).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    await expect(result).resolves.toBe('captured')
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('does not ask the page to draw again once the capture has stopped waiting for the debugger', async () => {
    let release!: () => void
    const { browser, tab, webContents } = minimizedTab({
      probeReturnsOnCall: 1,
      withDebugger: async (_webContents, operation) => {
        await new Promise<void>((resolve) => { release = resolve })
        return await operation()
      }
    })
    const operation = vi.fn(async () => 'captured')
    const result = withRenderableTab(browser, tab, operation)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toBe('captured')
    // Another debugger operation on the page held it while a probe found the page presented.
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('gives the debugger back when the page does not answer, and does not ask it again until it does', async () => {
    let leased = false
    const { browser, tab, webContents } = minimizedTab({
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
    const first = withRenderableTab(browser, tab, async () => 'captured').catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(leased).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    // Other debugger work on the page waits behind the request, so a page that never answers must not hold it.
    expect(leased).toBe(false)
    await vi.advanceTimersByTimeAsync(9_000)
    const error = await first
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as LocalizedError).key).toBe('appErrors.pageTools.renderTimedOut')

    const second = withRenderableTab(browser, tab, async () => 'captured').catch((failure: unknown) => failure)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await second).toBeInstanceOf(LocalizedError)
    expect(webContents.debugger.sendCommand).toHaveBeenCalledOnce()
  })
})
