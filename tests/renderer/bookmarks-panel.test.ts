import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
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
      renameBookmark: vi.fn(async () => []),
      removeBookmark: vi.fn(async () => []),
      openBookmark: vi.fn(async () => undefined),
      ...overrides
    }
  })
}

describe('BookmarksPanel', () => {
  it('renders the rename editor outside interactive buttons and focuses it', async () => {
    renderPanel()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    const editor = screen.getByRole('textbox', { name: 'Rename Alpha docs' })

    expect(editor).toHaveFocus()
    expect(editor.closest('button')).toBeNull()
    expect(screen.queryByTitle('https://example.test/alpha')).not.toBeInTheDocument()
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
