<script setup lang="ts">
import UiButton from '../../ui/UiButton.vue'
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookmarksOpenAllController } from './useBookmarksOpenAll.js'
import { ignoreHeldEnter } from '../../held-enter.js'
import { vTooltip } from '../../ui/tooltip.js'

const props = defineProps<{
  controller: BookmarksOpenAllController
  /** How many bookmarks the list shows. */
  count: number
  /** Another bookmark change is under way. */
  blocked: boolean
  formatNumber: (value: number) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const { pending, asking, opened, error } = props.controller
const questionId = `bookmarks-open-all-question-${useId()}`
const row = ref<HTMLElement | null>(null)
const question = ref<HTMLElement | null>(null)

function counted(key: string, count: number): string {
  return t(key, { count: props.formatNumber(count) }, count)
}

const dropped = () => document.hasFocus() && (!document.activeElement || document.activeElement === document.body)

/**
 * The question takes the keyboard to Cancel, so it is heard and a held Enter answers nothing: every button here
 * ignores the key's repeats. Once it is answered or dropped, the keyboard goes back to Open all rather than to the page.
 */
watch(asking, async isAsking => {
  await nextTick()
  if (isAsking) question.value?.querySelector<HTMLElement>('.bookmarks-open-all-cancel')?.focus()
  else if (dropped()) row.value?.querySelector('button')?.focus()
}, { flush: 'post' })

// The list can empty while the keyboard is here, and these controls then go: the keyboard goes to the panel's search,
// or to Close, as when a focused bookmark goes.
onBeforeUnmount(() => {
  const panel = row.value?.closest('.bookmarks-panel')
  const focused = document.activeElement
  if (!panel || !focused || !(row.value?.contains(focused) || question.value?.contains(focused))) return
  void nextTick(() => {
    if (!panel.isConnected || !dropped()) return
    const target = [panel.querySelector<HTMLElement>('.bookmark-search-field input'), panel.querySelector<HTMLElement>('.panel-close')]
      .find(element => element?.isConnected && !element.matches(':disabled'))
    target?.focus()
  })
})
</script>

<template>
  <div ref="row" class="bookmarks-open-all">
    <UiButton
      appearance="application"
      type="button"
      :aria-disabled="pending || blocked || asking"
      v-tooltip="t('bookmarks.openAll.hint')"
      @keydown="ignoreHeldEnter"
      @click="controller.request"
    >{{ t('bookmarks.openAll.button', { count: formatNumber(count) }) }}</UiButton>
  </div>
  <div v-if="asking" ref="question" class="bookmarks-open-all-ask" role="group" :aria-labelledby="questionId">
    <p :id="questionId">{{ counted('bookmarks.openAll.ask', count) }}</p>
    <UiButton appearance="application" type="button" :aria-disabled="blocked" @keydown="ignoreHeldEnter" @click="controller.confirm">{{ counted('bookmarks.openAll.confirm', count) }}</UiButton>
    <UiButton class="bookmarks-open-all-cancel" appearance="application" type="button" @keydown="ignoreHeldEnter" @click="controller.cancel">{{ t('bookmarks.openAll.cancel') }}</UiButton>
  </div>
  <p v-if="opened" class="bookmarks-feedback" role="status">{{ counted('bookmarks.openAll.opened', opened) }}</p>
  <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
</template>
