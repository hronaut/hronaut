import { afterEach, expect, it, vi } from 'vitest'
import { BACKGROUND_LOAD_TURN_MS, BACKGROUND_LOADS, BackgroundLoads } from '../src/main/browser/tab-sleep/background-loads.js'

// Open all, a workspace template or an archived workspace opened every page at once, and 45 pages loading together on
// 4 cores took the processor from Hronaut's window. They now load a few at a time.

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Tabs waiting asleep, whose wakes a test finishes one by one. */
function queue() {
  const asleep = new Set<string>()
  const loading = new Map<string, { resolve(): void; reject(error: Error): void }>()
  const loads = new BackgroundLoads({
    waiting: tabId => asleep.has(tabId),
    wake: tabId => new Promise<void>((resolve, reject) => {
      asleep.delete(tabId)
      loading.set(tabId, { resolve, reject })
    })
  })
  const open = (...tabIds: string[]) => { for (const tabId of tabIds) { asleep.add(tabId); loads.add(tabId) } }
  const settle = async (tabId: string, error?: Error) => {
    const load = loading.get(tabId)!
    loading.delete(tabId)
    if (error) load.reject(error)
    else load.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return { asleep, open, settle, loading: () => [...loading.keys()] }
}

it(`loads ${BACKGROUND_LOADS} tabs at a time, each next one in the order they were opened`, async () => {
  const tabs = queue()
  tabs.open('a', 'b', 'c', 'd', 'e')
  expect(tabs.loading()).toEqual(['a', 'b', 'c'])
  await tabs.settle('b')
  expect(tabs.loading()).toEqual(['a', 'c', 'd'])
  await tabs.settle('a')
  await tabs.settle('c')
  expect(tabs.loading()).toEqual(['d', 'e'])
})

it('skips a tab shown or closed before its turn, and goes on after a load that failed', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const tabs = queue()
  tabs.open('a', 'b', 'c', 'shown', 'closed', 'last')
  tabs.asleep.delete('shown')
  tabs.asleep.delete('closed')
  await tabs.settle('a', new Error('Nothing loaded'))
  expect(warn).toHaveBeenCalledWith('[browser] Could not load a background tab:', expect.any(Error))
  expect(tabs.loading()).toEqual(['b', 'c', 'last'])
})

it('gives the next tab its turn once a page still loads after a while, and lets that page go on loading', async () => {
  vi.useFakeTimers()
  const tabs = queue()
  tabs.open('a', 'b', 'c', 'd')
  await vi.advanceTimersByTimeAsync(BACKGROUND_LOAD_TURN_MS - 1)
  expect(tabs.loading()).toEqual(['a', 'b', 'c'])
  // A page whose server never answers an image held its turn for as long as the wake waited, 30 seconds.
  await vi.advanceTimersByTimeAsync(1)
  expect(tabs.loading()).toEqual(['a', 'b', 'c', 'd'])
})
