<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconHorizontalSplit from '~icons/material-symbols/horizontal-split-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconSwapHoriz from '~icons/material-symbols/swap-horiz-rounded'
import IconVerticalSplit from '~icons/material-symbols/vertical-split-rounded'
import type { BrowserState, BrowserTabState, HronautApi } from '../../../shared/types.js'
import type { BrowserSplitOrientation } from '../../../shared/split-view.js'

type SplitViewBrowserApi = Pick<HronautApi, 'openSplitView' | 'updateSplitView' | 'closeSplitView'>

const props = defineProps<{
  state: BrowserState
  activeTab?: BrowserTabState
  browser: SplitViewBrowserApi
  acceptState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  closeOtherMenus: () => void
}>()

const emit = defineEmits<{
  error: [cause: unknown, fallback: string]
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const busy = ref(false)
const regularTabs = computed(() => props.state.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')))
const available = computed(() => regularTabs.value.length > 1 || props.state.splitView !== undefined)
const splitViewTabs = computed(() => props.state.splitView
  ? [
      props.state.tabs.find((tab) => tab.id === props.state.splitView!.firstTabId),
      props.state.tabs.find((tab) => tab.id === props.state.splitView!.secondTabId)
    ].filter((tab): tab is BrowserTabState => Boolean(tab))
  : [])
const splitCandidates = computed(() => regularTabs.value.filter((tab) => tab.id !== props.state.activeTabId))
const splitPartner = computed(() => splitViewTabs.value.find((tab) => tab.id !== props.state.activeTabId))

function close(): void {
  open.value = false
}

function toggleMenu(): void {
  if (open.value) {
    close()
    return
  }
  props.closeOtherMenus()
  open.value = true
}

async function runMutation(
  operation: () => Promise<BrowserState>,
  fallback: string,
  closeMenu = false
): Promise<void> {
  if (busy.value) return
  if (closeMenu) close()
  busy.value = true
  try {
    await props.acceptState(operation())
  } catch (error) {
    emit('error', error, fallback)
  } finally {
    busy.value = false
  }
}

async function openTabInSplitView(tabId: string): Promise<void> {
  await runMutation(
    () => props.browser.openSplitView(tabId),
    t('runtimeActions.workspace.splitOpen'),
    true
  )
}

async function changeSplitLayout(orientation: BrowserSplitOrientation): Promise<void> {
  if (props.state.splitView?.orientation === orientation) return
  await runMutation(
    () => props.browser.updateSplitView({ orientation }),
    t('runtimeActions.workspace.splitLayout')
  )
}

async function changeSplitRatio(event: Event): Promise<void> {
  const ratio = Number((event.target as HTMLInputElement).value) / 100
  await runMutation(
    () => props.browser.updateSplitView({ ratio }),
    t('runtimeActions.workspace.splitSize')
  )
}

async function swapSplitTabs(): Promise<void> {
  await runMutation(
    () => props.browser.updateSplitView({ swap: true }),
    t('runtimeActions.workspace.splitSwap')
  )
}

async function exitSplitView(): Promise<void> {
  await runMutation(
    () => props.browser.closeSplitView(),
    t('runtimeActions.workspace.splitClose'),
    true
  )
}

watch(available, (isAvailable) => {
  if (!isAvailable) close()
}, { immediate: true })

onBeforeUnmount(close)
defineExpose({ close, toggleMenu })
</script>

<template>
  <div v-if="available" class="split-view-control">
    <UiButton appearance="application"
      class="icon-button split-view-button"
      :class="{ active: Boolean(state.splitView) }"
      type="button"
      :title="state.splitView ? t('runtime.tabs.splitWith', { title: splitPartner?.title || t('runtime.tabs.splitOther') }) : t('runtime.tabs.splitOpen')"
      :aria-label="t('shell.split.heading')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggleMenu"
    >
      <IconHorizontalSplit v-if="state.splitView?.orientation === 'horizontal'" aria-hidden="true" />
      <IconVerticalSplit v-else aria-hidden="true" />
    </UiButton>
    <section
      v-if="open"
      class="split-view-menu"
      data-shell-side-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="split-view-menu-title"
      :aria-busy="busy"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('shell.split.workspace') }}</span>
          <h2 id="split-view-menu-title">{{ t('shell.split.heading') }}</h2>
        </div>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('shell.split.closeMenu')" @click="close"><IconClose aria-hidden="true" /></UiButton>
      </header>
      <template v-if="state.splitView">
        <p class="split-view-summary">{{ activeTab?.title || t('shell.split.tab') }} {{ t('shell.split.with') }} {{ splitPartner?.title || t('shell.split.tab') }}</p>
        <div class="split-layout-options" role="group" :aria-label="t('shell.split.layout')">
          <UiButton appearance="application"
            type="button"
            :class="{ selected: state.splitView.orientation === 'vertical' }"
            :aria-pressed="state.splitView.orientation === 'vertical'"
            :disabled="busy"
            @click="changeSplitLayout('vertical')"
          ><IconVerticalSplit aria-hidden="true" /><span>{{ t('shell.split.side') }}</span></UiButton>
          <UiButton appearance="application"
            type="button"
            :class="{ selected: state.splitView.orientation === 'horizontal' }"
            :aria-pressed="state.splitView.orientation === 'horizontal'"
            :disabled="busy"
            @click="changeSplitLayout('horizontal')"
          ><IconHorizontalSplit aria-hidden="true" /><span>{{ t('shell.split.stacked') }}</span></UiButton>
        </div>
        <label class="split-ratio-control">
          <span>{{ t('shell.split.first') }}</span>
          <input
            type="range"
            min="25"
            max="75"
            step="5"
            :value="Math.round(state.splitView.ratio * 100)"
            :disabled="busy"
            @change="changeSplitRatio"
          />
          <output>{{ Math.round(state.splitView.ratio * 100) }}%</output>
        </label>
        <footer>
          <UiButton appearance="application" type="button" :disabled="busy" @click="swapSplitTabs"><IconSwapHoriz aria-hidden="true" /> {{ t('shell.split.swap') }}</UiButton>
          <UiButton appearance="application" variant="danger" class="danger" type="button" :disabled="busy" @click="exitSplitView"><IconClose aria-hidden="true" /> {{ t('shell.split.exit') }}</UiButton>
        </footer>
      </template>
      <template v-else>
        <p class="split-view-summary">{{ t('shell.split.choose', { page: activeTab?.title || t('shell.split.thisPage') }) }}</p>
        <div class="split-candidate-list">
          <UiButton appearance="application" v-for="tab in splitCandidates" :key="tab.id" type="button" :disabled="busy" @click="openTabInSplitView(tab.id)">
            <img v-if="tab.faviconDataUrl" :src="tab.faviconDataUrl" alt="" />
            <IconLanguage v-else aria-hidden="true" />
            <span><strong>{{ tab.title || t('shell.split.newTab') }}</strong><small>{{ tab.mcpGroupName || t('shell.split.noWorkspace') }}</small></span>
          </UiButton>
        </div>
      </template>
    </section>
  </div>
</template>
