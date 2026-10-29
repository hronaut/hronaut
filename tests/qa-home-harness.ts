// Shared jsdom harness for the Home redesign QA tests (tests/qa-home-*.test.ts). Not a test file itself: it renders
// Home's real markup, mounts its real controller with a mocked `/api/status` and `window.hronautHome`, and cleans up
// the DOM, timers, storage and listeners after each test.
import { afterEach, beforeEach, vi, type Mock } from 'vitest'
import { renderHomePage } from '../src/main/home/home-page.js'
import { buildMcpReadinessDiagnostic } from '../src/main/mcp/readiness.js'
import { mountHome } from '../src/renderer/src/home/controller.js'
import type { ConnectedAgent } from '../src/shared/agent-status.js'
import type { AgentPresenceState } from '../src/shared/agent-presence.js'
import type { HomeBootstrap, HomeDashboard, HomeFeedEntry, HronautHomeApi } from '../src/shared/home.js'
import type { HomeWorkspaceState } from '../src/shared/home-workspaces.js'
import type { SupportedLocale } from '../src/shared/locale.js'
import type { BrowserSavedTabGroupState, BrowserTabGroupState } from '../src/shared/types.js'

/** Home's clock in every QA test: 10:00 local time, so the greeting is "Good morning" in any time zone. */
export const NOW = new Date(2026, 8, 13, 10, 0, 0).getTime()
export const minutesAgo = (minutes: number): number => NOW - minutes * 60_000
export const isoMinutesAgo = (minutes: number): string => new Date(minutesAgo(minutes)).toISOString()

export const baseDashboard: HomeDashboard = {
  name: 'hronaut', version: '3.0.0', endpoint: 'http://127.0.0.1:47812/mcp',
  startedAt: isoMinutesAgo(30), activeRequests: 0, totalRequests: 0,
  paused: false, status: 'ready', completedToolCalls: 0, clients: [],
  recentActivity: [], toolMetrics: [], tools: [],
  readiness: buildMcpReadinessDiagnostic({
    checkedAt: isoMinutesAgo(0), serverStatus: 'ready', startedAt: isoMinutesAgo(30), advertisedToolNames: [], clients: []
  })
}

export const emptyWorkspaces: HomeWorkspaceState = { mcpTabGroups: [], savedTabGroups: [], tabs: [], activeTabId: null, allHumanInteractionLocked: false }

export function agent(key: string, name: string, state: AgentPresenceState, overrides: Partial<ConnectedAgent> = {}): ConnectedAgent {
  return { key, name, state, initial: name.trim().charAt(0).toLocaleUpperCase(), colorIndex: 0, workspaceIds: [], ...overrides }
}

export function openWorkspace(id: string, overrides: Partial<BrowserTabGroupState> = {}): BrowserTabGroupState {
  return {
    id, name: `Workspace ${id}`, description: '', color: 'blue', createdAt: isoMinutesAgo(60 * 24), lastUsedAt: isoMinutesAgo(60),
    tabCount: 0, activeTabId: null, storageOriginCount: 0, navigationPolicy: { mode: 'unrestricted', rules: [] }, ...overrides
  }
}

export function archivedWorkspace(group: BrowserTabGroupState, savedAt = isoMinutesAgo(5)): BrowserSavedTabGroupState {
  const { id, name, description, color, storageOriginCount, navigationPolicy, hiddenFromSidebar, deletionProtected, agentAccess } = group
  return { id, name, description, color, storageOriginCount, navigationPolicy, hiddenFromSidebar, deletionProtected, agentAccess, savedAt, tabs: [] }
}

let feedId = 0
export function feedEntry(workspaceId: string, overrides: Partial<HomeFeedEntry> = {}): HomeFeedEntry {
  return {
    id: `entry-${++feedId}`, agentKey: 'claude', agentName: 'Claude Code', colorIndex: 1, workspaceId,
    step: 'click', outcome: 'done', at: minutesAgo(1), ...overrides
  }
}

export interface MountOptions {
  dashboard?: HomeDashboard
  workspaces?: HomeWorkspaceState
  api?: Partial<HronautHomeApi>
  authenticationDisabled?: boolean
  locale?: SupportedLocale
}

export interface HomeHarness {
  page: ReturnType<typeof mountHome>
  data: HomeBootstrap
  api: Partial<HronautHomeApi>
  load: Mock<() => Promise<{ ok: boolean; json: () => Promise<HomeDashboard> }>>
  /** Shows this status now, as main's next read would, and returns it on every later read. */
  show(next: HomeDashboard): void
  /** The workspaces main returns from now on; shown on the next read or `showWorkspaces`. */
  setWorkspaces(next: HomeWorkspaceState): void
}

let mounted: ReturnType<typeof mountHome> | undefined

/** Renders Home's real document and mounts its controller. Polling, `/api/status` and the workspace reads are mocked. */
export function mountTestHome(options: MountOptions = {}): HomeHarness {
  mounted?.dispose()
  let current = options.dashboard ?? baseDashboard
  let workspaces = options.workspaces ?? emptyWorkspaces
  const html = renderHomePage({
    endpoint: current.endpoint, initialState: current, locale: options.locale ?? 'en-US', platform: 'linux',
    authenticationDisabled: options.authenticationDisabled, workspaces
  })
  document.documentElement.innerHTML = html
  const data = JSON.parse(document.querySelector('#home-bootstrap')!.textContent!) as HomeBootstrap
  const api: Partial<HronautHomeApi> = { getWorkspaces: vi.fn(async () => workspaces), ...options.api }
  const load = vi.fn(async () => ({ ok: true, json: async () => current }))
  const page = mountHome(data, api as HronautHomeApi, load as unknown as typeof fetch)
  mounted = page
  return {
    page, data, api, load,
    show(next) { current = next; page.update(next) },
    setWorkspaces(next) { workspaces = next }
  }
}

/** Lets pending promise chains (reads, bridge answers) finish without moving the fake clock. */
export async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

/** A promise the test resolves or rejects later, to hold a bridge call open. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}
export const query = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`Missing ${selector}`)
  return node
}
export const words = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/gu, ' ').trim()

/** Fake timers on a fixed clock, an in-memory localStorage, and full cleanup after each test. */
export function installHomeHooks(): void {
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const values = new Map<string, string>()
    const storage: Storage = {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: key => values.get(key) ?? null,
      key: index => [...values.keys()][index] ?? null,
      removeItem: key => { values.delete(key) },
      setItem: (key, value) => { values.set(key, String(value)) }
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  })
  afterEach(() => {
    mounted?.dispose()
    mounted = undefined
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.documentElement.innerHTML = ''
    if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
    else Reflect.deleteProperty(window, 'localStorage')
  })
}
