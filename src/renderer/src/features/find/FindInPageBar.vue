<script setup lang="ts">
import UiButton from "../../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import {
  MAX_FIND_QUERY_LENGTH,
  type BrowserFindResult,
  type BrowserTabState,
  type HronautApi
} from '../../../../shared/types.js'
import { isImeCompositionEvent } from '../../keyboard-composition.js'
import { vTooltip } from '../../ui/tooltip.js'

type FindBrowserApi = Pick<HronautApi, 'findInPage' | 'stopFindInPage' | 'focusActivePage'>

const props = defineProps<{
  activeTab?: BrowserTabState
  browser: FindBrowserApi
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const caseSensitive = ref(false)
const searchFailed = ref(false)
const searching = ref(false)
const result = ref<BrowserFindResult>({ activeMatchOrdinal: 0, matches: 0 })
let targetTabId: string | undefined
let requestSequence = 0
// The key last pressed down in the bar and not yet released there, such as Enter on its Close button.
let heldKey: string | undefined
let stopWaitingForRelease = (): void => undefined

async function search(forward: boolean, newSearch: boolean): Promise<void> {
  const tabId = targetTabId
  const normalizedQuery = query.value.slice(0, MAX_FIND_QUERY_LENGTH)
  if (normalizedQuery !== query.value) query.value = normalizedQuery
  const sequence = ++requestSequence
  searchFailed.value = false
  searching.value = Boolean(tabId && normalizedQuery)
  if (!tabId) return
  if (!normalizedQuery) {
    result.value = { activeMatchOrdinal: 0, matches: 0 }
    await props.browser.stopFindInPage(tabId).catch(() => undefined)
    return
  }
  try {
    const next = await props.browser.findInPage({
      tabId,
      query: normalizedQuery,
      forward,
      findNext: newSearch,
      caseSensitive: caseSensitive.value
    })
    if (sequence === requestSequence && tabId === targetTabId) result.value = next
  } catch {
    if (sequence === requestSequence && tabId === targetTabId) {
      result.value = { activeMatchOrdinal: 0, matches: 0 }
      searchFailed.value = true
    }
  } finally {
    if (sequence === requestSequence && tabId === targetTabId) searching.value = false
  }
}

function navigateMatch(forward: boolean): void {
  if (searching.value || !query.value || !result.value.matches) return
  void search(forward, false)
}

function handleSearchInput(event: Event): void {
  if ((event as InputEvent).isComposing) return
  void search(true, true)
}

// Ctrl+Enter, as in Chrome's find bar, where macOS takes Control too.
function isFollowMatchKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event) || event.key !== 'Enter' || isFollowMatchKey(event)) return
  event.preventDefault()
  void search(!event.shiftKey, false)
}

// Escape typed anywhere in the bar closes Find itself, not the first panel in the shell's Escape order, such as Site
// storage, even in its own window. Ctrl+Enter anywhere in it closes Find and clicks the active match, as in Chrome,
// which follows the link the match is in.
function handleBarKeydown(event: KeyboardEvent): void {
  heldKey = event.key
  if (isImeCompositionEvent(event) || event.defaultPrevented) return
  if (isFollowMatchKey(event)) {
    event.preventDefault()
    void close({ activateMatch: true, returnKeyboard: true, releaseKey: event.key })
    return
  }
  if (event.key !== 'Escape') return
  event.preventDefault()
  void close({ returnKeyboard: true, releaseKey: event.key })
}

function handleBarKeyup(event: KeyboardEvent): void {
  if (event.key === heldKey) heldKey = undefined
}

// A click from the keyboard comes with Enter still down; Space clicks once it is up.
function closeFromButton(event: MouseEvent): void {
  void close({ returnKeyboard: true, releaseKey: event.detail === 0 ? heldKey : undefined })
}

/**
 * Gives the keyboard back to the page, as Chrome does when the person closes Find, once the key that closed it is up: a
 * held Escape or Enter repeats, and the page would take the repeats as keys of its own, such as Enter on a button.
 */
function returnKeyboardToPage(key: string | undefined): void {
  stopWaitingForRelease()
  heldKey = undefined
  const focusPage = (): void => { void props.browser.focusActivePage().catch(() => undefined) }
  if (!key) {
    focusPage()
    return
  }
  const released = (event: KeyboardEvent): void => {
    if (event.key !== key) return
    stopWaitingForRelease()
    // Find opened again meanwhile keeps the keyboard in its field.
    if (!open.value) focusPage()
  }
  // A key let go of while another window has the keyboard never reaches this one, so leaving the window ends the wait.
  stopWaitingForRelease = () => {
    window.removeEventListener('keyup', released, true)
    window.removeEventListener('blur', stopWaitingForRelease)
    stopWaitingForRelease = () => undefined
  }
  window.addEventListener('keyup', released, true)
  window.addEventListener('blur', stopWaitingForRelease)
}

function retrySearch(): void {
  input.value?.focus()
  void search(true, true)
}

function toggleCaseSensitive(): void {
  caseSensitive.value = !caseSensitive.value
  void search(true, true)
}

async function activate(tab: BrowserTabState | undefined): Promise<void> {
  if (!tab) return
  const shouldRepeatQuery = Boolean(query.value)
  targetTabId = tab.id
  await nextTick()
  if (!open.value || targetTabId !== tab.id || props.activeTab?.id !== tab.id) return
  input.value?.focus()
  input.value?.select()
  if (shouldRepeatQuery) await search(true, true)
}

// Find Next and Find Previous, again: as in Chrome, in an open bar they go to the next or previous match as Enter and
// Shift+Enter do in its field, and with Find closed they open it and search for its last text again.
async function openForTab(tab: BrowserTabState | undefined = props.activeTab, again?: 'next' | 'previous'): Promise<void> {
  if (!tab) return
  const forward = again !== 'previous'
  if (again && open.value && targetTabId === tab.id) {
    input.value?.focus()
    input.value?.select()
    if (query.value) await search(forward, false)
    return
  }
  const shouldRepeatQuery = Boolean(query.value)
  targetTabId = tab.id
  open.value = true
  await nextTick()
  if (!open.value || targetTabId !== tab.id || props.activeTab?.id !== tab.id) return
  input.value?.focus()
  input.value?.select()
  if (shouldRepeatQuery) await search(forward, true)
}

async function cleanup(options: { activateMatch?: boolean } = {}): Promise<void> {
  const tabId = targetTabId
  requestSequence += 1
  targetTabId = undefined
  searching.value = false
  searchFailed.value = false
  result.value = { activeMatchOrdinal: 0, matches: 0 }
  if (!tabId) return
  const stopped = options.activateMatch ? props.browser.stopFindInPage(tabId, { activateMatch: true }) : props.browser.stopFindInPage(tabId)
  await stopped.catch(() => undefined)
}

async function close(options: { activateMatch?: boolean; returnKeyboard?: boolean; releaseKey?: string } = {}): Promise<void> {
  open.value = false
  if (options.returnKeyboard) returnKeyboardToPage(options.releaseKey)
  await cleanup(options)
}

watch(open, (isOpen) => {
  if (isOpen && !targetTabId) void activate(props.activeTab)
  else if (!isOpen && targetTabId) void cleanup()
}, { immediate: true })

// Another tab, another page or a reload ends the search, including one opened while the next page was still loading. A
// change within the page keeps it, as in Chrome, such as a documentation site moving its address to the section in
// view while the person steps through matches.
watch([
  () => props.activeTab?.id,
  () => props.activeTab?.documentGeneration
], () => {
  if (open.value && targetTabId) void close()
}, { flush: 'sync' })

onBeforeUnmount(() => {
  stopWaitingForRelease()
  void close()
})
defineExpose({ close, openForTab })
</script>

<template>
  <div v-if="open" class="find-bar" role="search" :aria-label="t('find.region')" @keydown="handleBarKeydown" @keyup="handleBarKeyup">
    <div class="find-field">
      <IconSearch aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="search"
        :maxlength="MAX_FIND_QUERY_LENGTH"
        :aria-label="t('find.text')"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('find.placeholder')"
        @input="handleSearchInput"
        @keydown="handleSearchKeydown"
      />
    </div>
    <output class="find-count" aria-live="polite" :aria-busy="searching">
      {{ searching ? t('find.searching') : searchFailed ? t('find.failed') : query ? `${result.activeMatchOrdinal} / ${result.matches}` : '0 / 0' }}
    </output>
    <UiButton v-if="searchFailed" appearance="application" class="find-action" type="button" v-tooltip="t('find.retry')" :aria-label="t('find.retry')" @click="retrySearch">
      <IconRefresh aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="find-action find-option"
      type="button"
      v-tooltip="t('find.matchCaseTitle')"
      :aria-label="t('find.matchCase')"
      :aria-pressed="caseSensitive"
      @click="toggleCaseSensitive"
    >{{ t('find.matchCaseShort') }}</UiButton>
    <UiButton appearance="application"
      class="find-action"
      type="button"
      v-tooltip="t('find.previousTitle')"
      :aria-label="t('find.previous')"
      :aria-disabled="searching || !query || !result.matches"
      @click="navigateMatch(false)"
    >
      <IconKeyboardArrowUp aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="find-action"
      type="button"
      v-tooltip="t('find.nextTitle')"
      :aria-label="t('find.next')"
      :aria-disabled="searching || !query || !result.matches"
      @click="navigateMatch(true)"
    >
      <IconKeyboardArrowDown aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application" class="find-action" type="button" v-tooltip="t('find.closeTitle')" :aria-label="t('find.close')"
      @click="closeFromButton">
      <IconClose aria-hidden="true" />
    </UiButton>
  </div>
</template>
