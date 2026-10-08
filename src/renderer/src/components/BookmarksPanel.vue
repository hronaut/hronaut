<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconBackground from '~icons/material-symbols/tab-unselected-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconEdit from '~icons/material-symbols/edit-rounded'
import IconLink from '~icons/material-symbols/link-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconStarOutline from '~icons/material-symbols/star-outline-rounded'
import type { BrowserBookmark, HronautBookmarkCollectionsApi, PanelDock } from '../../../shared/types.js'
import { useBookmarksPanelController } from '../composables/useBookmarksPanelController.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import BookmarkCollectionsToolbar from './BookmarkCollectionsToolbar.vue'
import { useBookmarkCollectionsController } from '../composables/useBookmarkCollectionsController.js'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  collectionsApi?: HronautBookmarkCollectionsApi
  activeUrl: string | null
  activeTitle: string
  currentBookmark?: BrowserBookmark
  listBookmarks: () => Promise<BrowserBookmark[]>
  addBookmark: (url: string, title: string) => Promise<BrowserBookmark[]>
  renameBookmark: (id: string, title: string) => Promise<BrowserBookmark[]>
  updateBookmarkDestination: (id: string, url: string) => Promise<BrowserBookmark[]>
  removeBookmark: (id: string) => Promise<BrowserBookmark[]>
  openBookmark: (bookmark: BrowserBookmark) => Promise<void>
  openBookmarkInBackground: (bookmark: BrowserBookmark) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const bookmarks = defineModel<BrowserBookmark[]>('bookmarks', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const panelRoot = ref<HTMLElement | null>(null)
let focusGeneration = 0
const stopFocusSessionTracking = watch(open, () => { focusGeneration += 1 }, { flush: 'sync' })
const { t } = useI18n({ useScope: 'global' })
const {
  query,
  error,
  pendingAction,
  editingBookmarkId,
  editingBookmarkTitle,
  editingBookmarkUrl,
  editingDestination,
  setEditingInput,
  filteredBookmarks,
  cancelRename: cancelRenameDraft,
  toggle,
  toggleCurrent,
  openEntry,
  openInBackground,
  beginRename,
  commitRename: saveRenameDraft,
  remove: removeEntry,
  handleEscape: handlePanelEscape,
  dispose
} = useBookmarksPanelController({
  open,
  bookmarks,
  activeUrl: toRef(props, 'activeUrl'),
  activeTitle: toRef(props, 'activeTitle'),
  currentBookmark: toRef(props, 'currentBookmark'),
  listBookmarks: props.listBookmarks,
  addBookmark: props.addBookmark,
  renameBookmark: props.renameBookmark,
  updateBookmarkDestination: props.updateBookmarkDestination,
  removeBookmark: props.removeBookmark,
  openBookmark: props.openBookmark,
  openBookmarkInBackground: props.openBookmarkInBackground
})

const collectionController = useBookmarkCollectionsController({
  api: props.collectionsApi, open, blocked: computed(() => pendingAction.value !== null)
})
const { pending: collectionsPending, collections, selection } = collectionController
const anyPending = computed(() => pendingAction.value !== null || collectionsPending.value)
const visibleBookmarks = computed(() => filteredBookmarks.value.filter(bookmark => collectionController.includes(bookmark.id)))
const collectionsToolbar = ref<{ cancelEdit: () => void } | null>(null)
watch(selection, cancelRenameDraft)

// Authoritative bookmark and collection updates can remove a focused row
// without running one of this panel's action handlers.
const stopVisibleTracking = watch(() => visibleBookmarks.value.map(bookmark => bookmark.id), async (_ids, _previous, onCleanup) => {
  const focused = document.activeElement
  const panel = panelRoot.value
  const row = focused instanceof HTMLElement && panel?.contains(focused)
    ? focused.closest('.bookmark-item') : null
  if (!row || !panel || !(focused instanceof HTMLElement)) return
  const generation = focusGeneration
  let superseded = false
  onCleanup(() => { superseded = true })
  const assignment = focused.matches('.bookmark-collection-assignment select')
  const editing = focused.closest('.bookmark-editor') || focused.matches('.bookmark-action.confirm')
  const selector = assignment || editing ? null
    : focused.matches('.bookmark-open') ? 'button.bookmark-open'
      : focused.matches('.bookmark-background') ? '.bookmark-background'
        : focused.matches('.bookmark-destination') ? '.bookmark-destination'
          : focused.matches('.danger') ? '.bookmark-action.danger'
            : '.bookmark-action:not(.danger):not(.confirm):not(.bookmark-background):not(.bookmark-destination)'
  const next = selector ? row.nextElementSibling?.querySelector<HTMLElement>(selector) : null
  const previous = selector ? row.previousElementSibling?.querySelector<HTMLElement>(selector) : null
  await nextTick()
  if (superseded || generation !== focusGeneration || !open.value || panel !== panelRoot.value
    || !panel.isConnected || row.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [next, previous,
    assignment ? panel.querySelector<HTMLSelectElement>('.bookmark-collection-filter select') : null,
    panel.querySelector<HTMLInputElement>('.bookmark-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled, [aria-disabled="true"]'))
  target?.focus()
}, { flush: 'pre' })

onBeforeUnmount(() => {
  focusGeneration += 1
  stopVisibleTracking()
  stopFocusSessionTracking()
  collectionController.dispose()
  dispose()
})

async function assignCollection(bookmarkId: string, event: Event): Promise<void> {
  const generation = focusGeneration
  const select = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget : null
  if (!select) return
  const panel = select.closest('.bookmarks-panel')
  const focused = document.activeElement === select
  await collectionController.assign(bookmarkId, select.value || null)
  await nextTick()
  if (generation !== focusGeneration || !focused || !open.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== select) return
  if (select.isConnected) select.focus()
  else panel.querySelector<HTMLSelectElement>('.bookmark-collection-filter select')?.focus()
}

defineExpose({ toggle, toggleCurrent, handleEscape })

async function finishRename(operation: () => void | Promise<void>): Promise<void> {
  const generation = focusGeneration
  const focused = document.activeElement
  const row = focused instanceof HTMLElement
    && (focused.closest('.bookmark-editor') || focused.closest('.bookmark-action.confirm'))
    ? focused.closest('.bookmark-item')
    : null
  const panel = row?.closest('.bookmarks-panel')
  const wasDestination = editingDestination.value
  await operation()
  await nextTick()
  if (generation !== focusGeneration || !open.value || editingBookmarkId.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  if (row?.isConnected) row.querySelector<HTMLButtonElement>(wasDestination ? '.bookmark-destination' : '.bookmark-action:not(.danger)')?.focus()
  else panel.querySelector<HTMLInputElement>('.bookmark-search-field input')?.focus()
}

function cancelRename(): void {
  void finishRename(cancelRenameDraft)
}

function commitRename(bookmarkId: string): Promise<void> {
  return finishRename(() => saveRenameDraft(bookmarkId))
}

async function remove(bookmarkId: string, event: MouseEvent): Promise<void> {
  const generation = focusGeneration
  const focused = event.currentTarget instanceof HTMLButtonElement
    && document.activeElement === event.currentTarget ? event.currentTarget : null
  const row = focused?.closest('.bookmark-item')
  const panel = row?.closest('.bookmarks-panel')
  const next = row?.nextElementSibling?.querySelector<HTMLButtonElement>('.bookmark-action.danger')
  const previous = row?.previousElementSibling?.querySelector<HTMLButtonElement>('.bookmark-action.danger')
  await removeEntry(bookmarkId)
  await nextTick()
  if (generation !== focusGeneration || !open.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [focused, next, previous,
    panel.querySelector<HTMLInputElement>('.bookmark-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}

function handleEscape(): void {
  if (collectionController.editor.value) collectionsToolbar.value?.cancelEdit()
  else if (editingBookmarkId.value) cancelRename()
  else handlePanelEscape()
}

function handleRenameKeydown(event: KeyboardEvent, bookmarkId: string): void {
  if (isImeCompositionEvent(event)) return
  if (event.key === 'Enter') {
    event.preventDefault()
    void commitRename(bookmarkId)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}
</script>

<template>
  <section
    v-if="open"
    ref="panelRoot"
    class="bookmarks-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="bookmarks-title"
    :aria-busy="anyPending"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('bookmarks.kicker') }}</span>
        <h2 id="bookmarks-title">{{ t('bookmarks.heading') }}</h2>
      </div>
      <div class="bookmarks-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('bookmarks.heading') })" />
        <UiButton appearance="application"
          type="button"
          :disabled="!activeUrl || anyPending"
          @click="toggleCurrent"
        >{{ currentBookmark ? t('bookmarks.removeCurrent') : t('bookmarks.addCurrent') }}</UiButton>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('bookmarks.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <BookmarkCollectionsToolbar v-if="collectionsApi" ref="collectionsToolbar" :controller="collectionController" :blocked="pendingAction !== null" />
    <div v-if="bookmarks.length" class="bookmark-search-field">
      <IconSearch aria-hidden="true" />
      <input v-model="query" type="search" :aria-label="t('bookmarks.search')" autocomplete="off" spellcheck="false" :placeholder="t('bookmarks.search')" />
    </div>
    <div v-if="!bookmarks.length" class="bookmarks-empty">
      <IconStarOutline aria-hidden="true" />
      <strong>{{ t('bookmarks.empty') }}</strong>
      <span>{{ t('bookmarks.emptyDescription') }}</span>
    </div>
    <div v-else-if="!visibleBookmarks.length" class="bookmarks-empty compact">
      <IconSearch aria-hidden="true" />
      <strong>{{ t(!query.trim() && selection !== 'all' ? 'bookmarks.emptyCollection' : 'bookmarks.noMatches') }}</strong>
      <span>{{ t(!query.trim() && selection !== 'all' ? 'bookmarks.collectionEmptyHint' : 'bookmarks.tryAnother') }}</span>
    </div>
    <div v-else class="bookmarks-list">
      <article v-for="bookmark in visibleBookmarks" :key="bookmark.id" class="bookmark-item" :class="{ current: bookmark.id === currentBookmark?.id, editing: editingBookmarkId === bookmark.id }">
        <div v-if="editingBookmarkId === bookmark.id" class="bookmark-open bookmark-editor">
          <span class="bookmark-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="bookmark-copy">
            <input
              v-if="editingDestination"
              :ref="setEditingInput"
              v-model="editingBookmarkUrl"
              type="url"
              :aria-label="t('bookmarks.destinationAria', { title: bookmark.title })"
              :disabled="anyPending"
              maxlength="32768"
              autocomplete="off"
              spellcheck="false"
              @keydown="handleRenameKeydown($event, bookmark.id)"
            />
            <input
              v-else
              :ref="setEditingInput"
              v-model="editingBookmarkTitle"
              :aria-label="t('bookmarks.renameAria', { title: bookmark.title })"
              :disabled="anyPending"
              maxlength="200"
              @keydown="handleRenameKeydown($event, bookmark.id)"
            />
            <span>{{ editingDestination ? bookmark.title : bookmark.url }}</span>
          </span>
        </div>
        <UiButton appearance="application" v-else class="bookmark-open" type="button" :title="bookmark.url" :disabled="anyPending" @click="openEntry(bookmark)">
          <span class="bookmark-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="bookmark-copy">
            <strong>{{ bookmark.title }}</strong>
            <span>{{ bookmark.url }}</span>
          </span>
        </UiButton>
        <UiButton appearance="application" v-if="editingBookmarkId === bookmark.id" class="bookmark-action confirm" type="button" :disabled="anyPending" :aria-label="t(editingDestination ? 'bookmarks.saveDestinationAria' : 'bookmarks.saveAria', { title: bookmark.title })" :title="t(editingDestination ? 'bookmarks.saveDestination' : 'bookmarks.save')" @click="commitRename(bookmark.id)"><IconCheck aria-hidden="true" /></UiButton>
        <UiButton appearance="application" v-else class="bookmark-action" type="button" :disabled="anyPending" :aria-label="t('bookmarks.renameAria', { title: bookmark.title })" :title="t('bookmarks.rename')" @click="beginRename(bookmark)"><IconEdit aria-hidden="true" /></UiButton>
        <UiButton appearance="application" v-if="editingBookmarkId !== bookmark.id" class="bookmark-action bookmark-destination" type="button" :disabled="anyPending" :aria-label="t('bookmarks.destinationAria', { title: bookmark.title })" :title="t('bookmarks.destination')" @click="beginRename(bookmark, true)"><IconLink aria-hidden="true" /></UiButton>
        <UiButton appearance="application" v-if="editingBookmarkId !== bookmark.id" class="bookmark-action bookmark-background" type="button"
          :aria-disabled="anyPending"
          :aria-label="t('bookmarks.backgroundAria', { title: bookmark.title })"
          :title="t('bookmarks.background')"
          @click="openInBackground(bookmark)"><IconBackground aria-hidden="true" /></UiButton>
        <UiButton appearance="application" variant="danger" class="bookmark-action danger" type="button" :disabled="anyPending" :aria-label="t('bookmarks.removeAria', { title: bookmark.title })" :title="t('bookmarks.remove')" @click="remove(bookmark.id, $event)"><IconDelete aria-hidden="true" /></UiButton>
        <label v-if="collectionsApi && collections.length && editingBookmarkId !== bookmark.id" class="bookmark-collection-assignment">
          <span>{{ t('bookmarks.collection') }}</span>
          <select :value="collectionController.assignment(bookmark.id)" :disabled="anyPending" :aria-label="t('bookmarks.assignCollection', { title: bookmark.title })" @change="assignCollection(bookmark.id, $event)">
            <option value="">{{ t('bookmarks.unfiled') }}</option>
            <option v-for="collection in collections" :key="collection.id" :value="collection.id">{{ collection.name }}</option>
          </select>
        </label>
      </article>
    </div>
    <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
  </section>
</template>
