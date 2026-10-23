<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useResizeObserver } from '@vueuse/core'
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded'
import IconArrowForward from '~icons/material-symbols/arrow-forward-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconStar from '~icons/material-symbols/star-rounded'
import IconStarOutline from '~icons/material-symbols/star-outline-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import type { BrowserTabState } from '../../../shared/types.js'
import { asMiddleClick } from '../open-click.js'
import { toolbarClickAction } from '../toolbar-click.js'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  activeTab?: BrowserTabState
  zoomOpen: boolean
  bookmarksOpen: boolean
  currentBookmark: boolean
  formatPercent: (value: number) => string
  /** Lists the pages the arrow goes through, opening at the anchor, in the window's CSS pixels; false when there were none. */
  listHistory: (direction: 'back' | 'forward', anchor: { x: number; y: number }) => Promise<boolean>
}>()

const emit = defineEmits<{
  back: []
  forward: []
  reload: []
  reloadIgnoringCache: []
  /** The page Back, Forward or Reload goes to, opening in a new tab beside the tab; behind unless active. */
  openInNewTab: [target: 'back' | 'forward' | 'reload', active: boolean]
  stop: []
  find: []
  toggleZoom: []
  toggleBookmarks: []
}>()

const { t } = useI18n({ useScope: 'global' })

// As in Chrome, holding an arrow down this long, or right-clicking it, lists the pages it goes through.
const HISTORY_HOLD_MS = 500
let historyHold: ReturnType<typeof setTimeout> | undefined
// The arrow whose hold listed its pages, so the click its release makes does not also go there.
let heldArrow: 'back' | 'forward' | null = null

function openHistoryList(direction: 'back' | 'forward', button: Element): Promise<boolean> {
  const { left, bottom } = button.getBoundingClientRect()
  return props.listHistory(direction, { x: left, y: bottom })
}

function holdArrow(direction: 'back' | 'forward', event: PointerEvent): void {
  heldArrow = null
  releaseArrow()
  const button = event.currentTarget
  if (event.button !== 0 || !event.isPrimary || !(button instanceof Element)) return
  historyHold = setTimeout(() => {
    historyHold = undefined
    heldArrow = direction
    // With no list to show, such as for a tab that is waking, letting go goes there as a click does.
    void openHistoryList(direction, button).then((shown) => {
      if (!shown && heldArrow === direction) heldArrow = null
    }, () => {
      if (heldArrow === direction) heldArrow = null
    })
  }, HISTORY_HOLD_MS)
}

function releaseArrow(): void {
  clearTimeout(historyHold)
  historyHold = undefined
}

function rightClickArrow(direction: 'back' | 'forward', event: MouseEvent): void {
  // A touch's long press opens the list by the hold already.
  if ('pointerType' in event && event.pointerType === 'touch') return
  releaseArrow()
  if (event.currentTarget instanceof Element) void openHistoryList(direction, event.currentTarget)
}

function clickArrow(direction: 'back' | 'forward', event: MouseEvent): void {
  const held = heldArrow === direction
  heldArrow = null
  // A key's click has no pointer behind it, so it is never the end of a hold.
  if (held && event.detail > 0) return
  if (clickedElsewhere(direction, event)) return
  if (direction === 'back') emit('back')
  else emit('forward')
}

onBeforeUnmount(releaseArrow)

function clickReload(event: MouseEvent): void {
  if (props.activeTab?.loading) emit('stop')
  else if (!clickedElsewhere('reload', event)) emit('reload')
}

const mac = window.hronautShell?.windowChrome?.platform === 'darwin'

/** Opens the button's page in a new tab, or reloads without the cache, for a click Chrome reads so; says whether it did. */
function clickedElsewhere(button: 'back' | 'forward' | 'reload', event: MouseEvent): boolean {
  const action = toolbarClickAction(button, event, mac)
  if (action === 'reload-ignoring-cache') emit('reloadIgnoringCache')
  else if (action) emit('openInNewTab', button, action === 'new-tab')
  return action !== undefined
}

const commands = ref<HTMLElement>()
// True while the commands sit in their own band below the address. The address field then
// fills its row (styles/shell/toolbar.css), so both rows end at the same edge.
const commandsWrapped = ref(false)

function syncCommandsWrapped(): void {
  const reload = commands.value?.parentElement?.querySelector<HTMLElement>('.reload-button')
  if (!reload || !commands.value) return
  commandsWrapped.value = commands.value.getBoundingClientRect().top >= reload.getBoundingClientRect().bottom
}

useResizeObserver(
  () => [commands.value, commands.value?.parentElement].filter((element): element is HTMLElement => Boolean(element)),
  syncCommandsWrapped
)
</script>

<template>
  <UiButton appearance="application"
    class="icon-button back-button"
    type="button"
    v-tooltip="t('shell.toolbar.backTitle')"
    :aria-label="t('shell.toolbar.back')"
    :disabled="!activeTab?.canGoBack"
    @click="clickArrow('back', $event)"
    @auxclick="asMiddleClick($event, (click) => clickArrow('back', click))"
    @pointerdown="holdArrow('back', $event)"
    @pointerup="releaseArrow"
    @pointerleave="releaseArrow"
    @pointercancel="releaseArrow"
    @contextmenu.prevent="rightClickArrow('back', $event)"
  ><IconArrowBack aria-hidden="true" /></UiButton>
  <UiButton appearance="application"
    class="icon-button forward-button"
    type="button"
    v-tooltip="t('shell.toolbar.forwardTitle')"
    :aria-label="t('shell.toolbar.forward')"
    :disabled="!activeTab?.canGoForward"
    @click="clickArrow('forward', $event)"
    @auxclick="asMiddleClick($event, (click) => clickArrow('forward', click))"
    @pointerdown="holdArrow('forward', $event)"
    @pointerup="releaseArrow"
    @pointerleave="releaseArrow"
    @pointercancel="releaseArrow"
    @contextmenu.prevent="rightClickArrow('forward', $event)"
  ><IconArrowForward aria-hidden="true" /></UiButton>
  <UiButton appearance="application" class="icon-button reload-button" type="button" v-tooltip="t(activeTab?.loading ? 'runtime.tabs.stop' : 'runtime.tabs.reload')" :aria-label="t(activeTab?.loading ? 'runtime.tabs.stop' : 'runtime.tabs.reload')" :disabled="!activeTab" @click="clickReload" @auxclick="asMiddleClick($event, clickReload)">
    <IconStop v-if="activeTab?.loading" aria-hidden="true" />
    <IconRefresh v-else aria-hidden="true" />
  </UiButton>
  <slot />
  <div ref="commands" class="toolbar-commands" :class="{ wrapped: commandsWrapped }">
    <!-- Takes only the room the commands leave, so it never narrows the address field. -->
    <slot name="leading" />
    <UiButton appearance="application"
      class="icon-button find-button"
      type="button"
      v-tooltip="t('shell.toolbar.findTitle')"
      :aria-label="t('shell.toolbar.find')"
      aria-keyshortcuts="Control+F Meta+F"
      :disabled="!activeTab"
      @click="emit('find')"
    >
      <IconSearch aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="zoom-button"
      type="button"
      v-tooltip="t('runtime.address.zoom', { percent: formatPercent(activeTab?.zoomPercent ?? 100) })"
      :aria-label="t('shell.toolbar.zoom', { percent: `${activeTab?.zoomPercent ?? 100}%` })"
      :aria-expanded="zoomOpen"
      :disabled="!activeTab"
      @click="emit('toggleZoom')"
    >
      {{ activeTab?.zoomPercent ?? 100 }}%
    </UiButton>
    <UiButton appearance="application"
      class="icon-button bookmarks-button"
      :class="{ bookmarked: currentBookmark }"
      type="button"
      v-tooltip="t(currentBookmark ? 'runtime.tabs.bookmarkSaved' : 'runtime.tabs.bookmarkSave')"
      :aria-label="t('shell.toolbar.bookmarks')"
      aria-keyshortcuts="Control+D Meta+D"
      :aria-expanded="bookmarksOpen"
      :disabled="!activeTab"
      @click="emit('toggleBookmarks')"
    >
      <IconStar v-if="currentBookmark" aria-hidden="true" />
      <IconStarOutline v-else aria-hidden="true" />
    </UiButton>
    <slot name="commands" />
  </div>
</template>
