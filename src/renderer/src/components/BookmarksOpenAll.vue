<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserBookmark } from '../../../shared/types.js'
import { friendlyUiError } from '../composables/useAppToastController.js'
import { ignoreHeldEnter } from '../held-enter.js'
import { vTooltip } from '../ui/tooltip.js'

/** Chrome asks before opening more than this many bookmarks at once. */
const OPEN_WITHOUT_ASKING = 15

const props = defineProps<{
  /** The bookmarks the list shows, in its order. */
  bookmarks: readonly BrowserBookmark[]
  /** Another bookmark change is under way. */
  blocked: boolean
  openInBackground: (bookmark: BrowserBookmark) => Promise<void>
  formatNumber: (value: number) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const pending = ref(false)
/** The bookmarks Open all asks about before opening them, as the list showed them. */
const asking = ref<readonly BrowserBookmark[] | null>(null)
const status = ref('')
const error = ref('')

// A question about other bookmarks than those listed is not asked any more.
watch(() => props.bookmarks.map(bookmark => bookmark.id).join('\n'), () => { asking.value = null })

function counted(key: string, count: number): string {
  return t(key, { count: props.formatNumber(count) }, count)
}

/**
 * Opens every bookmark the list shows in a tab behind this one, in the list's order, as Chrome's Open all does with a
 * folder, after asking when that is more than 15 tabs. Opening stops at the first tab that cannot open, such as at
 * Hronaut's tab limit, and says how many did.
 */
async function openAll(bookmarks: readonly BrowserBookmark[]): Promise<void> {
  if (pending.value || props.blocked || !bookmarks.length) return
  status.value = ''
  error.value = ''
  if (!asking.value && bookmarks.length > OPEN_WITHOUT_ASKING) {
    asking.value = bookmarks
    return
  }
  asking.value = null
  pending.value = true
  let opened = 0
  try {
    for (const bookmark of bookmarks) {
      await props.openInBackground(bookmark)
      opened += 1
    }
  } catch (cause) {
    error.value = friendlyUiError(cause, t('runtime.toast.actionFailed'))
  } finally {
    pending.value = false
    if (opened) status.value = counted('bookmarks.openAll.opened', opened)
  }
}

/** Open all asks once; while it asks, its own buttons answer. */
function request(): void {
  if (!asking.value) void openAll(props.bookmarks)
}
</script>

<template>
  <div class="bookmarks-open-all">
    <UiButton
      appearance="application"
      type="button"
      :aria-disabled="pending || blocked"
      v-tooltip="t('bookmarks.openAll.hint')"
      @keydown="ignoreHeldEnter"
      @click="request"
    >{{ t('bookmarks.openAll.button', { count: formatNumber(bookmarks.length) }) }}</UiButton>
  </div>
  <div v-if="asking" class="bookmarks-open-all-ask" role="group" aria-labelledby="bookmarks-open-all-question">
    <p id="bookmarks-open-all-question" role="status">{{ counted('bookmarks.openAll.ask', asking.length) }}</p>
    <UiButton appearance="application" type="button" :aria-disabled="blocked" @keydown="ignoreHeldEnter" @click="openAll(asking)">{{ counted('bookmarks.openAll.confirm', asking.length) }}</UiButton>
    <UiButton appearance="application" type="button" @keydown="ignoreHeldEnter" @click="asking = null">{{ t('bookmarks.openAll.cancel') }}</UiButton>
  </div>
  <p v-if="status" class="bookmarks-feedback" role="status">{{ status }}</p>
  <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
</template>
