import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BookmarksPanel from '../../src/renderer/src/components/BookmarksPanel.vue'
import { useBookmarkCollectionsController } from '../../src/renderer/src/composables/useBookmarkCollectionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import type { BookmarkCollectionSnapshot, BookmarkTabsOutcome, BrowserBookmark } from '../../src/shared/types.js'
import { ref } from 'vue'

function bookmark(id: string): BrowserBookmark {
  return { id, url: `https://example.test/${id}`, title: `Page ${id}`, createdAt: '2026-08-22T09:00:00.000Z', updatedAt: '2026-08-22T09:00:00.000Z' }
}

const client: BookmarkCollectionSnapshot = { revision: 1, collections: [{ id: 'client', name: 'Client A', bookmarkIds: [] }] }

function api(list: () => Promise<BookmarkCollectionSnapshot> = async () => client) {
  let changed!: (snapshot: BookmarkCollectionSnapshot) => void
  return {
    list: vi.fn(list),
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), assign: vi.fn(),
    bookmarkTabs: vi.fn(async (_workspaceId: string | null, name: string): Promise<BookmarkTabsOutcome> => ({
      snapshot: { revision: 2, collections: [...client.collections, { id: 'new', name, bookmarkIds: ['one', 'two'] }] },
      result: { collectionId: 'new', saved: 2, inOtherCollections: 1, notWebPages: 0, overLimit: 0, limit: 500 }
    })),
    onChanged: vi.fn((callback: typeof changed) => { changed = callback; return vi.fn() }),
    changed: (snapshot: BookmarkCollectionSnapshot) => changed(snapshot)
  }
}

const mounted: { unmount(): void }[] = []
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()) })

function mountPanel(collectionsApi: ReturnType<typeof api>, overrides: Record<string, unknown> = {}, locale: SupportedLocale = 'en-US') {
  const wrapper = mount(BookmarksPanel, {
    attachTo: document.body,
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      open: true,
      bookmarks: [bookmark('one'), bookmark('two')],
      dock: 'right' as const,
      activeUrl: 'https://example.test/one',
      activeTitle: 'Page one',
      listBookmarks: vi.fn(async () => [bookmark('one'), bookmark('two')]),
      addBookmark: vi.fn(async () => []),
      updateBookmarkDestination: vi.fn(async () => []),
      renameBookmark: vi.fn(async () => []),
      removeBookmark: vi.fn(async () => []),
      copyBookmarkAddress: vi.fn(async () => undefined),
      openBookmarkInBackground: vi.fn(async () => undefined),
      openBookmark: vi.fn(async () => undefined),
      exportBookmarks: vi.fn(async () => null),
      importBookmarks: vi.fn(async () => null),
      formatNumber: (value: number) => value.toLocaleString(locale),
      collectionsApi,
      ...overrides
    }
  })
  mounted.push(wrapper)
  const exposed = wrapper.vm as unknown as { bookmarkAllTabs(workspaceId: string | null, suggestedName?: string): Promise<void> }
  return { wrapper, exposed }
}

const nameField = () => document.querySelector<HTMLInputElement>('.bookmark-collection-editor input')

describe('Bookmark all tabs in the Bookmarks panel', () => {
  it('asks for the name with the keyboard on it, selected and numbered, and saves the tabs with Enter', async () => {
    const collections = api()
    const { wrapper, exposed } = mountPanel(collections)
    await flushPromises()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    const group = wrapper.get('.bookmark-collection-editor')
    expect(group.attributes('role')).toBe('group')
    expect(document.getElementById(group.attributes('aria-labelledby')!)!.textContent)
      .toBe('Bookmark all tabs The open tabs go in a new collection with this name.')
    const input = nameField()!
    expect(input.value).toBe('Client A (2)')
    expect(input).toHaveFocus()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Client A (2)'.length])
    expect(wrapper.get('.bookmark-collection-editor').text()).toContain('Bookmark tabs')

    await wrapper.get('.bookmark-collection-editor input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(collections.bookmarkTabs).toHaveBeenCalledExactlyOnceWith('workspace-1', 'Client A (2)')
    expect(nameField()).toBeNull()
    expect(wrapper.get<HTMLSelectElement>('.bookmark-collection-filter select').element.value).toBe('c:new')
    expect(wrapper.get('.bookmarks-feedback[role="status"]').text())
      .toBe('Added 2 pages to Client A (2). 1 was already in another collection, so it stayed there.')
    // The keyboard goes back to the collection filter, as after any other collection change.
    expect(wrapper.get('.bookmark-collection-filter select').element).toHaveFocus()
  })

  it('saves only on a new Enter, not one held from the command palette', async () => {
    const collections = api()
    const { wrapper, exposed } = mountPanel(collections)
    await flushPromises()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    const input = wrapper.get('.bookmark-collection-editor input')
    await input.trigger('keydown', { key: 'Enter', repeat: true })
    await flushPromises()
    expect(collections.bookmarkTabs).not.toHaveBeenCalled()
    expect(nameField()).toHaveFocus()
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(collections.bookmarkTabs).toHaveBeenCalledExactlyOnceWith('workspace-1', 'Client A (2)')
  })

  it('keeps a renumbered name selected, so typing still replaces it, unless the person moved in it', async () => {
    const collections = api()
    const { exposed } = mountPanel(collections)
    await flushPromises()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    const taken = (revision: number, ...names: string[]) => ({
      revision, collections: [...client.collections, ...names.map(name => ({ id: name, name, bookmarkIds: [] }))]
    })
    collections.changed(taken(2, 'Client A (2)'))
    await flushPromises()
    const input = nameField()!
    expect(input.value).toBe('Client A (3)')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Client A (3)'.length])
    input.setSelectionRange(3, 3)
    collections.changed(taken(3, 'Client A (2)', 'Client A (3)'))
    await flushPromises()
    expect(input.value).toBe('Client A (4)')
    expect(input.selectionStart).not.toBe(0)
    expect(input).toHaveFocus()
  })

  it('says at once that no collection can be added at the limit, rather than asking for a name', async () => {
    const full = { revision: 1, collections: Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, name: `Collection ${index}`, bookmarkIds: [] })) }
    const collections = api(async () => full)
    const { wrapper, exposed } = mountPanel(collections)
    await flushPromises()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    expect(nameField()).toBeNull()
    expect(wrapper.get('.bookmarks-error[role="alert"]').text()).toBe('Collection limit reached (50)')
    expect(collections.bookmarkTabs).not.toHaveBeenCalled()
  })

  it('waits for Open all to finish before the name can be saved', async () => {
    let opened!: () => void
    const openBookmarkInBackground = vi.fn(() => new Promise<void>(resolve => { opened = resolve }))
    const collections = api()
    const { wrapper, exposed } = mountPanel(collections, { openBookmarkInBackground })
    await flushPromises()
    await wrapper.get('.bookmarks-open-all button').trigger('click')
    await flushPromises()
    expect(openBookmarkInBackground).toHaveBeenCalledOnce()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    const input = nameField()!
    expect(input.disabled).toBe(true)
    // Cancel stays available.
    expect(wrapper.findAll('.bookmark-collection-editor button').map(button => button.attributes('disabled') !== undefined)).toEqual([true, false])
    opened()
    await flushPromises()
    opened()
    await flushPromises()
    expect(input.disabled).toBe(false)
    expect(input).toHaveFocus()
  })

  it('opens the panel when it is closed, and names the collection Open tabs without a workspace name', async () => {
    const collections = api(async () => ({ revision: 1, collections: [] }))
    const opened: { current?: { setProps(props: Record<string, unknown>): Promise<void> } } = {}
    const { wrapper, exposed } = mountPanel(collections, { open: false, 'onUpdate:open': (value: boolean) => opened.current?.setProps({ open: value }) })
    opened.current = wrapper
    await exposed.bookmarkAllTabs(null)
    await flushPromises()
    expect(wrapper.emitted('update:open')).toEqual([[true]])
    expect(nameField()!.value).toBe('Open tabs')
    expect(nameField()).toHaveFocus()
    await wrapper.get('.bookmark-collection-editor input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(collections.bookmarkTabs).toHaveBeenCalledExactlyOnceWith(null, 'Open tabs')
  })

  it('waits for the collections to load, numbers the name by them, and leaves the keyboard where it moved meanwhile', async () => {
    let loaded!: (snapshot: BookmarkCollectionSnapshot) => void
    const collections = api(() => new Promise(resolve => { loaded = resolve }))
    const { wrapper, exposed } = mountPanel(collections)
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    expect(nameField()!.value).toBe('Client A')
    expect(nameField()!.disabled).toBe(true)
    loaded(client)
    await flushPromises()
    expect(nameField()!.value).toBe('Client A (2)')
    expect(nameField()).toHaveFocus()

    // Asked again while loading, but the keyboard moved to Search before the field could take it.
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    const search = wrapper.get<HTMLInputElement>('.bookmark-search-field input').element
    search.focus()
    loaded(client)
    await flushPromises()
    expect(nameField()!.disabled).toBe(false)
    expect(search).toHaveFocus()
  })

  it('takes the question back with Escape and keeps the panel open', async () => {
    const collections = api()
    const { wrapper, exposed } = mountPanel(collections)
    await flushPromises()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    await wrapper.get('.bookmark-collection-editor input').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(nameField()).toBeNull()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(collections.bookmarkTabs).not.toHaveBeenCalled()
  })

  it('keeps the name to try again when the tabs cannot be saved', async () => {
    const collections = api()
    collections.bookmarkTabs.mockRejectedValueOnce(new Error('None of these tabs can go in a new collection: each shows no web page or is already in another collection.'))
    const { wrapper, exposed } = mountPanel(collections)
    await flushPromises()
    await exposed.bookmarkAllTabs('workspace-1', 'Client A')
    await flushPromises()
    await wrapper.get('.bookmark-collection-editor input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.bookmarks-error[role="alert"]').text()).toContain('None of these tabs can go in a new collection')
    expect(nameField()!.value).toBe('Client A (2)')
    expect(wrapper.find('.bookmarks-feedback').exists()).toBe(false)
  })

  // Each sentence in full, with pl/ru/uk's three plural forms.
  it.each([
    ['en-US', [1, 1, 1, 1], 'Added 1 page to Tabs. 1 was already in another collection, so it stayed there. 1 tab shows no web page, so it was left out. Hronaut keeps up to 500 bookmarks, so 1 was left out.'],
    ['ru-RU', [21, 1, 2, 1], '21 страница добавлена в Tabs. 1 уже была в другой коллекции и осталась там. 2 вкладки не показывают веб-страницу, поэтому пропущены. Hronaut хранит до 500 закладок, поэтому 1 пропущена.'],
    ['ru-RU', [3, 2, 5, 5], '3 страницы добавлены в Tabs. 2 уже были в других коллекциях и остались там. 5 вкладок не показывают веб-страницу, поэтому пропущены. Hronaut хранит до 500 закладок, поэтому 5 пропущено.'],
    ['ru-RU', [5, 5, 1, 2], '5 страниц добавлено в Tabs. 5 уже было в других коллекциях и осталось там. 1 вкладка не показывает веб-страницу, поэтому пропущена. Hronaut хранит до 500 закладок, поэтому 2 пропущены.'],
    ['uk-UA', [3, 5, 2, 1], '3 сторінки додано до Tabs. 5 вже було в інших колекціях і лишилося там. 2 вкладки не показують вебсторінку, тому їх пропущено. Hronaut зберігає до 500 закладок, тому 1 пропущено.'],
    ['pl-PL', [5, 1, 2, 22], 'Dodano 5 stron do Tabs. 1 była już w innej kolekcji, więc tam została. 2 karty nie pokazują strony internetowej, więc je pominięto. Hronaut przechowuje do 500 zakładek, więc pominięto 22.']
  ] as const)('says what it saved in %s for %j', async (locale, [saved, inOtherCollections, notWebPages, overLimit], expected) => {
    const collections = api()
    collections.bookmarkTabs.mockImplementationOnce(async (_workspaceId, name) => ({
      snapshot: { revision: 2, collections: [{ id: 'new', name, bookmarkIds: [] }] },
      result: { collectionId: 'new', saved, inOtherCollections, notWebPages, overLimit, limit: 500 }
    }))
    const { wrapper, exposed } = mountPanel(collections, {}, locale)
    await flushPromises()
    await exposed.bookmarkAllTabs(null, 'Tabs')
    await flushPromises()
    await wrapper.get('.bookmark-collection-editor input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.bookmarks-feedback').text()).toBe(expected)
  })
})

describe('Bookmark all tabs naming', () => {
  function controller(snapshot: BookmarkCollectionSnapshot = client) {
    const collections = api(async () => snapshot)
    const open = ref(true)
    const instance = useBookmarkCollectionsController({ open, blocked: ref(false), api: collections, translate: key => key })
    return { instance, collections }
  }

  it('numbers a name that a collection has, within 80 characters, and renumbers it while it is untouched', async () => {
    const { instance, collections } = controller({ revision: 1, collections: [{ id: 'long', name: 'x'.repeat(80), bookmarkIds: [] }] })
    try {
      await flushPromises()
      instance.beginTabs('w', 'x'.repeat(90))
      expect(instance.draft.value).toBe(`${'x'.repeat(76)} (2)`)
      collections.changed({ revision: 2, collections: [{ id: 'long', name: 'x'.repeat(80), bookmarkIds: [] }, { id: 'two', name: `${'x'.repeat(76)} (2)`, bookmarkIds: [] }] })
      expect(instance.draft.value).toBe(`${'x'.repeat(76)} (3)`)
      instance.draft.value = 'Mine'
      collections.changed({ revision: 3, collections: [{ id: 'mine', name: 'Mine', bookmarkIds: [] }] })
      expect(instance.draft.value).toBe('Mine')
    } finally { instance.dispose() }
  })

  it('does not renumber the name on its way, when its own snapshot comes first', async () => {
    const { instance, collections } = controller()
    try {
      await flushPromises()
      let finish!: (outcome: BookmarkTabsOutcome) => void
      collections.bookmarkTabs.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      instance.beginTabs('w', 'Tabs')
      const saving = instance.save()
      const snapshot = { revision: 2, collections: [...client.collections, { id: 'new', name: 'Tabs', bookmarkIds: ['one'] }] }
      collections.changed(snapshot)
      expect(instance.draft.value).toBe('Tabs')
      finish({ snapshot, result: { collectionId: 'new', saved: 1, inOtherCollections: 0, notWebPages: 0, overLimit: 0, limit: 500 } })
      expect(await saving).toBe(true)
      expect(instance.selection.value).toBe('c:new')
      expect(instance.tabsResult.value).toMatchObject({ collectionId: 'new', saved: 1 })
    } finally { instance.dispose() }
  })

  it('keeps a selection chosen while saving, and forgets what it did on the next change', async () => {
    const { instance, collections } = controller()
    try {
      await flushPromises()
      let finish!: (outcome: BookmarkTabsOutcome) => void
      collections.bookmarkTabs.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      instance.beginTabs(null, 'Tabs')
      const saving = instance.save()
      instance.selection.value = 'unfiled'
      finish({ snapshot: { revision: 2, collections: [...client.collections, { id: 'new', name: 'Tabs', bookmarkIds: [] }] }, result: { collectionId: 'new', saved: 1, inOtherCollections: 0, notWebPages: 0, overLimit: 0, limit: 500 } })
      expect(await saving).toBe(true)
      expect(instance.selection.value).toBe('unfiled')
      expect(instance.tabsResult.value).not.toBeNull()
      instance.beginEdit()
      expect(instance.tabsResult.value).toBeNull()
    } finally { instance.dispose() }
  })

  it('forgets what it did once its collection is gone, as when the collection is removed elsewhere', async () => {
    const { instance, collections } = controller()
    try {
      await flushPromises()
      instance.beginTabs(null, 'Tabs')
      expect(await instance.save()).toBe(true)
      expect(instance.tabsResult.value).toMatchObject({ collectionId: 'new' })
      collections.changed({ revision: 3, collections: [...client.collections, { id: 'new', name: 'Tabs', bookmarkIds: ['one'] }] })
      expect(instance.tabsResult.value).toMatchObject({ collectionId: 'new' })
      collections.changed({ revision: 4, collections: client.collections })
      expect(instance.tabsResult.value).toBeNull()
    } finally { instance.dispose() }
  })

  it('says the collection limit at once, with no name to type', async () => {
    const { instance } = controller({ revision: 1, collections: Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, name: `C ${index}`, bookmarkIds: [] })) })
    try {
      await flushPromises()
      instance.beginTabs('w', 'Tabs')
      expect(instance.editor.value).toBeNull()
      expect(instance.error.value).toBe('appErrors.bookmarks.collectionLimit')
    } finally { instance.dispose() }
  })
})
