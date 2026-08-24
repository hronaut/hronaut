import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserTabsBar from '../../src/renderer/src/components/BrowserTabsBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
})

afterEach(() => {
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
})

function workspace(id = 'workspace-1'): BrowserTabGroupState {
  return {
    id,
    name: 'Research',
    color: 'purple',
    createdAt: '2026-08-22T09:00:00.000Z',
    lastUsedAt: '2026-08-22T09:00:00.000Z',
    tabCount: 0,
    activeTabId: null,
    isDefault: false,
    storageKind: 'isolated',
    storageOriginCount: 0
  }
}

function tab(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
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
    mcpGroupId: 'workspace-1',
    mcpGroupName: 'Research',
    ...overrides
  }
}

function browserState(overrides: Partial<BrowserState> = {}): BrowserState {
  const home = tab('home', {
    title: 'Hronaut Home',
    url: 'hronaut://home',
    active: true,
    mcpGroupId: undefined,
    mcpGroupName: undefined
  })
  const first = tab('first')
  return {
    tabs: [home, first],
    closedTabs: [],
    activeTabId: home.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47891/mcp',
    profilePath: '/tmp/hronaut-test',
    mcpTabGroups: [workspace()],
    savedTabGroups: [],
    ...overrides
  }
}

function renderTabs(state = browserState(), hydrated = true) {
  return render(BrowserTabsBar, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      state,
      hydrated,
      mcpActivityByTab: {},
      formatNumber: (value: number) => String(value),
      tabTooltip: (value: BrowserTabState) => value.title,
      describeEmulation: () => ''
    }
  })
}

describe('BrowserTabsBar', () => {
  it.each([
    { label: 'empty', tabs: [] as BrowserTabState[], activeTabId: null },
    { label: 'populated', tabs: [tab('first')], activeTabId: 'first' }
  ])('requests the same workspace context menu for an $label workspace', async ({ tabs, activeTabId }) => {
    const view = renderTabs(browserState({ tabs, activeTabId }))

    await fireEvent.contextMenu(screen.getByRole('button', { name: /workspace Research/ }))

    expect(view.emitted('showWorkspaceContextMenu')).toEqual([['workspace-1']])
  })

  it('restores and persists collapsed workspaces', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    renderTabs()
    const user = userEvent.setup()

    const group = screen.getByRole('button', { name: 'Expand workspace Research, 1 tab' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()

    await user.click(group)

    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeVisible()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('reveals a tab when external activation enters its collapsed workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    const initial = browserState()
    const view = renderTabs(initial)
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()

    await view.rerender({
      state: browserState({
        activeTabId: 'first',
        tabs: initial.tabs.map((value) => ({ ...value, active: value.id === 'first' }))
      })
    })

    expect(screen.getByRole('button', { name: 'Collapse workspace Research, 1 tab' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeVisible()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('preserves collapse state while the authoritative browser state hydrates', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    const view = renderTabs(browserState({ tabs: [], activeTabId: null, mcpTabGroups: [] }), false)
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual(['workspace-1'])

    const hydrated = browserState()
    await view.rerender({
      state: browserState({
        activeTabId: 'first',
        tabs: hydrated.tabs.map((value) => ({ ...value, active: value.id === 'first' }))
      }),
      hydrated: true
    })

    expect(screen.getByRole('button', { name: 'Expand workspace Research, 1 tab' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual(['workspace-1'])
  })

  it('removes stale persisted workspace ids on startup', () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['removed-workspace']))

    renderTabs()

    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('emits midpoint-aware reorder requests but keeps pinned boundaries intact', async () => {
    const first = tab('first')
    const second = tab('second')
    const pinned = tab('pinned', { pinned: true })
    const view = renderTabs(browserState({ tabs: [first, second, pinned], activeTabId: 'first' }))
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const pinnedControl = screen.getByRole('tab', { name: 'Page pinned' })
    vi.spyOn(secondControl, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      width: 100,
      right: 120,
      top: 0,
      bottom: 32,
      height: 32,
      x: 20,
      y: 0,
      toJSON: () => ({})
    })

    await fireEvent.dragStart(firstControl)
    await fireEvent.dragOver(secondControl, { clientX: 90 })
    await fireEvent.drop(secondControl, { clientX: 90 })

    expect(view.emitted().reorderTab).toEqual([[
      { tabId: 'first', targetTabId: 'second', placement: 'after' }
    ]])

    await fireEvent.dragStart(firstControl)
    await fireEvent.dragOver(pinnedControl, { clientX: 0 })
    await fireEvent.drop(pinnedControl, { clientX: 0 })

    expect(view.emitted().reorderTab).toHaveLength(1)
  })

  it('rejects drag targets from another workspace before showing a drop affordance', async () => {
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = {
      ...workspace('workspace-2'),
      name: 'QA'
    }
    const source = tab('source')
    const otherWorkspaceTarget = tab('target', {
      mcpGroupId: secondWorkspace.id,
      mcpGroupName: secondWorkspace.name
    })
    const view = renderTabs(browserState({
      tabs: [source, otherWorkspaceTarget],
      activeTabId: source.id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))
    const sourceControl = screen.getByRole('tab', { name: 'Page source' })
    const targetControl = screen.getByRole('tab', { name: 'Page target' })
    vi.spyOn(targetControl, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      width: 100,
      right: 120,
      top: 0,
      bottom: 32,
      height: 32,
      x: 20,
      y: 0,
      toJSON: () => ({})
    })

    await fireEvent.dragStart(sourceControl)
    await fireEvent.dragOver(targetControl, { clientX: 90 })

    expect(targetControl).not.toHaveClass('drop-before')
    expect(targetControl).not.toHaveClass('drop-after')

    await fireEvent.drop(targetControl, { clientX: 90 })

    expect(view.emitted().reorderTab).toBeUndefined()
  })

  it('offers explicit controls and mouse-wheel navigation when tabs overflow', async () => {
    const tabs = Array.from({ length: 9 }, (_, index) => tab(`tab-${index + 1}`))
    renderTabs(browserState({ tabs, activeTabId: tabs[0].id }))
    const user = userEvent.setup()
    const strip = screen.getByRole('tablist', { name: 'Browser tabs and workspaces' })
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 1_280 },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })
    const scrollBy = vi.fn(({ left }: ScrollToOptions) => { strip.scrollLeft += left ?? 0 })
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })

    await fireEvent.scroll(strip)

    const previous = screen.getByRole('button', { name: 'Show previous tabs' })
    const next = screen.getByRole('button', { name: 'Show more tabs' })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    await user.click(next)
    expect(scrollBy).toHaveBeenCalledOnce()
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
    expect(scrollBy.mock.calls[0][0].left).toBeCloseTo(230.4)

    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 120 })
    strip.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(350.4)

    strip.scrollLeft = 960
    await fireEvent.scroll(strip)
    expect(previous).toBeEnabled()
    expect(next).toBeDisabled()

    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 280 })
    await user.click(screen.getByRole('button', { name: 'Collapse workspace Research, 9 tabs' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show previous tabs' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()
    })
  })

  it('reveals a newly active tab inside the scrolling strip', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const initial = browserState()
      const view = renderTabs(initial)

      await view.rerender({
        state: browserState({
          activeTabId: 'first',
          tabs: initial.tabs.map((value) => ({ ...value, active: value.id === 'first' }))
        })
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })
})
