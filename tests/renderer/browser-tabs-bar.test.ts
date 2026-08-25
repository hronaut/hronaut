import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
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

function renderTabs(state = browserState(), hydrated = true, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  return render(BrowserTabsBar, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      state,
      hydrated,
      orientation,
      mcpActivityByTab: {},
      formatNumber: (value: number) => String(value),
      tabTooltip: (value: BrowserTabState) => value.title,
      describeEmulation: () => ''
    }
  })
}

describe('BrowserTabsBar', () => {
  it('uses vertical navigation and scrolling when tabs are placed on the left', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }), true, 'vertical')
    const user = userEvent.setup()
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const strip = screen.getByRole('tablist', { name: 'Browser tabs and workspaces' })

    expect(strip.closest('.browser-tabs-bar')).toHaveClass('vertical')
    firstControl.focus()
    await user.keyboard('{ArrowDown}')
    expect(secondControl).toHaveFocus()

    Object.defineProperties(strip, {
      clientHeight: { configurable: true, value: 320 },
      scrollHeight: { configurable: true, value: 1_280 },
      scrollTop: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 120 })
    strip.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(strip.scrollTop).toBe(120)
  })

  it('recomputes overflow when the tab position changes its scroll axis', async () => {
    const tabs = Array.from({ length: 9 }, (_, index) => tab(`tab-${index + 1}`))
    const view = renderTabs(browserState({ tabs, activeTabId: tabs[0].id }))
    const strip = screen.getByRole('tablist', { name: 'Browser tabs and workspaces' })
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 1_280 },
      scrollWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 320 },
      scrollHeight: { configurable: true, value: 1_280 },
      scrollTop: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()

    await view.rerender({ orientation: 'vertical' })

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeEnabled())
  })

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

  it('reveals the active tab when it moves into a collapsed workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = { ...workspace('workspace-2'), name: 'Hidden QA' }
    const active = tab('active', { active: true })
    const view = renderTabs(browserState({
      tabs: [active],
      activeTabId: active.id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))

    await view.rerender({
      state: browserState({
        tabs: [{
          ...active,
          mcpGroupId: secondWorkspace.id,
          mcpGroupName: secondWorkspace.name
        }],
        activeTabId: active.id,
        mcpTabGroups: [firstWorkspace, secondWorkspace]
      })
    })

    expect(screen.getByRole('button', { name: 'Collapse workspace Hidden QA, 1 tab' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page active' })).toBeVisible()
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

  it('uses one tab stop and manually activates workspace tabs after arrow-key navigation', async () => {
    const first = tab('first')
    const second = tab('second', { active: true })
    const third = tab('third')
    const view = renderTabs(browserState({
      tabs: [first, second, third],
      activeTabId: second.id
    }))
    const user = userEvent.setup()
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const thirdControl = screen.getByRole('tab', { name: 'Page third' })

    expect(firstControl).toHaveAttribute('tabindex', '-1')
    expect(secondControl).toHaveAttribute('tabindex', '0')
    expect(thirdControl).toHaveAttribute('tabindex', '-1')

    secondControl.focus()
    await user.keyboard('{ArrowRight}')
    expect(thirdControl).toHaveFocus()
    expect(thirdControl).toHaveAttribute('tabindex', '0')
    expect(secondControl).toHaveAttribute('tabindex', '-1')
    expect(view.emitted().selectTab).toBeUndefined()

    await user.keyboard('{ArrowRight}')
    expect(firstControl).toHaveFocus()
    await user.keyboard('{End}')
    expect(thirdControl).toHaveFocus()
    await user.keyboard('{Home}')
    expect(firstControl).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(view.emitted().selectTab).toEqual([['first']])
  })

  it('skips collapsed workspace tabs during keyboard navigation and includes them after expansion', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = { ...workspace('workspace-2'), name: 'Hidden QA' }
    const first = tab('first', { active: true })
    const second = tab('second')
    const hidden = tab('hidden', {
      mcpGroupId: secondWorkspace.id,
      mcpGroupName: secondWorkspace.name
    })
    renderTabs(browserState({
      tabs: [first, second, hidden],
      activeTabId: first.id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))
    const user = userEvent.setup()
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })

    firstControl.focus()
    await user.keyboard('{ArrowLeft}')
    expect(secondControl).toHaveFocus()
    expect(screen.queryByRole('tab', { name: 'Page hidden' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand workspace Hidden QA, 1 tab' }))
    const previouslyHidden = screen.getByRole('tab', { name: 'Page hidden' })
    secondControl.focus()
    await user.keyboard('{ArrowRight}')
    expect(previouslyHidden).toHaveFocus()
    expect(previouslyHidden).toHaveAttribute('aria-selected', 'false')
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

  it('closes a crowded tab with the middle mouse button without activating it', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    const view = renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }))

    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    screen.getByRole('tab', { name: 'Page second' }).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.emitted('closeTab')).toEqual([[second.id]])
    expect(view.emitted('selectTab')).toBeUndefined()
  })

  it('does not middle-click close tabs while all browser interaction is locked', async () => {
    const first = tab('first', { active: true })
    const view = renderTabs(browserState({
      tabs: [first],
      activeTabId: first.id,
      allHumanInteractionLocked: true
    }))

    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    screen.getByRole('tab', { name: 'Page first' }).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.emitted('closeTab')).toBeUndefined()
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

  it('recomputes overflow when tabs move into a collapsed workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = { ...workspace('workspace-2'), name: 'Hidden QA' }
    const tabs = Array.from({ length: 9 }, (_, index) => tab(`tab-${index + 1}`))
    const view = renderTabs(browserState({
      tabs,
      activeTabId: tabs[0].id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))
    const strip = screen.getByRole('tablist', { name: 'Browser tabs and workspaces' })
    let contentWidth = 1_280
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, get: () => contentWidth },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeVisible()

    contentWidth = 280
    await view.rerender({
      state: browserState({
        tabs: tabs.map((value, index) => index === 0 ? value : ({
          ...value,
          mcpGroupId: secondWorkspace.id,
          mcpGroupName: secondWorkspace.name
        })),
        activeTabId: tabs[0].id,
        mcpTabGroups: [firstWorkspace, secondWorkspace]
      })
    })

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

  it('keeps the active crowded tab revealed when an earlier pinned tab expands', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first', { pinned: true })
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()

      await view.rerender({
        state: browserState({
          tabs: [{ ...first, pinned: false }, active],
          activeTabId: active.id
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

  it('keeps a partially visible active tab revealed when earlier tabs expand', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first', { pinned: true })
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()
      vi.spyOn(screen.getByRole('tablist'), 'getBoundingClientRect').mockReturnValue({
        left: 0, right: 320, top: 0, bottom: 40, width: 320, height: 40, x: 0, y: 0, toJSON: () => ({})
      })
      vi.spyOn(screen.getByRole('tab', { name: active.title }), 'getBoundingClientRect').mockReturnValue({
        left: 280, right: 400, top: 0, bottom: 40, width: 120, height: 40, x: 280, y: 0, toJSON: () => ({})
      })

      await view.rerender({
        state: browserState({
          tabs: [{ ...first, pinned: false }, active],
          activeTabId: active.id
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

  it('does not steal a crowded strip the user scrolled away from the active tab', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first', { pinned: true })
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()
      vi.spyOn(screen.getByRole('tablist'), 'getBoundingClientRect').mockReturnValue({
        left: 0, right: 320, top: 0, bottom: 40, width: 320, height: 40, x: 0, y: 0, toJSON: () => ({})
      })
      vi.spyOn(screen.getByRole('tab', { name: active.title }), 'getBoundingClientRect').mockReturnValue({
        left: 500, right: 620, top: 0, bottom: 40, width: 120, height: 40, x: 500, y: 0, toJSON: () => ({})
      })

      await view.rerender({
        state: browserState({
          tabs: [{ ...first, pinned: false }, active],
          activeTabId: active.id
        })
      })
      await nextTick()

      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('reveals the active tab again when the scrolling strip is resized', async () => {
    const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const scrollIntoView = vi.fn()
    let resizeCallback: ResizeObserverCallback | undefined
    let resizeObserver: ResizeObserver | undefined

    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
        resizeObserver = this
      }

      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    }

    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const active = tab('active', { active: true })
      renderTabs(browserState({ tabs: [active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()

      resizeCallback?.([], resizeObserver!)

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (originalResizeObserver) Object.defineProperty(window, 'ResizeObserver', originalResizeObserver)
      else Reflect.deleteProperty(window, 'ResizeObserver')
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })
})
