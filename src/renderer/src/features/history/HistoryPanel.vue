<script setup lang="ts">
import UiButton from "../../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, onUpdated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ignoreHeldEnter } from '../../held-enter.js'
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
import type { BrowserBookmark, BrowserHistoryEntry } from '../../../../shared/types.js'
import { useHistoryPanelController } from './useHistoryPanelController.js'
import { asMiddleClick, openClickTab } from '../../open-click.js'
import { vTooltip } from '../../ui/tooltip.js'
import { confirmAction } from '../../confirm-action.js'
import { splitConfirmation } from '../../../../shared/confirmation.js'

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
  /** Gives the keyboard to the page in view. */
  returnKeyboard?: () => void
}>()

const open = defineModel<boolean>('open', { required: true })
const entries = defineModel<BrowserHistoryEntry[]>('entries', { required: true })
const panelRoot = ref<HTMLElement | null>(null)
let focusGeneration = 0
// The row whose Remove is under way. remove() moves the focus on from it, so the live list leaves that row alone.
let removalFocusRow: Element | null = null
const stopFocusSessionTracking = watch(open, () => { focusGeneration += 1 }, { flush: 'sync' })
const { t } = useI18n({ useScope: 'global' })
const {
  query,
  sortOrder,
  dateRange,
  origin,
  entryOrigin,
  filterOrigin,
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
  confirmClear: () => confirmAction(splitConfirmation(() => t('privacyActions.clearHistory')))
})

// History puts the keyboard in its search as it opens, as Chrome's History page does, with the last search selected so
// that typing replaces it, and in the panel itself until it has visits to search.
function takeKeyboard(panel: HTMLElement): void {
  const search = panel.querySelector<HTMLInputElement>('.history-search-field input')
  if (!search) {
    panel.focus()
    return
  }
  search.focus()
  search.select()
}
// It takes the keyboard once Vue has rendered it, after the search has been given its text, which would otherwise drop
// the selection.
let keyboardWanted = false
const stopOpenFocus = watch(open, (isOpen) => { keyboardWanted = isOpen })
const stopSearchFocus = watch(() => open.value && entries.value.length > 0, (searchable) => {
  if (searchable && panelRoot.value && document.activeElement === panelRoot.value) keyboardWanted = true
})
onUpdated(() => {
  if (!keyboardWanted || !open.value || !panelRoot.value) return
  keyboardWanted = false
  takeKeyboard(panelRoot.value)
})
// Whether the keyboard was in History as it last closed, read before the panel goes.
let keyboardInPanelAtClose = false
const stopCloseTracking = watch(open, (isOpen) => {
  const focused = document.activeElement
  if (!isOpen) keyboardInPanelAtClose = !focused || focused === document.body || panelRoot.value?.contains(focused) === true
}, { flush: 'sync' })

/**
 * When History closes itself, with Escape, Close, its key or a visit opened from it, the page in view gets back the
 * keyboard that was in History, as when Chrome's History tab closes. Another surface that closes History, such as
 * Bookmarks, keeps the keyboard. Its key pressed in a page leaves the keyboard in the page, where main kept it, and a
 * window that no longer has the keyboard has none to give: given late, it would take the keyboard from where a
 * shortcut pressed next, such as Ctrl+L, put it.
 */
function giveKeyboardBack(generationBeforeClose: number): void {
  // The close reaches the panel once its owner has updated it; anything after it, such as opening History again, wins.
  void nextTick(() => {
    if (focusGeneration !== generationBeforeClose + 1 || open.value) return
    const focused = document.activeElement
    if (keyboardInPanelAtClose && (!focused || focused === document.body) && document.hasFocus()) props.returnKeyboard?.()
  })
}
function close(): void {
  if (!open.value) return
  const generation = focusGeneration
  open.value = false
  giveKeyboardBack(generation)
}
function toggleHistory(): Promise<void> {
  const closing = open.value
  const generation = focusGeneration
  const toggled = toggle()
  if (closing) giveKeyboardBack(generation)
  return toggled
}

defineExpose({ toggle: toggleHistory, close })

// Calendar refreshes and authoritative history updates can move or remove a row without
// a panel action. Capture its focused control before Vue patches the live list.
const stopVisibleTracking = watch(() => filteredEntries.value.map(entry => entry.id), async (_ids, _previous, onCleanup) => {
  const focused = document.activeElement
  const panel = panelRoot.value
  const row = focused instanceof HTMLElement && panel?.contains(focused)
    ? focused.closest('.history-item') : null
  if (!row || !panel || !(focused instanceof HTMLElement) || row === removalFocusRow) return
  const generation = focusGeneration
  let superseded = false
  onCleanup(() => { superseded = true })
  const selector = focused.classList.contains('history-open') ? '.history-open'
    : focused.classList.contains('history-origin') ? '.history-origin'
    : focused.classList.contains('history-copy-address') ? '.history-copy-address'
    : focused.classList.contains('history-background') ? '.history-background'
      : focused.classList.contains('history-bookmark') ? '.history-bookmark' : '.history-action.danger'
  const next = row.nextElementSibling?.querySelector<HTMLButtonElement>(selector)
  const previous = row.previousElementSibling?.querySelector<HTMLButtonElement>(selector)
  await nextTick()
  if (superseded || generation !== focusGeneration || !open.value || panel !== panelRoot.value
    || !panel.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  if (row.isConnected) {
    // Keyed moves can blur retained controls, including focusable pending actions.
    if (focused.isConnected && !focused.matches(':disabled')) focused.focus()
    return
  }
  const target = [next, previous,
    panel.querySelector<HTMLInputElement>('.history-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}, { flush: 'pre' })

onBeforeUnmount(() => {
  focusGeneration += 1
  stopOpenFocus()
  stopSearchFocus()
  stopCloseTracking()
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
  // The live list can drop the row before the removal finishes, while the other rows' controls are still disabled,
  // and its own recovery would then pass over the next row's Remove to Search.
  if (row) removalFocusRow = row
  try {
    await removeEntry(entryId)
    await nextTick()
  } finally {
    if (removalFocusRow === row) removalFocusRow = null
  }
  if (generation !== focusGeneration || !open.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [focused, next, previous,
    panel.querySelector<HTMLInputElement>('.history-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}
const mac = window.hronautShell?.windowChrome?.platform === 'darwin'

/**
 * A middle-click or Ctrl+click (⌘-click on a Mac) on a visit opens it in a new tab behind and keeps History open, as in
 * Chrome; with Shift it opens in front, as a click does.
 */
async function openVisit(event: MouseEvent, entry: BrowserHistoryEntry): Promise<void> {
  if (openClickTab(event, mac) === 'new-background-tab') {
    await openInBackground(entry)
    return
  }
  const generation = focusGeneration
  if (await openEntry(entry)) giveKeyboardBack(generation)
}

// Opening an entry and Clear all disable the control you used until they finish, and Chromium then drops its focus.
// When the panel is still open afterwards, as after a failure or once Clear all has emptied History, that control gets
// the focus back, or Search or Close when it can no longer be used, unless you have moved the focus, gone to the
// website or another app, or closed the panel meanwhile.
async function keepFocusThrough(event: Event, action: () => Promise<unknown>): Promise<void> {
  const generation = focusGeneration
  const panel = panelRoot.value
  const focused = event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget
    ? event.currentTarget : null
  await action()
  await nextTick()
  if (!focused || !panel || generation !== focusGeneration || !open.value || panel !== panelRoot.value
    || !panel.isConnected) return
  if (!document.hasFocus() || (document.activeElement !== document.body && document.activeElement !== focused)) return
  const target = [focused,
    panel.querySelector<HTMLInputElement>('.history-search-field input'),
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}

async function clearOrigin(event: Event): Promise<void> {
  const button = event.currentTarget
  const panel = panelRoot.value
  const generation = focusGeneration
  const restoreFocus = document.activeElement === button
  origin.value = ''
  await nextTick()
  if (!restoreFocus || generation !== focusGeneration || !open.value || panel !== panelRoot.value
    || !panel?.isConnected || (document.activeElement !== document.body && document.activeElement !== button)) return
  const target = panel.querySelector<HTMLInputElement>('.history-search-field input')
    ?? panel.querySelector<HTMLButtonElement>('.panel-close')
  target?.focus()
}
</script>

<template>
  <section
    v-if="open"
    ref="panelRoot"
    class="history-panel"
    tabindex="-1"
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
        <UiButton appearance="application" type="button" :disabled="!entries.length || pendingAction !== null"
          @keydown="ignoreHeldEnter" @click="keepFocusThrough($event, clear)">{{ t('history.clearAll') }}</UiButton>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('history.close')" @keydown="ignoreHeldEnter" @click="close"><IconClose aria-hidden="true" /></UiButton>
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
    <label v-if="entries.length" class="history-sort-order">
      <span>{{ t('history.sortOrder') }}</span>
      <select v-model="sortOrder" :disabled="pendingAction !== null">
        <option value="recent">{{ t('history.sortRecent') }}</option>
        <option value="visits">{{ t('history.sortVisits') }}</option>
      </select>
    </label>
    <div v-if="origin" class="history-origin-filter">
      <span>{{ t('history.origin') }}: <bdi>{{ origin }}</bdi></span>
      <UiButton appearance="application" type="button" :aria-label="t('history.clearOrigin')" @click="clearOrigin"><IconClose aria-hidden="true" /></UiButton>
    </div>
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
        <UiButton appearance="application" class="history-open" type="button" v-tooltip="entry.url" :disabled="pendingAction !== null"
          @keydown="ignoreHeldEnter"
          @click="keepFocusThrough($event, () => openVisit($event, entry))"
          @auxclick="asMiddleClick($event, (click) => keepFocusThrough(click, () => openVisit(click, entry)))">
          <span class="history-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="history-copy">
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.url }}</span>
            <small>{{ entryMeta(entry) }}</small>
          </span>
        </UiButton>
        <UiButton appearance="application" class="history-origin history-action" type="button"
          :disabled="!entryOrigin(entry)" :aria-disabled="pendingAction !== null"
          :aria-label="t('history.filterOriginAria', { title: entry.title })"
          v-tooltip="t('history.filterOrigin')" @click="filterOrigin(entry)"><IconLanguage aria-hidden="true" /></UiButton>
        <UiButton appearance="application" class="history-copy-address history-action" type="button"
          :aria-disabled="pendingAction !== null"
          :aria-label="t('history.copyAddressAria', { title: entry.title })"
          v-tooltip="t('history.copyAddress')"
          @click="copyAddress(entry)"><IconCopy aria-hidden="true" /></UiButton>
        <UiButton appearance="application" class="history-background history-action" type="button"
          :aria-disabled="pendingAction !== null"
          :aria-label="t('history.backgroundAria', { title: entry.title })"
          v-tooltip="t('history.background')"
          @keydown="ignoreHeldEnter"
          @click="openInBackground(entry)">
          <IconBackground aria-hidden="true" />
        </UiButton>
        <UiButton appearance="application" class="history-bookmark history-action" type="button"
          :aria-disabled="isBookmarked(entry) || pendingAction !== null"
          :aria-label="t(isBookmarked(entry) ? 'history.bookmarkedAria' : 'history.bookmarkAria', { title: entry.title })"
          v-tooltip="t(isBookmarked(entry) ? 'history.bookmarked' : 'history.bookmark')"
          @click="saveBookmark(entry)">
          <IconBookmarked v-if="isBookmarked(entry)" aria-hidden="true" />
          <IconBookmark v-else aria-hidden="true" />
        </UiButton>
        <UiButton appearance="application" variant="danger" class="history-action danger" type="button" :disabled="pendingAction !== null" @keydown="ignoreHeldEnter" :aria-label="t('history.removeAria', { title: entry.title })" v-tooltip="t('history.remove')" @click="remove(entry.id, $event)"><IconDelete aria-hidden="true" /></UiButton>
      </article>
    </div>
    <p class="history-retention"><IconPrivacy aria-hidden="true" /> {{ t('history.retention') }}</p>
    <p v-if="copyFeedback === 'success'" class="history-feedback" role="status">{{ t('history.addressCopied') }}</p>
    <p v-if="copyFeedback === 'error'" class="history-error" role="alert">{{ t('history.copyFailed') }}</p>
    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
  </section>
</template>
