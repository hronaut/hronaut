import { computed, ref, watch, type Ref } from 'vue'
import type { BookmarkCollectionSnapshot, HronautBookmarkCollectionsApi } from '../../../shared/types.js'

export function useBookmarkCollectionsController(options: {
  api?: HronautBookmarkCollectionsApi
  open: Readonly<Ref<boolean>>
  blocked: Readonly<Ref<boolean>>
}) {
  const snapshot = ref<BookmarkCollectionSnapshot>({ revision: -1, collections: [] })
  const selection = ref('all')
  const pending = ref(false)
  const error = ref('')
  const editor = ref<string | null>(null)
  const draft = ref('')
  let generation = 0
  let editGeneration = 0
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
  }

  async function run(operation: () => Promise<BookmarkCollectionSnapshot>): Promise<boolean> {
    if (disposed || pending.value || options.blocked.value) return false
    const expected = generation
    pending.value = true
    error.value = ''
    try {
      const next = await operation()
      if (expected !== generation) return false
      accept(next)
      return true
    } catch (cause) {
      if (expected === generation) error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      if (expected === generation) pending.value = false
    }
  }

  function cancelEdit(): void {
    editGeneration += 1
    editor.value = null
    draft.value = ''
  }

  function beginEdit(id?: string): void {
    if (disposed || pending.value || options.blocked.value) return
    cancelEdit()
    editor.value = id === undefined ? 'new' : `edit:${id}`
    draft.value = collections.value.find(collection => collection.id === id)?.name ?? ''
    error.value = ''
  }

  async function save(): Promise<boolean> {
    const api = options.api
    const editing = editor.value
    if (!api || !editing) return false
    const id = editing === 'new' ? null : editing.slice(5)
    const expected = editGeneration
    const expectedSelection = selectionGeneration
    const name = draft.value
    const saved = await run(() => id === null ? api.create(name) : api.rename(id, name))
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

  return { collections, selection, selected, pending, error, editor, draft, beginEdit, cancelEdit, save, remove, assign, includes,
    assignment: (bookmarkId: string) => assignments.value.get(bookmarkId) ?? '', dispose }
}

export type BookmarkCollectionsController = ReturnType<typeof useBookmarkCollectionsController>
