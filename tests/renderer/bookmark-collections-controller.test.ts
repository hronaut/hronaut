import { ref } from 'vue'
import { expect, it, vi } from 'vitest'
import type { BookmarkCollectionSnapshot } from '../../src/shared/types.js'
import { useBookmarkCollectionsController } from '../../src/renderer/src/composables/useBookmarkCollectionsController.js'

function fixture() {
  const open = ref(false)
  const blocked = ref(false)
  const initial: BookmarkCollectionSnapshot = { revision: 1, collections: [{ id: 'one', name: 'One', bookmarkIds: ['a'] }] }
  let notify!: (value: BookmarkCollectionSnapshot) => void
  const unsubscribe = vi.fn()
  const api = {
    list: vi.fn(async () => initial), create: vi.fn(async (_name: string) => initial),
    rename: vi.fn(async (_id: string, _name: string) => initial), remove: vi.fn(async (_id: string) => initial),
    assign: vi.fn(async (_id: string, _collection: string | null) => initial),
    onChanged: vi.fn((listener: typeof notify) => { notify = listener; return unsubscribe })
  }
  const controller = useBookmarkCollectionsController({ open, blocked, api, translate: key => `t:${key}` })
  notify(initial)
  return { controller, api, open, blocked, notify: (value: BookmarkCollectionSnapshot) => notify(value), unsubscribe }
}

it('filters All, Unfiled and one collection and preserves newer subscription snapshots', async () => {
  const { controller, notify } = fixture()
  try {
    expect(controller.includes('a')).toBe(true)
    controller.selection.value = 'unfiled'
    expect(controller.includes('a')).toBe(false)
    expect(controller.includes('b')).toBe(true)
    controller.selection.value = 'c:one'
    expect(controller.includes('a')).toBe(true)
    expect(controller.includes('b')).toBe(false)
    notify({ revision: 3, collections: [] })
    notify({ revision: 2, collections: [{ id: 'one', name: 'Stale', bookmarkIds: ['a'] }] })
    expect(controller.selection.value).toBe('unfiled')
    expect(controller.collections.value).toEqual([])
  } finally { controller.dispose() }
})

it('retains failed drafts for retry and ignores late saves after close/reopen', async () => {
  const { controller, api, open } = fixture()
  try {
    controller.beginEdit()
    controller.draft.value = 'New'
    api.create.mockRejectedValueOnce(new Error('Disk unavailable'))
    expect(await controller.save()).toBe(false)
    expect(controller.draft.value).toBe('New')
    expect(controller.error.value).toBe('Disk unavailable')
    let finish!: (value: BookmarkCollectionSnapshot) => void
    api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = controller.save()
    open.value = true
    open.value = false
    open.value = true
    await Promise.resolve()
    controller.beginEdit('one')
    controller.draft.value = 'Newer draft'
    finish({ revision: 2, collections: [{ id: 'new', name: 'New', bookmarkIds: [] }] })
    expect(await pending).toBe(false)
    expect(controller.draft.value).toBe('Newer draft')
    expect(controller.editor.value).toBe('edit:one')
  } finally { controller.dispose() }
})

it('deduplicates pending actions and does not override a newer collection selection on save', async () => {
  const { controller, api } = fixture()
  try {
    let finish!: (value: BookmarkCollectionSnapshot) => void
    api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    controller.beginEdit()
    controller.draft.value = 'Project'
    const pending = controller.save()
    expect(await controller.save()).toBe(false)
    controller.selection.value = 'unfiled'
    finish({ revision: 2, collections: [{ id: 'project', name: 'Project', bookmarkIds: [] }] })
    expect(await pending).toBe(true)
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(controller.selection.value).toBe('unfiled')
  } finally { controller.dispose() }
})

it('discards late errors and notifications after disposal', async () => {
  const { controller, api, notify, unsubscribe } = fixture()
  let reject!: (error: Error) => void
  api.assign.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const pending = controller.assign('a', null)
  controller.dispose()
  notify({ revision: 100, collections: [] })
  reject(new Error('Late failure'))
  expect(await pending).toBe(false)
  expect(controller.error.value).toBe('')
  expect(controller.collections.value).toHaveLength(1)
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it.each(['create', 'rename'] as const)('keeps a cancelled %s save committed without reopening its editor', async action => {
  const { controller, api } = fixture()
  try {
    let finish!: (value: BookmarkCollectionSnapshot) => void
    api[action].mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    controller.beginEdit(action === 'create' ? undefined : 'one')
    controller.draft.value = 'Saved'
    const pending = controller.save()
    controller.cancelEdit()
    const next = { revision: 2, collections: [{ id: 'one', name: 'Saved', bookmarkIds: ['a'] }] }
    finish(next)
    expect(await pending).toBe(false)
    expect(controller.collections.value).toEqual(next.collections)
    expect(controller.editor.value).toBeNull()
    expect(controller.pending.value).toBe(false)
    expect(controller.error.value).toBe('')
  } finally { controller.dispose() }
})

it.each(['cancel', 'cancel-reopen', 'external-removal', 'dispose'] as const)('withholds late rename failure after %s', async scenario => {
  const { controller, api, open, notify } = fixture()
  try {
    open.value = true
    await Promise.resolve()
    await Promise.resolve()
    let fail!: (error: Error) => void
    api.rename.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    controller.beginEdit('one')
    controller.draft.value = 'Submitted'
    const pending = controller.save()
    if (scenario === 'external-removal') notify({ revision: 2, collections: [] })
    else if (scenario === 'dispose') controller.dispose()
    else controller.cancelEdit()
    if (scenario === 'cancel-reopen') {
      // A reopened panel can start a new editor with the same collection and draft.
      open.value = false
      open.value = true
      await Promise.resolve()
      await Promise.resolve()
      controller.beginEdit('one')
      controller.draft.value = 'Submitted'
    }
    fail(new Error('Old save failure'))
    expect(await pending).toBe(false)
    expect(controller.error.value).toBe('')
    if (scenario === 'cancel-reopen') {
      expect(controller.editor.value).toBe('edit:one')
      expect(controller.draft.value).toBe('Submitted')
    }
    if (scenario !== 'dispose') expect(controller.pending.value).toBe(false)
  } finally { controller.dispose() }
})

it.each(['remove', 'assign'] as const)('preserves %s failure feedback when an unrelated editor is cancelled', async action => {
  const { controller, api } = fixture()
  try {
    controller.selection.value = 'c:one'
    let fail!: (error: Error) => void
    api[action].mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const pending = action === 'remove' ? controller.remove() : controller.assign('a', null)
    controller.cancelEdit()
    fail(new Error('Operation failed'))
    expect(await pending).toBe(false)
    expect(controller.error.value).toBe('Operation failed')
    expect(controller.pending.value).toBe(false)
  } finally { controller.dispose() }
})

it('shows a main-process failure without Electron\'s IPC wrapper', async () => {
  const { controller, api } = fixture()
  try {
    controller.beginEdit()
    controller.draft.value = 'New'
    api.create.mockRejectedValueOnce(new Error("Error invoking remote method 'bookmark-collections:create': Error: A collection with this name already exists."))
    expect(await controller.save()).toBe(false)
    expect(controller.error.value).toBe('A collection with this name already exists.')
  } finally { controller.dispose() }
})
