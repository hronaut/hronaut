<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookmarkCollectionsController } from '../composables/useBookmarkCollectionsController.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{ controller: BookmarkCollectionsController; blocked: boolean }>()
const { t } = useI18n({ useScope: 'global' })
const { collections, selection, selected, pending, error, editor, draft } = props.controller
const nameInput = ref<HTMLInputElement | null>(null)
const filter = ref<HTMLSelectElement | null>(null)
const root = ref<HTMLElement | null>(null)

async function begin(id?: string): Promise<void> {
  const element = root.value
  props.controller.beginEdit(id)
  await nextTick()
  if (element?.isConnected) nameInput.value?.focus()
}

async function finish(operation: () => void | Promise<unknown>): Promise<void> {
  const element = root.value
  const focused = document.activeElement
  const ownedFocus = focused instanceof HTMLElement && element?.contains(focused)
  await operation()
  await nextTick()
  if (!ownedFocus || !element?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  if (editor.value) nameInput.value?.focus()
  else filter.value?.focus()
}

defineExpose({ cancelEdit: () => { void finish(props.controller.cancelEdit) } })

function keydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void finish(props.controller.cancelEdit)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void finish(props.controller.save)
  }
}
</script>

<template>
  <div ref="root" class="bookmark-collections">
    <label class="bookmark-collection-filter">
      <span>{{ t('bookmarks.collection') }}</span>
      <select ref="filter" v-model="selection" :aria-label="t('bookmarks.collectionFilter')">
        <option value="all">{{ t('bookmarks.allCollections') }}</option>
        <option value="unfiled">{{ t('bookmarks.unfiled') }}</option>
        <option v-for="collection in collections" :key="collection.id" :value="`c:${collection.id}`">{{ collection.name }}</option>
      </select>
    </label>
    <div class="bookmark-collection-actions">
      <UiButton appearance="application" type="button" :disabled="blocked || pending || collections.length >= 50" @click="begin()">{{ t('bookmarks.newCollection') }}</UiButton>
      <UiButton v-if="selected" appearance="application" type="button" :disabled="blocked || pending" @click="begin(selected.id)">{{ t('bookmarks.renameCollection') }}</UiButton>
      <UiButton v-if="selected" appearance="application" type="button" :disabled="blocked || pending" :title="t('bookmarks.removeCollectionHint')" @click="finish(controller.remove)">{{ t('bookmarks.removeCollection') }}</UiButton>
    </div>
    <div v-if="editor" class="bookmark-collection-editor">
      <input ref="nameInput" v-model="draft" :aria-label="t('bookmarks.collectionName')" maxlength="80" :disabled="blocked || pending" @keydown="keydown" />
      <UiButton appearance="application" type="button" :disabled="blocked || pending || !draft.trim()" @click="finish(controller.save)">{{ t('bookmarks.saveCollection') }}</UiButton>
      <UiButton appearance="application" type="button" @click="finish(controller.cancelEdit)">{{ t('bookmarks.cancelCollection') }}</UiButton>
    </div>
    <p v-if="selected" class="bookmark-collection-hint">{{ t('bookmarks.removeCollectionHint') }}</p>
    <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
  </div>
</template>
