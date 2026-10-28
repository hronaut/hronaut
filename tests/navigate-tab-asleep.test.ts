import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { back, forward, navigate } from '../src/main/browser/page-navigation/page-navigation.js'

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
  const access = {
    getTab: () => tab,
    findTab: (id: string) => (id === tab.id ? tab : undefined),
    searchEngine: () => undefined,
    prepareDiagnosticNavigation: vi.fn(),
    wakeTab: vi.fn(async () => { calls.push('wake'); tab.sleeping = false; tab.wakePromise = undefined; return { ok: true } }),
    getState: () => ({ ok: true })
  }
  return { tab, access, calls }
}

it('loads an address in a tab restored asleep once its sleeping page is there, after waking it', async () => {
  let pageShown!: () => void
  const { access, calls } = sleepingTab({ pageReady: new Promise<void>(resolve => { pageShown = resolve }) })
  const loaded = navigate(access as never, 'https://next.example/')
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(calls).toEqual([])
  pageShown()
  await loaded
  expect(calls).toEqual(['wake', 'load https://next.example/'])
})

it('replaces a wake already running with the address, as a load replaces the one before it', async () => {
  const { access, calls } = sleepingTab({ waking: true })
  await navigate(access as never, 'https://next.example/')
  expect(access.wakeTab).not.toHaveBeenCalled()
  expect(calls).toEqual(['load https://next.example/'])
})

it('wakes a sleeping tab before Back and Forward, which then go from the page it woke to', async () => {
  const backward = sleepingTab()
  await back(backward.access as never)
  expect(backward.calls).toEqual(['wake', 'back'])
  const onward = sleepingTab({ waking: true })
  await forward(onward.access as never)
  expect(onward.calls).toEqual(['wake', 'forward'])
})
