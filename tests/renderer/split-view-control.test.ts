import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SplitViewControl from '../../src/renderer/src/components/SplitViewControl.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import type { BrowserState, BrowserTabState, HronautApi } from '../../src/shared/types.js'

function tab(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
    loading: false,
    navigationGeneration: 0,
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
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function renderControl(options: {
  state?: BrowserState
  open?: boolean
  browser?: Partial<Pick<HronautApi, 'openSplitView' | 'updateSplitView' | 'closeSplitView'>>
  locale?: SupportedLocale
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
    global: { plugins: [createHronautI18n(options.locale ?? 'en-US')] },
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

  // Hronaut calls a blank tab "New tab" until a page names it; split view showed that English title in every language.
  it.each([
    ['en-US', 'New tab', 'with'],
    ['uk-UA', 'Нова вкладка', 'з']
  ] as const)('names a blank tab in %s as a new tab, not as a generic tab', async (locale, name, withWord) => {
    const blank = { title: 'New tab', url: 'about:blank' }
    const choosing = renderControl({ locale, state: browserState({
      tabs: browserState().tabs.map(value => value.id === 'first' ? { ...value, ...blank } : value)
    }) })
    expect(choosing.view.container.querySelector('.split-view-summary')?.textContent).toContain(name)
    choosing.view.unmount()

    const candidate = renderControl({ locale, state: browserState({
      tabs: browserState().tabs.map(value => value.id === 'second' ? { ...value, ...blank } : value)
    }) })
    expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    candidate.view.unmount()

    const split = renderControl({ locale, state: browserState({
      tabs: browserState().tabs.map(value => value.id === 'first' ? { ...value, ...blank } : value),
      splitView: { firstTabId: 'first', secondTabId: 'second', orientation: 'vertical', ratio: 0.5 }
    }) })
    expect(split.view.container.querySelector('.split-view-summary')?.textContent).toBe(`${name} ${withWord} Page second`)
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

describe('SplitViewControl keyboard focus while a change is saved', () => {
  const splitState = () => browserState({
    splitView: { firstTabId: 'first', secondTabId: 'second', orientation: 'vertical', ratio: 0.5 }
  })

  // Chromium moves the focus of a control to the page body while the control is disabled. JSDOM cannot blur a
  // disabled control, so it is enabled for the blur itself.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  // The menu stayed open with every control disabled, Chromium blurred the one you used, and nothing gave it the
  // focus back: the next Tab started at the top of the window and the next arrow key on the size slider did nothing.
  it.each([
    ['Stacked', 'is saved'],
    ['Swap panes', 'is saved'],
    ['Swap panes', 'fails'],
    ['size slider', 'is saved']
  ] as const)('gives the focus back to %s once the change %s', async (control, outcome) => {
    const pending = deferred<BrowserState>()
    const state = splitState()
    const updateSplitView = vi.fn(() => pending.promise)
    const rendered = renderControl({ state, browser: { updateSplitView } })
    const user = userEvent.setup()
    let target: HTMLElement
    if (control === 'size slider') {
      target = screen.getByRole('slider')
      target.focus()
      await fireEvent.change(target, { target: { value: '60' } })
    } else {
      target = screen.getByRole('button', { name: control })
      target.focus()
      await user.keyboard('{Enter}')
    }
    expect(updateSplitView).toHaveBeenCalledOnce()
    expect(target).toBeDisabled()
    dropFocusLikeChromium(target)

    if (outcome === 'is saved') pending.resolve(state)
    else pending.reject(new Error('split renderer unavailable'))

    await vi.waitFor(() => expect(target).toHaveFocus())
    expect(target).toBeEnabled()
    if (outcome === 'fails') expect(rendered.view.emitted().error).toHaveLength(1)
  })

  it('moves the focus to Close when the control you used is gone once the change is saved', async () => {
    const pending = deferred<BrowserState>()
    const rendered = renderControl({ state: splitState(), browser: { updateSplitView: vi.fn(() => pending.promise) } })
    rendered.acceptState.mockImplementationOnce(async (next) => {
      await rendered.view.rerender({ state: await next })
    })
    const swap = screen.getByRole('button', { name: 'Swap panes' })
    swap.focus()
    await userEvent.setup().keyboard('{Enter}')
    dropFocusLikeChromium(swap)

    // Split view ended meanwhile, so the menu now offers tabs to split with instead of Swap panes.
    pending.resolve(browserState())

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Close split view menu' })).toHaveFocus())
    expect(swap).not.toBeInTheDocument()
  })

  // Closing the menu detaches the control you used, so the reopened menu's own controls must not take the focus either.
  it.each(['moved', 'closed and reopened'] as const)('leaves the focus alone when you %s it while the change is saved', async (scenario) => {
    const pending = deferred<BrowserState>()
    const state = splitState()
    const rendered = renderControl({ state, browser: { updateSplitView: vi.fn(() => pending.promise) } })
    const elsewhere = document.createElement('button')
    elsewhere.textContent = 'Elsewhere'
    document.body.append(elsewhere)
    try {
      const stacked = screen.getByRole('button', { name: 'Stacked' })
      stacked.focus()
      await userEvent.setup().keyboard('{Enter}')
      dropFocusLikeChromium(stacked)
      if (scenario === 'moved') elsewhere.focus()
      else {
        await rendered.view.rerender({ open: false })
        await rendered.view.rerender({ open: true })
      }

      pending.resolve(state)
      await flushPromises()

      if (scenario === 'moved') expect(elsewhere).toHaveFocus()
      else {
        expect(document.body).toHaveFocus()
        expect(screen.getByRole('button', { name: 'Stacked' })).not.toHaveFocus()
      }
    } finally {
      elsewhere.remove()
    }
  })
})
