import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { back, forward, navigate } from '../src/main/browser/page-navigation/page-navigation.js'

// The browser below stubs getState, which navigating publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// A tab restored asleep first shows its sleeping page, and a load before that page was in place was taken back by it,
// or by the wake that followed. Back and Forward of a sleeping tab went from its sleeping page.

function sleepingTab(options: { pageReady?: Promise<void>; waking?: boolean } = {}) {
  const calls: string[] = []
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => false,
    loadURL: vi.fn(async (url: string) => { calls.push(`load ${url}`) }),
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => true,
      getActiveIndex: () => 1,
      getAllEntries: () => [{ url: 'https://example.test/first' }, { url: 'https://example.test/shown' }, { url: 'https://example.test/forward' }],
      goBack: vi.fn(async () => { calls.push('back') }),
      goForward: vi.fn(async () => { calls.push('forward') })
    }
  })
  const tab = {
    id: 'tab', navigationGeneration: 0, documentGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: !options.waking,
    wakePromise: options.waking ? new Promise<void>(() => undefined) : undefined, pageReady: options.pageReady, webContents
  }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    options: {},
    prepareDiagnosticNavigation: vi.fn(),
    wakeTab: vi.fn(async () => { calls.push('wake'); tab.sleeping = false; tab.wakePromise = undefined; return { ok: true } }),
    getState: () => ({ ok: true })
  }
  return { tab, browser, calls }
}

it('loads an address in a tab restored asleep once its session cookies are back, after waking it', async () => {
  let cookiesBack!: () => void
  const { browser, calls } = sleepingTab({ pageReady: new Promise<void>(resolve => { cookiesBack = resolve }) })
  const loaded = navigate(browser as never, 'https://next.example/')
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(calls).toEqual([])
  cookiesBack()
  await loaded
  expect(calls).toEqual(['wake', 'load https://next.example/'])
})

it('replaces a wake already running with the address, as a load replaces the one before it', async () => {
  const { browser, calls } = sleepingTab({ waking: true })
  await navigate(browser as never, 'https://next.example/')
  expect(browser.wakeTab).not.toHaveBeenCalled()
  expect(calls).toEqual(['load https://next.example/'])
})

it('wakes a sleeping tab before Back and Forward, which then go from the page it woke to', async () => {
  const backward = sleepingTab()
  await back(backward.browser as never)
  expect(backward.calls).toEqual(['wake', 'back'])
  const onward = sleepingTab({ waking: true })
  await forward(onward.browser as never)
  expect(onward.calls).toEqual(['wake', 'forward'])
})
