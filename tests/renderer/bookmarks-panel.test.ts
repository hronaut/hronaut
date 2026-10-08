import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BookmarksPanel from '../../src/renderer/src/components/BookmarksPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserBookmark, BookmarkCollectionSnapshot } from '../../src/shared/types.js'

function bookmark(id: string, title = `Page ${id}`): BrowserBookmark {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    createdAt: '2026-08-22T09:00:00.000Z',
    updatedAt: '2026-08-22T09:00:00.000Z'
  }
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    bookmarks: [bookmark('alpha', 'Alpha docs'), bookmark('beta', 'Beta page')],
    dock: 'right' as const,
    activeUrl: 'https://example.test/alpha',
    activeTitle: 'Alpha docs',
    currentBookmark: bookmark('alpha', 'Alpha docs'),
    listBookmarks: vi.fn(async () => []),
    addBookmark: vi.fn(async () => []),
    updateBookmarkDestination: vi.fn(async () => []),
    renameBookmark: vi.fn(async () => []),
    removeBookmark: vi.fn(async () => []),
    copyBookmarkAddress: vi.fn(async () => undefined),
    openBookmarkInBackground: vi.fn(async () => undefined),
    openBookmark: vi.fn(async () => undefined),
    ...overrides
  }
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(BookmarksPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: panelProps(overrides)
  })
}

describe('live bookmark focus recovery', () => {
  it.each(['open', 'rename', 'destination', 'background', 'copy', 'remove'])('moves external removal focus to the neighboring %s control', async control => {
    const view = renderPanel()
    const target = (title: string) => control === 'open' ? screen.getByRole('button', { name: new RegExp(`^${title}`) })
      : screen.getByRole('button', { name: control === 'rename' ? `Rename ${title}`
        : control === 'destination' ? `Edit address for ${title}`
          : control === 'background' ? `Open ${title} in background tab` : control === 'copy' ? `Copy address for ${title}` : `Remove ${title}` })
    target('Alpha docs').focus()
    await view.rerender({ bookmarks: [bookmark('beta', 'Beta page')] })
    await flushPromises()
    expect(target('Beta page')).toHaveFocus()
  })

  it('recovers to the previous row when the last focused row disappears', async () => {
    const view = renderPanel()
    screen.getByRole('button', { name: 'Open Beta page in background tab' }).focus()
    await view.rerender({ bookmarks: [bookmark('alpha', 'Alpha docs')] })
    await flushPromises()
    expect(screen.getByRole('button', { name: 'Open Alpha docs in background tab' })).toHaveFocus()
  })

  it('does not replace a missing neighboring Rename control with its Save action', async () => {
    const view = renderPanel()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rename Beta page' }))
    screen.getByRole('button', { name: 'Rename Alpha docs' }).focus()
    await view.rerender({ bookmarks: [bookmark('beta', 'Beta page')] })
    await flushPromises()
    expect(screen.getByRole('searchbox')).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Rename Beta page' })).toHaveValue('Beta page')
  })

  it('keeps the search query and recovers search focus after an external rename leaves its results', async () => {
    const view = renderPanel()
    const search = screen.getByRole('searchbox')
    await userEvent.setup().type(search, 'Alpha docs')
    screen.getByRole('button', { name: 'Open Alpha docs in background tab' }).focus()
    await view.rerender({ bookmarks: [bookmark('alpha', 'Renamed page'), bookmark('beta', 'Beta page')] })
    await flushPromises()
    expect(search).toHaveValue('Alpha docs')
    expect(search).toHaveFocus()
  })

  it('uses Close when an external update empties bookmarks', async () => {
    const view = renderPanel()
    screen.getByRole('button', { name: 'Remove Alpha docs' }).focus()
    await view.rerender({ bookmarks: [] })
    await flushPromises()
    expect(screen.getByRole('button', { name: 'Close bookmarks' })).toHaveFocus()
  })

  it('recovers search focus when an externally removed bookmark was being edited', async () => {
    const view = renderPanel()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rename Alpha docs' }))
    expect(screen.getByRole('textbox', { name: 'Rename Alpha docs' })).toHaveFocus()
    await view.rerender({ bookmarks: [bookmark('beta', 'Beta page')] })
    await flushPromises()
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it.each(['row', 'assignment', 'search', 'filter'])('preserves collection selection and %s focus during an external membership change', async control => {
    let changed!: (snapshot: BookmarkCollectionSnapshot) => void
    const snapshot = { revision: 1, collections: [{ id: 'project', name: 'Project', bookmarkIds: ['alpha', 'beta'] }] }
    const api = {
      list: vi.fn(async () => snapshot),
      onChanged: vi.fn((callback: typeof changed) => { changed = callback; return vi.fn() }),
      create: vi.fn(), rename: vi.fn(), remove: vi.fn(), assign: vi.fn()
    }
    renderPanel({ collectionsApi: api })
    await flushPromises()
    const filter = screen.getByRole('combobox', { name: 'Filter bookmarks by collection' })
    await userEvent.setup().selectOptions(filter, 'c:project')
    const target = control === 'filter' ? filter : control === 'search' ? screen.getByRole('searchbox')
      : control === 'assignment' ? screen.getByRole('combobox', { name: 'Collection for Alpha docs' })
        : screen.getByRole('button', { name: 'Open Alpha docs in background tab' })
    target.focus()
    changed({ revision: 2, collections: [{ ...snapshot.collections[0], bookmarkIds: ['beta'] }] })
    await flushPromises()
    expect(filter).toHaveValue('c:project')
    expect(screen.queryByRole('button', { name: 'Open Alpha docs in background tab' })).toBeNull()
    expect(control === 'row' ? screen.getByRole('button', { name: 'Open Beta page in background tab' })
      : control === 'assignment' ? filter : target).toHaveFocus()
  })

  it('preserves newer focus moved outside the panel during the DOM update', async () => {
    const view = renderPanel()
    const focused = screen.getByRole('button', { name: 'Remove Alpha docs' })
    const external = document.createElement('button')
    document.body.append(external)
    const observer = new MutationObserver(() => { if (!focused.isConnected) external.focus() })
    observer.observe(screen.getByRole('dialog'), { childList: true, subtree: true })
    try {
      focused.focus()
      await view.rerender({ bookmarks: [bookmark('beta', 'Beta page')] })
      await flushPromises()
      expect(external).toHaveFocus()
    } finally { observer.disconnect(); external.remove() }
  })

  it('invalidates queued recovery when the same panel closes and reopens before rendering', async () => {
    let finishLoad!: (bookmarks: BrowserBookmark[]) => void
    const beta = bookmark('beta', 'Beta page')
    const wrapper = mount(BookmarksPanel, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: panelProps({ listBookmarks: vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finishLoad = resolve })) })
    })
    const panel = screen.getByRole('dialog')
    const focused = screen.getByRole('button', { name: 'Remove Alpha docs' })
    const exposed = wrapper.vm as unknown as { toggle(): Promise<void> }
    let reopened = false
    const observer = new MutationObserver(() => {
      if (focused.isConnected || reopened) return
      reopened = true
      void exposed.toggle()
      void exposed.toggle()
    })
    observer.observe(panel, { childList: true, subtree: true })
    try {
      focused.focus()
      await wrapper.setProps({ bookmarks: [beta] })
      await flushPromises()
      expect(reopened).toBe(true)
      expect(screen.getByRole('dialog')).toBe(panel)
      expect(document.body).toHaveFocus()
      finishLoad([beta])
      await flushPromises()
      expect(document.body).toHaveFocus()
    } finally { observer.disconnect(); wrapper.unmount() }
  })

  it('preserves newer search focus when an external removal overlaps a pending background action', async () => {
    let finish!: () => void
    const view = renderPanel({ openBookmarkInBackground: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open Alpha docs in background tab' }))
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Beta')
    await view.rerender({ bookmarks: [bookmark('beta', 'Beta page')] })
    finish()
    await flushPromises()
    expect(search).toHaveFocus()
    expect(search).toHaveValue('Beta')
  })
})

describe('BookmarksPanel', () => {
  it('creates a collection, assigns a bookmark and keeps all links when removing the collection', async () => {
    let snapshot: BookmarkCollectionSnapshot = { revision: 1, collections: [] }
    const api = {
      list: vi.fn(async () => snapshot), onChanged: vi.fn(() => () => undefined),
      create: vi.fn(async (name: string) => (snapshot = { revision: 2, collections: [{ id: 'project', name, bookmarkIds: [] }] })),
      rename: vi.fn(async () => snapshot),
      assign: vi.fn(async (id: string) => (snapshot = { revision: 3, collections: [{ id: 'project', name: 'Project', bookmarkIds: [id] }] })),
      remove: vi.fn(async () => (snapshot = { revision: 4, collections: [] }))
    }
    renderPanel({ collectionsApi: api })
    await flushPromises()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New collection' }))
    expect(screen.getByRole('textbox', { name: 'Collection name' })).toHaveFocus()
    await user.keyboard('Project{Enter}')
    const filter = screen.getByRole('combobox', { name: 'Filter bookmarks by collection' })
    expect(filter).toHaveFocus()
    expect(screen.getByText('No bookmarks in this collection')).toBeVisible()
    await user.selectOptions(filter, 'all')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Collection for Alpha docs' }), 'project')
    await user.selectOptions(filter, 'c:project')
    expect(screen.getByRole('button', { name: /^Alpha docs/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Beta page/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove collection' }))
    expect(filter).toHaveFocus()
    expect(filter).toHaveValue('unfiled')
    expect(screen.getByRole('button', { name: /^Beta page/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Alpha docs/ })).toBeVisible()
  })

  it('preserves newer search focus when an assignment removes the focused row from Unfiled', async () => {
    let finish!: (value: BookmarkCollectionSnapshot) => void
    const api = {
      list: vi.fn(async () => ({ revision: 1, collections: [{ id: 'project', name: 'Project', bookmarkIds: [] }] })),
      onChanged: vi.fn(() => () => undefined), create: vi.fn(), rename: vi.fn(), remove: vi.fn(),
      assign: vi.fn(() => new Promise<BookmarkCollectionSnapshot>(resolve => { finish = resolve }))
    }
    renderPanel({ collectionsApi: api })
    await flushPromises()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter bookmarks by collection' }), 'unfiled')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Collection for Alpha docs' }), 'project')
    const search = screen.getByRole('searchbox')
    await user.click(search)
    finish({ revision: 2, collections: [{ id: 'project', name: 'Project', bookmarkIds: ['alpha'] }] })
    await flushPromises()
    expect(search).toHaveFocus()
    expect(screen.queryByRole('button', { name: /^Alpha docs/ })).toBeNull()
  })

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

  it.each(['first', 'last', 'filtered', 'only'])('keeps intended %s removal focus when a live update arrives before the removal response', async scenario => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    const alpha = bookmark('alpha', 'Alpha docs')
    const beta = bookmark('beta', 'Beta page')
    const removed = scenario === 'last' ? beta : alpha
    const remaining = scenario === 'only' ? [] : [scenario === 'last' ? alpha : beta]
    const view = renderPanel({ bookmarks: scenario === 'only' ? [alpha] : [alpha, beta],
      removeBookmark: vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve })) })
    if (scenario === 'filtered') await fireEvent.update(screen.getByRole('searchbox'), 'Alpha docs')
    const remove = screen.getByRole('button', { name: `Remove ${removed.title}` })
    remove.focus()
    await fireEvent.click(remove)
    await view.rerender({ bookmarks: remaining })
    await flushPromises()
    if (scenario === 'first' || scenario === 'last') {
      expect(screen.getByRole('button', { name: `Remove ${remaining[0].title}` })).toBeDisabled()
    }
    finish(remaining)
    await flushPromises()
    const destination = scenario === 'only' ? screen.getByRole('button', { name: 'Close bookmarks' })
      : scenario === 'filtered' ? screen.getByRole('searchbox')
        : screen.getByRole('button', { name: `Remove ${remaining[0].title}` })
    expect(destination).toHaveFocus()
  })

  it.each(['search', 'outside', 'reopen'])('preserves newer %s focus after a live removal update precedes the response', async destination => {
    let finish!: (bookmarks: BrowserBookmark[]) => void
    const remaining = [bookmark('beta', 'Beta page')]
    const view = renderPanel({ removeBookmark: vi.fn(() => new Promise<BrowserBookmark[]>(resolve => { finish = resolve })) })
    const remove = screen.getByRole('button', { name: 'Remove Alpha docs' })
    remove.focus()
    await fireEvent.click(remove)
    await view.rerender({ bookmarks: remaining })
    await flushPromises()
    if (destination === 'reopen') {
      await view.rerender({ open: false })
      await view.rerender({ open: true })
    }
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      const target = destination === 'outside' ? outside : screen.getByRole('searchbox')
      target.focus()
      finish(remaining)
      await flushPromises()
      expect(target).toHaveFocus()
    } finally { outside.remove() }
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

it('copies a saved bookmark address by keyboard without opening or editing it', async () => {
  const copyBookmarkAddress = vi.fn(async () => undefined)
  const openBookmark = vi.fn(async () => undefined)
  renderPanel({ copyBookmarkAddress, openBookmark })
  const copy = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
  copy.focus()
  await userEvent.keyboard('{Enter}')
  await flushPromises()
  expect(copyBookmarkAddress).toHaveBeenCalledExactlyOnceWith(bookmark('alpha', 'Alpha docs'))
  expect(openBookmark).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Address copied')
  expect(copy).toHaveFocus()
})

it('reports clipboard failure without exception contents and permits an explicit retry', async () => {
  const copyBookmarkAddress = vi.fn().mockRejectedValueOnce(new Error('private clipboard detail')).mockResolvedValue(undefined)
  renderPanel({ copyBookmarkAddress })
  const button = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
  await fireEvent.click(button)
  await flushPromises()
  expect(screen.getByRole('alert')).toHaveTextContent('Could not copy address. Try again.')
  expect(screen.queryByText(/private clipboard detail/)).toBeNull()
  await fireEvent.click(button)
  await flushPromises()
  expect(copyBookmarkAddress).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Address copied')
})

it.each(['query', 'close', 'destination', 'removal', 'collection'])('discards delayed clipboard feedback after %s changes', async change => {
  let finish!: () => void
  const copyBookmarkAddress = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const collectionsApi = { list: vi.fn(async () => ({ revision: 1, collections: [] })), onChanged: vi.fn(() => () => {}) }
  const view = renderPanel({ copyBookmarkAddress, collectionsApi })
  await flushPromises()
  const button = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
  await fireEvent.click(button)
  await fireEvent.click(button)
  expect(copyBookmarkAddress).toHaveBeenCalledTimes(1)
  if (change === 'query') await fireEvent.update(screen.getByRole('searchbox'), 'Beta')
  if (change === 'close') { await view.rerender({ open: false }); await view.rerender({ open: true }) }
  if (change === 'destination') await view.rerender({ bookmarks: [{ ...bookmark('alpha', 'Alpha docs'), url: 'https://example.test/new' }] })
  if (change === 'removal') await view.rerender({ bookmarks: [bookmark('beta', 'Beta page')] })
  if (change === 'collection') await fireEvent.update(screen.getByRole('combobox', { name: 'Filter bookmarks by collection' }), 'unfiled')
  finish()
  await flushPromises()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})


it('sorts bookmark titles without changing authoritative order and retains the choice across panel reopen', async () => {
  const entries = [bookmark('z', 'Zebra'), bookmark('a', 'Alpha')]
  const view = renderPanel({ bookmarks: entries })
  const titles = () => [...view.container.querySelectorAll('.bookmark-copy strong')].map(node => node.textContent)
  expect(titles()).toEqual(['Zebra', 'Alpha'])
  const sort = screen.getByRole('combobox', { name: 'Sort bookmarks' })
  expect(sort).toHaveValue('updated')
  await fireEvent.update(sort, 'title')
  expect(titles()).toEqual(['Alpha', 'Zebra'])
  expect(entries.map(entry => entry.title)).toEqual(['Zebra', 'Alpha'])
  await view.rerender({ open: false })
  await view.rerender({ open: true })
  expect(screen.getByRole('combobox', { name: 'Sort bookmarks' })).toHaveValue('title')
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort bookmarks' }), 'updated')
  expect(titles()).toEqual(['Zebra', 'Alpha'])
})

it('keeps focus on the same bookmark action when a live title update moves its row', async () => {
  const view = renderPanel({ bookmarks: [bookmark('b', 'Beta'), bookmark('c', 'Charlie'), bookmark('z', 'Zebra')] })
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort bookmarks' }), 'title')
  screen.getByRole('button', { name: 'Copy address for Zebra' }).focus()
  await view.rerender({ bookmarks: [bookmark('b', 'Beta'), bookmark('c', 'Charlie'), bookmark('z', 'Alpha')] })
  await flushPromises()
  expect([...view.container.querySelectorAll('.bookmark-copy strong')].map(node => node.textContent)).toEqual(['Alpha', 'Beta', 'Charlie'])
  expect(screen.getByRole('button', { name: 'Copy address for Alpha' })).toHaveFocus()
})

it.each(['copy', 'background'])('retains the pending %s control through a live title reorder and completion', async action => {
  let finish!: () => void
  const operation = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const view = renderPanel({
    bookmarks: [bookmark('b', 'Beta'), bookmark('c', 'Charlie'), bookmark('z', 'Zebra')],
    [action === 'copy' ? 'copyBookmarkAddress' : 'openBookmarkInBackground']: operation
  })
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort bookmarks' }), 'title')
  const button = screen.getByRole('button', { name: action === 'copy' ? 'Copy address for Zebra' : 'Open Zebra in background tab' })
  await userEvent.setup().click(button)
  expect(button).toHaveAttribute('aria-disabled', 'true')
  await view.rerender({ bookmarks: [bookmark('b', 'Beta'), bookmark('c', 'Charlie'), bookmark('z', 'Alpha')] })
  await flushPromises()
  expect(button).toHaveFocus()
  await fireEvent.click(button)
  expect(operation).toHaveBeenCalledTimes(1)
  finish()
  await flushPromises()
  expect(button).toHaveFocus()
  expect(button).toHaveAttribute('aria-disabled', 'false')
})

it.each(['copy', 'background'])('preserves newer human focus during a pending %s reorder', async action => {
  let finish!: () => void
  const operation = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const view = renderPanel({
    bookmarks: [bookmark('b', 'Beta'), bookmark('z', 'Zebra')],
    [action === 'copy' ? 'copyBookmarkAddress' : 'openBookmarkInBackground']: operation
  })
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort bookmarks' }), 'title')
  await userEvent.setup().click(screen.getByRole('button', { name: action === 'copy' ? 'Copy address for Zebra' : 'Open Zebra in background tab' }))
  const update = view.rerender({ bookmarks: [bookmark('b', 'Beta'), bookmark('z', 'Alpha')] })
  const search = screen.getByRole('searchbox')
  search.focus()
  await update
  await flushPromises()
  expect(search).toHaveFocus()
  finish()
  await flushPromises()
  expect(search).toHaveFocus()
})
