import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BookmarksPanel from '../../src/renderer/src/components/BookmarksPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserBookmark } from '../../src/shared/types.js'

function bookmark(id: string, title = `Page ${id}`): BrowserBookmark {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    createdAt: '2026-08-22T09:00:00.000Z',
    updatedAt: '2026-08-22T09:00:00.000Z'
  }
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(BookmarksPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      bookmarks: [bookmark('alpha', 'Alpha docs'), bookmark('beta', 'Beta page')],
      dock: 'right',
      activeUrl: 'https://example.test/alpha',
      activeTitle: 'Alpha docs',
      currentBookmark: bookmark('alpha', 'Alpha docs'),
      listBookmarks: vi.fn(async () => []),
      addBookmark: vi.fn(async () => []),
      updateBookmarkDestination: vi.fn(async () => []),
      renameBookmark: vi.fn(async () => []),
      removeBookmark: vi.fn(async () => []),
      openBookmarkInBackground: vi.fn(async () => undefined),
      openBookmark: vi.fn(async () => undefined),
      ...overrides
    }
  })
}

describe('BookmarksPanel', () => {
  it('explicitly opens a bookmark in the background and retains panel, search and keyboard focus', async () => {
    const openBookmarkInBackground = vi.fn(async () => undefined)
    const openBookmark = vi.fn(async () => undefined)
    renderPanel({ openBookmarkInBackground, openBookmark })
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Alpha')
    const button = screen.getByRole('button', { name: 'Open Alpha docs in background tab' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(openBookmarkInBackground).toHaveBeenCalledWith(bookmark('alpha', 'Alpha docs'))
    expect(openBookmark).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(search).toHaveValue('Alpha')
    expect(button).toHaveFocus()
  })

  it.each(['{Escape}', '{Enter}', 'Save'])('returns focus to address editing after %s', async key => {
    const original = bookmark('alpha', 'Alpha docs')
    const updateBookmarkDestination = vi.fn(async () => [{ ...original, url: 'https://example.test/new' }])
    renderPanel({ bookmarks: [original], updateBookmarkDestination })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit address for Alpha docs' }))
    const input = screen.getByRole('textbox', { name: 'Edit address for Alpha docs' })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'https://example.test/new')
    if (key === 'Save') await user.click(screen.getByRole('button', { name: 'Save address for Alpha docs' }))
    else await user.keyboard(key)
    expect(screen.getByRole('button', { name: 'Edit address for Alpha docs' })).toHaveFocus()
    expect(updateBookmarkDestination).toHaveBeenCalledTimes(key === '{Escape}' ? 0 : 1)
    if (key !== '{Escape}') expect(updateBookmarkDestination).toHaveBeenCalledWith('alpha', 'https://example.test/new')
  })

  it('focuses search when the saved destination leaves the filtered list', async () => {
    const original = bookmark('alpha', 'Alpha docs')
    renderPanel({ bookmarks: [original], updateBookmarkDestination: vi.fn(async () => [{ ...original, url: 'https://elsewhere.test/new' }]) })
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'example.test')
    await user.click(screen.getByRole('button', { name: 'Edit address for Alpha docs' }))
    const input = screen.getByRole('textbox', { name: 'Edit address for Alpha docs' })
    await user.clear(input)
    await user.type(input, 'https://elsewhere.test/new{Enter}')
    expect(screen.getByText('No matching bookmarks')).toBeInTheDocument()
    expect(search).toHaveFocus()
  })

  it('preserves newer focus during a destination save and a draft after failure', async () => {
    let reject!: (error: Error) => void
    const updateBookmarkDestination = vi.fn(() => new Promise<BrowserBookmark[]>((_resolve, fail) => { reject = fail }))
    renderPanel({ updateBookmarkDestination })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit address for Alpha docs' }))
    const input = screen.getByRole('textbox', { name: 'Edit address for Alpha docs' })
    await user.clear(input)
    await user.type(input, 'https://example.test/new{Enter}')
    const search = screen.getByRole('searchbox')
    await user.click(search)
    reject(new Error('Destination already exists'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Destination already exists')
    expect(input).toHaveValue('https://example.test/new')
    expect(search).toHaveFocus()
  })

  it.each(['first', 'last', 'filtered', 'only'])('preserves keyboard access after removing the %s bookmark', async scenario => {
    const alpha = bookmark('alpha', 'Alpha docs')
    const beta = bookmark('beta', 'Beta page')
    const removed = scenario === 'last' ? beta : alpha
    const remaining = scenario === 'only' ? [] : [scenario === 'last' ? alpha : beta]
    const removeBookmark = vi.fn(async () => remaining)
    renderPanel({ bookmarks: scenario === 'only' ? [alpha] : [alpha, beta], removeBookmark })
    const user = userEvent.setup()
    if (scenario === 'filtered') await user.type(screen.getByRole('searchbox'), 'Alpha')
    const button = screen.getByRole('button', { name: `Remove ${removed.title}` })
    button.focus()
    await user.keyboard('{Enter}')

    expect(removeBookmark).toHaveBeenCalledWith(removed.id)
    expect(screen.queryByRole('button', { name: `Remove ${removed.title}` })).not.toBeInTheDocument()
    const destination = scenario === 'only'
      ? screen.getByRole('button', { name: 'Close bookmarks' })
      : scenario === 'filtered'
        ? screen.getByRole('searchbox')
        : screen.getByRole('button', { name: `Remove ${remaining[0].title}` })
    expect(destination).toHaveFocus()
  })

  it('renders the rename editor outside interactive buttons and focuses it', async () => {
    renderPanel()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    const editor = screen.getByRole('textbox', { name: 'Rename Alpha docs' })

    expect(editor).toHaveFocus()
    expect(editor.closest('button')).toBeNull()
    expect(screen.queryByTitle('https://example.test/alpha')).not.toBeInTheDocument()
  })

  it('preserves newer focus while bookmark removal is pending', async () => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    renderPanel({ removeBookmark: vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Alpha docs' }))
    const search = screen.getByRole('searchbox')
    await user.click(search)
    finish([bookmark('beta', 'Beta page')])
    await flushPromises()
    expect(search).toHaveFocus()
  })

  it('does not restore removal focus into a reopened panel', async () => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    const view = renderPanel({ removeBookmark: vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Alpha docs' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true, bookmarks: [bookmark('beta', 'Beta page')] })
    finish([bookmark('beta', 'Beta page')])
    await flushPromises()
    expect(document.body).toHaveFocus()
  })

  it('keeps the removal control reachable after a failed removal', async () => {
    renderPanel({ removeBookmark: vi.fn(async () => { throw new Error('Removal failed') }) })
    const user = userEvent.setup()
    const remove = screen.getByRole('button', { name: 'Remove Alpha docs' })
    await user.click(remove)
    expect(await screen.findByRole('alert')).toHaveTextContent('Removal failed')
    expect(remove).toHaveFocus()
  })

  it.each(['{Escape}', '{Enter}', 'Save'])('returns keyboard focus to Rename after %s', async key => {
    const renameBookmark = vi.fn(async () => [bookmark('alpha', 'Alpha docs')])
    renderPanel({ bookmarks: [bookmark('alpha', 'Alpha docs')], renameBookmark })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    if (key === 'Save') await user.click(screen.getByRole('button', { name: 'Save name for Alpha docs' }))
    else await user.keyboard(key)

    expect(screen.queryByRole('textbox', { name: 'Rename Alpha docs' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Alpha docs' })).toHaveFocus()
    expect(renameBookmark).toHaveBeenCalledTimes(key === '{Escape}' ? 0 : 1)
  })

  it('preserves focus moved elsewhere while a rename is saving', async () => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    const renameBookmark = vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve }))
    renderPanel({ bookmarks: [bookmark('alpha', 'Alpha docs')], renameBookmark })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    await user.keyboard('{Enter}')
    const search = screen.getByRole('searchbox')
    await user.click(search)
    finish([bookmark('alpha', 'Alpha docs')])

    await screen.findByRole('button', { name: 'Rename Alpha docs' })
    expect(search).toHaveFocus()
  })

  it.each(['{Enter}', 'Save'])('focuses search when %s saves a rename that no longer matches', async key => {
    const renameBookmark = vi.fn(async () => [bookmark('alpha', 'Updated title')])
    renderPanel({ bookmarks: [bookmark('alpha', 'Original title')], renameBookmark })
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Original')
    await user.click(screen.getByRole('button', { name: 'Rename Original title' }))
    const editor = screen.getByRole('textbox', { name: 'Rename Original title' })
    await user.clear(editor)
    await user.type(editor, 'Updated title')
    if (key === 'Save') await user.click(screen.getByRole('button', { name: 'Save name for Original title' }))
    else await user.keyboard(key)

    expect(screen.getByText('No matching bookmarks')).toBeVisible()
    expect(search).toHaveValue('Original')
    expect(search).toHaveFocus()
    expect(renameBookmark).toHaveBeenCalledWith('alpha', 'Updated title')
    await user.clear(search)
    expect(screen.getByRole('button', { name: 'Rename Updated title' })).toBeVisible()
  })

  it('preserves another control focus when the saved row leaves the search results', async () => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    const renameBookmark = vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve }))
    renderPanel({ bookmarks: [bookmark('alpha', 'Original title')], renameBookmark })
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'Original')
    await user.click(screen.getByRole('button', { name: 'Rename Original title' }))
    await user.keyboard('{Enter}')
    const dock = screen.getByRole('combobox', { name: 'Dock Bookmarks' })
    dock.focus()
    finish([bookmark('alpha', 'Updated title')])

    expect(await screen.findByText('No matching bookmarks')).toBeVisible()
    expect(dock).toHaveFocus()
  })

  it('does not restore focus into a panel reopened while a rename is saving', async () => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    const renameBookmark = vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve }))
    const view = renderPanel({ bookmarks: [bookmark('alpha', 'Original title')], renameBookmark })
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'Original')
    await user.click(screen.getByRole('button', { name: 'Rename Original title' }))
    await user.keyboard('{Enter}')
    await view.rerender({ open: false })
    await view.rerender({ open: true, bookmarks: [bookmark('alpha', 'Updated title')] })
    finish([bookmark('alpha', 'Updated title')])
    await flushPromises()

    expect(screen.getByText('No matching bookmarks')).toBeVisible()
    expect(document.body).toHaveFocus()
  })

  it('keeps a failed rename editable and allows retrying the same draft', async () => {
    const renameBookmark = vi.fn()
      .mockRejectedValueOnce(new Error('Could not rename bookmark'))
      .mockResolvedValueOnce([bookmark('alpha', 'Corrected title')])
    renderPanel({ bookmarks: [bookmark('alpha', 'Alpha docs')], renameBookmark })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    const editor = screen.getByRole('textbox', { name: 'Rename Alpha docs' })
    await user.clear(editor)
    await user.type(editor, 'Corrected title{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename bookmark')
    expect(editor).toHaveValue('Corrected title')
    await user.type(editor, '{Enter}')

    expect(renameBookmark).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Corrected title')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not save or cancel a rename when IME composition owns Enter or Escape', async () => {
    const renameBookmark = vi.fn(async () => [bookmark('alpha', 'Composed title')])
    renderPanel({ bookmarks: [bookmark('alpha', 'Alpha docs')], renameBookmark })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    const editor = screen.getByRole('textbox', { name: 'Rename Alpha docs' })
    await fireEvent.update(editor, 'Composed title')

    await fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    await fireEvent.keyDown(editor, { key: 'Escape', isComposing: true })

    expect(renameBookmark).not.toHaveBeenCalled()
    expect(editor).toHaveValue('Composed title')
    expect(editor).toBeVisible()
  })

  it('emits dock changes and resets editing after the panel is closed', async () => {
    const view = renderPanel()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock Bookmarks' }), 'bottom')
    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    await user.click(screen.getByRole('button', { name: 'Close bookmarks' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true })

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    expect(screen.queryByRole('textbox', { name: 'Rename Alpha docs' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Alpha docs' })).toBeVisible()
  })
})

describe('background bookmark action races', () => {
  it('blocks repeated pending clicks and keeps a failed action focused for retry', async () => {
    let reject!: (error: Error) => void
    const openBookmarkInBackground = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    renderPanel({ openBookmarkInBackground })
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Open Alpha docs in background tab' })
    await user.click(button)
    await user.keyboard('{Enter} ')
    await fireEvent.click(screen.getByRole('button', { name: 'Open Beta page in background tab' }))
    expect(openBookmarkInBackground).toHaveBeenCalledOnce()
    reject(new Error('Tab limit reached'))
    await flushPromises()
    expect(screen.getByRole('alert')).toHaveTextContent('Tab limit reached')
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    openBookmarkInBackground.mockResolvedValueOnce(undefined)
    await user.keyboard('{Enter}')
    expect(openBookmarkInBackground).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(button).toHaveFocus()
  })

  it('preserves newer search focus when a pending background tab completes', async () => {
    let finish!: () => void
    renderPanel({ openBookmarkInBackground: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open Alpha docs in background tab' }))
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Beta')
    finish()
    await flushPromises()
    expect(search).toHaveFocus()
    expect(search).toHaveValue('Beta')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it.each(['resolve', 'reject'])('ignores a late %s after the panel closes and reopens', async outcome => {
    let finish!: () => void
    let reject!: (error: Error) => void
    const view = renderPanel({ openBookmarkInBackground: vi.fn(() => new Promise<void>((resolve, fail) => { finish = resolve; reject = fail })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open Alpha docs in background tab' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Beta')
    if (outcome === 'resolve') finish()
    else reject(new Error('Old failure'))
    await flushPromises()
    expect(search).toHaveFocus()
    expect(search).toHaveValue('Beta')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})
