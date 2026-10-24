import { computed, ref, watch, type Ref } from 'vue'
import type { BookmarkCollectionSnapshot, BookmarkTabsResult, HronautBookmarkCollectionsApi } from '../../../shared/types.js'
import { friendlyUiError } from './useAppToastController.js'

export function useBookmarkCollectionsController(options: {
  api?: HronautBookmarkCollectionsApi
  open: Readonly<Ref<boolean>>
  blocked: Readonly<Ref<boolean>>
  /** Words for a failure that carries none of its own. */
  translate: (key: string) => string
}) {
  const snapshot = ref<BookmarkCollectionSnapshot>({ revision: -1, collections: [] })
  const selection = ref('all')
  const pending = ref(false)
  const error = ref('')
  /** The name being edited: 'new', `edit:<id>`, or `tabs:<workspace id>` (`tabs:` alone for no workspace) for Bookmark all tabs. */
  const editor = ref<string | null>(null)
  const draft = ref('')
  /** What the last Bookmark all tabs did, until another change. */
  const tabsResult = ref<BookmarkTabsResult | null>(null)
  let generation = 0
  let editGeneration = 0
  /** The name Bookmark all tabs suggested, kept up to date with the collections until the person changes it. */
  let tabsSuggestion: { base: string; name: string } | null = null
  let selectionGeneration = 0
  let disposed = false
  const collections = computed(() => snapshot.value.collections)
  const selected = computed(() => collections.value.find(collection => `c:${collection.id}` === selection.value))
  const assignments = computed(() => new Map(collections.value.flatMap(collection => collection.bookmarkIds.map(id => [id, collection.id] as const))))

  function accept(next: BookmarkCollectionSnapshot): void {
    if (disposed || next.revision < snapshot.value.revision) return
    snapshot.value = next
    if (selection.value.startsWith('c:') && !selected.value) selection.value = 'unfiled'
    if (editor.value?.startsWith('edit:') && !collections.value.some(collection => collection.id === editor.value!.slice(5))) cancelEdit()
    if (editor.value?.startsWith('tabs:') && tabsSuggestion && draft.value === tabsSuggestion.name) {
      tabsSuggestion.name = availableName(tabsSuggestion.base)
      draft.value = tabsSuggestion.name
    }
  }

  async function run(operation: () => Promise<BookmarkCollectionSnapshot>, feedbackCurrent: () => boolean = () => true): Promise<boolean> {
    if (disposed || pending.value || options.blocked.value) return false
    const expected = generation
    pending.value = true
    error.value = ''
    tabsResult.value = null
    try {
      const next = await operation()
      if (expected !== generation) return false
      accept(next)
      return true
    } catch (cause) {
      if (expected === generation && feedbackCurrent()) error.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
      return false
    } finally {
      if (expected === generation) pending.value = false
    }
  }

  function cancelEdit(): void {
    editGeneration += 1
    editor.value = null
    draft.value = ''
    tabsSuggestion = null
  }

  function beginEdit(id?: string): void {
    if (disposed || pending.value || options.blocked.value) return
    cancelEdit()
    editor.value = id === undefined ? 'new' : `edit:${id}`
    draft.value = collections.value.find(collection => collection.id === id)?.name ?? ''
    error.value = ''
    tabsResult.value = null
  }

  /**
   * Bookmark all tabs asks what to call the new collection, as Chrome asks for the folder's name: by the workspace's,
   * or the suggested, name, numbered when a collection has it. Unlike the panel's own buttons it asks even while a
   * change is under way, as its key or a tab's menu can come at any time; it saves once that is done.
   */
  function beginTabs(workspaceId: string | null, suggestedName: string): void {
    if (disposed) return
    cancelEdit()
    editor.value = `tabs:${workspaceId ?? ''}`
    tabsSuggestion = { base: suggestedName, name: availableName(suggestedName) }
    draft.value = tabsSuggestion.name
    error.value = ''
    tabsResult.value = null
  }

  function availableName(suggested: string): string {
    const base = suggested.trim().replace(/\s+/g, ' ').slice(0, 80)
    const taken = new Set(collections.value.map(collection => collection.name.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    for (let number = 2; ; number += 1) {
      const suffix = ` (${number})`
      const name = `${base.slice(0, 80 - suffix.length)}${suffix}`
      if (!taken.has(name.toLowerCase())) return name
    }
  }

  async function save(): Promise<boolean> {
    const api = options.api
    const editing = editor.value
    if (!api || !editing) return false
    const expected = editGeneration
    const expectedSelection = selectionGeneration
    const name = draft.value
    if (editing.startsWith('tabs:')) {
      const workspaceId = editing.slice(5) || null
      let result: BookmarkTabsResult | null = null
      const saved = await run(async () => {
        const outcome = await api.bookmarkTabs(workspaceId, name)
        result = outcome.result
        return outcome.snapshot
      }, () => expected === editGeneration)
      if (!saved || expected !== editGeneration || !result) return false
      const { collectionId } = result
      if (expectedSelection === selectionGeneration && collections.value.some(collection => collection.id === collectionId)) {
        selection.value = `c:${collectionId}`
      }
      cancelEdit()
      tabsResult.value = result
      return true
    }
    const id = editing === 'new' ? null : editing.slice(5)
    const saved = await run(() => id === null ? api.create(name) : api.rename(id, name), () => expected === editGeneration)
    if (!saved || expected !== editGeneration) return false
    const collection = collections.value.find(candidate => id === null
      ? candidate.name === name.trim().replace(/\s+/g, ' ')
      : candidate.id === id)
    if (collection && expectedSelection === selectionGeneration) selection.value = `c:${collection.id}`
    cancelEdit()
    return true
  }

  function remove(): Promise<boolean> {
    const api = options.api
    const id = selected.value?.id
    return api && id ? run(() => api.remove(id)) : Promise.resolve(false)
  }

  function assign(bookmarkId: string, collectionId: string | null): Promise<boolean> {
    const api = options.api
    return api ? run(() => api.assign(bookmarkId, collectionId)) : Promise.resolve(false)
  }

  const unsubscribe = options.api?.onChanged(accept)
  const stopSelection = watch(selection, () => { selectionGeneration += 1 }, { flush: 'sync' })
  const stop = watch(options.open, isOpen => {
    generation += 1
    pending.value = false
    error.value = ''
    tabsResult.value = null
    cancelEdit()
    if (isOpen && options.api) void run(() => options.api!.list())
  }, { immediate: true, flush: 'sync' })

  function includes(bookmarkId: string): boolean {
    if (selection.value === 'all') return true
    const assigned = assignments.value.get(bookmarkId)
    return selection.value === 'unfiled' ? !assigned : assigned === selected.value?.id
  }

  function dispose(): void {
    disposed = true
    generation += 1
    stop()
    stopSelection()
    unsubscribe?.()
  }

  return { collections, selection, selected, pending, error, editor, draft, tabsResult, beginEdit, beginTabs, cancelEdit, save, remove, assign, includes,
    assignment: (bookmarkId: string) => assignments.value.get(bookmarkId) ?? '', dispose }
}

export type BookmarkCollectionsController = ReturnType<typeof useBookmarkCollectionsController>
