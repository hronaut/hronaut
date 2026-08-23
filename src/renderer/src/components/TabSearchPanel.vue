<script setup lang="ts">
import { onBeforeUnmount, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconRestore from '~icons/material-symbols/restore-page-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconTabSearch from '~icons/material-symbols/tab-search-rounded'
import type {
  BrowserState,
  BrowserTabGroupColor,
  BrowserTabState,
  McpTabActivity
} from '../../../shared/types.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { useTabSearchController } from '../composables/useTabSearchController.js'

const props = defineProps<{
  state: BrowserState
  mcpActivityByTab: Record<string, McpTabActivity>
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  selectTab: (tabId: string) => Promise<unknown>
  expandTabGroup: (tab: BrowserTabState) => void
  describeEmulation: (tab: BrowserTabState) => string
  formatNumber: (value: number) => string
  formatTime: (value: Date | number | string) => string
  formatError: (cause: unknown, fallback: string) => string
  showError: (title: string, message: string) => void
}>()

const emit = defineEmits<{ newTab: [] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  input,
  query,
  selection,
  actionPending,
  regularTabs,
  filteredTabs,
  filteredClosedTabs,
  filteredSavedTabGroups,
  results,
  selectedResult,
  resultLabel,
  resultIndex,
  openPanel: openControllerPanel,
  close,
  handleKeydown,
  selectOpenTab,
  restoreClosedTab,
  restoreSavedGroup,
  closeOpenTab,
  togglePinnedTab,
  deleteSavedGroup,
  tabMeta,
  closedTabMeta,
  dispose
} = useTabSearchController({
  state: toRef(props, 'state'),
  open,
  mcpActivityByTab: toRef(props, 'mcpActivityByTab'),
  browser: window.hronaut,
  syncState: props.syncState,
  selectTab: props.selectTab,
  expandTabGroup: props.expandTabGroup,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatNumber: props.formatNumber,
  formatTime: props.formatTime,
  describeEmulation: props.describeEmulation,
  confirm: (message) => window.confirm(message),
  formatError: props.formatError,
  showError: props.showError
})

let lastPointerPosition: { x: number; y: number } | null = null

async function openPanel(): Promise<void> {
  lastPointerPosition = null
  await openControllerPanel()
}

function selectFromPointer(event: PointerEvent, index: number): void {
  const position = { x: event.clientX, y: event.clientY }
  if (lastPointerPosition?.x === position.x && lastPointerPosition.y === position.y) return
  lastPointerPosition = position
  selection.value = index
}

function tabGroupColorStyle(color: BrowserTabGroupColor): Record<string, string> {
  return { '--tab-group-color': BROWSER_TAB_GROUP_COLOR_HEX[color] }
}

defineExpose({ openPanel, close })
onBeforeUnmount(dispose)
</script>

<template>
  <section v-if="open" class="tab-search-panel" data-shell-side-panel role="dialog" aria-modal="false" aria-labelledby="tab-search-title">
    <header>
      <div>
        <span class="eyebrow">{{ t('tabSearch.kicker') }}</span>
        <h2 id="tab-search-title">{{ t('tabSearch.heading') }}</h2>
      </div>
      <span class="tab-search-count">{{ t('tabSearch.countOpen', { count: formatNumber(regularTabs.length) }) }}{{ state.savedTabGroups.length ? ` ${t('tabSearch.countSaved', { count: formatNumber(state.savedTabGroups.length) })}` : '' }}{{ state.closedTabs.length ? ` ${t('tabSearch.countClosed', { count: formatNumber(state.closedTabs.length) })}` : '' }}</span>
      <button class="panel-close" type="button" :aria-label="t('tabSearch.close')" @click="close"><IconClose aria-hidden="true" /></button>
    </header>
    <div v-if="regularTabs.length || state.closedTabs.length || state.savedTabGroups.length" class="tab-search-field">
      <IconSearch aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="search"
        :aria-label="t('tabSearch.search')"
        aria-controls="tab-search-results"
        aria-describedby="tab-search-status"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('tabSearch.placeholder')"
        @keydown="handleKeydown"
      />
      <kbd>⌃/⌘ ⇧ A</kbd>
    </div>
    <span id="tab-search-status" class="sr-only" role="status" aria-live="polite">
      {{ t('tabSearch.matches', { count: formatNumber(results.length) }, results.length) }}<template v-if="selectedResult"> {{ t('tabSearch.selected', { item: resultLabel(selectedResult) }) }}</template>
    </span>
    <div v-if="!regularTabs.length && !state.closedTabs.length && !state.savedTabGroups.length" class="tab-search-empty">
      <IconTabSearch aria-hidden="true" />
      <strong>{{ t('tabSearch.empty') }}</strong>
      <span>{{ t('tabSearch.homeAvailable') }}</span>
      <button type="button" @click="emit('newTab')">{{ t('tabSearch.newTab') }}</button>
    </div>
    <div v-else-if="!results.length" class="tab-search-empty compact">
      <IconSearch aria-hidden="true" />
      <strong>{{ t('tabSearch.noMatches') }}</strong>
      <span>{{ t('tabSearch.tryAnother') }}</span>
    </div>
    <div v-else id="tab-search-results" class="tab-search-list">
      <section v-if="filteredSavedTabGroups.length" class="tab-search-section saved-groups" aria-labelledby="saved-groups-title">
        <h3 id="saved-groups-title">{{ t('tabSearch.archived') }} <span>{{ formatNumber(filteredSavedTabGroups.length) }}</span></h3>
        <div role="list" :aria-label="t('tabSearch.archivedAria')">
          <article
            v-for="group in filteredSavedTabGroups"
            :id="`tab-search-saved-${group.id}`"
            :key="group.id"
            class="tab-search-item saved-group"
            :class="{ selected: resultIndex('saved', group.id) === selection }"
            role="listitem"
            @pointermove="selectFromPointer($event, resultIndex('saved', group.id))"
          >
            <button class="tab-search-open" type="button" :title="group.tabs.map((tab) => tab.url).join('\n')" :disabled="actionPending" @click="restoreSavedGroup(group)">
              <span class="tab-search-site-icon saved" :style="tabGroupColorStyle(group.color)" aria-hidden="true"><IconFolderOpen /></span>
              <span class="tab-search-copy">
                <strong>{{ group.name }}</strong>
                <span>{{ t('tabSearch.savedTabs', { count: formatNumber(group.tabs.length) }, group.tabs.length) }}</span>
                <small>{{ group.tabs.slice(0, 3).map((tab) => tab.title || tab.url).join(' · ') }}</small>
              </span>
            </button>
            <button class="tab-search-restore" type="button" :aria-label="t('tabSearch.restoreWorkspaceAria', { name: group.name })" :title="t('tabSearch.restoreWorkspace')" :disabled="actionPending" @click="restoreSavedGroup(group)"><IconRestore aria-hidden="true" /></button>
            <button class="tab-search-close" type="button" :aria-label="t('tabSearch.deleteWorkspaceAria', { name: group.name })" :title="t('tabSearch.deleteWorkspace')" :disabled="actionPending" @click="deleteSavedGroup($event, group)"><IconDelete aria-hidden="true" /></button>
          </article>
        </div>
      </section>
      <section v-if="filteredTabs.length" class="tab-search-section" aria-labelledby="open-tabs-title">
        <h3 id="open-tabs-title">{{ t('tabSearch.openTabs') }} <span>{{ formatNumber(filteredTabs.length) }}</span></h3>
        <div role="list" :aria-label="t('tabSearch.openTabs')">
          <article
            v-for="tab in filteredTabs"
            :id="`tab-search-open-${tab.id}`"
            :key="tab.id"
            class="tab-search-item"
            :class="{ selected: resultIndex('open', tab.id) === selection, active: tab.active }"
            role="listitem"
            @pointermove="selectFromPointer($event, resultIndex('open', tab.id))"
          >
            <button class="tab-search-open" type="button" :title="tab.url" :disabled="actionPending" @click="selectOpenTab(tab)">
              <span class="tab-search-site-icon" aria-hidden="true">
                <span v-if="tab.loading" class="spinner" />
                <img v-else-if="tab.faviconDataUrl" :src="tab.faviconDataUrl" alt="" draggable="false" />
                <span v-else-if="tab.url === 'about:blank'">✦</span>
                <IconLanguage v-else />
              </span>
              <span class="tab-search-copy">
                <strong>{{ tab.title || t('tabSearch.newTabTitle') }}</strong>
                <span>{{ tab.url === 'about:blank' ? t('tabSearch.blankPage') : tab.url }}</span>
                <small v-if="tabMeta(tab)">{{ tabMeta(tab) }}</small>
              </span>
            </button>
            <button
              class="tab-search-pin"
              :class="{ active: tab.pinned }"
              type="button"
              :aria-label="tab.pinned ? t('tabSearch.unpinAria', { title: tab.title || t('tabSearch.newTabTitle') }) : t('tabSearch.pinAria', { title: tab.title || t('tabSearch.newTabTitle') })"
              :title="tab.pinned ? t('tabSearch.unpin') : t('tabSearch.pin')"
              :aria-pressed="tab.pinned"
              :disabled="actionPending"
              @click="togglePinnedTab($event, tab)"
            ><IconKeep aria-hidden="true" /></button>
            <button class="tab-search-close" type="button" :aria-label="t('tabSearch.closeTabAria', { title: tab.title || t('tabSearch.newTabTitle') })" :title="t('tabSearch.closeTab')" :disabled="actionPending || state.allHumanInteractionLocked" data-lock-protected-tab-close @click="closeOpenTab($event, tab.id)"><IconClose aria-hidden="true" /></button>
          </article>
        </div>
      </section>
      <section v-if="filteredClosedTabs.length" class="tab-search-section recently-closed" aria-labelledby="closed-tabs-title">
        <h3 id="closed-tabs-title">{{ t('tabSearch.recentlyClosed') }} <span>{{ formatNumber(filteredClosedTabs.length) }}</span></h3>
        <div role="list" :aria-label="t('accessibility.recentlyClosedTabs')">
          <article
            v-for="tab in filteredClosedTabs"
            :id="`tab-search-closed-${tab.id}`"
            :key="tab.id"
            class="tab-search-item closed"
            :class="{ selected: resultIndex('closed', tab.id) === selection }"
            role="listitem"
            @pointermove="selectFromPointer($event, resultIndex('closed', tab.id))"
          >
            <button class="tab-search-open" type="button" :title="tab.url" :disabled="actionPending" @click="restoreClosedTab(tab)">
              <span class="tab-search-site-icon closed" aria-hidden="true"><IconHistory /></span>
              <span class="tab-search-copy">
                <strong>{{ tab.title || t('tabSearch.newTabTitle') }}</strong>
                <span>{{ tab.url === 'about:blank' ? t('tabSearch.blankPage') : tab.url }}</span>
                <small>{{ closedTabMeta(tab) }}</small>
              </span>
            </button>
            <button class="tab-search-restore" type="button" :aria-label="t('tabSearch.restoreAria', { title: tab.title || t('tabSearch.newTabTitle') })" :title="t('tabSearch.restore')" :disabled="actionPending" @click="restoreClosedTab(tab)"><IconRestore aria-hidden="true" /></button>
          </article>
        </div>
      </section>
    </div>
    <footer v-if="results.length"><span><kbd>↑</kbd><kbd>↓</kbd> {{ t('tabSearch.navigate') }}</span><span><kbd>Enter</kbd> {{ t('tabSearch.open') }}</span><span><kbd>Esc</kbd> {{ t('tabSearch.close') }}</span></footer>
  </section>
</template>
