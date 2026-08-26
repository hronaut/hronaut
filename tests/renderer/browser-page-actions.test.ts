import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BrowserPageActions from '../../src/renderer/src/components/BrowserPageActions.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
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

function state(activeTab = tab()): BrowserState {
  return {
    tabs: [activeTab],
    closedTabs: [],
    activeTabId: activeTab.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/tmp/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function renderActions(
  areaCaptureState: 'idle' | 'picking' | 'capturing' | 'copied' | 'error' = 'idle',
  activeTab = tab()
) {
  return render(BrowserPageActions, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      state: state(activeTab),
      activeTab,
      browser: {
        openSplitView: vi.fn(),
        updateSplitView: vi.fn(),
        closeSplitView: vi.fn()
      },
      acceptState: vi.fn(),
      closeOtherMenus: vi.fn(),
      effectiveHumanInteractionLocked: false,
      tabHumanInteractionLocked: false,
      tabInteractionLockLabel: 'Lock page input in this tab',
      areaCaptureState,
      areaCaptureLabel: 'Capture page area',
      elementPickerState: 'idle',
      elementPickerTitle: 'Pick a page element',
      elementPickerLabel: 'Pick element for agent context',
      pageToolsOpen: false,
      splitMenuOpen: false
    }
  })
}

describe('BrowserPageActions', () => {
  it('delegates the website toolbar actions with accessible controls', async () => {
    const view = renderActions()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Lock page input in this tab' }))
    await user.click(screen.getByRole('button', { name: 'Capture page area' }))
    await user.click(screen.getByRole('button', { name: 'Pick element for agent context' }))
    await user.click(screen.getByRole('button', { name: 'Page tools' }))

    expect(view.emitted().toggleTabInteraction).toHaveLength(1)
    expect(view.emitted().toggleAreaCapture).toHaveLength(1)
    expect(view.emitted().toggleElementPicker).toHaveLength(1)
    expect(view.emitted().togglePageTools).toHaveLength(1)
  })

  it('blocks native picker work while a page screenshot is capturing', () => {
    renderActions('capturing')

    expect(screen.getByRole('button', { name: 'Capture page area' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pick element for agent context' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Page tools' })).toBeEnabled()
  })

  it('disables page-specific controls for an internal application tab', () => {
    renderActions('idle', tab({ url: 'hronaut://home/' }))

    expect(screen.getByRole('button', { name: 'Lock page input in this tab' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Capture page area' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pick element for agent context' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Page tools' })).toBeDisabled()
  })
})
