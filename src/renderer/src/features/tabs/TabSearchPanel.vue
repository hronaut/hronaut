<script setup lang="ts">
import TabLabelEditor from './TabLabelEditor.vue'
import UiButton from "../../ui/UiButton.vue"
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import UiSegmentedControl from '../../ui/UiSegmentedControl.vue'
import UiOverlayTransition from '../../ui/UiOverlayTransition.vue'
import UiMenu, { type UiMenuItem } from '../../ui/UiMenu.vue'
import { useTabPagePreview } from './useTabPagePreview.js'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconBedtime from '~icons/material-symbols/bedtime-outline-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconMore from '~icons/material-symbols/more-horiz-rounded'
import IconRestore from '~icons/material-symbols/restore-page-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconTabSearch from '~icons/material-symbols/tab-search-rounded'
import type {
  BrowserState,
  BrowserTabGroupColor,
  BrowserTabState,
  McpTabActivity
} from '../../../../shared/types.js'
import { commandShortcutKeys } from '../../../../shared/command-palette.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../../shared/tab-groups.js'
import { tabTitleForDisplay } from '../../../../shared/tab-title.js'
import { useTabSearchController } from './useTabSearchController.js'
import { useModalDialogFocus } from '../../composables/useModalDialogFocus.js'
import { vTooltip } from '../../ui/tooltip.js'
import { confirmAction } from '../../confirm-action.js'
import { ignoreHeldEnter } from '../../held-enter.js'

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

const emit = defineEmits<{ newTab: []; transferWorkspaceData: [] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
// The key that opens tab search on this platform: Control+Shift+A on macOS stays with the page.
const searchKeysMac = window.hronautShell?.windowChrome?.platform === 'darwin'
const searchKeys = commandShortcutKeys('Ctrl/Cmd+Shift+A', searchKeysMac).join(searchKeysMac ? ' ' : '+')
const panel = ref<HTMLElement | null>(null)
const {
  input,
  query,
  resultKind,
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
  confirm: confirmAction,
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
/** The card whose ⋯ menu is open; one at a time, and none when the overview opens again. */
const cardMenuTabId = ref<string | null>(null)
watch(open, (isOpen) => {
  if (!isOpen) cardMenuTabId.value = null
})

/** The card's rarer actions, kept out of sight until its ⋯ menu opens. */
function cardMenuItems(tab: BrowserTabState): UiMenuItem[] {
  return [
    { id: 'pin', label: tab.pinned ? t('tabSearch.unpin') : t('tabSearch.pin'), disabled: actionPending.value },
    { id: 'preview', label: t('tabSearch.fullPagePreview'), disabled: actionPending.value || tab.sleeping || tab.loading }
  ]
}

/**
 * Every overview action is disabled while one runs, so Chromium moves the focus of the one you used to the document
 * body. A finished close, pin or delete hands focus to the search field itself and a restore closes the overview; after
 * a failure, give the focus back to that control, or else the overview itself, unless you moved it meanwhile. Not to the
 * search field: Enter there runs the selected result, which a held Enter would then do.
 */
async function keepFocusThrough(event: Event, action: () => Promise<unknown>): Promise<void> {
  const dialog = panel.value
  const focused = event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget
    ? event.currentTarget : null
  await action()
  await nextTick()
  if (!focused || !dialog || !open.value || dialog !== panel.value || !dialog.isConnected || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = focused.isConnected && !focused.matches(':disabled') ? focused : dialog
  target.focus()
}

function runCardMenuItem(tab: BrowserTabState, id: string): void {
  if (id === 'pin') void togglePinnedTab(undefined, tab)
  else if (id === 'preview') void showPagePreview(tab, `tab-card-menu-${tab.id}`)
}

function tabHost(tab: BrowserTabState): string {
  try {
    const url = new URL(tab.url)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : ''
  } catch {
    return ''
  }
}

const sparseCount = computed(() => regularTabs.value.length + props.state.closedTabs.length + props.state.savedTabGroups.length)
const fitOptions = computed(() => [
  { value: 'page', label: t('tabSearch.fitPage') },
  { value: 'width', label: t('tabSearch.fitWidth') }
])
let previewReturnId: string | null = null

/** Opens the tab's full-page preview; Back to tabs returns to `returnId`'s control, or else the search field. */
async function showPagePreview(tab: BrowserTabState, returnId: string | null): Promise<void> {
  if (actionPending.value || tab.sleeping || tab.loading) return
  previewReturnId = returnId
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
    // Alt+Enter opens it from the search field, so Back to tabs returns there. A held Alt+Enter would open and close
    // the preview on every repeat.
    if (!event.repeat) void showPagePreview(selectedResult.value.tab, null)
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
  <UiOverlayTransition>
    <div v-if="open" class="settings-overlay tab-overview-overlay" @click.self="close">
      <section ref="panel" class="tab-search-panel" :class="{ 'tab-search-sparse': sparseCount <= 2, 'tab-search-single': sparseCount <= 1, 'tab-search-single-preview': regularTabs.length === 1, 'tab-search-detail': previewTabId }" @keydown="handlePanelKeydown" role="dialog" aria-modal="true" aria-labelledby="tab-search-title" tabindex="-1">
        <header>
          <div>
            <span class="eyebrow">{{ t('tabSearch.kicker') }}</span>
            <h2 id="tab-search-title">{{ t('tabSearch.heading') }}</h2>
          </div>
          <div v-if="!previewTabId" class="tab-search-summary">
            <span v-if="resultKind === 'all' || resultKind === 'open'" class="tab-search-live" :class="{ paused: previewRefreshPaused }" :data-preview-count="Object.keys(previewsByTab).length"><span aria-hidden="true" />{{ previewRefreshPaused ? t('tabSearch.previewsPaused') : t('tabSearch.livePreviews') }}</span>
            <span class="tab-search-count">{{ t('tabSearch.countOpen', { count: formatNumber(regularTabs.length) }) }}{{ state.savedTabGroups.length ? ` ${t('tabSearch.countSaved', { count: formatNumber(state.savedTabGroups.length) })}` : '' }}{{ state.closedTabs.length ? ` ${t('tabSearch.countClosed', { count: formatNumber(state.closedTabs.length) })}` : '' }}</span>
          </div>
          <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('tabSearch.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
        </header>
        <section v-if="previewTabId" class="tab-page-preview" role="region" :aria-label="t('tabSearch.pagePreview')">
          <div class="tab-page-preview-toolbar">
            <UiButton ref="previewBack" @keydown="ignoreHeldEnter" @click="backToTabs">{{ t('tabSearch.backToTabs') }}</UiButton>
            <div class="tab-page-preview-heading">
              <strong>{{ previewTab ? tabTitleForDisplay(previewTab, t('tabSearch.newTabTitle')) : t('tabSearch.newTabTitle') }}</strong>
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
            <img :src="fullPreview.dataUrl" :width="fullPreview.width" :height="fullPreview.height" :alt="t('tabSearch.fullPreviewAlt', { title: previewTab ? tabTitleForDisplay(previewTab, t('tabSearch.newTabTitle')) : t('tabSearch.newTabTitle') })" draggable="false" />
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
          <kbd data-testid="tab-search-keys">{{ searchKeys }}</kbd>
        </div>
        <label v-if="regularTabs.length || state.closedTabs.length || state.savedTabGroups.length" class="tab-search-kind-filter">
          <span>{{ t('tabSearch.resultType') }}</span>
          <select v-model="resultKind" :disabled="actionPending">
            <option value="all">{{ t('tabSearch.allResults') }}</option>
            <option value="open">{{ t('tabSearch.openTabs') }}</option>
            <option value="closed">{{ t('tabSearch.recentlyClosed') }}</option>
            <option value="saved">{{ t('tabSearch.archived') }}</option>
          </select>
        </label>
        <span id="tab-search-status" class="sr-only" role="status" aria-live="polite">
          {{ t('tabSearch.matches', { count: formatNumber(results.length) }, results.length) }}<template v-if="selectedResult">{{ ' ' + t('tabSearch.selected', { item: resultLabel(selectedResult) }) }}</template>
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
                    v-tooltip="tab.url"
                    :disabled="actionPending"
                    @click="selectOpenTab(tab)"
                  >
                    <span class="tab-overview-preview" :class="{ sleeping: tab.sleeping }">
                      <img v-if="previewForTab(tab)" :src="previewForTab(tab)?.dataUrl" alt="" draggable="false" />
                      <span v-else class="tab-overview-placeholder">
                        <span class="tab-overview-placeholder-site" aria-hidden="true">
                          <IconBedtime v-if="tab.sleeping" />
                          <span v-else-if="previewLoading" class="spinner" />
                          <img v-else-if="tab.faviconDataUrl" :src="tab.faviconDataUrl" alt="" draggable="false" />
                          <IconLanguage v-else />
                        </span>
                        <strong v-if="tabHost(tab)">{{ tabHost(tab) }}</strong>
                        <small>{{ tab.sleeping ? t('tabSearch.previewSleeping') : t('tabSearch.previewNotYet') }}</small>
                      </span>
                      <span v-if="tab.sleeping && previewForTab(tab)" class="tab-overview-sleeping"><IconBedtime aria-hidden="true" />{{ t('tabSearch.sleeping') }}</span>
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
                        <strong>{{ tab.label || tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) }}</strong>
                      </span>
                      <small v-if="tab.label">{{ tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) }}</small>
                      <span>{{ tabDisplayUrl(tab) }}</span>
                      <small v-if="tabMeta(tab)">{{ tabMeta(tab) }}</small>
                    </span>
                  </UiButton>
                  <span class="tab-overview-card-actions">
                    <UiMenu
                      class="tab-overview-more"
                      align="end"
                      :trigger-id="`tab-card-menu-${tab.id}`"
                      :label="t('tabSearch.moreActionsAria', { title: tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) })"
                      :tooltip="t('tabSearch.moreActions')"
                      :items="cardMenuItems(tab)"
                      :open="cardMenuTabId === tab.id"
                      @update:open="cardMenuTabId = $event ? tab.id : (cardMenuTabId === tab.id ? null : cardMenuTabId)"
                      @select="runCardMenuItem(tab, $event)"
                    ><template #trigger><IconMore aria-hidden="true" /></template></UiMenu>
                    <UiButton appearance="application" class="tab-search-close" type="button" :aria-label="t('tabSearch.closeTabAria', { title: tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) })" v-tooltip="t('tabSearch.closeTab')" :disabled="actionPending" @click="keepFocusThrough($event, () => closeOpenTab($event, tab.id))"><IconClose aria-hidden="true" /></UiButton>
                  </span>
                  <TabLabelEditor :tab="tab" />
                </article>
              </div>
            </section>
          </div>
          <section v-if="filteredSavedTabGroups.length" class="tab-search-section compact-results saved-groups" aria-labelledby="saved-groups-title">
            <UiButton appearance="application" type="button" :disabled="actionPending" @click="emit('transferWorkspaceData')">{{ t('workspaceEditor.transferData') }}</UiButton>
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
                <UiButton appearance="application" :id="resultId({ kind: 'saved', tab: group })" class="tab-search-open" type="button" v-tooltip="group.tabs.map((tab) => tab.url).join('\n')" :disabled="actionPending" @click="keepFocusThrough($event, () => restoreSavedGroup(group))">
                  <span class="tab-search-site-icon saved" :style="tabGroupColorStyle(group.color)" aria-hidden="true"><IconFolderOpen /></span>
                  <span class="tab-search-copy">
                    <strong>{{ group.name }}</strong>
                    <span>{{ t('tabSearch.savedTabs', { count: formatNumber(group.tabs.length) }, group.tabs.length) }}</span>
                    <small>{{ group.tabs.slice(0, 3).map((tab) => tab.label || tabTitleForDisplay(tab, t('tabSearch.newTabTitle'))).join(' · ') }}</small>
                  </span>
                </UiButton>
                <UiButton appearance="application" class="tab-search-restore" type="button" :aria-label="t('tabSearch.restoreWorkspaceAria', { name: group.name })" v-tooltip="t('tabSearch.restoreWorkspace')" :disabled="actionPending" @click="keepFocusThrough($event, () => restoreSavedGroup(group))"><IconRestore aria-hidden="true" /></UiButton>
                <UiButton appearance="application" class="tab-search-close" type="button" :aria-label="t('tabSearch.deleteWorkspaceAria', { name: group.name })" v-tooltip="t('tabSearch.deleteWorkspace')" :disabled="actionPending" @click="keepFocusThrough($event, () => deleteSavedGroup($event, group))"><IconDelete aria-hidden="true" /></UiButton>
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
                <UiButton appearance="application" :id="resultId({ kind: 'closed', tab })" class="tab-search-open" type="button" v-tooltip="tab.url" :disabled="actionPending" @click="restoreClosedTab(tab)">
                  <span class="tab-search-site-icon closed" aria-hidden="true"><IconHistory /></span>
                  <span class="tab-search-copy">
                    <strong>{{ tab.label || tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) }}</strong>
                        <small v-if="tab.label">{{ tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) }}</small>
                    <span>{{ tab.url === 'about:blank' ? t('tabSearch.blankPage') : tab.url }}</span>
                    <small>{{ closedTabMeta(tab) }}</small>
                  </span>
                </UiButton>
                <UiButton appearance="application" class="tab-search-restore" type="button" :aria-label="t('tabSearch.restoreAria', { title: tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) })" v-tooltip="t('tabSearch.restore')" :disabled="actionPending" @click="restoreClosedTab(tab)"><IconRestore aria-hidden="true" /></UiButton>
              </article>
            </div>
          </section>
        </div>
        </template>
        <footer v-if="!previewTabId"><span><kbd>↑</kbd><kbd>↓</kbd> {{ t('tabSearch.navigate') }}</span><span><kbd>Enter</kbd> {{ t('tabSearch.open') }}</span><span><kbd>Esc</kbd> {{ t('tabSearch.close') }}</span></footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
