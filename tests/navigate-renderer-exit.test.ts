import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'

// The browser below stubs getState, which navigating publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// A page whose renderer exited while it loaded ended browser_navigate with Electron's bare "ERR_FAILED (-2) loading",
// as a network failure would, and showed the person that error on top of the tab's notice that the page stopped working.

/**
 * A tab whose load fails as Electron fails it, with its renderer gone or still running. As in Electron, the failure
 * comes before the renderer exit is reported, here the given time later.
 */
function navigationThatFails({ rendererExits = false, exitReportedAfterMs = 0, crashedBefore = false, closesTab = false,
  navigatesMeanwhile = false, error = "ERR_FAILED (-2) loading 'https://next.example/'" } = {}) {
  let crashed = crashedBefore
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => crashed,
    loadURL: vi.fn(async () => {
      if (rendererExits) {
        setTimeout(() => {
          if (closesTab) tabs.delete(tab.id)
          // Such as the person typing another address.
          if (navigatesMeanwhile) tab.navigationGeneration += 1
          crashed = true
          webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 })
        }, exitReportedAfterMs)
      }
      throw Object.assign(new Error(error), { code: error.split(' ')[0], errno: Number(/\((-\d+)\)/.exec(error)?.[1]) })
    })
  })
  const tab = { id: 'tab', navigationGeneration: 0, documentGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: false, webContents }
  const tabs = new Map([[tab.id, tab]])
  const browser = {
    tabs,
    activeTabId: tab.id,
    options: {},
    prepareDiagnosticNavigation: vi.fn(),
    getState: () => ({ ok: true })
  }
  return Object.assign((byPerson: boolean) => navigate(browser as never, 'https://next.example/', undefined, { byPerson }), { webContents })
}

describe('a load that ends because the page renderer exited', () => {
  it('tells an agent the renderer exited, not that the network failed', async () => {
    const navigation = navigationThatFails({ rendererExits: true })(false)
    await expect(navigation).rejects.toBeInstanceOf(RendererExitedError)
    await expect(navigation).rejects.toMatchObject({ message: expect.stringContaining('renderer exited'), sent: true })
  })

  it('leaves the person with the tab notice that the page stopped working', async () => {
    await expect(navigationThatFails({ rendererExits: true })(true)).resolves.toEqual({ ok: true })
  })

  it.each([false, true])('still fails a load whose renderer kept running (by a person: %s)', async byPerson => {
    await expect(navigationThatFails()(byPerson)).rejects.toThrow('ERR_FAILED (-2)')
  })

  it('waits a moment for an exit Electron reports after the load failed, and no longer', async () => {
    // Electron can fail the load in a task of its own, before the one that reports the exit.
    vi.useFakeTimers()
    try {
      const late = expect(navigationThatFails({ rendererExits: true, exitReportedAfterMs: 99 })(false)).rejects.toBeInstanceOf(RendererExitedError)
      await vi.advanceTimersByTimeAsync(99)
      await late
      const tooLate = expect(navigationThatFails({ rendererExits: true, exitReportedAfterMs: 101 })(false)).rejects.toThrow('ERR_FAILED (-2)')
      await vi.advanceTimersByTimeAsync(101)
      await tooLate
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for an exit after any failure, as a renderer exit can end a load with another error', async () => {
    const aborted = "ERR_ABORTED (-3) loading 'https://next.example/'"
    await expect(navigationThatFails({ rendererExits: true, exitReportedAfterMs: 20, error: aborted })(false)).rejects.toBeInstanceOf(RendererExitedError)
  })

  it('tells an agent of the exit of the renderer that a load into a crashed page started', async () => {
    // The page the person or an agent loads after a crash runs in a new renderer, whose exit is this load's.
    await expect(navigationThatFails({ crashedBefore: true, rendererExits: true })(false)).rejects.toBeInstanceOf(RendererExitedError)
  })

  it('reports the network error of a load into a page that had already crashed', async () => {
    // The load starts a new renderer, so the old one's exit is not this load's.
    const navigation = navigationThatFails({ crashedBefore: true, error: "ERR_CONNECTION_REFUSED (-102) loading 'https://next.example/'" })(false)
    await expect(navigation).rejects.not.toBeInstanceOf(RendererExitedError)
    await expect(navigation).rejects.toThrow('ERR_CONNECTION_REFUSED')
  })

  it('leaves alone a tab closed or sent elsewhere while its renderer exit is checked', async () => {
    await expect(navigationThatFails({ rendererExits: true, closesTab: true })(false)).resolves.toEqual({ ok: true })
    // The exit may be the newer load's, which reports it itself.
    await expect(navigationThatFails({ rendererExits: true, navigatesMeanwhile: true })(false)).resolves.toEqual({ ok: true })
  })

  it('stops watching the renderer once the load settled', async () => {
    const failed = navigationThatFails({ error: "ERR_NAME_NOT_RESOLVED (-105) loading 'https://next.example/'" })
    await expect(failed(false)).rejects.toThrow('ERR_NAME_NOT_RESOLVED')
    const exited = navigationThatFails({ rendererExits: true })
    await expect(exited(true)).resolves.toEqual({ ok: true })
    expect([failed.webContents.listenerCount('render-process-gone'), exited.webContents.listenerCount('render-process-gone')]).toEqual([0, 0])
  })
})
