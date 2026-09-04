<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import UiSegmentedControl from '../ui/UiSegmentedControl.vue'
import { useTabPagePreview } from '../composables/useTabPagePreview.js'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconBedtime from '~icons/material-symbols/bedtime-outline-rounded'
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
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

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
const panel = ref<HTMLElement | null>(null)
const {
  input,
  query,
  selection,
  actionPending,
  previewLoading,
  previewRefreshPaused,
  previewsByTab,
  regularTabs,
  filteredWorkspaceGroups,
  filteredClosedTabs,
  filteredSavedTabGroups,
  results,
  selectedResult,
  resultId,
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
  previewForTab,
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

const pagePreview = useTabPagePreview({
  open,
  tabs: computed(() => props.state.tabs),
  capture: (tabId) => window.hronaut.getTabOverviewPagePreview(tabId)
})
const { tabId: previewTabId, tab: previewTab, preview: fullPreview, status: pagePreviewStatus, error: pagePreviewError, fit: previewFit } = pagePreview
const previewBack = ref<{ focus: () => void } | null>(null)
const sparseCount = computed(() => regularTabs.value.length + props.state.closedTabs.length + props.state.savedTabGroups.length)
const fitOptions = computed(() => [
  { value: 'page', label: t('tabSearch.fitPage') },
  { value: 'width', label: t('tabSearch.fitWidth') }
])
let previewReturnId: string | null = null

async function showPagePreview(tab: BrowserTabState): Promise<void> {
  if (actionPending.value || tab.sleeping || tab.loading) return
  previewReturnId = `tab-page-preview-${tab.id}`
  void pagePreview.show(tab)
  await nextTick()
  if (previewTabId.value === tab.id) previewBack.value?.focus()
}

async function backToTabs(): Promise<void> {
  pagePreview.back()
  await nextTick()
  if (!open.value) return
  const target = previewReturnId ? document.getElementById(previewReturnId) : null
  if (target instanceof HTMLButtonElement && !target.disabled) target.focus()
  else input.value?.focus()
}

function handlePanelKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape' && previewTabId.value) {
    event.preventDefault()
    event.stopPropagation()
    void backToTabs()
  }
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return
  if (event.altKey && event.key === 'Enter' && selectedResult.value?.kind === 'open') {
    event.preventDefault()
    void showPagePreview(selectedResult.value.tab)
    return
  }
  handleKeydown(event)
}

// Capture focus before Vue replaces the image/recovery subtree. Keep persistent
// toolbar focus intact and never restore into a closed or superseded preview.
watch([fullPreview, pagePreviewStatus], async () => {
  const selectedTabId = previewTabId.value
  const previousFocus = document.activeElement
  if (!selectedTabId || !(previousFocus instanceof HTMLElement)
    || !previousFocus.closest('.tab-page-preview-canvas, .tab-page-preview-state')) return
  await nextTick()
  if (!open.value || previewTabId.value !== selectedTabId || previousFocus.isConnected
    || document.activeElement !== document.body || !document.hasFocus()) return
  previewBack.value?.focus()
})

useModalDialogFocus({ open, panel, focusTarget: input })

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

function workspaceLayoutStyle(workspace: { color: BrowserTabGroupColor; tabs: BrowserTabState[] }): Record<string, string> {
  const columns = Math.min(4, Math.max(1, workspace.tabs.length))
  return {
    ...tabGroupColorStyle(workspace.color),
    '--tab-overview-basis': `${columns * 232 - 12}px`,
    '--tab-overview-max-width': `${columns * 420 + (columns - 1) * 12}px`
  }
}

function tabDisplayUrl(tab: BrowserTabState): string {
  if (tab.url === 'about:blank') return t('tabSearch.blankPage')
  try {
    const url = new URL(tab.url)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}`
  } catch {
    return tab.url
  }
}

defineExpose({ openPanel, close })
onBeforeUnmount(() => { dispose(); pagePreview.dispose() })
</script>

<template>
  <div v-if="open" class="settings-overlay tab-overview-overlay" @click.self="close">
    <section ref="panel" class="tab-search-panel" :class="{ 'tab-search-sparse': sparseCount <= 2, 'tab-search-single': sparseCount <= 1, 'tab-search-single-preview': regularTabs.length === 1, 'tab-search-detail': previewTabId }" @keydown="handlePanelKeydown" role="dialog" aria-modal="true" aria-labelledby="tab-search-title" tabindex="-1">
      <header>
        <div>
          <span class="eyebrow">{{ t('tabSearch.kicker') }}</span>
          <h2 id="tab-search-title">{{ t('tabSearch.heading') }}</h2>
        </div>
        <div v-if="!previewTabId" class="tab-search-summary">
          <span class="tab-search-live" :class="{ paused: previewRefreshPaused }" :data-preview-count="Object.keys(previewsByTab).length"><span aria-hidden="true" />{{ previewRefreshPaused ? t('tabSearch.previewsPaused') : t('tabSearch.livePreviews') }}</span>
          <span class="tab-search-count">{{ t('tabSearch.countOpen', { count: formatNumber(regularTabs.length) }) }}{{ state.savedTabGroups.length ? ` ${t('tabSearch.countSaved', { count: formatNumber(state.savedTabGroups.length) })}` : '' }}{{ state.closedTabs.length ? ` ${t('tabSearch.countClosed', { count: formatNumber(state.closedTabs.length) })}` : '' }}</span>
        </div>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('tabSearch.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
      </header>
      <section v-if="previewTabId" class="tab-page-preview" role="region" :aria-label="t('tabSearch.pagePreview')">
        <div class="tab-page-preview-toolbar">
          <UiButton ref="previewBack" @click="backToTabs">{{ t('tabSearch.backToTabs') }}</UiButton>
          <div class="tab-page-preview-heading">
            <strong>{{ previewTab?.title || t('tabSearch.newTabTitle') }}</strong>
            <span>{{ previewTab ? tabDisplayUrl(previewTab) : t('tabSearch.previewClosed') }}</span>
          </div>
          <UiButton variant="primary" :disabled="!previewTab || actionPending" @click="previewTab && selectOpenTab(previewTab)">{{ t('tabSearch.openTab') }}</UiButton>
        </div>
        <div class="tab-page-preview-options">
          <UiSegmentedControl v-model="previewFit" :options="fitOptions" :label="t('tabSearch.previewScale')" />
          <span>{{ t('tabSearch.previewSnapshot') }}</span>
          <UiButton :disabled="pagePreviewStatus === 'loading' || !previewTab || previewTab.loading || previewTab.sleeping" @click="pagePreview.refresh">{{ t('tabSearch.refreshPreview') }}</UiButton>
        </div>
        <div v-if="fullPreview" class="tab-page-preview-canvas" :class="`fit-${previewFit}`" tabindex="0" :aria-label="t('tabSearch.pagePreview')">
          <img :src="fullPreview.dataUrl" :width="fullPreview.width" :height="fullPreview.height" :alt="t('tabSearch.fullPreviewAlt', { title: previewTab?.title || t('tabSearch.newTabTitle') })" draggable="false" />
        </div>
        <div v-else class="tab-page-preview-state" :role="pagePreviewStatus === 'loading' ? 'status' : 'alert'" :aria-busy="pagePreviewStatus === 'loading'">
          <span v-if="pagePreviewStatus === 'loading'" class="spinner" aria-hidden="true" />
          <strong>{{ t(pagePreviewStatus === 'loading' ? 'tabSearch.previewCapturing' : pagePreviewStatus === 'closed' ? 'tabSearch.previewClosed' : pagePreviewStatus === 'changed' ? 'tabSearch.previewChanged' : 'tabSearch.previewFailed') }}</strong>
          <span v-if="pagePreviewStatus !== 'loading' && previewTab">{{ pagePreviewStatus === 'error' ? formatError(pagePreviewError, t('tabSearch.previewRecovery')) : t('tabSearch.previewRecovery') }}</span>
          <UiButton v-if="pagePreviewStatus !== 'loading' && previewTab" :disabled="previewTab.loading || previewTab.sleeping" @click="pagePreview.refresh">{{ t('tabSearch.retryPreview') }}</UiButton>
        </div>
      </section>
      <template v-else>
      <div v-if="regularTabs.length || state.closedTabs.length || state.savedTabGroups.length" class="tab-search-field">
        <IconSearch aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          type="search"
          role="searchbox"
          :aria-label="t('tabSearch.search')"
          aria-autocomplete="list"
          aria-controls="tab-search-results"
          aria-describedby="tab-search-status"
          :aria-expanded="results.length > 0"
          :aria-activedescendant="selectedResult ? resultId(selectedResult) : undefined"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('tabSearch.placeholder')"
          @keydown="handleSearchKeydown"
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
        <UiButton appearance="application" type="button" @click="emit('newTab')">{{ t('tabSearch.newTab') }}</UiButton>
      </div>
      <div v-else-if="!results.length" class="tab-search-empty compact">
        <IconSearch aria-hidden="true" />
        <strong>{{ t('tabSearch.noMatches') }}</strong>
        <span>{{ t('tabSearch.tryAnother') }}</span>
      </div>
      <div v-else id="tab-search-results" class="tab-search-list" role="region" :aria-label="t('tabSearch.results')">
        <div class="tab-overview-workspaces">
          <section
            v-for="workspace in filteredWorkspaceGroups"
            :key="workspace.id"
            class="tab-overview-workspace"
            :style="workspaceLayoutStyle(workspace)"
          >
            <h3 :id="`tab-overview-workspace-${workspace.id}`"><span class="tab-overview-workspace-dot" aria-hidden="true" />{{ workspace.name }} <span>{{ formatNumber(workspace.tabs.length) }}</span></h3>
            <div class="tab-overview-grid" role="list" :aria-labelledby="`tab-overview-workspace-${workspace.id}`">
              <article
                v-for="tab in workspace.tabs"
                :key="tab.id"
                class="tab-overview-card"
                :class="{ selected: resultIndex('open', tab.id) === selection, active: tab.active }"
                role="listitem"
                @pointermove="selectFromPointer($event, resultIndex('open', tab.id))"
              >
                <UiButton appearance="application"
                  :id="resultId({ kind: 'open', tab })"
                  class="tab-overview-open"
                  type="button"
                  :title="tab.url"
                  :disabled="actionPending"
                  @click="selectOpenTab(tab)"
                >
                  <span class="tab-overview-preview">
                    <img v-if="previewForTab(tab)" :src="previewForTab(tab)?.dataUrl" alt="" draggable="false" />
                    <span v-else class="tab-overview-placeholder">
                      <IconBedtime v-if="tab.sleeping" aria-hidden="true" />
                      <span v-else-if="previewLoading" class="spinner" aria-hidden="true" />
                      <img v-else-if="tab.faviconDataUrl" :src="tab.faviconDataUrl" alt="" draggable="false" />
                      <IconLanguage v-else aria-hidden="true" />
                      <small>{{ tab.sleeping ? t('tabSearch.previewSleeping') : t('tabSearch.previewUnavailable') }}</small>
                    </span>
                    <span v-if="tab.active" class="tab-overview-current">{{ t('tabSearch.meta.current') }}</span>
                  </span>
                  <span class="tab-overview-copy">
                    <span class="tab-overview-title-row">
                      <span class="tab-search-site-icon" aria-hidden="true">
                        <span v-if="tab.loading" class="spinner" />
                        <img v-else-if="tab.faviconDataUrl" :src="tab.faviconDataUrl" alt="" draggable="false" />
                        <span v-else-if="tab.url === 'about:blank'">✦</span>
                        <IconLanguage v-else />
                      </span>
                      <strong>{{ tab.title || t('tabSearch.newTabTitle') }}</strong>
                    </span>
                    <span>{{ tabDisplayUrl(tab) }}</span>
                    <small v-if="tabMeta(tab)">{{ tabMeta(tab) }}</small>
                  </span>
                </UiButton>
                <div class="tab-overview-preview-action">
                  <UiButton :id="`tab-page-preview-${tab.id}`" :aria-label="t('tabSearch.previewAria', { title: tab.title || t('tabSearch.newTabTitle') })" :disabled="actionPending || tab.sleeping || tab.loading" :title="tab.sleeping ? t('tabSearch.previewSleeping') : undefined" @click="showPagePreview(tab)">{{ t('tabSearch.fullPagePreview') }}</UiButton>
                </div>
                <span class="tab-overview-card-actions">
                  <UiButton appearance="application"
                    class="tab-search-pin"
                    :class="{ active: tab.pinned }"
                    type="button"
                    :aria-label="tab.pinned ? t('tabSearch.unpinAria', { title: tab.title || t('tabSearch.newTabTitle') }) : t('tabSearch.pinAria', { title: tab.title || t('tabSearch.newTabTitle') })"
                    :title="tab.pinned ? t('tabSearch.unpin') : t('tabSearch.pin')"
                    :aria-pressed="tab.pinned"
                    :disabled="actionPending"
                    @click="togglePinnedTab($event, tab)"
                  ><IconKeep aria-hidden="true" /></UiButton>
                  <UiButton appearance="application" class="tab-search-close" type="button" :aria-label="t('tabSearch.closeTabAria', { title: tab.title || t('tabSearch.newTabTitle') })" :title="t('tabSearch.closeTab')" :disabled="actionPending || state.allHumanInteractionLocked" data-lock-protected-tab-close @click="closeOpenTab($event, tab.id)"><IconClose aria-hidden="true" /></UiButton>
                </span>
              </article>
            </div>
          </section>
        </div>
        <section v-if="filteredSavedTabGroups.length" class="tab-search-section compact-results saved-groups" aria-labelledby="saved-groups-title">
          <h3 id="saved-groups-title">{{ t('tabSearch.archived') }} <span>{{ formatNumber(filteredSavedTabGroups.length) }}</span></h3>
          <div class="tab-search-compact-grid" role="list" :aria-label="t('tabSearch.archivedAria')">
            <article
              v-for="group in filteredSavedTabGroups"
              :key="group.id"
              class="tab-search-item saved-group"
              :class="{ selected: resultIndex('saved', group.id) === selection }"
              role="listitem"
              @pointermove="selectFromPointer($event, resultIndex('saved', group.id))"
            >
              <UiButton appearance="application" :id="resultId({ kind: 'saved', tab: group })" class="tab-search-open" type="button" :title="group.tabs.map((tab) => tab.url).join('\n')" :disabled="actionPending" @click="restoreSavedGroup(group)">
                <span class="tab-search-site-icon saved" :style="tabGroupColorStyle(group.color)" aria-hidden="true"><IconFolderOpen /></span>
                <span class="tab-search-copy">
                  <strong>{{ group.name }}</strong>
                  <span>{{ t('tabSearch.savedTabs', { count: formatNumber(group.tabs.length) }, group.tabs.length) }}</span>
                  <small>{{ group.tabs.slice(0, 3).map((tab) => tab.title || tab.url).join(' · ') }}</small>
                </span>
              </UiButton>
              <UiButton appearance="application" class="tab-search-restore" type="button" :aria-label="t('tabSearch.restoreWorkspaceAria', { name: group.name })" :title="t('tabSearch.restoreWorkspace')" :disabled="actionPending" @click="restoreSavedGroup(group)"><IconRestore aria-hidden="true" /></UiButton>
              <UiButton appearance="application" class="tab-search-close" type="button" :aria-label="t('tabSearch.deleteWorkspaceAria', { name: group.name })" :title="t('tabSearch.deleteWorkspace')" :disabled="actionPending" @click="deleteSavedGroup($event, group)"><IconDelete aria-hidden="true" /></UiButton>
            </article>
          </div>
        </section>
        <section v-if="filteredClosedTabs.length" class="tab-search-section compact-results recently-closed" aria-labelledby="closed-tabs-title">
          <h3 id="closed-tabs-title">{{ t('tabSearch.recentlyClosed') }} <span>{{ formatNumber(filteredClosedTabs.length) }}</span></h3>
          <div class="tab-search-compact-grid" role="list" :aria-label="t('accessibility.recentlyClosedTabs')">
            <article
              v-for="tab in filteredClosedTabs"
              :key="tab.id"
              class="tab-search-item closed"
              :class="{ selected: resultIndex('closed', tab.id) === selection }"
              role="listitem"
              @pointermove="selectFromPointer($event, resultIndex('closed', tab.id))"
            >
              <UiButton appearance="application" :id="resultId({ kind: 'closed', tab })" class="tab-search-open" type="button" :title="tab.url" :disabled="actionPending" @click="restoreClosedTab(tab)">
                <span class="tab-search-site-icon closed" aria-hidden="true"><IconHistory /></span>
                <span class="tab-search-copy">
                  <strong>{{ tab.title || t('tabSearch.newTabTitle') }}</strong>
                  <span>{{ tab.url === 'about:blank' ? t('tabSearch.blankPage') : tab.url }}</span>
                  <small>{{ closedTabMeta(tab) }}</small>
                </span>
              </UiButton>
              <UiButton appearance="application" class="tab-search-restore" type="button" :aria-label="t('tabSearch.restoreAria', { title: tab.title || t('tabSearch.newTabTitle') })" :title="t('tabSearch.restore')" :disabled="actionPending" @click="restoreClosedTab(tab)"><IconRestore aria-hidden="true" /></UiButton>
            </article>
          </div>
        </section>
      </div>
      </template>
      <footer v-if="!previewTabId"><span><kbd>↑</kbd><kbd>↓</kbd> {{ t('tabSearch.navigate') }}</span><span><kbd>Enter</kbd> {{ t('tabSearch.open') }}</span><span><kbd>Esc</kbd> {{ t('tabSearch.close') }}</span></footer>
    </section>
  </div>
</template>
