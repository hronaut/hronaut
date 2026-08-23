import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ZoomBar from '../../src/renderer/src/components/ZoomBar.vue'
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
    active: true,
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

function browserState(activeTab: BrowserTabState): BrowserState {
  return {
    tabs: [activeTab],
    closedTabs: [],
    activeTabId: activeTab.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47891/mcp',
    profilePath: '/tmp/hronaut-test',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function renderBar(options: {
  activeTab?: BrowserTabState
  open?: boolean
  setZoom?: Pick<HronautApi, 'setZoom'>['setZoom']
} = {}) {
  const activeTab = options.activeTab ?? tab('first')
  const state = browserState(activeTab)
  const browser = {
    setZoom: vi.fn(options.setZoom ?? (async () => state))
  }
  const acceptState = vi.fn(async (next: Promise<BrowserState> | BrowserState) => { await next })
  const view = render(ZoomBar, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: options.open ?? true,
      activeTab,
      browser,
      acceptState,
      formatPercent: (value: number) => `${value}%`
    }
  })
  return { view, browser, acceptState, activeTab, state }
}

describe('ZoomBar', () => {
  it('serializes zoom changes and accepts the authoritative browser state', async () => {
    const pending = deferred<BrowserState>()
    const rendered = renderBar({ setZoom: () => pending.promise })
    const user = userEvent.setup()
    const controls = screen.getByRole('group', { name: 'Page zoom controls' })

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))

    expect(rendered.browser.setZoom).toHaveBeenCalledWith({ tabId: 'first', action: 'in' })
    expect(rendered.acceptState).toHaveBeenCalledWith(pending.promise)
    expect(controls).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(rendered.browser.setZoom).toHaveBeenCalledTimes(1)

    pending.resolve(rendered.state)
    await vi.waitFor(() => expect(controls).toHaveAttribute('aria-busy', 'false'))
  })

  it('reports rejected zoom operations without leaving the controls busy', async () => {
    const failure = new Error('tab disappeared')
    const rendered = renderBar({ setZoom: async () => { throw failure } })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))

    await vi.waitFor(() => expect(rendered.view.emitted().error).toEqual([[failure]]))
    expect(screen.getByRole('group', { name: 'Page zoom controls' })).toHaveAttribute('aria-busy', 'false')
  })

  it('closes stale controls when the active tab changes or becomes Home', async () => {
    const changed = renderBar()

    await changed.view.rerender({ activeTab: tab('second') })
    expect(changed.view.emitted()['update:open']?.at(-1)).toEqual([false])

    const home = renderBar()
    await home.view.rerender({ activeTab: tab('first', { url: 'hronaut://home/' }) })
    expect(home.view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('respects page zoom limits and clears open state on unmount', () => {
    const minimum = renderBar({ activeTab: tab('minimum', { zoomPercent: 50 }) })
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    minimum.view.unmount()
    expect(minimum.view.emitted()['update:open']?.at(-1)).toEqual([false])

    renderBar({ activeTab: tab('maximum', { zoomPercent: 300 }) })
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  })
})
