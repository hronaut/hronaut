<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconEdit from '~icons/material-symbols/edit-rounded'
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
  setEditingInput,
  filteredBookmarks,
  cancelRename,
  toggle,
  toggleCurrent,
  openEntry,
  beginRename,
  commitRename,
  remove,
  handleEscape,
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
  removeBookmark: props.removeBookmark,
  openBookmark: props.openBookmark
})

defineExpose({ toggle, toggleCurrent, handleEscape })
onBeforeUnmount(dispose)

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
      <article v-for="bookmark in filteredBookmarks" :key="bookmark.id" class="bookmark-item" :class="{ current: bookmark.id === currentBookmark?.id }">
        <div v-if="editingBookmarkId === bookmark.id" class="bookmark-open bookmark-editor">
          <span class="bookmark-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="bookmark-copy">
            <input
              :ref="setEditingInput"
              v-model="editingBookmarkTitle"
              :aria-label="t('bookmarks.renameAria', { title: bookmark.title })"
              :disabled="pendingAction !== null"
              maxlength="200"
              @keydown="handleRenameKeydown($event, bookmark.id)"
            />
            <span>{{ bookmark.url }}</span>
          </span>
        </div>
        <UiButton appearance="application" v-else class="bookmark-open" type="button" :title="bookmark.url" :disabled="pendingAction !== null" @click="openEntry(bookmark)">
          <span class="bookmark-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="bookmark-copy">
            <strong>{{ bookmark.title }}</strong>
            <span>{{ bookmark.url }}</span>
          </span>
        </UiButton>
        <UiButton appearance="application" v-if="editingBookmarkId === bookmark.id" class="bookmark-action confirm" type="button" :disabled="pendingAction !== null" :aria-label="t('bookmarks.saveAria', { title: bookmark.title })" :title="t('bookmarks.save')" @click="commitRename(bookmark.id)"><IconCheck aria-hidden="true" /></UiButton>
        <UiButton appearance="application" v-else class="bookmark-action" type="button" :disabled="pendingAction !== null" :aria-label="t('bookmarks.renameAria', { title: bookmark.title })" :title="t('bookmarks.rename')" @click="beginRename(bookmark)"><IconEdit aria-hidden="true" /></UiButton>
        <UiButton appearance="application" variant="danger" class="bookmark-action danger" type="button" :disabled="pendingAction !== null" :aria-label="t('bookmarks.removeAria', { title: bookmark.title })" :title="t('bookmarks.remove')" @click="remove(bookmark.id)"><IconDelete aria-hidden="true" /></UiButton>
      </article>
    </div>
    <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
  </section>
</template>
