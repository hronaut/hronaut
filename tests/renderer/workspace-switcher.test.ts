import { mount, type VueWrapper } from '@vue/test-utils'
import { fireEvent, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import WorkspaceSwitcher from '../../src/renderer/src/components/WorkspaceSwitcher.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'
import type { BrowserState, BrowserTabGroupState } from '../../src/shared/types.js'

function group(id: string, name: string, lastUsedAt: string, extra: Partial<BrowserTabGroupState> = {}): BrowserTabGroupState {
  return {
    id,
    name,
    description: '',
    color: 'blue',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt,
    tabCount: 1,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    ...extra
  }
}

function agent(name: string, state: AgentPresence['state']): AgentPresence {
  return { clientKey: name, name, initial: name[0] ?? '', colorIndex: 1, state, step: 'working', recentSteps: [] }
}

function browserState(): BrowserState {
  return {
    activeTabId: 'shop-2',
    tabs: [
      { id: 'shop-1', url: 'https://shop.example/', mcpGroupId: 'shop' },
      { id: 'shop-2', url: 'http://localhost:5173/cart', mcpGroupId: 'shop' },
      { id: 'docs-1', url: 'https://docs.example/', mcpGroupId: 'docs' },
      { id: 'ops-1', url: 'https://grafana.example/', mcpGroupId: 'ops' }
    ],
    mcpTabGroups: [
      group('shop', 'Shop', '2026-10-16T20:00:00.000Z', { tabCount: 2, activeTabId: 'shop-2' }),
      group('docs', 'Docs', '2026-10-16T19:00:00.000Z', { activeTabId: 'docs-1' }),
      group('ops', 'Ops', '2026-10-16T09:00:00.000Z', { activeTabId: 'ops-1' }),
      group('empty', 'Empty', '2026-10-16T08:00:00.000Z', { tabCount: 0 })
    ],
    savedTabGroups: [{
      id: 'old',
      name: 'Old client',
      description: '',
      color: 'green',
      savedAt: '2026-09-01T00:00:00.000Z',
      storageOriginCount: 0,
      navigationPolicy: { mode: 'unrestricted', rules: [] },
      tabs: [{ title: 'Portal', url: 'https://portal.old.example/', pinned: false }]
    }]
  } as unknown as BrowserState
}

function presence(initial: Record<string, AgentPresence[]>) {
  let listener: ((snapshot: AgentPresenceSnapshot) => void) | undefined
  let revision = 1
  const api: HronautAgentPresenceApi = {
    get: async () => ({ revision, workspaces: initial }),
    onChanged: (next) => { listener = next; return () => { listener = undefined } }
  }
  return { api, publish: (workspaces: Record<string, AgentPresence[]>) => listener?.({ revision: ++revision, workspaces }) }
}

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function setup(options: { state?: BrowserState; agents?: Record<string, AgentPresence[]>; attention?: { tabId?: string; workspaceId?: string } | null } = {}) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const feed = presence(options.agents ?? {})
  const calls = {
    selectTab: vi.fn(async (_tabId: string) => undefined),
    expandTabGroup: vi.fn(),
    syncState: vi.fn(async (next: Promise<BrowserState> | BrowserState) => { await next }),
    newTab: vi.fn(async () => browserState()),
    restoreSavedTabGroup: vi.fn(async () => browserState()),
    showError: vi.fn()
  }
  const mounted = mount(WorkspaceSwitcher, {
    attachTo: document.body,
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: false,
      'onUpdate:open': (open: boolean) => { void mounted.setProps({ open }) },
      state: options.state ?? browserState(),
      userAttention: options.attention ?? null,
      browser: { newTab: calls.newTab, restoreSavedTabGroup: calls.restoreSavedTabGroup },
      syncState: calls.syncState,
      selectTab: calls.selectTab,
      expandTabGroup: calls.expandTabGroup,
      formatNumber: String,
      formatError: (cause: unknown) => String(cause),
      showError: calls.showError,
      presenceApi: feed.api
    }
  })
  wrapper = mounted
  await vi.waitFor(() => Promise.resolve())
  const openPanel = async () => {
    await (mounted.vm as unknown as { openPanel: () => Promise<void> }).openPanel()
    await nextTick()
  }
  return { wrapper: mounted, calls, feed, openPanel }
}

function options(): string[] {
  return within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.querySelector('strong')?.textContent ?? '')
}

describe('WorkspaceSwitcher', () => {
  it('works out no workspace while closed, as pages load and change the browser state, and lists them once opened', async () => {
    let reads = 0
    const counted = (): BrowserState => {
      const state = browserState()
      const groups = state.mcpTabGroups
      return Object.defineProperty(state, 'mcpTabGroups', { enumerable: true, get: () => { reads += 1; return groups } })
    }
    const { wrapper, openPanel } = await setup()
    for (let change = 0; change < 3; change++) {
      await wrapper.setProps({ state: counted() })
      await nextTick()
    }
    expect(reads).toBe(0)
    await openPanel()
    expect(reads).toBeGreaterThan(0)
    expect(options()).toContain('Docs')
  })

  it('lists workspaces by who needs them and recent use, and Enter goes back to the previous one', async () => {
    const { wrapper, calls, openPanel } = await setup({ agents: { ops: [agent('Claude Code', 'working')] } })
    await openPanel()

    expect(screen.getByRole('dialog', { name: 'Switch workspace' })).toBeVisible()
    const search = screen.getByRole('combobox', { name: 'Search workspaces' })
    await vi.waitFor(() => expect(search).toHaveFocus())
    expect(options()).toEqual(['Ops', 'Shop', 'Docs', 'Empty', 'Old client'])
    expect(screen.getByRole('option', { name: /^Ops, Claude Code working, 1 tab · grafana\.example$/ })).toBeVisible()
    const shop = screen.getByRole('option', { name: /^Shop, Current, 2 tabs · shop\.example · localhost:5173$/ })
    expect(shop).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('group', { name: 'Archived' })).toContainElement(screen.getByRole('option', { name: /^Old client, Archived/ }))

    // With nothing typed, the first workspace that is not the current one is selected.
    const ops = screen.getByRole('option', { name: /^Ops/ })
    expect(ops).toHaveAttribute('aria-selected', 'true')
    expect(search).toHaveAttribute('aria-activedescendant', ops.id)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: /^Docs/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() => expect(calls.selectTab).toHaveBeenCalledWith('docs-1'))
    expect(calls.expandTabGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'docs-1' }))
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not switch workspace for the repeats of a held Enter', async () => {
    // The switcher opens with the focus in its search field and another workspace selected, so the repeats of the
    // Enter that opened it switched workspace.
    const { wrapper, calls, openPanel } = await setup({ agents: { ops: [agent('Claude Code', 'working')] } })
    await openPanel()
    const search = screen.getByRole('combobox', { name: 'Search workspaces' })
    await vi.waitFor(() => expect(search).toHaveFocus())

    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    search.dispatchEvent(repeat)
    await nextTick()
    expect(repeat.defaultPrevented).toBe(true)
    expect(calls.selectTab).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Switch workspace' })).toBeVisible()

    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(calls.selectTab).toHaveBeenCalledWith('ops-1'))
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('keeps the workspace it opened on selected under a resting pointer, and follows a pointer that moves', async () => {
    const { calls, openPanel } = await setup({ agents: { ops: [agent('Claude Code', 'working')] } })
    await openPanel()
    const ops = () => screen.getByRole('option', { name: /^Ops/ })
    const docs = screen.getByRole('option', { name: /^Docs/ })
    expect(ops()).toHaveAttribute('aria-selected', 'true')

    // Hiding the pages under the switcher hands the window the pointer where it rests, over a row or beside the list.
    await fireEvent.pointerMove(docs, { clientX: 300, clientY: 200 })
    await fireEvent.pointerMove(docs, { clientX: 300, clientY: 200 })
    expect(ops()).toHaveAttribute('aria-selected', 'true')
    await fireEvent.pointerMove(docs, { clientX: 304, clientY: 206 })
    expect(docs).toHaveAttribute('aria-selected', 'true')

    // Opened again under the same resting pointer, Enter still goes where the switcher opened on.
    screen.getByRole('button', { name: 'Close workspace switcher' }).click()
    await nextTick()
    await openPanel()
    await fireEvent.pointerMove(screen.getByRole('dialog').parentElement!, { clientX: 900, clientY: 40 })
    await fireEvent.pointerMove(screen.getByRole('option', { name: /^Docs/ }), { clientX: 900, clientY: 40 })
    expect(ops()).toHaveAttribute('aria-selected', 'true')
    await fireEvent.pointerMove(screen.getByRole('option', { name: /^Docs/ }), { clientX: 304, clientY: 206 })
    expect(screen.getByRole('option', { name: /^Docs/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(calls.selectTab).toHaveBeenCalledWith('docs-1'))
  })

  it('finds a workspace by an agent or a site, restores an archived one, and opens a tab in an empty one', async () => {
    const { calls, openPanel } = await setup({ agents: { ops: [agent('Claude Code', 'idle')] } })
    await openPanel()
    const search = screen.getByRole('combobox', { name: 'Search workspaces' })

    await userEvent.type(search, 'claude')
    expect(options()).toEqual(['Ops'])
    await userEvent.clear(search)
    await userEvent.type(search, 'localhost')
    expect(options()).toEqual(['Shop'])
    await userEvent.clear(search)
    await userEvent.type(search, 'portal.old')
    expect(options()).toEqual(['Old client'])
    expect(screen.getByRole('status')).toHaveTextContent('1 matching workspace. Selected Old client.')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(calls.restoreSavedTabGroup).toHaveBeenCalledWith('old'))
    expect(calls.syncState).toHaveBeenCalledOnce()

    await openPanel()
    await userEvent.type(screen.getByRole('combobox', { name: 'Search workspaces' }), 'empty')
    await userEvent.click(screen.getByRole('option', { name: /^Empty/ }))
    await vi.waitFor(() => expect(calls.newTab).toHaveBeenCalledWith({ mcpGroupId: 'empty', active: true }))
    expect(calls.selectTab).not.toHaveBeenCalled()

    await openPanel()
    await userEvent.type(screen.getByRole('combobox', { name: 'Search workspaces' }), 'nothing like it')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('No matching workspaces')).toBeVisible()
  })

  it('shows who needs you, and keeps each workspace in its place while agents come and go', async () => {
    const { feed, openPanel } = await setup({ attention: { tabId: 'docs-1' } })
    await openPanel()
    expect(options()).toEqual(['Docs', 'Shop', 'Ops', 'Empty', 'Old client'])
    expect(screen.getByRole('option', { name: /^Docs, Needs you/ })).toBeVisible()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { name: /^Ops/ })).toHaveAttribute('aria-selected', 'true')

    feed.publish({ ops: [agent('Codex', 'working')], empty: [agent('Claude Code', 'working'), agent('Cursor', 'working'), agent('Zed', 'working')] })
    await nextTick()
    expect(options()).toEqual(['Docs', 'Shop', 'Ops', 'Empty', 'Old client'])
    expect(screen.getByRole('option', { name: /^Ops, Codex working/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /^Empty, Claude Code, Cursor \+1 working/ })).toBeVisible()

    // Opened again, the switcher sorts by the agents at work now.
    screen.getByRole('button', { name: 'Close workspace switcher' }).click()
    await nextTick()
    await openPanel()
    expect(options()).toEqual(['Docs', 'Ops', 'Empty', 'Shop', 'Old client'])
  })

  it('lists pinned workspaces after those with agents at work, the earliest pinned first, and says they are pinned', async () => {
    const state = browserState()
    const pins: Record<string, string> = { ops: '2026-10-16T12:00:00.000Z', empty: '2026-10-15T12:00:00.000Z' }
    state.mcpTabGroups = state.mcpTabGroups.map((entry) => pins[entry.id] ? { ...entry, pinnedAt: pins[entry.id] } : entry)
    const { openPanel } = await setup({ state, agents: { docs: [agent('Codex', 'working')] } })
    await openPanel()
    expect(options()).toEqual(['Docs', 'Empty', 'Ops', 'Shop', 'Old client'])
    const ops = screen.getByRole('option', { name: /^Ops, Pinned, 1 tab · grafana\.example$/ })
    expect(within(ops).getByText('Pinned')).toBeVisible()
    expect(screen.getByRole('option', { name: /^Shop, Current, 2 tabs/ })).not.toHaveTextContent('Pinned')
  })

  it('keeps Enter on the workspace used most recently when pinned ones are listed above it', async () => {
    const state = browserState()
    state.mcpTabGroups = state.mcpTabGroups.map((entry) => entry.id === 'ops' ? { ...entry, pinnedAt: '2026-10-16T12:00:00.000Z' } : entry)
    const { openPanel } = await setup({ state })
    await openPanel()
    expect(options()).toEqual(['Ops', 'Shop', 'Docs', 'Empty', 'Old client'])
    expect(screen.getByRole('option', { name: /^Docs/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('moves the selection in the order on screen when a workspace appears while it is open', async () => {
    const { wrapper, openPanel } = await setup()
    await openPanel()
    expect(options()).toEqual(['Shop', 'Docs', 'Ops', 'Empty', 'Old client'])
    expect(screen.getByRole('option', { name: /^Docs/ })).toHaveAttribute('aria-selected', 'true')

    // An agent opens a workspace meanwhile: it is drawn last among the open ones, and the arrow keys agree.
    const next = browserState()
    await wrapper.setProps({ state: { ...next, mcpTabGroups: [...next.mcpTabGroups, group('fresh', 'Fresh', '2026-10-16T21:00:00.000Z', { tabCount: 0 })] } })
    expect(options()).toEqual(['Shop', 'Docs', 'Ops', 'Empty', 'Fresh', 'Old client'])
    expect(screen.getByRole('group', { name: 'Archived' })).not.toContainElement(screen.getByRole('option', { name: /^Fresh/ }))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const fresh = screen.getByRole('option', { name: /^Fresh/ })
    expect(fresh).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox', { name: 'Search workspaces' })).toHaveAttribute('aria-activedescendant', fresh.id)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /^Old client/ })).toHaveAttribute('aria-selected', 'true')

    // Only sections with workspaces in them are listed.
    await userEvent.type(screen.getByRole('combobox', { name: 'Search workspaces' }), 'shop')
    expect(within(screen.getByRole('listbox')).getAllByRole('group').map((section) => section.getAttribute('aria-label'))).toEqual(['Open workspaces'])
    await userEvent.clear(screen.getByRole('combobox', { name: 'Search workspaces' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Search workspaces' }), 'portal')
    expect(within(screen.getByRole('listbox')).getAllByRole('group')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Archived' })).toBeVisible()
  })

  it('reports a failed switch unless the switcher was opened again meanwhile', async () => {
    const { calls, openPanel } = await setup()
    let fail: (cause: Error) => void = () => undefined
    calls.selectTab.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
    await openPanel()
    await userEvent.keyboard('{Enter}')
    fail(new Error('gone'))
    await vi.waitFor(() => expect(calls.showError).toHaveBeenCalledWith('Could not switch workspace', 'Error: gone'))

    await openPanel()
    await userEvent.keyboard('{Enter}')
    await openPanel()
    fail(new Error('late'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.showError).toHaveBeenCalledOnce()
  })

  it('asks for a new workspace once it shows as closed', async () => {
    // The workspace editor opens only while the palette is closed, and New workspace asked while the switcher still
    // showed as open, so the editor never opened.
    const { wrapper, openPanel } = await setup()
    await openPanel()
    let openWhenAsked: unknown
    await wrapper.setProps({ onCreateWorkspace: () => { openWhenAsked = wrapper.props('open') } })
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    await vi.waitFor(() => expect(wrapper.emitted('createWorkspace')).toHaveLength(1))
    expect(openWhenAsked).toBe(false)
  })

  it('hands off to tab search or a new workspace, and says when there are no workspaces yet', async () => {
    const { wrapper, openPanel } = await setup()
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Search tabs' }))
    expect(wrapper.emitted('searchTabs')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    await vi.waitFor(() => expect(wrapper.emitted('createWorkspace')).toHaveLength(1))

    await wrapper.setProps({ state: { ...browserState(), activeTabId: null, tabs: [], mcpTabGroups: [], savedTabGroups: [] } })
    await openPanel()
    expect(screen.getByText('No workspaces yet')).toBeVisible()
  })
})
