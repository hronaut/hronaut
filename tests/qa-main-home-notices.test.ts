// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHomePage } from '../src/main/home-page.js'
import type { McpDashboardState } from '../src/main/mcp/server.js'
import { buildMcpReadinessDiagnostic } from '../src/main/mcp/readiness.js'
import { mountHome } from '../src/renderer/src/home/controller.js'
import type { HomeBootstrap, HronautHomeApi } from '../src/shared/home.js'

const STATUS_URL = 'hronaut://home/api/status'

const state: McpDashboardState = {
  name: 'hronaut', version: '1.11.50', endpoint: 'http://127.0.0.1:47812/mcp',
  startedAt: '2026-09-04T12:00:00.000Z', activeRequests: 0, totalRequests: 0,
  paused: false, status: 'ready', completedToolCalls: 0, clients: [],
  recentActivity: [], toolMetrics: [], tools: [],
  readiness: buildMcpReadinessDiagnostic({
    checkedAt: '2026-09-04T12:00:00.000Z', serverStatus: 'ready',
    startedAt: '2026-09-04T12:00:00.000Z', advertisedToolNames: [], clients: []
  })
}

type Response = { ok: boolean; json: () => Promise<unknown> }
const ready = (): Promise<Response> => Promise.resolve({ ok: true, json: async () => state })

let mounted: ReturnType<typeof mountHome> | undefined
let hidden = false
const listeners = new Set<() => void>()

function mount() {
  const html = renderHomePage({ endpoint: state.endpoint, initialState: state, locale: 'en-US' })
  document.documentElement.innerHTML = html
  const bridge = {
    onChanged: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    })
  }
  Object.defineProperty(window, 'hronautHome', { configurable: true, value: bridge })
  const data = JSON.parse(document.querySelector('#home-bootstrap')!.textContent!) as HomeBootstrap
  const load = vi.fn((_url: string, _init?: unknown) => ready())
  mounted = mountHome(data, bridge as unknown as HronautHomeApi, load as unknown as typeof fetch)
  const statusReads = () => load.mock.calls.filter(([url]) => url === STATUS_URL).length
  const notify = (times = 1) => { for (let index = 0; index < times; index += 1) for (const listener of [...listeners]) listener() }
  return { page: mounted, load, statusReads, notify, bridge }
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((next) => { resolve = next })
  return { promise, resolve }
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
})

afterEach(() => {
  mounted?.dispose()
  mounted = undefined
  listeners.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.innerHTML = ''
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor)
  else Reflect.deleteProperty(document, 'hidden')
})

describe('Home change notices from main', () => {
  it('reads the status once for a burst of notices, a quarter second after the first', async () => {
    const { statusReads, notify } = mount()
    await settle()
    expect(statusReads()).toBe(1)

    notify(5)
    await vi.advanceTimersByTimeAsync(249)
    expect(statusReads()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(statusReads()).toBe(2)
    // Well before the 2-second poll, nothing else reads.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(statusReads()).toBe(2)
  })

  it('waits for a read in flight when notices arrive during it, then reads once more', async () => {
    const { load, statusReads, notify } = mount()
    await settle()
    const slow = deferred()
    load.mockImplementationOnce(() => slow.promise)

    notify()
    await vi.advanceTimersByTimeAsync(250)
    expect(statusReads()).toBe(2)
    // Two more rounds of notices arrive while that read is still on its way.
    notify(3)
    await vi.advanceTimersByTimeAsync(250)
    notify()
    await vi.advanceTimersByTimeAsync(250)
    expect(statusReads()).toBe(2)

    slow.resolve({ ok: true, json: async () => state })
    await settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(statusReads()).toBe(3)
    // The read after it finishes, and no notice is left to read for.
    await vi.advanceTimersByTimeAsync(500)
    expect(statusReads()).toBe(3)
  })

  it('reads nothing after it is disposed, and stops listening to main', async () => {
    const { page, statusReads, notify } = mount()
    await settle()
    notify()
    page.dispose()
    expect(listeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(statusReads()).toBe(1)
    notify()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(statusReads()).toBe(1)
  })

  it('reads once when a hidden Home is shown again after notices, and not before', async () => {
    const { statusReads, notify } = mount()
    await settle()
    hidden = true
    notify(3)
    await vi.advanceTimersByTimeAsync(500)
    expect(statusReads()).toBe(1)

    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(statusReads()).toBe(2)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(500)
    expect(statusReads()).toBe(2)
  })
})
