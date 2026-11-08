import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
// Showing a resumed page at once is recorded rather than done, so each case can tell how the page was shown.
const { showResumedPresentedView } = vi.hoisted(() => ({ showResumedPresentedView: vi.fn() }))
vi.mock('../src/main/browser/presented-view-visibility.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/presented-view-visibility.js')>(),
  showResumedPresentedView,
  reconcileTabPresentation: (browser: { reconcileTabPresentation: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.reconcileTabPresentation(...args)
}))
// The browser below records with changed each time the page's new state is published.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))

const { controlPageLifecycle } = await import('../src/main/browser/page-lifecycle/page-lifecycle.js')
type PageTab = Pick<BrowserTab, 'id' | 'url' | 'navigationGeneration' | 'nativeInputEnvironmentGeneration' | 'sleeping' | 'webContents'
  | 'view' | 'pageLifecycleState' | 'pageLifecycleUnknownRequest' | 'pageLifecycleAnimations'>

/** A frozen tab on screen, and a browser that notes when it shows the tab's page. */
function frozenTab() {
  const commands: string[] = []
  const webContents = {
    id: 3,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    getBackgroundThrottling: () => false,
    setBackgroundThrottling: vi.fn(),
    executeJavaScript: vi.fn(async () => []),
    debugger: {
      isAttached: () => true,
      sendCommand: vi.fn(async (method: string, params?: { state?: string }) => { commands.push(`${method} ${params?.state ?? ''}`) })
    }
  } as unknown as WebContents
  const tab: PageTab = {
    id: 'tab',
    url: 'https://example.com/',
    navigationGeneration: 1,
    nativeInputEnvironmentGeneration: 0,
    sleeping: false,
    webContents,
    view: {} as BrowserTab['view'],
    pageLifecycleState: 'frozen',
    pageLifecycleAnimations: []
  }
  showResumedPresentedView.mockReset().mockImplementation(() => { commands.push(`show ${tab.pageLifecycleState} at once`) })
  const reconcileTabPresentation = vi.fn(() => { commands.push(`show ${tab.pageLifecycleState}`) })
  const window = {}
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    destroyed: false,
    debuggerQueue: { run: (_id: number, operation: () => Promise<unknown>) => operation() },
    dialogMonitorAttachPromises: new Map(),
    devToolsOpening: new Set(),
    window,
    reconcileTabPresentation,
    changed: vi.fn()
  }
  return { tab, browser, window, commands, reconcileTabPresentation }
}

describe('resuming a frozen page', () => {
  it('shows the page on screen as it resumes it, before reporting done', async () => {
    // Chromium hides a page it freezes and leaves it hidden when it resumes, so the resumed page's timers and frames
    // stayed throttled until a later check found it hidden.
    const page = frozenTab()
    await expect(controlPageLifecycle(page.browser as never, 'tab', 'active')).resolves.toMatchObject({ state: 'active', status: 'changed' })
    expect(showResumedPresentedView).toHaveBeenCalledExactlyOnceWith(page.window, page.tab.view)
    expect(page.reconcileTabPresentation).not.toHaveBeenCalled()
    expect(page.commands).toEqual(['Page.setWebLifecycleState active', 'show active at once'])
    // The new state is published without saving the tabs.
    expect(page.browser.changed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('has a page whose freeze may not have reached Chromium shown only if it is hidden', async () => {
    // Showing it at once would give a page that was never hidden a hidden-then-visible change.
    const page = frozenTab()
    page.tab.pageLifecycleState = 'unknown'
    page.tab.pageLifecycleUnknownRequest = 'frozen'
    await expect(controlPageLifecycle(page.browser as never, 'tab', 'active')).resolves.toMatchObject({ state: 'active', status: 'changed' })
    expect(page.reconcileTabPresentation).toHaveBeenCalledExactlyOnceWith(page.tab)
    expect(showResumedPresentedView).not.toHaveBeenCalled()
    expect(page.commands).toEqual(['Page.setWebLifecycleState active', 'show active'])
    expect(page.browser.changed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not show a page it freezes', async () => {
    const page = frozenTab()
    page.tab.pageLifecycleState = 'active'
    await expect(controlPageLifecycle(page.browser as never, 'tab', 'frozen')).resolves.toMatchObject({ state: 'frozen', status: 'changed' })
    expect(showResumedPresentedView).not.toHaveBeenCalled()
    expect(page.reconcileTabPresentation).not.toHaveBeenCalled()
    expect(page.browser.changed).toHaveBeenCalledExactlyOnceWith(false)
  })
})

describe('a lifecycle change while the page is busy', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  /** The tab's page with an earlier debugger command under way until `free` is called. */
  function busyPage() {
    const page = frozenTab()
    let free!: () => void
    const earlier = new Promise<void>(resolve => { free = resolve })
    page.browser.debuggerQueue = { run: (_id: number, operation: () => Promise<unknown>) => earlier.then(operation) }
    return { ...page, free }
  }

  it('waits for the page however long it is busy, then applies, instead of ending unknown after five seconds', async () => {
    vi.useFakeTimers()
    const page = busyPage()
    let settled = false
    const resumed = controlPageLifecycle(page.browser as never, 'tab', 'active').finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(settled).toBe(false)
    expect(page.tab.pageLifecycleState).toBe('frozen')
    expect(page.commands).toEqual([])
    page.free()
    await vi.advanceTimersByTimeAsync(100)
    await expect(resumed).resolves.toMatchObject({ state: 'active', status: 'changed', retrySafe: true })
    expect(page.commands).toEqual(['Page.setWebLifecycleState active', 'show active at once'])
  })

  it('still leaves the state unknown when Chromium does not answer within five seconds of its turn', async () => {
    vi.useFakeTimers()
    const page = busyPage()
    vi.mocked(page.tab.webContents.debugger.sendCommand).mockImplementation(() => new Promise(() => undefined))
    const frozen = controlPageLifecycle(page.browser as never, 'tab', 'active')
    await vi.advanceTimersByTimeAsync(12_000)
    page.free()
    await vi.advanceTimersByTimeAsync(4_900)
    expect(page.tab.pageLifecycleState).toBe('frozen')
    await vi.advanceTimersByTimeAsync(200)
    await expect(frozen).resolves.toMatchObject({ state: 'unknown', status: 'outcome-unknown', retrySafe: false })
    expect(page.tab.pageLifecycleState).toBe('unknown')
  })
})
