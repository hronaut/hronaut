import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BookmarksFileActions from '../../src/renderer/src/components/BookmarksFileActions.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BookmarkImportResult, SupportedLocale } from '../../src/shared/types.js'

function renderActions(props: Record<string, unknown> = {}, locale: SupportedLocale = 'en-US') {
  const exportBookmarks = vi.fn(async (): Promise<number | null> => 3)
  const importBookmarks = vi.fn(async (): Promise<BookmarkImportResult | null> => ({ added: 1, alreadySaved: 0, notWebPages: 0, overLimit: 0, limit: 500 }))
  const view = render(BookmarksFileActions, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { count: 3, blocked: false, exportBookmarks, importBookmarks, formatNumber: (value: number) => value.toLocaleString(locale), ...props }
  })
  return { view, exportBookmarks, importBookmarks, user: userEvent.setup() }
}

describe('BookmarksFileActions', () => {
  it('says what an import did, sentence by sentence', async () => {
    const importBookmarks = vi.fn<() => Promise<BookmarkImportResult | null>>()
    const { user } = renderActions({ importBookmarks })
    const button = screen.getByRole('button', { name: 'Import…' })
    const said = async (result: BookmarkImportResult | null) => {
      importBookmarks.mockResolvedValueOnce(result)
      await user.click(button)
      await flushPromises()
      return screen.queryByRole('status')?.textContent ?? null
    }
    expect(await said({ added: 1, alreadySaved: 0, notWebPages: 0, overLimit: 0, limit: 500 })).toBe('Imported 1 bookmark.')
    expect(await said({ added: 12, alreadySaved: 2, notWebPages: 1, overLimit: 3, limit: 500 }))
      .toBe('Imported 12 bookmarks. 2 were already saved. 1 link is not a web page, so it was left out. Hronaut keeps up to 500 bookmarks, so 3 were left out.')
    expect(await said({ added: 0, alreadySaved: 1, notWebPages: 2, overLimit: 0, limit: 500 }))
      .toBe('No new bookmarks were imported. 1 was already saved. 2 links are not web pages, so they were left out.')
    // Cancelling the dialog says nothing.
    expect(await said(null)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says how many it exported, and why it could not', async () => {
    const exportBookmarks = vi.fn<() => Promise<number | null>>().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("Error invoking remote method 'bookmarks:export-file': Error: The bookmarks file could not be saved.")).mockResolvedValueOnce(3)
    const { user } = renderActions({ exportBookmarks })
    const button = screen.getByRole('button', { name: 'Export…' })
    await user.click(button)
    await flushPromises()
    expect(screen.getByRole('status')).toHaveTextContent('Exported 1 bookmark.')
    await user.click(button)
    await flushPromises()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('The bookmarks file could not be saved.')
    // The next try says only what it did.
    await user.click(button)
    await flushPromises()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Exported 3 bookmarks.')
  })

  it('keeps a held Enter that confirmed the dialog from opening it again', () => {
    renderActions()
    for (const name of ['Import…', 'Export…']) {
      const pressed = (repeat: boolean) => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', repeat, bubbles: true, cancelable: true })
        screen.getByRole('button', { name }).dispatchEvent(event)
        return event.defaultPrevented
      }
      expect([pressed(true), pressed(false)]).toEqual([true, false])
    }
  })

  it('opens one dialog at a time, none while another change is under way, and no export without bookmarks', async () => {
    let finish!: (count: number | null) => void
    const exportBookmarks = vi.fn(() => new Promise<number | null>(resolve => { finish = resolve }))
    const { view, importBookmarks, user } = renderActions({ exportBookmarks })
    const exportButton = screen.getByRole('button', { name: 'Export…' })
    const importButton = screen.getByRole('button', { name: 'Import…' })
    await user.click(exportButton)
    // The button keeps the keyboard while the dialog is open, so it is there when the dialog closes.
    expect(exportButton).toHaveFocus()
    expect(exportButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(exportButton)
    await user.click(importButton)
    expect(exportBookmarks).toHaveBeenCalledOnce()
    expect(importBookmarks).not.toHaveBeenCalled()
    finish(3)
    await flushPromises()
    expect(exportButton).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Exported 3 bookmarks.')

    await view.rerender({ blocked: true })
    await user.click(importButton)
    expect(importBookmarks).not.toHaveBeenCalled()
    await view.rerender({ blocked: false, count: 0 })
    expect(exportButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(exportButton)
    expect(exportBookmarks).toHaveBeenCalledOnce()
    await user.click(importButton)
    expect(importBookmarks).toHaveBeenCalledOnce()
  })

  it.each([
    ['ru-RU', 'Импорт…', 3, 'Импортированы 3 закладки.'],
    ['pl-PL', 'Importuj…', 5, 'Zaimportowano 5 zakładek.'],
    ['uk-UA', 'Імпорт…', 21, 'Імпортовано 21 закладку.'],
    ['de-DE', 'Importieren…', 1234, '1.234']
  ] as const)('counts in %s\'s plural forms and digits', async (locale, label, added, said) => {
    const importBookmarks = vi.fn(async () => ({ added, alreadySaved: 0, notWebPages: 0, overLimit: 0, limit: 500 }))
    const { user } = renderActions({ importBookmarks }, locale)
    await user.click(screen.getByRole('button', { name: label }))
    await flushPromises()
    expect(screen.getByRole('status')).toHaveTextContent(said)
  })
})
