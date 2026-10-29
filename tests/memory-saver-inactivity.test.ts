import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }))
// The prototype-built browser below stubs changed, getState, focusTabOrTrustedChrome and putTabToSleep, which split
// view and Memory Saver reach through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js')>(),
  focusTabOrTrustedChrome: (browser: { focusTabOrTrustedChrome: (tab: unknown) => void }, tab: unknown) => browser.focusTabOrTrustedChrome(tab)
}))
vi.mock('../src/main/browser/tab-sleep/tab-sleep.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-sleep/tab-sleep.js')>(),
  putTabToSleep: (
    browser: { putTabToSleep: (tab: unknown, reportBlocked: boolean, isCurrent: () => boolean) => Promise<boolean> },
    tab: unknown,
    reportBlocked: boolean,
    isCurrent: () => boolean
  ) => browser.putTabToSleep(tab, reportBlocked, isCurrent)
}))
import { Browser } from '../src/main/browser/browser.js'

afterEach(() => { vi.useRealTimers() })

const MINUTE = 60_000

interface Tab {
  id: string
  url: string
  sleeping: boolean
  lastActiveAt: number
  view: { id: string }
  webContents: { id: number; isDestroyed: () => boolean }
}

function page(id: string, number: number, lastActiveAt: number): Tab {
  return {
    id, url: `https://example.test/${id}`, sleeping: false, lastActiveAt,
    view: { id: `view-${id}` }, webContents: { id: number, isDestroyed: () => false }
  }
}

/**
 * Three website tabs with Memory Saver on its default hour. Putting a tab to sleep is recorded instead of done, so the
 * test sees which tabs the sweep finds inactive for longer than the timeout, before checking whether each may sleep.
 */
function browser() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(10 * 60 * MINUTE)
  const now = Date.now()
  const tabs = new Map([
    ['reading', page('reading', 1, now)],
    ['other', page('other', 2, now)],
    ['idle', page('idle', 3, now - 3 * 60 * MINUTE)]
  ])
  const putTabToSleep = vi.fn(async (_tab: Tab) => false)
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false, tabs, mcpTabGroups: new Map(),
    activeTabId: null, splitView: null, tabSelectionGeneration: 0, splitViewGeneration: 0,
    memorySaverEnabled: true, memorySaverTimeoutMinutes: 60, memorySaverSettingsGeneration: 0,
    memorySaverSweeps: { run: (sweep: () => Promise<void>) => sweep() },
    window: { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } },
    splitDivider: { cancel: vi.fn() },
    putTabToSleep, wakeTab: vi.fn(async () => ({})),
    layout: vi.fn(), focusTabOrTrustedChrome: vi.fn(), changed: vi.fn(), getState: () => ({})
  }) as Browser
  const sweep = () => (manager as unknown as { sweepMemorySaver(force: boolean): Promise<void> }).sweepMemorySaver(false)
  const askedToSleep = () => putTabToSleep.mock.calls.map(([tab]) => tab.id)
  return { manager, tabs, putTabToSleep, sweep, askedToSleep }
}

describe('Memory Saver inactivity', () => {
  it('counts the time a tab was in view as activity, so switching away does not put it to sleep at once', async () => {
    const { manager, sweep, askedToSleep } = browser()
    manager.selectTab('reading')
    // The person reads the page for two hours, scrolling but never clicking or typing in it.
    vi.setSystemTime(Date.now() + 2 * 60 * MINUTE)
    manager.selectTab('other')
    await sweep()
    // The page the person was reading until a moment ago used to go to sleep at the next sweep, within 30 seconds of
    // switching away, as if it had been inactive for two hours.
    expect(askedToSleep()).not.toContain('reading')
    expect(askedToSleep()).toContain('idle')

    // Once it has been out of view for longer than the timeout, it may sleep.
    vi.setSystemTime(Date.now() + 61 * MINUTE)
    await sweep()
    expect(askedToSleep()).toContain('reading')
  })

  it('counts the time a page was in split view as activity when the split view closes', async () => {
    const { manager, sweep, askedToSleep } = browser()
    manager.selectTab('reading')
    manager.openSplitView('other')
    // Both pages stay side by side for two hours.
    vi.setSystemTime(Date.now() + 2 * 60 * MINUTE)
    manager.closeSplitView()
    await sweep()
    // The page that left the window used to sleep at the next sweep.
    expect(askedToSleep()).not.toContain('other')
    expect(askedToSleep()).toContain('idle')
  })

  it('counts the time a page was in split view as activity when another split view replaces it', async () => {
    const { manager, sweep, askedToSleep } = browser()
    manager.selectTab('reading')
    manager.openSplitView('other')
    vi.setSystemTime(Date.now() + 2 * 60 * MINUTE)
    // The person pairs the page they are on with another one; the earlier partner leaves the window.
    manager.openSplitView('idle')
    await sweep()
    expect(askedToSleep()).not.toContain('other')
  })

  it('asks each tab once when the tabs are put in a new order during the sweep', async () => {
    const { tabs, putTabToSleep, sweep, askedToSleep } = browser()
    vi.setSystemTime(Date.now() + 2 * 60 * MINUTE)
    putTabToSleep.mockImplementationOnce(async () => {
      // A page opens a tab beside another, which puts the open tabs in a new order.
      const entries = [...tabs.entries()].reverse()
      tabs.clear()
      for (const [id, tab] of entries) tabs.set(id, tab)
      return false
    })
    await sweep()
    // The open tabs were walked live, so the new order started the sweep again and asked the tabs a second time.
    expect(askedToSleep().sort()).toEqual(['idle', 'other', 'reading'])
  })

  it('leaves the sleeping tabs asleep when Memory Saver is turned off, as Chrome does, until each is shown or used', () => {
    const { manager, tabs } = browser()
    tabs.get('idle')!.sleeping = true
    tabs.get('other')!.sleeping = true
    manager.setMemorySaverSettings(false, 60)
    // Turning it off woke every sleeping tab at once, such as the dozens restored asleep, which loaded all their pages
    // together.
    expect((manager as unknown as { wakeTab: ReturnType<typeof vi.fn> }).wakeTab).not.toHaveBeenCalled()
    expect([...tabs.values()].filter(tab => tab.sleeping).map(tab => tab.id)).toEqual(['other', 'idle'])
  })
})
