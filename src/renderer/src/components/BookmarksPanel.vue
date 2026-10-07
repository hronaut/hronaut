<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconEdit from '~icons/material-symbols/edit-rounded'
import IconLink from '~icons/material-symbols/link-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconStarOutline from '~icons/material-symbols/star-outline-rounded'
import type { BrowserBookmark, PanelDock } from '../../../shared/types.js'
import { useBookmarksPanelController } from '../composables/useBookmarksPanelController.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  activeUrl: string | null
  activeTitle: string
  currentBookmark?: BrowserBookmark
  listBookmarks: () => Promise<BrowserBookmark[]>
  addBookmark: (url: string, title: string) => Promise<BrowserBookmark[]>
  renameBookmark: (id: string, title: string) => Promise<BrowserBookmark[]>
  updateBookmarkDestination: (id: string, url: string) => Promise<BrowserBookmark[]>
  removeBookmark: (id: string) => Promise<BrowserBookmark[]>
  openBookmark: (bookmark: BrowserBookmark) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const bookmarks = defineModel<BrowserBookmark[]>('bookmarks', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
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
  openBookmark: props.openBookmark
})

defineExpose({ toggle, toggleCurrent, handleEscape })
onBeforeUnmount(dispose)

async function finishRename(operation: () => void | Promise<void>): Promise<void> {
  const focused = document.activeElement
  const row = focused instanceof HTMLElement
    && (focused.closest('.bookmark-editor') || focused.closest('.bookmark-action.confirm'))
    ? focused.closest('.bookmark-item')
    : null
  const panel = row?.closest('.bookmarks-panel')
  const wasDestination = editingDestination.value
  await operation()
  await nextTick()
  if (!open.value || editingBookmarkId.value || !panel?.isConnected) return
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
  const focused = event.currentTarget instanceof HTMLButtonElement
    && document.activeElement === event.currentTarget ? event.currentTarget : null
  const row = focused?.closest('.bookmark-item')
  const panel = row?.closest('.bookmarks-panel')
  const next = row?.nextElementSibling?.querySelector<HTMLButtonElement>('.bookmark-action.danger')
  const previous = row?.previousElementSibling?.querySelector<HTMLButtonElement>('.bookmark-action.danger')
  await removeEntry(bookmarkId)
  await nextTick()
  if (!open.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [focused, next, previous,
    panel.querySelector<HTMLInputElement>('.bookmark-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}

function handleEscape(): void {
  if (editingBookmarkId.value) cancelRename()
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
    class="bookmarks-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="bookmarks-title"
    :aria-busy="pendingAction !== null"
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
          :disabled="!activeUrl || pendingAction !== null"
          @click="toggleCurrent"
        >{{ currentBookmark ? t('bookmarks.removeCurrent') : t('bookmarks.addCurrent') }}</UiButton>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('bookmarks.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="bookmarks.length" class="bookmark-search-field">
      <IconSearch aria-hidden="true" />
      <input v-model="query" type="search" :aria-label="t('bookmarks.search')" autocomplete="off" spellcheck="false" :placeholder="t('bookmarks.search')" />
    </div>
    <div v-if="!bookmarks.length" class="bookmarks-empty">
      <IconStarOutline aria-hidden="true" />
      <strong>{{ t('bookmarks.empty') }}</strong>
      <span>{{ t('bookmarks.emptyDescription') }}</span>
    </div>
    <div v-else-if="!filteredBookmarks.length" class="bookmarks-empty compact">
      <IconSearch aria-hidden="true" />
      <strong>{{ t('bookmarks.noMatches') }}</strong>
      <span>{{ t('bookmarks.tryAnother') }}</span>
    </div>
    <div v-else class="bookmarks-list">
      <article v-for="bookmark in filteredBookmarks" :key="bookmark.id" class="bookmark-item" :class="{ current: bookmark.id === currentBookmark?.id, editing: editingBookmarkId === bookmark.id }">
        <div v-if="editingBookmarkId === bookmark.id" class="bookmark-open bookmark-editor">
          <span class="bookmark-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="bookmark-copy">
            <input
              v-if="editingDestination"
              :ref="setEditingInput"
              v-model="editingBookmarkUrl"
              type="url"
              :aria-label="t('bookmarks.destinationAria', { title: bookmark.title })"
              :disabled="pendingAction !== null"
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
              :disabled="pendingAction !== null"
              maxlength="200"
              @keydown="handleRenameKeydown($event, bookmark.id)"
            />
            <span>{{ editingDestination ? bookmark.title : bookmark.url }}</span>
          </span>
        </div>
        <UiButton appearance="application" v-else class="bookmark-open" type="button" :title="bookmark.url" :disabled="pendingAction !== null" @click="openEntry(bookmark)">
          <span class="bookmark-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="bookmark-copy">
            <strong>{{ bookmark.title }}</strong>
            <span>{{ bookmark.url }}</span>
          </span>
        </UiButton>
        <UiButton appearance="application" v-if="editingBookmarkId === bookmark.id" class="bookmark-action confirm" type="button" :disabled="pendingAction !== null" :aria-label="t(editingDestination ? 'bookmarks.saveDestinationAria' : 'bookmarks.saveAria', { title: bookmark.title })" :title="t(editingDestination ? 'bookmarks.saveDestination' : 'bookmarks.save')" @click="commitRename(bookmark.id)"><IconCheck aria-hidden="true" /></UiButton>
        <UiButton appearance="application" v-else class="bookmark-action" type="button" :disabled="pendingAction !== null" :aria-label="t('bookmarks.renameAria', { title: bookmark.title })" :title="t('bookmarks.rename')" @click="beginRename(bookmark)"><IconEdit aria-hidden="true" /></UiButton>
        <UiButton appearance="application" v-if="editingBookmarkId !== bookmark.id" class="bookmark-action bookmark-destination" type="button" :disabled="pendingAction !== null" :aria-label="t('bookmarks.destinationAria', { title: bookmark.title })" :title="t('bookmarks.destination')" @click="beginRename(bookmark, true)"><IconLink aria-hidden="true" /></UiButton>
        <UiButton appearance="application" variant="danger" class="bookmark-action danger" type="button" :disabled="pendingAction !== null" :aria-label="t('bookmarks.removeAria', { title: bookmark.title })" :title="t('bookmarks.remove')" @click="remove(bookmark.id, $event)"><IconDelete aria-hidden="true" /></UiButton>
      </article>
    </div>
    <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
  </section>
</template>
