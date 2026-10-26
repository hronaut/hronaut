import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'

// Pages loading together changed the browser state many times a second, and each change sent every tab to the shell,
// which drew them all again: 45 tabs opened at once froze the window for up to 3.9 s.

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }))

const { BrowserTabsManager } = await import('../src/main/browser/tabs-manager.js')

interface Manager {
  changed(persist?: boolean): void
  getState(): BrowserState
  destroy(): void
}

let now = 1_000
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A manager whose state is only its MCP address, which a test changes, sending to a fake shell. */
function manager() {
  const sent: BrowserState[] = []
  const published: BrowserState[] = []
  const changes = vi.fn()
  let address = 'http://127.0.0.1:1/mcp'
  const instance = Object.assign(Object.create(BrowserTabsManager.prototype), {
    destroyed: false,
    restoringLayout: false,
    statePublishTimer: null,
    lastStatePublishAt: Number.NEGATIVE_INFINITY,
    lastPublishedState: undefined,
    options: { onStateChanged: (state: BrowserState) => published.push(state), onChanged: changes },
    window: { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_channel: string, state: BrowserState) => sent.push(state) } },
    store: { save: async () => undefined },
    browserStateAccess: () => ({
      publishedAgentFollow: () => undefined,
      orderedTabs: () => [],
      closedTabs: () => [],
      activeTabId: () => null,
      splitView: () => undefined,
      allTabsMuted: () => false,
      allHumanInteractionLocked: () => false,
      allAgentsPaused: () => false,
      agentPauseOverridesAllowed: () => false,
      mcpUrl: () => address,
      options: () => ({ profilePath: '/profile' }),
      listMcpTabGroups: () => [],
      listSavedTabGroups: () => []
    })
  }) as Manager
  return { instance, sent, published, changes, setAddress: (next: string) => { address = next } }
}

it('publishes a change after a quiet moment at once', () => {
  const { instance, sent, published, changes } = manager()
  instance.changed(false)
  expect(sent.map(state => state.mcpUrl)).toEqual(['http://127.0.0.1:1/mcp'])
  expect(published).toHaveLength(1)
  expect(changes).toHaveBeenCalledTimes(1)
})

it('publishes the changes of a burst together, from the state as it is then', async () => {
  const { instance, sent, published, changes, setAddress } = manager()
  instance.changed(false)
  for (const port of [2, 3, 4]) {
    now += 5
    setAddress(`http://127.0.0.1:${port}/mcp`)
    instance.changed(false)
  }
  // The shell keeps what was published first until the burst's wait ends.
  expect(sent).toHaveLength(1)
  // The overlays go back above a page view attached meanwhile at once.
  expect(changes).toHaveBeenCalledTimes(4)
  now += 20
  await vi.advanceTimersByTimeAsync(28)
  expect(sent.map(state => state.mcpUrl)).toEqual(['http://127.0.0.1:1/mcp', 'http://127.0.0.1:4/mcp'])
  expect(published).toHaveLength(2)
})

it('does not send a state equal to the one published last', async () => {
  const { instance, sent } = manager()
  instance.changed(false)
  now += 100
  instance.changed(false)
  expect(sent).toHaveLength(1)
})

it('sends an equal state again when it was read meanwhile, as an action reply shows the shell another state', () => {
  const { instance, sent } = manager()
  instance.changed(false)
  now += 100
  instance.getState()
  instance.changed(false)
  expect(sent).toHaveLength(2)
})

it('publishes a waiting change before the state is read, so an action reply is never newer than what the shell keeps', async () => {
  const { instance, sent, setAddress } = manager()
  instance.changed(false)
  now += 5
  setAddress('http://127.0.0.1:2/mcp')
  instance.changed(false)
  expect(sent).toHaveLength(1)
  const reply = instance.getState()
  expect(sent.map(state => state.mcpUrl)).toEqual(['http://127.0.0.1:1/mcp', 'http://127.0.0.1:2/mcp'])
  expect(reply.mcpUrl).toBe('http://127.0.0.1:2/mcp')
  now += 40
  await vi.advanceTimersByTimeAsync(40)
  expect(sent).toHaveLength(2)
})

it('publishes nothing once the browser is closing', async () => {
  const { instance, sent, setAddress } = manager()
  instance.changed(false)
  now += 5
  setAddress('http://127.0.0.1:2/mcp')
  instance.changed(false)
  Object.assign(instance, { destroyed: true })
  now += 30
  await vi.advanceTimersByTimeAsync(30)
  expect(sent).toHaveLength(1)
})
