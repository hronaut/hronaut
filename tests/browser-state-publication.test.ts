import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { shownTabIds, StatePublication, STATE_DRAWN_TIMEOUT_MS, STATE_PUBLISH_MS } from '../src/main/browser/browser-state/state-publication.js'
import type { BrowserState, BrowserTabState } from '../src/shared/types.js'

// Pages loading together changed the browser state many times a second, and each change sent every tab to the shell,
// which drew them all again: 45 tabs opened at once froze the window for up to 3.9 s.

// The fake clock also drives performance.now, so a state drawn while timers run is drawn at their time.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/**
 * A publication of a state holding one tab, whose title and loading a test changes, sent to a fake shell. The shell
 * says it drew each state right after it arrives, unless the test draws them itself; the tab is shown unless hidden.
 */
function publication(options: { drawsItself?: boolean; hidden?: boolean } = {}) {
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
    shownLoadingTabIds: () => page.loading && !options.hidden ? ['tab'] : [],
    send: (state) => {
      if (failing) throw new Error('hook failed')
      sent.push(state)
      if (!options.drawsItself) queueMicrotask(() => states.drawn())
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

it('waits for the shell to draw a state before sending the next, then as long again as the drawing took', async () => {
  // A shell slower than the changes fell seconds behind on a queue of older states while 45 pages loaded.
  const shell = publication({ drawsItself: true })
  shell.change({ title: 'First' })
  await advance(40)
  shell.change({ title: 'Second' })
  await advance(100)
  expect(shell.titles()).toEqual(['First'])
  // Drawn 140 ms after it was sent: the next state waits another 140 ms, from the state as it is then.
  shell.states.drawn()
  shell.change({ title: 'Third' })
  await advance(139)
  expect(shell.titles()).toEqual(['First'])
  await advance(1)
  expect(shell.titles()).toEqual(['First', 'Third'])
})

it('sends again a while after a state the shell never said it drew', async () => {
  // A shell that reloads, or a test window without one, does not hold the browser's state back for long.
  const shell = publication({ drawsItself: true })
  shell.change({ title: 'First' })
  await advance(10)
  shell.change({ title: 'Second' })
  await advance(STATE_DRAWN_TIMEOUT_MS - 11)
  expect(shell.titles()).toEqual(['First'])
  await advance(1)
  expect(shell.titles()).toEqual(['First', 'Second'])
})

it('sends a shown page that starts loading even while the shell draws, but not a page loading behind it', async () => {
  const shown = publication({ drawsItself: true })
  shown.change({ title: 'Before reload' })
  shown.change({ loading: true })
  expect(shown.loading()).toEqual([false, true])

  const hidden = publication({ drawsItself: true, hidden: true })
  hidden.change({ title: 'Before load' })
  hidden.change({ loading: true })
  expect(hidden.loading()).toEqual([false])
  hidden.states.drawn()
  await advance(STATE_PUBLISH_MS)
  expect(hidden.loading()).toEqual([false, true])
})

it('ignores a drawn state it did not send, so a late answer does not let a burst through', async () => {
  const shell = publication({ drawsItself: true })
  shell.states.drawn()
  shell.change({ title: 'First' })
  shell.states.drawn()
  shell.states.drawn()
  shell.change({ title: 'Second' })
  await advance(STATE_PUBLISH_MS)
  expect(shell.titles()).toEqual(['First', 'Second'])
  shell.change({ title: 'Third' })
  await advance(STATE_PUBLISH_MS)
  expect(shell.titles()).toEqual(['First', 'Second'])
})

it('counts the selected tab and the other half of its split view as shown', () => {
  expect(shownTabIds(null, null)).toEqual([])
  expect(shownTabIds('a', null)).toEqual(['a'])
  expect(shownTabIds('b', { firstTabId: 'a', secondTabId: 'b' })).toEqual(['a', 'b'])
  expect(shownTabIds('c', { firstTabId: 'a', secondTabId: 'b' })).toEqual(['c'])
})
