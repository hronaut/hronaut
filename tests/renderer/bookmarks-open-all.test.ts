import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, toRef, type PropType } from 'vue'
import BookmarksOpenAll from '../../src/renderer/src/components/BookmarksOpenAll.vue'
import { useBookmarksOpenAll } from '../../src/renderer/src/composables/useBookmarksOpenAll.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserBookmark, SupportedLocale } from '../../src/shared/types.js'

function bookmarks(count: number, path = ''): BrowserBookmark[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `b${index}`, url: `https://e.example/${path}${index}`, title: `Page ${index}`, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z'
  }))
}

type Open = (bookmark: BrowserBookmark) => Promise<void>

// As the Bookmarks panel holds it: the run belongs to the panel, and counts as one of its pending changes.
const Panel = defineComponent({
  props: {
    bookmarks: { type: Array as PropType<BrowserBookmark[]>, required: true },
    blocked: { type: Boolean, default: false },
    open: { type: Boolean, default: true },
    openInBackground: { type: Function as PropType<Open>, required: true },
    formatNumber: { type: Function as PropType<(value: number) => string>, required: true }
  },
  setup(props) {
    const controller = useBookmarksOpenAll({
      bookmarks: toRef(props, 'bookmarks'),
      open: toRef(props, 'open'),
      blocked: toRef(props, 'blocked'),
      openInBackground: bookmark => props.openInBackground(bookmark),
      translate: key => key
    })
    const blocked = computed(() => props.blocked || controller.pending.value)
    return () => props.open
      ? h(BookmarksOpenAll, { controller, count: props.bookmarks.length, blocked: blocked.value, formatNumber: props.formatNumber })
      : null
  }
})

function renderOpenAll(props: Record<string, unknown> = {}, locale: SupportedLocale = 'en-US') {
  const openInBackground = vi.fn<Open>(async () => undefined)
  const view = render(Panel, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { bookmarks: bookmarks(3), openInBackground, formatNumber: (value: number) => value.toLocaleString(locale), ...props }
  })
  return { view, openInBackground, user: userEvent.setup() }
}

const opened = (openInBackground: { mock: { calls: [BrowserBookmark][] } }) => openInBackground.mock.calls.map(([bookmark]) => bookmark.url)

describe('BookmarksOpenAll', () => {
  it('opens every listed bookmark in a background tab, in the list\'s order, as Chrome\'s Open all', async () => {
    const { openInBackground, user } = renderOpenAll()
    await user.click(screen.getByRole('button', { name: 'Open all (3)' }))
    await flushPromises()
    expect(opened(openInBackground)).toEqual(['https://e.example/0', 'https://e.example/1', 'https://e.example/2'])
    expect(screen.getByRole('status')).toHaveTextContent('Opened 3 tabs.')
  })

  it('opens 14 at once and asks first from 15, as Chrome does', async () => {
    const { view, openInBackground, user } = renderOpenAll({ bookmarks: bookmarks(14) })
    await user.click(screen.getByRole('button', { name: 'Open all (14)' }))
    await flushPromises()
    expect(openInBackground).toHaveBeenCalledTimes(14)
    expect(screen.queryByRole('group')).toBeNull()
    await view.rerender({ bookmarks: bookmarks(15, 'more/') })
    await user.click(screen.getByRole('button', { name: 'Open all (15)' }))
    expect(screen.getByRole('group', { name: 'Open 15 tabs?' })).toBeInTheDocument()
    expect(openInBackground).toHaveBeenCalledTimes(14)
  })

  it('takes the keyboard to Cancel while it asks, and back to Open all once answered', async () => {
    const { openInBackground, user } = renderOpenAll({ bookmarks: bookmarks(16) })
    const button = screen.getByRole('button', { name: 'Open all (16)' })
    await user.click(button)
    const question = screen.getByRole('group', { name: 'Open 16 tabs?' })
    await flushPromises()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // Asking again asks nothing more.
    await user.click(button)
    expect(screen.getAllByRole('group')).toEqual([question])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await flushPromises()
    expect(screen.queryByRole('group')).toBeNull()
    expect(button).toHaveFocus()
    expect(openInBackground).not.toHaveBeenCalled()

    await user.click(button)
    await flushPromises()
    await user.click(screen.getByRole('button', { name: 'Open 16 tabs' }))
    await flushPromises()
    expect(openInBackground).toHaveBeenCalledTimes(16)
    expect(button).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Opened 16 tabs.')
  })

  it.each([
    ['in another order', (list: BrowserBookmark[]) => list.slice().reverse()],
    ['with another address for one of them', (list: BrowserBookmark[]) => list.map((bookmark, index) => index === 3 ? { ...bookmark, url: 'https://moved.example/' } : bookmark)],
    ['with one fewer', (list: BrowserBookmark[]) => list.slice(1)]
  ])('asks no more once the list shows its bookmarks %s', async (_change, change) => {
    const list = bookmarks(20)
    const { view, openInBackground, user } = renderOpenAll({ bookmarks: list })
    await user.click(screen.getByRole('button', { name: 'Open all (20)' }))
    const confirm = screen.getByRole('button', { name: 'Open 20 tabs' })
    await view.rerender({ bookmarks: change(list) })
    expect(screen.queryByRole('group')).toBeNull()
    await user.click(confirm)
    expect(openInBackground).not.toHaveBeenCalled()
  })

  it('stops at the first tab that cannot open and says how many did', async () => {
    const openInBackground = vi.fn<Open>(async () => undefined)
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

  it('opens nothing more while it opens or while another bookmark change is under way', async () => {
    let finish!: () => void
    const openInBackground = vi.fn<Open>(() => new Promise<void>(resolve => { finish = resolve }))
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

  it('keeps opening when the panel closes, and neither asks again nor opens twice once it reopens', async () => {
    const finishes: (() => void)[] = []
    const openInBackground = vi.fn<Open>(() => new Promise<void>(resolve => { finishes.push(resolve) }))
    const { view, user } = renderOpenAll({ bookmarks: bookmarks(3), openInBackground })
    await user.click(screen.getByRole('button', { name: 'Open all (3)' }))
    await view.rerender({ open: false })
    finishes.shift()!()
    await flushPromises()
    await view.rerender({ open: true })
    const button = screen.getByRole('button', { name: 'Open all (3)' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    while (finishes.length) {
      finishes.shift()!()
      await flushPromises()
    }
    expect(openInBackground).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('status')).toHaveTextContent('Opened 3 tabs.')
  })

  it('drops its question when the panel closes', async () => {
    const { view, user } = renderOpenAll({ bookmarks: bookmarks(15) })
    await user.click(screen.getByRole('button', { name: 'Open all (15)' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('keeps a held Enter from pressing any of its buttons again', async () => {
    const { user } = renderOpenAll({ bookmarks: bookmarks(15) })
    await user.click(screen.getByRole('button', { name: 'Open all (15)' }))
    for (const name of ['Open all (15)', 'Open 15 tabs', 'Cancel']) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
      screen.getByRole('button', { name }).dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it.each([
    ['ru-RU', 21, 'Открыть все (21)', 'Открыть 21 вкладку?', 'Открыть 21 вкладку', 'Открыта 21 вкладка.'],
    ['pl-PL', 22, 'Otwórz wszystkie (22)', 'Otworzyć 22 karty?', 'Otwórz 22 karty', 'Otwarto 22 karty.'],
    ['uk-UA', 25, 'Відкрити всі (25)', 'Відкрити 25 вкладок?', 'Відкрити 25 вкладок', 'Відкрито 25 вкладок.'],
    ['de-DE', 1200, 'Alle öffnen (1.200)', '1.200 Tabs öffnen?', '1.200 Tabs öffnen', '1.200 Tabs geöffnet.']
  ] as const)('counts in %s\'s plural forms and digits', async (locale, count, button, ask, confirm, said) => {
    const { user } = renderOpenAll({ bookmarks: bookmarks(count) }, locale)
    await user.click(screen.getByRole('button', { name: button }))
    expect(screen.getByRole('group', { name: ask })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: confirm }))
    await flushPromises()
    expect(screen.getByRole('status')).toHaveTextContent(said)
  })
})
