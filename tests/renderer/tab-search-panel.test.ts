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
      expect(search).toHaveAttribute('role', 'searchbox')
      expect(search).toHaveAttribute('aria-activedescendant', 'tab-search-open-beta')
      expect(screen.getByRole('list', { name: /Other tabs/ })).toBeVisible()
      expect(document.querySelector('.tab-overview-current')).toHaveTextContent('Current tab')
      await vi.waitFor(() => expect(document.querySelector('.tab-overview-preview > img')).toHaveAttribute('src', 'data:image/jpeg;base64,cHJldmlldw=='))
      await userEvent.setup().type(search, 'alpha')
      expect(search).toHaveAttribute('aria-activedescendant', 'tab-search-open-alpha')
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
