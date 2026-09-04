import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TabSearchPanel from '../../src/renderer/src/components/TabSearchPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, active = false): BrowserTabState {
  return {
    id,
    navigationGeneration: 1,
    title: `Tab ${id}`,
    url: `https://${id}.example`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active,
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

function state(): BrowserState {
  return {
    tabs: [tab('alpha'), tab('beta', true)],
    closedTabs: [],
    activeTabId: 'beta',
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

describe('TabSearchPanel', () => {
  it('owns search rendering and runs the matching tab through its controller boundary', async () => {
    const browserState = state()
    const selectTab = vi.fn(async () => undefined)
    const browser = {
      closeTab: vi.fn(async () => browserState),
      reopenClosedTab: vi.fn(async () => browserState),
      setTabPinned: vi.fn(async () => browserState),
      restoreSavedTabGroup: vi.fn(async () => browserState),
      deleteSavedTabGroup: vi.fn(async () => browserState),
      getTabOverviewPagePreview: vi.fn(async (tabId: string) => ({ tabId, navigationGeneration: 1, dataUrl: 'data:image/jpeg;base64,YWJj', width: 1000, height: 4000 })),
      getTabOverviewPreviews: vi.fn(async () => [{
        tabId: 'beta',
        navigationGeneration: 1,
        dataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
        width: 360,
        height: 225
      }])
    }
    const previousHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')
    Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
    const view = render(TabSearchPanel, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        state: browserState,
        mcpActivityByTab: {},
        syncState: vi.fn(async () => undefined),
        selectTab,
        expandTabGroup: vi.fn(),
        describeEmulation: () => '',
        formatNumber: String,
        formatTime: String,
        formatError: (_cause: unknown, fallback: string) => fallback,
        showError: vi.fn()
      }
    })

    try {
      const search = screen.getByRole('searchbox', { name: 'Search tabs' })
      expect(screen.getByRole('dialog', { name: 'Tabs' })).toBeVisible()
      expect(screen.getByRole('dialog', { name: 'Tabs' })).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByText('Live previews')).toBeVisible()
      expect(search).toHaveAttribute('role', 'searchbox')
      expect(search).toHaveAttribute('aria-activedescendant', 'tab-search-open-beta')
      expect(screen.getByRole('list', { name: /Other tabs/ })).toBeVisible()
      expect(document.querySelector('.tab-overview-current')).toHaveTextContent('Current tab')
      await vi.waitFor(() => expect(document.querySelector('.tab-overview-preview > img')).toHaveAttribute('src', 'data:image/jpeg;base64,cHJldmlldw=='))
      expect(browser.getTabOverviewPagePreview).not.toHaveBeenCalled()
      const previewAction = screen.getByRole('button', { name: 'Preview Tab beta' })
      await userEvent.setup().click(previewAction)
      expect(selectTab).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to tabs' })).toHaveFocus())
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Full-page preview of Tab beta' })).toBeVisible()
      expect(screen.getByRole('radio', { name: 'Fit page' })).toHaveAttribute('aria-checked', 'true')
      await userEvent.setup().click(screen.getByRole('radio', { name: 'Fit width' }))
      expect(document.querySelector('.tab-page-preview-canvas')).toHaveClass('fit-width')
      await userEvent.setup().keyboard('{Escape}')
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Preview Tab beta' })).toHaveFocus())
      expect(view.emitted()['update:open']).toBeUndefined()
      const restoredSearch = screen.getByRole('searchbox', { name: 'Search tabs' })
      await userEvent.setup().click(restoredSearch)
      await userEvent.setup().keyboard('{Alt>}{Enter}{/Alt}')
      expect(browser.getTabOverviewPagePreview).toHaveBeenCalledTimes(2)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Back to tabs' }))
      const activeSearch = screen.getByRole('searchbox', { name: 'Search tabs' })
      await userEvent.setup().type(activeSearch, 'alpha')
      expect(activeSearch).toHaveAttribute('aria-activedescendant', 'tab-search-open-alpha')
      expect(screen.getByText('Tab alpha').closest('.tab-overview-card')).toHaveClass('selected')
      await userEvent.setup().keyboard('{Enter}')
      await vi.waitFor(() => expect(selectTab).toHaveBeenCalledWith('alpha'))
      expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    } finally {
      view.unmount()
      if (previousHronaut) Object.defineProperty(window, 'hronaut', previousHronaut)
      else Reflect.deleteProperty(window, 'hronaut')
    }
  })

  it('keeps selection and pin available while tab locking disables only close', async () => {
    const browserState = { ...state(), allHumanInteractionLocked: true }
    const browser = {
      closeTab: vi.fn(async () => browserState),
      reopenClosedTab: vi.fn(async () => browserState),
      setTabPinned: vi.fn(async () => browserState),
      restoreSavedTabGroup: vi.fn(async () => browserState),
      deleteSavedTabGroup: vi.fn(async () => browserState),
      getTabOverviewPreviews: vi.fn(async () => [])
    }
    const previousHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')
    Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
    const selectTab = vi.fn(async () => undefined)
    const view = render(TabSearchPanel, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        state: browserState,
        mcpActivityByTab: {},
        syncState: vi.fn(async () => undefined),
        selectTab,
        expandTabGroup: vi.fn(),
        describeEmulation: () => '',
        formatNumber: String,
        formatTime: String,
        formatError: (_cause: unknown, fallback: string) => fallback,
        showError: vi.fn()
      }
    })

    try {
      const close = screen.getByRole('button', { name: 'Close Tab beta' })
      const pin = screen.getByRole('button', { name: 'Pin Tab beta' })
      expect(close).toBeDisabled()
      expect(pin).toBeEnabled()
      await userEvent.setup().click(pin)
      expect(browser.setTabPinned).toHaveBeenCalledWith('beta', true)
      const alphaTab = document.getElementById('tab-search-open-alpha')
      expect(alphaTab).toBeInstanceOf(HTMLButtonElement)
      await userEvent.setup().click(alphaTab!)
      expect(selectTab).toHaveBeenCalledWith('alpha')
    } finally {
      view.unmount()
      if (previousHronaut) Object.defineProperty(window, 'hronaut', previousHronaut)
      else Reflect.deleteProperty(window, 'hronaut')
    }
  })

  it('keeps keyboard focus inside preview recovery after navigation removes the canvas', async () => {
    const browserState = state()
    const browser = {
      closeTab: vi.fn(async () => browserState), reopenClosedTab: vi.fn(async () => browserState),
      setTabPinned: vi.fn(async () => browserState), restoreSavedTabGroup: vi.fn(async () => browserState),
      deleteSavedTabGroup: vi.fn(async () => browserState), getTabOverviewPreviews: vi.fn(async () => []),
      getTabOverviewPagePreview: vi.fn(async (tabId: string) => ({ tabId, navigationGeneration: 1,
        dataUrl: 'data:image/jpeg;base64,YWJj', width: 1000, height: 4000 }))
    }
    const previous = Object.getOwnPropertyDescriptor(window, 'hronaut')
    Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
    const view = render(TabSearchPanel, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { open: true, state: browserState, mcpActivityByTab: {},
        syncState: vi.fn(async () => undefined), selectTab: vi.fn(async () => undefined), expandTabGroup: vi.fn(),
        describeEmulation: () => '', formatNumber: String, formatTime: String,
        formatError: (_cause: unknown, fallback: string) => fallback, showError: vi.fn() }
    })
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Preview Tab beta' }))
      const canvas = document.querySelector<HTMLElement>('.tab-page-preview-canvas')!
      canvas.focus()
      expect(canvas).toHaveFocus()
      await view.rerender({ state: { ...browserState, tabs: browserState.tabs.map((tab) => ({ ...tab, navigationGeneration: 2 })) } })
      expect(screen.getByRole('alert')).toHaveTextContent('The page changed')
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to tabs' })).toHaveFocus())
      browser.getTabOverviewPagePreview.mockResolvedValueOnce({ tabId: 'beta', navigationGeneration: 2,
        dataUrl: 'data:image/jpeg;base64,YWJj', width: 1000, height: 4000 })
      await user.click(screen.getByRole('button', { name: 'Retry preview' }))
      expect(screen.getByRole('img', { name: 'Full-page preview of Tab beta' })).toBeVisible()
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to tabs' })).toHaveFocus())
      const persistentControl = screen.getByRole('radio', { name: 'Fit width' })
      await user.click(persistentControl)
      await view.rerender({ state: { ...browserState, tabs: browserState.tabs.map((tab) => ({ ...tab, navigationGeneration: 3 })) } })
      expect(persistentControl).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.getByRole('searchbox', { name: 'Search tabs' })).toBeVisible()
      expect(view.emitted()['update:open']).toBeUndefined()
    } finally {
      view.unmount()
      if (previous) Object.defineProperty(window, 'hronaut', previous)
      else Reflect.deleteProperty(window, 'hronaut')
    }
  })

  it('moves focus into the modal when only Hronaut Home is available', async () => {
    const browserState = state()
    browserState.tabs = [{
      ...tab('home', true),
      title: 'Hronaut Home',
      url: 'hronaut://home/'
    }]
    browserState.activeTabId = 'home'
    const browser = {
      closeTab: vi.fn(async () => browserState),
      reopenClosedTab: vi.fn(async () => browserState),
      setTabPinned: vi.fn(async () => browserState),
      restoreSavedTabGroup: vi.fn(async () => browserState),
      deleteSavedTabGroup: vi.fn(async () => browserState),
      getTabOverviewPreviews: vi.fn(async () => [])
    }
    const previousHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')
    const previousHronautShell = Object.getOwnPropertyDescriptor(window, 'hronautShell')
    Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
    Object.defineProperty(window, 'hronautShell', {
      configurable: true,
      value: { isWindowFocused: vi.fn(async () => true) }
    })
    const view = render(TabSearchPanel, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: true,
        state: browserState,
        mcpActivityByTab: {},
        syncState: vi.fn(async () => undefined),
        selectTab: vi.fn(async () => undefined),
        expandTabGroup: vi.fn(),
        describeEmulation: () => '',
        formatNumber: String,
        formatTime: String,
        formatError: (_cause: unknown, fallback: string) => fallback,
        showError: vi.fn()
      }
    })

    try {
      const dialog = screen.getByRole('dialog', { name: 'Tabs' })
      await vi.waitFor(() => expect(dialog).toHaveFocus())
      expect(screen.queryByRole('searchbox', { name: 'Search tabs' })).not.toBeInTheDocument()
    } finally {
      view.unmount()
      if (previousHronaut) Object.defineProperty(window, 'hronaut', previousHronaut)
      else Reflect.deleteProperty(window, 'hronaut')
      if (previousHronautShell) Object.defineProperty(window, 'hronautShell', previousHronautShell)
      else Reflect.deleteProperty(window, 'hronautShell')
    }
  })
})
