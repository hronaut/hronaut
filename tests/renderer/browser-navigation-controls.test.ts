import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function renderControls(activeTab: BrowserTabState | null = tab(), currentBookmark = false, commands?: string,
  listHistory = vi.fn(async () => true)) {
  const view = render(BrowserNavigationControls, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      activeTab: activeTab ?? undefined,
      zoomOpen: false,
      bookmarksOpen: false,
      currentBookmark,
      formatPercent: (value: number) => `${value}%`,
      listHistory
    },
    slots: { default: '<div data-testid="address-slot">Address</div>', ...(commands ? { commands } : {}) }
  })
  return Object.assign(view, { listHistory })
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

  describe('the list of pages an arrow goes through, as in Chrome', () => {
    afterEach(() => { vi.useRealTimers() })

    function placed(name: string): HTMLElement {
      const button = screen.getByRole('button', { name })
      button.getBoundingClientRect = () => ({ left: 12, top: 40, right: 44, bottom: 72, width: 32, height: 32, x: 12, y: 40, toJSON: () => ({}) })
      return button
    }

    const press = (button: HTMLElement, options: PointerEventInit = {}): void => {
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, button: 0, ...options }))
    }

    it('opens below the arrow when it is right-clicked, and does not go there', async () => {
      const view = renderControls(tab({ canGoForward: true }))

      await fireEvent.contextMenu(placed('Back'))
      await fireEvent.contextMenu(placed('Forward'))

      expect(view.listHistory.mock.calls).toEqual([['back', { x: 12, y: 72 }], ['forward', { x: 12, y: 72 }]])
      expect(view.emitted().back).toBeUndefined()
      expect(view.emitted().forward).toBeUndefined()
    })

    it('opens when the arrow is held, and the release does not also go back', async () => {
      vi.useFakeTimers()
      const view = renderControls()
      const back = placed('Back')

      press(back)
      vi.advanceTimersByTime(499)
      expect(view.listHistory).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(view.listHistory.mock.calls).toEqual([['back', { x: 12, y: 72 }]])
      await fireEvent.pointerUp(back)
      await fireEvent.click(back, { detail: 1 })
      expect(view.emitted().back).toBeUndefined()

      // The next click goes back as usual.
      press(back)
      await fireEvent.pointerUp(back)
      await fireEvent.click(back, { detail: 1 })
      expect(view.emitted().back).toHaveLength(1)
      expect(view.listHistory).toHaveBeenCalledOnce()
    })

    it('goes back for a click that ends a press shorter than a hold, or one the pointer leaves', async () => {
      vi.useFakeTimers()
      const view = renderControls()
      const back = placed('Back')

      press(back)
      vi.advanceTimersByTime(300)
      await fireEvent.pointerUp(back)
      await fireEvent.click(back, { detail: 1 })
      press(back)
      await fireEvent.pointerLeave(back)
      vi.advanceTimersByTime(1_000)
      press(back, { button: 2 })
      vi.advanceTimersByTime(1_000)

      expect(view.emitted().back).toHaveLength(1)
      expect(view.listHistory).not.toHaveBeenCalled()
    })

    it('goes back for the next click after a hold whose release the list took', async () => {
      vi.useFakeTimers()
      const view = renderControls()
      const back = placed('Back')

      press(back)
      vi.advanceTimersByTime(500)
      // The native list took the release, so neither pointerup nor click reached the arrow.
      press(back)
      await fireEvent.pointerUp(back)
      await fireEvent.click(back, { detail: 1 })

      expect(view.listHistory).toHaveBeenCalledOnce()
      expect(view.emitted().back).toHaveLength(1)
    })

    it('goes back when a hold finds no list to show, as for a tab that is waking', async () => {
      vi.useFakeTimers()
      const view = renderControls(tab(), false, undefined, vi.fn(async () => false))
      const back = placed('Back')

      press(back)
      vi.advanceTimersByTime(500)
      await vi.waitFor(() => expect(view.listHistory).toHaveBeenCalledOnce())
      await Promise.resolve()
      await fireEvent.pointerUp(back)
      await fireEvent.click(back, { detail: 1 })

      expect(view.emitted().back).toHaveLength(1)
    })

    it('opens once for a long touch, whose press also asks for a context menu', async () => {
      vi.useFakeTimers()
      const view = renderControls()
      const back = placed('Back')

      press(back, { pointerType: 'touch' })
      vi.advanceTimersByTime(500)
      back.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' }))

      expect(view.listHistory).toHaveBeenCalledOnce()
    })

    it('goes back for a key after a hold whose release the list took', async () => {
      vi.useFakeTimers()
      const view = renderControls()
      const back = placed('Back')

      press(back)
      vi.advanceTimersByTime(500)
      // The native list took the release, so no click followed; Enter on the arrow then makes a click with no pointer.
      await fireEvent.click(back, { detail: 0 })

      expect(view.listHistory).toHaveBeenCalledOnce()
      expect(view.emitted().back).toHaveLength(1)
    })

    it('tells how to list the pages in the arrows\' tooltips, and keeps their names', () => {
      renderControls(tab({ canGoForward: true }))

      expect(screen.getByRole('button', { name: 'Back' }))
        .toHaveAttribute('data-tooltip', 'Click to go back, right-click or hold to see history')
      expect(screen.getByRole('button', { name: 'Forward' }))
        .toHaveAttribute('data-tooltip', 'Click to go forward, right-click or hold to see history')
    })
  })

  it('disables every page-specific action when no tab is available', () => {
    renderControls(null)

    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Find in page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Page zoom controls, \d+%$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bookmarks' })).toBeDisabled()
  })
})
