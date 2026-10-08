<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconBookmark from '~icons/material-symbols/bookmark-add-outline-rounded'
import IconBackground from '~icons/material-symbols/tab-unselected-rounded'
import IconBookmarked from '~icons/material-symbols/bookmark-rounded'
import IconCopy from '~icons/material-symbols/content-copy-outline-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import type { BrowserBookmark, BrowserHistoryEntry } from '../../../shared/types.js'
import { useHistoryPanelController } from '../composables/useHistoryPanelController.js'

const props = defineProps<{
  formatDateTime: (value: Date | number | string) => string
  formatNumber: (value: number) => string
  bookmarks: BrowserBookmark[]
  saveHistoryBookmark: (url: string, title: string) => Promise<void>
  listHistory: () => Promise<BrowserHistoryEntry[]>
  removeHistoryEntry: (id: string) => Promise<BrowserHistoryEntry[]>
  clearHistory: () => Promise<BrowserHistoryEntry[]>
  openHistoryEntry: (entry: BrowserHistoryEntry) => Promise<void>
  openHistoryEntryInBackground: (entry: BrowserHistoryEntry) => Promise<void>
  copyHistoryAddress: (entry: BrowserHistoryEntry) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const entries = defineModel<BrowserHistoryEntry[]>('entries', { required: true })
const panelRoot = ref<HTMLElement | null>(null)
let focusGeneration = 0
const stopFocusSessionTracking = watch(open, () => { focusGeneration += 1 }, { flush: 'sync' })
const { t } = useI18n({ useScope: 'global' })
const {
  query,
  dateRange,
  error,
  pendingAction,
  copyFeedback,
  filteredEntries,
  toggle,
  openEntry,
  openInBackground,
  copyAddress,
  bookmark,
  remove: removeEntry,
  clear,
  entryMeta,
  dispose
} = useHistoryPanelController({
  open,
  entries,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatDateTime: props.formatDateTime,
  formatNumber: props.formatNumber,
  listHistory: props.listHistory,
  removeHistoryEntry: props.removeHistoryEntry,
  clearHistory: props.clearHistory,
  openHistoryEntry: props.openHistoryEntry,
  openHistoryEntryInBackground: props.openHistoryEntryInBackground,
  saveHistoryBookmark: props.saveHistoryBookmark,
  copyHistoryAddress: props.copyHistoryAddress,
  confirmClear: () => window.confirm(t('privacyActions.clearHistory'))
})

defineExpose({ toggle })

// Calendar refreshes and authoritative history updates can remove a row without
// a panel action. Capture its focused control before Vue patches the live list.
const stopVisibleTracking = watch(() => filteredEntries.value.map(entry => entry.id), async (_ids, _previous, onCleanup) => {
  const focused = document.activeElement
  const panel = panelRoot.value
  const row = focused instanceof HTMLElement && panel?.contains(focused)
    ? focused.closest('.history-item') : null
  if (!row || !panel || !(focused instanceof HTMLElement)) return
  const generation = focusGeneration
  let superseded = false
  onCleanup(() => { superseded = true })
  const selector = focused.classList.contains('history-open') ? '.history-open'
    : focused.classList.contains('history-copy-address') ? '.history-copy-address'
    : focused.classList.contains('history-background') ? '.history-background'
      : focused.classList.contains('history-bookmark') ? '.history-bookmark' : '.history-action.danger'
  const next = row.nextElementSibling?.querySelector<HTMLButtonElement>(selector)
  const previous = row.previousElementSibling?.querySelector<HTMLButtonElement>(selector)
  await nextTick()
  if (superseded || generation !== focusGeneration || !open.value || panel !== panelRoot.value
    || !panel.isConnected || row.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [next, previous,
    panel.querySelector<HTMLInputElement>('.history-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}, { flush: 'pre' })

onBeforeUnmount(() => {
  focusGeneration += 1
  stopVisibleTracking()
  stopFocusSessionTracking()
  dispose()
})

function isBookmarked(entry: BrowserHistoryEntry): boolean {
  return props.bookmarks.some(bookmark => bookmark.url === entry.url)
}

async function saveBookmark(entry: BrowserHistoryEntry): Promise<void> {
  if (isBookmarked(entry) || pendingAction.value !== null) return
  await bookmark(entry)
}

async function remove(entryId: string, event: MouseEvent): Promise<void> {
  const generation = focusGeneration
  const focused = event.currentTarget instanceof HTMLButtonElement
    && document.activeElement === event.currentTarget ? event.currentTarget : null
  const row = focused?.closest('.history-item')
  const panel = row?.closest('.history-panel')
  const next = row?.nextElementSibling?.querySelector<HTMLButtonElement>('.history-action.danger')
  const previous = row?.previousElementSibling?.querySelector<HTMLButtonElement>('.history-action.danger')
  await removeEntry(entryId)
  await nextTick()
  if (generation !== focusGeneration || !open.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [focused, next, previous,
    panel.querySelector<HTMLInputElement>('.history-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}
</script>

<template>
  <section
    v-if="open"
    ref="panelRoot"
    class="history-panel"
    data-shell-side-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="history-title"
    :aria-busy="pendingAction !== null"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('history.kicker') }}</span>
        <h2 id="history-title">{{ t('history.heading') }}</h2>
      </div>
      <div class="history-header-actions">
        <UiButton appearance="application" type="button" :disabled="!entries.length || pendingAction !== null" @click="clear">{{ t('history.clearAll') }}</UiButton>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('history.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="entries.length" class="history-search-field">
      <IconSearch aria-hidden="true" />
      <input v-model="query" type="search" :aria-label="t('history.search')" autocomplete="off" spellcheck="false" :placeholder="t('history.placeholder')" />
    </div>
    <label v-if="entries.length" class="history-date-filter">
      <span>{{ t('history.dateRange') }}</span>
      <select v-model="dateRange">
        <option value="all">{{ t('history.allDates') }}</option>
        <option value="today">{{ t('history.today') }}</option>
        <option value="last7Days">{{ t('history.last7Days') }}</option>
      </select>
    </label>
    <div v-if="!entries.length" class="history-empty">
      <IconHistory aria-hidden="true" />
      <strong>{{ t('history.empty') }}</strong>
      <span>{{ t('history.emptyDescription') }}</span>
    </div>
    <div v-else-if="!filteredEntries.length" class="history-empty compact">
      <IconSearch aria-hidden="true" />
      <strong>{{ t('history.noMatches') }}</strong>
      <span>{{ t('history.tryAnother') }}</span>
    </div>
    <div v-else class="history-list">
      <article v-for="entry in filteredEntries" :key="entry.id" class="history-item">
        <UiButton appearance="application" class="history-open" type="button" :title="entry.url" :disabled="pendingAction !== null" @click="openEntry(entry)">
          <span class="history-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="history-copy">
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.url }}</span>
            <small>{{ entryMeta(entry) }}</small>
          </span>
        </UiButton>
        <UiButton appearance="application" class="history-copy-address history-action" type="button"
          :aria-disabled="pendingAction !== null"
          :aria-label="t('history.copyAddressAria', { title: entry.title })"
          :title="t('history.copyAddress')"
          @click="copyAddress(entry)"><IconCopy aria-hidden="true" /></UiButton>
        <UiButton appearance="application" class="history-background history-action" type="button"
          :aria-disabled="pendingAction !== null"
          :aria-label="t('history.backgroundAria', { title: entry.title })"
          :title="t('history.background')"
          @click="openInBackground(entry)">
          <IconBackground aria-hidden="true" />
        </UiButton>
        <UiButton appearance="application" class="history-bookmark history-action" type="button"
          :aria-disabled="isBookmarked(entry) || pendingAction !== null"
          :aria-label="t(isBookmarked(entry) ? 'history.bookmarkedAria' : 'history.bookmarkAria', { title: entry.title })"
          :title="t(isBookmarked(entry) ? 'history.bookmarked' : 'history.bookmark')"
          @click="saveBookmark(entry)">
          <IconBookmarked v-if="isBookmarked(entry)" aria-hidden="true" />
          <IconBookmark v-else aria-hidden="true" />
        </UiButton>
        <UiButton appearance="application" variant="danger" class="history-action danger" type="button" :disabled="pendingAction !== null" :aria-label="t('history.removeAria', { title: entry.title })" :title="t('history.remove')" @click="remove(entry.id, $event)"><IconDelete aria-hidden="true" /></UiButton>
      </article>
    </div>
    <p class="history-retention"><IconPrivacy aria-hidden="true" /> {{ t('history.retention') }}</p>
    <p v-if="copyFeedback === 'success'" class="history-feedback" role="status">{{ t('history.addressCopied') }}</p>
    <p v-if="copyFeedback === 'error'" class="history-error" role="alert">{{ t('history.copyFailed') }}</p>
    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
  </section>
</template>
