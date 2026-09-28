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
    navigationGeneration: 0,
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
  it('presents independent tab controls with consistent action labels', async () => {
    const view = renderActions()
    const group = screen.getByRole('group', { name: 'Tab controls' })
    expect(group.querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Pause agents for this tab' })).toHaveTextContent('Pause agents')
    expect(screen.getByRole('button', { name: 'Lock page input in this tab' })).toHaveTextContent('Lock input')
    expect(screen.getByRole('button', { name: 'Mute Tab' })).toHaveTextContent('Mute')
    await view.rerender({
      activeTab: tab({ agentPaused: true, muted: true }),
      tabHumanInteractionLocked: true,
      effectiveHumanInteractionLocked: true,
      tabInteractionLockLabel: 'Unlock page input in this tab'
    })
    expect(screen.getByRole('button', { name: 'Resume agents for this tab' })).toHaveTextContent('Resume agents')
    expect(screen.getByRole('button', { name: 'Unlock page input in this tab' })).toHaveTextContent('Unlock input')
    expect(screen.getByRole('button', { name: 'Unmute Tab' })).toHaveTextContent('Unmute')
    expect(screen.getByRole('button', { name: 'Freeze this live page for deterministic review' })).toHaveTextContent('Live')
  })

  it('mutes a silent tab and reflects the authoritative state when switching tabs', async () => {
    const activeTab = tab()
    const view = renderActions('idle', activeTab)
    const mute = screen.getByRole('button', { name: 'Mute Tab' })
    expect(mute).toHaveAttribute('title', 'Mute Example')
    expect(mute).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(mute)
    expect(view.emitted().toggleTabMuted).toEqual([[activeTab]])
    await view.rerender({ activeTab: tab({ id: 'tab-2', title: 'Music', muted: true }) })
    const unmute = screen.getByRole('button', { name: 'Unmute Tab' })
    expect(unmute).toHaveAttribute('title', 'Unmute Music')
    expect(unmute).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(unmute)
    expect(view.emitted().toggleTabMuted?.[1]).toEqual([expect.objectContaining({ id: 'tab-2', muted: true })])
  })

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

  it('keeps agent pause separate from Live/Frozen and disables protected overrides', async () => {
    const activeTab = tab({ agentPaused: true, pageLifecycleState: 'active' })
    const view = renderActions('idle', activeTab)
    await userEvent.click(screen.getByRole('button', { name: 'Resume agents for this tab' }))
    expect(view.emitted().toggleTabAgentPaused).toEqual([[activeTab]])
    expect(view.emitted().togglePageLifecycle).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Freeze this live page for deterministic review' })).toBeEnabled()
    await view.rerender({ state: { ...state(activeTab), agentControlLocked: true } })
    expect(screen.getByRole('button', { name: 'Resume agents for this tab' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Freeze this live page for deterministic review' })).toBeEnabled()
  })

  it('exposes the authoritative page lifecycle without silently retrying an unknown hold', async () => {
    const activeTab = tab({ pageLifecycleState: 'active' })
    const view = renderActions('idle', activeTab)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Freeze this live page for deterministic review' }))
    expect(view.emitted().togglePageLifecycle).toEqual([[activeTab]])

    await view.rerender({ activeTab: tab({ pageLifecycleState: 'frozen' }) })
    const resume = screen.getByRole('button', { name: 'Resume this frozen page' })
    expect(resume).toHaveAttribute('aria-pressed', 'true')

    await view.rerender({ activeTab: tab({ pageLifecycleState: 'unknown' }) })
    expect(screen.getByRole('button', { name: /Page hold outcome is unknown/ })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Freeze this live page for deterministic review' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Capture page area' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pick element for agent context' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Page tools' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mute Tab' })).toBeDisabled()
  })
})
