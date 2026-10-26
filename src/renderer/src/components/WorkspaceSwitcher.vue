<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconKeep from '~icons/material-symbols/keep-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconTabSearch from '~icons/material-symbols/tab-search-rounded'
import IconWorkspaces from '~icons/material-symbols/workspaces-outline'
import type { HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { commandShortcutKeys } from '../../../shared/command-palette.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import type { BrowserState, BrowserTabState, HronautApi, UserAttentionRequest } from '../../../shared/types.js'
import {
  filterWorkspaceSwitcherEntries,
  workspaceSwitcherEntries,
  type WorkspaceSwitcherEntry
} from '../../../shared/workspace-switcher.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import { goToWorkspace, workspaceEntryDetails, workspaceEntryStatus } from '../workspace-navigation.js'
import UiButton from '../ui/UiButton.vue'
import UiOverlayTransition from '../ui/UiOverlayTransition.vue'

const props = defineProps<{
  state: BrowserState
  userAttention?: Pick<UserAttentionRequest, 'tabId' | 'workspaceId'> | null
  browser: Pick<HronautApi, 'newTab' | 'restoreSavedTabGroup'>
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  selectTab: (tabId: string) => Promise<unknown>
  expandTabGroup: (tab: BrowserTabState) => void
  formatNumber: (value: number) => string
  formatError: (cause: unknown, fallback: string) => string
  showError: (title: string, message: string) => void
  presenceApi?: HronautAgentPresenceApi
}>()

const emit = defineEmits<{
  /** Look for a tab instead, in tab search. */
  searchTabs: []
  createWorkspace: []
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const switcherKeys = commandShortcutKeys('Ctrl/Cmd+K', window.hronautShell?.windowChrome.platform === 'darwin')
const presence = useAgentPresence(props.presenceApi)
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const selection = ref(0)

const entries = computed(() => workspaceSwitcherEntries(props.state, presence.snapshot.value.workspaces, props.userAttention, t('shell.agents.unnamed')))
// The order is settled when the switcher opens, so a workspace does not move under the pointer or the
// selection when an agent starts or stops there; its status still changes in place. A workspace that appears
// meanwhile goes last in its own section, where it is drawn, so the arrow keys follow the list on screen.
const order = shallowRef(new Map<string, number>())
const ordered = computed(() => {
  const known = order.value
  return entries.value
    .map((entry, index) => ({ entry, rank: known.get(`${entry.kind}:${entry.id}`) ?? known.size + index }))
    .sort((left, right) => Number(left.entry.kind === 'archived') - Number(right.entry.kind === 'archived') || left.rank - right.rank)
    .map(({ entry }) => entry)
})
const results = computed(() => filterWorkspaceSwitcherEntries(ordered.value, query.value))
const sections = computed(() => [
  { id: 'open', entries: results.value.filter((entry) => entry.kind === 'open') },
  { id: 'archived', entries: results.value.filter((entry) => entry.kind === 'archived') }
].filter((section) => section.entries.length))
const selected = computed<WorkspaceSwitcherEntry | undefined>(() => results.value[selection.value])
// One string, so the sentences keep the space between them that template whitespace would lose.
const status = computed(() => [
  t('workspaceSwitcher.matches', { count: props.formatNumber(results.value.length) }, results.value.length),
  selected.value ? t('workspaceSwitcher.selected', { name: selected.value.name }) : ''
].filter(Boolean).join(' '))

function key(entry: WorkspaceSwitcherEntry): string {
  return `${entry.kind}:${entry.id}`
}

function optionId(entry: WorkspaceSwitcherEntry): string {
  return `workspace-switcher-${entry.kind}-${entry.id}`
}

function indexOf(entry: WorkspaceSwitcherEntry): number {
  return results.value.findIndex((candidate) => key(candidate) === key(entry))
}

function colorStyle(entry: WorkspaceSwitcherEntry): Record<string, string> {
  return { '--workspace-color': BROWSER_TAB_GROUP_COLOR_HEX[entry.color] }
}

function statusText(entry: WorkspaceSwitcherEntry): string {
  return workspaceEntryStatus(entry, t, props.formatNumber)
}

function details(entry: WorkspaceSwitcherEntry): string {
  return workspaceEntryDetails(entry, t, props.formatNumber)
}

function label(entry: WorkspaceSwitcherEntry): string {
  return [
    entry.name,
    entry.current ? t('workspaceSwitcher.current') : '',
    entry.pinnedAt ? t('workspaceSwitcher.pinned') : '',
    entry.kind === 'archived' ? t('workspaceSwitcher.archived') : '',
    statusText(entry),
    details(entry)
  ].filter(Boolean).join(', ')
}

function reveal(): void {
  const entry = selected.value
  if (entry) document.getElementById(optionId(entry))?.scrollIntoView?.({ block: 'nearest' })
}

// With nothing typed, Enter goes to a workspace other than the one in view: where an agent needs you or works, or else
// the one used most recently. Pinned workspaces are listed above the rest but do not take that place from it.
function firstChoice(): number {
  if (query.value.trim()) return 0
  const entries = results.value
  const busy = entries.findIndex((entry) => !entry.current && entry.status !== 'idle')
  if (busy >= 0) return busy
  let recent = -1
  entries.forEach((entry, index) => {
    if (!entry.current && entry.kind === 'open' && (recent < 0 || entry.usedAt > entries[recent].usedAt)) recent = index
  })
  return recent >= 0 ? recent : Math.max(0, entries.findIndex((entry) => !entry.current))
}

// A new query starts from its best match; otherwise the selected workspace keeps its selection as the list changes.
// A closed switcher lists nothing, so each page that loads does not work out every workspace's entry again.
watch([query, () => open.value ? results.value.map(key) : []], ([nextQuery, nextKeys], [previousQuery, previousKeys]) => {
  if (nextQuery !== previousQuery) {
    selection.value = firstChoice()
  } else {
    const kept = previousKeys?.[selection.value]
    const index = kept ? nextKeys.indexOf(kept) : -1
    selection.value = index >= 0 ? index : Math.min(selection.value, Math.max(0, nextKeys.length - 1))
  }
  void nextTick(reveal)
}, { flush: 'sync' })

let presentation = 0
// Each choice, and each opening, is newer than the choice before; only the newest one reports a failure.
let choice = 0
async function openPanel(): Promise<void> {
  presentation += 1
  choice += 1
  lastPointer = null
  order.value = new Map(entries.value.map((entry, index) => [key(entry), index]))
  query.value = ''
  selection.value = firstChoice()
  open.value = true
  const current = presentation
  await nextTick()
  if (current !== presentation || !open.value) return
  input.value?.focus()
  reveal()
}

function close(): void {
  open.value = false
}

watch(open, (isOpen) => { if (!isOpen) presentation += 1 }, { flush: 'sync' })

async function choose(entry: WorkspaceSwitcherEntry): Promise<void> {
  close()
  const current = ++choice
  try {
    const found = await goToWorkspace(entry, props)
    // Closed after the list was drawn, such as by an agent.
    if (!found) props.showError(t('workspaceSwitcher.switchFailed'), t('workspaceSwitcher.switchDescription', { name: entry.name }))
  } catch (cause) {
    // Reopening the switcher, or choosing again, is newer; a late failure does not cover it.
    if (current !== choice) return
    const archived = entry.kind === 'archived'
    props.showError(
      t(archived ? 'runtime.workspace.restoreFailed' : 'workspaceSwitcher.switchFailed'),
      props.formatError(cause, archived ? t('runtime.workspace.restoreDescription') : t('workspaceSwitcher.switchDescription', { name: entry.name }))
    )
  }
}

function searchTabs(): void {
  close()
  emit('searchTabs')
}

async function createWorkspace(): Promise<void> {
  close()
  // The workspace editor opens only while the palette is closed, which it sees once the closed switcher is drawn.
  await nextTick()
  emit('createWorkspace')
}

function move(offset: number): void {
  const count = results.value.length
  if (!count) return
  selection.value = (selection.value + offset + count) % count
  void nextTick(reveal)
}

function handleKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event)) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' && selected.value) {
    event.preventDefault()
    // The switcher opens with the focus here and another workspace selected, often from Switch workspace pressed with
    // Enter, so a held Enter would switch without a choice.
    if (!event.repeat) void choose(selected.value)
  }
}

// Where the pointer was at its last event since the switcher opened. The first event only says where it rests:
// hiding the pages under the switcher hands Hronaut's window a pointer event wherever the pointer already was,
// and a list that scrolls under a resting pointer sends more. Only a pointer that moves selects a workspace, so
// Enter still goes where the switcher opened on.
let lastPointer: { x: number; y: number } | null = null
function pointerMoved(event: PointerEvent): boolean {
  const moved = lastPointer !== null && (lastPointer.x !== event.clientX || lastPointer.y !== event.clientY)
  lastPointer = { x: event.clientX, y: event.clientY }
  return moved
}

function selectFromPointer(event: PointerEvent, entry: WorkspaceSwitcherEntry): void {
  if (!pointerMoved(event)) return
  const index = indexOf(entry)
  if (index >= 0) selection.value = index
}

useModalDialogFocus({ open, panel, focusOnOpen: false })

defineExpose({ openPanel, close })
onBeforeUnmount(() => {
  presentation += 1
  choice += 1
  presence.dispose()
})
</script>

<template>
  <UiOverlayTransition>
    <div v-if="open" class="settings-overlay command-palette-overlay" @click.self="close" @pointermove="pointerMoved">
      <section
        ref="panel"
        class="command-palette workspace-switcher"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-switcher-title"
      >
        <header class="command-palette-header">
          <IconWorkspaces aria-hidden="true" />
          <div>
            <span class="eyebrow">{{ t('workspaceSwitcher.kicker') }}</span>
            <h2 id="workspace-switcher-title">{{ t('workspaceSwitcher.heading') }}</h2>
          </div>
          <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('workspaceSwitcher.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
        </header>
        <div class="command-palette-field">
          <IconSearch aria-hidden="true" />
          <input
            ref="input"
            v-model="query"
            type="search"
            role="combobox"
            :aria-label="t('workspaceSwitcher.search')"
            aria-autocomplete="list"
            aria-controls="workspace-switcher-results"
            :aria-expanded="results.length > 0"
            :aria-activedescendant="selected ? optionId(selected) : undefined"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('workspaceSwitcher.placeholder')"
            @keydown="handleKeydown"
          />
          <span class="command-palette-keys" aria-hidden="true"><kbd v-for="key in switcherKeys" :key="key">{{ key }}</kbd></span>
        </div>
        <span class="sr-only" role="status" aria-live="polite">
          {{ status }}
        </span>
        <div v-if="results.length" id="workspace-switcher-results" class="command-palette-results" role="listbox" :aria-label="t('workspaceSwitcher.results')">
          <div v-for="section in sections" :key="section.id" class="workspace-switcher-section" role="group" :aria-labelledby="section.id === 'archived' ? 'workspace-switcher-archived' : undefined" :aria-label="section.id === 'open' ? t('workspaceSwitcher.openGroup') : undefined">
            <h3 v-if="section.id === 'archived'" id="workspace-switcher-archived" class="workspace-switcher-heading" aria-hidden="true">{{ t('workspaceSwitcher.archived') }}</h3>
            <UiButton appearance="application"
              v-for="entry in section.entries"
              :id="optionId(entry)"
              :key="key(entry)"
              class="command-palette-item workspace-switcher-item"
              :class="{ selected: selected && key(selected) === key(entry), archived: entry.kind === 'archived' }"
              :data-status="entry.status"
              :style="colorStyle(entry)"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="selected !== undefined && key(selected) === key(entry)"
              :aria-current="entry.current ? 'true' : undefined"
              :aria-label="label(entry)"
              @pointermove="selectFromPointer($event, entry)"
              @click="choose(entry)"
            >
              <span class="workspace-switcher-mark" aria-hidden="true"><IconFolderOpen v-if="entry.kind === 'archived'" /></span>
              <span class="command-palette-copy">
                <strong>{{ entry.name }}</strong>
                <small>
                  <span v-if="statusText(entry)" class="workspace-switcher-status">{{ statusText(entry) }}</span><template v-if="statusText(entry) && details(entry)"> · </template>{{ details(entry) }}
                </small>
              </span>
              <span class="command-palette-meta">
                <small v-if="entry.pinnedAt" class="workspace-switcher-pinned"><IconKeep aria-hidden="true" />{{ t('workspaceSwitcher.pinned') }}</small>
                <small v-if="entry.current">{{ t('workspaceSwitcher.current') }}</small>
              </span>
            </UiButton>
          </div>
        </div>
        <div v-else class="command-palette-empty">
          <IconSearch aria-hidden="true" />
          <strong>{{ entries.length ? t('workspaceSwitcher.empty') : t('workspaceSwitcher.none') }}</strong>
          <span>{{ entries.length ? t('workspaceSwitcher.emptyDescription') : t('workspaceSwitcher.noneDescription') }}</span>
        </div>
        <footer class="workspace-switcher-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ t('workspaceSwitcher.navigate') }}</span>
          <span><kbd>Enter</kbd> {{ t('workspaceSwitcher.choose') }}</span>
          <span class="workspace-switcher-actions">
            <UiButton variant="ghost" type="button" aria-keyshortcuts="Control+Shift+A Meta+Shift+A" @click="searchTabs"><template #startIcon><IconTabSearch /></template>{{ t('workspaceSwitcher.searchTabs') }}</UiButton>
            <UiButton variant="ghost" type="button" @click="createWorkspace"><template #startIcon><IconAdd /></template>{{ t('workspaceSwitcher.newWorkspace') }}</UiButton>
          </span>
        </footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
