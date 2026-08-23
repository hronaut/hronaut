import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TabSearchPanel from '../../src/renderer/src/components/TabSearchPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, active = false): BrowserTabState {
  return {
    id,
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
      deleteSavedTabGroup: vi.fn(async () => browserState)
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
      await userEvent.setup().type(search, 'alpha')
      expect(screen.getByText('Tab alpha').closest('.tab-search-item')).toHaveClass('selected')
      await userEvent.setup().keyboard('{Enter}')
      await vi.waitFor(() => expect(selectTab).toHaveBeenCalledWith('alpha'))
      expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    } finally {
      view.unmount()
      if (previousHronaut) Object.defineProperty(window, 'hronaut', previousHronaut)
      else Reflect.deleteProperty(window, 'hronaut')
    }
  })
})
