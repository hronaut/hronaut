<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookmarkImportResult } from '../../../shared/types.js'
import { friendlyUiError } from '../composables/useAppToastController.js'
import { ignoreHeldEnter } from '../held-enter.js'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  /** How many bookmarks there are; with none, there is nothing to export. */
  count: number
  /** Another bookmark change is under way. */
  blocked: boolean
  exportBookmarks: () => Promise<number | null>
  importBookmarks: () => Promise<BookmarkImportResult | null>
  formatNumber: (value: number) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const pending = ref<'import' | 'export' | null>(null)
const status = ref('')
const error = ref('')

function counted(key: string, count: number, values: Record<string, string> = {}): string {
  return t(key, { ...values, count: props.formatNumber(count) }, count)
}

function importMessage(result: BookmarkImportResult): string {
  const sentences = [result.added ? counted('bookmarks.file.imported', result.added) : t('bookmarks.file.nothingNew')]
  if (result.alreadySaved) sentences.push(counted('bookmarks.file.alreadySaved', result.alreadySaved))
  if (result.notWebPages) sentences.push(counted('bookmarks.file.notWebPages', result.notWebPages))
  if (result.overLimit) sentences.push(counted('bookmarks.file.overLimit', result.overLimit, { max: props.formatNumber(result.limit) }))
  return sentences.join(' ')
}

/**
 * Opens the system's dialog for the file, as Chrome's bookmark manager does. The button stays focusable while it
 * waits, so the keyboard is where it was once the dialog closes, and a held Enter that confirmed the dialog does not
 * open it again.
 */
async function run(action: 'import' | 'export'): Promise<void> {
  if (pending.value || props.blocked || (action === 'export' && !props.count)) return
  pending.value = action
  status.value = ''
  error.value = ''
  try {
    if (action === 'export') {
      const exported = await props.exportBookmarks()
      if (exported !== null) status.value = counted('bookmarks.file.exported', exported)
    } else {
      const result = await props.importBookmarks()
      if (result) status.value = importMessage(result)
    }
  } catch (cause) {
    error.value = friendlyUiError(cause, t('runtime.toast.actionFailed'))
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <div class="bookmarks-file-actions">
    <UiButton appearance="application" type="button" :aria-disabled="pending !== null || blocked" v-tooltip="t('bookmarks.file.importHint')" @keydown="ignoreHeldEnter" @click="run('import')">{{ t('bookmarks.file.import') }}</UiButton>
    <UiButton appearance="application" type="button" :aria-disabled="pending !== null || blocked || !count" v-tooltip="t('bookmarks.file.exportHint')" @keydown="ignoreHeldEnter" @click="run('export')">{{ t('bookmarks.file.export') }}</UiButton>
  </div>
  <p v-if="status" class="bookmarks-feedback" role="status">{{ status }}</p>
  <p v-if="error" class="bookmarks-error" role="alert">{{ error }}</p>
</template>
