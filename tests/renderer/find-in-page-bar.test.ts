import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FindInPageBar from '../../src/renderer/src/components/FindInPageBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { MAX_FIND_QUERY_LENGTH, type BrowserFindResult, type BrowserTabState, type HronautApi } from '../../src/shared/types.js'

function tab(id: string): BrowserTabState {
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
    devToolsOpen: false
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function renderBar(options: {
  activeTab?: BrowserTabState
  browser?: Partial<Pick<HronautApi, 'findInPage' | 'stopFindInPage'>>
} = {}) {
  const activeTab = options.activeTab ?? tab('first')
  const browser = {
    findInPage: vi.fn(options.browser?.findInPage ?? (async (): Promise<BrowserFindResult> => ({ activeMatchOrdinal: 1, matches: 3 }))),
    stopFindInPage: vi.fn(options.browser?.stopFindInPage ?? (async () => undefined))
  }
  const view = render(FindInPageBar, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { open: true, activeTab, browser }
  })
  return { view, browser, activeTab }
}

describe('FindInPageBar', () => {
  it('focuses the query and delegates match navigation to the active tab', async () => {
    const { browser } = renderBar()
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Find text' })

    await vi.waitFor(() => expect(search).toHaveFocus())
    expect(search).toHaveAttribute('maxlength', String(MAX_FIND_QUERY_LENGTH))
    await fireEvent.update(search, 'needle')

    await vi.waitFor(() => expect(browser.findInPage).toHaveBeenLastCalledWith({
      tabId: 'first',
      query: 'needle',
      forward: true,
      findNext: true
    }))
    expect(screen.getByText('1 / 3')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Next match' }))
    expect(browser.findInPage).toHaveBeenLastCalledWith({
      tabId: 'first',
      query: 'needle',
      forward: true,
      findNext: false
    })
    await user.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(browser.findInPage).toHaveBeenLastCalledWith({
      tabId: 'first',
      query: 'needle',
      forward: false,
      findNext: false
    })
  })

  it('keeps a stale search response from replacing the latest result', async () => {
    const first = deferred<BrowserFindResult>()
    const second = deferred<BrowserFindResult>()
    const { browser } = renderBar({
      browser: {
        findInPage: (options) => options.query === 'first' ? first.promise : second.promise
      }
    })
    const search = screen.getByRole('searchbox', { name: 'Find text' })

    await fireEvent.update(search, 'first')
    await fireEvent.update(search, 'second')
    expect(browser.findInPage).toHaveBeenCalledTimes(2)

    second.resolve({ activeMatchOrdinal: 2, matches: 4 })
    await screen.findByText('2 / 4')
    first.resolve({ activeMatchOrdinal: 1, matches: 9 })

    await vi.waitFor(() => expect(screen.getByText('2 / 4')).toBeVisible())
    expect(screen.queryByText('1 / 9')).not.toBeInTheDocument()
  })

  it('closes and clears the original page search when the active tab changes', async () => {
    const { view, browser } = renderBar()
    await vi.waitFor(() => expect(screen.getByRole('searchbox', { name: 'Find text' })).toHaveFocus())

    await view.rerender({ activeTab: tab('second') })

    await vi.waitFor(() => expect(browser.stopFindInPage).toHaveBeenCalledWith('first'))
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('truncates oversized programmatic input to the shared main-process limit', async () => {
    const { browser } = renderBar()
    const search = screen.getByRole('searchbox', { name: 'Find text' })
    const oversized = 'x'.repeat(MAX_FIND_QUERY_LENGTH + 1)

    await fireEvent.update(search, oversized)

    await vi.waitFor(() => expect(browser.findInPage).toHaveBeenCalledWith(expect.objectContaining({
      query: 'x'.repeat(MAX_FIND_QUERY_LENGTH)
    })))
    expect(search).toHaveValue('x'.repeat(MAX_FIND_QUERY_LENGTH))
  })

  it('invalidates pending work and clears the page selection when unmounted', async () => {
    const pending = deferred<BrowserFindResult>()
    const { view, browser } = renderBar({ browser: { findInPage: () => pending.promise } })
    await fireEvent.update(screen.getByRole('searchbox', { name: 'Find text' }), 'needle')

    view.unmount()

    await vi.waitFor(() => expect(browser.stopFindInPage).toHaveBeenCalledWith('first'))
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    pending.resolve({ activeMatchOrdinal: 1, matches: 1 })
  })
})
