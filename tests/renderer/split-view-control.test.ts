import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SplitViewControl from '../../src/renderer/src/components/SplitViewControl.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState, HronautApi } from '../../src/shared/types.js'

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
  const home = tab('home', { url: 'hronaut://home', title: 'Hronaut Home', mcpGroupId: undefined, mcpGroupName: undefined })
  const first = tab('first', { active: true })
  const second = tab('second')
  return {
    tabs: [home, first, second],
    closedTabs: [],
    activeTabId: first.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47891/mcp',
    profilePath: '/tmp/hronaut-test',
    mcpTabGroups: [],
    savedTabGroups: [],
    ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function renderControl(options: {
  state?: BrowserState
  open?: boolean
  browser?: Partial<Pick<HronautApi, 'openSplitView' | 'updateSplitView' | 'closeSplitView'>>
} = {}) {
  const state = options.state ?? browserState()
  const browser = {
    openSplitView: vi.fn(options.browser?.openSplitView ?? (async () => state)),
    updateSplitView: vi.fn(options.browser?.updateSplitView ?? (async () => state)),
    closeSplitView: vi.fn(options.browser?.closeSplitView ?? (async () => state))
  }
  const acceptState = vi.fn(async (next: Promise<BrowserState> | BrowserState) => { await next })
  const closeOtherMenus = vi.fn()
  const view = render(SplitViewControl, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: options.open ?? true,
      state,
      activeTab: state.tabs.find((value) => value.id === state.activeTabId),
      browser,
      acceptState,
      closeOtherMenus
    }
  })
  return { view, browser, acceptState, closeOtherMenus }
}

describe('SplitViewControl', () => {
  it('opens from a clean shell and delegates the selected tab through authoritative state', async () => {
    const closed = renderControl({ open: false })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Split view' }))

    expect(closed.closeOtherMenus).toHaveBeenCalledOnce()
    expect(closed.view.emitted()['update:open']).toEqual([[true]])
    closed.view.unmount()

    const opened = renderControl()
    await user.click(screen.getByRole('button', { name: /Page second/ }))

    expect(opened.browser.openSplitView).toHaveBeenCalledWith('second')
    expect(opened.acceptState).toHaveBeenCalledOnce()
    expect(opened.view.emitted()['update:open']).toEqual([[false]])
  })

  it('closes stale menu state when candidates disappear or the toolbar unmounts', async () => {
    const state = browserState()
    const view = renderControl({ state }).view

    await view.rerender({
      state: browserState({
        tabs: state.tabs.filter((value) => value.id !== 'second')
      })
    })

    expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument()
    expect(view.emitted()['update:open']).toEqual([[false]])

    const mounted = renderControl().view
    mounted.unmount()
    expect(mounted.emitted()['update:open']).toEqual([[false]])
  })

  it('serializes split mutations and reports rejected operations', async () => {
    const pending = deferred<BrowserState>()
    const state = browserState({
      splitView: {
        firstTabId: 'first',
        secondTabId: 'second',
        orientation: 'vertical',
        ratio: 0.5
      }
    })
    const updateSplitView = vi.fn(() => pending.promise)
    const rendered = renderControl({ state, browser: { updateSplitView } })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Stacked' }))

    expect(screen.getByRole('dialog', { name: 'Split view' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Swap panes' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Swap panes' }))
    expect(updateSplitView).toHaveBeenCalledTimes(1)

    pending.resolve(state)
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Split view' })).toHaveAttribute('aria-busy', 'false'))

    const failure = new Error('split renderer unavailable')
    rendered.browser.closeSplitView.mockRejectedValueOnce(failure)
    await user.click(screen.getByRole('button', { name: 'Exit split view' }))
    await vi.waitFor(() => expect(rendered.view.emitted().error).toEqual([[
      failure,
      'Split view could not be closed.'
    ]]))
  })
})
