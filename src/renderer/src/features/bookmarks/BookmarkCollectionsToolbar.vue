<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookmarkTabsResult } from '../../../../shared/types.js'
import type { BookmarkCollectionsController } from './useBookmarkCollectionsController.js'
import { isImeCompositionEvent } from '../../keyboard-composition.js'
import UiButton from '../../ui/UiButton.vue'
import { vTooltip } from '../../ui/tooltip.js'

const props = defineProps<{ controller: BookmarkCollectionsController; blocked: boolean; formatNumber: (value: number) => string }>()
const { t } = useI18n({ useScope: 'global' })
const { collections, selection, selected, pending, error, editor, draft, tabsResult } = props.controller
const nameInput = ref<HTMLInputElement | null>(null)
const filter = ref<HTMLSelectElement | null>(null)
const root = ref<HTMLElement | null>(null)
const tabsQuestionId = `bookmark-all-tabs-${useId()}`
const namingTabs = computed(() => editor.value?.startsWith('tabs:') === true)
/** Where the keyboard was when Bookmark all tabs asked, while its name field waits for a change under way to end. */
let tabsAskedFrom: Element | null | undefined

function counted(key: string, count: number, values: Record<string, string> = {}): string {
  return t(key, { ...values, count: props.formatNumber(count) }, count)
}

function tabsMessage(result: BookmarkTabsResult): string {
  const name = collections.value.find(collection => collection.id === result.collectionId)?.name ?? ''
  const sentences = [counted('bookmarks.allTabs.saved', result.saved, { name })]
  if (result.inOtherCollections) sentences.push(counted('bookmarks.allTabs.inOtherCollections', result.inOtherCollections))
  if (result.notWebPages) sentences.push(counted('bookmarks.allTabs.notWebPages', result.notWebPages))
  if (result.overLimit) sentences.push(counted('bookmarks.allTabs.overLimit', result.overLimit, { max: props.formatNumber(result.limit) }))
  return sentences.join(' ')
}

/**
 * Bookmark all tabs takes the keyboard to the name, selected so typing replaces it, as Chrome's dialog does. While
 * another change is under way the field waits, and then takes the keyboard only if it is still where it was.
 */
async function beginTabs(workspaceId: string | null, name: string): Promise<void> {
  props.controller.beginTabs(workspaceId, name)
  tabsAskedFrom = document.activeElement
  await focusTabsName(true)
}

async function focusTabsName(asked = false): Promise<void> {
  await nextTick()
  const input = nameInput.value
  if (tabsAskedFrom === undefined || !namingTabs.value || !input?.isConnected) return
  if (input.disabled) return
  const focused = document.activeElement
  const moved = !asked && focused !== tabsAskedFrom && focused !== null && focused !== document.body
  tabsAskedFrom = undefined
  if (moved) return
  input.focus()
  input.select()
}

watch(() => props.blocked || pending.value, busy => { if (!busy) void focusTabsName() })

// A suggested name renumbered while it is selected, as when a collection takes the name meanwhile, stays selected,
// so typing still replaces it. The field still shows the name it had here; once the person types, it shows theirs.
watch(draft, async (_name, previous) => {
  const input = nameInput.value
  if (!namingTabs.value || !input || document.activeElement !== input) return
  if (input.value !== previous || input.selectionStart !== 0 || input.selectionEnd !== previous.length) return
  await nextTick()
  if (document.activeElement === input) input.select()
})

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

defineExpose({ cancelEdit: () => { void finish(props.controller.cancelEdit) }, beginTabs })

function keydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void finish(props.controller.cancelEdit)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    // A held Enter, such as the one that ran Bookmark all tabs from the command palette, does not save a name the
    // person has not seen yet.
    if (!event.repeat) void finish(props.controller.save)
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
      <UiButton v-if="selected" appearance="application" type="button" :disabled="blocked || pending" v-tooltip="t('bookmarks.removeCollectionHint')" @click="finish(controller.remove)">{{ t('bookmarks.removeCollection') }}</UiButton>
    </div>
    <div v-if="editor" class="bookmark-collection-editor" :role="namingTabs ? 'group' : undefined" :aria-labelledby="namingTabs ? tabsQuestionId : undefined">
      <p v-if="namingTabs" :id="tabsQuestionId"><strong>{{ t('bookmarks.allTabs.heading') }}</strong> {{ t('bookmarks.allTabs.hint') }}</p>
      <input ref="nameInput" v-model="draft" :aria-label="t('bookmarks.collectionName')" maxlength="80" :disabled="blocked || pending" @keydown="keydown" />
      <UiButton appearance="application" type="button" :disabled="blocked || pending || !draft.trim()" @click="finish(controller.save)">{{ namingTabs ? t('bookmarks.allTabs.save') : t('bookmarks.saveCollection') }}</UiButton>
      <UiButton appearance="application" type="button" @click="finish(controller.cancelEdit)">{{ namingTabs ? t('bookmarks.allTabs.cancel') : t('bookmarks.cancelCollection') }}</UiButton>
    </div>
    <p v-if="tabsResult" class="bookmarks-feedback" role="status">{{ tabsMessage(tabsResult) }}</p>
    <p v-if="selected" class="bookmark-collection-hint">{{ t('bookmarks.removeCollectionHint') }}</p>
    <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
  </div>
</template>
