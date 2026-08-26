import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBookmarksPanelController } from '../../src/renderer/src/composables/useBookmarksPanelController.js'
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

function createController(initialBookmarks = [bookmark('alpha')]) {
  const open = ref(false)
  const bookmarks = ref(initialBookmarks)
  const activeUrl = ref<string | null>('https://example.test/current')
  const activeTitle = ref('Current page')
  const currentBookmark = ref<BrowserBookmark>()
  const listBookmarks = vi.fn(async () => bookmarks.value)
  const addBookmark = vi.fn(async (url: string, title: string) => [bookmark('current', title), ...bookmarks.value])
  const renameBookmark = vi.fn(async (id: string, title: string) => bookmarks.value.map((item) => item.id === id ? { ...item, title } : item))
  const removeBookmark = vi.fn(async (id: string) => bookmarks.value.filter((item) => item.id !== id))
  const openBookmark = vi.fn(async () => undefined)
  const controller = useBookmarksPanelController({
    open,
    bookmarks,
    activeUrl,
    activeTitle,
    currentBookmark,
    listBookmarks,
    addBookmark,
    renameBookmark,
    removeBookmark,
    openBookmark
  })
  return {
    open,
    bookmarks,
    activeUrl,
    activeTitle,
    currentBookmark,
    listBookmarks,
    addBookmark,
    renameBookmark,
    removeBookmark,
    openBookmark,
    controller
  }
}

describe('bookmarks panel controller', () => {
  it('opens the panel and reports list failures without dropping retained bookmarks', async () => {
    const { open, bookmarks, listBookmarks, controller } = createController()
    listBookmarks.mockRejectedValueOnce(new Error('Bookmark storage is unavailable'))

    await controller.toggle()

    expect(open.value).toBe(true)
    expect(bookmarks.value).toHaveLength(1)
    expect(controller.error.value).toBe('Bookmark storage is unavailable')
    expect(controller.pendingAction.value).toBeNull()
    controller.dispose()
  })

  it('preserves a rename draft after failure and clears it only after a successful retry', async () => {
    const { bookmarks, renameBookmark, controller } = createController()
    await controller.beginRename(bookmarks.value[0])
    controller.editingBookmarkTitle.value = 'Corrected title'
    renameBookmark.mockRejectedValueOnce(new Error('Could not rename bookmark'))

    await controller.commitRename('alpha')
    expect(controller.error.value).toBe('Could not rename bookmark')
    expect(controller.editingBookmarkId.value).toBe('alpha')
    expect(controller.editingBookmarkTitle.value).toBe('Corrected title')

    await controller.commitRename('alpha')
    expect(bookmarks.value[0].title).toBe('Corrected title')
    expect(controller.editingBookmarkId.value).toBeNull()
    controller.dispose()
  })

  it('keeps editing active when removal fails and cancels stale editing after external removal', async () => {
    const { bookmarks, removeBookmark, controller } = createController()
    await controller.beginRename(bookmarks.value[0])
    removeBookmark.mockRejectedValueOnce(new Error('Could not remove bookmark'))

    await controller.remove('alpha')
    expect(controller.editingBookmarkId.value).toBe('alpha')
    expect(controller.error.value).toBe('Could not remove bookmark')

    bookmarks.value = []
    await nextTick()
    expect(controller.editingBookmarkId.value).toBeNull()
    controller.dispose()
  })

  it('deduplicates current-page mutations and accepts the authoritative result', async () => {
    let resolveAdd: ((bookmarks: BrowserBookmark[]) => void) | undefined
    const pendingAdd = new Promise<BrowserBookmark[]>((resolve) => {
      resolveAdd = resolve
    })
    const { bookmarks, addBookmark, controller } = createController([])
    addBookmark.mockReturnValue(pendingAdd)

    const first = controller.toggleCurrent()
    const duplicate = controller.toggleCurrent()
    expect(addBookmark).toHaveBeenCalledTimes(1)
    expect(controller.pendingAction.value).toBe('add:https://example.test/current')

    resolveAdd?.([bookmark('current', 'Current page')])
    await Promise.all([first, duplicate])
    expect(bookmarks.value.map((item) => item.id)).toEqual(['current'])
    controller.dispose()
  })

  it('keeps the panel visible when opening a bookmark fails', async () => {
    const { open, bookmarks, openBookmark, controller } = createController()
    open.value = true
    openBookmark.mockRejectedValueOnce(new Error('Could not open bookmark'))

    await controller.openEntry(bookmarks.value[0])

    expect(open.value).toBe(true)
    expect(controller.error.value).toBe('Could not open bookmark')
    controller.dispose()
  })

  it('does not let an older bookmark navigation close a newly reopened panel', async () => {
    let finishNavigation!: () => void
    const navigation = new Promise<undefined>((resolve) => {
      finishNavigation = () => resolve(undefined)
    })
    const { open, bookmarks, openBookmark, controller } = createController()
    open.value = true
    openBookmark.mockReturnValueOnce(navigation)

    const openingBookmark = controller.openEntry(bookmarks.value[0])
    await controller.toggle()
    await controller.toggle()
    expect(open.value).toBe(true)

    finishNavigation()
    await openingBookmark

    expect(open.value).toBe(true)
    controller.dispose()
  })
})
