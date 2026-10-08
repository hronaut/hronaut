import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { BrowserBookmark } from '../../../shared/types.js'

export interface BookmarksPanelControllerOptions {
  locale: Readonly<Ref<string>>
  open: Ref<boolean>
  bookmarks: Ref<BrowserBookmark[]>
  activeUrl: Readonly<Ref<string | null>>
  activeTitle: Readonly<Ref<string>>
  currentBookmark: Readonly<Ref<BrowserBookmark | undefined>>
  listBookmarks: () => Promise<BrowserBookmark[]>
  addBookmark: (url: string, title: string) => Promise<BrowserBookmark[]>
  renameBookmark: (id: string, title: string) => Promise<BrowserBookmark[]>
  updateBookmarkDestination: (id: string, url: string) => Promise<BrowserBookmark[]>
  removeBookmark: (id: string) => Promise<BrowserBookmark[]>
  openBookmark: (bookmark: BrowserBookmark) => Promise<void>
  copyBookmarkAddress: (bookmark: BrowserBookmark) => Promise<void>
  openBookmarkInBackground: (bookmark: BrowserBookmark) => Promise<void>
}

export function useBookmarksPanelController(options: BookmarksPanelControllerOptions) {
  const query = ref('')
  const sortOrder = ref<'updated' | 'title'>('updated')
  const titleCollator = computed(() => new Intl.Collator(options.locale.value, { numeric: true, sensitivity: 'base' }))
  const error = ref('')
  const copyFeedback = ref<'success' | 'error' | ''>('')
  const copiedBookmark = ref<{ id: string; url: string } | null>(null)
  let copyGeneration = 0
  const pendingAction = ref<string | null>(null)
  const editingBookmarkId = ref<string | null>(null)
  const editingBookmarkTitle = ref('')
  const editingBookmarkUrl = ref('')
  const editingDestination = ref(false)
  let editGeneration = 0
  const editingInput = ref<HTMLInputElement | null>(null)
  let actionGeneration = 0

  const filteredBookmarks = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    const matching = !normalized ? options.bookmarks.value : options.bookmarks.value.filter((bookmark) => (
      bookmark.title.toLocaleLowerCase().includes(normalized)
      || bookmark.url.toLocaleLowerCase().includes(normalized)
    ))
    return sortOrder.value === 'title'
      ? [...matching].sort((left, right) => titleCollator.value.compare(left.title, right.title))
      : matching
  })

  function resetCopyFeedback(): void {
    copyGeneration += 1
    copyFeedback.value = ''
  }

  const copyTargetVisible = computed(() => !copiedBookmark.value || filteredBookmarks.value.some(
    item => item.id === copiedBookmark.value!.id && item.url === copiedBookmark.value!.url
  ))
  const stopCopyTracking = watch([query, options.open, copyTargetVisible], resetCopyFeedback, { flush: 'sync' })

  async function copyAddress(bookmark: BrowserBookmark): Promise<void> {
    if (!options.open.value || pendingAction.value || !filteredBookmarks.value.some(
      item => item.id === bookmark.id && item.url === bookmark.url
    )) return
    copiedBookmark.value = { id: bookmark.id, url: bookmark.url }
    await runAction(`copy:${bookmark.id}`, async () => {
      const generation = copyGeneration
      try {
        await options.copyBookmarkAddress(bookmark)
        if (generation === copyGeneration) copyFeedback.value = 'success'
      } catch {
        if (generation === copyGeneration) copyFeedback.value = 'error'
      }
    })
  }

  function resetError(): void {
    error.value = ''
  }

  function invalidateActions(): void {
    actionGeneration += 1
    pendingAction.value = null
  }

  function cancelRename(): void {
    editGeneration += 1
    editingBookmarkUrl.value = ''
    editingDestination.value = false
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
    const generation = ++actionGeneration
    resetError()
    resetCopyFeedback()
    pendingAction.value = actionId
    try {
      const nextBookmarks = await operation()
      if (generation !== actionGeneration) return false
      if (nextBookmarks) options.bookmarks.value = nextBookmarks
      return true
    } catch (cause) {
      if (generation !== actionGeneration) return false
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      if (generation === actionGeneration) pendingAction.value = null
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

  async function openInBackground(bookmark: BrowserBookmark): Promise<void> {
    await runAction(`background:${bookmark.id}`, () => options.openBookmarkInBackground(bookmark))
  }

  async function beginRename(bookmark: BrowserBookmark, destination = false): Promise<void> {
    if (pendingAction.value) return
    resetError()
    resetCopyFeedback()
    const generation = ++editGeneration
    editingDestination.value = destination
    editingBookmarkUrl.value = bookmark.url
    editingBookmarkId.value = bookmark.id
    editingBookmarkTitle.value = bookmark.title
    await nextTick()
    if (editingBookmarkId.value !== bookmark.id || generation !== editGeneration) return
    editingInput.value?.focus()
    editingInput.value?.select()
  }

  async function commitRename(bookmarkId: string): Promise<void> {
    if (editingBookmarkId.value !== bookmarkId) return
    const generation = editGeneration
    const renamed = await runAction(
      editingDestination.value ? `destination:${bookmarkId}` : `rename:${bookmarkId}`,
      () => editingDestination.value
        ? options.updateBookmarkDestination(bookmarkId, editingBookmarkUrl.value)
        : options.renameBookmark(bookmarkId, editingBookmarkTitle.value)
    )
    if (renamed && generation === editGeneration) cancelRename()
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
    invalidateActions()
    if (isOpen) return
    resetError()
    cancelRename()
  }, { flush: 'sync' })
  const stopBookmarkTracking = watch(
    () => options.bookmarks.value.map((bookmark) => bookmark.id),
    (ids) => {
      if (editingBookmarkId.value && !ids.includes(editingBookmarkId.value)) cancelRename()
    },
    { flush: 'sync' }
  )

  function dispose(): void {
    invalidateActions()
    resetCopyFeedback()
    stopCopyTracking()
    stopOpenTracking()
    stopBookmarkTracking()
  }

  return {
    query,
    sortOrder,
    error,
    copyFeedback,
    copyAddress,
    resetCopyFeedback,
    pendingAction,
    editingBookmarkId,
    editingBookmarkTitle,
    editingBookmarkUrl,
    editingDestination,
    editingInput,
    setEditingInput,
    filteredBookmarks,
    resetError,
    cancelRename,
    toggle,
    toggleCurrent,
    openEntry,
    openInBackground,
    beginRename,
    commitRename,
    remove,
    handleEscape,
    dispose
  }
}
