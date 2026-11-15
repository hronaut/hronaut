<script setup lang="ts">
import UiButton from "../../ui/UiButton.vue"
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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

type FindBrowserApi = Pick<HronautApi, 'findInPage' | 'stopFindInPage' | 'forwardFindKey' | 'findSelectionText' | 'focusActivePage'>

const props = defineProps<{
  activeTab?: BrowserTabState
  // Every open tab, whose Find the bar keeps while another tab is shown.
  readTabs?: () => readonly BrowserTabState[]
  // Whether another surface is open, which a tab's Find coming back would close: it comes back once that closes, or
  // when the person opens Find.
  returnHeld?: boolean
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
// Whether Find waits for the page's selected text, which it may search for instead of the text in its field.
const readingSelection = ref(false)
// The bar shows Find searching while it waits for the page too, rather than a count for no search.
const busy = computed(() => searching.value || (readingSelection.value && Boolean(query.value)))
const result = ref<BrowserFindResult>({ activeMatchOrdinal: 0, matches: 0 })
let targetTabId: string | undefined
let requestSequence = 0
// The keys the field sent on to the page as pressed, by the key on the keyboard, and the tab they went to.
const pageHeldKeys = new Map<string, { tabId: string; key: BrowserFindPageKey['key'] }>()
// Whether the person typed text in the field since Find opened, which then keeps it rather than take up the page's
// selected text, as in Chrome.
let typedText = false
// The latest read of the page's selected text, which supersedes an earlier one still answering.
let selectionRead = 0
// Whether a search session started on the page since Find opened, which Find Next and Find Previous go on with.
let pageSearched = false
// The search still answering for a tab Find came back to, which the bar shows once it answers.
let adoptedSequence: number | undefined

// As in Chrome, Find belongs to its tab: another tab shown hides it, leaving the page's matches marked, and the tab
// shown again brings it back with its text, its count and the match it was on. A page the tab goes to meanwhile, or a
// reload, ends it, as it does in the tab shown.
interface ParkedFind {
  query: string
  caseSensitive: boolean
  result: BrowserFindResult
  searchFailed: boolean
  searching: boolean
  // The search the tab was waiting for when it was hidden, whose answer comes to this Find.
  sequence: number
  pageSearched: boolean
  typedText: boolean
  documentGeneration: number
}
const parkedFinds = new Map<string, ParkedFind>()

async function search(forward: boolean, newSearch: boolean, fromSelectionStart = false): Promise<void> {
  const tabId = targetTabId
  const normalizedQuery = query.value.slice(0, MAX_FIND_QUERY_LENGTH)
  if (normalizedQuery !== query.value) query.value = normalizedQuery
  const sequence = ++requestSequence
  adoptedSequence = undefined
  searchFailed.value = false
  searching.value = Boolean(tabId && normalizedQuery)
  if (!tabId) return
  if (!normalizedQuery) {
    pageSearched = false
    result.value = { activeMatchOrdinal: 0, matches: 0 }
    // As in Chrome, emptying the field clears the page's selection, where closing Find keeps the match selected.
    await props.browser.stopFindInPage(tabId, { clearSelection: true }).catch(() => undefined)
    return
  }
  if (newSearch) pageSearched = true
  try {
    const next = await props.browser.findInPage({
      tabId,
      query: normalizedQuery,
      forward,
      findNext: newSearch,
      caseSensitive: caseSensitive.value,
      ...(fromSelectionStart ? { fromSelectionStart } : {})
    })
    settleSearch(tabId, sequence, next, false)
  } catch {
    settleSearch(tabId, sequence, { activeMatchOrdinal: 0, matches: 0 }, true)
  }
}

// A search's answer goes to the bar while it shows the search's tab, or to the tab's hidden Find, when it is the latest
// search there.
function settleSearch(tabId: string, sequence: number, next: BrowserFindResult, failed: boolean): void {
  if (tabId === targetTabId && (sequence === requestSequence || sequence === adoptedSequence)) {
    adoptedSequence = undefined
    result.value = next
    searchFailed.value = failed
    searching.value = false
    return
  }
  const parked = parkedFinds.get(tabId)
  if (parked?.searching && parked.sequence === sequence) Object.assign(parked, { result: next, searchFailed: failed, searching: false })
}

function navigateMatch(forward: boolean): void {
  if (busy.value || !query.value || !result.value.matches) return
  void search(forward, false)
}

function handleSearchInput(event: Event): void {
  // Also while an input method composes text, which the field's model takes only once it ends.
  typedText = (event.target as HTMLInputElement).value !== ''
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
  // Enter pressed before Find searched the page, while it waits for the page's selected text, starts the search.
  void search(!event.shiftKey, !pageSearched)
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
  typedText = false
  pageSearched = false
  await nextTick()
  if (!showsTab(tab)) return
  input.value?.focus()
  input.value?.select()
  if (await takeSelectedText(tab) !== 'none') return
  // As in Chrome, Find opening again finds the match it closed on, which the page keeps selected.
  if (shouldRepeatQuery) await search(true, true, true)
}

// As in Chrome, in an open bar Find takes the keyboard to its field and selects its text, leaving the current match
// where it is, and Find Next and Find Previous go to the next or previous match as Enter and Shift+Enter do in the
// field. With Find closed, each opens it and searches for its last text again: Find from the match it closed on,
// which the page keeps selected, and Find Next and Find Previous from the match after or before it. Find, open or
// not, first takes up the text selected in the page until the person types in the field.
async function openForTab(tab: BrowserTabState | undefined = props.activeTab, again?: 'next' | 'previous'): Promise<void> {
  if (!tab) return
  const forward = again !== 'previous'
  // Find the tab kept while another surface was open goes on where it was.
  if (!open.value && restore(tab)) await nextTick()
  if (open.value && targetTabId === tab.id) {
    input.value?.focus()
    input.value?.select()
    if (again) {
      if (query.value) await search(forward, !pageSearched)
    } else {
      await takeSelectedText(tab)
    }
    return
  }
  const shouldRepeatQuery = Boolean(query.value)
  targetTabId = tab.id
  typedText = false
  pageSearched = false
  open.value = true
  await nextTick()
  if (!showsTab(tab)) return
  input.value?.focus()
  input.value?.select()
  if (again === undefined && await takeSelectedText(tab) !== 'none') return
  if (shouldRepeatQuery) await search(forward, true, again === undefined)
}

// As in Chrome, Find takes up the text selected in the page, of at most 250 characters, and finds it there: the
// selected text itself, as the page keeps it selected. The person typing or searching while the page answers, or a
// newer read, goes on instead: then nothing more is searched for this one ('overtaken'). With nothing selected ('none'),
// Find goes on as it would without.
async function takeSelectedText(tab: BrowserTabState): Promise<'taken' | 'none' | 'overtaken'> {
  if (typedText) return 'none'
  const read = ++selectionRead
  const sequence = requestSequence
  readingSelection.value = true
  const text = await props.browser.findSelectionText(tab.id).catch(() => '')
  if (read === selectionRead) readingSelection.value = false
  if (read !== selectionRead || sequence !== requestSequence || typedText || !showsTab(tab)) return 'overtaken'
  if (!text) return 'none'
  query.value = text
  await nextTick()
  if (document.activeElement === input.value) input.value?.select()
  await search(true, true, true)
  return 'taken'
}

function showsTab(tab: BrowserTabState): boolean {
  return open.value && targetTabId === tab.id && props.activeTab?.id === tab.id
}

async function cleanup(options: { activateMatch?: boolean; keepMatch?: boolean } = {}): Promise<void> {
  const tabId = targetTabId
  requestSequence += 1
  adoptedSequence = undefined
  targetTabId = undefined
  releasePageKeys()
  searching.value = false
  readingSelection.value = false
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

// Another tab hides Find, which that tab shown again brings back. Another page or a reload ends the search, including
// one opened while the next page was still loading. A change within the page keeps it, as in Chrome, such as a
// documentation site moving its address to the section in view while the person steps through matches.
watch([
  () => props.activeTab?.id,
  () => props.activeTab?.documentGeneration
], ([tabId], [previousTabId, previousGeneration]) => {
  if (tabId === previousTabId) {
    if (open.value && targetTabId) void close()
    return
  }
  if (open.value && targetTabId && targetTabId === previousTabId && previousGeneration !== undefined) {
    park(previousTabId, previousGeneration)
  } else if (open.value && targetTabId) void close()
  if (!props.returnHeld) restore(props.activeTab)
}, { flush: 'sync' })

watch(() => props.returnHeld, (held) => {
  if (!held && !open.value) restore(props.activeTab)
})

// The tabs closed, gone to another page or put to sleep take their hidden Find with them.
watch(() => props.readTabs?.(), (tabs) => {
  if (!tabs) return
  for (const [tabId, parked] of parkedFinds) {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab && !tab.sleeping && tab.documentGeneration === parked.documentGeneration) continue
    parkedFinds.delete(tabId)
    if (tab && !tab.sleeping) void props.browser.stopFindInPage(tabId, { clearSelection: true }).catch(() => undefined)
  }
})

// Hides Find for a tab another tab replaces, without ending the page's search, whose matches stay marked, as in Chrome.
function park(tabId: string, documentGeneration: number): void {
  releasePageKeys()
  selectionRead += 1
  readingSelection.value = false
  parkedFinds.set(tabId, {
    query: query.value,
    caseSensitive: caseSensitive.value,
    result: result.value,
    searchFailed: searchFailed.value,
    searching: searching.value,
    sequence: adoptedSequence ?? requestSequence,
    pageSearched,
    typedText,
    documentGeneration
  })
  adoptedSequence = undefined
  targetTabId = undefined
  searching.value = false
  // The tab's count stays with it, not with the next tab Find opens in.
  result.value = { activeMatchOrdinal: 0, matches: 0 }
  searchFailed.value = false
  open.value = false
}

// Brings back the Find a tab had when another tab replaced it, as it was, while the tab still shows the page it searched.
function restore(tab: BrowserTabState | undefined): boolean {
  const parked = tab && parkedFinds.get(tab.id)
  if (!tab || !parked) return false
  parkedFinds.delete(tab.id)
  if (tab.sleeping || parked.documentGeneration !== tab.documentGeneration) {
    // Main keeps the next page's selection when the search's own page is gone, and clears the search's otherwise.
    if (!tab.sleeping) void props.browser.stopFindInPage(tab.id, { clearSelection: true }).catch(() => undefined)
    return false
  }
  query.value = parked.query
  caseSensitive.value = parked.caseSensitive
  result.value = parked.result
  searchFailed.value = parked.searchFailed
  searching.value = parked.searching
  adoptedSequence = parked.searching ? parked.sequence : undefined
  pageSearched = parked.pageSearched
  typedText = parked.typedText
  targetTabId = tab.id
  open.value = true
  return true
}

// Gives the field the keyboard back, all its text selected, for the tab shown again that had it in Find, as Chrome's
// Find bar does; false when Find is not open for the tab.
function returnFocus(tabId: string): boolean {
  const field = input.value
  if (!open.value || targetTabId !== tabId || !field) return false
  field.focus({ preventScroll: true })
  field.select()
  return document.activeElement === field
}

onBeforeUnmount(() => { void close() })
defineExpose({ close, openForTab, returnFocus })
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
    <output class="find-count" aria-live="polite" :aria-busy="busy">
      {{ busy ? t('find.searching') : searchFailed ? t('find.failed') : query ? `${result.activeMatchOrdinal} / ${result.matches}` : '0 / 0' }}
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
      :aria-disabled="busy || !query || !result.matches"
      @click="navigateMatch(false)"
    >
      <IconKeyboardArrowUp aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="find-action"
      type="button"
      v-tooltip="t('find.nextTitle')"
      :aria-label="t('find.next')"
      :aria-disabled="busy || !query || !result.matches"
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
