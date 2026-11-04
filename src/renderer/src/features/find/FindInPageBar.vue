<script setup lang="ts">
import UiButton from "../../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import { browserShortcutAction, websiteKeptShortcutAction } from '../../../../shared/browser-shortcuts.js'
import {
  MAX_FIND_QUERY_LENGTH,
  type BrowserFindPageKey,
  type BrowserFindResult,
  type BrowserTabState,
  type HronautApi
} from '../../../../shared/types.js'
import { isImeCompositionEvent } from '../../keyboard-composition.js'
import { vTooltip } from '../../ui/tooltip.js'

type FindBrowserApi = Pick<HronautApi, 'findInPage' | 'stopFindInPage' | 'forwardFindKey' | 'focusActivePage'>

const props = defineProps<{
  activeTab?: BrowserTabState
  browser: FindBrowserApi
}>()

const open = defineModel<boolean>('open', { required: true })
// Whether the keyboard is in the bar.
const focused = defineModel<boolean>('focused', { default: false })
const { t } = useI18n({ useScope: 'global' })
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const caseSensitive = ref(false)
const searchFailed = ref(false)
const searching = ref(false)
const result = ref<BrowserFindResult>({ activeMatchOrdinal: 0, matches: 0 })
let targetTabId: string | undefined
let requestSequence = 0
// The keys the field sent on to the page as pressed, by the key on the keyboard, and the tab they went to.
const pageHeldKeys = new Map<string, { tabId: string; key: BrowserFindPageKey['key'] }>()

async function search(forward: boolean, newSearch: boolean, fromSelectionStart = false): Promise<void> {
  const tabId = targetTabId
  const normalizedQuery = query.value.slice(0, MAX_FIND_QUERY_LENGTH)
  if (normalizedQuery !== query.value) query.value = normalizedQuery
  const sequence = ++requestSequence
  searchFailed.value = false
  searching.value = Boolean(tabId && normalizedQuery)
  if (!tabId) return
  if (!normalizedQuery) {
    result.value = { activeMatchOrdinal: 0, matches: 0 }
    // As in Chrome, emptying the field clears the page's selection, where closing Find keeps the match selected.
    await props.browser.stopFindInPage(tabId, { clearSelection: true }).catch(() => undefined)
    return
  }
  try {
    const next = await props.browser.findInPage({
      tabId,
      query: normalizedQuery,
      forward,
      findNext: newSearch,
      caseSensitive: caseSensitive.value,
      ...(fromSelectionStart ? { fromSelectionStart } : {})
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
  if (isImeCompositionEvent(event) || forwardPageKey(event)) return
  if (event.key !== 'Enter' || isFollowMatchKey(event)) return
  event.preventDefault()
  void search(!event.shiftKey, false)
}

function handleSearchKeyup(event: KeyboardEvent): void {
  releasePageKey(event)
}

// As in Chrome, Up, Down, Page Up and Page Down in the field, and Home and End with Ctrl, scroll the page: the field
// sends them on to it, pressed and released, and keeps its own text and caret. A browser key stays the browser's, such
// as Ctrl+Page Down going to the next tab, also while held.
function forwardPageKey(event: KeyboardEvent): boolean {
  const key = pageKey(event)
  const tabId = targetTabId
  if (!key || !tabId) return false
  const input = {
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    control: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    mac: window.hronautShell?.windowChrome.platform === 'darwin'
  }
  if (browserShortcutAction(input) ?? websiteKeptShortcutAction(input)) return false
  event.preventDefault()
  pageHeldKeys.set(event.code || event.key, { tabId, key })
  void props.browser.forwardFindKey(tabId, { type: 'keyDown', key, ...modifiers(event), repeat: event.repeat }).catch(() => undefined)
  return true
}

// The release of a key the field sent on to the page goes there too, as in Chrome, whatever else is held by then, so
// the page does not keep the key held down.
function releasePageKey(event: KeyboardEvent): void {
  const held = pageHeldKeys.get(event.code || event.key)
  if (!held) return
  pageHeldKeys.delete(event.code || event.key)
  event.preventDefault()
  void props.browser.forwardFindKey(held.tabId, { type: 'keyUp', key: held.key, ...modifiers(event), repeat: false }).catch(() => undefined)
}

// Once the field no longer has the keyboard, the page gets the releases of the keys it still has pressed from it, which
// go elsewhere.
function releasePageKeys(): void {
  const released = { shift: false, control: false, alt: false, meta: false, repeat: false }
  for (const { tabId, key } of pageHeldKeys.values()) {
    void props.browser.forwardFindKey(tabId, { type: 'keyUp', key, ...released }).catch(() => undefined)
  }
  pageHeldKeys.clear()
}

function modifiers(event: KeyboardEvent): Pick<BrowserFindPageKey, 'shift' | 'control' | 'alt' | 'meta'> {
  return { shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey }
}

function pageKey(event: KeyboardEvent): BrowserFindPageKey['key'] | null {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown') return event.key
  if ((event.key === 'Home' || event.key === 'End') && event.ctrlKey) return event.key
  return null
}

// Escape typed anywhere in the bar closes Find itself, not the first panel in the shell's Escape order, such as Site
// storage, even in its own window. Ctrl+Enter anywhere in it closes Find and clicks the active match, as in Chrome,
// which follows the link the match is in.
function handleBarKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event) || event.defaultPrevented) return
  if (isFollowMatchKey(event)) {
    event.preventDefault()
    void close({ activateMatch: true, returnKeyboard: true })
    return
  }
  if (event.key !== 'Escape') return
  event.preventDefault()
  void close({ keepMatch: true, returnKeyboard: true })
}

// A click on the count or between the controls focuses the bar itself, which takes focus only that way, so the
// keyboard stays in the bar.
function handleBarFocusout(event: FocusEvent): void {
  const bar = event.currentTarget
  if (!(bar instanceof Node && event.relatedTarget instanceof Node && bar.contains(event.relatedTarget))) focused.value = false
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
  // As in Chrome, Find opening again finds the match it closed on, which the page keeps selected.
  if (shouldRepeatQuery) await search(true, true, true)
}

// As in Chrome, in an open bar Find takes the keyboard to its field and selects its text, leaving the current match
// where it is, and Find Next and Find Previous go to the next or previous match as Enter and Shift+Enter do in the
// field. With Find closed, each opens it and searches for its last text again: Find from the match it closed on,
// which the page keeps selected, and Find Next and Find Previous from the match after or before it.
async function openForTab(tab: BrowserTabState | undefined = props.activeTab, again?: 'next' | 'previous'): Promise<void> {
  if (!tab) return
  const forward = again !== 'previous'
  if (open.value && targetTabId === tab.id) {
    input.value?.focus()
    input.value?.select()
    if (again && query.value) await search(forward, false)
    return
  }
  const shouldRepeatQuery = Boolean(query.value)
  targetTabId = tab.id
  open.value = true
  await nextTick()
  if (!open.value || targetTabId !== tab.id || props.activeTab?.id !== tab.id) return
  input.value?.focus()
  input.value?.select()
  if (shouldRepeatQuery) await search(forward, true, again === undefined)
}

async function cleanup(options: { activateMatch?: boolean; keepMatch?: boolean } = {}): Promise<void> {
  const tabId = targetTabId
  requestSequence += 1
  targetTabId = undefined
  releasePageKeys()
  searching.value = false
  searchFailed.value = false
  result.value = { activeMatchOrdinal: 0, matches: 0 }
  if (!tabId) return
  // The person closing Find leaves its match selected, as in Chrome. Find closing for another reason, such as another
  // tab, another page or a panel opening, ends the search without selecting the match, which would move the page's
  // focus to the link it is in.
  const stopped = options.activateMatch
    ? props.browser.stopFindInPage(tabId, { activateMatch: true })
    : options.keepMatch ? props.browser.stopFindInPage(tabId) : props.browser.stopFindInPage(tabId, { clearSelection: true })
  await stopped.catch(() => undefined)
}

async function close(options: { activateMatch?: boolean; keepMatch?: boolean; returnKeyboard?: boolean } = {}): Promise<void> {
  open.value = false
  // The person closing Find from the bar gives the keyboard back to the page, as in Chrome. Main lets the page have it
  // once nothing covers it, and drops the repeats of a key still held from the shell, so a held Escape or Enter goes no
  // further.
  if (options.returnKeyboard) void props.browser.focusActivePage().catch(() => undefined)
  await cleanup(options)
}

watch(open, (isOpen) => {
  // The bar goes without a focusout when it closes with the keyboard in it.
  if (!isOpen) focused.value = false
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

onBeforeUnmount(() => { void close() })
defineExpose({ close, openForTab })
</script>

<template>
  <div v-if="open" class="find-bar" role="search" :aria-label="t('find.region')" @keydown="handleBarKeydown"
    tabindex="-1" @focusin="focused = true" @focusout="handleBarFocusout">
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
        @keyup="handleSearchKeyup"
        @blur="releasePageKeys"
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
      @click="close({ keepMatch: true, returnKeyboard: true })">
      <IconClose aria-hidden="true" />
    </UiButton>
  </div>
</template>
