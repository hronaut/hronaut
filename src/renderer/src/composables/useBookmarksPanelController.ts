import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { BrowserBookmark } from '../../../shared/types.js'

export interface BookmarksPanelControllerOptions {
  open: Ref<boolean>
  bookmarks: Ref<BrowserBookmark[]>
  activeUrl: Readonly<Ref<string | null>>
  activeTitle: Readonly<Ref<string>>
  currentBookmark: Readonly<Ref<BrowserBookmark | undefined>>
  listBookmarks: () => Promise<BrowserBookmark[]>
  addBookmark: (url: string, title: string) => Promise<BrowserBookmark[]>
  renameBookmark: (id: string, title: string) => Promise<BrowserBookmark[]>
  removeBookmark: (id: string) => Promise<BrowserBookmark[]>
  openBookmark: (bookmark: BrowserBookmark) => Promise<void>
}

export function useBookmarksPanelController(options: BookmarksPanelControllerOptions) {
  const query = ref('')
  const error = ref('')
  const pendingAction = ref<string | null>(null)
  const editingBookmarkId = ref<string | null>(null)
  const editingBookmarkTitle = ref('')
  const editingInput = ref<HTMLInputElement | null>(null)

  const filteredBookmarks = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    if (!normalized) return options.bookmarks.value
    return options.bookmarks.value.filter((bookmark) => (
      bookmark.title.toLocaleLowerCase().includes(normalized)
      || bookmark.url.toLocaleLowerCase().includes(normalized)
    ))
  })

  function resetError(): void {
    error.value = ''
  }

  function cancelRename(): void {
    editingBookmarkId.value = null
    editingBookmarkTitle.value = ''
  }

  function setEditingInput(element: unknown): void {
    editingInput.value = element instanceof HTMLInputElement ? element : null
  }

  async function runAction(
    actionId: string,
    operation: () => Promise<BrowserBookmark[] | void>
  ): Promise<boolean> {
    if (pendingAction.value) return false
    resetError()
    pendingAction.value = actionId
    try {
      const nextBookmarks = await operation()
      if (nextBookmarks) options.bookmarks.value = nextBookmarks
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      if (pendingAction.value === actionId) pendingAction.value = null
    }
  }

  async function toggle(): Promise<void> {
    if (options.open.value) {
      options.open.value = false
      return
    }
    options.open.value = true
    await runAction('load', options.listBookmarks)
  }

  async function toggleCurrent(): Promise<void> {
    options.open.value = true
    const url = options.activeUrl.value
    if (!url) return
    const current = options.currentBookmark.value
    await runAction(
      current ? `remove:${current.id}` : `add:${url}`,
      () => current
        ? options.removeBookmark(current.id)
        : options.addBookmark(url, options.activeTitle.value || new URL(url).hostname)
    )
  }

  async function openEntry(bookmark: BrowserBookmark): Promise<void> {
    const opened = await runAction(`open:${bookmark.id}`, () => options.openBookmark(bookmark))
    if (opened) options.open.value = false
  }

  async function beginRename(bookmark: BrowserBookmark): Promise<void> {
    if (pendingAction.value) return
    resetError()
    editingBookmarkId.value = bookmark.id
    editingBookmarkTitle.value = bookmark.title
    await nextTick()
    editingInput.value?.focus()
    editingInput.value?.select()
  }

  async function commitRename(bookmarkId: string): Promise<void> {
    if (editingBookmarkId.value !== bookmarkId) return
    const renamed = await runAction(
      `rename:${bookmarkId}`,
      () => options.renameBookmark(bookmarkId, editingBookmarkTitle.value)
    )
    if (renamed) cancelRename()
  }

  async function remove(bookmarkId: string): Promise<void> {
    const removed = await runAction(`remove:${bookmarkId}`, () => options.removeBookmark(bookmarkId))
    if (removed && editingBookmarkId.value === bookmarkId) cancelRename()
  }

  function handleEscape(): void {
    if (editingBookmarkId.value) cancelRename()
    else options.open.value = false
  }

  const stopOpenTracking = watch(options.open, (isOpen) => {
    if (isOpen) return
    resetError()
    cancelRename()
  })
  const stopBookmarkTracking = watch(
    () => options.bookmarks.value.map((bookmark) => bookmark.id),
    (ids) => {
      if (editingBookmarkId.value && !ids.includes(editingBookmarkId.value)) cancelRename()
    },
    { flush: 'sync' }
  )

  function dispose(): void {
    stopOpenTracking()
    stopBookmarkTracking()
  }

  return {
    query,
    error,
    pendingAction,
    editingBookmarkId,
    editingBookmarkTitle,
    editingInput,
    setEditingInput,
    filteredBookmarks,
    resetError,
    cancelRename,
    toggle,
    toggleCurrent,
    openEntry,
    beginRename,
    commitRename,
    remove,
    handleEscape,
    dispose
  }
}
