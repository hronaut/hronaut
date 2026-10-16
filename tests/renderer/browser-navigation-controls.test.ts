import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import BrowserNavigationControls from '../../src/renderer/src/components/BrowserNavigationControls.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState } from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    loading: false,
    navigationGeneration: 0,
    canGoBack: true,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 125,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function renderControls(activeTab: BrowserTabState | null = tab(), currentBookmark = false, commands?: string) {
  return render(BrowserNavigationControls, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      activeTab: activeTab ?? undefined,
      zoomOpen: false,
      bookmarksOpen: false,
      currentBookmark,
      formatPercent: (value: number) => `${value}%`
    },
    slots: { default: '<div data-testid="address-slot">Address</div>', ...(commands ? { commands } : {}) }
  })
}

describe('BrowserNavigationControls', () => {
  it('delegates navigation and keeps the address control in order', async () => {
    const view = renderControls()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await user.click(screen.getByRole('button', { name: 'Find in page' }))
    await user.click(screen.getByRole('button', { name: /^Page zoom controls, \d+%$/ }))
    await user.click(screen.getByRole('button', { name: 'Bookmarks' }))

    expect(view.emitted().back).toHaveLength(1)
    expect(view.emitted().reload).toHaveLength(1)
    expect(view.emitted().find).toHaveLength(1)
    expect(view.emitted().toggleZoom).toHaveLength(1)
    expect(view.emitted().toggleBookmarks).toHaveLength(1)
    expect(screen.getByTestId('address-slot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('keeps find, zoom, bookmarks and the page commands in one group after the address', () => {
    const view = renderControls(tab(), false, '<button type="button" data-testid="page-command">Page tools</button>')
    const commands = view.container.querySelector('.toolbar-commands')!
    const children = [...view.container.children]

    // The group wraps as one band, so no command is left beside the address on a narrow toolbar.
    expect(children.map((child) => child.getAttribute('aria-label') ?? child.className)).toEqual([
      'Back', 'Forward', 'Reload', '', 'toolbar-commands'
    ])
    expect(children[3]).toBe(screen.getByTestId('address-slot'))
    expect([...commands.children].map((child) => child.getAttribute('aria-label') ?? child.textContent)).toEqual([
      'Find in page', 'Page zoom controls, 125%', 'Bookmarks', 'Page tools'
    ])
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveClass('reload-button')
  })

  it('switches reload to stop while loading and exposes bookmark state', async () => {
    const view = renderControls(tab({ loading: true }), true)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }))

    expect(view.emitted().stop).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Bookmarks' })).toHaveClass('bookmarked')
  })

  it('disables every page-specific action when no tab is available', () => {
    renderControls(null)

    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Find in page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Page zoom controls, \d+%$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bookmarks' })).toBeDisabled()
  })
})
