<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAdsClick from '~icons/material-symbols/ads-click-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconHandyman from '~icons/material-symbols/handyman-rounded'
import IconLock from '~icons/material-symbols/lock-rounded'
import IconLockOpen from '~icons/material-symbols/lock-open-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconScreenshotRegion from '~icons/material-symbols/screenshot-region-rounded'
import type { BrowserState, BrowserTabState, HronautApi } from '../../../shared/types.js'
import type {
  ElementPickerState,
  ScreenshotCaptureState
} from '../composables/usePageCaptureController.js'
import SplitViewControl from './SplitViewControl.vue'

type SplitViewBrowserApi = Pick<HronautApi, 'openSplitView' | 'updateSplitView' | 'closeSplitView'>

const props = defineProps<{
  state: BrowserState
  activeTab?: BrowserTabState
  browser: SplitViewBrowserApi
  acceptState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  closeOtherMenus: () => void
  effectiveHumanInteractionLocked: boolean
  tabHumanInteractionLocked: boolean
  tabInteractionLockLabel: string
  areaCaptureState: ScreenshotCaptureState
  areaCaptureLabel: string
  elementPickerState: ElementPickerState
  elementPickerTitle: string
  elementPickerLabel: string
  pageToolsOpen: boolean
}>()

const emit = defineEmits<{
  toggleTabInteraction: []
  toggleAreaCapture: []
  toggleElementPicker: []
  togglePageTools: []
  splitError: [cause: unknown, fallback: string]
}>()

const splitMenuOpen = defineModel<boolean>('splitMenuOpen', { required: true })
const { t } = useI18n({ useScope: 'global' })
const activeTabIsInternal = computed(() => !props.activeTab || props.activeTab.url.startsWith('hronaut://home'))

function reportSplitError(cause: unknown, fallback: string): void {
  emit('splitError', cause, fallback)
}
</script>

<template>
  <div
    class="interaction-locks"
    role="group"
    :aria-label="t(effectiveHumanInteractionLocked ? 'runtime.locks.inputLocked' : 'runtime.locks.inputLock')"
  >
    <button
      class="interaction-lock-button"
      :class="{ locked: tabHumanInteractionLocked }"
      type="button"
      :title="tabInteractionLockLabel"
      :aria-label="tabInteractionLockLabel"
      :aria-pressed="tabHumanInteractionLocked"
      :disabled="activeTabIsInternal || state.allHumanInteractionLocked"
      @click="emit('toggleTabInteraction')"
    >
      <IconLock v-if="tabHumanInteractionLocked" aria-hidden="true" />
      <IconLockOpen v-else aria-hidden="true" />
      {{ t('shell.split.tab') }}
    </button>
  </div>
  <SplitViewControl
    v-model:open="splitMenuOpen"
    :state="state"
    :active-tab="activeTab"
    :browser="browser"
    :accept-state="acceptState"
    :close-other-menus="closeOtherMenus"
    @error="reportSplitError"
  />
  <button
    class="icon-button area-capture-button"
    :class="{ active: areaCaptureState === 'picking' || areaCaptureState === 'capturing', copied: areaCaptureState === 'copied', error: areaCaptureState === 'error' }"
    type="button"
    :title="areaCaptureLabel"
    :aria-label="areaCaptureLabel"
    :aria-pressed="areaCaptureState === 'picking'"
    :disabled="activeTabIsInternal || areaCaptureState === 'capturing'"
    @click="emit('toggleAreaCapture')"
  >
    <IconCheck v-if="areaCaptureState === 'copied'" aria-hidden="true" />
    <IconClose v-else-if="areaCaptureState === 'picking'" aria-hidden="true" />
    <IconProgress v-else-if="areaCaptureState === 'capturing'" class="state-spinner" aria-hidden="true" />
    <IconScreenshotRegion v-else aria-hidden="true" />
  </button>
  <button
    class="icon-button element-picker-button"
    :class="{ active: elementPickerState === 'picking', copied: elementPickerState === 'copied', error: elementPickerState === 'error' }"
    type="button"
    :title="elementPickerTitle"
    :aria-label="elementPickerLabel"
    aria-keyshortcuts="Control+Shift+C Meta+Alt+C"
    :aria-pressed="elementPickerState === 'picking'"
    :disabled="activeTabIsInternal || areaCaptureState === 'capturing'"
    @click="emit('toggleElementPicker')"
  >
    <IconCheck v-if="elementPickerState === 'copied'" aria-hidden="true" />
    <IconClose v-else-if="elementPickerState === 'picking'" aria-hidden="true" />
    <IconAdsClick v-else aria-hidden="true" />
  </button>
  <button
    class="icon-button page-tools-button"
    :class="{ active: pageToolsOpen }"
    type="button"
    :title="t('shell.pageTools.heading')"
    :aria-label="t('shell.pageTools.heading')"
    aria-haspopup="dialog"
    aria-controls="page-tools-panel"
    :aria-expanded="pageToolsOpen"
    :disabled="activeTabIsInternal"
    @click="emit('togglePageTools')"
  >
    <IconHandyman aria-hidden="true" />
  </button>
</template>
