import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TAB_STATE_VERSION,
  TabStateStore,
  type PersistedBrowserState
} from '../src/main/browser/tab-store.js'
import { MAX_TAB_TITLE_CHARS } from '../src/main/browser/tab-metadata.js'

const DEFAULT_WORKSPACE_ID = '01912345-6789-7abc-8def-0123456789ab'
const ACTIVE_WORKSPACE_ID = '01912345-678a-7abc-8def-0123456789ab'
const SAVED_WORKSPACE_ID = '01912345-678b-7abc-8def-0123456789ab'
const HOME_TAB_ID = '01912345-678c-7abc-8def-0123456789ab'
const ACTIVE_TAB_ID = '01912345-678d-7abc-8def-0123456789ab'
const ACTIVE_STORAGE_ID = '8e3da8ea-cba4-41c2-9619-a6e04a493a44'
const SAVED_STORAGE_ID = '9f4eb9fb-dcb5-42d3-a72a-b7f15b5a4b55'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: TabStateStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'state', 'tabs.json')
  return { path, store: new TabStateStore(path) }
}

function currentState(): PersistedBrowserState {
  return {
    version: TAB_STATE_VERSION,
    activeTabId: ACTIVE_TAB_ID,
    allHumanInteractionLocked: true,
    mcpTabGroups: [
      {
        id: DEFAULT_WORKSPACE_ID,
        contextClass: 'standard',
        name: 'Personal',
        description: 'Everyday signed-in browsing',
        storageId: '77777777-1111-4111-8111-111111111111',
        color: 'gray',
        createdAt: '2026-08-20T09:00:00.000Z',
        lastUsedAt: '2026-08-20T09:01:00.000Z',
        activeTabId: null,
        origins: [],
        navigationPolicy: { mode: 'unrestricted', rules: [] },
        navigationAudit: []
      },
      {
        id: ACTIVE_WORKSPACE_ID,
        contextClass: 'standard',
        name: 'Checkout debugging',
        description: 'Reproduce checkout failures',
        color: 'orange',
        createdAt: '2026-08-20T09:02:00.000Z',
        lastUsedAt: '2026-08-20T09:03:00.000Z',
        activeTabId: ACTIVE_TAB_ID,
        storageId: ACTIVE_STORAGE_ID,
        origins: ['https://shop.example'],
        navigationPolicy: { mode: 'restricted', rules: ['https://shop.example', '*.trusted.example'] },
        navigationAudit: []
      }
    ],
    savedTabGroups: [{
      id: SAVED_WORKSPACE_ID,
      contextClass: 'standard',
      name: 'Saved checkout research',
      description: 'Reference material for checkout work',
      color: 'blue',
      savedAt: '2026-08-20T09:04:00.000Z',
      storageId: SAVED_STORAGE_ID,
      origins: ['https://docs.example'],
      navigationPolicy: { mode: 'restricted', rules: ['https://docs.example'] },
      navigationAudit: [],
      tabs: [{ title: 'Orders', url: 'https://docs.example/orders', pinned: true }]
    }],
    tabs: [
      { id: HOME_TAB_ID, title: 'Hronaut Home', url: 'hronaut://home/' },
      {
        id: ACTIVE_TAB_ID,
        title: 'Checkout',
        url: 'https://shop.example/checkout',
        pinned: true,
        humanInteractionLocked: true,
        mcpGroupId: ACTIVE_WORKSPACE_ID
      }
    ]
  }
}

describe('TabStateStore', () => {
  it('atomically persists and restores only the current UUIDv7 workspace format', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    await store.save(state)

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(state)
    expect(await store.load()).toEqual({
      ...state,
      allTabsMuted: false,
      mcpTabGroups: state.mcpTabGroups?.map(group => ({ ...group, hiddenFromSidebar: false, deletionProtected: false })),
      savedTabGroups: state.savedTabGroups?.map(group => ({ ...group, hiddenFromSidebar: false, deletionProtected: false })),
      tabs: [
        { ...state.tabs[0], muted: false, pinned: false, humanInteractionLocked: false },
        { ...state.tabs[1], muted: false }
      ]
    })
  })

  it('loads legacy workspaces without descriptions as empty context', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    delete state.mcpTabGroups?.[0]?.description
    delete state.savedTabGroups?.[0]?.description
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()

    expect(restored?.mcpTabGroups?.[0]?.description).toBe('')
    expect(restored?.savedTabGroups?.[0]?.description).toBe('')
  })

  it('persists public observers only with one origin-scoped restricted policy', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![1]!.contextClass = 'public-observer'
    state.mcpTabGroups![1]!.navigationPolicy = { mode: 'restricted', rules: ['https://shop.example'] }
    await store.save(state)

    expect(await store.load()).toMatchObject({
      mcpTabGroups: [expect.any(Object), expect.objectContaining({
        contextClass: 'public-observer',
        navigationPolicy: { mode: 'restricted', rules: ['https://shop.example'] }
      })]
    })

    state.mcpTabGroups![1]!.navigationPolicy = { mode: 'unrestricted', rules: [] }
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')
    expect(await store.load()).toBeNull()
  })

  it('repairs malformed descriptions without discarding workspace state', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![0]!.description = 'x'.repeat(1001)
    state.savedTabGroups![0]!.description = 'unsafe\u0000context'
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()

    expect(restored?.mcpTabGroups).toHaveLength(2)
    expect(restored?.mcpTabGroups?.[0]?.description).toBe('')
    expect(restored?.savedTabGroups?.[0]?.description).toBe('')
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toContain('unsafe')
    expect(JSON.parse(repaired)).toMatchObject({
      mcpTabGroups: [expect.objectContaining({ description: '' }), expect.any(Object)],
      savedTabGroups: [expect.objectContaining({ description: '' })]
    })
  })

  it('repairs malformed, future, and inverted workspace timestamps', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    try {
      const { path, store } = await createStore()
      const state = currentState()
      state.mcpTabGroups![0]!.createdAt = '2027-01-01T00:00:00.000Z'
      state.mcpTabGroups![0]!.lastUsedAt = 'not-a-date'
      state.mcpTabGroups![1]!.createdAt = '2026-08-20T09:03:00.000Z'
      state.mcpTabGroups![1]!.lastUsedAt = '2026-08-20T09:02:00.000Z'
      state.savedTabGroups![0]!.savedAt = '2027-02-01T00:00:00.000Z'
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, JSON.stringify(state), 'utf8')

      const restored = await store.load()

      expect(restored?.mcpTabGroups?.[0]).toMatchObject({
        createdAt: '2026-09-16T12:00:00.000Z',
        lastUsedAt: '2026-09-16T12:00:00.000Z'
      })
      expect(restored?.mcpTabGroups?.[1]).toMatchObject({
        createdAt: '2026-08-20T09:03:00.000Z',
        lastUsedAt: '2026-08-20T09:03:00.000Z'
      })
      expect(restored?.savedTabGroups?.[0]?.savedAt).toBe('2026-09-16T12:00:00.000Z')
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        mcpTabGroups: [
          expect.objectContaining({
            createdAt: '2026-09-16T12:00:00.000Z',
            lastUsedAt: '2026-09-16T12:00:00.000Z'
          }),
          expect.objectContaining({
            createdAt: '2026-08-20T09:03:00.000Z',
            lastUsedAt: '2026-08-20T09:03:00.000Z'
          })
        ],
        savedTabGroups: [expect.objectContaining({ savedAt: '2026-09-16T12:00:00.000Z' })]
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores bounded PNG favicons and repairs invalid persisted favicon data', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.tabs[1]!.faviconDataUrl = 'data:image/png;base64,iVBORw0KGgo='
    await store.save(state)

    expect((await store.load())?.tabs[1]?.faviconDataUrl).toBe(state.tabs[1]!.faviconDataUrl)

    const persisted = JSON.parse(await readFile(path, 'utf8')) as PersistedBrowserState
    persisted.tabs[1]!.faviconDataUrl = `data:image/png;base64,${'A'.repeat(128 * 1024)}`
    await writeFile(path, JSON.stringify(persisted), 'utf8')

    expect((await store.load())?.tabs[1]?.faviconDataUrl).toBeUndefined()
    expect(JSON.parse(await readFile(path, 'utf8')).tabs[1]).not.toHaveProperty('faviconDataUrl')
  })

  it('serializes concurrent saves and keeps the last queued browser state', async () => {
    const { path, store } = await createStore()
    const states = Array.from({ length: 20 }, (_value, index) => {
      const state = currentState()
      state.tabs[1]!.title = `Checkout ${index}`
      return state
    })

    await Promise.all(states.map((state) => store.save(state)))

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(states.at(-1))
  })

  it('does not persist embedded HTTP credentials from active or archived tabs', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.tabs[1]!.url = 'https://active-user:active-secret@shop.example/checkout'
    state.tabs[1]!.title = state.tabs[1]!.url
    state.savedTabGroups![0]!.tabs[0]!.url = 'view-source:https://saved-user:saved-secret@docs.example/orders'
    state.savedTabGroups![0]!.tabs[0]!.title = state.savedTabGroups![0]!.tabs[0]!.url

    await store.save(state)

    const persisted = await readFile(path, 'utf8')
    expect(persisted).not.toContain('active-user')
    expect(persisted).not.toContain('active-secret')
    expect(persisted).not.toContain('saved-user')
    expect(persisted).not.toContain('saved-secret')
    expect(JSON.parse(persisted)).toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({
          id: ACTIVE_TAB_ID,
          title: 'https://shop.example/checkout',
          url: 'https://shop.example/checkout'
        })
      ]),
      savedTabGroups: [{ tabs: [{
        title: 'view-source:https://docs.example/orders',
        url: 'view-source:https://docs.example/orders'
      }] }]
    })
  })

  it('repairs embedded HTTP credentials already present in persisted tab state', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.tabs[1]!.url = 'https://active-user:active-secret@shop.example/checkout'
    state.tabs[1]!.title = state.tabs[1]!.url
    state.savedTabGroups![0]!.tabs[0]!.url = 'view-source:https://saved-user:saved-secret@docs.example/orders'
    state.savedTabGroups![0]!.tabs[0]!.title = state.savedTabGroups![0]!.tabs[0]!.url
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()

    expect(restored?.tabs[1]?.url).toBe('https://shop.example/checkout')
    expect(restored?.tabs[1]?.title).toBe('https://shop.example/checkout')
    expect(restored?.savedTabGroups?.[0]?.tabs[0]?.url).toBe('view-source:https://docs.example/orders')
    expect(restored?.savedTabGroups?.[0]?.tabs[0]?.title).toBe('view-source:https://docs.example/orders')
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toContain('active-secret')
    expect(repaired).not.toContain('saved-secret')
  })

  it('repairs privileged URLs left in active and archived agent workspaces', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.tabs[1]!.url = 'file:///tmp/active-workspace-secret.txt'
    state.tabs[1]!.title = state.tabs[1]!.url
    state.savedTabGroups![0]!.tabs[0]!.url = 'chrome://version'
    state.savedTabGroups![0]!.tabs[0]!.title = state.savedTabGroups![0]!.tabs[0]!.url
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()

    expect(restored?.tabs[1]).toMatchObject({ title: 'New tab', url: 'about:blank' })
    expect(restored?.savedTabGroups?.[0]?.tabs[0]).toMatchObject({ title: 'New tab', url: 'about:blank' })
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toContain('active-workspace-secret')
    expect(repaired).not.toContain('chrome://version')
  })

  it('repairs active and archived URLs that fall outside their persisted workspace allowlists', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.tabs[1]!.url = 'https://blocked.example/private?token=not-persisted'
    state.tabs[1]!.title = state.tabs[1]!.url
    state.savedTabGroups![0]!.tabs[0]!.url = 'https://blocked.example/archive/private'
    state.savedTabGroups![0]!.tabs[0]!.title = state.savedTabGroups![0]!.tabs[0]!.url
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()

    expect(restored?.tabs[1]).toMatchObject({ title: 'New tab', url: 'about:blank' })
    expect(restored?.savedTabGroups?.[0]?.tabs[0]).toMatchObject({ title: 'New tab', url: 'about:blank' })
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toContain('not-persisted')
    expect(repaired).not.toContain('/archive/private')
  })

  it('canonicalizes workspace allowlists without silently downgrading restricted policies', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![1]!.navigationPolicy = {
      mode: 'restricted',
      rules: ['https://SHOP.example:443/', 'https://shop.example', '*.BÜCHER.example.']
    }
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    expect((await store.load())?.mcpTabGroups?.[1]?.navigationPolicy).toEqual({
      mode: 'restricted',
      rules: ['https://shop.example', '*.xn--bcher-kva.example']
    })

    state.mcpTabGroups![1]!.navigationPolicy = { mode: 'restricted', rules: ['file:///tmp/private'] }
    await writeFile(path, JSON.stringify(state), 'utf8')
    expect(await store.load()).toBeNull()
  })

  it('persists only bounded origin-level denied-navigation audit entries', async () => {
    const { store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![1]!.navigationAudit = [{
      id: '01912345-6790-7abc-8def-0123456789ab',
      timestamp: '2026-08-20T09:05:00.000Z',
      targetOrigin: 'https://blocked.example',
      reason: 'no-match',
      source: 'redirect'
    }]
    await store.save(state)

    expect((await store.load())?.mcpTabGroups?.[1]?.navigationAudit).toEqual(state.mcpTabGroups![1]!.navigationAudit)

    state.mcpTabGroups![1]!.navigationAudit![0]!.targetOrigin = 'https://blocked.example/private?secret=value'
    expect(() => store.save(state)).toThrow('audit origin')
  })

  it('drops unversioned legacy tab state instead of migrating or restoring it', async () => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({
      activeTabId: 'legacy-tab',
      tabs: [{ id: 'legacy-tab', title: 'Legacy', url: 'https://legacy.example' }]
    }), 'utf8')

    expect(await store.load()).toBeNull()
  })

  it('restores a valid bounded split-view layout', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.splitView = {
      firstTabId: HOME_TAB_ID,
      secondTabId: ACTIVE_TAB_ID,
      orientation: 'horizontal',
      ratio: 0.9
    }
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    expect((await store.load())?.splitView).toEqual({
      firstTabId: HOME_TAB_ID,
      secondTabId: ACTIVE_TAB_ID,
      orientation: 'horizontal',
      ratio: 0.75
    })
  })

  it('rejects current state when active and archived workspaces share a profile partition', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.savedTabGroups![0]!.storageId = ACTIVE_STORAGE_ID
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    expect(await store.load()).toBeNull()
  })

  it('persists repaired active and archived page titles without dropping current state', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.tabs[1]!.title = `  Checkout\n${'x'.repeat(MAX_TAB_TITLE_CHARS * 4)}  `
    state.savedTabGroups![0]!.tabs[0]!.title = `  Orders\t${'y'.repeat(MAX_TAB_TITLE_CHARS * 4)}  `
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()
    expect(restored?.tabs[1]?.title).toHaveLength(MAX_TAB_TITLE_CHARS)
    expect(restored?.tabs[1]?.title).toMatch(/^Checkout x+$/)
    expect(restored?.savedTabGroups?.[0]?.tabs[0]?.title).toHaveLength(MAX_TAB_TITLE_CHARS)
    expect(restored?.savedTabGroups?.[0]?.tabs[0]?.title).toMatch(/^Orders y+$/)
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toMatch(/\\n|\\t/)
    expect(JSON.parse(repaired)).toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({ id: ACTIVE_TAB_ID, title: expect.stringMatching(/^Checkout x+$/) })
      ]),
      savedTabGroups: [expect.objectContaining({
        tabs: [expect.objectContaining({ title: expect.stringMatching(/^Orders y+$/) })]
      })]
    })
  })

  it('restores distinct workspace identities that intentionally share a human label', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.savedTabGroups![0]!.name = 'Checkout debugging'
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()
    expect(restored?.mcpTabGroups?.[1]).toMatchObject({ id: ACTIVE_WORKSPACE_ID, name: 'Checkout debugging' })
    expect(restored?.savedTabGroups?.[0]).toMatchObject({ id: SAVED_WORKSPACE_ID, name: 'Checkout debugging' })
  })

  it.each([
    ['a non-UUIDv7 tab ID', (state: PersistedBrowserState) => { state.tabs[0]!.id = 'legacy-tab' }],
    ['a non-UUIDv7 workspace ID', (state: PersistedBrowserState) => { state.mcpTabGroups![1]!.id = 'legacy-workspace' }],
    ['a missing isolated storage ID', (state: PersistedBrowserState) => { state.mcpTabGroups![1]!.storageId = '' }],
    ['a tab owned by an archived workspace', (state: PersistedBrowserState) => { state.tabs[1]!.mcpGroupId = SAVED_WORKSPACE_ID }],
    ['a malformed active tab URL', (state: PersistedBrowserState) => { state.tabs[1]!.url = 'https://[' }],
    ['a malformed archived tab URL', (state: PersistedBrowserState) => { state.savedTabGroups![0]!.tabs[0]!.url = 'https://[' }],
    ['a nested view-source URL', (state: PersistedBrowserState) => { state.tabs[1]!.url = 'view-source:view-source:https://example.com' }]
  ])('rejects current state containing %s', async (_name, corrupt) => {
    const { path, store } = await createStore()
    const state = currentState()
    corrupt(state)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    expect(await store.load()).toBeNull()
  })

  it('sanitizes origin lists inside an otherwise valid current profile', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![1]!.origins = [
      'https://shop.example/checkout',
      'not a URL',
      'file:///tmp/private',
      'https://shop.example/account',
      'http://localhost:4173/path'
    ]
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    expect((await store.load())?.mcpTabGroups?.[1]?.origins).toEqual([
      'http://localhost:4173',
      'https://shop.example'
    ])
  })

  it('persists sanitized workspace origins so private URL details are removed from the profile', async () => {
    const { path, store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![1]!.origins = [
      'https://person:origin-secret@shop.example/private?token=active-secret',
      'not a URL'
    ]
    state.savedTabGroups![0]!.origins = [
      'https://docs.example/orders?token=archived-secret'
    ]
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(state), 'utf8')

    const restored = await store.load()

    expect(restored?.mcpTabGroups?.[1]?.origins).toEqual(['https://shop.example'])
    expect(restored?.savedTabGroups?.[0]?.origins).toEqual(['https://docs.example'])
    const repaired = await readFile(path, 'utf8')
    expect(repaired).not.toMatch(/origin-secret|active-secret|archived-secret|\/private/)
    expect(JSON.parse(repaired)).toMatchObject({
      mcpTabGroups: expect.arrayContaining([
        expect.objectContaining({ id: ACTIVE_WORKSPACE_ID, origins: ['https://shop.example'] })
      ]),
      savedTabGroups: [expect.objectContaining({ origins: ['https://docs.example'] })]
    })
  })

  it('returns null for missing and malformed files', async () => {
    const { path, store } = await createStore()
    expect(await store.load()).toBeNull()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '{not json', 'utf8')
    expect(await store.load()).toBeNull()
    await writeFile(path, 'null\n', 'utf8')
    expect(await store.load()).toBeNull()
  })
})


describe('workspace direct agent access persistence', () => {
  it('retains disabled access for active and archived workspaces across reload', async () => {
    const { store } = await createStore()
    const state = currentState()
    state.mcpTabGroups![1]!.agentAccess = false
    state.savedTabGroups![0]!.agentAccess = false
    await store.save(state)
    const loaded = await store.load()
    expect(loaded?.mcpTabGroups?.find((group) => group.id === ACTIVE_WORKSPACE_ID)?.agentAccess).toBe(false)
    expect(loaded?.savedTabGroups?.find((group) => group.id === SAVED_WORKSPACE_ID)?.agentAccess).toBe(false)
  })
})

describe('discarded obsolete workspace data', () => {
  it.each([undefined, 0, 1, 2])('deletes unsupported tab snapshots (version=%s)', async version => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ ...currentState(), version }))
    expect(await store.load()).toBeNull()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([false, true])('drops base-profile workspaces and tabs while preserving isolated storage (archived=%s)', async archived => {
    const { path, store } = await createStore()
    const state = currentState()
    const owner = state.mcpTabGroups![0]!
    const obsolete = { ...owner, storageId: undefined }
    if (archived) {
      state.mcpTabGroups!.shift()
      state.savedTabGroups!.push({ ...obsolete, savedAt: owner.lastUsedAt, tabs: [{ title: 'Old tab', url: 'https://old.example' }] } as never)
    } else {
      state.mcpTabGroups![0] = obsolete as never
      state.tabs.push({ id: SAVED_WORKSPACE_ID, mcpGroupId: owner.id, title: 'Old tab', url: 'https://old.example' })
      state.activeTabId = SAVED_WORKSPACE_ID
      state.splitView = { firstTabId: ACTIVE_TAB_ID, secondTabId: SAVED_WORKSPACE_ID, orientation: 'horizontal', ratio: 0.5 }
    }
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ ...state, defaultHumanGroupId: owner.id }))
    const loaded = await store.load()
    expect(loaded).not.toBeNull()
    expect(loaded?.mcpTabGroups?.map(group => group.id)).toEqual([ACTIVE_WORKSPACE_ID])
    expect(loaded?.savedTabGroups?.map(group => group.id)).toEqual([SAVED_WORKSPACE_ID])
    expect(loaded?.mcpTabGroups?.[0]?.storageId).toBe(ACTIVE_STORAGE_ID)
    expect(loaded?.tabs.every(tab => tab.mcpGroupId !== owner.id)).toBe(true)
    expect(loaded).not.toHaveProperty('defaultHumanGroupId')
    expect(await store.load()).toEqual(loaded)
    expect(await readFile(path, 'utf8')).not.toContain('old.example')
  })
})

describe('continuity checkpoint persistence', () => {
  it('round-trips guarded workspace identities without storing runtime evidence', async () => {
    const { store, path } = await createStore()
    const state = currentState()
    state.continuityWorkspaceIds = [DEFAULT_WORKSPACE_ID]
    await store.save(state)
    expect((await store.load())?.continuityWorkspaceIds).toEqual([DEFAULT_WORKSPACE_ID])
    expect(await readFile(path, 'utf8')).not.toContain('originDigest')
  })
  it('preserves profiles and guards them conservatively when checkpoint metadata is malformed', async () => {
    const { store, path } = await createStore()
    await store.save(currentState())
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    raw.continuityWorkspaceIds = ['unrecognized-workspace']
    await writeFile(path, JSON.stringify(raw))
    const restored = await store.load()
    expect(restored).not.toBeNull()
    expect(restored?.continuityWorkspaceIds?.sort()).toEqual([...(restored?.mcpTabGroups ?? []), ...(restored?.savedTabGroups ?? [])].map(group => group.id).sort())
  })
})
