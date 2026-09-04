<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import {
  MAX_FIND_QUERY_LENGTH,
  type BrowserFindResult,
  type BrowserTabState,
  type HronautApi
} from '../../../shared/types.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

type FindBrowserApi = Pick<HronautApi, 'findInPage' | 'stopFindInPage'>

const props = defineProps<{
  activeTab?: BrowserTabState
  browser: FindBrowserApi
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const result = ref<BrowserFindResult>({ activeMatchOrdinal: 0, matches: 0 })
let targetTabId: string | undefined
let requestSequence = 0

async function search(forward: boolean, newSearch: boolean): Promise<void> {
  const tabId = targetTabId
  const normalizedQuery = query.value.slice(0, MAX_FIND_QUERY_LENGTH)
  if (normalizedQuery !== query.value) query.value = normalizedQuery
  const sequence = ++requestSequence
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
      findNext: newSearch
    })
    if (sequence === requestSequence && tabId === targetTabId) result.value = next
  } catch {
    if (sequence === requestSequence && tabId === targetTabId) {
      result.value = { activeMatchOrdinal: 0, matches: 0 }
    }
  }
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event) || event.key !== 'Enter') return
  event.preventDefault()
  void search(!event.shiftKey, false)
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

async function openForTab(tab: BrowserTabState | undefined = props.activeTab): Promise<void> {
  if (!tab) return
  const shouldRepeatQuery = Boolean(query.value)
  targetTabId = tab.id
  open.value = true
  await nextTick()
  if (!open.value || targetTabId !== tab.id || props.activeTab?.id !== tab.id) return
  input.value?.focus()
  input.value?.select()
  if (shouldRepeatQuery) await search(true, true)
}

async function cleanup(): Promise<void> {
  const tabId = targetTabId
  requestSequence += 1
  targetTabId = undefined
  result.value = { activeMatchOrdinal: 0, matches: 0 }
  if (tabId) await props.browser.stopFindInPage(tabId).catch(() => undefined)
}

async function close(): Promise<void> {
  open.value = false
  await cleanup()
}

watch(open, (isOpen) => {
  if (isOpen && !targetTabId) void activate(props.activeTab)
  else if (!isOpen && targetTabId) void cleanup()
}, { immediate: true })

watch(() => props.activeTab?.id, (tabId) => {
  if (open.value && targetTabId && tabId !== targetTabId) void close()
})

onBeforeUnmount(() => { void close() })
defineExpose({ close, openForTab })
</script>

<template>
  <div v-if="open" class="find-bar" role="search" :aria-label="t('find.region')">
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
        @input="search(true, true)"
        @keydown="handleSearchKeydown"
      />
    </div>
    <output class="find-count" aria-live="polite">
      {{ query ? `${result.activeMatchOrdinal} / ${result.matches}` : '0 / 0' }}
    </output>
    <UiButton native
      class="find-action"
      type="button"
      :title="t('find.previousTitle')"
      :aria-label="t('find.previous')"
      :disabled="!query || !result.matches"
      @click="search(false, false)"
    >
      <IconKeyboardArrowUp aria-hidden="true" />
    </UiButton>
    <UiButton native
      class="find-action"
      type="button"
      :title="t('find.nextTitle')"
      :aria-label="t('find.next')"
      :disabled="!query || !result.matches"
      @click="search(true, false)"
    >
      <IconKeyboardArrowDown aria-hidden="true" />
    </UiButton>
    <UiButton native class="find-action" type="button" :title="t('find.closeTitle')" :aria-label="t('find.close')" @click="close">
      <IconClose aria-hidden="true" />
    </UiButton>
  </div>
</template>
