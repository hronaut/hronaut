import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
    defaultHumanGroupId: DEFAULT_WORKSPACE_ID,
    mcpTabGroups: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: 'Default',
        color: 'gray',
        createdAt: '2026-08-20T09:00:00.000Z',
        lastUsedAt: '2026-08-20T09:01:00.000Z',
        activeTabId: null,
        origins: []
      },
      {
        id: ACTIVE_WORKSPACE_ID,
        name: 'Checkout debugging',
        color: 'orange',
        createdAt: '2026-08-20T09:02:00.000Z',
        lastUsedAt: '2026-08-20T09:03:00.000Z',
        activeTabId: ACTIVE_TAB_ID,
        storageId: ACTIVE_STORAGE_ID,
        origins: ['https://shop.example']
      }
    ],
    savedTabGroups: [{
      id: SAVED_WORKSPACE_ID,
      name: 'Saved checkout research',
      color: 'blue',
      savedAt: '2026-08-20T09:04:00.000Z',
      storageId: SAVED_STORAGE_ID,
      origins: ['https://docs.example'],
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
      tabs: [
        { ...state.tabs[0], pinned: false, humanInteractionLocked: false },
        state.tabs[1]
      ]
    })
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

  it('repairs untrusted active and archived page titles without dropping current state', async () => {
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
  })

  it.each([
    ['a non-UUIDv7 tab ID', (state: PersistedBrowserState) => { state.tabs[0]!.id = 'legacy-tab' }],
    ['a non-UUIDv7 workspace ID', (state: PersistedBrowserState) => { state.mcpTabGroups![1]!.id = 'legacy-workspace' }],
    ['a missing isolated storage ID', (state: PersistedBrowserState) => { delete state.mcpTabGroups![1]!.storageId }],
    ['a duplicate workspace name', (state: PersistedBrowserState) => { state.savedTabGroups![0]!.name = 'Checkout debugging' }],
    ['a tab owned by an archived workspace', (state: PersistedBrowserState) => { state.tabs[1]!.mcpGroupId = SAVED_WORKSPACE_ID }]
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
