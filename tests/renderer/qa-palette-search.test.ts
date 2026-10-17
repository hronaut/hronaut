import { fireEvent, render, screen } from '@testing-library/vue'
import { nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../../src/renderer/src/components/CommandPalette.vue'
import { RECENT_COMMANDS_KEY, useCommandPaletteController } from '../../src/renderer/src/composables/useCommandPaletteController.js'
import { useCommandPaletteSearch } from '../../src/renderer/src/composables/useCommandPaletteSearch.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { LocalPreferenceStorage } from '../../src/renderer/src/local-preferences.js'
import { goToTab, goToWorkspace, type WorkspaceNavigation } from '../../src/renderer/src/workspace-navigation.js'
import type { AgentPresence, AgentPresenceSnapshot } from '../../src/shared/agent-presence.js'
import type { CommandPaletteResult, CommandPaletteResultSection } from '../../src/shared/command-palette-search.js'
import type {
  BrowserHistoryEntry,
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabGroupState,
  BrowserTabState
} from '../../src/shared/types.js'

// Regression coverage for #869 (the command palette searches tabs, workspaces, settings and history), deferred to the
// redesign QA pass.

const globalT = createHronautI18n('en-US').global.t as (key: string, values?: Record<string, unknown>, plural?: number) => string
const translate = (key: string, values?: Record<string, unknown>, plural?: number): string => (
  plural === undefined ? globalT(key, values ?? {}) : globalT(key, values ?? {}, plural)
)

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function tab(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    navigationGeneration: 1,
    title: `Tab ${id}`,
    url: `https://${id}.example/`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active: false,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function group(id: string, name: string, overrides: Partial<BrowserTabGroupState> = {}): BrowserTabGroupState {
  return {
    id,
    name,
    description: '',
    color: 'green',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: '2026-10-01T00:00:00.000Z',
    tabCount: 0,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    ...overrides
  }
}

function archive(id: string, name: string): BrowserSavedTabGroupState {
  return {
    id,
    name,
    description: '',
    color: 'blue',
    savedAt: '2026-10-02T00:00:00.000Z',
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    tabs: [{ title: 'Old notes', url: 'https://notes.example/', pinned: false }]
  }
}

function state(): BrowserState {
  return {
    tabs: [
      tab('current', { title: 'Acme orders', url: 'https://acme.test/orders', mcpGroupId: 'shop', active: true }),
      tab('docs', { title: 'Acme docs', url: 'https://acme.test/docs?token=secret#auth', mcpGroupId: 'shop' }),
      tab('home', { title: 'Acme Home', url: 'hronaut://home/' }),
      tab('research-tab', { title: 'Paper', url: 'https://papers.example/', mcpGroupId: 'team:research' })
    ],
    closedTabs: [],
    activeTabId: 'current',
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [
      group('shop', 'Acme Store', { activeTabId: 'current', tabCount: 2 }),
      group('team:research', 'Acme research', { activeTabId: 'research-tab', tabCount: 1, color: 'purple' })
    ],
    savedTabGroups: [archive('saved:2026:acme', 'Acme archive')]
  }
}

function navigation(overrides: Partial<WorkspaceNavigation> = {}): WorkspaceNavigation & {
  browser: { newTab: ReturnType<typeof vi.fn>; restoreSavedTabGroup: ReturnType<typeof vi.fn> }
  syncState: ReturnType<typeof vi.fn>
  selectTab: ReturnType<typeof vi.fn>
  expandTabGroup: ReturnType<typeof vi.fn>
} {
  const current = state()
  return {
    state: current,
    browser: {
      newTab: vi.fn(async () => current),
      restoreSavedTabGroup: vi.fn(async () => current)
    },
    syncState: vi.fn(async (next: Promise<BrowserState> | BrowserState) => { await next }),
    selectTab: vi.fn(async () => undefined),
    expandTabGroup: vi.fn(),
    ...overrides
  } as never
}

describe('goToTab', () => {
  it('shows an open tab, unfolding its workspace first', async () => {
    const target = navigation()

    await expect(goToTab('docs', target)).resolves.toBe(true)

    expect(target.expandTabGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'docs' }))
    expect(target.selectTab).toHaveBeenCalledWith('docs')
    expect(target.expandTabGroup.mock.invocationCallOrder[0]).toBeLessThan(target.selectTab.mock.invocationCallOrder[0])
  })

  it('returns false for a tab that is gone, without selecting anything', async () => {
    const target = navigation()

    await expect(goToTab('closed-by-agent', target)).resolves.toBe(false)

    expect(target.expandTabGroup).not.toHaveBeenCalled()
    expect(target.selectTab).not.toHaveBeenCalled()
  })

  it('lets a failed selection reach the caller', async () => {
    const target = navigation()
    target.selectTab.mockRejectedValueOnce(new Error('Renderer disappeared'))

    await expect(goToTab('docs', target)).rejects.toThrow('Renderer disappeared')
  })
})

describe('goToWorkspace', () => {
  it('restores an archived workspace by its whole id, colons included', async () => {
    const target = navigation()

    await expect(goToWorkspace({ kind: 'archived', id: 'saved:2026:acme' }, target)).resolves.toBe(true)

    expect(target.browser.restoreSavedTabGroup).toHaveBeenCalledWith('saved:2026:acme')
    expect(target.syncState).toHaveBeenCalledOnce()
    expect(target.selectTab).not.toHaveBeenCalled()
  })

  it('shows the tab an open workspace had in view', async () => {
    const target = navigation()

    await expect(goToWorkspace({ kind: 'open', id: 'team:research' }, target)).resolves.toBe(true)

    expect(target.expandTabGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'research-tab' }))
    expect(target.selectTab).toHaveBeenCalledWith('research-tab')
    expect(target.browser.newTab).not.toHaveBeenCalled()
  })

  it('shows the workspace\'s first tab when it has no tab in view', async () => {
    const current = state()
    current.mcpTabGroups[0] = { ...current.mcpTabGroups[0], activeTabId: null }
    const target = navigation({ state: current })

    await expect(goToWorkspace({ kind: 'open', id: 'shop' }, target)).resolves.toBe(true)

    expect(target.selectTab).toHaveBeenCalledWith('current')
  })

  it('opens a new tab in an open workspace without tabs', async () => {
    const current = state()
    current.mcpTabGroups.push(group('empty', 'Empty workspace'))
    const target = navigation({ state: current })

    await expect(goToWorkspace({ kind: 'open', id: 'empty' }, target)).resolves.toBe(true)

    expect(target.browser.newTab).toHaveBeenCalledWith({ mcpGroupId: 'empty', active: true })
    expect(target.syncState).toHaveBeenCalledOnce()
    expect(target.selectTab).not.toHaveBeenCalled()
  })

  it('returns false for an open workspace that is gone', async () => {
    const target = navigation()

    await expect(goToWorkspace({ kind: 'open', id: 'closed-by-agent' }, target)).resolves.toBe(false)

    expect(target.selectTab).not.toHaveBeenCalled()
    expect(target.browser.newTab).not.toHaveBeenCalled()
    expect(target.syncState).not.toHaveBeenCalled()
  })
})

function presenceAgent(name: string, state: AgentPresence['state']): AgentPresence {
  return { clientKey: name, name, initial: name[0], colorIndex: 0, state, step: 'click', recentSteps: [] }
}

function visit(id: string, url: string, title: string, minutesAgo: number): BrowserHistoryEntry {
  return { id, url, title, visitedAt: new Date(Date.UTC(2026, 9, 17, 5, 0) - minutesAgo * 60_000).toISOString(), visitCount: 1 }
}

function createSearch(initial = state()) {
  const browserState: Ref<BrowserState> = ref(initial)
  const history = ref<BrowserHistoryEntry[]>([
    visit('billing', 'https://acme.test/billing', 'Acme billing', 5),
    visit('open-docs', 'https://acme.test/docs?token=secret', 'Acme docs', 1)
  ])
  const presence = ref<AgentPresenceSnapshot>({
    revision: 1,
    workspaces: {
      'team:research': [presenceAgent('Claude Code', 'working'), presenceAgent('Codex', 'working'), presenceAgent('Cursor', 'working')]
    }
  })
  const browser = {
    newTab: vi.fn(async () => browserState.value),
    restoreSavedTabGroup: vi.fn(async () => browserState.value)
  }
  const showError = vi.fn()
  const selectTab = vi.fn(async (_tabId: string): Promise<unknown> => undefined)
  const expandTabGroup = vi.fn()
  const openHistoryEntry = vi.fn(async (_entry: BrowserHistoryEntry): Promise<unknown> => undefined)
  const openSettingsSection = vi.fn()
  const search = useCommandPaletteSearch({
    state: browserState,
    history,
    userAttention: ref(null),
    presence,
    browser,
    syncState: async (next) => { browserState.value = await Promise.resolve(next) },
    selectTab,
    expandTabGroup,
    translate,
    formatNumber: String,
    formatError: (cause, fallback) => cause instanceof Error ? cause.message : fallback,
    showError,
    openHistoryEntry,
    openSettingsSection
  })
  return { search, browserState, history, browser, showError, selectTab, expandTabGroup, openHistoryEntry, openSettingsSection }
}

function result(kind: CommandPaletteResult['kind'], id: string, label = id, score = 30): CommandPaletteResult {
  return { kind, id, label, description: '', score }
}

describe('useCommandPaletteSearch', () => {
  it('searches nothing until something is typed', () => {
    const { search } = createSearch()
    expect(search.search('')).toEqual([])
    expect(search.search('   ')).toEqual([])
  })

  it('lists tabs, workspaces, settings and history in that order, leaving out the tab and workspace in view', () => {
    const { search } = createSearch()
    const sections = search.search('acme')

    expect(sections.map((section) => section.id)).toEqual(['tabs', 'workspaces', 'settings', 'history'])
    const [tabs, workspaces, settings, history] = sections
    expect(tabs.results.map((entry) => entry.id)).toEqual(['docs'])
    expect(tabs.results[0]).toMatchObject({ label: 'Acme docs', description: 'acme.test/docs · Acme Store', color: 'green' })
    expect(workspaces.results.map((entry) => entry.id)).toEqual(['open:team:research', 'archived:saved:2026:acme'])
    expect(workspaces.results[0]).toMatchObject({ label: 'Acme research', color: 'purple' })
    // Three agents work there: two are named and the third is counted.
    expect(workspaces.results[0].description).toBe('Claude Code, Codex +1 working · 1 tab · papers.example')
    expect(workspaces.results[1].description).toBe('Archived · 1 tab · notes.example')
    expect(settings.results).toEqual([])
    // The docs page is open in a tab (with a fragment), so History lists only the billing page.
    expect(history.results.map((entry) => entry.id)).toEqual(['billing'])
  })

  it('finds a Settings section by its name', () => {
    const { search } = createSearch()
    const settings = search.search('passwords').find((section) => section.id === 'settings')
    expect(settings?.results.map((entry) => entry.id)).toEqual(['credentials'])
  })

  it('goes to an open tab result', async () => {
    const { search, selectTab, expandTabGroup, showError } = createSearch()

    await search.open(result('tabs', 'docs', 'Acme docs'))

    expect(expandTabGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'docs' }))
    expect(selectTab).toHaveBeenCalledWith('docs')
    expect(showError).not.toHaveBeenCalled()
  })

  it('restores an archived workspace whose id has colons, and shows an open one whose id has colons', async () => {
    const { search, browser, selectTab, showError } = createSearch()
    const [archived, open] = ['archived:saved:2026:acme', 'open:team:research'].map((id) => result('workspaces', id))

    await search.open(archived)
    expect(browser.restoreSavedTabGroup).toHaveBeenCalledWith('saved:2026:acme')

    await search.open(open)
    expect(selectTab).toHaveBeenCalledWith('research-tab')
    expect(showError).not.toHaveBeenCalled()
  })

  it('opens Settings on a section and a visited page in a new tab', async () => {
    const { search, history, openSettingsSection, openHistoryEntry, showError } = createSearch()

    await search.open(result('settings', 'downloads', 'Downloads'))
    expect(openSettingsSection).toHaveBeenCalledWith('downloads')

    await search.open(result('history', 'billing', 'Acme billing'))
    expect(openHistoryEntry).toHaveBeenCalledWith(history.value[0])
    expect(showError).not.toHaveBeenCalled()
  })

  it.each([
    ['a tab an agent closed', result('tabs', 'gone', 'Gone page')],
    ['a workspace that closed', result('workspaces', 'open:gone', 'Gone page')],
    ['a History entry that was cleared', result('history', 'gone', 'Gone page')]
  ])('says it could not open %s after the list was shown', async (_name, gone) => {
    const { search, showError } = createSearch()

    await search.open(gone)

    expect(showError).toHaveBeenCalledWith('Could not open Gone page', 'It may have been closed or removed after the list was shown.')
  })

  it('shows why opening failed', async () => {
    const { search, selectTab, showError } = createSearch()
    selectTab.mockRejectedValueOnce(new Error('Renderer disappeared'))

    await search.open(result('tabs', 'docs', 'Acme docs'))

    expect(showError).toHaveBeenCalledWith('Could not open Acme docs', 'Renderer disappeared')
  })

  it('keeps an older choice\'s failure quiet once the person chose something newer', async () => {
    const { search, selectTab, showError } = createSearch()
    const first = deferred<unknown>()
    selectTab.mockReturnValueOnce(first.promise)

    const older = search.open(result('tabs', 'docs', 'Acme docs'))
    await search.open(result('workspaces', 'archived:saved:2026:acme', 'Acme archive'))
    first.reject(new Error('Renderer disappeared'))
    await older

    expect(showError).not.toHaveBeenCalled()
  })

  it('still reports the newest choice\'s own failure', async () => {
    const { search, selectTab, showError } = createSearch()
    const first = deferred<unknown>()
    selectTab.mockReturnValueOnce(first.promise)

    const older = search.open(result('tabs', 'docs', 'Acme docs'))
    await search.open(result('tabs', 'gone', 'Gone page'))
    first.resolve(undefined)
    await older

    expect(showError).toHaveBeenCalledOnce()
    expect(showError).toHaveBeenCalledWith('Could not open Gone page', expect.any(String))
  })

  it.each(['rejects', 'finds nothing'] as const)('stays quiet when a choice in flight %s after the palette opened again or ran a command', async (outcome) => {
    const { search, selectTab, browserState, showError } = createSearch()
    const pending = deferred<unknown>()
    selectTab.mockReturnValueOnce(pending.promise)

    const opening = search.open(result('workspaces', 'open:team:research', 'Acme research'))
    search.invalidate()
    if (outcome === 'rejects') pending.reject(new Error('Renderer disappeared'))
    else {
      browserState.value = { ...browserState.value, mcpTabGroups: [] }
      pending.resolve(undefined)
    }
    await opening

    expect(showError).not.toHaveBeenCalled()
    // A gone workspace chosen after the reset is reported again.
    await search.open(result('workspaces', 'open:gone', 'Gone page'))
    expect(showError).toHaveBeenCalledOnce()
  })
})

function memoryStorage() {
  const values = new Map<string, string>()
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value) })
  const storage: LocalPreferenceStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem,
    removeItem: (key: string) => { values.delete(key) }
  }
  return { values, storage, setItem }
}

function createController(sections: Ref<CommandPaletteResultSection[]>) {
  const open = ref(false)
  const { values, storage, setItem } = memoryStorage()
  const runCommand = vi.fn(async () => undefined)
  const openResult = vi.fn(async (_result: CommandPaletteResult) => undefined)
  const forgetResults = vi.fn()
  const search = vi.fn((query: string): readonly CommandPaletteResultSection[] => query.trim() ? sections.value : [])
  const controller = useCommandPaletteController({
    open,
    websiteAvailable: ref(true),
    storage: () => storage,
    translate: (key, parameters) => globalT(key, parameters ?? {}),
    runCommand,
    onRunError: vi.fn(),
    search,
    openResult,
    forgetResults
  })
  return { open, values, setItem, runCommand, openResult, forgetResults, search, controller }
}

function selectedKey(controller: ReturnType<typeof useCommandPaletteController>): string | undefined {
  return controller.selectedEntry.value?.key
}

function entryIndex(controller: ReturnType<typeof useCommandPaletteController>, key: string): number {
  return controller.entries.value.findIndex((entry) => entry.key === key)
}

describe('command palette controller with search results', () => {
  it('searches nothing and lists only commands while nothing is typed', async () => {
    const { search, controller } = createController(ref([{ id: 'tabs', results: [result('tabs', 'a')] }]))
    await controller.openPanel()
    controller.query.value = '   '
    await nextTick()

    expect(search).not.toHaveBeenCalled()
    expect(controller.entries.value.every((entry) => entry.kind === 'command')).toBe(true)
    controller.dispose()
  })

  it('runs the selected result with Enter, closing the palette', async () => {
    const found = result('tabs', 'docs', 'Acme docs', 40)
    const { open, openResult, runCommand, controller } = createController(ref([{ id: 'tabs', results: [found] }]))
    await controller.openPanel()
    controller.query.value = 'acme docs'
    await nextTick()
    expect(selectedKey(controller)).toBe('tabs:docs')

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))

    await vi.waitFor(() => expect(openResult).toHaveBeenCalledWith(found))
    expect(open.value).toBe(false)
    expect(runCommand).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('never adds a result to Recent, while a command run from the same list is remembered', async () => {
    const { setItem, values, controller } = createController(ref([{ id: 'tabs', results: [result('tabs', 'docs', 'Settings notes', 30)] }]))
    await controller.openPanel()
    controller.query.value = 'settings'
    await nextTick()
    const found = controller.entries.value.find((entry) => entry.kind === 'result')!

    await controller.runEntry(found)
    expect(setItem).not.toHaveBeenCalled()
    await controller.openPanel()
    expect(controller.groups.value.map((group) => group.id)).not.toContain('recent')

    controller.query.value = 'settings'
    await nextTick()
    await controller.runEntry(controller.entries.value.find((entry) => entry.kind === 'command' && entry.command.id === 'settings')!)
    expect(JSON.parse(values.get(RECENT_COMMANDS_KEY)!)).toEqual(['settings'])
    controller.dispose()
  })

  it('forgets results in flight when it opens or runs a command, but not when it runs a result', async () => {
    const { forgetResults, controller } = createController(ref([{ id: 'tabs', results: [result('tabs', 'docs', 'Settings notes', 30)] }]))
    await controller.openPanel()
    expect(forgetResults).toHaveBeenCalledTimes(1)
    controller.query.value = 'settings'
    await nextTick()

    await controller.runEntry(controller.entries.value.find((entry) => entry.kind === 'result')!)
    expect(forgetResults).toHaveBeenCalledTimes(1)

    await controller.openPanel()
    expect(forgetResults).toHaveBeenCalledTimes(2)
    controller.query.value = 'settings'
    await nextTick()
    await controller.runEntry(controller.entries.value.find((entry) => entry.kind === 'command')!)
    expect(forgetResults).toHaveBeenCalledTimes(3)
    controller.dispose()
  })

  it('keeps the selected result by key as results come and go while open', async () => {
    const sections = ref<CommandPaletteResultSection[]>([{ id: 'tabs', results: [result('tabs', 'b', 'Zeta b')] }])
    const { controller } = createController(sections)
    await controller.openPanel()
    controller.query.value = 'zeta'
    await nextTick()
    controller.selection.value = entryIndex(controller, 'tabs:b')
    expect(selectedKey(controller)).toBe('tabs:b')

    // A tab opens ahead of it, and a workspace that matches better appears above it.
    sections.value = [
      { id: 'tabs', results: [result('tabs', 'a', 'Zeta a'), result('tabs', 'b', 'Zeta b')] },
      { id: 'workspaces', results: [result('workspaces', 'open:zeta', 'Zeta', 40)] }
    ]
    await nextTick()
    expect(selectedKey(controller)).toBe('tabs:b')
    expect(entryIndex(controller, 'workspaces:open:zeta')).toBeLessThan(entryIndex(controller, 'tabs:b'))

    // The selected tab closes: the selection stays in place within the shorter list.
    const index = controller.selection.value
    sections.value = [{ id: 'tabs', results: [result('tabs', 'a', 'Zeta a')] }]
    await nextTick()
    expect(controller.selection.value).toBe(Math.min(index, controller.entries.value.length - 1))
    expect(controller.selectedEntry.value).toBeDefined()

    // Typing starts again from the best match.
    controller.query.value = 'zeta a'
    await nextTick()
    expect(controller.selection.value).toBe(0)
    controller.dispose()
  })

  it('moves the keyboard selection across commands and results and wraps around', async () => {
    const { controller } = createController(ref([{ id: 'history', results: [result('history', 'h1', 'Settings blog', 5)] }]))
    await controller.openPanel()
    controller.query.value = 'settings'
    await nextTick()
    const last = controller.entries.value.length - 1
    expect(controller.entries.value[last]?.key).toBe('history:h1')

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(selectedKey(controller)).toBe('history:h1')
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(controller.selection.value).toBe(0)
    controller.dispose()
  })

  it.each([
    ['its whole name', 40, true],
    ['the start of its name', 30, true],
    ['only its address', 5, false]
  ])('puts a result matching by %s %s commands that match only in their description', async (_name, score, first) => {
    // "dashboard" is in the Home command's description, not in any command's name.
    const { controller } = createController(ref([{ id: 'tabs', results: [result('tabs', 'board', 'Dashboard', score)] }]))
    await controller.openPanel()
    controller.query.value = 'dashboard'
    await nextTick()
    const commandIndexes = controller.entries.value.flatMap((entry, index) => entry.kind === 'command' ? [index] : [])
    expect(commandIndexes.length).toBeGreaterThan(0)
    const resultIndex = entryIndex(controller, 'tabs:board')

    if (first) expect(resultIndex).toBe(0)
    else expect(resultIndex).toBeGreaterThan(Math.max(...commandIndexes))
    controller.dispose()
  })

  it('keeps the result sections in their own order when they match equally well', async () => {
    const { controller } = createController(ref([
      { id: 'tabs', results: [result('tabs', 't', 'Zeta tab')] },
      { id: 'workspaces', results: [result('workspaces', 'open:w', 'Zeta workspace')] },
      { id: 'settings', results: [] },
      { id: 'history', results: [result('history', 'h', 'Zeta page')] }
    ]))
    await controller.openPanel()
    controller.query.value = 'zeta'
    await nextTick()

    expect(controller.groups.value.map((group) => group.id)).toEqual(['tabs', 'workspaces', 'history'])
    controller.dispose()
  })
})

describe('CommandPalette search results', () => {
  beforeEach(() => {
    window.localStorage.removeItem(RECENT_COMMANDS_KEY)
  })

  afterEach(() => {
    window.localStorage.removeItem(RECENT_COMMANDS_KEY)
    vi.restoreAllMocks()
  })

  function renderPalette(sections: Ref<CommandPaletteResultSection[]>) {
    const openResult = vi.fn()
    const view = render(CommandPalette, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        websiteAvailable: false,
        formatNumber: String,
        runCommand: vi.fn(),
        reportCommandError: vi.fn(),
        search: (query: string) => query.trim() ? sections.value : [],
        openResult,
        forgetResults: vi.fn()
      }
    })
    return { view, openResult }
  }

  it('shows results under their section headings and opens one on click without remembering it', async () => {
    const workspace = { ...result('workspaces', 'archived:saved:2026:acme', 'Acme archive', 30), description: 'Archived · 1 tab', color: 'blue' as const }
    const { view, openResult } = renderPalette(ref([
      { id: 'tabs', results: [{ ...result('tabs', 'docs', 'Acme docs', 30), description: 'acme.test/docs · Acme Store', color: 'green' as const }] },
      { id: 'workspaces', results: [workspace] },
      { id: 'history', results: [{ ...result('history', 'billing', 'Acme billing', 30), description: 'acme.test/billing' }] }
    ]))
    await fireEvent.update(screen.getByRole('combobox', { name: 'Search commands, tabs and pages' }), 'acme')

    for (const heading of ['Open tabs', 'Workspaces', 'History']) expect(screen.getByText(heading, { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Acme docs/ })).toHaveTextContent('acme.test/docs · Acme Store')
    const archived = screen.getByRole('option', { name: /Acme archive/ })
    expect(archived).toHaveAttribute('id', 'command-palette-workspaces-archived-saved-2026-acme')
    expect(archived.querySelector('.command-palette-workspace-dot')).not.toBeNull()

    await fireEvent.click(archived)

    expect(openResult).toHaveBeenCalledWith(workspace)
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    expect(window.localStorage.getItem(RECENT_COMMANDS_KEY)).toBeNull()
    view.unmount()
  })

  it('ignores a resting pointer while results change under it, but not when the same rows come back', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const sections = ref<CommandPaletteResultSection[]>([
      { id: 'tabs', results: [result('tabs', 'a', 'Zeta a'), result('tabs', 'b', 'Zeta b')] }
    ])
    const { view } = renderPalette(sections)
    await fireEvent.update(screen.getByRole('combobox', { name: 'Search commands, tabs and pages' }), 'zeta')
    now += 1_000

    const first = screen.getByRole('option', { name: /Zeta a/ })
    await fireEvent.pointerMove(first, { clientX: 40, clientY: 80 })
    expect(first).toHaveAttribute('aria-selected', 'true')

    // The same rows with new details do not move the list, so the pointer still works at once.
    sections.value = [{ id: 'tabs', results: [{ ...result('tabs', 'a', 'Zeta a'), description: 'now loading' }, result('tabs', 'b', 'Zeta b')] }]
    await nextTick()
    const second = screen.getByRole('option', { name: /Zeta b/ })
    await fireEvent.pointerMove(second, { clientX: 40, clientY: 120 })
    expect(second).toHaveAttribute('aria-selected', 'true')

    // A tab opens ahead of them and moves the rows under the resting pointer.
    sections.value = [{ id: 'tabs', results: [result('tabs', 'new', 'Zeta new'), result('tabs', 'a', 'Zeta a'), result('tabs', 'b', 'Zeta b')] }]
    await nextTick()
    const shifted = screen.getByRole('option', { name: /Zeta a/ })
    await fireEvent.pointerMove(shifted, { clientX: 40, clientY: 121 })
    expect(screen.getByRole('option', { name: /Zeta b/ })).toHaveAttribute('aria-selected', 'true')

    now += 151
    await fireEvent.pointerMove(shifted, { clientX: 40, clientY: 122 })
    expect(shifted).toHaveAttribute('aria-selected', 'true')
    view.unmount()
  })
})
