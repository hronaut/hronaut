import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Whether the computer is online, as Chromium tells it.
const { isOnline } = vi.hoisted(() => ({ isOnline: vi.fn(() => true) }))
vi.mock('electron', () => ({ net: { isOnline } }))
// Whether the tab's workspace may open the website.
const { workspaceNavigationAllowed } = vi.hoisted(() => ({ workspaceNavigationAllowed: vi.fn(() => true) }))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', () => ({ workspaceNavigationAllowed }))
import { reloadWhenWebsiteReachable } from '../src/main/browser/network-error-reload/network-error-reload.js'
import { certificateProblem, loadFailureProblem } from '../src/main/browser/page-load-problem.js'

const PAGE = 'https://mail.example/inbox'

/** A window showing one tab whose page fails to load each time it loads, until the website can be reached. */
function failingTab() {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    loadURL: vi.fn(async (_url: string) => {
      // As Chromium reports it: the load starts a navigation, then fails while the website cannot be reached.
      tab.navigationGeneration += 1
      if (!reachable && !loading) fail()
    })
  })
  const tab = {
    id: 'tab', url: PAGE, navigationGeneration: 0, sleeping: false, wakePromise: undefined as Promise<void> | undefined,
    mcpGroupId: 'workspace' as string | undefined, emulation: { network: 'none' }, networkRoutes: [] as unknown[],
    pageProblem: undefined as ReturnType<typeof loadFailureProblem> | undefined, webContents: contents
  }
  const window = { isDestroyed: () => false, isVisible: vi.fn(() => true), isMinimized: vi.fn(() => false) }
  const browser = {
    destroyed: false, activeTabId: 'tab' as string | null, tabs: new Map([['tab', tab]]), window,
    splitViewContains: vi.fn(() => false), prepareDiagnosticNavigation: vi.fn(), restoringLayout: false,
    options: { onChanged: vi.fn() }, statePublication: { changed: vi.fn() },
    mcpActivitiesByTab: new Map<string, Set<string>>(), rendererRecovery: { isRecovering: vi.fn(() => false) }
  }
  let reachable = false
  // A load still under way, which has neither loaded nor failed yet.
  let loading = false
  const fail = (errorDescription = 'ERR_INTERNET_DISCONNECTED', url = PAGE) => {
    tab.pageProblem = loadFailureProblem('en-US', url, -106, errorDescription)
    reloadWhenWebsiteReachable(browser as never, tab as never)
  }
  /** A load the person starts, which fails too. */
  const personLoads = () => {
    tab.navigationGeneration += 1
    fail()
  }
  return { tab, contents, browser, window, fail, personLoads, reachable: () => { reachable = true }, holdLoads: () => { loading = true } }
}

beforeEach(() => {
  vi.useFakeTimers()
  isOnline.mockReset().mockReturnValue(true)
  workspaceNavigationAllowed.mockReset().mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loading a page again once its website can be reached, as in Chrome', () => {
  it('loads it again after 1 s, waits longer after each failure up to every 30 min, and stops once it loads', async () => {
    const f = failingTab()
    f.fail()
    const delays = [1_000, 5_000, 30_000, 60_000, 300_000, 600_000, 1_800_000, 1_800_000]
    for (const [index, delay] of delays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(f.contents.loadURL, `before reload ${index + 1}`).toHaveBeenCalledTimes(index)
      await vi.advanceTimersByTimeAsync(1)
      expect(f.contents.loadURL, `reload ${index + 1}`).toHaveBeenCalledTimes(index + 1)
    }
    expect(f.contents.loadURL).toHaveBeenLastCalledWith(PAGE)
    expect(f.browser.prepareDiagnosticNavigation).toHaveBeenCalledTimes(delays.length)
    expect(workspaceNavigationAllowed).toHaveBeenLastCalledWith(f.browser, 'workspace', PAGE, 'history')
    f.reachable()
    await vi.advanceTimersByTimeAsync(1_800_000)
    expect(f.contents.loadURL).toHaveBeenCalledTimes(delays.length + 1)
    expect(f.tab.pageProblem).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes the problem away while the page loads again, as the person’s Reload does', async () => {
    const f = failingTab()
    f.reachable()
    f.fail()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.tab.pageProblem).toBeUndefined()
    expect(f.browser.statePublication.changed).toHaveBeenCalledOnce()
  })

  it('waits while the computer is offline or the tab is out of view, without counting that time as attempts', async () => {
    const f = failingTab()
    f.fail()
    isOnline.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(60_000)
    isOnline.mockReturnValue(true)
    f.window.isVisible.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(60_000)
    f.window.isVisible.mockReturnValue(true)
    f.window.isMinimized.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(60_000)
    f.window.isMinimized.mockReturnValue(false)
    f.browser.activeTabId = 'other'
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.contents.loadURL).not.toHaveBeenCalled()
    // A pane of the split view is in view too.
    f.browser.splitViewContains.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.contents.loadURL).toHaveBeenCalledOnce()
    // The first reload failed, so the next one waits 5 s.
    await vi.advanceTimersByTimeAsync(4_999)
    expect(f.contents.loadURL).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.contents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('starts again from 1 s after a load of the person’s fails', async () => {
    const f = failingTab()
    f.fail()
    await vi.advanceTimersByTimeAsync(1_000 + 5_000)
    expect(f.contents.loadURL).toHaveBeenCalledTimes(2)
    f.personLoads()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.contents.loadURL).toHaveBeenCalledTimes(3)
  })

  it('starts again from 1 s when the person loads the page while a reload is under way', async () => {
    const f = failingTab()
    f.fail()
    await vi.advanceTimersByTimeAsync(1_000)
    f.holdLoads()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(f.contents.loadURL).toHaveBeenCalledTimes(2)
    // The person's load replaces the reload under way, and fails.
    f.personLoads()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.contents.loadURL).toHaveBeenCalledTimes(3)
  })

  it('leaves a refused certificate and other failures as they are', async () => {
    // Electron names no error for a page that failed after it was shown, which the person may be using.
    for (const errorDescription of ['ERR_CERT_AUTHORITY_INVALID', 'ERR_BLOCKED_BY_CLIENT', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_FAILED', '']) {
      const f = failingTab()
      f.fail(errorDescription)
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(f.contents.loadURL, errorDescription).not.toHaveBeenCalled()
    }
    for (const url of ['file:///home/user/report.html', 'hronaut://home/']) {
      const f = failingTab()
      f.fail('ERR_INTERNET_DISCONNECTED', url)
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(f.contents.loadURL, url).not.toHaveBeenCalled()
    }
    const f = failingTab()
    f.tab.pageProblem = certificateProblem('en-US', PAGE, -105, 'ERR_NAME_NOT_RESOLVED', { host: 'mail.example', canProceed: true })
    reloadWhenWebsiteReachable(f.browser as never, f.tab as never)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(f.contents.loadURL).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves a tab whose network is emulated offline or routed as it is', async () => {
    const tabs = [
      (f: ReturnType<typeof failingTab>) => { f.tab.emulation.network = 'offline' },
      (f: ReturnType<typeof failingTab>) => { f.tab.networkRoutes.push({ id: 'route' }) }
    ]
    for (const [index, set] of tabs.entries()) {
      for (const when of ['before', 'after'] as const) {
        const f = failingTab()
        if (when === 'before') set(f)
        f.fail()
        if (when === 'after') set(f)
        await vi.advanceTimersByTimeAsync(3_600_000)
        expect(f.contents.loadURL, `${index} ${when}`).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
      }
    }
  })

  it('stops once the tab shows another page or sleeps, its page is replaced, or it closes', async () => {
    const changes = [
      (f: ReturnType<typeof failingTab>) => { f.tab.pageProblem = undefined },
      (f: ReturnType<typeof failingTab>) => { f.tab.sleeping = true },
      (f: ReturnType<typeof failingTab>) => { f.tab.webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, loadURL: vi.fn() }) },
      (f: ReturnType<typeof failingTab>) => { f.browser.tabs.delete('tab') }
    ]
    for (const [index, change] of changes.entries()) {
      const f = failingTab()
      f.fail()
      change(f)
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(f.contents.loadURL, String(index)).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
    const f = failingTab()
    f.fail()
    f.contents.emit('destroyed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits while the tab wakes, an agent command runs in it or its page is being recovered', async () => {
    const f = failingTab()
    f.fail()
    f.tab.wakePromise = Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    f.tab.wakePromise = undefined
    f.browser.mcpActivitiesByTab.set('tab', new Set(['activity']))
    await vi.advanceTimersByTimeAsync(10_000)
    f.browser.mcpActivitiesByTab.delete('tab')
    f.browser.rendererRecovery.isRecovering.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(f.contents.loadURL).not.toHaveBeenCalled()
    f.browser.rendererRecovery.isRecovering.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.contents.loadURL).toHaveBeenCalledOnce()
  })

  it('never loads a website the tab’s workspace may not open, and loads a tab in no workspace', async () => {
    const f = failingTab()
    workspaceNavigationAllowed.mockReturnValue(false)
    f.fail()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(workspaceNavigationAllowed).toHaveBeenCalledOnce()
    expect(f.contents.loadURL).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    const outside = failingTab()
    outside.tab.mcpGroupId = undefined
    outside.fail()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(outside.contents.loadURL).toHaveBeenCalledOnce()
    expect(workspaceNavigationAllowed).toHaveBeenCalledOnce()
  })
})
