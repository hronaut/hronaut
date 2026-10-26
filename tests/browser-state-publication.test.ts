import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StatePublication, STATE_PUBLISH_MS } from '../src/main/browser/browser-state/state-publication.js'
import type { BrowserState, BrowserTabState } from '../src/shared/types.js'

// Pages loading together changed the browser state many times a second, and each change sent every tab to the shell,
// which drew them all again: 45 tabs opened at once froze the window for up to 3.9 s.

let now = 1_000
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function advance(ms: number): Promise<void> {
  now += ms
  await vi.advanceTimersByTimeAsync(ms)
}

/** A publication of a state holding one tab, whose title and loading a test changes, sent to a fake shell. */
function publication() {
  const sent: BrowserState[] = []
  const page = { title: 'Start', loading: false }
  let open = true
  let failing = false
  const read = (): BrowserState => ({
    tabs: [{ id: 'tab', title: page.title, loading: page.loading } as BrowserTabState],
    closedTabs: [],
    activeTabId: 'tab',
    allTabsMuted: false,
    allHumanInteractionLocked: false,
    agentControlLocked: false,
    mcpUrl: 'http://127.0.0.1:1/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  })
  const states = new StatePublication({
    canPublish: () => open,
    read,
    loadingTabIds: () => page.loading ? ['tab'] : [],
    send: (state) => {
      if (failing) throw new Error('hook failed')
      sent.push(state)
    }
  })
  return {
    states,
    sent,
    titles: () => sent.map(state => state.tabs[0]!.title),
    loading: () => sent.map(state => state.tabs[0]!.loading),
    change: (next: Partial<typeof page>) => { Object.assign(page, next); states.changed() },
    close: () => { open = false },
    fail: (next: boolean) => { failing = next }
  }
}

it('publishes a change after a quiet moment at once', () => {
  const shell = publication()
  shell.change({ title: 'First' })
  expect(shell.titles()).toEqual(['First'])
})

it('publishes the changes of a burst together, from the state as it is then', async () => {
  const shell = publication()
  shell.change({ title: 'First' })
  await advance(5)
  shell.change({ title: 'Second' })
  shell.change({ title: 'Third' })
  expect(shell.titles()).toEqual(['First'])
  await advance(STATE_PUBLISH_MS)
  expect(shell.titles()).toEqual(['First', 'Third'])
  // The burst ended: the next change after a quiet moment goes out at once again.
  await advance(100)
  shell.change({ title: 'Fourth' })
  expect(shell.titles()).toEqual(['First', 'Third', 'Fourth'])
})

it('publishes a page that starts loading at once, so a load that ends within the burst still reaches the shell', async () => {
  // Reloading a cached page starts and ends its load within a few milliseconds; the shell's Environment panel and
  // detached panels act when a tab starts loading and when it stops.
  const shell = publication()
  shell.change({ title: 'Before reload' })
  await advance(2)
  shell.change({ loading: true })
  await advance(3)
  shell.change({ loading: false })
  expect(shell.loading()).toEqual([false, true])
  await advance(STATE_PUBLISH_MS)
  expect(shell.loading()).toEqual([false, true, false])
  // A page that keeps loading is not published at once again for each change.
  shell.change({ loading: true })
  await advance(2)
  shell.change({ title: 'Loading' })
  expect(shell.loading()).toEqual([false, true, false, true])
})

it('does not send a state equal to the one sent last', async () => {
  const shell = publication()
  shell.change({ title: 'Same' })
  await advance(100)
  shell.change({ title: 'Same' })
  expect(shell.titles()).toEqual(['Same'])
})

it('sends an equal state again once the state was read, as an action reply may show the shell another state', async () => {
  const shell = publication()
  shell.change({ title: 'Same' })
  await advance(100)
  shell.states.beforeRead()
  shell.change({ title: 'Same' })
  expect(shell.titles()).toEqual(['Same', 'Same'])
})

it('publishes a waiting change before the state is read, so an action reply is never newer than what the shell keeps', async () => {
  const shell = publication()
  shell.change({ title: 'First' })
  await advance(5)
  shell.change({ title: 'Second' })
  shell.states.beforeRead()
  expect(shell.titles()).toEqual(['First', 'Second'])
  await advance(STATE_PUBLISH_MS)
  expect(shell.titles()).toEqual(['First', 'Second'])
})

it('publishes nothing while the browser closes, and nothing waits once disposed', async () => {
  const shell = publication()
  shell.change({ title: 'First' })
  await advance(5)
  shell.change({ title: 'Waiting' })
  shell.states.dispose()
  await advance(STATE_PUBLISH_MS)
  shell.close()
  shell.change({ title: 'Closing' })
  shell.states.beforeRead()
  await advance(STATE_PUBLISH_MS)
  expect(shell.titles()).toEqual(['First'])
})

it('logs a hook that fails without failing the change, and sends the state again with the next change', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const shell = publication()
  shell.fail(true)
  expect(() => shell.change({ title: 'First' })).not.toThrow()
  expect(error).toHaveBeenCalledWith('[browser] Could not publish the browser state:', expect.any(Error))
  shell.fail(false)
  await advance(100)
  shell.change({ title: 'First' })
  expect(shell.titles()).toEqual(['First'])
})
