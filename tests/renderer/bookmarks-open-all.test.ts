import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BookmarksOpenAll from '../../src/renderer/src/components/BookmarksOpenAll.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserBookmark, SupportedLocale } from '../../src/shared/types.js'

function bookmarks(count: number): BrowserBookmark[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `b${index}`, url: `https://e.example/${index}`, title: `Page ${index}`, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z'
  }))
}

function renderOpenAll(props: Record<string, unknown> = {}, locale: SupportedLocale = 'en-US') {
  const openInBackground = vi.fn(async (_bookmark: BrowserBookmark) => undefined)
  const view = render(BookmarksOpenAll, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { bookmarks: bookmarks(3), blocked: false, openInBackground, formatNumber: (value: number) => value.toLocaleString(locale), ...props }
  })
  return { view, openInBackground, user: userEvent.setup() }
}

const opened = (openInBackground: ReturnType<typeof vi.fn>) => openInBackground.mock.calls.map(([bookmark]) => (bookmark as BrowserBookmark).url)

describe('BookmarksOpenAll', () => {
  it('opens every listed bookmark in a background tab, in the list\'s order, as Chrome\'s Open all', async () => {
    const { openInBackground, user } = renderOpenAll()
    await user.click(screen.getByRole('button', { name: 'Open all (3)' }))
    await flushPromises()
    expect(opened(openInBackground)).toEqual(['https://e.example/0', 'https://e.example/1', 'https://e.example/2'])
    expect(screen.getByRole('status')).toHaveTextContent('Opened 3 tabs.')
  })

  it('asks before opening more than 15 tabs, and opens none when that is cancelled', async () => {
    const { openInBackground, user } = renderOpenAll({ bookmarks: bookmarks(16) })
    const button = screen.getByRole('button', { name: 'Open all (16)' })
    await user.click(button)
    expect(openInBackground).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Open 16 tabs?' })).toBeInTheDocument()
    // The keyboard stays on Open all, so a held Enter cannot answer the question.
    expect(button).toHaveFocus()
    await user.click(button)
    expect(screen.getAllByRole('group')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group')).toBeNull()
    expect(openInBackground).not.toHaveBeenCalled()

    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Open 16 tabs' }))
    await flushPromises()
    expect(openInBackground).toHaveBeenCalledTimes(16)
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Opened 16 tabs.')
  })

  it('opens 15 without asking', async () => {
    const { openInBackground, user } = renderOpenAll({ bookmarks: bookmarks(15) })
    await user.click(screen.getByRole('button', { name: 'Open all (15)' }))
    await flushPromises()
    expect(openInBackground).toHaveBeenCalledTimes(15)
  })

  it('asks no more once the list shows other bookmarks', async () => {
    const { view, openInBackground, user } = renderOpenAll({ bookmarks: bookmarks(20) })
    await user.click(screen.getByRole('button', { name: 'Open all (20)' }))
    expect(screen.getByRole('group', { name: 'Open 20 tabs?' })).toBeInTheDocument()
    await view.rerender({ bookmarks: bookmarks(18) })
    expect(screen.queryByRole('group')).toBeNull()
    await view.rerender({ bookmarks: bookmarks(18).slice().reverse() })
    expect(openInBackground).not.toHaveBeenCalled()
  })

  it('stops at the first tab that cannot open and says how many did', async () => {
    const openInBackground = vi.fn(async (_bookmark: BrowserBookmark) => undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Error invoking remote method 'browser:new-tab': Error: Tab limit reached (50)"))
    const { user } = renderOpenAll({ bookmarks: bookmarks(5), openInBackground })
    await user.click(screen.getByRole('button', { name: 'Open all (5)' }))
    await flushPromises()
    expect(openInBackground).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('status')).toHaveTextContent('Opened 2 tabs.')
    expect(screen.getByRole('alert')).toHaveTextContent('Tab limit reached (50)')
  })

  it('opens nothing while it opens or while another bookmark change is under way', async () => {
    let finish!: () => void
    const openInBackground = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const { view, user } = renderOpenAll({ bookmarks: bookmarks(2), openInBackground })
    const button = screen.getByRole('button', { name: 'Open all (2)' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(openInBackground).toHaveBeenCalledOnce()
    finish()
    await flushPromises()
    finish()
    await flushPromises()
    expect(openInBackground).toHaveBeenCalledTimes(2)
    expect(button).toHaveAttribute('aria-disabled', 'false')

    await view.rerender({ blocked: true })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(openInBackground).toHaveBeenCalledTimes(2)
  })

  it('keeps a held Enter from opening them again', () => {
    renderOpenAll()
    const event = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    screen.getByRole('button', { name: 'Open all (3)' }).dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it.each([
    ['ru-RU', 21, 'Открыть все (21)', 'Открыть 21 вкладку?', 'Открыта 21 вкладка.'],
    ['pl-PL', 22, 'Otwórz wszystkie (22)', 'Otworzyć 22 karty?', 'Otwarto 22 karty.'],
    ['uk-UA', 25, 'Відкрити всі (25)', 'Відкрити 25 вкладок?', 'Відкрито 25 вкладок.'],
    ['de-DE', 1200, 'Alle öffnen (1.200)', '1.200 Tabs öffnen?', '1.200 Tabs geöffnet.']
  ] as const)('counts in %s\'s plural forms and digits', async (locale, count, button, ask, said) => {
    const { user } = renderOpenAll({ bookmarks: bookmarks(count) }, locale)
    await user.click(screen.getByRole('button', { name: button }))
    expect(screen.getByRole('group', { name: ask })).toBeInTheDocument()
    await user.click(screen.getByRole('group').querySelector('button')!)
    await flushPromises()
    expect(screen.getByRole('status')).toHaveTextContent(said)
  })
})
